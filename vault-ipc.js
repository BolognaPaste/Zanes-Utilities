// Encrypted vault backend: one container file (.zvault) that holds any number of files and folders.
//
// Crypto (Node's built-in OpenSSL, no extra packages):
//   password --scrypt (N=2^18, r=8, p=1, random 32-byte salt)--> key-encryption key
//   key-encryption key --AES-256-GCM--> unwraps a random 32-byte master key stored in the header
//   master key --HKDF-SHA256--> one key for file data, one for the index
//   file data is cut into 1 MiB chunks, each sealed with AES-256-GCM under a fresh random nonce.
//   The chunk's authenticated data holds the file id, chunk number and a "last chunk" flag, so
//   chunks cannot be reordered, swapped between files or cut off without the tag check failing.
//   The index (file names, sizes, dates, where each file sits) is one sealed blob, so names are hidden too.
//
// File layout:
//   0..127     header: magic, version, scrypt settings, salt, wrapped master key, and a small pointer
//              (offset + length + checksum) to the current index. Bytes 0..53 are authenticated with
//              the wrapped key; the pointer is the only part that is ever rewritten in place.
//   128..      file records, then index blobs. Adding files appends records and a new index, syncs the
//              disk, and only then moves the pointer, so a crash leaves the previous index intact.
//              Removing files or changing the password rewrites the vault into a temp file and swaps it in.
//
// The master key lives only in this process while a vault is unlocked and is wiped on lock. The page
// never sees keys, and it never chooses paths: every path comes from a native dialog opened here.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const MAGIC = Buffer.from('ZVAULT');
const VERSION = 1;
const LOGN = 18, R = 8, P = 1;          // scrypt: about 256 MB of memory, roughly a second on a desktop PC
const HDR = 128, AAD_LEN = 54, PTR_AT = 112;
const CH = 1024 * 1024;                 // plaintext bytes per chunk
const OVER = 28;                        // nonce (12) + tag (16) added to each chunk
const MAX_INDEX = 64 * 1024 * 1024;
const IDLE_MS = 10 * 60 * 1000;         // locks itself after 10 idle minutes
const IDX_AAD = Buffer.from('zvault index v1');

const recBytes = size => size === 0 ? 0 : size + Math.ceil(size / CH) * OVER;
const hkey = (master, label) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), 'zvault ' + label, 32));

async function kek(password, salt, logN) {
  const pw = Buffer.from(String(password).normalize('NFKC'), 'utf8');
  try {
    const N = 2 ** logN;
    return await scrypt(pw, salt, 32, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  } finally { pw.fill(0); }
}

function seal(key, aad, plain) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, ct, c.getAuthTag()]);
}
function unseal(key, aad, rec) {
  if (rec.length < OVER) throw new Error('bad record');
  const d = crypto.createDecipheriv('aes-256-gcm', key, rec.subarray(0, 12), { authTagLength: 16 });
  d.setAAD(aad);
  d.setAuthTag(rec.subarray(rec.length - 16));
  return Buffer.concat([d.update(rec.subarray(12, rec.length - 16)), d.final()]);
}
const chunkAad = (id, i, last) => { const b = Buffer.alloc(21); id.copy(b, 0); b.writeUInt32LE(i, 16); b[20] = last ? 1 : 0; return b; };

function wrap(key, master, h) {
  const c = crypto.createCipheriv('aes-256-gcm', key, h.subarray(42, 54), { authTagLength: 16 });
  c.setAAD(h.subarray(0, AAD_LEN));
  return Buffer.concat([c.update(master), c.final(), c.getAuthTag()]);   // 32 + 16 bytes
}
function unwrap(key, h) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, h.subarray(42, 54), { authTagLength: 16 });
  d.setAAD(h.subarray(0, AAD_LEN));
  d.setAuthTag(h.subarray(86, 102));
  return Buffer.concat([d.update(h.subarray(54, 86)), d.final()]);
}

