/**
 * probe-responsive.mjs — is the window ALIVE while the shelf paints itself?
 *
 * Runs the same cold boot twice in one go — once with the art worker disabled
 * (`?artworker=0`, i.e. the old all-on-the-main-thread pipeline) and once with
 * it on — and reports, for each:
 *
 *   - time to first shelf pixels,
 *   - time to interactive (the first 1.5s stretch with no block over 100ms),
 *   - the worst single main-thread block,
 *   - how many of the 1s samples were unresponsive,
 *   - total longtask blocking time.
 *
 * The lag sampler is a self-rescheduling 0ms timeout: the amount by which it
 * comes back LATE is exactly how long the main thread was busy, which is the
 * only definition of "frozen" the user experiences.
 *
 * node qa/_probes/probe-responsive.mjs [--url=…] [--wait=45000] [--books=42] [--only=on|off]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1445');
const WAIT = Number(opt('wait', '45000'));
const BOOKS = Number(opt('books', '42'));
const ONLY = opt('only', '');
mkdirSync('qa/freeze', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

/** Seed a stub DB with `n` books, in its own context, so boots are realistic. */
async function seed(context) {
  if (BOOKS <= 0) return;
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [seed pageerror]', e.message.slice(0, 200)));
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 300000,
    polling: 400,
  });
  await page.evaluate(() => {
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page
    .waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 })
    .catch(() => {});
  const seeded = await page.evaluate(async (count) => {
    try {
      const create = globalThis.__shelfSeedBooks;
      if (typeof create !== 'function') return 'no __shelfSeedBooks hook';
      const per = Math.ceil(count / 3);
      for (let floor = 0; floor < 3; floor++) {
        const titles = [];
        for (let i = 0; i < per && floor * per + i < count; i++) {
          titles.push(`Volume ${floor * per + i + 1} of the Long Shelf`);
        }
        await create(titles, floor);
      }
      const KEY = 'notebook.stubdb.v1';
      const tables = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      return (tables.books ?? []).length;
    } catch (e) {
      return `seed failed: ${String(e)}`;
    }
  }, BOOKS);
  console.log(`  seeded → ${seeded} books in the stub DB`);
  await page.evaluate(() => {
    const KEY = 'notebook.stubdb.v1';
    const tables = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const s = Array.isArray(tables.settings) ? tables.settings : [];
    const hit = s.find((r) => r && r.key === 'appState:tutorialCompleted');
    if (hit) hit.value = '1';
    else s.push({ key: 'appState:tutorialCompleted', value: '1' });
    tables.settings = s;
    localStorage.setItem(KEY, JSON.stringify(tables));
  });
  await page.close();
}

async function measure(label, query) {
  // A fresh context per run: no shared memory cache, no warm GPU program cache.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await seed(context);

  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [console.error] ${m.text().slice(0, 160)}`);
  });

  await page.addInitScript(() => {
    window.__t0 = performance.now();
    window.__lag = [];
    const tick = () => {
      const t = performance.now();
      setTimeout(() => {
        window.__lag.push([Math.round(t - window.__t0), Math.round(Math.max(0, performance.now() - t))]);
        tick();
      }, 0);
    };
    tick();
    window.__longtasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      /* unsupported */
    }
    window.__firstPaint = -1;
    const probe = () => {
      if (window.__firstPaint < 0) {
        const c = document.querySelector('canvas.shelf-canvas') ?? document.querySelector('canvas');
        if (c && c.width > 0) window.__firstPaint = Math.round(performance.now() - window.__t0);
      }
      if (window.__firstPaint < 0) requestAnimationFrame(probe);
    };
    requestAnimationFrame(probe);
  });

  await page.goto(`${URL_BASE}/?fx=force&bakeprof=1${query}`, {
    waitUntil: 'domcontentloaded',
    timeout: 300000,
  });
  await page.waitForTimeout(WAIT);

  const r = await page.evaluate(() => ({
    lag: window.__lag ?? [],
    tasks: window.__longtasks ?? [],
    firstPaint: window.__firstPaint,
    samples: globalThis.__bakeProfile ?? [],
    books: document.querySelectorAll('.shelf-a11y button').length,
  }));
  await context.close();

  const blocks = r.lag.filter(([, d]) => d > 0);
  const worst = Math.max(0, ...r.lag.map(([, d]) => d));
  const over100 = r.lag.filter(([, d]) => d > 100);
  const over500 = r.lag.filter(([, d]) => d > 500);
  const frozenMs = over100.reduce((n, [, d]) => n + d, 0);
  const taskTotal = r.tasks.reduce((n, [, d]) => n + d, 0);

  // TTI: the moment the last >100ms block ended — after this the window
  // answers every single poll within a frame.
  const tti = over100.reduce((n, [t, d]) => Math.max(n, t + d), 0);

  console.log(`\n===== ${label} =====`);
  console.log(`  books on shelf        ${r.books}`);
  console.log(`  first shelf pixels    ${r.firstPaint}ms`);
  console.log(`  interactive (TTI)     ${tti}ms   (end of the last >100ms block)`);
  console.log(`  worst single block    ${worst}ms`);
  console.log(`  blocks >100ms         ${over100.length}   >500ms: ${over500.length}`);
  console.log(`  time spent frozen     ${frozenMs}ms of the ${WAIT}ms window`);
  console.log(`  longtask blocking     ${taskTotal}ms across ${r.tasks.length} tasks`);
  console.log(
    `  worst blocks          ${[...r.lag]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([t, d]) => `${d}ms@${t}ms`)
      .join('  ')}`,
  );
  const bakes = r.samples.filter((s) => s.kind !== 'disk');
  console.log(
    `  art pieces painted    ${bakes.length}  (${bakes.reduce((n, s) => n + s.ms, 0).toFixed(0)}ms of paint, wherever it ran)`,
  );
  void blocks;
  return { label, firstPaint: r.firstPaint, tti, worst, over100: over100.length, frozenMs, taskTotal };
}

const results = [];
if (ONLY !== 'on') results.push(await measure('BEFORE — art on the main thread', '&artworker=0'));
if (ONLY !== 'off') results.push(await measure('AFTER  — art in worker threads', ''));
await browser.close();

writeFileSync('qa/freeze/responsive.json', JSON.stringify(results, null, 2));
if (results.length === 2) {
  const [b, a] = results;
  console.log('\n===== delta =====');
  const row = (name, x, y, unit = 'ms') =>
    console.log(`  ${name.padEnd(22)} ${String(x).padStart(8)}${unit} → ${String(y).padStart(8)}${unit}`);
  row('first shelf pixels', b.firstPaint, a.firstPaint);
  row('interactive (TTI)', b.tti, a.tti);
  row('worst single block', b.worst, a.worst);
  row('blocks >100ms', b.over100, a.over100, '');
  row('time frozen', b.frozenMs, a.frozenMs);
  row('longtask blocking', b.taskTotal, a.taskTotal);
}
