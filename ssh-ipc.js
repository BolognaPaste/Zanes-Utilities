// SSH terminal backend (file transfer is in ssh-sftp.js). Runs in the main process, so the page never touches the network, your keys or
// your password directly. It uses the "ssh2" package, which is loaded only when you first connect, so the
// rest of the app still starts if that package has not been installed yet.
//
// What it guarantees:
//  - Server identity is checked. A server seen for the first time is shown to you in a native dialog (the
//    page cannot click it for you); a server whose key has CHANGED is refused outright.
//  - Passwords and key passphrases are used for the one connection and are never written to disk.
//  - Only a real private key file can be read as a key (it must start with a key header and be under 64 KB).
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_SESSIONS = 6;
const KEY_HEAD = /^\s*(-----BEGIN [A-Z ]*PRIVATE KEY-----|PuTTY-User-Key-File-\d+:)/;
const NEED = 'The SSH component is not installed yet. In the app folder, run "npm install", then start the app again.';
const HOST_RE = /^[A-Za-z0-9:][A-Za-z0-9._:%-]{0,251}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

let lib;
function load() {
  if (lib !== undefined) return lib;
  try { lib = require('ssh2'); } catch { lib = null; }
  return lib;
}

// The same fingerprint OpenSSH prints: SHA256, base64, no padding.
const fingerprint = blob => 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
function keyType(blob) {
  try { const n = blob.readUInt32BE(0); return blob.toString('latin1', 4, 4 + n).replace(/^ssh-/, '').toUpperCase(); } catch { return ''; }
}
const hostKey = (host, port) => host.toLowerCase() + ':' + port;

function explain(e) {
  const m = String((e && e.message) || e || '');
  const c = e && e.code;
  if (e && e.level === 'client-authentication') return 'Sign-in failed: the server did not accept that user name, password or key.';
  if (/no passphrase/i.test(m)) return 'This key is protected by a passphrase. Enter the passphrase and try again.';
  if (/passphrase/i.test(m) && /(bad|incorrect|wrong|unable|decrypt)/i.test(m)) return 'The passphrase did not unlock this key.';
  if (/Cannot parse privateKey|Unsupported key format/i.test(m)) return 'The key file could not be read. It may be damaged or in a format this app does not support.';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'That server name could not be found. Check the host name and your internet connection.';
  if (c === 'ECONNREFUSED') return 'The server refused the connection. SSH may not be running on that port.';
  if (c === 'ETIMEDOUT' || /timed out/i.test(m)) return 'The server did not answer in time.';
  if (c === 'ECONNRESET') return 'The server closed the connection.';
  if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH') return 'That server cannot be reached from this network.';
  return m || 'The connection failed.';
}

