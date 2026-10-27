const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOC = 'zu-loc.bin';
const LEGACY = 'zu-store.key';
const KDF = { N: 131072, r: 8, p: 1 };
const DECOYS = 3;
const MIN_PW = 8;

let dir = '', ss = null;
const rnd = n => crypto.randomBytes(n).toString('hex');
const canWrap = () => !!(ss && ss.isEncryptionAvailable && ss.isEncryptionAvailable());

function init(userData, safeStorage) { dir = userData; ss = safeStorage; }

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + rnd(4) + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, text); try { fs.fsyncSync(fd); } catch {} } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function shred(file) {
  try {
    const n = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r+');
    try { const b = crypto.randomBytes(Math.max(1, n)); fs.writeSync(fd, b, 0, b.length, 0); try { fs.fsyncSync(fd); } catch {} }
    finally { fs.closeSync(fd); }
  } catch {}
  try { fs.unlinkSync(file); } catch {}
}

function prune(file) {
  let d = path.dirname(file);
  while (d.length > dir.length && d.startsWith(dir)) {
    try { fs.rmdirSync(d); } catch { return; }
    d = path.dirname(d);
  }
}

const EXT = ['.dat', '.bin', '.db', '.cache'];
function newRel() {
  const depth = 1 + crypto.randomInt(0, 3);
  const parts = [];
  for (let i = 0; i < depth; i++) parts.push(rnd(4 + crypto.randomInt(0, 5)));
  parts.push(rnd(8 + crypto.randomInt(0, 9)) + EXT[crypto.randomInt(0, EXT.length)]);
  return parts.join('/');
}
const REL_OK = /^([0-9a-f]{8,16}\/){1,3}[0-9a-f]{16,32}\.[a-z]{2,5}$/;
function abs(rel) {
  if (typeof rel !== 'string' || !REL_OK.test(rel)) throw new Error('Bad key location.');
  return path.join(dir, ...rel.split('/'));
}

function gcmSeal(key, aad, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function gcmOpen(key, aad, b) {
  if (b.length < 28) throw new Error('Too short.');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const kdf = (pw, salt, o) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pw).normalize('NFC'), salt, 64, { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r }, (e, k) => {
    if (e) return reject(e);
    resolve({ loc: k.subarray(0, 32), wrap: k.subarray(32, 64) });
  });
});
const kdfOk = j => j && Number.isInteger(j.N) && Number.isInteger(j.r) && Number.isInteger(j.pp)
  && j.N >= 16384 && j.N <= 262144 && (j.N & (j.N - 1)) === 0 && j.r >= 1 && j.r <= 8 && j.pp >= 1 && j.pp <= 4 && typeof j.s === 'string';
const kdfParams = j => ({ N: j.N, r: j.r, p: j.pp });
const zero = k => { if (k) { try { if (k.loc) k.loc.fill(0); if (k.wrap) k.wrap.fill(0); } catch {} } };

function readLocator() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, LOC), 'utf8'));
    if (j && j.v === 2 && (j.m === 'dpapi' || j.m === 'plain' || j.m === 'pw') && typeof j.p === 'string') return j;
  } catch {}
  return null;
}
const peekMode = () => { const j = readLocator(); return j ? j.m : null; };

function openPointer(j, kek) {
  let text;
  if (j.m === 'dpapi') {
    if (!canWrap()) throw new Error('Windows key protection is not available right now.');
    text = ss.decryptString(Buffer.from(j.p, 'base64'));
  } else if (j.m === 'plain') text = Buffer.from(j.p, 'base64').toString('utf8');
  else text = gcmOpen(kek.loc, 'ZUL2', Buffer.from(j.p, 'base64')).toString('utf8');
  const p = JSON.parse(text);
  if (!p || typeof p.k !== 'string' || !Array.isArray(p.d)) throw new Error('Bad pointer.');
  abs(p.k);
  return { k: p.k, d: p.d.filter(x => { try { abs(x); return true; } catch { return false; } }) };
}

function wrapBundle(bundle, ctx) {
  const raw = Buffer.concat([bundle.k1, bundle.k2]);
  if (ctx.m === 'dpapi') return ss.encryptString(raw.toString('base64')).toString('base64');
  if (ctx.m === 'plain') return raw.toString('base64');
  return gcmSeal(ctx.kek.wrap, 'ZUK2', raw).toString('base64');
}
function unwrapBundle(b64, m, kek) {
  let raw;
  if (m === 'dpapi') {
    if (!canWrap()) throw new Error('Windows key protection is not available right now.');
    raw = Buffer.from(ss.decryptString(Buffer.from(b64, 'base64')), 'base64');
  } else if (m === 'plain') raw = Buffer.from(b64, 'base64');
  else raw = gcmOpen(kek.wrap, 'ZUK2', Buffer.from(b64, 'base64'));
  if (raw.length !== 64) throw new Error('Bad key.');
  return { k1: Buffer.from(raw.subarray(0, 32)), k2: Buffer.from(raw.subarray(32)) };
}
function readBundle(j, ptr, kek) {
  const body = JSON.parse(fs.readFileSync(abs(ptr.k), 'utf8'));
  if (!body || body.v !== 2 || body.m !== j.m || typeof body.b !== 'string') throw new Error('Bad key file.');
  return unwrapBundle(body.b, j.m, kek);
}

function removePointer(ptr) {
  if (!ptr) return;
  for (const r of [ptr.k].concat(ptr.d || [])) { try { const f = abs(r); shred(f); prune(f); } catch {} }
}

