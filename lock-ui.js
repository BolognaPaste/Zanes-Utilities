// App lock, page side: the lock screen, the padlock at the bottom of the menu and the "App lock" section of
// Settings. The lock itself is enforced by the main process (lock-ipc.js); this file only draws it and talks to
// it through window.appLock (see preload.js). It uses nothing from the other scripts except the optional toast and
// page pause functions, so the lock screen keeps working even if another script fails.
(function () {
  'use strict';
  const q = s => document.querySelector(s);
  const root = document.documentElement;
  const api = window.appLock;
  const note = t => { try { if (typeof toast === 'function') toast(t); } catch {} };

  const svg = d => '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="' + d + '"/></svg>';
  const SHUT = svg('M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z');
  const OPEN = svg('M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z');

  const nb = q('#lk-nav'), pw = q('#lk-pw'), go = q('#lk-go'), err = q('#lk-err');

  // Settings page: the buttons in the left column jump to their section (works with or without the lock).
  document.querySelectorAll('.sxp .sx-act[data-sj]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.sxp .sx-act[data-sj]').forEach(x => x.removeAttribute('data-on'));
    b.setAttribute('data-on', '1');
    const t = q('#' + b.dataset.sj);
    if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    held = true;                    // keep the clicked one lit while the page glides there
  }));

  // Settings page: as the page on the right scrolls, the left column lights up the section that is in view.
  let held = false;
  (function spy() {
    const body = q('#p-settings .sx-body');
    if (!body) return;
    const btns = Array.from(document.querySelectorAll('#p-settings .sx-act[data-sj]'));
    const pairs = () => btns.map(b => ({ b, el: q('#' + b.dataset.sj) })).filter(p => p.el);
    let raf = 0;
    const update = () => {
      raf = 0;
      if (held) return;
      const ps = pairs();
      if (!ps.length) return;
      const top = body.getBoundingClientRect().top;
      let cur = ps[0];
      ps.forEach(p => { if (p.el.getBoundingClientRect().top - top <= 80) cur = p; });
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) cur = ps[ps.length - 1];
      btns.forEach(x => { if (x === cur.b) x.setAttribute('data-on', '1'); else x.removeAttribute('data-on'); });
    };
    body.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    ['wheel', 'touchmove', 'keydown', 'pointerdown'].forEach(ev => body.addEventListener(ev, () => { held = false; }, { passive: true }));
  })();

  // Settings page: whether the saved data is being encrypted (secure-store.js).
  (function dataProtection() {
    const el = q('#dp-status');
    if (!el) return;
    const ss = window.secureStore;
    if (!ss || !ss.status) { el.textContent = 'Data protection only works in the Zane\'s Utilities desktop app.'; return; }
    ss.status().then(r => {
      if (r && r.on && r.method === 'dpapi') el.textContent = 'Active. Saved data is encrypted with ' + r.algo + '. The key is protected by your Windows account.';
      else if (r && r.on) el.textContent = 'Active, but Windows could not protect the key on this PC, so it is stored in a private file next to the data. The data is still encrypted.';
      else el.textContent = 'Not active: encryption could not start, so data is saved the normal way. Restart the app to try again.';
    }).catch(() => { el.textContent = 'Could not check.'; });
  })();

  if (!api) {                       // opened outside the desktop app: nothing to lock
    if (nb) nb.hidden = true;
    const s = q('#lk-status');
    if (s) s.textContent = 'App lock only works in the Zane\'s Utilities desktop app.';
    return;
  }

  let st = { enabled: false, locked: false, auto: 0, dir: '' };
  let startedLocked = !!api.startLocked, reloading = false, waitTimer = 0, busy = false;

  // ---- Lock screen ----------------------------------------------------------------------------------------
  const enable = on => { if (pw) pw.disabled = !on; if (go) go.disabled = !on; };

  // Things that would sit on top of the lock screen or keep going behind it are put away first.
  function pauseAll() {
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
    for (const f of ['fmPause', 'phPause', 'lvPause']) { try { if (typeof window[f] === 'function') window[f](); } catch {} }
    try { if (typeof closeMenu === 'function') closeMenu(); if (typeof closeDlg === 'function') closeDlg(); } catch {}
  }

  // Bring back what was on screen when the lock came on (only the FMHY view and the Phone page need it).
  function resume() {
    const cur = q('nav .nv[aria-current="page"]'), p = cur && cur.dataset.p;
    try {
      if (p === 'fmhy' && typeof window.fmEnter === 'function') window.fmEnter();
      else if (p === 'phone' && typeof window.phEnter === 'function') window.phEnter();
    } catch {}
  }

  function setLocked(v) {
    st.locked = v;
    if (v) {
      pauseAll();
      root.classList.add('locked');
      pw.value = ''; err.textContent = '';
      clearInterval(waitTimer); enable(true);
      setTimeout(() => pw.focus(), 30);
      return;
    }
    if (!root.classList.contains('locked') || reloading) return;
    if (startedLocked) {
      // The page was loaded while locked, so its start-up requests were all refused. Load it again, now unlocked.
      reloading = true;
      location.reload();
      return;
    }
    root.classList.remove('locked');
    pw.value = '';
    resume();
  }

  function countdown(sec) {
    clearInterval(waitTimer); enable(false);
    const end = Date.now() + sec * 1000;
    const tick = () => {
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left <= 0) { clearInterval(waitTimer); err.textContent = ''; enable(true); pw.focus(); return; }
      err.textContent = 'Too many wrong attempts. Try again in ' + left + ' s.';
    };
    tick(); waitTimer = setInterval(tick, 500);
  }

  async function tryUnlock() {
    if (busy || !pw.value) return;
    busy = true; enable(false); err.textContent = '';
    let r;
    try { r = await api.unlock(pw.value); } catch { r = { ok: false, error: 'Could not unlock. Try again.' }; }
    busy = false;
    pw.value = '';
    if (r && r.ok) { setLocked(false); return; }
    if (r && r.wait > 0) { countdown(r.wait); return; }
    enable(true);
    err.textContent = (r && r.error) || 'Wrong password.';
    pw.focus();
  }

  go.addEventListener('click', tryUnlock);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); } });
  if (api.onChange) api.onChange(m => { if (m && typeof m.locked === 'boolean') setLocked(m.locked); });

  // ---- Padlock at the bottom of the menu --------------------------------------------------------------------
  function toSettings(id) {
    const s = q('.nv[data-p="settings"]');
    if (s) s.click();
    const j = q('.sxp .sx-act[data-sj="' + id + '"]');
    if (j) j.click();
  }
  if (nb) nb.addEventListener('click', async () => {
    if (!st.enabled) return toSettings('lk-card');          // no password yet: go and set one up
    try { const r = await api.lock(); if (r && r.ok === false) note(r.error || 'Could not lock.'); }
    catch { note('Could not lock.'); }
  });

  // ---- Settings section ---------------------------------------------------------------------------------------
  function settings() {
    const E = id => document.getElementById(id);
    const msg = E('lk-msg');
    if (!msg) return;
    const say = (t, bad) => { msg.textContent = t || ''; msg.className = bad ? 'err' : 'fx'; };
    const val = id => E(id).value;
    const clear = (...ids) => ids.forEach(i => { E(i).value = ''; });
    const fail = r => say(((r && r.error) || 'Something went wrong.') + (r && r.wait > 0 ? ' Try again in ' + r.wait + ' s.' : ''), true);
    const run = (btn, fn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await fn(); } catch { say('Something went wrong. Try again.', true); } finally { btn.disabled = false; }
    });

    window.lkPaint = () => {
      if (nb) {
        nb.innerHTML = st.enabled ? SHUT : OPEN;
        nb.dataset.on = st.enabled ? '1' : '0';
        const t = st.enabled ? 'Lock app' : 'Set up app lock';
        nb.title = t; nb.setAttribute('aria-label', t);
      }
      E('lk-off').hidden = st.enabled;
      E('lk-onbox').hidden = !st.enabled;
      E('lk-dir').hidden = !st.enabled;
      const s = E('lk-status');
      s.textContent = st.enabled ? 'App lock is on' : 'App lock is off. Anyone who opens the app can use it.';
      s.className = st.enabled ? 'lk-st on' : 'lk-st';
      E('lk-auto').value = String(st.auto || 0);
      E('lk-dir').textContent = st.enabled
        ? 'Forgot the password? There is no reset. The lock can only be taken off by deleting the file app-lock.json from this folder: ' + (st.dir || 'the app data folder')
        : '';
    };

    run(E('lk-set'), async () => {
      const a = val('lk-n1');
      if (a.length < 4) return say('Use at least 4 characters.', true);
      if (a !== val('lk-n2')) return say('The two passwords do not match.', true);
      const r = await api.set(a);
      if (!r || !r.ok) return fail(r);
      clear('lk-n1', 'lk-n2');
      await refresh();
      say('App lock is on. The app will ask for this password each time it opens.');
      note('App lock is on');
    });

    run(E('lk-chg'), async () => {
      const a = val('lk-p1');
      if (!val('lk-c')) return say('Enter your current password.', true);
      if (a.length < 4) return say('Use at least 4 characters.', true);
      if (a !== val('lk-p2')) return say('The two new passwords do not match.', true);
      const r = await api.set(a, val('lk-c'));
      if (!r || !r.ok) return fail(r);
      clear('lk-c', 'lk-p1', 'lk-p2');
      say('Password changed.');
      note('Password changed');
    });

    run(E('lk-rm'), async () => {
      if (!val('lk-rc')) return say('Enter your current password.', true);
      const r = await api.remove(val('lk-rc'));
      if (!r || !r.ok) return fail(r);
      clear('lk-rc');
      await refresh();
      say('App lock is off.');
      note('App lock is off');
    });

    run(E('lk-now'), async () => {
      const r = await api.lock();
      if (r && r.ok === false) fail(r);
    });

    E('lk-auto').addEventListener('change', async () => {
      try {
        const r = await api.auto(+E('lk-auto').value);
        if (!r || !r.ok) { fail(r); await refresh(); return; }
        st.auto = +E('lk-auto').value;
        say(st.auto ? 'The app will lock after ' + st.auto + (st.auto === 1 ? ' minute' : ' minutes') + ' without keyboard or mouse use.' : 'Auto-lock is off.');
      } catch { say('Could not save that.', true); }
    });

    document.querySelectorAll('#lk-card input').forEach(i => i.addEventListener('input', () => say('')));
  }

  async function refresh() {
    st = Object.assign(st, await api.state());
    if (typeof window.lkPaint === 'function') window.lkPaint();
  }

  try { settings(); } catch (e) { /* the lock screen above still works if the Settings form fails */ }
  refresh().catch(() => {}).then(() => {
    if (st.locked) startedLocked = true;
    if (st.locked || root.classList.contains('locked')) setLocked(true);
  });
})();
