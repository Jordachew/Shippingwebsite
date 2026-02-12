/* =========================================================
   Sueños Shipping — Admin Dashboard (admin.js)
   - Robust auth (fix "login once"/stuck sign-in)
   - Safe session-first user checks (no AuthSessionMissingError crash)
   - Staff/admin role gating
   - Packages, customers, messages
   - Sender constraint fallbacks: staff -> admin -> support
   - Optional Bulk CSV upload if DOM exists
========================================================= */

// ========================
// CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Storage buckets (optional; code handles if missing)
const INVOICE_BUCKET = "invoices";
const PKG_PHOTO_BUCKET = "package_photos";

// ========================
// SUPABASE CLIENT (singleton)
// ========================
if (!window.supabase || !window.supabase.createClient) {
  console.error("Supabase UMD library missing. Ensure supabase.min.js loads before admin.js");
}

window.__SB__ =
  window.__SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

const supabase = window.__SB__;

// ========================
// NOTIFICATION QUEUE (send immediately)
// ========================
async function processNotificationQueueNow() {
  try {
    const sess = await supabase.auth.getSession();
    const token = sess?.data?.session?.access_token;
    if (!token) return;

    await fetch("/api/process-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ limit: 25 }),
    });
  } catch (_) {
    // Silent: don't block admin UX if mail sending fails.
  }
}

// ========================
// DOM HELPERS
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

function getProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function clearSupabaseAuthToken() {
  // Clears the stored session that causes “login works once then stuck”
  try {
    const ref = getProjectRef();
    if (ref) localStorage.removeItem(`sb-${ref}-auth-token`);
  } catch (_) {}
}

// ========================
// SAFE AUTH HELPERS
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
  // IMPORTANT: session-first to avoid AuthSessionMissingError
  const { session, error: sErr } = await safeGetSession();
  if (sErr) return { user: null, session: null, error: sErr };
  if (!session) return { user: null, session: null, error: null };

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { user: session.user || null, session, error };
    return { user: data?.user || session.user || null, session, error: null };
  } catch (e) {
    return { user: session.user || null, session, error: e };
  }
}

async function hardResetAuth(reason = "") {
  console.warn("Hard reset auth:", reason);
  try {
    await supabase.auth.signOut();
  } catch (_) {}
  clearSupabaseAuthToken();
}

// If token exists but session is missing, clear it once to prevent “stuck sign-in”
async function sanitizeStaleTokenOnce() {
  const onceKey = "admin_sanitize_once";
  if (sessionStorage.getItem(onceKey) === "1") return;

  const ref = getProjectRef();
  const tokenKey = ref ? `sb-${ref}-auth-token` : null;
  const tokenExists = tokenKey ? !!localStorage.getItem(tokenKey) : false;

  const { session, error } = await safeGetSession();
  if (error) return;

  if (tokenExists && !session) {
    sessionStorage.setItem(onceKey, "1");
    clearSupabaseAuthToken();
    location.reload();
  }
}

// Timeout wrapper so UI doesn’t hang forever
async function withTimeout(promise, ms = 12000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error("Request timed out (blocked or not returning).")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

// ========================
// ROLE GATE
// ========================
async function getMyProfile() {
  const { user } = await safeGetUser();
  if (!user) return { profile: null, error: null };

  // Minimal columns only (avoid “column not found” crashes)
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  return { profile: data || null, error };
}

function isStaffRole(role) {
  return role === "staff" || role === "admin";
}

// ========================
// APP STATE
// ========================
let currentAdmin = null; // { id, email, role, full_name }
let currentCustomer = null; // { id, email, full_name }
let msgChannel = null;

// ========================
// TABS
// ========================
function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab[data-tab]"));
  if (!buttons.length) return;

  function showTab(tabName) {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));

    const panels = ["overview", "customers", "packages", "messages", "reports", "roles"];
    panels.forEach((p) => {
      const el = $(`tab-${p}`);
      if (el) el.classList.toggle("hidden", p !== tabName);
    });

    // Lazy refresh on tab switch
    if (tabName === "overview") renderOverview();
    if (tabName === "customers") renderCustomers();
    if (tabName === "packages") renderPackages();
    if (tabName === "messages") renderConversations();
  }

  buttons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // Default
  showTab("overview");
}

