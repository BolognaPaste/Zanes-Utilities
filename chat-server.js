// Chat server: lets other people reach the chat hub from a web browser, with no extra packages (Node's own http).
//
// It only listens while you have pressed Start on the Test page, and by default only on this PC (127.0.0.1).
// "Let other devices connect" makes it listen on the network so friends can open http://<your-ip>:<port>.
// That is plain HTTP, so it is meant for a home network or a private VPN. For friends anywhere on the internet use
// the internet link (chat-tunnel.js): a tunnel program makes an https:// address that reaches this server, and then
// the server sees the tunnel's host name (setTunnel below) and accepts requests for it.
//
// Live updates use long-polling (the browser asks "anything new?" and the server answers as soon as there is
// something, or after about 25 seconds with nothing), because tunnels and proxies often hold back streamed
// responses (Server-Sent Events) but always pass ordinary requests.
//
//   GET  /                     the browser chat page (chat-web.html), plus /chat-ui.js /chat-web.js /chat.css
//   GET  /api/info             server name and whether a password is needed (no login required)
//   POST /api/join             { name, password } -> { token, me }      or { token } to come back
//   GET  /api/snapshot         channels, members, who you are            (Authorization: Bearer <token>)
//   GET  /api/history?ch=&before=
//   POST /api/send             { ch, text }
//   POST /api/typing           { ch }
//   POST /api/delete           { ch, id }
//   POST /api/connect          -> { sid }   starts a live session (needed before polling)
//   GET  /api/poll?sid=&ack=   -> { events, n }   waits for news; ack = the last n the browser has processed
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { ChatError } = require('./chat-core');

const STATIC = {
  '/': ['chat-web.html', 'text/html; charset=utf-8'],
  '/chat-web.js': ['chat-web.js', 'text/javascript; charset=utf-8'],
  '/chat-ui.js': ['chat-ui.js', 'text/javascript; charset=utf-8'],
  '/chat.css': ['chat.css', 'text/css; charset=utf-8']
};
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
const MAX_BODY = 8 * 1024;
const MAX_CONNS = 150, MAX_PER_USER = 5;
const POLL_MS = 25000;       // how long an empty poll is held
const IDLE_MS = 50000;       // a session nobody has polled for this long is dropped (the person shows as offline)
const QUEUE_MAX = 400;       // events kept for a slow browser before it is told to reload everything

class ChatServer {
  constructor(hub, opts) {
    this.hub = hub;
    this.root = (opts && opts.root) || __dirname;
    this.srv = null;
    this.conns = new Map();       // session id -> { uid, unsub, queue, n, waiter, seen }
    this.reaper = null;
    this.tunnelHost = null;       // e.g. "quiet-river-fox.trycloudflare.com" while the internet link is open
    this.port = 0;
    this.lan = false;
    this.files = {};
  }

