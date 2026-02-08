/* =========================================================
   Sueños Shipping — Customer Portal (script.js)
   Fixes:
   - AuthSessionMissingError (safe session-first auth)
   - “login only once” / stuck sign-in (stale token handling)
   - Chat readability (white text in chat area + input)
   - Chat updates immediately after sending
   - Profile ensure (no trigger required)
========================================================= */

// ========================
// CONFIG (PASTE YOUR VALUES)
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files"; // only used if you later allow chat attachments

// Business hours note (Mon–Fri 10–5)
const HOURS_TEXT = "Mon–Fri 10:00 AM–5:00 PM. After hours, we reply next business day.";

// Warehouse address (rendered if your HTML has the fields)
const WAREHOUSE = {
  companyCode: "SNS-JM",
  line1: "8465 W 44th Ave",
  line2: "STE119, SNS-JM2 43935 KIN",
  cityStateZip: "Hialeah, FL 33018",
};

// ========================
// SUPABASE CLIENT (safe singleton)
// ========================
(function initSupabase() {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase client library not loaded. Make sure supabase.min.js is included before script.js");
    return;
  }
  if (!window.__SB__) {
    window.__SB__ = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // use default storage (localStorage) unless you have a reason to override
      },
    });
  }
})();
const supabase = window.__SB__;

// ========================
// BASIC HELPERS
// ========================
function $(id) { return document.getElementById(id); }

function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatJMD(n) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON"
    ? "Rhoden Hall District, Clarendon"
    : "UWI, Kingston";
}

function getProjectRef() {
  try { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
  catch { return ""; }
}

function clearSupabaseAuthStorage() {
  // clears the stored sb token that causes “login works once then breaks”
  try {
    const ref = getProjectRef();
    if (ref) localStorage.removeItem(`sb-${ref}-auth-token`);
    localStorage.removeItem("pending_profile");
  } catch (_) {}
}

async function hardResetAuth(reason = "") {
  console.warn("Hard resetting auth:", reason);
  try { await supabase.auth.signOut(); } catch (_) {}
  clearSupabaseAuthStorage();
}

// ========================
// AUTH — SAFE USER ACCESS (prevents AuthSessionMissingError)
// ========================
async function safeGetSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { session: null, error };
    return { session: data?.session || null, error: null };
  } catch (e) {
    return { session: null, error: e };
  }
}

async function safeGetUser() {
  // session-first; only calls getUser if we actually have a session
  const { session, error: sErr } = await safeGetSession();
  if (sErr) return { user: null, session: null, error: sErr };
  if (!session) return { user: null, session: null, error: null };

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { user: session.user || null, session, error };
    return { user: data?.user || session.user || null, session, error: null };
  } catch (e) {
    // Covers AuthSessionMissingError and other throws
    return { user: session.user || null, session, error: e };
  }
}

// ========================
// UI FIX: CUSTOMER CHAT READABILITY
// ========================
function injectCustomerChatStyles() {
  if (document.getElementById("customerChatStyles")) return;

  const style = document.createElement("style");
  style.id = "customerChatStyles";
  style.textContent = `
    /* Chat messages */
    #chatBody { color:#fff !important; }
    #chatBody * { color:#fff !important; }
    #chatBody .meta { color: rgba(255,255,255,.75) !important; }

    /* Chat input */
    #chatInput {
      color:#fff !important;
      background: rgba(255,255,255,0.07) !important;
      border: 1px solid rgba(255,255,255,0.16) !important;
    }
    #chatInput::placeholder { color: rgba(255,255,255,.6) !important; }

    /* Optional bubbles */
    .bubble { background: rgba(255,255,255,0.06) !important; }
    .bubble.me { background: rgba(255,255,255,0.10) !important; }
  `;
  document.head.appendChild(style);
}