// ========================
// LOGIN / LOGOUT
// ========================
function setupAuthUI() {
  $("logoutBtn")?.addEventListener("click", async () => {
    await hardResetAuth("logout");
    location.reload();
  });

  $("adminLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("adminLoginMsg");
    if (msg) msg.textContent = "Signing in...";

    const email = ($("adminEmail")?.value || "").trim().toLowerCase();
    const password = $("adminPassword")?.value || "";

    try {
      // If we already have a session, just render app
      const { session } = await safeGetSession();
      if (session?.user) {
        if (msg) msg.textContent = "";
        await renderApp();
        return;
      }

      // Sign in (timeout so we don’t hang indefinitely)
      let res = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 12000);

      if (res?.error) {
        console.warn("Admin login error (first try):", res.error);
        // Clear possible poisoned token and retry once
        await hardResetAuth("login retry after error");
        res = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 12000);
      }

      if (res?.error) {
        if (msg) msg.textContent = res.error.message;
        return;
      }

      // Verify session exists
      const check = await safeGetSession();
      if (!check.session) {
        if (msg) msg.textContent = "Signed in, but no session found (domain/caching issue). Try clearing site data.";
        return;
      }

      if (msg) msg.textContent = "";
      await renderApp();
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = err?.message || String(err);
    }
  });
}

// ========================
// APP RENDER (auth gate)
// ========================
async function renderApp() {
  const loginCard = $("adminLoginCard");
  const app = $("adminApp");
  const logoutBtn = $("logoutBtn");
  const who = $("whoami");

  const { user, error } = await safeGetUser();
  if (error) console.warn("Admin safeGetUser error:", error);

  const authed = !!user;

  if (loginCard) loginCard.classList.toggle("hidden", authed);
  if (app) app.classList.toggle("hidden", !authed);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !authed);

  if (!authed) {
    currentAdmin = null;
    if (who) who.textContent = "";
    teardownMessageRealtime();
    return;
  }

  // Profile/role gate
  const { profile, error: pErr } = await getMyProfile();
  if (pErr) console.warn("Profile read error:", pErr);

  const role = profile?.role || "customer";
  const active = profile?.is_active !== false;

  if (!active) {
    await hardResetAuth("inactive staff");
    if (who) who.textContent = "";
    if ($("adminLoginMsg")) $("adminLoginMsg").textContent = "Account deactivated.";
    return;
  }

  if (!isStaffRole(role)) {
    // IMPORTANT: Don't auto-signout here. Auto-signout can create the “login once then stuck” loop.
    // Instead, show a clear message and allow manual logout.
    currentAdmin = null;
    if (who) who.textContent = "";
    if (loginCard) loginCard.classList.remove("hidden");
    if (app) app.classList.add("hidden");
    if (logoutBtn) logoutBtn.classList.remove("hidden");
    if ($("adminLoginMsg")) $("adminLoginMsg").textContent =
      "Signed in, but not authorized. Your profile role must be 'staff' or 'admin'. Click Log out, then have an admin update your role in Supabase.";
    return;
  }

  currentAdmin = {
    id: profile?.id || user.id,
    email: profile?.email || user.email,
    full_name: profile?.full_name || user.email,
    role,
  };

  if (who) who.textContent = `${currentAdmin.full_name} • ${currentAdmin.role}`;

  setupTabs();
  setupOverviewButtons();

  // Initial loads
  await renderOverview();
}

// Keep UI responsive on auth changes
let __authSub = null;
function setupAuthSubOnce() {
  if (__authSub) return;
  __authSub = supabase.auth.onAuthStateChange(() => renderApp());
}

// ========================
// OVERVIEW
// ========================
function setupOverviewButtons() {
  $("goPackagesBtn")?.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="packages"]')?.click();
  });
  $("goMessagesBtn")?.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="messages"]')?.click();
  });
  $("exportPackagesBtn")?.addEventListener("click", exportPackagesCSV);
}

