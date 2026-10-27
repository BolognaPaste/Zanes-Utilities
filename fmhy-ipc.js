const FMHY_HOST = /^([a-z0-9-]+\.)*fmhy\.net$/i;
const HOME = 'https://fmhy.net/';
const adblock = require('./adblock');

function register(ipcMain, getWin, { session, shell, WebContentsView, BrowserWindow, app }) {
  let view = null, attached = false;
  const popups = new Map();
  let blockPref = true;

  const inside = u => { try { const x = new URL(u); return x.protocol === 'https:' && FMHY_HOST.test(x.hostname); } catch { return false; } };
  const out = u => { if (/^https?:/i.test(u)) shell.openExternal(u); };
  const pop = u => { const n = web(u); if (n) openPopup(n, 'link', blockPref).catch(() => {}); };
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
    wc.setWindowOpenHandler(({ url }) => { if (inside(url)) wc.loadURL(url); else pop(url); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!inside(url)) { e.preventDefault(); pop(url); } });
    wc.on('will-redirect', (e, url) => { if (!inside(url)) { e.preventDefault(); pop(url); } });
    wc.loadURL(HOME);
  }

  ipcMain.handle('fmhy:show', (_e, b) => {
    const win = getWin();
    if (!win || win.isDestroyed()) return { ok: false, error: 'The app window is not available.' };
    if (b && typeof b.block === 'boolean') blockPref = b.block;
    if (!view) make();
    if (!attached) { win.contentView.addChildView(view); attached = true; }
    view.setBounds(rect(b));
    return { ok: true };
  });

  ipcMain.handle('fmhy:bounds', (_e, b) => { if (view && attached) view.setBounds(rect(b)); return true; });

  ipcMain.handle('fmhy:hide', () => {
    const win = getWin();
    if (view && attached && win && !win.isDestroyed()) win.contentView.removeChildView(view);
    attached = false;
    return true;
  });

  const web = u => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

  const KEEP_MS = 365 * 24 * 3600 * 1000;
  let flushTimer = 0, popSes = null, blocker = null;
  const flush = () => { if (!popSes) return; try { popSes.cookies.flushStore().catch(() => {}); popSes.flushStorageData(); } catch {} };
  const flushSoon = () => { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 1000); };

  function popupSession() {
    if (popSes) return popSes;
    const ses = popSes = session.fromPartition('persist:fmhy-popup');
    blocker = adblock.create(app, ses, () => { const w = getWin(); if (w) w.webContents.send('fmhy:ad'); });
    ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen'));
    ses.setPermissionCheckHandler((wc, perm) => perm === 'fullscreen');
    ses.cookies.on('changed', (_e, c, cause, removed) => {
      if (removed) { flushSoon(); return; }
      if (!c.session) { flushSoon(); return; }
      const host = String(c.domain || '').replace(/^\./, '');
      if (!host) return;
      const jar = {
        url: (c.secure ? 'https://' : 'http://') + host + (c.path || '/'),
        name: c.name, value: c.value, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly,
        sameSite: c.sameSite, expirationDate: (Date.now() + KEEP_MS) / 1000
      };
      if (!c.hostOnly) jar.domain = c.domain;
      ses.cookies.set(jar).then(flushSoon, () => {});
    });
    if (app && app.on) app.on('before-quit', flush);
    return ses;
  }

  ipcMain.handle('fmhy:warm', () => { popupSession(); blocker.warm(); return true; });

  ipcMain.handle('fmhy:adstatus', async () => { popupSession(); return blocker.status(); });
  ipcMain.handle('fmhy:adset', async (_e, on) => { popupSession(); blockPref = !!on; await blocker.set(!!on, 1); return blocker.status(); });
  ipcMain.handle('fmhy:adrefresh', async () => { popupSession(); await blocker.refresh(); return blocker.status(); });

  async function openPopup(rawUrl, key, block) {
    const win = getWin();
    if (!win || win.isDestroyed()) return { ok: false, error: 'The app window is not available.' };
    const url = web(rawUrl);
    if (!url) return { ok: false, error: 'That is not a valid web address.' };
    blockPref = !!block;

    popupSession();
    let note = '';
    try {
      const r = await blocker.set(!!block);
      if (r.on && !r.ready) note = 'The ad blocker is still loading its filter lists, so this page opened without it. It switches on by itself in a moment.';
      else if (r.on && r.error) note = 'The ad blocker could not load its filter lists (' + r.error + '), so this page opened without it.';
    } catch (err) { note = 'The ad blocker could not start, so this page opened without it.'; }
    if (!win || win.isDestroyed()) return { ok: false, error: 'The app window is not available.' };

    let p = key !== null ? popups.get(key) : null;
    if (p && !p.isDestroyed()) {
      if (p.webContents.getURL() !== url) p.loadURL(url).catch(() => {});
      if (p.isMinimized()) p.restore();
      p.focus();
      return { ok: true, note };
    }

    const ses = popupSession();
    const b = win.getBounds();
    const w = Math.max(640, Math.round(b.width * 0.85)), h = Math.max(480, Math.round(b.height * 0.85));
    p = new BrowserWindow({
      parent: win, width: w, height: h,
      x: b.x + Math.round((b.width - w) / 2), y: b.y + Math.round((b.height - h) / 2),
      minWidth: 480, minHeight: 360, autoHideMenuBar: true, backgroundColor: '#0f161c',
      icon: require('path').join(__dirname, 'build', 'icon.png'),
      webPreferences: { partition: 'persist:fmhy-popup', contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    p.setMenuBarVisibility(false);
    const wc = p.webContents;
    wc.setWindowOpenHandler(({ url: u }) => { const n = web(u); if (n) wc.loadURL(n).catch(() => {}); return { action: 'deny' }; });
    const only = (e, u) => { if (!web(u)) e.preventDefault(); };
    wc.on('will-navigate', only);
    wc.on('will-redirect', only);
    const go = d => { const h = wc.navigationHistory; if (d < 0 ? h.canGoBack() : h.canGoForward()) { d < 0 ? h.goBack() : h.goForward(); return true; } return false; };
    wc.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && i.alt && !i.control && !i.shift && (i.key === 'ArrowLeft' || i.key === 'ArrowRight') && go(i.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
    });
    p.on('app-command', (_e, c) => { if (c === 'browser-backward') go(-1); else if (c === 'browser-forward') go(1); });
    p.on('close', flush);
    if (key !== null) { popups.set(key, p); p.on('closed', () => { if (popups.get(key) === p) popups.delete(key); }); }
    p.loadURL(url).catch(() => {});
    return { ok: true, note };
  }

  ipcMain.handle('fmhy:popup', (_e, a) => {
    const slot = a && Number.isInteger(a.slot) && a.slot >= 0 && a.slot < 4 ? a.slot : null;
    return openPopup(a && a.url, slot, !(a && a.block === false));
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
