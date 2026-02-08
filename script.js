// ========================
// CONFIG (PASTE YOUR VALUES)
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Safe singleton (prevents double-load issues)
window.__SB__ =
  window.__SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // NOTE: you can remove storage override if you want,
      // but keeping it is fine on same-origin deployments.
      storage: window.localStorage,
    },
  });

const supabase = window.__SB__;

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

// ========================
// DEBUG HELPERS
// ========================
function logSB(label, obj) {
  try {
    console.log("🟣", label, JSON.parse(JSON.stringify(obj || {})));
  } catch {
    console.log("🟣", label, obj);
  }
}

// ========================
// UI HELPERS
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
function formatJMD(n) {
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

// Your DB values appear to be: UWI_KINGSTON and RHODEN_HALL_CLARENDON
function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON"
    ? "Rhoden Hall District, Clarendon"
    : "UWI, Kingston";
}

// Business hours note (Mon–Fri 10–5)
const HOURS_TEXT =
  "Mon–Fri 10:00 AM–5:00 PM. After hours, we reply next business day.";

// ========================
// CUSTOMER CHAT VISIBILITY FIX (WHITE TEXT)
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

    /* Optional: make bubbles readable if your theme is dark */
    .bubble { background: rgba(255,255,255,0.06) !important; }
    .bubble.me { background: rgba(255,255,255,0.10) !important; }
  `;
  document.head.appendChild(style);
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
// NAV + TABS
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
// PROFILE creation (NO TRIGGER REQUIRED)
// ========================
function stashPendingProfile(full_name, phone, email) {
  try {
    localStorage.setItem(
      "pending_profile",
      JSON.stringify({ full_name, phone, email, at: Date.now() })
    );
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
  try {
    localStorage.removeItem("pending_profile");
  } catch (_) {}
}

async function ensureProfile({ full_name, phone } = {}) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr };
  const user = userData?.user;
  if (!user) return { ok: false, error: new Error("Not logged in") };

  const readRes = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role")
    .eq("id", user.id)
    .maybeSingle();

  if (readRes.error) console.error("PROFILE READ ERROR:", readRes.error);

  if (readRes.data && !readRes.error) {
    const profile = readRes.data;
    const patch = {};
    if (full_name && !profile.full_name) patch.full_name = full_name;
    if (phone && !profile.phone) patch.phone = phone;
    if (Object.keys(patch).length) {
      const up = await supabase.from("profiles").update(patch).eq("id", user.id);
      if (up.error) console.error("PROFILE UPDATE ERROR:", up.error);
    }
    return { ok: true, profile };
  }

  const upsertRes = await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    full_name: full_name || "",
    phone: phone || "",
  });

  if (upsertRes.error) {
    console.error("PROFILE UPSERT ERROR:", upsertRes.error);
    return { ok: false, error: upsertRes.error };
  }

  const read2 = await supabase
    .from("profiles")
    .select("id, email, full_name, phone, role")
    .eq("id", user.id)
    .maybeSingle();

  if (read2.error) console.error("PROFILE READ2 ERROR:", read2.error);

  return { ok: true, profile: read2.data || null };
}

// ========================
// AUTH: STOP RECURSION / MULTI-LISTENERS
// ========================
let __renderAuthBusy = false;
let __renderAuthQueued = false;

function renderAuthDebounced() {
  if (__renderAuthQueued) return;
  __renderAuthQueued = true;
  setTimeout(async () => {
    __renderAuthQueued = false;
    await renderAuth();
  }, 0);
}

function getProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "unknown";
  }
}

function clearSupabaseAuthStorage() {
  try {
    const ref = getProjectRef();
    localStorage.removeItem(`sb-${ref}-auth-token`);
    localStorage.removeItem("pending_profile");
  } catch {}
}

// ✅ If login gets stuck, this resets local auth state without wiping your whole browser storage.
async function hardResetAuthState() {
  try { await supabase.auth.signOut(); } catch {}
  clearSupabaseAuthStorage();
}

// ========================
// Login / Register / Logout
// ========================
function setupLoginRegister() {
  const loginForm = $("loginForm");
  const regForm = $("registerForm");

  // LOGIN
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = $("loginMsg");
    if (msg) msg.textContent = "Signing in...";

    // Safety timeout so it never hangs forever
    let timeoutHit = false;
    const t = setTimeout(() => {
      timeoutHit = true;
      if (msg) msg.textContent = "Still signing in… (If this keeps happening, we’ll reset auth and try again.)";
    }, 9000);

    try {
      const email = $("loginEmail")?.value?.trim()?.toLowerCase();
      const password = $("loginPassword")?.value;

      // If a broken token is in storage, sign-in can behave weirdly.
      // Reset stale storage first if we already have a junk session.
      const sess0 = await supabase.auth.getSession();
      logSB("PRE LOGIN SESSION", sess0);

      // Attempt login
      const res = await supabase.auth.signInWithPassword({ email, password });
      logSB("LOGIN RES", res);

      if (res.error) {
        // If auth storage is corrupted, retry once after clearing
        const m = res.error.message || "";
        if (m.toLowerCase().includes("refresh") || m.toLowerCase().includes("token") || timeoutHit) {
          await hardResetAuthState();
          const res2 = await supabase.auth.signInWithPassword({ email, password });
          logSB("LOGIN RES (RETRY)", res2);
          if (res2.error) {
            if (msg) msg.textContent = `Login error: ${res2.error.message}`;
            return;
          }
        } else {
          if (msg) msg.textContent = `Login error: ${res.error.message}`;
          return;
        }
      }

      // ✅ Force UI update immediately (don’t rely only on onAuthStateChange)
      const sess = await supabase.auth.getSession();
      logSB("POST LOGIN SESSION", sess);

      if (!sess?.data?.session) {
        if (msg) msg.textContent = "Logged in but no session returned. Check Supabase Auth settings (email confirmation?).";
        // Still try to rerender UI
        renderAuthDebounced();
        return;
      }

      if (msg) msg.textContent = "";
      renderAuthDebounced();
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
    } finally {
      clearTimeout(t);
    }
  });

  // REGISTER
  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = $("regMsg");
    if (msg) msg.textContent = "Creating account...";

    try {
      const full_name = $("regName")?.value?.trim() || "";
      const phone = $("regPhone")?.value?.trim() || "";
      const email = $("regEmail")?.value?.trim()?.toLowerCase();
      const password = $("regPassword")?.value;

      stashPendingProfile(full_name, phone, email);

      const res = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name, phone } },
      });

      logSB("SIGNUP RES", res);

      if (res.error) {
        if (msg) msg.textContent = `Signup error: ${res.error.message}`;
        return;
      }

      if (msg) msg.textContent = "Account created. If email confirmation is ON, confirm email then sign in.";
      regForm.reset();
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
    }
  });

  // LOGOUT (bind once)
  if (!window.__LOGOUT_BOUND__) {
    window.__LOGOUT_BOUND__ = true;
    $("logoutBtn")?.addEventListener("click", async () => {
      try {
        await supabase.auth.signOut();
      } finally {
        clearSupabaseAuthStorage();
        location.reload();
      }
    });
  }
}

// ========================
// Packages + invoices
// ========================
async function renderPackages(filter = "") {
  const body = $("pkgBody");
  if (!body) return;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    body.innerHTML = `<tr><td colspan="4" class="muted">Please log in.</td></tr>`;
    return;
  }

  let q = supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at")
    .order("updated_at", { ascending: false });

  if (filter.trim()) q = q.ilike("tracking", `%${filter.trim()}%`);

  const { data, error } = await q;
  if (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No packages yet. Upload invoices and message us if needed.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map(
      (p) => `
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}${
        p.pickup_confirmed
          ? ` <span class="tag">Confirmed</span>`
          : ` <span class="tag">Pending</span>`
      }</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `
    )
    .join("");
}

async function renderUploads() {
  const list = $("uploadsList");
  if (!list) return;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    list.innerHTML = `<li class="muted">Log in to see uploads.</li>`;
    return;
  }

  const res = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .order("created_at", { ascending: false })
    .limit(10);

  logSB("INVOICES SELECT", res);

  if (res.error) {
    list.innerHTML = `<li class="muted">${escapeHTML(res.error.message)}</li>`;
    return;
  }
  if (!res.data?.length) {
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = res.data
    .map(
      (i) => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name)} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending confirmation"} • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `
    )
    .join("");
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

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      if ($("invMsg")) $("invMsg").textContent = "Please log in.";
      return;
    }

    const tracking = $("invTracking")?.value?.trim();
    const pickup = $("invPickup")?.value;
    const note = $("invNote")?.value?.trim();
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

    const allowed =
      /(\.pdf|\.jpe?g|\.docx|\.xlsx|\.xls)$/i.test(file.name) ||
      [
        "application/pdf",
        "image/jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ].includes(file.type);

    if (!allowed) {
      if ($("invMsg")) $("invMsg").textContent = "Allowed: PDF, JPEG, DOCX, XLS/XLSX.";
      return;
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
    logSB("INVOICE UPLOAD", up);

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

    logSB("INVOICE INSERT", ins);

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
// Chat (messages + optional attachment)
// ========================
let chatChannel = null;

async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) {
    body.innerHTML = `<div class="muted small">Log in to chat with support.</div>`;
    return;
  }

  const res = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  logSB("MESSAGES SELECT", res);

  if (res.error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(res.error.message)}</div>`;
    return;
  }

  const data = res.data || [];

  body.innerHTML =
    (data.length ? data : [])
      .map(
        (m) => `
    <div class="bubble ${m.sender === "customer" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "customer" ? "You" : "Support"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `
      )
      .join("") || `<div class="muted small">Start the conversation. ${escapeHTML(HOURS_TEXT)}</div>`;

  body.scrollTop = body.scrollHeight;
}

