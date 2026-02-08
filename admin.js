console.log("✅ ADMIN.JS LOADED v2026-02-08-DIAG");

const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

window.__ADMIN_SB__ =
  window.__ADMIN_SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

const supabase = window.__ADMIN_SB__;

const CHAT_BUCKET = "chat_files";

let currentCustomer = null;
let chatPollTimer = null;
let lastChatSeenAt = null;

function $(id) { return document.getElementById(id); }
function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function ui() {
  return {
    loginCard: $("staffLoginCard") || $("adminLoginCard"),
    appWrap: $("adminWrap") || $("adminApp"),
    logoutBtn: $("logoutBtn"),
    authMsg: $("authMsg") || $("adminLoginMsg") || $("staffLoginMsg"),

    loginForm: $("staffLoginForm") || $("adminLoginForm"),
    email: $("staffEmail") || $("adminEmail"),
    password: $("staffPassword") || $("adminPassword"),
    loginMsg: $("staffLoginMsg") || $("adminLoginMsg"),

    findForm: $("findForm"),
    custEmail: $("custEmail"),
    custId: $("custId"),
    findMsg: $("findMsg"),

    pkgBody: $("pkgBody"),
    invoiceList: $("invoiceList"),

    chatForm: $("chatForm") || $("adminChatForm"),
    chatBody: $("chatBody") || $("adminChatBody") || $("adminChatWindow"),
    chatInput: $("chatInput") || $("adminChatInput"),
    chatFile: $("chatFile") || $("adminChatFile"),
    chatMsg: $("chatMsg") || $("adminChatMsg"),
  };
}

function setStatus(text) {
  const U = ui();
  if (U.findMsg) U.findMsg.textContent = text || "";
  console.log("STATUS:", text);
}

function showError(where, err){
  console.error(`❌ ${where}`, err);
  const U = ui();
  const msg = err?.message || String(err);
  if (U.authMsg) U.authMsg.textContent = `${where}: ${msg}`;
  if (U.findMsg) U.findMsg.textContent = `${where}: ${msg}`;
}

function showAuthUI(authed, staff, msg) {
  const U = ui();
  if (U.loginCard) U.loginCard.classList.toggle("hidden", authed && staff);
  if (U.appWrap) U.appWrap.classList.toggle("hidden", !(authed && staff));
  if (U.logoutBtn) U.logoutBtn.classList.toggle("hidden", !(authed && staff));
  if (U.authMsg) U.authMsg.textContent = msg || "";
}

function getProjectRef(){
  try { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
  catch { return "ykpcgcjudotzakaxgnxh"; }
}
function clearAuthStorage(){
  try { localStorage.removeItem(`sb-${getProjectRef()}-auth-token`); } catch {}
}

async function requireStaff(){
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  const user = u?.user;
  if (!user){
    showAuthUI(false,false,"Please sign in as staff.");
    return false;
  }

  const { data: prof, error: pErr } = await supabase
    .from("profiles")
    .select("id,email,role,is_active,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) throw pErr;

  const role = (prof?.role || "customer").toLowerCase();
  const active = (prof?.is_active ?? true) === true;
  const staff = active && (role === "staff" || role === "admin");

  if (!staff){
    showAuthUI(true,false,`Signed in as ${user.email}, but not staff/admin. Set role='staff' or 'admin' in profiles.`);
    return false;
  }

  showAuthUI(true,true,`Staff access granted (${user.email}).`);
  return true;
}

async function login(email, password){
  const U = ui();
  if (U.loginMsg) U.loginMsg.textContent = "Signing in...";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){
    if (U.loginMsg) U.loginMsg.textContent = error.message;
    return false;
  }
  if (U.loginMsg) U.loginMsg.textContent = "";
  return true;
}

async function logout(){
  try { await supabase.auth.signOut(); }
  finally {
    clearAuthStorage();
    stopChatPolling();
    currentCustomer = null;
    location.href = "/admin.html";
  }
}

async function findCustomerByEmail(email){
  return supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
}

async function renderPackages(){
  const U = ui();
  if (!U.pkgBody){
    console.warn("Missing pkgBody element (#pkgBody). Packages won't render.");
    return;
  }
  if (!currentCustomer){
    U.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false });

  if (error){
    U.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">${esc(error.message)}</td></tr>`;
    throw error;
  }

  if (!data?.length){
    U.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">No packages yet.</td></tr>`;
    return;
  }

  U.pkgBody.innerHTML = data.map(p=>`
    <tr>
      <td><strong>${esc(p.tracking)}</strong></td>
      <td><span class="tag">${esc(p.status)}</span></td>
      <td>${esc(p.pickup || "")}</td>
      <td>${p.pickup_confirmed ? "Yes" : "No"}</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `).join("");
}

