const { _electron: electron } = require('@playwright/test');
const os = require('os');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

// Launches the unpackaged app with a throwaway profile so tests never touch real data.
async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'zu-e2e-'));
  const started = Date.now();
  const app = await electron.launch({ args: [root, '--user-data-dir=' + userData], cwd: root, env: { ...process.env, ZU_DEVTOOLS: '0' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.nv[data-p="home"]');
  const coldStartMs = Date.now() - started;
  const close = async () => {
    try {
      await app.close();
    } catch {}
    fs.rmSync(userData, { recursive: true, force: true });
  };
  return { app, page, userData, coldStartMs, close };
}

module.exports = { launch, root };
