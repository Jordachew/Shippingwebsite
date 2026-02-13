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

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
// PROFILE BOOTSTRAP (ensure row exists)
// ========================
async function ensureProfileSafe(user) {
  try {
    if (!user?.id) return;
    const full_name = user.user_metadata?.full_name || user.user_metadata?.name || null;
    const phone = user.user_metadata?.phone || null;
    // Upsert minimal profile; role remains whatever is already set (default 'customer')
    await supabase.from("profiles").upsert(
      { id: user.id, email: user.email, full_name, phone },
      { onConflict: "id" }
    );
  } catch (e) {
    console.warn("ensureProfileSafe failed:", e);
  }
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
    if (tabName === "reports") renderReports();
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

  // Ensure profile row exists (prevents "can’t sign in" confusion)
  await ensureProfileSafe(user);

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

  // Pull recent + compute meaningful totals for the dashboard row
  const [pkgRecent, msgRecent, pkgAgg, openMsgs] = await Promise.all([
    supabase.from("packages").select("id,tracking,status,updated_at").order("updated_at", { ascending: false }).limit(8),
    supabase.from("messages").select("id,user_id,sender,body,created_at,resolved").order("created_at", { ascending: false }).limit(8),
    supabase
      .from("packages")
      .select("id,status,weight,cost,amount_due_jmd,amount_paid_jmd,is_paid", { count: "exact" })
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("resolved", false),
  ]);

  const totalPkgs = pkgAgg.count || 0;
  let totalDue = 0;
  let totalPaid = 0;
  let unpaidCount = 0;
  for (const p of pkgAgg.data || []) {
    const due = Number(p.amount_due_jmd ?? p.cost ?? 0) || 0;
    const paid = Number(p.amount_paid_jmd ?? 0) || 0;
    totalDue += due;
    totalPaid += paid;
    const isPaid = (p.is_paid === true) || (due > 0 && paid >= due);
    if (!isPaid) unpaidCount += 1;
  }

  const stats = [
    { label: "Total packages", value: totalPkgs },
    { label: "Unpaid packages", value: unpaidCount },
    { label: "Total due (JMD)", value: formatJMD(totalDue) },
    { label: "Open messages", value: openMsgs.count || 0 },
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

  const pkgRes = pkgRecent;
  const msgRes = msgRecent;
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
	    .select("id,email,full_name,phone,address,customer_no,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%,customer_no.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) {
	    body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
	    body.innerHTML = `<tr><td colspan="5" class="muted">No customers found.</td></tr>`;
    return;
  }

  const label = (c) => {
    const name = (c.full_name || c.email || "Customer").trim();
    const no = (c.customer_no || "").trim();
    return no ? `${name} — ${no}` : name;
  };

  body.innerHTML = data
    .map((c) => {
      const active = c.is_active === false ? "Inactive" : "Active";
      return `
        <tr data-id="${escapeHTML(c.id)}" class="clickrow">
          <td><strong>${escapeHTML(c.full_name || "—")}</strong><div class="muted small">${escapeHTML(c.customer_no || "")}</div></td>
          <td>${escapeHTML(c.email || "—")}</td>
          <td>${escapeHTML(c.phone || "—")}</td>
          <td class="muted small">${active}</td>
          <td><button class="btn btn--ghost btn--sm" type="button" data-edit="${escapeHTML(c.id)}">Edit</button></td>
        </tr>`;
    })
    .join("");

  const selectCustomer = async (id) => {
    const customer = data.find((x) => x.id === id);
    if (!customer) return;
    currentCustomer = {
      id: customer.id,
      email: customer.email,
      full_name: customer.full_name,
      customer_no: customer.customer_no,
      phone: customer.phone,
      address: customer.address,
      is_active: customer.is_active,
    };
    await renderCustomerDetail();
  };

  body.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await selectCustomer(btn.getAttribute("data-edit"));
      document.getElementById("customerEditForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", async () => {
      await selectCustomer(tr.getAttribute("data-id"));
    });
  });
}

