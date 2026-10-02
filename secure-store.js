// Encrypted storage for everything the app saves on this PC.
//
// What it protects
//   - The page's localStorage (game library, saved connections, settings, scan history, ...). secure-ls.js in the
//     page swaps localStorage for a copy that lives here; the data is kept in memory while the app runs and saved
//     to one encrypted file, zu-data.bin, in the app's data folder.
//   - The app's own JSON files (trusted SSH servers, chat data, optimizer backups, Mumble settings). They are
//     read and written through readTextSync / writeText and friends below.
//
// How
//   AES-256-GCM (encryption plus tamper detection) with a fresh random 12-byte nonce for every save. The 256-bit key
//   is random and is kept in zu-store.key, wrapped by Windows (Electron safeStorage, which uses DPAPI). The wrapped
//   key can only be opened by the same Windows user on the same PC, so copied files are unreadable elsewhere. Nothing
//   here asks for a password, so there is no way to be locked out of your own data.
//   An encrypted file starts with the 4 bytes "ZUE1". Files without them are older plain-text copies; they are still
//   read, and are encrypted the next time they are saved (and once at start-up for the known files).
//
// Speed
//   One small file is read and decrypted at start-up (well under a millisecond for typical sizes). Changes are
//   batched in the page, merged here and written to disk at most once every 400 ms in the background. AES-GCM runs
//   at hardware speed, so the cost is not measurable in normal use.
//
// Limits (also shown on the Settings page)
//   The key protects against copying the files, other Windows accounts and disk theft. A program that runs as you,
//   while you are signed in, can ask Windows to open the key just like this app does.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAGIC = Buffer.from('ZUE1');
const DATA = 'zu-data.bin', KEYF = 'zu-store.key';
const DELAY = 400;                               // ms between a change and the background save

let dir = '', key = null, method = 'off';
let data = new Map(), existed = false;
let loadedReal = false, wiped = false, dirty = false, writing = false, timer = 0, seq = 0;

