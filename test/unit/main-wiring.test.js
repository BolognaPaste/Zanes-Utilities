'use strict';
// Loads the real main.js against a stub of Electron to prove the Phase 0 wiring (startup timings, log file,
// diagnostics export, tool-load logging) works and that the IPC trust gate still refuses foreign senders.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');

function stubFn() { return new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : stubFn()), apply: () => stubFn() }); }

function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-main-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  const ready = [];
  const wins = [];
  let savePath = path.join(dir, 'diag.json');
  const app = new Proxy({
    requestSingleInstanceLock: () => true, quit() {}, on() {}, setAppUserModelId() {}, isPackaged: false,
    getName: () => 'Zanes Utilities', getVersion: () => '1.0.0-test',
    getPath: n => { const p = path.join(dir, n); fs.mkdirSync(p, { recursive: true }); return p; },
    whenReady: () => ({ then: fn => { ready.push(fn); } })
  }, { get: (t2, k) => (k in t2 ? t2[k] : stubFn()) });
  class BrowserWindow {
    constructor() {
      this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {}, once() {}, getURL: () => 'file:///index.html', send() {}, reloadIgnoringCache() {} };
      wins.push(this);
    }
    loadFile() {} isDestroyed() { return false; } once() {} isVisible() { return false; } show() {}
    static fromWebContents() { return wins[0]; }
  }
  const electron = {
    app, BrowserWindow, Menu: { setApplicationMenu() {} }, WebContentsView: class {}, shell: { openExternal() {} }, net: {}, nativeImage: {}, webContents: {},
    powerMonitor: { on() {} }, safeStorage: { isEncryptionAvailable: () => false },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }, fromPartition: () => ({}) },
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on() {}, removeHandler() {} },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: savePath }), showOpenDialog: async () => ({ canceled: true }) }
  };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? electron : orig.call(this, req, ...rest); };
  const mainPath = require.resolve('../../main.js');
  delete require.cache[mainPath];
  try { require(mainPath); } finally { Module._load = orig; }
  return { dir, handlers, ready, wins, setSavePath: p => { savePath = p; } };
}

test('main.js starts, logs startup, and exports a diagnostics bundle through the trusted IPC channel', async t => {
  const m = boot(t);
  assert.equal(m.ready.length, 1, 'main.js registers a whenReady handler');
  m.ready[0]();
  const win = m.wins[0];
  assert.ok(win, 'a window was created');
  const logFile = path.join(m.dir, 'logs', 'app.log');
  assert.match(fs.readFileSync(logFile, 'utf8'), /INFO  Starting Zane's Utilities 1\.0\.0-test/);

  assert.equal(typeof m.handlers['app:exportDiagnostics'], 'function');
  const trustedEvent = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const r = await m.handlers['app:exportDiagnostics'](trustedEvent);
  assert.equal(r.ok, true);
  const bundle = JSON.parse(fs.readFileSync(r.path, 'utf8'));
  assert.equal(bundle.schema, 1);
  assert.equal(bundle.app.version, '1.0.0-test');
  assert.ok(typeof bundle.timingsMs.appReady === 'number' && typeof bundle.timingsMs.windowCreated === 'number' && typeof bundle.timingsMs.modulesRegistered === 'number');
  assert.match(bundle.log, /Starting Zane's Utilities/);
});

test('the IPC gate still refuses requests that do not come from the main window', async t => {
  const m = boot(t);
  m.ready[0]();
  const stranger = { sender: {}, senderFrame: {} };
  await assert.rejects(async () => m.handlers['app:exportDiagnostics'](stranger), /Blocked: this request did not come from the app window/);
  await assert.rejects(async () => m.handlers['app:loadTool'](stranger, 'vault'), /Blocked/);
});

test('loading a tool logs the module, and an unknown tool is ignored', async t => {
  const m = boot(t);
  m.ready[0]();
  const win = m.wins[0];
  const ev = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.deepEqual(await m.handlers['app:loadTool'](ev, 'shred'), { ok: true });
  assert.deepEqual(await m.handlers['app:loadTool'](ev, 'does-not-exist'), { ok: true });
  assert.match(fs.readFileSync(path.join(m.dir, 'logs', 'app.log'), 'utf8'), /Module loaded: shred \(\d+ ms\)/);
  assert.equal(typeof m.handlers['shr:run'], 'function', 'the shredder channels were registered');
});
