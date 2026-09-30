// File shredder backend: overwrites files 5 times, renames them, then deletes them. Works on
// files and folders. Only paths the user picked in the native dialogs can be shredded, and the
// main process asks for confirmation itself, so the page cannot shred anything on its own.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CHUNK = 4 * 1024 * 1024;
// Pass 1 zeros, 2 ones, 3 random, 4 alternating bits (0xAA), 5 random.
const PASSES = [0x00, 0xFF, 'rand', 0xAA, 'rand'];

const norm = p => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
function isProtected(p) {
  const full = path.resolve(p), n = norm(full);
  if (norm(path.parse(full).root) === n) return true; // a drive root
  const env = k => process.env[k] || '';
  const sys = norm(env('SystemRoot') || 'C:\\Windows');
  if (n === sys || n.startsWith(sys + path.sep)) return true;
  const exact = [env('ProgramFiles'), env('ProgramFiles(x86)'), env('ProgramData'), env('USERPROFILE'),
    env('APPDATA'), env('LOCALAPPDATA'), os.homedir(), path.dirname(os.homedir())].filter(Boolean).map(norm);
  // Exact matches, and any folder that contains one of them (for example AppData, which holds Roaming and Local).
  return exact.some(x => x === n || x.startsWith(n + path.sep));
}

async function collect(p, files, dirs) {
  const st = await fsp.lstat(p);
  if (st.isSymbolicLink()) files.push({ p, size: 0, link: true }); // remove the link, never its target
  else if (st.isDirectory()) {
    for (const e of await fsp.readdir(p)) await collect(path.join(p, e), files, dirs);
    dirs.push(p); // children come first, so folders can be removed in this order
  } else if (st.isFile()) files.push({ p, size: st.size });
}

function register(ipcMain, getWin, { dialog }) {
  const allowed = new Set();
  let running = false, stop = false;
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('shr:progress', m); };

  ipcMain.handle('shr:pick', async (_e, kind) => {
    const win = getWin();
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'folders' ? 'Choose folders to shred' : 'Choose files to shred',
      properties: kind === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    });
    if (r.canceled) return { ok: true, data: { items: [], skipped: [] } };
    const items = [], skipped = [];
    for (const p of r.filePaths) {
      if (isProtected(p)) { skipped.push(p); continue; }
      allowed.add(p);
      items.push({ path: p, kind: kind === 'folders' ? 'folder' : 'file' });
    }
    return { ok: true, data: { items, skipped } };
  });

  ipcMain.handle('shr:cancel', () => { stop = true; return true; });

  ipcMain.handle('shr:run', async (_e, req) => {
    if (running) return { ok: false, error: 'A shred is already running.' };
    const paths = [...new Set((Array.isArray(req && req.paths) ? req.paths : []).filter(p => typeof p === 'string' && allowed.has(p) && !isProtected(p)))];
    if (!paths.length) return { ok: false, error: 'Nothing was selected.' };

    const names = paths.slice(0, 5).map(p => path.basename(p) || p).join('\n');
    const ask = await dialog.showMessageBox(getWin(), {
      type: 'warning', buttons: ['Cancel', 'Shred permanently'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Shred permanently?',
      message: 'Permanently shred ' + paths.length + ' item' + (paths.length > 1 ? 's' : '') + '?',
      detail: names + (paths.length > 5 ? '\n...and ' + (paths.length - 5) + ' more' : '') +
        '\n\nEach file is overwritten 5 times and then deleted. It skips the Recycle Bin and cannot be recovered.'
    });
    if (ask.response !== 1) return { ok: false, declined: true, error: 'Shredding was cancelled. Nothing was changed.' };

    running = true; stop = false;
    const failed = [];
    let nFiles = 0, nFolders = 0, bytes = 0, cancelled = false;
    try {
      const files = [], dirs = [];
      for (const p of paths) {
        try { await collect(p, files, dirs); } catch (e) { failed.push({ path: p, error: e.code || e.message }); }
      }
      const total = files.reduce((a, f) => a + f.size * PASSES.length, 0);
      let done = 0, last = 0;
      const tick = (name, i, pass) => {
        const now = Date.now();
        if (now - last < 100) return;
        last = now;
        send({ t: 'p', name, i, n: files.length, pass: pass + 1, passes: PASSES.length, done, total });
      };

      for (let i = 0; i < files.length && !stop; i++) {
        const f = files[i], name = path.basename(f.p);
        send({ t: 'p', name, i: i + 1, n: files.length, pass: 1, passes: PASSES.length, done, total });
        try {
          if (f.link) {
            try { await fsp.unlink(f.p); } catch { await fsp.rmdir(f.p); }
            continue;
          }
          await fsp.chmod(f.p, 0o666).catch(() => {});
          const fh = await fsp.open(f.p, 'r+');
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
                pos += n; done += n;
                tick(name, i + 1, pass);
              }
              await fh.sync();
            }
            await fh.truncate(0);
          } finally { await fh.close(); }
          // Hide the original name too, then delete.
          let target = f.p;
          try {
            target = path.join(path.dirname(f.p), crypto.randomBytes(8).toString('hex'));
            await fsp.rename(f.p, target);
          } catch { target = f.p; }
          await fsp.unlink(target);
          nFiles++; bytes += f.size;
        } catch (e) {
          if (e.stopped) { cancelled = true; break; }
          failed.push({ path: f.p, error: e.code || e.message });
        }
      }
      if (stop) cancelled = true;

      if (!cancelled) {
        send({ t: 'finish' });
        for (const d of dirs) {
          try { await fsp.rmdir(d); nFolders++; }
          catch (e) { if (!failed.some(x => x.path.startsWith(d))) failed.push({ path: d, error: e.code || e.message }); }
        }
      }
      for (const p of paths) allowed.delete(p);
      return { ok: true, data: { files: nFiles, folders: nFolders, bytes, failed, cancelled, passes: PASSES.length } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally { running = false; }
  });
}

module.exports = { register };
