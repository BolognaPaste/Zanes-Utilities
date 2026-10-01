// Test page: a Discord-style chat that runs from this PC.
// Talks to chat-ipc.js through window.chat (see preload.js) and uses the shared GUI in chat-ui.js.
// Uses $, esc and toast from index.html / app.js.
//
// You chat as the host. The server settings panel (gear button) is where you start the network server so other
// people can join from a browser, set a join password, rename things and manage channels.
(function () {
  'use strict';
  const pg = $('#p-test');
  const root = $('#cht-root');
  if (!pg || !root) return;
  const api = window.chat;
  if (!api || !window.ChatUI) {
    root.className = '';
    root.innerHTML = '<div class="empty"><b>The chat only works in the Zane\'s Utilities desktop app.</b>It could not reach the app\'s chat service.</div>';
    return;
  }

  // The backend answers { ok, v } or { ok, error }; the GUI wants plain promises that resolve or throw.
  const un = async p => {
    const r = await p;
    if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
    return r.v;
  };
  const listeners = new Set();
  api.onEvent(ev => listeners.forEach(fn => fn(ev)));
  const adapter = {
    init: () => un(api.snapshot()),
    history: (ch, before) => un(api.history(ch, before)),
    send: (ch, text) => un(api.send(ch, text)),
    typing: ch => un(api.typing(ch)),
    remove: (ch, id) => un(api.remove(ch, id)),
    on: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    host: {
      addChannel: (name, topic) => un(api.channelAdd(name, topic)),
      kick: uid => un(api.kick(uid))
    }
  };

  /* ---------- server settings panel ---------- */
  function openSettings(ui) {
    if (ui.panelOpen()) { ui.closePanel(); return; }
    ui.openPanel('Server settings', body => buildPanel(body, ui));
  }

  function buildPanel(body, ui) {
    let st = null, vs = null, timer = 0, lastVoice = '';
    const vapi = window.mumble;
    body.innerHTML = '<div class="cht-card" data-k="host"></div><div class="cht-card" data-k="voice"></div><div class="cht-card" data-k="names"></div><div class="cht-card" data-k="chs"></div>';
    const sec = k => body.querySelector('[data-k="' + k + '"]');
    const q = k => body.querySelector('input[data-k="' + k + '"]');
    const say = (text, bad) => { const m = sec('msg'); if (m) { m.textContent = text || ''; m.className = 'cht-note' + (bad ? ' warn' : ''); } };
    const fail = e => say((e && e.message) || 'Something went wrong.', true);
    const refresh = async () => { st = await un(api.settings()); };

    function statusHtml() {
      const s = st.server, t = st.tunnel;
      let h = '<div class="cht-row"><span class="cht-pill' + (s.running ? ' on' : '') + '"><i></i>' +
        (s.running ? 'Running on port ' + s.port + ' \u00b7 ' + s.connected + ' connected' : 'Stopped') + '</span></div>';
      if (!s.running) return h;
      if (t.state === 'on') {
        h += '<div class="cht-f">Internet link<span>Send this address and the join password to friends anywhere. It changes the next time you open the link.</span></div>' +
          '<div class="cht-url"><span>' + esc(t.url) + '</span><button type="button" class="cht-btn alt" data-k="copy" data-u="' + esc(t.url) + '">Copy</button></div>' +
          '<div class="cht-row"><button type="button" class="cht-btn alt" data-k="tunoff">Close internet link</button></div>';
      } else if (t.state === 'starting') {
        h += '<p class="cht-note">Creating the internet link\u2026 this can take up to 30 seconds.</p>';
      } else {
        if (t.state === 'error') h += '<p class="cht-note warn">' + esc(t.error) + '</p>';
        h += '<div class="cht-row"><button type="button" class="cht-btn alt" data-k="tunon">Create internet link</button></div>';
      }
      h += '<div class="cht-f">On this network</div>' + s.urls.map(u => '<div class="cht-url"><span>' + esc(u) + '</span><button type="button" class="cht-btn alt" data-k="copy" data-u="' + esc(u) + '">Copy</button></div>').join('');
      if (!s.lan) h += '<p class="cht-note">Only this PC can use these addresses right now. Tick "Let other devices on my network connect" and restart to let your home network in.</p>';
      else if (!st.hasPassword) h += '<p class="cht-note warn">Anyone on your network who opens an address above can join. Set a join password below.</p>';
      return h;
    }
    let lastStatus = '';
    // Only redraws when something changed, so a button is never replaced between mouse-down and mouse-up.
    function renderStatus() {
      const el = sec('status');
      if (!el || !st) return;
      const html = statusHtml();
      if (html !== lastStatus) { lastStatus = html; el.innerHTML = html; }
    }

    function renderHost() {
      const run = st.server.running, t = st.tunnel;
      const was = sec('host').querySelector('details.cht-more');      // keep the setup steps open if they were open
      const keepOpen = (was && was.open) || (!t.bin && t.want);
      lastStatus = '';
      sec('host').innerHTML =
        '<h3>Host this chat</h3>' +
        '<div data-k="status"></div>' +
        '<div class="cht-row">' +
          '<label>Port <input type="number" min="1024" max="65535" data-k="port" value="' + st.port + '"' + (run ? ' disabled' : '') + '></label>' +
          '<label><input type="checkbox" data-k="lan"' + (st.lan ? ' checked' : '') + (run ? ' disabled' : '') + '> Let other devices on my network connect</label>' +
        '</div>' +
        '<div class="cht-row"><label><input type="checkbox" data-k="net"' + (t.want ? ' checked' : '') + (run ? ' disabled' : '') + '> Let friends join over the internet (internet link)</label></div>' +
        '<div class="cht-row"><button type="button" class="cht-btn' + (run ? ' bad' : '') + '" data-k="toggle">' + (run ? 'Stop server' : 'Start server') + '</button></div>' +
        '<p class="cht-note" data-k="msg" role="status"></p>' +
        '<details class="cht-more"' + (keepOpen ? ' open' : '') + '><summary>Set up the internet link (one time)</summary>' +
          '<p class="cht-note">The internet link needs no router settings. It uses Cloudflare\'s free tunnel program, <b>cloudflared</b>, which you provide (the app does not download anything itself).</p>' +
          '<ol><li>Download <b>cloudflared-windows-amd64.exe</b> from <a href="https://github.com/cloudflare/cloudflared/releases/latest" target="_blank" rel="noopener noreferrer">Cloudflare\'s releases page</a>. No account is needed.</li>' +
          '<li>Press <b>Choose cloudflared\u2026</b> and pick that file. (Or put it in a folder named <code>cloudflared</code> next to the app.)</li>' +
          '<li>Set a join password below, tick the internet link box and press Start server.</li></ol>' +
          '<div class="cht-row"><button type="button" class="cht-btn alt" data-k="tunpick">Choose cloudflared\u2026</button>' +
          '<span class="cht-note" style="margin:0">' + (t.bin ? 'Found: ' + esc(t.bin) : 'Not found yet.') + '</span></div>' +
          '<p class="cht-note">Good to know: the link needs the join password, and its address is new each time. Messages travel through Cloudflare\'s network (encrypted to Cloudflare, but not end-to-end encrypted). Free quick links have no uptime guarantee, so close the link when you are done. Without the internet link the server is plain HTTP, so use it on your home network or a VPN such as Tailscale, and do not forward its port on your router.</p>' +
        '</details>' +
        '<div class="cht-f">Join password<span>' + (st.hasPassword ? 'A password is set. People need it to join.' : 'No password is set. Anyone who can reach the address can join (the internet link needs one).') + '</span>' +
          '<div class="cht-row"><input type="password" data-k="pw" maxlength="128" autocomplete="off" placeholder="' + (st.hasPassword ? 'New password' : 'Choose a password') + '" aria-label="Join password">' +
          '<button type="button" class="cht-btn alt" data-k="pwsave">Save</button>' +
          (st.hasPassword ? '<button type="button" class="cht-btn alt" data-k="pwclear">Remove</button>' : '') + '</div></div>';
      renderStatus();
    }
    // Voice chat through Mumble (a separate program, opened in its own window). See mumble-ipc.js.
    const vkey = () => JSON.stringify([vs.running, vs.client, vs.server, vs.error, vs.hasPassword, vs.urls]);
    function renderVoice() {
      const el = sec('voice');
      if (!el) return;
      if (!vapi) { el.innerHTML = '<h3>Voice chat (Mumble)</h3><p class="cht-note">Voice chat is not available in this build.</p>'; return; }
      const run = vs.running;
      lastVoice = vkey();
      el.innerHTML =
        '<h3>Voice chat (Mumble)</h3>' +
        '<p class="cht-note"><a href="https://www.mumble.info" target="_blank" rel="noopener noreferrer">Mumble</a> is a free voice chat program. It opens in its own window and talks to a voice server that this app can run on your PC.</p>' +
        '<div class="cht-row"><span class="cht-pill' + (run ? ' on' : '') + '"><i></i>' + (run ? 'Voice server running on port ' + vs.port : 'Voice server stopped') + '</span></div>' +
        (vs.error ? '<p class="cht-note warn">' + esc(vs.error) + '</p>' : '') +
        (run ? '<div class="cht-f">Friends on your network join with</div>' + (vs.urls.length ? vs.urls.map(u => '<div class="cht-url"><span>' + esc(u) + '</span><button type="button" class="cht-btn alt" data-k="copy" data-u="' + esc(u) + '">Copy</button></div>').join('') : '<p class="cht-note">Only this PC can join right now. Tick \u201cLet other devices on my network connect\u201d below and restart the voice server.</p>') : '') +
        (run && vs.lan && !vs.hasPassword ? '<p class="cht-note warn">Anyone on your network can join. Set a voice password below.</p>' : '') +
        '<div class="cht-row">' +
          '<label>Port <input type="number" min="1024" max="65535" data-k="vport" value="' + vs.port + '"' + (run ? ' disabled' : '') + '></label>' +
          '<label><input type="checkbox" data-k="vlan"' + (vs.lan ? ' checked' : '') + (run ? ' disabled' : '') + '> Let other devices on my network connect</label>' +
        '</div>' +
        '<div class="cht-row"><button type="button" class="cht-btn' + (run ? ' bad' : '') + '" data-k="' + (run ? 'vstop' : 'vstart') + '"' + (!run && !vs.server ? ' disabled' : '') + '>' + (run ? 'Stop voice server' : 'Start voice server') + '</button>' +
          '<button type="button" class="cht-btn alt" data-k="vopen"' + (vs.client ? '' : ' disabled') + '>Open Mumble' + (run ? ' and join' : '') + '</button></div>' +
        '<p class="cht-note" data-k="vmsg" role="status"></p>' +
        '<div class="cht-f">Voice password<span>' + (vs.hasPassword ? 'A password is set. People need it to join.' : 'No password is set.') + '</span>' +
          '<div class="cht-row"><input type="password" data-k="vpw" maxlength="64" autocomplete="off" placeholder="' + (vs.hasPassword ? 'New password' : 'Choose a password') + '" aria-label="Voice password"' + (run ? ' disabled' : '') + '>' +
          '<button type="button" class="cht-btn alt" data-k="vpwsave"' + (run ? ' disabled' : '') + '>Save</button>' +
          (vs.hasPassword ? '<button type="button" class="cht-btn alt" data-k="vpwclear"' + (run ? ' disabled' : '') + '>Remove</button>' : '') + '</div></div>' +
        '<div class="cht-f">Owner password<span>This is for Mumble\u2019s built-in owner account, named <b>SuperUser</b>. Set it once, then use \u201cOpen as owner\u201d to add channels and make your own account an admin. Stop the voice server first to set it.</span>' +
          '<div class="cht-row"><input type="password" data-k="vsu" maxlength="64" autocomplete="off" placeholder="Choose an owner password" aria-label="Owner password"' + (run ? ' disabled' : '') + '>' +
          '<button type="button" class="cht-btn alt" data-k="vsusave"' + (run || !vs.server ? ' disabled' : '') + '>Set</button>' +
          '<button type="button" class="cht-btn alt" data-k="vowner"' + (run && vs.client ? '' : ' disabled') + '>Open as owner</button></div></div>' +
        '<details class="cht-more"' + (!vs.client || !vs.server ? ' open' : '') + '><summary>Set up Mumble (one time)</summary>' +
          '<p class="cht-note">The app does not download Mumble for you. Get the Windows installer from <a href="https://www.mumble.info/downloads/" target="_blank" rel="noopener noreferrer">mumble.info/downloads</a> and install it. Make sure the server part (mumble-server) is included.</p>' +
          '<p class="cht-note">The app looks in Mumble\u2019s normal install folder and in a folder named <code>mumble</code> next to the app. If it cannot find a file, choose it here.</p>' +
          '<div class="cht-row"><button type="button" class="cht-btn alt" data-k="vpickc">Choose mumble.exe\u2026</button><span class="cht-note" style="margin:0">' + (vs.client ? 'Found: ' + esc(vs.client) : 'Not found yet.') + '</span></div>' +
          '<div class="cht-row"><button type="button" class="cht-btn alt" data-k="vpicks">Choose mumble-server.exe\u2026</button><span class="cht-note" style="margin:0">' + (vs.server ? 'Found: ' + esc(vs.server) : 'Not found yet.') + '</span></div>' +
          '<p class="cht-note">Good to know: the chat\u2019s internet link cannot carry voice. Friends outside your home need a VPN such as Tailscale (everyone installs it, then joins using your Tailscale address), or you can forward the port (TCP and UDP) on your router with a voice password set. The first time the server starts, Windows may ask to allow it through the firewall. The password is saved on this PC in plain text, because Mumble\u2019s server needs it that way.</p>' +
        '</details>';
    }
    const vsay = (text, bad) => { const m = sec('vmsg'); if (m) { m.textContent = text || ''; m.className = 'cht-note' + (bad ? ' warn' : ''); } };

    function renderNames() {
      sec('names').innerHTML =
        '<h3>Names</h3>' +
        '<label class="cht-f">Server name<input type="text" data-k="sn" maxlength="40" value="' + esc(st.serverName) + '"></label>' +
        '<label class="cht-f">Your name in chat<input type="text" data-k="hn" maxlength="24" value="' + esc(st.hostName) + '"></label>' +
        '<div class="cht-row"><button type="button" class="cht-btn" data-k="namesave">Save names</button></div>';
    }
    function renderChs() {
      const chs = ui.state.channels;
      sec('chs').innerHTML = '<h3>Channels</h3>' + chs.map(c =>
        '<div class="cht-chrow" data-id="' + esc(c.id) + '">' +
          '<input type="text" data-k="cn" maxlength="32" value="' + esc(c.name) + '" aria-label="Channel name">' +
          '<input type="text" data-k="ct" maxlength="120" value="' + esc(c.topic) + '" placeholder="Topic" aria-label="Channel topic">' +
          '<button type="button" class="cht-btn alt" data-k="csave">Save</button>' +
          '<button type="button" class="cht-btn bad" data-k="cdel"' + (chs.length < 2 ? ' disabled' : '') + '>Delete</button></div>').join('') +
        '<p class="cht-note">Deleting a channel also deletes its messages. Add channels with the + button above the channel list. The last 500 messages of each channel are saved on this PC, so they are still here when you start the server again, even with a new internet link.</p>';
    }

    body.addEventListener('click', async e => {
      const t = e.target.closest('[data-k]');
      if (!t || t.tagName !== 'BUTTON') return;
      const k = t.dataset.k;
      try {
        if (k === 'toggle') {
          const starting = !st.server.running;
          t.disabled = true;
          if (starting) t.textContent = q('net').checked ? 'Starting (up to 45 s)\u2026' : 'Starting\u2026';
          try { st = await un(starting ? api.serverStart(Number(q('port').value), q('lan').checked, q('net').checked) : api.serverStop()); }
          finally { t.disabled = false; }
          renderHost(); say(st.server.running ? 'Server started.' : 'Server stopped.');
        } else if (k === 'tunon') {
          t.disabled = true; t.textContent = 'Creating\u2026';
          try { st = await un(api.tunnelStart()); } finally { t.disabled = false; }
          renderHost();
        } else if (k === 'tunoff') {
          st = await un(api.tunnelStop()); renderHost(); say('Internet link closed.');
        } else if (k === 'tunpick') {
          st = await un(api.tunnelPick()); renderHost(); say(st.tunnel.bin ? 'cloudflared found.' : '');
        } else if (k === 'copy') {
          await navigator.clipboard.writeText(t.dataset.u);
          (t.closest('[data-k="voice"]') ? vsay : say)('Copied ' + t.dataset.u);
        } else if (k === 'pwsave') {
          const v = q('pw').value;
          if (!v) return say('Type a password first.', true);
          st = await un(api.setSettings({ password: v }));
          renderHost(); say('Password saved. People who already joined stay signed in.');
        } else if (k === 'pwclear') {
          st = await un(api.setSettings({ password: '' }));
          renderHost(); say('Password removed.');
        } else if (k === 'namesave') {
          st = await un(api.setSettings({ serverName: q('sn').value, hostName: q('hn').value }));
          renderNames(); toast('Names saved');
        } else if (k === 'csave') {
          const row = t.closest('.cht-chrow');
          await un(api.channelEdit(row.dataset.id, row.querySelector('[data-k="cn"]').value, row.querySelector('[data-k="ct"]').value));
          toast('Channel saved');
        } else if (k === 'cdel') {
          const row = t.closest('.cht-chrow');
          ChatUI.confirmClick(t, 'Sure?', () => un(api.channelDel(row.dataset.id)).catch(err => toast(err.message)));
        } else if (k === 'vstart') {
          t.disabled = true; t.textContent = 'Starting\u2026';
          const pw = q('vpw').value;
          try { vs = await un(vapi.serverStart(Number(q('vport').value), q('vlan').checked, pw)); }
          catch (e) { try { vs = await un(vapi.status()); } catch {} renderVoice(); vsay(e.message, true); return; }
          renderVoice(); vsay('Voice server started.');
        } else if (k === 'vstop') {
          vs = await un(vapi.serverStop()); renderVoice(); vsay('Voice server stopped.');
        } else if (k === 'vopen') {
          t.disabled = true;
          try { vs = await un(vapi.open(st && st.hostName)); } finally { t.disabled = false; }
          vsay(vs.running ? 'Mumble is opening. If it asks, enter the voice password.' : 'Mumble is opening.');
        } else if (k === 'vsusave') {
          const v = q('vsu').value;
          if (!v) return vsay('Type an owner password first.', true);
          t.disabled = true; t.textContent = 'Setting\u2026';
          try { vs = await un(vapi.setOwnerPassword(v)); } finally { t.disabled = false; t.textContent = 'Set'; }
          renderVoice(); vsay('Owner password set. Start the voice server, then press Open as owner.');
        } else if (k === 'vowner') {
          t.disabled = true;
          try { vs = await un(vapi.open('SuperUser')); } finally { t.disabled = false; }
          vsay('Mumble is opening as SuperUser. Enter the owner password when it asks.');
        } else if (k === 'vpickc' || k === 'vpicks') {
          vs = await un(vapi.pick(k === 'vpicks' ? 'server' : 'client')); renderVoice();
        } else if (k === 'vpwsave') {
          const v = q('vpw').value;
          if (!v) return vsay('Type a password first.', true);
          vs = await un(vapi.setPassword(v)); renderVoice(); vsay('Voice password saved.');
        } else if (k === 'vpwclear') {
          vs = await un(vapi.setPassword('')); renderVoice(); vsay('Voice password removed.');
        }
      } catch (err) { if (k === 'namesave' || k === 'csave') toast(err.message); else if (k[0] === 'v' && k !== 'vstart') vsay(err.message, true); else fail(err); }
    });

    const off = adapter.on(ev => { if (ev.t === 'channels') renderChs(); });
    refresh().then(() => {
      renderHost(); renderNames(); renderChs();
      if (vapi) un(vapi.status()).then(v => { vs = v; renderVoice(); }).catch(() => { vs = { running: false, port: 64738, lan: false, hasPassword: false, urls: [], error: '' }; renderVoice(); });
      else renderVoice();
      // Keeps the "connected" count current without touching what you are typing in the boxes below it.
      timer = setInterval(async () => { try { await refresh(); const b = body.querySelector('[data-k="toggle"]'); if (b && !b.disabled && b.textContent.startsWith('Stop') !== st.server.running) renderHost(); else renderStatus(); } catch {}
        // Notices a voice server that stopped on its own, without redrawing while a box is being typed in.
        if (vapi && vs) { try { const v = await un(vapi.status()); if (JSON.stringify([v.running, v.client, v.server, v.error, v.hasPassword, v.urls]) !== lastVoice) { vs = v; if (!body.querySelector('[data-k="vpw"]:focus, [data-k="vport"]:focus, [data-k="vsu"]:focus')) renderVoice(); } } catch {} }
      }, 2000);
    }).catch(fail);
    return () => { clearInterval(timer); off(); };
  }

  /* ---------- joining a friend's server (from this app instead of a browser) ---------- */
  // The connection itself lives in the app's main process (chat-remote.js). Here: a small bar above the chat, a join
  // form, and a second adapter that sends everything to the friend's server instead of this PC's own chat.
  const rlisteners = new Set();
  const radapter = {
    init: () => un(api.remoteSnapshot()),
    history: (ch, before) => un(api.remoteHistory(ch, before)),
    send: (ch, text) => un(api.remoteSend(ch, text)),
    typing: ch => un(api.remoteTyping(ch)),
    remove: (ch, id) => un(api.remoteDelete(ch, id)),
    on: fn => { rlisteners.add(fn); return () => rlisteners.delete(fn); }
  };
  const canJoin = !!(api.remoteJoin && api.onRemoteEvent);
  if (canJoin) api.onRemoteEvent(ev => { if (ev.t === 'ended') backToMine(ev.notice); else rlisteners.forEach(fn => fn(ev)); });

  let ui = null, mode = 'mine', remoteInfo = null;      // mode: mine | join | remote
  const bar = document.createElement('div');
  bar.className = 'cht-row';
  bar.style.margin = '0 0 12px';
  if (canJoin) root.parentNode.insertBefore(bar, root);
  function renderBar() {
    if (!canJoin) return;
    if (mode === 'remote' && remoteInfo) {
      bar.innerHTML = '<span class="cht-pill on"><i></i>Connected to ' + esc(remoteInfo.serverName) + ' \u00b7 ' + esc(remoteInfo.address) + '</span>' +
        '<button type="button" class="cht-btn alt" data-b="leave">Leave server</button>';
    } else if (mode === 'join') {
      bar.innerHTML = '';
    } else {
      bar.innerHTML = '<button type="button" class="cht-btn alt" data-b="join">Join a friend\u2019s server</button>';
    }
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    if (b.dataset.b === 'join') showJoin();
    else if (b.dataset.b === 'leave') un(api.remoteLeave()).catch(() => {}).then(() => backToMine());
  });

  function dropUi() { if (ui) { ui.destroy(); ui = null; } rlisteners.clear(); }
  function backToMine(notice) {
    dropUi(); mode = 'mine'; remoteInfo = null;
    renderBar(); enter();
    if (notice) toast(notice);
  }

  async function showJoin(notice) {
    dropUi(); mode = 'join'; renderBar();
    let saved = { address: '', name: '' };
    try { saved = await un(api.remoteStatus()); } catch {}
    root.innerHTML =
      '<div class="cht-card" style="max-width:520px">' +
        '<h3>Join a friend\u2019s server</h3>' +
        '<p class="cht-note">Paste the address your friend copied from their Test page. It looks like <code>http://192.168.1.5:3000</code> on the same network or a VPN, or <code>https://\u2026.trycloudflare.com</code> for their internet link.</p>' +
        '<label class="cht-f">Server address<input type="text" data-j="addr" maxlength="200" spellcheck="false" autocomplete="off" value="' + esc(saved.address || '') + '"></label>' +
        '<label class="cht-f">Your name in their chat<input type="text" data-j="name" maxlength="24" value="' + esc(saved.name || '') + '"></label>' +
        '<label class="cht-f">Server password (if they set one)<input type="password" data-j="pw" maxlength="128" autocomplete="off"></label>' +
        '<div class="cht-row"><button type="button" class="cht-btn" data-j="go">Join</button><button type="button" class="cht-btn alt" data-j="cancel">Cancel</button></div>' +
        '<p class="cht-note' + (notice ? ' warn' : '') + '" data-j="msg" role="status">' + esc(notice || '') + '</p>' +
      '</div>';
    const f = k => root.querySelector('[data-j="' + k + '"]');
    const msg = (t, bad) => { const m = f('msg'); m.textContent = t || ''; m.className = 'cht-note' + (bad ? ' warn' : ''); };
    const go = async () => {
      const b = f('go');
      b.disabled = true; msg('Connecting\u2026');
      try {
        const r = await un(api.remoteJoin(f('addr').value, f('name').value, f('pw').value));
        remoteInfo = { serverName: r.name, address: r.address };
        dropUi(); mode = 'remote'; renderBar();
        ui = ChatUI.mount(root, radapter, { onKicked: () => setTimeout(() => { if (mode === 'remote') { un(api.remoteLeave()).catch(() => {}); backToMine('You were removed from that server.'); } }, 1500) });
      } catch (e) { b.disabled = false; msg(e.message, true); }
    };
    f('go').addEventListener('click', go);
    root.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
    f('cancel').addEventListener('click', () => backToMine());
    (f('addr').value ? (f('name').value ? f('pw') : f('name')) : f('addr')).focus();
  }

  /* ---------- page life ---------- */
  const enter = () => {
    if (mode !== 'mine') return;
    if (!ui) ui = ChatUI.mount(root, adapter, { onSettings: openSettings });
    else ui.scrollEnd();
  };
  // The chat is started the first time the page is opened (the app cannot be used while it is locked, so it is never
  // asked for data in that state) and refreshed when the app is unlocked, because nothing is pushed while locked.
  new MutationObserver(() => { if (!pg.hidden) enter(); }).observe(pg, { attributes: true, attributeFilter: ['hidden'] });
  renderBar();
  if (!pg.hidden) enter();
  if (window.appLock && window.appLock.onChange) window.appLock.onChange(m => { if (m && m.locked === false && ui) ui.resync(); });
})();