  running() { return !!this.srv; }
  status() {
    return { running: this.running(), port: this.port, lan: this.lan, urls: this.running() ? this.urls() : [], connected: this.conns.size };
  }
  urls() {
    const out = ['http://localhost:' + this.port];
    if (this.lan) {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + this.port);
      }
    }
    return out;
  }

  setTunnel(url) {
    try { this.tunnelHost = url ? new URL(url).hostname.toLowerCase() : null; } catch { this.tunnelHost = null; }
  }

  start(port, lan) {
    if (this.srv) return Promise.reject(new Error('The server is already running.'));
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this._handle(req, res));
      srv.headersTimeout = 15000;
      srv.requestTimeout = 0;            // a poll is held open for up to 25 seconds
      srv.on('error', err => {
        if (!this.srv) {
          reject(new Error(err.code === 'EADDRINUSE' ? 'Port ' + port + ' is already in use. Pick another one.'
            : err.code === 'EACCES' ? 'Windows would not let the app use port ' + port + '. Pick another one.' : 'Could not start: ' + err.message));
        }
      });
      srv.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
        this.srv = srv; this.port = port; this.lan = !!lan;
        this.reaper = setInterval(() => this._reap(), 10000);
        if (this.reaper.unref) this.reaper.unref();
        resolve(this.status());
      });
    });
  }
  stop() {
    const srv = this.srv;
    if (!srv) return;
    this.srv = null;
    clearInterval(this.reaper); this.reaper = null;
    for (const sid of [...this.conns.keys()]) this._drop(sid);
    this.tunnelHost = null;
    try { srv.close(); if (srv.closeAllConnections) srv.closeAllConnections(); } catch {}
    this.port = 0;
  }

  /* ---------- request handling ---------- */
  _send(res, code, body, type) {
    res.writeHead(code, { ...HEADERS, 'Content-Type': type || 'application/json; charset=utf-8' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  _fail(res, err) {
    const known = err instanceof ChatError;
    this._send(res, known ? err.code : 500, { error: known ? err.message : 'Something went wrong.' });
  }

  // Blocks requests that did not come from a page served by this server: a Host that is not an IP address, "localhost",
  // this PC's name or the internet link's own address (DNS rebinding), and an Origin that does not match the Host
  // (another website posting to us).
  _allowed(req) {
    const host = String(req.headers.host || '');
    const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
    const tunnel = !!this.tunnelHost && name === this.tunnelHost;
    const ok = tunnel || name === 'localhost' || net.isIP(name) > 0 || name === os.hostname().toLowerCase() || name === os.hostname().toLowerCase() + '.local';
    if (!ok) return false;
    const origin = req.headers.origin;
    return !origin || origin === 'http://' + host || (tunnel && origin === 'https://' + host);
  }
  // The address used to count wrong passwords. Through the tunnel every request comes from this PC, so the tunnel
  // program's "real visitor" header is used, but only while the tunnel is open and the request came from this PC.
  _who(req) {
    const a = req.socket.remoteAddress || '?';
    if (this.tunnelHost && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1')) {
      const v = String(req.headers['cf-connecting-ip'] || '').trim();
      if (net.isIP(v)) return v;
    }
    return a;
  }
  _user(req, url) {
    const m = /^Bearer ([0-9a-f]{16,128})$/.exec(String(req.headers.authorization || ''));
    const u = this.hub.auth(m ? m[1] : '');
    if (!u) throw new ChatError('Not signed in.', 401);
    return u;
  }
  _body(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return reject(new ChatError('Expected JSON.', 415));
      let size = 0; const parts = [];
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) { reject(new ChatError('Request too large.', 413)); req.destroy(); return; }
        parts.push(c);
      });
      req.on('end', () => {
        try { const v = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); resolve(v && typeof v === 'object' ? v : {}); }
        catch { reject(new ChatError('That was not valid JSON.')); }
      });
      req.on('error', () => reject(new ChatError('Request failed.')));
    });
  }
  _file(res, key) {
    const [name, type] = STATIC[key];
    try {
      if (!this.files[name]) this.files[name] = fs.readFileSync(path.join(this.root, name));
      this._send(res, 200, this.files[name], type);
    } catch { this._send(res, 404, 'Not found', 'text/plain; charset=utf-8'); }
  }

  async _handle(req, res) {
    try {
      if (!this._allowed(req)) return this._send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' && STATIC[p]) return this._file(res, p);
      if (!p.startsWith('/api/')) return this._send(res, 404, 'Not found', 'text/plain; charset=utf-8');

      if (req.method === 'GET' && p === '/api/info') return this._send(res, 200, this.hub.info());
      if (req.method === 'GET' && p === '/api/poll') return this._poll(req, res, this._user(req, url), url);
      if (req.method === 'GET' && p === '/api/snapshot') return this._send(res, 200, this.hub.snapshot(this._user(req, url).id));
      if (req.method === 'GET' && p === '/api/history') {
        const u = this._user(req, url);
        const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : undefined;
        return this._send(res, 200, this.hub.history(String(url.searchParams.get('ch')), before));
      }
      if (req.method !== 'POST') return this._send(res, 405, { error: 'Method not allowed.' });

      const b = await this._body(req);
      if (p === '/api/join') return this._send(res, 200, this.hub.join(b, this._who(req)));
      const u = this._user(req, url);
      if (p === '/api/connect') return this._send(res, 200, { sid: this._connect(u) });
      if (p === '/api/send') return this._send(res, 200, { id: this.hub.send(u.id, String(b.ch), b.text) });
      if (p === '/api/typing') { this.hub.typing(u.id, String(b.ch)); return this._send(res, 200, {}); }
      if (p === '/api/delete') { this.hub.remove(u.id, String(b.ch), Number(b.id)); return this._send(res, 200, {}); }
      return this._send(res, 404, { error: 'Unknown request.' });
    } catch (err) {
      if (!res.headersSent) this._fail(res, err);
      else try { res.end(); } catch {}
    }
  }

  /* ---------- live sessions (long-polling) ---------- */
  _connect(user) {
    const mine = [...this.conns.values()].filter(c => c.uid === user.id).length;
    if (this.conns.size >= MAX_CONNS || mine >= MAX_PER_USER) throw new ChatError('Too many open connections.', 429);
    const sid = crypto.randomBytes(16).toString('hex');
    const c = { uid: user.id, queue: [], n: 0, waiter: null, seen: Date.now(), over: false, unsub: null };
    c.unsub = this.hub.subscribe(user.id, ev => {
      if (c.queue.length >= QUEUE_MAX) { c.queue.length = 0; c.over = true; return; }
      c.queue.push({ n: ++c.n, ev });
      this._wake(c);
    });
    this.conns.set(sid, c);
    return sid;
  }
  _drop(sid) {
    const c = this.conns.get(sid);
    if (!c) return;
    this.conns.delete(sid);
    try { c.unsub(); } catch {}
    this._wake(c, true);
  }
  _reap() {
    const now = Date.now();
    for (const [sid, c] of this.conns) if (!c.waiter && now - c.seen > IDLE_MS) this._drop(sid);
  }
  // Answers the poll that is waiting on this session, if any.
  _wake(c, ended) {
    const w = c.waiter;
    if (!w) return;
    c.waiter = null;
    clearTimeout(w.timer);
    if (w.res.writableEnded || w.res.destroyed) return;
    if (ended && !c.queue.length) return this._send(w.res, 410, { error: 'Session ended.' });
    c.seen = Date.now();
    const body = { events: c.queue.map(q => q.ev), n: c.n };
    if (c.over) { body.resync = true; c.over = false; }
    this._send(w.res, 200, body);
    if (c.queue.some(q => q.ev.t === 'kicked')) { this.conns.forEach((x, sid) => { if (x === c) this._drop(sid); }); }
  }
  _poll(req, res, user, url) {
    const sid = String(url.searchParams.get('sid') || '');
    const c = this.conns.get(sid);
    if (!c || c.uid !== user.id) throw new ChatError('Session ended.', 410);
    const ack = Number(url.searchParams.get('ack')) || 0;
    c.queue = c.queue.filter(q => q.n > ack);        // what the browser already has is thrown away
    c.seen = Date.now();
    if (c.waiter) this._wake(c);                      // a newer poll replaces an older one that is still waiting
    if (c.queue.length || c.over) {
      const body = { events: c.queue.map(q => q.ev), n: c.n };
      if (c.over) { body.resync = true; c.over = false; }
      return this._send(res, 200, body);
    }
    const w = { res, timer: setTimeout(() => this._wake(c), POLL_MS) };
    c.waiter = w;
    res.on('close', () => { if (c.waiter === w) { clearTimeout(w.timer); c.waiter = null; c.seen = Date.now(); } });
  }
}

module.exports = { ChatServer };
