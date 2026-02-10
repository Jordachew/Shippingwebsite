// ========================
// CONFIG (PASTE YOUR VALUES)
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// Safe singleton (prevents "already declared" + multi-load issues)
window.__SB__ = window.__SB__ || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabase = window.__SB__;

// Storage buckets
const INVOICE_BUCKET = "invoices";

// Warehouse address (UPDATED)
const WAREHOUSE_ADDRESS_LINES = [
  "3706 NW 16th Street",
  "Lauderhill, Florida 33311"
];

// ========================
// RATES (EDIT)
// ========================
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
  { lbs: 10, jmd: 2950 }
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
  return new Intl.NumberFormat("en-JM", {
    style: "currency",
    currency: "JMD",
    maximumFractionDigits: 0
  }).format(Number(n || 0));
}

function firstNameFrom(fullName, email){
  const name = (fullName || "").trim();
  if(name) return name.split(/\s+/)[0];
  const e = (email || "").trim();
  if(!e) return "Customer";
  return e.split("@")[0] || "Customer";
}

function setYear(){
  const y = $("year");
  if(y) y.textContent = new Date().getFullYear();
}

// ========================
// SHIPPING ADDRESS (Account # + Address)
// ========================
function buildShipToText(profile, email){
  const first = firstNameFrom(profile?.full_name, email);
  const acct = (profile?.customer_no || "SNS-JMXXXX").trim();
  return [
    `${first} — ${acct}`,
    ...WAREHOUSE_ADDRESS_LINES
  ].join("\n");
}

function renderShipTo(profile, email){
  const block = $("shipToBlock");
  const badge = $("accountBadge");
  if(block) block.textContent = buildShipToText(profile, email);

  if(badge){
    const acct = profile?.customer_no ? `Account #: ${profile.customer_no}` : "";
    badge.textContent = acct;
  }
}

async function copyShipTo(){
  const block = $("shipToBlock");
  if(!block) return;
  try{
    await navigator.clipboard.writeText(block.textContent || "");
    const btn = $("copyShipTo");
    if(btn){
      const old = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(()=>{ btn.textContent = old; }, 900);
    }
  }catch(_){
    alert("Copy failed. Please select and copy manually.");
  }
}

// ========================
// CALCULATOR
// ========================
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

    if(!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(valueUSD) || valueUSD < 0){
      result.innerHTML = `<div class="result__big">—</div><div class="result__sub">Please enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(weight);
    const total = rate + fixedFeeJMD;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">Weight used: <strong>${rounded} lb</strong>. Base: ${formatJMD(rate)} + Fee: ${formatJMD(fixedFeeJMD)}.</div>
    `;
  });
}

// ========================
// AUTH TABS
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
function setupLoginRegister(){
  const loginForm = $("loginForm");
  const regForm = $("registerForm");
  const logoutBtn = $("logoutBtn");

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("loginMsg");
    if(msg) msg.textContent = "Signing in...";

    try{
      const email = ($("loginEmail")?.value || "").trim().toLowerCase();
      const password = $("loginPassword")?.value || "";

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if(error){ if(msg) msg.textContent = error.message; return; }

      if(msg) msg.textContent = "";
      await renderAuth();
    }catch(err){
      console.error(err);
      if(msg) msg.textContent = "Sign-in failed. Please try again.";
    }
  });

  regForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("regMsg");
    if(msg) msg.textContent = "Creating account...";

    const full_name = ($("regName")?.value || "").trim();
    const email = ($("regEmail")?.value || "").trim().toLowerCase();
    const password = $("regPassword")?.value || "";

    try{
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name } }
      });

      if(error){ if(msg) msg.textContent = `Signup error: ${error.message}`; return; }

      if(msg) msg.textContent = "Account created. Check your email (if confirmation is enabled), then log in.";
      regForm.reset();
    }catch(err){
      console.error(err);
      if(msg) msg.textContent = "Signup failed. Please try again.";
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    await renderAuth();
  });

  $("copyShipTo")?.addEventListener("click", copyShipTo);
}

// ========================
// DATA: PACKAGES
// ========================
async function renderPackages(filter=""){
  const body = $("pkgBody");
  if(!body) return;

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;

  if(userErr || !user){
    body.innerHTML = `<tr><td colspan="3" class="muted">Please log in.</td></tr>`;
    return;
  }

  let q = supabase
    .from("packages")
    .select("tracking,status,updated_at")
    .order("updated_at", { ascending: false });

  if(filter.trim()){
    q = q.ilike("tracking", `%${filter.trim()}%`);
  }

  const { data, error } = await q;
  if(error){
    body.innerHTML = `<tr><td colspan="3" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  if(!data?.length){
    body.innerHTML = `<tr><td colspan="3" class="muted">No packages found.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => `
    <tr>
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status || "—")}</span></td>
      <td class="muted small">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ""}</td>
    </tr>
  `).join("");
}

function setupPackageSearch(){
  $("pkgSearch")?.addEventListener("input", (e)=> renderPackages(e.target.value || ""));
  $("resetSearch")?.addEventListener("click", ()=> {
    if($("pkgSearch")) $("pkgSearch").value = "";
    renderPackages("");
  });
}

