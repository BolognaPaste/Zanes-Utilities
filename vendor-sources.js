'use strict';
// Looks up the newest GPU driver published by each manufacturer and compares it with what is
// installed. Network access is injected (ctx.get).
//
// Sources:
//   NVIDIA  public driver-lookup service used by nvidia.com/Download (XML lists + JSON query)
//   AMD     Adrenalin release-notes pages (no index or feed exists, so recent URLs are probed)
//   Intel   version text on the download / support pages (graphics, Wi-Fi, Bluetooth, chipset)
//   AMD     also the Ryzen chipset driver page
//   Other   Realtek, Qualcomm, MediaTek, Broadcom and the like publish no version feed, so those
//           devices are listed with a link to the PC maker's driver page instead
// The requests are few, sequential and use an honest User-Agent. If a site refuses them the
// result says so and links to the manufacturer's page; nothing tries to get around blocking.

const NV_HOST = 'https://gfwsl.geforce.com';
const NV_LOOKUP = 'https://www.nvidia.com/Download/API/lookupValueSearch.aspx';
const NV_PAGE = 'https://www.nvidia.com/en-us/drivers/';
const AMD_PAGE = 'https://www.amd.com/en/support/download/drivers.html';
const INTEL_ARC = 'https://www.intel.com/content/www/us/en/download/785597/intel-arc-iris-xe-graphics-windows.html';
const INTEL_XE = 'https://www.intel.com/content/www/us/en/support/products/211012/graphics/processor-graphics/intel-iris-xe-graphics-family.html';

