// Phone Link backend: shows and controls an Android phone on this PC over USB with scrcpy.
// scrcpy opens its own window (the phone screen, mouse and keyboard work in it), and adb, which
// comes in the same download as scrcpy, is used for the phone list and the quick buttons.
//
// The page never sends commands or paths. It sends a phone serial that must be in the last adb
// list, option values that are checked against fixed lists here, and names of quick actions that
// map to fixed adb arguments. Files this module writes (screenshots, recordings) go to
// Downloads\ZanesUtilities, and the APK to install comes from a native file dialog opened here.
//
// scrcpy and adb are looked for, in order, in: the "scrcpy" folder next to the app (unpacked from the
// asar archive when packaged), "scrcpy" in the app's resources folder, "scrcpy" in the app's data folder,
// and finally the folders on PATH. Nothing is downloaded by the app.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const SERIAL = /^[\w.:\-]{1,64}$/;
// Quick buttons. The numbers are Android key codes (KEYCODE_HOME and so on).
const KEYS = { home: 3, back: 4, recents: 187, power: 26, volup: 24, voldown: 25, wake: 224 };
const SHELL = { notif: ['shell', 'cmd', 'statusbar', 'expand-notifications'] };
const SIZES = [0, 800, 1024, 1280, 1920, 2560];   // longest side in pixels, 0 = the phone's own size
const RATES = [2, 4, 8, 16, 32, 64];              // video bit rate in Mbit/s
const FPS = [15, 30, 60, 90, 120];

const unpack = p => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const exe = n => n + (process.platform === 'win32' ? '.exe' : '');

function ownDirs(app) {
  const d = [unpack(path.join(__dirname, 'scrcpy'))];
  if (process.resourcesPath) d.push(path.join(process.resourcesPath, 'scrcpy'));
  try { d.push(path.join(app.getPath('userData'), 'scrcpy')); } catch {}
  return d;
}

function findTools(app) {
  const own = ownDirs(app);
  const all = own.concat((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  const look = (name, dirs) => { for (const d of dirs) { const f = path.join(d, exe(name)); if (fs.existsSync(f)) return f; } return ''; };
  const scrcpy = look('scrcpy', all);
  // adb from the same download as scrcpy is the safest pairing; otherwise any adb on this PC.
  const adb = (scrcpy && look('adb', [path.dirname(scrcpy)])) || look('adb', all);
  return { scrcpy, adb, own, bundled: !!adb && own.includes(path.dirname(adb)) };
}

function run(bin, args, { timeout = 15000 } = {}) {
  return new Promise(resolve => {
    let p, out = '', err = '', timedOut = false, done = false;
    const fin = code => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, timedOut }); };
    let timer = 0;
    try { p = spawn(bin, args, { windowsHide: true }); } catch (e) { resolve({ code: -1, out, err: e.message }); return; }
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    timer = setTimeout(() => { timedOut = true; p.kill(); }, timeout);
    p.stdout.on('data', d => { out = (out + d).slice(-1e6); });
    p.stderr.on('data', d => { err = (err + d).slice(-1e6); });
    p.on('error', e => { err = e.message; fin(-1); });
    // 'close' waits for the output pipes to end, which never happens if adb leaves its background server holding them.
    // So also finish shortly after the process itself exits.
    p.on('exit', code => setTimeout(() => fin(code), 250));
    p.on('close', code => fin(code));
  });
}

const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
};
const pick = (v, allowed, def) => (allowed.includes(Number(v)) ? Number(v) : def);
const stateHelp = s => s === 'unauthorized' ? 'Unlock the phone and tap Allow on the USB debugging prompt, then press Refresh.'
  : s === 'offline' ? 'The phone is offline. Unplug it, plug it back in and press Refresh.'
  : 'The phone is not ready (' + s + ').';