// ========================
// DATA: INVOICE UPLOADS
// ========================
async function renderUploads(){
  const list = $("uploadsList");
  if(!list) return;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if(!user){
    list.innerHTML = `<li class="muted">Log in to see uploads.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,created_at,note")
    .order("created_at", { ascending: false })
    .limit(10);

  if(error){
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }

  if(!data?.length){
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = data.map(i => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name || "file")}</div>
      <div class="muted small">${i.file_type ? escapeHTML(i.file_type) : ""} • ${i.created_at ? new Date(i.created_at).toLocaleString() : ""}${i.note ? ` • ${escapeHTML(i.note)}` : ""}</div>
    </li>
  `).join("");
}

function setupInvoiceUpload(){
  const form = $("invoiceForm");
  if(!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("invMsg");
    if(msg) msg.textContent = "Uploading...";

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if(!user){
      if(msg) msg.textContent = "Please log in.";
      return;
    }

    const tracking = ($("invTracking")?.value || "").trim();
    const note = ($("invNote")?.value || "").trim();
    const fileInput = $("invFile");

    if(!tracking){
      if(msg) msg.textContent = "Tracking ID required.";
      return;
    }
    if(!fileInput?.files?.length){
      if(msg) msg.textContent = "Choose a file.";
      return;
    }

    const file = fileInput.files[0];
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${tracking}/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
    if(up.error){
      if(msg) msg.textContent = up.error.message;
      return;
    }

    const ins = await supabase.from("invoices").insert({
      user_id: user.id,
      tracking,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown",
      note: note || null
    });

    if(ins.error){
      if(msg) msg.textContent = ins.error.message;
      return;
    }

    form.reset();
    if(msg) msg.textContent = "Uploaded.";
    await renderUploads();
  });
}

// ========================
// CHAT (simple)
// ========================
let chatChannel = null;

function openChat(){
  $("chatWidget")?.classList.remove("hidden");
  $("chatWidget")?.setAttribute("aria-hidden","false");
  renderChat().then(setupChatRealtime);
}
function closeChat(){
  $("chatWidget")?.classList.add("hidden");
  $("chatWidget")?.setAttribute("aria-hidden","true");
}

async function renderChat(){
  const body = $("chatBody");
  if(!body) return;

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if(!user){
    body.innerHTML = `<div class="muted small">Log in to chat with support.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if(error){
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data || []).map(m => `
    <div class="bubble ${m.sender === "customer" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "customer" ? "You" : "Support"}</span>
        <span>${m.created_at ? new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : ""}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">Start the conversation.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime(){
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if(!user) return;

  if(chatChannel){
    supabase.removeChannel(chatChannel);
    chatChannel = null;
  }

  chatChannel = supabase
    .channel(`messages:${user.id}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${user.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

async function sendChatMessage(text){
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if(!user) return alert("Please log in to chat.");

  const { error } = await supabase.from("messages").insert({
    user_id: user.id,
    sender: "customer",
    body: text
  });

  if(error) alert(error.message);
}

function setupChatUI(){
  $("chatFab")?.addEventListener("click", openChat);
  $("closeChat")?.addEventListener("click", closeChat);

  $("chatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput");
    const text = (input?.value || "").trim();
    if(!text) return;
    if(input) input.value = "";
    await sendChatMessage(text);
  });
}

// ========================
// AUTH RENDER
// ========================
async function renderAuth(){
  const loginCard = $("loginCard");
  const dashCard = $("dashCard");

  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  const authed = !!user;

  if(loginCard) loginCard.classList.toggle("hidden", authed);
  if(dashCard) dashCard.classList.toggle("hidden", !authed);

  if(!authed){
    if($("adminLink")) $("adminLink").style.display = "none";
    if($("userName")) $("userName").textContent = "Customer";
    if(chatChannel){ supabase.removeChannel(chatChannel); chatChannel = null; }
    return;
  }

  // Pull profile for this user only
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("full_name,role,customer_no")
    .eq("id", user.id)
    .maybeSingle();

  if(profErr){
    console.warn("PROFILE READ ERROR:", profErr);
  }

  const first = firstNameFrom(profile?.full_name, user.email);
  if($("userName")) $("userName").textContent = `${first} — ${user.email}`;

  // admin link visible if staff/admin
  const role = (profile?.role || "").toLowerCase();
  if($("adminLink")) $("adminLink").style.display = (role === "staff" || role === "admin") ? "inline-flex" : "none";

  renderShipTo(profile, user.email);

  await renderPackages("");
  await renderUploads();
}

supabase.auth.onAuthStateChange(async () => {
  await renderAuth();
});

// ========================
// INIT
// ========================
function init(){
  setYear();
  setupAuthTabs();
  setupCalculator();
  setupLoginRegister();
  setupPackageSearch();
  setupInvoiceUpload();
  setupChatUI();
  renderAuth();
}

window.addEventListener("DOMContentLoaded", init);
