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

function firstNameFromFullName(full_name, email="") {
  const n = (full_name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const local = (email || "").split("@")[0] || "Customer";
  // Title-case first segment
  return local.split(/[._-]+/)[0].replace(/^./, c => c.toUpperCase());
}

function customerLabel(profile, fallbackUserId="") {
  const email = profile?.email || "";
  const acct = (profile?.customer_no || "").trim();
  const first = firstNameFromFullName(profile?.full_name, email);
  // Format: FirstName — email — SNS-JMXXXX
  if (email && acct) return `${first} — ${email} — ${acct}`;
  if (email) return `${first} — ${email}`;
  if (acct) return `${first || "Customer"} — ${acct}`;
  return first || fallbackUserId || "Customer";
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

// One-time UI bindings + render guards
let __pkgUiBound = false;
let __pkgRenderSeq = 0;
let __invUiBound = false;
let __invRenderSeq = 0;


// ========================
// TABS
// ========================
function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab[data-tab]"));
  if (!buttons.length) return;

  function showTab(tabName) {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));

    const panels = ["overview", "customers", "packages", "invoices", "messages", "reports", "roles"];
    panels.forEach((p) => {
      const el = $(`tab-${p}`);
      if (el) el.classList.toggle("hidden", p !== tabName);
    });

    // Lazy refresh on tab switch
    if (tabName === "overview") renderOverview();
    if (tabName === "customers") renderCustomers();
    if (tabName === "packages") renderPackages();
    if (tabName === "invoices") renderInvoices();
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
    await hardResetAuth("not staff");
    if (who) who.textContent = "";
    if ($("adminLoginMsg")) $("adminLoginMsg").textContent =
      "Not authorized (role must be staff/admin). Ask admin to update your profile role.";
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
    .select("id,email,full_name,customer_no,role,is_active,created_at")
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
      <td><div><strong>${escapeHTML(c.full_name || "—")}</strong></div><div class="muted small">${escapeHTML(c.customer_no || "")}</div></td>
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
      <p class="muted small"><strong>Account #:</strong> ${escapeHTML(currentCustomer.customer_no || "—")}</p>
      <div class="card mini">
        <div class="muted small"><strong>US Warehouse Shipping Address</strong></div>
        <div>${escapeHTML((currentCustomer.full_name || "Customer") + ", " + (currentCustomer.customer_no || ""))}</div>
        <div>${escapeHTML(WAREHOUSE_ADDRESS)}</div>
      </div>
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
  if (__pkgUiBound) return;
  __pkgUiBound = true;

  const run = debounce(() => renderPackages(), 250);

  $("pkgSearch")?.addEventListener("input", run);
  $("statusFilter")?.addEventListener("change", () => renderPackages());
  $("refreshPackages")?.addEventListener("click", () => renderPackages());

  $("pkgEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await savePackageEdits();
  });

  // Row actions (edit)
  const body = $("packagesBody");
  if (body && !body.__delegated) {
    body.__delegated = true;
    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (!id || !action) return;

      if (action === "edit") {
        const { data, error } = await supabase
          .from("packages")
          .select("id,tracking,status,store,notes,user_id,updated_at, profiles!packages_user_id_fkey(email,full_name,customer_no)")
          .eq("id", id)
          .maybeSingle();

        if (error || !data) {
          $("pkgMsg") && ($("pkgMsg").textContent = error?.message || "Could not load package.");
          return;
        }
        fillPackageEditor(data);
      }
    });
  }
}

