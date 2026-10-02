// Keeps the page's localStorage in the app's encrypted store (secure-store.js) instead of in Chromium's plain files.
//
// Runs first, in the page's <head>, so every script after it simply keeps calling localStorage as before. The data is
// held in memory (reads are instant) and changes are sent to the main process in small batches, which encrypts and
// saves them in the background. Outside the desktop app (or if anything here fails) nothing is replaced and the
// browser's own localStorage is used, so the page always works.
//
// First start after an update: whatever the old, unencrypted localStorage held is handed over once, and the old copy
// is erased only after the encrypted one has been saved. While the app is locked the page is given an empty store
// (the real data stays in the main process); after unlocking the page reloads and gets everything.
(function () {
  'use strict';
  const api = window.secureStore;
  if (!api || typeof api.load !== 'function') return;
  let real;
  try { real = window.localStorage; } catch (e) { return; }

  let res;
  try { res = api.load(); } catch (e) { return; }
  if (!res || !res.ok) return;

  const live = !res.locked;
  const mem = new Map(Object.entries(res.data || {}));

  // Old unencrypted data, handed over once. If the hand-over fails nothing is replaced and nothing is erased.
  if (live && res.fresh) {
    try {
      const o = {};
      for (let i = 0; i < real.length; i++) { const k = real.key(i); const v = real.getItem(k); if (k !== null && v !== null) o[k] = v; }
      if (Object.keys(o).length) {
        const r = api.importAll(o);
        if (!r || !r.ok) return;
        Object.keys(o).forEach(k => mem.set(k, o[k]));
      }
    } catch (e) { return; }
  }

  // Changes are collected and sent together, shortly after the last one and when the page closes.
  let pend = new Map(), clr = false, timer = 0;
  const flush = () => {
    timer = 0;
    if (!live || (!pend.size && !clr)) return;
    const ops = [];
    pend.forEach((v, k) => ops.push([k, v]));
    const batch = { clear: clr, ops };
    pend = new Map(); clr = false;
    try { api.send(batch); } catch (e) { /* the next change sends it again */ }
  };
  const later = () => { if (live && !timer) timer = setTimeout(flush, 60); };
  const queue = (k, v) => { if (!live) return; pend.set(k, v); later(); };

  const methods = {
    getItem: k => { k = String(k); return mem.has(k) ? mem.get(k) : null; },
    setItem: (k, v) => { k = String(k); v = String(v); mem.set(k, v); queue(k, v); },
    removeItem: k => { k = String(k); if (mem.delete(k)) queue(k, null); },
    clear: () => { mem.clear(); pend = new Map(); if (live) { clr = true; later(); } },
    key: i => { const ks = Array.from(mem.keys()); i = Number(i); return i >= 0 && i < ks.length ? ks[i] : null; }
  };
  const store = new Proxy({}, {
    get: (_t, p) => {
      if (p === 'length') return mem.size;
      if (p === Symbol.toStringTag) return 'Storage';
      if (typeof p === 'string') {
        if (Object.prototype.hasOwnProperty.call(methods, p)) return methods[p];
        return mem.has(p) ? mem.get(p) : undefined;
      }
      return undefined;
    },
    set: (_t, p, v) => { if (typeof p === 'string') methods.setItem(p, v); return true; },
    deleteProperty: (_t, p) => { if (typeof p === 'string') methods.removeItem(p); return true; },
    has: (_t, p) => typeof p === 'string' && (Object.prototype.hasOwnProperty.call(methods, p) || mem.has(p) || p === 'length'),
    ownKeys: () => Array.from(mem.keys()),
    getOwnPropertyDescriptor: (_t, p) => (typeof p === 'string' && mem.has(p) ? { value: mem.get(p), writable: true, enumerable: true, configurable: true } : undefined)
  });

  try { Object.defineProperty(window, 'localStorage', { value: store, configurable: true, writable: false }); } catch (e) { return; }

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // Only now that the replacement is in place, and the encrypted copy is saved, is the old plain copy erased.
  if (live) { try { if (real.length) real.clear(); } catch (e) { /* best effort */ } }
})();
