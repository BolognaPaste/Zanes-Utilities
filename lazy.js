(() => {
  'use strict';
  const SCRIPTS = {
    crash: ['xml-deep.js'],
    drv: ['drivers.js', 'vendor-ui.js'],
    shred: ['shred-ui.js'],
    vault: ['vault-ui.js'],
    media: ['video-ui.js'],
    games: ['games-ui.js'],
    fmhy: ['fmhy-ui.js'],
    settings: ['fmhy-ui.js'],
    phone: ['phone-ui.js'],
    opt: ['optimizer-ui.js'],
    test: ['chat-ui.js', 'test-ui.js'],
    ssh: ['node_modules/@xterm/xterm/lib/xterm.js', 'node_modules/@xterm/addon-fit/lib/addon-fit.js', 'ssh-ui.js']
  };

  const files = new Map();
  const tabs = new Map();
  const ready = new Set();

  const addScript = src => {
    if (files.has(src)) return files.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        s.remove();
        reject(new Error('Could not load ' + src + '.'));
      };
      document.body.appendChild(s);
    });
    files.set(src, p);
    p.catch(() => files.delete(src));
    return p;
  };

  function load(tab) {
    if (!SCRIPTS[tab]) return Promise.resolve();
    if (tabs.has(tab)) return tabs.get(tab);
    const p = (async () => {
      if (window.appTools) {
        const r = await window.appTools.load(tab);
        if (!r || r.ok === false) throw new Error((r && r.error) || 'This tool could not be loaded.');
      }
      for (const src of SCRIPTS[tab]) await addScript(src);
    })();
    tabs.set(tab, p);
    p.then(
      () => ready.add(tab),
      () => tabs.delete(tab)
    );
    return p;
  }

  const busy = (tab, on) => {
    const pg = document.getElementById('p-' + tab);
    if (!pg) return;
    pg.toggleAttribute('inert', on);
    if (on) pg.setAttribute('aria-busy', 'true');
    else pg.removeAttribute('aria-busy');
    const old = pg.querySelector(':scope > .lz-err');
    if (old) old.remove();
  };
  const fail = (tab, err) => {
    const pg = document.getElementById('p-' + tab);
    if (!pg) return;
    const p = document.createElement('p');
    p.className = 'err lz-err';
    p.setAttribute('role', 'alert');
    p.textContent = (err && err.message ? err.message : 'This tool could not be loaded.') + ' Click its name in the menu to try again.';
    pg.prepend(p);
  };

  document.querySelectorAll('.nv').forEach(b => {
    const tab = b.dataset.p;
    if (!SCRIPTS[tab]) return;
    b.addEventListener('click', () => {
      if (ready.has(tab)) return;
      busy(tab, true);
      load(tab).then(
        () => {
          busy(tab, false);
          if (b.getAttribute('aria-current') === 'page') b.click();
        },
        err => {
          busy(tab, false);
          fail(tab, err);
        }
      );
    });
  });

  try {
    if (localStorage.getItem('gca-dv-auto') !== '0') {
      const go = () => {
        load('drv').catch(() => {});
      };
      if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
      else setTimeout(go, 1500);
    }
  } catch (e) {}

  {
    const preloadAll = async () => {
      for (const tab of Object.keys(SCRIPTS)) {
        if (tab === 'drv') continue;
        try {
          await load(tab);
        } catch (e) {}
      }
    };
    const go = () => {
      preloadAll();
    };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
    if (window.appLock && window.appLock.onChange)
      window.appLock.onChange(m => {
        if (m && m.locked === false) preloadAll();
      });
  }
})();
