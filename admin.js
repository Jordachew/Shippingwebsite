// ========================
// CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

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

// ========================
// HELPERS
// ========================
function $(id) { return document.getElementById(id); }
function escapeHTML(s) {
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
function getProjectRef() {
  try { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
  catch { return "ykpcgcjudotzakaxgnxh"; }
}
function clearSupabaseAuthStorage() {
  try {
    const ref = getProjectRef();
    localStorage.removeItem(`sb-${ref}-auth-token`);
  } catch {}
}

let __renderBusy = false;
function renderDebounced() {
  setTimeout(renderAdmin, 0);
}

// ========================
// AUTH + ROLE GATE
// ========================
async function getRoleForUser(userId) {
  const res = await supabase
    .from("profiles")
    .select("role,is_active,full_name,email")
    .eq("id", userId)
    .maybeSingle();

  if (res.error) {
    console.error("ADMIN profile read error:", res.error);
    return { ok:false, error: res.error, role: null, profile: null };
  }
  const p = res.data || null;
  const role = p?.role || "customer";
  const active = (p?.is_active ?? true) === true;
  return { ok:true, role, active, profile: p };
}

async function renderAdmin() {
  if (__renderBusy) return;
  __renderBusy = true;

  try {
    const authMsg = $("authMsg");
    const loginCard = $("staffLoginCard");
    const adminWrap = $("adminWrap");
    const logoutBtn = $("logoutBtn");

    const { data: uData, error: uErr } = await supabase.auth.getUser();
    if (uErr) console.error("getUser error:", uErr);

    const user = uData?.user;
    const authed = !!user;

    // logged out
    if (!authed) {
      loginCard?.classList.remove("hidden");
      adminWrap?.classList.add("hidden");
      logoutBtn?.classList.add("hidden");
      if (authMsg) authMsg.textContent = "";
      return;
    }

    // logged in — check role
    const gate = await getRoleForUser(user.id);
    if (!gate.ok) {
      loginCard?.classList.remove("hidden");
      adminWrap?.classList.add("hidden");
      logoutBtn?.classList.remove("hidden");
      if (authMsg) authMsg.textContent = `Profile error: ${gate.error.message}`;
      return;
    }

    if (!gate.active) {
      if (authMsg) authMsg.textContent = "Your account is deactivated. Contact admin.";
      loginCard?.classList.remove("hidden");
      adminWrap?.classList.add("hidden");
      logoutBtn?.classList.remove("hidden");
      return;
    }

    const isStaff = gate.role === "staff" || gate.role === "admin";
    if (!isStaff) {
      if (authMsg) authMsg.textContent = "Access denied: not staff/admin.";
      loginCard?.classList.remove("hidden");
      adminWrap?.classList.add("hidden");
      logoutBtn?.classList.remove("hidden");
      return;
    }

    // show dashboard
    loginCard?.classList.add("hidden");
    adminWrap?.classList.remove("hidden");
    logoutBtn?.classList.remove("hidden");
    if (authMsg) authMsg.textContent = `Signed in as ${gate.profile?.full_name || user.email} (${gate.role})`;
  } finally {
    __renderBusy = false;
  }
}

// subscribe once
if (!window.__ADMIN_AUTH_SUB__) {
  window.__ADMIN_AUTH_SUB__ = supabase.auth.onAuthStateChange(() => renderDebounced());
}

// ========================
// LOGIN / LOGOUT
// ========================
function setupLogin() {
  $("staffLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("staffLoginMsg");
    if (msg) msg.textContent = "Signing in...";

    const email = $("staffEmail")?.value?.trim()?.toLowerCase();
    const password = $("staffPassword")?.value;

    const res = await supabase.auth.signInWithPassword({ email, password });
    console.log("ADMIN LOGIN RES", res);

    if (res.error) {
      if (msg) msg.textContent = res.error.message;
      return;
    }
    if (msg) msg.textContent = "";
    // UI will update via onAuthStateChange
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      clearSupabaseAuthStorage();
      location.href = "/admin.html";
    }
  });
}

function init() {
  setupLogin();
  renderDebounced();
}

window.addEventListener("DOMContentLoaded", init);
