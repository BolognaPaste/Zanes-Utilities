// Manufacturer section of the Driver updater page: graphics, Wi-Fi, Bluetooth and chipset drivers,
// plus manual-check entries and a link to the PC maker's driver page.
// Talks to vendor-ipc.js through window.drivers (see preload.js). Uses $ and esc from index.html.
(function () {
  'use strict';
  const btn = $('#vn-check'), msg = $('#vn-msg'), list = $('#vn-list');
  if (!btn) return;
  const api = window.drivers;
  if (!api || !api.vendors) {
    btn.disabled = true;
    msg.textContent = 'Manufacturer checks only work in the Zane\'s Utilities desktop app on Windows.';
    return;
  }

  const STATUS = {
    newer: ['Update available', 'dvw'],
    current: ['Up to date', 'dvok'],
    unknown: ['Could not compare', 'fx'],
    manual: ['Check manually', 'fx']
  };
  const ORDER = ['Graphics', 'Wi-Fi', 'Bluetooth', 'Chipset', 'Other', 'PC maker'];
  const mb = n => (n / 1048576).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
  const row = (k, v) => v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : '';
  const safeHref = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };

  let offProgress = null;

  function card(it, i) {
    const st = STATUS[it.status] || STATUS.unknown;
    const page = safeHref(it.page);
    let acts = '';
    if (it.download && it.status !== 'current') acts += '<button type="button" data-a="dl" data-i="' + i + '">Download ' + esc(it.latest || 'driver') + (it.size ? ' (' + esc(it.size) + ')' : '') + '</button>';
    if (page) acts += '<a class="ob" href="' + esc(page) + '" target="_blank" rel="noopener">' + (it.download ? 'Release notes' : it.status === 'manual' ? 'Open driver page' : 'Open ' + esc(it.vendor) + ' page') + '</a>';
    return '<div class="vnc" id="vn-c' + i + '">' +
      '<div class="vh"><b>' + esc(it.gpu) + '</b><span class="' + st[1] + '">' + st[0] + '</span></div>' +
      '<dl>' + row('Installed', it.installed) + row('Newest from ' + it.vendor, it.latest) + row('Released', it.released) + row('Checked via', it.source) + '</dl>' +
      (it.note ? '<p class="fx">' + esc(it.note) + '</p>' : '') +
      '<div class="bar" data-bar>' + acts + '</div><div data-prog></div></div>';
  }

  async function check() {
    btn.disabled = true; list.innerHTML = ''; msg.textContent = 'Asking the manufacturers\u2026 this can take up to a minute.';
    let r;
    try { r = await api.vendors(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    btn.disabled = false;
    if (!r || !r.ok) { msg.textContent = (r && r.error) || 'The check failed.'; msg.className = 'err'; return; }
    msg.className = 'fx';
    const items = (r.data || []).slice().sort((a, b) => {
      const x = ORDER.indexOf(a.category || 'Graphics'), y = ORDER.indexOf(b.category || 'Graphics');
      return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    });
    if (!items.length) { msg.textContent = 'Nothing to check was found in this PC.'; return; }
    const n = items.filter(x => x.status === 'newer').length;
    const m = items.filter(x => x.status === 'manual').length;
    msg.textContent = (n ? n + ' driver update' + (n > 1 ? 's' : '') + ' available.' : 'Nothing newer was found for the drivers that could be checked.') +
      (m ? ' ' + m + ' item' + (m > 1 ? 's' : '') + ' need a manual look (see below).' : '');
    let last = null, html = '';
    items.forEach((it, i) => {
      const c = it.category || 'Graphics';
      if (c !== last) { html += '<h3 class="vnh">' + esc(c === 'Other' ? 'Other devices' : c === 'PC maker' ? 'Your PC maker' : c) + '</h3>'; last = c; }
      html += card(it, i);
    });
    list.innerHTML = html;
    list._items = items;
  }

  async function download(i, box) {
    const it = list._items && list._items[i];
    if (!it || !it.download) return;
    const bar = box.querySelector('[data-bar]'), prog = box.querySelector('[data-prog]');
    bar.querySelectorAll('button').forEach(b => b.disabled = true);
    prog.innerHTML = '<progress max="100" value="0"></progress><p class="fx" data-t>Starting download\u2026</p>';
    const pb = prog.querySelector('progress'), pt = prog.querySelector('[data-t]');
    if (offProgress) offProgress();
    offProgress = api.onDownload(m => {
      if (m.t === 'dl') {
        if (m.total) { pb.value = Math.round(m.got / m.total * 100); pt.textContent = 'Downloading ' + mb(m.got) + ' of ' + mb(m.total); }
        else { pb.removeAttribute('value'); pt.textContent = 'Downloading ' + mb(m.got); }
      } else if (m.t === 'verify') { pb.removeAttribute('value'); pt.textContent = 'Checking the NVIDIA digital signature\u2026'; }
    });
    let r;
    try { r = await api.download(it.download); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (offProgress) { offProgress(); offProgress = null; }
    if (!r || !r.ok) {
      prog.innerHTML = '<p class="err">' + esc((r && r.error) || 'The download failed.') + '</p>';
      bar.querySelectorAll('button').forEach(b => b.disabled = false);
      return;
    }
    const d = r.data;
    prog.innerHTML = '<p class="fx"><span class="dvok">Verified.</span> Saved as ' + esc(d.name) + ' in your Downloads\\ZanesUtilities folder. Signed by ' + esc(d.subject) + '.</p>' +
      '<div class="bar"><button type="button" data-run>Run installer</button></div>';
    prog.querySelector('[data-run]').addEventListener('click', async ev => {
      ev.target.disabled = true;
      let x;
      try { x = await api.runInstaller(d.file); } catch (e) { x = { ok: false, error: String((e && e.message) || e) }; }
      ev.target.disabled = false;
      if (x && x.ok) ev.target.textContent = 'Installer started';
      else prog.insertAdjacentHTML('beforeend', '<p class="err">' + esc((x && x.error) || 'The installer did not start.') + '</p>');
    });
  }

  btn.addEventListener('click', check);
  list.addEventListener('click', e => {
    const b = e.target.closest('button[data-a="dl"]');
    if (b) download(+b.dataset.i, b.closest('.vnc'));
  });
})();
