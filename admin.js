/* =========================================================
   Sueños Shipping — Staff Dashboard (admin.js) FIXED
   Fixes:
   - Package search/filter glitches (one-time listeners + debounce + stale response guard)
   - pkgEditApproved is <select> (was treated as checkbox)
   - Adds real dashboard analytics (counts by status)
   - Adds approve action + edit action in packages table
   - Keeps auth/session hardening from prior version
========================================================= */

// ========================
// CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

const INVOICE_BUCKET = "invoices";
const PKG_PHOTO_BUCKET = "package_photos";

// Status list used in analytics
const STATUS_LIST = ["RECEIVED", "IN_TRANSIT", "ARRIVED_JA", "READY_FOR_PICKUP", "PICKED_UP", "ON_HOLD"];

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

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function getProjectRef() {
  try {
    return new URL(SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return "";
  }
}

function clearSupabaseAuthToken() {
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

async function withTimeout(promise, ms = 12000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error("Request timed out.")), ms);
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
let currentAdmin = null;
let currentCustomer = null;
let msgChannel = null;

// prevent duplicate UI bindings
let __tabsBound = false;
let __overviewBound = false;
let __customersBound = false;
let __packagesBound = false;
let __messagesBound = false;
let __rolesBound = false;

// packages render sequence guard
let __pkgRenderSeq = 0;

// ========================
// TABS
// ========================
function setupTabsOnce() {
  if (__tabsBound) return;
  __tabsBound = true;

  const buttons = Array.from(document.querySelectorAll(".tab[data-tab]"));
  if (!buttons.length) return;

  function showTab(tabName) {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    const panels = ["overview", "customers", "packages", "messages", "reports", "roles"];
    panels.forEach((p) => {
      const el = $(`tab-${p}`);
      if (el) el.classList.toggle("hidden", p !== tabName);
    });

    if (tabName === "overview") renderOverview();
    if (tabName === "customers") renderCustomers();
    if (tabName === "packages") renderPackages();
    if (tabName === "messages") renderConversations();
  }

  buttons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab("overview");
}

// ========================
// LOGIN / LOGOUT
// ========================
function setupAuthUIOnce() {
  // safe to bind multiple times, but do once anyway
  if ($("logoutBtn")?.__bound) return;
  if ($("logoutBtn")) $("logoutBtn").__bound = true;

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
      const { session } = await safeGetSession();
      if (session?.user) {
        if (msg) msg.textContent = "";
        await renderApp();
        return;
      }

      let res = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 12000);
      if (res?.error) {
        await hardResetAuth("login retry");
        res = await withTimeout(supabase.auth.signInWithPassword({ email, password }), 12000);
      }

      if (res?.error) {
        if (msg) msg.textContent = res.error.message;
        return;
      }

      const check = await safeGetSession();
      if (!check.session) {
        if (msg) msg.textContent = "Signed in, but no session found. Clear site data for this domain.";
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
// APP RENDER
// ========================
async function renderApp() {
  const loginCard = $("adminLoginCard");
  const app = $("adminApp");
  const logoutBtn = $("logoutBtn");
  const who = $("whoami");

  const { user, error } = await safeGetUser();
  if (error) console.warn("Admin safeGetUser error:", error);

  const authed = !!user;
  loginCard?.classList.toggle("hidden", authed);
  app?.classList.toggle("hidden", !authed);
  logoutBtn?.classList.toggle("hidden", !authed);

  if (!authed) {
    currentAdmin = null;
    who && (who.textContent = "");
    teardownMessageRealtime();
    return;
  }

  const { profile, error: pErr } = await getMyProfile();
  if (pErr) console.warn("Profile read error:", pErr);

  const role = profile?.role || "customer";
  const active = profile?.is_active !== false;

  if (!active) {
    await hardResetAuth("inactive staff");
    who && (who.textContent = "");
    $("adminLoginMsg") && ($("adminLoginMsg").textContent = "Account deactivated.");
    return;
  }

  if (!isStaffRole(role)) {
    await hardResetAuth("not staff");
    who && (who.textContent = "");
    $("adminLoginMsg") &&
      ($("adminLoginMsg").textContent =
        "Not authorized (role must be staff/admin). Update your profile role in Supabase.");
    return;
  }

  currentAdmin = {
    id: profile?.id || user.id,
    email: profile?.email || user.email,
    full_name: profile?.full_name || user.email,
    role,
  };

  who && (who.textContent = `${currentAdmin.full_name} • ${currentAdmin.role}`);

  setupTabsOnce();
  setupOverviewButtonsOnce();
  setupCustomersUIOnce();
  setupPackagesUIOnce();
  setupMessagesUIOnce();
  setupRolesUIOnce();

  await renderOverview();
}

// Keep UI responsive on auth changes
let __authSub = null;
function setupAuthSubOnce() {
  if (__authSub) return;
  __authSub = supabase.auth.onAuthStateChange(() => renderApp());
}

// ========================
// OVERVIEW (analytics)
// ========================
function setupOverviewButtonsOnce() {
  if (__overviewBound) return;
  __overviewBound = true;

  $("goPackagesBtn")?.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="packages"]')?.click();
  });
  $("goMessagesBtn")?.addEventListener("click", () => {
    document.querySelector('.tab[data-tab="messages"]')?.click();
  });
  $("exportPackagesBtn")?.addEventListener("click", exportPackagesCSV);
}

