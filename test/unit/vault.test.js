'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vault = require('../../vault-ipc');
const V = vault._test;

const PW = 'correct horse battery staple';

function harness() {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const q = { save: [], open: [], msg: [] };
  const dialog = {
    showSaveDialog: async () => q.save.shift(),
    showOpenDialog: async () => q.open.shift(),
    showMessageBox: async () => q.msg.shift() || { response: 1 }
  };
  vault.register(ipcMain, () => null, { dialog });
  const call = (ch, req) => handlers[ch]({}, req);
  return { call, q };
}

test('weakPassword rejects short alphabets, digits-only, common and sequential passwords', () => {
  for (const pw of ['aaaaaaaaaaaa', '123456789012', 'password', 'abcdefghijkl', 'qwertyuiop']) assert.equal(V.weakPassword(pw), true, pw);
  for (const pw of [PW, 'tr0ub4dor&3-plus-words', 'Zebra Kettle 91 Orbit']) assert.equal(V.weakPassword(pw), false, pw);
});

test('safeParts neutralises traversal, reserved names and illegal characters', () => {
  assert.deepEqual(V.safeParts('a/../b'), ['a', '_', 'b']);
  assert.deepEqual(V.safeParts('CON.txt'), ['_CON.txt']);
  assert.deepEqual(V.safeParts('dir/na<me>?.txt.'), ['dir', 'na_me__.txt']);
  assert.deepEqual(V.safeParts('..'), ['_']);
});

test('recBytes accounts for the 28 bytes of overhead per 1 MB chunk', () => {
  assert.equal(V.recBytes(0), 0);
  assert.equal(V.recBytes(1), 1 + V.OVER);
  assert.equal(V.recBytes(V.CH), V.CH + V.OVER);
  assert.equal(V.recBytes(V.CH + 1), V.CH + 1 + 2 * V.OVER);
});

test('chunk records round-trip and are bound to chunk index and last-chunk flag', () => {
  const key = crypto.randomBytes(32), id = crypto.randomBytes(16), data = crypto.randomBytes(1000);
  const rec = V.seal(key, V.chunkAad(id, 3, true), data);
  assert.deepEqual(V.unseal(key, V.chunkAad(id, 3, true), rec), data);
  assert.throws(() => V.unseal(key, V.chunkAad(id, 4, true), rec), /authenticate|Unsupported/i, 'moved chunk');
  assert.throws(() => V.unseal(key, V.chunkAad(id, 3, false), rec), /authenticate|Unsupported/i, 'truncation flag');
  const bad = Buffer.from(rec); bad[20] ^= 1;
  assert.throws(() => V.unseal(key, V.chunkAad(id, 3, true), bad), /authenticate|Unsupported/i, 'flipped bit');
});

test('parseIndex accepts a valid index and rejects out-of-range or malformed entries', () => {
  const ok = { id: 'a'.repeat(32), name: 'x.txt', size: 10, mtime: 1, off: V.HDR };
  const size = V.HDR + V.recBytes(10);
  assert.equal(V.parseIndex(V.indexText([ok]), size).files.length, 1);
  assert.throws(() => V.parseIndex(V.indexText([ok]), size - 1), /damaged/);
  assert.throws(() => V.parseIndex(JSON.stringify({ v: 2, files: [] }), size), /damaged/);
  assert.throws(() => V.parseIndex(V.indexText([{ ...ok, id: 'zz' }]), size), /damaged/);
  assert.throws(() => V.parseIndex(V.indexText([{ ...ok, off: 5 }]), size), /damaged/);
  assert.throws(() => V.parseIndex(V.indexText([{ ...ok, name: '' }]), size), /damaged/);
});

