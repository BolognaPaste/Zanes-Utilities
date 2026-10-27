const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'app-lock.json';
const AUTO = [0, 1, 5, 10, 15, 30, 60];
const MIN_LEN = 4,
  MAX_LEN = 128,
  MIN_STORE = 8;
const COST = { N: 16384, r: 8, p: 1 };

let cfg = null;
let locked = false;
let fails = 0,
  blockedUntil = 0,
  busy = false,
  timer = 0;
let storage = null;
const pwMode = () => !!(storage && storage.passwordMode());

const isLocked = () => locked;

function load(file) {
  try {
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hex = /^[0-9a-f]{32,256}$/i;
    const ok =
      b &&
      hex.test(b.salt) &&
      hex.test(b.hash) &&
      [b.N, b.r, b.p].every(Number.isInteger) &&
      b.N >= 1024 &&
      b.N <= 131072 &&
      (b.N & (b.N - 1)) === 0 &&
      b.r >= 1 &&
      b.r <= 16 &&
      b.p >= 1 &&
      b.p <= 16;
    if (!ok) return null;
    return { salt: b.salt, hash: b.hash, N: b.N, r: b.r, p: b.p, auto: AUTO.includes(b.auto) ? b.auto : 0 };
  } catch {
    return null;
  }
}

function save(file, c) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, ...c }), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const derive = (pw, salt, o) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(pw.normalize('NFC'), salt, 64, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r }, (e, k) =>
      e ? reject(e) : resolve(k)
    );
  });

const badNew = (p, min) =>
  typeof p !== 'string'
    ? 'Enter a password.'
    : p.length < (min || MIN_LEN)
      ? 'Use at least ' + (min || MIN_LEN) + ' characters.'
      : p.length > MAX_LEN
        ? 'That password is too long.'
        : '';

async function check(pw) {
  if (!cfg && !pwMode()) return { ok: false, error: 'No password is set.' };
  const now = Date.now();
  if (now < blockedUntil) return { ok: false, error: 'Too many wrong attempts.', wait: Math.ceil((blockedUntil - now) / 1000) };
  if (busy) return { ok: false, error: 'Please wait a moment.' };
  busy = true;
  let ok = false;
  try {
    if (typeof pw === 'string' && pw.length <= 256) {
      if (pwMode()) ok = await storage.unlockWithPassword(pw);
      else {
        const key = await derive(pw, Buffer.from(cfg.salt, 'hex'), cfg);
        const want = Buffer.from(cfg.hash, 'hex');
        ok = key.length === want.length && crypto.timingSafeEqual(key, want);
      }
    }
  } catch {
    ok = false;
  } finally {
    busy = false;
  }
  if (ok) {
    fails = 0;
    return { ok: true };
  }
  fails++;
  if (fails >= 5) blockedUntil = Date.now() + Math.min(5000 * 2 ** (fails - 5), 300000);
  const wait = blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0;
  return { ok: false, error: 'Wrong password.', wait };
}

