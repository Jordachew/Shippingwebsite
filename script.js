// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_i99PVgfeQkRvtjnemX6V9w_wd97XPng";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const INVOICE_BUCKET = "invoices";

// ========================
// RATES (EDIT)
// ========================
const rates = [
  { lbs: 1, jmd: 500 },
  { lbs: 2, jmd: 850 },
  { lbs: 3, jmd: 1250 },
  { lbs: 4, jmd: 1350 },
  { lbs: 5, jmd: 1600 },
  { lbs: 6, jmd: 1950 },
  { lbs: 7, jmd: 2150 },
  { lbs: 8, jmd: 2350 },
  { lbs: 9, jmd: 2600 },
  { lbs: 10, jmd: 2950 },
];
const fixedFeeJMD = 500;

// ========================
// HELPERS
// ========================
function $(id){ return document.getElementById(id); }
function escapeHTML(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function formatJMD(n){
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(n);
}
function setYear(){ const y = $("year"); if(y) y.textContent = new Date().getFullYear(); }

// ========================
// RATES + CALCULATOR
// ========================
function buildRatesTable(){
  const body = $("ratesTableBody");
  if(!body) return;
  body.innerHTML = rates.map(r => `<tr><td>${r.lbs}</td><td>${formatJMD(r.jmd)}</td></tr>`).join("");
}
function findRateForWeight(weightLbs){
  const rounded = Math.ceil(weightLbs);
  const match = rates.find(r => r.lbs === rounded);
  if(match) return { rounded, rate: match.jmd };
  const last = rates[rates.length - 1];
  const prev = rates[rates.length - 2] || last;
  const step = Math.max(0, last.jmd - prev.jmd);
  const extraLbs = Math.max(0, rounded - last.lbs);
  return { rounded, rate: last.jmd + (extraLbs * step) };
}
function setupCalculator(){
  const form = $("calcForm");
  const result = $("result");
  if(!form || !result) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const weight = parseFloat($("weight")?.value);
    const valueUSD = parseFloat($("value")?.value);
    const tariff = ($("tariff")?.value || "").trim();

    if(!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(valueUSD) || valueUSD < 0){
      result.innerHTML = `<div class="result__big">—</div><div class="result__sub">Please enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(weight);
    const total = rate + fixedFeeJMD;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">
        Weight used: <strong>${rounded} lb</strong>. Base: <strong>${formatJMD(rate)}</strong> + Fee: <strong>${formatJMD(fixedFeeJMD)}</strong>.
        <br/>Declared value: <strong>$${valueUSD.toFixed(2)} USD</strong>${tariff ? ` • Tariff: <strong>${escapeHTML(tariff)}</strong>` : ""}.
      </div>
    `;
  });
}

// ========================
// NAV (mobile)
// ========================
function setupMobileNav(){
  const toggle = $("navToggle");
  const nav = $("nav");
  if(!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const isOpen = nav.style.display === "flex";
    nav.style.display = isOpen ? "none" : "flex";
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    if(window.matchMedia("(max-width: 720px)").matches){
      nav.style.display = "none";
      toggle.setAttribute("aria-expanded", "false");
    }
  }));
}

// ========================
// AUTH TABS (REGISTER FIX)
// ========================
function setupAuthTabs(){
  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");
  const loginPane = $("loginPane");
  const registerPane = $("registerPane");
  if(!tabLogin || !tabRegister || !loginPane || !registerPane) return;

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
// LOGIN / REGISTER
// ========================
function setupLogin(){
  const form = $("loginForm");
  const msg = $("loginMsg");
  const logoutBtn = $("logoutBtn");

  if(form){
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if(msg) msg.textContent = "Signing in...";
      const email = ($("loginEmail")?.value || "").trim().toLowerCase();
      const password = $("loginPassword")?.value || "";

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if(error){ if(msg) msg.textContent = error.message; return; }
      if(msg) msg.textContent = "";
      await renderAuth();
    });
  }

  if(logoutBtn){
    logoutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
      await renderAuth();
    });
  }
}

function setupRegister(){
  const form = $("registerForm");
  const msg = $("regMsg");
  if(!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(msg) msg.textContent = "Creating account...";

    const full_name = ($("regName")?.value || "").trim();
    const email = ($("regEmail")?.value || "").trim().toLowerCase();
    const password = $("regPassword")?.value || "";

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name } }
    });

    if(error){ if(msg) msg.textContent = error.message; return; }
    if(msg) msg.textContent = "Account created. Check email for confirmation (if enabled), then log in.";
    form.reset();
  });
}

