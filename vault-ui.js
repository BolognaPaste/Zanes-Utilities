// Encrypted vault page: create or unlock a vault, add files, extract them, remove them, change the password.
// Talks to vault-ipc.js through window.vault (see preload.js). Uses $, esc and toast from index.html.
// The page only ever holds the file list. Keys stay in the main process, and file paths come from native dialogs.
(function () {
  'use strict';
  const na = $('#vt-na'), lockedV = $('#vt-locked'), openV = $('#vt-unlocked'), res = $('#vt-res');
  const api = window.vault;
  if (!api || !api.create) {
    na.hidden = false; lockedV.hidden = true;
    return;
  }

  const pick = $('#vt-pick'), fileEl = $('#vt-file'), pw = $('#vt-pw'), unlock = $('#vt-unlock');
  const np = $('#vt-np'), np2 = $('#vt-np2'), meter = $('#vt-meter'), show = $('#vt-show'), create = $('#vt-create');
  const info = $('#vt-info'), addF = $('#vt-addf'), addD = $('#vt-addd'), ext = $('#vt-ext'), rm = $('#vt-rm');
  const q = $('#vt-q'), allW = $('#vt-allw'), all = $('#vt-all'), list = $('#vt-list');
  const cpb = $('#vt-cpb'), lockB = $('#vt-lockb'), cp = $('#vt-cp');
  const op = $('#vt-op'), nw = $('#vt-nw'), nw2 = $('#vt-nw2'), cps = $('#vt-cps'), cpx = $('#vt-cpx');

  const ROWS = 2000;
  const size = n => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 || n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)) + ' ' + u[i];
  };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const say = (cls, t) => { res.innerHTML = '<p class="' + cls + '">' + esc(t) + '</p>'; };
  const errOf = e => String((e && e.message) || e);

  let vault = null, picked = null, busy = false, cur = null;
  const sel = new Set();

  /* Progress from the main process (also carries the auto-lock notice) */
  api.onProgress(m => {
    if (!m) return;
    if (m.t === 'locked') {
      show_(null);
      say('fx', 'The vault locked itself after 10 minutes without use. Enter the password to open it again.');
    } else if (m.t === 'p' && cur) {
      cur.t.textContent = cur.label + ' ' + m.name;
      if (m.total) cur.pb.value = Math.round(m.done / m.total * 100);
    }
  });

  function setBusy(b) {
    busy = b;
    [pick, unlock, create, addF, addD, cpb, lockB, cps, pw, np, np2].forEach(x => { x.disabled = b; });
    if (!b) { pw.disabled = !picked; unlock.disabled = !picked; }
    syncSel();
  }

  // Runs one backend call with a progress bar and a Stop button. Resolves to the backend's reply.
  async function run(label, fn, determinate) {
    if (busy) return null;
    setBusy(true);
    res.innerHTML = '<p class="fx" data-t></p><progress' + (determinate ? ' max="100" value="0"' : '') + '></progress>' +
      (determinate ? '<div class="bar"><button type="button" class="alt" id="vt-stop">Stop</button></div>' : '');
    cur = { t: res.querySelector('[data-t]'), pb: res.querySelector('progress'), label: determinate ? label : '' };
    cur.t.textContent = label;
    const stopB = $('#vt-stop');
    if (stopB) stopB.onclick = () => { stopB.disabled = true; api.cancel(); };
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, error: errOf(e) }; }
    cur = null;
    setBusy(false);
    return r || { ok: false, error: 'No answer came back.' };
  }
  const fail = r => say(r && r.declined ? 'fx' : 'err', (r && r.error) || 'That did not work.');

  function failedTable(rows, key) {
    return '<div class="dvt"><table>' + rows.map(f => '<tr><th>' + esc(f[key]) + '</th><td class="o">' + esc(f.error) + '</td></tr>').join('') + '</table></div>';
  }

  /* Views */
  function shown() {
    const t = q.value.trim().toLowerCase();
    return vault ? vault.files.filter(f => !t || f.name.toLowerCase().includes(t)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })) : [];
  }

  function syncSel() {
    ext.disabled = busy || !sel.size;
    rm.disabled = busy || !sel.size;
    ext.textContent = 'Extract selected' + (sel.size ? ' (' + sel.size + ')' : '') + '…';
    rm.textContent = 'Remove selected' + (sel.size ? ' (' + sel.size + ')' : '');
    const rows = shown().slice(0, ROWS);
    all.checked = rows.length > 0 && rows.every(f => sel.has(f.id));
    all.disabled = busy;
  }

  function render() {
    if (!vault) return;
    const rows = shown();
    q.hidden = allW.hidden = !vault.files.length;
    info.innerHTML = '<b>' + esc(vault.name) + '</b> is unlocked: ' + plural(vault.files.length, 'file') + ', ' + size(vault.bytes) + ' of content.';
    if (!vault.files.length) {
      list.innerHTML = '<div class="empty"><b>This vault is empty</b><span class="fx">Add files or folders. They are encrypted as they go in. Your originals are left where they are.</span></div>';
    } else if (!rows.length) {
      list.innerHTML = '<p class="fx">No files match that filter.</p>';
    } else {
      list.innerHTML = rows.slice(0, ROWS).map(f =>
        '<label class="hi"><input type="checkbox" value="' + esc(f.id) + '"' + (sel.has(f.id) ? ' checked' : '') + '><span><b>' + esc(f.name) + '</b><small>' +
        esc(size(f.size) + (f.mtime ? ' \u00b7 ' + new Date(f.mtime).toLocaleString() : '')) + '</small></span></label>').join('') +
        (rows.length > ROWS ? '<p class="fx">Showing the first ' + ROWS.toLocaleString() + ' of ' + rows.length.toLocaleString() + '. Use the filter to narrow the list.</p>' : '');
    }
    syncSel();
  }

  function show_(v) {
    vault = v;
    sel.clear();
    lockedV.hidden = !!v; openV.hidden = !v;
    cp.hidden = true;
    [pw, np, np2, op, nw, nw2].forEach(x => { x.value = ''; });
    q.value = '';
    meter.textContent = '';
    fileEl.textContent = picked ? 'Chosen: ' + picked.name : 'No vault chosen.';
    pw.disabled = unlock.disabled = !picked;
    if (v) render();
  }

  /* Open an existing vault */
  pick.addEventListener('click', async () => {
    let r;
    try { r = await api.pick(); } catch (e) { r = { ok: false, error: errOf(e) }; }
    if (!r || !r.ok) { fail(r); return; }
    if (!r.data) return;
    picked = r.data;
    res.innerHTML = '';
    fileEl.textContent = 'Chosen: ' + picked.name;
    pw.disabled = unlock.disabled = false;
    pw.focus();
  });

  async function doUnlock() {
    if (!picked || !pw.value) { if (picked) say('err', 'Enter the vault password.'); return; }
    const r = await run('Unlocking\u2026 the key is made slowly on purpose, so it takes a moment.', () => api.open(picked.file, pw.value));
    if (!r) return;
    if (!r.ok) { fail(r); pw.select(); return; }
    res.innerHTML = '';
    show_(r.data);
  }
  unlock.addEventListener('click', doUnlock);
  pw.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });

  /* Create a vault */
  np.addEventListener('input', () => {
    const n = np.value.length;
    meter.textContent = !n ? '' : n < 12 ? 'Too short: use at least 12 characters.' :
      n < 16 ? 'Long enough. Longer is stronger; several unrelated words make a good passphrase.' : 'Long enough.';
  });
  show.addEventListener('change', () => {
    const t = show.checked ? 'text' : 'password';
    [np, np2, pw, op, nw, nw2].forEach(x => { x.type = t; });
  });

  create.addEventListener('click', async () => {
    if (np.value.length < 12) { say('err', 'Use at least 12 characters.'); return; }
    if (np.value !== np2.value) { say('err', 'The two passwords do not match.'); return; }
    const r = await run('Choose where to save the vault, then it is created\u2026', () => api.create(np.value));
    if (!r) return;
    if (!r.ok) { fail(r); return; }
    picked = null;
    res.innerHTML = '';
    show_(r.data);
    say('dvok', 'Vault created and unlocked. Remember the password: nothing can recover it.');
  });

  /* Add, extract, remove */
  async function add(kind) {
    const r = await run('Encrypting\u2026', () => api.add(kind), true);
    if (!r) return;
    if (!r.ok) { fail(r); return; }
    const d = r.data;
    vault = d.vault; render();
    let html = '';
    if (d.added) {
      html += '<p class="dvok">Added ' + plural(d.added, 'item') + (d.replaced ? ' (' + d.replaced + ' replaced an item with the same name)' : '') + '.</p>' +
        '<p class="fx">Your originals were not touched, so unencrypted copies still exist. Shred them if you no longer want them.</p>' +
        '<div class="bar"><button type="button" class="alt" id="vt-goshred">Open File shredder</button></div>';
    } else if (!d.failed.length) {
      html += '<p class="fx">Nothing was added.</p>';
    }
    if (d.failed.length) html += '<p class="fx">These were not added:</p>' + failedTable(d.failed, 'path');
    res.innerHTML = html;
    const g = $('#vt-goshred');
    if (g) g.onclick = () => document.querySelector('.nv[data-p="shred"]').click();
  }
  addF.addEventListener('click', () => add('files'));
  addD.addEventListener('click', () => add('folders'));

  ext.addEventListener('click', async () => {
    if (!sel.size) return;
    const r = await run('Decrypting\u2026', () => api.extract([...sel]), true);
    if (!r) return;
    if (!r.ok) { fail(r); return; }
    const d = r.data;
    let html = '<p class="' + (d.failed.length || d.cancelled ? 'err' : 'dvok') + '">' + (d.cancelled ? 'Stopped. ' : '') +
      'Extracted ' + plural(d.count, 'file') + ' (' + size(d.bytes) + ') to ' + esc(d.dir) + '.</p>';
    if (d.count) html += '<p class="fx">These are ordinary, unprotected copies. Shred them when you are done with them.</p>';
    if (d.failed.length) html += '<p class="fx">These could not be extracted:</p>' + failedTable(d.failed, 'name');
    res.innerHTML = html;
  });

  rm.addEventListener('click', async () => {
    if (!sel.size) return;
    const r = await run('Removing and compacting the vault\u2026', () => api.remove([...sel]), true);
    if (!r) return;
    if (!r.ok) { fail(r); return; }
    vault = r.data.vault; sel.clear(); render();
    say('dvok', 'Removed ' + plural(r.data.removed, 'item') + ' from the vault.');
  });

  /* Selection and filter */
  list.addEventListener('change', e => {
    const c = e.target;
    if (!(c instanceof HTMLInputElement) || c.type !== 'checkbox') return;
    if (c.checked) sel.add(c.value); else sel.delete(c.value);
    syncSel();
  });
  all.addEventListener('change', () => {
    shown().slice(0, ROWS).forEach(f => { if (all.checked) sel.add(f.id); else sel.delete(f.id); });
    render();
  });
  q.addEventListener('input', render);

  /* Change password */
  cpb.addEventListener('click', () => { cp.hidden = !cp.hidden; if (!cp.hidden) op.focus(); });
  cpx.addEventListener('click', () => { cp.hidden = true; [op, nw, nw2].forEach(x => { x.value = ''; }); });
  cps.addEventListener('click', async () => {
    if (!op.value) { say('err', 'Enter the current password.'); return; }
    if (nw.value.length < 12) { say('err', 'The new password needs at least 12 characters.'); return; }
    if (nw.value !== nw2.value) { say('err', 'The new passwords do not match.'); return; }
    const r = await run('Changing the password\u2026 this rewrites the vault file.', () => api.changePassword(op.value, nw.value), true);
    if (!r) return;
    if (!r.ok) { fail(r); return; }
    vault = r.data.vault; cp.hidden = true; [op, nw, nw2].forEach(x => { x.value = ''; });
    render();
    say('dvok', 'Password changed.');
  });

  /* Lock */
  lockB.addEventListener('click', async () => {
    try { await api.lock(); } catch {}
    show_(null);
    say('fx', 'Vault locked. The key has been wiped from memory.');
  });

  // If the page was reloaded while a vault was open, pick up where it was.
  (async () => {
    try { const r = await api.state(); if (r && r.ok && r.data) show_(r.data); } catch {}
  })();
  show_(null);
})();
