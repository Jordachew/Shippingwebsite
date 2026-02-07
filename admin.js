
// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8"; // keep same as script.js

// Safe singleton (prevents double-load)
window.__SB__ =
  window.__SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });

const supabase = window.__SB__;

// Buckets (create in Storage)
const INVOICE_BUCKET = "invoices";
const PACKAGE_PHOTO_BUCKET = "package_photos"; // create bucket (private) or change to "invoices" if you prefer

// --------------------
// Helpers
// --------------------
function $(id) { return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmtDate(ts){
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}
function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function downloadText(filename, text, mime="text/plain"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

// --------------------
// Auth + role gating
// --------------------
let me = null;          // auth user
let myProfile = null;   // profiles row
let isStaff = false;
let isAdmin = false;

async function getMyProfile(){
  const { data: u } = await supabase.auth.getUser();
  me = u?.user || null;
  if (!me) return null;

  const res = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .eq("id", me.id)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data || null;
}

function show(el, on){ if (el) el.classList.toggle("hidden", !on); }

async function hardSignOut(){
  try { await supabase.auth.signOut(); } catch {}
  // hard reset local session token
  try {
    const host = new URL(SUPABASE_URL).host;
    localStorage.removeItem(`sb-${host}-auth-token`);
  } catch {}
  location.reload();
}

async function renderAuth(){
  const loginCard = $("adminLoginCard");
  const app = $("adminApp");
  const who = $("whoami");
  const logoutBtn = $("logoutBtn");

  try {
    myProfile = await getMyProfile();
  } catch (err) {
    console.error("Profile read error:", err);
    myProfile = null;
  }

  const authed = !!me;
  show(loginCard, !authed);
  show(app, authed);
  show(logoutBtn, authed);

  if (!authed){
    if (who) who.textContent = "";
    return;
  }

  const role = (myProfile?.role || "").toLowerCase();
  const active = myProfile?.is_active !== false;
  isStaff = active && (role === "staff" || role === "admin");
  isAdmin = active && (role === "admin");

  if (who){
    who.textContent = `${myProfile?.full_name || me.email} • ${role || "unknown role"}`;
  }

  // If logged in but not staff: show a clear message and keep app hidden
  if (!isStaff){
    show(app, false);
    show(loginCard, true);
    const msg = $("adminLoginMsg");
    if (msg) msg.textContent = "This account is not staff/admin yet. Set profiles.role to staff or admin in Supabase.";
    return;
  }

  // roles tab is admin-only
  const rolesTabBtn = document.querySelector('.tab[data-tab="roles"]');
  if (rolesTabBtn) rolesTabBtn.style.display = isAdmin ? "inline-flex" : "none";

  // Load initial data
  await refreshAll();
}

// --------------------
// Login UI
// --------------------
function setupLogin(){
  $("adminLoginForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const msg = $("adminLoginMsg");
    if (msg) msg.textContent = "Signing in…";

    try {
      const email = ($("adminEmail")?.value || "").trim().toLowerCase();
      const password = $("adminPassword")?.value || "";

      const res = await supabase.auth.signInWithPassword({ email, password });
      console.log("ADMIN LOGIN RES:", res);

      if (res.error){
        if (msg) msg.textContent = res.error.message;
        return;
      }

      if (msg) msg.textContent = "";
      await renderAuth();
    } catch (err){
      console.error(err);
      if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
    }
  });

  $("logoutBtn")?.addEventListener("click", hardSignOut);
}

// --------------------
// Tabs
// --------------------
function setTab(name){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  const panel = $(`tab-${name}`);
  if (panel) panel.classList.remove("hidden");
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setTab(btn.dataset.tab);
    });
  });
  $("goPackagesBtn")?.addEventListener("click", ()=>setTab("packages"));
  $("goMessagesBtn")?.addEventListener("click", ()=>setTab("messages"));
}

