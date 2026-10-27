'use strict';
// Runs a legacy renderer script (plain <script>, no modules) in a sandbox with a tolerant fake DOM,
// so its top-level functions can be tested without Electron. Function declarations become properties
// of the returned context.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function fakeEl() {
  const fn = function () {};
  const el = new Proxy(fn, {
    get(_t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style' || k === 'dataset') return {};
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
      if (k === 'addEventListener') return () => {};
      return fakeEl();
    },
    set() { return true; },
    apply() { return fakeEl(); }
  });
  return el;
}

function load(file, extra) {
  const store = {};
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date, Math, JSON, DataView, ArrayBuffer, Uint8Array, BigInt,
    Promise, Map, Set, RegExp, Error, Number, String, Array, Object, parseInt, parseFloat, isFinite, isNaN,
    document: { querySelector: fakeEl, querySelectorAll: () => [], getElementById: fakeEl, createElement: fakeEl, addEventListener() {}, body: fakeEl(), documentElement: fakeEl() },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0, requestIdleCallback: () => 0, navigator: { userAgent: 'node', clipboard: {} },
    ...(extra || {})
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), ctx, { filename: file });
  return ctx;
}

module.exports = { load };
