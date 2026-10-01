// SSH terminal page (Privacy & security). Talks to ssh-ipc.js and ssh-sftp.js through window.sshTerm (see preload.js)
// and draws the terminal with xterm.js. The Files panel (upload / download) is the last big section of this file. Uses $, esc and toast from app.js.
// Saved connections keep the host, port, user name and key file path. Passwords and passphrases are never stored.
(function () {
  'use strict';
  const api = window.sshTerm;
  const el = id => document.querySelector('#ssh-' + id);
  const na = el('na'), dep = el('dep'), tabs = el('tabs'), stage = el('stage'), bar = el('bar'), meta = el('meta'), panel = el('new'), notabs = el('notabs'), newB = el('newb'), dot = el('dot'), stat = el('st');
  const host = el('host-in'), port = el('port'), user = el('user'), auth = el('auth'), pass = el('pass'), pwW = el('pw-w'), keyW = el('key-w');
  const keyP = el('keyp'), keyB = el('keyb'), pp = el('pp'), save = el('save'), go = el('go'), msg = el('msg');
  const saved = el('saved'), pbox = el('prompt'), hostsD = el('hosts'), hostsL = el('hostsl');
  const bFont = { dn: el('fdn'), up: el('fup') }, bClear = el('clear'), bEnd = el('end');
  if (!panel) return;
  const fe = id => document.querySelector('#ssh-f-' + id);
  const fpan = el('fp'), bFiles = el('files');
  const F = { up: fe('up'), ref: fe('ref'), path: fe('path'), put: fe('put'), putd: fe('putd'), get: fe('get'), mk: fe('mk'), ren: fe('ren'), del: fe('del'),
    q: fe('q'), ql: fe('ql'), qi: fe('qi'), qok: fe('qok'), qno: fe('qno'), prog: fe('prog'), pt: fe('pt'), pb: fe('pb'), pf: fe('pf'), x: fe('x'),
    all: fe('all'), list: fe('list'), msg: fe('msg') };

  const PK = 'gca-ssh-profiles', FK = 'gca-ssh-font';
  const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const note = (t, bad) => { msg.textContent = t || ''; msg.className = bad ? 'err' : 'fx'; };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const clip = n => Math.min(24, Math.max(9, n));

  const haveTerm = typeof window.Terminal === 'function' && window.FitAddon && typeof window.FitAddon.FitAddon === 'function';
  if (!api || !api.connect) {
    na.hidden = false;
    [host, port, user, auth, pass, keyB, pp, save, go].forEach(x => { x.disabled = true; });
    return;
  }
  if (!haveTerm) {
    dep.hidden = false;
    dep.textContent = 'The terminal component is missing. In the app folder, run "npm install", then start the app again.';
    go.disabled = true;
  }
  api.state().then(r => {
    if (r && r.ok && !r.data.available) { dep.hidden = false; dep.textContent = r.data.error; go.disabled = true; }
  }).catch(() => {});
  api.reset().catch(() => {});          // a freshly loaded page has no terminals, so nothing may stay open behind it

  /* ---------- state ---------- */
  const S = new Map();                  // id -> session
  let active = 'new', font = clip(+read(FK) || 14), keyPath = '', busy = false, profiles = [];

  const THEME = { background: '#0a0710', foreground: '#ece6f5', cursor: '#b57bff', cursorAccent: '#0a0710', selectionBackground: '#4b2f7a' };

  function fitNow(s) {
    if (!s || !s.box.offsetWidth || !s.box.offsetHeight) return;
    try { s.fit.fit(); } catch {}
  }
  let raf = 0;
  const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitNow(S.get(active))); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(refit).observe(stage);
  window.addEventListener('resize', refit);

  /* ---------- tabs and views ---------- */
  function renderTabs() {
    let h = '';
    for (const s of S.values()) {
      h += '<div class="sst-i"' + (active === s.id ? ' data-on="1"' : '') + '><button type="button" class="sst-t" role="tab" aria-selected="' + (active === s.id) + '" data-t="' + s.id + '">' +
        esc(s.label) + (s.closed ? ' (closed)' : '') + '</button><button type="button" class="sst-x" data-x="' + s.id + '" aria-label="Close ' + esc(s.label) + '" title="Close this tab">\u00d7</button></div>';
    }
    tabs.innerHTML = h;
    notabs.hidden = !!S.size;
  }

  function view(id) {
    if (id !== 'new' && !S.has(id)) id = S.size ? [...S.keys()].pop() : 'new';
    active = id;
    const s = S.get(id);
    panel.hidden = id !== 'new';
    stage.hidden = bar.hidden = !s;
    for (const x of S.values()) x.box.hidden = x !== s;
    renderTabs();
    newB.dataset.on = id === 'new' ? '1' : '';
    dot.className = 'sx-dot' + (s && !s.closed ? ' on' : '');
    stat.textContent = !s ? 'Not connected' : s.closed ? 'Disconnected' : 'Connected \u00b7 ' + s.label;
    if (s) {
      meta.textContent = s.closed ? s.label + ' \u00b7 not connected' : s.label + (s.fp ? ' \u00b7 ' + (s.keyType ? s.keyType + ' ' : '') + s.fp : '');
      meta.title = s.fp || '';
      bEnd.textContent = s.closed ? 'Reconnect\u2026' : 'Disconnect';
      bEnd.dataset.mode = s.closed ? 'again' : 'end';
      fitNow(s);
      if (!s.closed) s.term.focus();
    }
    fpRender();
  }

  function makeSession(id, label) {
    const box = document.createElement('div');
    box.className = 'ssk';
    stage.appendChild(box);
    const term = new window.Terminal({
      cursorBlink: true, fontSize: font, scrollback: 5000, allowProposedApi: false,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace', theme: THEME
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(box);
    const s = { id, label, box, term, fit, fp: '', keyType: '', closed: false, ready: false, f: newF() };
    // Ctrl+C copies when text is selected (otherwise it goes to the program). Ctrl+V and Ctrl+Shift+V paste.
    term.attachCustomKeyEventHandler(ev => {
      if (ev.type !== 'keydown' || !ev.ctrlKey) return true;
      const k = String(ev.key).toLowerCase();
      if (k === 'c' && (ev.shiftKey || term.hasSelection())) {
        const t = term.getSelection();
        if (t) { try { navigator.clipboard.writeText(t).then(() => toast('Copied')).catch(() => {}); } catch {} }
        return false;
      }
      if (k === 'v') return false;      // lets the browser paste into the terminal
      return true;
    });
    term.onData(d => { if (s.ready && !s.closed) api.input(id, d).catch(() => {}); });
    term.onResize(({ cols, rows }) => { if (s.ready && !s.closed) api.resize(id, cols, rows).catch(() => {}); });
    S.set(id, s);
    return s;
  }

  function dispose(s) {
    try { s.term.dispose(); } catch {}
    s.box.remove();
    S.delete(s.id);
  }

  function ended(s, why) {
    if (s.closed) return;
    s.closed = true;
    s.f.x = null; s.f.busy = false; s.f.q = null; s.f.msg = ''; s.f.bad = false;   // the panel then says the connection is closed
    s.term.write('\r\n\x1b[33m[' + (why || 'The session ended.') + ']\x1b[0m\r\n');
    if (active === s.id) view(s.id); else renderTabs();
  }

  /* ---------- saved connections ---------- */
  function loadProfiles() {
    try { const a = JSON.parse(read(PK)); profiles = Array.isArray(a) ? a.filter(p => p && typeof p.host === 'string' && typeof p.user === 'string').slice(0, 30) : []; } catch { profiles = []; }
  }
  const storeProfiles = () => write(PK, JSON.stringify(profiles));
  function renderSaved() {
    saved.innerHTML = profiles.length
      ? profiles.map((p, i) =>
        '<div class="sx-p"><span><b>' + esc(p.user + '@' + p.host) + '</b><small>Port ' + esc(p.port || 22) + ' \u00b7 ' + (p.auth === 'key' ? 'Key file' : 'Password') + '</small></span>' +
        '<button type="button" data-use="' + i + '" title="Fill the form with this connection">Use</button><button type="button" data-del="' + i + '" aria-label="Remove ' + esc(p.user + '@' + p.host) + '" title="Remove">\u00d7</button></div>').join('')
      : '<p class="sx-none">Nothing saved yet</p>';
  }
  function fill(p) {
    if (active !== 'new') view('new');
    host.value = p.host || ''; port.value = String(p.port || 22); user.value = p.user || '';
    auth.value = p.auth === 'key' ? 'key' : 'password';
    keyPath = p.keyPath || '';
    sync();
    pass.value = ''; pp.value = '';
    (auth.value === 'key' ? (keyPath ? pp : keyB) : pass).focus();
  }
  saved.addEventListener('click', e => {
    const u = e.target.closest('[data-use]'), d = e.target.closest('[data-del]');
    if (u) { const p = profiles[+u.dataset.use]; if (p) fill(p); }
    else if (d) { profiles.splice(+d.dataset.del, 1); storeProfiles(); renderSaved(); }
  });

  /* ---------- the form ---------- */
  function sync() {
    const key = auth.value === 'key';
    pwW.hidden = key; keyW.hidden = !key;
    keyP.textContent = keyPath || 'No key file chosen';
    keyP.className = keyPath ? '' : 'fx';
    go.disabled = busy || !haveTerm || !!dep.textContent && !dep.hidden;
  }
  auth.addEventListener('change', sync);
  keyB.addEventListener('click', async () => {
    let r;
    try { r = await api.pickKey(); } catch { r = null; }
    if (r && r.ok && r.data.path) { keyPath = r.data.path; sync(); pp.focus(); }
  });

  async function connect() {
    if (busy) return;
    const h = host.value.trim(), u = user.value.trim(), pt = port.value.trim() || '22';
    if (!h) { note('Enter the host name or IP address.', true); host.focus(); return; }
    if (!/^\d+$/.test(pt) || +pt < 1 || +pt > 65535) { note('The port must be a number from 1 to 65535.', true); port.focus(); return; }
    if (!u) { note('Enter your user name.', true); user.focus(); return; }
    if (auth.value === 'password' && !pass.value) { note('Enter your password.', true); pass.focus(); return; }
    if (auth.value === 'key' && !keyPath) { note('Choose your private key file.', true); return; }

    busy = true; sync(); note('Connecting to ' + h + '\u2026');
    const id = rid(), label = u + '@' + h + (pt === '22' ? '' : ':' + pt);
    const s = makeSession(id, label);
    view(id);                                // shown now so the terminal has a real size to report to the server
    s.term.write('Connecting to ' + h + '\u2026\r\n');
    let r;
    try {
      r = await api.connect({
        id, host: h, port: +pt, user: u, auth: auth.value, password: pass.value,
        keyPath: auth.value === 'key' ? keyPath : '', passphrase: pp.value, cols: s.term.cols, rows: s.term.rows
      });
    } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    pass.value = ''; pp.value = '';          // gone from the page as soon as the server has had it
    busy = false;
    hidePrompt(id);
    if (!r || !r.ok) {
      dispose(s);
      view('new');
      note((r && r.error) || 'The connection failed.', true);
      if (r && r.hostChanged) { hostsD.open = true; loadHosts(); }
      sync();
      return;
    }
    s.ready = true; s.fp = r.data.fingerprint || ''; s.keyType = r.data.keyType || '';
    note('');
    if (save.checked) {
      const p = { host: h, port: +pt, user: u, auth: auth.value, keyPath: auth.value === 'key' ? keyPath : '' };
      profiles = profiles.filter(x => !(x.host === p.host && x.port === p.port && x.user === p.user));
      profiles.unshift(p); profiles = profiles.slice(0, 30);
      storeProfiles(); renderSaved();
    }
    sync();
    api.resize(id, s.term.cols, s.term.rows).catch(() => {});
    view(id);
  }
  go.addEventListener('click', connect);
  [host, port, user, pass, pp].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); connect(); } }));

  /* ---------- tabs, toolbar ---------- */
  newB.addEventListener('click', () => { view('new'); host.focus(); });
  tabs.addEventListener('click', e => {
    const x = e.target.closest('[data-x]'), t = e.target.closest('[data-t]');
    if (x) {
      const s = S.get(x.dataset.x);
      if (!s) return;
      if (!s.closed) api.close(s.id).catch(() => {});
      hidePrompt(s.id);
      dispose(s);
      view(active === s.id ? (S.size ? [...S.keys()].pop() : 'new') : active);
    } else if (t) view(t.dataset.t);
  });
  bEnd.addEventListener('click', () => {
    const s = S.get(active);
    if (!s) return;
    if (s.closed) {
      const p = profiles.find(x => x.user + '@' + x.host + (x.port === 22 ? '' : ':' + x.port) === s.label);
      view('new');
      if (p) fill(p); else { const m = /^(.*)@(.*?)(?::(\d+))?$/.exec(s.label); if (m) fill({ user: m[1], host: m[2], port: m[3] || 22 }); }
    } else api.close(s.id).catch(() => {});
  });
  const setFont = n => {
    font = clip(n); write(FK, String(font));
    for (const s of S.values()) { s.term.options.fontSize = font; }
    fitNow(S.get(active));
  };
  bFont.dn.addEventListener('click', () => setFont(font - 1));
  bFont.up.addEventListener('click', () => setFont(font + 1));
  bClear.addEventListener('click', () => { const s = S.get(active); if (s) { s.term.clear(); if (!s.closed) s.term.focus(); } });

  /* ---------- questions from the server (2-step codes, repeated password) ---------- */
  const queue = [];
  function showPrompt() {
    const q = queue[0];
    if (!q) { pbox.hidden = true; pbox.innerHTML = ''; return; }
    pbox.hidden = false;
    pbox.innerHTML = '<div class="empty"><b>' + esc(q.name || 'The server is asking for more') + '</b>' +
      (q.instructions ? '<span class="fx">' + esc(q.instructions) + '</span>' : '') +
      q.prompts.map((p, i) => '<label class="sel">' + esc(p.prompt || 'Answer') + '<input type="' + (p.echo ? 'text' : 'password') + '" data-a="' + i + '" autocomplete="off" spellcheck="false"></label>').join('') +
      '<div class="bar"><button type="button" data-ok="1">Send</button><button type="button" class="alt" data-no="1">Cancel</button></div></div>';
    const first = pbox.querySelector('input');
    if (first) first.focus();
  }
  function answer(ok) {
    const q = queue.shift();
    if (!q) return;
    const a = ok ? [...pbox.querySelectorAll('input[data-a]')].map(i => i.value) : [];
    pbox.innerHTML = '';
    api.answer(q.pid, a).catch(() => {});
    showPrompt();
  }
  function hidePrompt(id) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id === id) queue.splice(i, 1);
    showPrompt();
  }
  pbox.addEventListener('click', e => { if (e.target.closest('[data-ok]')) answer(true); else if (e.target.closest('[data-no]')) answer(false); });
  pbox.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input')) { e.preventDefault(); answer(true); } });

  /* ---------- events from the main process ---------- */
  api.onEvent(m => {
    const s = m && S.get(m.id);
    if (!s) return;
    if (m.t === 'data') s.term.write(m.d instanceof Uint8Array ? m.d : new Uint8Array(m.d));
    else if (m.t === 'closed') ended(s, m.m);
    else if (m.t === 'xfer') { if (m.state === 'run') { s.f.x = { op: m.op, phase: m.phase, file: m.file, i: m.i, n: m.n, done: m.done, total: m.total }; if (active === s.id) fpProg(s); } }
    else if (m.t === 'prompt') { queue.push({ id: m.id, pid: m.pid, name: m.name, instructions: m.instructions, prompts: m.prompts || [] }); if (queue.length === 1) showPrompt(); }
  });

  /* ---------- servers this app trusts ---------- */
  async function loadHosts() {
    let r;
    try { r = await api.hosts(); } catch { r = null; }
    const list = r && r.ok ? r.data : [];
    hostsL.innerHTML = list.length
      ? list.map((x, i) => '<div class="g"><span><b>' + esc(x.host) + (x.port === 22 ? '' : ':' + esc(x.port)) + '</b><small>' + esc(x.fingerprint) + '</small></span>' +
        '<button type="button" class="alt" data-f="' + i + '">Forget</button></div>').join('')
      : '<p class="fx">No servers saved yet. A server is saved the first time you choose to trust it.</p>';
    hostsL._list = list;
  }
  hostsD.addEventListener('toggle', () => { if (hostsD.open) loadHosts(); });
  hostsL.addEventListener('click', async e => {
    const b = e.target.closest('[data-f]');
    const x = b && hostsL._list && hostsL._list[+b.dataset.f];
    if (!x) return;
    let r;
    try { r = await api.forget(x.host, x.port); } catch { r = null; }
    if (r && r.ok) loadHosts();
  });

  /* ---------- files on the server (SFTP) ---------- */
  // Each connection keeps its own folder, ticked items and transfer state in s.f. Paths on this PC never reach the
  // page: uploads and downloads open native dialogs in the main process.
  function newF() { return { path: '', entries: [], trunc: false, sel: new Set(), tried: false, loading: false, busy: false, tok: 0, x: null, q: null, msg: '', bad: false }; }
  let filesOn = false, qOwner = '';
  if (!api.ls) { bFiles.hidden = true; }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < 3);
    return (n >= 100 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i];
  }
  const isDir = e => e.kind === 'dir' || (e.kind === 'link' && e.target === 'dir');
  const joinP = (a, b) => (a === '/' ? '' : a) + '/' + b;
  const parentP = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
  const when = t => { if (!t) return ''; try { return new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };
  const alive = s => !!s && s.ready && !s.closed;
  const idle = s => alive(s) && !s.f.x && !s.f.busy;

  function setMsg(s, text, bad) {
    s.f.msg = text || ''; s.f.bad = !!bad;
    if (s.id === active) { F.msg.textContent = s.closed && !s.f.msg ? 'This connection is closed. Reconnect to use the files again.' : s.f.msg; F.msg.className = 'sf-msg' + (s.f.bad ? ' err' : ''); }
  }

  function rowHtml(e, i, on) {
    const d = isDir(e), icon = d ? '\u{1F4C1}' : e.kind === 'link' ? '\u{1F517}' : '\u{1F4C4}';
    const name = d ? '<button type="button" class="sf-o" data-o="' + i + '" title="Open this folder">' + esc(e.name) + '</button>' : '<span title="' + esc(e.name) + '">' + esc(e.name) + (e.kind === 'link' && e.target === 'broken' ? ' (broken shortcut)' : '') + '</span>';
    return '<div class="sf-r" data-i="' + i + '"' + (on ? ' data-on="1"' : '') + '><input type="checkbox" data-c="' + i + '"' + (on ? ' checked' : '') + ' aria-label="Tick ' + esc(e.name) + '">' +
      '<span class="sf-n"><span aria-hidden="true">' + icon + '</span>' + name + '</span><span class="sf-s">' + (d || e.kind === 'other' ? '' : bytes(e.size)) + '</span><span class="sf-m">' + esc(when(e.mtime)) + '</span></div>';
  }
  function fpList(s) {
    const f = s.f;
    F.list.innerHTML = f.entries.length ? f.entries.map((e, i) => rowHtml(e, i, f.sel.has(e.name))).join('')
      : '<p class="sf-none">' + (!f.tried || f.loading ? 'Loading\u2026' : !alive(s) ? 'Not connected.' : f.path ? 'This folder is empty.' : 'The file list could not be loaded. See the message below.') + '</p>';
    F.all.checked = f.entries.length > 0 && f.sel.size === f.entries.length;
  }
  function fpButtons(s) {
    const f = s.f, live = alive(s), ok = idle(s), n = f.sel.size;
    F.up.disabled = !live || !f.path || f.path === '/';
    F.ref.disabled = !live || f.loading;
    F.path.disabled = !live;
    F.put.disabled = F.putd.disabled = F.mk.disabled = !ok || !f.path;
    F.get.disabled = !ok || n < 1;
    F.ren.disabled = !ok || n !== 1;
    F.del.disabled = !ok || n < 1;
    F.all.disabled = !f.entries.length;
  }
  function fpProg(s) {
    const x = s.f.x;
    F.prog.hidden = !x;
    if (!x) return;
    const down = x.op === 'download', scan = x.phase === 'scan';
    F.pb.dataset.ind = scan ? '1' : '';
    F.pf.style.width = scan || !x.total ? (scan ? '' : '0%') : Math.min(100, x.done / x.total * 100).toFixed(1) + '%';
    F.pt.textContent = scan ? 'Preparing to ' + (down ? 'download' : 'upload') + '\u2026'
      : (down ? 'Downloading ' : 'Uploading ') + (x.file || '') + '  (' + x.i + ' of ' + x.n + ')  \u00b7  ' + bytes(x.done) + ' of ' + bytes(x.total);
  }
  function fpRender() {
    const s = S.get(active);
    fpan.hidden = !(filesOn && s);
    bFiles.dataset.on = filesOn ? '1' : '';
    bFiles.setAttribute('aria-pressed', String(filesOn));
    if (!s || !filesOn) return;
    if (qOwner !== s.id) { F.q.hidden = true; const o = S.get(qOwner); if (o) o.f.q = null; qOwner = ''; }
    F.q.hidden = !s.f.q;
    if (document.activeElement !== F.path) F.path.value = s.f.path;
    fpList(s); fpButtons(s); fpProg(s);
    setMsg(s, s.f.msg, s.f.bad);
    if (alive(s) && !s.f.tried) fpLoad(s, '');
  }

  // after = message to show once the folder has loaded (for example "3 items deleted").
  async function fpLoad(s, dir, after, bad) {
    const f = s.f, tok = ++f.tok;
    f.tried = true; f.loading = true;
    if (s.id === active) { fpButtons(s); if (!f.entries.length) fpList(s); }
    let r;
    try { r = await api.ls(s.id, dir); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (tok !== f.tok || !S.has(s.id)) return;
    f.loading = false;
    if (r && r.ok) {
      f.path = r.data.path; f.entries = r.data.entries; f.trunc = !!r.data.truncated; f.sel = new Set();
      f.msg = after || (f.trunc ? 'This folder is large. Only the first 5000 items are shown.' : ''); f.bad = !!bad;
    } else { f.msg = (r && r.error) || 'The folder could not be opened.'; f.bad = true; }
    if (s.id === active) { F.path.value = f.path; fpRender(); }
  }

  function toggleRow(s, i, on) {
    const e = s.f.entries[i];
    if (!e) return;
    if (on) s.f.sel.add(e.name); else s.f.sel.delete(e.name);
    const row = F.list.querySelector('[data-i="' + i + '"]');
    if (row) { row.dataset.on = on ? '1' : ''; const c = row.querySelector('input'); if (c) c.checked = on; }
    F.all.checked = s.f.entries.length > 0 && s.f.sel.size === s.f.entries.length;
    fpButtons(s);
  }
  F.list.addEventListener('click', e => {
    const s = S.get(active), o = e.target.closest('[data-o]');
    if (!s) return;
    if (o) { const en = s.f.entries[+o.dataset.o]; if (en && idle(s)) fpLoad(s, joinP(s.f.path, en.name)); return; }
    if (e.target.matches('input')) return;                      // the checkbox reports through "change"
    const r = e.target.closest('[data-i]');
    if (r) toggleRow(s, +r.dataset.i, !r.dataset.on);
  });
  F.list.addEventListener('change', e => { const s = S.get(active), c = e.target.closest('[data-c]'); if (s && c) toggleRow(s, +c.dataset.c, c.checked); });
  F.all.addEventListener('change', () => {
    const s = S.get(active);
    if (!s) return;
    s.f.sel = F.all.checked ? new Set(s.f.entries.map(e => e.name)) : new Set();
    fpList(s); fpButtons(s);
  });

  bFiles.addEventListener('click', () => { filesOn = !filesOn; fpRender(); });
  F.up.addEventListener('click', () => { const s = S.get(active); if (s && alive(s)) fpLoad(s, parentP(s.f.path)); });
  F.ref.addEventListener('click', () => { const s = S.get(active); if (s && alive(s)) fpLoad(s, s.f.path); });
  F.path.addEventListener('keydown', e => {
    const s = S.get(active);
    if (!s) return;
    if (e.key === 'Enter') { e.preventDefault(); const v = F.path.value.trim(); if (v) fpLoad(s, v); }
    else if (e.key === 'Escape') { F.path.value = s.f.path; F.path.blur(); }
  });

  /* name box for "New folder" and "Rename" (the page cannot use window.prompt) */
  function askName(mode) {
    const s = S.get(active);
    if (!s || !idle(s)) return;
    let initial = '', from = '';
    if (mode === 'ren') { from = [...s.f.sel][0] || ''; initial = from; }
    s.f.q = { mode, from }; qOwner = s.id;
    F.ql.textContent = mode === 'mk' ? 'New folder name' : 'New name for "' + from + '"';
    F.q.hidden = false; F.qi.value = initial; F.qi.focus(); F.qi.select();
  }
  function closeName() { const s = S.get(qOwner); if (s) s.f.q = null; qOwner = ''; F.q.hidden = true; }
  async function submitName() {
    const s = S.get(qOwner), q = s && s.f.q, name = F.qi.value.trim();
    if (!s || !q) return closeName();
    if (!name) { F.qi.focus(); return; }
    if (/[\/\u0000]/.test(name) || name === '.' || name === '..') { setMsg(s, 'A name cannot contain a slash.', true); F.qi.focus(); return; }
    closeName();
    s.f.busy = true; setMsg(s, ''); fpRender();
    let r;
    try { r = q.mode === 'mk' ? await api.mkdir(s.id, s.f.path, name) : await api.rename(s.id, s.f.path, q.from, name); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    s.f.busy = false;
    if (!S.has(s.id)) return;
    if (r && r.ok) await fpLoad(s, s.f.path, q.mode === 'mk' ? 'Created the folder "' + name + '".' : 'Renamed to "' + name + '".');
    else { setMsg(s, (r && r.error) || 'That did not work.', true); fpRender(); }
  }
  F.mk.addEventListener('click', () => askName('mk'));
  F.ren.addEventListener('click', () => askName('ren'));
  F.qok.addEventListener('click', submitName);
  F.qno.addEventListener('click', closeName);
  F.qi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitName(); } else if (e.key === 'Escape') closeName(); });

  F.del.addEventListener('click', async () => {
    const s = S.get(active);
    if (!s || !idle(s) || !s.f.sel.size) return;
    const names = [...s.f.sel];
    s.f.busy = true; setMsg(s, ''); fpRender();
    let r;
    try { r = await api.remove(s.id, s.f.path, names); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    s.f.busy = false;
    if (!S.has(s.id)) return;
    if (!r || !r.ok) { setMsg(s, r && r.declined ? '' : (r && r.error) || 'That did not work.', !(r && r.declined)); fpRender(); return; }
    const d = r.data || { removed: 0, failed: [] };
    let msg = 'Deleted ' + plural(d.removed, 'item') + '.';
    if (d.failed.length) msg += '\n' + d.failed.slice(0, 3).map(x => x.name + ': ' + x.error).join('\n') + (d.failed.length > 3 ? '\n\u2026and ' + (d.failed.length - 3) + ' more' : '');
    await fpLoad(s, s.f.path, msg, d.failed.length > 0);
  });

  /* uploads and downloads */
  function summary(d) {
    const down = d.op === 'download', done = (down ? 'Downloaded ' : 'Uploaded ') + plural(d.files, 'file') + (d.dirs ? ' and ' + plural(d.dirs, 'folder') : '') + ' (' + bytes(d.bytes) + ')';
    let m = d.cancelled ? 'Stopped. ' + done + ' before you cancelled.' : done + (down && d.dest ? ' to ' + d.dest : '') + '.';
    if (d.skipped) m += '\n' + plural(d.skipped, 'shortcut or special item') + ' skipped.';
    if (d.failed && d.failed.length) m += '\n' + plural(d.failed.length, 'item') + ' could not be copied:\n' + d.failed.slice(0, 3).map(x => x.name + ': ' + x.error).join('\n') + (d.failed.length > 3 ? '\n\u2026and ' + (d.failed.length - 3) + ' more' : '');
    return m;
  }
  async function transfer(kind) {
    const s = S.get(active);
    if (!s || !idle(s) || !s.f.path || (kind === 'get' && !s.f.sel.size)) return;
    const f = s.f, op = kind === 'get' ? 'download' : 'upload';
    f.x = { op, phase: 'scan', file: '', i: 0, n: 0, done: 0, total: 0 }; setMsg(s, ''); fpRender();
    F.x.disabled = false; F.x.textContent = 'Cancel';
    let r;
    try { r = kind === 'get' ? await api.download(s.id, f.path, [...f.sel]) : await api.upload(s.id, f.path, kind === 'putd' ? 'folder' : 'files'); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    f.x = null;
    if (!S.has(s.id)) return;
    if (!r || !r.ok) { setMsg(s, (r && r.error) || 'The transfer did not work.', true); fpRender(); return; }
    const d = r.data || {};
    if (d.dialog) { setMsg(s, ''); fpRender(); return; }             // nothing was chosen
    const bad = !!(d.failed && d.failed.length);
    if (op === 'upload') await fpLoad(s, f.path, summary(d), bad);
    else { setMsg(s, summary(d), bad); fpRender(); }
  }
  F.get.addEventListener('click', () => transfer('get'));
  F.put.addEventListener('click', () => transfer('put'));
  F.putd.addEventListener('click', () => transfer('putd'));
  F.x.addEventListener('click', () => { const s = S.get(active); if (s && s.f.x) { F.x.disabled = true; F.x.textContent = 'Cancelling\u2026'; api.cancelTransfer(s.id).catch(() => {}); } });

  loadProfiles(); renderSaved(); sync(); view('new');
})();