async function renderPackages() {
  setupPackagesUI();

  const body = $("packagesBody");
  if (!body) return;

  const seq = ++__pkgRenderSeq;

  const q = ($("pkgSearch")?.value || "").trim().toLowerCase();
  const status = ($("statusFilter")?.value || "").trim();

  let query = supabase
    .from("packages")
    .select("id,tracking,status,store,notes,user_id,updated_at, profiles!packages_user_id_fkey(email,full_name,customer_no)")
    .order("updated_at", { ascending: false })
    .limit(200);

  // Server-side filtering where possible
  if (q) {
    // tracking/store server-side
    query = query.or(`tracking.ilike.%${q}%,store.ilike.%${q}%`);
  }
  if (status) query = query.eq("status", status);

  let { data, error } = await query;

  // Ignore stale responses (prevents “glitching” while typing)
  if (seq !== __pkgRenderSeq) return;

  // If join fails (missing FK), fall back without join and map emails
  if (error && /profiles/i.test(error.message || "")) {
    const fallback = await supabase
      .from("packages")
      .select("id,tracking,status,store,notes,user_id,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);

    data = fallback.data;
    error = fallback.error;

    if (!error && data?.length) {
      const ids = [...new Set(data.map((p) => p.user_id).filter(Boolean))];
      if (ids.length) {
        const prof = await supabase.from("profiles").select("id,email,full_name,customer_no").in("id", ids);
        const map = new Map((prof.data || []).map((r) => [r.id, r]));
        data = data.map((p) => ({ ...p, profiles: map.get(p.user_id) || null }));
      }
    }
  }

  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  let rows = data || [];

  // Client-side email filtering (since email comes from joined profile)
  if (q) {
    rows = rows.filter((p) => {
      const email = (p.profiles?.email || "").toLowerCase();
      const name = (p.profiles?.full_name || "").toLowerCase();
      const tracking = (p.tracking || "").toLowerCase();
      const store = (p.store || "").toLowerCase();
      return tracking.includes(q) || store.includes(q) || email.includes(q) || name.includes(q);
    });
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No packages.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (p) => `
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(customerLabel(p.profiles, p.user_id))}</td>
      <td>${escapeHTML(p.store || "—")}</td>
      <td class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
      <td>
        <button class="btn btn--ghost btn-sm" type="button" data-action="edit" data-id="${escapeHTML(p.id)}">Edit</button>
      </td>
    </tr>
  `
    )
    .join("");
}

function fillPackageEditor(pkg) {
  $("pkgEditId") && ($("pkgEditId").value = pkg.id || "");
  $("pkgEditTracking") && ($("pkgEditTracking").value = pkg.tracking || "");
  $("pkgEditStatus") && ($("pkgEditStatus").value = pkg.status || "");
  $("pkgEditStore") && ($("pkgEditStore").value = pkg.store || "");
  $("pkgEditNotes") && ($("pkgEditNotes").value = pkg.notes || "");
  $("pkgEditMsg") && ($("pkgEditMsg").textContent = "");
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
    notes: ($("pkgEditNotes")?.value || "").trim() || null,
  };

  const { error } = await supabase.from("packages").update(patch).eq("id", id);
  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  // Optional uploads
  const photoFile = $("pkgPhotoFile")?.files?.[0] || null;
  const invoiceFile = $("pkgInvoiceFile")?.files?.[0] || null;

  if (photoFile) await uploadPackageFile(id, photoFile, PKG_PHOTO_BUCKET, "photo", msg);
  if (invoiceFile) await uploadPackageFile(id, invoiceFile, INVOICE_BUCKET, "invoice", msg);

  if ($("pkgPhotoFile")) $("pkgPhotoFile").value = "";
  if ($("pkgInvoiceFile")) $("pkgInvoiceFile").value = "";

  if (msg) msg.textContent = "Saved.";
  await renderPackages();
  await renderOverview();
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
// INVOICES (approval)
// ========================
function setupInvoicesUI() {
  if (__invUiBound) return;
  __invUiBound = true;

  const run = debounce(() => renderInvoices(), 250);

  $("invSearch")?.addEventListener("input", run);
  $("invFilter")?.addEventListener("change", () => renderInvoices());
  $("refreshInvoices")?.addEventListener("click", () => renderInvoices());

  const body = $("invoicesBody");
  if (body && !body.__delegated) {
    body.__delegated = true;
    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      const tr = e.target.closest("tr[data-id]");
      const id = btn?.getAttribute("data-id") || tr?.getAttribute("data-id");
      if (!id) return;

      // Row click = preview
      if (!btn && tr) {
        const path = tr.getAttribute("data-path") || "";
        if (path) openInvoicePreview(path);
        return;
      }

      const action = btn.getAttribute("data-action");
      if (action === "approve") await setInvoiceApproval(id, true);
      if (action === "reject") await setInvoiceApproval(id, false);
      if (action === "open") {
        const path = btn.getAttribute("data-path") || "";
        if (path) openInvoicePreview(path);
      }
    });
  }
}

