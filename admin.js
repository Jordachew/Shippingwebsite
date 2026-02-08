/* =========================================================
   ADMIN.JS — CLEAN ALL-IN-ONE VERSION
   - Fixes "can't login again" (proper token clearing)
   - Chat text/input white
   - Chat updates automatically (poll every 3s)
   - After sending message: re-fetch chat after 5s
   - Works with multiple possible element IDs
   ========================================================= */

console.log("✅ ADMIN.JS LOADED v2026-02-08-REWRITE");

// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Safe singleton
window.__ADMIN_SB__ =
  window.__ADMIN_SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });

const supabase = window.__ADMIN_SB__;

// Buckets
const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

// ========================
// STATE
// ========================
let currentCustomer = null; // {id,email}
let chatPollTimer = null;
let lastChatSeenAt = null;
let __authSubSet = false;
let __authRenderLock = false;

// ========================
// HELPERS
// ========================
function $(id) {
  return document.getElementById(id);
}
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON"
    ? "Rhoden Hall District, Clarendon"
    : "UWI, Kingston";
}
function show(el, on) {
  if (!el) return;
  el.classList.toggle("hidden", !on);
}
function getProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0]; // ykpcgc...
  } catch {
    return "ykpcgcjudotzakaxgnxh";
  }
}
function clearAuthStorage() {
  try {
    localStorage.removeItem(`sb-${getProjectRef()}-auth-token`);
  } catch (_) {}
}
function injectAdminChatStyles() {
  if (document.getElementById("adminChatStyles")) return;
  const style = document.createElement("style");
  style.id = "adminChatStyles";
  style.textContent = `
    /* Chat text readability */
    #chatBody, #adminChatBody, #adminChatWindow { color:#fff !important; }
    #chatBody *, #adminChatBody *, #adminChatWindow * { color:#fff !important; }
    .meta { color: rgba(255,255,255,.75) !important; }

    /* Input visibility */
    #chatInput, #adminChatInput {
      color:#fff !important;
      background: rgba(255,255,255,0.07) !important;
      border: 1px solid rgba(255,255,255,0.16) !important;
    }
    #chatInput::placeholder, #adminChatInput::placeholder {
      color: rgba(255,255,255,.6) !important;
    }

    /* Optional: buttons/labels in chat area */
    #chatMsg, #adminChatMsg { color: rgba(255,255,255,.75) !important; }
  `;
  document.head.appendChild(style);
}

// Works even if your admin.html uses different ids
function els() {
  return {
    // auth cards/buttons
    loginCard: $("staffLoginCard") || $("adminLoginCard"),
    appWrap: $("adminWrap") || $("adminApp"),
    logoutBtn: $("logoutBtn"),
    authMsg: $("authMsg") || $("adminLoginMsg") || $("staffLoginMsg"),

    // login form inputs
    loginForm: $("staffLoginForm") || $("adminLoginForm"),
    email: $("staffEmail") || $("adminEmail"),
    password: $("staffPassword") || $("adminPassword"),
    loginMsg: $("staffLoginMsg") || $("adminLoginMsg"),

    // customer search
    findForm: $("findForm"),
    custEmail: $("custEmail"),
    custId: $("custId"),
    findMsg: $("findMsg"),

    // packages/invoices
    pkgBody: $("pkgBody"),
    invoiceList: $("invoiceList"),

    // chat
    chatForm: $("chatForm") || $("adminChatForm"),
    chatBody: $("chatBody") || $("adminChatBody") || $("adminChatWindow"),
    chatInput: $("chatInput") || $("adminChatInput"),
    chatFile: $("chatFile") || $("adminChatFile"),
    chatMsg: $("chatMsg") || $("adminChatMsg"),
  };
}

// ========================
// AUTH + ROLE GATING
// ========================
async function getMyProfile() {
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) return { ok: false, error: uErr };
  const user = u?.user;
  if (!user) return { ok: false, error: new Error("Not logged in") };

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,email,role,full_name,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return { ok: false, error: pErr };
  return { ok: true, user, profile };
}

function setAuthUIState(authed, staff, email, msgText) {
  const ui = els();
  show(ui.loginCard, !(authed && staff));
  show(ui.appWrap, authed && staff);
  show(ui.logoutBtn, authed && staff);
  if (ui.authMsg) ui.authMsg.textContent = msgText || "";
  if (!authed && ui.findMsg) ui.findMsg.textContent = "";
}