// ========================
// MOBILE NAV + AUTH TABS
// ========================
function setupMobileNav() {
  const toggle = $("navToggle");
  const nav = $("nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", () => {
    const open = nav.style.display === "flex";
    nav.style.display = open ? "none" : "flex";
  });
}

function setupAuthTabs() {
  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");
  const loginPane = $("loginPane");
  const registerPane = $("registerPane");
  if (!tabLogin || !tabRegister || !loginPane || !registerPane) return;

  const setTab = (which) => {
    const isLogin = which === "login";
    tabLogin.classList.toggle("active", isLogin);
    tabRegister.classList.toggle("active", !isLogin);
    loginPane.classList.toggle("hidden", !isLogin);
    registerPane.classList.toggle("hidden", isLogin);
  };

  tabLogin.addEventListener("click", () => setTab("login"));
  tabRegister.addEventListener("click", () => setTab("register"));
}

// ========================
// CALCULATOR
// ========================
const fixedFeeJMD = 500;
const rates = [
  { lbs: 1, jmd: 500 },
  { lbs: 2, jmd: 850 },
  { lbs: 3, jmd: 1250 },
  { lbs: 4, jmd: 1550 },
  { lbs: 5, jmd: 1900 },
  { lbs: 6, jmd: 2250 },
  { lbs: 7, jmd: 2600 },
  { lbs: 8, jmd: 2950 },
  { lbs: 9, jmd: 3300 },
  { lbs: 10, jmd: 3650 },
];

function findRateForWeight(weightLbs) {
  const rounded = Math.ceil(weightLbs);
  const match = rates.find((r) => r.lbs === rounded);
  if (match) return { rounded, rate: match.jmd };

  const last = rates[rates.length - 1];
  const prev = rates[rates.length - 2] || last;
  const step = Math.max(0, last.jmd - prev.jmd);
  return { rounded, rate: last.jmd + (rounded - last.lbs) * step };
}

function setupCalculator() {
  const form = $("calcForm");
  const result = $("result");
  if (!form || !result) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const w = parseFloat($("weight")?.value);
    const v = parseFloat($("value")?.value);

    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(v) || v < 0) {
      result.innerHTML = `<div class="result__big">—</div><div class="result__sub">Enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(w);
    const total = rate + fixedFeeJMD;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">Weight used: <strong>${rounded} lb</strong>. Base: ${formatJMD(rate)} + Fee: ${formatJMD(fixedFeeJMD)}.</div>
    `;
  });
}

// ========================
// PROFILE: local “pending profile” for email-confirm flows
// ========================
function stashPendingProfile(full_name, phone, email) {
  try {
    localStorage.setItem("pending_profile", JSON.stringify({ full_name, phone, email, at: Date.now() }));
  } catch (_) {}
}
function readPendingProfile() {
  try {
    const raw = localStorage.getItem("pending_profile");
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
function clearPendingProfile() {
  try { localStorage.removeItem("pending_profile"); } catch (_) {}
}

// Ensure profile row exists (NO trigger required)
async function ensureProfile({ full_name, phone } = {}) {
  const { user } = await safeGetUser();
  if (!user) return { ok: false, error: new Error("Not logged in") };

  // Try read minimal columns (avoid “column does not exist” crashes)
  const read = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  if (!read.error && read.data) {
    // Patch missing full_name only (safe)
    const patch = {};
    if (full_name && !read.data.full_name) patch.full_name = full_name;

    if (Object.keys(patch).length) {
      const up = await supabase.from("profiles").update(patch).eq("id", user.id);
      if (up.error) console.warn("PROFILE UPDATE ERROR:", up.error);
    }
    return { ok: true, profile: read.data };
  }

  // If missing or blocked, attempt an upsert using only safe columns
  const upsert = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: full_name || "",
    // phone only if your table has it; if not, it will fail.
    // We avoid inserting phone here to prevent schema mismatch.
  });

  if (upsert.error) return { ok: false, error: upsert.error };

  const read2 = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", user.id)
    .maybeSingle();

  return { ok: true, profile: read2.data || null };
}

