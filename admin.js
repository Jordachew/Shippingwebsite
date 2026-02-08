console.log("✅ ADMIN.JS LOADED v2026-02-08-DIAG");


/* =========================================================
   Sueños Shipping — Staff/Admin Dashboard (admin.html v2)
   Works with IDs in admin.html:
   adminLoginCard, adminLoginForm, adminApp, customersBody,
   packagesBody, convoList, adminChatBody, adminChatForm, etc.
========================================================= */

// ========================
// CONFIG (PASTE YOUR VALUES)
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Storage buckets (must exist in Supabase Storage)
const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files"; // optional (if you later add attachments)

// Safe singleton (prevents double-load issues)
window.__SB__ = window.__SB__ || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabase = window.__SB__;

// ========================
// HELPERS
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

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return String(iso || ""); }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function injectAdminChatContrastFix(){ /* styles handled in styles.css */ }

// ========================
// GLOBAL STATE
// ========================
let currentUser = null;
let currentProfile = null; // staff/admin profile row
let authSub = null;

let msgChannel = null;      // realtime channel for messages
let pollTimer = null;       // fallback poll for messages
let selectedConvoUserId = null;

let selectedPackage = null; // currently selected package object

// ========================
// DOM VALIDATION (for your debugging)
// ========================
function validateDom() {
  const required = [
    "adminLoginCard", "adminLoginForm", "adminApp",
    "adminEmail", "adminPassword", "adminLoginMsg",
    "logoutBtn", "whoami",
    "statsRow", "recentPackages", "recentMessages",
    "customersBody", "custSearch", "refreshCustomers", "customerDetail",
    "packagesBody", "pkgSearch", "statusFilter", "refreshPackages", "pkgMsg",
    "pkgEditForm", "pkgEditId", "pkgEditTracking", "pkgEditStatus", "pkgEditStore", "pkgEditApproved", "pkgEditNotes", "pkgEditMsg",
    "convoList", "adminChatBody", "adminChatForm", "adminChatInput", "adminChatMsg", "convoTitle", "markResolvedBtn",
    "msgSearch", "msgFilter", "refreshMessages",
    "reportRange", "runReports", "exportReports", "shipmentsChart", "storesChart",
    "roleForm", "roleEmail", "roleValue", "roleMsg",
    "goPackagesBtn", "goMessagesBtn", "exportPackagesBtn", "quickMsg"
  ];
  const missing = required.filter(id => !$(id));
  if (missing.length) console.warn("⚠️ Missing DOM elements:", missing);
}

// ========================
// AUTH + ROLE GATE
// ========================
async function readProfileById(userId) {
  return await supabase
    .from("profiles")
    .select("id,email,full_name,role,is_active,phone,address")
    .eq("id", userId)
    .maybeSingle();
}

function isStaffRole(role) {
  return role === "staff" || role === "admin";
}

async function requireStaffSession() {
  const { data: userData, error: uErr } = await supabase.auth.getUser();
  if (uErr) return { ok: false, error: uErr };

  const user = userData?.user;
  if (!user) return { ok: false, error: new Error("Not logged in") };

  const profRes = await readProfileById(user.id);
  if (profRes.error) return { ok: false, error: profRes.error };
  const prof = profRes.data;

  if (!prof) return { ok: false, error: new Error("No profile row for this user (profiles table).") };
  if (prof.is_active === false) return { ok: false, error: new Error("Account is deactivated.") };
  if (!isStaffRole(prof.role)) return { ok: false, error: new Error("Not staff. Set role=staff or admin in profiles.") };

  currentUser = user;
  currentProfile = prof;
  return { ok: true, user, profile: prof };
}

async function renderAuthState() {
  const loginCard = $("adminLoginCard");
  const app = $("adminApp");
  const logoutBtn = $("logoutBtn");
  const whoami = $("whoami");

  // reset UI
  if (whoami) whoami.textContent = "";
  if (logoutBtn) logoutBtn.classList.add("hidden");

  const gate = await requireStaffSession();
  if (!gate.ok) {
    // show login UI
    currentUser = null;
    currentProfile = null;
    if (loginCard) loginCard.classList.remove("hidden");
    if (app) app.classList.add("hidden");
    teardownRealtime();
    return;
  }

  // show app
  if (loginCard) loginCard.classList.add("hidden");
  if (app) app.classList.remove("hidden");
  if (logoutBtn) logoutBtn.classList.remove("hidden");
  if (whoami) whoami.textContent = `${gate.profile.full_name || gate.user.email} • ${gate.profile.role}`;

  // Load initial data
  await refreshAll();
}

