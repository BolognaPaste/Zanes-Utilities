// Web games backend.
//  - Lists browser games from GameMonetize's public game feed, which exists so other sites can show
//    and embed its HTML5 games. Only that feed is contacted, results are cached for 30 minutes, and
//    every game address and thumbnail is checked here before the page ever sees it.
//  - Optionally blocks requests to well-known advertising hosts (a switch on the page).
//  - Opens Coolmath Games in its own locked-down window. Coolmath has no public feed and its games
//    belong to other developers, so its catalog is not copied; the real site is simply shown.
const FEED = 'https://gamemonetize.com/rssfeed.php';
const HOSTS = new Set(['gamemonetize.com', 'rss.gamemonetize.com']);   // the feed redirects to rss.gamemonetize.com
const PLAY = /^https:\/\/html5\.gamemonetize\.co\/[a-z0-9]{8,64}\/?$/i;
const THUMB = /^https:\/\/img\.gamemonetize\.com\/[\w\/.-]+$/i;
const CATS = ['All', '.IO', '2 Player', '3D', 'Action', 'Adventure', 'Arcade', 'Clicker', 'Cooking', 'Hypercasual',
  'Multiplayer', 'Puzzle', 'Racing', 'Shooting', 'Soccer', 'Sports', 'Stickman'];
// Titles that are never shown (case-insensitive, matched anywhere in the title). Add more with | .
const BLOCKED_TITLES = /card[\s-]*match|match(ing)?[\s-]*(the[\s-]*|all[\s-]*|two[\s-]*|same[\s-]*)?cards?\b|memory[\s-]*(card|match|game)|cards?[\s-]*memory|pairs?[\s-]*(card|match)|match[\s-]*pairs?/i;
// Same idea for the feed's tags, so card-matching games with an ordinary title are caught too.
const BLOCKED_TAGS = /card[\s-]*match|memory[\s-]*card|matching[\s-]*cards?/i;
// Individual games that are never shown, matched as whole words anywhere in the title (case-insensitive).
const BLOCKED_GAMES = /\b(chips bakery simulator|box press puzzle|dragon ball super|adult-puzzles|goofy|pinocchio|ninja turtles|mowgli|smurfs|south park|donald duck|baby shark|winnie pooh|minions|heroes of might and magic|futurama|kim kardashian|little baby bum)\b/i;
// Games that are always offered, whether or not they are among the feed's newest 100. They are GameMonetize's own
// pages (the addresses are the ones its game pages publish for embedding) and go through the same checks as feed games.
const FEATURED = [
  { id: 'fbwg6', title: 'Fireboy and Watergirl 6', category: '2 Player', tags: 'Arcade,Fire,Water,2 Player,Fireboy,Watergirl',
    url: 'https://html5.gamemonetize.co/cym6sfm8kebf73562van2bwa2tdz4prh/', thumb: 'https://img.gamemonetize.com/cym6sfm8kebf73562van2bwa2tdz4prh/512x384.jpg',
    description: 'Teamwork puzzle platformer: collect the diamonds and get both characters to the exit.', instructions: 'Fireboy: arrow keys. Watergirl: W A S D.', width: 900, height: 600 },
  { id: 'fbwgforest', title: 'Forest Fireboy and Watergirl', category: 'Puzzle', tags: 'Arcade,Fire,Water,Multiplayer,Fireboy,Watergirl',
    url: 'https://html5.gamemonetize.co/1xvemgqh10s5oag3rrvukaeny2fd7ekk/', thumb: 'https://img.gamemonetize.com/1xvemgqh10s5oag3rrvukaeny2fd7ekk/512x384.jpg',
    description: 'Fireboy and Watergirl in a forest temple: push boxes, press switches and cooperate to get through.', instructions: 'Mouse click or tap to play.', width: 1280, height: 720 }
];
// A featured game shows under "All" and under its own category.
const featuredFor = category => normalize(FEATURED.filter(g => category === 'All' || g.category === category));
const AMOUNT = 100;                 // the largest page the feed offers besides "All"
const TTL = 30 * 60 * 1000;
const ADULT = /\badult\b|\b18\+|\bnsfw\b|\bsexy?\b|\bporn|\berotic/i;
const ADULT_COMPANY = 'Adult-Puzzles.com';   // a publisher in the feed's company list whose games are all for adults

// Advertising hosts. A request to any of these (or their subdomains) is cancelled while blocking is on.
const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'imasdk.googleapis.com',
  '2mdn.net', 'adnxs.com', 'adsrvr.org', 'amazon-adsystem.com', 'criteo.com', 'criteo.net', 'pubmatic.com', 'rubiconproject.com',
  'openx.net', 'casalemedia.com', 'indexww.com', 'taboola.com', 'outbrain.com', 'adinplay.com', 'moatads.com', 'adsafeprotected.com',
  'teads.tv', 'smartadserver.com', 'lijit.com', 'sharethrough.com', '33across.com', 'bidswitch.net', 'media.net', 'yieldmo.com',
  'connatix.com', 'spotx.tv', 'springserve.com', 'advertising.com', 'adform.net', 'adcolony.com', 'applovin.com', 'unityads.unity3d.com',
  'gadsme.com', 'a-mo.net', 'servedbyadbutler.com', 'adsco.re', 'exoclick.com', 'popads.net', 'propellerads.com'];
