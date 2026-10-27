'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load-browser-script');
const dump = require('../helpers/minidump');

const ctx = load('app.js');
// Values created inside the vm sandbox have a different Array prototype; compare plain copies.
const plain = x => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

test('parseDmp rejects data without the MDMP signature', () => {
  assert.equal(ctx.parseDmp(new ArrayBuffer(64)), null);
});

test('parseDmp reads exception, modules and system info', () => {
  const buf = dump.build({
    mods: [
      { name: 'C:\\Games\\Cool\\cool.exe', base: 0x7ff600000000n, size: 0x100000 },
      { name: 'C:\\Windows\\System32\\nvwgf2umx.dll', base: 0x7ffa00000000n, size: 0x500000 }
    ]
  });
  const d = ctx.parseDmp(dump.toArrayBuffer(buf));
  assert.equal(d.code, 0xc0000005);
  assert.equal(d.tid, 4242);
  assert.equal(d.mods.length, 2);
  assert.equal(d.mods[1].n, 'C:\\Windows\\System32\\nvwgf2umx.dll');
  assert.equal(d.os, '10.0 build 22631');
  assert.equal(d.par.length, 2);
});

test('anDmp: access violation inside the NVIDIA driver is flagged as a graphics driver crash', () => {
  const buf = dump.build({
    addr: 0x7ffa00001000n,
    mods: [
      { name: 'D:\\Game\\game.exe', base: 0x7ff600000000n, size: 0x100000 },
      { name: 'C:\\Windows\\System32\\nvwgf2umx.dll', base: 0x7ffa00000000n, size: 0x500000 }
    ]
  });
  const r = ctx.anDmp('crash.dmp', dump.toArrayBuffer(buf));
  assert.equal(r.findings[0].t, 'Access violation');
  assert.match(r.findings[0].e, /Tried to read address 0x10/);
  assert.match(r.findings[0].w, /near zero/);
  const driver = r.findings.find(f => /NVIDIA graphics driver/.test(f.t));
  assert.ok(driver, 'expected an NVIDIA driver finding');
  assert.equal(driver.s, 'H');
  assert.ok(r.facts.some(([k, v]) => k === 'Faulting module' && /nvwgf2umx\.dll \+0x1000/.test(v)));
  assert.ok(r.facts.some(([k, v]) => k === 'Architecture' && v === 'x64'));
});

test('anDmp: overlay modules that did not fault are listed as contributing', () => {
  const buf = dump.build({
    code: 0xc0000374,
    addr: 0x7ff600000100n,
    params: [],
    mods: [
      { name: 'D:\\Game\\game.exe', base: 0x7ff600000000n, size: 0x100000 },
      { name: 'C:\\x\\GameOverlayRenderer64.dll', base: 0x7ffb00000000n, size: 0x10000 }
    ]
  });
  const r = ctx.anDmp('crash.dmp', dump.toArrayBuffer(buf));
  assert.equal(r.findings[0].t, 'Heap corruption');
  const ov = r.findings.find(f => /Overlay, hook or anti-cheat/.test(f.t));
  assert.ok(ov);
  assert.match(ov.e, /GameOverlayRenderer64\.dll/);
});

test('anDmp: unknown exception code gets a generic explanation, not a crash', () => {
  const buf = dump.build({ code: 0xc0def00d, addr: 0x1n, params: [], mods: [] });
  const r = ctx.anDmp('x.dmp', dump.toArrayBuffer(buf));
  assert.match(r.findings[0].t, /Unknown exception 0xC0DEF00D/);
});

test('anDmp: a truncated dump reports an error message instead of throwing', () => {
  const buf = dump.build({ mods: [] }).subarray(0, 40);
  const r = ctx.anDmp('cut.dmp', dump.toArrayBuffer(buf));
  assert.ok(r.err);
  assert.deepEqual(plain(r.findings), []);
});

test('anText: log rules match with line numbers and the right severity', () => {
  const log = ['Loading level', 'Warning: slow frame', 'EXCEPTION_ACCESS_VIOLATION reading 0x0', 'bad_alloc while loading textures'].join(
    '\n'
  );
  const r = ctx.anText('game.log', log);
  const av = r.findings.find(f => f.t === 'Memory access violation');
  const oom = r.findings.find(f => f.t === 'Out of memory');
  assert.ok(av && oom);
  assert.equal(av.s, 'H');
  assert.match(av.e, /^line 3:/);
  assert.match(oom.e, /^line 4:/);
  assert.deepEqual(plain(r.facts), [['Lines read', '4']]);
});

test('anText: overlay modules named in a log are low-severity findings', () => {
  const r = ctx.anText('g.log', 'hooking via reshade64.dll\nfatal error');
  const f = r.findings.find(x => x.t === 'Overlay or injected hook module');
  assert.ok(f);
  assert.equal(f.s, 'L');
  assert.ok(r.key.some(k => /fatal error/.test(k)));
});

test('anText: very long lines are clipped and an empty file yields no findings', () => {
  assert.deepEqual(plain(ctx.anText('e.log', '').findings), []);
  const r = ctx.anText('long.log', 'x'.repeat(10000) + ' bad_alloc');
  assert.equal(r.findings.length, 0, 'text beyond the 4000-char clip is not scanned');
});