// ========================
// TABS
// ========================
function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab[data-tab]"));
  const panels = (name) => $(`tab-${name}`);

  function setTab(name) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["overview", "customers", "packages", "messages", "reports", "roles"].forEach(n => {
      const p = panels(n);
      if (!p) return;
      p.classList.toggle("hidden", n !== name);
    });
    if (name === "messages") {
      // ensure messages list keeps updating
      loadConversations();
      ensureMessageLiveUpdates();
    }
  }

  tabs.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  $("goPackagesBtn")?.addEventListener("click", () => setTab("packages"));
  $("goMessagesBtn")?.addEventListener("click", () => setTab("messages"));

  return { setTab };
}

let tabAPI = null;

// ========================
// STATS + OVERVIEW
// ========================
async function refreshStatsOnly() {
  const row = $("statsRow");
  if (!row) return;

  const { data: pkgs, error } = await supabase
    .from("packages")
    .select("status")
    .limit(5000);

  if (error) {
    row.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  const counts = {};
  for (const p of (pkgs || [])) {
    const k = p.status || "UNKNOWN";
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = (pkgs || []).length;

  const cards = [
    ["Total packages", total],
    ["In Transit", counts.IN_TRANSIT || 0],
    ["Ready for Pickup", counts.READY_FOR_PICKUP || 0],
    ["Picked Up", counts.PICKED_UP || 0],
    ["On Hold", counts.ON_HOLD || 0],
  ];

  row.innerHTML = cards.map(([label, value]) => `
    <div class="stat">
      <div class="stat__k">${escapeHTML(label)}</div>
      <div class="stat__v">${escapeHTML(String(value))}</div>
    </div>
  `).join("");
}

async function loadOverviewLists() {
  const rp = $("recentPackages");
  const rm = $("recentMessages");
  if (rp) rp.innerHTML = `<li class="muted">Loading…</li>`;
  if (rm) rm.innerHTML = `<li class="muted">Loading…</li>`;

  const pkgRes = await supabase
    .from("packages")
    .select("tracking,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(8);

  if (rp) {
    if (pkgRes.error) rp.innerHTML = `<li class="muted">${escapeHTML(pkgRes.error.message)}</li>`;
    else rp.innerHTML = (pkgRes.data || []).map(p => `
      <li>
        <strong>${escapeHTML(p.tracking)}</strong>
        <span class="tag">${escapeHTML(p.status || "")}</span>
        <div class="muted small">${escapeHTML(fmtDate(p.updated_at))}</div>
      </li>
    `).join("") || `<li class="muted">No recent packages.</li>`;
  }

  const msgRes = await supabase
    .from("messages")
    .select("sender,body,created_at,resolved")
    .order("created_at", { ascending: false })
    .limit(8);

  if (rm) {
    if (msgRes.error) rm.innerHTML = `<li class="muted">${escapeHTML(msgRes.error.message)}</li>`;
    else rm.innerHTML = (msgRes.data || []).map(m => `
      <li>
        <span class="tag">${escapeHTML(m.sender || "")}</span>
        ${escapeHTML((m.body || "").slice(0, 90))}
        <div class="muted small">${escapeHTML(fmtDate(m.created_at))}${m.resolved ? " • resolved" : ""}</div>
      </li>
    `).join("") || `<li class="muted">No recent messages.</li>`;
  }
}

// ========================
// CUSTOMERS
// ========================
let selectedCustomerId = null;

async function loadCustomers() {
  const body = $("customersBody");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;

  const q = ($("custSearch")?.value || "").trim().toLowerCase();

  const { data: profs, error } = await supabase
    .from("profiles")
    .select("id,full_name,email,phone,role,is_active")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const filtered = (profs || []).filter(p => {
    if (!q) return true;
    const hay = `${p.full_name || ""} ${p.email || ""} ${p.phone || ""}`.toLowerCase();
    return hay.includes(q);
  });

  body.innerHTML = filtered.map(p => `
    <tr data-id="${escapeHTML(p.id)}">
      <td>${escapeHTML(p.full_name || "—")}</td>
      <td>${escapeHTML(p.email || "—")}</td>
      <td>${escapeHTML(p.phone || "—")}</td>
      <td><span class="tag">${escapeHTML(p.role || "customer")}</span></td>
      <td>${p.is_active === false ? `<span class="tag tag--warn">Deactivated</span>` : `<span class="tag tag--ok">Active</span>`}</td>
      <td>
        <button class="btn btn--ghost btn--sm" data-act="view">View</button>
        <button class="btn btn--ghost btn--sm" data-act="toggle">${p.is_active === false ? "Activate" : "Deactivate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="muted">No customers found.</td></tr>`;

  // row handlers
  body.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    tr.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "view") {
          selectedCustomerId = id;
          await renderCustomerDetail(id);
        } else if (act === "toggle") {
          await toggleCustomerActive(id);
          await loadCustomers();
          if (selectedCustomerId === id) await renderCustomerDetail(id);
        }
      });
    });

    tr.addEventListener("click", async () => {
      selectedCustomerId = id;
      await renderCustomerDetail(id);
    });
  });
}