let __chatQueued = false;
function renderChatDebounced() {
  if (__chatQueued) return;
  __chatQueued = true;
  setTimeout(async () => {
    __chatQueued = false;
    await renderChat();
  }, 0);
}

async function setupChatRealtime() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return;

  if (chatChannel) {
    supabase.removeChannel(chatChannel);
    chatChannel = null;
  }

  chatChannel = supabase
    .channel(`messages:${user.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` },
      () => renderChatDebounced()
    )
    .subscribe();
}

async function sendChatMessage(text, file) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return alert("Please log in to chat.");

  const msgRes = await supabase
    .from("messages")
    .insert({ user_id: user.id, sender: "customer", body: text })
    .select("id")
    .single();

  logSB("MESSAGE INSERT", msgRes);

  if (msgRes.error) return alert(msgRes.error.message);

  if (file) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/messages/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { upsert: false });
    logSB("CHAT FILE UPLOAD", up);

    if (up.error) return alert(up.error.message);

    const attRes = await supabase.from("message_attachments").insert({
      message_id: msgRes.data.id,
      user_id: user.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
    });

    logSB("ATTACHMENT INSERT", attRes);

    if (attRes.error) return alert(attRes.error.message);
  }
}

function openChat() {
  injectCustomerChatStyles(); // ✅ ensure styles apply even if widget loads later
  $("chatWidget")?.classList.remove("hidden");
  $("chatWidget")?.setAttribute("aria-hidden", "false");
  if ($("chatHoursText")) $("chatHoursText").textContent = HOURS_TEXT;
  renderChatDebounced();
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
    const file = $("chatFile")?.files?.[0] || null;
    const msgEl = $("chatMsg");

    const text = (input?.value || "").trim();
    if (!text && !file) {
      if (msgEl) msgEl.textContent = "Type a message or attach a file.";
      return;
    }

    if (msgEl) msgEl.textContent = "Sending...";
    if (input) input.value = "";
    if ($("chatFile")) $("chatFile").value = "";

    await sendChatMessage(text || "(Attachment)", file);
    if (msgEl) msgEl.textContent = "";
    renderChatDebounced(); // ✅ immediate refresh
  });
}

