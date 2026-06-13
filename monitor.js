(function (global) {
  'use strict';

  let _user = { id: 'anon', name: 'anon' };
  let _app  = 'suenos';

  function _log(severity, source, message, detail) {
    const level = (severity === 'error' || severity === 'critical') ? 'error' : 'warn';
    console[level](`[${_app}:${severity}] ${source} — ${message}`, detail || '');
  }

  window.addEventListener('error', e => {
    if (e.message === 'Script error.') return;
    _log('error', `js:${(e.filename||'').split('/').pop()}:${e.lineno}`, e.message, e.error?.stack?.slice(0,500));
  });

  window.addEventListener('unhandledrejection', e => {
    _log('error', 'promise:unhandled', e.reason?.message || String(e.reason), e.reason?.stack?.slice(0,500));
  });

  global.SuenosMonitor = {
    init({ appName = 'suenos' } = {}) { _app = appName; },
    setUser(id, name) { _user = { id: id || 'anon', name: name || 'anon' }; },
    info    : (src, msg, d) => _log('info',     src, msg, d),
    warning : (src, msg, d) => _log('warning',  src, msg, d),
    error   : (src, msg, d) => _log('error',    src, msg, d),
    critical: (src, msg, d) => _log('critical', src, msg, d),
  };

})(window);
