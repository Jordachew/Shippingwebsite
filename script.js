
/* ============================================================
   Sueños Shipping — Customer Portal script.js (Fresh, Stable)
   - Fixes: "supabase already declared", "supabase undefined/auth"
   - Uses global singleton: window.__SB__
   - Uses sb everywhere (NOT const supabase)
   - Safe profile read: eq("id", user.id).maybeSingle()
   - Shows: FirstName — Email + SNS-JMXXXX shipping address header
   ============================================================ */

/* -------------------------
   1) SUPABASE INIT (SINGLETON)
   ------------------------- */
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// IMPORTANT: ensure supabase-js is loaded BEFORE this script:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script defer src="script.js"></script>
if (!window.supabase) {
  throw new Error(
    "Supabase library not loaded. Ensure the supabase-js <script> tag is included BEFORE script.js."
  );
}

// Global singleton to prevent "Identifier already declared"
window.__SB__ =
  window.__SB__ || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Use sb everywhere
const sb = window.__SB__;

/* -------------------------
   2) CONFIG
   ------------------------- */
const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

// Business hours note
const HOURS_TEXT =
  "Mon–Fri 10:00 AM–5:00 PM. After hours, we reply next business day.";

// Warehouse address (updated)
const WAREHOUSE_ADDRESS_LINES = [
  "3706 NW 16th Street",
  "Lauderhill, Florida 33311",
];

// Calculator base pricing (edit anytime)
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
function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON"
    ? "Rhoden Hall District, Clarendon"
    : "UWI, Kingston";
}

/* -------------------------
   3) NAV + TABS
   ------------------------- */
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

/* -------------------------
   4) CALCULATOR
   ------------------------- */
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
      result.innerHTML =
        `<div class="result__big">—</div>` +
        `<div class="result__sub">Enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(w);
    const total = rate + fixedFeeJMD;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">
        Weight used: <strong>${rounded} lb</strong>.
        Base: ${formatJMD(rate)} + Fee: ${formatJMD(fixedFeeJMD)}.
      </div>
    `;
  });
}

/* -------------------------
   5) PROFILE + SHIPPING ADDRESS
   ------------------------- */
function firstNameFrom(fullName, email) {
  const fn = (fullName || "").trim().split(/\s+/)[0];
  if (fn) return fn;
  const fromEmail = (email || "Customer").split("@")[0];
  return fromEmail || "Customer";
}

function buildShipToText(profile, email) {
  const first = firstNameFrom(profile?.full_name, email);
  const acct = profile?.customer_no || "SNS-JMXXXX";

  return [`${first} — ${acct}`, ...WAREHOUSE_ADDRESS_LINES].join("\n");
}

function renderShipTo(profile, email) {
  const el = $("shipToBlock");
  if (!el) return;
  el.textContent = buildShipToText(profile, email);
}

/**
 * ensureProfileSafe()
 * Creates/updates a basic profiles row if missing.
 * - Never uses .single() without filters
 * - Avoids columns that might not exist
 */