function register(ipcMain, getWin, { app, dialog, shell }) {
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('phn:event', m); };
  const info = new Map();        // serial -> { mfr, model, android }, asked once per phone
  const made = new Set();        // files this module wrote, the only ones the page may reveal
  const versions = new Map();    // scrcpy path -> version text
  let seen = new Map();          // serial -> device from the last adb list
  let proc = null, stopping = false, tail = [], usedAdb = false, installing = false, polling = false;

  const outDir = () => path.join(app.getPath('downloads'), 'ZanesUtilities');

  function need(req) {
    const t = findTools(app);
    if (!t.adb) return { error: 'adb was not found. It comes in the same download as scrcpy.' };
    const serial = String((req && req.serial) || '');
    const d = seen.get(serial);
    if (!SERIAL.test(serial) || !d) return { error: 'That phone is not in the list. Press Refresh.' };
    if (d.state !== 'device') return { error: stateHelp(d.state) };
    return { t, serial, d };
  }

  function stopProc() {
    if (!proc) return;
    const p = proc;
    stopping = true;
    if (process.platform === 'win32' && p.pid) {
      // Without /F this asks the scrcpy window to close, so a recording is finished properly.
      try { spawn('taskkill', ['/PID', String(p.pid)], { windowsHide: true }).on('error', () => {}); } catch {}
      setTimeout(() => { if (proc === p) p.kill(); }, 3000);
    } else p.kill();
  }

  app.on('before-quit', () => {
    if (proc) proc.kill();
    // adb starts a background server. When it came from this app's own scrcpy folder, stop it on the way out
    // so it does not keep those files locked. An adb found on PATH belongs to the user and is left alone.
    if (usedAdb) {
      const t = findTools(app);
      if (t.adb && t.bundled) { try { spawn(t.adb, ['kill-server'], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); } catch {} }
    }
  });

  ipcMain.handle('phn:status', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Only available on Windows.' };
    const t = findTools(app);
    let version = '';
    if (t.scrcpy) {
      if (!versions.has(t.scrcpy)) {
        const r = await run(t.scrcpy, ['--version'], { timeout: 8000 });
        const m = /scrcpy\s+(\d+(?:\.\d+)*)/i.exec(r.out);
        versions.set(t.scrcpy, m ? m[1] : '');
      }
      version = versions.get(t.scrcpy);
    }
    return { ok: true, data: { scrcpy: !!t.scrcpy, adb: !!t.adb, version, places: t.own, running: !!proc } };
  });

  ipcMain.handle('phn:folder', async () => {
    try {
      const dir = path.join(app.getPath('userData'), 'scrcpy');
      await fsp.mkdir(dir, { recursive: true });
      const err = await shell.openPath(dir);
      return err ? { ok: false, error: err } : { ok: true, data: dir };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('phn:devices', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Only available on Windows.' };
    const t = findTools(app);
    if (!t.adb) return { ok: false, notool: true, error: 'adb was not found.' };
    if (polling) return { ok: false, busy: true, error: 'Already checking.' };
    polling = true;
    try {
      usedAdb = true;
      const r = await run(t.adb, ['devices', '-l'], { timeout: 20000 });
      const lines = r.out.replace(/\r/g, '').split('\n');
      const at = lines.findIndex(l => /^List of devices attached/i.test(l));
      if (at < 0) return { ok: false, error: (r.err || r.out || 'adb did not answer.').trim().slice(0, 300) };
      const list = [];
      for (const l of lines.slice(at + 1)) {
        const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(l.trim());
        if (!m || !SERIAL.test(m[1])) continue;
        const kv = {};
        for (const x of m[3].split(/\s+/)) { const i = x.indexOf(':'); if (i > 0) kv[x.slice(0, i)] = x.slice(i + 1); }
        list.push({ serial: m[1], state: m[2], usb: 'usb' in kv, model: (kv.model || '').replace(/_/g, ' ') });
      }
      seen = new Map(list.map(d => [d.serial, d]));
      await Promise.all(list.filter(d => d.state === 'device' && !info.has(d.serial)).map(async d => {
        const q = await run(t.adb, ['-s', d.serial, 'shell', 'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release'], { timeout: 8000 });
        const [mfr = '', model = '', android = ''] = q.out.replace(/\r/g, '').split('\n').map(s => s.trim());
        if (model) info.set(d.serial, { mfr, model, android });
      }));
      for (const d of list) Object.assign(d, info.get(d.serial) || {});
      return { ok: true, data: { devices: list } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally { polling = false; }
  });

  ipcMain.handle('phn:start', async (_e, req) => {
    if (process.platform !== 'win32') return { ok: false, error: 'Only available on Windows.' };
    if (proc) return { ok: false, error: 'Phone Link is already running. Stop it first.' };
    const n = need(req);
    if (n.error) return { ok: false, error: n.error };
    if (!n.t.scrcpy) return { ok: false, error: 'scrcpy was not found.' };
    const o = (req && req.opts) || {};
    const ro = !!o.view;   // view only: scrcpy refuses the options that need control, so they are dropped

    const args = ['-s', n.serial, '--window-title=' + (n.d.model || n.serial).replace(/[^\w .-]/g, '')];
    const size = pick(o.size, SIZES, 1920);
    if (size) args.push('--max-size=' + size);
    args.push('--video-bit-rate=' + pick(o.rate, RATES, 8) + 'M', '--max-fps=' + pick(o.fps, FPS, 60));
    if (!o.audio) args.push('--no-audio');
    if (o.top) args.push('--always-on-top');
    if (o.full) args.push('--fullscreen');
    if (ro) args.push('--no-control');
    else {
      if (o.awake) args.push('--stay-awake');
      if (o.off) args.push('--turn-screen-off');
      if (o.touch) args.push('--show-touches');
      if (o.poff) args.push('--power-off-on-close');
    }
    let rec = '';
    if (o.rec) {
      try {
        await fsp.mkdir(outDir(), { recursive: true });
        // .mkv is used because it stays playable even if scrcpy has to be stopped abruptly.
        rec = path.join(outDir(), 'phone-' + stamp() + '.mkv');
        args.push('--record=' + rec);
        made.add(rec);
      } catch (e) { return { ok: false, error: 'Could not create the recordings folder: ' + String((e && e.message) || e) }; }
    }

    stopping = false; tail = [];
    const env = { ...process.env };
    if (n.t.adb) env.ADB = n.t.adb;   // make scrcpy use the same adb, so two adb versions do not fight over the server
    const p = spawn(n.t.scrcpy, args, { windowsHide: true, env });
    proc = p;
    const feed = () => {
      let buf = '';
      return d => {
        buf += d;
        const ls = buf.split(/\r?\n/); buf = ls.pop();
        for (const l of ls) {
          const s = l.trim().slice(0, 300);
          if (!s) continue;
          tail.push(s); if (tail.length > 40) tail.shift();
          send({ t: 'log', line: s });
        }
      };
    };
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', feed()); p.stderr.on('data', feed());
    const lastError = () => {
      const l = tail.slice().reverse().find(x => /error|could not|failed|cannot|unknown option/i.test(x));
      return (l || tail[tail.length - 1] || '').replace(/^(ERROR|WARN|INFO):\s*/i, '');
    };
    let finished = false;
    const finish = code => {
      if (finished) return;
      finished = true;
      if (proc === p) proc = null;
      const clean = stopping || code === 0;
      send({ t: 'exit', code, rec: rec && fs.existsSync(rec) ? rec : '', err: clean ? '' : lastError() });
    };
    p.on('error', e => { tail.push(e.message); finish(-1); });
    p.on('exit', code => setTimeout(() => finish(code), 250));   // a little time for the last log lines to arrive
    p.on('close', code => finish(code));
    send({ t: 'state', running: true });

    // If scrcpy quits within a couple of seconds, something is wrong (phone locked, too old Android, bad option).
    const early = await new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v); } };
      p.once('error', e => fin({ error: e.message }));
      p.once('exit', code => setTimeout(() => fin({ code }), 300));
      p.once('close', code => fin({ code }));
      setTimeout(() => fin(null), 2500);
    });
    if (early) return { ok: false, error: 'scrcpy stopped right away' + (early.error || lastError() ? ': ' + (early.error || lastError()) : '.') };
    return { ok: true, data: { rec } };
  });

  ipcMain.handle('phn:stop', () => { stopProc(); return { ok: true }; });

  ipcMain.handle('phn:key', async (_e, req) => {
    const n = need(req);
    if (n.error) return { ok: false, error: n.error };
    const action = String((req && req.action) || '');
    let args;
    if (Object.prototype.hasOwnProperty.call(KEYS, action)) args = ['shell', 'input', 'keyevent', String(KEYS[action])];
    else if (Object.prototype.hasOwnProperty.call(SHELL, action)) args = SHELL[action];
    else return { ok: false, error: 'Unknown action.' };
    const r = await run(n.t.adb, ['-s', n.serial, ...args], { timeout: 8000 });
    return r.code === 0 ? { ok: true } : { ok: false, error: (r.err || r.out || 'The phone did not accept that.').trim().slice(0, 200) };
  });

  ipcMain.handle('phn:shot', async (_e, req) => {
    const n = need(req);
    if (n.error) return { ok: false, error: n.error };
    try {
      await fsp.mkdir(outDir(), { recursive: true });
      const png = await new Promise((resolve, reject) => {
        const p = spawn(n.t.adb, ['-s', n.serial, 'exec-out', 'screencap', '-p'], { windowsHide: true });
        const chunks = []; let size = 0, err = '';
        const timer = setTimeout(() => { p.kill(); reject(new Error('The phone took too long to answer.')); }, 20000);
        p.stdout.on('data', d => { size += d.length; if (size > 60e6) { p.kill(); reject(new Error('The screenshot was larger than expected.')); } else chunks.push(d); });
        p.stderr.on('data', d => { err += d; });
        p.on('error', e => { clearTimeout(timer); reject(e); });
        p.on('close', () => { clearTimeout(timer); resolve({ buf: Buffer.concat(chunks), err }); });
      });
      const b = png.buf;
      if (b.length < 8 || b.readUInt32BE(0) !== 0x89504E47) return { ok: false, error: (png.err || 'The phone did not return a picture. The screen may be protected.').trim().slice(0, 200) };
      const file = path.join(outDir(), 'phone-' + stamp() + '.png');
      await fsp.writeFile(file, b);
      made.add(file);
      return { ok: true, data: { file } };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  ipcMain.handle('phn:install', async (_e, req) => {
    if (installing) return { ok: false, error: 'An install is already running.' };
    const n = need(req);
    if (n.error) return { ok: false, error: n.error };
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Choose an app (APK) to install on the phone', properties: ['openFile'],
      filters: [{ name: 'Android app', extensions: ['apk'] }]
    });
    if (r.canceled || !r.filePaths[0] || !/\.apk$/i.test(r.filePaths[0])) return { ok: false, declined: true, error: 'Cancelled. Nothing was installed.' };
    installing = true;
    try {
      const x = await run(n.t.adb, ['-s', n.serial, 'install', '-r', r.filePaths[0]], { timeout: 5 * 60 * 1000 });
      const text = (x.out + '\n' + x.err).replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
      if (/\bSuccess\b/.test(x.out)) return { ok: true, data: { name: path.basename(r.filePaths[0]) } };
      if (x.timedOut) return { ok: false, error: 'The install took too long. Check the phone: it may be waiting for you to confirm.' };
      return { ok: false, error: (text[text.length - 1] || 'The install failed.').slice(0, 300) };
    } finally { installing = false; }
  });

  ipcMain.handle('phn:reveal', (_e, req) => {
    const f = String((req && req.file) || '');
    if (!made.has(f) || !fs.existsSync(f)) return { ok: false, error: 'That file is not available.' };
    shell.showItemInFolder(f);
    return { ok: true };
  });
}

module.exports = { register };
