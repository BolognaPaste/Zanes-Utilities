// Browser page for people who join your chat server (served by chat-server.js at http://<your-ip>:<port>).
// It signs in, keeps a live connection going (long-polling, so it also works through the internet link and any proxy)
// and hands everything to the shared GUI in chat-ui.js.
// The login token is kept in this browser only, so reloading the page keeps you signed in.
(function () {
  'use strict';
  const app = document.getElementById('app');
  const TOKEN = 'cht-token', NAME = 'cht-name';
  const get = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const put = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
  let token = get(TOKEN), ctl = null, gen = 0, sid = '', ack = 0;
  const listeners = new Set();
  const emit = ev => listeners.forEach(fn => { try { fn(ev); } catch {} });
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function call(method, path, body, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 20000);
    let res;
    try {
      res = await fetch(path, {
      method, cache: 'no-store', signal: ctrl.signal,
      headers: Object.assign({}, body ? { 'Content-Type': 'application/json' } : {}, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'The server took too long to answer.' : 'Could not reach the server.'); }
    finally { clearTimeout(timer); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || 'Request failed (' + res.status + ').'); e.status = res.status; throw e; }
    return data;
  }
  const guard = p => p.catch(e => { if (e.status === 401 && ctl) signedOut('Your session ended. Join again.'); throw e; });
  const api = {
    init: () => guard(call('GET', '/api/snapshot')),
    history: (ch, before) => guard(call('GET', '/api/history?ch=' + encodeURIComponent(ch) + (before ? '&before=' + before : ''))),
    send: (ch, text) => guard(call('POST', '/api/send', { ch, text })),
    typing: ch => guard(call('POST', '/api/typing', { ch })),
    remove: (ch, id) => guard(call('POST', '/api/delete', { ch, id })),
    on: fn => { listeners.add(fn); return () => listeners.delete(fn); }
  };

  // Live events: ask the server "anything new?" over and over. ack tells it which events we already processed, so
  // nothing is lost if a reply gets dropped. If the session was forgotten (server restarted, long network gap) a new one
  // is opened and the GUI reloads everything.
  async function connect() { const r = await call('POST', '/api/connect', {}); sid = r.sid; ack = 0; }
  async function live(mine) {
    let fails = 0, offline = false;
    const back = () => { if (offline) { offline = false; emit({ t: 'status', online: true }); emit({ t: 'resync' }); } };
    while (mine === gen) {
      try {
        if (!sid) await connect();
        if (mine !== gen) return;
        const r = await call('GET', '/api/poll?sid=' + encodeURIComponent(sid) + '&ack=' + ack, null, 40000);
        if (mine !== gen) return;
        back(); fails = 0;
        ack = r.n;
        for (const ev of r.events || []) { emit(ev); if (ev.t === 'kicked') { gen++; return; } }
        if (r.resync) emit({ t: 'resync' });
      } catch (e) {
        if (mine !== gen) return;
        if (e.status === 401) { signedOut('Your session ended. Join again.'); return; }
        if (e.status === 410) {
          try { await connect(); if (mine !== gen) return; offline = true; back(); continue; }
          catch (e2) { if (e2.status === 401) { signedOut('Your session ended. Join again.'); return; } }
        }
        if (!offline) { offline = true; emit({ t: 'status', online: false }); }
        await sleep(Math.min(1000 * ++fails, 5000));
      }
    }
  }

  function stop() { gen++; if (ctl) { ctl.destroy(); ctl = null; } listeners.clear(); }
  function signedOut(notice) { stop(); token = ''; put(TOKEN, ''); showJoin(notice); }

  async function showJoin(notice) {
    app.textContent = '';
    const wrap = h('div', 'cht cht-solo');
    const box = h('div', 'cht-join');
    const title = h('h1', null, 'Join the chat');
    const sub = h('p', 'cht-note', 'Connecting\u2026');
    box.append(title, sub);
    wrap.appendChild(box);
    app.appendChild(wrap);
    let info;
    try { info = await call('GET', '/api/info'); } catch { sub.textContent = 'Could not reach the server.'; sub.className = 'cht-note warn'; return; }
    document.title = info.name;
    title.textContent = info.name;
    sub.textContent = notice || 'Pick a name to join.';
    if (notice) sub.className = 'cht-note warn';

    const KEY = 'cht-key-' + (info.id || '');
    const form = h('form');
    const nameL = h('label', 'cht-f', 'Your name');
    const name = h('input'); name.type = 'text'; name.maxLength = 24; name.autocomplete = 'nickname'; name.value = get(NAME);
    nameL.appendChild(name); form.appendChild(nameL);
    let pw = null;
    if (info.passwordRequired) {
      const l = h('label', 'cht-f', 'Server password');
      pw = h('input'); pw.type = 'password'; pw.autocomplete = 'off';
      l.appendChild(pw); form.appendChild(l);
    }
    const go = h('button', 'cht-btn', 'Join'); go.type = 'submit';
    const err = h('p', 'cht-note warn'); err.setAttribute('role', 'alert');
    form.append(go, err);
    box.appendChild(form);
    name.focus();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      go.disabled = true; err.textContent = '';
      try {
        let key = info.id ? get(KEY) : '';
        if (info.id && !key) { const b = new Uint8Array(24); crypto.getRandomValues(b); key = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
        const r = await call('POST', '/api/join', { name: name.value, password: pw ? pw.value : undefined, recover: key || undefined });
        token = r.token; put(TOKEN, token); put(NAME, r.me.name); if (key) put(KEY, key);
        startChat();
      } catch (ex) { err.textContent = ex.message; go.disabled = false; }
    });
  }

  function startChat() {
    stop();
    app.textContent = '';
    const root = h('div', 'cht-solo');
    app.appendChild(root);
    const mine = ++gen;
    sid = ''; ack = 0;
    live(mine);
    ctl = ChatUI.mount(root, api, { onKicked: () => setTimeout(() => signedOut('You were removed from this server.'), 1500) });
  }

  (async function boot() {
    if (!token) return showJoin();
    try { await call('POST', '/api/join', { token }); startChat(); }
    catch (e) { if (e.status === 401) { token = ''; put(TOKEN, ''); showJoin(); } else showJoin('Could not reach the server.'); }
  })();
})();