async function renderInvoices(){
  const U = ui();
  if (!U.invoiceList){
    console.warn("Missing invoiceList element (#invoiceList). Invoices won't render.");
    return;
  }
  if (!currentCustomer){
    U.invoiceList.innerHTML = `<li class="muted">Search a customer first.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending:false })
    .limit(30);

  if (error){
    U.invoiceList.innerHTML = `<li class="muted">${esc(error.message)}</li>`;
    throw error;
  }

  if (!data?.length){
    U.invoiceList.innerHTML = `<li class="muted">No invoices found.</li>`;
    return;
  }

  U.invoiceList.innerHTML = data.map(i=>`
    <li>
      <div><strong>${esc(i.tracking)}</strong> • ${esc(i.file_name || "file")} (${esc(i.file_type || "unknown")})</div>
      <div class="muted small">${new Date(i.created_at).toLocaleString()}</div>
    </li>
  `).join("");
}

async function renderChat(){
  const U = ui();
  if (!U.chatBody){
    console.warn("Missing chat body element (#chatBody/#adminChatBody). Chat won't render.");
    return;
  }
  if (!currentCustomer){
    U.chatBody.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at",{ascending:true})
    .limit(200);

  if (error){
    U.chatBody.innerHTML = `<div class="muted small">${esc(error.message)}</div>`;
    throw error;
  }

  U.chatBody.innerHTML = (data||[]).map(m=>`
    <div class="bubble ${m.sender==="staff" ? "me" : ""}" data-msg-id="m_${esc(m.id)}">
      <div>${esc(m.body)}</div>
      <div class="meta">
        <span>${m.sender==="staff" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">No messages yet.</div>`;

  U.chatBody.scrollTop = U.chatBody.scrollHeight;
  if (data?.length) lastChatSeenAt = data[data.length-1].created_at;
}

function stopChatPolling(){
  if (chatPollTimer){
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}
function startChatPolling(){
  stopChatPolling();
  if (!currentCustomer) return;

  chatPollTimer = setInterval(async ()=>{
    try{
      if (!currentCustomer) return;

      let q = supabase
        .from("messages")
        .select("id,sender,body,created_at")
        .eq("user_id", currentCustomer.id)
        .order("created_at",{ascending:true})
        .limit(50);

      if (lastChatSeenAt) q = q.gt("created_at", lastChatSeenAt);

      const { data, error } = await q;
      if (error) return;

      if (data?.length){
        // simplest: rerender so we don't fight HTML structure
        await renderChat();
      }
    }catch(_){}
  }, 3000);
}

async function sendStaffMessage(text, file){
  if (!currentCustomer) throw new Error("Search customer first.");

  const { data: msg, error: mErr } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "staff", body: text })
    .select("id,sender,body,created_at")
    .single();

  if (mErr) throw mErr;

  // update UI immediately
  await renderChat();

  // requested: auto refresh chat after 5s
  setTimeout(()=>renderChat(), 5000);

  // optional attachment
  if (file){
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${currentCustomer.id}/messages/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { upsert:false });
    if (up.error) throw up.error;

    const ins = await supabase.from("message_attachments").insert({
      message_id: msg.id,
      user_id: currentCustomer.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
    });
    if (ins.error) throw ins.error;
  }
}