async function countPackagesByStatus(status) {
  const { count, error } = await supabase
    .from("packages")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) return 0;
  return count || 0;
}

async function countAllPackages() {
  const { count, error } = await supabase.from("packages").select("id", { count: "exact", head: true });
  if (error) return 0;
  return count || 0;
}

async function countCustomers() {
  // Best-effort: count all profiles
  const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  if (error) return 0;
  return count || 0;
}

async function countOpenMessages() {
  // If you use resolved column:
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("resolved", false);

  if (error) return 0;
  return count || 0;
}

async function renderOverview() {
  const statsRow = $("statsRow");
  if (!statsRow) return;

  // Real analytics
  const [allPkgs, customers, openMsgs, ...statusCounts] = await Promise.all([
    countAllPackages(),
    countCustomers(),
    countOpenMessages(),
    ...STATUS_LIST.map((s) => countPackagesByStatus(s)),
  ]);

  const statCards = [
    { label: "Total packages", value: allPkgs },
    { label: "Customers", value: customers },
    { label: "Open messages", value: openMsgs },
    { label: "In Transit", value: statusCounts[STATUS_LIST.indexOf("IN_TRANSIT")] || 0 },
    { label: "Ready for pickup", value: statusCounts[STATUS_LIST.indexOf("READY_FOR_PICKUP")] || 0 },
    { label: "Picked up", value: statusCounts[STATUS_LIST.indexOf("PICKED_UP")] || 0 },
  ];

  statsRow.innerHTML = statCards
    .map(
      (s) => `
      <div class="stat">
        <div class="stat__value">${escapeHTML(s.value)}</div>
        <div class="stat__label">${escapeHTML(s.label)}</div>
      </div>
    `
    )
    .join("");

  // Recent lists (match admin.html uses <ul>)
  const [pkgRes, msgRes] = await Promise.all([
    supabase.from("packages").select("tracking,status,updated_at").order("updated_at", { ascending: false }).limit(8),
    supabase.from("messages").select("sender,body,created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  const recentPackages = $("recentPackages");
  if (recentPackages) {
    recentPackages.innerHTML =
      (pkgRes.data || [])
        .map(
          (p) => `
        <li class="rowline">
          <strong>${escapeHTML(p.tracking)}</strong>
          <span class="tag">${escapeHTML(p.status)}</span>
          <span class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ""}</span>
        </li>
      `
        )
        .join("") || `<li class="muted">No recent packages.</li>`;
  }

  const recentMessages = $("recentMessages");
  if (recentMessages) {
    recentMessages.innerHTML =
      (msgRes.data || [])
        .map(
          (m) => `
        <li class="rowline">
          <span class="tag">${escapeHTML(m.sender)}</span>
          <span>${escapeHTML((m.body || "").slice(0, 70))}</span>
          <span class="muted small">${m.created_at ? new Date(m.created_at).toLocaleString() : ""}</span>
        </li>
      `
        )
        .join("") || `<li class="muted">No recent messages.</li>`;
  }
}

// ========================
// CUSTOMERS
// ========================
function setupCustomersUIOnce() {
  if (__customersBound) return;
  __customersBound = true;

  const run = debounce(() => renderCustomers(), 250);
  $("custSearch")?.addEventListener("input", run);
  $("refreshCustomers")?.addEventListener("click", () => renderCustomers());
}

async function renderCustomers() {
  const body = $("customersBody");
  if (!body) return;

  const q = ($("custSearch")?.value || "").trim().toLowerCase();

  // Try selecting phone, but fall back if your schema doesn't have it.
  let { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,role,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error && /column .*phone/i.test(error.message || "")) {
    const fallback = await supabase
      .from("profiles")
      .select("id,email,full_name,role,is_active,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    data = fallback.data;
    error = fallback.error;
  }

  if (q && data) {
    data = data.filter((x) => {
      const e = (x.email || "").toLowerCase();
      const n = (x.full_name || "").toLowerCase();
      const p = (x.phone || "").toLowerCase();
      return e.includes(q) || n.includes(q) || p.includes(q);
    });
  }

  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted">No customers found.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map((c) => {
      const isActive = c.is_active !== false;
      return `
      <tr data-id="${escapeHTML(c.id)}" class="clickrow">
        <td><strong>${escapeHTML(c.full_name || "—")}</strong></td>
        <td>${escapeHTML(c.email || "—")}</td>
        <td>${escapeHTML(c.phone || "—")}</td>
        <td><span class="tag">${escapeHTML(c.role || "customer")}</span></td>
        <td class="muted small">${isActive ? "Active" : "Inactive"}</td>
        <td>
          <button class="btn btn--ghost btn-sm" data-action="view" data-id="${escapeHTML(c.id)}" type="button">View</button>
        </td>
      </tr>`;
    })
    .join("");

  // event delegation
  if (!body.__delegated) {
    body.__delegated = true;
    body.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (!id) return;

      currentCustomer = data.find((x) => x.id === id) || null;
      await renderCustomerDetail();
    });
  }
}

