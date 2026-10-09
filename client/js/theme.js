/* Diterapkan di <head> agar tidak ada kedipan tema. */
(function () {
  'use strict';
  var KEY = 'xen_theme';
  function read() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function apply(mode) {
    var root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
  }
  window.XenTheme = {
    get: read,
    set: function (mode) {
      try { localStorage.setItem(KEY, mode); } catch (e) { /* abaikan */ }
      apply(mode);
    }
  };
  apply(read());

  // Preferensi lokal (disimpan di browser): ukuran UI, Enter untuk kirim, perangkat panggilan.
  var PKEY = 'xen_prefs';
  function prefs() { try { return JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch (e) { return {}; } }
  function applyFont() {
    var f = prefs().fontSize || 'md';
    document.documentElement.setAttribute('data-font', f);
  }
  window.XenPrefs = {
    get: function (k) { return prefs()[k]; },
    set: function (k, v) {
      var p = prefs();
      if (v === undefined || v === null || v === '') delete p[k]; else p[k] = v;
      try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch (e) { /* abaikan */ }
      if (k === 'fontSize') applyFont();
    }
  };
  applyFont();
})();
