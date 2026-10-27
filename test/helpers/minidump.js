'use strict';
// Builds a tiny but structurally valid Windows minidump for tests.
function build({
  code = 0xc0000005,
  addr = 0x7ff600001234n,
  params = [0n, 0x10n],
  tid = 4242,
  ts = 1760000000,
  mods = [],
  arch = 9,
  os = [10, 0, 22631]
} = {}) {
  const parts = [];
  const streams = [];
  let cursor = 32 + 12 * 3;
  const place = (type, buf) => {
    streams.push({ type, size: buf.length, rva: cursor });
    parts.push(buf);
    cursor += buf.length;
  };

  const ex = Buffer.alloc(8 + 32 + 8 * 15 + 16);
  ex.writeUInt32LE(tid, 0);
  ex.writeUInt32LE(code >>> 0, 8);
  ex.writeBigUInt64LE(BigInt(addr), 8 + 16);
  ex.writeUInt32LE(params.length, 8 + 24);
  params.forEach((p, i) => ex.writeBigUInt64LE(BigInt(p), 8 + 32 + i * 8));
  place(6, ex);

  const nameBufs = mods.map(m => {
    const s = Buffer.from(m.name, 'utf16le');
    const b = Buffer.alloc(4 + s.length);
    b.writeUInt32LE(s.length, 0);
    s.copy(b, 4);
    return b;
  });
  const modBase = cursor + 4 + mods.length * 108;
  let nameAt = modBase;
  const list = Buffer.alloc(4 + mods.length * 108);
  list.writeUInt32LE(mods.length, 0);
  mods.forEach((m, i) => {
    list.writeBigUInt64LE(BigInt(m.base), 4 + i * 108);
    list.writeUInt32LE(m.size, 4 + i * 108 + 8);
    list.writeUInt32LE(nameAt, 4 + i * 108 + 20);
    nameAt += nameBufs[i].length;
  });
  place(4, Buffer.concat([list, ...nameBufs]));

  const si = Buffer.alloc(24);
  si.writeUInt16LE(arch, 0);
  si.writeUInt32LE(os[0], 8);
  si.writeUInt32LE(os[1], 12);
  si.writeUInt32LE(os[2], 16);
  place(7, si);

  const head = Buffer.alloc(32);
  head.write('MDMP', 0, 'latin1');
  head.writeUInt32LE(streams.length, 8);
  head.writeUInt32LE(32, 12);
  head.writeUInt32LE(ts, 20);
  const dir = Buffer.alloc(12 * streams.length);
  streams.forEach((s, i) => {
    dir.writeUInt32LE(s.type, i * 12);
    dir.writeUInt32LE(s.size, i * 12 + 4);
    dir.writeUInt32LE(s.rva, i * 12 + 8);
  });
  // directory sits directly after the 32-byte header; recompute rva so streams start after the directory
  const shift = 32 + dir.length - (32 + 12 * 3);
  if (shift !== 0) throw new Error('minidump helper expects exactly 3 streams');
  return Buffer.concat([head, dir, ...parts]);
}
const toArrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
module.exports = { build, toArrayBuffer };
