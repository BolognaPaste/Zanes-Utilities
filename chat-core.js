// Chat core: the whole chat "server" as plain logic. It knows nothing about Electron or the network.
//
// The app window talks to it through chat-ipc.js, and other people talk to it through chat-server.js (a small
// HTTP server). Both end up calling the same methods below, so every rule (name limits, message length, who may
// delete what, rate limits) lives in this one file.
//
// What is stored (chat/state.json in the app's data folder): the server name, the channels, the last messages of
// each channel, the people who joined (only a SHA-256 hash of their login token, never the token itself) and a
// salted scrypt hash of the join password if one is set. Nothing is sent anywhere by this file.
const fs = require('fs');
const secure = require('./secure-store');
const path = require('path');
const crypto = require('crypto');

const LIMITS = {
  name: 24, text: 2000, channel: 32, topic: 120, serverName: 40,
  history: 500,      // messages kept per channel
  page: 100,         // messages returned per history request
  channels: 30, users: 200,
  burst: 6, burstMs: 6000,           // at most 6 messages per 6 seconds per person
  pwMin: 4, pwMax: 128,
  failMax: 8, failMs: 60000,         // wrong join passwords allowed per address per minute
  allFailMax: 40, allFailMs: 600000  // ...and in total from everyone per 10 minutes (matters once there is a public link)
};
const COLORS = ['#b57bff', '#5ec8ff', '#ff8a80', '#f0b45a', '#6ee7a0', '#ff7ad9', '#9aa5ff', '#e8d36a'];
const HOST = 'host';

class ChatError extends Error {
  constructor(message, code) { super(message); this.code = code || 400; }
}

// Control characters and the "right-to-left override" family are removed so nobody can fake someone else's name.
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const cleanName = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(BAD, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(BAD, '').replace(/\n{4,}/g, '\n\n\n').trim();
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.channel);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = () => crypto.randomBytes(4).toString('hex');
const pick = () => COLORS[crypto.randomInt(COLORS.length)];

