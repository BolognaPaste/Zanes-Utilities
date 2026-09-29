// Local videos section of the Media player page (shown with the server address form).
// Talks to video-ipc.js through window.localVideos (see preload.js). Uses $, esc and toast from index.html.
//
// Every movie gets a header image. In order of preference: a wide image next to the file (banner,
// fanart, landscape), a poster, a Windows thumbnail of the video, and finally a coloured tile with
// the title's initials. A clearlogo/logo image next to the file is laid over the header.
(function () {
  'use strict';
  const sec = $('#lv');
  if (!sec) return;
  const na = $('#lv-na'), pick = $('#lv-pick'), re = $('#lv-re'), dirEl = $('#lv-dir'), q = $('#lv-q'), list = $('#lv-list');
  const box = $('#lv-play'), vid = $('#lv-v'), ttl = $('#lv-t'), sub = $('#lv-s'), auto = $('#lv-auto');
  const prev = $('#lv-prev'), next = $('#lv-next'), ext = $('#lv-ext'), cls = $('#lv-x'), msg = $('#lv-msg'), view = $('#lv-view');
  const api = window.localVideos;
  const K = 'gca-video-dir', KV = 'gca-video-view';
  const getDir = () => { try { return localStorage.getItem(K) || ''; } catch { return ''; } };
  const setDir = d => { try { d ? localStorage.setItem(K, d) : localStorage.removeItem(K); } catch {} };
  const getMode = () => { try { return localStorage.getItem(KV) === 'rows' ? 'rows' : 'cards'; } catch { return 'cards'; } };

  if (!api || !api.scan) {
    na.hidden = false; pick.disabled = true;
    window.lvEnter = window.lvPause = () => {};
    return;
  }

  let dir = getDir(), files = [], shown = [], cur = '', trunc = false, busy = false, err = '', mode = getMode();

  const fileUrl = p => {
    p = p.replace(/\\/g, '/');
    const e = encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
    return p.startsWith('//') ? 'file:' + e : p.startsWith('/') ? 'file://' + e : 'file:///' + e;
  };
  const fmt = n => n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? Math.round(n / 1048576) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const parts = rel => { const a = rel.split(/[\\/]/); return { name: a.pop(), folder: a.join(' \\ ') }; };

  /* Movie names: "The.Matrix.1999.1080p.BluRay.x264.mkv" -> "The Matrix", 1999 */
  const TAGS = /\b(2160p|1080p|720p|480p|4k|uhd|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdtv|dvdrip|x26[45]|h\.?26[45]|hevc|hdr10?|remux|proper|extended|unrated|imax)\b/i;
  function pretty(file) {
    let s = file.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
    const t = s.search(TAGS);
    if (t > 0) s = s.slice(0, t);
    let year = '', last = null, m;
    const rx = /(?:^|[\s(\[])((?:19|20)\d{2})(?=$|[\s)\]])/g;
    while ((m = rx.exec(s))) last = m;
    if (last && last.index > 0 && +last[1] <= new Date().getFullYear() + 1) { year = last[1]; s = s.slice(0, last.index); }
    s = s.replace(/[\s(\[\-]+$/, '').trim();
    return { title: s || file.replace(/\.[^.]+$/, ''), year };
  }
  const initials = t => t.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '?';
  const tint = t => { let h = 0; for (const c of t) h = (h * 31 + c.codePointAt(0)) >>> 0; return 'hsl(' + (h % 360) + ' 28% 24%)'; };

  /* Header art: sidecar image first, then the Windows thumbnail (made on demand, a few at a time) */
  const thumbs = new Map();   // video path -> thumbnail file, or null when none could be made
  const pending = new Set(), queue = [];
  let active = 0, io = null;

  const headerSrc = f => (f.art && (f.art.wide || f.art.poster)) || thumbs.get(f.path) || '';

  function setImg(h, file) {
    const im = document.createElement('img');
    im.className = 'main'; im.alt = ''; im.decoding = 'async'; im.dataset.k = 'thumb';
    im.src = fileUrl(file);
    h.classList.remove('ph');
    const ini = h.querySelector('.ini'); if (ini) ini.remove();
    h.insertBefore(im, h.firstChild);
  }

  function apply(p) {
    list.querySelectorAll('.lvh[data-need]').forEach(h => {
      if (h.dataset.p !== p) return;
      h.removeAttribute('data-need');
      const t = thumbs.get(p);
      if (t) setImg(h, t);
    });
  }

  function pump() {
    while (active < 3 && queue.length) {
      const p = queue.shift();
      active++;
      (async () => {
        let r;
        try { r = await api.thumb(p); } catch { r = null; }
        thumbs.set(p, r && r.ok ? r.data : null);
        pending.delete(p);
        apply(p);
      })().finally(() => { active--; pump(); });
    }
  }

  function want(p) {
    if (!p || !api.thumb || thumbs.has(p) || pending.has(p)) return;
    pending.add(p); queue.push(p); pump();
  }

  function resetQueue() {
    for (const p of queue) pending.delete(p);
    queue.length = 0;
  }

  // Only ask Windows for thumbnails of cards that are (nearly) on screen.
  function watch() {
    if (io) io.disconnect();
    const need = list.querySelectorAll('.lvh[data-need]');
    if (!('IntersectionObserver' in window)) { need.forEach(h => want(h.dataset.p)); return; }
    io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { io.unobserve(e.target); want(e.target.dataset.p); }
    }), { root: list, rootMargin: '240px' });
    need.forEach(h => io.observe(h));
  }

  // A picture that fails to load falls back to the next choice instead of showing a broken icon.
  list.addEventListener('error', e => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement)) return;
    if (im.classList.contains('lvlogo')) { im.remove(); return; }
    const h = im.closest('.lvh');
    if (!h) return;
    const wasArt = im.dataset.k === 'art';
    im.remove();
    h.classList.add('ph');
    if (!h.querySelector('.ini')) h.insertAdjacentHTML('afterbegin', '<span class="ini">' + esc(h.dataset.i) + '</span>');
    if (!wasArt) return;
    const t = thumbs.get(h.dataset.p);
    if (t) setImg(h, t); else { h.dataset.need = '1'; want(h.dataset.p); }
  }, true);

  function card(f, i) {
    const p = parts(f.rel), n = pretty(p.name), a = f.art || {};
    const wide = a.wide || '', poster = a.poster || '';
    const src = wide || poster || thumbs.get(f.path) || '';
    const isArt = !!(wide || poster);
    const need = !src && thumbs.get(f.path) === undefined;
    const ini = initials(n.title);
    return '<button type="button" class="lvi" data-i="' + i + '" title="' + esc(f.rel) + '"' + (f.path === cur ? ' aria-current="true"' : '') + '>' +
      '<span class="lvh' + (src ? '' : ' ph') + '" data-p="' + esc(f.path) + '" data-i="' + esc(ini) + '"' + (need ? ' data-need="1"' : '') + ' style="--tint:' + tint(n.title) + '">' +
      (src ? '<img class="main' + (!wide && poster ? ' poster' : '') + '" data-k="' + (isArt ? 'art' : 'thumb') + '" src="' + esc(fileUrl(src)) + '" alt="" loading="lazy" decoding="async">' : '<span class="ini">' + esc(ini) + '</span>') +
      (a.logo ? '<img class="lvlogo" src="' + esc(fileUrl(a.logo)) + '" alt="' + esc(n.title) + ' logo" loading="lazy" decoding="async">' : '') +
      '<span class="sz">' + esc(fmt(f.size)) + '</span></span>' +
      '<span class="lvt"><b>' + esc(n.title) + '</b>' + (n.year ? '<span class="yr">' + esc(n.year) + '</span>' : '') +
      (p.folder ? '<small>' + esc(p.folder) + '</small>' : '') + '</span></button>';
  }

  function render() {
    const t = q.value.trim().toLowerCase();
    shown = files.filter(f => !t || f.rel.toLowerCase().includes(t));
    q.hidden = !files.length;
    view.hidden = !files.length;
    view.textContent = mode === 'cards' ? 'List view' : 'Card view';
    list.className = mode;
    re.disabled = busy || !dir;
    pick.disabled = busy;
    if (busy) dirEl.textContent = 'Looking for videos in ' + dir + '\u2026';
    else if (err) dirEl.innerHTML = '<span class="err">' + esc(err) + '</span>';
    else if (dir) dirEl.textContent = dir + ': ' + files.length + ' video' + (files.length === 1 ? '' : 's') +
      (t ? ' (' + shown.length + ' match)' : '') + (trunc ? '. Only the first 5,000 are listed.' : '.');
    else dirEl.textContent = '';
    if (!dir) list.innerHTML = '<div class="empty"><b>No folder chosen</b><span class="fx">Choose a folder and its videos are listed here. Click one to play it.</span></div>';
    else if (busy) list.innerHTML = '';
    else if (!files.length) list.innerHTML = err ? '' : '<div class="empty"><b>No videos found</b><span class="fx">Nothing in this folder or its subfolders looks like a video file (mp4, mkv, webm, mov, avi and similar).</span></div>';
    else if (!shown.length) list.innerHTML = '<p class="fx">No videos match that filter.</p>';
    else list.innerHTML = shown.map(card).join('');
    watch();
    syncNav();
  }

  // Playing a movie only moves the highlight, so the pictures are not reloaded.
  function mark() {
    list.querySelectorAll('.lvi').forEach(b => {
      const f = shown[+b.dataset.i];
      if (f && f.path === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    syncNav();
  }

  function syncNav() {
    const i = shown.findIndex(f => f.path === cur);
    prev.disabled = i <= 0;
    next.disabled = i < 0 || i >= shown.length - 1;
  }

  async function scan() {
    if (busy || !dir) return;
    busy = true; err = ''; resetQueue(); render();
    let r;
    try { r = await api.scan(dir); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    busy = false;
    if (!r || !r.ok) { files = []; trunc = false; err = (r && r.error) || 'The folder could not be read.'; }
    else {
      files = r.data.files.slice().sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true, sensitivity: 'base' }));
      trunc = !!r.data.truncated;
    }
    render();
  }

  function play(i) {
    const f = shown[i];
    if (!f) return;
    cur = f.path;
    const p = parts(f.rel), n = pretty(p.name);
    msg.hidden = true; ext.hidden = false;
    ttl.textContent = n.year ? n.title + ' (' + n.year + ')' : n.title;
    sub.textContent = f.path;
    box.hidden = false;
    const art = headerSrc(f);
    if (art) vid.poster = fileUrl(art); else vid.removeAttribute('poster');
    vid.src = fileUrl(f.path);
    const pr = vid.play();
    if (pr && pr.catch) pr.catch(() => {});
    mark();
    box.scrollIntoView({ block: 'nearest' });
  }

  function stop() {
    vid.pause();
    vid.removeAttribute('src');
    vid.removeAttribute('poster');
    vid.load();
    box.hidden = true; cur = '';
    mark();
  }

  vid.addEventListener('error', () => {
    if (!vid.getAttribute('src')) return;
    msg.textContent = 'This file could not be played inside the app. Its format or codec may not be supported. Use "Open in default player" instead.';
    msg.hidden = false;
  });
  vid.addEventListener('ended', () => {
    const i = shown.findIndex(f => f.path === cur);
    if (auto.checked && i >= 0 && i < shown.length - 1) play(i + 1);
  });

  pick.addEventListener('click', async () => {
    let d;
    try { d = await api.pick(); } catch { d = null; }
    if (!d) return;
    dir = d; setDir(d); files = []; q.value = '';
    if (cur) stop();
    scan();
  });
  re.addEventListener('click', () => {
    for (const [k, v] of thumbs) if (v === null) thumbs.delete(k);   // Refresh also retries missing thumbnails
    scan();
  });
  q.addEventListener('input', render);
  view.addEventListener('click', () => {
    mode = mode === 'cards' ? 'rows' : 'cards';
    try { localStorage.setItem(KV, mode); } catch {}
    render();
  });
  list.addEventListener('click', e => { const b = e.target.closest('.lvi'); if (b) play(+b.dataset.i); });
  prev.addEventListener('click', () => { const i = shown.findIndex(f => f.path === cur); if (i > 0) play(i - 1); });
  next.addEventListener('click', () => { const i = shown.findIndex(f => f.path === cur); if (i >= 0 && i < shown.length - 1) play(i + 1); });
  cls.addEventListener('click', stop);
  ext.addEventListener('click', async () => {
    let r = '';
    try { r = await api.open(cur); } catch (e) { r = String((e && e.message) || e); }
    if (r) { msg.textContent = 'Could not open it: ' + r; msg.hidden = false; }
    else { vid.pause(); toast('Opened in your default player'); }
  });

  // Called by the Media player page: refresh the list when the section is shown, pause when it is hidden.
  window.lvEnter = () => { dir = getDir(); if (dir) scan(); else render(); };
  window.lvPause = () => { vid.pause(); };
  render();
})();
