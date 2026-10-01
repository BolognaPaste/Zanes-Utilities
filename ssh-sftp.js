// File transfer (SFTP) for the SSH tab. Runs in the main process and rides on the SSH connection you already
// signed in with (a second channel on the same connection, so there is no second login).
//
// What it guarantees:
//  - The page never sees or chooses a path on this PC. Where files are saved and which files are sent are
//    picked in native dialogs that only this process can open.
//  - File names that come from the server are treated as untrusted. They are cleaned so a hostile server
//    cannot write outside the folder you chose (no "..\..\", no drive letters, no reserved Windows names).
//  - Nothing on this PC is ever overwritten: a download that would collide gets "name (1)" instead.
//    Replacing something on the server, or deleting, always asks first in a native dialog.
//  - Shortcuts (symbolic links) inside a folder are skipped, so a transfer cannot loop or leave the folder.
//  - Downloads go to "name.part" and are renamed only when complete, so a half-finished file never looks real.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const MAX_ITEMS = 50000;       // files + folders in one transfer
const MAX_DEPTH = 40;
const MAX_LIST = 5000;         // rows shown for one folder
const MAX_NAMES = 2000;        // items chosen at once
const STEP_MS = 120;           // progress messages are sent at most this often

const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000;
const kindOf = mode => { const t = (mode | 0) & S_IFMT; return t === S_IFDIR ? 'dir' : t === S_IFREG ? 'file' : t === S_IFLNK ? 'link' : 'other'; };

// Wraps an ssh2 callback-style method (sftp.readdir(path, cb) ...) as a promise.
const call = (o, m, ...a) => new Promise((res, rej) => { try { o[m](...a, (e, r) => (e ? rej(e) : res(r))); } catch (e) { rej(e); } });
const pj = (...a) => path.posix.join(...a);
const okName = n => typeof n === 'string' && n.length > 0 && n.length <= 255 && !/[\/\u0000]/.test(n) && n !== '.' && n !== '..';
const okDir = d => typeof d === 'string' && d.startsWith('/') && d.length <= 4096 && !d.includes('\u0000');
const cancelErr = () => Object.assign(new Error('Cancelled.'), { cancelled: true });
// Removes a half-written local file. On Windows the file can stay locked for a moment, so it tries twice.
async function rmQuiet(f) {
  try { await fsp.unlink(f); } catch (e) { if (e.code === 'ENOENT') return; await new Promise(r => setTimeout(r, 300)); try { await fsp.unlink(f); } catch {} }
}

function explain(e) {
  const m = String((e && e.message) || e || ''), c = e && e.code;
  if (e && e.cancelled) return 'Cancelled.';
  if (typeof c === 'string') {
    if (c === 'ENOSPC') return 'There is not enough free space on this PC.';
    if (c === 'EACCES' || c === 'EPERM') return 'Windows did not allow this app to use that file or folder.';
    if (c === 'EBUSY') return 'That file is in use by another program.';
    if (c === 'ENOENT') return 'A file on this PC was not found. It may have been moved or deleted.';
    if (c === 'EISDIR' || c === 'ENOTDIR') return 'A file and a folder have the same name, so it could not be copied.';
  }
  if (/subsystem|sftp/i.test(m) && /(fail|unable|not|denied|disabled|request)/i.test(m)) return 'This server does not allow file transfer (its SFTP service is switched off).';
  if (/not connected|no response|channel|closed|ended|destroyed/i.test(m)) return 'The connection to the server was lost.';
  if (c === 2) return 'That file or folder was not found on the server.';
  if (c === 3) return 'The server did not allow that (permission denied).';
  if (c === 4) return 'The server could not do that. A folder may not be empty, or the name may already be in use.';
  if (c === 8) return 'The server does not support that.';
  return m || 'The operation failed.';
}

// Makes a name that came from the server safe to use as a Windows file name.
function safeLocalName(n) {
  let s = String(n).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '');
  if (!s || s === '.' || s === '..') s = '_';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = '_' + s;
  if (s.length > 200) { const x = path.extname(s); s = s.slice(0, 200 - Math.min(x.length, 20)) + x.slice(0, 20); }
  return s;
}
function withSuffix(name, n) {
  const x = path.extname(name), base = x && x !== name ? name.slice(0, -x.length) : name;
  return base + ' (' + n + ')' + (x && x !== name ? x : '');
}
const inside = (root, p) => { const r = path.resolve(root), q = path.resolve(p); return q === r || q.startsWith(r.endsWith(path.sep) ? r : r + path.sep); };

