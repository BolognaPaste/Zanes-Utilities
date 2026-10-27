const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const ks = require('./keystore');

const MAGIC = Buffer.from('ZUE1');
const MAGIC2 = Buffer.from('ZUE2');
const LEGACY_DATA = 'zu-data.bin';
const BUCKET = 4096;
const DELAY = 400;
const KNOWN = [
  'ssh-known-hosts.json',
  'optimizer-backup.json',
  'optimizer-games.json',
  'mumble/mumble.json',
  'chat/state.json',
  'chat/remote.json',
  'chat/identities.json',
  'chat/tunnel.json'
];

let dir = '',
  key = null,
  outer = null,
  nameKey = null,
  bundle = null,
  method = 'off';
let pending = false;
let data = new Map(),
  existed = false;
let loadedReal = false,
  wiped = false,
  dirty = false,
  writing = false,
  timer = 0,
  seq = 0;

const hk = (secret, info) => Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('zu-v2'), Buffer.from(info), 32));
const dataFile = () => path.join(dir, crypto.createHmac('sha256', nameKey).update('data').digest('hex').slice(0, 24) + '.zud');

function install(r) {
  bundle = r.bundle;
  key = bundle.k1;
  outer = hk(bundle.k2, 'outer');
  nameKey = hk(bundle.k2, 'names');
  method = r.mode === 'pw' ? 'password' : r.mode;
  pending = false;
  loadData();
  upgrade(KNOWN);
}
function forgetKeys() {
  for (const b of [key, outer, nameKey]) {
    try {
      if (b) b.fill(0);
    } catch {}
  }
  ks.wipeBundle(bundle);
  key = outer = nameKey = bundle = null;
}

const isV2 = b => b.length >= 32 && b.subarray(0, 4).equals(MAGIC2);
const isSealed = b => b.length >= 32 && (b.subarray(0, 4).equals(MAGIC) || isV2(b));