async function renderCustomerDetail() {
  const card = $("customerDetail");
  if (!card) return;

  if (!currentCustomer) {
    card.innerHTML = `<div class="muted">No customer selected.</div>`;
    return;
  }

  const { data: pkgs, error } = await supabase
    .from("packages")
    .select("tracking,status,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    card.innerHTML = `<div class="muted">${escapeHTML(error.message)}</div>`;
    return;
  }

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
            <span class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ""}</span>
          </div>`
          )
          .join("") || `<div class="muted">No packages assigned.</div>`
      }
    </div>
  `;
}

// ========================
// PACKAGES
// ========================
function setupPackagesUIOnce() {
  if (__packagesBound) return;
  __packagesBound = true;

  const run = debounce(() => renderPackages(), 250);

  $("pkgSearch")?.addEventListener("input", run);
  $("statusFilter")?.addEventListener("change", () => renderPackages());
  $("refreshPackages")?.addEventListener("click", () => renderPackages());

  $("pkgEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await savePackageEdits();
  });

  // table action delegation
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
        // load the row data quickly by selecting it
        const { data, error } = await supabase
          .from("packages")
          .select("id,tracking,status,store,approved,notes,user_id,updated_at")
          .eq("id", id)
          .maybeSingle();

        if (error || !data) {
          $("pkgMsg") && ($("pkgMsg").textContent = error?.message || "Could not load package.");
          return;
        }
        fillPackageEditor(data);
      }

      if (action === "approve") {
        await approvePackage(id);
      }
    });
  }
}

