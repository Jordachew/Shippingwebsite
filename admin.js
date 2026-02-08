// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// One safe singleton (prevents double-load issues)
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

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

// --------------------
// Helpers
// --------------------
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

// ✅ FIX: correct Supabase localStorage key uses PROJECT REF, not host
function getProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0]; // ykpcgcjudotzakaxgnxh
  } catch {
    return "ykpcgcjudotzakaxgnxh";
  }
}
function clearAuthStorage() {
  try {
    const ref = getProjectRef();
    localStorage.removeItem(`sb-${ref}-auth-token`);
  } catch (_) {}
}

// Admin state
let currentCustomer = null; // { id, email }
let selectedPkg = null;

let chatChannel = null;
let chatPollTimer = null;
let lastChatSeenAt = null;

let __renderBusy = false;
let __refreshBusy = false;

// --------------------
// Auth + role gating
// --------------------
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

function setAuthUI({ authed, staff, email }) {
  const loginCard = $("staffLoginCard");
  const wrap = $("adminWrap");
  const logoutBtn = $("logoutBtn");
  const authMsg = $("authMsg");

  if (loginCard) loginCard.classList.toggle("hidden", authed && staff);
  if (wrap) wrap.classList.toggle("hidden", !(authed && staff));
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !(authed && staff));

  if (authMsg) {
    if (!authed) authMsg.textContent = "Please sign in as staff.";
    else if (!staff)
      authMsg.textContent =
        `Signed in as ${email || "user"}, but not staff/admin. Set role='staff' or 'admin' in profiles.`;
    else authMsg.textContent = `Staff access granted (${email || "staff"}).`;
  }
}

async function requireStaff() {
  const res = await getMyProfile();
  if (!res.ok) {
    setAuthUI({ authed: false, staff: false });
    return { ok: false, error: res.error };
  }

  const role = (res.profile?.role || "customer").toLowerCase();
  const active = (res.profile?.is_active ?? true) === true;

  const staff = active && (role === "staff" || role === "admin"); // allow admin
  setAuthUI({ authed: true, staff, email: res.user.email });

  if (!staff) return { ok: false, error: new Error("Not staff/admin") };
  return { ok: true, user: res.user, profile: res.profile };
}

async function logout() {
  try {
    await supabase.auth.signOut();
  } finally {
    // ✅ important: ensure token is cleared so next login works
    clearAuthStorage();
    teardownChat();
    window.location.href = "/admin.html";
  }
}

async function staffLogin(email, password) {
  const msg = $("staffLoginMsg");
  if (msg) msg.textContent = "Signing in...";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (msg) msg.textContent = error.message;
    return false;
  }
  if (msg) msg.textContent = "";
  return true;
}

async function findCustomer(email) {
  return supabase
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();
}

// --------------------
// Packages + invoices
// --------------------
async function renderPackages() {
  const body = $("pkgBody");
  if (!body) return;

  if (!currentCustomer) {
    body.innerHTML = `<tr><td colspan="5" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,weight_lbs,cost_jmd,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHTML(
      error.message
    )}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No packages yet.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map(
      (p) => `
    <tr
      data-tracking="${escapeHTML(p.tracking)}"
      data-status="${escapeHTML(p.status)}"
      data-pickup="${escapeHTML(p.pickup)}"
      data-pickup_confirmed="${p.pickup_confirmed ? "true" : "false"}"
      data-weight_lbs="${p.weight_lbs ?? ""}"
      data-cost_jmd="${p.cost_jmd ?? ""}"
    >
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}${
        p.pickup_confirmed ? ` <span class="tag">Confirmed</span>` : ``
      }</td>
      <td>${p.pickup_confirmed ? "Yes" : "No"}</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `
    )
    .join("");
}

async function renderInvoices() {
  const list = $("invoiceList");
  if (!list) return;

  if (!currentCustomer) {
    list.innerHTML = `<li class="muted">Search a customer first.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }
  if (!data?.length) {
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = data
    .map(
      (i) => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(
        i.file_name
      )} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${
        i.pickup_confirmed ? "Confirmed" : "Pending"
      } • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `
    )
    .join("");
}

// --------------------
// Chat (render + realtime + polling fallback)
// --------------------
function injectChatStyles() {
  if (document.getElementById("adminChatStyles")) return;

  const style = document.createElement("style");
  style.id = "adminChatStyles";
  style.textContent = `
    /* Chat window text */
    #chatBody, #chatBody * { color: #fff !important; }
    #chatBody .meta { color: rgba(255,255,255,.75) !important; }

    /* Chat input visibility */
    #chatInput {
      color: #fff !important;
      background: rgba(255,255,255,0.06) !important;
      border: 1px solid rgba(255,255,255,0.12) !important;
    }
    #chatInput::placeholder { color: rgba(255,255,255,.6) !important; }

    /* File input label area */
    #chatMsg { color: rgba(255,255,255,.75) !important; }
  `;
  document.head.appendChild(style);
}

async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  if (!currentCustomer) {
    body.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML =
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

  body.scrollTop = body.scrollHeight;

  if (data && data.length) {
    lastChatSeenAt = data[data.length - 1].created_at;
  }
}

function appendChatMessage(m) {
  const body = $("chatBody");
  if (!body || !m) return;

  const key = `m_${m.id}`;
  if (m.id && body.querySelector(`[data-msg-id="${key}"]`)) return;

  const html = `
    <div class="bubble ${m.sender === "staff" ? "me" : ""}" data-msg-id="${key}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "staff" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `;
  body.insertAdjacentHTML("beforeend", html);
  body.scrollTop = body.scrollHeight;

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
  }, 4000);
}

