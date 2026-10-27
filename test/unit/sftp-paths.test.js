'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { safeLocalName, withSuffix, inside } = require('../../ssh-sftp');

test('safeLocalName replaces characters Windows forbids and dodges reserved device names', () => {
  assert.equal(safeLocalName('a<b>c:d.txt'), 'a_b_c_d.txt');
  assert.equal(safeLocalName('../evil'), '.._evil');
  assert.equal(safeLocalName('..'), '_');
  assert.equal(safeLocalName(''), '_');
  assert.equal(safeLocalName('nul.txt'), '_nul.txt');
  assert.equal(safeLocalName('trailing. '), 'trailing');
});

test('safeLocalName caps very long names but keeps a short extension', () => {
  const n = safeLocalName('a'.repeat(300) + '.mp4');
  assert.ok(n.length <= 200);
  assert.ok(n.endsWith('.mp4'));
});

test('withSuffix inserts a counter before the extension', () => {
  assert.equal(withSuffix('report.pdf', 2), 'report (2).pdf');
  assert.equal(withSuffix('README', 3), 'README (3)');
  assert.equal(withSuffix('.hidden', 2), '.hidden (2)');
});

test('inside only accepts paths within the root', () => {
  const root = path.resolve('/srv/dl');
  assert.equal(inside(root, path.join(root, 'a', 'b')), true);
  assert.equal(inside(root, root), true);
  assert.equal(inside(root, path.join(root, '..', 'other')), false);
  assert.equal(inside(root, root + '-sibling'), false);
});
