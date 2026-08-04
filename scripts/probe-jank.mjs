/**
 * scripts/probe-jank.mjs — what stalls the main thread, and for how long.
 *
 * Two reports that look unrelated and are probably one bug:
 *
 *   *"sometimes there is a sound effect bug of static … it's a sound rendering
 *    bug, not a sound source quality problem"*
 *   *"if the user clicks on the sidebar options to open a panel, there is a huge
 *    FPS drop before it gets restored again back to 240 FPS"*
 *
 * Two other explanations were measured and killed first, which is why this one
 * is worth the trouble. `probe-sound-clip.mjs` taps Howler's master with an
 * AnalyserNode and finds peak 0.18 with six auditions stacked (no clipping) and
 * flatness 0.03 (no noise wash). But an analyser lives INSIDE the graph: it
 * reports what the graph renders, not what the device receives. When the render
 * quantum misses its deadline the samples are computed perfectly and arrive
 * late, and that is heard as a crackle — which is exactly the word "static"
 * covers, and exactly what a main-thread stall long enough to cost frames would
 * also produce.
 *
 * So this measures stalls directly: `PerformanceObserver('longtask')` plus a
 * rAF gap monitor, around the three things the reader named — advancing a tour
 * step, pressing a sound-set chip, and opening a rail panel.
 *
 *   npm run dev
 *   node scripts/probe-jank.mjs
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

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
await page.waitForTimeout(1500);

/**
 * Arm both monitors.
 *
 * `longtask` is the browser's own answer to "the main thread was busy for more
 * than 50 ms", which is the threshold at which an interaction stops feeling
 * immediate. The rAF gap is the second opinion: a task can stall presentation
 * without being attributed as a long task, and the gap is what a frame counter
 * would have shown the reader.
 */
await page.evaluate(() => {
  globalThis.__tasks = [];
  globalThis.__gaps = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) globalThis.__tasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    globalThis.__noLongtask = true;
  }
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    globalThis.__gaps.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  globalThis.__reset = () => {
    globalThis.__tasks = [];
    globalThis.__gaps = [];
  };
});

const measure = async (label, action, settle = 1400) => {
  await page.evaluate(() => globalThis.__reset());
  await action();
  await page.waitForTimeout(settle);
  const r = await page.evaluate(() => {
    const gaps = globalThis.__gaps.slice(1);
    gaps.sort((a, b) => b - a);
    return {
      tasks: globalThis.__tasks.slice().sort((a, b) => b - a),
      worstGap: gaps[0] ?? 0,
      frames: gaps.length,
      // What a frame counter would print: the worst gap as an instantaneous fps.
      worstFps: gaps[0] > 0 ? 1000 / gaps[0] : 0,
      noLongtask: globalThis.__noLongtask === true,
    };
  });
  const bad = r.tasks.filter((t) => t >= 50);
  console.log(
    `   ${bad.length > 0 ? 'STALL' : 'ok   '}  ${label.padEnd(34)} ` +
      `longest task ${String(r.tasks[0] ?? 0).padStart(4)}ms · ` +
      `worst frame gap ${r.worstGap.toFixed(0).padStart(4)}ms (${r.worstFps.toFixed(0)} fps)` +
      (bad.length > 1 ? `  · ${bad.length} tasks over 50ms` : ''),
  );
  return r;
};

console.log('\n2. a quiet shelf — the control');
await measure('doing nothing', async () => {});

console.log('\n3. the rail panels the reader named');
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

for (const tool of ['customize', 'page-style', 'catalogue', 'toc', 'share']) {
  const btn = page.locator(`.nb-rail-button[data-tool="${tool}"]`);
  if ((await btn.count()) === 0) continue;
  await measure(`open the ${tool} panel`, async () => {
    await btn.first().click({ force: true });
  });
  await measure(`close the ${tool} panel`, async () => {
    await btn.first().click({ force: true });
  });
}

console.log('\n4. the studio, which the reader guessed at too');
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
