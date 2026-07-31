/**
 * probe-freeze.mjs — startup responsiveness + CPU attribution.
 *
 * 1. Samples main-thread lag every 250ms from before navigation until the
 *    world settles (a 0ms timeout that comes back late == a frozen window).
 * 2. Records a V8 CPU profile over the same window and aggregates SELF time
 *    per function, so the blocking work is named rather than guessed.
 * 3. Reports time-to-first-paint of the shelf canvas.
 *
 * node qa/_probes/probe-freeze.mjs [--wait=45000] [--tag=before] [--profile=0]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const WAIT = Number(opt('wait', '45000'));
const TAG = opt('tag', 'before');
const PROFILE = opt('profile', '1') !== '0';
const BOOKS = Number(opt('books', '42'));
mkdirSync('qa/freeze', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

// Pass 1: seed the stub DB with books so the measured boot is a realistic one.
if (BOOKS > 0) {
  const seedPage = await context.newPage();
  await seedPage.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await seedPage.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
  await seedPage.evaluate(() => { void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; }); });
  await seedPage.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 }).catch(() => {});
  const n = await seedPage.evaluate(async (count) => {
    const w = globalThis.__shelfWorld;
    const store = w['store'];
    if ((store.totalBooks?.() ?? 0) >= count - 2) return 0;
    const books = await import('/src/data/books.ts');
    const per = Math.ceil(count / 3);
    for (let i = 0; i < count; i++) {
      await books.createBook({
        title: `Volume ${i + 1} of the Long Shelf`,
        floor: Math.floor(i / per),
        slot: i % per,
        spineSeed: (0x9e3779b1 * (i + 1)) >>> 0,
      });
    }
    await store.refreshAll();
    return count;
  }, BOOKS);
  const settings = await seedPage.evaluate(() => {
    const KEY = 'notebook.stubdb.v1';
    const tables = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const s = Array.isArray(tables.settings) ? tables.settings : [];
    const hit = s.find((r) => r && r.key === 'appState:tutorialCompleted');
    if (hit) hit.value = '1';
    else s.push({ key: 'appState:tutorialCompleted', value: '1' });
    tables.settings = s;
    localStorage.setItem(KEY, JSON.stringify(tables));
    return s.length;
  });
  console.log(`seed pass: created ${n} books, ${settings} settings rows`);
  await seedPage.close();
}

// Pass 2: the measured cold boot (same origin, so the stub DB persists).
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  window.__lag = [];
  window.__t0 = performance.now();
  const tick = () => {
    const t = performance.now();
    setTimeout(() => {
      window.__lag.push([Math.round(t - window.__t0), Math.round(performance.now() - t)]);
      tick();
    }, 250);
  };
  tick();
  window.__longtasks = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__longtasks.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* unsupported */ }
  // First moment the shelf canvas has non-empty pixels.
  window.__firstPaint = -1;
  const probe = () => {
    if (window.__firstPaint < 0) {
      const c = document.querySelector('canvas');
      if (c && c.width > 0) window.__firstPaint = Math.round(performance.now() - window.__t0);
    }
    if (window.__firstPaint < 0) requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
});

const session = PROFILE ? await context.newCDPSession(page) : null;
if (session) {
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 200 });
  await session.send('Profiler.start');
}

const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 300000 });
let worldMs = -1;
try {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 250 });
  worldMs = Date.now() - t0;
} catch { console.log('[warn] world never appeared'); }
await page.waitForTimeout(WAIT);

const report = await page.evaluate(() => ({
  lag: window.__lag ?? [],
  tasks: window.__longtasks ?? [],
  firstPaint: window.__firstPaint,
  samples: globalThis.__bakeProfile ?? [],
  books: globalThis.__shelfWorld?.['store']?.totalBooks?.() ?? -1,
}));

let prof = null;
if (session) prof = (await session.send('Profiler.stop')).profile;
await browser.close();

/* ------------------------------- reporting -------------------------------- */
const lag = report.lag;
const worst = [...lag].sort((a, b) => b[1] - a[1]).slice(0, 8);
const frozenSamples = lag.filter(([, d]) => d > 500);
const frozenMs = frozenSamples.reduce((n, [, d]) => n + d, 0);
const taskTotal = report.tasks.reduce((n, [, d]) => n + d, 0);

console.log(`\n===== ${TAG} =====`);
console.log(`books on shelf: ${report.books}`);
console.log(`canvas first paint: ${report.firstPaint}ms`);
console.log(`world object available: ${worldMs}ms`);
console.log(`longtasks: ${report.tasks.length}, ${taskTotal}ms blocking total`);
for (const [s, d] of [...report.tasks].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`   task @${s}ms dur=${d}ms`);
}
console.log(`main-thread lag samples (250ms cadence): n=${lag.length}`);
console.log(`  worst: ${worst.map(([t, d]) => `${d}ms@${t}ms`).join('  ')}`);
console.log(`  samples over 500ms: ${frozenSamples.length} (${frozenMs}ms of frozen window)`);
console.log(`  samples over 100ms: ${lag.filter(([, d]) => d > 100).length}`);

const bakes = report.samples.filter((s) => s.kind !== 'disk').sort((a, b) => b.ms - a.ms);
console.log(`\nbake producer runs: ${bakes.length}, ${bakes.reduce((n, s) => n + s.ms, 0).toFixed(0)}ms wall`);
for (const s of bakes.slice(0, 12)) console.log(`  ${s.ms.toFixed(0).padStart(6)}ms ${s.kind} ${s.what.slice(0, 74)}`);

if (prof) {
  writeFileSync(`qa/freeze/${TAG}.cpuprofile`, JSON.stringify(prof));
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = prof.samples.length;
  for (const id of prof.samples) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const name = `${f.functionName || '(anonymous)'} @ ${(f.url || '').split('/').slice(-1)[0]}:${f.lineNumber + 1}`;
    self.set(name, (self.get(name) ?? 0) + 1);
  }
  const durMs = (prof.endTime - prof.startTime) / 1000;
  const perSample = durMs / Math.max(1, total);
  console.log(`\nCPU self-time over ${durMs.toFixed(0)}ms (${total} samples):`);
  for (const [name, n] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
    console.log(`  ${(n * perSample).toFixed(0).padStart(6)}ms  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
}