// --------------------
// Data loaders
// --------------------
async function fetchStats(){
  // Note: supabase JS doesn't support group by easily via REST;
  // We'll fetch needed rows with select status and count in JS (OK for small/medium data).
  const { data: pkgs, error: pErr } = await supabase
    .from("packages")
    .select("status");
  if (pErr) throw pErr;

  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("resolved");
  if (mErr) throw mErr;

  const counts = { total: pkgs?.length || 0 };
  const byStatus = {};
  for (const p of (pkgs||[])){
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }
  const openMsgs = (msgs||[]).filter(x => x.resolved === false).length;

  return {
    total: counts.total,
    in_transit: byStatus["IN_TRANSIT"] || 0,
    ready: byStatus["READY_FOR_PICKUP"] || 0,
    picked: byStatus["PICKED_UP"] || 0,
    arrived: byStatus["ARRIVED_JA"] || 0,
    received: byStatus["RECEIVED"] || 0,
    on_hold: byStatus["ON_HOLD"] || 0,
    openMsgs
  };
}

function renderStats(stats){
  const row = $("statsRow");
  if (!row) return;

  const card = (label, value, sub="") => `
    <div class="stat">
      <div class="stat__label">${escapeHTML(label)}</div>
      <div class="stat__value">${escapeHTML(String(value))}</div>
      ${sub ? `<div class="stat__sub">${escapeHTML(sub)}</div>` : ""}
    </div>
  `;

  row.innerHTML = [
    card("Packages", stats.total, "All"),
    card("In Transit", stats.in_transit, "Status"),
    card("Ready for pickup", stats.ready, "Status"),
    card("Open messages", stats.openMsgs, "Unresolved"),
  ].join("");
}

async function renderOverview(){
  // recent packages
  const rp = $("recentPackages");
  const rm = $("recentMessages");
  if (rp){
    const { data, error } = await supabase
      .from("packages")
      .select("tracking,status,updated_at")
      .order("updated_at",{ascending:false})
      .limit(6);
    rp.innerHTML = error ? `<li class="muted">${escapeHTML(error.message)}</li>` :
      (data||[]).map(p=>`<li><strong>${escapeHTML(p.tracking)}</strong> <span class="tag">${escapeHTML(p.status)}</span><div class="muted small">${escapeHTML(fmtDate(p.updated_at))}</div></li>`).join("")
      || `<li class="muted">No packages yet.</li>`;
  }
  if (rm){
    const { data, error } = await supabase
      .from("messages")
      .select("user_id,sender,body,created_at,resolved")
      .order("created_at",{ascending:false})
      .limit(6);
    rm.innerHTML = error ? `<li class="muted">${escapeHTML(error.message)}</li>` :
      (data||[]).map(m=>`<li><span class="tag">${escapeHTML(m.sender)}</span> ${escapeHTML(m.body).slice(0,70)}<div class="muted small">${escapeHTML(fmtDate(m.created_at))}${m.resolved ? " • resolved" : ""}</div></li>`).join("")
      || `<li class="muted">No messages yet.</li>`;
  }
}

// --------------------
// Customers
// --------------------
let selectedCustomer = null;

