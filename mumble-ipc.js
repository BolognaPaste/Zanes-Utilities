// Voice chat through Mumble (https://www.mumble.info), next to the text chat on the Test page.
//
// Mumble is a separate, free, open-source voice program (a native app, so it cannot be shown inside the page). This
// file does not download or contain it: you provide the Mumble files, the same way you provide cloudflared for the
// chat's internet link (see findBin). With them in place the app can:
//   - run a Mumble server (mumble-server.exe) on this PC, with a port, an optional password and an on-network-only switch
//   - open the Mumble client already pointed at that server
//
// Mumble's voice is its own protocol (TCP + UDP on port 64738 by default). The chat's Cloudflare "internet link" only
// carries web pages, so it cannot carry voice. Friends on your network can join directly; friends elsewhere need a VPN
// such as Tailscale (or a router port forward with a password set).
//
// Only the app window may ask for these things (every request goes through main.js's trusted-sender check), and
// processes are started with an argument list, never through a shell.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const WIN = process.platform === 'win32';
const NAMES = {
  client: WIN ? ['mumble.exe'] : ['mumble'],
  server: WIN ? ['mumble-server.exe', 'murmur.exe'] : ['mumble-server', 'murmurd']
};
const NAME_OK = {
  client: WIN ? /^mumble\.exe$/i : /^mumble$/,
  server: WIN ? /^(mumble-server|murmur)\.exe$/i : /^(mumble-server|murmurd)$/
};
const READY_MS = 10000;
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const looksRight = (kind, f) => typeof f === 'string' && path.isAbsolute(f) && NAME_OK[kind].test(path.basename(f));
// The password goes into the server's settings file between quotes, so keep it to plain printable characters.
const passwordOk = p => typeof p === 'string' && /^[\x20-\x7e]{1,64}$/.test(p) && !/["\\]/.test(p);
const cleanName = n => String(n || '').replace(/[^\w .-]/g, '').trim().slice(0, 24) || 'host';

function register(ipc, getWin, { app, dialog }) {
  const dir = path.join(app.getPath('userData'), 'mumble');
  const cfgFile = path.join(dir, 'mumble.json');
  const iniFile = path.join(dir, 'server.ini');
  // Saved choices. The password is stored here in plain text because Mumble's server settings file needs it that way.
  let cfg = { client: '', server: '', port: 64738, lan: false, password: '' };
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (c && typeof c === 'object') {
      if (looksRight('client', c.client)) cfg.client = c.client;
      if (looksRight('server', c.server)) cfg.server = c.server;
      if (Number.isInteger(c.port) && c.port >= 1024 && c.port <= 65535) cfg.port = c.port;
      cfg.lan = !!c.lan;
      if (passwordOk(c.password)) cfg.password = c.password;
    }
  } catch {}
  const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg)); };

  // Where the Mumble files are looked for: the file you picked, then "mumble" folders next to the app, in its
  // resources and in its data folder (also their "client" / "server" subfolders), then Mumble's normal install folders.
  const unpacked = __dirname.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
  const find = kind => {
    const saved = cfg[kind];
    if (saved && looksRight(kind, saved) && isFile(saved)) return saved;
    const roots = [path.join(unpacked, 'mumble'), path.join(process.resourcesPath || '', 'mumble'), path.join(dir)];
    for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) roots.push(path.join(pf, 'Mumble'));
    for (const r of roots) for (const d of [r, path.join(r, kind)]) for (const n of NAMES[kind]) {
      const f = path.join(d, n);
      if (isFile(f)) return f;
    }
    return '';
  };

  // ---- the server process ----
  let child = null, running = false, runPort = 0, runLan = false, error = '', tail = [];
  const lanUrls = () => {
    if (!running || !runLan) return [];
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push('mumble://' + a.address + ':' + runPort + '/');
    }
    return out;
  };
  const status = () => ({
    client: find('client'), server: find('server'), running, port: running ? runPort : cfg.port,
    lan: running ? runLan : cfg.lan, hasPassword: !!cfg.password, urls: lanUrls(), error
  });

  const ini = (port, lan, password) => {
    const f = p => p.replace(/\\/g, '/');
    return [
      'database=' + f(path.join(dir, 'mumble-server.sqlite')),
      'logfile=' + f(path.join(dir, 'mumble-server.log')),
      'port=' + port,
      lan ? '' : 'host=127.0.0.1',                      // without "host" the server answers on every network card
      password ? 'serverpassword="' + password + '"' : '',
      'users=20',
      'registerName="Zane\'s Utilities"',
      'welcometext="Welcome to the voice chat."'
    ].filter(Boolean).join('\n') + '\n';
  };

  // Resolves once something is accepting connections on the port and our process is still alive (a port that is
  // already taken makes the server quit, so being alive after the connect means it is ours).
  const waitReady = (c, port) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const gone = () => new Error('The Mumble server stopped right away.' + (tail.length ? ' ' + tail[tail.length - 1] : ' Is port ' + port + ' already in use?'));
    const tick = () => {
      if (c._gone) return reject(gone());
      if (Date.now() - t0 > READY_MS) return reject(new Error('The Mumble server did not start in time.'));
      const s = net.connect({ port, host: '127.0.0.1' });
      let over = false;
      const next = fn => { if (over) return; over = true; s.destroy(); fn(); };
      s.setTimeout(1000);
      s.once('connect', () => next(() => setTimeout(() => (c._gone ? reject(gone()) : resolve()), 400)));
      s.once('error', () => next(() => setTimeout(tick, 400)));
      s.once('timeout', () => next(() => setTimeout(tick, 400)));
    };
    setTimeout(tick, 600);
  });

  function stopServer() {
    const c = child;
    child = null; running = false;
    if (c) { c._stopped = true; try { c.kill(); } catch {} }
  }

  async function startServer(port, lan, newPassword) {
    if (child) throw new Error('The Mumble server is already running.');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
    if (newPassword) { if (!passwordOk(newPassword)) throw new Error('The voice password can use letters, numbers and symbols, but not quotes or backslashes (max 64 characters).'); cfg.password = newPassword; }
    const bin = find('server');
    if (!bin) throw new Error('The Mumble server (mumble-server.exe) was not found. Follow the setup steps in the voice section.');
    cfg.port = port; cfg.lan = !!lan;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(iniFile, ini(port, !!lan, cfg.password));
    save();
    error = ''; tail = [];
    const c = spawn(bin, ['-ini', iniFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(bin) });
    child = c;
    const onData = buf => { for (const l of buf.toString('utf8').split(/\r?\n/)) { if (l.trim()) { tail.push(l.trim().slice(0, 200)); if (tail.length > 15) tail.shift(); } } };
    c.stdout.on('data', onData); c.stderr.on('data', onData);
    c.on('error', e => { c._gone = true; if (child === c) { child = null; running = false; } error = 'The Mumble server could not be started: ' + e.message; });
    c.on('exit', code => {
      c._gone = true;
      if (child === c) { child = null; if (running) error = 'The Mumble server stopped (code ' + code + ').'; running = false; }
    });
    try { await waitReady(c, port); }
    catch (e) { stopServer(); error = e.message; throw e; }
    running = true; runPort = port; runLan = !!lan;
  }

  async function openClient(name) {
    const bin = find('client');
    if (!bin) throw new Error('The Mumble program (mumble.exe) was not found. Follow the setup steps in the voice section.');
    // Pointing it at our own server. The password is not put on the command line (other programs can read that);
    // Mumble asks for it once and can remember it.
    const args = running ? ['mumble://' + encodeURIComponent(cleanName(name)) + '@127.0.0.1:' + runPort + '/'] : [];
    const c = spawn(bin, args, { detached: true, stdio: 'ignore', cwd: path.dirname(bin) });
    await new Promise((res, rej) => { c.once('spawn', res); c.once('error', rej); });
    c.unref();
  }

  // Sets the password of Mumble's built-in owner account ("SuperUser"), which can add channels and make other people
  // admins. Mumble only allows this while the server is stopped, by running the server program once with -supw.
  // The password is given to that program as an argument (no shell is involved) and is not saved by this app.
  async function setOwnerPassword(pw) {
    if (running) throw new Error('Stop the voice server first, then set the owner password.');
    if (typeof pw !== 'string' || !/^[\x20-\x7e]{4,64}$/.test(pw)) throw new Error('Use 4 to 64 letters, numbers or symbols for the owner password.');
    const bin = find('server');
    if (!bin) throw new Error('The Mumble server (mumble-server.exe) was not found. Follow the setup steps in the voice section.');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(iniFile, ini(cfg.port, cfg.lan, cfg.password));      // same database the voice server uses
    await new Promise((resolve, reject) => {
      const c = spawn(bin, ['-ini', iniFile, '-supw', pw], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: path.dirname(bin) });
      const lines = [];
      const onData = buf => { for (const l of buf.toString('utf8').split(/\r?\n/)) if (l.trim()) lines.push(l.trim().slice(0, 200)); };
      c.stdout.on('data', onData); c.stderr.on('data', onData);
      const timer = setTimeout(() => { try { c.kill(); } catch {} reject(new Error('Mumble did not answer in time.')); }, 20000);
      c.on('error', e => { clearTimeout(timer); reject(new Error('Could not run the Mumble server: ' + e.message)); });
      c.on('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error('Mumble could not set the password (code ' + code + ').' + (lines.length ? ' ' + lines[lines.length - 1] : '')));
      });
    });
  }

  const h = (channel, fn) => ipc.handle(channel, async (_e, a) => {
    try { return { ok: true, v: await fn(a && typeof a === 'object' ? a : {}) }; }
    catch (err) { return { ok: false, error: (err && err.message) || 'Something went wrong.' }; }
  });

  h('mumble:status', () => status());
  h('mumble:pick', async a => {
    const kind = a.kind === 'server' ? 'server' : 'client';
    const r = await dialog.showOpenDialog(getWin(), {
      title: kind === 'server' ? 'Choose mumble-server.exe' : 'Choose mumble.exe', properties: ['openFile'],
      filters: WIN ? [{ name: 'Mumble', extensions: ['exe'] }] : []
    });
    if (r.canceled || !r.filePaths[0]) return status();
    if (!looksRight(kind, r.filePaths[0])) throw new Error('That is not the right file. Look for ' + NAMES[kind][0] + '.');
    cfg[kind] = r.filePaths[0]; save();
    return status();
  });
  h('mumble:setPassword', a => {
    if (running) throw new Error('Stop the voice server first, then change the password.');
    const p = typeof a.password === 'string' ? a.password : '';
    if (p && !passwordOk(p)) throw new Error('The voice password can use letters, numbers and symbols, but not quotes or backslashes (max 64 characters).');
    cfg.password = p; save();
    return status();
  });
  h('mumble:serverStart', async a => { await startServer(Number(a.port), !!a.lan, typeof a.password === 'string' ? a.password : ''); return status(); });
  h('mumble:serverStop', () => { stopServer(); error = ''; return status(); });
  h('mumble:setOwnerPassword', async a => { await setOwnerPassword(a.password); return status(); });
  h('mumble:open', async a => { await openClient(a.name); return status(); });

  app.on('before-quit', () => stopServer());
}

module.exports = { register };