const NV_DL = /^https:\/\/([a-z0-9-]+\.)*download\.nvidia\.com\/[^\s?#]+\.exe$/i;

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');

function cmp(a, b) {
  const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const SKIP = /basic display|remote display|virtual|parsec|indirect|citrix|vmware|hyper-v|displaylink|meta /i;
function vendorOf(g) {
  const s = (g.mfr || '') + ' ' + (g.name || '');
  if (SKIP.test(s)) return '';
  if (/nvidia|geforce/i.test(s)) return 'nvidia';
  if (/\bamd\b|advanced micro|radeon/i.test(s)) return 'amd';
  if (/intel/i.test(s)) return 'intel';
  return '';
}

// ---------- NVIDIA ----------
function parseLookup(xml) {
  const out = [];
  const rx = /<LookupValue([^>]*)>\s*<Name>([^<]*)<\/Name>\s*<Value>(\d+)<\/Value>/g;
  let m;
  while ((m = rx.exec(xml))) {
    const p = /ParentID="(\d+)"/.exec(m[1]);
    out.push({ name: m[2].trim(), value: m[3], parent: p ? p[1] : '' });
  }
  return out;
}

// Turns "NVIDIA GeForce RTX 3060 Laptop GPU" into the series names NVIDIA's list uses.
function nvidiaSeries(name) {
  if (/quadro|tesla|rtx\s*a\d|rtx\s*pro|\bada\b|\bt\d{3,4}\b/i.test(name)) return null;
  const mobile = /laptop|notebook|max-q|mobile/i.test(name) || /\b\d{3,4}M\b/i.test(name);
  const m = /\b(RTX|GTX|GT|MX)\s*(\d{3,4})/i.exec(name);
  if (!m) return null;
  const kind = m[1].toUpperCase(), n = +m[2];
  if (kind === 'MX') {
    const h = Math.floor(n / 100) * 100;
    return ['GeForce MX' + h + ' Series (Notebooks)', 'GeForce MX' + h + ' Series (Notebook)'];
  }
  if (n >= 1000) {
    const gen = Math.floor(n / 100);
    if (kind === 'RTX') return [mobile ? 'GeForce RTX ' + gen + ' Series (Notebooks)' : 'GeForce RTX ' + gen + ' Series'];
    if (gen === 16) return mobile ? ['GeForce GTX 16 Series (Notebooks)'] : ['GeForce 16 Series'];
    if (gen === 10) return mobile ? ['GeForce 10 Series (Notebooks)'] : ['GeForce 10 Series'];
    return null;
  }
  const h = Math.floor(n / 100) * 100;
  if (h < 600) return null;
  return mobile ? ['GeForce ' + h + 'M Series (Notebooks)'] : ['GeForce ' + h + ' Series'];
}

// Windows reports 32.0.15.8157 for GeForce driver 581.57: the last five digits.
function nvidiaInstalled(ver) {
  const d = String(ver || '').replace(/\D/g, '');
  return d.length >= 5 ? d.slice(-5, -2) + '.' + d.slice(-2) : '';
}

function safeNvPage(u) {
  try {
    const x = new URL(decodeURIComponent(String(u || '')));
    return x.protocol === 'https:' && /(^|\.)nvidia\.com$/i.test(x.hostname) ? x.href : '';
  } catch { return ''; }
}

async function checkNvidia(gpu, ctx) {
  const base = { vendor: 'NVIDIA', gpu: gpu.name, installed: nvidiaInstalled(gpu.ver), page: NV_PAGE, source: 'NVIDIA driver lookup service' };
  const cands = nvidiaSeries(gpu.name);
  if (!cands) return { ...base, status: 'unknown', note: 'This looks like a professional or older card. Check NVIDIA\'s driver page for the right download.' };

  const series = parseLookup(await ctx.get(NV_LOOKUP + '?TypeID=2')).filter(x => x.parent === '1');
  const hit = cands.map(norm).map(c => series.find(x => norm(x.name) === c)).find(Boolean);
  if (!hit) return { ...base, status: 'unknown', note: 'NVIDIA\'s list has no series matching "' + cands[0] + '".' };

  let osid = (ctx.build || 0) >= 22000 ? '135' : '57';
  try {
    const want = (ctx.build || 0) >= 22000 ? 'windows 11' : 'windows 10 64-bit';
    const o = parseLookup(await ctx.get(NV_LOOKUP + '?TypeID=4')).find(x => norm(x.name) === want);
    if (o) osid = o.value;
  } catch { /* the built-in ids above are fine */ }

  const url = NV_HOST + '/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup' +
    '&psid=' + hit.value + '&osID=' + osid + '&languageCode=1033&beta=0&isWHQL=1&dltype=-1&dch=1&upCRD=0&qnf=0&sort1=0&numberOfResults=1';
  let info;
  try {
    const j = JSON.parse(await ctx.get(url));
    info = j && j.IDS && j.IDS[0] && j.IDS[0].downloadInfo;
  } catch { info = null; }
  if (!info || !info.Version) return { ...base, status: 'unknown', note: 'NVIDIA returned no driver for ' + hit.name + '.' };

  let dl = String(info.DownloadURL || '').replace(/^http:\/\//i, 'https://');
  if (!NV_DL.test(dl)) dl = '';
  const latest = String(info.Version);
  const status = !base.installed ? 'unknown' : (cmp(base.installed, latest) < 0 ? 'newer' : 'current');
  return {
    ...base, status, latest,
    released: String(info.ReleaseDateTime || '').trim(),
    size: String(info.DownloadURLFileSize || '').trim(),
    page: safeNvPage(info.DetailsURL) || NV_PAGE,
    download: dl,
    note: status === 'unknown' ? 'Could not read the installed driver version.' : 'Game Ready driver for ' + hit.name + '.'
  };
}

// ---------- AMD ----------
function parseAmdNotes(html) {
  const t = text(html);
  const versions = [...t.matchAll(/Driver Store Version\s*(\d+\.\d+\.\d+\.\d+)/gi)].map(m => m[1]);
  if (!versions.length) return null;
  const a = /Adrenalin Edition\s+(\d+\.\d+\.\d+)/i.exec(t);
  const d = /(?:Last Updated|Date)\s*:?\s*([A-Z][a-z]+ \d{1,2}\s*(?:st|nd|rd|th)?,? \d{4})/.exec(t);
  return { versions, adrenalin: a ? a[1] : '', released: d ? d[1] : '' };
}

async function checkAmd(gpu, ctx) {
  const base = { vendor: 'AMD', gpu: gpu.name, installed: gpu.ver, page: AMD_PAGE, source: 'AMD release notes' };
  const now = new Date();
  let found = null;
  outer:
  for (let back = 0; back < 3; back++) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const yy = String(d.getFullYear()).slice(-2), mm = d.getMonth() + 1;
    for (let n = 6; n >= 1; n--) {
      const url = 'https://www.amd.com/en/resources/support-articles/release-notes/RN-RAD-WIN-' + yy + '-' + mm + '-' + n + '.html';
      let html;
      try { html = await ctx.get(url); }
      catch (e) { if (e.status === 404) continue; throw e; }
      const p = parseAmdNotes(html);
      if (p) { found = { ...p, url }; break outer; }
    }
  }
  if (!found) return { ...base, status: 'unknown', note: 'Could not read AMD\'s recent release notes. AMD\'s site may block automated requests, so open the page instead.' };

  // AMD ships separate packages per GPU generation; the leading digits of the third number tell them apart.
  const branch = v => (v.split('.')[2] || '').slice(0, 2);
  const mine = found.versions.filter(v => branch(v) === branch(gpu.ver));
  const page = found.url;
  if (!mine.length) return { ...base, page, latest: found.adrenalin, released: found.released, status: 'unknown', note: 'The newest AMD release does not list a driver for your GPU generation.' };
  const latestStore = mine.sort(cmp)[mine.length - 1];
  return {
    ...base, page, latest: found.adrenalin ? found.adrenalin + ' (driver ' + latestStore + ')' : latestStore,
    released: found.released,
    status: cmp(gpu.ver, latestStore) < 0 ? 'newer' : 'current',
    note: 'AMD only offers the download through its own site; use the page link.'
  };
}

// ---------- Intel ----------
async function checkIntel(gpu, ctx) {
  const arc = /\barc\b/i.test(gpu.name);
  const url = arc ? INTEL_ARC : INTEL_XE;
  const rx = arc ? /Graphics Driver\s+(\d+\.\d+\.\d+\.\d+)/i : /Version:\s*(\d+\.\d+\.\d+\.\d+)/i;
  const base = { vendor: 'Intel', gpu: gpu.name, installed: gpu.ver, page: url, source: 'Intel download center' };
  const m = rx.exec(text(await ctx.get(url)));
  if (!m) return { ...base, status: 'unknown', note: 'Could not read the version from Intel\'s page. Open it to check manually.' };
  const latest = m[1];
  const track = v => v.split('.').slice(0, 2).join('.');
  if (track(latest) !== track(gpu.ver)) {
    return { ...base, latest, status: 'unknown', note: 'Your Intel GPU uses a different driver track than the newest package. Check Intel\'s page for your model.' };
  }
  return {
    ...base, latest, status: cmp(gpu.ver, latest) < 0 ? 'newer' : 'current',
    note: 'Laptop makers customise Intel drivers; if you have problems, use your laptop maker\'s version.'
  };
}


// ---------- other components: Wi-Fi, Bluetooth, chipset, PC maker ----------
const INTEL_WIFI = 'https://www.intel.com/content/www/us/en/download/19351/intel-wireless-wi-fi-drivers-for-windows-10-and-windows-11.html';
const INTEL_BT = 'https://www.intel.com/content/www/us/en/download/18649/intel-wireless-bluetooth-drivers-for-windows-10-and-windows-11.html';
const INTEL_CHIPSET = 'https://www.intel.com/content/www/us/en/download/19347/chipset-inf-utility.html';
const INTEL_DSA = 'https://www.intel.com/content/www/us/en/support/detect.html';
const AMD_CHIPSET = 'https://www.amd.com/en/support/downloads/drivers.html/chipsets/laptop-chipsets/amd-ryzen-and-athlon-mobile-chipset.html';

const isIntel = d => /intel/i.test((d.mfr || '') + ' ' + (d.prov || '')) || /VEN_8086/i.test(d.id || '');
const isAmd = d => /\bamd\b|advanced micro/i.test((d.mfr || '') + ' ' + (d.prov || '')) || /VEN_1022/i.test(d.id || '');
const major = v => Number(String(v).split('.')[0]) || 0;
const AMD_CHIPSET_DEV = /amd (psp|gpio|i2c|uart|smbus|pci|pmf|sfh|iov|usb4|micropep|s0i3|wireless button|3d v-cache|hsmp|ams mailbox|ppm)/i;

// Intel prints "driver version 24.70.0.3 for AX211, BE200 ..."; when the adapter's model appears
// next to a version, that version is the one meant for it.
function intelVersions(html, model) {
  const t = text(html), out = [];
  for (const m of t.matchAll(/driver version\s*:?\s*(\d+\.\d+\.\d+\.\d+)([^]{0,400})/gi)) out.push({ v: m[1], near: m[2].replace(/\s+/g, '').toLowerCase() });
  if (!model) return out.map(x => x.v);
  const tok = model.replace(/\s+/g, '').toLowerCase();
  const mine = out.filter(x => x.near.includes(tok));
  return (mine.length ? mine : out).map(x => x.v);
}

async function checkIntelWireless(d, wifi, ctx) {
  const url = wifi ? INTEL_WIFI : INTEL_BT;
  const base = { vendor: 'Intel', category: wifi ? 'Wi-Fi' : 'Bluetooth', gpu: d.name, installed: d.ver, page: url, source: 'Intel download center' };
  const model = (/\b(BE\d{3}|AX\d{3}|AC[- ]?\d{4}|9\d{3}|8\d{3}|7\d{3}|3165|3168)\b/i.exec(d.name) || [])[1] || '';
  const all = intelVersions(await ctx.get(url), model);
  const newLine = major(d.ver) >= 20;               // 19.x is Intel's separate line for old adapters
  const same = all.filter(v => (major(v) >= 20) === newLine);
  if (!same.length) return { ...base, status: 'unknown', note: 'Could not find a version for this adapter on Intel\'s page. Open it to check manually.' };
  const latest = same.sort(cmp)[same.length - 1];
  return {
    ...base, latest, status: cmp(d.ver, latest) < 0 ? 'newer' : 'current',
    note: 'Laptop makers customise Intel wireless drivers; if you have problems, use your laptop maker\'s version.'
  };
}

async function checkIntelChipset(app, ctx) {
  const base = { vendor: 'Intel', category: 'Chipset', gpu: app.name, installed: app.ver, page: INTEL_CHIPSET, source: 'Intel download center' };
  const m = /utility version\s+(\d+\.\d+\.\d+\.\d+)/i.exec(text(await ctx.get(INTEL_CHIPSET)));
  if (!m) return { ...base, status: 'unknown', note: 'Could not read the version from Intel\'s page. Open it to check manually.' };
  return {
    ...base, latest: m[1], status: cmp(app.ver, m[1]) < 0 ? 'newer' : 'current',
    note: 'This package mostly sets the device names shown in Device Manager, so skipping it is usually harmless.'
  };
}

async function checkAmdChipset(app, ctx) {
  const base = { vendor: 'AMD', category: 'Chipset', gpu: app ? app.name : 'AMD Ryzen chipset drivers', installed: app ? app.ver : '', page: AMD_CHIPSET, source: 'AMD support page' };
  const t = text(await ctx.get(AMD_CHIPSET));
  const m = /AMD Chipset Drivers\s+Revision Number\s+(\d+\.\d+\.\d+\.\d+)(?:[^]{0,200}?Release Date\s+(\d{4}-\d{2}-\d{2}))?/i.exec(t);
  if (!m) return { ...base, status: 'unknown', note: 'Could not read the version from AMD\'s page. AMD\'s site may block automated requests, so open the page instead.' };
  const res = { ...base, latest: m[1], released: m[2] || '' };
  if (!app) return { ...res, status: 'unknown', note: 'AMD chipset components were found, but not AMD\'s chipset package, so there is no version to compare. AMD only offers the download through its own site.' };
  return { ...res, status: cmp(app.ver, m[1]) < 0 ? 'newer' : 'current', note: 'AMD only offers the download through its own site; use the page link.' };
}

const JUNK = /system manufacturer|to be filled|default string|o\.e\.m|^$/i;

// Only links: nothing is fetched from these sites.
function oemLink(pc) {
  const maker = norm(JUNK.test(pc.mfr || '') ? pc.prov : pc.mfr);
  const tag = String(pc.ver || '').trim();
  if (/dell|alienware/.test(maker)) return /^[a-z0-9]{7}$/i.test(tag) ? 'https://www.dell.com/support/home/en-us/product-support/servicetag/' + tag + '/drivers' : 'https://www.dell.com/support/home/en-us';
  if (/\bhp\b|hewlett/.test(maker)) return 'https://support.hp.com/us-en/drivers';
  if (/lenovo/.test(maker)) return 'https://support.lenovo.com/us/en/';
  if (/asus/.test(maker)) return 'https://www.asus.com/support/download-center/';
  if (/micro-star|msi/.test(maker)) return 'https://www.msi.com/support/download/';
  if (/gigabyte/.test(maker)) return 'https://www.gigabyte.com/Support';
  if (/acer/.test(maker)) return 'https://www.acer.com/us-en/support/drivers-and-manuals';
  if (/microsoft/.test(maker)) return 'https://support.microsoft.com/surface';
  return '';
}

const tidyVendor = s => String(s || '').replace(/\((r|tm)\)/gi, '').replace(/[,.]?\s*\b(inc|corporation|corp|co|ltd|llc|gmbh|technologies|technology|semiconductor)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
const GENERIC = /^(microsoft|\(standard|standard|generic|windows|unknown|nvidia)|^$/i;

async function checkComponents(devs, ctx) {
  const out = [], used = new Set(), done = new Set();
  const drv = devs.filter(d => d.k === 'drv'), apps = devs.filter(d => d.k === 'app'), pc = devs.find(d => d.k === 'pc');

  // Runs one check, at most once per key, and turns a failure into a card instead of an error.
  async function run(key, label, fn) {
    if (done.has(key)) return;
    done.add(key);
    try { out.push(await fn()); }
    catch (e) {
      out.push({ vendor: label, category: 'Other', gpu: label, installed: '', status: 'unknown', page: '', source: label,
        note: 'Could not check ' + label + '\'s site: ' + (e && e.message ? e.message : e) });
    }
  }

  let amdChipsetSeen = false;
  for (const d of drv) {
    const cls = String(d.cls || '');
    if (isIntel(d) && /^net$/i.test(cls) && /wi-?fi|wireless|wlan|802\.11/i.test(d.name) && !/virtual|direct|miniport|\bwan\b/i.test(d.name)) {
      used.add(d);
      await run('wifi|' + d.name + '|' + d.ver, 'Intel', () => checkIntelWireless(d, true, ctx));
    } else if (isIntel(d) && /bluetooth/i.test(d.name) && !/enumerator|rfcomm|gatt|generic/i.test(d.name)) {
      used.add(d);
      await run('bt|' + d.name + '|' + d.ver, 'Intel', () => checkIntelWireless(d, false, ctx));
    } else if (isAmd(d) && AMD_CHIPSET_DEV.test(d.name)) {
      used.add(d); amdChipsetSeen = true;
    } else if (/^display$/i.test(cls) || (/display audio|hdmi audio|high definition audio/i.test(d.name) && /nvidia|amd|intel/i.test(d.mfr + ' ' + d.prov))) {
      used.add(d);   // updated together with the graphics driver
    }
  }

  const intelApp = apps.find(a => /intel/i.test(a.mfr + ' ' + a.name));
  const amdApp = apps.find(a => /\bamd\b|advanced micro/i.test(a.mfr + ' ' + a.name));
  if (intelApp) await run('intel-chipset', 'Intel', () => checkIntelChipset(intelApp, ctx));
  if (amdApp || amdChipsetSeen) await run('amd-chipset', 'AMD', () => checkAmdChipset(amdApp, ctx));

  // Everything else: group by maker; there is no feed to compare against.
  const groups = new Map();
  for (const d of drv) {
    if (used.has(d)) continue;
    const v = tidyVendor(d.prov || d.mfr);
    if (GENERIC.test(v)) continue;
    const g = groups.get(v) || { n: 0, names: [] };
    g.n++;
    if (g.names.length < 3 && !g.names.includes(d.name)) g.names.push(d.name);
    groups.set(v, g);
  }
  const link = pc ? oemLink(pc) : '';
  for (const [v, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) {
    const intel = /^intel/i.test(v);
    out.push({
      vendor: v, category: 'Other', gpu: v + ' devices (' + g.n + ')', installed: '', status: 'manual',
      page: intel ? INTEL_DSA : link, source: intel ? 'Intel' : 'PC maker',
      note: (intel
        ? 'Intel publishes no version feed for these; its Driver & Support Assistant can check them. '
        : v + ' publishes no version feed, so these cannot be compared automatically; your PC or motherboard maker\'s page has the drivers it supports. ') +
        'Includes: ' + g.names.join(', ') + (g.n > g.names.length ? ' and more' : '') + '.'
    });
  }
  if (pc && link) {
    out.push({
      vendor: tidyVendor(JUNK.test(pc.mfr || '') ? pc.prov : pc.mfr) || 'PC maker', category: 'PC maker',
      gpu: pc.name || 'This PC', installed: '', status: 'manual', page: link, source: 'PC maker',
      note: 'The maker\'s own page lists every driver it supports for this model, including the ones that cannot be checked automatically.'
    });
  }
  return out;
}

// ---------- entry point ----------
async function checkAll(gpus, ctx) {
  const seen = new Set(), out = [];
  for (const g of gpus) {
    const v = vendorOf(g);
    const key = g.name + '|' + g.ver;
    if (!v || seen.has(key)) continue;
    seen.add(key);
    try {
      out.push(await ({ nvidia: checkNvidia, amd: checkAmd, intel: checkIntel })[v](g, ctx));
    } catch (e) {
      const label = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' }[v];
      out.push({
        vendor: label, gpu: g.name, installed: v === 'nvidia' ? nvidiaInstalled(g.ver) : g.ver, status: 'unknown',
        page: { nvidia: NV_PAGE, amd: AMD_PAGE, intel: INTEL_ARC }[v], source: label,
        note: 'Could not check ' + label + '\'s site: ' + (e && e.message ? e.message : e)
      });
    }
  }
  return out.map(x => ({ category: 'Graphics', ...x }));
}

const MAX_DOWNLOAD = 4 * 1024 * 1024 * 1024;   // GeForce installers are about 1 GB; stop anything far beyond that

// Streams a URL to disk. fetchFn is fetch-compatible (Electron's net.fetch in the app).
async function downloadFile(fetchFn, url, dest, onProgress) {
  const fs = require('fs');
  const part = dest + '.part';
  const res = await fetchFn(url, { headers: { 'User-Agent': 'ZanesUtilities/1.0 (driver download)' } });
  if (!res.ok) throw new Error('Download failed (HTTP ' + res.status + ').');
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(part);
  const failed = new Promise((_, rej) => out.on('error', rej));
  failed.catch(() => {});
  let got = 0, last = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), failed]);
      if (done) break;
      got += value.length;
      if (got > MAX_DOWNLOAD) throw new Error('The download was larger than expected, so it was stopped.');
      if (!out.write(value)) await Promise.race([new Promise(r => out.once('drain', r)), failed]);
      if (Date.now() - last > 250) { last = Date.now(); onProgress && onProgress(got, total); }
    }
    await new Promise((ok, bad) => out.end(e => (e ? bad(e) : ok())));
    fs.renameSync(part, dest);
    onProgress && onProgress(got, total);
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(part); } catch {}
    throw e;
  }
  return got;
}

module.exports = { checkAll, checkComponents, downloadFile, NV_DL };
