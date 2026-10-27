const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CHUNK = 4 * 1024 * 1024;
const PASSES = [0x00, 0xff, 'rand', 0xaa, 'rand'];

const norm = p =>
  path
    .resolve(p)
    .replace(/[\\/]+$/, '')
    .toLowerCase();
function isProtected(p) {
  const full = path.resolve(p),
    n = norm(full);
  if (norm(path.parse(full).root) === n) return true;
  const env = k => process.env[k] || '';
  const sys = norm(env('SystemRoot') || 'C:\\Windows');
  if (n === sys || n.startsWith(sys + path.sep)) return true;
  const exact = [
    env('ProgramFiles'),
    env('ProgramFiles(x86)'),
    env('ProgramData'),
    env('USERPROFILE'),
    env('APPDATA'),
    env('LOCALAPPDATA'),
    os.homedir(),
    path.dirname(os.homedir())
  ]
    .filter(Boolean)
    .map(norm);
  return exact.some(x => x === n || x.startsWith(n + path.sep));
}

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const randName = len => {
  const b = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += NAME_CHARS[b[i] % NAME_CHARS.length];
  return s;
};
const nameLen = p => Math.min(Math.max(path.basename(p).length, 8), 200);
const T0 = Date.UTC(1980, 0, 1),
  T1 = Date.UTC(2030, 0, 1);
const randTime = () => T0 + crypto.randomInt(0, T1 - T0);
const exists = async p => {
  try {
    await fsp.lstat(p);
    return true;
  } catch (e) {
    return e.code !== 'ENOENT';
  }
};

async function scrambleName(p, len) {
  const dir = path.dirname(p);
  for (let t = 0; t < 20; t++) {
    const np = path.join(dir, randName(len));
    if (await exists(np)) continue;
    try {
      await fsp.rename(p, np);
      return np;
    } catch {
      return p;
    }
  }
  return p;
}

const readPS = name =>
  fs
    .readFileSync(path.join(__dirname, 'ps', name), 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .join('\n');
function metaHelper() {
  if (process.platform !== 'win32') return { run: async () => true, close() {} };
  let child = null,
    dead = false,
    buf = '';
  const waiting = [];
  const fail = () => {
    dead = true;
    for (const w of waiting.splice(0)) {
      clearTimeout(w.t);
      w.res(false);
    }
    try {
      if (child) child.kill();
    } catch {}
  };
  try {
    child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(readPS('shred-meta.ps1'), 'utf16le').toString('base64')
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const w = waiting.shift();
        if (w) {
          clearTimeout(w.t);
          w.res(line === 'ok');
        }
      }
    });
    child.stdin.on('error', fail);
    child.on('error', fail);
    child.on('exit', fail);
  } catch {
    dead = true;
  }
  return {
    run: (kind, p, time) =>
      new Promise(res => {
        if (dead || !child) return res(false);
        const w = { res, t: setTimeout(fail, 15000) };
        waiting.push(w);
        try {
          child.stdin.write(kind + ' ' + Buffer.from(p, 'utf8').toString('base64') + ' ' + time + '\n');
        } catch {
          fail();
        }
      }),
    close() {
      dead = true;
      try {
        if (child) {
          child.stdin.end();
          child.kill();
        }
      } catch {}
    }
  };
}

async function collect(p, files, dirs) {
  const st = await fsp.lstat(p);
  if (st.isSymbolicLink()) files.push({ p, size: 0, link: true });
  else if (st.isDirectory()) {
    for (const e of await fsp.readdir(p)) await collect(path.join(p, e), files, dirs);
    dirs.push(p);
  } else if (st.isFile()) files.push({ p, size: st.size });
}

