// ========================
// Editable business settings
// ========================
const BUSINESS_NAME = "Sueños Shipping & Variety Store";

// === EDIT YOUR RATES HERE (JMD) ===
const rates = [
  { lbs: 1,  jmd: 500 },
  { lbs: 2,  jmd: 850 },
  { lbs: 3,  jmd: 1250 },
  { lbs: 4,  jmd: 1550 },
  { lbs: 5,  jmd: 1900 },
  { lbs: 6,  jmd: 2250 },
  { lbs: 7,  jmd: 2600 },
  { lbs: 8,  jmd: 2950 },
  { lbs: 9,  jmd: 3300 },
  { lbs: 10, jmd: 3650 },
];

const fixedFeeJMD = 500;

// ========================
// Demo auth + data (LOCAL ONLY)
// ========================
// Demo user accounts (front-end only). Replace with real backend auth later.
const DEMO_USERS = [
  { email: "demo@suenos.com", password: "Demo1234", name: "Demo Customer" },
];

// Mock package data per user (front-end only).
const MOCK_PACKAGES = {
  "demo@suenos.com": [
    { tracking: "SSX-1001", status: "Received at warehouse", updated: "Today", notes: "Awaiting invoice." },
    { tracking: "SSX-1002", status: "Processing", updated: "Yesterday", notes: "Consolidation check in progress." },
    { tracking: "SSX-1003", status: "In transit", updated: "2 days ago", notes: "Shipped on schedule." },
    { tracking: "SSX-1004", status: "Ready for pickup", updated: "3 days ago", notes: "Bring ID for pickup." },
  ],
};

// LocalStorage keys
const LS = {
  session: "suenos_session",
  uploads: "suenos_uploads",
  chat: "suenos_chat",
};

// ========================
// Helpers
// ========================
function formatJMD(n){
  return new Intl.NumberFormat("en-JM", { style: "currency", currency: "JMD", maximumFractionDigits: 0 }).format(n);
}
function safeJSONParse(v, fallback){
  try { return JSON.parse(v); } catch { return fallback; }
}
function nowTime(){
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function setYear(){
  const year = document.getElementById("year");
  if(year) year.textContent = new Date().getFullYear();
}

// ========================
// Rates table + calculator
// ========================
function buildRatesTable(){
  const body = document.getElementById("ratesTableBody");
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
  const form = document.getElementById("calcForm");
  const result = document.getElementById("result");
  if(!form || !result) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const weight = parseFloat(document.getElementById("weight").value);
    const valueUSD = parseFloat(document.getElementById("value").value);
    const tariff = (document.getElementById("tariff").value || "").trim();

    if(!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(valueUSD) || valueUSD < 0){
      result.innerHTML = `<div class="result__big">—</div><div class="result__sub">Please enter valid numbers.</div>`;
      return;
    }

    const { rounded, rate } = findRateForWeight(weight);
    const total = rate + fixedFeeJMD;

    result.innerHTML = `
      <div class="result__big">${formatJMD(total)}</div>
      <div class="result__sub">
        Weight used: <strong>${rounded} lb</strong> (rounded up). Base: <strong>${formatJMD(rate)}</strong> + Fee: <strong>${formatJMD(fixedFeeJMD)}</strong>.
        <br/>Declared value: <strong>$${valueUSD.toFixed(2)} USD</strong>${tariff ? ` • Tariff: <strong>${tariff}</strong>` : ""}.
      </div>
    `;
  });
}

// ========================
// Mobile nav
// ========================
function setupMobileNav(){
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");
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
// Demo Login + Dashboard
// ========================
function getSession(){
  return safeJSONParse(localStorage.getItem(LS.session), null);
}
function setSession(s){
  localStorage.setItem(LS.session, JSON.stringify(s));
}
function clearSession(){
  localStorage.removeItem(LS.session);
}
function renderAuth(){
  const loginCard = document.getElementById("loginCard");
  const dashCard = document.getElementById("dashCard");
  const userName = document.getElementById("userName");

  if(!loginCard || !dashCard) return;

  const session = getSession();
  const isAuthed = !!session?.email;

  loginCard.classList.toggle("hidden", isAuthed);
  dashCard.classList.toggle("hidden", !isAuthed);

  if(isAuthed && userName) userName.textContent = session.name || "Customer";

  if(isAuthed){
    renderPackages();
    renderUploads();
  }
}
function setupLogin(){
  const form = document.getElementById("loginForm");
  const msg = document.getElementById("loginMsg");
  const logoutBtn = document.getElementById("logoutBtn");

  if(form){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = (document.getElementById("loginEmail").value || "").trim().toLowerCase();
      const password = document.getElementById("loginPassword").value || "";

      const u = DEMO_USERS.find(x => x.email === email && x.password === password);
      if(!u){
        if(msg) msg.textContent = "Invalid login. Try demo@suenos.com / Demo1234";
        return;
      }

      setSession({ email: u.email, name: u.name });
      if(msg) msg.textContent = "";
      renderAuth();
    });
  }

  if(logoutBtn){
    logoutBtn.addEventListener("click", () => {
      clearSession();
      renderAuth();
    });
  }
}

