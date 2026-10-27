'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { isProtected, PASSES } = require('../../shred-ipc')._test;

test('the current overwrite scheme is five passes (00, FF, random, AA, random)', () => {
  assert.deepEqual(PASSES, [0x00, 0xFF, 'rand', 0xAA, 'rand']);
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
  } finally { process.env = keep; }
});

test('a normal file inside a user work folder is not protected', () => {
  const p = path.join(os.homedir(), 'Documents', 'scratch', 'secret.txt');
  assert.equal(isProtected(p), false);
});