function ptrBuf(off, len) {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(BigInt(off), 0);
  b.writeUInt32LE(len, 8);
  crypto.createHash('sha256').update(b.subarray(0, 12)).digest().copy(b, 12, 0, 4);
  return b;
}

async function readFull(fh, len, pos) {
  const buf = Buffer.allocUnsafe(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, pos + got);
    if (!bytesRead) throw new Error('The vault file ends early. It may be damaged.');
    got += bytesRead;
  }
  return buf;
}
async function writeAll(fh, buf, pos) {
  let done = 0;
  while (done < buf.length) {
    const { bytesWritten } = await fh.write(buf, done, buf.length - done, pos + done);
    done += bytesWritten;
  }
}

function parseIndex(text, fileSize) {
  const j = JSON.parse(text), bad = () => new Error('The vault index is damaged.');
  if (!j || j.v !== 1 || !Array.isArray(j.files)) throw bad();
  return {
    files: j.files.map(f => {
      if (!f || typeof f.id !== 'string' || !/^[0-9a-f]{32}$/.test(f.id) || typeof f.name !== 'string' || !f.name || f.name.length > 1024 ||
          !Number.isSafeInteger(f.size) || f.size < 0 || !Number.isSafeInteger(f.off) || f.off < HDR || f.off + recBytes(f.size) > fileSize) throw bad();
      return { id: f.id, name: f.name, size: f.size, mtime: Number.isFinite(f.mtime) ? f.mtime : 0, off: f.off };
    })
  };
}
const indexText = files => JSON.stringify({ v: 1, files: files.map(({ id, name, size, mtime, off }) => ({ id, name, size, mtime, off })) });

// Reads the header, unlocks the master key and loads the index. Throws friendly errors.
async function openVault(file, password) {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size < HDR) throw new Error('That file is not a vault.');
    const head = await readFull(fh, HDR, 0);
    if (!head.subarray(0, 6).equals(MAGIC)) throw new Error('That file is not a vault made by Zane\'s Utilities.');
    if (head[6] !== VERSION) throw new Error('This vault was made by a newer version of the app.');
    if (head[7] < 14 || head[7] > 19 || head[8] !== R || head[9] !== P) throw new Error('This vault uses settings this version does not support.');
    const key = await kek(password, head.subarray(10, 42), head[7]);
    let master;
    try { master = unwrap(key, head); }
    catch { throw new Error('Wrong password, or the vault file is damaged.'); }
    finally { key.fill(0); }
    const dk = hkey(master, 'data'), ik = hkey(master, 'index');
    try {
      const p = head.subarray(PTR_AT, PTR_AT + 16);
      const sum = crypto.createHash('sha256').update(p.subarray(0, 12)).digest().subarray(0, 4);
      const off = Number(p.readBigUInt64LE(0)), len = p.readUInt32LE(8);
      if (!sum.equals(p.subarray(12, 16)) || off < HDR || len < OVER || len > MAX_INDEX || off + len > size) throw new Error('The vault index pointer is damaged.');
      let text;
      try { text = unseal(ik, IDX_AAD, await readFull(fh, len, off)).toString('utf8'); }
      catch { throw new Error('The vault index failed its integrity check. The file is damaged or was changed.'); }
      return { file, head, master, dk, ik, index: parseIndex(text, size) };
    } catch (e) { master.fill(0); dk.fill(0); ik.fill(0); throw e; }
  } finally { await fh.close(); }
}