// Packages
function getUserPackages(email){
  return MOCK_PACKAGES[email] || [];
}
function renderPackages(filter=""){
  const session = getSession();
  const body = document.getElementById("pkgBody");
  if(!session || !body) return;

  const all = getUserPackages(session.email);
  const list = filter
    ? all.filter(p => p.tracking.toLowerCase().includes(filter.toLowerCase().trim()))
    : all;

  if(list.length === 0){
    body.innerHTML = `<tr><td colspan="3" class="muted">No packages found.</td></tr>`;
    return;
  }

  body.innerHTML = list.map(p => `
    <tr data-track="${p.tracking}">
      <td><strong>${p.tracking}</strong></td>
      <td>${statusPill(p.status)}</td>
      <td class="muted">${p.updated}</td>
    </tr>
  `).join("");

  // Click row → modal
  body.querySelectorAll("tr[data-track]").forEach(row => {
    row.addEventListener("click", () => openPackageModal(row.dataset.track));
  });
}
function statusPill(status){
  const s = status.toLowerCase();
  let label = "In progress";
  let tone = "tag";
  if(s.includes("ready")) { label = "Ready"; tone = "tag tag--ok"; }
  else if(s.includes("received")) { label = "Received"; tone = "tag"; }
  else if(s.includes("transit")) { label = "In transit"; tone = "tag"; }
  else if(s.includes("processing")) { label = "Processing"; tone = "tag"; }

  return `<span class="${tone}">${label}</span> <span class="muted small">${status}</span>`;
}
function setupPackageSearch(){
  const search = document.getElementById("pkgSearch");
  const reset = document.getElementById("resetSearch");
  if(search){
    search.addEventListener("input", () => renderPackages(search.value));
  }
  if(reset){
    reset.addEventListener("click", () => {
      if(search) search.value = "";
      renderPackages("");
    });
  }
}