async function toggleCustomerActive(userId) {
  // only admin should do this in a real system; keep it simple here.
  const detail = $("customerDetail");
  if (detail) detail.textContent = "Updating…";

  const profRes = await supabase.from("profiles").select("is_active").eq("id", userId).maybeSingle();
  if (profRes.error) {
    if (detail) detail.textContent = profRes.error.message;
    return;
  }
  const next = !(profRes.data?.is_active === false);

  const { error } = await supabase.from("profiles").update({ is_active: next ? false : true }).eq("id", userId);
  if (error && detail) detail.textContent = error.message;
}

async function renderCustomerDetail(userId) {
  const box = $("customerDetail");
  if (!box) return;
  box.textContent = "Loading…";

  const prof = await supabase
    .from("profiles")
    .select("id,full_name,email,phone,address,role,is_active")
    .eq("id", userId)
    .maybeSingle();

  const pk = await supabase
    .from("packages")
    .select("tracking,status,updated_at,store,approved")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(15);

  const inv = await supabase
    .from("invoices")
    .select("tracking,file_name,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  const msg = await supabase
    .from("messages")
    .select("sender,body,created_at,resolved")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (prof.error) {
    box.textContent = prof.error.message;
    return;
  }

  const p = prof.data || {};
  box.innerHTML = `
    <div class="stack">
      <div>
        <div class="h3">${escapeHTML(p.full_name || "—")}</div>
        <div class="muted">${escapeHTML(p.email || "")}</div>
        <div class="muted small">${escapeHTML(p.phone || "—")} • ${escapeHTML(p.address || "No address")}</div>
        <div class="muted small">Role: <strong>${escapeHTML(p.role || "customer")}</strong> • ${p.is_active === false ? "Deactivated" : "Active"}</div>
      </div>

      <div class="grid2">
        <div>
          <div class="muted small">Packages</div>
          <ul class="list">
            ${(pk.error ? [`<li class="muted">${escapeHTML(pk.error.message)}</li>`] :
              (pk.data||[]).map(x => `<li><strong>${escapeHTML(x.tracking)}</strong> <span class="tag">${escapeHTML(x.status)}</span> ${x.approved ? `<span class="tag tag--ok">Approved</span>` : `<span class="tag tag--warn">Pending</span>`}<div class="muted small">${escapeHTML(fmtDate(x.updated_at))}${x.store ? " • "+escapeHTML(x.store):""}</div></li>`))
              .join("") || `<li class="muted">No packages.</li>`}
          </ul>
        </div>

        <div>
          <div class="muted small">Invoices</div>
          <ul class="list">
            ${(inv.error ? [`<li class="muted">${escapeHTML(inv.error.message)}</li>`] :
              (inv.data||[]).map(x => `<li><strong>${escapeHTML(x.tracking)}</strong> • ${escapeHTML(x.file_name || "file")}<div class="muted small">${escapeHTML(fmtDate(x.created_at))}</div></li>`))
              .join("") || `<li class="muted">No invoices.</li>`}
          </ul>
        </div>
      </div>

      <div>
        <div class="muted small">Recent messages</div>
        <ul class="list">
          ${(msg.error ? [`<li class="muted">${escapeHTML(msg.error.message)}</li>`] :
            (msg.data||[]).map(x => `<li><span class="tag">${escapeHTML(x.sender)}</span> ${escapeHTML(x.body).slice(0,120)}<div class="muted small">${escapeHTML(fmtDate(x.created_at))}${x.resolved ? " • resolved":""}</div></li>`))
            .join("") || `<li class="muted">No messages.</li>`}
        </ul>
      </div>
    </div>
  `;
}

// ========================
// PACKAGES
// ========================
async function loadPackages() {
  const tbody = $("packagesBody");
  const msg = $("pkgMsg");
  if (msg) msg.textContent = "";
  if (!tbody) return;

  const q = ($("pkgSearch")?.value || "").trim().toLowerCase();
  const statusFilter = ($("statusFilter")?.value || "").trim();

  const { data: pkgs, error: pErr } = await supabase
    .from("packages")
    .select("id,user_id,tracking,status,notes,updated_at,created_at,store,photo_paths,approved")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (pErr) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">${escapeHTML(pErr.message)}</td></tr>`;
    return;
  }

  // load profiles (for label)
  const userIds = Array.from(new Set((pkgs || []).map(p => p.user_id).filter(Boolean)));
  let profMap = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", userIds);
    for (const p of (profs || [])) profMap[p.id] = p;
  }

  const filtered = (pkgs || []).filter(p => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (!q) return true;
    const cust = profMap[p.user_id];
    const hay = `${p.tracking || ""} ${p.status || ""} ${p.store || ""} ${cust?.full_name || ""} ${cust?.email || ""}`.toLowerCase();
    return hay.includes(q);
  });

  tbody.innerHTML = filtered.map(p => {
    const cust = profMap[p.user_id];
    const custLabel = cust ? (cust.full_name || cust.email) : (p.user_id ? p.user_id.slice(0, 8) + "…" : "—");
    return `
      <tr data-id="${escapeHTML(String(p.id))}">
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status || "")}</span></td>
        <td>${p.approved ? `<span class="tag tag--ok">Yes</span>` : `<span class="tag tag--warn">No</span>`}</td>
        <td>${escapeHTML(custLabel)}</td>
        <td>${escapeHTML(p.store || "—")}</td>
        <td class="muted">${escapeHTML(fmtDate(p.updated_at))}</td>
        <td><button class="btn btn--ghost btn--sm" data-act="edit">Edit</button></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" class="muted">No packages found.</td></tr>`;

  tbody.querySelectorAll("tr[data-id]").forEach(tr => {
    const id = tr.getAttribute("data-id");
    tr.querySelector("button[data-act='edit']")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const pkg = (pkgs || []).find(x => String(x.id) === String(id));
      if (!pkg) return;
      selectedPackage = pkg;
      fillPackageEditForm(pkg);
    });
    tr.addEventListener("click", () => {
      const pkg = (pkgs || []).find(x => String(x.id) === String(id));
      if (!pkg) return;
      selectedPackage = pkg;
      fillPackageEditForm(pkg);
    });
  });
}