function register(ipcMain, getWin, { app, dialog }) {
  const sessions = new Map();            // id -> { conn, stream, chunks, timer, closed }
  const prompts = new Map();             // pid -> { id, finish, timer }
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('ssh:event', m); };
  const khFile = () => path.join(app.getPath('userData'), 'ssh-known-hosts.json');
  // File transfer (SFTP) lives in its own file; it shares this connection and is told when a session ends.
  const sf = require('./ssh-sftp').register(ipcMain, getWin, { dialog, send, getSession: id => sessions.get(id) });

  async function readHosts() {
    try { const o = JSON.parse(await fsp.readFile(khFile(), 'utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  }
  async function writeHosts(o) {
    const f = khFile(), tmp = f + '.tmp';
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(o, null, 1), 'utf8');
    await fsp.rename(tmp, f);
  }

  function flush(s) {
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    if (!s.chunks.length) return;
    const d = Buffer.concat(s.chunks); s.chunks = []; s.size = 0;
    send({ id: s.id, t: 'data', d });
  }
  function queue(s, b) {
    s.chunks.push(b); s.size += b.length;
    if (s.size >= 262144) flush(s);
    else if (!s.timer) s.timer = setTimeout(() => flush(s), 12);   // many small chunks become one message
  }
  function closeSession(id, why) {
    const s = sessions.get(id);
    if (!s || s.closed) return;
    s.closed = true;
    flush(s);
    try { sf.closed(id); } catch {}          // stops any copy and closes the file channel before the connection goes
    sessions.delete(id);
    try { s.stream && s.stream.end(); } catch {}
    try { s.conn.end(); } catch {}
    send({ id, t: 'closed', m: why || '' });
  }
  function closeAll() { for (const id of [...sessions.keys()]) closeSession(id, ''); }
  function dropPrompts(id) {
    for (const [pid, p] of prompts) if (p.id === id) { clearTimeout(p.timer); prompts.delete(pid); try { p.finish([]); } catch {} }
  }
  app.on('will-quit', closeAll);

  ipcMain.handle('ssh:state', () => ({ ok: true, data: { available: !!load(), sessions: sessions.size, max: MAX_SESSIONS, error: load() ? '' : NEED } }));

  ipcMain.handle('ssh:pickKey', async () => {
    const ssh = path.join(os.homedir(), '.ssh');
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Choose your private key file',
      defaultPath: fs.existsSync(ssh) ? ssh : undefined,
      properties: ['openFile'],
      filters: [{ name: 'All files', extensions: ['*'] }]
    });
    return { ok: true, data: { path: r.canceled || !r.filePaths[0] ? '' : r.filePaths[0] } };
  });

  ipcMain.handle('ssh:connect', async (_e, req) => {
    const ssh2 = load();
    if (!ssh2) return { ok: false, error: NEED };
    req = req && typeof req === 'object' ? req : {};
    const id = String(req.id || ''), host = String(req.host || '').trim(), user = String(req.user || '').trim();
    const port = req.port === undefined || req.port === '' ? 22 : Number(req.port);
    const auth = req.auth === 'key' ? 'key' : 'password';
    const password = typeof req.password === 'string' ? req.password : '';
    const passphrase = typeof req.passphrase === 'string' ? req.passphrase : '';
    const cols = Math.min(500, Math.max(10, Math.floor(Number(req.cols)) || 80));
    const rows = Math.min(300, Math.max(2, Math.floor(Number(req.rows)) || 24));

    if (!ID_RE.test(id) || sessions.has(id)) return { ok: false, error: 'Could not start this connection. Please try again.' };
    if (!HOST_RE.test(host)) return { ok: false, error: 'Enter the host name or IP address of the server.' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'The port must be a number from 1 to 65535.' };
    if (!user || user.length > 128 || /[\u0000-\u001f\u007f]/.test(user)) return { ok: false, error: 'Enter your user name on that server.' };
    if (password.length > 1024 || passphrase.length > 1024) return { ok: false, error: 'That password is too long.' };
    if (auth === 'password' && !password) return { ok: false, error: 'Enter your password.' };
    if (sessions.size >= MAX_SESSIONS) return { ok: false, error: 'You can have up to ' + MAX_SESSIONS + ' connections open at once. Close one first.' };

    let privateKey;
    if (auth === 'key') {
      const kp = String(req.keyPath || '');
      if (!path.isAbsolute(kp)) return { ok: false, error: 'Choose your private key file.' };
      try {
        const st = await fsp.stat(kp);
        if (!st.isFile() || st.size > 65536) return { ok: false, error: 'That file is not a private key.' };
        privateKey = await fsp.readFile(kp);
        if (!KEY_HEAD.test(privateKey.toString('latin1', 0, 200))) return { ok: false, error: 'That file is not a private key. Choose the private one (for example id_ed25519), not the ".pub" file.' };
      } catch (e) {
        return { ok: false, error: 'The key file could not be read: ' + (e.code || e.message) };
      }
    }

    const known = await readHosts();
    const hk = hostKey(host, port);
    let hostFail = '';

    return new Promise(resolve => {
      const conn = new ssh2.Client();
      const s = { id, conn, stream: null, chunks: [], size: 0, timer: null, closed: false };
      sessions.set(id, s);
      let settled = false, fp = '', typ = '', pwUsed = false;
      const fail = msg => {
        if (settled) return;
        settled = true;
        dropPrompts(id);
        sessions.delete(id);
        try { conn.end(); } catch {}
        resolve({ ok: false, error: hostFail || msg, hostChanged: !!hostFail && /CHANGED/.test(hostFail) });
      };

      conn.on('ready', () => {
        conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
          if (err) return fail('The server would not open a terminal: ' + err.message);
          if (settled) { try { stream.end(); } catch {} return; }
          settled = true;
          s.stream = stream;
          stream.on('data', b => queue(s, b));
          stream.stderr.on('data', b => queue(s, b));
          stream.on('close', () => closeSession(id, 'The session ended.'));
          resolve({ ok: true, data: { id, host, port, user, fingerprint: fp, keyType: typ } });
        });
      });
      conn.on('error', e => {
        if (!settled) fail(explain(e));
        else closeSession(id, explain(e));
      });
      conn.on('close', () => {
        if (!settled) fail('The connection was closed before it finished. ' + (hostFail || ''));
        else closeSession(id, 'The connection was closed.');
      });

      // Some servers ask for the password again (or for a 2-step code) as a "keyboard-interactive" question.
      conn.on('keyboard-interactive', (name, instructions, _lang, qs, finish) => {
        if (auth === 'password' && !pwUsed && qs.length === 1 && /password/i.test(qs[0].prompt) && !qs[0].echo) { pwUsed = true; return finish([password]); }
        if (!qs.length) return finish([]);
        const pid = crypto.randomUUID();
        const timer = setTimeout(() => { prompts.delete(pid); finish([]); }, 120000);
        prompts.set(pid, { id, finish, timer });
        send({ id, t: 'prompt', pid, name: String(name || ''), instructions: String(instructions || ''), prompts: qs.map(q => ({ prompt: String(q.prompt || ''), echo: !!q.echo })) });
      });

      const cfg = {
        host, port, username: user,
        readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
        tryKeyboard: true,
        // Called during the handshake with the server's public key; deciding here is what stops impersonation.
        hostVerifier: (blob, cb) => {
          fp = fingerprint(blob); typ = keyType(blob);
          const saved = known[hk];
          if (saved === fp) return cb(true);
          if (saved) {
            hostFail = 'WARNING: the identity of ' + host + ' has CHANGED. This app saved ' + saved + ' but the server now presents ' + fp +
              '. Someone may be intercepting the connection, or the server was reinstalled. The connection was refused.';
            return cb(false);
          }
          dialog.showMessageBox(getWin(), {
            type: 'question', buttons: ['Cancel', 'Trust and connect'], defaultId: 0, cancelId: 0, noLink: true,
            title: 'Trust this server?',
            message: 'You have not connected to ' + host + (port === 22 ? '' : ' (port ' + port + ')') + ' before.',
            detail: 'The server identified itself as ' + (typ || 'unknown type') + ' with this fingerprint:\n\n' + fp +
              '\n\nOnly continue if you expect this server. If you can, compare the fingerprint with the one from the server\'s owner (on the server: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub). If you trust it, the app remembers it and warns you if it ever changes.'
          }).then(async r => {
            if (r.response !== 1) { hostFail = 'Connection cancelled. You did not trust the server.'; return cb(false); }
            try { const cur = await readHosts(); cur[hk] = fp; await writeHosts(cur); } catch { /* still connect; it will ask again next time */ }
            cb(true);
          }).catch(() => { hostFail = 'Connection cancelled.'; cb(false); });
        }
      };
      if (auth === 'key') { cfg.privateKey = privateKey; if (passphrase) cfg.passphrase = passphrase; cfg.tryKeyboard = false; }
      else { cfg.password = password; }

      try { conn.connect(cfg); } catch (e) { fail(explain(e)); }
    });
  });

  ipcMain.handle('ssh:answer', (_e, req) => {
    const p = req && prompts.get(String(req.pid || ''));
    if (!p) return { ok: false };
    clearTimeout(p.timer); prompts.delete(req.pid);
    const a = Array.isArray(req.answers) ? req.answers.slice(0, 8).map(x => String(x).slice(0, 1024)) : [];
    p.finish(a);
    return { ok: true };
  });

  ipcMain.handle('ssh:input', (_e, req) => {
    const s = req && sessions.get(String(req.id || ''));
    if (!s || !s.stream || typeof req.data !== 'string' || req.data.length > 1048576) return { ok: false };
    s.stream.write(req.data);
    return { ok: true };
  });

  ipcMain.handle('ssh:resize', (_e, req) => {
    const s = req && sessions.get(String(req.id || ''));
    const cols = Math.floor(Number(req && req.cols)), rows = Math.floor(Number(req && req.rows));
    if (!s || !s.stream || !(cols >= 1 && cols <= 500 && rows >= 1 && rows <= 300)) return { ok: false };
    try { s.stream.setWindow(rows, cols, 0, 0); } catch { return { ok: false }; }
    return { ok: true };
  });

  ipcMain.handle('ssh:close', (_e, req) => { const id = String((req && req.id) || ''); dropPrompts(id); closeSession(id, ''); return { ok: true }; });
  // The page asks for this when it loads: a reloaded page has lost its terminals, so nothing may stay open behind it.
  ipcMain.handle('ssh:reset', () => { for (const id of [...prompts.values()].map(p => p.id)) dropPrompts(id); closeAll(); return { ok: true }; });

  ipcMain.handle('ssh:hosts', async () => {
    const o = await readHosts();
    return { ok: true, data: Object.keys(o).sort().map(k => { const i = k.lastIndexOf(':'); return { host: k.slice(0, i), port: Number(k.slice(i + 1)), fingerprint: String(o[k]) }; }) };
  });

  ipcMain.handle('ssh:forget', async (_e, req) => {
    const host = String((req && req.host) || ''), port = Number(req && req.port);
    if (!HOST_RE.test(host) || !Number.isInteger(port)) return { ok: false, error: 'Unknown server.' };
    const o = await readHosts(), k = hostKey(host, port);
    if (!o[k]) return { ok: true, data: { removed: false } };
    const r = await dialog.showMessageBox(getWin(), {
      type: 'warning', buttons: ['Cancel', 'Forget this server'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Forget saved server identity?',
      message: 'Forget the saved identity of ' + host + (port === 22 ? '' : ' (port ' + port + ')') + '?',
      detail: 'The next connection will ask you to trust the server again. Only do this if you know why its identity changed, for example because the server was reinstalled.'
    });
    if (r.response !== 1) return { ok: false, declined: true, error: 'Nothing was changed.' };
    delete o[k];
    await writeHosts(o);
    return { ok: true, data: { removed: true } };
  });
}

module.exports = { register, fingerprint, explain };