async function loadCustomers(){
  const tbody = $("customersBody");
  if (!tbody) return;

  const q = ($("custSearch")?.value || "").trim().toLowerCase();

  // Fetch a manageable set; for big datasets you’d use pagination/server filtering.
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .order("created_at",{ascending:false})
    .limit(500);

  if (error){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const filtered = (data||[]).filter(p=>{
    const hay = `${p.full_name||""} ${p.email||""} ${p.phone||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  tbody.innerHTML = filtered.map(p=>`
    <tr data-id="${escapeHTML(p.id)}">
      <td>${escapeHTML(p.full_name || "—")}</td>
      <td class="muted">${escapeHTML(p.email || "—")}</td>
      <td>${escapeHTML(p.phone || "—")}</td>
      <td><span class="tag">${escapeHTML(p.role || "customer")}</span></td>
      <td>${p.is_active === false ? `<span class="tag tag--warn">Deactivated</span>` : `<span class="tag tag--ok">Active</span>`}</td>
      <td>
        <button class="btn btn--xs btn--ghost" data-act="view">View</button>
        <button class="btn btn--xs btn--ghost" data-act="toggle">${p.is_active === false ? "Activate" : "Deactivate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="muted">No customers found.</td></tr>`;

  tbody.querySelectorAll("tr").forEach(tr=>{
    tr.addEventListener("click", async (e)=>{
      const id = tr.getAttribute("data-id");
      const act = e.target?.getAttribute?.("data-act");

      if (act === "toggle"){
        e.preventDefault(); e.stopPropagation();
        if (!isAdmin && !isStaff) return;
        const row = filtered.find(x=>x.id===id);
        const next = !(row?.is_active === false);
        const { error: uErr } = await supabase.from("profiles").update({ is_active: !next }).eq("id", id);
        if (uErr) return alert(uErr.message);
        await loadCustomers();
        if (selectedCustomer?.id === id) await selectCustomer(id);
        return;
      }

      await selectCustomer(id);
    });
  });
}

async function selectCustomer(id){
  const box = $("customerDetail");
  selectedCustomer = null;
  if (box) box.innerHTML = "Loading…";

  const { data: prof, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .eq("id", id)
    .maybeSingle();

  if (error){
    if (box) box.innerHTML = `<div class="muted">${escapeHTML(error.message)}</div>`;
    return;
  }
  selectedCustomer = prof;

  // history: packages + invoices + messages counts
  const [pk, inv, msg] = await Promise.all([
    supabase.from("packages").select("id,tracking,status,updated_at,store,approved").eq("user_id", id).order("updated_at",{ascending:false}).limit(25),
    supabase.from("invoices").select("id,tracking,file_name,created_at").eq("user_id", id).order("created_at",{ascending:false}).limit(25),
    supabase.from("messages").select("id,sender,body,created_at,resolved").eq("user_id", id).order("created_at",{ascending:false}).limit(25),
  ]);

  if (box){
    box.innerHTML = `
      <div class="stack">
        <div>
          <div class="h3">${escapeHTML(prof.full_name || "—")}</div>
          <div class="muted">${escapeHTML(prof.email || "")}</div>
          <div class="muted small">${escapeHTML(prof.phone || "—")} • ${escapeHTML(prof.address || "No address")}</div>
          <div class="muted small">Role: <strong>${escapeHTML(prof.role || "customer")}</strong> • ${prof.is_active===false ? "Deactivated" : "Active"}</div>
        </div>

        <div class="grid2">
          <div>
            <div class="muted small">Packages</div>
            <ul class="list">
              ${(pk.error ? [`<li class="muted">${escapeHTML(pk.error.message)}</li>`] :
                (pk.data||[]).map(p=>`<li><strong>${escapeHTML(p.tracking)}</strong> <span class="tag">${escapeHTML(p.status)}</span> ${p.approved ? `<span class="tag tag--ok">Approved</span>` : `<span class="tag tag--warn">Pending</span>`}<div class="muted small">${escapeHTML(fmtDate(p.updated_at))}${p.store ? " • "+escapeHTML(p.store):""}</div></li>`))
                .join("") || `<li class="muted">No packages.</li>`}
            </ul>
          </div>

          <div>
            <div class="muted small">Invoices</div>
            <ul class="list">
              ${(inv.error ? [`<li class="muted">${escapeHTML(inv.error.message)}</li>`] :
                (inv.data||[]).map(i=>`<li><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name || "file")}<div class="muted small">${escapeHTML(fmtDate(i.created_at))}</div></li>`))
                .join("") || `<li class="muted">No invoices.</li>`}
            </ul>
          </div>
        </div>

        <div>
          <div class="muted small">Recent messages</div>
          <ul class="list">
            ${(msg.error ? [`<li class="muted">${escapeHTML(msg.error.message)}</li>`] :
              (msg.data||[]).slice(0,10).map(m=>`<li><span class="tag">${escapeHTML(m.sender)}</span> ${escapeHTML(m.body).slice(0,120)}<div class="muted small">${escapeHTML(fmtDate(m.created_at))}${m.resolved ? " • resolved":""}</div></li>`))
              .join("") || `<li class="muted">No messages.</li>`}
          </ul>
        </div>
      </div>
    `;
  }
}

// --------------------
// Packages
// --------------------
let selectedPackage = null;

async function loadPackages(){
  const tbody = $("packagesBody");
  const msg = $("pkgMsg");
  if (msg) msg.textContent = "";
  if (!tbody) return;

  const q = ($("pkgSearch")?.value || "").trim().toLowerCase();
  const statusFilter = ($("statusFilter")?.value || "").trim();

  // join-like: load packages then map customer names in JS
  const { data: pkgs, error: pErr } = await supabase
    .from("packages")
    .select("id,user_id,tracking,status,notes,updated_at,created_at,store,photo_paths,approved")
    .order("updated_at",{ascending:false})
    .limit(500);

  if (pErr){
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(pErr.message)}</td></tr>`;
    return;
  }

  // load profiles for display (only needed users)
  const userIds = Array.from(new Set((pkgs||[]).map(p=>p.user_id).filter(Boolean)));
  let profMap = {};
  if (userIds.length){
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,full_name,email")
      .in("id", userIds);
    for (const p of (profs||[])) profMap[p.id] = p;
  }

  const filtered = (pkgs||[]).filter(p=>{
    if (statusFilter && p.status !== statusFilter) return false;
    if (!q) return true;
    const cust = profMap[p.user_id];
    const hay = `${p.tracking||""} ${p.status||""} ${p.store||""} ${cust?.full_name||""} ${cust?.email||""}`.toLowerCase();
    return hay.includes(q);
  });

  tbody.innerHTML = filtered.map(p=>{
    const cust = profMap[p.user_id];
    const custLabel = cust ? (cust.full_name || cust.email) : (p.user_id ? p.user_id.slice(0,8)+"…" : "—");
    return `
      <tr data-id="${escapeHTML(String(p.id))}">
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status)}</span></td>
        <td>${p.approved ? `<span class="tag tag--ok">Yes</span>` : `<span class="tag tag--warn">No</span>`}</td>
        <td class="muted">${escapeHTML(custLabel)}</td>
        <td>${escapeHTML(p.store || "—")}</td>
        <td class="muted">${escapeHTML(fmtDate(p.updated_at))}</td>
        <td><button class="btn btn--xs btn--ghost" data-act="edit">Edit</button></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" class="muted">No packages found.</td></tr>`;

  tbody.querySelectorAll("button[data-act='edit']").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      e.preventDefault(); e.stopPropagation();
      const tr = btn.closest("tr");
      const id = tr?.getAttribute("data-id");
      const row = filtered.find(x=>String(x.id)===String(id));
      if (!row) return;
      selectedPackage = row;
      fillPackageForm(row);
    });
  });

  if (msg) msg.textContent = `Showing ${filtered.length} package(s).`;
}

