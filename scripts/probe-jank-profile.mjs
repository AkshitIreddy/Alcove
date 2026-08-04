/**
 * scripts/probe-jank-profile.mjs — WHERE the panel-open stall is spent.
 *
 * `probe-jank.mjs` established that opening a rail panel blocks the main thread
 * for 60–320 ms (customize 312 ms, catalogue 226 ms) against a 0 ms control.
 * This says which functions.
 *
 * A CPU profile rather than timers around suspected code: the whole point is
 * that the expensive thing is not known yet, and instrumenting a guess measures
 * the guess. `Profiler.start` / `Profiler.stop` over the CDP session samples
 * every stack the main thread is on, so the answer comes back whether it is
 * Solid rendering, a Pixi re-layout, an art bake, or a layout thrash nobody
 * wrote down.
 *
 *   npm run dev
 *   node scripts/probe-jank-profile.mjs
 *   node scripts/probe-jank-profile.mjs --tool=catalogue
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const URL_BASE = arg('url', 'http://localhost:1420');
const TOOL = arg('tool', 'customize');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);

console.log('1. boot');
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });

const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(1200);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-rail', { timeout: 60_000 });
await page.waitForTimeout(4000);

console.log(`2. profile opening the ${TOOL} panel`);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // µs — fine grained
await cdp.send('Profiler.start');

await page.locator(`.nb-rail-button[data-tool="${TOOL}"]`).first().click({ force: true });
await page.waitForTimeout(420);

const { profile } = await cdp.send('Profiler.stop');

/* ----------------------------- read the profile --------------------------- */

/** Self time per node id, from the sample stream and its deltas. */
const selfMs = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const deltas = profile.timeDeltas ?? [];
profile.samples.forEach((id, i) => {
  selfMs.set(id, (selfMs.get(id) ?? 0) + (deltas[i] ?? 0) / 1000);
});

const where = (n) => {
  const f = n.callFrame;
  const file = String(f.url || '')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/\?.*$/, '');
  const name = f.functionName || '(anonymous)';
  return `${name}  ${file}${f.lineNumber >= 0 ? `:${f.lineNumber + 1}` : ''}`;
};

const rows = [...selfMs.entries()]
  .map(([id, ms]) => ({ ms, node: byId.get(id) }))
  .filter((r) => r.node !== undefined && r.ms >= 0.5)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 22);

const total = [...selfMs.values()].reduce((a, b) => a + b, 0);
console.log(`\n   ${total.toFixed(0)}ms of samples in the window\n`);
console.log('   self time  where');
for (const r of rows) {
  console.log(`   ${r.ms.toFixed(1).padStart(7)}ms  ${where(r.node)}`);
}

/*
 * Roll the same self time up by FILE as well. One 300ms stall spread over
 * forty small functions in one module reads as nothing in the list above and
 * as the obvious answer here.
 */
const byFile = new Map();
for (const [id, ms] of selfMs) {
  const n = byId.get(id);
  if (n === undefined) continue;
  const file =
    String(n.callFrame.url || '(native)')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/\?.*$/, '') || '(native)';
  byFile.set(file, (byFile.get(file) ?? 0) + ms);
}
console.log('\n   self time  by file');
for (const [file, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  if (ms < 1) continue;
  console.log(`   ${ms.toFixed(1).padStart(7)}ms  ${file}`);
}

await browser.close();
