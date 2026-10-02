// Deep scanner for XML crash files. Called from handle() in app.js (window.anXml) and uses E, M, T, base, esc, anText from app.js.
// Reads: Windows Event Log exports, Unreal Engine CrashContext (.runtime-xml), Windows Error Reporting metadata, DxDiag (/x) reports,
// and any other XML (every value is scanned). It parses the whole tree, rebuilds call stacks, checks the faulting module and
// exception code, memory, drivers and nearby system events, and shows the XML as a collapsible tree.
(function () {
  'use strict';
  const lc = s => String(s == null ? '' : s).toLowerCase(), nm = e => lc(e.localName || e.nodeName);
  const own = e => { let t = ''; if (e) for (const c of e.childNodes) if (c.nodeType === 3 || c.nodeType === 4) t += c.nodeValue; return t.trim(); };
  const short = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '\u2026' : s; };
  const num = s => { const n = parseFloat(String(s).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };
  const EX = /\b(?:0x)?(C0000[0-9A-F]{3}|E06D7363|E0434352|887A00[0-9A-F]{2})\b/gi;
  const KIND = { gpu: 'Graphics driver', ov: 'Overlay / anti-cheat', au: 'Audio', rt: 'Windows / runtime' };
  const dll = m => /\.(dll|exe)$/i.test(m) ? m : m + '.dll';

  function leaves(doc) {
    const L = [];
    const go = (e, p) => {
      if (L.length > 6000) return;
      const path = p + '/' + nm(e);
      for (const a of e.attributes) L.push({ k: lc(a.name), v: a.value, path: path + '@' + a.name, attr: 1 });
      if (!e.children.length) { const v = own(e); if (v) L.push({ k: nm(e), v, path }); }
      else for (const c of e.children) go(c, path);
    };
    go(doc.documentElement, '');
    return L;
  }

  function frames(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      let m = line.match(/^\s*(?:#?\d+\s+)?([^\s!]+)!(\S.*)$/), mod, fn;
      if (m) { mod = m[1]; fn = m[2]; }
      else if ((m = line.match(/^\s*(\S+)\s+0x[0-9a-f]+\s*\+\s*(?:0x)?([0-9a-f]+)\s*$/i))) { mod = m[1]; fn = '+0x' + m[2]; }
      else continue;
      out.push({ mod: base(mod), fn: short(fn, 120) });
      if (out.length >= 200) break;
    }
    return out;
  }

  function tree(root) {
    let budget = 450;
    const go = (e, d) => {
      if (budget-- <= 0) return '';
      const at = [...e.attributes].map(a => ' ' + a.name + '="' + short(a.value, 60) + '"').join('').slice(0, 200);
      const head = esc('<' + (e.localName || e.nodeName) + at + '>');
      if (!e.children.length) { const v = own(e); return '<div class="xt-l">' + head + (v ? ' ' + esc(short(v, 160)) : '') + '</div>'; }
      return '<details' + (d < 2 ? ' open' : '') + '><summary>' + head + ' <span class="fx">(' + e.children.length + ')</span></summary><div class="xt-i">' + [...e.children].map(c => go(c, d + 1)).join('') + '</div></details>';
    };
    const h = go(root, 0);
    return h + (budget <= 0 ? '<p class="fx">Showing the first 450 elements.</p>' : '');
  }

  window.anXml = function anXml(name, txt) {
    txt = txt.replace(/^\uFEFF/, '');
    // Drop any DOCTYPE (with its entity definitions) before parsing, so a crafted file cannot expand entities into huge text.
    // The full text still goes to the plain-text scan below if the XML turns out to be damaged.
    const safeXml = txt.replace(/<!DOCTYPE[^>\[]*(?:\[[\s\S]*?\]\s*)?>/gi, '');
    const doc = new DOMParser().parseFromString(safeXml, 'application/xml');
    const pe = doc.getElementsByTagName('parsererror')[0];
    const F = [], seen = new Set(), facts = [];
    const add = (s, t, w, x, e) => { if (seen.has(t)) return; seen.add(t); F.push({ s, t, w, x, e }); };
    const exc = (code, where) => {
      const h = String(code).toUpperCase().replace(/^0X/, '').padStart(8, '0'), e = E[h];
      add('H', e ? e[0] : 'Exception 0x' + h, e ? e[1] : 'This exception code is not in the built-in list.',
        e ? e[2] : 'Search the code (0x' + h + ') online with the game name, and check the game log beside this file.', where);
    };
    const scanCodes = s => { for (const m of s.matchAll(EX)) if (E[m[1].toUpperCase()]) exc(m[1], 'found in the file: ' + m[0]); };

    if (pe) {   // cut-off or damaged file: scan it as text, and say so
      const r = anText(name, txt);
      r.findings.forEach(f => { if (!seen.has(f.t)) { seen.add(f.t); F.push(f); } });
      scanCodes(txt);
      add('M', 'The XML file is damaged or cut off', 'It could not be read as XML, which often means the game crashed while writing it. Only a text scan was possible.', 'If a second copy of the crash report exists (for example in another crash folder), scan that one too.', short(pe.textContent, 200));
      return { name, findings: F, facts: [['Format', 'Damaged XML (text scan only)'], ...r.facts], key: r.key };
    }

    const root = doc.documentElement, rn = nm(root), L = leaves(doc), V = L.filter(l => !l.attr);
    const g = (...ks) => { for (const k of ks) { const x = V.find(l => l.k === lc(k)); if (x) return x.v; } return ''; };
    const fct = (label, ...ks) => { const v = g(...ks); if (v) facts.push([label, short(v, 160)]); };
    const evs = [...doc.getElementsByTagNameNS('*', 'Event')];
    const isUE = rn === 'fgenericcrashcontext' || !!g('crashguid'), isDx = rn === 'dxdiag', isWer = rn === 'werreportmetadata';
    facts.push(['Format', isUE ? 'Unreal Engine crash context' : evs.length ? 'Windows Event Log export' : isWer ? 'Windows Error Reporting metadata' : isDx ? 'DxDiag report' : 'Generic XML'],
      ['Elements scanned', String(doc.getElementsByTagName('*').length)]);

    // A crash described by faulting app, module, exception code and offset (Event 1000 and WER APPCRASH share this).
    const appCrash = (app, mod, code, off, when) => {
      if (app) facts.push(['Crashed program', app]);
      if (when) facts.push(['Crash time', when]);
      if (code) { exc(code, 'Exception code ' + code); facts.push(['Exception code', code]); }
      if (!mod) return;
      facts.push(['Faulting module', mod + (off ? ' +0x' + String(off).replace(/^0x/i, '') : '')]);
      const b = base(mod), r = M.find(x => x.r.test(b));
      if (/^unknown$/i.test(b)) add('M', 'Crash outside any loaded module', 'The program jumped into invalid memory, which points to memory corruption or a damaged or hooked process.', 'Disable overlays and mods, verify game files, and test RAM if it repeats.', mod);
      else if (r) add(r.k === 'rt' ? 'M' : 'H', r.t, r.w, r.x, b);
      else if (app && lc(b).replace(/\.\w+$/, '') === lc(app).replace(/\.\w+$/, '')) add('M', 'The fault is in the game itself', 'The crash happened inside the game\'s own code, so a game bug, a mod, or corrupt game data is the likely cause.', 'Verify game files, disable mods, update the game, and report it with this file.', b);
      else add('M', 'Crash inside ' + b, 'The fault happened in this module. If it is a third-party DLL, that program is the suspect.', 'Search the module name with the game name; update or remove the software that owns it.', b);
    };

    // Unreal Engine CrashContext
    if (isUE) {
      fct('Game', 'gamename', 'executablename'); fct('Build', 'buildconfiguration'); fct('Engine version', 'engineversion'); fct('Crash type', 'crashtype');
      fct('Platform', 'platformfullname'); fct('CPU', 'misc.cpubrand'); fct('GPU', 'misc.primarygpubrand'); fct('Seconds since start', 'secondssincestart');
      fct('Error message', 'errormessage'); fct('Command line', 'commandline');
      const ct = lc(g('crashtype'));
      if (ct === 'gpucrash') add('H', 'GPU crash reported by the engine', 'The engine recorded this as a graphics card or driver crash, not a game logic bug.', 'Clean-install the GPU driver, lower overclocks, check temperatures and power supply.', 'CrashType: GPUCrash');
      else if (ct === 'hang') add('M', 'The game stopped responding', 'The engine\'s watchdog saw the game freeze and wrote this report.', 'Check for drive, network or GPU stalls just before the crash; lower graphics settings.', 'CrashType: Hang');
      else if (ct === 'ensure') add('L', 'Only a non-fatal check fired', 'An "ensure" is a warning-level check. The game normally keeps running after it.', 'If the game did crash, scan the other report files from the same folder.', 'CrashType: Ensure');
      if (/^true$/i.test(g('memorystats.bisoom'))) add('H', 'Out of memory', 'The engine flagged this crash as a failed memory allocation.', 'Close other apps, raise the page file, lower texture quality and resolution.', 'Allocation size: ' + (g('memorystats.oomallocationsize') || 'unknown') + ' bytes');
      const tp = num(g('memorystats.totalphysical')), ap = num(g('memorystats.availablephysical'));
      if (tp && ap != null && ap / tp < 0.08) add('M', 'Memory was nearly used up', 'Less than 8% of physical RAM was free when the game crashed.', 'Close other apps, raise the page file, lower texture settings.', 'Free ' + Math.round(ap / tp * 100) + '% of RAM');
      const secs = num(g('secondssincestart'));
      if (secs != null && secs < 60) add('M', 'Crashed within a minute of starting', 'Crashes this early usually come from loading, shaders, drivers or a mod, not from play.', 'Verify files, delete the shader cache, update the GPU driver, disable mods.', secs + ' seconds after launch');
      if (/^true$/i.test(g('misc.anticheatenabled'))) add('L', 'Anti-cheat was active', 'Anti-cheat hooks into the game and can clash with overlays, drivers and security tools.', 'Repair the anti-cheat from the launcher and close overlay and monitoring tools.', 'Misc.AnticheatEnabled: true');
      const pl = V.filter(l => /plugin/.test(l.path) && M.some(x => x.k === 'ov' && x.r.test(l.v))).map(l => short(l.v, 80));
      if (pl.length) add('L', 'Overlay or injected hook module', 'A capture, overlay or injector module is listed in the crash report.', 'Turn the overlay or capture tool off and retest.', [...new Set(pl)].join('\n'));
    }

    // WER metadata (ProblemSignatures)
    if (isWer) {
      fct('Report type', 'eventtype'); fct('Windows', 'windowsntversion'); fct('Build', 'build'); fct('Product', 'product');
      const P = i => g('parameter' + i);
      if (/appcrash/i.test(g('eventtype'))) appCrash(P(0), P(3), P(6), P(7), '');
      else if (/apphang/i.test(g('eventtype'))) add('M', 'The game stopped responding', 'Windows recorded a hang, not a crash.', 'Check drive, network and GPU stalls; lower graphics settings.', P(0));
    }

    // Windows Event Log
    let tl = '';
    if (evs.length) {
      const q = (e, n) => e.getElementsByTagNameNS('*', n)[0];
      const rows = evs.map(e => {
        const pr = q(e, 'Provider'), tc = q(e, 'TimeCreated'), d = [...e.getElementsByTagNameNS('*', 'Data')].map(own);
        return { p: pr ? pr.getAttribute('Name') || '' : '', id: num(own(q(e, 'EventID'))) || 0, lv: num(own(q(e, 'Level'))) || 4, t: tc ? tc.getAttribute('SystemTime') || '' : '', d, msg: own(q(e, 'Message')) };
      }).sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
      const crashT = [];
      for (const x of rows) {
        const all = x.d.join(' ') + ' ' + x.msg;
        if (/application error/i.test(x.p) && x.id === 1000) { appCrash(x.d[0], x.d[3], x.d[6], x.d[7], x.t); x.hit = 1; }
        else if (/application hang/i.test(x.p) && x.id === 1002) { add('M', 'The game stopped responding', 'Windows recorded a hang: the program stopped answering and was closed.', 'Check drive, network and GPU stalls; lower graphics settings.', x.d[0]); x.hit = 1; }
        else if (/windows error reporting/i.test(x.p) && x.id === 1001) {
          if (/livekernelevent/i.test(all)) add('H', 'Kernel watchdog: a driver or device stopped responding', 'Windows logged a LiveKernelEvent, usually a graphics driver timeout or a failing device.', 'Clean-install the GPU driver, check temperatures, and update chipset and storage drivers.', short(x.d.slice(0, 3).join(' | '), 200));
          else add('L', 'Windows Error Reporting kept a report', 'Windows saved a report for this problem, which may hold more files.', 'Look in the ReportArchive folder for the matching Report.wer and dump.', short(x.d.slice(0, 3).join(' | '), 200));
        }
        else if ((/^display$/i.test(x.p) && x.id === 4101) || /nvlddmkm|amdkmdag|igfx/i.test(x.p)) add('H', 'Graphics driver stopped responding and recovered', 'Windows reset the graphics driver after it timed out.', 'Clean-install the GPU driver, lower overclocks, check temperatures and the power supply.', x.t + ' ' + x.p);
        else if (/kernel-power/i.test(x.p) && x.id === 41) add('H', 'The PC lost power or restarted unexpectedly', 'Windows logged an unclean shutdown. This is a power, overheating or hardware problem, not a game bug.', 'Check temperatures and the power supply, and look for a blue screen near that time.', x.t);
        else if (/whea/i.test(x.p) && x.id >= 16 && x.id <= 20) add('H', 'Hardware error reported by the CPU or bus', 'WHEA logs corrected or fatal hardware errors, often from CPU overclocks, bad RAM or PCIe problems.', 'Remove CPU and RAM overclocks (including XMP/EXPO as a test), update the BIOS, and run a memory test.', x.t + ' event ' + x.id);
        else if (/^(disk|ntfs|storahci|stornvme|iastor.*)$/i.test(x.p) && [7, 11, 51, 55, 98, 129, 137, 153, 154].includes(x.id)) add('H', 'Drive or file system errors', 'Windows logged disk problems. Games that cannot read their files crash with in-page or corrupt-data errors.', 'Check the drive (SMART, chkdsk), reseat or replace cables, and reinstall the game on a healthy drive.', x.p + ' event ' + x.id + ' at ' + x.t);
        else if (/\.net runtime/i.test(x.p) && (x.id === 1026 || x.id === 1025)) add('M', 'Unhandled .NET exception', 'A managed (.NET/Unity/Mono) exception went uncaught.', 'Read the exception name in the evidence; update or remove mods.', short(x.d[0] || x.msg, 300));
        else if (/resource-exhaustion/i.test(x.p) && x.id === 2004) add('M', 'Windows ran low on memory', 'Windows warned that memory was running out and closed programs.', 'Close other apps, raise the page file, lower texture settings.', short(all, 200));
        else if (/bugcheck|systemerrorreporting/i.test(x.p) && x.id === 1001) add('H', 'Blue screen (bug check)', 'The system itself stopped. This is not a game crash.', 'Open the minidump in WinDbg (!analyze -v) or check Reliability Monitor; update drivers.', short(x.d[0] || x.msg, 200));
        for (const [re, s, t, w, f] of T) if (re.test(all)) add(s, t, w, f, 'event ' + x.id + ' (' + x.p + ')');
        if (x.hit) crashT.push(Date.parse(x.t) || 0);
      }
      const near = x => { const t = Date.parse(x.t) || 0; return crashT.some(c => c && t <= c && c - t <= 120000); };
      const sel = rows.filter(x => x.hit || x.lv <= 3 || near(x)).slice(-80);
      facts.push(['Events in file', String(rows.length)], ['First event', rows[0].t || 'unknown'], ['Last event', rows[rows.length - 1].t || 'unknown']);
      const LV = { 1: 'Critical', 2: 'Error', 3: 'Warning', 4: 'Info' };
      tl = '<h3>Event timeline</h3><p class="fx">Crashes, errors and warnings, plus anything in the 2 minutes before a crash (marked).</p><div class="tw"><table><tr><th>Time</th><th>Source</th><th>ID</th><th>Level</th><th>Details</th></tr>' +
        sel.map(x => '<tr><td>' + esc(x.t.replace('T', ' ').replace(/\.\d+Z?$/, '')) + (near(x) && !x.hit ? ' \u2022' : '') + '</td><td>' + esc(short(x.p, 40)) + '</td><td>' + x.id + '</td><td>' + (LV[x.lv] || x.lv) + '</td><td>' + esc(short(x.d.join(' | ') || x.msg, 110)) + '</td></tr>').join('') + '</table></div>';
    }

    // DxDiag
    if (isDx) {
      fct('Windows', 'operatingsystem'); fct('CPU', 'processor'); fct('Memory', 'memory'); fct('Page file', 'pagefile'); fct('DirectX', 'directxversion');
      const ram = num((g('memory').match(/(\d+)\s*MB/i) || [])[1]);
      if (ram && ram < 8192) add('L', 'Low system memory', 'Less than 8 GB of RAM leaves little room for modern games.', 'Close other apps, lower texture settings, and consider more RAM.', g('memory'));
      const dv = [...doc.getElementsByTagName('DisplayDevice')], real = [];
      for (const d of dv) {
        const f = n => own(d.getElementsByTagName(n)[0]), card = f('CardName'), drv = f('DriverVersion'), dd = f('DriverDate'), vm = f('DedicatedMemory'), mod = f('DriverModel');
        facts.push(['Graphics card', card + (drv ? ' (driver ' + drv + (dd ? ', ' + dd.split(' ')[0] : '') + ')' : '') + (vm ? ', ' + vm : '')]);
        if (/basic (render|display)|remote display/i.test(card)) { add('H', 'Windows is using a basic display adapter', 'No real graphics driver is installed for this adapter, so games run badly or crash.', 'Install the latest driver from NVIDIA, AMD or Intel.', card); continue; }
        real.push(card);
        const t = Date.parse(dd);
        if (t && Date.now() - t > 548 * 864e5) add('M', 'Graphics driver is over 18 months old', 'Older drivers miss fixes for newer games.', 'Clean-install the latest driver from the maker\'s site.', card + ' driver dated ' + dd.split(' ')[0]);
        const mb = num(vm);
        if (mb != null && mb < 2048 && /MB/i.test(vm)) add('M', 'Very little video memory', 'Under 2 GB of dedicated video memory forces games to swap textures through system memory.', 'Lower texture quality and resolution.', card + ': ' + vm);
        if (mod && !/wddm\s*(2|3)/i.test(mod)) add('L', 'Older graphics driver model', 'Modern DirectX 12 games expect WDDM 2.x or newer.', 'Update the graphics driver.', mod);
      }
      if (real.length > 1) add('L', 'Two graphics adapters in this PC', 'Laptops and some desktops can run a game on the weaker integrated GPU by mistake.', 'In Windows Settings > Graphics, set the game to use the high-performance GPU.', real.join('\n'));
      for (const l of V) if (/note/.test(l.k) && /problem|error|fail|not working|disabled/i.test(l.v)) add('M', 'DxDiag reported a problem', 'DxDiag found an issue on this PC.', 'Read the note and fix what it names, then run DxDiag again.', short(l.v, 220));
    }

    // Every value in the file: exception codes, error patterns, overlay and driver modules
    scanCodes(V.map(l => l.v).join('\n'));
    for (const [re, s, t, w, x] of T) { const l = V.find(l => l.v.length < 4000 && re.test(l.v)); if (l) add(s, t, w, x, l.path.replace(/^\//, '') + ': ' + short(l.v, 160)); }
    for (const m of M) { if (m.k === 'rt' || m.k === 'au') continue; const l = V.find(l => l.v.length < 4000 && m.r.test(l.v)); if (l) add(m.k === 'ov' ? 'L' : 'M', m.t.replace('Crash inside', 'Mentions'), m.w, m.x, l.path.replace(/^\//, '') + ': ' + short(l.v, 160)); }

    // Call stacks
    let fr = [];
    for (const l of V) if (/callstack|stacktrace|backtrace|^stack$/.test(l.k) && l.v.length > 20) fr = fr.concat(frames(l.v));
    let st = '';
    if (fr.length) {
      const cls = f => M.find(x => x.r.test(dll(f.mod)));
      const top = fr.find(f => { const r = cls(f); return !r || r.k !== 'rt'; });
      if (top) {
        const r = cls(top);
        if (r) add(r.k === 'gpu' ? 'H' : 'M', r.t.replace('Crash inside', 'Call stack top is in'), r.w, r.x, top.mod + ' ' + top.fn);
        else add('M', 'The call stack starts in ' + top.mod, 'The first frame outside Windows and the C++ runtime is in this module, so it is where the failing call came from.', 'If it is the game\'s own module, report the stack to the developer; if it is a mod or third-party DLL, update or remove it.', fr.slice(0, 3).map(f => f.mod + ' ' + f.fn).join('\n'));
      }
      facts.push(['Call stack frames', String(fr.length)]);
      st = '<h3>Call stack</h3><div class="tw"><table><tr><th>#</th><th>Module</th><th>Function or offset</th><th>Kind</th></tr>' +
        fr.slice(0, 30).map((f, i) => { const r = cls(f); return '<tr><td>' + i + '</td><td>' + esc(f.mod) + '</td><td>' + esc(f.fn) + '</td><td>' + (r ? KIND[r.k] : 'Game or other') + '</td></tr>'; }).join('') + '</table></div>';
    }

    const key = V.filter(l => /error|exception|message|reason|fault|assert/.test(l.k) && l.v.length < 600).slice(0, 10).map(l => l.path.replace(/^\//, '') + ': ' + short(l.v, 160));
    return { name, findings: F, facts, key, html: st + tl + '<details><summary>XML structure</summary><div class="xt">' + tree(root) + '</div></details>' };
  };
})();
