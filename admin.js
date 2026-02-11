/* ============================================================
   Sueños Shipping — Admin Dashboard (admin.js)
   Fixes:
   - Stable auth (no "login once" issue)
   - Correct profile read (filtered by id)
   - Admin page uses admin.js (not script.js)
   - Realtime chat for selected customer (no forced refresh)
   ============================================================ */

const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8"; // <-- replace with your anon key

if (!window.supabase) {
  throw new Error("Supabase UMD library not loaded (admin.html script order).");
}

window.__SB_ADMIN__ =
  window.__SB_ADMIN__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "suenos-auth",
    },
  });

const sb = window.__SB_ADMIN__;

function $(id) { return document.getElementById(id); }
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function clearAuthStorage() {
  try {
    const keys = Object.keys(localStorage || {});
    for (const k of keys) {
      if (k === "suenos-auth" || k.startsWith("sb-")) localStorage.removeItem(k);
    }
  } catch (_) {}
}
async function getAuthedUser() {
  const { data: sess } = await sb.auth.getSession();
  if (!sess?.session) return null;
  const { data: uData, error } = await sb.auth.getUser();
  if (error) return null;
  return uData?.user || null;
}

let staffProfile = null;
let currentCustomer = null; // { id, email, customer_no }
let chatChannel = null;

// ------------------------
// AUTH / ACCESS
// ------------------------
async function requireStaff() {
  const msg = $("authMsg");
  const user = await getAuthedUser();
  if (!user) {
    if (msg) msg.textContent = "Not logged in.";
    return false;
  }

  const { data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    if (msg) msg.textContent = "Profile error: " + (error?.message || "missing profile row");
    return false;
  }

  const role = (data.role || "").toLowerCase();
  if (role !== "staff" && role !== "admin") {
    if (msg) msg.textContent = "Access denied: staff/admin only.";
    return false;
  }

  staffProfile = data;

  if ($("authCard")) $("authCard").classList.add("hidden");
  if ($("adminApp")) $("adminApp").classList.remove("hidden");
  if ($("whoami")) $("whoami").textContent = `Signed in as ${data.full_name || "Staff"} (${data.email})`;

  return true;
}

async function doLogin(email, password) {
  const msg = $("authMsg");
  if (msg) msg.textContent = "Signing in...";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (msg) msg.textContent = error.message;
    return false;
  }
  if (msg) msg.textContent = "";
  return true;
}

async function doLogout() {
  await sb.auth.signOut();
  clearAuthStorage();
  location.href = "/#portal";
}

// ------------------------
// STATS
// ------------------------
async function renderStats() {
  const inTransitEl = $("statInTransit");
  const readyEl = $("statReady");
  const delivEl = $("statDelivered");

  async function countStatus(val) {
    const { count, error } = await sb
      .from("packages")
      .select("*", { count: "exact", head: true })
      .eq("status", val);
    if (error) return null;
    return count ?? 0;
  }

  const inTransit = await countStatus("In Transit");
  const ready = await countStatus("Ready for Pickup");
  const delivered = await countStatus("Delivered");

  if (inTransitEl) inTransitEl.textContent = inTransit == null ? "—" : String(inTransit);
  if (readyEl) readyEl.textContent = ready == null ? "—" : String(ready);
  if (delivEl) delivEl.textContent = delivered == null ? "—" : String(delivered);
}