function teardownChat() {
  if (chatChannel) {
    supabase.removeChannel(chatChannel);
    chatChannel = null;
  }
  stopChatPolling();
  lastChatSeenAt = null;
}

async function setupChatRealtime() {
  if (chatChannel) {
    supabase.removeChannel(chatChannel);
    chatChannel = null;
  }
  stopChatPolling();
  if (!currentCustomer) return;

  // Realtime subscription (if enabled on messages table)
  chatChannel = supabase
    .channel(`staff_messages:${currentCustomer.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${currentCustomer.id}` },
      (payload) => {
        appendChatMessage(payload.new);
      }
    )
    .subscribe();

  // Always run polling fallback too (safe, ensures it works even if realtime is off)
  startChatPolling();
}

async function sendStaff(text, file) {
  if (!currentCustomer) return alert("Search customer first.");

  const { data: msg, error: mErr } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "staff", body: text })
    .select("id,sender,body,created_at")
    .single();

  if (mErr) return alert(mErr.message);

  // ✅ Show instantly even without realtime
  appendChatMessage(msg);

  // ✅ As requested: "auto refresh after 5 seconds"
  // Instead of reloading the entire page, we re-fetch chat (safer).
  setTimeout(() => {
    renderChat();
  }, 5000);

  if (file) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${currentCustomer.id}/messages/${Date.now()}_${safeName}`;

    const up = await supabase.storage
      .from(CHAT_BUCKET)
      .upload(path, file, { upsert: false });
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
}

// --------------------
// Init
// --------------------
async function init() {
  injectChatStyles();

  $("logoutBtn")?.addEventListener("click", logout);

  $("staffLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("staffEmail").value.trim().toLowerCase();
    const password = $("staffPassword").value;

    const ok = await staffLogin(email, password);
    if (!ok) return;

    await requireStaff();
  });

  // Gate UI on load
  const gate = await requireStaff();
  if (!gate.ok) return;

  $("findForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("findMsg").textContent = "Searching...";
    const email = $("custEmail").value.trim().toLowerCase();

    const { data, error } = await findCustomer(email);
    if (error || !data) {
      $("findMsg").textContent = error?.message || "Customer not found.";
      currentCustomer = null;
      $("custId").textContent = "—";
      teardownChat();
      await renderPackages();
      await renderInvoices();
      await renderChat();
      return;
    }

    currentCustomer = { id: data.id, email: data.email };
    $("custId").textContent = data.id;
    $("findMsg").textContent = `Found: ${data.email}`;

    lastChatSeenAt = null;
    await renderPackages();
    await renderInvoices();
    await renderChat();
    await setupChatRealtime();
  });

  $("chatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ($("chatInput").value || "").trim();
    const file = $("chatFile")?.files?.[0] || null;
    if (!text && !file) return;

    $("chatInput").value = "";
    if ($("chatFile")) $("chatFile").value = "";

    await sendStaff(text || "(Attachment)", file);
  });

  // initial empties
  await renderPackages();
  await renderInvoices();
  await renderChat();
}

// ✅ Subscribe ONCE (prevents multiple handlers piling up)
if (!window.__ADMIN_AUTH_SUB__) {
  window.__ADMIN_AUTH_SUB__ = supabase.auth.onAuthStateChange(() => {
    setTimeout(() => requireStaff(), 0);
  });
}

window.addEventListener("DOMContentLoaded", init);
