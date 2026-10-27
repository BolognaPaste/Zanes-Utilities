#!/usr/bin/env node
// QA-6: hash-verify the bundled third-party binaries (scrcpy, cloudflared, mumble).
//   npm run verify:binaries              check against binaries.sha256.json
//   npm run verify:binaries -- --update  (re)write the manifest from what is on disk
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'binaries.sha256.json');
const DIRS = ['scrcpy', 'cloudflared', 'mumble'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const rel = f => path.relative(root, f).split(path.sep).join('/');

const present = DIRS.map(d => path.join(root, d)).filter(d => fs.existsSync(d));
const onDisk = {};
for (const d of present) for (const f of walk(d, [])) onDisk[rel(f)] = sha(f);

if (process.argv.includes('--update')) {
  if (!present.length) {
    console.error('None of ' + DIRS.join(', ') + ' exist here, nothing to record.');
    process.exit(1);
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files: onDisk }, null, 2) + '\n');
  console.log('Recorded ' + Object.keys(onDisk).length + ' file hashes in binaries.sha256.json');
  process.exit(0);
}

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { files: {} };
const want = manifest.files || {};
if (!Object.keys(want).length) {
  console.warn(
    'binaries.sha256.json is empty: no hashes are pinned yet. Run `npm run verify:binaries -- --update` on a PC that has the binaries, then commit the file.'
  );
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}
let bad = 0;
for (const [f, h] of Object.entries(want)) {
  if (!(f in onDisk)) {
    if (present.some(d => f.startsWith(rel(d) + '/'))) {
      console.error('MISSING  ' + f);
      bad++;
    }
    continue;
  }
  if (onDisk[f] !== h) {
    console.error('CHANGED  ' + f);
    bad++;
  }
}
for (const f of Object.keys(onDisk))
  if (!(f in want)) {
    console.error('UNLISTED ' + f);
    bad++;
  }
console.log(bad ? bad + ' problem(s) found.' : 'All ' + Object.keys(want).length + ' pinned binaries match.');
process.exit(bad ? 1 : 0);
