// ═══════════════════════════════════════════════════════
//  JPS PLATFORM MONITOR  v1.0
//  Shared monitoring module for all JPS projects.
//  Drop this file into any project and call:
//
//    JpsMonitor.init({ getClient, appName });
//
//  It will:
//   • Log JS errors & unhandled Promise rejections to DB
//   • Run a DB health check every 60 seconds
//   • Show a live DB status dot (green/red) on screen
//   • Show a STAGING banner when env = 'staging'
//   • Write all events to fpa_audit_log in Supabase
//
//  HOW TO READ THE LOGS:
//   → Supabase Dashboard → Table Editor → fpa_audit_log
//   → Filter: action LIKE 'monitor:%'
//   → Or open the FP&A platform → Audit Log panel
// ═══════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Environment ──────────────────────────────────────
  const _ENV = (() => {
    try { return localStorage.getItem('jps_env') || 'production'; } catch(e) { return 'production'; }
  })();
  const _IS_STAGING = _ENV === 'staging';

  // ── Internal state ───────────────────────────────────
  let _getClient = null;   // function that returns the live Supabase client
  let _appName   = 'jps'; // which app is logging (fpa | sales | propel | cashbench)
  let _user      = { id: 'system', name: 'system' };
  let _healthy   = true;
  let _healthTimer = null;
  let _ready     = false;

  // ── Core log writer ──────────────────────────────────
  async function _write(severity, source, message, detail) {
    const sb = _getClient ? _getClient() : null;
    const payload = {
      user_id:   _user.id,
      user_name: _user.name,
      action:    `monitor:${severity}`,
      target:    `[${_appName}] ${source}`,
      old_val:   null,
      new_val:   JSON.stringify({
        message,
        detail: detail || null,
        env: _ENV,
        app: _appName,
        ts:  new Date().toISOString(),
      }),
    };

    const level = (severity === 'critical' || severity === 'error') ? 'error' : 'warn';
    console[level](`[JpsMonitor:${severity}] [${_appName}] ${source} — ${message}`, detail || '');

    if (sb) {
      try { await sb.from('fpa_audit_log').insert(payload); } catch(e) { /* silent */ }
    }
  }

  // ── DB health check ───────────────────────────────────
  async function _healthCheck() {
    const sb = _getClient ? _getClient() : null;
    if (!sb) return;
    try {
      const t0 = Date.now();
      const { error } = await sb.from('fpa_dim_period').select('id').limit(1).single();
      const ms = Date.now() - t0;
      if (error) throw error;

      if (!_healthy) {
        _healthy = true;
        _setDot(true);
        _toast('✅ Database connection restored', 'ok');
        await _write('info', 'db-health', 'Connection restored', { latency_ms: ms });
      }
      if (ms > 3000) {
        await _write('warning', 'db-health', 'Slow DB response', { latency_ms: ms });
      }
    } catch(e) {
      if (_healthy) {
        _healthy = false;
        _setDot(false);
        _toast('⚠️ Database connection lost', 'err');
        await _write('critical', 'db-health', 'Connection failed', { error: e.message });
      }
    }
  }

  // ── UI helpers ────────────────────────────────────────
  function _setDot(ok) {
    const el = document.getElementById('jpsMonitorDot');
    if (!el) return;
    el.style.background = ok ? '#10b981' : '#ef4444';
    el.title = ok ? 'Database: Connected' : 'Database: Disconnected';
  }

  function _toast(msg, type) {
    // Use platform toast if available, else console
    if (typeof toast === 'function') { toast(msg, type); return; }
    if (typeof window._toast === 'function') { window._toast(msg, type); return; }
    console.info(`[Toast] ${msg}`);
  }

  function _injectBanner() {
    document.getElementById('jpsMonitorBanner')?.remove();
    document.getElementById('jpsMonitorDotWrap')?.remove();

    if (_IS_STAGING) {
      const bar = document.createElement('div');
      bar.id = 'jpsMonitorBanner';
      bar.style.cssText = [
        'position:fixed','top:0','left:0','right:0','z-index:99999',
        'background:#f59e0b','color:#1c1400','font-weight:700',
        'font-size:12px','letter-spacing:.04em','text-align:center',
        'padding:5px 12px','pointer-events:none','font-family:monospace',
      ].join(';');
      bar.textContent = `⚠️  STAGING — [${_appName.toUpperCase()}] — Changes will NOT affect production`;
      document.body.appendChild(bar);
    }

    // Status dot — always shown bottom-right
    const wrap = document.createElement('div');
    wrap.id = 'jpsMonitorDotWrap';
    wrap.style.cssText = [
      'position:fixed','bottom:12px','right:14px','z-index:99999',
      'display:flex','align-items:center','gap:6px',
      'font-size:11px','color:#6b7280','font-family:monospace','pointer-events:none',
    ].join(';');
    wrap.innerHTML = `
      <span id="jpsMonitorDot"
        style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;transition:background .3s;"
        title="Database: Connected"></span>
      <span>${_IS_STAGING ? 'STAGING' : 'PROD'} · ${_appName}</span>
    `;
    document.body.appendChild(wrap);
  }

  // ── Global error handlers ─────────────────────────────
  function _setupHandlers() {
    window.addEventListener('error', e => {
      if (e.message === 'Script error.' || e.message === 'Uncaught Error: Script error.') return;
      _write('error',
        e.filename ? `js:${e.filename.split('/').pop()}:${e.lineno}` : 'js:unknown',
        e.message,
        { lineno: e.lineno, colno: e.colno, stack: e.error?.stack?.slice(0, 500) || null }
      );
    });

    window.addEventListener('unhandledrejection', e => {
      const msg = e.reason?.message || String(e.reason) || 'Unknown rejection';
      _write('error', 'promise:unhandled', msg, { stack: e.reason?.stack?.slice(0, 500) || null });
    });
  }

  // ── Public API ────────────────────────────────────────
  const JpsMonitor = {

    /**
     * Initialise the monitor.
     * @param {object} opts
     * @param {function} opts.getClient  — () => supabaseClient  (called each time, so late-binding works)
     * @param {string}   opts.appName   — 'fpa' | 'sales' | 'propel' | 'cashbench'
     * @param {object}   [opts.user]    — { id, name } of logged-in user (call setUser later if not known yet)
     */
    init({ getClient, appName = 'jps', user = null } = {}) {
      if (_ready) return; // idempotent
      _getClient = getClient;
      _appName   = appName;
      if (user) _user = user;

      _setupHandlers();

      // Wait for DOM before injecting banner
      if (document.body) {
        _injectBanner();
        _healthCheck();
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          _injectBanner();
          _healthCheck();
        });
      }

      _healthTimer = setInterval(_healthCheck, 60_000);
      _ready = true;
      console.info(`[JpsMonitor] Initialised — app:${_appName} env:${_ENV}`);
    },

    /** Update the current user (call after login) */
    setUser(id, name) {
      _user = { id: id || 'system', name: name || 'system' };
    },

    /** Manually log any event */
    log(severity, source, message, detail) {
      return _write(severity, source, message, detail);
    },

    /** Convenience wrappers */
    info    : (src, msg, d) => _write('info',     src, msg, d),
    warning : (src, msg, d) => _write('warning',  src, msg, d),
    error   : (src, msg, d) => _write('error',    src, msg, d),
    critical: (src, msg, d) => _write('critical', src, msg, d),

    get env()      { return _ENV; },
    get isStaging(){ return _IS_STAGING; },
    get healthy()  { return _healthy; },
  };

  // Expose globally
  global.JpsMonitor = JpsMonitor;

})(window);
