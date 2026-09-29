// Windows Update section of the Driver updater page: scanning for driver updates, selecting and
// installing them, and the collapsible list of currently installed drivers.
// Talks to driver-ipc.js through window.drivers (see preload.js). Uses $ and esc from index.html.
(function () {
  'use strict';
  const na = $('#dv-na'), scanBtn = $('#dv-scan'), instBtn = $('#dv-inst');
  const rp = $('#dv-rp'), auto = $('#dv-auto'), autoinst = $('#dv-autoinst');
  const msg = $('#dv-msg'), list = $('#dv-list'), res = $('#dv-res'), badge = $('#dv-badge');
  const det = $('#dv-det'), q = $('#dv-q'), old = $('#dv-old'), ic = $('#dv-ic'), ilist = $('#dv-ilist');
  if (!scanBtn) return;
  const api = window.drivers;

  const AUTO_K = 'gca-dv-auto', AUTOINST_K = 'gca-dv-autoinst';
  const getFlag = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
  const setFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };

  // Remember the last successful scan so the Home page preview can show it, even after a restart.
  const LAST_K = 'gca-dv-last';
  const saveLast = list => {
    try {
      localStorage.setItem(LAST_K, JSON.stringify({ at: Date.now(), items: list.slice(0, 100).map(i => ({ name: i.name || 'Driver update', ver: i.ver || '', mfr: i.mfr || '' })) }));
    } catch {}
    if (window.homeRender) window.homeRender();
  };

  if (!api || !api.scan) {
    if (na) na.hidden = false;
    scanBtn.disabled = true;
    if (instBtn) instBtn.disabled = true;
    if (auto) auto.disabled = true;
    if (autoinst) autoinst.disabled = true;
    if (rp) rp.disabled = true;
    return;
  }

  if (auto) auto.checked = getFlag(AUTO_K, true);
  if (autoinst) autoinst.checked = getFlag(AUTOINST_K, false);
  if (auto) auto.addEventListener('change', () => setFlag(AUTO_K, auto.checked));
  if (autoinst) autoinst.addEventListener('change', () => setFlag(AUTOINST_K, autoinst.checked));

  let items = [], offProgress = null;

  function updateBadge(n) {
    if (!badge) return;
    if (n > 0) { badge.textContent = String(n); badge.hidden = false; } else { badge.hidden = true; }
  }

  function updateSelected() {
    const n = list.querySelectorAll('input:checked').length;
    if (instBtn) { instBtn.disabled = n === 0; instBtn.textContent = 'Install selected (' + n + ')'; }
  }

  function card(it) {
    const bits = [it.mfr, it.cls, it.ver, it.date, it.mb ? it.mb + ' MB' : ''].filter(Boolean).join(' \u00b7 ');
    return '<label class="hi"><input type="checkbox" value="' + esc(it.id) + '">' +
      '<span><b>' + esc(it.name || 'Driver update') + '</b>' + (bits ? '<small>' + esc(bits) + '</small>' : '') + '</span></label>';
  }

  async function scan(auto) {
    scanBtn.disabled = true; res.innerHTML = ''; list.innerHTML = '';
    if (instBtn) { instBtn.disabled = true; instBtn.textContent = 'Install selected (0)'; }
    msg.className = 'fx'; msg.textContent = 'Checking Windows Update for driver updates\u2026 this can take a few minutes.';
    let r;
    try { r = await api.scan(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    scanBtn.disabled = false;
    if (!r || !r.ok) {
      msg.className = 'err'; msg.textContent = (r && r.error) || 'The scan failed.';
      updateBadge(0);
      return;
    }
    items = r.data || [];
    saveLast(items);
    updateBadge(items.length);
    if (!items.length) { msg.className = 'fx'; msg.textContent = 'No driver updates were found. Everything checked is current.'; return; }
    msg.className = 'fx';
    msg.textContent = items.length + ' driver update' + (items.length > 1 ? 's' : '') + ' found. Pick the ones to install below.';
    list.innerHTML = items.map(card).join('');
    updateSelected();
    if (auto && autoinst && autoinst.checked) {
      list.querySelectorAll('input').forEach(i => { i.checked = true; });
      updateSelected();
      install();
    }
  }

  async function install() {
    const ids = [...list.querySelectorAll('input:checked')].map(i => i.value);
    if (!ids.length) return;
    instBtn.disabled = true;
    list.querySelectorAll('input').forEach(i => i.disabled = true);
    res.innerHTML = '<p class="fx" data-t>Starting\u2026</p><progress></progress>';
    const t = res.querySelector('[data-t]');
    if (offProgress) offProgress();
    offProgress = api.onProgress ? api.onProgress(m => { if (m && m.m) t.textContent = m.m; }) : null;
    let r;
    try { r = await api.install(ids, !!(rp && rp.checked)); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (offProgress) { offProgress(); offProgress = null; }
    list.querySelectorAll('input').forEach(i => i.disabled = false);
    updateSelected();
    if (!r || !r.ok) {
      res.innerHTML = '<p class="err">' + esc((r && r.error) || 'The install did not finish.') + '</p>';
      return;
    }
    const d = r.data;
    let html = '<p class="' + (d.success ? 'dvok' : 'err') + '">' + esc(d.message || (d.success ? 'Done.' : 'Some drivers did not install.')) + '</p>';
    if (d.reboot) html += '<p class="fx">Restart your PC to finish installing.</p>';
    if (d.items && d.items.length) {
      html += '<div class="dvt"><table>' + d.items.map(it =>
        '<tr><th>' + esc(it.title) + '</th><td class="o">' + (it.code === 2 ? 'Installed' : 'Failed') + (it.reboot ? ', restart needed' : '') + '</td></tr>'
      ).join('') + '</table></div>';
    }
    if (d.warns && d.warns.length) html += d.warns.map(w => '<p class="fx">' + esc(w) + '</p>').join('');
    res.innerHTML = html;
    scan(false);
  }

  function fmtDate(s) { try { return s ? new Date(s).toLocaleDateString() : ''; } catch { return s || ''; } }
  const THREE_YEARS = 3 * 365 * 24 * 60 * 60 * 1000;

  async function loadInstalled() {
    ic.textContent = 'Listing installed drivers\u2026';
    let r;
    try { r = await api.installed(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { ic.textContent = (r && r.error) || 'Could not list installed drivers.'; return; }
    ilist._all = r.data || [];
    renderInstalled();
  }

  function renderInstalled() {
    const all = ilist._all || [];
    const term = (q.value || '').trim().toLowerCase();
    const cutoff = Date.now() - THREE_YEARS;
    const rows = all.filter(x => {
      if (term) {
        const hay = ((x.name || '') + ' ' + (x.mfr || '') + ' ' + (x.cls || '') + ' ' + (x.ver || '')).toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (old.checked) {
        const t = x.date ? Date.parse(x.date) : NaN;
        if (!t || t >= cutoff) return false;
      }
      return true;
    });
    ic.textContent = rows.length + ' of ' + all.length + ' installed driver' + (all.length === 1 ? '' : 's') + ' shown.';
    ilist.innerHTML = '<table><tr><th>Device</th><th>Maker</th><th>Class</th><th>Version</th><th>Date</th></tr>' +
      rows.map(x => '<tr><td>' + esc(x.name) + '</td><td class="o">' + esc(x.mfr) + '</td><td class="o">' + esc(x.cls) +
        '</td><td class="o">' + esc(x.ver) + '</td><td class="o">' + esc(fmtDate(x.date)) + '</td></tr>').join('') + '</table>';
  }

  scanBtn.addEventListener('click', () => scan(false));
  list.addEventListener('change', updateSelected);
  if (instBtn) instBtn.addEventListener('click', install);
  q.addEventListener('input', renderInstalled);
  old.addEventListener('change', renderInstalled);
  if (det) det.addEventListener('toggle', () => { if (det.open && !ilist._all) loadInstalled(); });

  if (auto && auto.checked) scan(true);
})();