async function requireStaff() {
  const res = await getMyProfile();
  if (!res.ok) {
    setAuthUIState(false, false, "", "Please sign in as staff.");
    return { ok: false };
  }

  const role = (res.profile?.role || "customer").toLowerCase();
  const active = (res.profile?.is_active ?? true) === true;
  const staff = active && (role === "staff" || role === "admin");

  if (!staff) {
    setAuthUIState(
      true,
      false,
      res.user.email,
      `Signed in as ${res.user.email}, but not staff/admin. Set role='staff' or 'admin' in profiles.`
    );
    return { ok: false };
  }

  setAuthUIState(true, true, res.user.email, `Staff access granted (${res.user.email}).`);
  return { ok: true };
}

async function login(email, password) {
  const ui = els();
  if (ui.loginMsg) ui.loginMsg.textContent = "Signing in...";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (ui.loginMsg) ui.loginMsg.textContent = error.message;
    return false;
  }

  if (ui.loginMsg) ui.loginMsg.textContent = "";
  return true;
}

async function logout() {
  try {
    await supabase.auth.signOut();
  } finally {
    // ✅ important fix for "can't login again"
    clearAuthStorage();
    stopChatPolling();
    currentCustomer = null;
    window.location.href = "/admin.html";
  }
}

// ========================
// CUSTOMER LOOKUP
// ========================
async function findCustomerByEmail(email) {
  return supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
}

// ========================
// PACKAGES / INVOICES
// ========================
async function renderPackages() {
  const ui = els();
  if (!ui.pkgBody) return;

  if (!currentCustomer) {
    ui.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,weight_lbs,cost_jmd,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false });

  if (error) {
    ui.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    ui.pkgBody.innerHTML = `<tr><td colspan="5" class="muted">No packages yet.</td></tr>`;
    return;
  }

  ui.pkgBody.innerHTML = data
    .map(
      (p) => `
      <tr>
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status)}</span></td>
        <td>${escapeHTML(pickupLabel(p.pickup))}${p.pickup_confirmed ? ` <span class="tag">Confirmed</span>` : ""}</td>
        <td>${p.pickup_confirmed ? "Yes" : "No"}</td>
        <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
      </tr>
    `
    )
    .join("");
}

async function renderInvoices() {
  const ui = els();
  if (!ui.invoiceList) return;

  if (!currentCustomer) {
    ui.invoiceList.innerHTML = `<li class="muted">Search a customer first.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    ui.invoiceList.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }
  if (!data?.length) {
    ui.invoiceList.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  ui.invoiceList.innerHTML = data
    .map(
      (i) => `
      <li>
        <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name)} (${escapeHTML(i.file_type)})</div>
        <div class="muted small">
          Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending"} • ${new Date(i.created_at).toLocaleString()}
          ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
        </div>
      </li>
    `
    )
    .join("");
}

// ========================
// CHAT (AUTO UPDATE + FORCE REFRESH AFTER SEND)
// ========================
async function renderChat() {
  const ui = els();
  if (!ui.chatBody) return;

  if (!currentCustomer) {
    ui.chatBody.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    ui.chatBody.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  ui.chatBody.innerHTML =
    (data?.length ? data : [])
      .map(
        (m) => `
        <div class="bubble ${m.sender === "staff" ? "me" : ""}" data-msg-id="m_${escapeHTML(m.id)}">
          <div>${escapeHTML(m.body)}</div>
          <div class="meta">
            <span>${m.sender === "staff" ? "Support" : "Customer"}</span>
            <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
      `
      )
      .join("") || `<div class="muted small">No messages yet.</div>`;

  ui.chatBody.scrollTop = ui.chatBody.scrollHeight;

  if (data && data.length) lastChatSeenAt = data[data.length - 1].created_at;
}

function appendChatMessage(m) {
  const ui = els();
  if (!ui.chatBody || !m) return;

  const key = `m_${m.id}`;
  if (m.id && ui.chatBody.querySelector(`[data-msg-id="${key}"]`)) return;

  const html = `
    <div class="bubble ${m.sender === "staff" ? "me" : ""}" data-msg-id="${key}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "staff" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `;
  ui.chatBody.insertAdjacentHTML("beforeend", html);
  ui.chatBody.scrollTop = ui.chatBody.scrollHeight;
  if (m.created_at) lastChatSeenAt = m.created_at;
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

