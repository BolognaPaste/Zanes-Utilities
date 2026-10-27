'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { isProtected, PASSES, randName, NAME_CHARS } = require('../../shred-ipc')._test;

test('the current overwrite scheme is five passes (00, FF, random, AA, random)', () => {
  assert.deepEqual(PASSES, [0x00, 0xff, 'rand', 0xaa, 'rand']);
});

test('drive roots, the home folder and its parent are protected', () => {
  assert.equal(isProtected(path.parse(process.cwd()).root), true);
  assert.equal(isProtected(os.homedir()), true);
  assert.equal(isProtected(path.dirname(os.homedir())), true);
});

test('a folder that contains a protected folder is protected too', () => {
  assert.equal(isProtected(path.dirname(path.dirname(os.homedir()))), true);
});

test('Windows system and program folders are protected when the environment names them', () => {
  const keep = { ...process.env };
  try {
    process.env.SystemRoot = path.resolve('/fake/Windows');
    process.env.ProgramFiles = path.resolve('/fake/Program Files');
    assert.equal(isProtected(path.join(process.env.SystemRoot, 'System32', 'cmd.exe')), true);
    assert.equal(isProtected(process.env.ProgramFiles), true);
  } finally {
    process.env = keep;
  }
});

test('a normal file inside a user work folder is not protected', () => {
  const p = path.join(os.homedir(), 'Documents', 'scratch', 'secret.txt');
  assert.equal(isProtected(p), false);
});

test('scrambled names have the requested length and use only lowercase letters and digits', () => {
  for (const len of [1, 8, 200]) assert.match(randName(len), new RegExp('^[a-z0-9]{' + len + '}$'));
});

test('scrambled names use every character equally often (no modulo bias)', () => {
  // 360,000 draws give 10,000 per character; 6% is six standard deviations. A byte % 36 puts a-d about 12.5% over.
  const counts = new Map();
  for (const c of randName(360000)) counts.set(c, (counts.get(c) || 0) + 1);
  assert.equal(counts.size, NAME_CHARS.length);
  for (const [c, n] of counts) assert.ok(Math.abs(n - 10000) < 600, c + ' came up ' + n + ' times');
});