async function ensureProfileSafe({ full_name, phone } = {}) {
  const { data: uData, error: uErr } = await sb.auth.getUser();
  if (uErr) return { ok: false, error: uErr };
  const user = uData?.user;
  if (!user) return { ok: false, error: new Error("Not logged in") };

  // Read profile safely
  const { data: profile, error: pErr } = await sb
    .from("profiles")
    .select("id,email,full_name,phone,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  // If exists, optionally patch missing values
  if (!pErr && profile) {
    const patch = {};
    if (full_name && !profile.full_name) patch.full_name = full_name;
    if (phone && !profile.phone) patch.phone = phone;

    if (Object.keys(patch).length) {
      await sb.from("profiles").update(patch).eq("id", user.id);
    }
    return { ok: true, profile };
  }

  // If missing, attempt minimal insert (avoid schema mismatches)
  // We include full_name/phone only if your table has them; if it fails, fallback.
  const baseRow = { id: user.id, email: user.email };
  const attemptRow = {
    ...baseRow,
    full_name: full_name || "",
    phone: phone || "",
  };

  let ins = await sb.from("profiles").insert(attemptRow);
  if (ins.error) {
    // fallback minimal insert
    ins = await sb.from("profiles").insert(baseRow);
    if (ins.error) return { ok: false, error: ins.error };
  }

  const { data: profile2, error: p2Err } = await sb
    .from("profiles")
    .select("id,email,full_name,phone,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  if (p2Err) return { ok: false, error: p2Err };
  return { ok: true, profile: profile2 || null };
}

/* -------------------------
   6) LOGIN / REGISTER
   ------------------------- */
function setupLoginRegister() {
  const loginForm = $("loginForm");
  const regForm = $("registerForm");

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("loginMsg");
    if (msg) msg.textContent = "Signing in...";

    try {
      const email = ($("loginEmail")?.value || "").trim().toLowerCase();
      const password = $("loginPassword")?.value || "";

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (msg) msg.textContent = error.message;
        return;
      }

      // confirm session
      const { data: sessData, error: sessErr } = await sb.auth.getSession();
      if (sessErr) {
        if (msg) msg.textContent = "Session error: " + sessErr.message;
        return;
      }
      if (!sessData?.session) {
        if (msg)
          msg.textContent =
            "No session returned. If email confirmation is ON, confirm email then log in.";
        return;
      }

      // ensure profile exists (safe)
      const ensured = await ensureProfileSafe();
      if (!ensured.ok) {
        if (msg) msg.textContent = "Profile error: " + ensured.error.message;
        return;
      }

      if (msg) msg.textContent = "";
      await renderAuth();
    } catch (err) {
      console.error(err);
      if (msg)
        msg.textContent = "Unexpected error: " + (err?.message || String(err));
    }
  });

  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("regMsg");
    if (msg) msg.textContent = "Creating account...";

    try {
      const full_name = ($("regName")?.value || "").trim();
      const phone = ($("regPhone")?.value || "").trim();
      const email = ($("regEmail")?.value || "").trim().toLowerCase();
      const password = $("regPassword")?.value || "";

      const { error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name, phone } },
      });

      if (error) {
        if (msg) msg.textContent = "Signup error: " + error.message;
        return;
      }

      // If email confirmation OFF, we may have a session; if ON, they must confirm.
      // We DON'T force profile creation here if no session exists.
      const { data: sessData } = await sb.auth.getSession();
      if (sessData?.session) {
        await ensureProfileSafe({ full_name, phone });
        if (msg) msg.textContent = "Account created. You can now log in.";
      } else {
        if (msg)
          msg.textContent =
            "Account created. Please check your email to confirm, then log in.";
      }

      regForm.reset();
    } catch (err) {
      console.error(err);
      if (msg)
        msg.textContent = "Unexpected error: " + (err?.message || String(err));
    }
  });

  $("logoutBtn")?.addEventListener("click", async () => {
    await sb.auth.signOut();
    await renderAuth();
  });
}

/* -------------------------
   7) PACKAGES + INVOICES
   ------------------------- */
async function renderPackages(filter = "") {
  const body = $("pkgBody");
  if (!body) return;

  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
  if (!user) {
    body.innerHTML =
      `<tr><td colspan="4" class="muted">Please log in.</td></tr>`;
    return;
  }

  let q = sb
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at")
    .order("updated_at", { ascending: false });

  if (filter.trim()) {
    q = q.ilike("tracking", `%${filter.trim()}%`);
  }

  const { data, error } = await q;
  if (error) {
    body.innerHTML =
      `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML =
      `<tr><td colspan="4" class="muted">No packages yet.</td></tr>`;
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

  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
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

  list.innerHTML = data
    .map(
      (i) => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(
        i.file_name
      )} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${
        i.pickup_confirmed ? "Confirmed" : "Pending confirmation"
      } • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `
    )
    .join("");
}

