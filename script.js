(function () {
  "use strict";

  // ============================================================
  // Sueños Shipping — Customer Portal script.js (Stable Build)
  // Fixes:
  //  - "only sign in once" (stale token sanitizer + safe session checks)
  //  - "register stuck" (always shows returned error; never hangs)
  //  - rates list rendering (shows full rate table)
  //  - chat realtime + polling fallback
  //  - no global redeclare conflicts (IIFE scoped)
  // ============================================================

  // ------------------------
  // SUPABASE CONFIG
  // ------------------------
  var SUPABASE_URL = "https://ykpcgcjudotzakaxgnxh.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcGNnY2p1ZG90emFrYXhnbnhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTQ5ODMsImV4cCI6MjA4NTc5MDk4M30.PPh1QMU-eUI7N7dy0W5gzqcvSod2hKALItM7cyT0Gt8";

  var INVOICE_BUCKET = "invoices";
  var CHAT_BUCKET = "chat_files";

  var HOURS_TEXT = "Mon–Fri 10:00 AM–5:00 PM. After hours, we reply next business day.";

  // Warehouse address (display only)
  var WAREHOUSE_LINES = ["3706 NW 16th Street", "Lauderhill, Florida 33311"];

  // ------------------------
  // CALCULATOR RATES
  // ------------------------
  var fixedFeeJMD = 500;
  var rates = [
    { lbs: 1, jmd: 500 },
    { lbs: 2, jmd: 850 },
    { lbs: 3, jmd: 1250 },
    { lbs: 4, jmd: 1550 },
    { lbs: 5, jmd: 1900 },
    { lbs: 6, jmd: 2250 },
    { lbs: 7, jmd: 2600 },
    { lbs: 8, jmd: 2950 },
    { lbs: 9, jmd: 3300 },
    { lbs: 10, jmd: 3650 }
  ];

  // ------------------------
  // DOM HELPERS
  // ------------------------
  function $(id) { return document.getElementById(id); }
  function escapeHTML(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function formatJMD(n) {
    return new Intl.NumberFormat("en-JM", {
      style: "currency", currency: "JMD", maximumFractionDigits: 0
    }).format(Number(n || 0));
  }
  function pickupLabel(v) {
    // Backward compatible labels for legacy codes
    if (!v) return "";
    if (v === "RHODEN_HALL_CLARENDON") return "Rhoden Hall, Clarendon";
    if (v === "UWI_KINGSTON") return "UWI, Kingston";
    return String(v);
  }

  let __pickupLocationsCache = null;

  async function getPickupLocations() {
    // Try pulling from `locations` table (recommended). If missing or empty, fall back.
    if (__pickupLocationsCache) return __pickupLocationsCache;

    const fallback = [
      { value: "UWI_KINGSTON", label: "UWI, Kingston" },
      { value: "RHODEN_HALL_CLARENDON", label: "Rhoden Hall, Clarendon" },
    ];

    try {
      const res = await sb.from("locations").select("id,name,is_active").eq("is_active", true).order("name");
      if (res.error) {
        __pickupLocationsCache = fallback;
        return __pickupLocationsCache;
      }
      const rows = (res.data || []).filter(r => r && r.name);
      if (!rows.length) {
        __pickupLocationsCache = fallback;
        return __pickupLocationsCache;
      }
      // Store name as the value (since packages.pickup is text)
      __pickupLocationsCache = rows.map(r => ({ value: r.name, label: r.name }));
      return __pickupLocationsCache;
    } catch (e) {
      __pickupLocationsCache = fallback;
      return __pickupLocationsCache;
    }
  }

  function pickupOptionsHtml(currentValue, locations) {
    const cur = String(currentValue || "");
    const opts = (locations && locations.length ? locations : []);
    // include legacy options if the current value is a legacy code so it can remain selected
    const legacy = [
      { value: "UWI_KINGSTON", label: "UWI, Kingston" },
      { value: "RHODEN_HALL_CLARENDON", label: "Rhoden Hall, Clarendon" },
    ];
    const needsLegacy = legacy.some(o => o.value === cur) && !opts.some(o => o.value === cur);
    const finalOpts = needsLegacy ? legacy.concat(opts) : opts;

    return finalOpts.map(o => {
      const sel = (o.value === cur) ? "selected" : "";
      return `<option value="${escapeHTML(o.value)}" ${sel}>${escapeHTML(o.label)}</option>`;
    }).join("");
  }

  function firstName(fullName, email) {
    var fn = String(fullName || "").trim().split(/\s+/)[0];
    if (fn) return fn;
    return (String(email || "Customer").split("@")[0] || "Customer");
  }

  // ------------------------
  // SUPABASE CLIENT (singleton)
  // ------------------------
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase library missing. Ensure supabase.min.js loads before script.js");
  }

  window.__SB__ = window.__SB__ || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  var sb = window.__SB__;

  function getProjectRef() {
    try { return new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { return ""; }
  }
  function clearSupabaseAuthToken() {
    try {
      var ref = getProjectRef();
      if (ref) localStorage.removeItem("sb-" + ref + "-auth-token");
    } catch (_) {}
  }

  async function safeGetSession() {
    try {
      var res = await sb.auth.getSession();
      return { session: res?.data?.session || null, error: null };
    } catch (e) {
      return { session: null, error: e };
    }
  }

  // If token exists but session is missing, clear it once and reload.
  async function sanitizeStaleTokenOnce() {
    var onceKey = "cust_sanitize_once";
    if (sessionStorage.getItem(onceKey) === "1") return;

    var ref = getProjectRef();
    var tokenKey = ref ? ("sb-" + ref + "-auth-token") : null;
    var tokenExists = tokenKey ? !!localStorage.getItem(tokenKey) : false;

    var s = await safeGetSession();
    if (s.error) return;

    if (tokenExists && !s.session) {
      sessionStorage.setItem(onceKey, "1");
      clearSupabaseAuthToken();
      location.reload();
    }
  }

  // ------------------------
  // NAV + AUTH TABS
  // ------------------------
  function setupMobileNav() {
    var toggle = $("navToggle");
    var nav = $("nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.style.display === "flex";
      nav.style.display = open ? "none" : "flex";
    });
  }

  function setupAuthTabs() {
    var tabLogin = $("tabLogin");
    var tabRegister = $("tabRegister");
    var loginPane = $("loginPane");
    var registerPane = $("registerPane");
    if (!tabLogin || !tabRegister || !loginPane || !registerPane) return;

    function setTab(which) {
      var isLogin = which === "login";
      tabLogin.classList.toggle("active", isLogin);
      tabRegister.classList.toggle("active", !isLogin);
      loginPane.classList.toggle("hidden", !isLogin);
      registerPane.classList.toggle("hidden", isLogin);
    }

    tabLogin.addEventListener("click", function () { setTab("login"); });
    tabRegister.addEventListener("click", function () { setTab("register"); });
  }

  // ------------------------
  // RATES TABLE RENDER
  // ------------------------
  function renderRatesTable() {
    var host = $("ratesList");
    if (!host) return;

    var rows = rates.map(function (r) {
      return "<tr><td>" + r.lbs + " lb</td><td><strong>" + formatJMD(r.jmd) + "</strong></td></tr>";
    }).join("");

    host.innerHTML =
      '<div class="card card--pad">' +
        '<h3>Rate Chart</h3>' +
        '<p class="muted small">Base rate by weight. Final total = base rate + ' + formatJMD(fixedFeeJMD) + ' fee.</p>' +
        '<div class="tableWrap">' +
          '<table class="table">' +
            '<thead><tr><th>Weight</th><th>Base Rate</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  // ------------------------
  // CALCULATOR
  // ------------------------
  function findRateForWeight(weightLbs) {
    var rounded = Math.ceil(weightLbs);
    var match = rates.find(function (r) { return r.lbs === rounded; });
    if (match) return { rounded: rounded, rate: match.jmd };

    var last = rates[rates.length - 1];
    var prev = rates[rates.length - 2] || last;
    var step = Math.max(0, last.jmd - prev.jmd);
    return { rounded: rounded, rate: last.jmd + (rounded - last.lbs) * step };
  }

  function setupCalculator() {
    var form = $("calcForm");
    var result = $("result");
    if (!form || !result) return;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var w = parseFloat($("weight")?.value);
      var v = parseFloat($("value")?.value);

      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(v) || v < 0) {
        result.innerHTML = '<div class="result__big">—</div><div class="result__sub">Enter valid numbers.</div>';
        return;
      }

      var rr = findRateForWeight(w);
      var total = rr.rate + fixedFeeJMD;

      result.innerHTML =
        '<div class="result__big">' + formatJMD(total) + '</div>' +
        '<div class="result__sub">Weight used: <strong>' + rr.rounded + ' lb</strong>. Base: ' +
        formatJMD(rr.rate) + ' + Fee: ' + formatJMD(fixedFeeJMD) + '.</div>';
    });
  }

  // ------------------------
  // PROFILE HELPERS (safe)
  // ------------------------
  async function ensureProfileSafe(full_name, phone) {
    // Never throw: return {ok, profile?, error?}
    try {
      var u = await sb.auth.getUser();
      var user = u?.data?.user;
      if (!user) return { ok: false, error: new Error("Not logged in") };

      // Read profile
      var pr = await sb.from("profiles")
        .select("id,email,full_name,phone,role,customer_no")
        .eq("id", user.id)
        .maybeSingle();

      if (!pr.error && pr.data) {
        var patch = {};
        if (full_name && !pr.data.full_name) patch.full_name = full_name;
        if (phone && !pr.data.phone) patch.phone = phone;
        if (Object.keys(patch).length) {
          await sb.from("profiles").update(patch).eq("id", user.id);
        }
        return { ok: true, profile: pr.data };
      }

      // Insert minimal; if columns missing, fallback
      var rowTry = { id: user.id, email: user.email, full_name: full_name || "", phone: phone || "" };
      var ins = await sb.from("profiles").insert(rowTry);
      if (ins.error) {
        var ins2 = await sb.from("profiles").insert({ id: user.id, email: user.email });
        if (ins2.error) return { ok: false, error: ins2.error };
      }

      var pr2 = await sb.from("profiles")
        .select("id,email,full_name,phone,role,customer_no")
        .eq("id", user.id)
        .maybeSingle();

      if (pr2.error) return { ok: false, error: pr2.error };
      return { ok: true, profile: pr2.data || null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function renderShipTo(profile, email) {
    var el = $("shipToBlock");
    if (!el) return;
    var fn = String(profile?.full_name || '').trim() || firstName(profile?.full_name, email);
    var acct = profile?.customer_no || "SNS-JMXXXX";
    el.textContent = [fn + " — " + acct].concat(WAREHOUSE_LINES).join("\n");
  }

  // ------------------------
  // LOGIN / REGISTER
  // ------------------------
  function setupLoginRegister() {
    var loginForm = $("loginForm");
    var regForm = $("registerForm");

    loginForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      var msg = $("loginMsg");
      if (msg) msg.textContent = "Signing in...";

      try {
        var email = ($("loginEmail")?.value || "").trim().toLowerCase();
        var password = $("loginPassword")?.value || "";

        var res = await sb.auth.signInWithPassword({ email: email, password: password });
        if (res.error) {
          if (msg) msg.textContent = "Login error: " + res.error.message;
          return;
        }

        var sess = await safeGetSession();
        if (!sess.session) {
          if (msg) msg.textContent = "Logged in but no session returned. If email confirmation is ON, confirm email then log in.";
          return;
        }

        await ensureProfileSafe("", "");
        if (msg) msg.textContent = "";
        await renderAuth();
      } catch (err) {
        console.error(err);
        if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
      }
    });

    regForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      var msg = $("regMsg");
      if (msg) msg.textContent = "Creating account...";

      try {
        var full_name = ($("regName")?.value || "").trim();
        var phone = ($("regPhone")?.value || "").trim();
        var email = ($("regEmail")?.value || "").trim().toLowerCase();
        var password = $("regPassword")?.value || "";

        var res = await sb.auth.signUp({
          email: email,
          password: password,
          options: { data: { full_name: full_name, phone: phone } }
        });

        if (res.error) {
          if (msg) msg.textContent = "Signup error: " + res.error.message;
          return;
        }

        // If email confirmation OFF, we may already have a session
        var sess = await safeGetSession();
        if (sess.session) {
          await ensureProfileSafe(full_name, phone);
          if (msg) msg.textContent = "Account created. You can now log in.";
        } else {
          if (msg) msg.textContent = "Account created. Please check your email to confirm, then log in.";
        }

        regForm.reset();
      } catch (err) {
        console.error(err);
        if (msg) msg.textContent = "Unexpected error: " + (err?.message || String(err));
      }
    });

    $("logoutBtn")?.addEventListener("click", async function () {
      try { await sb.auth.signOut(); } catch (_) {}
      clearSupabaseAuthToken();
      await renderAuth();
    });
  }

  // ------------------------
  // PACKAGES + INVOICES
  // ------------------------
  async function renderPackages(filter) {
    filter = filter || "";
    var body = $("pkgBody");
    if (!body) return;

    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) {
	      body.innerHTML = '<tr><td colspan="6" class="muted">Please log in.</td></tr>';
      return;
    }

    var q = sb.from("packages")
      .select("id,tracking,status,weight,cost,pickup,pickup_confirmed,updated_at")
      .order("updated_at", { ascending: false });

    if (filter.trim()) q = q.ilike("tracking", "%" + filter.trim() + "%");

    var res = await q;
	    if (res.error) {
	      body.innerHTML = '<tr><td colspan="6" class="muted">' + escapeHTML(res.error.message) + "</td></tr>";
      return;
    }

    var data = res.data || [];
	    if (!data.length) {
	      body.innerHTML = '<tr><td colspan="6" class="muted">No packages yet.</td></tr>';
      return;
    }

    var norm = function (s) { return String(s || "").toLowerCase(); };
    var isReady = function (status) {
      var s = norm(status);
      return s.includes("pickup") && (s.includes("ready") || s.includes("read"));
    };

        var pickupLocations = await getPickupLocations();

    body.innerHTML = data.map(function (p) {
      var pickupCell = "";
      if (isReady(p.status) && !p.pickup_confirmed) {
        pickupCell = (
          '<div class="row row--wrap" style="gap:8px">'
          + '<select class="input input--compact" data-pickup-select="' + p.id + '">'
            + pickupOptionsHtml(p.pickup, pickupLocations)
          + '</select>'
          + '<button class="btn btn--ghost btn--sm" data-action="setPickup" data-pkg-id="' + p.id + '">Save</button>'
          + '</div>'
        );
      } else {
        pickupCell = escapeHTML(pickupLabel(p.pickup)) + (p.pickup_confirmed ? ' <span class="tag">Confirmed</span>' : '');
      }

      return (
        "<tr>" +
          "<td><strong>" + escapeHTML(p.tracking) + "</strong></td>" +
          '<td><span class="tag">' + escapeHTML(p.status) + "</span></td>" +
          "<td class=\"col--xs\">" + (p.weight != null ? escapeHTML(String(p.weight)) : "—") + "</td>" +
          "<td class=\"col--xs\">" + (p.cost != null ? formatJMD(Number(p.cost)) : "—") + "</td>" +
          "<td>" + pickupCell + "</td>" +
          '<td class="muted">' + new Date(p.updated_at).toLocaleString() + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  // Update pickup location for a ready-for-pickup package
  async function setupPickupUpdates() {
    var table = document.querySelector('[data-section="packages"]');
    if (!table) return;
    table.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-action="setPickup"]');
      if (!btn) return;
      e.preventDefault();

      var pkgId = btn.getAttribute('data-pkg-id');
      var sel = document.querySelector('[data-pickup-select="' + pkgId + '"]');
      var pickup = sel ? sel.value : null;
      if (!pickup) return;

      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var { error } = await sb.from('packages').update({ pickup: pickup }).eq('id', pkgId);
        if (error) {
          alert('Could not save pickup location: ' + error.message);
        } else {
          // refresh table
          await renderPackages(($('pkgSearch')?.value || '').trim());
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  }

  async function renderUploads() {
    var list = $("uploadsList");
    if (!list) return;

    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) {
      list.innerHTML = '<li class="muted">Log in to see uploads.</li>';
      return;
    }

    var res = await sb.from("invoices")
      .select("tracking,file_name,file_type,pickup,pickup_confirmed,created_at,note")
      .order("created_at", { ascending: false })
      .limit(10);

    if (res.error) {
      list.innerHTML = '<li class="muted">' + escapeHTML(res.error.message) + "</li>";
      return;
    }

    var data = res.data || [];
    if (!data.length) {
      list.innerHTML = '<li class="muted">No invoices uploaded yet.</li>';
      return;
    }

    list.innerHTML = data.map(function (i) {
      return (
        "<li>" +
          "<div><strong>" + escapeHTML(i.tracking) + "</strong> • " +
            escapeHTML(i.file_name) + " (" + escapeHTML(i.file_type) + ")" +
          "</div>" +
          '<div class="muted small">' +
            "Pickup: " + escapeHTML(pickupLabel(i.pickup)) + " • " +
            (i.pickup_confirmed ? "Confirmed" : "Pending confirmation") + " • " +
            new Date(i.created_at).toLocaleString() +
            (i.note ? " • " + escapeHTML(i.note) : "") +
          "</div>" +
        "</li>"
      );
    }).join("");
  }

  function setupPackageSearch() {
    $("pkgSearch")?.addEventListener("input", function (e) { renderPackages(e.target.value); });
    $("resetSearch")?.addEventListener("click", function () {
      if ($("pkgSearch")) $("pkgSearch").value = "";
      renderPackages("");
    });
  }

  function setupInvoiceUpload() {
    var form = $("invoiceForm");
    if (!form) return;

    // Populate tracking picklist with packages that are NOT ready for pickup
    populateInvoiceTrackingSelect();

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var msg = $("invMsg");
      if (msg) msg.textContent = "Uploading...";

      var u = await sb.auth.getUser();
      var user = u?.data?.user;
      if (!user) { if (msg) msg.textContent = "Please log in."; return; }

      var tracking = ($("invTracking")?.value || "").trim();
      var pickup = $("invPickup")?.value || "";
      var note = ($("invNote")?.value || "").trim();
      var fileInput = $("invFile");

      if (!tracking) { if (msg) msg.textContent = "Tracking ID required."; return; }
      if (!fileInput?.files?.length) { if (msg) msg.textContent = "Choose a file."; return; }

      var file = fileInput.files[0];
      var safeName = file.name.replace(/[^\w.\-]+/g, "_");
      var path = user.id + "/" + tracking + "/" + Date.now() + "_" + safeName;

      var up = await sb.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
      if (up.error) { if (msg) msg.textContent = up.error.message; return; }

      var ins = await sb.from("invoices").insert({
        user_id: user.id,
        tracking: tracking,
        pickup: pickup,
        pickup_confirmed: false,
        file_path: path,
        file_name: safeName,
        file_type: (file.type || "unknown"),
        note: note || null
      });

      if (ins.error) { if (msg) msg.textContent = ins.error.message; return; }

      form.reset();
      if (msg) msg.textContent = "Uploaded. Pickup location will be confirmed by staff.";
      await renderUploads();
    });
  }

  async function populateInvoiceTrackingSelect() {
    var sel = $("invTracking");
    if (!sel || sel.tagName !== "SELECT") return;

    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) return;

    // Exclude packages already ready for pickup (or already picked up)
    var exclude = new Set(["Read for Pickup", "Pickup/Delivered"]);

    var res = await sb
      .from("packages")
      .select("tracking,status,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (res.error) {
      sel.innerHTML = '<option value="">(unable to load packages)</option>';
      return;
    }

    var pkgs = (res.data || []).filter(function (p) {
      var s = String(p.status || "").trim();
      return p.tracking && !exclude.has(s);
    });

    var current = sel.value;
    var opts = ['<option value="">Select tracking #</option>'];
    pkgs.forEach(function (p) {
      opts.push('<option value="' + escapeHTML(p.tracking) + '">' + escapeHTML(p.tracking) + ' • ' + escapeHTML(p.status || "") + '</option>');
    });
    sel.innerHTML = opts.join("");
    if (current) sel.value = current;
  }

  // ------------------------
  // CHAT (realtime + polling fallback)
  // ------------------------
  var chatChannel = null;
  var chatPollTimer = null;

  async function renderChat() {
    var body = $("chatBody");
    if (!body) return;

    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) {
      body.innerHTML = '<div class="muted small">Log in to chat with support.</div>';
      return;
    }

    var res = await sb.from("messages")
      .select("id,sender,body,created_at")
      .order("created_at", { ascending: true })
      .limit(200);

    if (res.error) {
      body.innerHTML = '<div class="muted small">' + escapeHTML(res.error.message) + "</div>";
      return;
    }

    var data = res.data || [];
    body.innerHTML = data.length ? data.map(function (m) {
      var mine = m.sender === "customer";
      return (
        '<div class="bubble ' + (mine ? "me" : "") + '">' +
          "<div>" + escapeHTML(m.body) + "</div>" +
          '<div class="meta"><span>' + (mine ? "You" : "Support") + "</span>" +
            "<span>" + new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "</span>" +
          "</div></div>"
      );
    }).join("") : '<div class="muted small">Start the conversation. ' + escapeHTML(HOURS_TEXT) + "</div>";

    body.scrollTop = body.scrollHeight;
  }

  async function setupChatRealtime() {
    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) return;

    if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }

    chatChannel = sb.channel("messages:" + user.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "user_id=eq." + user.id },
        function () { renderChat(); }
      )
      .subscribe();

    // Polling fallback (covers cases where realtime isn't enabled)
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(function () { renderChat(); }, 5000);
  }

  async function sendChatMessage(text, file) {
    var u = await sb.auth.getUser();
    var user = u?.data?.user;
    if (!user) { alert("Please log in to chat."); return; }

    // sender must match DB constraint (use "customer")
    var ins = await sb.from("messages")
      .insert({ user_id: user.id, sender: "customer", body: text })
      .select("id")
      .single();

    if (ins.error) { alert(ins.error.message); return; }

    if (file) {
      var safeName = file.name.replace(/[^\w.\-]+/g, "_");
      var path = user.id + "/messages/" + Date.now() + "_" + safeName;

      var up = await sb.storage.from(CHAT_BUCKET).upload(path, file, { upsert: false });
      if (up.error) { alert(up.error.message); return; }

      var att = await sb.from("message_attachments").insert({
        message_id: ins.data.id,
        user_id: user.id,
        file_path: path,
        file_name: safeName,
        file_type: (file.type || "unknown")
      });

      if (att.error) { alert(att.error.message); return; }
    }

    // ensure UI updates immediately
    await renderChat();
  }

  function openChat() {
    $("chatWidget")?.classList.remove("hidden");
    $("chatWidget")?.setAttribute("aria-hidden", "false");
    if ($("chatHoursText")) $("chatHoursText").textContent = HOURS_TEXT;
    renderChat().then(setupChatRealtime);
  }
  function closeChat() {
    $("chatWidget")?.classList.add("hidden");
    $("chatWidget")?.setAttribute("aria-hidden", "true");
  }

  function setupChatUI() {
    $("chatFab")?.addEventListener("click", openChat);
    $("openChatTop")?.addEventListener("click", openChat);
    $("openChatCalc")?.addEventListener("click", openChat);
    $("openChatDash")?.addEventListener("click", openChat);
    $("openChatContact")?.addEventListener("click", openChat);
    $("closeChat")?.addEventListener("click", closeChat);

    $("chatForm")?.addEventListener("submit", async function (e) {
      e.preventDefault();
      var input = $("chatInput");
      var file = $("chatFile")?.files?.[0] || null;
      var msgEl = $("chatMsg");

      var text = (input?.value || "").trim();
      if (!text && !file) { if (msgEl) msgEl.textContent = "Type a message or attach a file."; return; }

      if (msgEl) msgEl.textContent = "Sending...";
      if (input) input.value = "";
      if ($("chatFile")) $("chatFile").value = "";

      await sendChatMessage(text || "(Attachment)", file);
      if (msgEl) msgEl.textContent = "";
    });
  }

  // ------------------------
  // AUTH RENDER
  // ------------------------
  var __renderAuthBusy = false;
  var __renderAuthTimer = null;

  async function renderAuth() {
    if (__renderAuthBusy) return;
    __renderAuthBusy = true;

    try {
      var loginCard = $("loginCard");
      var dashCard = $("dashCard");

      var u = await sb.auth.getUser();
      var user = u?.data?.user;
      var authed = !!user;

      if (loginCard) loginCard.classList.toggle("hidden", authed);
      if (dashCard) dashCard.classList.toggle("hidden", !authed);

      if (!authed) {
        if ($("adminLink")) $("adminLink").style.display = "none";
        if (chatChannel) { sb.removeChannel(chatChannel); chatChannel = null; }
        if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
        return;
      }

      // Ensure profile exists
      await ensureProfileSafe("", "");

      // Read profile for UI
      var pr = await sb.from("profiles")
        .select("full_name,role,customer_no")
        .eq("id", user.id)
        .maybeSingle();

      var profile = pr.data || null;

      // Show "FirstName — Email"
      var fn = firstName(profile?.full_name, user.email);
      if ($("userName")) $("userName").textContent = fn + " — " + user.email;
      if ($("welcomeName")) $("welcomeName").textContent = fn;
      if ($("customerNo")) $("customerNo").textContent = (profile?.customer_no || "");

      // Shipping address block
      renderShipTo(profile, user.email);

      // Admin link if staff/admin
      var role = (profile?.role || "").toLowerCase();
      var isStaff = (role === "staff" || role === "admin");
      if ($("adminLink")) $("adminLink").style.display = isStaff ? "inline-flex" : "none";

      setupDashboardTabs();
      // customer portal mini calculators removed
      await renderPackages("");
      await renderUploads();
      await renderDashboardStatsAndAwaiting();
    } finally {
      __renderAuthBusy = false;
    }
  }

  function renderAuthDebounced() {
    if (__renderAuthTimer) clearTimeout(__renderAuthTimer);
    __renderAuthTimer = setTimeout(function () { renderAuth(); }, 50);
  }

  // Subscribe ONCE
  if (!window.__AUTH_SUB__) {
    window.__AUTH_SUB__ = sb.auth.onAuthStateChange(function () {
      renderAuthDebounced();
    });
  }

  
  // ------------------------
  // DASHBOARD TABS + OVERVIEW
  // ------------------------
  var __dashSetupDone = false;
  var __dashEmbeddedChat = false;
  var __chatOriginalParent = null;
  var __chatOriginalNext = null;

  function showDashTab(name) {
    var tabs = document.querySelectorAll(".dashTab");
    var sections = document.querySelectorAll(".dashSection");

    tabs.forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === name);
    });
    sections.forEach(function (s) {
      s.classList.toggle("active", s.getAttribute("data-section") === name);
    });

    if (name === "chat") {
      embedChatWidget();
    } else if (name === "invoices") {
      // Refresh tracking options when visiting the Supplier Invoice tab
      populateInvoiceTrackingSelect();
    } else {
      unembedChatWidget();
    }
  }

  function setupDashboardTabs() {
    if (__dashSetupDone) return;
    __dashSetupDone = true;

    document.querySelectorAll(".dashTab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showDashTab(btn.getAttribute("data-tab"));
      });
    });

    $("jumpUpload")?.addEventListener("click", function () {
      showDashTab("invoices");
      $("invTracking")?.focus();
    });


    $("goPackages")?.addEventListener("click", function () {
      showDashTab("packages");
    });

    $("openChatDash")?.addEventListener("click", function () {
      showDashTab("chat");
    });
    $("closeChatTab")?.addEventListener("click", function () {
      showDashTab("overview");
      closeChat();
    });

    // If user hits X while embedded, go back to dashboard
    $("closeChat")?.addEventListener("click", function () {
      if (document.querySelector('.dashSection.active[data-section="chat"]')) {
        showDashTab("overview");
      }
    }, true);

    // Default tab
    showDashTab("overview");
  }

  function embedChatWidget() {
    var widget = $("chatWidget");
    var host = $("chatTabHost");
    var fab = $("chatFab");
    if (!widget || !host) return;

    if (!__chatOriginalParent) {
      __chatOriginalParent = widget.parentNode;
      __chatOriginalNext = widget.nextSibling;
    }

    if (widget.parentNode !== host) host.appendChild(widget);
    widget.classList.add("chat--embedded");
    if (fab) fab.style.display = "none";

    openChat();
    __dashEmbeddedChat = true;
    if ($("chatTabHint")) $("chatTabHint").style.display = "none";
  }

  function unembedChatWidget() {
    if (!__dashEmbeddedChat) return;

    var widget = $("chatWidget");
    var fab = $("chatFab");
    if (!widget || !__chatOriginalParent) return;

    // move back
    if (__chatOriginalNext && __chatOriginalNext.parentNode === __chatOriginalParent) {
      __chatOriginalParent.insertBefore(widget, __chatOriginalNext);
    } else {
      __chatOriginalParent.appendChild(widget);
    }

    widget.classList.remove("chat--embedded");
    closeChat();

    if (fab) fab.style.display = "";
    __dashEmbeddedChat = false;

    if ($("chatTabHint")) $("chatTabHint").style.display = "";
  }

  async function renderDashboardStatsAndAwaiting() {
    // Overview stats + latest packages + overview invoices
    var statReady = $("statReady");
    var statTransit = $("statTransit");
    var statOutstanding = $("statOutstanding");
    var overviewPkgBody = $("overviewPkgBody");
    var overviewInvList = $("overviewInvList");

    // Packages
    var res = await sb.from("packages")
      .select("id,tracking,status,weight,cost,amount_due_jmd,amount_paid_jmd,is_paid,updated_at,created_at")
      .order("updated_at", { ascending: false });

    if (res.error) {
      if (overviewPkgBody) overviewPkgBody.innerHTML = '<tr><td colspan="4" class="muted">' + escapeHTML(res.error.message) + '</td></tr>';
      if (statReady) statReady.textContent = "0";
      if (statTransit) statTransit.textContent = "0";
      if (statOutstanding) statOutstanding.textContent = "0";
    } else {
      var rows = res.data || [];
      var norm = function (s) { return String(s || "").toLowerCase(); };

      var readyRows = rows.filter(function (r) {
        var s = norm(r.status);
        // supports "Ready for Pickup" and the user's existing typo "Read for Pickup"
        return s.includes("pickup") && (s.includes("ready") || s.includes("read"));
      });
      var transitRows = rows.filter(function (r) { return norm(r.status).includes("transit"); });

      if (statReady) statReady.textContent = String(readyRows.length);
      if (statTransit) statTransit.textContent = String(transitRows.length);

      var outstanding = 0;
      rows.forEach(function (r) {
        var due = (r.amount_due_jmd != null) ? Number(r.amount_due_jmd) : (r.cost != null ? Number(r.cost) : 0);
        var paid = (r.amount_paid_jmd != null) ? Number(r.amount_paid_jmd) : 0;
        if (!Number.isFinite(due)) due = 0;
        if (!Number.isFinite(paid)) paid = 0;
        var diff = due - paid;
        if (diff > 0) outstanding += diff;
      });
      if (statOutstanding) statOutstanding.textContent = formatJMD(outstanding);

      if (overviewPkgBody) {
        var show = rows.slice(0, 6);
        if (!show.length) {
          overviewPkgBody.innerHTML = '<tr><td colspan="4" class="muted">No packages yet.</td></tr>';
        } else {
          overviewPkgBody.innerHTML = show.map(function (p) {
            return '<tr>'
              + '<td><strong>' + escapeHTML(p.tracking || "") + '</strong></td>'
              + '<td>' + escapeHTML(p.status || "") + '</td>'
              + '<td>' + (p.weight != null ? escapeHTML(String(p.weight)) : "—") + '</td>'
              + '<td>' + (p.cost != null ? formatJMD(Number(p.cost)) : (p.amount_due_jmd != null ? formatJMD(Number(p.amount_due_jmd)) : "—")) + '</td>'
              + '</tr>';
          }).join("");
        }
      }
    }

    // Invoices (supplier uploads + bills if you store them in the same bucket)
    if (overviewInvList) overviewInvList.innerHTML = '<li class="muted small">Loading…</li>';

    var invRes = await sb.from("invoices")
      .select("id,tracking,file_path,file_name,approved,created_at")
      .order("created_at", { ascending: false })
      .limit(6);

    if (overviewInvList) {
      if (invRes.error) {
        overviewInvList.innerHTML = '<li class="muted small">' + escapeHTML(invRes.error.message) + '</li>';
      } else {
        var invs = invRes.data || [];
        if (!invs.length) {
          overviewInvList.innerHTML = '<li class="muted small">No invoices uploaded yet.</li>';
        } else {
          overviewInvList.innerHTML = invs.map(function (inv) {
            var badge = inv.approved ? '<span class="tag">Approved</span>' : '<span class="tag tag--warn">Pending</span>';
            var a = '';
            // try public URL if the bucket is public; otherwise just show filename
            try {
              var url = sb.storage.from("invoices").getPublicUrl(inv.file_path).data.publicUrl;
              a = '<a class="link" href="' + url + '" target="_blank" rel="noopener">Download</a>';
            } catch (e) {
              a = '';
            }
            return '<li class="list__item">'
              + '<div><strong>' + escapeHTML(inv.tracking || "") + '</strong> • ' + escapeHTML(inv.file_name || "invoice") + '</div>'
              + '<div class="row row--wrap" style="gap:8px;margin-top:6px;align-items:center">'
              + badge + (a ? a : '')
              + '</div>'
              + '</li>';
          }).join("");
        }
      }
    }
  }

  function setupMiniCalcs() {
    // Overview mini calc
    $("miniCalcForm")?.addEventListener("submit", function (e) {
      e.preventDefault();
      var w = parseFloat($("miniWeight")?.value);
      var v = parseFloat($("miniValue")?.value);

      if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(v) || v < 0) {
        if ($("miniResult")) $("miniResult").textContent = "—";
        if ($("miniResultSub")) $("miniResultSub").textContent = "Enter valid numbers.";
        return;
      }

      var rr = findRateForWeight(w);
      var total = rr.rate + fixedFeeJMD;

      if ($("miniResult")) $("miniResult").textContent = formatJMD(total);
      if ($("miniResultSub")) $("miniResultSub").textContent =
        "Weight used: " + rr.rounded + " lb. Base: " + formatJMD(rr.rate) + " + Fee: " + formatJMD(fixedFeeJMD) + ".";
    });

    // Rates tab calc
      }

// ------------------------
  // INIT
  // ------------------------
  function init() {
    sanitizeStaleTokenOnce();
    setupMobileNav();
    setupAuthTabs();
    setupCalculator();
    renderRatesTable();
    setupLoginRegister();
    setupPackageSearch();
	    setupPickupUpdates();
    setupInvoiceUpload();
    setupChatUI();
    setupDashboardTabs();
    setupMiniCalcs();
    renderAuth();
  }

  window.addEventListener("DOMContentLoaded", init);
})();