function register(ipcMain, getWin, { dialog }) {
  const allowed = new Set();
  let running = false,
    stop = false;
  const send = m => {
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('shr:progress', m);
  };

  ipcMain.handle('shr:pick', async (_e, kind) => {
    const win = getWin();
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'folders' ? 'Choose folders to shred' : 'Choose files to shred',
      properties: kind === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    });
    if (r.canceled) return { ok: true, data: { items: [], skipped: [] } };
    const items = [],
      skipped = [];
    for (const p of r.filePaths) {
      if (isProtected(p)) {
        skipped.push(p);
        continue;
      }
      allowed.add(p);
      items.push({ path: p, kind: kind === 'folders' ? 'folder' : 'file' });
    }
    return { ok: true, data: { items, skipped } };
  });

  ipcMain.handle('shr:cancel', () => {
    stop = true;
    return true;
  });

  ipcMain.handle('shr:run', async (_e, req) => {
    if (running) return { ok: false, error: 'A shred is already running.' };
    const paths = [
      ...new Set((Array.isArray(req && req.paths) ? req.paths : []).filter(p => typeof p === 'string' && allowed.has(p) && !isProtected(p)))
    ];
    if (!paths.length) return { ok: false, error: 'Nothing was selected.' };

    const names = paths
      .slice(0, 5)
      .map(p => path.basename(p) || p)
      .join('\n');
    const ask = await dialog.showMessageBox(getWin(), {
      type: 'warning',
      buttons: ['Cancel', 'Shred permanently'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Shred permanently?',
      message: 'Permanently shred ' + paths.length + ' item' + (paths.length > 1 ? 's' : '') + '?',
      detail:
        names +
        (paths.length > 5 ? '\n...and ' + (paths.length - 5) + ' more' : '') +
        '\n\nEach file is overwritten 5 times. Its name and timestamps are scrambled on every pass, then it is deleted. It skips the Recycle Bin and cannot be recovered.'
    });
    if (ask.response !== 1) return { ok: false, declined: true, error: 'Shredding was cancelled. Nothing was changed.' };

    running = true;
    stop = false;
    const meta = metaHelper();
    const failed = [];
    let nFiles = 0,
      nFolders = 0,
      bytes = 0,
      cancelled = false;
    try {
      const files = [],
        dirs = [];
      for (const p of paths) {
        try {
          await collect(p, files, dirs);
        } catch (e) {
          failed.push({ path: p, error: e.code || e.message });
        }
      }
      const total = files.reduce((a, f) => a + f.size * PASSES.length, 0);
      let done = 0,
        last = 0;
      const tick = (name, i, pass) => {
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        send({ t: 'p', name, i, n: files.length, pass: pass + 1, passes: PASSES.length, done, total });
      };

      for (let i = 0; i < files.length && !stop; i++) {
        const f = files[i],
          name = path.basename(f.p);
        send({ t: 'p', name, i: i + 1, n: files.length, pass: 1, passes: PASSES.length, done, total });
        let cur = f.p;
        const len = nameLen(f.p);
        try {
          if (f.link) {
            cur = await scrambleName(cur, len);
            try {
              await fsp.unlink(cur);
            } catch {
              await fsp.rmdir(cur);
            }
            continue;
          }
          await fsp.chmod(f.p, 0o666).catch(() => {});
          const fh = await fsp.open(f.p, 'r+');
          const scrub = async () => {
            const t = new Date(randTime());
            try {
              await fh.utimes(t, new Date(randTime()));
            } catch {}
            await meta.run('f', cur, randTime());
            cur = await scrambleName(cur, len);
          };
          try {
            const buf = Buffer.allocUnsafe(Math.max(1, Math.min(CHUNK, f.size)));
            for (let pass = 0; pass < PASSES.length; pass++) {
              const pat = PASSES[pass];
              if (pat !== 'rand') buf.fill(pat);
              for (let pos = 0; pos < f.size; ) {
                if (stop) throw Object.assign(new Error('stopped'), { stopped: true });
                const n = Math.min(buf.length, f.size - pos);
                if (pat === 'rand') crypto.randomFillSync(buf, 0, n);
                await fh.write(buf, 0, n, pos);
                pos += n;
                done += n;
                tick(name, i + 1, pass);
              }
              await fh.sync();
              await scrub();
            }
            await fh.truncate(0);
            await scrub();
          } finally {
            await fh.close();
          }
          await fsp.unlink(cur);
          nFiles++;
          bytes += f.size;
        } catch (e) {
          if (cur !== f.p && !(await exists(f.p))) {
            try {
              await fsp.rename(cur, f.p);
              cur = f.p;
            } catch {}
          }
          if (e.stopped) {
            cancelled = true;
            break;
          }
          failed.push({ path: cur, error: e.code || e.message });
        }
      }
      if (stop) cancelled = true;

      if (!cancelled) {
        send({ t: 'finish' });
        for (const d of dirs) {
          let cur = d;
          try {
            if (!(await fsp.readdir(d)).length) {
              const len = nameLen(d);
              for (let k = 0; k < PASSES.length; k++) {
                const t = new Date(randTime());
                await fsp.utimes(cur, t, new Date(randTime())).catch(() => {});
                await meta.run('d', cur, randTime());
                cur = await scrambleName(cur, len);
              }
            }
            await fsp.rmdir(cur);
            nFolders++;
          } catch (e) {
            if (cur !== d && !(await exists(d))) {
              try {
                await fsp.rename(cur, d);
              } catch {}
            }
            if (!failed.some(x => x.path.startsWith(d))) failed.push({ path: d, error: e.code || e.message });
          }
        }
      }
      for (const p of paths) allowed.delete(p);
      return { ok: true, data: { files: nFiles, folders: nFolders, bytes, failed, cancelled, passes: PASSES.length } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      running = false;
      meta.close();
    }
  });
}

module.exports = { register, _test: { isProtected, PASSES } };
