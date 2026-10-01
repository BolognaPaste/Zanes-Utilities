// Internet link: lets friends outside your home network reach the chat server without any router setup.
//
// It runs Cloudflare's free "quick tunnel" program (cloudflared, no account needed). cloudflared makes an outbound
// connection from this PC to Cloudflare and prints an address like https://quiet-river-fox.trycloudflare.com. Whoever
// opens that address reaches the chat server on this PC, over HTTPS between them and Cloudflare. The address is new
// every time the link is opened. Nothing is downloaded by the app: you provide cloudflared.exe (see findBinary).
//
// The tunnel only ever points at the chat server's port on 127.0.0.1, never at anything else on the PC.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const READY_MS = 45000;          // give up if the link is not up by then
const GRACE_MS = 15000;          // after the address is printed, wait this long for "registered" before showing it anyway
const NAMES = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared'];

// Where cloudflared is looked for: the file you picked, then "cloudflared" folders next to the app, in its resources
// and in its data folder, then the folders on PATH.
function findBinary(savedPath, dirs) {
  const ok = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
  if (savedPath && path.isAbsolute(savedPath) && ok(savedPath)) return savedPath;
  const all = (dirs || []).concat(String(process.env.PATH || '').split(path.delimiter).filter(Boolean));
  for (const d of all) for (const n of NAMES) { const f = path.join(d, n); if (ok(f)) return f; }
  return '';
}
// A file chosen in the file dialog must at least look like cloudflared.
const looksRight = f => typeof f === 'string' && path.isAbsolute(f) && /^cloudflared[^\\/]*$/i.test(path.basename(f)) && (process.platform !== 'win32' || /\.exe$/i.test(f));

class Tunnel {
  constructor(onClose) {
    this.onClose = onClose || (() => {});
    this.state = 'off';          // off | starting | on | error
    this.url = '';
    this.error = '';
    this.child = null;
    this.tail = [];
  }
  fail(message) { this.state = 'error'; this.error = message; this.url = ''; }
  status() { return { state: this.state, url: this.url, error: this.error }; }

  // Resolves with the public address once the link works.
  start(bin, port) {
    if (this.child) return Promise.reject(new Error('The internet link is already starting or open.'));
    this.state = 'starting'; this.url = ''; this.error = ''; this.tail = [];
    return new Promise((resolve, reject) => {
      let settled = false, found = '', graceT = 0;
      const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + port], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;

      const finish = (err, url) => {
        if (settled) return;
        settled = true;
        clearTimeout(graceT); clearTimeout(limit);
        if (err) { this.state = 'error'; this.error = err.message; this._kill(); reject(err); }
        else { this.state = 'on'; this.url = url; resolve(url); }
      };
      const limit = setTimeout(() => finish(new Error('The internet link did not come up in time. Check your internet connection and try again.')), READY_MS);

      const onData = buf => {
        const text = buf.toString('utf8');
        for (const line of text.split(/\r?\n/)) { if (line.trim()) { this.tail.push(line.trim().slice(0, 300)); if (this.tail.length > 25) this.tail.shift(); } }
        if (!found) {
          // "api.trycloudflare.com" shows up in error messages; the link itself is a different name.
          for (const m of text.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)) {
            if (m[1].toLowerCase() !== 'api') { found = 'https://' + m[1].toLowerCase() + '.trycloudflare.com'; break; }
          }
          if (found) graceT = setTimeout(() => finish(null, found), GRACE_MS);
        }
        // The address only works once cloudflared says it connected; opening it earlier can make the name fail to look up.
        if (found && /registered tunnel connection/i.test(text)) finish(null, found);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', e => finish(new Error(e.code === 'ENOENT' ? 'cloudflared could not be started (file not found).' : 'cloudflared could not be started: ' + e.message)));
      child.on('exit', code => {
        if (child._stopped) {             // we closed it ourselves (stop, or a failure already reported)
          if (!settled) { settled = true; clearTimeout(graceT); clearTimeout(limit); reject(new Error('The internet link was closed.')); }
          return;
        }
        const was = this.state;
        if (this.child === child) this.child = null;
        if (!settled) {
          const hint = this.tail.filter(l => /\b(ERR|error|failed)\b/i.test(l)).slice(-1)[0];
          finish(new Error('cloudflared stopped (code ' + code + ').' + (hint ? ' ' + hint : '')));
        } else if (was === 'on') {
          this.state = 'error'; this.error = 'The internet link closed unexpectedly.'; this.url = '';
          this.onClose();
        }
      });
    });
  }

  _kill() {
    const c = this.child;
    this.child = null;
    if (c) { c._stopped = true; try { c.kill(); } catch {} }
  }
  stop() {
    const had = this.state === 'on' || this.state === 'starting';
    this._kill();
    this.state = 'off'; this.url = ''; this.error = '';
    if (had) this.onClose();
  }
}

module.exports = { Tunnel, findBinary, looksRight };
