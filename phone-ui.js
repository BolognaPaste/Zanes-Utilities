// Phone Link page: use and control an Android phone over USB with scrcpy.
// Talks to phone-ipc.js through window.phone (see preload.js). Uses $, esc and toast from index.html / app.js.
// scrcpy shows the phone in its own window; this page finds the phone, starts and stops scrcpy and
// offers the quick buttons, screenshots and app installs that use adb.
(function () {
  'use strict';
  const pg = $('#p-phone');
  if (!pg) return;
  const na = $('#ph-na'), tool = $('#ph-tool'), tmsg = $('#ph-tmsg'), tdir = $('#ph-dir');
  const refresh = $('#ph-refresh'), msg = $('#ph-msg'), list = $('#ph-list'), ver = $('#ph-ver');
  const go = $('#ph-go'), stop = $('#ph-stop'), shot = $('#ph-shot'), apk = $('#ph-apk');
  const ctl = $('#ph-ctl'), res = $('#ph-res'), log = $('#ph-log'), box = $('#ph-opts');
  const api = window.phone;

  const SEL = { size: '#ph-size', rate: '#ph-rate', fps: '#ph-fps' };
  const CHK = { audio: '#ph-audio', awake: '#ph-awake', off: '#ph-off', touch: '#ph-touch', top: '#ph-top', full: '#ph-full', view: '#ph-view', poff: '#ph-poff', rec: '#ph-rec' };
  const NEEDS_CONTROL = ['awake', 'off', 'touch', 'poff'];   // scrcpy refuses these in view-only mode
  const DEF = { size: 1920, rate: 8, fps: 60, audio: true, awake: true, off: false, touch: false, top: false, full: false, view: false, poff: false, rec: false };
  const OK = 'gca-ph-opts', DK = 'gca-ph-dev';
  const STATE = { device: ['Ready', 'dvok'], unauthorized: ['Needs permission', 'dvw'], offline: ['Offline', 'dvw'] };
  const HELP = {
    unauthorized: 'Unlock the phone and tap Allow on the "Allow USB debugging?" prompt (tick Always allow), then press Refresh.',
    offline: 'Unplug the phone, plug it back in and press Refresh.'
  };
  const row = (k, v) => v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : '';
  const ctrls = () => [...pg.querySelectorAll('#ph-ctl button')];

  if (!api || !api.devices) {
    na.hidden = false;
    [refresh, go, shot, apk].forEach(b => { b.disabled = true; });
    ctrls().forEach(b => { b.disabled = true; });
    window.phEnter = window.phPause = () => {};
    return;
  }

  const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  /* Options are remembered in this app only */
  function loadOpts() {
    let s = {};
    try { s = JSON.parse(read(OK)) || {}; } catch {}
    const o = { ...DEF, ...s };
    for (const k in SEL) { const e = $(SEL[k]); if ([...e.options].some(x => +x.value === +o[k])) e.value = String(o[k]); }
    for (const k in CHK) $(CHK[k]).checked = !!o[k];
  }
  function opts() {
    const o = {};
    for (const k in SEL) o[k] = +$(SEL[k]).value;
    for (const k in CHK) o[k] = $(CHK[k]).checked;
    return o;
  }

  let devs = [], last = '', cur = read(DK), running = false, busy = false, toolsOk = false, timer = 0;
  const logLines = [];

  const ready = () => devs.find(d => d.serial === cur && d.state === 'device') || null;

  function sync() {
    const d = ready(), can = toolsOk && !!d;
    go.disabled = !can || running || busy;
    go.textContent = running ? 'Running\u2026' : 'Start';
    stop.hidden = !running;
    shot.disabled = apk.disabled = !can || busy;
    ctrls().forEach(b => { b.disabled = !can; });
    box.querySelectorAll('input,select').forEach(e => { e.disabled = running; });
    const v = $(CHK.view).checked;
    NEEDS_CONTROL.forEach(k => { const e = $(CHK[k]); e.disabled = running || v; e.closest('label').style.opacity = v ? '.5' : ''; });
  }

  function card(d) {
    const st = STATE[d.state] || [d.state, 'fx'], ok = d.state === 'device';
    const name = [d.mfr, d.model].filter(Boolean).join(' ') || d.model || 'Android phone';
    return '<label class="vnc phd"><input type="radio" name="ph-dev" value="' + esc(d.serial) + '"' + (ok ? '' : ' disabled') + (d.serial === cur ? ' checked' : '') + '>' +
      '<span class="phb"><span class="vh"><b>' + esc(name) + '</b><span class="' + st[1] + '">' + st[0] + '</span></span>' +
      '<dl>' + row('Serial', d.serial) + row('Android', d.android) + row('Connection', d.usb ? 'USB' : 'Network') + '</dl>' +
      (ok ? '' : '<p class="fx">' + esc(HELP[d.state] || 'The phone is not ready (' + d.state + ').') + '</p>') + '</span></label>';
  }

  function render() {
    const first = devs.find(d => d.state === 'device');
    if (!ready()) { cur = first ? first.serial : ''; if (cur) write(DK, cur); }
    list.innerHTML = devs.length ? devs.map(card).join('') :
      '<div class="empty"><b>No phone found</b><span class="fx">Plug the phone in with a USB cable and turn on USB debugging (steps below). The list updates by itself.</span></div>';
    sync();
  }

  function showTool(d) {
    toolsOk = false;
    tool.hidden = false;
    const p = (d && d.places) || [];
    tmsg.innerHTML = 'scrcpy was not found. Download the Windows 64-bit ZIP from <code>github.com/Genymobile/scrcpy/releases</code> and extract everything in it (scrcpy.exe, adb.exe, scrcpy-server and the DLLs) into one folder of these, then press Refresh:' +
      (p.length ? '<br>' + p.map(x => '<code>' + esc(x) + '</code>').join('<br>') : '');
    devs = []; last = ''; render();
  }

  async function status() {
    let r;
    try { r = await api.status(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) { msg.className = 'err'; msg.textContent = (r && r.error) || 'Phone Link could not start.'; toolsOk = false; sync(); return false; }
    running = !!r.data.running;
    if (!r.data.scrcpy || !r.data.adb) { showTool(r.data); ver.textContent = ''; return false; }
    toolsOk = true; tool.hidden = true;
    ver.textContent = r.data.version ? 'scrcpy ' + r.data.version : '';
    return true;
  }

  async function poll() {
    if (!toolsOk) return;
    let r;
    try { r = await api.devices(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || r.busy) return;
    if (!r.ok) {
      if (r.notool) { status(); return; }
      msg.className = 'err'; msg.textContent = r.error || 'The phone list could not be read.';
      return;
    }
    msg.className = 'fx';
    const n = r.data.devices.filter(d => d.state === 'device').length;
    msg.textContent = n ? n + ' phone' + (n > 1 ? 's' : '') + ' ready.' : r.data.devices.length ? 'A phone is connected but not ready yet.' : 'Looking for phones\u2026';
    const key = JSON.stringify(r.data.devices);
    if (key !== last) { last = key; devs = r.data.devices; render(); }
  }

  async function start() {
    const d = ready();
    if (!d || running || busy) return;
    busy = true; sync();
    res.innerHTML = '<p class="fx">Starting scrcpy\u2026</p>';
    logLines.length = 0; log.textContent = '';
    let r;
    try { r = await api.start(d.serial, opts()); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    busy = false;
    if (!r || !r.ok) { res.innerHTML = '<p class="err">' + esc((r && r.error) || 'scrcpy did not start.') + '</p>'; running = false; sync(); return; }
    running = true;
    res.innerHTML = '<p class="fx"><span class="dvok">Running.</span> The phone screen is in the scrcpy window. Click in it to use the phone, drag an APK onto it to install it, or drag other files onto it to copy them to the phone.' + (r.data.rec ? ' Recording is being saved.' : '') + '</p>';
    sync();
  }

  const revealBtn = f => '<button type="button" class="alt" data-reveal="' + esc(f) + '">Show in folder</button>';

  api.onEvent(m => {
    if (!m) return;
    if (m.t === 'log') {
      logLines.push(m.line); if (logLines.length > 60) logLines.shift();
      log.textContent = logLines.join('\n');
    } else if (m.t === 'state') {
      running = !!m.running; sync();
    } else if (m.t === 'exit') {
      running = false; busy = false; sync();
      let h = m.err ? '<p class="err">scrcpy stopped: ' + esc(m.err) + '</p>' : '<p class="fx">scrcpy closed.</p>';
      if (m.rec) h += '<p class="fx">Recording saved: <code>' + esc(m.rec) + '</code></p><div class="bar">' + revealBtn(m.rec) + '</div>';
      res.innerHTML = h;
    }
  });

  async function quick(k) {
    const d = ready();
    if (!d) return;
    let r;
    try { r = await api.key(d.serial, k); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) toast((r && r.error) || 'The phone did not respond');
  }

  async function screenshot() {
    const d = ready();
    if (!d || busy) return;
    busy = true; sync();
    res.innerHTML = '<p class="fx">Taking a screenshot\u2026</p>';
    let r;
    try { r = await api.shot(d.serial); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    busy = false; sync();
    if (!r || !r.ok) { res.innerHTML = '<p class="err">' + esc((r && r.error) || 'The screenshot failed.') + '</p>'; return; }
    res.innerHTML = '<p class="fx"><span class="dvok">Saved.</span> <code>' + esc(r.data.file) + '</code></p><div class="bar">' + revealBtn(r.data.file) + '</div>';
    toast('Screenshot saved');
  }

  async function install() {
    const d = ready();
    if (!d || busy) return;
    busy = true; sync();
    res.innerHTML = '<p class="fx">Installing\u2026 keep the phone unlocked; it may ask you to confirm.</p><progress></progress>';
    let r;
    try { r = await api.install(d.serial); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    busy = false; sync();
    if (!r || !r.ok) { res.innerHTML = '<p class="' + (r && r.declined ? 'fx' : 'err') + '">' + esc((r && r.error) || 'The install failed.') + '</p>'; return; }
    res.innerHTML = '<p class="dvok">Installed ' + esc(r.data.name) + '.</p>';
  }

  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    msg.className = 'fx'; msg.textContent = 'Looking for phones\u2026';
    last = '';
    if (await status()) await poll();
    refresh.disabled = false;
  });
  tdir.addEventListener('click', async () => {
    let r;
    try { r = await api.folder(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (!r || !r.ok) toast((r && r.error) || 'Could not open the folder');
  });
  list.addEventListener('change', e => {
    if (e.target.name === 'ph-dev') { cur = e.target.value; write(DK, cur); sync(); }
  });
  box.addEventListener('change', () => { write(OK, JSON.stringify(opts())); sync(); });
  ctl.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) quick(b.dataset.k); });
  res.addEventListener('click', async e => {
    const b = e.target.closest('[data-reveal]');
    if (!b) return;
    let r;
    try { r = await api.reveal(b.dataset.reveal); } catch (x) { r = { ok: false, error: String((x && x.message) || x) }; }
    if (!r || !r.ok) toast((r && r.error) || 'Could not open the folder');
  });
  go.addEventListener('click', start);
  stop.addEventListener('click', () => { stop.disabled = true; api.stop(); setTimeout(() => { stop.disabled = false; }, 3500); });
  shot.addEventListener('click', screenshot);
  apk.addEventListener('click', install);

  // Called by the page navigation: look for phones while the page is open, stop looking when it is not.
  // A running scrcpy window keeps going either way.
  window.phEnter = async () => {
    if (await status()) { await poll(); }
    clearInterval(timer);
    timer = setInterval(poll, 3000);
    sync();
  };
  window.phPause = () => { clearInterval(timer); timer = 0; };

  loadOpts();
  sync();
})();