function register(ipc, getWin, { app, ipcMain, BrowserWindow, webContents, powerMonitor, storage: store }) {
  storage = store || null;
  const file = () => path.join(app.getPath('userData'), FILE);
  const hiddenWins = new Set(),
    mutedViews = new Set();

  cfg = load(file());
  locked = !!cfg || pwMode();

  const send = () => {
    const w = getWin();
    if (w) w.webContents.send('lock:changed', { locked });
  };

  function doLock() {
    if (locked || !(cfg || pwMode())) return;
    locked = true;
    const main = getWin();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== main && !w.isDestroyed() && w.isVisible()) {
        hiddenWins.add(w);
        w.hide();
      }
    }
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (!wc.isDestroyed() && !wc.isAudioMuted()) {
          mutedViews.add(wc);
          wc.setAudioMuted(true);
        }
      } catch {}
    }
    send();
  }

  function doUnlock() {
    if (!locked) return;
    locked = false;
    for (const wc of mutedViews) {
      try {
        if (!wc.isDestroyed()) wc.setAudioMuted(false);
      } catch {}
    }
    mutedViews.clear();
    for (const w of hiddenWins) {
      try {
        if (!w.isDestroyed()) w.showInactive();
      } catch {}
    }
    hiddenWins.clear();
    send();
  }

  function schedule() {
    clearInterval(timer);
    timer = 0;
    if (!cfg || !cfg.auto) return;
    timer = setInterval(() => {
      try {
        if (!locked && cfg && cfg.auto && powerMonitor.getSystemIdleTime() >= cfg.auto * 60) doLock();
      } catch {}
    }, 15000);
  }
  schedule();

  ipcMain.on('lock:initial', e => {
    const w = getWin();
    e.returnValue = { startLocked: !!(w && e.sender === w.webContents && locked) };
  });

  ipc.handle('lock:state', () => ({
    enabled: !!cfg || pwMode(),
    locked,
    auto: cfg ? cfg.auto : 0,
    dir: app.getPath('userData'),
    storagePassword: pwMode()
  }));

  ipc.handle('lock:set', async (_e, a) => {
    const err = badNew(a && a.password, pwMode() ? MIN_STORE : MIN_LEN);
    if (err) return { ok: false, error: err };
    if (cfg || pwMode()) {
      const c = await check(a.current);
      if (!c.ok) return c;
    }
    if (pwMode()) {
      const r = await storage.changePassword(a.current, a.password);
      if (!r.ok) return r;
    }
    const salt = crypto.randomBytes(16);
    let hash;
    try {
      hash = (await derive(a.password, salt, COST)).toString('hex');
    } catch {
      return { ok: false, error: 'Could not set the password.' };
    }
    const next = { salt: salt.toString('hex'), hash, ...COST, auto: cfg ? cfg.auto : 0 };
    try {
      save(file(), next);
    } catch {
      return { ok: false, error: 'Could not save the password.' };
    }
    cfg = next;
    fails = 0;
    blockedUntil = 0;
    schedule();
    return { ok: true };
  });

  ipc.handle('lock:remove', async (_e, a) => {
    if (pwMode())
      return {
        ok: false,
        error: 'This password also protects your saved data. Switch Data protection back to your Windows account first.'
      };
    if (!cfg) return { ok: true };
    const c = await check(a && a.password);
    if (!c.ok) return c;
    try {
      fs.unlinkSync(file());
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return { ok: false, error: 'Could not remove the password.' };
    }
    cfg = null;
    fails = 0;
    blockedUntil = 0;
    schedule();
    return { ok: true };
  });

  ipc.handle('lock:lock', () => {
    if (!cfg && !pwMode()) return { ok: false, error: 'Set a password first.' };
    doLock();
    return { ok: true };
  });

  ipc.handle('lock:unlock', async (_e, a) => {
    if (!locked) return { ok: true };
    const c = await check(a && a.password);
    if (!c.ok) return c;
    if (pwMode() && !cfg) {
      try {
        await writeCfg(a.password, 0);
      } catch {}
    }
    doUnlock();
    return { ok: true };
  });

  async function writeCfg(password, auto) {
    const salt = crypto.randomBytes(16);
    const hash = (await derive(password, salt, COST)).toString('hex');
    const next = { salt: salt.toString('hex'), hash, ...COST, auto };
    save(file(), next);
    cfg = next;
    schedule();
  }

  ipc.handle('store:pwEnable', async (_e, a) => {
    if (pwMode()) return { ok: false, error: 'A password is already in use.' };
    const err = badNew(a && a.password, MIN_STORE);
    if (err) return { ok: false, error: err };
    if (cfg) {
      const c = await check(a.current);
      if (!c.ok) return c;
    }
    const r = await storage.usePassword(a.password);
    if (!r.ok) return r;
    try {
      await writeCfg(a.password, cfg ? cfg.auto : 0);
    } catch {}
    fails = 0;
    blockedUntil = 0;
    return { ok: true };
  });

  ipc.handle('store:pwDisable', async (_e, a) => {
    if (!pwMode()) return { ok: true };
    const c = await check(a && a.current);
    if (!c.ok) return c;
    const r = await storage.useWindows(a.current);
    if (!r.ok) return r;
    fails = 0;
    blockedUntil = 0;
    return { ok: true };
  });

  ipc.handle('lock:auto', (_e, a) => {
    const m = a && a.minutes;
    if (!cfg) return { ok: false, error: 'Set a password first.' };
    if (!AUTO.includes(m)) return { ok: false, error: 'Choose one of the listed times.' };
    const next = { ...cfg, auto: m };
    try {
      save(file(), next);
    } catch {
      return { ok: false, error: 'Could not save the setting.' };
    }
    cfg = next;
    schedule();
    return { ok: true };
  });
}

module.exports = {
  register,
  isLocked,
  _test: {
    check,
    load,
    save,
    badNew,
    setState(c) {
      cfg = c;
      fails = 0;
      blockedUntil = 0;
      busy = false;
      storage = null;
    },
    state() {
      return { fails, blockedUntil };
    },
    derive,
    COST
  }
};
