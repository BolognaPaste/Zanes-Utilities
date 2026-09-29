const { app, BrowserWindow, Menu, session, ipcMain, dialog, shell, net, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');

const CLIP = ['clipboard-read', 'clipboard-sanitized-write'];
const ALLOW = [...CLIP, 'fullscreen'];   // 'fullscreen' is what lets <video> and the Jellyfin frame go fullscreen
const EXTERNAL = /^(steam:|com\.epicgames\.launcher:|https?:)/i;
const TEXT_OK = /\.(acf|item|vdf)$/i;          // only launcher manifests may be read as text
const START = {
  'gca-steam': 'C:\\Program Files (x86)\\Steam',
  'gca-epic': 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests'
};

require('./driver-ipc').register(ipcMain, () => BrowserWindow.getAllWindows()[0]);
require('./vendor-ipc').register(ipcMain, () => BrowserWindow.getAllWindows()[0], { app, net, shell });
require('./shred-ipc').register(ipcMain, () => BrowserWindow.getAllWindows()[0], { dialog });
require('./video-ipc').register(ipcMain, () => BrowserWindow.getAllWindows()[0], { dialog, shell, app, nativeImage });

const okPath = p => typeof p === 'string' && path.isAbsolute(p);

// Native folder picker: no Chromium "system folder" blocklist, so Program Files works.
ipcMain.handle('efs:pick', async (e, id) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const def = START[id];
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    defaultPath: def && existsSync(def) ? def : undefined
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

// Native file picker for game executables: returns full paths, .exe files only.
ipcMain.handle('efs:pickExe', async e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose game executables',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Programs', extensions: ['exe'] }]
  });
  return r.canceled ? [] : r.filePaths.filter(p => /\.exe$/i.test(p));
});

ipcMain.handle('efs:list', async (_e, p) => {
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

ipcMain.handle('efs:stat', async (_e, p) => {
  if (!okPath(p)) return null;
  try {
    const s = await fs.stat(p);
    return { kind: s.isDirectory() ? 'directory' : 'file', size: s.size, mtimeMs: s.mtimeMs };
  } catch { return null; }
});

ipcMain.handle('efs:text', async (_e, p) => {
  if (!okPath(p) || !TEXT_OK.test(p)) throw new Error('not allowed');
  const s = await fs.stat(p);
  if (s.size > 2e6) throw new Error('too large');
  return fs.readFile(p, 'utf8');
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f161c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  Menu.setApplicationMenu(null);

  // Play buttons (steam:// and Epic links) and "open in new tab" go to the OS, not into the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    e.preventDefault();
    if (EXTERNAL.test(url)) shell.openExternal(url);
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOW.includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ALLOW.includes(perm));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