async function renderOverview() {
  // Stats: packages by status + customers + messages
  const statsRow = $("statsRow");
  if (!statsRow) return;

  // Pull last N packages/messages for “Recent”
  const [pkgRes, msgRes, custRes] = await Promise.all([
    supabase
      .from("packages")
      .select("id,tracking,status,updated_at")
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("messages")
      .select("id,user_id,sender,body,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("profiles")
      .select("id")
      .limit(1),
  ]);

  // Build quick status counts (lightweight)
  const statusCounts = {};
  if (pkgRes.data) {
    for (const p of pkgRes.data) {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    }
  }

  const stats = [
    { label: "Recent packages", value: pkgRes.data?.length || 0 },
    { label: "Recent messages", value: msgRes.data?.length || 0 },
    { label: "Statuses shown", value: Object.keys(statusCounts).length },
  ];

  statsRow.innerHTML = stats
    .map(
      (s) => `
      <div class="stat">
        <div class="stat__value">${escapeHTML(s.value)}</div>
        <div class="stat__label">${escapeHTML(s.label)}</div>
      </div>
    `
    )
    .join("");

  const recentPackages = $("recentPackages");
  if (recentPackages) {
    recentPackages.innerHTML =
      (pkgRes.data || [])
        .map(
          (p) => `
        <div class="rowline">
          <strong>${escapeHTML(p.tracking)}</strong>
          <span class="tag">${escapeHTML(p.status)}</span>
          <span class="muted small">${new Date(p.updated_at).toLocaleString()}</span>
        </div>
      `
        )
        .join("") || `<div class="muted">No recent packages.</div>`;
  }

  const recentMessages = $("recentMessages");
  if (recentMessages) {
    recentMessages.innerHTML =
      (msgRes.data || [])
        .map(
          (m) => `
        <div class="rowline">
          <span class="tag">${escapeHTML(m.sender)}</span>
          <span>${escapeHTML((m.body || "").slice(0, 80))}</span>
          <span class="muted small">${new Date(m.created_at).toLocaleString()}</span>
        </div>
      `
        )
        .join("") || `<div class="muted">No recent messages.</div>`;
  }
}

// ========================
// CUSTOMERS
// ========================
function setupCustomersUI() {
  $("custSearch")?.addEventListener("input", () => renderCustomers());
  $("refreshCustomers")?.addEventListener("click", () => renderCustomers());
}

async function renderCustomers() {
  setupCustomersUI();

  const body = $("customersBody");
  if (!body) return;

  const q = ($("custSearch")?.value || "").trim().toLowerCase();

  let query = supabase
    .from("profiles")
    .select("id,email,full_name,role,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No customers found.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map(
      (c) => `
    <tr data-id="${escapeHTML(c.id)}" class="clickrow">
      <td><strong>${escapeHTML(c.full_name || "—")}</strong></td>
      <td>${escapeHTML(c.email || "—")}</td>
      <td><span class="tag">${escapeHTML(c.role || "customer")}</span></td>
      <td class="muted small">${c.is_active === false ? "Inactive" : "Active"}</td>
    </tr>
  `
    )
    .join("");

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", async () => {
      const id = tr.getAttribute("data-id");
      const customer = data.find((x) => x.id === id);
      currentCustomer = customer
        ? { id: customer.id, email: customer.email, full_name: customer.full_name }
        : null;

      await renderCustomerDetail();
      // jump to messages tab with convo
      document.querySelector('.tab[data-tab="messages"]')?.click();
      await selectConversationByCustomer(currentCustomer?.id);
    });
  });
}