const isAdHost = h => AD_HOSTS.some(d => h === d || h.endsWith('.' + d));
const COOLMATH_HOST = /^([a-z0-9-]+\.)*(coolmathgames|coolmath-games|coolmath|coolmath4kids)\.com$/i;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '\u2014', ndash: '\u2013',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026' };
const decode = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  }
  return NAMED[e.toLowerCase()] ?? m;
});
// The feed HTML-encodes text, sometimes twice, and descriptions can contain links: reduce it all to plain text.
const plain = (s, max) => decode(decode(String(s || '')).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
const dim = (v, def) => { const n = Math.round(Number(v)); return n >= 200 && n <= 4000 ? n : def; };

function normalize(list, forceAdult) {
  const out = [];
  for (const g of Array.isArray(list) ? list : []) {
    if (!g || !PLAY.test(String(g.url)) || !THUMB.test(String(g.thumb))) continue;
    const title = plain(g.title, 100);
    if (!title || BLOCKED_TITLES.test(title) || BLOCKED_GAMES.test(title) || BLOCKED_TAGS.test(String(g.tags || ''))) continue;
    out.push({
      id: String(g.id || ''), title, url: g.url, thumb: g.thumb,
      adult: !!forceAdult || ADULT.test(String(g.tags || '') + ' ' + String(g.category || '') + ' ' + title),
      cat: plain(g.category, 40),
      tags: String(g.tags || '').split(',').map(t => plain(t, 30)).filter(Boolean).slice(0, 8),
      desc: plain(g.description, 400), how: plain(g.instructions, 300),
      w: dim(g.width, 800), h: dim(g.height, 600)
    });
  }
  return out;
}

function register(ipcMain, getWin, { app, net, session, shell, BrowserWindow }) {
  const cache = new Map();
  let blocking = true;

  // The blocker lives in the request pipeline of each session that shows games.
  function hookAds(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
      let host = '';
      try { host = new URL(d.url).hostname.toLowerCase(); } catch {}
      cb({ cancel: blocking && isAdHost(host) });
    });
  }
  app.whenReady().then(() => hookAds(session.defaultSession));
  ipcMain.handle('gms:ads', (_e, on) => { blocking = !!on; return { ok: true }; });

  async function fetchFeed(category, company) {
    const url = FEED + '?' + new URLSearchParams({ format: 'json', category, type: 'html5', popularity: 'newest', company, amount: String(AMOUNT) });
    const key = category + '|' + company;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': 'ZanesUtilities/1.0 (web games list)', Accept: 'application/json' }, signal: ac.signal });
      if (!res.ok) throw new Error('GameMonetize answered HTTP ' + res.status + '.');
      if (!HOSTS.has(new URL(res.url || url).hostname)) throw new Error('The feed redirected somewhere unexpected.');
      const text = await res.text();
      if (text.length > 10e6) throw new Error('The feed was larger than expected.');
      const v = normalize(JSON.parse(text), company === ADULT_COMPANY);
      cache.set(key, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The game list took too long to load.');
      if (e instanceof SyntaxError) throw new Error('GameMonetize sent an answer this app could not read.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  ipcMain.handle('gms:list', async (_e, req) => {
    const category = CATS.includes(req && req.category) ? req.category : 'All';
    try {
      let games = await fetchFeed(category, 'All');
      { const f = featuredFor(category), have = new Set(f.map(g => g.url)); games = f.concat(games.filter(g => !have.has(g.url))); }
      if (req && req.adult) {
        // Adult games are asked for separately; a failure here must not hide the normal list.
        try {
          const more = await fetchFeed('All', ADULT_COMPANY), seen = new Set(games.map(g => g.url));
          games = games.concat(more.filter(g => !seen.has(g.url)));
        } catch {}
      }
      return games.length ? { ok: true, data: { games } } : { ok: false, error: 'No games came back for "' + category + '". Try another category.' };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // Coolmath Games in a window of its own: no preload script, its own storage, all permissions refused
  // except fullscreen, and it can only navigate within Coolmath's own sites. Other links open in the browser.
  let cm = null;
  ipcMain.handle('gms:coolmath', () => {
    if (cm && !cm.isDestroyed()) { cm.focus(); return { ok: true }; }
    const ses = session.fromPartition('persist:coolmath');
    if (!ses._zHooked) {
      ses._zHooked = true;
      hookAds(ses);
      ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen'));
      ses.setPermissionCheckHandler((wc, perm) => perm === 'fullscreen');
    }
    cm = new BrowserWindow({
      width: 1200, height: 800, backgroundColor: '#0f161c', title: 'Coolmath Games', autoHideMenuBar: true,
      webPreferences: { partition: 'persist:coolmath', contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    const ok = u => { try { const x = new URL(u); return x.protocol === 'https:' && COOLMATH_HOST.test(x.hostname); } catch { return false; } };
    const out = u => { if (/^https?:/i.test(u)) shell.openExternal(u); };
    cm.webContents.setWindowOpenHandler(({ url }) => { if (ok(url)) cm.loadURL(url); else out(url); return { action: 'deny' }; });
    cm.webContents.on('will-navigate', (e, url) => { if (!ok(url)) { e.preventDefault(); out(url); } });
    cm.webContents.on('will-redirect', (e, url) => { if (!ok(url)) { e.preventDefault(); out(url); } });
    cm.loadURL('https://www.coolmathgames.com/');
    return { ok: true };
  });
}

module.exports = { register };
