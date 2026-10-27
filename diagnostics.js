'use strict';
// Builds the "Export diagnostics" bundle (QA-5). Contains no personal files, no settings
// values and no chat/vault/SSH data: only versions, hardware class, timings and the redacted log.
const os = require('os');
const { redact } = require('./logger');

function build({ app, process: proc, log, timings, loadedModules, now }) {
  const mem = proc.memoryUsage ? proc.memoryUsage() : {};
  const mb = n => Math.round((n || 0) / 1048576);
  const cpus = os.cpus() || [];
  return {
    schema: 1,
    generated: new Date(now === undefined ? Date.now() : now).toISOString(),
    app: { name: app.getName(), version: app.getVersion(), packaged: !!app.isPackaged },
    runtime: { electron: proc.versions.electron, chrome: proc.versions.chrome, node: proc.versions.node },
    system: {
      platform: proc.platform,
      arch: proc.arch,
      release: os.release(),
      cpu: cpus[0] ? cpus[0].model.trim() : 'unknown',
      cores: cpus.length,
      ramMB: mb(os.totalmem()),
      freeRamMB: mb(os.freemem())
    },
    memoryMB: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed) },
    timingsMs: timings || {},
    loadedModules: Array.from(loadedModules || []),
    log: redact(log || '')
  };
}

function toText(bundle) {
  return JSON.stringify(bundle, null, 2) + '\n';
}

module.exports = { build, toText };