function fillPackageEditForm(p) {
  $("pkgEditId").value = p.id || "";
  $("pkgEditTracking").value = p.tracking || "";
  $("pkgEditStatus").value = p.status || "RECEIVED";
  $("pkgEditStore").value = p.store || "";
  $("pkgEditApproved").value = String(!!p.approved);
  $("pkgEditNotes").value = p.notes || "";
  if ($("pkgEditMsg")) $("pkgEditMsg").textContent = "";
}

async function onSavePackage(e) {
  e.preventDefault();
  const msg = $("pkgEditMsg");
  if (msg) msg.textContent = "Saving…";

  try {
    const id = $("pkgEditId").value;
    if (!id) throw new Error("Select a package first.");

    const tracking = $("pkgEditTracking").value.trim();
    const status = $("pkgEditStatus").value;
    const store = $("pkgEditStore").value.trim() || null;
    const approved = $("pkgEditApproved").value === "true";
    const notes = $("pkgEditNotes").value.trim() || null;

    // Optional: upload invoice file from staff
    const invFile = $("pkgInvoiceFile")?.files?.[0] || null;
    if (invFile) {
      if (!selectedPackage?.user_id) throw new Error("This package has no customer assigned (user_id).");
      const safe = invFile.name.replace(/[^\w.\-]+/g, "_");
      const invPath = `${selectedPackage.user_id}/${tracking}/${Date.now()}_${safe}`;
      const upInv = await supabase.storage.from(INVOICE_BUCKET).upload(invPath, invFile, { upsert: false });
      if (upInv.error) throw upInv.error;

      const insInv = await supabase.from("invoices").insert({
        user_id: selectedPackage.user_id,
        tracking,
        file_path: invPath,
        file_name: safe,
        file_type: invFile.type || "unknown",
        note: "Uploaded by staff"
      });
      if (insInv.error) throw insInv.error;
    }

    // Optional: photo file (if you later add a bucket + column)
    // We won't force it here because your schema may differ.

    const payload = {
      tracking,
      status,
      store,
      approved,
      notes,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("packages").update(payload).eq("id", id);
    if (error) throw error;

    if (msg) msg.textContent = "Saved.";
    if ($("pkgPhotoFile")) $("pkgPhotoFile").value = "";
    if ($("pkgInvoiceFile")) $("pkgInvoiceFile").value = "";

    await loadPackages();
    await refreshStatsOnly();
    await loadOverviewLists();
  } catch (err) {
    console.error(err);
    if (msg) msg.textContent = err?.message || String(err);
  }
}

// ========================
// MESSAGES (Realtime + Poll fallback)
// ========================
async function loadConversations() {
  const list = $("convoList");
  if (!list) return;

  const q = ($("msgSearch")?.value || "").trim().toLowerCase();
  const filter = ($("msgFilter")?.value || "open");

  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id,user_id,sender,body,created_at,resolved")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }

  // Group by user_id
  const byUser = new Map();
  for (const m of (msgs || [])) {
    if (filter === "open" && m.resolved === true) continue;
    const key = m.user_id;
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(m);
  }

  const userIds = Array.from(byUser.keys()).filter(Boolean);
  let profMap = {};
  if (userIds.length) {
    const { data: profs } = await supabase.from("profiles").select("id,full_name,email").in("id", userIds);
    for (const p of (profs || [])) profMap[p.id] = p;
  }

  const items = userIds.map(uid => {
    const latest = byUser.get(uid)?.[0];
    const prof = profMap[uid];
    const label = prof ? (prof.full_name || prof.email) : (uid.slice(0, 8) + "…");
    const preview = (latest?.body || "").slice(0, 60);
    const unresolved = (byUser.get(uid) || []).some(x => x.resolved === false);
    const text = `${label} ${preview}`.toLowerCase();
    if (q && !text.includes(q)) return null;
    return { uid, label, latest, unresolved };
  }).filter(Boolean);

  list.innerHTML = items.map(it => `
    <li class="listItem ${it.uid === selectedConvoUserId ? "active" : ""}" data-uid="${escapeHTML(it.uid)}">
      <div class="listItem__title">
        ${escapeHTML(it.label)}
        ${it.unresolved ? `<span class="tag tag--warn">Open</span>` : `<span class="tag tag--ok">Resolved</span>`}
      </div>
      <div class="muted small">${escapeHTML(it.latest?.body || "")}</div>
      <div class="muted small">${escapeHTML(fmtDate(it.latest?.created_at))}</div>
    </li>
  `).join("") || `<li class="muted">No conversations.</li>`;

  list.querySelectorAll(".listItem").forEach(li => {
    li.addEventListener("click", async () => {
      selectedConvoUserId = li.getAttribute("data-uid");
      await renderChatFor(selectedConvoUserId);
      await loadConversations();
      ensureMessageLiveUpdates(); // ensure subscription targets selected
    });
  });
}

async function renderChatFor(userId) {
  selectedConvoUserId = userId;

  const title = $("convoTitle");
  const body = $("adminChatBody");
  if (title) title.textContent = "Loading…";
  if (body) body.innerHTML = "";

  // label
  const { data: prof } = await supabase.from("profiles").select("full_name,email").eq("id", userId).maybeSingle();
  if (title) title.textContent = prof ? (prof.full_name || prof.email || userId) : userId;

  const { data: msgs, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at,resolved")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    if (body) body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  if (body) {
    body.innerHTML = (msgs || []).map(m => `
      <div class="bubble ${m.sender === "staff" ? "me" : ""}">
        <div>${escapeHTML(m.body || "")}</div>
        <div class="meta">
          <span>${escapeHTML(m.sender === "staff" ? "Staff" : "Customer")}</span>
          <span>${escapeHTML(new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
        </div>
      </div>
    `).join("") || `<div class="muted small">No messages yet.</div>`;

    body.scrollTop = body.scrollHeight;
  }
}

async function sendStaffMessage(text) {
  const msgEl = $("adminChatMsg");
  if (!selectedConvoUserId) {
    if (msgEl) msgEl.textContent = "Select a conversation first.";
    return;
  }

  if (msgEl) msgEl.textContent = "Sending…";

  const { error } = await supabase.from("messages").insert({
    user_id: selectedConvoUserId,
    sender: "staff",
    body: text,
    resolved: false
  });

  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  if (msgEl) msgEl.textContent = "Sent.";
  // Immediately refresh (for cases where realtime isn't enabled)
  await renderChatFor(selectedConvoUserId);
  await loadConversations();
}

async function markResolved() {
  const msgEl = $("adminChatMsg");
  if (!selectedConvoUserId) {
    if (msgEl) msgEl.textContent = "Select a conversation first.";
    return;
  }

  if (msgEl) msgEl.textContent = "Marking resolved…";

  const { error } = await supabase
    .from("messages")
    .update({ resolved: true })
    .eq("user_id", selectedConvoUserId)
    .eq("resolved", false);

  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  if (msgEl) msgEl.textContent = "Resolved.";
  await renderChatFor(selectedConvoUserId);
  await loadConversations();
}

function teardownRealtime() {
  if (msgChannel) {
    supabase.removeChannel(msgChannel);
    msgChannel = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ensureMessageLiveUpdates() {
  // Always keep a fallback poll running (5 sec)
  if (!pollTimer) {
    pollTimer = setInterval(async () => {
      if (!currentUser) return;
      if ($("adminApp")?.classList.contains("hidden")) return;

      // If viewing messages tab and a convo is selected, refresh chat and convo list.
      const messagesPanelVisible = !$("tab-messages")?.classList.contains("hidden");
      if (!messagesPanelVisible) return;

      await loadConversations();
      if (selectedConvoUserId) await renderChatFor(selectedConvoUserId);
    }, 5000);
  }

  // Realtime subscription for inserts (best case)
  // If Realtime isn't enabled for table "messages", this won't fire, but poll will still work.
  if (msgChannel) {
    supabase.removeChannel(msgChannel);
    msgChannel = null;
  }

  msgChannel = supabase
    .channel("admin-messages-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const messagesPanelVisible = !$("tab-messages")?.classList.contains("hidden");
      if (!messagesPanelVisible) return;

      await loadConversations();

      const m = payload?.new;
      if (selectedConvoUserId && m?.user_id === selectedConvoUserId) {
        await renderChatFor(selectedConvoUserId);
      }
    })
    .subscribe();
}

// ========================
// REPORTS (simple, no charts lib)
// ========================
let lastReport = null;

async function runReports() {
  const rangeDays = parseInt($("reportRange")?.value || "30", 10);
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  $("shipmentsChart").textContent = "Loading…";
  $("storesChart").textContent = "Loading…";

  const { data: pkgs, error } = await supabase
    .from("packages")
    .select("created_at,store,status")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) {
    $("shipmentsChart").textContent = error.message;
    $("storesChart").textContent = "";
    return;
  }

  // group by day
  const byDay = {};
  const storeCounts = {};
  for (const p of (pkgs || [])) {
    const day = (p.created_at || "").slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
    const s = (p.store || "Unknown").trim();
    storeCounts[s] = (storeCounts[s] || 0) + 1;
  }

  const days = Object.keys(byDay).sort();
  const lines = days.map(d => `${d}: ${byDay[d]}`).join("\n");
  const topStores = Object.entries(storeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  $("shipmentsChart").textContent = lines || "No shipments in this range.";
  $("storesChart").innerHTML = topStores.map(([s, c]) => `<div>${escapeHTML(s)} — <strong>${c}</strong></div>`).join("") || "No stores data.";

  lastReport = { since, pkgs };
}

function exportReportsCSV() {
  if (!lastReport?.pkgs) {
    alert("Run reports first.");
    return;
  }
  const rows = [["created_at", "store", "status"]];
  for (const p of lastReport.pkgs) rows.push([p.created_at || "", p.store || "", p.status || ""]);
  const csv = rows.map(r => r.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadText(`reports_${lastReport.since.slice(0, 10)}.csv`, csv);
}

// ========================
// ROLES
// ========================
async function onRoleUpdate(e) {
  e.preventDefault();
  const msg = $("roleMsg");
  if (msg) msg.textContent = "Updating…";

  if (currentProfile?.role !== "admin") {
    if (msg) msg.textContent = "Only admin can change roles.";
    return;
  }

  const email = $("roleEmail").value.trim().toLowerCase();
  const role = $("roleValue").value;

  const { data: prof, error: pErr } = await supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
  if (pErr) { if (msg) msg.textContent = pErr.message; return; }
  if (!prof) { if (msg) msg.textContent = "No profile found for that email."; return; }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", prof.id);
  if (error) { if (msg) msg.textContent = error.message; return; }

  if (msg) msg.textContent = "Role updated.";
  $("roleForm").reset();
  await loadCustomers();
}

// ========================
// EXPORT PACKAGES (CSV)
// ========================
async function exportPackagesCSV() {
  const qm = $("quickMsg");
  if (qm) qm.textContent = "Exporting…";

  const { data: pkgs, error } = await supabase
    .from("packages")
    .select("tracking,status,store,approved,user_id,updated_at,created_at")
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (error) {
    if (qm) qm.textContent = error.message;
    return;
  }

  const rows = [["tracking","status","store","approved","user_id","updated_at","created_at"]];
  for (const p of (pkgs || [])) {
    rows.push([p.tracking||"", p.status||"", p.store||"", String(!!p.approved), p.user_id||"", p.updated_at||"", p.created_at||""]);
  }
  const csv = rows.map(r => r.map(x => `"${String(x).replaceAll('"','""')}"`).join(",")).join("\n");
  downloadText(`packages_${new Date().toISOString().slice(0,10)}.csv`, csv);
  if (qm) qm.textContent = "Exported.";
}

// ========================
// REFRESH ALL
// ========================
async function refreshAll() {
  await refreshStatsOnly();
  await loadOverviewLists();
  await loadCustomers();
  await loadPackages();
  await loadConversations();
  ensureMessageLiveUpdates();
}

// ========================
// EVENTS
// ========================
function setupEvents() {
  // Login
  $("adminLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("adminLoginMsg");
    if (msg) msg.textContent = "Signing in…";

    const email = $("adminEmail").value.trim().toLowerCase();
    const password = $("adminPassword").value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (msg) msg.textContent = error.message;
      return;
    }
    if (msg) msg.textContent = "";
    await renderAuthState();
  });

  // Logout
  $("logoutBtn")?.addEventListener("click", async () => {
    teardownRealtime();
    await supabase.auth.signOut();
    await renderAuthState();
  });

  // Filters
  $("refreshCustomers")?.addEventListener("click", loadCustomers);
  $("custSearch")?.addEventListener("input", () => { loadCustomers(); });

  $("refreshPackages")?.addEventListener("click", loadPackages);
  $("pkgSearch")?.addEventListener("input", () => { loadPackages(); });
  $("statusFilter")?.addEventListener("change", () => { loadPackages(); });

  // Package edit
  $("pkgEditForm")?.addEventListener("submit", onSavePackage);

  // Messages
  $("refreshMessages")?.addEventListener("click", async () => {
    await loadConversations();
    if (selectedConvoUserId) await renderChatFor(selectedConvoUserId);
  });
  $("msgSearch")?.addEventListener("input", loadConversations);
  $("msgFilter")?.addEventListener("change", loadConversations);

  $("adminChatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("adminChatInput");
    const text = (input?.value || "").trim();
    if (!text) return;
    input.value = "";
    await sendStaffMessage(text);
  });

  $("markResolvedBtn")?.addEventListener("click", markResolved);

  // Reports
  $("runReports")?.addEventListener("click", runReports);
  $("exportReports")?.addEventListener("click", exportReportsCSV);

  // Roles
  $("roleForm")?.addEventListener("submit", onRoleUpdate);

  // Export packages quick action
  $("exportPackagesBtn")?.addEventListener("click", exportPackagesCSV);

  // Auth state listener (one-time)
  if (!authSub) {
    authSub = supabase.auth.onAuthStateChange(async () => {
      await renderAuthState();
    });
  }
}

// ========================
// INIT
// ========================
async function init() {
  validateDom();
  injectAdminChatContrastFix();
  tabAPI = setupTabs();
  setupEvents();
  await renderAuthState();
}

window.addEventListener("DOMContentLoaded", init);
