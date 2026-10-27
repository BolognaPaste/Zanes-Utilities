'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cmp, vendorOf, parseLookup, major } = require('../../vendor-sources')._test;

test('cmp orders dotted versions numerically, not as text', () => {
  assert.equal(cmp('552.12', '552.9'), 1);
  assert.equal(cmp('31.0.101.5333', '31.0.101.5590'), -1);
  assert.equal(cmp('1.2', '1.2.0'), 0);
  assert.equal(cmp('2', '10'), -1);
});

test('cmp treats missing parts as zero and is antisymmetric', () => {
  for (const [a, b] of [['1.0', '1'], ['3.4.5', '3.4'], ['0.9', '1.0.0']]) assert.equal(cmp(a, b) + 0, -cmp(b, a) + 0);
});

test('major extracts the leading number or 0', () => {
  assert.equal(major('24.30.1'), 24);
  assert.equal(major('abc'), 0);
});

test('vendorOf recognises GPU vendors and skips virtual adapters', () => {
  assert.equal(vendorOf({ mfr: 'NVIDIA', name: 'GeForce RTX 4070' }), 'nvidia');
  assert.equal(vendorOf({ mfr: 'Advanced Micro Devices, Inc.', name: 'Radeon RX 7800 XT' }), 'amd');
  assert.equal(vendorOf({ mfr: 'Intel Corporation', name: 'Intel(R) UHD Graphics' }), 'intel');
  assert.equal(vendorOf({ mfr: 'Microsoft', name: 'Microsoft Basic Display Adapter' }), '');
  assert.equal(vendorOf({ mfr: 'Parsec', name: 'Parsec Virtual Display' }), '');
  assert.equal(vendorOf({}), '');
});

test('parseLookup reads NVIDIA lookup XML including parent ids', () => {
  const xml = '<LookupValueCollection><LookupValue ParentID="3"><Name> GeForce RTX 4070 </Name><Value>1001</Value></LookupValue><LookupValue><Name>Series</Name><Value>7</Value></LookupValue></LookupValueCollection>';
  assert.deepEqual(parseLookup(xml), [
    { name: 'GeForce RTX 4070', value: '1001', parent: '3' },
    { name: 'Series', value: '7', parent: '' }
  ]);
});

test('parseLookup returns an empty list for unexpected markup (vendor page drift)', () => {
  assert.deepEqual(parseLookup('<html>changed</html>'), []);
});