// ========================
// SHIPPING ADDRESS RENDER (optional; won’t crash if elements missing)
// ========================
function renderShipTo(displayName) {
  const box = $("shipToBlock");      // container
  const nameEl = $("shipToName");    // name span
  const linesEl = $("shipToLines");  // lines container
  const copyBtn = $("shipToCopy");   // button
  const msgEl = $("shipToMsg");      // message span

  if (!box || !linesEl) return;

  if (nameEl) nameEl.textContent = displayName || "Customer";

  const textLines = [
    `${displayName || "Customer"} — ${WAREHOUSE.companyCode}`,
    WAREHOUSE.line1,
    WAREHOUSE.line2,
    WAREHOUSE.cityStateZip,
  ];

  linesEl.innerHTML = textLines.map(l => `<div>${escapeHTML(l)}</div>`).join("");

  if (copyBtn && !copyBtn.__bound) {
    copyBtn.__bound = true;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(textLines.join("\n"));
        if (msgEl) msgEl.textContent = "Copied!";
        setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 1500);
      } catch {
        if (msgEl) msgEl.textContent = "Copy failed (browser blocked).";
      }
    });
  }

  box.classList.remove("hidden");
}

// ========================
// AUTH UI (debounced; no recursion)
// ========================
let __renderAuthRunning = false;
let __renderAuthQueued = false;

function queueRenderAuth() {
  if (__renderAuthQueued) return;
  __renderAuthQueued = true;
  setTimeout(async () => {
    __renderAuthQueued = false;
    await renderAuth();
  }, 0);
}

async function renderAuth() {
  if (__renderAuthRunning) return;
  __renderAuthRunning = true;

  try {
    const loginCard = $("loginCard");
    const dashCard = $("dashCard");

    const { user, error } = await safeGetUser();
    if (error) console.warn("GET USER ERROR:", error);

    const authed = !!user;

    if (loginCard) loginCard.classList.toggle("hidden", authed);
    if (dashCard) dashCard.classList.toggle("hidden", !authed);

    if (!authed) {
      if ($("adminLink")) $("adminLink").style.display = "none";
      teardownChatRealtime();
      return;
    }

    // If they signed up w/ email confirm ON, pending profile may exist
    const pending = readPendingProfile();
    if (pending) {
      await ensureProfile({ full_name: pending.full_name, phone: pending.phone });
      clearPendingProfile();
    } else {
      await ensureProfile();
    }

    // Read profile name for display (safe minimal select)
    const prof = await supabase
      .from("profiles")
      .select("full_name,role")
      .eq("id", user.id)
      .maybeSingle();

    const profile = prof?.data || {};
    const displayName = profile?.full_name || user.email || "Customer";
    if ($("userName")) $("userName").textContent = displayName;

    // Admin link only if staff/admin
    const role = profile?.role || "customer";
    const isStaff = role === "staff" || role === "admin";
    if ($("adminLink")) $("adminLink").style.display = isStaff ? "inline-flex" : "none";

    // Render shipping address card (if your HTML includes it)
    renderShipTo(displayName);

    // Render dashboard data
    await renderPackages("");
    await renderUploads();
  } finally {
    __renderAuthRunning = false;
  }
}

// Subscribe once
if (!window.__CUSTOMER_AUTH_SUB__) {
  window.__CUSTOMER_AUTH_SUB__ = supabase.auth.onAuthStateChange(() => {
    queueRenderAuth();
  });
}

