#!/usr/bin/env node
// QA-4: repeatable baseline numbers. Run `npm run baseline`. Output goes to baseline/baseline-<platform>.json.
// - Main-process module load cost is measured in a fresh Node process per module.
// - PowerShell spawn cost is measured only on Windows (it is the cost behind every driver/system query).
// - App cold start and memory come from the Playwright perf test (tests/e2e/smoke.spec.js).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const round = n => Math.round(n * 10) / 10;

const MODULES = ['chat-core', 'chat-server', 'chat-tunnel', 'chat-remote', 'vault-ipc', 'shred-ipc', 'vendor-sources', 'ssh-sftp', 'optimizer-ipc',
  'lock-ipc', 'secure-store', 'keystore', 'adblock', 'logger', 'diagnostics'];

function loadCost(mod) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, ['-e', "const t=process.hrtime.bigint();require('./" + mod + "');console.log(Number(process.hrtime.bigint()-t)/1e6)"], { cwd: root, encoding: 'utf8' });
    const v = parseFloat(r.stdout);
    if (r.status === 0 && Number.isFinite(v)) runs.push(v);
  }
  return runs.length ? round(median(runs)) : null;
}

function powershellCost() {
  if (process.platform !== 'win32') return { skipped: 'not Windows' };
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint();
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '1'], { encoding: 'utf8' });
    if (r.status === 0) runs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return { runs: runs.map(round), medianMs: runs.length ? round(median(runs)) : null };
}

const size = f => { try { return fs.statSync(path.join(root, f)).size; } catch { return null; } };
const lines = f => { try { return fs.readFileSync(path.join(root, f), 'utf8').split('\n').length; } catch { return null; } };
const sourceFiles = fs.readdirSync(root).filter(f => /\.(js|html|css)$/.test(f) && f !== 'eslint.config.js');

const result = {
  generated: new Date().toISOString(),
  node: process.version, platform: process.platform, arch: process.arch,
  moduleLoadMs: Object.fromEntries(MODULES.map(m => [m, loadCost(m)])),
  powershellSpawn: powershellCost(),
  source: { files: sourceFiles.length, totalLines: sourceFiles.reduce((s, f) => s + (lines(f) || 0), 0), indexHtmlBytes: size('index.html') }
};

fs.mkdirSync(path.join(root, 'baseline'), { recursive: true });
const out = path.join(root, 'baseline', 'baseline-' + process.platform + '.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log('\nSaved ' + path.relative(root, out));
