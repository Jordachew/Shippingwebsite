/* ============================================================
   Sueños Shipping — Customer Portal (script.js)
   Dark theme preserved. Stable auth + calculator + invoices + chat.
   Key fixes:
   - No "supabase already declared" (global singleton window.__SB__)
   - No "only sign in once" (stable storageKey + safe session checks)
   - Phone field supported at signup
   - Calculator/rates always render (script loads after supabase UMD)
   ============================================================ */

// ------------------------
// SUPABASE INIT (SINGLETON)
// ------------------------
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8"; // <-- replace with your anon key

if (!window.supabase) {
  throw new Error(
    "Supabase UMD library not loaded. Ensure you have: " +
      "<script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'></script> " +
      "before script.js"
  );
}

window.__SB__ =
  window.__SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "suenos-auth",
    },
  });

const sb = window.__SB__;

// ------------------------
// CONFIG
// ------------------------
const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";
const HOURS_TEXT = "Mon–Fri 10:00 AM–5:00 PM. After hours, we reply next business day.";

// Warehouse address (updated)
const WAREHOUSE_ADDRESS_LINES = ["3706 NW 16th Street", "Lauderhill, Florida 33311"];

// ------------------------
// RATES (EDIT)
// ------------------------
const rates = [
  { lbs: 1, jmd: 400 },
  { lbs: 2, jmd: 750 },
  { lbs: 3, jmd: 1050 },
  { lbs: 4, jmd: 1350 },
  { lbs: 5, jmd: 1600 },
  { lbs: 6, jmd: 1950 },
  { lbs: 7, jmd: 2150 },
  { lbs: 8, jmd: 2350 },
  { lbs: 9, jmd: 2600 },
  { lbs: 10, jmd: 2950 },
];
const fixedFeeJMD = 500;

// ------------------------
// HELPERS
// ------------------------
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
    maximumFractionDigits: 0
  }).format(Number(n || 0));
}
function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON" ? "Rhoden Hall District, Clarendon" : "UWI, Kingston";
}
function firstName(fullName, email) {
  const fn = (fullName || "").trim().split(/\s+/)[0];
  if (fn) return fn;
  return (email || "Customer").split("@")[0] || "Customer";
}
function clearAuthStorage() {
  // fixes "can only login once" caused by stale/duplicate auth keys
  try {
    const keys = Object.keys(localStorage || {});
    for (const k of keys) {
      if (k === "suenos-auth" || k.startsWith("sb-")) localStorage.removeItem(k);
    }
  } catch (_) {}
}

// ------------------------
// NAV + TABS
// ------------------------
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

// ------------------------
// CALCULATOR
// ------------------------
function findRateForWeight(weightLbs) {
  const rounded = Math.ceil(weightLbs);
  const match = rates.find(r => r.lbs === rounded);
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
    const w = parseFloat(($("weight")?.value || "").trim());
    const v = parseFloat(($("value")?.value || "").trim());

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

// ------------------------
// PROFILE (safe)
// ------------------------
async function getAuthedUser() {
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session) return null;
  const { data: uData, error: uErr } = await sb.auth.getUser();
  if (uErr) return null;
  return uData?.user || null;
}

async function readMyProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,phone,role,customer_no")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function ensureProfile(user, { full_name, phone } = {}) {
  // Try read
  const existing = await readMyProfile(user.id);
  if (existing) {
    const patch = {};
    if (full_name && !existing.full_name) patch.full_name = full_name;
    if (phone && !existing.phone) patch.phone = phone;
    if (Object.keys(patch).length) {
      await sb.from("profiles").update(patch).eq("id", user.id);
    }
    return await readMyProfile(user.id);
  }

  // Insert minimal first (never break if schema differs)
  let ins = await sb.from("profiles").insert({ id: user.id, email: user.email });
  if (ins.error) {
    // if conflict etc, ignore
  }

  // Attempt optional patch
  const patch = {};
  if (full_name) patch.full_name = full_name;
  if (phone) patch.phone = phone;
  if (Object.keys(patch).length) {
    await sb.from("profiles").update(patch).eq("id", user.id);
  }

  return await readMyProfile(user.id);
}

function renderShipTo(profile, email) {
  const el = $("shipToBlock");
  if (!el) return;
  const name = firstName(profile?.full_name, email);
  const acct = profile?.customer_no || "SNS-JMXXXX";
  el.textContent = [`${name} — ${acct}`, ...WAREHOUSE_ADDRESS_LINES].join("\n");
}

function setupCopyShipTo() {
  $("copyShipTo")?.addEventListener("click", async () => {
    const text = $("shipToBlock")?.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const btn = $("copyShipTo");
      if (btn) {
        const old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = old), 1200);
      }
    } catch (_) {}
  });
}

// ------------------------
// AUTH (login/register/logout)
// ------------------------
function setupLoginRegister() {
  $("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("loginMsg");
    if (msg) msg.textContent = "Signing in...";

    const email = ($("loginEmail")?.value || "").trim().toLowerCase();
    const password = $("loginPassword")?.value || "";

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (msg) msg.textContent = error.message;
      return;
    }

    // confirm session
    const { data: sess } = await sb.auth.getSession();
    if (!sess?.session) {
      if (msg) msg.textContent = "No session. If email confirmation is ON, confirm your email then sign in.";
      return;
    }

    if (msg) msg.textContent = "";
    await renderAuth();
  });

  $("registerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("regMsg");
    if (msg) msg.textContent = "Creating account...";

    const full_name = ($("regName")?.value || "").trim();
    const phone = ($("regPhone")?.value || "").trim();
    const email = ($("regEmail")?.value || "").trim().toLowerCase();
    const password = $("regPassword")?.value || "";

    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { full_name, phone } }
    });

    if (error) {
      if (msg) msg.textContent = "Signup error: " + error.message;
      return;
    }

    const { data: sess } = await sb.auth.getSession();
    if (sess?.session) {
      const user = await getAuthedUser();
      if (user) await ensureProfile(user, { full_name, phone });
      if (msg) msg.textContent = "Account created. You can now log in.";
    } else {
      if (msg) msg.textContent = "Account created. Please check your email to confirm, then log in.";
    }

    $("registerForm").reset();
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    clearAuthStorage();
    await renderAuth();
  });
}

