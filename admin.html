// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8"; // keep same as script.js

// Safe singleton (prevents double-load)
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

// Buckets (create in Storage)
const INVOICE_BUCKET = "invoices";
const PACKAGE_PHOTO_BUCKET = "package_photos"; // create bucket (private) or change to "invoices" if you prefer

// --------------------
// Helpers
// --------------------
function $(id) { return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmtDate(ts){
  try { return new Date(ts).toLocaleString(); } catch { return ""; }
}
function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function downloadText(filename, text, mime="text/plain"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
function show(el, on){ if (el) el.classList.toggle("hidden", !on); }

// ✅ FIX: project ref key, not host
function getProjectRef(){
  try { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
  catch { return "ykpcgcjudotzakaxgnxh"; }
}
function clearAuthStorage(){
  try {
    const ref = getProjectRef();
    localStorage.removeItem(`sb-${ref}-auth-token`);
  } catch {}
}

// --------------------
// Auth + role gating
// --------------------
let me = null;          // auth user
let myProfile = null;   // profiles row
let isStaff = false;
let isAdmin = false;

let __renderBusy = false;
let __refreshBusy = false;

async function getMyProfile(){
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;

  me = u?.user || null;
  if (!me) return null;

  const res = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .eq("id", me.id)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data || null;
}

async function hardSignOut(){
  try { await supabase.auth.signOut(); } catch {}
  clearAuthStorage();
  // Force a clean state for admin
  location.href = "admin.html";
}

async function renderAuth(){
  if (__renderBusy) return;
  __renderBusy = true;

  const loginCard = $("adminLoginCard");
  const app = $("adminApp");
  const who = $("whoami");
  const logoutBtn = $("logoutBtn");
  const loginMsg = $("adminLoginMsg");

  try {
    try {
      myProfile = await getMyProfile();
    } catch (err) {
      console.error("Profile read error:", err);
      myProfile = null;
    }

    const authed = !!me;

    show(loginCard, !authed);
    show(app, authed);
    show(logoutBtn, authed);

    if (!authed){
      if (who) who.textContent = "";
      if (loginMsg) loginMsg.textContent = "";
      return;
    }

    const role = (myProfile?.role || "").toLowerCase();
    const active = myProfile?.is_active !== false;
    isStaff = active && (role === "staff" || role === "admin");
    isAdmin = active && (role === "admin");

    if (who){
      who.textContent = `${myProfile?.full_name || me.email} • ${role || "unknown role"}`;
    }

    // If logged in but not staff: show message, keep app hidden
    if (!isStaff){
      show(app, false);
      show(loginCard, true);
      if (loginMsg) loginMsg.textContent =
        "This account is not staff/admin yet. Set profiles.role to staff or admin in Supabase.";
      return;
    }

    // roles tab is admin-only
    const rolesTabBtn = document.querySelector('.tab[data-tab="roles"]');
    if (rolesTabBtn) rolesTabBtn.style.display = isAdmin ? "inline-flex" : "none";

    // ✅ avoid multiple concurrent refreshes
    if (!__refreshBusy){
      __refreshBusy = true;
      try { await refreshAll(); }
      finally { __refreshBusy = false; }
    }
  } finally {
    __renderBusy = false;
  }
}

// --------------------
// Login UI
// --------------------
function setupLogin(){
  $("adminLoginForm")?.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const msg = $("adminLoginMsg");
    if (msg) msg.textContent = "Signing in…";

    try {
      const email = ($("adminEmail")?.value || "").trim().toLowerCase();
      const password = $("adminPassword")?.value || "";

      const res = await supabase.auth.signInWithPassword({ email, password });
      console.log("ADMIN LOGIN RES:", res);

      if (res.error){
        if (msg) msg.textContent = res.error.message;
        return;
      }

      if (msg) msg.textContent = "";
      // renderAuth will run via auth state change, but call once here too:
      await renderAuth();
    } catch (err){
      console.error(err);
      if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
    }
  });

  $("logoutBtn")?.addEventListener("click", hardSignOut);
}

// --------------------
// Tabs
// --------------------
function setTab(name){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  const panel = $(`tab-${name}`);
  if (panel) panel.classList.remove("hidden");
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      setTab(btn.dataset.tab);
    });
  });
  $("goPackagesBtn")?.addEventListener("click", ()=>setTab("packages"));
  $("goMessagesBtn")?.addEventListener("click", ()=>setTab("messages"));
}

// --------------------
// Data loaders
// --------------------
async function fetchStats(){
  const { data: pkgs, error: pErr } = await supabase
    .from("packages")
    .select("status");
  if (pErr) throw pErr;

  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("resolved");
  if (mErr) throw mErr;

  const byStatus = {};
  for (const p of (pkgs||[])){
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  }
  const openMsgs = (msgs||[]).filter(x => x.resolved === false).length;

  return {
    total: pkgs?.length || 0,
    in_transit: byStatus["IN_TRANSIT"] || 0,
    ready: byStatus["READY_FOR_PICKUP"] || 0,
    picked: byStatus["PICKED_UP"] || 0,
    arrived: byStatus["ARRIVED_JA"] || 0,
    received: byStatus["RECEIVED"] || 0,
    on_hold: byStatus["ON_HOLD"] || 0,
    openMsgs
  };
}