function commit(bundle, ctx, old) {
  const k = newRel(), d = [];
  while (d.length < DECOYS) { const r = newRel(); if (r !== k && !d.includes(r)) d.push(r); }
  try {
    const b = wrapBundle(bundle, ctx);
    writeAtomic(abs(k), JSON.stringify({ v: 2, m: ctx.m, b }));
    for (const r of d) {
      const fake = crypto.randomBytes(Math.ceil(b.length * 3 / 4)).toString('base64').slice(0, b.length);
      writeAtomic(abs(r), JSON.stringify({ v: 2, m: ctx.m, b: fake }));
    }
    const back = unwrapBundle(JSON.parse(fs.readFileSync(abs(k), 'utf8')).b, ctx.m, ctx.kek);
    const same = back.k1.equals(bundle.k1) && back.k2.equals(bundle.k2);
    back.k1.fill(0); back.k2.fill(0);
    if (!same) throw new Error('The new key file did not read back correctly.');

    const ptr = JSON.stringify({ k, d });
    const loc = { v: 2, m: ctx.m };
    if (ctx.m === 'dpapi') loc.p = ss.encryptString(ptr).toString('base64');
    else if (ctx.m === 'plain') loc.p = Buffer.from(ptr, 'utf8').toString('base64');
    else {
      loc.s = ctx.salt.toString('base64'); loc.N = ctx.N; loc.r = ctx.r; loc.pp = ctx.p;
      loc.p = gcmSeal(ctx.kek.loc, 'ZUL2', Buffer.from(ptr, 'utf8')).toString('base64');
    }
    writeAtomic(path.join(dir, LOC), JSON.stringify(loc));
  } catch (e) { removePointer({ k, d }); throw e; }
  removePointer(old);
}

function readLegacy() {
  const file = path.join(dir, LEGACY);
  let j = null;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (j && j.m === 'dpapi') {
    if (!canWrap()) throw new Error('Windows key protection is not available right now.');
    try { const k = Buffer.from(ss.decryptString(Buffer.from(j.k, 'base64')), 'base64'); if (k.length === 32) return k; } catch {}
  } else if (j && j.m === 'plain') {
    const k = Buffer.from(String(j.k || ''), 'base64');
    if (k.length === 32) return k;
  }
  try { fs.renameSync(file, file + '.old'); } catch {}
  return null;
}

function loadAuto() {
  const j = readLocator();
  if (j && j.m === 'pw') { const e = new Error('A password is needed.'); e.code = 'NEEDPW'; throw e; }
  let bundle = null, old = null, legacy = false;
  if (j) {
    if (j.m === 'dpapi' && !canWrap()) throw new Error('Windows key protection is not available right now.');
    try { old = openPointer(j); bundle = readBundle(j, old); }
    catch { old = null; bundle = null; try { fs.renameSync(path.join(dir, LOC), path.join(dir, LOC + '.old')); } catch {} }
  }
  if (!bundle) {
    const k1 = readLegacy();
    legacy = !!k1;
    bundle = { k1: k1 || crypto.randomBytes(32), k2: crypto.randomBytes(32) };
  }
  const m = canWrap() ? 'dpapi' : 'plain';
  try { commit(bundle, { m }, old); } catch (e) { if (!old) throw e; }
  if (legacy) shred(path.join(dir, LEGACY));
  return { bundle, mode: m, migrated: legacy };
}

async function unlockPassword(pw) {
  const j = readLocator();
  if (!j || j.m !== 'pw' || !kdfOk(j)) return null;
  const o = kdfParams(j), salt = Buffer.from(j.s, 'base64');
  const kek = await kdf(pw, salt, o);
  try {
    let ptr;
    try { ptr = openPointer(j, kek); } catch { return null; }
    let bundle;
    try { bundle = readBundle(j, ptr, kek); } catch { return { damaged: true }; }
    try { commit(bundle, { m: 'pw', kek, salt, N: o.N, r: o.r, p: o.p }, ptr); } catch {}
    return { bundle, mode: 'pw' };
  } finally { zero(kek); }
}

async function verifyPassword(pw) {
  const j = readLocator();
  if (!j || j.m !== 'pw' || !kdfOk(j)) return false;
  const kek = await kdf(pw, Buffer.from(j.s, 'base64'), kdfParams(j));
  try { openPointer(j, kek); return true; } catch { return false; } finally { zero(kek); }
}

async function rewrap(bundle, current, next) {
  const j = readLocator();
  let old = null;
  if (j && j.m === 'pw') {
    if (!kdfOk(j)) return { ok: false, error: 'The key settings are damaged.' };
    const kek = await kdf(current, Buffer.from(j.s, 'base64'), kdfParams(j));
    try { old = openPointer(j, kek); } catch { return { ok: false, wrong: true }; } finally { zero(kek); }
  } else if (j) { try { old = openPointer(j); } catch { old = null; } }
  let ctx, kek = null;
  if (next == null) ctx = { m: canWrap() ? 'dpapi' : 'plain' };
  else {
    const salt = crypto.randomBytes(16);
    kek = await kdf(next, salt, KDF);
    ctx = { m: 'pw', kek, salt, N: KDF.N, r: KDF.r, p: KDF.p };
  }
  try { commit(bundle, ctx, old); } finally { zero(kek); }
  return { ok: true, mode: ctx.m };
}

const wipeBundle = b => { if (b) { try { b.k1.fill(0); b.k2.fill(0); } catch {} } };

module.exports = { init, loadAuto, unlockPassword, verifyPassword, rewrap, peekMode, wipeBundle, MIN_PW, LOC, LEGACY };
