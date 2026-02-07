console.log("admin.js loaded, window.supabase:", window.supabase);

// ========================
// SUPABASE CONFIG
// ========================
const SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

// One safe singleton (prevents double-load issues)
window.__ADMIN_SB__ =
  window.__ADMIN_SB__ ||
  window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });

const supabase = window.__ADMIN_SB__;

const INVOICE_BUCKET = "invoices";
const CHAT_BUCKET = "chat_files";

function $(id) { return document.getElementById(id); }
function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function pickupLabel(v) {
  return v === "RHODEN_HALL_CLARENDON" ? "Rhoden Hall District, Clarendon" : "UWI, Kingston";
}

let currentCustomer = null; // { id, email }
let selectedPkg = null;
let chatChannel = null;

function setAuthUI({ authed, staff, email }) {
  const loginCard = $("staffLoginCard");
  const wrap = $("adminWrap");
  const logoutBtn = $("logoutBtn");

  if (loginCard) loginCard.classList.toggle("hidden", authed && staff);
  if (wrap) wrap.classList.toggle("hidden", !(authed && staff));
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !(authed && staff));

  const authMsg = $("authMsg");
  if (authMsg) {
    if (!authed) authMsg.textContent = "Please sign in as staff.";
    else if (!staff) authMsg.textContent = `Signed in as ${email || "user"}, but not staff. Set role='staff' in profiles.`;
    else authMsg.textContent = `Staff access granted (${email || "staff"}).`;
  }
}

async function getMyProfile() {
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) return { ok: false, error: uErr };
  const user = u?.user;
  if (!user) return { ok: false, error: new Error("Not logged in") };

  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("id,email,role,full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (pErr) return { ok: false, error: pErr };
  return { ok: true, user, profile };
}

async function requireStaff() {
  const res = await getMyProfile();
  if (!res.ok) {
    setAuthUI({ authed: false, staff: false });
    return { ok: false, error: res.error };
  }
  const staff = res.profile?.role === "staff";
  setAuthUI({ authed: true, staff, email: res.user.email });
  if (!staff) return { ok: false, error: new Error("Not staff") };
  return { ok: true, user: res.user, profile: res.profile };
}

async function logout() {
  try {
    await supabase.auth.signOut();
  } finally {
    // Hard reset local session so you don't get "login once then stuck"
    try { localStorage.removeItem(`sb-${new URL(SUPABASE_URL).host}-auth-token`); } catch (_) {}
    window.location.reload();
  }
}

async function staffLogin(email, password) {
  const msg = $("staffLoginMsg");
  if (msg) msg.textContent = "Signing in...";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (msg) msg.textContent = error.message;
    return false;
  }
  if (msg) msg.textContent = "";
  return true;
}

async function findCustomer(email) {
  return supabase.from("profiles").select("id,email").eq("email", email).maybeSingle();
}

// --------------------
// Packages
// --------------------
async function renderPackages() {
  const body = $("pkgBody");
  if (!body) return;

  if (!currentCustomer) {
    body.innerHTML = `<tr><td colspan="4" class="muted">Search a customer first.</td></tr>`;
    return;
  }

  const { data, error } = await supabase
    .from("packages")
    .select("tracking,status,pickup,pickup_confirmed,weight_lbs,cost_jmd,updated_at")
    .eq("user_id", currentCustomer.id)
    .order("updated_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHTML(error.message)}</td></tr>`;
    return;
  }
  if (!data?.length) {
    body.innerHTML = `<tr><td colspan="4" class="muted">No packages yet.</td></tr>`;
    return;
  }

  body.innerHTML = data.map(p => `
    <tr
      data-tracking="${escapeHTML(p.tracking)}"
      data-status="${escapeHTML(p.status)}"
      data-pickup="${escapeHTML(p.pickup)}"
      data-pickup_confirmed="${p.pickup_confirmed ? "true" : "false"}"
      data-weight_lbs="${p.weight_lbs ?? ""}"
      data-cost_jmd="${p.cost_jmd ?? ""}"
    >
      <td><strong>${escapeHTML(p.tracking)}</strong></td>
      <td><span class="tag">${escapeHTML(p.status)}</span></td>
      <td>${escapeHTML(pickupLabel(p.pickup))}${p.pickup_confirmed ? ` <span class="tag">Confirmed</span>` : ``}</td>
      <td class="muted">${new Date(p.updated_at).toLocaleString()}</td>
    </tr>
  `).join("");

  body.querySelectorAll("tr[data-tracking]").forEach(row => {
    row.addEventListener("click", () => openUpdateModal(row.dataset));
  });
}