function sealInner(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
function openInner(b) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(4, 16));
  d.setAAD(MAGIC);
  d.setAuthTag(b.subarray(16, 32));
  return Buffer.concat([d.update(b.subarray(32)), d.final()]);
}
function sealOuter(inner) {
  const total = Math.max(BUCKET, Math.ceil((4 + inner.length) / BUCKET) * BUCKET);
  const pt = Buffer.alloc(total);
  pt.writeUInt32BE(inner.length, 0);
  inner.copy(pt, 4);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', outer, iv);
  c.setAAD(MAGIC2);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return Buffer.concat([MAGIC2, iv, c.getAuthTag(), ct]);
}
function openOuter(b) {
  const d = crypto.createDecipheriv('aes-256-gcm', outer, b.subarray(4, 16));
  d.setAAD(MAGIC2);
  d.setAuthTag(b.subarray(16, 32));
  const pt = Buffer.concat([d.update(b.subarray(32)), d.final()]);
  const n = pt.length >= 4 ? pt.readUInt32BE(0) : -1;
  if (n < 32 || n > pt.length - 4) throw new Error('Damaged file.');
  return pt.subarray(4, 4 + n);
}
const seal = buf => sealOuter(sealInner(buf));
function unseal(b) {
  if (!isSealed(b)) return null;
  if (!key) throw new Error('No key.');
  let x = b;
  if (isV2(b)) {
    x = openOuter(b);
    if (!x.subarray(0, 4).equals(MAGIC)) throw new Error('Damaged file.');
  }
  return openInner(x);
}
const tmpName = f => f + '.' + process.pid + '.' + ++seq + '.tmp';
function writeBufSync(file, buf) {
  const tmp = tmpName(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
async function writeBuf(file, buf) {
  const tmp = tmpName(file);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, file);
}
const needKey = () => {
  if (!key && pending) throw new Error('Saved data is locked until the password is entered.');
};

function readTextSync(file) {
  const b = fs.readFileSync(file),
    t = unseal(b);
  return (t || b).toString('utf8');
}
async function readText(file) {
  const b = await fsp.readFile(file),
    t = unseal(b);
  return (t || b).toString('utf8');
}
function writeTextSync(file, text) {
  needKey();
  const b = Buffer.from(String(text), 'utf8');
  writeBufSync(file, key ? seal(b) : b);
}
async function writeText(file, text) {
  needKey();
  const b = Buffer.from(String(text), 'utf8');
  await writeBuf(file, key ? seal(b) : b);
}
function upgrade(rel) {
  if (!key) return;
  for (const r of rel) {
    const f = path.join(dir, r);
    try {
      const b = fs.readFileSync(f);
      if (isV2(b)) continue;
      writeBufSync(f, sealOuter(isSealed(b) ? b : sealInner(b)));
    } catch {}
  }
}

function loadData() {
  const f = dataFile(),
    old = path.join(dir, LEGACY_DATA);
  let b,
    from = f;
  try {
    b = fs.readFileSync(f);
  } catch {
    try {
      b = fs.readFileSync(old);
      from = old;
    } catch {
      existed = false;
      data = new Map();
      return;
    }
  }
  try {
    const t = unseal(b);
    if (!t) throw new Error('not encrypted');
    const o = JSON.parse(t.toString('utf8'));
    data = new Map(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string'));
    existed = true;
  } catch {
    try {
      fs.renameSync(from, from + '.unreadable');
    } catch {}
    existed = false;
    data = new Map();
    return;
  }
  if (from === old) {
    dirty = true;
    flushSync();
    if (!dirty) {
      try {
        fs.rmSync(old, { force: true });
      } catch {}
    }
  }
}
const pack = () => seal(Buffer.from(JSON.stringify(Object.fromEntries(data)), 'utf8'));

function flushSync() {
  clearTimeout(timer);
  timer = 0;
  if (!dirty || !key) return;
  dirty = false;
  try {
    writeBufSync(dataFile(), pack());
    existed = true;
  } catch {
    dirty = true;
  }
}
async function flushAsync() {
  timer = 0;
  if (!dirty || !key) return;
  if (writing) {
    schedule();
    return;
  }
  dirty = false;
  writing = true;
  try {
    await writeBuf(dataFile(), pack());
    existed = true;
  } catch {
    dirty = true;
  } finally {
    writing = false;
    if (dirty) schedule();
  }
}
function schedule() {
  if (timer) return;
  timer = setTimeout(flushAsync, DELAY);
  if (timer.unref) timer.unref();
}

function wipe() {
  clearTimeout(timer);
  timer = 0;
  dirty = false;
  data = new Map();
  existed = false;
  wiped = true;
  try {
    if (nameKey) fs.rmSync(dataFile(), { force: true });
  } catch {}
  try {
    fs.rmSync(path.join(dir, LEGACY_DATA), { force: true });
  } catch {}
}

const passwordMode = () => method === 'password';

async function unlockWithPassword(pw) {
  if (typeof pw !== 'string' || !pw || pw.length > 256) return false;
  if (key && !pending) return ks.verifyPassword(pw);
  const r = await ks.unlockPassword(pw);
  if (!r || !r.bundle) return false;
  install(r);
  return true;
}
const fail = r => ({ ok: false, error: (r && r.error) || (r && r.wrong ? 'Wrong password.' : 'The keys could not be changed.') });
async function usePassword(pw) {
  if (!key || pending || passwordMode()) return { ok: false, error: 'Not available right now.' };
  try {
    const r = await ks.rewrap(bundle, null, pw);
    if (!r.ok) return fail(r);
    method = 'password';
    flushSync();
    return { ok: true };
  } catch {
    return { ok: false, error: 'The keys could not be changed. Nothing was changed.' };
  }
}
async function changePassword(current, pw) {
  if (!key || pending || !passwordMode()) return { ok: false, error: 'Not available right now.' };
  try {
    const r = await ks.rewrap(bundle, current, pw);
    return r.ok ? { ok: true } : fail(r);
  } catch {
    return { ok: false, error: 'The keys could not be changed. Nothing was changed.' };
  }
}
async function useWindows(current) {
  if (!key || pending || !passwordMode()) return { ok: false, error: 'Not available right now.' };
  try {
    const r = await ks.rewrap(bundle, current, null);
    if (!r.ok) return fail(r);
    method = r.mode;
    return { ok: true };
  } catch {
    return { ok: false, error: 'The keys could not be changed. Nothing was changed.' };
  }
}

function register(ipcMain, ipc, { app, safeStorage, trusted, isLocked }) {
  dir = app.getPath('userData');
  ks.init(dir, safeStorage);
  try {
    install(ks.loadAuto());
  } catch (e) {
    key = outer = nameKey = bundle = null;
    if (e && e.code === 'NEEDPW') {
      pending = true;
      method = 'password';
    } else method = 'off';
  }
  app.on('before-quit', flushSync);
  process.on('exit', forgetKeys);

  ipcMain.on('store:load', e => {
    if (!trusted(e)) {
      e.returnValue = { ok: false };
      return;
    }
    if (!key) {
      e.returnValue = pending && isLocked() ? { ok: true, locked: true, data: {} } : { ok: false };
      return;
    }
    if (isLocked()) {
      loadedReal = false;
      e.returnValue = { ok: true, locked: true, data: {} };
      return;
    }
    loadedReal = true;
    wiped = false;
    e.returnValue = { ok: true, locked: false, fresh: !existed, data: Object.fromEntries(data) };
  });

  ipcMain.on('store:import', (e, m) => {
    if (!trusted(e) || !key || !loadedReal || wiped || existed || !m || typeof m.data !== 'object' || !m.data) {
      e.returnValue = { ok: false };
      return;
    }
    const next = new Map();
    for (const [k, v] of Object.entries(m.data)) if (typeof v === 'string' && k.length <= 512 && v.length <= 16e6) next.set(k, v);
    data = next;
    dirty = true;
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
    dirty = true;
    schedule();
  });

  ipc.handle('store:status', () => ({ on: !!key, method, algo: 'AES-256-GCM', layers: 2, moves: true }));
}

module.exports = {
  register,
  wipe,
  readTextSync,
  readText,
  writeTextSync,
  writeText,
  upgrade,
  passwordMode,
  unlockWithPassword,
  usePassword,
  changePassword,
  useWindows
};