/* ---------- browsing ---------- */
async function listDir(sftp, want) {
  const dir = await call(sftp, 'realpath', want || '.');
  if (!okDir(dir)) throw new Error('The server gave a folder path this app cannot use.');
  const raw = await call(sftp, 'readdir', dir);
  const entries = [];
  for (const it of raw || []) {
    const name = it && it.filename;
    if (!okName(name)) continue;                       // also drops "." and ".."
    const a = it.attrs || {};
    let kind = kindOf(a.mode);
    if (!a.mode && typeof it.longname === 'string') { const c = it.longname[0]; kind = c === 'd' ? 'dir' : c === '-' ? 'file' : c === 'l' ? 'link' : 'other'; }
    entries.push({ name, kind, size: Number(a.size) || 0, mtime: Number(a.mtime) || 0, target: '' });
  }
  const truncated = entries.length > MAX_LIST;
  entries.sort((a, b) => {
    const da = a.kind === 'dir' ? 0 : 1, db = b.kind === 'dir' ? 0 : 1;
    return da - db || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  entries.length = Math.min(entries.length, MAX_LIST);
  // A shortcut is shown as what it points to, so a link to a folder can be opened.
  const links = entries.filter(e => e.kind === 'link').slice(0, 300);
  await Promise.all(links.map(async e => {
    try { const st = await call(sftp, 'stat', pj(dir, e.name)); e.target = kindOf(st.mode); e.size = Number(st.size) || 0; } catch { e.target = 'broken'; }
  }));
  entries.sort((a, b) => {
    const da = a.kind === 'dir' || a.target === 'dir' ? 0 : 1, db = b.kind === 'dir' || b.target === 'dir' ? 0 : 1;
    return da - db || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  return { path: dir, entries, truncated };
}

/* ---------- a running transfer ---------- */
function newTransfer(op, emit) {
  const x = { op, cancelled: false, done: 0, total: 0, i: 0, n: 0, file: '', phase: 'scan', last: 0, partial: null };
  x.aborted = new Promise((_, rej) => { x.abort = () => rej(cancelErr()); });
  x.aborted.catch(() => {});
  x.cancel = () => { x.cancelled = true; x.abort(); };
  x.emit = (force) => {
    const now = Date.now();
    if (!force && now - x.last < STEP_MS) return;
    x.last = now;
    emit({ t: 'xfer', state: 'run', op, phase: x.phase, file: x.file, i: x.i, n: x.n, done: x.done, total: x.total });
  };
  // Runs one operation but gives up at once when the transfer is cancelled.
  x.guard = p => Promise.race([p, x.aborted]);
  return x;
}

function fastCopy(x, sftp, method, from, to, base) {
  return x.guard(new Promise((res, rej) => {
    sftp[method](from, to, {
      concurrency: 32, chunkSize: 32768,
      step: t => { x.done = base + t; x.emit(false); }
    }, e => (e ? rej(e) : res()));
  }));
}

/* ---------- download ---------- */
async function scanRemote(sftp, dir, names, x) {
  const items = [];             // { name, parent (remote path or null), remote, kind, size }
  let skipped = 0;
  const add = it => { items.push(it); if (items.length > MAX_ITEMS) throw new Error('That is more than ' + MAX_ITEMS + ' files and folders. Choose fewer, or a smaller folder.'); };
  async function walk(rdir, depth) {
    if (x.cancelled) throw cancelErr();
    if (depth > MAX_DEPTH) { skipped++; return; }
    const list = await x.guard(call(sftp, 'readdir', rdir));
    for (const it of list || []) {
      const name = it && it.filename;
      if (!okName(name)) continue;
      const a = it.attrs || {}, k = kindOf(a.mode), remote = pj(rdir, name);
      if (k === 'dir') { add({ name, parent: rdir, remote, kind: 'dir', size: 0 }); await walk(remote, depth + 1); }
      else if (k === 'file') add({ name, parent: rdir, remote, kind: 'file', size: Number(a.size) || 0 });
      else skipped++;                                   // shortcuts and special files
    }
  }
  for (const name of names) {
    if (x.cancelled) throw cancelErr();
    const remote = pj(dir, name);
    let st;
    try { st = await x.guard(call(sftp, 'stat', remote)); } catch (e) { if (e.cancelled) throw e; skipped++; continue; }
    const k = kindOf(st.mode);
    if (k === 'dir') { add({ name, parent: null, remote, kind: 'dir', size: 0 }); await walk(remote, 1); }
    else if (k === 'file') add({ name, parent: null, remote, kind: 'file', size: Number(st.size) || 0 });
    else skipped++;
  }
  return { items, skipped };
}

// Decides the local path of every item. Top-level names never replace anything that exists.
async function planLocal(items, destRoot) {
  const used = new Set(), localOf = new Map();
  for (const it of items) {
    const parentLocal = it.parent === null ? destRoot : localOf.get(it.parent);
    let name = safeLocalName(it.name), n = 0, cand;
    for (;;) {
      cand = path.join(parentLocal, n ? withSuffix(name, n) : name);
      let taken = used.has(cand.toLowerCase());
      if (!taken && it.parent === null) { try { await fsp.access(cand); taken = true; } catch {} }
      if (!taken) break;
      n++;
    }
    if (!inside(destRoot, cand)) throw new Error('A name from the server would have been saved outside the chosen folder. The transfer was stopped.');
    used.add(cand.toLowerCase());
    localOf.set(it.remote, cand);
    it.local = cand;
  }
}

async function runDownload(sftp, { dir, names, destRoot }, x, isDead) {
  x.phase = 'scan'; x.emit(true);
  const { items, skipped: sk } = await scanRemote(sftp, dir, names, x);
  await planLocal(items, destRoot);
  const files = items.filter(i => i.kind === 'file');
  x.total = files.reduce((a, i) => a + i.size, 0);
  x.n = files.length; x.i = 0; x.phase = 'copy';
  const res = { op: 'download', files: 0, dirs: 0, bytes: 0, failed: [], skipped: sk, cancelled: false, dest: destRoot };
  const badDirs = new Set();
  let base = 0;
  for (const it of items) {
    if (x.cancelled || isDead()) break;
    try {
      if (it.parent !== null && badDirs.has(it.parent)) { if (it.kind === 'dir') badDirs.add(it.remote); throw new Error('Its folder could not be created on this PC.'); }
      if (it.kind === 'dir') { await fsp.mkdir(it.local); res.dirs++; continue; }
      x.i++; x.file = it.name; x.emit(true);
      if (it.size === 0) await fsp.writeFile(it.local, '', { flag: 'wx' });
      else {
        const tmp = it.local + '.part';
        x.partial = tmp;
        try { await fastCopy(x, sftp, 'fastGet', it.remote, tmp, base); await fsp.rename(tmp, it.local); }
        catch (e) { await rmQuiet(tmp); throw e; }
        x.partial = null;
      }
      base += it.size; x.done = base; res.files++; res.bytes += it.size;
    } catch (e) {
      if (it.kind === 'dir') badDirs.add(it.remote);
      if (e.cancelled || x.cancelled) break;
      res.failed.push({ name: it.remote.slice(dir.length).replace(/^\//, ''), error: explain(e) });
      base += it.size;
    }
  }
  res.cancelled = x.cancelled;
  return res;
}

/* ---------- upload ---------- */
async function scanLocal(paths, x) {
  const items = [];             // { name, parentLocal (local path or null), local, kind, size }
  let skipped = 0;
  const add = it => { items.push(it); if (items.length > MAX_ITEMS) throw new Error('That is more than ' + MAX_ITEMS + ' files and folders. Choose fewer, or a smaller folder.'); };
  async function walk(ldir, depth) {
    if (x.cancelled) throw cancelErr();
    if (depth > MAX_DEPTH) { skipped++; return; }
    for (const d of await fsp.readdir(ldir, { withFileTypes: true })) {
      if (!okName(d.name)) { skipped++; continue; }
      const local = path.join(ldir, d.name);
      if (d.isDirectory()) { add({ name: d.name, parentLocal: ldir, local, kind: 'dir', size: 0 }); await walk(local, depth + 1); }
      else if (d.isFile()) { let size = 0; try { size = (await fsp.stat(local)).size; } catch { skipped++; continue; } add({ name: d.name, parentLocal: ldir, local, kind: 'file', size }); }
      else skipped++;
    }
  }
  for (const p of paths) {
    if (x.cancelled) throw cancelErr();
    const name = path.basename(p);
    if (!okName(name)) { skipped++; continue; }
    let st;
    try { st = await fsp.stat(p); } catch { skipped++; continue; }
    if (st.isDirectory()) { add({ name, parentLocal: null, local: p, kind: 'dir', size: 0 }); await walk(p, 1); }
    else if (st.isFile()) add({ name, parentLocal: null, local: p, kind: 'file', size: st.size });
    else skipped++;
  }
  return { items, skipped };
}

async function ensureRemoteDir(sftp, p) {
  try { const st = await call(sftp, 'stat', p); if (kindOf(st.mode) === 'dir') return; throw Object.assign(new Error('A file with that name already exists on the server.'), { code: 4 }); }
  catch (e) { if (e.code !== 2 && !/no such file/i.test(String(e.message))) throw e; }
  await call(sftp, 'mkdir', p);
}

async function remoteExists(sftp, p) { try { await call(sftp, 'stat', p); return true; } catch { return false; } }

// Returns the plan, or { items } after "existing" has been shown to the person by the caller.
async function planUpload(sftp, dir, paths, x) {
  const { items, skipped } = await scanLocal(paths, x);
  const existing = [];
  for (const it of items) if (it.parentLocal === null && await remoteExists(sftp, pj(dir, it.name))) existing.push(it.name);
  return { items, skipped, existing };
}

async function runUpload(sftp, { dir, items, skipped }, x, isDead, getSftp) {
  const files = items.filter(i => i.kind === 'file');
  x.total = files.reduce((a, i) => a + i.size, 0);
  x.n = files.length; x.i = 0; x.phase = 'copy';
  const remoteOf = new Map();
  const res = { op: 'upload', files: 0, dirs: 0, bytes: 0, failed: [], skipped, cancelled: false, dest: dir };
  const failedDirs = new Set();
  let base = 0;
  for (const it of items) {
    if (x.cancelled || isDead()) break;
    const parentRemote = it.parentLocal === null ? dir : remoteOf.get(it.parentLocal);
    const remote = pj(parentRemote || dir, it.name);
    remoteOf.set(it.local, remote);
    try {
      if (parentRemote === undefined || failedDirs.has(it.parentLocal)) { failedDirs.add(it.local); throw new Error('Its folder could not be created.'); }
      if (it.kind === 'dir') { await x.guard(ensureRemoteDir(sftp, remote)); res.dirs++; continue; }
      x.i++; x.file = it.name; x.emit(true);
      x.partial = remote;
      if (it.size === 0) {
        const h = await x.guard(call(sftp, 'open', remote, 'w'));
        await call(sftp, 'close', h);
      } else await fastCopy(x, sftp, 'fastPut', it.local, remote, base);
      x.partial = null;
      base += it.size; x.done = base; res.files++; res.bytes += it.size;
    } catch (e) {
      if (it.kind === 'dir') failedDirs.add(it.local);
      if (e.cancelled || x.cancelled) break;
      // A copy that failed part-way leaves a broken file on the server. Remove it, unless the server refused to
      // open it at all (then whatever is there was not written by us).
      if (it.kind === 'file' && x.partial && e.code !== 3) { try { await call(sftp, 'unlink', x.partial); } catch {} }
      x.partial = null;
      res.failed.push({ name: path.relative(path.dirname(items[0].local), it.local) || it.name, error: explain(e) });
      base += it.size;
    }
  }
  res.cancelled = x.cancelled;
  // A cancelled upload leaves a partly written file on the server; remove it using a fresh channel.
  if (x.cancelled && x.partial && !isDead()) {
    try { const s2 = await getSftp(); await call(s2, 'unlink', x.partial); } catch {}
  }
  return res;
}

/* ---------- small operations ---------- */
async function removeItems(sftp, dir, names) {
  const res = { removed: 0, failed: [] };
  for (const name of names) {
    let isDir = false;
    try {
      const st = await call(sftp, 'lstat', pj(dir, name));
      isDir = kindOf(st.mode) === 'dir';
      if (isDir) await call(sftp, 'rmdir', pj(dir, name));       // only empty folders
      else await call(sftp, 'unlink', pj(dir, name));
      res.removed++;
    } catch (e) {
      res.failed.push({ name, error: isDir && e && e.code === 4 ? 'The folder is not empty. Open it and delete what is inside first.' : explain(e) });
    }
  }
  return res;
}

/* ---------- wiring to the SSH sessions ---------- */
function register(ipcMain, getWin, { dialog, send, getSession }) {
  const live = req => { const s = req && getSession(String((req && req.id) || '')); return s && s.stream && !s.closed ? s : null; };
  const NOPE = { ok: false, error: 'This connection is not open.' };

  function getSftp(s) {
    if (s.sftp) return Promise.resolve(s.sftp);
    if (s.sftpP) return s.sftpP;
    s.sftpP = new Promise((res, rej) => {
      s.conn.sftp((err, sftp) => {
        s.sftpP = null;
        if (err) return rej(err);
        sftp.on('error', () => {});                                   // an unhandled "error" would crash the app
        sftp.on('close', () => { if (s.sftp === sftp) s.sftp = null; });
        s.sftp = sftp;
        res(sftp);
      });
    });
    return s.sftpP;
  }
  const dropSftp = s => { const f = s.sftp; s.sftp = null; try { f && f.end(); } catch {} };

  const names = v => Array.isArray(v) && v.length >= 1 && v.length <= MAX_NAMES && v.every(okName) ? v : null;

  ipcMain.handle('ssh:ls', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const want = String((req && req.dir) || '');
    if (want && !okDir(want)) return { ok: false, error: 'Enter a folder path that starts with /.' };
    try { return { ok: true, data: await listDir(await getSftp(s), want) }; } catch (e) { return { ok: false, error: explain(e) }; }
  });

  ipcMain.handle('ssh:mkdir', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const dir = req && req.dir, name = String((req && req.name) || '').trim();
    if (!okDir(dir)) return { ok: false, error: 'Unknown folder.' };
    if (!okName(name)) return { ok: false, error: 'Enter a folder name without slashes.' };
    try { await call(await getSftp(s), 'mkdir', pj(dir, name)); return { ok: true }; } catch (e) { return { ok: false, error: explain(e) }; }
  });

  ipcMain.handle('ssh:rename', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const dir = req && req.dir, from = req && req.from, to = String((req && req.to) || '').trim();
    if (!okDir(dir) || !okName(from)) return { ok: false, error: 'Unknown item.' };
    if (!okName(to)) return { ok: false, error: 'Enter a name without slashes.' };
    if (from === to) return { ok: true };
    try {
      const f = await getSftp(s);
      if (await remoteExists(f, pj(dir, to))) return { ok: false, error: 'Something named "' + to + '" is already in this folder.' };
      await call(f, 'rename', pj(dir, from), pj(dir, to));
      return { ok: true };
    } catch (e) { return { ok: false, error: explain(e) }; }
  });

  ipcMain.handle('ssh:rm', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const dir = req && req.dir, list = names(req && req.names);
    if (!okDir(dir) || !list) return { ok: false, error: 'Nothing to delete.' };
    const shown = list.slice(0, 8).join('\n') + (list.length > 8 ? '\n\u2026and ' + (list.length - 8) + ' more' : '');
    const r = await dialog.showMessageBox(getWin(), {
      type: 'warning', buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Delete from the server?',
      message: 'Delete ' + (list.length === 1 ? 'this item' : list.length + ' items') + ' from the server?',
      detail: dir + '\n\n' + shown + '\n\nThis cannot be undone. Folders can only be deleted when they are empty.'
    });
    if (r.response !== 1) return { ok: false, declined: true, error: 'Nothing was deleted.' };
    try { return { ok: true, data: await removeItems(await getSftp(s), dir, list) }; } catch (e) { return { ok: false, error: explain(e) }; }
  });

  // Runs one transfer at a time per connection. The cleanup in "finally" always clears the busy flag.
  async function transfer(s, op, body) {
    if (s.xfer) return { ok: false, error: 'A transfer is already running on this connection.' };
    const x = newTransfer(op, send2(s));
    s.xfer = x;
    try {
      const data = await body(x);
      return data;
    } catch (e) {
      if (e && e.cancelled) return { ok: true, data: { op, files: 0, dirs: 0, bytes: 0, failed: [], skipped: 0, cancelled: true } };
      return { ok: false, error: explain(e) };
    } finally {
      if (x.cancelled) dropSftp(s);        // a cancelled copy leaves the channel in an unknown state; a new one opens next time
      s.xfer = null;
      send({ id: s.id, t: 'xfer', state: 'end', op });
    }
  }
  const send2 = s => m => send(Object.assign({ id: s.id }, m));
  const dead = s => () => !!s.closed;

  ipcMain.handle('ssh:get', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const dir = req && req.dir, list = names(req && req.names);
    if (!okDir(dir) || !list) return { ok: false, error: 'Choose what to download first.' };
    return transfer(s, 'download', async x => {
      const r = await dialog.showOpenDialog(getWin(), { title: 'Choose where to save the download', buttonLabel: 'Save here', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return { ok: true, data: { cancelled: true, dialog: true } };
      const sftp = await getSftp(s);
      return { ok: true, data: await runDownload(sftp, { dir, names: list, destRoot: r.filePaths[0] }, x, dead(s)) };
    });
  });

  ipcMain.handle('ssh:put', async (_e, req) => {
    const s = live(req); if (!s) return NOPE;
    const dir = req && req.dir, kind = req && req.kind === 'folder' ? 'folder' : 'files';
    if (!okDir(dir)) return { ok: false, error: 'Unknown folder.' };
    return transfer(s, 'upload', async x => {
      const r = await dialog.showOpenDialog(getWin(), kind === 'folder'
        ? { title: 'Choose a folder to upload', buttonLabel: 'Upload folder', properties: ['openDirectory'] }
        : { title: 'Choose files to upload', buttonLabel: 'Upload', properties: ['openFile', 'multiSelections'] });
      if (r.canceled || !r.filePaths.length) return { ok: true, data: { cancelled: true, dialog: true } };
      const sftp = await getSftp(s);
      x.phase = 'scan'; x.emit(true);
      const plan = await planUpload(sftp, dir, r.filePaths, x);
      if (!plan.items.length) return { ok: false, error: 'There was nothing to upload in that choice.' };
      if (plan.existing.length) {
        const shown = plan.existing.slice(0, 8).join('\n') + (plan.existing.length > 8 ? '\n\u2026and ' + (plan.existing.length - 8) + ' more' : '');
        const c = await dialog.showMessageBox(getWin(), {
          type: 'question', buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true,
          title: 'Replace files on the server?',
          message: plan.existing.length === 1 ? 'An item with this name is already on the server.' : plan.existing.length + ' items with these names are already on the server.',
          detail: dir + '\n\n' + shown + '\n\nFiles with the same name will be replaced. Folders are merged: only files with the same name inside them are replaced.'
        });
        if (c.response !== 1) return { ok: true, data: { cancelled: true, dialog: true } };
      }
      return { ok: true, data: await runUpload(sftp, { dir, items: plan.items, skipped: plan.skipped }, x, dead(s), () => getSftp(s)) };
    });
  });

  ipcMain.handle('ssh:xcancel', (_e, req) => {
    const s = req && getSession(String(req.id || ''));
    if (s && s.xfer) { s.xfer.cancel(); dropSftp(s); return { ok: true }; }   // closing the channel stops the copy in flight
    return { ok: false };
  });

  return {
    // Called when a connection ends: stops any copy and closes the file channel.
    closed(id) {
      const s = getSession(id);
      if (!s) return;
      if (s.xfer) s.xfer.cancel();
      dropSftp(s);
    }
  };
}

module.exports = { register, safeLocalName, withSuffix, inside, listDir, runDownload, runUpload, planUpload, removeItems, newTransfer, explain, kindOf };