// Windows-safe relative path for extraction. Never lets a stored name climb out of the chosen folder.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
function safeParts(name) {
  return name.split('/').map(p => {
    p = p.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
    if (!p || p === '.' || p === '..') p = '_';
    return RESERVED.test(p) ? '_' + p : p;
  });
}
async function createUnique(dir, fileName) {
  const ext = path.extname(fileName), stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 0; n < 1000; n++) {
    const p = path.join(dir, n ? stem + ' (' + (n + 1) + ')' + ext : fileName);
    try { return { p, fh: await fsp.open(p, 'wx') }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('Too many files with the same name.');
}

const norm = p => path.resolve(p).toLowerCase();
const nice = e => e && e.code === 'ENOSPC' ? 'The disk is full.' : e && e.code === 'EBUSY' ? 'The file is in use by another program.' : e && e.code === 'EPERM' ? 'Windows denied permission.' :
  e && e.code === 'EACCES' ? 'Windows denied permission.' : e && e.code === 'ENOENT' ? 'The file could not be found.' : String((e && e.message) || e);

function register(ipcMain, getWin, { dialog }) {
  const allowed = new Set();
  let S = null, busy = false, stop = false, idle = 0, lastTick = 0;
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('vlt:progress', m); };
  const tick = (m, force) => { const now = Date.now(); if (!force && now - lastTick < 100) return; lastTick = now; send(m); };

  function touch() {
    clearTimeout(idle);
    idle = setTimeout(() => { if (busy) touch(); else lock('idle'); }, IDLE_MS);
  }
  function lock(reason) {
    clearTimeout(idle); idle = 0;
    if (!S) return;
    S.master.fill(0); S.dk.fill(0); S.ik.fill(0);
    S = null;
    if (reason) send({ t: 'locked', reason });
  }
  const view = () => S && {
    name: path.basename(S.file),
    bytes: S.index.files.reduce((a, f) => a + f.size, 0),
    files: S.index.files.map(({ id, name, size, mtime }) => ({ id, name, size, mtime }))
  };

  async function guard(fn, needOpen = true) {
    if (busy) return { ok: false, error: 'Another vault task is already running.' };
    if (needOpen && !S) return { ok: false, error: 'The vault is locked. Unlock it first.' };
    busy = true; stop = false;
    try { const r = await fn(); if (S) touch(); return r; }
    catch (e) { return { ok: false, error: nice(e) }; }
    finally { busy = false; }
  }
  const pwOk = (v, strict) => {
    if (typeof v !== 'string' || !v) throw new Error('Enter the password.');
    if (strict && v.length < 12) throw new Error('Use at least 12 characters. A long passphrase of several words is best.');
    if (v.length > 512) throw new Error('That password is too long (512 characters at most).');
    return v;
  };

  // Writes header + everything to a temp file next to the vault, syncs it, then swaps it in.
  async function rewrite(keep, head) {
    const tmp = S.file + '.tmp-' + crypto.randomBytes(4).toString('hex');
    const src = await fsp.open(S.file, 'r');
    let out = null;
    try {
      out = await fsp.open(tmp, 'wx');
      let pos = HDR;
      const moved = [];
      const total = keep.reduce((a, f) => a + f.size, 0);
      let done = 0;
      const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
      for (const f of keep) {
        if (stop) throw Object.assign(new Error('stopped'), { stopped: true });
        const len = recBytes(f.size);
        for (let c = 0; c < len; ) {
          const n = Math.min(buf.length, len - c);
          const b = await readFull(src, n, f.off + c);
          await writeAll(out, b, pos + c);
          c += n; done += n;
          tick({ t: 'p', name: f.name, done, total: Math.max(total, 1) });
        }
        moved.push({ ...f, off: pos });
        pos += len;
      }
      const blob = seal(S.ik, IDX_AAD, Buffer.from(indexText(moved), 'utf8'));
      await writeAll(out, blob, pos);
      const h = Buffer.from(head);
      ptrBuf(pos, blob.length).copy(h, PTR_AT);
      await writeAll(out, h, 0);
      await out.sync();
      await out.close(); out = null;
      await src.close();
      await fsp.rename(tmp, S.file);
      return { head: h, files: moved };
    } catch (e) {
      try { if (out) await out.close(); } catch {}
      try { await src.close(); } catch {}
      await fsp.unlink(tmp).catch(() => {});
      throw e;
    }
  }

  ipcMain.handle('vlt:state', () => ({ ok: true, data: view() }));
  ipcMain.handle('vlt:cancel', () => { stop = true; return true; });
  ipcMain.handle('vlt:lock', () => { if (!busy) lock(); else stop = true; return { ok: true }; });

  ipcMain.handle('vlt:create', (_e, req) => guard(async () => {
    const password = pwOk(req && req.password, true);
    const r = await dialog.showSaveDialog(getWin(), {
      title: 'Create vault', defaultPath: 'My vault.zvault', filters: [{ name: 'Encrypted vault', extensions: ['zvault'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, declined: true, error: 'Cancelled. No vault was created.' };
    let file = r.filePath;
    if (!/\.zvault$/i.test(file)) {
      file += '.zvault';
      if (fs.existsSync(file)) return { ok: false, error: path.basename(file) + ' already exists. Choose another name.' };
    }
    lock();
    const salt = crypto.randomBytes(32), master = crypto.randomBytes(32);
    const key = await kek(password, salt, LOGN);
    const head = Buffer.alloc(HDR);
    MAGIC.copy(head, 0); head[6] = VERSION; head[7] = LOGN; head[8] = R; head[9] = P;
    salt.copy(head, 10); crypto.randomBytes(12).copy(head, 42);
    wrap(key, master, head).copy(head, 54);
    key.fill(0);
    const dk = hkey(master, 'data'), ik = hkey(master, 'index');
    const blob = seal(ik, IDX_AAD, Buffer.from(indexText([]), 'utf8'));
    ptrBuf(HDR, blob.length).copy(head, PTR_AT);
    const fh = await fsp.open(file, 'w');
    try { await writeAll(fh, Buffer.concat([head, blob]), 0); await fh.sync(); } finally { await fh.close(); }
    S = { file, head, master, dk, ik, index: { files: [] } };
    touch();
    return { ok: true, data: view() };
  }, false));

  ipcMain.handle('vlt:pick', async () => {
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Open vault', properties: ['openFile'],
      filters: [{ name: 'Encrypted vault', extensions: ['zvault'] }, { name: 'All files', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths[0]) return { ok: true, data: null };
    allowed.add(r.filePaths[0]);
    return { ok: true, data: { file: r.filePaths[0], name: path.basename(r.filePaths[0]) } };
  });

  ipcMain.handle('vlt:open', (_e, req) => guard(async () => {
    const file = String((req && req.file) || '');
    if (!allowed.has(file)) return { ok: false, error: 'Choose the vault file first.' };
    const password = pwOk(req.password, false);
    lock();
    S = await openVault(file, password);
    touch();
    return { ok: true, data: view() };
  }, false));

  ipcMain.handle('vlt:add', (_e, req) => guard(async () => {
    const kind = req && req.kind === 'folders' ? 'folders' : 'files';
    const r = await dialog.showOpenDialog(getWin(), {
      title: kind === 'folders' ? 'Choose folders to add to the vault' : 'Choose files to add to the vault',
      properties: kind === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    });
    if (r.canceled || !r.filePaths.length) return { ok: true, data: { added: 0, replaced: 0, failed: [], vault: view() } };

    const items = [], failed = [], used = new Set();
    const uniq = base => {
      const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
      let n = 1, name = base;
      while (used.has(name.toLowerCase())) name = stem + ' (' + (++n) + ')' + ext;
      used.add(name.toLowerCase());
      return name;
    };
    async function collect(abs, name) {
      try {
        const st = await fsp.lstat(abs);
        if (st.isSymbolicLink()) { failed.push({ path: abs, error: 'Shortcuts and links are skipped.' }); return; }
        if (st.isDirectory()) { for (const e of await fsp.readdir(abs)) await collect(path.join(abs, e), name + '/' + e); }
        else if (st.isFile()) { if (norm(abs) !== norm(S.file)) items.push({ abs, name, mtime: st.mtimeMs }); }
      } catch (e) { failed.push({ path: abs, error: nice(e) }); }
    }
    for (const p of r.filePaths) await collect(p, uniq(path.basename(p) || p));

    const fh = await fsp.open(S.file, 'r+');
    const start = (await fh.stat()).size;
    let pos = start, committed = false;
    const added = [];
    try {
      let total = 0;
      for (const it of items) { try { total += (await fsp.stat(it.abs)).size; } catch {} }
      let done = 0;
      const buf = Buffer.allocUnsafe(CH);
      for (const it of items) {
        if (stop) throw Object.assign(new Error('stopped'), { stopped: true });
        const id = crypto.randomBytes(16), off = pos;
        let src = null;
        try {
          src = await fsp.open(it.abs, 'r');
          const size = (await src.stat()).size;
          let read = 0, idx = 0;
          while (read < size) {
            if (stop) throw Object.assign(new Error('stopped'), { stopped: true });
            const n = Math.min(CH, size - read);
            let got = 0;
            while (got < n) {
              const { bytesRead } = await src.read(buf, got, n - got, read + got);
              if (!bytesRead) throw new Error('The file changed while it was being read.');
              got += bytesRead;
            }
            const rec = seal(S.dk, chunkAad(id, idx, read + n >= size), buf.subarray(0, n));
            await writeAll(fh, rec, pos);
            pos += rec.length; read += n; idx++; done += n;
            tick({ t: 'p', name: it.name, done, total: Math.max(total, 1) });
          }
          added.push({ id: id.toString('hex'), name: it.name, size, mtime: Math.round(it.mtime), off });
        } catch (e) {
          if (e.stopped) throw e;
          pos = off;   // the next file overwrites whatever part of this one was written
          failed.push({ path: it.abs, error: nice(e) });
        } finally { if (src) await src.close(); }
      }
      if (!added.length) { await fh.truncate(start); return { ok: true, data: { added: 0, replaced: 0, failed, vault: view() } }; }

      const names = new Set(added.map(f => f.name.toLowerCase()));
      const kept = S.index.files.filter(f => !names.has(f.name.toLowerCase()));
      const replaced = S.index.files.length - kept.length;
      const files = kept.concat(added);
      const blob = seal(S.ik, IDX_AAD, Buffer.from(indexText(files), 'utf8'));
      await writeAll(fh, blob, pos);
      await fh.sync();
      const p = ptrBuf(pos, blob.length);
      await writeAll(fh, p, PTR_AT);
      await fh.sync();
      committed = true;
      S.index = { files };
      S.head = Buffer.concat([S.head.subarray(0, PTR_AT), p, S.head.subarray(PTR_AT + 16)]);
      return { ok: true, data: { added: added.length, replaced, failed, vault: view() } };
    } catch (e) {
      if (e.stopped) return { ok: false, declined: true, error: 'Stopped. Nothing was added.' };
      throw e;
    } finally {
      if (!committed) { try { await fh.truncate(start); } catch {} }   // new data never became part of the vault
      await fh.close();
    }
  }));

  ipcMain.handle('vlt:extract', (_e, req) => guard(async () => {
    const ids = new Set(Array.isArray(req && req.ids) ? req.ids.filter(x => typeof x === 'string') : []);
    const list = S.index.files.filter(f => ids.has(f.id));
    if (!list.length) return { ok: false, error: 'Nothing was selected.' };
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Choose where to save the decrypted files', properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, declined: true, error: 'Cancelled. Nothing was extracted.' };
    const dir = r.filePaths[0];

    const vfh = await fsp.open(S.file, 'r');
    const failed = [];
    let count = 0, bytes = 0, done = 0, cancelled = false;
    const total = list.reduce((a, f) => a + f.size, 0);
    try {
      for (const f of list) {
        if (stop) { cancelled = true; break; }
        const parts = safeParts(f.name);
        let made = null;
        try {
          const sub = path.join(dir, ...parts.slice(0, -1));
          await fsp.mkdir(sub, { recursive: true });
          made = await createUnique(sub, parts[parts.length - 1]);
          const id = Buffer.from(f.id, 'hex'), n = Math.ceil(f.size / CH);
          let pos = f.off, w = 0;
          for (let i = 0; i < n; i++) {
            if (stop) throw Object.assign(new Error('stopped'), { stopped: true });
            const plen = Math.min(CH, f.size - i * CH);
            let plain;
            try { plain = unseal(S.dk, chunkAad(id, i, i === n - 1), await readFull(vfh, plen + OVER, pos)); }
            catch (e) { throw new Error(e && /Unsupported state|authenticate/i.test(e.message) ? 'Failed the integrity check. The vault file is damaged or was changed.' : e.message); }
            await writeAll(made.fh, plain, w);
            plain.fill(0);
            pos += plen + OVER; w += plen; done += plen;
            tick({ t: 'p', name: f.name, done, total: Math.max(total, 1) });
          }
          await made.fh.close(); made.fh = null;
          if (f.mtime) await fsp.utimes(made.p, new Date(), new Date(f.mtime)).catch(() => {});
          count++; bytes += f.size;
        } catch (e) {
          if (made) { try { if (made.fh) await made.fh.close(); } catch {} await fsp.unlink(made.p).catch(() => {}); }
          if (e.stopped) { cancelled = true; break; }
          failed.push({ name: f.name, error: nice(e) });
        }
      }
    } finally { await vfh.close(); }
    return { ok: true, data: { count, bytes, dir, failed, cancelled } };
  }));

  ipcMain.handle('vlt:remove', (_e, req) => guard(async () => {
    const ids = new Set(Array.isArray(req && req.ids) ? req.ids.filter(x => typeof x === 'string') : []);
    const gone = S.index.files.filter(f => ids.has(f.id));
    if (!gone.length) return { ok: false, error: 'Nothing was selected.' };
    const ask = await dialog.showMessageBox(getWin(), {
      type: 'warning', buttons: ['Cancel', 'Remove from vault'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Remove from vault?',
      message: 'Remove ' + gone.length + ' item' + (gone.length > 1 ? 's' : '') + ' from the vault?',
      detail: gone.slice(0, 5).map(f => f.name).join('\n') + (gone.length > 5 ? '\n...and ' + (gone.length - 5) + ' more' : '') +
        '\n\nThe encrypted data is deleted from the vault file. Anything you have not extracted first is lost.'
    });
    if (ask.response !== 1) return { ok: false, declined: true, error: 'Cancelled. Nothing was removed.' };
    const keep = S.index.files.filter(f => !ids.has(f.id));
    try {
      const r = await rewrite(keep, S.head);
      S.head = r.head; S.index = { files: r.files };
    } catch (e) {
      if (e.stopped) return { ok: false, declined: true, error: 'Stopped. Nothing was removed.' };
      throw e;
    }
    return { ok: true, data: { removed: gone.length, vault: view() } };
  }));

  ipcMain.handle('vlt:passwd', (_e, req) => guard(async () => {
    const oldPw = pwOk(req && req.oldPassword, false), newPw = pwOk(req && req.newPassword, true);
    // Prove the current password again before changing anything.
    const k0 = await kek(oldPw, S.head.subarray(10, 42), S.head[7]);
    try {
      const m = unwrap(k0, S.head);
      const same = crypto.timingSafeEqual(m, S.master);
      m.fill(0);
      if (!same) throw new Error('x');
    } catch { return { ok: false, error: 'The current password is wrong.' }; }
    finally { k0.fill(0); }

    const head = Buffer.from(S.head);
    crypto.randomBytes(32).copy(head, 10);
    crypto.randomBytes(12).copy(head, 42);
    head[7] = LOGN;
    const k1 = await kek(newPw, head.subarray(10, 42), LOGN);
    wrap(k1, S.master, head).copy(head, 54);
    k1.fill(0);
    const r = await rewrite(S.index.files, head);
    S.head = r.head; S.index = { files: r.files };
    return { ok: true, data: { vault: view() } };
  }));
}

module.exports = { register };