function fillPackageForm(p){
  $("pkgEditId").value = p.id;
  $("pkgEditTracking").value = p.tracking || "";
  $("pkgEditStatus").value = p.status || "RECEIVED";
  $("pkgEditStore").value = p.store || "";
  $("pkgEditApproved").value = String(!!p.approved);
  $("pkgEditNotes").value = p.notes || "";
  const m = $("pkgEditMsg");
  if (m) m.textContent = "";
}

async function savePackageEdits(e){
  e.preventDefault();
  const msg = $("pkgEditMsg");
  if (msg) msg.textContent = "Saving…";

  try{
    const id = Number($("pkgEditId").value);
    if (!id) { if(msg) msg.textContent="Select a package first."; return; }

    const tracking = $("pkgEditTracking").value.trim();
    const status = $("pkgEditStatus").value;
    const store = $("pkgEditStore").value.trim() || null;
    const approved = $("pkgEditApproved").value === "true";
    const notes = $("pkgEditNotes").value.trim() || null;

    // 1) upload optional photo
    let photoPaths = null;
    const photoFile = $("pkgPhotoFile")?.files?.[0] || null;
    if (photoFile){
      const safe = photoFile.name.replace(/[^\w.\-]+/g, "_");
      const path = `packages/${id}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from(PACKAGE_PHOTO_BUCKET).upload(path, photoFile, { upsert:false });
      if (up.error) throw up.error;

      // append to existing list
      const existing = Array.isArray(selectedPackage?.photo_paths) ? selectedPackage.photo_paths : (selectedPackage?.photo_paths || []);
      const arr = Array.isArray(existing) ? existing.slice() : [];
      arr.push(path);
      photoPaths = arr;
    }

    // 2) upload optional invoice (stores file, inserts row)
    const invFile = $("pkgInvoiceFile")?.files?.[0] || null;
    if (invFile){
      if (!selectedPackage?.user_id) throw new Error("Package has no user_id assigned; assign customer first.");
      const safe = invFile.name.replace(/[^\w.\-]+/g, "_");
      const invPath = `${selectedPackage.user_id}/${tracking}/${Date.now()}_${safe}`;

      const upInv = await supabase.storage.from(INVOICE_BUCKET).upload(invPath, invFile, { upsert:false });
      if (upInv.error) throw upInv.error;

      const insInv = await supabase.from("invoices").insert({
        user_id: selectedPackage.user_id,
        tracking,
        file_path: invPath,
        file_name: safe,
        file_type: invFile.type || "unknown",
        note: "Uploaded by staff",
      });

      if (insInv.error) throw insInv.error;
    }

    // 3) update package
    const payload = { tracking, status, store, approved, notes, updated_at: new Date().toISOString() };
    if (photoPaths) payload.photo_paths = photoPaths;

    const { error } = await supabase.from("packages").update(payload).eq("id", id);
    if (error) throw error;

    if (msg) msg.textContent = "Saved.";
    // clear file inputs
    if ($("pkgPhotoFile")) $("pkgPhotoFile").value = "";
    if ($("pkgInvoiceFile")) $("pkgInvoiceFile").value = "";

    await loadPackages();
    await refreshStatsOnly();
  } catch (err){
    console.error(err);
    if (msg) msg.textContent = err?.message || String(err);
  }
}

// --------------------
// Messages
// --------------------
let selectedConvoUserId = null;

async function loadConversations(){
  const list = $("convoList");
  if (!list) return;

  const q = ($("msgSearch")?.value || "").trim().toLowerCase();
  const filter = ($("msgFilter")?.value || "open");

  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved")
    .order("created_at",{ascending:false})
    .limit(1000);

  if (error){
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }

  // Group by user_id
  const byUser = new Map();
  for (const m of (msgs||[])){
    if (filter === "open" && m.resolved === true) continue;
    const key = m.user_id;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(m);
  }

  const userIds = Array.from(byUser.keys()).filter(Boolean);
  let profMap = {};
  if (userIds.length){
    const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", userIds);
    for (const p of (profs||[])) profMap[p.id]=p;
  }

  // Build list items
  const items = userIds.map(uid=>{
    const latest = byUser.get(uid)?.[0];
    const prof = profMap[uid];
    const label = prof ? (prof.full_name || prof.email) : (uid.slice(0,8)+"…");
    const preview = (latest?.body || "").slice(0,60);
    const unresolved = (byUser.get(uid)||[]).some(x=>x.resolved===false);
    const text = `${label} — ${preview}`;
    if (q && !text.toLowerCase().includes(q)) return null;
    return { uid, label, latest, unresolved, text };
  }).filter(Boolean);

  list.innerHTML = items.map(it=>`
    <li class="listItem ${it.uid===selectedConvoUserId ? "active":""}" data-uid="${escapeHTML(it.uid)}">
      <div class="listItem__title">
        ${escapeHTML(it.label)}
        ${it.unresolved ? `<span class="tag tag--warn">Open</span>` : `<span class="tag tag--ok">Resolved</span>`}
      </div>
      <div class="muted small">${escapeHTML(it.latest?.body || "")}</div>
      <div class="muted small">${escapeHTML(fmtDate(it.latest?.created_at))}</div>
    </li>
  `).join("") || `<li class="muted">No conversations.</li>`;

  list.querySelectorAll(".listItem").forEach(li=>{
    li.addEventListener("click", async ()=>{
      selectedConvoUserId = li.getAttribute("data-uid");
      await renderChatFor(selectedConvoUserId);
      await loadConversations();
    });
  });
}

async function renderChatFor(userId){
  const title = $("convoTitle");
  const body = $("adminChatBody");
  if (title) title.textContent = "Loading…";
  if (body) body.innerHTML = "";

  selectedConvoUserId = userId;

  const [{ data: prof }, { data: msgs, error }] = await Promise.all([
    supabase.from("profiles").select("id,full_name,email").eq("id", userId).maybeSingle(),
    supabase.from("messages").select("id,sender,body,created_at,resolved").eq("user_id", userId).order("created_at",{ascending:true}).limit(500),
  ]);

  if (title){
    const label = prof?.full_name || prof?.email || userId.slice(0,8)+"…";
    title.textContent = `Chat with ${label}`;
  }

  if (error){
    if (body) body.innerHTML = `<div class="muted">${escapeHTML(error.message)}</div>`;
    return;
  }

  if (body){
    body.innerHTML = (msgs||[]).map(m=>`
      <div class="bubble ${m.sender==="staff" ? "me" : ""}">
        <div>${escapeHTML(m.body)}</div>
        <div class="meta">
          <span>${escapeHTML(m.sender)}</span>
          <span>${escapeHTML(new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}))}</span>
        </div>
      </div>
    `).join("") || `<div class="muted small">No messages yet.</div>`;
    body.scrollTop = body.scrollHeight;
  }
}

async function sendStaffMessage(e){
  e.preventDefault();
  const input = $("adminChatInput");
  const msg = $("adminChatMsg");
  const text = (input?.value || "").trim();

  if (!selectedConvoUserId){
    if (msg) msg.textContent = "Select a conversation first.";
    return;
  }
  if (!text){
    if (msg) msg.textContent = "Type a message.";
    return;
  }

  if (msg) msg.textContent = "Sending…";

  const res = await supabase.from("messages").insert({
    user_id: selectedConvoUserId,
    sender: "staff",
    body: text,
    resolved: false
  });

  if (res.error){
    if (msg) msg.textContent = res.error.message;
    return;
  }

  if (input) input.value = "";
  if (msg) msg.textContent = "";
  await renderChatFor(selectedConvoUserId);
  await refreshStatsOnly();
}

async function markResolved(){
  const msg = $("adminChatMsg");
  if (!selectedConvoUserId){
    if (msg) msg.textContent = "Select a conversation first.";
    return;
  }
  if (msg) msg.textContent = "Marking resolved…";

  // mark all messages for that user as resolved
  const res = await supabase
    .from("messages")
    .update({ resolved: true })
    .eq("user_id", selectedConvoUserId);

  if (res.error){
    if (msg) msg.textContent = res.error.message;
    return;
  }

  if (msg) msg.textContent = "Resolved.";
  await loadConversations();
  await renderChatFor(selectedConvoUserId);
  await refreshStatsOnly();
}

// --------------------
// Reports
// --------------------
let lastReportRows = [];

async function runReports(){
  const days = Number(($("reportRange")?.value || "30"));
  const since = new Date(Date.now() - days*24*60*60*1000).toISOString();

  const shipEl = $("shipmentsChart");
  const storeEl = $("storesChart");
  if (shipEl) shipEl.textContent = "Loading…";
  if (storeEl) storeEl.textContent = "Loading…";

  const { data, error } = await supabase
    .from("packages")
    .select("created_at,store,status")
    .gte("created_at", since)
    .order("created_at",{ascending:true})
    .limit(5000);

  if (error){
    if (shipEl) shipEl.textContent = error.message;
    if (storeEl) storeEl.textContent = error.message;
    return;
  }

  // group by date (YYYY-MM-DD)
  const byDay = {};
  const byStore = {};
  for (const p of (data||[])){
    const d = (p.created_at || "").slice(0,10);
    byDay[d] = (byDay[d] || 0) + 1;
    const s = (p.store || "Unknown").trim() || "Unknown";
    byStore[s] = (byStore[s] || 0) + 1;
  }

  const dayRows = Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0]));
  const storeRows = Object.entries(byStore).sort((a,b)=>b[1]-a[1]).slice(0,12);

  lastReportRows = [
    ...dayRows.map(([k,v])=>({ type:"shipments_by_day", key:k, value:v })),
    ...storeRows.map(([k,v])=>({ type:"stores", key:k, value:v })),
  ];

  if (shipEl){
    shipEl.innerHTML = `
      <div class="muted small">Shipments per day (last ${days} days)</div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>Date</th><th>Shipments</th></tr></thead>
          <tbody>${dayRows.map(([d,v])=>`<tr><td>${escapeHTML(d)}</td><td>${escapeHTML(String(v))}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No data.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }

  if (storeEl){
    storeEl.innerHTML = `
      <div class="muted small">Top stores (last ${days} days)</div>
      <div class="tableWrap">
        <table class="table">
          <thead><tr><th>Store</th><th>Count</th></tr></thead>
          <tbody>${storeRows.map(([s,v])=>`<tr><td>${escapeHTML(s)}</td><td>${escapeHTML(String(v))}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">No data.</td></tr>`}</tbody>
        </table>
      </div>
    `;
  }
}

function exportReports(){
  if (!lastReportRows.length) return alert("Run reports first.");
  const header = ["type","key","value"];
  const lines = [header.join(",")].concat(lastReportRows.map(r=>[r.type,r.key,r.value].map(csvEscape).join(",")));
  downloadText(`suenos-reports-${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
}

async function exportPackages(){
  const { data, error } = await supabase
    .from("packages")
    .select("id,user_id,tracking,status,store,approved,created_at,updated_at,notes")
    .order("created_at",{ascending:false})
    .limit(5000);

  if (error) return alert(error.message);

  const header = ["id","user_id","tracking","status","store","approved","created_at","updated_at","notes"];
  const lines = [header.join(",")].concat((data||[]).map(r=>header.map(k=>csvEscape(r[k])).join(",")));
  downloadText(`suenos-packages-${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
}

// --------------------
// Roles
// --------------------
async function setupRoles(){
  $("roleForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const msg = $("roleMsg");
    if (msg) msg.textContent = "";

    if (!isAdmin){
      if (msg) msg.textContent = "Admin only.";
      return;
    }

    const email = ($("roleEmail")?.value || "").trim().toLowerCase();
    const role = $("roleValue")?.value || "staff";

    if (!email){
      if (msg) msg.textContent = "Enter an email.";
      return;
    }

    if (msg) msg.textContent = "Updating…";

    // Update by email
    const res = await supabase.from("profiles").update({ role }).eq("email", email);
    if (res.error){
      if (msg) msg.textContent = res.error.message;
      return;
    }
    if (msg) msg.textContent = "Updated.";
  });
}

// --------------------
// Refresh
// --------------------
async function refreshStatsOnly(){
  try{
    const stats = await fetchStats();
    renderStats(stats);
  } catch (e){
    console.error(e);
  }
}

async function refreshAll(){
  await refreshStatsOnly();
  await renderOverview();
  await loadCustomers();
  await loadPackages();
  await loadConversations();
}

// --------------------
// Init
// --------------------
function setupFilters(){
  $("refreshCustomers")?.addEventListener("click", loadCustomers);
  $("custSearch")?.addEventListener("input", ()=>loadCustomers());

  $("refreshPackages")?.addEventListener("click", loadPackages);
  $("pkgSearch")?.addEventListener("input", ()=>loadPackages());
  $("statusFilter")?.addEventListener("change", ()=>loadPackages());
  $("pkgEditForm")?.addEventListener("submit", savePackageEdits);

  $("refreshMessages")?.addEventListener("click", loadConversations);
  $("msgSearch")?.addEventListener("input", ()=>loadConversations());
  $("msgFilter")?.addEventListener("change", ()=>loadConversations());
  $("adminChatForm")?.addEventListener("submit", sendStaffMessage);
  $("markResolvedBtn")?.addEventListener("click", markResolved);

  $("runReports")?.addEventListener("click", runReports);
  $("exportReports")?.addEventListener("click", exportReports);
  $("exportPackagesBtn")?.addEventListener("click", exportPackages);
  $("exportPackagesBtn")?.addEventListener("click", ()=>{ const q=$("quickMsg"); if(q) q.textContent="Export downloaded."; });
}

function init(){
  setupLogin();
  setupTabs();
  setupFilters();
  setupRoles();

  // auth events
  supabase.auth.onAuthStateChange(()=>renderAuth());

  // default tab
  setTab("overview");
  renderAuth();
}

window.addEventListener("DOMContentLoaded", init);
