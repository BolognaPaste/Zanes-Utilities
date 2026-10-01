// Game optimizer backend. Reads this PC's hardware (ps/specs.ps1) and applies a few Windows tweaks that need no
// administrator rights: Game Mode, Game Bar capture, the power plan and the per-game "use the high-performance GPU"
// setting. Values it changes are saved in userData/optimizer-backup.json first, so "Undo" can put them back.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const readPS = name => fs.readFileSync(path.join(__dirname, 'ps', name), 'utf8')
  .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).join('\n');
const encode = s => Buffer.from(s, 'utf16le').toString('base64');

function runPS(script, timeoutMs) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', [...PS_ARGS, '-EncodedCommand', encode(script)], { windowsHide: true });
    let out = '', err = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
const exec = (file, args) => new Promise(res => execFile(file, args, { windowsHide: true, timeout: 15000 }, (err, out) => res({ ok: !err, out: String(out || '') })));

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const GPUKEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
// [registry key, value name, wanted value, value Windows uses when the entry is missing]
const REGS = {
  gamemode: [['HKCU\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1, 1], ['HKCU\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1, 1]],
  capture: [['HKCU\\System\\GameConfigStore', 'GameDVR_Enabled', 0, 1], ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 0, 1]]
};
const IDS = ['gamemode', 'capture', 'power'];
const EXE = /^[A-Za-z]:\\[^"<>|*?\r\n]{1,400}\.exe$/i;

async function regGet(key, name) {
  const r = await exec('reg.exe', ['query', key, '/v', name]);
  const m = r.ok && /REG_DWORD\s+(0x[0-9a-f]+)/i.exec(r.out);
  return m ? parseInt(m[1], 16) : null;
}
const regSet = (key, name, v) => exec('reg.exe', ['add', key, '/v', name, '/t', 'REG_DWORD', '/d', String(v), '/f']);
const regDel = (key, name) => exec('reg.exe', ['delete', key, '/v', name, '/f']);

async function scheme() {
  const r = await exec('powercfg.exe', ['/getactivescheme']);
  const g = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(r.out), n = /\(([^)]*)\)/.exec(r.out);
  return { guid: g ? g[1].toLowerCase() : '', name: n ? n[1] : '' };
}

// ---- Per-game settings. Unreal Engine games keep their graphics choices in GameUserSettings.ini under
// %LOCALAPPDATA%\<Project>\Saved\Config\<Windows folder>. Only files that already exist are edited, and the
// original is copied to userData/optimizer-games first so "Undo game settings" can put it back.
const crypto = require('crypto');
const sha = s => crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex');
const UE_SUBS = ['WindowsNoEditor', 'Windows', 'WindowsClient', 'WinGDK'];
function ueProjects(exe) {
  const dir = path.dirname(exe), names = new Set();
  names.add(path.basename(exe).replace(/\.exe$/i, '').replace(/-Win\w*-Shipping$/i, '').replace(/-Shipping$/i, ''));
  const m = /^(.*)[\\/]Binaries[\\/]/i.exec(dir + '\\');
  if (m) names.add(path.basename(m[1]));
  else { try { for (const d of fs.readdirSync(dir, { withFileTypes: true }).slice(0, 80)) if (d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'Binaries'))) names.add(d.name); } catch {} }
  return [...names].filter(n => n && !/[\\/:*?"<>|]/.test(n));
}
function ueFiles(exe) {
  const base = process.env.LOCALAPPDATA, out = [];
  if (!base) return out;
  for (const n of ueProjects(exe)) for (const sub of UE_SUBS) {
    const f = path.join(base, n, 'Saved', 'Config', sub, 'GameUserSettings.ini');
    if (fs.existsSync(f)) out.push(f);
  }
  return out;
}
function setIni(text, section, key, value) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/), head = '[' + section.toLowerCase() + ']';
  const at = lines.findIndex(l => l.trim().toLowerCase() === head), line = key + '=' + value;
  if (at < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push('', '[' + section + ']', line, '');
    return lines.join(eol);
  }
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) if (/^\s*\[/.test(lines[i])) { end = i; break; }
  for (let i = at + 1; i < end; i++) if (lines[i].split('=')[0].trim().toLowerCase() === key.toLowerCase()) { lines[i] = line; return lines.join(eol); }
  lines.splice(at + 1, 0, line);
  return lines.join(eol);
}
const clampN = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
function ueEdit(text, c) {
  const q = c.q;
  const sg = { ResolutionQuality: c.scale, ViewDistanceQuality: q.fx, AntiAliasingQuality: q.aa, ShadowQuality: q.shadow, GlobalIlluminationQuality: q.fx,
    ReflectionQuality: q.fx, PostProcessQuality: q.fx, TextureQuality: q.tex, EffectsQuality: q.fx, FoliageQuality: q.fx, ShadingQuality: q.fx };
  for (const k of Object.keys(sg)) text = setIni(text, 'ScalabilityGroups', 'sg.' + k, sg[k]);
  return setIni(text, '/Script/Engine.GameUserSettings', 'FrameRateLimit', c.fps + '.000000');
}