function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex') };
}
function checkPw(pw, rec) {
  try {
    const a = Buffer.from(hashPw(String(pw), rec.salt).hash, 'hex'), b = Buffer.from(rec.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

const fresh = () => ({
  v: 1, id: crypto.randomBytes(8).toString('hex'), name: 'My Server', seq: 0,
  host: { name: 'Host', color: COLORS[0] },
  net: { port: 7878, lan: false, tunnel: false },
  pw: null,
  channels: [{ id: 'general', name: 'general', topic: 'Say hello' }, { id: 'off-topic', name: 'off-topic', topic: '' }],
  messages: {}, users: {}
});

class ChatHub {
  constructor(file) {
    this.file = file;
    this.d = this._load();
    this.subs = new Map();        // person id -> Set of listener functions (one per open window / browser tab)
    this.hashes = new Map();      // token hash -> person id
    for (const u of Object.values(this.d.users)) this.hashes.set(u.th, u.id);
    this.rate = new Map();        // person id -> { sent: [timestamps], typed: timestamp }
    this.fails = new Map();       // network address -> [timestamps of wrong passwords]
    this.allFails = [];           // timestamps of every wrong password
    this.timer = null;
  }

  /* ---------- storage ---------- */
  _load() {
    const d = fresh();
    let b;
    try { b = JSON.parse(secure.readTextSync(this.file)); } catch { return d; }
    if (!b || typeof b !== 'object') return d;
    if (typeof b.id === 'string' && /^[0-9a-f]{16}$/.test(b.id)) d.id = b.id;
    if (typeof b.name === 'string') d.name = cleanName(b.name, LIMITS.serverName) || d.name;
    if (Number.isInteger(b.seq) && b.seq >= 0) d.seq = b.seq;
    if (b.host && typeof b.host === 'object') {
      d.host.name = cleanName(b.host.name, LIMITS.name) || d.host.name;
      if (COLORS.includes(b.host.color)) d.host.color = b.host.color;
    }
    if (b.net && Number.isInteger(b.net.port) && b.net.port >= 1024 && b.net.port <= 65535) d.net = { port: b.net.port, lan: !!b.net.lan, tunnel: !!b.net.tunnel };
    const hex = /^[0-9a-f]{32,128}$/;
    if (b.pw && hex.test(b.pw.salt) && hex.test(b.pw.hash)) d.pw = { salt: b.pw.salt, hash: b.pw.hash };
    if (Array.isArray(b.channels)) {
      const ch = [], seen = new Set();
      for (const c of b.channels) {
        if (!c || !/^[a-z0-9-]{1,32}$/.test(c.id) || seen.has(c.id) || ch.length >= LIMITS.channels) continue;
        seen.add(c.id);
        ch.push({ id: c.id, name: slug(c.name) || c.id, topic: cleanName(c.topic, LIMITS.topic) });
      }
      if (ch.length) d.channels = ch;
    }
    if (b.users && typeof b.users === 'object') {
      for (const [id, u] of Object.entries(b.users)) {
        if (!/^[0-9a-f]{8}$/.test(id) || !u || !hex.test(u.th)) continue;
        const name = cleanName(u.name, LIMITS.name);
        if (!name) continue;
        d.users[id] = { id, name, color: COLORS.includes(u.color) ? u.color : COLORS[1], th: u.th, seen: Number(u.seen) || 0 };
        if (typeof u.rh === 'string' && hex.test(u.rh)) d.users[id].rh = u.rh;
      }
    }
    if (b.messages && typeof b.messages === 'object') {
      for (const c of d.channels) {
        const list = Array.isArray(b.messages[c.id]) ? b.messages[c.id] : [];
        d.messages[c.id] = list.filter(m => m && Number.isInteger(m.id) && typeof m.text === 'string' && typeof m.uid === 'string')
          .slice(-LIMITS.history)
          .map(m => ({ id: m.id, ch: c.id, ts: Number(m.ts) || 0, uid: m.uid, name: cleanName(m.name, LIMITS.name) || '?', color: COLORS.includes(m.color) ? m.color : COLORS[1], text: m.text.slice(0, LIMITS.text) }));
        for (const m of d.messages[c.id]) if (m.id > d.seq) d.seq = m.id;
      }
    }
    return d;
  }
  _save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 600);
    if (this.timer.unref) this.timer.unref();
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      secure.writeTextSync(this.file, JSON.stringify(this.d));          // encrypted, written whole then swapped in (secure-store.js)
    } catch { /* a failed save must never take the chat down; the next change tries again */ }
  }

  /* ---------- live connections ---------- */
  // fn(event) is called for every event; events with a "to" only go to that person. Returns the unsubscribe function.
  subscribe(uid, fn) {
    let set = this.subs.get(uid);
    const first = !set || !set.size;
    if (!set) this.subs.set(uid, set = new Set());
    set.add(fn);
    if (first && uid !== HOST) this._emit({ t: 'members', members: this.members() });
    return () => {
      const s = this.subs.get(uid);
      if (!s) return;
      s.delete(fn);
      if (!s.size) { this.subs.delete(uid); if (uid !== HOST) this._emit({ t: 'members', members: this.members() }); }
    };
  }
  connections(uid) { const s = this.subs.get(uid); return s ? s.size : 0; }
  _emit(ev, onlyUid) {
    for (const [uid, set] of this.subs) {
      if (onlyUid && uid !== onlyUid) continue;
      for (const fn of [...set]) { try { fn(ev); } catch { /* one broken listener must not stop the others */ } }
    }
  }

  /* ---------- people ---------- */
  members() {
    const list = [{ id: HOST, name: this.d.host.name, color: this.d.host.color, host: true, online: true }];
    for (const u of Object.values(this.d.users)) list.push({ id: u.id, name: u.name, color: u.color, host: false, online: this.connections(u.id) > 0 });
    return list.sort((a, b) => (b.host - a.host) || (b.online - a.online) || a.name.localeCompare(b.name));
  }
  _nameTaken(name, exceptId) {
    const n = name.toLowerCase();
    if (exceptId !== HOST && this.d.host.name.toLowerCase() === n) return true;
    return Object.values(this.d.users).some(u => u.id !== exceptId && u.name.toLowerCase() === n);
  }
  info() { return { id: this.d.id, name: this.d.name, passwordRequired: !!this.d.pw }; }
  hasPassword() { return !!this.d.pw; }

  // Returns { token, me } for a new person (name + password if one is set) or for someone coming back with their token.
  join(req, address) {
    req = req || {};
    if (typeof req.token === 'string' && req.token) {
      const u = this.auth(req.token);
      if (!u) throw new ChatError('Your session ended. Join again.', 401);
      return { token: req.token, me: this.me(u.id) };
    }
    const key = String(address || '?');
    const now = Date.now();
    const f = (this.fails.get(key) || []).filter(t => now - t < LIMITS.failMs);
    if (f.length >= LIMITS.failMax) throw new ChatError('Too many wrong passwords. Wait a minute and try again.', 429);
    this.allFails = this.allFails.filter(t => now - t < LIMITS.allFailMs);
    if (this.allFails.length >= LIMITS.allFailMax) throw new ChatError('Too many wrong passwords were tried. New people cannot join for a few minutes.', 429);
    if (this.d.pw && !checkPw(req.password == null ? '' : req.password, this.d.pw)) {
      f.push(now); this.fails.set(key, f); this.allFails.push(now);
      throw new ChatError('Wrong password.', 403);
    }
    // A person's own device keeps a secret "recover" key (see chat-remote.js). Showing it again, after the password check
    // above, gives them their old account back with a fresh login token, so their name and old messages stay theirs
    // even when they come in through a new internet link (a new address makes the browser forget its saved login).
    const rec = typeof req.recover === 'string' && /^[0-9a-f]{32,64}$/.test(req.recover) ? req.recover : '';
    if (rec) {
      const rh = sha(rec);
      const old = Object.values(this.d.users).find(x => x.rh === rh);
      if (old) {
        const token = crypto.randomBytes(24).toString('hex');
        this.hashes.delete(old.th);
        old.th = sha(token); old.seen = now;
        this.hashes.set(old.th, old.id);
        this._save();
        this._emit({ t: 'members', members: this.members() });
        return { token, me: this.me(old.id) };
      }
    }
    const name = cleanName(req.name, LIMITS.name);
    if (name.length < 2) throw new ChatError('Pick a name with at least 2 characters.');
    if (this._nameTaken(name)) throw new ChatError('That name is taken. Pick another one.');
    if (Object.keys(this.d.users).length >= LIMITS.users) throw new ChatError('This server is full.', 403);
    let id; do { id = rid(); } while (this.d.users[id] || id === HOST);
    const token = crypto.randomBytes(24).toString('hex');
    const u = { id, name, color: pick(), th: sha(token), seen: now };
    if (rec) u.rh = sha(rec);
    this.d.users[id] = u;
    this.hashes.set(u.th, id);
    this._save();
    this._emit({ t: 'members', members: this.members() });
    return { token, me: this.me(id) };
  }
  auth(token) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
    const id = this.hashes.get(sha(token));
    return id ? this.d.users[id] || null : null;
  }
  me(uid) {
    if (uid === HOST) return { id: HOST, name: this.d.host.name, color: this.d.host.color, host: true };
    const u = this.d.users[uid];
    if (!u) throw new ChatError('Not signed in.', 401);
    return { id: u.id, name: u.name, color: u.color, host: false };
  }
  snapshot(uid) {
    return { server: { name: this.d.name }, me: this.me(uid), channels: this.d.channels.map(c => ({ ...c })), members: this.members() };
  }
  kick(uid) {
    const u = this.d.users[uid];
    if (!u) throw new ChatError('That person is not on the server.', 404);
    this._emit({ t: 'kicked' }, uid);
    this.subs.delete(uid);
    this.hashes.delete(u.th);
    delete this.d.users[uid];
    this.rate.delete(uid);
    this._save();
    this._emit({ t: 'members', members: this.members() });
  }

  /* ---------- messages ---------- */
  _channel(id) {
    const c = this.d.channels.find(x => x.id === id);
    if (!c) throw new ChatError('That channel does not exist.', 404);
    return c;
  }
  history(chId, before, limit) {
    this._channel(chId);
    const all = this.d.messages[chId] || [];
    const b = Number.isInteger(before) ? before : Infinity;
    const n = Math.min(Math.max(Number(limit) || LIMITS.page, 1), LIMITS.page);
    const older = all.filter(m => m.id < b);
    return { messages: older.slice(-n).map(m => ({ ...m })), more: older.length > n };
  }
  send(uid, chId, text) {
    const me = this.me(uid);
    this._channel(chId);
    text = cleanText(text);
    if (!text) throw new ChatError('Type a message first.');
    if (text.length > LIMITS.text) throw new ChatError('That message is too long (' + LIMITS.text + ' characters at most).');
    const now = Date.now();
    const r = this.rate.get(uid) || { sent: [], typed: 0 };
    r.sent = r.sent.filter(t => now - t < LIMITS.burstMs);
    if (uid !== HOST && r.sent.length >= LIMITS.burst) throw new ChatError('Slow down a little.', 429);
    r.sent.push(now); this.rate.set(uid, r);
    const m = { id: ++this.d.seq, ch: chId, ts: now, uid, name: me.name, color: me.color, text };
    const list = this.d.messages[chId] || (this.d.messages[chId] = []);
    list.push(m);
    if (list.length > LIMITS.history) list.splice(0, list.length - LIMITS.history);
    this._save();
    this._emit({ t: 'message', msg: { ...m } });
    return m.id;
  }
  typing(uid, chId) {
    const me = this.me(uid);
    this._channel(chId);
    const r = this.rate.get(uid) || { sent: [], typed: 0 };
    const now = Date.now();
    if (now - r.typed < 2000) return;
    r.typed = now; this.rate.set(uid, r);
    this._emit({ t: 'typing', ch: chId, uid, name: me.name });
  }
  remove(uid, chId, msgId) {
    this.me(uid);
    this._channel(chId);
    const list = this.d.messages[chId] || [];
    const i = list.findIndex(m => m.id === msgId);
    if (i < 0) throw new ChatError('That message is already gone.', 404);
    if (uid !== HOST && list[i].uid !== uid) throw new ChatError('You can only delete your own messages.', 403);
    list.splice(i, 1);
    this._save();
    this._emit({ t: 'delete', ch: chId, id: msgId });
  }

  /* ---------- host-only settings (called only from chat-ipc.js, never from the network) ---------- */
  _channelsChanged() { this._save(); this._emit({ t: 'channels', channels: this.d.channels.map(c => ({ ...c })) }); }
  addChannel(name, topic) {
    if (this.d.channels.length >= LIMITS.channels) throw new ChatError('That is the most channels allowed (' + LIMITS.channels + ').');
    const s = slug(name);
    if (!s) throw new ChatError('Channel names can use letters, numbers and dashes.');
    if (this.d.channels.some(c => c.name === s)) throw new ChatError('There is already a channel called #' + s + '.');
    let id; do { id = rid(); } while (this.d.channels.some(c => c.id === id));
    this.d.channels.push({ id, name: s, topic: cleanName(topic, LIMITS.topic) });
    this._channelsChanged();
    return id;
  }
  editChannel(id, patch) {
    const c = this._channel(id);
    patch = patch || {};
    if (patch.name != null) {
      const s = slug(patch.name);
      if (!s) throw new ChatError('Channel names can use letters, numbers and dashes.');
      if (this.d.channels.some(x => x.id !== id && x.name === s)) throw new ChatError('There is already a channel called #' + s + '.');
      c.name = s;
    }
    if (patch.topic != null) c.topic = cleanName(patch.topic, LIMITS.topic);
    this._channelsChanged();
  }
  deleteChannel(id) {
    this._channel(id);
    if (this.d.channels.length <= 1) throw new ChatError('The server needs at least one channel.');
    this.d.channels = this.d.channels.filter(c => c.id !== id);
    delete this.d.messages[id];
    this._channelsChanged();
  }
  setServerName(name) {
    const n = cleanName(name, LIMITS.serverName);
    if (!n) throw new ChatError('The server needs a name.');
    this.d.name = n; this._save();
    this._emit({ t: 'server', name: n });
  }
  setHostName(name) {
    const n = cleanName(name, LIMITS.name);
    if (n.length < 2) throw new ChatError('Pick a name with at least 2 characters.');
    if (this._nameTaken(n, HOST)) throw new ChatError('Someone on the server already uses that name.');
    this.d.host.name = n; this._save();
    this._emit({ t: 'members', members: this.members() });
  }
  setPassword(pw) {
    pw = pw == null ? '' : String(pw);
    if (!pw) { this.d.pw = null; this._save(); return; }
    if (pw.length < LIMITS.pwMin || pw.length > LIMITS.pwMax) throw new ChatError('The password needs ' + LIMITS.pwMin + ' to ' + LIMITS.pwMax + ' characters.');
    this.d.pw = hashPw(pw);
    this._save();
  }
  setNet(port, lan, tunnel) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ChatError('The port must be a number from 1024 to 65535.');
    this.d.net = { port, lan: !!lan, tunnel: !!tunnel }; this._save();
  }
  get net() { return { ...this.d.net }; }
  get serverName() { return this.d.name; }
  get hostName() { return this.d.host.name; }
}

module.exports = { ChatHub, ChatError, LIMITS, HOST };
