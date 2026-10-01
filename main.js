// Keep compiled code for this app's own files on disk, so later launches skip parsing them (Node 22+; ignored if missing).
try { const m = require('module'); if (typeof m.enableCompileCache === 'function') m.enableCompileCache(); } catch {}

const { app, BrowserWindow, WebContentsView, Menu, session, ipcMain, dialog, shell, net, nativeImage, webContents, powerMonitor } = require('electron');
const appLock = require('./lock-ipc');
const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');

// The page only writes to the clipboard, and 'fullscreen' lets <video> and the Jellyfin frame go fullscreen.
const ALLOW = ['clipboard-sanitized-write', 'fullscreen'];
const EXTERNAL = /^(steam:|com\.epicgames\.launcher:|https?:)/i;
const TEXT_OK = /\.(acf|item|vdf)$/i;          // only launcher manifests may be read as text
const START = {
  'gca-steam': 'C:\\Program Files (x86)\\Steam',
  'gca-epic': 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'
};

let mainWin = null;
const getWin = () => (mainWin && !mainWin.isDestroyed() ? mainWin : undefined);

// Only one copy of the app may run: two copies would fight over the same vault, scrcpy and cache folders.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { const w = getWin(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

// Every IPC handler goes through this, so only the app's own top-level page can call them. Frames with other
// content (Jellyfin, games) and the FMHY / Coolmath views never get the preload bridge, and this is a second lock.
const trusted = e => !!mainWin && !mainWin.isDestroyed() && e.sender === mainWin.webContents && !!e.senderFrame && e.senderFrame === e.sender.mainFrame;
// While the app is locked (see lock-ipc.js) every request is refused except the lock ones, and 'fmhy:hide', which
// only takes the FMHY view off screen so the lock screen is not covered by it.
const openWhenLocked = channel => channel.startsWith('lock:') || channel === 'fmhy:hide';
const ipc = {
  handle: (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
    if (!trusted(e)) throw new Error('Blocked: this request did not come from the app window.');
    if (appLock.isLocked() && !openWhenLocked(channel)) throw new Error('The app is locked.');
    return fn(e, ...args);
  })
};
// The feature modules are loaded and registered right after the window has been asked to open (see whenReady
// below), so the window starts loading while this file's modules are still being read. They are all registered
// in the same step as the window is created, before the page can send its first request.
function registerModules() {
  appLock.register(ipc, getWin, { app, ipcMain, BrowserWindow, webContents, powerMonitor });
  require('./driver-ipc').register(ipc, getWin);
  require('./vendor-ipc').register(ipc, getWin, { app, net, shell });
  require('./shred-ipc').register(ipc, getWin, { dialog });
  require('./vault-ipc').register(ipc, getWin, { dialog });
  require('./games-ipc').register(ipc, getWin, { app, net, session, shell, BrowserWindow });
  require('./fmhy-ipc').register(ipc, getWin, { session, shell, WebContentsView, BrowserWindow, app });
  require('./video-ipc').register(ipc, getWin, { dialog, shell, app, nativeImage });
  require('./phone-ipc').register(ipc, getWin, { app, dialog, shell });
  require('./ssh-ipc').register(ipc, getWin, { app, dialog });
  require('./optimizer-ipc').register(ipc, getWin, { app });
  require('./chat-ipc').register(ipc, getWin, { app, dialog });
  require('./mumble-ipc').register(ipc, getWin, { app, dialog });
}

const okPath = p => typeof p === 'string' && path.isAbsolute(p);

// Native folder picker: no Chromium "system folder" blocklist, so Program Files works.
ipc.handle('efs:pick', async (e, id) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const def = START[id];
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    defaultPath: def && existsSync(def) ? def : undefined
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// Native file picker for game executables: returns full paths, .exe files only.
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

// "Delete all data" on the Home page: clears the app's browser storage and caches (main window, Coolmath
// and FMHY windows), the video thumbnail cache (plus the converted-audio cache when asked) and the list of SSH servers you
// chose to trust, then reloads the page so nothing
// in memory writes the data back. Vault files, shredded files and installers you downloaded are yours and are left alone.
ipc.handle('app:wipe', async (e, opts) => {
  const failed = [];
  const step = async (label, fn) => { try { await fn(); } catch { failed.push(label); } };
  const clearSes = async ses => { await ses.clearStorageData(); await ses.clearCache(); };
  await step('app storage', () => clearSes(session.defaultSession));
  for (const part of ['persist:coolmath', 'persist:fmhy', 'persist:fmhy-popup']) await step(part, () => clearSes(session.fromPartition(part)));
  // Converted audio copies are only removed when the person ticked the option.
  for (const d of ['video-thumbs', 'ssh-known-hosts.json'].concat(opts && opts.audio ? ['video-audio-fixed'] : [])) await step(d, () => fs.rm(path.join(app.getPath('userData'), d), { recursive: true, force: true }));
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
    icon: path.join(__dirname, 'build', 'icon.png'),   // taskbar/window icon when run with "npm start"; the built app uses build/icon.ico
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWin = win;
  // Play buttons (steam:// and Epic links) and "open in new tab" go to the OS, not into the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app window may only reload its own page. Any other address (including other file: pages, which would
  // get the preload bridge) is refused; web links and Steam/Epic links go to the OS instead.
  const navigate = (e, url) => {
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    e.preventDefault();
    if (EXTERNAL.test(url)) shell.openExternal(url);
  };
  win.webContents.on('will-navigate', navigate);
  win.webContents.on('will-redirect', navigate);

  win.loadFile(path.join(__dirname, 'index.html'));
}

// <webview> is never used, so no window may create one.
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));

// Same id as "appId" in package.json, so Windows groups the taskbar button under this app (with its icon and name) and not under Electron.
app.setAppUserModelId('com.zane.utilities');

app.whenReady().then(() => {
  if (!gotLock) return;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOW.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOW.includes(perm));
  Menu.setApplicationMenu(null);
  createWindow();
  registerModules();
});

app.on('window-all-closed', () => app.quit());
