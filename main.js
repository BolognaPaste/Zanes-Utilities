try { const m = require('module'); if (typeof m.enableCompileCache === 'function') m.enableCompileCache(); } catch {}

const { app, BrowserWindow, WebContentsView, Menu, session, ipcMain, dialog, shell, net, nativeImage, webContents, powerMonitor, safeStorage } = require('electron');
const appLock = require('./lock-ipc');
const secure = require('./secure-store');
const path = require('path');
const fs = require('fs/promises');
const logger = require('./logger');
const diagnostics = require('./diagnostics');

const T0 = performance.now();
const timings = {};
let log = { debug() {}, info() {}, warn() {}, error() {}, readAll: () => '' };
const mark = name => { timings[name] = Math.round(performance.now() - T0); };
process.on('uncaughtExceptionMonitor', err => { try { log.error('Uncaught exception', err); } catch {} });
process.on('unhandledRejection', err => { try { log.error('Unhandled rejection', err instanceof Error ? err : String(err)); } catch {} });
const { existsSync } = require('fs');

const ALLOW = ['clipboard-sanitized-write', 'fullscreen'];
const EXTERNAL = /^(steam:|com\.epicgames\.launcher:|https?:)/i;
const TEXT_OK = /\.(acf|item|vdf)$/i;
const START = {
  'gca-steam': 'C:\\Program Files (x86)\\Steam',
  'gca-epic': 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'
};

let mainWin = null;
const getWin = () => (mainWin && !mainWin.isDestroyed() ? mainWin : undefined);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { const w = getWin(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

const trusted = e => !!mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame;
const openWhenLocked = channel => channel.startsWith('lock:') || channel === 'fmhy:hide';
const ipc = {
  handle: (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Blocked: this request did not come from the app window.');
    if (appLock.isLocked() && !openWhenLocked(channel)) throw new Error('The app is locked.');
    return fn(e, ...args);
  })
};
function registerModules() {
  secure.register(ipcMain, ipc, { app, safeStorage, trusted, isLocked: appLock.isLocked });
  appLock.register(ipc, getWin, { app, ipcMain, BrowserWindow, webContents, powerMonitor, storage: secure });
}

const TOOL_MODULES = {
  test: ['chat', 'mumble'],
  drv: ['driver', 'vendor'],
  shred: ['shred'],
  vault: ['vault'],
  media: ['video'],
  games: ['games'],
  fmhy: ['fmhy'],
  settings: ['fmhy'],
  phone: ['phone'],
  ssh: ['ssh'],
  opt: ['optimizer']
};
const MODULE_LOADERS = {
  chat: () => require('./chat-ipc').register(ipc, getWin, { app, dialog }),
  mumble: () => require('./mumble-ipc').register(ipc, getWin, { app, dialog }),
  driver: () => require('./driver-ipc').register(ipc, getWin),
  vendor: () => require('./vendor-ipc').register(ipc, getWin, { app, net, shell }),
  shred: () => require('./shred-ipc').register(ipc, getWin, { dialog }),
  vault: () => require('./vault-ipc').register(ipc, getWin, { dialog }),
  games: () => require('./games-ipc').register(ipc, getWin, { app, net, session, shell, BrowserWindow }),
  fmhy: () => require('./fmhy-ipc').register(ipc, getWin, { session, shell, WebContentsView, BrowserWindow, app }),
  video: () => require('./video-ipc').register(ipc, getWin, { dialog, shell, app, nativeImage }),
  phone: () => require('./phone-ipc').register(ipc, getWin, { app, dialog, shell }),
  ssh: () => require('./ssh-ipc').register(ipc, getWin, { app, dialog }),
  optimizer: () => require('./optimizer-ipc').register(ipc, getWin, { app })
};
const loadedModules = new Set();
function loadTool(tab) {
  if (!Object.prototype.hasOwnProperty.call(TOOL_MODULES, tab)) return;
  for (const name of TOOL_MODULES[tab]) {
    if (loadedModules.has(name)) continue;
    const t = performance.now();
    try { MODULE_LOADERS[name](); } catch (err) { log.error('Module failed to load: ' + name, err); throw err; }
    loadedModules.add(name);
    log.info('Module loaded: ' + name + ' (' + Math.round(performance.now() - t) + ' ms)');
  }
}
ipc.handle('app:loadTool', (_e, tab) => {
  try { loadTool(typeof tab === 'string' ? tab : ''); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || 'This tool could not be loaded.' }; }
});