// ------------------------
// PACKAGES + UPLOADS
// ------------------------
async function renderPackages(filter = "") {
  const body = $("pkgBody");
  if (!body) return;

  const user = await getAuthedUser();
  if (!user) {
    body.innerHTML = `<tr><td colspan="4" class="muted">Please log in.</td></tr>`;
    return;
  }

  let q = sb.from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at")
    .order("updated_at", { ascending: false });

  if (filter.trim()) q = q.ilike("tracking", `%${filter.trim()}%`);

  const { data, error } = await q;
  if (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No packages yet.</td></tr>`;
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

  const user = await getAuthedUser();
  if (!user) {
    list.innerHTML = `<li class="muted">Log in to see uploads.</li>`;
    return;
  }

  const { data, error } = await sb
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
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending"} • ${new Date(i.created_at).toLocaleString()}
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
    const msg = $("invMsg");
    if (msg) msg.textContent = "Uploading...";

    const user = await getAuthedUser();
    if (!user) {
      if (msg) msg.textContent = "Please log in.";
      return;
    }

    const tracking = ($("invTracking")?.value || "").trim();
    const pickup = $("invPickup")?.value || "";
    const note = ($("invNote")?.value || "").trim();
    const fileInput = $("invFile");

    if (!tracking) { if (msg) msg.textContent = "Tracking ID required."; return; }
    if (!fileInput?.files?.length) { if (msg) msg.textContent = "Choose a file."; return; }

    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await sb.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
    if (up.error) { if (msg) msg.textContent = up.error.message; return; }

    const ins = await sb.from("invoices").insert({
      user_id: user.id,
      tracking,
      pickup,
      pickup_confirmed: false,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
      note: note || null
    });

    if (ins.error) { if (msg) msg.textContent = ins.error.message; return; }

    form.reset();
    if (msg) msg.textContent = "Uploaded. Pickup location will be confirmed by staff.";
    await renderUploads();
  });
}

// ------------------------
// CHAT (realtime)
// ------------------------
let chatChannel = null;

async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  const user = await getAuthedUser();
  if (!user) {
    body.innerHTML = `<div class="muted small">Log in to chat with support.</div>`;
    return;
  }

  const { data, error } = await sb
    .from("messages")
    .select("id,sender,body,created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data?.length ? data : []).map(m => `
    <div class="bubble ${m.sender === "customer" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "customer" ? "You" : "Support"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">Start the conversation. ${escapeHTML(HOURS_TEXT)}</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime() {
  const user = await getAuthedUser();
  if (!user) return;

  if (chatChannel) {
    sb.removeChannel(chatChannel);
    chatChannel = null;
  }

  chatChannel = sb
    .channel(`messages:${user.id}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

async function sendChatMessage(text, file) {
  const user = await getAuthedUser();
  if (!user) return alert("Please log in to chat.");

  const { data: msg, error: mErr } = await sb
    .from("messages")
    .insert({ user_id: user.id, sender: "customer", body: text })
    .select("id")
    .single();

  if (mErr) return alert(mErr.message);

  if (file) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/messages/${Date.now()}_${safeName}`;

    const up = await sb.storage.from(CHAT_BUCKET).upload(path, file, { upsert: false });
    if (up.error) return alert(up.error.message);

    const ins = await sb.from("message_attachments").insert({
      message_id: msg.id,
      user_id: user.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown"
    });

    if (ins.error) return alert(ins.error.message);
  }
}

function openChat() {
  $("chatWidget")?.classList.remove("hidden");
  $("chatWidget")?.setAttribute("aria-hidden", "false");
  if ($("chatHoursText")) $("chatHoursText").textContent = HOURS_TEXT;
  renderChat().then(setupChatRealtime);
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
  });
}

// ------------------------
// AUTH RENDER
// ------------------------
async function renderAuth() {
  const loginCard = $("loginCard");
  const dashCard = $("dashCard");

  const user = await getAuthedUser();
  const authed = !!user;

  if (loginCard) loginCard.classList.toggle("hidden", authed);
  if (dashCard) dashCard.classList.toggle("hidden", !authed);

  if (!authed) {
    if ($("adminLink")) $("adminLink").style.display = "none";
    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
    return;
  }

  // Ensure profile exists & read it
  const prof = await ensureProfile(user);
  const fn = firstName(prof?.full_name, user.email);

  if ($("userName")) $("userName").textContent = `${fn} — ${user.email}`;
  renderShipTo(prof, user.email);

  const role = (prof?.role || "").toLowerCase();
  const isStaff = role === "staff" || role === "admin";
  if ($("adminLink")) $("adminLink").style.display = isStaff ? "inline-flex" : "none";

  await renderPackages("");
  await renderUploads();
}

sb.auth.onAuthStateChange(async () => {
  await renderAuth();
});

// ------------------------
// INIT
// ------------------------
function init() {
  setupMobileNav();
  setupAuthTabs();
  setupCalculator();
  setupLoginRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();
  setupCopyShipTo();
  renderAuth();
}

window.addEventListener("DOMContentLoaded", init);
