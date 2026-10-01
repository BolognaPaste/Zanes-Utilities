// Ad / tracker blocker for the FMHY quick-link pop-out windows.
//
// uBlock Origin itself is a browser extension and cannot run inside Electron, so this uses the same filter
// lists and the same filter syntax (network rules, cosmetic "hide this element" rules and scriptlets) through
// the @ghostery/adblocker-electron engine. It is attached to one session only: the 'persist:fmhy-popup' one.
//
// The compiled engine is cached in the app's data folder, so only the very first launch (and a refresh once a
// week, or when asked for on the Settings page) has to download the lists. If the lists cannot be loaded the
// pages still open, just without blocking. status() reports what really happened, for the Settings page.
const path = require('path');
const fs = require('fs/promises');

// uBlock Origin's default lists, plus the EasyList family and Peter Lowe's host list it ships with.
const LISTS = [
  { name: 'uBlock filters', url: 'https://ublockorigin.github.io/uAssets/filters/filters.min.txt' },
  { name: 'uBlock filters: badware risks', url: 'https://ublockorigin.github.io/uAssets/filters/badware.min.txt' },
  { name: 'uBlock filters: privacy', url: 'https://ublockorigin.github.io/uAssets/filters/privacy.min.txt' },
  { name: 'uBlock filters: quick fixes', url: 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt' },
  { name: 'uBlock filters: unbreak', url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt' },
  { name: 'uBlock filters: resource abuse', url: 'https://ublockorigin.github.io/uAssets/filters/resource-abuse.min.txt' },
  { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  { name: 'Peter Lowe\'s ad and tracking servers', url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext' }
];
const URLS = LISTS.map(l => l.url);
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;   // re-download the lists after a week
const FETCH_TIMEOUT_MS = 30000;

const timedFetch = (url, opts) => fetch(url, Object.assign({}, opts, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }));
const exists = async p => { try { return await fs.stat(p); } catch { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cacheFile = app => path.join(app.getPath('userData'), 'adblock-engine.bin');

// Builds (or reads from the cache) the blocking engine and records in `info` what happened. Resolves to the
// engine; rejects if that was not possible. `force` throws the saved copy away first (the "Update now" button).
async function buildEngine(app, force, info) {
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  const file = cacheFile(app);
  const bak = file + '.bak';
  const caching = { path: file, read: fs.readFile, write: fs.writeFile };
  const config = { enableCompression: true, loadCosmeticFilters: true, loadNetworkFilters: true };

  const st = await exists(file);
  const stale = !!st && (force || Date.now() - st.mtimeMs > MAX_AGE_MS);
  info.source = st && !stale ? 'cache' : 'download';
  info.warning = '';
  if (stale) { await fs.copyFile(file, bak).catch(() => {}); await fs.rm(file, { force: true }); }
  let engine;
  try {
    engine = await ElectronBlocker.fromLists(timedFetch, URLS, config, caching);
  } catch (err) {
    // Refresh failed (offline?): keep using the old saved copy rather than going without.
    if (stale && await exists(bak)) {
      await fs.copyFile(bak, file).catch(() => {});
      engine = await ElectronBlocker.fromLists(timedFetch, URLS, config, caching);
      info.source = 'cache';
      info.warning = 'Could not download fresh lists (' + String((err && err.message) || err) + '), so the saved copy is being used.';
    } else throw err;
  } finally {
    if (stale) fs.rm(bak, { force: true }).catch(() => {});
  }

  // Confirm the engine really is on disk (the library writes it as it finishes, so give it a moment).
  let after = null;
  for (let i = 0; i < 10 && !(after && after.size > 0); i++) { after = await exists(file); if (!(after && after.size > 0)) await sleep(200); }
  info.cached = !!(after && after.size > 0);
  info.cachedAt = info.cached ? after.mtimeMs : 0;
  info.size = info.cached ? after.size : 0;
  try { const f = engine.getFilters(); info.filters = ((f && f.networkFilters) || []).length + ((f && f.cosmeticFilters) || []).length; } catch { info.filters = 0; }
  return engine;
}

// One guard per session. set(true / false) turns blocking on / off; warm() starts loading the lists early;
// refresh() downloads them again; status() describes the current state. `onChange` is called after every change.
function create(app, ses, onChange) {
  let loading = null, refreshing = null, want = false, enabled = false;
  const info = { state: 'idle', source: '', cached: false, cachedAt: 0, size: 0, filters: 0, error: '', warning: '' };
  const emit = () => { try { if (onChange) onChange(); } catch {} };

  const load = force => {
    if (!loading) {
      info.state = 'loading'; info.error = ''; emit();
      loading = buildEngine(app, !!force, info).then(
        e => { info.state = 'ready'; emit(); return e; },
        err => { loading = null; info.state = 'error'; info.error = String((err && err.message) || err); emit(); throw err; }
      );
    }
    return loading;
  };

  // Brings the session in line with `want`. Safe to call repeatedly and from several places.
  async function apply() {
    if (want) {
      const engine = await load();
      if (want && !enabled) { engine.enableBlockingInSession(ses); enabled = true; emit(); }
    } else if (enabled && loading) {
      const engine = await loading;
      if (!want && enabled) { engine.disableBlockingInSession(ses); enabled = false; emit(); }
    }
  }

  return {
    warm() { load().catch(() => {}); },

    // Resolves { on, ready, error }. Waits up to `waitMs` for the lists so the page that is about to open is
    // already covered; if that takes longer the page opens anyway and blocking switches on as soon as it is ready.
    async set(on, waitMs) {
      want = !!on;
      const done = apply().then(() => true, () => false);
      if (!want) { await done; return { on: false, ready: true, error: '' }; }
      const ok = await Promise.race([done, sleep(waitMs || 15000).then(() => null)]);
      if (ok === null) return { on: true, ready: false, error: '' };
      return { on: true, ready: ok, error: ok ? '' : info.error };
    },

    // Downloads every list again and replaces the saved copy. Blocking carries on with the new lists.
    refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const old = loading ? await loading.catch(() => null) : null;
        if (old && enabled) { old.disableBlockingInSession(ses); enabled = false; }
        loading = null;
        try { await load(true); if (info.state === 'ready') await apply(); } catch {}
      })().finally(() => { refreshing = null; });
      return refreshing;
    },

    async status() {
      const st = await exists(cacheFile(app));
      return Object.assign({}, info, {
        lists: LISTS.map(l => l.name),
        want, blocking: enabled,
        onDisk: !!st && st.size > 0, diskAt: st ? st.mtimeMs : 0, diskSize: st ? st.size : 0,
        maxAgeDays: MAX_AGE_MS / 86400000
      });
    }
  };
}

module.exports = { create, LISTS };
