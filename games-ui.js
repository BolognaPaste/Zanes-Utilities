// Web games page: browse GameMonetize's free HTML5 games and play them inside the app.
// Talks to games-ipc.js through window.webGames (see preload.js). Uses $, esc from index.html.
// Games run in a sandboxed frame: no access to this page, no pop-ups, no top-level navigation.
(function () {
  'use strict';
  const sec = $('#gm-sec');
  if (!sec) return;
  const na = $('#gm-na'), cat = $('#gm-cat'), q = $('#gm-q'), re = $('#gm-re'), msg = $('#gm-msg'), list = $('#gm-list');
  const box = $('#gm-play'), frame = $('#gm-frame'), ttl = $('#gm-t'), how = $('#gm-how'), fs = $('#gm-fs'), cls = $('#gm-x');
  const ads = $('#gm-ads'), adultEl = $('#gm-adult'), cmOpen = $('#cm-open');
  const api = window.webGames;
  const K = 'gca-gm-cat', KA = 'gca-gm-ads', KX = 'gca-gm-adult';
  const flag = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
  const setFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };
  const CATS = ['All', '.IO', '2 Player', '3D', 'Action', 'Adventure', 'Arcade', 'Clicker', 'Cooking', 'Hypercasual',
    'Multiplayer', 'Puzzle', 'Racing', 'Shooting', 'Soccer', 'Sports', 'Stickman'];
  const PLAY = /^https:\/\/html5\.gamemonetize\.co\/[a-z0-9]{8,64}\/?$/i;
  const THUMB = /^https:\/\/img\.gamemonetize\.com\//i;

  if (!api || !api.list) {
    na.hidden = false;
    [cat, q, re, ads, adultEl, cmOpen].forEach(x => { x.disabled = true; });
    window.gmEnter = window.gmPause = () => {};
    return;
  }

  cat.innerHTML = CATS.map(c => '<option>' + esc(c) + '</option>').join('');
  try { const s = localStorage.getItem(K); if (CATS.includes(s)) cat.value = s; } catch {}

  ads.checked = flag(KA, true);
  adultEl.checked = flag(KX, false);
  const syncAds = () => { try { api.blockAds(ads.checked); } catch {} };
  syncAds();

  let games = [], shown = [], busy = false, loaded = false;

  async function load() {
    if (busy) return;
    busy = true; re.disabled = cat.disabled = true;
    msg.className = 'fx'; msg.textContent = 'Loading games\u2026'; list.innerHTML = '';
    let r;
    try { r = await api.list(cat.value, adultEl.checked); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    busy = false; re.disabled = cat.disabled = false;
    if (!r || !r.ok) {
      games = []; loaded = false;
      msg.className = 'err'; msg.textContent = (r && r.error) || 'The game list could not be loaded.';
      return;
    }
    games = r.data.games; loaded = true;
    render();
  }

  function render() {
    const t = q.value.trim().toLowerCase();
    shown = games.filter(g => (adultEl.checked || !g.adult) && (!t || (g.title + ' ' + g.cat + ' ' + g.tags.join(' ')).toLowerCase().includes(t)));
    msg.className = 'fx';
    msg.textContent = shown.length + ' game' + (shown.length === 1 ? '' : 's') + (t ? ' match' + (shown.length === 1 ? 'es' : '') : '') + '. Click one to play.';
    list.innerHTML = shown.length
      ? shown.map((g, i) => '<button type="button" class="gmc" data-i="' + i + '" title="' + esc(g.desc) + '">' +
          (THUMB.test(g.thumb) ? '<img src="' + esc(g.thumb) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<b>' + esc(g.title) + '</b><small>' + esc(g.cat) + '</small></button>').join('')
      : '<p class="fx">No games match that filter.</p>';
  }

  function play(i) {
    const g = shown[i];
    if (!g || !PLAY.test(g.url)) return;
    ttl.textContent = g.title;
    how.textContent = g.how || g.desc;
    frame.src = g.url;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  // A hidden frame keeps running and playing sound, so closing the game really unloads it.
  function stop() {
    frame.src = 'about:blank';
    box.hidden = true;
  }

  list.addEventListener('click', e => { const b = e.target.closest('.gmc'); if (b) play(+b.dataset.i); });
  cls.addEventListener('click', stop);
  fs.addEventListener('click', () => { if (frame.requestFullscreen) frame.requestFullscreen().catch(() => {}); });
  q.addEventListener('input', () => { if (loaded) render(); });
  cat.addEventListener('change', () => { try { localStorage.setItem(K, cat.value); } catch {} load(); });
  re.addEventListener('click', load);
  ads.addEventListener('change', () => {
    setFlag(KA, ads.checked); syncAds();
    if (!box.hidden) msg.textContent = 'Ad blocking changes apply the next time a game loads. Close the game and open it again.';
  });
  adultEl.addEventListener('change', () => {
    if (adultEl.checked && !confirm('Show games marked for adults (18+)? Only turn this on if you are 18 or older.')) { adultEl.checked = false; return; }
    setFlag(KX, adultEl.checked);
    load();
  });
  cmOpen.addEventListener('click', async () => {
    let r;
    try { r = await api.coolmath(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { msg.className = 'err'; msg.textContent = (r && r.error) || 'Coolmath Games could not be opened.'; }
  });

  // Called by the page navigation: load on first visit, unload the game when leaving.
  window.gmEnter = () => { if (!loaded && !busy) load(); };
  window.gmPause = stop;
})();
