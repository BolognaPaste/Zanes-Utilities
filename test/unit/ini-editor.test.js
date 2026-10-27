'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setIni, ueEdit, clampN } = require('../../optimizer-ipc')._test;

test('setIni appends a missing section at the end', () => {
  assert.equal(setIni('[A]\nx=1\n', 'B', 'y', '2'), '[A]\nx=1\n\n[B]\ny=2\n');
});

test('setIni replaces an existing key (case-insensitive) inside the right section only', () => {
  const src = '[A]\nKey=old\n[B]\nkey=keep\n';
  assert.equal(setIni(src, 'a', 'key', 'new'), '[A]\nkey=new\n[B]\nkey=keep\n');
});

test('setIni inserts a new key directly under an existing header', () => {
  assert.equal(setIni('[A]\nx=1\n', 'A', 'y', '2'), '[A]\ny=2\nx=1\n');
});

test('setIni keeps CRLF line endings', () => {
  const out = setIni('[A]\r\nx=1\r\n', 'A', 'x', '9');
  assert.equal(out, '[A]\r\nx=9\r\n');
  assert.ok(!/[^\r]\n/.test(out));
});

test('setIni on empty text creates the section', () => {
  assert.equal(setIni('', 'S', 'k', 'v'), '\n[S]\nk=v\n');
});

test('ueEdit writes every scalability key and the frame-rate limit', () => {
  const q = { fx: 2, aa: 3, shadow: 1, tex: 4 };
  const out = ueEdit('', { q, scale: 75, fps: 144 });
  assert.match(out, /\[ScalabilityGroups\]/);
  assert.match(out, /sg\.ResolutionQuality=75/);
  assert.match(out, /sg\.ShadowQuality=1/);
  assert.match(out, /sg\.TextureQuality=4/);
  assert.match(out, /\[\/Script\/Engine\.GameUserSettings\]\nFrameRateLimit=144\.000000/);
});

test('ueEdit is idempotent', () => {
  const c = { q: { fx: 2, aa: 3, shadow: 1, tex: 4 }, scale: 100, fps: 60 };
  const once = ueEdit('[Other]\nz=1\n', c);
  assert.equal(ueEdit(once, c), once);
  assert.match(once, /\[Other\]\nz=1/);
});

test('clampN rounds, clamps and falls back', () => {
  assert.equal(clampN('7.6', 0, 10, 5), 8);
  assert.equal(clampN(99, 0, 10, 5), 10);
  assert.equal(clampN(-3, 0, 10, 5), 0);
  assert.equal(clampN('abc', 0, 10, 5), 5);
  assert.equal(clampN(undefined, 0, 10, 5), 5);
});
