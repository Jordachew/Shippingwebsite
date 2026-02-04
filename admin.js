// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function $(id){ return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

let currentCustomer = null; // { id, email }
let selectedPackage = null; // { tracking }
let chatChannel = null;

async function requireStaff(){
  const authMsg = $("authMsg");
  const { data: { user } } = await supabase.auth.getUser();
  if(!user){
    if(authMsg) authMsg.textContent = "Not logged in. Please log in via the main portal first.";
    return false;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role,email")
    .single();

  if(error){
    if(authMsg) authMsg.textContent = `Profile error: ${error.message}`;
    return false;
  }

  if(profile?.role !== "staff"){
    if(authMsg) authMsg.textContent = "Access denied: staff only.";
    return false;
  }

  if(authMsg) authMsg.textContent = `Logged in as staff (${profile.email}).`;
  return true;
}

async function logout(){
  await supabase.auth.signOut();
  location.href = "/#portal";
}

async function findCustomerByEmail(email){
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if(error) return { error };
  return { data };
}

async function renderCustomerPackages(){
  const body = $("pkgBody");
  if(!body) return;

  if(!currentCustomer){
    body.innerHTML = `<tr><td colspan="3" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,updated_at,notes")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending:false });

  if(error){
    body.innerHTML = `<tr><td colspan="3" class="muted">Error: ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if(!data || data.length === 0){
    body.innerHTML = `<tr><td colspan="3" class="muted">No packages for this customer yet.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => `
    <tr data-tracking="${escapeHTML(p.tracking)}" data-status="${escapeHTML(p.status)}" data-notes="${escapeHTML(p.notes || "")}">
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td class="muted">${escapeHTML(new Date(p.updated_at).toLocaleString())}</td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-tracking]").forEach(row => {
    row.addEventListener("click", () => openUpdateModal(row.dataset));
  });
}

function openUpdateModal(ds){
  selectedPackage = { tracking: ds.tracking };
  $("mTitle").textContent = `Update ${ds.tracking}`;
  $("mStatus").value = ds.status || "";
  $("mNotes").value = ds.notes || "";
  $("updateMsg").textContent = "";

  const modal = $("updateModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");

  modal.querySelectorAll("[data-close='1']").forEach(el => {
    el.addEventListener("click", closeUpdateModal, { once:true });
  });

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeUpdateModal();
  }, { once:true });
}

function closeUpdateModal(){
  const modal = $("updateModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  selectedPackage = null;
}

async function updatePackage(status, notes){
  const msg = $("updateMsg");
  if(!currentCustomer || !selectedPackage){
    if(msg) msg.textContent = "No package selected.";
    return;
  }

  if(msg) msg.textContent = "Saving...";

  const { error } = await supabase
    .from("packages")
    .update({ status, notes: notes || null, updated_at: new Date().toISOString() })
    .eq("user_id", currentCustomer.id)
    .eq("tracking", selectedPackage.tracking);

  if(error){
    if(msg) msg.textContent = error.message;
    return;
  }

  if(msg) msg.textContent = "Saved.";
  await renderCustomerPackages();
}

async function createPackage(tracking, status, notes){
  const msg = $("createMsg");
  if(!currentCustomer){
    if(msg) msg.textContent = "Search a customer first.";
    return;
  }

  if(msg) msg.textContent = "Creating...";

  const { error } = await supabase
    .from("packages")
    .insert({ user_id: currentCustomer.id, tracking, status, notes: notes || null });

  if(error){
    if(msg) msg.textContent = error.message;
    return;
  }

  if(msg) msg.textContent = "Created.";
  $("createPkgForm").reset();
  await renderCustomerPackages();
}

// -------------------
// STAFF CHAT
// -------------------
async function renderChat(){
  const body = $("chatBody");
  if(!body) return;

  if(!currentCustomer){
    body.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending:true })
    .limit(200);

  if(error){
    body.innerHTML = `<div class="muted small">Error: ${escapeHTML(error.message)}</div>`;
    return;
  }

  if(!data || data.length === 0){
    body.innerHTML = `<div class="muted small">No messages yet.</div>`;
    return;
  }

  body.innerHTML = data.map(m => `
    <div class="bubble ${m.sender === "support" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "support" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
      </div>
    </div>
  `).join("");

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime(){
  if(chatChannel){ supabase.removeChannel(chatChannel); chatChannel = null; }
  if(!currentCustomer) return;

  chatChannel = supabase
    .channel(`staff_messages:${currentCustomer.id}`)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`user_id=eq.${currentCustomer.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

async function sendSupportMessage(text){
  if(!currentCustomer) return alert("Search a customer first.");

  const { error } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "support", body: text });

  if(error) alert(error.message);
}

async function init(){
  const ok = await requireStaff();
  if(!ok) return;

  $("logoutBtn")?.addEventListener("click", logout);

  $("findForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("findMsg").textContent = "Searching...";
    const email = ($("custEmail").value || "").trim().toLowerCase();

    const { data, error } = await findCustomerByEmail(email);
    if(error || !data){
      $("findMsg").textContent = error?.message || "Customer not found.";
      currentCustomer = null;
      $("custId").textContent = "—";
      await renderCustomerPackages();
      await renderChat();
      return;
    }

    currentCustomer = { id: data.id, email: data.email };
    $("custId").textContent = data.id;
    $("findMsg").textContent = `Found: ${data.email}`;
    await renderCustomerPackages();
    await renderChat();
    await setupChatRealtime();
  });

  $("createPkgForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tracking = ($("tracking").value || "").trim();
    const status = ($("status").value || "").trim();
    const notes = ($("notes").value || "").trim();
    await createPackage(tracking, status, notes);
  });

  $("updateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = ($("mStatus").value || "").trim();
    const notes = ($("mNotes").value || "").trim();
    $("updateMsg").textContent = "";
    await updatePackage(status, notes);
  });

  $("chatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const text = (input.value || "").trim();
    if(!text) return;
    input.value = "";
    await sendSupportMessage(text);
  });

  await renderCustomerPackages();
  await renderChat();
}

window.addEventListener("DOMContentLoaded", () => {
  init();
});
