const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const LISTS = [
  { name: 'uBlock filters', url: 'https://ublockorigin.github.io/uAssets/filters/filters.min.txt' },
  { name: 'uBlock filters: badware risks', url: 'https://ublockorigin.github.io/uAssets/filters/badware.min.txt' },
  { name: 'uBlock filters: privacy', url: 'https://ublockorigin.github.io/uAssets/filters/privacy.min.txt' },
  { name: 'uBlock filters: quick fixes', url: 'https://ublockorigin.github.io/uAssets/filters/quick-fixes.min.txt' },
  { name: 'uBlock filters: unbreak', url: 'https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt' },
  { name: 'uBlock filters: resource abuse', url: 'https://ublockorigin.github.io/uAssets/filters/resource-abuse.txt' },
  { name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  {
    name: "Peter Lowe's ad and tracking servers",
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext'
  }
];
const URLS = LISTS.map(l => l.url);
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 45000;

const timedFetch = (url, opts, ms) => {
  const o = Object.assign({}, opts, { signal: AbortSignal.timeout(ms || FETCH_TIMEOUT_MS) });
  let f = null;
  try {
    f = require('electron').net;
  } catch {}
  return f && f.fetch ? f.fetch(url, o) : fetch(url, o);
};
const exists = async p => {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cacheFile = app => path.join(app.getPath('userData'), 'adblock-engine.bin');

const listsDir = app => path.join(app.getPath('userData'), 'adblock-lists');
const listFile = (app, url) => path.join(listsDir(app), crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.txt');
const LOOKS_HTML = /^\s*<(!doctype|html|head|body)\b/i;
const why = e =>
  e && (e.name === 'TimeoutError' || e.name === 'AbortError')
    ? 'it took too long to answer'
    : String((e && e.message) || e || 'unknown error').slice(0, 160);

async function downloadList(url, fetcher) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1500);
    try {
      const res = await fetcher(url, { headers: { Accept: 'text/plain, */*' } });
      if (!res.ok) throw new Error('the server answered HTTP ' + res.status);
      const text = await res.text();
      if (text.length < 200) throw new Error('the answer was empty');
      if (LOOKS_HTML.test(text.slice(0, 300))) throw new Error('the server sent a web page instead of a list');
      return text;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function listFetcher(app, stats, fetcher) {
  fetcher = fetcher || timedFetch;
  const ok = text => new Response(text, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return async (url, opts) => {
    if (!URLS.includes(url)) return fetcher(url, opts);
    const name = (LISTS.find(l => l.url === url) || {}).name || url;
    const file = listFile(app, url);
    try {
      const text = await downloadList(url, fetcher);
      stats.fetched++;
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file + '.tmp', text);
        await fs.rename(file + '.tmp', file);
      } catch {}
      return ok(text);
    } catch (err) {
      let saved = '';
      try {
        saved = await fs.readFile(file, 'utf8');
      } catch {}
      if (saved) {
        stats.saved++;
        stats.problems.push({ name, why: why(err), saved: true });
        return ok(saved);
      }
      stats.missing++;
      stats.problems.push({ name, why: why(err), saved: false });
      return ok('');
    }
  };
}

async function buildEngine(app, force, info, fetcher) {
  let ElectronBlocker;
  try {
    ({ ElectronBlocker } = require('@ghostery/adblocker-electron'));
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND')
      throw new Error(
        'The ad blocker component (@ghostery/adblocker-electron) is not installed. Open a terminal in the app folder, run "npm install", then start the app again.'
      );
    throw e;
  }
  const file = cacheFile(app);
  const bak = file + '.bak';
  const caching = { path: file, read: fs.readFile, write: fs.writeFile };
  const config = { enableCompression: true, loadCosmeticFilters: true, loadNetworkFilters: true };
  const stats = { fetched: 0, saved: 0, missing: 0, problems: [] };
  const lists = listFetcher(app, stats, fetcher);

  const waitForFile = async () => {
    let after = null;
    for (let i = 0; i < 10 && !(after && after.size > 0); i++) {
      after = await exists(file);
      if (!(after && after.size > 0)) await sleep(200);
    }
    return after && after.size > 0 ? after : null;
  };

  const st = await exists(file);
  const stale = !!st && (force || Date.now() - st.mtimeMs > MAX_AGE_MS);
  info.source = st && !stale ? 'cache' : 'download';
  info.warning = '';
  let restored = false;
  if (stale) {
    await fs.copyFile(file, bak).catch(() => {});
    await fs.rm(file, { force: true });
  }
  let engine;
  try {
    engine = await ElectronBlocker.fromLists(lists, URLS, config, caching);
    if (stats.fetched + stats.saved === 0 && stats.missing > 0) {
      await waitForFile();
      await fs.rm(file, { force: true });
      throw new Error(
        'No filter list could be downloaded and none is saved yet. ' + stats.problems[0].name + ': ' + stats.problems[0].why + '.'
      );
    }
  } catch (err) {
    if (stale && (await exists(bak))) {
      await fs.copyFile(bak, file).catch(() => {});
      engine = await ElectronBlocker.fromLists(lists, URLS, config, caching);
      info.source = 'cache';
      restored = true;
      info.warning = 'Could not download fresh lists (' + String((err && err.message) || err) + '), so the saved copy is being used.';
    } else throw err;
  } finally {
    if (stale) fs.rm(bak, { force: true }).catch(() => {});
  }

  let partial = false;
  if (!restored && stats.fetched + stats.saved + stats.missing > 0) {
    info.source = stats.fetched ? 'download' : 'cache';
    if (stats.problems.length) {
      info.warning =
        'Some lists could not be downloaded: ' +
        stats.problems.map(p => p.name + ' (' + p.why + (p.saved ? '; the saved copy was used' : '; skipped for now') + ')').join(', ') +
        '.';
      partial = stats.missing > 0;
    }
  }

  let after = await waitForFile();
  if (partial && after) {
    await fs.rm(file, { force: true });
    after = null;
  }
  info.cached = !!after;
  info.cachedAt = after ? after.mtimeMs : 0;
  info.size = after ? after.size : 0;
  try {
    const f = engine.getFilters();
    info.filters = ((f && f.networkFilters) || []).length + ((f && f.cosmeticFilters) || []).length;
  } catch {
    info.filters = 0;
  }
  return engine;
}

function create(app, ses, onChange) {
  let loading = null,
    refreshing = null,
    want = false,
    enabled = false;
  const info = { state: 'idle', source: '', cached: false, cachedAt: 0, size: 0, filters: 0, error: '', warning: '' };
  const emit = () => {
    try {
      if (onChange) onChange();
    } catch {}
  };

  const load = force => {
    if (!loading) {
      info.state = 'loading';
      info.error = '';
      emit();
      loading = buildEngine(app, !!force, info).then(
        e => {
          info.state = 'ready';
          emit();
          return e;
        },
        err => {
          loading = null;
          info.state = 'error';
          info.error = String((err && err.message) || err);
          emit();
          throw err;
        }
      );
    }
    return loading;
  };

  async function apply() {
    if (want) {
      const engine = await load();
      if (want && !enabled) {
        engine.enableBlockingInSession(ses);
        enabled = true;
        emit();
      }
    } else if (enabled && loading) {
      const engine = await loading;
      if (!want && enabled) {
        engine.disableBlockingInSession(ses);
        enabled = false;
        emit();
      }
    }
  }

  return {
    warm() {
      load().catch(() => {});
    },

    async set(on, waitMs) {
      want = !!on;
      const done = apply().then(
        () => true,
        () => false
      );
      if (!want) {
        await done;
        return { on: false, ready: true, error: '' };
      }
      const ok = await Promise.race([done, sleep(waitMs || 15000).then(() => null)]);
      if (ok === null) return { on: true, ready: false, error: '' };
      return { on: true, ready: ok, error: ok ? '' : info.error };
    },

    refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const old = loading ? await loading.catch(() => null) : null;
        if (old && enabled) {
          old.disableBlockingInSession(ses);
          enabled = false;
        }
        loading = null;
        try {
          await load(true);
          if (info.state === 'ready') await apply();
        } catch {}
      })().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },

    async status() {
      const st = await exists(cacheFile(app));
      return Object.assign({}, info, {
        lists: LISTS.map(l => l.name),
        want,
        blocking: enabled,
        onDisk: !!st && st.size > 0,
        diskAt: st ? st.mtimeMs : 0,
        diskSize: st ? st.size : 0,
        maxAgeDays: MAX_AGE_MS / 86400000
      });
    }
  };
}

module.exports = { create, LISTS, _listFetcher: listFetcher };
