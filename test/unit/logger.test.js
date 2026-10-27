'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { create, redact, MAX_BYTES, KEEP } = require('../../logger');
const diagnostics = require('../../diagnostics');

const tmp = t => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-log-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

test('redact hides the home folder, user name, LAN addresses, tunnel hosts, hex secrets and key=value secrets', () => {
  const o = { home: 'C:\\Users\\Zane', user: 'Zane' };
  assert.equal(redact('open C:\\Users\\Zane\\Documents\\x.txt', o), 'open %USERPROFILE%\\Documents\\x.txt');
  assert.equal(redact('open C:/Users/zane/Documents', o), 'open %USERPROFILE%/Documents');
  assert.equal(redact('hello Zane!', o), 'hello <user>!');
  assert.equal(redact('Zanes Utilities', o), 'Zanes Utilities', 'does not mangle longer words');
  assert.equal(redact('http://192.168.1.77:7878', o), 'http://192.168.x.x:7878');
  assert.equal(redact('https://quiet-frog-12.trycloudflare.com/join', o), 'https://<tunnel-host>/join');
  assert.equal(redact('token ' + 'ab12'.repeat(10), o), 'token <hex>');
  assert.equal(redact('password=hunter2 next', o), 'password=<hidden> next');
  assert.equal(redact('{"token":"abc"}', o), '{"token":"<hidden>"}');
});

test('redact tolerates null and non-strings', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(42), '42');
});

test('log lines have a timestamp and level, honour the minimum level and redact extras', t => {
  const dir = tmp(t);
  const log = create(dir, { level: 'info', home: '/home/zed', user: 'zed' });
  log.debug('hidden');
  log.info('Started');
  log.error('Boom', new Error('failed in /home/zed/app'));
  const text = log.readAll();
  assert.ok(!text.includes('hidden'));
  assert.match(text, /^\d{4}-\d\d-\d\dT[\d:.]+Z INFO  Started\n/);
  assert.match(text, /ERROR Boom Error: failed in %USERPROFILE%\/app/);
  assert.equal(text.trim().split('\n').length, 2, 'stack traces stay on one line');
});

test('the log rotates at the size limit and keeps a fixed number of files', t => {
  const dir = tmp(t);
  const log = create(dir, {});
  const line = 'x'.repeat(1000);
  for (let i = 0; i < Math.ceil((MAX_BYTES * 4) / 1000); i++) log.info(line);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['app.log', 'app.log.1', 'app.log.2'].slice(0, KEEP));
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= MAX_BYTES);
});

test('logging never throws even when the folder is unusable', t => {
  const dir = tmp(t);
  const blocker = path.join(dir, 'file');
  fs.writeFileSync(blocker, 'x');
  const log = create(path.join(blocker, 'sub'));
  assert.doesNotThrow(() => {
    log.info('a');
    log.error('b', new Error('c'));
  });
  assert.equal(log.readAll(), '');
});

test('diagnostics bundle contains versions, timings, modules and a redacted log, and no personal data keys', () => {
  const app = { getName: () => 'Zanes Utilities', getVersion: () => '1.0.0', isPackaged: false };
  const proc = {
    versions: { electron: '44.7.2', chrome: '1', node: '22' },
    platform: 'win32',
    arch: 'x64',
    memoryUsage: () => ({ rss: 200 * 1048576, heapUsed: 50 * 1048576 })
  };
  const b = diagnostics.build({
    app,
    process: proc,
    log: 'password=abc line',
    timings: { appReady: 120 },
    loadedModules: new Set(['chat']),
    now: 0
  });
  assert.equal(b.schema, 1);
  assert.equal(b.generated, '1970-01-01T00:00:00.000Z');
  assert.equal(b.app.version, '1.0.0');
  assert.deepEqual(b.timingsMs, { appReady: 120 });
  assert.deepEqual(b.loadedModules, ['chat']);
  assert.equal(b.memoryMB.rss, 200);
  assert.equal(b.log, 'password=<hidden> line');
  assert.deepEqual(Object.keys(b).sort(), [
    'app',
    'generated',
    'loadedModules',
    'log',
    'memoryMB',
    'runtime',
    'schema',
    'system',
    'timingsMs'
  ]);
  assert.doesNotThrow(() => JSON.parse(diagnostics.toText(b)));
});