function injectChatStyles(){
  if (document.getElementById("adminChatStyles")) return;
  const style = document.createElement("style");
  style.id = "adminChatStyles";
  style.textContent = `
    #chatBody, #adminChatBody, #adminChatWindow { color:#fff !important; }
    #chatBody *, #adminChatBody *, #adminChatWindow * { color:#fff !important; }
    #chatInput, #adminChatInput {
      color:#fff !important;
      background: rgba(255,255,255,0.07) !important;
      border: 1px solid rgba(255,255,255,0.16) !important;
    }
    #chatInput::placeholder, #adminChatInput::placeholder { color: rgba(255,255,255,.6) !important; }
  `;
  document.head.appendChild(style);
}

function validateDom(){
  const U = ui();
  const required = [
    ["loginForm", U.loginForm],
    ["email", U.email],
    ["password", U.password],
    ["findForm", U.findForm],
    ["custEmail", U.custEmail],
    ["pkgBody", U.pkgBody],
    ["invoiceList", U.invoiceList],
    ["chatForm", U.chatForm],
    ["chatBody", U.chatBody],
    ["chatInput", U.chatInput],
  ];

  const missing = required.filter(([_, el]) => !el).map(([name]) => name);
  if (missing.length){
    console.warn("⚠️ Missing DOM elements:", missing);
    const U2 = ui();
    if (U2.authMsg){
      U2.authMsg.textContent =
        "Admin page loaded but some elements are missing: " + missing.join(", ") +
        ". Your admin.html IDs may not match this script.";
    }
  }
}

async function init(){
  injectChatStyles();
  validateDom();

  const U = ui();

  U.logoutBtn?.addEventListener("click", logout);

  U.loginForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    try{
      const email = (U.email?.value || "").trim().toLowerCase();
      const password = U.password?.value || "";
      const ok = await login(email, password);
      if (!ok) return;
      await requireStaff();
    }catch(err){
      showError("Login", err);
    }
  });

  // Gate on load
  try{
    const ok = await requireStaff();
    if (!ok) return;
  }catch(err){
    showError("Staff check", err);
    return;
  }

  // Customer search
  U.findForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    try{
      setStatus("Searching...");
      const email = (U.custEmail?.value || "").trim().toLowerCase();
      const { data, error } = await findCustomerByEmail(email);

      if (error || !data){
        currentCustomer = null;
        lastChatSeenAt = null;
        stopChatPolling();
        if (U.custId) U.custId.textContent = "—";
        setStatus(error?.message || "Customer not found.");
        await renderPackages();
        await renderInvoices();
        await renderChat();
        return;
      }

      currentCustomer = { id: data.id, email: data.email };
      lastChatSeenAt = null;
      if (U.custId) U.custId.textContent = data.id;
      setStatus(`Found: ${data.email}`);

      await renderPackages();
      await renderInvoices();
      await renderChat();
      startChatPolling();
    }catch(err){
      showError("Customer search", err);
    }
  });

  // Chat send
  U.chatForm?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    try{
      const text = (U.chatInput?.value || "").trim();
      const file = U.chatFile?.files?.[0] || null;

      if (!text && !file){
        if (U.chatMsg) U.chatMsg.textContent = "Type a message or attach a file.";
        return;
      }

      if (U.chatMsg) U.chatMsg.textContent = "Sending...";
      if (U.chatInput) U.chatInput.value = "";
      if (U.chatFile) U.chatFile.value = "";

      await sendStaffMessage(text || "(Attachment)", file);
      if (U.chatMsg) U.chatMsg.textContent = "";
    }catch(err){
      showError("Send message", err);
    }
  });

  // Initial blank renders
  await renderPackages();
  await renderInvoices();
  await renderChat();

  // Auth state listener once
  if (!__authSubSet){
    __authSubSet = true;
    supabase.auth.onAuthStateChange(()=>{
      setTimeout(()=>requireStaff().catch(err=>showError("Auth state", err)), 0);
    });
  }
}

window.addEventListener("DOMContentLoaded", init);