async function createPackage(payload) {
  if (!currentCustomer) { $("createMsg").textContent = "Search a customer first."; return; }
  $("createMsg").textContent = "Creating...";

  const { error } = await supabase.from("packages").insert({
    user_id: currentCustomer.id,
    tracking: payload.tracking,
    status: payload.status,
    pickup: payload.pickup,
    pickup_confirmed: false,
    weight_lbs: payload.weight_lbs || null,
    cost_jmd: payload.cost_jmd || null,
  });

  if (error) { $("createMsg").textContent = error.message; return; }
  $("createMsg").textContent = "Created.";
  await renderPackages();
}

async function updatePackage(tracking, updates, sendEmail) {
  $("updateMsg").textContent = "Saving...";

  // Normalize types
  if (updates.pickup_confirmed === "true") updates.pickup_confirmed = true;
  if (updates.pickup_confirmed === "false") updates.pickup_confirmed = false;

  if (updates.weight_lbs === "") updates.weight_lbs = null;
  if (updates.cost_jmd === "") updates.cost_jmd = null;

  const { error } = await supabase
    .from("packages")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("tracking", tracking);

  if (error) { $("updateMsg").textContent = error.message; return; }

  // If READY_FOR_PICKUP and user requested email:
  if (sendEmail && updates.status === "READY_FOR_PICKUP") {
    try {
      const r = await fetch("/api/notify-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracking })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Email failed");
      $("updateMsg").textContent = "Saved + email sent.";
    } catch (e) {
      $("updateMsg").textContent = `Saved, but email failed: ${e.message}`;
    }
  } else {
    $("updateMsg").textContent = "Saved.";
  }

  // If pickup confirmed, also confirm invoices for that tracking
  if (updates.pickup_confirmed === true) {
    await supabase
      .from("invoices")
      .update({ pickup_confirmed: true })
      .eq("user_id", currentCustomer.id)
      .eq("tracking", tracking);
  }

  await renderPackages();
  await renderInvoices();
}

async function bulkUpload(csvText) {
  if (!currentCustomer) { $("bulkMsg").textContent = "Search a customer first."; return; }

  const lines = csvText.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) { $("bulkMsg").textContent = "Paste at least one line."; return; }

  $("bulkMsg").textContent = "Uploading...";

  // Format: tracking,status,pickup,weight_lbs,cost_jmd
  const rows = lines.map(line => {
    const [tracking, status, pickup, weight, cost] = line.split(",").map(x => x?.trim());
    return {
      user_id: currentCustomer.id,
      tracking,
      status: status || "RECEIVED",
      pickup: pickup || "UWI_KINGSTON",
      pickup_confirmed: false,
      weight_lbs: weight ? Number(weight) : null,
      cost_jmd: cost ? Number(cost) : null
    };
  }).filter(r => r.tracking);

  const { error } = await supabase.from("packages").insert(rows);
  if (error) { $("bulkMsg").textContent = error.message; return; }

  $("bulkMsg").textContent = `Uploaded ${rows.length} packages.`;
  await renderPackages();
}

function openUpdateModal(ds) {
  selectedPkg = ds.tracking;

  $("mTitle").textContent = `Update ${ds.tracking}`;
  $("mStatus").value = ds.status || "RECEIVED";
  $("mPickup").value = ds.pickup || "UWI_KINGSTON";
  $("mPickupConfirmed").value = ds.pickup_confirmed || "false";
  $("mWeight").value = ds.weight_lbs || "";
  $("mCost").value = ds.cost_jmd || "";
  $("mSendEmail").value = "no";
  $("updateMsg").textContent = "";

  $("updateModal").classList.remove("hidden");
  $("updateModal").setAttribute("aria-hidden", "false");

  $("updateModal").querySelectorAll("[data-close='1']").forEach(el => {
    el.addEventListener("click", closeUpdateModal, { once: true });
  });
}
function closeUpdateModal() {
  $("updateModal").classList.add("hidden");
  $("updateModal").setAttribute("aria-hidden", "true");
  selectedPkg = null;
}

// --------------------
// Invoices
// --------------------
async function renderInvoices() {
  const list = $("invoiceList");
  if (!list) return;

  if (!currentCustomer) {
    list.innerHTML = `<li class="muted">Search a customer first.</li>`;
    return;
  }

  const { data, error } = await supabase
    .from("invoices")
    .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    list.innerHTML = `<li class="muted">${escapeHTML(error.message)}</li>`;
    return;
  }
  if (!data?.length) {
    list.innerHTML = `<li class="muted">No invoices uploaded yet.</li>`;
    return;
  }

  list.innerHTML = data.map(i => `
    <li>
      <div><strong>${escapeHTML(i.tracking)}</strong> • ${escapeHTML(i.file_name)} (${escapeHTML(i.file_type)})</div>
      <div class="muted small">
        Pickup: ${escapeHTML(pickupLabel(i.pickup))} • ${i.pickup_confirmed ? "Confirmed" : "Pending"} • ${new Date(i.created_at).toLocaleString()}
        ${i.note ? ` • ${escapeHTML(i.note)}` : ""}
      </div>
    </li>
  `).join("");
}

