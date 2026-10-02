// File shredder page and the shredding stats on the home page.
// Talks to shred-ipc.js through window.shredder (see preload.js). Uses $, esc and toast from index.html.
(function () {
  'use strict';
  const K = 'gca-shred-stats';
  const zero = { bytes: 0, files: 0, folders: 0, last: 0 };
  const load = () => { try { const s = JSON.parse(localStorage.getItem(K)); return { bytes: +s.bytes || 0, files: +s.files || 0, folders: +s.folders || 0, last: +s.last || 0 }; } catch { return { ...zero }; } };
  const save = s => { try { localStorage.setItem(K, JSON.stringify(s)); } catch {} };
  const size = n => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 || n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + u[i];
  };

  /* Home page stats */
  const sb = $('#ss-b'), sf = $('#ss-f'), sd = $('#ss-d'), sl = $('#ss-l'), reset = $('#ss-x');
  function renderStats() {
    const s = load();
    sb.textContent = size(s.bytes);
    sf.textContent = s.files.toLocaleString();
    sd.textContent = s.folders.toLocaleString();
    sl.textContent = s.last ? 'Last shred: ' + new Date(s.last).toLocaleString() : 'Nothing shredded yet.';
    reset.disabled = !(s.bytes || s.files || s.folders);
  }
  let armed = 0;
  const disarm = () => { clearTimeout(armed); armed = 0; reset.textContent = 'Delete stats'; };
  reset.addEventListener('click', () => {
    if (!armed) { reset.textContent = 'Click again to delete stats'; armed = setTimeout(disarm, 4000); return; }
    disarm();
    try { localStorage.removeItem(K); } catch {}
    renderStats();
    toast('Shredding stats deleted');
  });
  renderStats();

  /* Shredder page */
  const na = $('#sh-na'), addF = $('#sh-files'), addD = $('#sh-folder'), list = $('#sh-list');
  const hint = $('#sh-hint'), go = $('#sh-go'), clr = $('#sh-clear'), stop = $('#sh-stop'), res = $('#sh-res');
  const api = window.shredder;
  if (!api || !api.run) {
    na.hidden = false;
    [addF, addD, go, clr].forEach(b => { b.disabled = true; });
    return;
  }

  let items = [], busy = false, off = null;

  function render() {
    list.innerHTML = items.length
      ? items.map((it, i) => '<div class="it" title="' + esc(it.path) + '"><span><b>' + esc(it.path.split(/[\\/]/).filter(Boolean).pop() || it.path) + '</b><small>' +
          (it.kind === 'folder' ? 'Folder' : 'File') + ' \u00b7 ' + esc(it.path) + '</small></span>' +
          '<button type="button" data-rm="' + i + '" aria-label="Remove from list" title="Remove from list"' + (busy ? ' disabled' : '') + '>\u00d7</button></div>').join('')
      : '<p class="none">Nothing selected</p>';
    hint.textContent = items.length
      ? items.length + ' item' + (items.length === 1 ? '' : 's') + ' ready. Folders are shredded with everything inside them. You confirm once more before anything is destroyed.'
      : 'Use Add files or Add folders in the sidebar to choose what to shred.';
    go.textContent = 'Shred ' + items.length + ' item' + (items.length === 1 ? '' : 's');
    go.disabled = busy || !items.length;
    clr.disabled = busy || !items.length;
    addF.disabled = addD.disabled = busy;
  }

  async function add(kind) {
    let r;
    try { r = await api.pick(kind); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { res.innerHTML = '<p class="err">' + esc((r && r.error) || 'Could not open the picker.') + '</p>'; return; }
    res.innerHTML = '';
    r.data.items.forEach(it => { if (!items.some(x => x.path === it.path)) items.push(it); });
    if (r.data.skipped.length) res.innerHTML = '<p class="err">Protected system locations cannot be shredded: ' + r.data.skipped.map(esc).join(', ') + '</p>';
    render();
  }

  async function shred() {
    if (busy || !items.length) return;
    busy = true; render();
    stop.hidden = false;
    res.innerHTML = '<p class="fx" data-t>Starting\u2026</p><progress max="100"></progress>';
    const t = res.querySelector('[data-t]'), pb = res.querySelector('progress');
    off = api.onProgress(m => {
      if (m.t === 'finish') { t.textContent = 'Removing empty folders\u2026'; return; }
      if (m.t !== 'p') return;
      t.textContent = 'File ' + m.i + ' of ' + m.n + ': ' + m.name + ' (pass ' + m.pass + ' of ' + m.passes + ')';
      if (m.total) pb.value = Math.round(m.done / m.total * 100);
    });
    let r;
    try { r = await api.run(items.map(x => x.path)); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (off) { off(); off = null; }
    busy = false; stop.hidden = true;
    if (!r || !r.ok) {
      res.innerHTML = '<p class="' + (r && r.declined ? 'fx' : 'err') + '">' + esc((r && r.error) || 'The shred did not finish.') + '</p>';
      render();
      return;
    }
    const d = r.data;
    if (d.files || d.folders) {
      const s = load();
      s.bytes += d.bytes; s.files += d.files; s.folders += d.folders; s.last = Date.now();
      save(s); renderStats();
    }
    items = []; render();
    let html = '<p class="' + (d.failed.length || d.cancelled ? 'err' : 'dvok') + '">' +
      (d.cancelled ? 'Stopped. ' : '') + 'Shredded ' + d.files + ' file' + (d.files === 1 ? '' : 's') +
      (d.folders ? ' and ' + d.folders + ' folder' + (d.folders === 1 ? '' : 's') : '') + ' (' + size(d.bytes) + ', ' + d.passes + ' passes each).</p>';
    if (d.cancelled) html += '<p class="fx">The file being shredded when you stopped may be partly overwritten and is still on disk. Add it again to finish.</p>';
    if (d.failed.length) {
      html += '<p class="fx">These could not be shredded (often because another program is using them, or you lack permission):</p><div class="dvt"><table>' +
        d.failed.map(f => '<tr><th>' + esc(f.path) + '</th><td class="o">' + esc(f.error) + '</td></tr>').join('') + '</table></div>';
    }
    res.innerHTML = html;
  }

  addF.addEventListener('click', () => add('files'));
  addD.addEventListener('click', () => add('folders'));
  go.addEventListener('click', shred);
  clr.addEventListener('click', () => { items = []; res.innerHTML = ''; render(); });
  stop.addEventListener('click', () => { stop.disabled = true; api.cancel(); setTimeout(() => { stop.disabled = false; }, 1500); });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (b && !busy) { items.splice(+b.dataset.rm, 1); render(); }
  });
  render();
})();
