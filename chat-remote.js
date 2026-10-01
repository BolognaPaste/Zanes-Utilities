// Join someone else's chat server from inside this app (instead of opening it in a web browser).
//
// It talks to the same server that chat-server.js runs on the host's PC, the same way the browser page (chat-web.js)
// does: sign in with a name (and the server password if there is one), then keep a long-poll going for live events.
// The requests are made here in the main process, so the page never needs to reach other websites itself, and the
// login token stays in this process (the page never sees it).
//
// The address can be what the host copied from their Test page: http://192.168.1.5:3000 for the same network or a VPN,
// or the https://something.trycloudflare.com internet link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// "192.168.1.5:3000", "http://host:3000/" or "https://x.trycloudflare.com/" -> "http://192.168.1.5:3000".
// Only web addresses are accepted, and nothing after the host is kept.
function normalize(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Type the server address first.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/\.trycloudflare\.com(?=[:/]|$)/i.test(s) ? 'https://' : 'http://') + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('That does not look like a server address.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The address must start with http:// or https://.');
  if (u.username || u.password) throw new Error('Leave the user name and password out of the address.');
  if (!u.hostname) throw new Error('That does not look like a server address.');
  return u.origin;
}

class RemoteClient {
  // emit(ev) delivers live events to the app window; stateFile remembers the last address and name (never a password).
  constructor(emit, stateFile) {
    this.emit = emit;
    this.stateFile = stateFile;
    this.idFile = path.join(path.dirname(stateFile), 'identities.json');     // server id -> recover key, kept on this device only
    this.base = '';
    this.token = '';
    this.name = '';
    this.sid = '';
    this.ack = 0;
    this.gen = 0;             // bumped to stop the running live loop
    this.state = 'off';       // off | on
  }

  saved() {
    try { const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); return { address: String(s.address || ''), name: String(s.name || '') }; }
    catch { return { address: '', name: '' }; }
  }
  status() { return Object.assign({ state: this.state, address: this.state === 'on' ? this.base : '' }, this.state === 'on' ? { name: this.name } : this.saved()); }

  _keys() { try { const k = JSON.parse(fs.readFileSync(this.idFile, 'utf8')); return k && typeof k === 'object' ? k : {}; } catch { return {}; } }
  _saveKey(serverId, key) {
    try { const k = this._keys(); k[serverId] = key; fs.mkdirSync(path.dirname(this.idFile), { recursive: true }); fs.writeFileSync(this.idFile, JSON.stringify(k)); } catch {}
  }

  async call(method, p, body, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 20000);
    let res;
    try {
      res = await fetch(this.base + p, {
        method, cache: 'no-store', signal: ctrl.signal, redirect: 'error',
        headers: Object.assign({}, body ? { 'Content-Type': 'application/json' } : {}, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server. Check the address, and that the host has started their server.');
    } finally { clearTimeout(timer); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || 'Request failed (' + res.status + ').'); e.status = res.status; throw e; }
    return data;
  }
  // Used for everything after joining: a 401 means the session is over.
  async authed(method, p, body) {
    if (this.state !== 'on') throw new Error('You are not connected to a server.');
    try { return await this.call(method, p, body); }
    catch (e) { if (e.status === 401) this.end('Your session ended. Join again.'); throw e; }
  }

  // Resolves with { name } (the server's name) once signed in; rejects with a readable message.
  async join(address, name, password) {
    this.leave();
    const base = normalize(address);
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Pick a name to use in the chat.');
    this.base = base; this.token = '';
    let info;
    try {
      info = await this.call('GET', '/api/info');
      if (!info || typeof info.name !== 'string') throw new Error('That address is not a Zane\'s Utilities chat server.');
      if (info.passwordRequired && !password) throw new Error('This server needs a password.');
      // The server's id stays the same when the host restarts, even though the internet link's address changes, so the
      // key saved here for it gets this person their old account back.
      const sid = /^[0-9a-f]{16}$/.test(info.id || '') ? info.id : '';
      const key = sid ? (this._keys()[sid] || crypto.randomBytes(24).toString('hex')) : '';
      const r = await this.call('POST', '/api/join', { name: nm, password: info.passwordRequired ? String(password) : undefined, recover: key || undefined });
      this.token = r.token; this.name = r.me && r.me.name ? r.me.name : nm;
      if (sid) this._saveKey(sid, key);
    } catch (e) { this.base = ''; this.token = ''; throw e; }
    this.state = 'on';
    try { fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); fs.writeFileSync(this.stateFile, JSON.stringify({ address: base, name: this.name })); } catch {}
    this.sid = ''; this.ack = 0;
    this._live(++this.gen);
    return { name: info.name };
  }

  // Live events: ask the server "anything new?" over and over (same protocol as chat-web.js).
  async _connect() { const r = await this.call('POST', '/api/connect', {}); this.sid = r.sid; this.ack = 0; }
  async _live(mine) {
    let fails = 0, offline = false;
    const back = () => { if (offline) { offline = false; this.emit({ t: 'status', online: true }); this.emit({ t: 'resync' }); } };
    while (mine === this.gen) {
      try {
        if (!this.sid) await this._connect();
        if (mine !== this.gen) return;
        const r = await this.call('GET', '/api/poll?sid=' + encodeURIComponent(this.sid) + '&ack=' + this.ack, null, 40000);
        if (mine !== this.gen) return;
        back(); fails = 0;
        this.ack = r.n;
        for (const ev of r.events || []) { this.emit(ev); if (ev.t === 'kicked') { this.end('You were removed from this server.'); return; } }
        if (r.resync) this.emit({ t: 'resync' });
      } catch (e) {
        if (mine !== this.gen) return;
        if (e.status === 401) { this.end('Your session ended. Join again.'); return; }
        if (e.status === 410) {
          try { await this._connect(); if (mine !== this.gen) return; offline = true; back(); continue; }
          catch (e2) { if (e2.status === 401) { this.end('Your session ended. Join again.'); return; } }
        }
        if (!offline) { offline = true; this.emit({ t: 'status', online: false }); }
        await sleep(Math.min(1000 * ++fails, 5000));
      }
    }
  }

  // The server closed our session (removed, password changed, restarted without us): tell the page.
  end(notice) {
    if (this.state !== 'on') return;
    this.gen++; this.state = 'off'; this.token = ''; this.sid = '';
    this.emit({ t: 'ended', notice });
  }
  leave() { this.gen++; this.state = 'off'; this.token = ''; this.sid = ''; }

  snapshot() { return this.authed('GET', '/api/snapshot'); }
  history(ch, before) { return this.authed('GET', '/api/history?ch=' + encodeURIComponent(ch) + (before ? '&before=' + encodeURIComponent(before) : '')); }
  send(ch, text) { return this.authed('POST', '/api/send', { ch, text }); }
  typing(ch) { return this.authed('POST', '/api/typing', { ch }); }
  remove(ch, id) { return this.authed('POST', '/api/delete', { ch, id }); }
}

module.exports = { RemoteClient, normalize };
