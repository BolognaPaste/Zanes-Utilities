// QA-3: smoke tests for the real app. They run on Windows CI (windows-latest) and on a developer PC.
// NOTE: written from reading the markup, first run happens on Windows CI. Selectors below come from index.html.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launch } = require('./helpers');

const TABS = [
  'home',
  'test',
  'next',
  'crash',
  'hist',
  'opt',
  'media',
  'games',
  'fmhy',
  'drv',
  'phone',
  'shred',
  'vault',
  'ssh',
  'settings'
];

async function openTool(page, tab) {
  // Tools inside a collapsed nav group are hidden until the group is opened.
  const group = page.locator('nav details.ng:has(.nv[data-p="' + tab + '"])');
  if ((await group.count()) && !(await group.evaluate(d => d.open))) await group.locator('summary').click();
  await page.click('.nv[data-p="' + tab + '"]');
  await expect(page.locator('#p-' + tab)).toBeVisible();
}

test('app starts, shows Home, and every tool opens without a load error', async () => {
  const { page, close } = await launch();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  try {
    for (const tab of TABS) {
      await openTool(page, tab);
      await expect(page.locator('#p-' + tab + ' .lz-err')).toHaveCount(0);
      await expect(page.locator('#p-' + tab)).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 });
    }
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  } finally {
    await close();
  }
});

test('crash analyzer scans a large log on a worker thread and the window keeps responding', async () => {
  // About 25 MB of log lines with the crash at the very end. Scanned on the page's own thread this stalls it for over a second.
  const file = path.join(require('os').tmpdir(), 'zu-big-' + process.pid + '.log');
  const lines = [];
  for (let i = 0; i < 230000; i++)
    lines.push('[2026.10.28-12.00.00:' + (i % 1000) + '] LogStreaming: Loaded asset /Game/Maps/Tile_' + i + ' in 4.2ms');
  fs.writeFileSync(file, lines.join('\n') + '\nFatal error: EXCEPTION_ACCESS_VIOLATION reading address 0x0\n');
  const { page, close } = await launch();
  try {
    await openTool(page, 'crash');
    await page.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      window.__tick = setInterval(() => {
        const now = performance.now();
        window.__gaps.push(now - last);
        last = now;
      }, 16);
    });
    await page.setInputFiles('#fi', file);
    await expect(page.locator('#out section h2')).toHaveText(path.basename(file), { timeout: 60_000 });
    const r = await page.evaluate(() => {
      clearInterval(window.__tick);
      return { worstGapMs: Math.round(Math.max(...window.__gaps)), text: document.querySelector('#out section').textContent };
    });
    console.log('CRASH-SCAN ' + JSON.stringify({ worstGapMs: r.worstGapMs }));
    expect(r.text).toContain('Memory access violation');
    expect(r.worstGapMs).toBeLessThan(400);
  } finally {
    await close();
    fs.rmSync(file, { force: true });
  }
});

test('window follows the security baseline (sandbox, no node in the page)', async () => {
  const { page, close } = await launch();
  try {
    const exposed = await page.evaluate(() => ({
      req: typeof require,
      proc: typeof process,
      tools: typeof window.appTools,
      diag: typeof window.appDiag
    }));
    expect(exposed).toEqual({ req: 'undefined', proc: 'undefined', tools: 'object', diag: 'object' });
  } finally {
    await close();
  }
});

test('app lock: turn on, lock, reject a wrong password, unlock', async () => {
  const { page, close } = await launch();
  try {
    await page.click('.nv[data-p="settings"]');
    await page.click('#p-settings .sx-act[data-sj="lk-card"]');
    await page.fill('#lk-n1', 'e2e-password');
    await page.fill('#lk-n2', 'e2e-password');
    await page.click('#lk-set');
    await expect(page.locator('#lk-onbox')).toBeVisible({ timeout: 20_000 });
    await page.click('#lk-now');
    await expect(page.locator('#lk')).toBeVisible();
    await page.fill('#lk-pw', 'wrong-password');
    await page.click('#lk-go');
    await expect(page.locator('#lk-err')).not.toHaveText('');
    await page.fill('#lk-pw', 'e2e-password');
    await page.click('#lk-go');
    await expect(page.locator('#lk')).toBeHidden({ timeout: 20_000 });
  } finally {
    await close();
  }
});

test('delete all app data returns the app to a fresh state', async () => {
  const { page, close } = await launch();
  try {
    await page.evaluate(() => localStorage.setItem('gca-e2e-marker', '1'));
    await page.click('#dd-x');
    await page.click('#dwy');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.nv[data-p="home"]');
    expect(await page.evaluate(() => localStorage.getItem('gca-e2e-marker'))).toBeNull();
  } finally {
    await close();
  }
});

test('baseline: cold start and memory are recorded for the performance budget (QA-4)', async () => {
  const { app, page, coldStartMs, close } = await launch();
  try {
    await page.waitForTimeout(3000); // let idle-time preloading settle, as a real user would see
    const metrics = await app.evaluate(({ app: a }) =>
      a.getAppMetrics().map(m => ({ type: m.type, workingSetKB: m.memory.workingSetSize }))
    );
    const total = metrics.reduce((s, m) => s + m.workingSetKB, 0);
    const out = { platform: process.platform, coldStartMs, idleWorkingSetMB: Math.round(total / 1024), processes: metrics.length };
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(path.join('test-results', 'perf-' + process.platform + '.json'), JSON.stringify(out, null, 2));
    console.log('PERF', JSON.stringify(out));
    expect(coldStartMs).toBeGreaterThan(0);
  } finally {
    await close();
  }
});