test('full round trip: create, add (multi-chunk), lock, reopen, extract, replace, remove, change password', { timeout: 120000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-vault-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { call, q } = harness();
  const file = path.join(tmp, 'v.zvault');

  const big = crypto.randomBytes(V.CH + 4321), small = Buffer.from('hello vault');
  fs.writeFileSync(path.join(tmp, 'big.bin'), big);
  fs.writeFileSync(path.join(tmp, 'small.txt'), small);

  assert.equal((await call('vlt:create', { password: 'short' })).ok, false, 'weak/short password refused');
  q.save.push({ canceled: false, filePath: file });
  const made = await call('vlt:create', { password: PW });
  assert.equal(made.ok, true, made.error);

  q.open.push({ canceled: false, filePaths: [path.join(tmp, 'big.bin'), path.join(tmp, 'small.txt')] });
  const added = await call('vlt:add', { kind: 'files' });
  assert.equal(added.ok, true, added.error);
  assert.equal(added.data.added, 2);
  assert.deepEqual(added.data.vault.files.map(f => f.name).sort(), ['big.bin', 'small.txt']);

  const onDisk = fs.readFileSync(file);
  assert.ok(!onDisk.includes(small), 'plaintext must not appear in the container');
  assert.ok(!onDisk.includes(Buffer.from('small.txt')), 'file names must not appear in the container');

  await call('vlt:lock');
  assert.equal((await call('vlt:state')).data, null);
  assert.equal((await call('vlt:add', { kind: 'files' })).ok, false, 'locked vault refuses work');

  q.open.push({ canceled: false, filePaths: [file] });
  await call('vlt:pick');
  assert.equal((await call('vlt:open', { file, password: 'wrong password here' })).ok, false);
  const opened = await call('vlt:open', { file, password: PW });
  assert.equal(opened.ok, true, opened.error);
  assert.equal(opened.data.files.length, 2);

  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  q.open.push({ canceled: false, filePaths: [out] });
  const ex = await call('vlt:extract', { ids: opened.data.files.map(f => f.id) });
  assert.equal(ex.ok, true, ex.error);
  assert.equal(ex.data.count, 2);
  assert.deepEqual(fs.readFileSync(path.join(out, 'big.bin')), big);
  assert.deepEqual(fs.readFileSync(path.join(out, 'small.txt')), small);

  // adding a file with the same name replaces it
  fs.writeFileSync(path.join(tmp, 'small.txt'), 'v2');
  q.open.push({ canceled: false, filePaths: [path.join(tmp, 'small.txt')] });
  const rep = await call('vlt:add', { kind: 'files' });
  assert.equal(rep.data.replaced, 1);
  assert.equal(rep.data.vault.files.length, 2);

  // remove one file
  const state = (await call('vlt:state')).data;
  const smallId = state.files.find(f => f.name === 'small.txt').id;
  const rm = await call('vlt:remove', { ids: [smallId] });
  assert.equal(rm.data.removed, 1);
  assert.deepEqual((await call('vlt:state')).data.files.map(f => f.name), ['big.bin']);

  // change password, reopen with the new one only
  const NEW = 'a totally different passphrase 42';
  const pw = await call('vlt:passwd', { oldPassword: PW, newPassword: NEW });
  assert.equal(pw.ok, true, pw.error);
  await call('vlt:lock');
  q.open.push({ canceled: false, filePaths: [file] });
  await call('vlt:pick');
  assert.equal((await call('vlt:open', { file, password: PW })).ok, false);
  const again = await call('vlt:open', { file, password: NEW });
  assert.equal(again.ok, true, again.error);

  fs.rmSync(out, { recursive: true });
  fs.mkdirSync(out);
  q.open.push({ canceled: false, filePaths: [out] });
  const ex2 = await call('vlt:extract', { ids: again.data.files.map(f => f.id) });
  assert.equal(ex2.ok, true, ex2.error);
  assert.deepEqual(fs.readFileSync(path.join(out, 'big.bin')), big, 'data survives re-keying');
  await call('vlt:lock');
});

test('tampering is detected: a flipped byte in the header or in the data fails cleanly', { timeout: 120000 }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-vault-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { call, q } = harness();
  const file = path.join(tmp, 't.zvault');
  fs.writeFileSync(path.join(tmp, 'a.txt'), crypto.randomBytes(5000));
  q.save.push({ canceled: false, filePath: file });
  await call('vlt:create', { password: PW });
  q.open.push({ canceled: false, filePaths: [path.join(tmp, 'a.txt')] });
  await call('vlt:add', { kind: 'files' });
  await call('vlt:lock');

  const pristine = fs.readFileSync(file);
  const reopen = async pw => { q.open.push({ canceled: false, filePaths: [file] }); await call('vlt:pick'); return call('vlt:open', { file, password: pw }); };

  const hdr = Buffer.from(pristine); hdr[60] ^= 0xff; fs.writeFileSync(file, hdr);
  const r1 = await reopen(PW);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /Wrong password|damaged/);

  // Layout: header, the original (now superseded) empty-index record, then file chunk records, then the live index.
  const firstChunk = V.HDR + V.indexText([]).length + V.OVER;
  const data = Buffer.from(pristine); data[firstChunk + 10] ^= 0xff; fs.writeFileSync(file, data);
  const r2 = await reopen(PW);
  assert.equal(r2.ok, true, 'header and index are intact so it opens');
  const out = path.join(tmp, 'o'); fs.mkdirSync(out);
  q.open.push({ canceled: false, filePaths: [out] });
  const ex = await call('vlt:extract', { ids: r2.data.files.map(f => f.id) });
  assert.equal(ex.data.failed.length, 1);
  assert.match(ex.data.failed[0].error, /integrity check/);
  assert.equal(fs.readdirSync(out).length, 0, 'no partial plaintext is left behind');

  fs.writeFileSync(file, pristine.subarray(0, 60));
  const r3 = await reopen(PW);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /not a vault/);
  await call('vlt:lock');
});
