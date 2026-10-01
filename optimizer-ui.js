// Game optimizer page (Game tools). Talks to optimizer-ipc.js through window.optimizer (see preload.js).
// Rates this PC from the hardware scan, then builds in-game setting advice, Windows tweaks and tips. Uses $, esc and toast from app.js.
(function () {
  'use strict';
  const pg = $('#p-opt');
  if (!pg) return;
  const api = window.optimizer, efs = window.efs;
  const el = id => $('#op-' + id);
  const na = el('na'), scan = el('scan'), msg = el('msg'), res = el('res'), pcEl = el('pc'), setEl = el('set'), goalEl = el('goal'),
    twEl = el('tw'), apply = el('apply'), undo = el('undo'), gpuB = el('gpu'), gl = el('gl'), tipEl = el('tips'), twm = el('twm');
  if (!api || !api.specs) { na.hidden = false; scan.disabled = true; return; }

  const GK = 'gca-opt-goal';
  const TN = ['Entry', 'Budget', 'Mid-range', 'High-end', 'Enthusiast'];
  const TD = ['Plays older and lightweight games well. Expect low settings in new games.', 'Handles most games at 1080p on medium settings.',
    'Runs current games at 1080p on high settings, and 1440p with upscaling.', 'Strong at 1440p on high settings. 4K works with upscaling.',
    'Handles nearly anything at very high settings, including 4K.'];
  const PRESET = ['Low', 'Medium', 'High', 'Very High', 'Ultra'];
  const TW = [
    ['gamemode', 'Turn on Windows Game Mode', 'Gives your game priority for CPU and GPU time and keeps Windows from starting updates while you play.'],
    ['capture', 'Turn off background game recording', 'Stops the Xbox Game Bar from capturing in the background, which costs a few frames per second. Game Bar clips stop working until you undo this.'],
    ['power', 'Use the High performance power plan', 'Stops Windows from slowing the processor down to save power.']
  ];
  let spec = null, A = null, st = null, scanned = false;
  const read = () => { try { return localStorage.getItem(GK) || 'balanced'; } catch { return 'balanced'; } };
  goalEl.value = ['quality', 'balanced', 'fps'].includes(read()) ? read() : 'balanced';

  /* ---------- rating ---------- */
  function gpuInfo(g) {
    const n = g.name, v = g.vram || 0;
    const o = { t: 0, kind: /nvidia|geforce|rtx|gtx/i.test(n) ? 'nv' : /amd|radeon/i.test(n) ? 'amd' : /intel/i.test(n) ? 'intel' : '?', rt: false, series: 0, ig: false };
    let m;
    if ((m = /RTX\s*(?:PRO\s*)?(\d{4})/i.exec(n))) {
      const x = +m[1], md = x % 100; o.series = Math.floor(x / 1000); o.rt = true;
      o.t = md >= 80 ? 5 : md >= 70 ? 4 : md >= 60 ? 3 : md >= 50 ? 2 : 1;
      if (o.series === 2 && md >= 80) o.t = 4;
      if (/\bTi\b/i.test(n) && o.series >= 3 && (md === 60 || md === 70)) o.t++;
      else if (/Super/i.test(n) && o.series >= 4 && md === 70) o.t++;
      o.t = Math.min(5, o.t);
    } else if ((m = /GTX\s*(\d{3,4})/i.exec(n))) {
      const x = +m[1], md = x % 100;
      o.t = x >= 1650 && x < 1700 ? 2 : x >= 1000 ? (md >= 70 ? 3 : md === 60 ? 2 : 1) : x >= 900 ? (md >= 70 ? 2 : 1) : 1;
    } else if ((m = /RX\s*(\d{3,4})/i.exec(n))) {
      const x = +m[1], s = Math.floor(x / 1000), h = Math.floor((x % 1000) / 100);
      if (x < 1000) o.t = x % 100 >= 70 ? 2 : 1;
      else if (s === 9) { o.t = x % 100 >= 70 ? (/XT/i.test(n) ? 5 : 4) : 3; o.rt = true; }
      else { o.t = h <= 4 ? 1 : h === 5 ? 2 : h === 6 ? 3 : h === 7 ? (s === 5 ? 3 : 4) : h === 8 ? 4 : 5; o.rt = s >= 6; }
      o.series = s;
    } else if (/Arc/i.test(n) && (m = /\b([AB])(\d{3})\b/i.exec(n))) {
      o.t = +m[2] >= 570 ? 3 : 1; o.rt = true; o.kind = 'intel';
    } else if (/Arc/i.test(n) || /Radeon.*(\d{3})M\b/i.test(n)) {
      m = /(\d{3})M\b/i.exec(n); o.t = m && +m[1] < 740 ? 1 : 2; o.ig = true;
    } else if (/UHD|Iris|HD Graphics|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d+ Graphics/i.test(n)) { o.t = 1; o.ig = true; }
    if (!o.t) { o.t = v <= 2 ? 1 : v <= 4 ? 2 : v <= 6 ? 3 : v <= 10 ? 4 : 5; o.ig = v < 1; }
    if (/laptop|mobile|max-q|notebook/i.test(n) && o.t >= 4) o.t--;   // laptop 70/80/90-class chips run well below the desktop ones
    return o;
  }
  function analyze(s) {
    const real = s.gpus.filter(g => !/virtual|basic display|remote|parsec|spacedesk|mirage|indirect/i.test(g.name));
    const list = (real.length ? real : s.gpus).map(g => Object.assign({ g }, gpuInfo(g))).sort((a, b) => b.t - a.t || b.g.vram - a.g.vram);
    const gpu = list[0] || Object.assign({ g: { name: 'Unknown graphics', vram: 0 } }, gpuInfo({ name: '', vram: 0 }));
    const scr = s.gpus.find(g => g.w > 0 && g.h > 0) || { w: 0, h: 0, hz: 0 };
    const cores = s.cpu.cores || 1, cs = cores + ((s.cpu.threads || cores) - cores) / 2;
    const ct = cs <= 4 ? 1 : cs <= 7 ? 2 : cs <= 10 ? 3 : cs <= 14 ? 4 : 5;
    const rt = s.ram.gb < 6 ? 1 : s.ram.gb < 12 ? 2 : s.ram.gb < 24 ? 3 : s.ram.gb < 48 ? 4 : 5;
    const tier = Math.max(1, Math.min(gpu.t, ct + 1, rt + 1));
    return { list, gpu, scr, ct, rt, tier, weak: tier < gpu.t ? (ct + 1 === tier ? 'processor' : 'memory') : '' };
  }

  /* ---------- advice ---------- */
  function recs(a, goal) {
    const { gpu, tier } = a, g = gpu.g, G = Math.max(0, ['quality', 'balanced', 'fps'].indexOf(goal));
    const idx = Math.max(0, Math.min(4, tier - 1 + (goal === 'quality' ? 1 : goal === 'fps' ? -1 : 0)));
    const w = a.scr.w || 1920, h = a.scr.h || 1080, hz = a.scr.hz || 60, v = g.vram || 0;
    const need = [1080, 1080, 1080, 1440, 2160][gpu.t - 1] * (goal === 'quality' ? 1.15 : goal === 'fps' ? 0.8 : 1) / h;
    const mode = need >= 0.95 ? '' : need >= 0.64 ? 'Quality' : need >= 0.55 ? 'Balanced' : 'Performance';
    const ups = gpu.kind === 'nv' && gpu.rt ? 'DLSS' : gpu.kind === 'intel' && !gpu.ig ? 'XeSS' : 'FSR';
    const fps = Math.min(hz, [[30, 45, 60, 60, 90], [45, 60, 75, 90, 120], [60, 75, 100, 144, 165]][G][tier - 1]);
    const R = [['Overall preset', PRESET[idx], 'Start here, then adjust the rows below.']];
    R.push(['Resolution', mode ? h + 'p output with ' + ups + ' ' + mode : 'Native ' + w + '\u00d7' + h,
      mode ? 'Your screen is sharper than this PC can draw natively. If the game has no upscaler, set render scale to about ' + Math.round(need * 100) + '%.'
        : need > 1.5 ? 'You have spare power: try render scale 125\u2013150%' + (gpu.kind === 'nv' && gpu.rt ? ' or DLAA' : '') + ' for a sharper image.' : 'Run at your screen\u2019s own resolution.']);
    R.push(['Texture quality', gpu.ig ? 'Low\u2013Medium' : v <= 2 ? 'Low' : v <= 4 ? 'Medium' : v <= 8 ? 'High' : v <= 12 ? 'Very High' : 'Ultra',
      gpu.ig ? 'Integrated graphics share system memory, so keep textures low.' : 'Matched to ' + (v ? 'your ' + v + ' GB of video memory' : 'your video memory') + '. Textures cost little speed, but too high makes the game stutter.']);
    R.push(['Shadows', ['Low', 'Low', 'Medium', 'Medium', 'High'][idx], 'One of the costliest settings for the look you get back.']);
    R.push(['Anti-aliasing', ['FXAA or off', 'SMAA or FXAA', 'TAA', 'TAA', 'TAA'][idx], 'TAA looks cleanest on modern games; FXAA is the cheapest.']);
    R.push(['Ambient occlusion', ['Off', 'Low (SSAO)', 'Medium', 'High', 'High'][idx], '']);
    R.push(['Effects, view distance, post-processing', ['Low', 'Low', 'Medium', 'High', 'High'][idx], '']);
    R.push(['Ray tracing', !gpu.rt ? 'Not supported \u2013 leave off' : tier >= 5 && goal !== 'fps' ? 'On (medium\u2013high) with ' + ups : tier >= 4 && goal !== 'fps' ? 'Low, only with ' + ups : 'Off',
      'The biggest single cost in frames per second.']);
    if ((gpu.kind === 'nv' && gpu.series >= 4 && tier >= 3) || (gpu.kind === 'amd' && gpu.rt && tier >= 3))
      R.push(['Frame generation', 'Optional', 'Raises the frame rate but adds a little delay. Best when you already get 50\u201360 fps.']);
    R.push(['Motion blur, film grain, depth of field', 'Off', 'They cost speed and soften the picture.']);
    R.push(['Frame limit', fps + ' fps', 'Your display runs at ' + hz + ' Hz. Use the in-game limiter with V-Sync off (or V-Sync on if you see tearing and have no G-Sync/FreeSync).']);
    R.cfg = { scale: mode ? Math.max(50, Math.min(100, Math.round(need * 100))) : 100, fps,
      q: { shadow: [0, 0, 1, 1, 2][idx], aa: [0, 1, 2, 2, 2][idx], fx: [0, 0, 1, 2, 2][idx], tex: gpu.ig ? 0 : v <= 2 ? 0 : v <= 4 ? 1 : v <= 8 ? 2 : 3 } };
    return R;
  }
  function tips(s, a) {
    const T = [], hdd = s.disks.some(d => /hdd/i.test(d.type)), ssd = s.disks.some(d => /ssd/i.test(d.type) || /nvme/i.test(d.bus));
    if (hdd) T.push(ssd ? 'Install demanding games on your SSD, not the hard drive. Loading and texture streaming are much faster.' : 'Your games run from a hard drive. An SSD shortens loading times and reduces stutter.');
    if (s.ram.gb && s.ram.gb < 16) T.push('You have ' + s.ram.gb + ' GB of memory. Close browsers and launchers before playing; 16 GB is the comfortable minimum for current games.');
    if (s.ram.sticks === 1 && s.ram.gb >= 4) T.push('Memory is a single stick. Two matching sticks run in dual channel, which noticeably helps frame rates, especially on integrated graphics.');
    if (s.ram.mhz && ((s.ram.type === 26 && s.ram.mhz <= 2666) || (s.ram.type === 34 && s.ram.mhz <= 4800)))
      T.push('Your memory runs at ' + s.ram.mhz + ' MHz, which is the basic speed. If your kit is rated higher, turn on XMP / EXPO in the BIOS.');
    if (a.scr.hz && a.scr.hz <= 60) T.push('Your display is set to ' + a.scr.hz + ' Hz. If the monitor supports more, choose it in Settings \u2192 System \u2192 Display \u2192 Advanced display.');
    if (s.laptop) T.push('This is a laptop: plug in the charger and set Windows power mode to Best performance while gaming. It slows down on battery.');
    if (s.laptop && s.gpus.length > 1) T.push('This laptop has more than one graphics chip. Use the section above to make sure your games run on the strong one.');
    const old = a.gpu.g.date && (Date.now() - Date.parse(a.gpu.g.date)) / 864e5 > 180;
    if (old) T.push({ drv: 1, t: 'Your graphics driver is from ' + a.gpu.g.date + '. New games often ship with fixes in newer drivers.' });
    if (s.hags && a.gpu.rt) T.push('Hardware-accelerated GPU scheduling is ' + (s.hags === 2 ? 'on' : 'off') + '. You can try the other setting in Settings \u2192 System \u2192 Display \u2192 Graphics \u2192 Default graphics settings (needs a restart). Results vary, so test with a game you know.');
    if (a.weak) T.push('Your ' + a.weak + ' is the weakest part for gaming, so a better graphics card alone would not help much. Settings that use the processor (crowds, view distance, physics) matter most here.');
    return T;
  }

  /* ---------- drawing ---------- */
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + ' TB' : n + ' GB';
  const disk = d => (/nvme/i.test(d.bus) ? 'NVMe SSD' : d.type && d.type !== 'Unspecified' ? d.type : d.bus || 'Drive') + ' ' + fmt(d.gb);
  const row = (k, v) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  function drawPC() {
    const s = spec, a = A, c = s.cpu, g = a.gpu.g;
    const seg = [1, 2, 3, 4, 5].map(i => '<i' + (i <= a.tier ? ' class="on"' : '') + '></i>').join('');
    const pill = (l, t, weak) => '<span class="pill' + (weak ? ' weak' : '') + '">' + l + ': ' + TN[t - 1] + '</span>';
    pcEl.innerHTML = '<div class="opt"><div><b class="big">' + TN[a.tier - 1] + '</b> <span class="fx">gaming rating</span></div><div class="seg" aria-hidden="true">' + seg + '</div>' +
      '<div class="fx">' + TD[a.tier - 1] + '</div></div>' +
      '<p>' + pill('Graphics', a.gpu.t, a.weak) + pill('Processor', a.ct, a.weak === 'processor') + pill('Memory', a.rt, a.weak === 'memory') +
      (a.weak ? '<span class="fx">Your ' + a.weak + ' is holding the graphics card back.</span>' : '') + '</p>' +
      '<dl class="opg">' + row('Processor', c.name + ' (' + c.cores + ' cores, ' + c.threads + ' threads' + (c.mhz ? ', up to ' + (c.mhz / 1000).toFixed(1) + ' GHz' : '') + ')') +
      row('Memory', s.ram.gb + ' GB' + (s.ram.mhz ? ' at ' + s.ram.mhz + ' MHz' : '') + (s.ram.sticks ? ' (' + s.ram.sticks + (s.ram.sticks === 1 ? ' stick)' : ' sticks)') : '')) +
      row('Graphics', a.list.map(x => x.g.name).join(' + ') || 'Unknown') +
      row('Video memory', a.gpu.ig ? 'Shared with system memory' : g.vram ? g.vram + ' GB' : 'Unknown') +
      row('Display', a.scr.w ? a.scr.w + '\u00d7' + a.scr.h + (a.scr.hz ? ' at ' + a.scr.hz + ' Hz' : '') : 'Unknown') +
      row('Storage', s.disks.map(disk).join(', ') || 'Unknown') + row('Windows', s.os || 'Unknown') + '</dl>';
  }
  function drawSet() {
    setEl.innerHTML = '<table><thead><tr><th>Setting</th><th>Use</th><th>Why</th></tr></thead><tbody>' +
      recs(A, goalEl.value).map(r => '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td><td class="fx">' + esc(r[2]) + '</td></tr>').join('') + '</tbody></table>';
  }
  function drawTips() {
    const T = tips(spec, A);
    tipEl.innerHTML = T.length ? T.map(t => typeof t === 'string' ? '<li>' + esc(t) + '</li>'
      : '<li>' + esc(t.t) + ' <button type="button" class="alt" id="op-drv">Open Driver updater</button></li>').join('') : '<li class="fx">Nothing else stands out.</li>';
    const b = $('#op-drv');
    if (b) b.onclick = () => document.querySelector('.nv[data-p="drv"]').click();
  }
  function drawState() {
    if (!st) return;
    twEl.innerHTML = TW.map(([id, t, d]) => {
      const on = st.tweaks[id] && st.tweaks[id].on;
      return '<label class="phd"><input type="checkbox" data-t="' + id + '"' + (on ? ' checked disabled' : ' checked') + '><span class="phb"><b>' + esc(t) + '</b>' +
        '<span class="st' + (on ? ' on' : '') + '">' + (on ? 'Already on' : 'Not on yet') + '</span><br><span class="fx">' + esc(d) +
        (id === 'power' && spec && spec.laptop ? ' On a laptop this shortens battery life and adds heat.' : '') + '</span></span></label>';
    }).join('');
    undo.disabled = !st.hasBackup;
    gl.innerHTML = st.gpuPrefs.length
      ? '<table><thead><tr><th>Game</th><th>Uses</th><th></th></tr></thead><tbody>' + st.gpuPrefs.map((p, i) => '<tr><td><code>' + esc(p.path) + '</code></td><td>' +
        (p.pref === 2 ? 'High performance GPU' : p.pref === 1 ? 'Power saving GPU' : 'Windows decides') + '</td><td><button type="button" class="alt" data-rm="' + i + '">Remove</button></td></tr>').join('') + '</tbody></table>'
      : '<p class="fx">No games set yet.' + (spec && spec.gpus.length < 2 ? ' This PC shows only one graphics chip, so this usually changes nothing.' : '') + '</p>';
  }
  const apiRun = async (fn, ok) => {
    let r; try { r = await fn(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.data) { st = r.data; drawState(); }
    twm.textContent = r && r.ok ? '' : (r && r.error) || 'That did not work.'; twm.hidden = !twm.textContent;
    if (r && r.ok && ok) toast(ok);
    return r;
  };

  /* ---------- my games (writes the recommended settings into each game's settings file) ---------- */
  const gaAdd = el('ga-add'), gaApply = el('ga-apply'), gaUndo = el('ga-undo'), gaMsg = el('ga-msg'), gaList = el('ga-list');
  let gm = [], gres = {};
  const gsay = (t, bad) => { gaMsg.className = bad ? 'err' : 'fx'; gaMsg.textContent = t || ''; gaMsg.hidden = !t; };
  const gname = p => p.split(/[\\/]/).pop();
  function drawGames() {
    gaApply.disabled = !gm.length || !A;
    gaUndo.disabled = !gm.some(g => g.applied);
    gaList.innerHTML = gm.length ? '<table><thead><tr><th>Game</th><th>In-game settings</th><th></th></tr></thead><tbody>' + gm.map((g, i) => {
      const t = !g.exists ? 'File not found' : gres[g.path] === 'failed' ? 'Could not change the file. Close the game and try again.' : g.applied ? 'Applied' :
        g.files ? 'Ready to apply' : 'No supported settings file found. Launch the game once, then apply again. Only Unreal Engine games are supported.';
      return '<tr><td><b>' + esc(gname(g.path)) + '</b><br><code>' + esc(g.path) + '</code></td><td class="fx">' + esc(t) + '</td><td><button type="button" class="alt" data-gr="' + i + '">Remove</button></td></tr>';
    }).join('') + '</tbody></table>' : '<p class="fx">No games added yet.</p>';
  }
  async function gcall(fn) {
    let r; try { r = await fn(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.data && r.data.games) { gm = r.data.games; drawGames(); }
    return r;
  }
  async function loadGames() {
    if (!api.gamesGet) { gaAdd.disabled = gaApply.disabled = gaUndo.disabled = true; return; }
    await gcall(() => api.gamesGet());
    drawGames();
  }
  gaAdd.addEventListener('click', async () => {
    let p = []; try { p = efs && efs.pickExe ? await efs.pickExe() : []; } catch {}
    if (p && p.length) { gsay(''); const r = await gcall(() => api.gamesAdd(p)); if (!r || !r.ok) gsay((r && r.error) || 'That did not work.', true); }
  });
  gaApply.addEventListener('click', async () => {
    if (!A) return;
    gaApply.disabled = true; gsay('Applying\u2026');
    const r = await gcall(() => api.gamesApply(recs(A, goalEl.value).cfg, !!(spec && spec.gpus.length > 1)));
    if (!r || !r.ok) { gsay((r && r.error) || 'That did not work.', true); drawGames(); return; }
    gres = {}; (r.data.results || []).forEach(x => { gres[x.path] = x.status; });
    const n = Object.values(gres), a = n.filter(x => x === 'applied').length, f = n.filter(x => x === 'failed').length, none = n.filter(x => x === 'none').length;
    gsay(a + ' game' + (a === 1 ? '' : 's') + ' updated' + (f ? ', ' + f + ' could not be changed' : '') + (none ? ', ' + none + ' not supported yet' : '') + '.' + (a ? ' Start the game and check its video settings.' : ''), f && !a);
    drawGames();
    const s = await api.state().catch(() => null);
    if (s && s.ok) { st = s.data; drawState(); }
    if (a) toast('Settings written to ' + a + ' game' + (a === 1 ? '' : 's'));
  });
  gaUndo.addEventListener('click', async () => {
    gaUndo.disabled = true; gres = {};
    const r = await gcall(() => api.gamesUndo());
    gsay(r && r.ok ? '' : (r && r.error) || 'That did not work.', !(r && r.ok));
    if (r && r.ok) toast('Game settings restored');
    drawGames();
  });
  gaList.addEventListener('click', async e => {
    const b = e.target.closest('[data-gr]'), g = b && gm[+b.dataset.gr];
    if (g) await gcall(() => api.gamesRemove(g.path));
  });

  /* ---------- actions ---------- */
  async function scanPC() {
    scan.disabled = true; msg.className = 'fx'; msg.textContent = 'Reading your hardware\u2026 this takes a few seconds.';
    let r; try { r = await api.specs(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    scan.disabled = false;
    if (!r || !r.ok) { msg.className = 'err'; msg.textContent = (r && r.error) || 'The scan failed.'; return; }
    msg.textContent = ''; spec = r.data; A = analyze(spec);
    res.hidden = false; drawPC(); drawSet(); drawTips();
    const s = await api.state().catch(() => null);
    if (s && s.ok) { st = s.data; drawState(); }
    loadGames();
  }
  scan.addEventListener('click', scanPC);
  goalEl.addEventListener('change', () => { try { localStorage.setItem(GK, goalEl.value); } catch {} if (A) drawSet(); });
  apply.addEventListener('click', async () => {
    const ids = [...twEl.querySelectorAll('input[data-t]:checked:not(:disabled)')].map(i => i.dataset.t);
    if (!ids.length) { twm.textContent = 'Everything selected is already on.'; twm.hidden = false; return; }
    apply.disabled = true;
    await apiRun(() => api.apply(ids), 'Tweaks applied');
    apply.disabled = false;
  });
  undo.addEventListener('click', async () => { undo.disabled = true; await apiRun(() => api.undo(), 'Your changes were undone'); drawState(); });
  gpuB.addEventListener('click', async () => {
    let p = []; try { p = efs && efs.pickExe ? await efs.pickExe() : []; } catch {}
    if (p && p.length) apiRun(() => api.gpu(p), 'Saved for ' + p.length + ' game' + (p.length === 1 ? '' : 's'));
  });
  gl.addEventListener('click', e => {
    const b = e.target.closest('[data-rm]'), p = b && st && st.gpuPrefs[+b.dataset.rm];
    if (p) apiRun(() => api.gpuRemove(p.path), 'Removed');
  });
  // Sidebar buttons scroll the main pane to a section
  pg.querySelectorAll('[data-j]').forEach(b => b.addEventListener('click', () => {
    const t = document.getElementById(b.dataset.j);
    if (!t || res.hidden) return;
    t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    pg.querySelectorAll('[data-j]').forEach(x => x.removeAttribute('data-on'));
    b.dataset.on = '1';
  }));
  $('.nv[data-p="opt"]').addEventListener('click', () => { if (!scanned) { scanned = true; scanPC(); } });
})();