function startChatPolling() {
  stopChatPolling();
  if (!currentCustomer) return;

  chatPollTimer = setInterval(async () => {
    try {
      if (!currentCustomer) return;

      // Fetch only new messages
      let q = supabase
        .from("messages")
        .select("id,sender,body,created_at")
        .eq("user_id", currentCustomer.id)
        .order("created_at", { ascending: true })
        .limit(50);

      if (lastChatSeenAt) q = q.gt("created_at", lastChatSeenAt);

      const { data, error } = await q;
      if (error) return;
      if (data?.length) data.forEach(appendChatMessage);
    } catch (_) {}
  }, 3000); // every 3 seconds
}

function refreshChatAfter5s() {
  setTimeout(() => {
    renderChat();
  }, 5000);
}

async function sendStaffMessage(text, file) {
  const ui = els();
  if (!currentCustomer) return alert("Search customer first.");

  const { data: msg, error: mErr } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "staff", body: text })
    .select("id,sender,body,created_at")
    .single();

  if (mErr) return alert(mErr.message);

  // Show instantly
  appendChatMessage(msg);

  // Your requested behavior
  refreshChatAfter5s();

  // Optional attachment (if you have message_attachments table + storage bucket)
  if (file) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${currentCustomer.id}/messages/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { upsert: false });
    if (up.error) return alert(up.error.message);

    const ins = await supabase.from("message_attachments").insert({
      message_id: msg.id,
      user_id: currentCustomer.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
    });
    if (ins.error) return alert(ins.error.message);
  }

  if (ui.chatMsg) ui.chatMsg.textContent = "";
}

// ========================
// INIT
// ========================
async function init() {
  injectAdminChatStyles();

  const ui = els();

  // Logout
  ui.logoutBtn?.addEventListener("click", logout);

  // Login
  ui.loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (ui.email?.value || "").trim().toLowerCase();
    const password = ui.password?.value || "";

    const ok = await login(email, password);
    if (!ok) return;

    await requireStaff();
  });

  // Gate
  const gate = await requireStaff();
  if (!gate.ok) return;

  // Customer search
  ui.findForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (ui.findMsg) ui.findMsg.textContent = "Searching...";

    const email = (ui.custEmail?.value || "").trim().toLowerCase();
    const { data, error } = await findCustomerByEmail(email);

    if (error || !data) {
      currentCustomer = null;
      if (ui.findMsg) ui.findMsg.textContent = error?.message || "Customer not found.";
      if (ui.custId) ui.custId.textContent = "—";
      lastChatSeenAt = null;
      stopChatPolling();
      await renderPackages();
      await renderInvoices();
      await renderChat();
      return;
    }

    currentCustomer = { id: data.id, email: data.email };
    if (ui.custId) ui.custId.textContent = data.id;
    if (ui.findMsg) ui.findMsg.textContent = `Found: ${data.email}`;

    // Reset chat state and start auto updates
    lastChatSeenAt = null;
    await renderPackages();
    await renderInvoices();
    await renderChat();
    startChatPolling();
  });

  // Chat send
  ui.chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (ui.chatInput?.value || "").trim();
    const file = ui.chatFile?.files?.[0] || null;

    if (!text && !file) {
      if (ui.chatMsg) ui.chatMsg.textContent = "Type a message or attach a file.";
      return;
    }

    if (ui.chatMsg) ui.chatMsg.textContent = "Sending...";
    if (ui.chatInput) ui.chatInput.value = "";
    if (ui.chatFile) ui.chatFile.value = "";

    await sendStaffMessage(text || "(Attachment)", file);
  });

  // Initial renders
  await renderPackages();
  await renderInvoices();
  await renderChat();
}

// Subscribe once (prevents duplicate auth handlers)
if (!__authSubSet) {
  __authSubSet = true;
  supabase.auth.onAuthStateChange(() => {
    if (__authRenderLock) return;
    __authRenderLock = true;
    setTimeout(async () => {
      try {
        await requireStaff();
      } finally {
        __authRenderLock = false;
      }
    }, 0);
  });
}

window.addEventListener("DOMContentLoaded", init);