async function renderPackages() {
  const body = $("packagesBody");
  if (!body) return;

  const seq = ++__pkgRenderSeq;

  const q = ($("pkgSearch")?.value || "").trim();
  const status = ($("statusFilter")?.value || "").trim();

  let query = supabase
    .from("packages")
    .select("id,tracking,status,approved,user_id,store,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (q) query = query.or(`tracking.ilike.%${q}%,store.ilike.%${q}%`);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  // Ignore stale responses (prevents “glitch/race”)
  if (seq !== __pkgRenderSeq) return;

  if (error) {
    body.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No packages.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map((p) => {
      const approved = !!p.approved;
      return `
      <tr>
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status)}</span></td>
        <td>${approved ? `<span class="tag">Yes</span>` : `<span class="tag">No</span>`}</td>
        <td class="muted small">${escapeHTML(p.user_id || "Unassigned")}</td>
        <td>${escapeHTML(p.store || "—")}</td>
        <td class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</td>
        <td class="row">
          <button class="btn btn--ghost btn-sm" type="button" data-action="edit" data-id="${escapeHTML(p.id)}">Edit</button>
          ${
            approved
              ? ""
              : `<button class="btn btn--ghost btn-sm" type="button" data-action="approve" data-id="${escapeHTML(
                  p.id
                )}">Approve</button>`
          }
        </td>
      </tr>`;
    })
    .join("");
}

function fillPackageEditor(pkg) {
  $("pkgEditId") && ($("pkgEditId").value = pkg.id || "");
  $("pkgEditTracking") && ($("pkgEditTracking").value = pkg.tracking || "");
  $("pkgEditStatus") && ($("pkgEditStatus").value = pkg.status || "");
  $("pkgEditStore") && ($("pkgEditStore").value = pkg.store || "");
  $("pkgEditNotes") && ($("pkgEditNotes").value = pkg.notes || "");

  // IMPORTANT: pkgEditApproved is a <select> (true/false)
  if ($("pkgEditApproved")) {
    $("pkgEditApproved").value = pkg.approved ? "true" : "false";
  }

  $("pkgEditMsg") && ($("pkgEditMsg").textContent = "");
}

async function approvePackage(id) {
  const msg = $("pkgMsg");
  if (msg) msg.textContent = "Approving...";

  const { error } = await supabase.from("packages").update({ approved: true }).eq("id", id);
  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  if (msg) msg.textContent = "Approved.";
  await renderPackages();
}

async function savePackageEdits() {
  const msg = $("pkgEditMsg");
  if (msg) msg.textContent = "Saving...";

  const id = $("pkgEditId")?.value;
  if (!id) {
    if (msg) msg.textContent = "Select a package first.";
    return;
  }

  const approvedStr = ($("pkgEditApproved")?.value || "false").trim();
  const approved = approvedStr === "true";

  const patch = {
    tracking: ($("pkgEditTracking")?.value || "").trim(),
    status: ($("pkgEditStatus")?.value || "").trim(),
    store: ($("pkgEditStore")?.value || "").trim() || null,
    approved,
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
  await renderOverview(); // keep analytics updated
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
// MESSAGES
// ========================
function setupMessagesUIOnce() {
  if (__messagesBound) return;
  __messagesBound = true;

  const run = debounce(() => renderConversations(), 250);
  $("refreshMessages")?.addEventListener("click", () => renderConversations());
  $("msgSearch")?.addEventListener("input", run);
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
  const list = $("convoList");
  if (!list) return;

  const q = ($("msgSearch")?.value || "").trim().toLowerCase();
  const filter = ($("msgFilter")?.value || "open").trim();

  const { data, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved")
    .order("created_at", { ascending: false })
    .limit(400);

  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }

  const grouped = new Map();
  for (const m of data || []) if (!grouped.has(m.user_id)) grouped.set(m.user_id, m);

  let convos = Array.from(grouped.values());

  if (filter === "open") convos = convos.filter((m) => !m.resolved);
  if (q) convos = convos.filter((m) => (m.body || "").toLowerCase().includes(q));

  if (!convos.length) {
    list.innerHTML = `<li class="muted">No conversations.</li>`;
    return;
  }

  list.innerHTML = convos
    .map(
      (m) => `
    <li>
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
    </li>
  `
    )
    .join("");

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

  const prof = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", userId)
    .maybeSingle();

  currentCustomer = prof.data
    ? { id: prof.data.id, email: prof.data.email, full_name: prof.data.full_name }
    : { id: userId, email: "", full_name: "" };

  $("convoTitle") &&
    ($("convoTitle").textContent =
      currentCustomer.full_name || currentCustomer.email || `Customer ${currentCustomer.id}`);

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
      </div>`
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

  const trySend = async (sender) =>
    supabase.from("messages").insert({
      user_id: currentCustomer.id,
      sender,
      body: text,
      resolved: false,
    });

  let res = await trySend("staff");
  if (res.error) res = await trySend("admin");
  if (res.error) res = await trySend("support");

  if (res.error) {
    if (msg) msg.textContent = res.error.message;
    return;
  }

  if (msg) msg.textContent = "";
  await renderChat();
  setTimeout(() => renderChat(), 800);
  await renderConversations();
  await renderOverview();
}

async function markConversationResolved(userId) {
  const msg = $("adminChatMsg");
  if (msg) msg.textContent = "Marking resolved...";

  const { error } = await supabase.from("messages").update({ resolved: true }).eq("user_id", userId);

  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  if (msg) msg.textContent = "Resolved.";
  await renderConversations();
  await renderChat();
  await renderOverview();
}

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
        await renderOverview();
      }
    )
    .subscribe();
}

// ========================
// ROLES
// ========================
function setupRolesUIOnce() {
  if (__rolesBound) return;
  __rolesBound = true;

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
    await renderCustomers();
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
// INIT
// ========================
async function init() {
  await sanitizeStaleTokenOnce();
  setupAuthUIOnce();
  setupAuthSubOnce();
  await renderApp();
}

window.addEventListener("DOMContentLoaded", init);
