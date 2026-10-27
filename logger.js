'use strict';
// Local, rotating, redacted application log (QA-5). No network, no telemetry.
const fs = require('fs');
const path = require('path');
const os = require('os');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_BYTES = 512 * 1024;
const KEEP = 3; // app.log, app.log.1, app.log.2

// Remove things that identify the person or grant access before text is stored or exported.
function redact(input, opts) {
  let s = String(input == null ? '' : input);
  const home = (opts && opts.home) || os.homedir();
  const user = (opts && opts.user) || safeUser();
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (home) s = s.replace(new RegExp(esc(home).replace(/\\\\/g, '[\\\\/]'), 'gi'), '%USERPROFILE%');
  if (user && user.length > 2) s = s.replace(new RegExp('(?<![A-Za-z0-9])' + esc(user) + '(?![A-Za-z0-9])', 'gi'), '<user>');
  s = s.replace(/\b[a-z0-9-]+\.trycloudflare\.com\b/gi, '<tunnel-host>');
  s = s.replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.$2.x.x');
  s = s.replace(/\b[0-9a-f]{32,}\b/gi, '<hex>');
  s = s.replace(/\b([A-Za-z0-9_-]{20,}\.){1,2}[A-Za-z0-9_-]{20,}\b/g, '<token>');
  s = s.replace(/((?:password|passwd|passphrase|token|secret|key)["']?\s*[:=]\s*)(["']?)[^\s"',;}]+/gi, '$1$2<hidden>');
  return s;
}
function safeUser() {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

function create(dir, opts) {
  opts = opts || {};
  const min = LEVELS[opts.level || 'info'];
  const file = path.join(dir, 'app.log');
  let size = -1;
  let failed = false;

  const rotate = () => {
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? file : file + '.' + (i - 1);
      const to = file + '.' + i;
      try {
        fs.rmSync(to, { force: true });
        fs.renameSync(from, to);
      } catch {}
    }
    try {
      fs.rmSync(file, { force: true });
    } catch {}
    size = 0;
  };

  function write(level, msg, extra) {
    if (failed || LEVELS[level] < min) return;
    try {
      if (size < 0) {
        fs.mkdirSync(dir, { recursive: true });
        try {
          size = fs.statSync(file).size;
        } catch {
          size = 0;
        }
      }
      let line = new Date().toISOString() + ' ' + level.toUpperCase().padEnd(5) + ' ' + redact(msg, opts);
      if (extra !== undefined) {
        let t;
        if (extra instanceof Error) t = extra.stack || extra.message || String(extra);
        else if (typeof extra === 'string') t = extra;
        else {
          try {
            t = JSON.stringify(extra);
          } catch {
            t = String(extra);
          }
        }
        line += ' ' + redact(t, opts).replace(/\r?\n/g, ' | ').slice(0, 2000);
      }
      line = line.replace(/\r?\n/g, ' ') + '\n';
      if (size + line.length > MAX_BYTES) rotate();
      fs.appendFileSync(file, line);
      size += line.length;
    } catch {
      failed = true;
    } // logging must never break the app
  }

  return {
    file,
    debug: (m, x) => write('debug', m, x),
    info: (m, x) => write('info', m, x),
    warn: (m, x) => write('warn', m, x),
    error: (m, x) => write('error', m, x),
    // Newest-last text of all rotated logs, already redacted when written.
    readAll() {
      const parts = [];
      for (let i = KEEP - 1; i >= 0; i--) {
        const f = i === 0 ? file : file + '.' + i;
        try {
          parts.push(fs.readFileSync(f, 'utf8'));
        } catch {}
      }
      return parts.join('');
    }
  };
}

module.exports = { create, redact, LEVELS, MAX_BYTES, KEEP };
