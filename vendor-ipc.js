// Manufacturer-site checks (graphics, Wi-Fi, Bluetooth, chipset) and verified NVIDIA downloads.
// See vendor-sources.js for what is queried.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPS, readPS, listResult } = require('./driver-ipc');
const { checkAll, checkComponents, downloadFile, NV_DL } = require('./vendor-sources');

const UA = 'ZanesUtilities/1.0 (driver version check)';
const HOSTS = new Set(['www.nvidia.com', 'gfwsl.geforce.com', 'www.amd.com', 'www.intel.com']);
const TTL = 30 * 60 * 1000;

function register(ipcMain, getWin, { app, net, shell }) {
  const send = m => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('vnd:progress', m); };
  const cache = new Map();
  const verified = new Set();
  let checking = false, downloading = false;

  // Only these manufacturer hosts are ever contacted, and results are kept for 30 minutes.
  async function get(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new Error('Blocked host ' + u.hostname);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ac.signal });
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      const v = await res.text();
      if (v.length > 3e6) throw new Error('Response too large');
      cache.set(url, { t: Date.now(), v });
      return v;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('timed out');
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function sigCheck(file) {
    const r = await runPS(readPS('sigcheck.ps1').replace('__FILE__', () => file.replace(/'/g, "''")), 180000);
    const line = r.out.replace(/\uFEFF/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop();
    let j = {};
    try { j = JSON.parse(line); } catch {}
    return { ok: j.status === 'Valid' && j.cn === 'NVIDIA Corporation', status: j.status || 'Unknown', subject: j.subject || '' };
  }

  ipcMain.handle('vnd:check', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Only available on Windows.' };
    if (checking) return { ok: false, error: 'A manufacturer check is already running.' };
    checking = true;
    try {
      const g = listResult(await runPS(readPS('gpus.ps1'), 60000));
      if (!g.ok) return g;
      const build = Number((os.release().split('.')[2]) || 0);
      const data = await checkAll(g.data, { get, build });
      // Wi-Fi, Bluetooth, chipset and the PC maker link. A failure here must not hide the graphics results.
      const noDevices = why => ({ vendor: 'This PC', category: 'Other', gpu: 'Other drivers', installed: '', status: 'unknown', page: '', source: 'Windows', note: 'Could not list the devices in this PC: ' + why });
      try {
        const dv = listResult(await runPS(readPS('devices.ps1'), 90000));
        if (dv.ok) data.push(...await checkComponents(dv.data, { get, build }));
        else data.push(noDevices(dv.error));
      } catch (e) {
        data.push(noDevices(String((e && e.message) || e)));
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally { checking = false; }
  });

  ipcMain.handle('vnd:download', async (_e, req) => {
    if (downloading) return { ok: false, error: 'A download is already running.' };
    const url = String((req && req.url) || '').replace(/^http:\/\//i, 'https://');
    if (!NV_DL.test(url)) return { ok: false, error: 'That download address is not an NVIDIA installer.' };
    downloading = true;
    try {
      const dir = path.join(app.getPath('downloads'), 'ZanesUtilities');
      fs.mkdirSync(dir, { recursive: true });
      const name = path.basename(new URL(url).pathname).replace(/[^\w.\-]/g, '_');
      const dest = path.join(dir, name);
      await downloadFile(net.fetch.bind(net), url, dest, (got, total) => send({ t: 'dl', got, total }));
      send({ t: 'verify' });
      const sig = await sigCheck(dest);
      if (!sig.ok) {
        try { fs.unlinkSync(dest); } catch {}
        return { ok: false, error: 'The file was deleted because its digital signature is not a valid NVIDIA signature (' + sig.status + ').' };
      }
      verified.add(dest);
      return { ok: true, data: { file: dest, name, subject: sig.subject } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally { downloading = false; }
  });

  // Opens the installer only if this app downloaded it and its signature is still valid.
  ipcMain.handle('vnd:run', async (_e, req) => {
    const file = String((req && req.file) || '');
    if (!verified.has(file) || !fs.existsSync(file)) return { ok: false, error: 'That installer is not available. Download it again.' };
    const sig = await sigCheck(file);
    if (!sig.ok) { verified.delete(file); return { ok: false, error: 'The installer changed since it was verified, so it was not started.' }; }
    const err = await shell.openPath(file);
    return err ? { ok: false, error: err } : { ok: true };
  });
}

module.exports = { register };