function register(ipcMain, getWin, { app }) {
  const file = () => path.join(app.getPath('userData'), 'optimizer-backup.json');
  const load = () => { try { const b = JSON.parse(fs.readFileSync(file(), 'utf8')); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };
  const save = b => { b.regs = b.regs || {}; fs.writeFileSync(file(), JSON.stringify(b)); };
  let busy = false;
  const guard = fn => async (_e, req) => {
    if (process.platform !== 'win32') return { ok: false, error: 'The Game optimizer only works on Windows.' };
    if (busy) return { ok: false, error: 'Another optimizer task is still running.' };
    busy = true;
    try { return await fn(req || {}); }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    finally { busy = false; }
  };

  async function state() {
    const tweaks = {};
    for (const id of Object.keys(REGS)) {
      const vals = await Promise.all(REGS[id].map(([k, n]) => regGet(k, n)));
      tweaks[id] = { on: REGS[id].every(([, , want, def], i) => (vals[i] === null ? def : vals[i]) === want) };
    }
    const s = await scheme();
    tweaks.power = { on: s.guid === HIGH || s.guid === ULTIMATE || /high performance|ultimate/i.test(s.name), name: s.name };
    const q = await exec('reg.exe', ['query', GPUKEY]);
    const gpuPrefs = [];
    for (const l of q.out.split(/\r?\n/)) {
      const m = /^\s+(.+?)\s{2,}REG_SZ\s+(.*)$/.exec(l);
      if (m && EXE.test(m[1])) { const p = /GpuPreference=(\d)/.exec(m[2]); gpuPrefs.push({ path: m[1], pref: p ? +p[1] : 0 }); }
    }
    const b = load();
    return { tweaks, gpuPrefs, hasBackup: !!(b.power || Object.keys(b.regs || {}).length) };
  }

  ipcMain.handle('opt:specs', guard(async () => {
    const r = await runPS(readPS('specs.ps1'), 90000);
    const line = r.out.replace(/\uFEFF/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
    try {
      const d = JSON.parse(line);
      for (const k of ['gpus', 'disks']) d[k] = Array.isArray(d[k]) ? d[k] : d[k] ? [d[k]] : [];
      return { ok: true, data: d };
    } catch { return { ok: false, error: 'Windows did not return the hardware details (exit code ' + r.code + ').' }; }
  }));

  ipcMain.handle('opt:state', guard(async () => ({ ok: true, data: await state() })));

  ipcMain.handle('opt:apply', guard(async req => {
    const ids = [...new Set((Array.isArray(req.ids) ? req.ids : []).filter(x => IDS.includes(x)))];
    if (!ids.length) return { ok: false, error: 'Nothing was selected.' };
    const b = load(), failed = [];
    b.regs = b.regs || {};
    for (const id of ids) {
      if (id === 'power') {
        const cur = await scheme();
        if (cur.guid && !b.power) b.power = cur.guid;
        let r = await exec('powercfg.exe', ['/setactive', HIGH]);
        if (!r.ok) {                                   // many laptops hide the plan until it is created
          const d = await exec('powercfg.exe', ['/duplicatescheme', HIGH]), g = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(d.out);
          if (g) r = await exec('powercfg.exe', ['/setactive', g[1]]);
        }
        if (!r.ok) failed.push('power plan');
        continue;
      }
      for (const [k, n, want] of REGS[id]) {
        const key = k + '|' + n;
        if (!(key in b.regs)) b.regs[key] = await regGet(k, n);
        save(b);
        if (!(await regSet(k, n, want)).ok) failed.push(id);
      }
    }
    save(b);
    const data = await state();
    return failed.length ? { ok: false, error: 'Could not change: ' + [...new Set(failed)].join(', ') + '.', data } : { ok: true, data };
  }));

  ipcMain.handle('opt:undo', guard(async () => {
    const b = load(), failed = [];
    for (const id of Object.keys(REGS)) for (const [k, n] of REGS[id]) {
      const key = k + '|' + n;
      if (!b.regs || !(key in b.regs)) continue;
      const was = b.regs[key];
      const r = was === null ? await regDel(k, n) : await regSet(k, n, was);
      if (r.ok || was === null) delete b.regs[key]; else failed.push(n);
    }
    if (b.power && GUID.test(b.power)) {
      if ((await exec('powercfg.exe', ['/setactive', b.power])).ok) delete b.power; else failed.push('power plan');
    } else delete b.power;
    save(b);
    const data = await state();
    return failed.length ? { ok: false, error: 'Could not restore: ' + failed.join(', ') + '.', data } : { ok: true, data };
  }));

  // Windows "Graphics settings" per-app choice: GpuPreference=2 is High performance.
  ipcMain.handle('opt:gpu', guard(async req => {
    const paths = (Array.isArray(req.paths) ? req.paths : []).filter(p => typeof p === 'string' && EXE.test(p)).slice(0, 50);
    if (!paths.length) return { ok: false, error: 'Choose game .exe files first.' };
    let bad = 0;
    for (const p of paths) if (!(await exec('reg.exe', ['add', GPUKEY, '/v', p, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'])).ok) bad++;
    const data = await state();
    return bad ? { ok: false, error: bad + ' of ' + paths.length + ' could not be saved.', data } : { ok: true, data };
  }));

  ipcMain.handle('opt:gpuRemove', guard(async req => {
    if (typeof req.path !== 'string' || !EXE.test(req.path)) return { ok: false, error: 'That is not a game path.' };
    await exec('reg.exe', ['delete', GPUKEY, '/v', req.path, '/f']);
    return { ok: true, data: await state() };
  }));

  // ---- "My games": a saved list of game .exe files that the recommended settings are written into.
  const gfile = () => path.join(app.getPath('userData'), 'optimizer-games.json');
  const gdir = () => path.join(app.getPath('userData'), 'optimizer-games');
  const gload = () => {
    try { const b = JSON.parse(fs.readFileSync(gfile(), 'utf8')); return { games: Array.isArray(b.games) ? b.games.filter(p => typeof p === 'string' && EXE.test(p)) : [], bak: b.bak && typeof b.bak === 'object' ? b.bak : {} }; }
    catch { return { games: [], bak: {} }; }
  };
  const gsave = b => { fs.mkdirSync(path.dirname(gfile()), { recursive: true }); fs.writeFileSync(gfile(), JSON.stringify(b)); };
  const gview = b => ({ games: b.games.map(p => { const files = ueFiles(p); return { path: p, exists: fs.existsSync(p), files: files.length, applied: files.some(f => b.bak[sha(f)]) }; }) });

  ipcMain.handle('opt:gamesGet', guard(async () => ({ ok: true, data: gview(gload()) })));

  ipcMain.handle('opt:gamesAdd', guard(async req => {
    const b = gload(), have = new Set(b.games.map(p => p.toLowerCase()));
    for (const p of (Array.isArray(req.paths) ? req.paths : [])) {
      if (typeof p === 'string' && EXE.test(p) && fs.existsSync(p) && !have.has(p.toLowerCase()) && b.games.length < 100) { b.games.push(p); have.add(p.toLowerCase()); }
    }
    gsave(b);
    return { ok: true, data: gview(b) };
  }));

  ipcMain.handle('opt:gamesRemove', guard(async req => {
    const b = gload();
    b.games = b.games.filter(p => p.toLowerCase() !== String(req.path || '').toLowerCase());
    gsave(b);
    return { ok: true, data: gview(b) };
  }));

  ipcMain.handle('opt:gamesApply', guard(async req => {
    const b = gload();
    if (!b.games.length) return { ok: false, error: 'Add some games first.' };
    const c = req.cfg || {}, q = c.q || {};
    const cfg = { scale: clampN(c.scale, 50, 100, 100), fps: clampN(c.fps, 30, 360, 60),
      q: { shadow: clampN(q.shadow, 0, 4, 2), aa: clampN(q.aa, 0, 4, 2), fx: clampN(q.fx, 0, 4, 2), tex: clampN(q.tex, 0, 4, 2) } };
    fs.mkdirSync(gdir(), { recursive: true });
    const results = [];
    for (const p of b.games) {
      let done = 0, bad = 0;
      for (const f of ueFiles(p)) {
        try {
          const k = sha(f);
          if (!b.bak[k]) { const copy = path.join(gdir(), k + '.bak'); fs.copyFileSync(f, copy); b.bak[k] = { file: f, copy }; gsave(b); }
          const text = fs.readFileSync(f, 'utf8');
          if (text.includes('\u0000')) { bad++; continue; }
          fs.writeFileSync(f, ueEdit(text.replace(/^\uFEFF/, ''), cfg));
          done++;
        } catch { bad++; }
      }
      if (req.gpu && EXE.test(p)) await exec('reg.exe', ['add', GPUKEY, '/v', p, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f']);
      results.push({ path: p, status: done ? 'applied' : bad ? 'failed' : 'none' });
    }
    gsave(b);
    return { ok: true, data: Object.assign(gview(b), { results }) };
  }));

  ipcMain.handle('opt:gamesUndo', guard(async () => {
    const b = gload(), failed = [];
    for (const k of Object.keys(b.bak)) {
      const e = b.bak[k];
      try {
        if (e && typeof e.file === 'string' && typeof e.copy === 'string' && e.copy.startsWith(gdir()) && fs.existsSync(e.copy)) {
          fs.copyFileSync(e.copy, e.file); fs.unlinkSync(e.copy);
        }
        delete b.bak[k];
      } catch { failed.push(path.basename(e && e.file || k)); }
    }
    gsave(b);
    const data = gview(b);
    return failed.length ? { ok: false, error: 'Could not restore: ' + failed.join(', ') + '. Close the game and try again.', data } : { ok: true, data };
  }));
}

module.exports = { register };
