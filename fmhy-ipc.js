// FMHY backend: shows fmhy.net inside the app window, on the FMHY page.
// The site runs in a WebContentsView laid over the page's placeholder area (the page reports where
// that area is). The view has no preload script, its own storage, refuses every permission except
// fullscreen, and can only navigate within fmhy.net. Links to other sites open in the default browser.
const FMHY_HOST = /^([a-z0-9-]+\.)*fmhy\.net$/i;
const HOME = 'https://fmhy.net/';

function register(ipcMain, getWin, { session, shell, WebContentsView }) {
  let view = null, attached = false;

  const inside = u => { try { const x = new URL(u); return x.protocol === 'https:' && FMHY_HOST.test(x.hostname); } catch { return false; } };
  const out = u => { if (/^https?:/i.test(u)) shell.openExternal(u); };
  const rect = b => {
    const n = k => Math.max(0, Math.round(Number(b && b[k]) || 0));
    return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
  };

  function make() {
    const ses = session.fromPartition('persist:fmhy');
    if (!ses._zHooked) {
      ses._zHooked = true;
      ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen'));
      ses.setPermissionCheckHandler((wc, perm) => perm === 'fullscreen');
    }
    view = new WebContentsView({ webPreferences: { partition: 'persist:fmhy', contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => { if (inside(url)) wc.loadURL(url); else out(url); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!inside(url)) { e.preventDefault(); out(url); } });
    wc.on('will-redirect', (e, url) => { if (!inside(url)) { e.preventDefault(); out(url); } });
    wc.loadURL(HOME);
  }

  // Put the site on screen at the given rectangle (created and loaded the first time).
  ipcMain.handle('fmhy:show', (_e, b) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return { ok: false, error: 'The app window is not available.' };
    if (!view) make();
    if (!attached) { win.contentView.addChildView(view); attached = true; }
    view.setBounds(rect(b));
    return { ok: true };
  });

  ipcMain.handle('fmhy:bounds', (_e, b) => { if (view && attached) view.setBounds(rect(b)); return true; });

  // Take the site off screen when another page is shown. It stays loaded, so coming back keeps your place.
  ipcMain.handle('fmhy:hide', () => {
    const win = getWin();
    if (view && attached && win && !win.isDestroyed()) win.contentView.removeChildView(view);
    attached = false;
    return true;
  });

  ipcMain.handle('fmhy:nav', (_e, what) => {
    if (!view) return { ok: false };
    const wc = view.webContents;
    if (what === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (what === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (what === 'home') wc.loadURL(HOME);
    else if (what === 'reload') wc.reload();
    else if (what === 'browser') out(wc.getURL());
    return { ok: true };
  });
}

module.exports = { register };
