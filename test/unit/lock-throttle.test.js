'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lock = require('../../lock-ipc')._test;

async function configure() {
  const salt = crypto.randomBytes(16);
  const cfg = { salt: salt.toString('hex'), N: 1024, r: 8, p: 1, auto: 0 };
  cfg.hash = (await lock.derive('correct horse', salt, cfg)).toString('hex');
  lock.setState(cfg);
  return cfg;
}

test('check: right password succeeds, wrong password reports a wait only from the 5th failure', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  await configure();
  assert.deepEqual(await lock.check('correct horse'), { ok: true });
  for (let i = 1; i <= 4; i++) assert.deepEqual(await lock.check('nope'), { ok: false, error: 'Wrong password.', wait: 0 });
  assert.deepEqual(await lock.check('nope'), { ok: false, error: 'Wrong password.', wait: 5 });
  const blocked = await lock.check('correct horse');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'Too many wrong attempts.');
  assert.equal(blocked.wait, 5);
});

test('check: the wait doubles with each further failure and is capped at 5 minutes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
  await configure();
  for (let i = 0; i < 5; i++) await lock.check('x');
  const waits = [];
  for (let i = 0; i < 6; i++) {
    t.mock.timers.tick(lock.state().blockedUntil - Date.now());
    const r = await lock.check('x');
    waits.push(r.wait);
  }
  assert.deepEqual(waits, [10, 20, 40, 80, 160, 300]);
});

test('check: a correct password after the wait clears the failure count', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 3_000_000 });
  await configure();
  for (let i = 0; i < 5; i++) await lock.check('x');
  t.mock.timers.tick(6000);
  assert.deepEqual(await lock.check('correct horse'), { ok: true });
  assert.equal(lock.state().fails, 0);
});

test('check: non-string and oversized inputs are simply wrong', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 4_000_000 });
  await configure();
  assert.equal((await lock.check(null)).ok, false);
  assert.equal((await lock.check('x'.repeat(300))).ok, false);
});

test('check: without a configured password it refuses', async () => {
  lock.setState(null);
  assert.deepEqual(await lock.check('anything'), { ok: false, error: 'No password is set.' });
});

test('badNew enforces the length rules', () => {
  assert.equal(lock.badNew(5, 4), 'Enter a password.');
  assert.equal(lock.badNew('abc', 4), 'Use at least 4 characters.');
  assert.equal(lock.badNew('x'.repeat(129), 4), 'That password is too long.');
  assert.equal(lock.badNew('abcd', 4), '');
});

test('load() rejects tampered or unsafe config files and accepts a valid one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-lock-'));
  try {
    const f = path.join(dir, 'app-lock.json');
    const good = { salt: 'a'.repeat(32), hash: 'b'.repeat(128), N: 16384, r: 8, p: 1, auto: 10 };
    lock.save(f, good);
    assert.deepEqual(lock.load(f), good);
    lock.save(f, { ...good, N: 3000 });
    assert.equal(lock.load(f), null, 'N must be a power of two');
    lock.save(f, { ...good, N: 2 ** 20 });
    assert.equal(lock.load(f), null, 'N above the cap is refused');
    lock.save(f, { ...good, auto: 7 });
    assert.equal(lock.load(f).auto, 0, 'unknown auto-lock minutes fall back to off');
    fs.writeFileSync(f, 'not json');
    assert.equal(lock.load(f), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