async function renderCustomerDetail() {
  const detail = $("customerDetail");
  const form = $("customerEditForm");
  if (!detail) return;

  if (!currentCustomer) {
    if (form) form.classList.add("hidden");
    detail.classList.remove("hidden");
    detail.textContent = "No customer selected.";
    return;
  }

  // Fill edit form
  if (form) {
    form.classList.remove("hidden");
    $("custEditName").value = currentCustomer.full_name || "";
    $("custEditEmail").value = currentCustomer.email || "";
    $("custEditPhone").value = currentCustomer.phone || "";
    $("custEditNo").value = currentCustomer.customer_no || "";
    $("custEditAddress").value = currentCustomer.address || "";
    $("custEditActive").value = currentCustomer.is_active === false ? "false" : "true";
    const msg = $("custEditMsg");
    if (msg) msg.textContent = "";

    // bind once
    if (!form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = $("custEditMsg");
        if (msg) msg.textContent = "Saving...";
        if (!currentCustomer) return;
	        const patch = {
	          full_name: ($("custEditName")?.value || "").trim() || null,
	          phone: ($("custEditPhone")?.value || "").trim() || null,
	          address: ($("custEditAddress")?.value || "").trim() || null,
	          is_active: $("custEditActive")?.value === "true",
	        };
        const { error } = await supabase.from("profiles").update(patch).eq("id", currentCustomer.id);
        if (error) {
          if (msg) msg.textContent = error.message;
          return;
        }
        if (msg) msg.textContent = "Saved.";
        await renderCustomers();
      });
    }
  }

  // Show summary below form
  const name = (currentCustomer.full_name || currentCustomer.email || "Customer").trim();
  const no = (currentCustomer.customer_no || "").trim();
  const title = no ? `${name} — ${no}` : name;

  const { data: pkgs } = await supabase
    .from("packages")
    .select("id,tracking,status,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  detail.classList.remove("hidden");
  detail.innerHTML = `
    <div class="muted small">Selected</div>
    <div><strong>${escapeHTML(title)}</strong></div>
    <div class="muted small" style="margin-top:8px">Recent packages</div>
    <div class="stack">
      ${
        (pkgs || [])
          .map(
            (p) => `
            <div class="rowline">
              <strong>${escapeHTML(p.tracking)}</strong>
              <span class="tag">${escapeHTML(p.status)}</span>
              <span class="muted small">${new Date(p.updated_at).toLocaleString()}</span>
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
function setupPackagesUI() {
  $("pkgSearch")?.addEventListener("input", () => renderPackages());
  $("statusFilter")?.addEventListener("change", () => renderPackages());
  $("refreshPackages")?.addEventListener("click", () => renderPackages());

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
    .select("id,tracking,status,store,approved,notes,user_id,updated_at,pickup,weight,cost,amount_due_jmd,amount_paid_jmd,invoice_prepared,is_paid")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (q) query = query.ilike("tracking", `%${q}%`);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    body.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  // Populate status filter + edit status suggestions from existing values
  const statuses = Array.from(new Set((data || []).map(p => p.status).filter(Boolean))).sort();
  const filter = $("statusFilter");
  if (filter) {
    const current = filter.value || "";
    filter.innerHTML = `<option value="">All statuses</option>` + statuses.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");
    filter.value = current;
  }
  const editSel = $("pkgEditStatus");
  if (editSel) {
    const cur = editSel.value || "";
    editSel.innerHTML = statuses.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("") || `<option value="">—</option>`;
    if (cur) editSel.value = cur;
  }

  // Fetch customer display names (full_name + customer_no)
  const userIds = Array.from(new Set((data || []).map(p => p.user_id).filter(Boolean)));
  const idToLabel = new Map();
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id,full_name,customer_no,email").in("id", userIds);
    for (const p of profs || []) {
      const name = (p.full_name || p.email || "Customer").trim();
      const no = (p.customer_no || "").trim();
      idToLabel.set(p.id, no ? `${name} — ${no}` : name);
    }
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted">No packages.</td></tr>`;
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
      <td class="muted small">${escapeHTML(idToLabel.get(p.user_id) || "Unknown customer")}</td>
      <td class="muted small">${new Date(p.updated_at).toLocaleString()}</td>
      <td><button class="btn btn--ghost btn--sm" type="button" data-edit="${escapeHTML(p.id)}">Edit</button></td>
    </tr>
  `
    )
    .join("");

  const goEdit = (id) => {
    const pkg = data.find((x) => String(x.id) === String(id));
    if (!pkg) return;
    fillPackageEditor(pkg);
    document.getElementById("pkgEditForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  body.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      goEdit(btn.getAttribute("data-edit"));
    });
  });

  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", () => goEdit(tr.getAttribute("data-id")));
  });
}

function fillPackageEditor(pkg) {
  if ($("pkgEditId")) $("pkgEditId").value = pkg.id || "";
  if ($("pkgEditTracking")) $("pkgEditTracking").value = pkg.tracking || "";
  if ($("pkgEditStatus")) $("pkgEditStatus").value = pkg.status || "";
  if ($("pkgEditStore")) $("pkgEditStore").value = pkg.store || "";
  if ($("pkgEditApproved")) $("pkgEditApproved").value = (pkg.approved ? "true" : "false");
  if ($("pkgEditNotes")) $("pkgEditNotes").value = pkg.notes || "";
  if ($("pkgEditPickup")) $("pkgEditPickup").value = pkg.pickup || "";
  if ($("pkgEditWeight")) $("pkgEditWeight").value = pkg.weight ?? "";
  if ($("pkgEditCost")) $("pkgEditCost").value = pkg.cost ?? "";

  // Billing fields (best-effort; columns may not exist in older DB)
  if ($("pkgEditDue")) $("pkgEditDue").value = pkg.amount_due_jmd ?? "";
  if ($("pkgEditPaid")) $("pkgEditPaid").value = pkg.amount_paid_jmd ?? "";
  if ($("pkgEditInvoicePrepared")) $("pkgEditInvoicePrepared").value = pkg.invoice_prepared ? "true" : "false";
  if ($("pkgEditIsPaid")) $("pkgEditIsPaid").value = pkg.is_paid ? "true" : "false";

  if ($("pkgEditMsg")) $("pkgEditMsg").textContent = "";
  if ($("pkgBillMsg")) $("pkgBillMsg").textContent = "";
}


async function savePackageEdits() {
  const msg = $("pkgEditMsg");
  const billMsg = $("pkgBillMsg");
  if (msg) msg.textContent = "Saving...";
  if (billMsg) billMsg.textContent = "";

  const id = $("pkgEditId")?.value;
  if (!id) {
    if (msg) msg.textContent = "Select a package first.";
    return;
  }

  // Build patch (best-effort for optional columns)
  const patch = {
    tracking: ($("pkgEditTracking")?.value || "").trim(),
    status: ($("pkgEditStatus")?.value || "").trim(),
    store: ($("pkgEditStore")?.value || "").trim() || null,
    approved: ($("pkgEditApproved")?.value === "true"),
    notes: ($("pkgEditNotes")?.value || "").trim() || null,
    pickup: ($("pkgEditPickup")?.value || "").trim() || null,
    weight: numOrNull($("pkgEditWeight")?.value),
    cost: numOrNull($("pkgEditCost")?.value),
    amount_due_jmd: numOrNull($("pkgEditDue")?.value),
    amount_paid_jmd: numOrNull($("pkgEditPaid")?.value),
    invoice_prepared: ($("pkgEditInvoicePrepared")?.value === "true"),
    is_paid: ($("pkgEditIsPaid")?.value === "true"),
  };

  // Try full patch; if DB doesn't have extra columns, retry with core fields.
  let res = await supabase.from("packages").update(patch).eq("id", id);
  if (res.error && String(res.error.message || "").includes("amount_due_jmd")) {
    const core = {
      tracking: patch.tracking,
      status: patch.status,
      store: patch.store,
      approved: patch.approved,
      notes: patch.notes,
      pickup: patch.pickup,
      weight: patch.weight,
      cost: patch.cost,
    };
    res = await supabase.from("packages").update(core).eq("id", id);
  }

  if (res.error) {
    if (msg) msg.textContent = res.error.message;
    return;
  }

  // Optional invoice upload
  const invoiceFile = $("pkgInvoiceFile")?.files?.[0] || null;
  if (invoiceFile) await uploadPackageFile(id, invoiceFile, INVOICE_BUCKET, "invoice", msg);
  if ($("pkgInvoiceFile")) $("pkgInvoiceFile").value = "";

  // Send queued emails immediately (best effort)
  try {
    await callProcessQueue();
  } catch (e) {
    // silent; queue still persists
  }

  if (msg) msg.textContent = "Saved.";
  await renderPackages();
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

  // Map user_id -> "Full Name — SNS-JMXXXX" (never display raw UUIDs in UI)
  const uidList = Array.from(new Set(convos.map(c => c.user_id).filter(Boolean)));
  const idToLabel = new Map();
  if (uidList.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,full_name,customer_no,email")
      .in("id", uidList);
    for (const p of profs || []) {
      const name = (p.full_name || p.email || "Customer").trim();
      const no = (p.customer_no || "").trim();
      idToLabel.set(p.id, no ? `${name} — ${no}` : name);
    }
  }

  // Show list
  list.innerHTML = convos
    .map(
      (m) => `
    <button class="convo ${m.user_id === currentCustomer?.id ? "active" : ""}" type="button" data-uid="${escapeHTML(
        m.user_id
      )}">
      <div class="row">
        <strong>${escapeHTML(idToLabel.get(m.user_id) || "Customer")}</strong>
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
    .select("id,email,full_name,customer_no")
    .eq("id", userId)
    .maybeSingle();

  currentCustomer = prof.data
    ? { id: prof.data.id, email: prof.data.email, full_name: prof.data.full_name, customer_no: prof.data.customer_no }
    : { id: userId, email: "", full_name: "", customer_no: "" };

  if ($("convoTitle")) {
    const name = currentCustomer.full_name || currentCustomer.email || "Customer";
    const no = (currentCustomer.customer_no || "").trim();
    $("convoTitle").textContent = no ? `${name} — ${no}` : name;
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
// EXPORT PACKAGES CSV
// ========================
// ========================
// REPORTS (simple, no external chart libs)
// ========================
let __lastReportRows = null;

function setupReportsUI() {
  $("runReports")?.addEventListener("click", () => renderReports(true));
  $("exportReports")?.addEventListener("click", exportReportsCSV);
}

function fmtNum(n) {
  const x = Number(n || 0) || 0;
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function renderReports(force = false) {
  setupReportsUI();

  const shipEl = $("shipmentsChart");
  const storeEl = $("storesChart");
  if (!shipEl || !storeEl) return;

  // Avoid re-running on every tab click unless requested
  if (__lastReportRows && !force) {
    shipEl.innerHTML = __lastReportRows.shipHtml;
    storeEl.innerHTML = __lastReportRows.storeHtml;
    return;
  }

  shipEl.textContent = "Loading…";
  storeEl.textContent = "Loading…";
  // clear cached report output


  const days = Number($("reportRange")?.value || 30) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Try to use extended finance fields if present; fall back gracefully
  let pkgSel = "id,created_at,store,status,weight,cost,amount_due_jmd,amount_paid_jmd,is_paid";
  let res = await supabase
    .from("packages")
    .select(pkgSel)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (res.error && String(res.error.message || "").includes("amount_due_jmd")) {
    pkgSel = "id,created_at,store,status,weight,cost";
    res = await supabase
      .from("packages")
      .select(pkgSel)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000);
  }

  if (res.error) {
    shipEl.innerHTML = `<div class="muted small">${escapeHTML(res.error.message)}</div>`;
    storeEl.innerHTML = `<div class="muted small">${escapeHTML(res.error.message)}</div>`;
    __lastReportRows = null;
    return;
  }

  const rows = res.data || [];

  // Shipments over time (by day)
  const byDay = new Map();
  for (const r of rows) {
    const d = (r.created_at || "").slice(0, 10) || "unknown";
    if (!byDay.has(d)) byDay.set(d, { day: d, count: 0, weight: 0, due: 0, paid: 0 });
    const o = byDay.get(d);
    o.count += 1;
    o.weight += Number(r.weight || 0) || 0;
    const due = Number(r.amount_due_jmd ?? r.cost ?? 0) || 0;
    const paid = Number(r.amount_paid_jmd ?? 0) || 0;
    o.due += due;
    o.paid += paid;
  }
  const dayRows = Array.from(byDay.values());

	  // Status breakdown
	  const byStatus = new Map();
	  for (const r of rows) {
	    const s = (r.status || "Unknown").trim() || "Unknown";
	    if (!byStatus.has(s)) byStatus.set(s, { status: s, count: 0, weight: 0, due: 0, paid: 0 });
	    const o = byStatus.get(s);
	    o.count += 1;
	    o.weight += Number(r.weight || 0) || 0;
	    const due = Number(r.amount_due_jmd ?? r.cost ?? 0) || 0;
	    const paid = Number(r.amount_paid_jmd ?? 0) || 0;
	    o.due += due;
	    o.paid += paid;
	  }
	  const statusRows = Array.from(byStatus.values()).sort((a, b) => b.count - a.count);

	  const shipHtml = `
    <div class="tableWrap">
      <table class="table" style="min-width: 720px;">
        <thead><tr><th>Day</th><th>Packages</th><th>Total weight</th><th>Total due (JMD)</th><th>Total paid (JMD)</th></tr></thead>
        <tbody>
          ${dayRows
            .map(
              (r) =>
                `<tr><td>${escapeHTML(r.day)}</td><td>${r.count}</td><td>${fmtNum(r.weight)}</td><td>${formatJMD(r.due)}</td><td>${formatJMD(r.paid)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
	    </div>
	    <div style="height:12px"></div>
	    <div class="tableWrap">
	      <table class="table" style="min-width: 720px;">
	        <thead><tr><th>Status</th><th>Packages</th><th>Total weight</th><th>Total due (JMD)</th><th>Total paid (JMD)</th></tr></thead>
	        <tbody>
	          ${statusRows
	            .map((r) =>
	              `<tr><td>${escapeHTML(r.status)}</td><td>${r.count}</td><td>${fmtNum(r.weight)}</td><td>${formatJMD(r.due)}</td><td>${formatJMD(r.paid)}</td></tr>`
	            )
	            .join("")}
	        </tbody>
	      </table>
	    </div>
  `;

  // Popular stores
  const byStore = new Map();
  for (const r of rows) {
    const s = (r.store || "Unknown").trim() || "Unknown";
    if (!byStore.has(s)) byStore.set(s, { store: s, count: 0, weight: 0, due: 0, paid: 0 });
    const o = byStore.get(s);
    o.count += 1;
    o.weight += Number(r.weight || 0) || 0;
    const due = Number(r.amount_due_jmd ?? r.cost ?? 0) || 0;
    const paid = Number(r.amount_paid_jmd ?? 0) || 0;
    o.due += due;
    o.paid += paid;
  }
  const storeRows = Array.from(byStore.values()).sort((a, b) => b.count - a.count).slice(0, 25);

  const storeHtml = `
    <div class="tableWrap">
      <table class="table" style="min-width: 720px;">
        <thead><tr><th>Store</th><th>Packages</th><th>Total weight</th><th>Total due (JMD)</th><th>Total paid (JMD)</th></tr></thead>
        <tbody>
          ${storeRows
            .map(
              (r) =>
                `<tr><td>${escapeHTML(r.store)}</td><td>${r.count}</td><td>${fmtNum(r.weight)}</td><td>${formatJMD(r.due)}</td><td>${formatJMD(r.paid)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  shipEl.innerHTML = shipHtml;
  storeEl.innerHTML = storeHtml;

  __lastReportRows = { shipHtml, storeHtml, rows };
}

function exportReportsCSV() {
  if (!__lastReportRows?.rows) {
    alert("Run reports first.");
    return;
  }

  const rows = __lastReportRows.rows;
  const header = ["created_at", "tracking", "status", "store", "weight", "cost", "amount_due_jmd", "amount_paid_jmd", "is_paid"];
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
  a.download = `reports_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ========================
// EXPORT PACKAGES
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

  if (!uploadBtn) return;

  const template = `customer_lookup,tracking,status,pickup,weight,cost,notes,store
customer@example.com,1Z999AA10123456784,Received at warehouse,UWI_KINGSTON,2.5,3650,Fragile,Amazon
SNS-JM0001,1Z999AA10123456785,In Transit,RHODEN_HALL_CLARENDON,1.2,2250,,Shein
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

      const lookups = Array.from(new Set(rows.map(r => (r.customer_lookup || r.customer_email || "").trim()).filter(Boolean)));
      const emails = lookups.filter(x => x.includes("@")).map(x => x.toLowerCase());
      const custNos = lookups.filter(x => !x.includes("@")).map(x => x.toUpperCase());

      const emailToId = new Map();
      const custNoToId = new Map();

      if (emails.length) {
        const { data: profs, error: e1 } = await supabase.from("profiles").select("id,email").in("email", emails);
        if (e1) throw e1;
        for (const p of profs || []) emailToId.set((p.email || "").toLowerCase(), p.id);
      }
      if (custNos.length) {
        const { data: profs2, error: e2 } = await supabase.from("profiles").select("id,customer_no").in("customer_no", custNos);
        if (e2) throw e2;
        for (const p of profs2 || []) custNoToId.set((p.customer_no || "").toUpperCase(), p.id);
      }

      const payload = rows.map((r) => {
        const lk = (r.customer_lookup || r.customer_email || "").trim();
        let user_id = null;
        if (lk.includes("@")) user_id = emailToId.get(lk.toLowerCase()) || null;
        else if (lk) user_id = custNoToId.get(lk.toUpperCase()) || null;

        return {
          user_id,
          tracking: (r.tracking || "").trim(),
          status: (r.status || "").trim() || "Received at warehouse",
          pickup: (r.pickup || "").trim() || null,
          weight: (r.weight != null && String(r.weight).trim() !== "") ? Number(r.weight) : null,
          cost: (r.cost != null && String(r.cost).trim() !== "") ? Number(r.cost) : null,
          notes: (r.notes || "").trim() || null,
          store: (r.store || "").trim() || null,
          approved: String(r.approved || "false").toLowerCase() === "true"
        };
      }).filter(p => p.tracking);

      // Upsert by tracking (if tracking is unique); otherwise create a unique index and change onConflict as needed.
      const { error } = await supabase.from("packages").upsert(payload, { onConflict: "tracking" });
      if (error) throw error;

      if (msg) msg.textContent = "Import complete.";
      await renderPackages();
    } catch (err) {
      if (msg) msg.textContent = `CSV import failed: ${err?.message || err}`;
      console.error(err);
    }
  });
}

// ========================
// INIT
// ========================
async function init() {
  await sanitizeStaleTokenOnce();
  setupAuthUI();
  setupAuthSubOnce();
	  setupReportsUI();
  setupBulkUploadIfPresent();
  await renderApp();
}

window.addEventListener("DOMContentLoaded", init);