/* ---------- key ---------- */
function writeKeyFile(file, k, ss, canWrap) {
  const body = canWrap
    ? { v: 1, m: 'dpapi', k: ss.encryptString(k.toString('base64')).toString('base64') }
    : { v: 1, m: 'plain', k: k.toString('base64') };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Returns the 32-byte key, creating it the first time. Throws if it cannot be had (encryption then stays off).
function loadKey(ss) {
  const file = path.join(dir, KEYF);
  const canWrap = !!(ss && ss.isEncryptionAvailable && ss.isEncryptionAvailable());
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (j && j.m === 'dpapi') {
    if (!canWrap) throw new Error('Windows key protection is not available right now.');   // leave everything as it is
    try {
      const k = Buffer.from(ss.decryptString(Buffer.from(j.k, 'base64')), 'base64');
      if (k.length === 32) { method = 'dpapi'; return k; }
    } catch {}
  } else if (j && j.m === 'plain') {
    const k = Buffer.from(String(j.k || ''), 'base64');
    if (k.length === 32) {
      if (canWrap) { try { writeKeyFile(file, k, ss, true); method = 'dpapi'; return k; } catch {} }
      method = 'plain'; return k;
    }
  }
  if (j) { try { fs.renameSync(file, file + '.old'); } catch {} }   // unreadable key (other PC or account): keep it aside
  const k = crypto.randomBytes(32);
  writeKeyFile(file, k, ss, canWrap);
  method = canWrap ? 'dpapi' : 'plain';
  return k;
}

/* ---------- sealing ---------- */
const isSealed = b => b.length >= 32 && b.subarray(0, 4).equals(MAGIC);
function seal(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function unseal(b) {                                // null when the file is not encrypted; throws when it cannot be opened
  if (!isSealed(b)) return null;
  if (!key) throw new Error('No key.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(4, 16));
  d.setAAD(MAGIC);
  d.setAuthTag(b.subarray(16, 32));
  return Buffer.concat([d.update(b.subarray(32)), d.final()]);
}
const tmpName = f => f + '.' + process.pid + '.' + (++seq) + '.tmp';
function writeBufSync(file, buf) {
  const tmp = tmpName(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, file);                         // written whole, then swapped in, so a crash never leaves half a file
}
async function writeBuf(file, buf) {
  const tmp = tmpName(file);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

/* ---------- files used by other parts of the app (text in, text out) ---------- */
function readTextSync(file) {
  const b = fs.readFileSync(file), t = unseal(b);
  return (t || b).toString('utf8');
}
async function readText(file) {
  const b = await fsp.readFile(file), t = unseal(b);
  return (t || b).toString('utf8');
}
function writeTextSync(file, text) {
  const b = Buffer.from(String(text), 'utf8');
  writeBufSync(file, key ? seal(b) : b);
}
async function writeText(file, text) {
  const b = Buffer.from(String(text), 'utf8');
  await writeBuf(file, key ? seal(b) : b);
}
// Encrypts older plain-text copies of these files (paths relative to the data folder).
function upgrade(rel) {
  if (!key) return;
  for (const r of rel) {
    const f = path.join(dir, r);
    try { const b = fs.readFileSync(f); if (!isSealed(b)) writeBufSync(f, seal(b)); } catch {}
  }
}

/* ---------- the page's localStorage ---------- */
function loadData() {
  const f = path.join(dir, DATA);
  let b;
  try { b = fs.readFileSync(f); } catch { existed = false; data = new Map(); return; }
  try {
    const t = unseal(b);
    if (!t) throw new Error('not encrypted');
    const o = JSON.parse(t.toString('utf8'));
    data = new Map(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string'));
    existed = true;
  } catch {                                          // cannot be opened: keep it aside rather than overwrite it
    try { fs.renameSync(f, f + '.unreadable'); } catch {}
    existed = false; data = new Map();
  }
}
const pack = () => seal(Buffer.from(JSON.stringify(Object.fromEntries(data)), 'utf8'));

function flushSync() {
  clearTimeout(timer); timer = 0;
  if (!dirty || !key) return;
  dirty = false;
  try { writeBufSync(path.join(dir, DATA), pack()); existed = true; } catch { dirty = true; }
}
async function flushAsync() {
  timer = 0;
  if (!dirty || !key) return;
  if (writing) { schedule(); return; }
  dirty = false; writing = true;
  try { await writeBuf(path.join(dir, DATA), pack()); existed = true; }
  catch { dirty = true; }
  finally { writing = false; if (dirty) schedule(); }
}
function schedule() {
  if (timer) return;
  timer = setTimeout(flushAsync, DELAY);
  if (timer.unref) timer.unref();
}

// "Delete all App Data": forget everything saved here. Nothing is accepted from the page again until it reloads.
function wipe() {
  clearTimeout(timer); timer = 0;
  dirty = false; data = new Map(); existed = false; wiped = true;
  try { fs.rmSync(path.join(dir, DATA), { force: true }); } catch {}
}

/* ---------- wiring ---------- */
// The page asks for its data once, before anything runs (sendSync from preload.js). While the app is locked it gets
// nothing: the data stays out of the page until the password is entered (the page then reloads, see lock-ui.js).
function register(ipcMain, ipc, { app, safeStorage, trusted, isLocked }) {
  dir = app.getPath('userData');
  try { key = loadKey(safeStorage); } catch { key = null; method = 'off'; }
  if (key) loadData();
  app.on('before-quit', flushSync);

  ipcMain.on('store:load', e => {
    if (!trusted(e) || !key) { e.returnValue = { ok: false }; return; }
    if (isLocked()) { loadedReal = false; e.returnValue = { ok: true, locked: true, data: {} }; return; }
    loadedReal = true; wiped = false;
    e.returnValue = { ok: true, locked: false, fresh: !existed, data: Object.fromEntries(data) };
  });

  // The first time: the page hands over what it had in its old, unencrypted storage.
  ipcMain.on('store:import', (e, m) => {
    if (!trusted(e) || !key || !loadedReal || wiped || existed || !m || typeof m.data !== 'object' || !m.data) { e.returnValue = { ok: false }; return; }
    const next = new Map();
    for (const [k, v] of Object.entries(m.data)) if (typeof v === 'string' && k.length <= 512 && v.length <= 16e6) next.set(k, v);
    data = next; dirty = true;
    flushSync();
    e.returnValue = { ok: existed };
  });

  ipcMain.on('store:ops', (e, b) => {
    if (!trusted(e) || !key || !loadedReal || wiped || !b || typeof b !== 'object') return;
    if (b.clear === true) data = new Map();
    if (Array.isArray(b.ops)) {
      for (const o of b.ops) {
        if (!Array.isArray(o) || typeof o[0] !== 'string' || o[0].length > 512) continue;
        if (o[1] === null) data.delete(o[0]);
        else if (typeof o[1] === 'string' && o[1].length <= 16e6) data.set(o[0], o[1]);
      }
    }
    dirty = true; schedule();
  });

  ipc.handle('store:status', () => ({ on: !!key, method, algo: 'AES-256-GCM' }));

  // Older plain-text copies of the app's own files get encrypted now.
  upgrade(['ssh-known-hosts.json', 'optimizer-backup.json', 'optimizer-games.json', 'mumble/mumble.json',
    'chat/state.json', 'chat/remote.json', 'chat/identities.json', 'chat/tunnel.json']);
}

module.exports = { register, wipe, readTextSync, readText, writeTextSync, writeText, upgrade };