// ========================
// PACKAGES
// ========================
async function renderPackages(filter=""){
  const body = $("pkgBody");
  if(!body) return;

  const { data: { user } } = await supabase.auth.getUser();
  if(!user){
    body.innerHTML = `<tr><td colspan="3" class="muted">Please log in.</td></tr>`;
    return;
  }

  let query = supabase
    .from("packages")
    .select("tracking,status,updated_at,notes")
    .order("updated_at", { ascending: false });

  if(filter.trim()){
    query = query.ilike("tracking", `%${filter.trim()}%`);
  }

  const { data, error } = await query;
  if(error){
    body.innerHTML = `<tr><td colspan="3" class="muted">Error: ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if(!data || data.length === 0){
    body.innerHTML = `<tr><td colspan="3" class="muted">No packages found.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => {
    const updated = new Date(p.updated_at).toLocaleString();
    return `
      <tr data-track="${escapeHTML(p.tracking)}" data-status="${escapeHTML(p.status)}" data-notes="${escapeHTML(p.notes || "")}" data-updated="${escapeHTML(updated)}">
        <td><strong>${escapeHTML(p.tracking)}</strong></td>
        <td><span class="tag">${escapeHTML(p.status)}</span></td>
        <td class="muted">${escapeHTML(updated)}</td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll("tr[data-track]").forEach(row => {
    row.addEventListener("click", () => openPackageModal(row.dataset));
  });
}

function openPackageModal(ds){
  const modal = $("pkgModal");
  const title = $("modalTitle");
  const sub = $("modalSub");
  const body = $("modalBody");
  if(!modal || !title || !sub || !body) return;

  title.textContent = ds.track || "Package";
  sub.textContent = ds.status || "";

  body.innerHTML = `
    <div><strong>Status:</strong> ${escapeHTML(ds.status || "—")}</div>
    <div><strong>Last updated:</strong> ${escapeHTML(ds.updated || "—")}</div>
    <div style="margin-top:10px;"><strong>Notes:</strong> ${escapeHTML(ds.notes || "—")}</div>
  `;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  modal.querySelectorAll("[data-close='1']").forEach(el => {
    el.addEventListener("click", closePackageModal, { once:true });
  });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape") closePackageModal(); }, { once:true });
}

function closePackageModal(){
  const modal = $("pkgModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function setupPackageSearch(){
  const search = $("pkgSearch");
  const reset = $("resetSearch");
  if(search) search.addEventListener("input", () => renderPackages(search.value));
  if(reset) reset.addEventListener("click", () => { search.value=""; renderPackages(""); });
}

// ========================
// INVOICES
// ========================
async function renderUploads(){
  const ul = $("uploadsList");
  if(!ul) return;

  const { data: { user } } = await supabase.auth.getUser();
  if(!user){ ul.innerHTML = `<li class="muted">Log in to see uploads.</li>`; return; }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,created_at,note")
    .order("created_at", { ascending:false })
    .limit(10);

  if(error){ ul.innerHTML = `<li class="muted">Error: ${escapeHTML(error.message)}</li>`; return; }
  if(!data || data.length === 0){ ul.innerHTML = `<li class="muted">No uploads yet.</li>`; return; }

  ul.innerHTML = data.map(u => `
    <li>
      <div><strong>${escapeHTML(u.tracking)}</strong> • ${escapeHTML(u.file_name)}</div>
      <div class="muted small">${new Date(u.created_at).toLocaleString()}${u.note ? ` • ${escapeHTML(u.note)}` : ""}</div>
    </li>
  `).join("");
}

function setupInvoiceUpload(){
  const form = $("invoiceForm");
  const msg = $("invMsg");
  if(!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(msg) msg.textContent = "Uploading...";

    const { data: { user } } = await supabase.auth.getUser();
    if(!user){ if(msg) msg.textContent = "Please log in first."; return; }

    const tracking = ($("invTracking")?.value || "").trim();
    const fileInput = $("invFile");
    const note = ($("invNote")?.value || "").trim();

    if(!tracking){ if(msg) msg.textContent = "Tracking ID required."; return; }
    if(!fileInput?.files?.length){ if(msg) msg.textContent = "Please choose a file."; return; }

    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { cacheControl:"3600", upsert:false });
    if(up.error){ if(msg) msg.textContent = up.error.message; return; }

    const ins = await supabase.from("invoices").insert({
      user_id: user.id,
      tracking,
      file_path: path,
      file_name: safeName,
      note: note || null
    });

    if(ins.error){ if(msg) msg.textContent = ins.error.message; return; }

    form.reset();
    if(msg) msg.textContent = "Invoice uploaded successfully.";
    await renderUploads();
  });
}

// ========================
// CHAT (REALTIME)
// ========================
let chatChannel = null;

async function renderChat(){
  const body = $("chatBody");
  if(!body) return;

  const { data: { user } } = await supabase.auth.getUser();
  if(!user){ body.innerHTML = `<div class="muted small">Log in to chat with support.</div>`; return; }

  const { data, error } = await supabase
    .from("messages")
    .select("sender,body,created_at")
    .order("created_at", { ascending:true })
    .limit(200);

  if(error){ body.innerHTML = `<div class="muted small">Error: ${escapeHTML(error.message)}</div>`; return; }
  if(!data || data.length === 0){
    body.innerHTML = `<div class="muted small">Start the conversation. We typically reply during business hours.</div>`;
    return;
  }

  body.innerHTML = data.map(m => `
    <div class="bubble ${m.sender === "customer" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "customer" ? "You" : "Support"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</span>
      </div>
    </div>
  `).join("");

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime(){
  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return;

  if(chatChannel){ supabase.removeChannel(chatChannel); chatChannel = null; }

  chatChannel = supabase
    .channel(`messages:${user.id}`)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"messages", filter:`user_id=eq.${user.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

function openChat(){
  const w = $("chatWidget");
  if(!w) return;
  w.classList.remove("hidden");
  w.setAttribute("aria-hidden","false");
  renderChat().then(setupChatRealtime);
  $("chatInput")?.focus();
}
function closeChat(){
  const w = $("chatWidget");
  if(!w) return;
  w.classList.add("hidden");
  w.setAttribute("aria-hidden","true");
}

function setupChatUI(){
  const fab = $("chatFab");
  const close = $("closeChat");
  const form = $("chatForm");
  const input = $("chatInput");

  const openButtons = ["openChatTop","openChatCalc","openChatDash","openChatContact","openChatFooter"]
    .map(id => $(id)).filter(Boolean);

  openButtons.forEach(btn => btn.addEventListener("click", openChat));
  fab?.addEventListener("click", openChat);
  close?.addEventListener("click", closeChat);

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = (input?.value || "").trim();
    if(!text) return;

    const { data: { user } } = await supabase.auth.getUser();
    if(!user){ alert("Please log in to send messages."); return; }

    input.value = "";
    const { error } = await supabase.from("messages").insert({ user_id:user.id, sender:"customer", body:text });
    if(error) alert(error.message);
  });
}

// ========================
// AUTH RENDER + ADMIN LINK
// ========================
async function renderAuth(){
  const loginCard = $("loginCard");
  const dashCard = $("dashCard");
  const userName = $("userName");
  const adminLink = $("adminLink");

  const { data: { user } } = await supabase.auth.getUser();
  const isAuthed = !!user;

  loginCard?.classList.toggle("hidden", isAuthed);
  dashCard?.classList.toggle("hidden", !isAuthed);

  if(!isAuthed){
    if(chatChannel){ supabase.removeChannel(chatChannel); chatChannel = null; }
    if(adminLink) adminLink.style.display = "none";
    return;
  }

  const { data: profile } = await supabase.from("profiles").select("full_name,email,role").single();
  if(userName) userName.textContent = profile?.full_name || user.email || "Customer";

  if(adminLink){
    adminLink.style.display = (profile?.role === "staff") ? "inline-flex" : "none";
  }

  await renderPackages("");
  await renderUploads();
  await renderChat();
  await setupChatRealtime();
}

supabase.auth.onAuthStateChange(async () => { await renderAuth(); });

// ========================
// INIT (DOMContentLoaded FIX)
// ========================
function init(){
  setYear();
  buildRatesTable();
  setupCalculator();
  setupMobileNav();
  setupAuthTabs();
  setupLogin();
  setupRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();
  renderAuth();
}

window.addEventListener("DOMContentLoaded", () => {
  init();
});