// --------------------
// Chat
// --------------------
async function renderChat() {
  const body = $("chatBody");
  if (!body) return;

  if (!currentCustomer) {
    body.innerHTML = `<div class="muted small">Search a customer to view chat.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id,sender,body,created_at")
    .eq("user_id", currentCustomer.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    body.innerHTML = `<div class="muted small">${escapeHTML(error.message)}</div>`;
    return;
  }

  body.innerHTML = (data?.length ? data : []).map(m => `
    <div class="bubble ${m.sender === "staff" ? "me" : ""}">
      <div>${escapeHTML(m.body)}</div>
      <div class="meta">
        <span>${m.sender === "staff" ? "Support" : "Customer"}</span>
        <span>${new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </div>
  `).join("") || `<div class="muted small">No messages yet.</div>`;

  body.scrollTop = body.scrollHeight;
}

async function setupChatRealtime() {
  if (chatChannel) { supabase.removeChannel(chatChannel); chatChannel = null; }
  if (!currentCustomer) return;

  chatChannel = supabase
    .channel(`staff_messages:${currentCustomer.id}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `user_id=eq.${currentCustomer.id}` },
      async () => { await renderChat(); }
    )
    .subscribe();
}

async function sendStaff(text, file) {
  if (!currentCustomer) return alert("Search customer first.");

  const { data: msg, error: mErr } = await supabase
    .from("messages")
    .insert({ user_id: currentCustomer.id, sender: "staff", body: text })
    .select("id")
    .single();

  if (mErr) return alert(mErr.message);

  if (file) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${currentCustomer.id}/messages/${Date.now()}_${safeName}`;

    const up = await supabase.storage.from(CHAT_BUCKET).upload(path, file, { upsert: false });
    if (up.error) return alert(up.error.message);

    const ins = await supabase.from("message_attachments").insert({
      message_id: msg.id,
      user_id: currentCustomer.id,
      file_path: path,
      file_name: safeName,
      file_type: file.type || "unknown"
    });

    if (ins.error) return alert(ins.error.message);
  }
}

// --------------------
// Init
// --------------------
async function init() {
  $("logoutBtn")?.addEventListener("click", logout);

  $("staffLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("staffEmail").value.trim().toLowerCase();
    const password = $("staffPassword").value;

    const ok = await staffLogin(email, password);
    if (!ok) return;

    const gate = await requireStaff();
    if (gate.ok) {
      // ready
    }
  });

  // Gate UI on load
  const gate = await requireStaff();
  if (!gate.ok) return;

  $("findForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("findMsg").textContent = "Searching...";
    const email = $("custEmail").value.trim().toLowerCase();

    const { data, error } = await findCustomer(email);
    if (error || !data) {
      $("findMsg").textContent = error?.message || "Customer not found.";
      currentCustomer = null;
      $("custId").textContent = "—";
      await renderPackages();
      await renderInvoices();
      await renderChat();
      return;
    }

    currentCustomer = { id: data.id, email: data.email };
    $("custId").textContent = data.id;
    $("findMsg").textContent = `Found: ${data.email}`;
    await renderPackages();
    await renderInvoices();
    await renderChat();
    await setupChatRealtime();
  });

  $("createPkgForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await createPackage({
      tracking: $("tracking").value.trim(),
      status: $("status").value,
      pickup: $("pickup").value,
      weight_lbs: $("weight").value.trim(),
      cost_jmd: $("cost").value.trim(),
    });
    e.target.reset();
  });

  $("bulkForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await bulkUpload($("bulkText").value);
  });

  $("updateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedPkg) return;
    const sendEmail = $("mSendEmail").value === "yes";
    await updatePackage(selectedPkg, {
      status: $("mStatus").value,
      pickup: $("mPickup").value,
      pickup_confirmed: $("mPickupConfirmed").value,
      weight_lbs: $("mWeight").value.trim(),
      cost_jmd: $("mCost").value.trim(),
    }, sendEmail);
  });

  $("chatForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ($("chatInput").value || "").trim();
    const file = $("chatFile")?.files?.[0] || null;
    if (!text && !file) return;

    $("chatInput").value = "";
    if ($("chatFile")) $("chatFile").value = "";

    await sendStaff(text || "(Attachment)", file);
  });

  // initial empties
  await renderPackages();
  await renderInvoices();
  await renderChat();
}

supabase.auth.onAuthStateChange(async () => {
  // Re-gate UI if auth changes (login/logout)
  await requireStaff();
});

window.addEventListener("DOMContentLoaded", init);