// Modal
function openPackageModal(tracking){
  const session = getSession();
  const modal = document.getElementById("pkgModal");
  const title = document.getElementById("modalTitle");
  const sub = document.getElementById("modalSub");
  const body = document.getElementById("modalBody");
  if(!session || !modal || !title || !sub || !body) return;

  const pkg = getUserPackages(session.email).find(p => p.tracking === tracking);
  if(!pkg) return;

  title.textContent = tracking;
  sub.textContent = pkg.status;

  const uploads = getUploads().filter(u => u.email === session.email && u.tracking.toLowerCase() === tracking.toLowerCase());

  body.innerHTML = `
    <div><strong>Status:</strong> ${pkg.status}</div>
    <div><strong>Last updated:</strong> ${pkg.updated}</div>
    <div style="margin-top:10px;"><strong>Notes:</strong> ${pkg.notes || "—"}</div>

    <div style="margin-top:14px;">
      <strong>Invoices on file (demo):</strong>
      ${uploads.length ? `<ul>${uploads.map(u => `<li>${u.filename} <span class="muted small">(${u.time})</span></li>`).join("")}</ul>` : `<div class="muted small">No uploads yet.</div>`}
    </div>
  `;

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  modal.querySelectorAll("[data-close='1']").forEach(el => {
    el.addEventListener("click", () => closePackageModal(), { once: true });
  });
  document.addEventListener("keydown", escCloseOnce, { once: true });
}
function escCloseOnce(e){
  if(e.key === "Escape") closePackageModal();
}
function closePackageModal(){
  const modal = document.getElementById("pkgModal");
  if(!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

// Invoices (demo local storage)
function getUploads(){
  return safeJSONParse(localStorage.getItem(LS.uploads), []);
}
function setUploads(list){
  localStorage.setItem(LS.uploads, JSON.stringify(list));
}
function renderUploads(){
  const session = getSession();
  const ul = document.getElementById("uploadsList");
  if(!session || !ul) return;

  const uploads = getUploads().filter(u => u.email === session.email).slice().reverse();

  if(uploads.length === 0){
    ul.innerHTML = `<li class="muted">No uploads yet.</li>`;
    return;
  }

  ul.innerHTML = uploads.slice(0, 6).map(u => `
    <li>
      <div><strong>${u.tracking}</strong> • ${u.filename}</div>
      <div class="muted small">${u.time}${u.note ? ` • ${u.note}` : ""}</div>
    </li>
  `).join("");
}
function setupInvoiceUpload(){
  const form = document.getElementById("invoiceForm");
  const msg = document.getElementById("invMsg");
  if(!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const session = getSession();
    if(!session){
      if(msg) msg.textContent = "Please log in first.";
      return;
    }

    const tracking = (document.getElementById("invTracking").value || "").trim();
    const fileInput = document.getElementById("invFile");
    const note = (document.getElementById("invNote").value || "").trim();

    if(!tracking){
      if(msg) msg.textContent = "Tracking ID required.";
      return;
    }
    if(!fileInput?.files?.length){
      if(msg) msg.textContent = "Please choose a file.";
      return;
    }

    const file = fileInput.files[0];

    // DEMO: store only metadata (filename) locally
    const uploads = getUploads();
    uploads.push({
      email: session.email,
      tracking,
      filename: file.name,
      note,
      time: new Date().toLocaleString(),
    });
    setUploads(uploads);

    form.reset();
    if(msg) msg.textContent = "Uploaded (demo). In a real system, this would be saved to the server.";
    renderUploads();
  });
}

// ========================
// Chat (demo local storage)
// ========================
function getChat(){
  return safeJSONParse(localStorage.getItem(LS.chat), []);
}
function setChat(list){
  localStorage.setItem(LS.chat, JSON.stringify(list));
}
function addChatMessage(role, text){
  const session = getSession();
  const who = role === "me" ? (session?.email || "guest") : BUSINESS_NAME;

  const list = getChat();
  list.push({
    role,
    who,
    text,
    time: new Date().toLocaleString(),
    t: nowTime(),
  });
  setChat(list);
  renderChat();

  // Auto-reply demo (so chat feels alive)
  if(role === "me"){
    window.setTimeout(() => {
      const reply = demoSupportReply(text);
      addChatMessage("support", reply);
    }, 600);
  }
}
function demoSupportReply(text){
  const t = text.toLowerCase();
  if(t.includes("rate") || t.includes("cost")) return "For a quick estimate, use the calculator. If you share weight + item type, we can guide you on duties too.";
  if(t.includes("invoice")) return "You can upload invoices in your portal under ‘Upload Invoice’. If you’re not seeing your tracking ID, share it here.";
  if(t.includes("pickup") || t.includes("ready")) return "When your package is ‘Ready for pickup’, bring a valid ID. If someone else is collecting, message us first.";
  if(t.includes("time") || t.includes("how long")) return "Transit time varies by shipment day and processing. Share your tracking ID and we’ll check the latest status.";
  return "Thanks! Share your tracking ID (if you have one) and we’ll help right away.";
}
function renderChat(){
  const body = document.getElementById("chatBody");
  if(!body) return;

  const list = getChat().slice(-60);
  if(list.length === 0){
    body.innerHTML = `<div class="muted small">Start a conversation. We typically reply during business hours.</div>`;
    return;
  }

  body.innerHTML = list.map(m => `
    <div class="bubble ${m.role === "me" ? "me" : ""}">
      <div>${escapeHTML(m.text)}</div>
      <div class="meta">
        <span>${m.role === "me" ? "You" : "Support"}</span>
        <span>${m.t}</span>
      </div>
    </div>
  `).join("");

  body.scrollTop = body.scrollHeight;
}
function escapeHTML(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function openChat(){
  const w = document.getElementById("chatWidget");
  if(!w) return;
  w.classList.remove("hidden");
  w.setAttribute("aria-hidden", "false");
  renderChat();
  const input = document.getElementById("chatInput");
  if(input) input.focus();
}
function closeChat(){
  const w = document.getElementById("chatWidget");
  if(!w) return;
  w.classList.add("hidden");
  w.setAttribute("aria-hidden", "true");
}
function setupChat(){
  const fab = document.getElementById("chatFab");
  const close = document.getElementById("closeChat");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");

  const openButtons = ["openChatTop","openChatCalc","openChatDash","openChatContact","openChatFooter"]
    .map(id => document.getElementById(id))
    .filter(Boolean);

  openButtons.forEach(btn => btn.addEventListener("click", openChat));
  if(fab) fab.addEventListener("click", openChat);
  if(close) close.addEventListener("click", closeChat);

  if(form){
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (input?.value || "").trim();
      if(!text) return;
      if(input) input.value = "";
      addChatMessage("me", text);
    });
  }

  // Seed chat on first load
  const existing = getChat();
  if(existing.length === 0){
    addChatMessage("support", `Hi! Welcome to ${BUSINESS_NAME}. How can we help you today?`);
  } else {
    renderChat();
  }
}

// ========================
// Init
// ========================
function init(){
  setYear();
  buildRatesTable();
  setupCalculator();
  setupMobileNav();

  setupLogin();
  setupPackageSearch();
  setupInvoiceUpload();

  setupChat();

  renderAuth();
}

init();
