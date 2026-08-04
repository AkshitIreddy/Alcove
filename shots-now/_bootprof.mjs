/**
 * _bootprof.mjs — a CPU profile of the boot, folded to self-time per module.
 *
 * Scratch tool. `perf-boot.mjs` says WHEN the shelf appeared; this says what
 * the main thread was doing until it did. Bundle size and module-scope work
 * are different costs and only a profile tells them apart: a 200 kB table of
 * literals is parse time, a 200-line loop that runs at import is execution
 * time, and the fix for one is not the fix for the other.
 *
 * Self time is attributed to the SCRIPT a frame belongs to, so on the dev
 * server (one request per module) the rows are module paths.
 *
 * Usage: node shots-now/_bootprof.mjs [url]
 */
import { chromium } from 'playwright';

const URL_ = process.argv[2] || 'http://localhost:1420/?fx=force';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
await cdp.send('Profiler.start');

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page
  .waitForFunction(
    () =>
      typeof window.__shelfVisibleBooks === 'function' && window.__shelfVisibleBooks().length > 0,
    null,
    { timeout: 60000 },
  )
  .catch(() => {});

const { profile } = await cdp.send('Profiler.stop');

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = profile.samples.length;
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const key = f.url && f.url.length > 0 ? f.url : `(${f.functionName || 'anonymous'})`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
const span = (profile.endTime - profile.startTime) / 1000;
const ms = (n) => (n / total) * span;

console.log(`profile spans ${span.toFixed(0)}ms, ${total} samples\n`);
const rows = [...self].sort((a, b) => b[1] - a[1]);
console.log('== self time by script ==');
for (const [url, n] of rows.slice(0, 30)) {
  const short = url.startsWith('http') ? new globalThis.URL(url).pathname : url;
  console.log(`  ${ms(n).toFixed(0).padStart(6)}ms  ${short}`);
}

// The same samples folded by top-level FUNCTION, which is where module-scope
// work shows up: an IIFE or a bare statement at import time has no name, so it
// lands under the module's own frame rather than a callee's.
const byFn = new Map();
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const short = f.url?.startsWith('http') ? new globalThis.URL(f.url).pathname : (f.url ?? '');
  const key = `${f.functionName || '(module scope)'}  ${short.split('/').slice(-2).join('/')}`;
  byFn.set(key, (byFn.get(key) ?? 0) + 1);
}
console.log('\n== self time by function ==');
for (const [k, n] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`  ${ms(n).toFixed(0).padStart(6)}ms  ${k}`);

await browser.close();