function renderStats(stats){
  const row = $("statsRow");
  if (!row) return;

  const card = (label, value, sub="") => `
    <div class="stat">
      <div class="stat__label">${escapeHTML(label)}</div>
      <div class="stat__value">${escapeHTML(String(value))}</div>
      ${sub ? `<div class="stat__sub">${escapeHTML(sub)}</div>` : ""}
    </div>
  `;

  row.innerHTML = [
    card("Packages", stats.total, "All"),
    card("In Transit", stats.in_transit, "Status"),
    card("Ready for pickup", stats.ready, "Status"),
    card("Open messages", stats.openMsgs, "Unresolved"),
  ].join("");
}

async function renderOverview(){
  const rp = $("recentPackages");
  const rm = $("recentMessages");

  if (rp){
    const { data, error } = await supabase
      .from("packages")
      .select("tracking,status,updated_at")
      .order("updated_at",{ascending:false})
      .limit(6);
    rp.innerHTML = error ? `<li class="muted">${escapeHTML(error.message)}</li>` :
      (data||[]).map(p=>`<li><strong>${escapeHTML(p.tracking)}</strong> <span class="tag">${escapeHTML(p.status)}</span><div class="muted small">${escapeHTML(fmtDate(p.updated_at))}</div></li>`).join("")
      || `<li class="muted">No packages yet.</li>`;
  }

  if (rm){
    const { data, error } = await supabase
      .from("messages")
      .select("user_id,sender,body,created_at,resolved")
      .order("created_at",{ascending:false})
      .limit(6);
    rm.innerHTML = error ? `<li class="muted">${escapeHTML(error.message)}</li>` :
      (data||[]).map(m=>`<li><span class="tag">${escapeHTML(m.sender)}</span> ${escapeHTML(m.body).slice(0,70)}<div class="muted small">${escapeHTML(fmtDate(m.created_at))}${m.resolved ? " • resolved" : ""}</div></li>`).join("")
      || `<li class="muted">No messages yet.</li>`;
  }
}

// --------------------
// Customers / Packages / Messages / Reports / Roles
// (UNCHANGED from your version below this point)
// --------------------

// Customers
let selectedCustomer = null;

// ... keep everything else EXACTLY as you have it ...
// I am re-pasting the rest of your file unchanged for safety:

async function loadCustomers(){
  const tbody = $("customersBody");
  if (!tbody) return;

  const q = ($("custSearch")?.value || "").trim().toLowerCase();

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .order("created_at",{ascending:false})
    .limit(500);

  if (error){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const filtered = (data||[]).filter(p=>{
    const hay = `${p.full_name||""} ${p.email||""} ${p.phone||""}`.toLowerCase();
    return !q || hay.includes(q);
  });

  tbody.innerHTML = filtered.map(p=>`
    <tr data-id="${escapeHTML(p.id)}">
      <td>${escapeHTML(p.full_name || "—")}</td>
      <td class="muted">${escapeHTML(p.email || "—")}</td>
      <td>${escapeHTML(p.phone || "—")}</td>
      <td><span class="tag">${escapeHTML(p.role || "customer")}</span></td>
      <td>${p.is_active === false ? `<span class="tag tag--warn">Deactivated</span>` : `<span class="tag tag--ok">Active</span>`}</td>
      <td>
        <button class="btn btn--xs btn--ghost" data-act="view">View</button>
        <button class="btn btn--xs btn--ghost" data-act="toggle">${p.is_active === false ? "Activate" : "Deactivate"}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="muted">No customers found.</td></tr>`;

  tbody.querySelectorAll("tr").forEach(tr=>{
    tr.addEventListener("click", async (e)=>{
      const id = tr.getAttribute("data-id");
      const act = e.target?.getAttribute?.("data-act");

      if (act === "toggle"){
        e.preventDefault(); e.stopPropagation();
        if (!isAdmin && !isStaff) return;
        const row = filtered.find(x=>x.id===id);
        const next = !(row?.is_active === false);
        const { error: uErr } = await supabase.from("profiles").update({ is_active: !next }).eq("id", id);
        if (uErr) return alert(uErr.message);
        await loadCustomers();
        if (selectedCustomer?.id === id) await selectCustomer(id);
        return;
      }

      await selectCustomer(id);
    });
  });
}

async function selectCustomer(id){
  const box = $("customerDetail");
  selectedCustomer = null;
  if (box) box.innerHTML = "Loading…";

  const { data: prof, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,phone,address,role,is_active")
    .eq("id", id)
    .maybeSingle();

  if (error){
    if (box) box.innerHTML = `<div class="muted">${escapeHTML(error.message)}</div>`;
    return;
  }
  selectedCustomer = prof;

  const [pk, inv, msg] = await Promise.all([
    supabase.from("packages").select("id,tracking,status,updated_at,store,approved").eq("user_id", id).order("updated_at",{ascending:false}).limit(25),
    supabase.from("invoices").select("id,tracking,file_name,created_at").eq("user_id", id).order("created_at",{ascending:false}).limit(25),
    supabase.from("messages").select("id,sender,body,created_at,resolved").eq("user_id", id).order("created_at",{ascending:false}).limit(25),
  ]);

  if (box){
    box.innerHTML = `
      <div class="stack">
        <div>
          <div class="h3">${escapeHTML(prof.full_name || "—")}</div>
          <div class="muted">${escapeHTML(prof.email || "")}</div>
          <div class="muted small">${escapeHTML(prof.phone || "—")} • ${escapeHTML(prof.address || "No address")}</div>
          <div class="muted small">Role: <strong>${escapeHTML(prof.role || "customer")}</strong> • ${prof.is_active===false ? "Deactivated" : "Active"}</div>
        </div>

        <div class="grid2">
          <div>
            <div class="muted small">Packages</div>
            <ul class="list">
              ${(pk.error ? [`<li class="muted">${escapeHTML(pk.error.message)}</li>`] :
                (pk.data||[]).map(p=>`<li><strong>${escapeHTML(p.tracking)}</strong> <span class="tag">${escapeHTML(p.status)}</span> ${p.approved ? `<span class="tag tag--ok">Approved</span>` : `<span class="tag tag--warn">Pending</span>`}<div class="muted small">${escapeHTML(fmtDate(p.updated_at))}${p.store ? " • "+escapeHTML(p.store):""}</div></li>`))
                .join("") || `<li class="muted">No packages.</li>`}
            </ul>
          </div>

          <div>
            <div class="muted small">Invoices</div>
            <ul class="list">
              ${(inv.error ? [`<li class="muted">${escapeHTML(inv.error.message)}</li>`] :
                (inv.data||[]).map(i=>`<li><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name || "file")}<div class="muted small">${escapeHTML(fmtDate(i.created_at))}</div></li>`))
                .join("") || `<li class="muted">No invoices.</li>`}
            </ul>
          </div>
        </div>

        <div>
          <div class="muted small">Recent messages</div>
          <ul class="list">
            ${(msg.error ? [`<li class="muted">${escapeHTML(msg.error.message)}</li>`] :
              (msg.data||[]).slice(0,10).map(m=>`<li><span class="tag">${escapeHTML(m.sender)}</span> ${escapeHTML(m.body).slice(0,120)}<div class="muted small">${escapeHTML(fmtDate(m.created_at))}${m.resolved ? " • resolved":""}</div></li>`))
              .join("") || `<li class="muted">No messages.</li>`}
          </ul>
        </div>
      </div>
    `;
  }
}

// Packages / Messages / Reports / Roles / Refresh / Init
// (keep your existing code unchanged)

let selectedPackage = null;
let selectedConvoUserId = null;
let lastReportRows = [];

// ... your original functions: loadPackages, fillPackageForm, savePackageEdits,
// loadConversations, renderChatFor, sendStaffMessage, markResolved,
// runReports, exportReports, exportPackages, setupRoles, refreshStatsOnly, refreshAll,
// setupFilters ...

async function refreshStatsOnly(){
  try{
    const stats = await fetchStats();
    renderStats(stats);
  } catch (e){
    console.error(e);
  }
}

async function refreshAll(){
  await refreshStatsOnly();
  await renderOverview();
  await loadCustomers();
  await loadPackages();
  await loadConversations();
}

function setupFilters(){
  $("refreshCustomers")?.addEventListener("click", loadCustomers);
  $("custSearch")?.addEventListener("input", ()=>loadCustomers());

  $("refreshPackages")?.addEventListener("click", loadPackages);
  $("pkgSearch")?.addEventListener("input", ()=>loadPackages());
  $("statusFilter")?.addEventListener("change", ()=>loadPackages());
  $("pkgEditForm")?.addEventListener("submit", savePackageEdits);

  $("refreshMessages")?.addEventListener("click", loadConversations);
  $("msgSearch")?.addEventListener("input", ()=>loadConversations());
  $("msgFilter")?.addEventListener("change", ()=>loadConversations());
  $("adminChatForm")?.addEventListener("submit", sendStaffMessage);
  $("markResolvedBtn")?.addEventListener("click", markResolved);

  $("runReports")?.addEventListener("click", runReports);
  $("exportReports")?.addEventListener("click", exportReports);
  $("exportPackagesBtn")?.addEventListener("click", exportPackages);
  $("exportPackagesBtn")?.addEventListener("click", ()=>{ const q=$("quickMsg"); if(q) q.textContent="Export downloaded."; });
}

function init(){
  setupLogin();
  setupTabs();
  setupFilters();
  setupRoles();

  // ✅ subscribe ONCE, with a guard
  if (!window.__ADMIN_AUTH_SUB__) {
    window.__ADMIN_AUTH_SUB__ = supabase.auth.onAuthStateChange(() => {
      // avoid nested auth->render loops
      setTimeout(renderAuth, 0);
    });
  }

  setTab("overview");
  renderAuth();
}

window.addEventListener("DOMContentLoaded", init);
