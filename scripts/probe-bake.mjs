/**
 * scripts/probe-bake.mjs — startup bake profiler + longtask observer.
 *
 * Loads the shelf headless with ?fx=force&bakeprof=1, records Performance
 * longtasks (event-loop blocking) and the __bakeProfile samples, then prints
 * a ranked breakdown of where the startup milliseconds went. Optionally
 * saves a screenshot (arg: --shot=out.png).
 *
 * Usage: node scripts/probe-bake.mjs [--url=http://localhost:1420] [--wait=25000] [--shot=path.png]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const WAIT_MS = Number(opt('wait', '25000'));
const SHOT = opt('shot', null);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') console.log('[err]', t);
  else if (t.includes('[bake]')) console.log('[log]', t);
});

await page.addInitScript(() => {
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    /* longtask unsupported */
  }
  // Event-loop latency sampler: how long a 0ms timeout actually takes.
  window.__latency = [];
  const tick = () => {
    const t0 = performance.now();
    setTimeout(() => {
      window.__latency.push(Math.round(performance.now() - t0));
      if (window.__latency.length < 4000) tick();
    }, 0);
  };
  tick();
});

const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });

// Wait for the world object — time-based polling, not rAF (rAF starves
// during the freeze), then let the bake storm play out.
let bootMs = -1;
try {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 300000,
    polling: 500,
  });
  bootMs = Date.now() - t0;
} catch {
  console.log('[warn] world object never appeared within 300s — dumping partials');
}
await page.waitForTimeout(WAIT_MS);

const report = await page.evaluate(() => {
  const samples = Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile : [];
  const tasks = Array.isArray(window.__longtasks) ? window.__longtasks : [];
  const latency = Array.isArray(window.__latency) ? window.__latency : [];
  const done = globalThis.__shelfWorld !== undefined;
  return { samples, tasks, latency, done };
});

if (SHOT) {
  try {
    await page.screenshot({ path: SHOT, timeout: 60000 });
  } catch (e) {
    console.log('[warn] screenshot failed:', String(e).slice(0, 120));
  }
}
await browser.close();

const bakes = report.samples
  .filter((s) => s.kind === 'bake' || s.kind === 'spine')
  .sort((a, b) => b.ms - a.ms);
const disks = report.samples.filter((s) => s.kind === 'disk');
const total = bakes.reduce((n, s) => n + s.ms, 0);
const taskTotal = report.tasks.reduce((n, t) => n + t.dur, 0);
const worstTasks = [...report.tasks].sort((a, b) => b.dur - a.dur).slice(0, 8);
const lat = report.latency.slice().sort((a, b) => a - b);
const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);

console.log(`\n== boot: world object after ${bootMs}ms; sampled over +${WAIT_MS}ms ==`);
console.log(`longtasks: ${report.tasks.length} tasks, ${taskTotal}ms total blocking`);
for (const t of worstTasks) console.log(`  task @${t.start}ms dur=${t.dur}ms`);
console.log(
  `event-loop latency ms: p50=${pct(50)} p90=${pct(90)} p99=${pct(99)} max=${lat[lat.length - 1] ?? 0}`,
);
console.log(`\nbakes: ${bakes.length} producer runs, ${total.toFixed(0)}ms total; ${disks.length} disk hits`);
for (const s of bakes.slice(0, 24)) {
  console.log(`  ${s.ms.toFixed(0).padStart(6)}ms  ${s.kind.padEnd(5)} ${s.what}`);
}
if (bakes.length > 24) console.log(`  … +${bakes.length - 24} more`);