function setupPackageSearch() {
  $("pkgSearch")?.addEventListener("input", (e) =>
    renderPackages(e.target.value)
  );
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

    const { data: uData } = await sb.auth.getUser();
    const user = uData?.user;
    if (!user) {
      if (msg) msg.textContent = "Please log in.";
      return;
    }

    const tracking = ($("invTracking")?.value || "").trim();
    const pickup = $("invPickup")?.value || "";
    const note = ($("invNote")?.value || "").trim();
    const fileInput = $("invFile");

    if (!tracking) {
      if (msg) msg.textContent = "Tracking ID required.";
      return;
    }
    if (!fileInput?.files?.length) {
      if (msg) msg.textContent = "Choose a file.";
      return;
    }

    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await sb.storage.from(INVOICE_BUCKET).upload(path, file, {
      upsert: false,
    });
    if (up.error) {
      if (msg) msg.textContent = up.error.message;
      return;
    }

    const ins = await sb.from("invoices").insert({
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
      if (msg) msg.textContent = ins.error.message;
      return;
    }

    form.reset();
    if (msg)
      msg.textContent =
        "Uploaded. Pickup location will be confirmed by staff.";
    await renderUploads();
  });
}

/* -------------------------
   8) CHAT
   ------------------------- */
let chatChannel = null;

async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
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
    body.innerHTML = `<div class="muted small">${escapeHTML(
      error.message
    )}</div>`;
    return;
  }

  body.innerHTML =
    (data?.length ? data : [])
      .map(
        (m) => `
      <div class="bubble ${m.sender === "customer" ? "me" : ""}">
        <div>${escapeHTML(m.body)}</div>
        <div class="meta">
          <span>${m.sender === "customer" ? "You" : "Support"}</span>
          <span>${new Date(m.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}</span>
        </div>
      </div>
    `
      )
      .join("") ||
    `<div class="muted small">Start the conversation. ${escapeHTML(
      HOURS_TEXT
    )}</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime() {
  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
  if (!user) return;

  if (chatChannel) {
    sb.removeChannel(chatChannel);
    chatChannel = null;
  }

  chatChannel = sb
    .channel(`messages:${user.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `user_id=eq.${user.id}`,
      },
      async () => {
        await renderChat();
      }
    )
    .subscribe();
}

async function sendChatMessage(text, file) {
  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
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

    const up = await sb.storage.from(CHAT_BUCKET).upload(path, file, {
      upsert: false,
    });
    if (up.error) return alert(up.error.message);

    const ins = await sb.from("message_attachments").insert({
      message_id: msg.id,
      user_id: user.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
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

/* -------------------------
   9) AUTH RENDER
   ------------------------- */
async function renderAuth() {
  const loginCard = $("loginCard");
  const dashCard = $("dashCard");

  const { data: uData } = await sb.auth.getUser();
  const user = uData?.user;
  const authed = !!user;

  if (loginCard) loginCard.classList.toggle("hidden", authed);
  if (dashCard) dashCard.classList.toggle("hidden", !authed);

  if (!authed) {
    if ($("adminLink")) $("adminLink").style.display = "none";
    if (chatChannel) {
      sb.removeChannel(chatChannel);
      chatChannel = null;
    }
    return;
  }

  // Ensure profile exists safely
  const ensured = await ensureProfileSafe();
  if (!ensured.ok) {
    console.warn("PROFILE ensure error:", ensured.error);
  }

  // Read profile for display + customer_no
  const { data: profile, error: pErr } = await sb
    .from("profiles")
    .select("full_name,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  const displayName =
    (!pErr && profile?.full_name)
      ? profile.full_name
      : (user.email || "Customer");

  // Show "FirstName — Email" if there is a #userName element
  const first = firstNameFrom(profile?.full_name, user.email);
  if ($("userName")) $("userName").textContent = `${first} — ${user.email}`;

  // Shipping address block (FirstName — SNS-JMXXXX)
  renderShipTo(profile, user.email);

  // Show admin link if staff
  const isStaff = (!pErr && profile?.role === "staff") || (!pErr && profile?.role === "admin");
  if ($("adminLink")) $("adminLink").style.display = isStaff ? "inline-flex" : "none";

  await renderPackages("");
  await renderUploads();
}

sb.auth.onAuthStateChange(async () => {
  await renderAuth();
});

/* -------------------------
   10) INIT
   ------------------------- */
function init() {
  setupMobileNav();
  setupAuthTabs();
  setupCalculator();
  setupLoginRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();
  renderAuth();
}

window.addEventListener("DOMContentLoaded", init);
