// FMHY page: fmhy.net shown inside the page area, with back / forward / home buttons and four
// custom quick-link buttons (set on the Settings page) that open pop-out pages with ads and trackers blocked.
// Links on the fmhy.net pages that lead to other sites open in the same kind of pop-out window.
// Talks to fmhy-ipc.js through window.fmhy (see preload.js). Uses $ from index.html.
// The site is drawn by the main process over #fm-host, so this file only reports where that box is.
(function () {
  'use strict';
  const host = $('#fm-host'), na = $('#fm-na'), bar = $('#fm-bar'), quick = $('#fm-quick');
  if (!host) return;
  const api = window.fmhy;

  // ---- Four quick-link buttons (top right of the page). Name + link are set on the Settings page and kept
  // in localStorage. Clicking a filled button opens its link in a pop-out window inside the app; an empty
  // button takes you to Settings. Only http(s) links are accepted.
  const KEY = 'zu-fmhy-quick', N = 4;
  const clean = raw => {                 // '' = empty, null = not a usable web address, otherwise the full URL
    let t = String(raw || '').trim();
    if (!t) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = 'https://' + t;
    try { const u = new URL(t); return /^https?:$/.test(u.protocol) && u.hostname ? u.href : null; } catch { return null; }
  };
  const load = () => {
    let a = [];
    try { a = JSON.parse(localStorage.getItem(KEY)) || []; } catch {}
    return Array.from({ length: N }, (_, i) => {
      const x = (Array.isArray(a) && a[i]) || {}, u = clean(x.url);
      return u ? { name: String(x.name || '').slice(0, 24), url: u } : { name: '', url: '' };
    });
  };
  let cfg = load();

  // Ad / tracker blocking in the pop-out pages (uBlock Origin filter lists). On unless switched off in Settings.
  const BKEY = 'zu-fmhy-block';
  const warm = () => { try { const p = api && api.warm && api.warm(); if (p && p.catch) p.catch(() => {}); } catch {} };   // refused while the app is locked; that is fine
  const blockOn = () => { try { return localStorage.getItem(BKEY) !== '0'; } catch { return true; } };
  const hostName = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  function renderQuick() {
    if (!quick) return;
    quick.textContent = '';
    cfg.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'alt'; b.dataset.q = i;
      if (c.url) { b.dataset.set = '1'; b.textContent = c.name || hostName(c.url); b.title = c.url + ' (change it in Settings)'; }
      else b.title = 'Empty button: click to set it up in Settings';
      quick.appendChild(b);
    });
  }
  const toSettings = () => { const b = document.querySelector('.nv[data-p="settings"]'); if (b) b.click(); };
  if (quick) quick.addEventListener('click', async e => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const c = cfg[+b.dataset.q];
    if (!c || !c.url) return toSettings();
    if (!api || !api.popup) return toast('Pop-out pages only work in the Zane\'s Utilities desktop app.');
    try {
      const r = await api.popup(c.url, +b.dataset.q, blockOn());
      if (r && r.ok === false) toast(r.error || 'Could not open that page.');
      else if (r && r.note) toast(r.note);
    } catch { toast('Could not open that page.'); }
  });

  // Settings page: the form for the four buttons.
  const save = $('#fq-save'), msg = $('#fq-msg');
  const fill = () => cfg.forEach((c, i) => { const n = $('#fq-n' + i), u = $('#fq-u' + i); if (n) n.value = c.name; if (u) u.value = c.url; });
  const say = (t, bad) => { if (msg) { msg.textContent = t; msg.className = bad ? 'err' : 'fx'; } };
  function saveForm() {
    const next = [];
    for (let i = 0; i < N; i++) {
      const name = $('#fq-n' + i).value.trim().slice(0, 24), raw = $('#fq-u' + i).value, url = clean(raw);
      if (url === null) return say('Button ' + (i + 1) + ': that is not a valid web address.', true);
      if (!url && name) return say('Button ' + (i + 1) + ' has a name but no link.', true);
      next.push(url ? { name: name || hostName(url), url } : { name: '', url: '' });
    }
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { return say('Could not save your buttons.', true); }
    cfg = next; fill(); renderQuick();
    say('Saved. Your buttons are on the FMHY page.');
    toast('Saved');
  }
  if (save) {
    save.addEventListener('click', saveForm);
    document.querySelectorAll('.fq-row input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveForm(); }));
    document.querySelectorAll('.fq-row input').forEach(inp => inp.addEventListener('input', () => say('')));
  }
  // ---- Settings page: Ad blocker section. Shows what the blocker has really read and saved, and has the
  // on / off switch and the "update now" button. The numbers come from the main process (adblock.js).
  const abOn = $('#ab-on'), abBox = $('#ab-box'), abHead = $('#ab-head'), abSub = $('#ab-sub'), abLists = $('#ab-lists'), abUpd = $('#ab-upd'), abMsg = $('#ab-msg');
  const abSay = (t, bad) => { if (abMsg) { abMsg.textContent = t || ''; abMsg.className = bad ? 'err' : 'fx'; } };
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const fmtDate = ms => { try { return new Date(ms).toLocaleString(); } catch { return ''; } };
  let abBusy = false;

  function paint(s) {
    if (!abBox || !s) return;
    const lines = [];
    let state = 'idle', head = '';
    if (s.state === 'loading') {
      head = 'Reading the filter lists…';
      lines.push('Downloading and building the filters. The first time can take a little while.');
    } else if (s.state === 'ready') {
      if (s.cached) { state = 'ready'; head = '\u2713 Filter lists read and cached'; }
      else { state = 'warn'; head = '\u2713 Filter lists read, but not saved to disk'; lines.push('They will have to be downloaded again next time the app starts.'); }
      lines.push(s.lists.length + ' lists' + (s.filters ? ', ' + s.filters.toLocaleString() + ' filter rules' : '') + '. ' + (s.source === 'cache' ? 'Loaded from the saved copy.' : 'Downloaded just now.'));
      if (s.cached) lines.push('Saved copy: ' + fmtSize(s.size) + ', ' + fmtDate(s.cachedAt) + '. Refreshes itself after ' + s.maxAgeDays + ' days.');
      if (s.warning) lines.push(s.warning);
      lines.push(s.blocking ? 'Blocking is active for your pop-out pages.' : (abOn && abOn.checked ? 'Blocking switches on when you open a page from one of your buttons.' : 'Blocking is switched off.'));
    } else if (s.state === 'error') {
      state = 'error'; head = '\u2715 Could not load the filter lists';
      lines.push(s.error || 'Unknown error.');
      lines.push('Pages from your buttons open without blocking until this works. Check your internet connection and press the button below.');
    } else {
      head = 'Not loaded yet';
      lines.push(s.onDisk
        ? 'A saved copy is on disk (' + fmtSize(s.diskSize) + ', ' + fmtDate(s.diskAt) + '). It loads when you open the FMHY page or one of your buttons.'
        : 'No filter lists are saved yet. They download the first time you open the FMHY page, or when you press the button below.');
    }
    abBox.dataset.s = state;
    abHead.textContent = head;
    abSub.textContent = '';
    lines.forEach(t => { const d = document.createElement('div'); d.textContent = t; abSub.appendChild(d); });
    abLists.textContent = '';
    if (s.state !== 'loading') (s.lists || []).forEach(n => { const li = document.createElement('li'); li.textContent = n; abLists.appendChild(li); });
  }
  const abRefresh = async () => { try { if (api && api.adStatus) paint(await api.adStatus()); } catch {} };

  if (abOn) {
    abOn.checked = blockOn();
    if (!api || !api.adStatus) {
      abOn.disabled = true; if (abUpd) abUpd.disabled = true;
      if (abHead) abHead.textContent = 'The ad blocker only works in the Zane\'s Utilities desktop app.';
    } else {
      abOn.addEventListener('change', async () => {
        try { localStorage.setItem(BKEY, abOn.checked ? '1' : '0'); } catch {}
        abSay('');
        try { paint(await api.adSet(abOn.checked)); } catch { abSay('Could not change the ad blocker.', true); }
      });
      if (abUpd) abUpd.addEventListener('click', async () => {
        if (abBusy) return;
        abBusy = true; abUpd.disabled = true; abUpd.textContent = 'Updating...'; abSay('');
        try {
          const r = await api.adRefresh();
          paint(r);
          if (r && r.state === 'ready' && r.cached && !r.warning) abSay('Filter lists updated and saved.');
          else if (r && r.state === 'ready') abSay(r.warning || 'Filter lists are loaded, but could not be saved.', true);
          else abSay('Could not update the filter lists.', true);
        } catch { abSay('Could not update the filter lists.', true); }
        abBusy = false; abUpd.disabled = false; abUpd.textContent = 'Update filter lists now';
      });
      if (api.onAd) api.onAd(abRefresh);
      const nav = document.querySelector('.sx-act[data-sj="ab-card"]');
      if (nav) nav.addEventListener('click', () => { if (blockOn()) warm(); abRefresh(); });
      abRefresh();
    }
  }
  fill(); renderQuick();

  if (!api || !api.show) {
    na.hidden = false; bar.hidden = true; host.hidden = true; if (quick) quick.hidden = true;
    window.fmEnter = window.fmPause = () => {};
    return;
  }

  let on = false, last = '', timer = 0, ro = null;
  const box = () => {
    const r = host.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const sync = () => {
    if (!on) return;
    const b = box(), k = [b.x, b.y, b.width, b.height].join();
    if (k !== last) { last = k; api.bounds(b); }
  };

  window.fmEnter = () => {
    on = true; last = '';
    if (blockOn()) warm();   // start loading the filter lists now, so the first button press is already covered
    requestAnimationFrame(() => {
      if (!on) return;
      const b = box(); last = [b.x, b.y, b.width, b.height].join();
      api.show(Object.assign({ block: blockOn() }, b));   // also tells the main process whether links from the site get ad blocking
    });
    if (window.ResizeObserver && !ro) { ro = new ResizeObserver(sync); ro.observe(host); }
    clearInterval(timer); timer = setInterval(sync, 300);   // also catches the menu opening or closing
  };
  window.fmPause = () => {
    if (!on) return;
    on = false; clearInterval(timer);
    api.hide();
  };

  window.addEventListener('resize', sync);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (b) api.nav(b.dataset.n);
  });
})();
