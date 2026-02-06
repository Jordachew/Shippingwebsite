// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

function $(id){ return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function pickupLabel(v){
  return v === "RHODEN_HALL_CLARENDON" ? "Rhoden Hall District, Clarendon" : "UWI, Kingston";
}

let currentCustomer = null; // { id, email }
let selectedPkg = null;
let chatChannel = null;

async function requireStaff(){
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user){ $("authMsg").textContent = "Not logged in. Log in on the main portal first."; return false; }

  const { data: profile, error } = await supabase.from("profiles").select("role,email").single();
  if(error){ $("authMsg").textContent = error.message; return false; }
  if(profile.role !== "staff"){ $("authMsg").textContent = "Access denied: staff only."; return false; }

  $("authMsg").textContent = `Staff access granted (${profile.email}).`;
  return true;
}

async function logout(){
  await supabase.auth.signOut();
  location.href = "/#portal";
}

async function findCustomer(email){
  return supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
}

async function renderPackages(){
  const body = $("pkgBody");
  if(!currentCustomer){
    body.innerHTML = `<tr><td colspan="5" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at,notes")
    .eq("user_id", currentCustomer.id)
    .order("updated_at",{ascending:false});

  if(error){
    body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  if(!data?.length){
    body.innerHTML = `<tr><td colspan="5" class="muted">No packages yet.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => `
    <tr data-tracking="${escapeHTML(p.tracking)}"
        data-status="${escapeHTML(p.status)}"
        data-pickup="${escapeHTML(p.pickup)}"
        data-pickup_confirmed="${p.pickup_confirmed ? "true" : "false"}"
        data-notes="${escapeHTML(p.notes||"")}">
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}</td>
      <td>${p.pickup_confirmed ? `<span class="tag">Yes</span>` : `<span class="tag">No</span>`}</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-tracking]").forEach(row=>{
    row.addEventListener("click", ()=> openUpdateModal(row.dataset));
  });
}

async function renderInvoices(){
  const list = $("invoiceList");
  if(!currentCustomer){
    list.innerHTML = `<li class="muted">Search a customer first.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .eq("user_id", currentCustomer.id)
    .order("created_at",{ascending:false})
    .limit(30);

  if(error){
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }
  if(!data?.length){
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = data.map(i=>`
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name)} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending"} • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `).join("");
}

function openUpdateModal(ds){
  selectedPkg = ds.tracking;
  $("mTitle").textContent = `Update ${ds.tracking}`;
  $("mStatus").value = ds.status || "RECEIVED";
  $("mPickup").value = ds.pickup || "UWI_KINGSTON";
  $("mPickupConfirmed").value = ds.pickup_confirmed || "false";
  $("mNotes").value = ds.notes || "";
  $("mSendEmail").value = "no";
  $("updateMsg").textContent = "";

  $("updateModal").classList.remove("hidden");
  $("updateModal").setAttribute("aria-hidden","false");

  $("updateModal").querySelectorAll("[data-close='1']").forEach(el=>{
    el.addEventListener("click", closeUpdateModal, { once:true });
  });
}
function closeUpdateModal(){
  $("updateModal").classList.add("hidden");
  $("updateModal").setAttribute("aria-hidden","true");
  selectedPkg = null;
}

async function createPackage(payload){
  if(!currentCustomer){ $("createMsg").textContent = "Search a customer first."; return; }
  $("createMsg").textContent = "Creating...";

  const { error } = await supabase.from("packages").insert({
    user_id: currentCustomer.id,
    tracking: payload.tracking,
    status: payload.status,
    pickup: payload.pickup,
    weight_lbs: payload.weight_lbs || null,
    declared_value_usd: payload.declared_value_usd || null,
    shipping_cost_jmd: payload.shipping_cost_jmd || null,
    notes: payload.notes || null
  });

  if(error){ $("createMsg").textContent = error.message; return; }
  $("createMsg").textContent = "Created.";
  await renderPackages();
}

async function updatePackage(tracking, updates, sendEmail){
  $("updateMsg").textContent = "Saving...";

  const { error } = await supabase
    .from("packages")
    .update(updates)
    .eq("tracking", tracking);

  if(error){ $("updateMsg").textContent = error.message; return; }

  // if READY_FOR_PICKUP and user requested email:
  if(sendEmail && updates.status === "READY_FOR_PICKUP"){
    try{
      const r = await fetch("/api/notify-ready", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ tracking })
      });
      const j = await r.json();
      if(!r.ok) throw new Error(j.error || "Email failed");
      $("updateMsg").textContent = "Saved + email sent.";
    }catch(e){
      $("updateMsg").textContent = `Saved, but email failed: ${e.message}`;
    }
  } else {
    $("updateMsg").textContent = "Saved.";
  }

  // Also confirm invoices pickup_confirmed if pickup is confirmed (nice workflow)
  if(updates.pickup_confirmed === true){
    await supabase
      .from("invoices")
      .update({ pickup_confirmed:true })
      .eq("user_id", currentCustomer.id)
      .eq("tracking", tracking);
  }

  await renderPackages();
  await renderInvoices();
}

