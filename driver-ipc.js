// Driver updater backend: runs the PowerShell scripts in ./ps and reports back to the page.
// Updates come from the Windows Update driver catalog (Microsoft-signed), installed through
// the Windows Update Agent API. Installing needs administrator rights, requested via UAC.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

// Read a script, drop comment-only lines and indentation so the encoded command stays short.
const readPS = name => fs.readFileSync(path.join(__dirname, 'ps', name), 'utf8')
  .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).join('\n');
const encode = s => Buffer.from(s, 'utf16le').toString('base64');
const clean = s => String(s || '').replace(/#< CLIXML/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

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

function listResult(r) {
  const line = r.out.replace(/\uFEFF/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
  if (line) {
    try {
      let d = JSON.parse(line);
      if (!Array.isArray(d)) d = d ? [d] : [];
      return { ok: true, data: d };
    } catch {}
  }
  return { ok: false, error: clean(r.err) || 'Windows did not return a result (exit code ' + r.code + ').' };
}

let busy = false;
async function guard(fn) {
  if (process.platform !== 'win32') return { ok: false, error: 'Driver updates are only available on Windows.' };
  if (busy) return { ok: false, error: 'Another driver task is already running.' };
  busy = true;
  try { return await fn(); }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  finally { busy = false; }
}

function register(ipcMain, getWin) {
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('drv:progress', m); };

  ipcMain.handle('drv:scan', () => guard(async () => listResult(await runPS(readPS('scan.ps1'), 240000))));
  ipcMain.handle('drv:installed', () => guard(async () => listResult(await runPS(readPS('installed.ps1'), 90000))));

  ipcMain.handle('drv:install', (_e, req) => guard(async () => {
    const ids = Array.isArray(req && req.ids) ? [...new Set(req.ids.filter(x => typeof x === 'string' && GUID.test(x)))] : [];
    if (!ids.length) return { ok: false, error: 'No drivers were selected.' };

    const log = path.join(os.tmpdir(), 'zu-drv-' + crypto.randomUUID() + '.log');
    fs.writeFileSync(log, '');
    // The whole elevated script travels in the command line, so there is no script file on disk
    // that another program could edit before it runs with administrator rights.
    const script = readPS('install.ps1')
      .replace('__IDS__', () => ids.map(i => "'" + i + "'").join(','))
      .replace('__LOG__', () => log.replace(/'/g, "''"))
      .replace('__RESTORE__', () => (req.restore ? '$true' : '$false'));
    const launch = "Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList " +
      "'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','" + encode(script) + "'";

    const items = [], warns = [];
    let done = null, seen = 0;
    const tick = () => {
      let txt = '';
      try { txt = fs.readFileSync(log, 'utf8'); } catch { return; }
      const lines = txt.replace(/\uFEFF/g, '').split('\n');
      lines.pop(); // last piece is empty or a half-written line
      for (; seen < lines.length; seen++) {
        let m; try { m = JSON.parse(lines[seen]); } catch { continue; }
        if (m.t === 'item') items.push(m);
        else if (m.t === 'warn') { warns.push(m.m); send(m); }
        else if (m.t === 'done') done = m;
        else send(m);
      }
    };
    const timer = setInterval(tick, 400);

    const r = await new Promise(resolve => {
      const p = spawn('powershell.exe', [...PS_ARGS, '-Command', launch], { windowsHide: true });
      let err = '';
      p.stderr.setEncoding('utf8');
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => resolve({ code: -1, err: e.message }));
      p.on('close', code => resolve({ code, err }));
    });
    clearInterval(timer); tick();
    try { fs.unlinkSync(log); } catch {}

    if (!done) {
      return { ok: false, error: seen === 0
        ? 'Nothing was installed. Administrator permission was not granted, or the helper could not start.'
        : (clean(r.err) || 'The installer stopped unexpectedly.') };
    }
    return { ok: true, data: { success: !!done.ok, reboot: !!done.reboot, message: done.m || '', items, warns } };
  }));
}

module.exports = { register, runPS, readPS, listResult, clean };