// ------------------------
// CUSTOMER SEARCH
// ------------------------
async function findCustomer(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;

  // Try email
  let { data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,customer_no")
    .ilike("email", q)
    .maybeSingle();

  if (!error && data) return data;

  // Try account number
  ({ data, error } = await sb
    .from("profiles")
    .select("id,email,full_name,customer_no")
    .ilike("customer_no", q)
    .maybeSingle());

  if (!error && data) return data;
  return null;
}

async function handleFindCustomer(e) {
  e.preventDefault();
  const msg = $("findMsg");
  if (msg) msg.textContent = "Searching...";

  const raw = $("custEmail")?.value || "";
  const found = await findCustomer(raw);

  if (!found) {
    currentCustomer = null;
    if ($("custId")) $("custId").textContent = "—";
    if (msg) msg.textContent = "No customer found.";
    await teardownChatRealtime();
    await renderChat(); // clears chat
    return;
  }

  currentCustomer = found;
  if ($("custId")) $("custId").textContent = `${found.full_name || ""} — ${found.email} (${found.customer_no || "no acct"})`;
  if (msg) msg.textContent = "Customer selected.";

  await renderPackages("");
  await renderInvoices();
  await renderChat();
  await setupChatRealtime();
}

// ------------------------
// PACKAGES
// ------------------------
async function renderPackages(filter = "") {
  const body = $("pkgBody");
  if (!body) return;

  let q = sb
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,updated_at,store,user_id")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (currentCustomer?.id) q = q.eq("user_id", currentCustomer.id);

  const f = (filter || "").trim();
  if (f) {
    // simple OR filter by tracking/status/store
    // postgrest OR syntax
    q = q.or(`tracking.ilike.%${f}%,status.ilike.%${f}%,store.ilike.%${f}%`);
  }

  const { data, error } = await q;
  if (error) {
    body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No packages found.</td></tr>`;
    return;
  }

  body.innerHTML = data
    .map(
      (p) => `
      <tr>
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status)}</span></td>
        <td>${escapeHTML(p.pickup || "")}</td>
        <td class="muted">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ""}</td>
        <td><button class="btn btn--ghost btn--sm" data-edit="${escapeHTML(p.tracking)}">Edit</button></td>
      </tr>
    `
    )
    .join("");

  // wire edit buttons
  body.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tracking = btn.getAttribute("data-edit");
      await loadPackageIntoEditor(tracking);
    });
  });
}

async function loadPackageIntoEditor(tracking) {
  const { data, error } = await sb
    .from("packages")
    .select("tracking,status,notes")
    .eq("tracking", tracking)
    .maybeSingle();

  if (error || !data) {
    if ($("updateMsg")) $("updateMsg").textContent = "Could not load package.";
    return;
  }

  if ($("mTitle")) $("mTitle").value = data.tracking || "";
  if ($("mStatus")) $("mStatus").value = data.status || "";
  if ($("mNotes")) $("mNotes").value = data.notes || "";
  if ($("updateMsg")) $("updateMsg").textContent = "";
}

async function savePackageEdits(e) {
  e.preventDefault();
  const tracking = $("mTitle")?.value || "";
  const status = ($("mStatus")?.value || "").trim();
  const notes = ($("mNotes")?.value || "").trim();

  const msg = $("updateMsg");
  if (msg) msg.textContent = "Saving...";

  if (!tracking) {
    if (msg) msg.textContent = "Missing tracking.";
    return;
  }

  const { error } = await sb
    .from("packages")
    .update({ status: status || null, notes: notes || null, updated_at: new Date().toISOString() })
    .eq("tracking", tracking);

  if (error) {
    if (msg) msg.textContent = error.message;
    return;
  }

  if (msg) msg.textContent = "Saved.";
  await renderStats();
  await renderPackages($("pkgSearch")?.value || "");
}

// ------------------------
// INVOICES (approval)
// ------------------------
async function renderInvoices() {
  const list = $("invoiceList");
  if (!list) return;

  let q = sb
    .from("invoices")
    .select("id,user_id,tracking,file_name,created_at,approved")
    .order("created_at", { ascending: false })
    .limit(50);

  if (currentCustomer?.id) q = q.eq("user_id", currentCustomer.id);

  const { data, error } = await q;
  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }

  if (!data?.length) {
    list.innerHTML = `<li class="muted">No invoices found.</li>`;
    return;
  }

  list.innerHTML = data
    .map((i) => {
      const approved = !!i.approved;
      return `
        <li class="list__item">
          <div>
            <div><strong>${escapeHTML(i.tracking || "")}</strong> • ${escapeHTML(i.file_name || "")}</div>
            <div class="muted small">${i.created_at ? new Date(i.created_at).toLocaleString() : ""} • ${approved ? "Approved" : "Pending"}</div>
          </div>
          <div class="list__actions">
            ${approved ? "" : `<button class="btn btn--primary btn--sm" data-approve="${i.id}">Approve</button>`}
          </div>
        </li>
      `;
    })
    .join("");

  list.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-approve");
      btn.disabled = true;
      await sb.from("invoices").update({ approved: true }).eq("id", id);
      await renderInvoices();
    });
  });
}

// ------------------------
// CHAT (admin replies)
// ------------------------
async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  if (!currentCustomer?.id) {
    body.innerHTML = `<div class="muted small">Select a customer to view messages.</div>`;
    return;
  }

  const { data, error } = await sb
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: true })
    .limit(300);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data || [])
    .map((m) => {
      const mine = (m.sender || "").toLowerCase() === "staff";
      return `
        <div class="bubble ${mine ? "me" : ""}">
          <div>${escapeHTML(m.body)}</div>
          <div class="meta">
            <span>${mine ? "Staff" : "Customer"}</span>
            <span>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</span>
          </div>
        </div>
      `;
    })
    .join("") || `<div class="muted small">No messages yet.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function teardownChatRealtime() {
  if (chatChannel) {
    sb.removeChannel(chatChannel);
    chatChannel = null;
  }
}

async function setupChatRealtime() {
  await teardownChatRealtime();
  if (!currentCustomer?.id) return;

  chatChannel = sb
    .channel(`admin-messages:${currentCustomer.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${currentCustomer.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

async function sendChat(e) {
  e.preventDefault();
  const msgEl = $("chatMsg");
  const input = $("chatInput");
  const text = (input?.value || "").trim();

  if (!currentCustomer?.id) {
    if (msgEl) msgEl.textContent = "Select a customer first.";
    return;
  }
  if (!text) return;

  if (msgEl) msgEl.textContent = "Sending...";

  const { error } = await sb
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "staff", body: text });

  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  if (input) input.value = "";
  if (msgEl) msgEl.textContent = "";
  await renderChat();
}

// ------------------------
// NAV (mobile)
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

// ------------------------
// INIT
// ------------------------
async function init() {
  setupMobileNav();

  $("adminLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = ($("adminEmail")?.value || "").trim().toLowerCase();
    const pass = $("adminPassword")?.value || "";
    const ok = await doLogin(email, pass);
    if (!ok) return;
    const allowed = await requireStaff();
    if (allowed) {
      await renderStats();
      await renderPackages("");
      await renderInvoices();
      await renderChat();
    }
  });

  $("logoutBtn")?.addEventListener("click", doLogout);
  $("findForm")?.addEventListener("submit", handleFindCustomer);
  $("updateForm")?.addEventListener("submit", savePackageEdits);
  $("chatForm")?.addEventListener("submit", sendChat);

  $("pkgSearch")?.addEventListener("input", async (e) => {
    await renderPackages(e.target.value);
  });

  // Auto-resume session if already logged in
  const allowed = await requireStaff();
  if (allowed) {
    await renderStats();
    await renderPackages("");
    await renderInvoices();
    await renderChat();
  }
}

window.addEventListener("DOMContentLoaded", init);
