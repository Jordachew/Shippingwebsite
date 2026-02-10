// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Safe singleton
window.__SB__ = window.__SB__ || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabase = window.__SB__;

function $(id){ return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function firstNameFromProfile(p){
  const n = (p?.full_name || "").trim();
  if(n) return n.split(/\s+/)[0];
  const e = (p?.email || "").trim();
  return e ? e.split("@")[0] : "Customer";
}
function customerLabel(p){
  const fn = firstNameFromProfile(p);
  const email = p?.email || "—";
  const acct = p?.customer_no ? ` — ${p.customer_no}` : "";
  return `${fn} — ${email}${acct}`;
}
function pickupLabel(v){
  return v === "RHODEN_HALL_CLARENDON" ? "Rhoden Hall, Clarendon" : "UWI, Kingston";
}
function debounce(fn, ms=250){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

let currentStaff = null;
let msgChannel = null;
let activeUserId = null;
let activeProfile = null;

// --------------------
// Tabs
// --------------------
function setTab(name){
  document.querySelectorAll(".tab").forEach(b=>{
    b.classList.toggle("active", b.getAttribute("data-tab") === name);
  });
  document.querySelectorAll(".tabPanel").forEach(p=>{
    p.classList.toggle("hidden", p.id !== `tab-${name}`);
  });
}

// --------------------
// Auth
// --------------------
async function signIn(email, password){
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error };
}

async function signOut(){
  await supabase.auth.signOut();
}

async function getSession(){
  const { data, error } = await supabase.auth.getSession();
  return { session: data?.session || null, error };
}

async function getUser(){
  const { data, error } = await supabase.auth.getUser();
  return { user: data?.user || null, error };
}

async function loadMyProfile(user){
  // IMPORTANT: filter by current user id to avoid RLS issues and wrong rows
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  return { profile: data || null, error };
}

async function requireStaff(){
  const { user, error: uErr } = await getUser();
  if(uErr) return { ok:false, error:uErr };
  if(!user) return { ok:false, error:new Error("Not signed in") };

  const { profile, error: pErr } = await loadMyProfile(user);
  if(pErr) return { ok:false, error:pErr };
  if(!profile) return { ok:false, error:new Error("No profile row found for this staff user.") };

  if(profile.role !== "staff" && profile.role !== "admin"){
    return { ok:false, error:new Error("This account is not staff/admin. Set role in profiles table.") };
  }

  currentStaff = { id:user.id, email:user.email, role: profile.role };
  if($("staffLabel")) $("staffLabel").textContent = `${profile.email} (${profile.role})`;
  return { ok:true, user, profile };
}

// --------------------
// Stats
// --------------------
async function renderStats(){
  const note = $("statsNote");
  try{
    // Customers
    const customersRes = await supabase
      .from("profiles")
      .select("id,role", { count:"exact", head:true });
    // Packages
    const pkgRes = await supabase
      .from("packages")
      .select("id,status", { count:"exact" })
      .limit(1000);

    // Messages open
    const msgRes = await supabase
      .from("messages")
      .select("id,resolved", { count:"exact" })
      .limit(2000);

    const customersCount = customersRes.count ?? null;
    const packagesCount = pkgRes.count ?? (pkgRes.data?.length ?? null);

    const statusCounts = {};
    (pkgRes.data || []).forEach(p=>{
      const s = (p.status || "Unknown").trim();
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    const inTransit = statusCounts["In Transit"] || statusCounts["IN_TRANSIT"] || 0;
    const ready = statusCounts["Ready for Pickup"] || statusCounts["READY_FOR_PICKUP"] || 0;

    let openMsgs = 0;
    (msgRes.data || []).forEach(m=>{
      if(m.resolved === false || m.resolved === null) openMsgs += 1;
    });

    if($("statCustomers")) $("statCustomers").textContent = customersCount ?? "—";
    if($("statPackages")) $("statPackages").textContent = packagesCount ?? "—";
    if($("statInTransit")) $("statInTransit").textContent = inTransit;
    if($("statReady")) $("statReady").textContent = ready;
    if($("statMessagesOpen")) $("statMessagesOpen").textContent = openMsgs;

    if(note) note.textContent = "Stats reflect what staff can access with current RLS policies.";
  }catch(e){
    console.error(e);
    if(note) note.textContent = "Stats error: " + (e?.message || e);
  }
}

// --------------------
// Customers
// --------------------
async function findCustomerByEmailOrAccount(q){
  q = (q || "").trim();
  if(!q) return { profile:null, error:null };

  // Try by account number first
  let res = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,customer_no,role")
    .eq("customer_no", q)
    .maybeSingle();

  if(res.error) return { profile:null, error:res.error };
  if(res.data) return { profile:res.data, error:null };

  // Fall back to email
  res = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,customer_no,role")
    .eq("email", q.toLowerCase())
    .maybeSingle();

  if(res.error) return { profile:null, error:res.error };
  return { profile:res.data || null, error:null };
}

async function renderCustomerResult(profile){
  const el = $("custResult");
  if(!el) return;
  if(!profile){
    el.innerHTML = `<div class="muted small">No customer found.</div>`;
    return;
  }

  // load order history (packages)
  const pkgs = await supabase
    .from("packages")
    .select("tracking,status,pickup,updated_at")
    .eq("user_id", profile.id)
    .order("updated_at",{ascending:false})
    .limit(50);

  const orders = (pkgs.data || []).map(p=>`
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status || "—")}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}</td>
      <td class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="muted">No packages assigned.</td></tr>`;

  el.innerHTML = `
    <div class="stack">
      <div><strong>${escapeHTML(customerLabel(profile))}</strong></div>
      <div class="muted small">User ID: ${escapeHTML(profile.id)}</div>
      <div class="muted small">Phone: ${escapeHTML(profile.phone || "—")}</div>
      <div class="muted small">Role: ${escapeHTML(profile.role || "customer")}</div>

      <div class="divider"></div>

      <div class="muted small"><strong>Order history</strong></div>
      <table class="table">
        <thead><tr><th>Tracking</th><th>Status</th><th>Pickup</th><th>Updated</th></tr></thead>
        <tbody>${orders}</tbody>
      </table>
    </div>
  `;
}

// --------------------
// Packages
// --------------------
async function resolveUserIdByEmail(email){
  const res = await supabase
    .from("profiles")
    .select("id,email,full_name,customer_no")
    .eq("email", (email||"").trim().toLowerCase())
    .maybeSingle();
  if(res.error) return { user_id:null, profile:null, error:res.error };
  if(!res.data) return { user_id:null, profile:null, error:new Error("No customer found with that email.") };
  return { user_id:res.data.id, profile:res.data, error:null };
}

async function renderPackages(){
  const body = $("pkgBody");
  if(!body) return;

  const q = ($("pkgSearch")?.value || "").trim().toLowerCase();

  // Pull packages + profiles to render email/account
  const { data: pkgs, error } = await supabase
    .from("packages")
    .select("id,tracking,status,pickup,pickup_confirmed,updated_at,user_id")
    .order("updated_at",{ascending:false})
    .limit(300);

  if(error){
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const userIds = [...new Set((pkgs||[]).map(p=>p.user_id).filter(Boolean))];
  const profMap = {};
  if(userIds.length){
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,full_name,customer_no")
      .in("id", userIds);
    (profs||[]).forEach(p=> profMap[p.id] = p);
  }

  let rows = (pkgs||[]).map(p=>{
    const prof = profMap[p.user_id] || null;
    const cust = prof ? customerLabel(prof) : (p.user_id ? p.user_id : "—");
    return { p, cust, email:(prof?.email||"").toLowerCase(), acct:(prof?.customer_no||"").toLowerCase() };
  });

  if(q){
    rows = rows.filter(r=>{
      const tracking = (r.p.tracking||"").toLowerCase();
      const status = (r.p.status||"").toLowerCase();
      return tracking.includes(q) || status.includes(q) || r.email.includes(q) || r.acct.includes(q);
    });
  }

  if(!rows.length){
    body.innerHTML = `<tr><td colspan="6" class="muted">No packages found.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(({p, cust})=>`
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status || "—")}</span></td>
      <td>${escapeHTML(cust)}</td>
      <td>${escapeHTML(pickupLabel(p.pickup))}${p.pickup_confirmed ? ' <span class="tag">Confirmed</span>' : ''}</td>
      <td class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
      <td>
        <button class="btn btn--ghost btn-sm" type="button" data-action="editPkg" data-id="${escapeHTML(p.id)}">Edit</button>
      </td>
    </tr>
  `).join("");
}

async function savePackageFromForm(){
  const msg = $("pkgMsg");
  if(msg) msg.textContent = "Saving...";

  const tracking = ($("pkgTracking")?.value || "").trim();
  const status = ($("pkgStatus")?.value || "").trim();
  const email = ($("pkgCustomerEmail")?.value || "").trim().toLowerCase();
  const pickup = ($("pkgPickup")?.value || "UWI_KINGSTON").trim();
  const weight = parseFloat(($("pkgWeight")?.value || "").trim());
  const cost = parseFloat(($("pkgCost")?.value || "").trim());

  if(!tracking){
    if(msg) msg.textContent = "Tracking is required.";
    return;
  }

  let user_id = null;
  if(email){
    const resolved = await resolveUserIdByEmail(email);
    if(resolved.error){
      if(msg) msg.textContent = resolved.error.message;
      return;
    }
    user_id = resolved.user_id;
  }

  const payload = {
    tracking,
    status,
    pickup,
    user_id,
  };
  if(Number.isFinite(weight)) payload.weight = weight;
  if(Number.isFinite(cost)) payload.cost = cost;

  // upsert on tracking if id not provided
  const { error } = await supabase
    .from("packages")
    .upsert(payload, { onConflict:"tracking" });

  if(error){
    if(msg) msg.textContent = error.message;
    return;
  }

  if(msg) msg.textContent = "Saved.";
  if($("pkgForm")) $("pkgForm").reset();
  await renderPackages();
  await renderStats();
}

// --------------------
// Invoices
// --------------------
async function renderInvoices(){
  const body = $("invBody");
  const msg = $("invMsg");
  if(!body) return;

  const q = ($("invSearch")?.value || "").trim().toLowerCase();
  const filter = ($("invFilter")?.value || "pending").trim();

  let query = supabase
    .from("invoices")
    .select("id,tracking,file_name,file_path,pickup,created_at,approved,user_id")
    .order("created_at",{ascending:false})
    .limit(300);

  if(filter === "pending") query = query.eq("approved", false);
  if(filter === "approved") query = query.eq("approved", true);

  const { data, error } = await query;
  if(error){
    body.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const userIds = [...new Set((data||[]).map(i=>i.user_id).filter(Boolean))];
  const profMap = {};
  if(userIds.length){
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,full_name,customer_no")
      .in("id", userIds);
    (profs||[]).forEach(p=> profMap[p.id]=p);
  }

  let rows = (data||[]).map(i=>{
    const prof = profMap[i.user_id] || null;
    const cust = prof ? customerLabel(prof) : (i.user_id || "—");
    return { i, cust, email:(prof?.email||"").toLowerCase(), acct:(prof?.customer_no||"").toLowerCase() };
  });

  if(q){
    rows = rows.filter(r=>{
      const tracking = (r.i.tracking||"").toLowerCase();
      return tracking.includes(q) || r.email.includes(q) || r.acct.includes(q);
    });
  }

  if(!rows.length){
    body.innerHTML = `<tr><td colspan="7" class="muted">No invoices.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(({i, cust})=>{
    const approved = !!i.approved;
    return `
      <tr>
        <td><strong>${escapeHTML(i.tracking || "—")}</strong></td>
        <td>${escapeHTML(cust)}</td>
        <td>${escapeHTML(i.file_name || "file")}</td>
        <td>${escapeHTML(pickupLabel(i.pickup))}</td>
        <td><span class="tag">${approved ? "Approved" : "Pending"}</span></td>
        <td class="muted small">${i.created_at ? new Date(i.created_at).toLocaleString() : "—"}</td>
        <td class="row">
          <button class="btn btn--ghost btn-sm" type="button" data-action="openInvoice" data-id="${escapeHTML(i.id)}">Open</button>
          ${approved ? "" : `<button class="btn btn--ghost btn-sm" type="button" data-action="approveInvoice" data-id="${escapeHTML(i.id)}">Approve</button>`}
          <button class="btn btn--ghost btn-sm" type="button" data-action="rejectInvoice" data-id="${escapeHTML(i.id)}">Reject</button>
        </td>
      </tr>
    `;
  }).join("");

  if(msg) msg.textContent = "";
}

async function setInvoiceApproval(id, approved){
  const msg = $("invMsg");
  if(msg) msg.textContent = approved ? "Approving..." : "Rejecting...";

  const patch = {
    approved,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? (currentStaff?.id || null) : null,
  };

  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  if(error){
    if(msg) msg.textContent = error.message;
    return;
  }

  if(msg) msg.textContent = approved ? "Approved." : "Rejected.";
  await renderInvoices();
  await renderStats();
}

// --------------------
// Messages
// --------------------
async function renderConversations(){
  const list = $("convList");
  if(!list) return;

  const q = ($("msgSearch")?.value || "").trim().toLowerCase();

  // Pull recent messages, then group by user_id
  const { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved")
    .order("created_at",{ascending:false})
    .limit(400);

  if(error){
    list.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  const byUser = {};
  (data||[]).forEach(m=>{
    if(!byUser[m.user_id]) byUser[m.user_id]=m;
  });

  const userIds = Object.keys(byUser);
  const profMap = {};
  if(userIds.length){
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,email,full_name,customer_no")
      .in("id", userIds);
    (profs||[]).forEach(p=> profMap[p.id]=p);
  }

  let convos = userIds.map(uid=>{
    const m = byUser[uid];
    const prof = profMap[uid] || null;
    const label = prof ? customerLabel(prof) : uid;
    const hay = (label + " " + (m.body||"")).toLowerCase();
    return { uid, label, prof, m, hay };
  });

  if(q){
    convos = convos.filter(c=> c.hay.includes(q) || (c.prof?.customer_no||"").toLowerCase().includes(q));
  }

  if(!convos.length){
    list.innerHTML = `<div class="muted small">No conversations.</div>`;
    return;
  }

  list.innerHTML = convos.map(c=>`
    <button class="btn btn--ghost" type="button" data-action="openConv" data-uid="${escapeHTML(c.uid)}" style="width:100%; justify-content:space-between; display:flex">
      <span>${escapeHTML(c.label)}</span>
      <span class="muted small">${c.m.created_at ? new Date(c.m.created_at).toLocaleDateString() : ""}</span>
    </button>
  `).join("");
}

async function renderChat(userId){
  const body = $("adminChatBody");
  const label = $("convLabel");
  if(!body) return;

  if(!userId){
    body.innerHTML = `<div class="muted small">Select a conversation.</div>`;
    if(label) label.textContent = "—";
    return;
  }

  const profRes = await supabase
    .from("profiles")
    .select("id,email,full_name,customer_no")
    .eq("id", userId)
    .maybeSingle();

  activeProfile = profRes.data || null;
  if(label) label.textContent = activeProfile ? customerLabel(activeProfile) : userId;

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", userId)
    .order("created_at",{ascending:true})
    .limit(500);

  if(error){
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data||[]).map(m=>`
    <div class="bubble ${m.sender === "staff" ? "" : "me"}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${escapeHTML(m.sender === "staff" ? "Support" : "Customer")}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">No messages yet.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function subscribeMessages(userId){
  if(msgChannel){
    supabase.removeChannel(msgChannel);
    msgChannel = null;
  }
  if(!userId) return;

  msgChannel = supabase
    .channel(`admin-messages:${userId}`)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`user_id=eq.${userId}` },
      async () => { await renderChat(userId); }
    )
    .subscribe();
}

async function sendStaffMessage(userId, text){
  if(!text.trim()) return;

  const { error } = await supabase.from("messages").insert({
    user_id: userId,
    sender: "staff",
    body: text.trim(),
    resolved: false
  });

  if(error) throw error;
}

// --------------------
// Bulk CSV
// --------------------
function parseCsv(text){
  const lines = (text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return [];
  const header = lines[0].split(",").map(s=>s.trim().toLowerCase());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(",").map(s=>s.trim());
    const obj = {};
    header.forEach((h, idx)=> obj[h] = cols[idx] ?? "");
    rows.push(obj);
  }
  return rows;
}

async function runBulkUpload(){
  const msg = $("bulkMsg");
  if(msg) msg.textContent = "Uploading...";

  const rows = parseCsv($("bulkCsv")?.value || "");
  if(!rows.length){
    if(msg) msg.textContent = "Paste CSV first.";
    return;
  }

  let ok=0, fail=0;
  for(const r of rows){
    try{
      const tracking = (r.tracking||"").trim();
      if(!tracking) { fail++; continue; }

      const status = (r.status||"In Transit").trim() || "In Transit";
      const pickup = (r.pickup||"UWI_KINGSTON").trim() || "UWI_KINGSTON";
      const weight = parseFloat((r.weight||"").trim());
      const cost = parseFloat((r.cost||"").trim());

      let user_id = null;
      if(r.email){
        const resolved = await resolveUserIdByEmail(r.email);
        if(!resolved.error) user_id = resolved.user_id;
      }

      const payload = { tracking, status, pickup, user_id };
      if(Number.isFinite(weight)) payload.weight = weight;
      if(Number.isFinite(cost)) payload.cost = cost;

      const { error } = await supabase.from("packages").upsert(payload, { onConflict:"tracking" });
      if(error) throw error;
      ok++;
    }catch(e){
      console.error(e);
      fail++;
    }
  }

  if(msg) msg.textContent = `Done. Success: ${ok}, Failed: ${fail}`;
  await renderPackages();
  await renderStats();
}

// --------------------
// Init + wiring
// --------------------
function bindUI(){
  // Tabs
  $("tabs")?.addEventListener("click", (e)=>{
    const b = e.target.closest(".tab");
    if(!b) return;
    setTab(b.getAttribute("data-tab"));
  });

  // Auth
  $("loginForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const authMsg = $("authMsg");
    const btn = $("loginBtn");
    if(authMsg) authMsg.textContent = "Signing in...";
    if(btn) btn.disabled = true;

    try{
      const email = ($("loginEmail")?.value || "").trim().toLowerCase();
      const password = $("loginPassword")?.value || "";
      const res = await signIn(email, password);
      if(res.error){
        if(authMsg) authMsg.textContent = res.error.message;
        return;
      }
      // session sanity
      const { session, error } = await getSession();
      if(error || !session){
        if(authMsg) authMsg.textContent = "Signed in but no session. Try hard refresh (Ctrl+Shift+R).";
        return;
      }

      if(authMsg) authMsg.textContent = "";
      await renderApp();
    }finally{
      if(btn) btn.disabled = false;
    }
  });

  $("logoutBtn")?.addEventListener("click", async ()=>{
    await signOut();
    location.reload();
  });

  // Customers search
  $("custSearchBtn")?.addEventListener("click", async ()=>{
    const q = $("custSearch")?.value || "";
    const { profile, error } = await findCustomerByEmailOrAccount(q);
    if(error){
      if($("custResult")) $("custResult").innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
      return;
    }
    await renderCustomerResult(profile);
  });
  $("custSearch")?.addEventListener("keydown", async (e)=>{
    if(e.key === "Enter"){
      e.preventDefault();
      $("custSearchBtn")?.click();
    }
  });

  // Packages
  $("pkgRefresh")?.addEventListener("click", renderPackages);
  $("pkgSearch")?.addEventListener("input", debounce(renderPackages, 200));
  $("pkgForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    await savePackageFromForm();
  });

  // Invoices
  $("invRefresh")?.addEventListener("click", renderInvoices);
  $("invSearch")?.addEventListener("input", debounce(renderInvoices, 200));
  $("invFilter")?.addEventListener("change", renderInvoices);
  $("invBody")?.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-action]");
    if(!btn) return;
    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if(!id) return;

    if(action === "approveInvoice") await setInvoiceApproval(id, true);
    if(action === "rejectInvoice") await setInvoiceApproval(id, false);
    if(action === "openInvoice"){
      // attempt to open via signed URL (requires storage policies)
      const { data: inv } = await supabase.from("invoices").select("file_path").eq("id", id).maybeSingle();
      if(inv?.file_path){
        const { data: urlData, error } = await supabase.storage.from("invoices").createSignedUrl(inv.file_path, 60);
        if(!error && urlData?.signedUrl) window.open(urlData.signedUrl, "_blank");
      }
    }
  });

  // Messages
  $("msgRefresh")?.addEventListener("click", async ()=>{
    await renderConversations();
    await renderChat(activeUserId);
  });
  $("msgSearch")?.addEventListener("input", debounce(renderConversations, 200));
  $("convList")?.addEventListener("click", async (e)=>{
    const btn = e.target.closest("button[data-action='openConv']");
    if(!btn) return;
    const uid = btn.getAttribute("data-uid");
    activeUserId = uid;
    await renderChat(uid);
    await subscribeMessages(uid);
  });
  $("adminChatForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const input = $("adminChatInput");
    const text = (input?.value || "").trim();
    if(!text || !activeUserId) return;

    try{
      if($("msgMsg")) $("msgMsg").textContent = "Sending...";
      await sendStaffMessage(activeUserId, text);
      if(input) input.value = "";
      if($("msgMsg")) $("msgMsg").textContent = "";
      await renderChat(activeUserId);
      await renderConversations();
      await renderStats();
    }catch(err){
      if($("msgMsg")) $("msgMsg").textContent = err.message || String(err);
    }
  });

  // Bulk
  $("bulkRun")?.addEventListener("click", runBulkUpload);

  // Refresh all
  $("refreshAll")?.addEventListener("click", renderAll);
}

async function renderAll(){
  await renderStats();
  await renderPackages();
  await renderInvoices();
  await renderConversations();
  await renderChat(activeUserId);
}

async function renderApp(){
  const authCard = $("authCard");
  const app = $("app");
  const logoutBtn = $("logoutBtn");

  const gate = await requireStaff();
  if(!gate.ok){
    if($("authMsg")) $("authMsg").textContent = gate.error.message;
    await signOut();
    return;
  }

  if(authCard) authCard.classList.add("hidden");
  if(app) app.classList.remove("hidden");
  if(logoutBtn) logoutBtn.classList.remove("hidden");

  setTab("customers");
  await renderAll();
}

// Auto boot if already signed in
async function boot(){
  bindUI();

  const { user } = await getUser();
  if(user){
    await renderApp();
  }
}

window.addEventListener("DOMContentLoaded", boot);
