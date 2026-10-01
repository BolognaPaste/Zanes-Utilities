// Chat GUI: channel list, messages, members and the box you type in.
//
// It depends on nothing else on the page, so the same file runs inside the app (Test page, see test-ui.js) and in
// the browser page other people open (chat-web.html). The page that uses it passes in an "api" object, which is the
// only thing that knows how messages travel:
//
//   api.init()                 -> { server: {name}, me: {id,name,color,host}, channels: [...], members: [...] }
//   api.history(ch, before?)   -> { messages: [...oldest first], more: boolean }
//   api.send(ch, text)         api.typing(ch)         api.remove(ch, id)      (all return promises)
//   api.on(fn)                 -> unsubscribe function; fn gets events: message, delete, channels, members, typing,
//                                 server, kicked, plus { t: 'status', online } and { t: 'resync' } from the transport
//   api.host (optional)        -> { addChannel(name, topic), kick(uid) }; when present the host controls are shown
//
// Everything that comes from other people is put on the page with textContent, never as HTML.
(function (g) {
  'use strict';

  const MAX = 2000;
  const HEX = /^#[0-9a-f]{6}$/i;
  const NOOP = () => {};
  const soft = p => { try { Promise.resolve(p).catch(NOOP); } catch {} };

  const GEAR = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
  const PEOPLE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>';

  const TPL =
    '<aside class="cht-side">' +
      '<div class="cht-srv"><span class="cht-sname" data-r="sname"></span>' +
        '<button type="button" class="cht-ib" data-r="gear" title="Server settings" aria-label="Server settings" hidden>' + GEAR + '</button></div>' +
      '<div class="cht-sect"><span>Channels</span>' +
        '<button type="button" class="cht-ib" data-r="add" title="New channel" aria-label="New channel" hidden>+</button></div>' +
      '<div class="cht-addch" data-r="addbox" hidden><input type="text" data-r="addin" maxlength="32" placeholder="new-channel" aria-label="New channel name" autocomplete="off">' +
        '<button type="button" class="cht-btn" data-r="addgo">Add</button></div>' +
      '<div class="cht-chs" data-r="chs"></div>' +
      '<div class="cht-me" data-r="me"></div>' +
    '</aside>' +
    '<div class="cht-main">' +
      '<div class="cht-head"><span class="cht-h" data-r="h"></span><span class="cht-topic" data-r="topic"></span>' +
        '<button type="button" class="cht-ib" data-r="memt" aria-pressed="true" title="Show or hide members" aria-label="Show or hide members">' + PEOPLE + '</button></div>' +
      '<div class="cht-banner" data-r="banner" role="status" hidden></div>' +
      '<div class="cht-mw"><div class="cht-msgs" data-r="msgs" role="log" aria-live="polite" aria-label="Messages" tabindex="0"></div>' +
        '<button type="button" class="cht-jump" data-r="jump" hidden>New messages \u2193</button></div>' +
      '<div class="cht-typing"><span data-r="typing"></span><span class="cht-cnt" data-r="cnt"></span></div>' +
      '<div class="cht-comp"><textarea class="cht-ta" data-r="ta" rows="1" maxlength="' + MAX + '" placeholder="Message" aria-label="Message"></textarea>' +
        '<button type="button" class="cht-send" data-r="send">Send</button></div>' +
      '<div class="cht-panel" data-r="panel" hidden><div class="cht-ph"><span data-r="ptitle"></span>' +
        '<button type="button" class="cht-ib" data-r="pclose" aria-label="Close" title="Close">\u2715</button></div><div class="cht-pb" data-r="pbody"></div></div>' +
    '</div>' +
    '<aside class="cht-mem" data-r="mem" aria-label="Members"></aside>';

  /* ---------- small helpers ---------- */
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text) { const b = h('button', cls, text); b.type = 'button'; return b; }
  const initial = n => (Array.from(String(n || '?'))[0] || '?').toUpperCase();
  const colorOf = c => (HEX.test(c) ? c : '#b57bff');
  function avatar(name, color, small) { const a = h('span', 'cht-av' + (small ? ' sm' : ''), initial(name)); a.style.background = colorOf(color); return a; }
  const timeOf = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date(), y = new Date(now.getTime() - 864e5);
    if (dayKey(d) === dayKey(now)) return 'Today';
    if (dayKey(d) === dayKey(y)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  // Web addresses in a message become links. Only http and https are linked; the app opens them in your normal browser.
  function linkify(parent, text) {
    const re = /https?:\/\/[^\s<>"']+/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      let url = m[0];
      const trail = /[.,;:!?)\]]+$/.exec(url);
      if (trail) url = url.slice(0, -trail[0].length);
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch {}
      if (!ok) continue;
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = h('a', null, url);
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      parent.appendChild(a);
      last = m.index + url.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  // First press asks "Sure?", second press within 2.5 seconds does it.
  function confirmClick(b, sure, fn) {
    if (b.dataset.sure) { clearTimeout(b._t); delete b.dataset.sure; b.textContent = b.dataset.label; fn(); return; }
    b.dataset.label = b.textContent; b.dataset.sure = '1'; b.textContent = sure;
    b._t = setTimeout(() => { delete b.dataset.sure; b.textContent = b.dataset.label; }, 2500);
  }

  /* ---------- the GUI ---------- */
  function mount(root, api, opts) {
    opts = opts || {};
    const host = !!(api.host && api.host.addChannel);
    const S = { me: null, server: { name: '' }, channels: [], members: [], cur: null, msgs: {}, more: {}, unread: {}, typing: {}, pending: {}, loading: {}, failed: null, online: true, gone: false, want: null };
    root.classList.add('cht');
    root.innerHTML = TPL;
    const r = {};
    root.querySelectorAll('[data-r]').forEach(e => { r[e.dataset.r] = e; });
    r.gear.hidden = !opts.onSettings;
    r.add.hidden = !host;
    const small = window.matchMedia && matchMedia('(max-width:700px)').matches;
    root.classList.toggle('cht-nomem', small);
    r.memt.setAttribute('aria-pressed', String(!small));

    /* messages shown to the person */
    let bannerT = 0;
    function banner(text, sticky) {
      clearTimeout(bannerT);
      r.banner.textContent = text || '';
      r.banner.hidden = !text;
      if (text && !sticky) bannerT = setTimeout(() => { if (S.online && !S.gone) r.banner.hidden = true; }, 5000);
    }
    const fail = e => banner((e && e.message) || 'Something went wrong.');
    function lockInput() {
      const off = !S.online || S.gone || !S.cur;
      r.ta.disabled = off; r.send.disabled = off;
      r.ta.placeholder = S.gone ? 'You are no longer on this server' : !S.online ? 'Reconnecting\u2026' : S.cur ? 'Message #' + chName(S.cur) : 'Message';
    }
    const chName = id => { const c = S.channels.find(x => x.id === id); return c ? c.name : ''; };

    /* ----- left column ----- */
    function renderChannels() {
      r.sname.textContent = S.server.name || 'Chat';
      r.chs.textContent = '';
      for (const c of S.channels) {
        const b = btn('cht-ch' + (S.unread[c.id] ? ' un' : ''));
        b.dataset.a = 'ch'; b.dataset.id = c.id;
        b.setAttribute('aria-current', String(c.id === S.cur));
        b.appendChild(h('span', 'h', '#'));
        b.appendChild(h('span', 'n', c.name));
        if (S.unread[c.id]) b.appendChild(h('span', 'cht-un', S.unread[c.id] > 99 ? '99+' : String(S.unread[c.id])));
        r.chs.appendChild(b);
      }
    }
    function renderMe() {
      r.me.textContent = '';
      if (!S.me) return;
      r.me.appendChild(avatar(S.me.name, S.me.color, true));
      const t = h('div'); t.style.minWidth = '0';
      t.appendChild(h('b', null, S.me.name));
      t.appendChild(h('small', null, S.me.host ? 'Hosting this server' : 'Member'));
      r.me.appendChild(t);
    }
    function renderHead() {
      const c = S.channels.find(x => x.id === S.cur);
      r.h.textContent = c ? '# ' + c.name : '';
      r.topic.textContent = c ? c.topic : '';
      lockInput();
    }

    /* ----- right column ----- */
    function memberRow(m) {
      const row = h('div', 'cht-mb' + (m.online ? '' : ' off'));
      const av = avatar(m.name, m.color, true);
      av.appendChild(h('i', 'cht-dot' + (m.online ? ' on' : '')));
      row.appendChild(av);
      row.appendChild(h('span', 'nm', m.name));
      if (m.host) row.appendChild(h('span', 'cht-tag', 'HOST'));
      else if (host && api.host.kick) {
        const k = btn('cht-kick', 'Remove');
        k.dataset.a = 'kick'; k.dataset.uid = m.id; k.title = 'Remove ' + m.name + ' from the server';
        row.appendChild(k);
      }
      return row;
    }
    function renderMembers() {
      r.mem.textContent = '';
      for (const [title, list] of [['Online', S.members.filter(m => m.online)], ['Offline', S.members.filter(m => !m.online)]]) {
        if (!list.length) continue;
        r.mem.appendChild(h('div', 'cht-mg', title + ' \u2014 ' + list.length));
        list.forEach(m => r.mem.appendChild(memberRow(m)));
      }
    }

    /* ----- messages ----- */
    const atBottom = () => r.msgs.scrollHeight - r.msgs.scrollTop - r.msgs.clientHeight < 80;
    const toBottom = () => { r.msgs.scrollTop = r.msgs.scrollHeight; r.jump.hidden = true; };
    r.msgs.addEventListener('scroll', () => { if (atBottom()) r.jump.hidden = true; });
    r.jump.addEventListener('click', () => { toBottom(); r.ta.focus(); });

    function rowsFor(m, prev) {
      const out = [];
      const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
      if (newDay) out.push(h('div', 'cht-day', dayLabel(m.ts)));
      const grp = !newDay && prev.uid === m.uid && prev.name === m.name && m.ts - prev.ts < 300000;
      const row = h('div', 'cht-m' + (grp ? ' g' : ''));
      row.dataset.id = m.id;
      row.appendChild(grp ? h('span', 'cht-gt', timeOf(m.ts)) : avatar(m.name, m.color));
      const body = h('div', 'cht-b');
      if (!grp) {
        const meta = h('div', 'cht-meta');
        const u = h('span', 'cht-u', m.name);
        u.style.color = 'color-mix(in srgb, ' + colorOf(m.color) + ' 62%, var(--c-fg))';   // stays readable on light and dark themes
        meta.appendChild(u);
        if (m.uid === 'host') meta.appendChild(h('span', 'cht-tag', 'HOST'));
        meta.appendChild(h('span', 'cht-ts', timeOf(m.ts)));
        body.appendChild(meta);
      }
      const t = h('div', 'cht-t');
      linkify(t, m.text);
      body.appendChild(t);
      row.appendChild(body);
      if (S.me && (S.me.host || m.uid === S.me.id)) {
        const act = h('div', 'cht-act');
        const d = btn(null, 'Delete');
        d.dataset.a = 'del'; d.title = 'Delete this message';
        act.appendChild(d); row.appendChild(act);
      }
      out.push(row);
      return out;
    }
    function emptyNote(title, text) { const e = h('div', 'cht-empty'); e.appendChild(h('b', null, title)); e.appendChild(document.createTextNode(text)); return e; }
    function renderMsgs() {
      const box = r.msgs;
      box.textContent = '';
      if (!S.cur) { box.appendChild(emptyNote('No channels yet', 'The host has not made a channel.')); return; }
      const list = S.msgs[S.cur];
      if (!list) {
        box.appendChild(S.failed === S.cur ? emptyNote('Could not load this channel', 'Click the channel again to retry.') : h('div', 'cht-empty', 'Loading\u2026'));
        return;
      }
      if (S.more[S.cur]) { const b = btn('cht-more', 'Load older messages'); b.dataset.a = 'older'; box.appendChild(b); }
      if (!list.length) { box.appendChild(emptyNote('Welcome to #' + chName(S.cur), 'This is the start of the channel. Say something.')); return; }
      const frag = document.createDocumentFragment();
      let prev = null;
      for (const m of list) { rowsFor(m, prev).forEach(n => frag.appendChild(n)); prev = m; }
      box.appendChild(frag);
    }
    function rerender() {            // redraw but keep the same distance from the bottom
      const below = r.msgs.scrollHeight - r.msgs.scrollTop;
      renderMsgs();
      r.msgs.scrollTop = r.msgs.scrollHeight - below;
    }
    function appendMsg(m) {
      const list = S.msgs[S.cur];
      const prev = list[list.length - 2] || null;
      const stick = atBottom() || (S.me && m.uid === S.me.id);
      const e = r.msgs.querySelector('.cht-empty'); if (e) e.remove();
      rowsFor(m, prev).forEach(n => r.msgs.appendChild(n));
      if (stick) toBottom(); else r.jump.hidden = false;
    }

    async function load(id) {
      if (S.loading[id]) return;
      S.loading[id] = true; S.pending[id] = []; S.failed = null;
      if (S.cur === id) renderMsgs();
      try {
        const res = await api.history(id);
        const have = new Set(res.messages.map(m => m.id));
        S.msgs[id] = res.messages.concat((S.pending[id] || []).filter(m => !have.has(m.id)));
        S.more[id] = !!res.more;
      } catch (e) { S.failed = id; fail(e); }
      S.loading[id] = false; delete S.pending[id];
      if (S.cur === id) { renderMsgs(); toBottom(); }
    }
    async function open(id) {
      if (!S.channels.some(c => c.id === id)) id = S.channels[0] ? S.channels[0].id : null;
      S.cur = id;
      if (id) S.unread[id] = 0;
      renderChannels(); renderHead(); renderTyping();
      r.jump.hidden = true;
      if (!id) { renderMsgs(); return; }
      if (!S.msgs[id]) await load(id);
      else { renderMsgs(); toBottom(); }
      if (!r.ta.disabled && !r.panel.contains(document.activeElement)) r.ta.focus();
    }
    async function older() {
      const ch = S.cur, list = S.msgs[ch];
      if (!list || !list.length) return;
      const before = list[0].id, h0 = r.msgs.scrollHeight, t0 = r.msgs.scrollTop;
      try {
        const res = await api.history(ch, before);
        S.msgs[ch] = res.messages.concat(list); S.more[ch] = !!res.more;
      } catch (e) { return fail(e); }
      if (S.cur === ch) { renderMsgs(); r.msgs.scrollTop = t0 + (r.msgs.scrollHeight - h0); }
    }

    /* ----- typing ----- */
    function renderTyping() {
      const now = Date.now(), t = S.typing[S.cur] || {};
      const names = Object.keys(t).filter(uid => t[uid].until > now && (!S.me || uid !== S.me.id)).map(uid => t[uid].name);
      r.typing.textContent = !names.length ? '' : names.length === 1 ? names[0] + ' is typing\u2026' : names.length === 2 ? names[0] + ' and ' + names[1] + ' are typing\u2026' : 'Several people are typing\u2026';
    }
    const tick = setInterval(renderTyping, 1000);

    /* ----- composer ----- */
    let lastTyped = 0;
    r.ta.addEventListener('input', () => {
      r.ta.style.height = 'auto';
      r.ta.style.height = Math.min(r.ta.scrollHeight + 2, 140) + 'px';
      const n = r.ta.value.length;
      r.cnt.textContent = n >= 1800 ? n + ' / ' + MAX : '';
      r.cnt.classList.toggle('over', n >= MAX);
      if (r.ta.value.trim() && S.cur && Date.now() - lastTyped > 3000) { lastTyped = Date.now(); soft(api.typing(S.cur)); }
    });
    r.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    async function send() {
      const text = r.ta.value.trim();
      if (!text || !S.cur || !S.online || S.gone) return;
      const ch = S.cur;
      r.ta.value = ''; r.ta.dispatchEvent(new Event('input'));
      try { await api.send(ch, text); }
      catch (e) { fail(e); if (!r.ta.value) { r.ta.value = text; r.ta.dispatchEvent(new Event('input')); } }
    }
    r.send.addEventListener('click', () => { send(); r.ta.focus(); });

    /* ----- events from the server ----- */
    function onEvent(ev) {
      if (!ev || typeof ev !== 'object') return;
      switch (ev.t) {
        case 'message': {
          const m = ev.msg;
          if (!m || typeof m.ch !== 'string') return;
          if (S.loading[m.ch]) (S.pending[m.ch] = S.pending[m.ch] || []).push(m);
          else if (S.msgs[m.ch]) {
            if (S.msgs[m.ch].some(x => x.id === m.id)) return;
            S.msgs[m.ch].push(m);
            if (m.ch === S.cur) appendMsg(m);
          }
          if (S.typing[m.ch]) delete S.typing[m.ch][m.uid];
          if (m.ch !== S.cur && S.me && m.uid !== S.me.id) { S.unread[m.ch] = (S.unread[m.ch] || 0) + 1; renderChannels(); }
          renderTyping();
          break;
        }
        case 'delete':
          if (S.msgs[ev.ch]) {
            S.msgs[ev.ch] = S.msgs[ev.ch].filter(m => m.id !== ev.id);
            if (ev.ch === S.cur) rerender();
          }
          break;
        case 'channels': {
          S.channels = ev.channels || [];
          for (const id of Object.keys(S.msgs)) if (!S.channels.some(c => c.id === id)) { delete S.msgs[id]; delete S.unread[id]; }
          const want = S.want; S.want = null;
          if (want && S.channels.some(c => c.id === want)) open(want);
          else if (!S.channels.some(c => c.id === S.cur)) open(null);
          else { renderChannels(); renderHead(); }
          break;
        }
        case 'members':
          S.members = ev.members || [];
          if (S.me) { const me = S.members.find(m => m.id === S.me.id); if (me) { S.me.name = me.name; S.me.color = me.color; renderMe(); } }
          renderMembers();
          break;
        case 'typing':
          (S.typing[ev.ch] = S.typing[ev.ch] || {})[ev.uid] = { name: String(ev.name || ''), until: Date.now() + 4000 };
          if (ev.ch === S.cur) renderTyping();
          break;
        case 'server':
          S.server.name = String(ev.name || ''); renderChannels();
          break;
        case 'status':
          S.online = !!ev.online;
          if (!S.online) banner('Disconnected. Trying to reconnect\u2026', true); else if (!S.gone) banner('');
          lockInput();
          break;
        case 'resync':
          resync();
          break;
        case 'kicked':
          S.gone = true; S.online = false;
          banner('You were removed from this server.', true);
          lockInput();
          if (opts.onKicked) opts.onKicked();
          break;
      }
    }
    const off = api.on ? api.on(onEvent) : NOOP;

    async function resync() {
      try {
        const s = await api.init();
        S.me = s.me; S.server = s.server || { name: '' }; S.channels = s.channels || []; S.members = s.members || [];
      } catch (e) { fail(e); return; }
      S.online = true; S.gone = false; S.msgs = {}; S.more = {}; S.pending = {}; S.loading = {}; S.typing = {};
      if (r.banner.textContent.startsWith('Disconnected')) banner('');
      renderMe(); renderMembers();
      await open(S.channels.some(c => c.id === S.cur) ? S.cur : null);
    }

    /* ----- clicks ----- */
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-a]');
      if (!t || !root.contains(t)) return;
      const a = t.dataset.a;
      if (a === 'ch') open(t.dataset.id);
      else if (a === 'older') older();
      else if (a === 'del') {
        const row = t.closest('.cht-m'); if (!row) return;
        confirmClick(t, 'Sure?', () => api.remove(S.cur, Number(row.dataset.id)).catch(fail));
      } else if (a === 'kick') {
        confirmClick(t, 'Sure?', () => api.host.kick(t.dataset.uid).catch(fail));
      }
    });
    r.memt.addEventListener('click', () => {
      const hide = root.classList.toggle('cht-nomem');
      r.memt.setAttribute('aria-pressed', String(!hide));
    });
    r.gear.addEventListener('click', () => { if (opts.onSettings) opts.onSettings(ctl); });

    /* new channel (host only) */
    r.add.addEventListener('click', () => { r.addbox.hidden = !r.addbox.hidden; if (!r.addbox.hidden) r.addin.focus(); });
    async function addChannel() {
      const name = r.addin.value.trim();
      if (!name) return;
      try {
        const res = await api.host.addChannel(name, '');
        r.addin.value = ''; r.addbox.hidden = true;
        // The "channels changed" event can arrive before or after this reply, so handle both orders.
        if (res && res.id) { if (S.channels.some(c => c.id === res.id)) open(res.id); else S.want = res.id; }
      } catch (e) { fail(e); }
    }
    r.addgo.addEventListener('click', addChannel);
    r.addin.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addChannel(); } else if (e.key === 'Escape') r.addbox.hidden = true; });

    /* full-cover panel, used for the server settings */
    let panelClean = null;
    function openPanel(title, build) {
      closePanel();
      r.ptitle.textContent = title;
      const wrap = h('div');
      r.pbody.appendChild(wrap);
      panelClean = build(wrap) || null;
      r.panel.hidden = false;
    }
    function closePanel() {
      if (r.panel.hidden && !panelClean) return;
      r.panel.hidden = true;
      if (typeof panelClean === 'function') panelClean();
      panelClean = null;
      r.pbody.textContent = '';
      if (opts.onPanelClose) opts.onPanelClose();
    }
    r.pclose.addEventListener('click', closePanel);
    // On the document, not the chat: saving a setting redraws its card, which drops keyboard focus out of the chat.
    const onKey = e => { if (e.key === 'Escape' && !r.panel.hidden && root.offsetParent !== null) closePanel(); };
    document.addEventListener('keydown', onKey);

    const ctl = {
      resync, openPanel, closePanel, scrollEnd: toBottom,
      panelOpen: () => !r.panel.hidden,
      state: S,
      destroy() { clearInterval(tick); off(); document.removeEventListener('keydown', onKey); clearTimeout(bannerT); root.textContent = ''; root.classList.remove('cht', 'cht-nomem'); }
    };
    lockInput();
    resync();
    return ctl;
  }

  g.ChatUI = { mount, confirmClick };
})(window);