async function bulkUpload(csvText){
  if(!currentCustomer){ $("bulkMsg").textContent = "Search a customer first."; return; }

  const lines = csvText.split("\n").map(l=>l.trim()).filter(Boolean);
  if(!lines.length){ $("bulkMsg").textContent = "Paste at least one line."; return; }

  $("bulkMsg").textContent = "Uploading...";
  const rows = lines.map(line => {
    const [tracking,status,pickup,weight,value,cost,notes] = line.split(",").map(x=>x?.trim());
    return {
      user_id: currentCustomer.id,
      tracking,
      status: status || "RECEIVED",
      pickup: pickup || "UWI_KINGSTON",
      weight_lbs: weight ? Number(weight) : null,
      declared_value_usd: value ? Number(value) : null,
      shipping_cost_jmd: cost ? Number(cost) : null,
      notes: notes || null
    };
  });

  const { error } = await supabase.from("packages").insert(rows);
  if(error){ $("bulkMsg").textContent = error.message; return; }

  $("bulkMsg").textContent = `Uploaded ${rows.length} packages.`;
  await renderPackages();
}

async function renderChat(){
  const body = $("chatBody");
  if(!currentCustomer){
    body.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at",{ascending:true})
    .limit(200);

  if(error){
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data?.length ? data : []).map(m => `
    <div class="bubble ${m.sender === "support" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "support" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">No messages yet.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime(){
  if(chatChannel){ supabase.removeChannel(chatChannel); chatChannel=null; }
  if(!currentCustomer) return;

  chatChannel = supabase
    .channel(`staff_messages:${currentCustomer.id}`)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`user_id=eq.${currentCustomer.id}` },
      async ()=>{ await renderChat(); }
    )
    .subscribe();
}

async function sendSupport(text, file){
  if(!currentCustomer) return alert("Search customer first.");

  const { data: msg, error: mErr } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender:"support", body: text })
    .select("id")
    .single();

  if(mErr) return alert(mErr.message);

  if(file){
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${currentCustomer.id}/messages/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { upsert:false });
    if(up.error) return alert(up.error.message);

    const ins = await supabase.from("message_attachments").insert({
      message_id: msg.id,
      user_id: currentCustomer.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown"
    });

    if(ins.error) return alert(ins.error.message);
  }
}

async function init(){
  const ok = await requireStaff();
  if(!ok) return;

  $("logoutBtn")?.addEventListener("click", logout);

  $("findForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    $("findMsg").textContent = "Searching...";
    const email = $("custEmail").value.trim().toLowerCase();

    const { data, error } = await findCustomer(email);
    if(error || !data){
      $("findMsg").textContent = error?.message || "Customer not found.";
      currentCustomer = null;
      $("custId").textContent = "—";
      await renderPackages();
      await renderInvoices();
      await renderChat();
      return;
    }

    currentCustomer = { id: data.id, email: data.email };
    $("custId").textContent = data.id;
    $("findMsg").textContent = `Found: ${data.email}`;
    await renderPackages();
    await renderInvoices();
    await renderChat();
    await setupChatRealtime();
  });

  $("createPkgForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    await createPackage({
      tracking: $("tracking").value.trim(),
      status: $("status").value,
      pickup: $("pickup").value,
      weight_lbs: $("weight").value ? Number($("weight").value) : null,
      declared_value_usd: $("value").value ? Number($("value").value) : null,
      shipping_cost_jmd: $("cost").value ? Number($("cost").value) : null,
      notes: $("notes").value.trim()
    });
  });

  $("bulkForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    await bulkUpload($("bulkText").value);
  });

  $("updateForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    if(!selectedPkg) return;

    const status = $("mStatus").value;
    const pickup = $("mPickup").value;
    const pickup_confirmed = $("mPickupConfirmed").value === "true";
    const notes = $("mNotes").value.trim();
    const sendEmail = $("mSendEmail").value === "yes";

    await updatePackage(selectedPkg, { status, pickup, pickup_confirmed, notes }, sendEmail);
  });

  $("chatForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const input = $("chatInput");
    const file = $("chatFile")?.files?.[0] || null;
    const msgEl = $("chatMsg");

    const text = (input.value || "").trim();
    if(!text && !file){ msgEl.textContent = "Type a message or attach a file."; return; }

    msgEl.textContent = "Sending...";
    input.value = "";
    if($("chatFile")) $("chatFile").value = "";

    await sendSupport(text || "(Attachment)", file);
    msgEl.textContent = "";
  });

  await renderPackages();
  await renderInvoices();
  await renderChat();
}

window.addEventListener("DOMContentLoaded", init);