// ========================
// LOGIN / REGISTER / LOGOUT
// ========================
function setupLoginRegister() {
  const loginForm = $("loginForm");
  const regForm = $("registerForm");

  // LOGIN
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = $("loginMsg");
    if (msg) msg.textContent = "Signing in...";

    const email = ($("loginEmail")?.value || "").trim().toLowerCase();
    const password = $("loginPassword")?.value || "";

    // If a stale token exists, it can poison future logins — reset first
    // (this is what fixes “only once” cases)
    const { session } = await safeGetSession();
    if (session && session.user) {
      // Already signed in (maybe invisible UI state). Force render and exit.
      if (msg) msg.textContent = "";
      queueRenderAuth();
      return;
    }

    // Try sign-in
    const res = await supabase.auth.signInWithPassword({ email, password });

    if (res.error) {
      // If token storage is corrupt, reset and retry once.
      console.warn("LOGIN ERROR:", res.error);
      await hardResetAuth("login error retry");
      const res2 = await supabase.auth.signInWithPassword({ email, password });
      if (res2.error) {
        if (msg) msg.textContent = res2.error.message;
        return;
      }
    }

    // Force UI update even if auth event doesn’t fire
    if (msg) msg.textContent = "";
    queueRenderAuth();
  });

  // REGISTER
  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("regMsg");
    if (msg) msg.textContent = "Creating account...";

    const full_name = ($("regName")?.value || "").trim();
    const phone = ($("regPhone")?.value || "").trim();
    const email = ($("regEmail")?.value || "").trim().toLowerCase();
    const password = $("regPassword")?.value || "";

    // Save locally for confirm-email flows
    stashPendingProfile(full_name, phone, email);

    const res = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name, phone } },
    });

    if (res.error) {
      if (msg) msg.textContent = res.error.message;
      return;
    }

    // If confirmation is off, a session may exist immediately; ensure profile then.
    const ensured = await ensureProfile({ full_name, phone });
    if (msg) {
      if (ensured.ok) {
        msg.textContent = "Account created. You can now log in.";
        clearPendingProfile();
      } else {
        msg.textContent = "Account created. Check email to confirm, then log in.";
      }
    }

    regForm.reset();
  });

  // LOGOUT
  $("logoutBtn")?.addEventListener("click", async () => {
    await hardResetAuth("logout");
    location.reload();
  });
}

// ========================
// PACKAGES + INVOICES
// ========================
async function renderPackages(filter = "") {
  const body = $("pkgBody");
  if (!body) return;

  const { user } = await safeGetUser();
  if (!user) {
    body.innerHTML = `<tr><td colspan="4" class="muted">Please log in.</td></tr>`;
    return;
  }

  let q = supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at")
    .order("updated_at", { ascending: false });

  if (filter.trim()) {
    q = q.ilike("tracking", `%${filter.trim()}%`);
  }

  const { data, error } = await q;
  if (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No packages yet. Upload invoices and message us if needed.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => `
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}${p.pickup_confirmed ? ` <span class="tag">Confirmed</span>` : ` <span class="tag">Pending</span>`}</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `).join("");
}

async function renderUploads() {
  const list = $("uploadsList");
  if (!list) return;

  const { user } = await safeGetUser();
  if (!user) {
    list.innerHTML = `<li class="muted">Log in to see uploads.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }
  if (!data?.length) {
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = data.map(i => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name)} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending confirmation"} • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `).join("");
}

function setupPackageSearch() {
  $("pkgSearch")?.addEventListener("input", (e) => renderPackages(e.target.value));
  $("resetSearch")?.addEventListener("click", () => {
    if ($("pkgSearch")) $("pkgSearch").value = "";
    renderPackages("");
  });
}

