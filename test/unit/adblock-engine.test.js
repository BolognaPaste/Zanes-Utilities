'use strict';
// The ad-blocking engine is parsed on a worker thread (adblock-worker.js). These tests check that the result blocks
// what the lists say, that the saved engine is reused and rebuilt like ElectronBlocker.fromLists did, and that the
// main thread keeps running while a large list set is parsed.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { Request } = require('@ghostery/adblocker');
const { _fromLists: fromLists, LISTS } = require('../../adblock');

const config = { enableCompression: true, loadCosmeticFilters: true, loadNetworkFilters: true };

// Serves the test filters as the first list and leaves the other lists and resources.json empty.
function setup(t, listText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-adblock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    return { text: async () => (url.endsWith('resources.json') ? '[]' : url === LISTS[0].url ? listText : '') };
  };
  const caching = { path: path.join(dir, 'engine.bin'), read: fsp.readFile, write: fsp.writeFile };
  return { fetcher, caching, calls };
}

const blocks = (engine, url) => engine.match(Request.fromRawDetails({ url, sourceUrl: 'https://site.example/', type: 'script' })).match;

test('the engine parsed on the worker thread blocks what the lists say and is saved', async t => {
  const s = setup(t, '||ads.example.com^\n||track.example.net^');
  const engine = await fromLists(ElectronBlocker, s.fetcher, config, s.caching);
  assert.ok(engine instanceof ElectronBlocker);
  assert.equal(blocks(engine, 'https://ads.example.com/a.js'), true);
  assert.equal(blocks(engine, 'https://cdn.example.org/app.js'), false);
  assert.ok(fs.statSync(s.caching.path).size > 0, 'the serialized engine was saved');
});

test('a saved engine is reused without downloading, and a damaged one is rebuilt', async t => {
  const s = setup(t, '||ads.example.com^');
  await fromLists(ElectronBlocker, s.fetcher, config, s.caching);
  const downloads = s.calls.length;
  const cached = await fromLists(ElectronBlocker, s.fetcher, config, s.caching);
  assert.equal(s.calls.length, downloads, 'nothing was downloaded the second time');
  assert.equal(blocks(cached, 'https://ads.example.com/a.js'), true);

  fs.writeFileSync(s.caching.path, 'not an engine');
  const rebuilt = await fromLists(ElectronBlocker, s.fetcher, config, s.caching);
  assert.ok(s.calls.length > downloads, 'the lists were downloaded again');
  assert.equal(blocks(rebuilt, 'https://ads.example.com/a.js'), true);
});

test('the main thread keeps running while a large list set is parsed', async t => {
  // Parsing these 40,000 filters on the main thread stalls it for about 0.6 s on a desktop CPU.
  const lines = [];
  for (let i = 0; i < 20000; i++) lines.push('||ad-host-' + i + '.example^$script', 'site' + i + '.example##.promo-' + i);
  const s = setup(t, lines.join('\n'));
  let last = Date.now(),
    worstGap = 0;
  const tick = setInterval(() => {
    const now = Date.now();
    worstGap = Math.max(worstGap, now - last);
    last = now;
  }, 10);
  const started = Date.now();
  try {
    const engine = await fromLists(ElectronBlocker, s.fetcher, config, s.caching);
    assert.equal(blocks(engine, 'https://ad-host-123.example/x.js'), true);
  } finally {
    clearInterval(tick);
  }
  const total = Date.now() - started;
  t.diagnostic('build took ' + total + ' ms; longest main-thread stall ' + worstGap + ' ms');
  assert.ok(worstGap < 250, 'the main thread stalled for ' + worstGap + ' ms of a ' + total + ' ms build');
});