async function renderInvoices() {
  setupInvoicesUI();

  const body = $("invoicesBody");
  if (!body) return;

  const seq = ++__invRenderSeq;

  const q = ($("invSearch")?.value || "").trim().toLowerCase();
  const filter = ($("invFilter")?.value || "pending").trim();

  let query = supabase
    .from("invoices")
    .select("id,tracking,file_name,file_path,file_type,pickup,created_at,approved,user_id, profiles!invoices_user_id_fkey(email,full_name,customer_no)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "pending") query = query.eq("approved", false);
  if (filter === "approved") query = query.eq("approved", true);

  let { data, error } = await query;

  if (seq !== __invRenderSeq) return;

  // Fallback if join fails
  if (error && /profiles/i.test(error.message || "")) {
    const fallback = await supabase
      .from("invoices")
      .select("id,tracking,file_name,file_path,file_type,pickup,created_at,approved,user_id")
      .order("created_at", { ascending: false })
      .limit(200);

    data = fallback.data;
    error = fallback.error;

    if (!error && data?.length) {
      const ids = [...new Set(data.map((i) => i.user_id).filter(Boolean))];
      if (ids.length) {
        const prof = await supabase.from("profiles").select("id,email,full_name,customer_no").in("id", ids);
        const map = new Map((prof.data || []).map((r) => [r.id, r]));
        data = data.map((i) => ({ ...i, profiles: map.get(i.user_id) || null }));
      }
    }
  }

  if (error) {
    body.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  let rows = data || [];

  if (q) {
    rows = rows.filter((i) => {
      const tracking = (i.tracking || "").toLowerCase();
      const email = (i.profiles?.email || "").toLowerCase();
      const name = (i.profiles?.full_name || "").toLowerCase();
      const file = (i.file_name || "").toLowerCase();
      return tracking.includes(q) || email.includes(q) || name.includes(q) || file.includes(q);
    });
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No invoices.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((i) => {
      const cust = customerLabel(i.profiles, i.user_id);
      const status = i.approved ? "Approved" : "Pending";
      return `
        <tr data-id="${escapeHTML(i.id)}" data-path="${escapeHTML(i.file_path || "")}">
          <td><strong>${escapeHTML(i.tracking)}</strong></td>
          <td>${escapeHTML(cust)}</td>
          <td>${escapeHTML(i.file_name || "file")}</td>
          <td>${escapeHTML(i.pickup || "—")}</td>
          <td><span class="tag">${escapeHTML(status)}</span></td>
          <td class="muted small">${i.created_at ? new Date(i.created_at).toLocaleString() : "—"}</td>
          <td class="row">
            <button class="btn btn--ghost btn-sm" type="button" data-action="open" data-id="${escapeHTML(i.id)}" data-path="${escapeHTML(i.file_path || "")}">Open</button>
            ${
              i.approved
                ? ""
                : `<button class="btn btn--ghost btn-sm" type="button" data-action="approve" data-id="${escapeHTML(i.id)}">Approve</button>`
            }
            <button class="btn btn--ghost btn-sm" type="button" data-action="reject" data-id="${escapeHTML(i.id)}">Reject</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function setInvoiceApproval(invoiceId, approved) {
  const msg = $("invMsg");
  if (msg) msg.textContent = approved ? "Approving..." : "Rejecting...";

  const patch = {
    approved,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? (currentAdmin?.id || null) : null,
  };

  const { error } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  if (msg) msg.textContent = approved ? "Approved." : "Rejected.";
  await renderInvoices();
  await renderOverview();
}

async function openInvoicePreview(filePath) {
  const el = $("invoicePreview");
  if (!el) return;

  if (!filePath) {
    el.textContent = "No invoice selected.";
    return;
  }

  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).createSignedUrl(filePath, 60 * 10);
  if (error || !data?.signedUrl) {
    el.innerHTML = `<div class="muted">Could not open invoice: ${escapeHTML(error?.message || "Unknown error")}</div>`;
    return;
  }

  el.innerHTML = `<a class="btn btn--ghost" href="${data.signedUrl}" target="_blank" rel="noopener">Open invoice in new tab</a>
                  <div class="muted small" style="margin-top:8px;">Link expires in 10 minutes.</div>`;
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
  let { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved, profiles!messages_user_id_fkey(email,full_name,customer_no)")
    .order("created_at", { ascending: false })
    .limit(400);

  // Fallback if join fails
  if (error && /profiles/i.test(error.message || "")) {
    const fallback = await supabase
      .from("messages")
      .select("id,user_id,sender,body,created_at,resolved")
      .order("created_at", { ascending: false })
      .limit(400);

    data = fallback.data;
    error = fallback.error;

    if (!error && data?.length) {
      const ids = [...new Set(data.map((m) => m.user_id).filter(Boolean))];
      if (ids.length) {
        const prof = await supabase.from("profiles").select("id,email,full_name,customer_no").in("id", ids);
        const map = new Map((prof.data || []).map((r) => [r.id, r]));
        data = data.map((m) => ({ ...m, profiles: map.get(m.user_id) || null }));
      }
    }
  }

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
    convos = convos.filter((m) => {
      const bodyTxt = (m.body || "").toLowerCase();
      const email = (m.profiles?.email || "").toLowerCase();
      const name = (m.profiles?.full_name || "").toLowerCase();
      const acct = (m.profiles?.customer_no || "").toLowerCase();
      return bodyTxt.includes(q) || email.includes(q) || name.includes(q) || acct.includes(q);
    });
  }

  if (!convos.length) {
    list.innerHTML = `<div class="muted">No conversations.</div>`;
    return;
  }

  // Show list
  list.innerHTML = convos
    .map((m) => {
      const label = customerLabel(m.profiles, m.user_id);
      return `
        <button class="convo ${m.user_id === currentCustomer?.id ? "active" : ""}" type="button" data-uid="${escapeHTML(
          m.user_id
        )}">
          <div class="row between">
            <div><strong>${escapeHTML(label)}</strong></div>
            <div>${m.resolved ? `<span class="tag">Resolved</span>` : `<span class="tag">Open</span>`}</div>
          </div>
          <div class="muted small">${escapeHTML((m.body || "").slice(0, 70))}</div>
          <div class="muted small">${new Date(m.created_at).toLocaleString()}</div>
        </button>
      `;
    })
    .join("");

  // click handlers (delegate)
  if (!list.__delegated) {
    list.__delegated = true;
    list.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-uid]");
      if (!btn) return;
      const uid = btn.getAttribute("data-uid");
      await selectConversationByCustomer(uid);
    });
  }
}


async function selectConversationByCustomer(userId) {
  if (!userId) return;

  // Load minimal profile for header
  const prof = await supabase
    .from("profiles")
    .select("id,email,full_name,customer_no")
    .eq("id", userId)
    .maybeSingle();

  currentCustomer = prof.data
    ? { id: prof.data.id, email: prof.data.email, full_name: prof.data.full_name }
    : { id: userId, email: "", full_name: "" };

  if ($("convoTitle")) {
    $("convoTitle").textContent = customerLabel({ full_name: currentCustomer.full_name, email: currentCustomer.email }, currentCustomer.id);
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

  const template = `tracking,customer_email,status,store,notes
1Z999AA10123456784,customer@example.com,RECEIVED,Amazon,Fragile
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