function setupInvoiceUpload() {
  const form = $("invoiceForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("invMsg")) $("invMsg").textContent = "Uploading...";

    const { user } = await safeGetUser();
    if (!user) {
      if ($("invMsg")) $("invMsg").textContent = "Please log in.";
      return;
    }

    const tracking = ($("invTracking")?.value || "").trim();
    const pickup = $("invPickup")?.value;
    const note = ($("invNote")?.value || "").trim();
    const fileInput = $("invFile");

    if (!tracking) {
      if ($("invMsg")) $("invMsg").textContent = "Tracking ID required.";
      return;
    }
    if (!fileInput?.files?.length) {
      if ($("invMsg")) $("invMsg").textContent = "Choose a file.";
      return;
    }

    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
    if (up.error) {
      if ($("invMsg")) $("invMsg").textContent = up.error.message;
      return;
    }

    const ins = await supabase.from("invoices").insert({
      user_id: user.id,
      tracking,
      pickup,
      pickup_confirmed: false,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
      note: note || null,
    });

    if (ins.error) {
      if ($("invMsg")) $("invMsg").textContent = ins.error.message;
      return;
    }

    form.reset();
    if ($("invMsg")) $("invMsg").textContent = "Uploaded. Pickup location will be confirmed by staff.";
    await renderUploads();
  });
}

// ========================
// CHAT (customer)
// ========================
let chatChannel = null;

function teardownChatRealtime() {
  if (chatChannel) {
    supabase.removeChannel(chatChannel);
    chatChannel = null;
  }
}

async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  const { user } = await safeGetUser();
  if (!user) {
    body.innerHTML = `<div class="muted small">Log in to chat with support.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data || []).map(m => `
    <div class="bubble ${m.sender === "customer" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "customer" ? "You" : "Support"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">Start the conversation. ${escapeHTML(HOURS_TEXT)}</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime() {
  const { user } = await safeGetUser();
  if (!user) return;

  teardownChatRealtime();

  chatChannel = supabase
    .channel(`messages:${user.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` },
      async () => {
        await renderChat();
      }
    )
    .subscribe();
}

async function sendChatMessage(text) {
  const { user } = await safeGetUser();
  if (!user) return alert("Please log in to chat.");

  const { error } = await supabase.from("messages").insert({
    user_id: user.id,
    sender: "customer",
    body: text,
    resolved: false,
  });

  if (error) throw error;
}

function openChat() {
  injectCustomerChatStyles();
  $("chatWidget")?.classList.remove("hidden");
  $("chatWidget")?.setAttribute("aria-hidden", "false");
  if ($("chatHoursText")) $("chatHoursText").textContent = HOURS_TEXT;

  renderChat();
  setupChatRealtime();
}

function closeChat() {
  $("chatWidget")?.classList.add("hidden");
  $("chatWidget")?.setAttribute("aria-hidden", "true");
}

function setupChatUI() {
  $("chatFab")?.addEventListener("click", openChat);
  $("openChatTop")?.addEventListener("click", openChat);
  $("openChatCalc")?.addEventListener("click", openChat);
  $("openChatDash")?.addEventListener("click", openChat);
  $("openChatContact")?.addEventListener("click", openChat);
  $("closeChat")?.addEventListener("click", closeChat);

  $("chatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const msgEl = $("chatMsg");

    const text = (input?.value || "").trim();
    if (!text) {
      if (msgEl) msgEl.textContent = "Type a message.";
      return;
    }

    if (msgEl) msgEl.textContent = "Sending...";
    if (input) input.value = "";

    try {
      await sendChatMessage(text);
      if (msgEl) msgEl.textContent = "";
      // immediate refresh so you see it even if realtime is off
      await renderChat();
      setTimeout(() => renderChat(), 1200);
    } catch (err) {
      console.error(err);
      if (msgEl) msgEl.textContent = err?.message || String(err);
    }
  });
}

// ========================
// INIT
// ========================
function init() {
  injectCustomerChatStyles();
  setupMobileNav();
  setupAuthTabs();
  setupCalculator();
  setupLoginRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();

  // If there is a corrupt/stale token stored, reset it so login works repeatedly.
  // This prevents “login only once” loops.
  safeGetSession().then(async ({ session, error }) => {
    if (error) {
      await hardResetAuth("session read error at boot");
    } else if (!session) {
      // ok; just render logged-out UI
    }
    queueRenderAuth();
  });
}

window.addEventListener("DOMContentLoaded", init);