// ========================
// Auth render (GUARDED)
// ========================
async function renderAuth() {
  if (__renderAuthBusy) return;
  __renderAuthBusy = true;

  try {
    const loginCard = $("loginCard");
    const dashCard = $("dashCard");

    const { data: userData, error: uErr } = await supabase.auth.getUser();
    if (uErr) console.error("GET USER ERROR:", uErr);

    const user = userData?.user;
    const authed = !!user;

    if (loginCard) loginCard.classList.toggle("hidden", authed);
    if (dashCard) dashCard.classList.toggle("hidden", !authed);

    if (!authed) {
      if ($("adminLink")) $("adminLink").style.display = "none";
      if (chatChannel) {
        supabase.removeChannel(chatChannel);
        chatChannel = null;
      }
      return;
    }

    const pending = readPendingProfile();
    const ensured = pending
      ? await ensureProfile({ full_name: pending.full_name, phone: pending.phone })
      : await ensureProfile();

    if (ensured?.ok && pending) clearPendingProfile();

    const profRes = await supabase
      .from("profiles")
      .select("full_name,role")
      .eq("id", user.id)
      .maybeSingle();

    if (profRes.error) console.error("PROFILE READ (renderAuth) ERROR:", profRes.error);

    const profile = profRes.data;
    const displayName = profile?.full_name || user.email || "Customer";
    if ($("userName")) $("userName").textContent = displayName;

    const role = profile?.role || "customer";
    const isStaff = role === "staff" || role === "admin";
    if ($("adminLink")) $("adminLink").style.display = isStaff ? "inline-flex" : "none";

    await renderPackages("");
    await renderUploads();
  } finally {
    __renderAuthBusy = false;
  }
}

// Subscribe ONCE
if (!window.__AUTH_SUB__) {
  window.__AUTH_SUB__ = supabase.auth.onAuthStateChange((event, session) => {
    console.log("AUTH EVENT:", event, !!session);
    renderAuthDebounced();
  });
}

// ========================
// INIT
// ========================
function init() {
  injectCustomerChatStyles(); // ✅ apply customer chat fix immediately
  setupMobileNav();
  setupAuthTabs();
  setupCalculator();
  setupLoginRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();
  renderAuthDebounced();
}

window.addEventListener("DOMContentLoaded", init);