async function renderCustomerDetail() {
  const card = $("customerDetail");
  if (!card || !currentCustomer) return;

  // fetch packages for that customer
  const { data: pkgs } = await supabase
    .from("packages")
    .select("id,tracking,status,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  card.innerHTML = `
    <div class="card__head">
      <h3 class="h3">${escapeHTML(currentCustomer.full_name || "Customer")}</h3>
      <p class="muted small">${escapeHTML(currentCustomer.email || "")}</p>
    </div>
    <div class="muted small">Recent packages</div>
    <div class="stack">
      ${
        (pkgs || [])
          .map(
            (p) => `
          <div class="rowline">
            <strong>${escapeHTML(p.tracking)}</strong>
            <span class="tag">${escapeHTML(p.status)}</span>
            <span class="muted small">${new Date(p.updated_at).toLocaleString()}</span>
          </div>
        `
          )
          .join("") || `<div class="muted">No packages assigned.</div>`
      }
    </div>
  `;
}

// ========================
// PACKAGES
// ========================
function setupPackagesUI() {
  $("pkgSearch")?.addEventListener("input", () => renderPackages());
  $("statusFilter")?.addEventListener("change", () => renderPackages());
  $("refreshPackages")?.addEventListener("click", () => renderPackages());

  var csvBtn = $("csvUploadBtn");
  if (csvBtn) csvBtn.addEventListener("click", async function () {
    var inp = $("csvUploadInput");
    var file = inp && inp.files ? inp.files[0] : null;
    if (!file) { var msg = $("csvUploadMsg"); if (msg) msg.textContent = "Choose a CSV file first."; return; }
    await importPackagesFromCsvFile(file);
  });


  $("pkgEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await savePackageEdits();
  });
}

async function renderPackages() {
  setupPackagesUI();

  const body = $("packagesBody");
  if (!body) return;

  const q = ($("pkgSearch")?.value || "").trim();
  const status = ($("statusFilter")?.value || "").trim();

  let query = supabase
    .from("packages")
    .select("id,tracking,status,store,approved,notes,user_id,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (q) query = query.ilike("tracking", `%${q}%`);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No packages.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map(
      (p) => `
    <tr data-id="${escapeHTML(p.id)}" class="clickrow">
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(p.store || "—")}</td>
      <td class="muted small">${p.approved ? "Yes" : "No"}</td>
      <td class="muted small">${escapeHTML(p.user_id || "Unassigned")}</td>
      <td class="muted small">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `
    )
    .join("");

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = tr.getAttribute("data-id");
      const pkg = data.find((x) => x.id === id);
      if (!pkg) return;
      fillPackageEditor(pkg);
    });
  });
}

function fillPackageEditor(pkg) {
  if ($("pkgEditId")) $("pkgEditId").value = pkg.id || "";
  if ($("pkgEditTracking")) $("pkgEditTracking").value = pkg.tracking || "";
  if ($("pkgEditStatus")) $("pkgEditStatus").value = pkg.status || "";
  if ($("pkgEditStore")) $("pkgEditStore").value = pkg.store || "";
  if ($("pkgEditApproved")) $("pkgEditApproved").value = (pkg.approved ? "true" : "false");
  if ($("pkgEditNotes")) $("pkgEditNotes").value = pkg.notes || "";
  if ($("pkgEditMsg")) $("pkgEditMsg").textContent = "";
}

async function savePackageEdits() {
  const msg = $("pkgEditMsg");
  if (msg) msg.textContent = "Saving...";

  const id = $("pkgEditId")?.value;
  if (!id) {
    if (msg) msg.textContent = "Select a package first.";
    return;
  }

  const patch = {
    tracking: ($("pkgEditTracking")?.value || "").trim(),
    status: ($("pkgEditStatus")?.value || "").trim(),
    store: ($("pkgEditStore")?.value || "").trim() || null,
    approved: ($("pkgEditApproved")?.value === "true"),
    notes: ($("pkgEditNotes")?.value || "").trim() || null,
  };

  const { error } = await supabase.from("packages").update(patch).eq("id", id);
  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  // Optional uploads (photo/invoice) if bucket exists
  const photoFile = $("pkgPhotoFile")?.files?.[0] || null;
  const invoiceFile = $("pkgInvoiceFile")?.files?.[0] || null;

  if (photoFile) await uploadPackageFile(id, photoFile, PKG_PHOTO_BUCKET, "photo", msg);
  if (invoiceFile) await uploadPackageFile(id, invoiceFile, INVOICE_BUCKET, "invoice", msg);

  if ($("pkgPhotoFile")) $("pkgPhotoFile").value = "";
  if ($("pkgInvoiceFile")) $("pkgInvoiceFile").value = "";

  if (msg) msg.textContent = "Saved.";
  await renderPackages();

  // Send status-change notifications immediately (DB triggers enqueue them).
  processNotificationQueueNow();
}

async function uploadPackageFile(pkgId, file, bucket, kind, msgEl) {
  try {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `packages/${pkgId}/${Date.now()}_${kind}_${safeName}`;
    const up = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
    if (up.error) {
      console.warn(`Upload ${kind} error:`, up.error);
      if (msgEl) msgEl.textContent = `Saved, but ${kind} upload failed: ${up.error.message}`;
    }
  } catch (e) {
    console.warn(`Upload ${kind} exception:`, e);
    if (msgEl) msgEl.textContent = `Saved, but ${kind} upload failed.`;
  }
}


// ========================
// CSV IMPORT (Freight list)
// Expected columns (header):
// customer_lookup,tracking,status,pickup,weight,cost,notes,store
// customer_lookup can be email OR customer_no (SNS-JMXXXX).
// ========================
function parseCsv(text) {
  var lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim().length; });
  if (!lines.length) return { header: [], rows: [] };
  var header = lines[0].split(",").map(function (h) { return h.trim(); });
  var rows = lines.slice(1).map(function (line) {
    var cols = line.split(","); // simple CSV (no quoted commas)
    var obj = {};
    header.forEach(function (h, i) { obj[h] = (cols[i] || "").trim(); });
    return obj;
  });
  return { header: header, rows: rows };
}

async function lookupUsersByCustomerLookup(lookups) {
  var map = {};
  var uniq = Array.from(new Set((lookups || []).filter(Boolean)));
  if (!uniq.length) return map;

  // Email matches
  var emailMatches = await supabase.from("profiles").select("id,email,full_name,customer_no").in("email", uniq);
  if (!emailMatches.error && emailMatches.data) {
    emailMatches.data.forEach(function (p) { if (p.email) map[p.email] = p; });
  }

  // Customer # matches
  var custMatches = await supabase.from("profiles").select("id,email,full_name,customer_no").in("customer_no", uniq);
  if (!custMatches.error && custMatches.data) {
    custMatches.data.forEach(function (p) { if (p.customer_no) map[p.customer_no] = p; });
  }

  return map;
}

async function importPackagesFromCsvFile(file) {
  var msg = $("csvUploadMsg");
  if (msg) msg.textContent = "Reading CSV...";
  var text = await file.text();
  var parsed = parseCsv(text);
  var rows = parsed.rows || [];
  if (!rows.length) { if (msg) msg.textContent = "CSV has no rows."; return; }

  var lookups = rows.map(function (r) { return r.customer_lookup; });
  var userMap = await lookupUsersByCustomerLookup(lookups);

  var toUpsert = [];
  var skipped = [];
  rows.forEach(function (r) {
    var lu = r.customer_lookup;
    var prof = userMap[lu];
    if (!prof || !prof.id) { skipped.push((lu || "missing") + " / " + (r.tracking || "missing tracking")); return; }

    var patch = {
      user_id: prof.id,
      tracking: r.tracking,
      status: r.status || "Received at warehouse",
      pickup: r.pickup || null,
      weight: r.weight ? Number(r.weight) : null,
      cost: r.cost ? Number(r.cost) : null,
      notes: r.notes || null,
      store: r.store || null,
      approved: false
    };
    toUpsert.push(patch);
  });

  if (!toUpsert.length) {
    if (msg) msg.textContent = "No valid rows to import. Check customer_lookup values.";
    return;
  }

  if (msg) msg.textContent = "Importing " + toUpsert.length + " packages...";
  var up = await supabase.from("packages").upsert(toUpsert, { onConflict: "user_id,tracking" });
  if (up.error) { if (msg) msg.textContent = up.error.message; return; }

  if (msg) msg.textContent = "Imported " + toUpsert.length + " packages." + (skipped.length ? (" Skipped: " + skipped.length) : "");
  await renderPackages();
}


// ========================
// MESSAGES
// ========================
function setupMessagesUI() {
  $("refreshMessages")?.addEventListener("click", () => renderConversations());
  $("msgSearch")?.addEventListener("input", () => renderConversations());
  $("msgFilter")?.addEventListener("change", () => renderConversations());

  $("adminChatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("adminChatInput");
    const text = (input?.value || "").trim();
    if (!text) return;
    if (input) input.value = "";
    await sendStaffMessage(text);
  });

  $("markResolvedBtn")?.addEventListener("click", async () => {
    if (!currentCustomer) return;
    await markConversationResolved(currentCustomer.id);
  });
}

async function renderConversations() {
  setupMessagesUI();

  const list = $("convoList");
  if (!list) return;

  const q = ($("msgSearch")?.value || "").trim().toLowerCase();
  const filter = ($("msgFilter")?.value || "").trim();

  // Fetch recent messages and group in JS (simple + reliable)
  const { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved")
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    list.innerHTML = `<div class="muted">${escapeHTML(error.message)}</div>`;
    return;
  }

  const grouped = new Map();
  for (const m of data || []) {
    if (!grouped.has(m.user_id)) grouped.set(m.user_id, m);
  }

  let convos = Array.from(grouped.values());

  if (filter === "open") convos = convos.filter((m) => !m.resolved);
  if (filter === "resolved") convos = convos.filter((m) => !!m.resolved);

  if (q) {
    convos = convos.filter((m) => (m.body || "").toLowerCase().includes(q));
  }

  if (!convos.length) {
    list.innerHTML = `<div class="muted">No conversations.</div>`;
    return;
  }

  // Show list
  list.innerHTML = convos
    .map(
      (m) => `
    <button class="convo ${m.user_id === currentCustomer?.id ? "active" : ""}" type="button" data-uid="${escapeHTML(
        m.user_id
      )}">
      <div class="row">
        <strong>${escapeHTML(m.user_id)}</strong>
        ${m.resolved ? `<span class="tag">Resolved</span>` : `<span class="tag">Open</span>`}
      </div>
      <div class="muted small">${escapeHTML((m.body || "").slice(0, 70))}</div>
      <div class="muted small">${new Date(m.created_at).toLocaleString()}</div>
    </button>
  `
    )
    .join("");

  list.querySelectorAll("button[data-uid]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.getAttribute("data-uid");
      await selectConversationByCustomer(uid);
    });
  });
}

async function selectConversationByCustomer(userId) {
  if (!userId) return;

  // Load minimal profile for header
  const prof = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", userId)
    .maybeSingle();

  currentCustomer = prof.data
    ? { id: prof.data.id, email: prof.data.email, full_name: prof.data.full_name }
    : { id: userId, email: "", full_name: "" };

  if ($("convoTitle")) {
    $("convoTitle").textContent =
      currentCustomer.full_name || currentCustomer.email || `Customer ${currentCustomer.id}`;
  }

  await renderChat();
  await setupMessageRealtime(userId);
}

async function renderChat() {
  const body = $("adminChatBody");
  if (!body) return;

  if (!currentCustomer) {
    body.innerHTML = `<div class="muted small">Select a conversation.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at,resolved")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML =
    (data || [])
      .map(
        (m) => `
      <div class="bubble ${m.sender !== "customer" ? "me" : ""}">
        <div>${escapeHTML(m.body)}</div>
        <div class="meta">
          <span>${escapeHTML(m.sender)}</span>
          <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    `
      )
      .join("") || `<div class="muted small">No messages yet.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function sendStaffMessage(text) {
  const msg = $("adminChatMsg");
  if (msg) msg.textContent = "Sending...";

  if (!currentCustomer) {
    if (msg) msg.textContent = "Select a conversation first.";
    return;
  }

  const trySend = async (sender) => {
    return await supabase.from("messages").insert({
      user_id: currentCustomer.id,
      sender,
      body: text,
      resolved: false,
    });
  };

  let res = await trySend("staff");
  if (res.error) res = await trySend("admin");
  if (res.error) res = await trySend("support");

  if (res.error) {
    if (msg) msg.textContent = res.error.message;
    return;
  }

  if (msg) msg.textContent = "";
  await renderChat();
  setTimeout(() => renderChat(), 800); // helps if realtime is off/slow
  await renderConversations();
}

async function markConversationResolved(userId) {
  const msg = $("adminChatMsg");
  if (msg) msg.textContent = "Marking resolved...";

  const { error } = await supabase
    .from("messages")
    .update({ resolved: true })
    .eq("user_id", userId);

  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  if (msg) msg.textContent = "Resolved.";
  await renderConversations();
  await renderChat();
}

// Realtime subscription for new messages (if enabled on Supabase)
function teardownMessageRealtime() {
  if (msgChannel) {
    supabase.removeChannel(msgChannel);
    msgChannel = null;
  }
}

async function setupMessageRealtime(userId) {
  teardownMessageRealtime();

  msgChannel = supabase
    .channel(`admin_messages_${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${userId}` },
      async () => {
        await renderChat();
        await renderConversations();
      }
    )
    .subscribe();
}

// ========================
// ROLES TAB (admin-only action)
// ========================
function setupRolesUI() {
  $("roleForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("roleMsg");
    if (msg) msg.textContent = "Saving...";

    if (!currentAdmin || currentAdmin.role !== "admin") {
      if (msg) msg.textContent = "Only admins can change roles.";
      return;
    }

    const email = ($("roleEmail")?.value || "").trim().toLowerCase();
    const role = ($("roleValue")?.value || "").trim();

    const { error } = await supabase.from("profiles").update({ role }).eq("email", email);
    if (error) {
      if (msg) msg.textContent = error.message;
      return;
    }

    if (msg) msg.textContent = "Role updated.";
  });
}

// ========================
// EXPORT PACKAGES CSV
// ========================
async function exportPackagesCSV() {
  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,store,approved,notes,user_id,updated_at")
    .order("updated_at", { ascending: false })
    .limit(2000);

  if (error) {
    alert(error.message);
    return;
  }

  const rows = data || [];
  const header = ["tracking", "status", "store", "approved", "notes", "user_id", "updated_at"];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      header
        .map((k) => {
          const v = r[k] ?? "";
          const s = String(v).replaceAll('"', '""');
          return `"${s}"`;
        })
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `packages_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ========================
// OPTIONAL: BULK CSV UPLOAD (only runs if DOM exists)
// Expected DOM ids (add these to admin.html if you want):
// bulkCsvFile, bulkCsvText, bulkUploadBtn, bulkTemplateBtn, bulkMsg
// ========================
function setupBulkUploadIfPresent() {
  const file = $("bulkCsvFile");
  const text = $("bulkCsvText");
  const uploadBtn = $("bulkUploadBtn");
  const tplBtn = $("bulkTemplateBtn");
  const msg = $("bulkMsg");

  if (!uploadBtn) return; // feature not on this admin.html yet

  const template = `tracking,customer_email,status,store,approved,notes
1Z999AA10123456784,customer@example.com,RECEIVED,Amazon,true,Fragile
`;

  tplBtn?.addEventListener("click", () => {
    const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bulk_packages_template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  uploadBtn.addEventListener("click", async () => {
    if (msg) msg.textContent = "Reading CSV...";

    let csv = (text?.value || "").trim();
    if (!csv && file?.files?.[0]) {
      csv = await file.files[0].text();
    }

    if (!csv) {
      if (msg) msg.textContent = "Paste CSV or choose a file.";
      return;
    }

    try {
      const rows = parseCsv(csv);
      if (!rows.length) throw new Error("No rows found.");

      if (msg) msg.textContent = `Uploading ${rows.length}...`;

      // Map emails -> ids
      const emails = Array.from(
        new Set(rows.map((r) => (r.customer_email || "").trim().toLowerCase()).filter(Boolean))
      );

      let emailToId = new Map();
      if (emails.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,email")
          .in("email", emails);

        for (const p of profs || []) emailToId.set((p.email || "").toLowerCase(), p.id);
      }

      // Build insert payload
      const payload = rows.map((r) => ({
        tracking: (r.tracking || "").trim(),
        status: (r.status || "RECEIVED").trim(),
        store: (r.store || "").trim() || null,
        approved: String(r.approved || "true").toLowerCase() !== "false",
        notes: (r.notes || "").trim() || null,
        user_id: emailToId.get((r.customer_email || "").trim().toLowerCase()) || null,
      })).filter((p) => p.tracking);

      // Upsert by tracking (requires unique index on tracking; if not, it’ll just insert)
      const { error } = await supabase.from("packages").upsert(payload, { onConflict: "tracking" });
      if (error) throw error;

      if (msg) msg.textContent = "Bulk upload complete.";
      if (file) file.value = "";
      if (text) text.value = "";
      await renderPackages();
    } catch (e) {
      console.error(e);
      if (msg) msg.textContent = e?.message || String(e);
    }
  });
}

function parseCsv(csvText) {
  // basic CSV parser supporting quoted values
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => (row[h] = cols[idx] ?? ""));
    out.push(row);
  }
  return out;
}

function splitCsvLine(line) {
  const res = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      res.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  res.push(cur);
  return res.map((s) => s.trim());
}

// ========================
// INIT
// ========================
async function init() {
  await sanitizeStaleTokenOnce();
  setupAuthUI();
  setupAuthSubOnce();
  setupRolesUI();
  setupBulkUploadIfPresent();
  await renderApp();
}

window.addEventListener("DOMContentLoaded", init);