ipc.handle('app:exportDiagnostics', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: 'Export diagnostics',
    defaultPath: 'zanes-utilities-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json',
    filters: [{ name: 'Diagnostics', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, declined: true };
  try {
    const bundle = diagnostics.build({ app, process, log: log.readAll(), timings, loadedModules });
    await fs.writeFile(r.filePath, diagnostics.toText(bundle), 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) { log.error('Diagnostics export failed', err); return { ok: false, error: 'The diagnostics file could not be saved.' }; }
});

const okPath = p => typeof p === 'string' && path.isAbsolute(p);

ipc.handle('efs:pick', async (e, id) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const def = START[id];
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    defaultPath: def && existsSync(def) ? def : undefined
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

ipc.handle('efs:pickExe', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose game executables',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Programs', extensions: ['exe'] }]
  });
  return r.canceled ? [] : r.filePaths.filter(p => /\.exe$/i.test(p));
});

ipc.handle('efs:list', async (_e, p) => {
  if (!okPath(p)) throw new Error('bad path');
  const out = [];
  for (const d of await fs.readdir(p, { withFileTypes: true })) {
    let kind = d.isDirectory() ? 'directory' : d.isFile() ? 'file' : '';
    if (!kind && d.isSymbolicLink()) {
      try { const s = await fs.stat(path.join(p, d.name)); kind = s.isDirectory() ? 'directory' : s.isFile() ? 'file' : ''; } catch {}
    }
    if (kind) out.push({ name: d.name, kind });
  }
  return out;
});

ipc.handle('efs:stat', async (_e, p) => {
  if (!okPath(p)) return null;
  try {
    const s = await fs.stat(p);
    return { kind: s.isDirectory() ? 'directory' : 'file', size: s.size, mtimeMs: s.mtimeMs };
  } catch { return null; }
});

ipc.handle('efs:text', async (_e, p) => {
  if (!okPath(p) || !TEXT_OK.test(p)) throw new Error('not allowed');
  const s = await fs.stat(p);
  if (s.size > 2e6) throw new Error('too large');
  return fs.readFile(p, 'utf8');
});

ipc.handle('app:wipe', async (e, opts) => {
  const failed = [];
  const step = async (label, fn) => { try { await fn(); } catch { failed.push(label); } };
  const clearSes = async ses => { await ses.clearStorageData(); await ses.clearCache(); };
  await step('app storage', () => clearSes(session.defaultSession));
  for (const part of ['persist:coolmath', 'persist:fmhy', 'persist:fmhy-popup']) await step(part, () => clearSes(session.fromPartition(part)));
  for (const d of ['video-thumbs', 'ssh-known-hosts.json'].concat(opts && opts.audio ? ['video-audio-fixed'] : [])) await step(d, () => fs.rm(path.join(app.getPath('userData'), d), { recursive: true, force: true }));
  secure.wipe();
  if (failed.length) return { ok: false, error: 'Some data could not be deleted: ' + failed.join(', ') + '.' };
  const win = BrowserWindow.fromWebContents(e.sender);
  setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reloadIgnoringCache(); }, 100);
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f161c',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged || process.env.ZU_DEVTOOLS === '1'
    }
  });
  mainWin = win;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  const navigate = (e, url) => {
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    e.preventDefault();
    if (EXTERNAL.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', navigate);
  win.webContents.on('will-redirect', navigate);

  win.webContents.once('did-finish-load', () => { mark('didFinishLoad'); log.info('Window loaded', timings); });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.on('render-process-gone', (_e, _wc, d) => log.error('Renderer process gone', d));
app.on('child-process-gone', (_e, d) => log.warn('Child process gone', d));

app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));

app.setAppUserModelId('com.zane.utilities');

app.whenReady().then(() => {
  if (!gotLock) return;
  log = logger.create(app.getPath('logs'));
  mark('appReady');
  log.info('Starting Zane\'s Utilities ' + app.getVersion() + ' (Electron ' + process.versions.electron + ', packaged=' + app.isPackaged + ')');
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOW.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOW.includes(perm));
  Menu.setApplicationMenu(null);
  createWindow();
  mark('windowCreated');
  registerModules();
  mark('modulesRegistered');
});

app.on('window-all-closed', () => app.quit());
