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

/*
 * 4. THE STUDIO — which the reader named alongside the panels, and which this
 * section did not previously open. It printed its heading, pressed Escape and
 * stopped, so a clean run read as "the studio is fine" when nothing had been
 * measured at all.
 *
 * The studio lives on the SHELF, not inside a book, so this leaves first.
 */
console.log('\n4. the studio, which the reader guessed at too');
// Escape does not leave a book — it closes whatever panel is up — so the two
// earlier versions of this section measured while still inside the Welcome
// book, where the shelf dock is not mounted at all. Go back properly, and
// through the SAME module instance the app uses: a probe's own
// import('/src/state/app.ts') can resolve to a second copy on a dev server
// that has served HMR, and calling closeBook() on that copy does nothing.
await page.evaluate(() => {
  globalThis.__shelfWorld?.closeBook?.();
});
if ((await page.locator('.shelf-dock').count()) === 0) {
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    app.appState.closeBook();
  });
}
await page.waitForTimeout(2600);
// By its accessible name — the dock's buttons carry no data-tool hook, and
// the first version of this section guessed three that do not exist and
// reported SKIPPED, which is the same nothing it printed before.
const studioBtn = page.getByLabel('Library studio').first();
if ((await studioBtn.count()) === 0) {
  // Say WHAT is there instead of just "skipped" — a skip that does not explain
  // itself is how this section spent three runs reporting nothing at all.
  const seen = await page.evaluate(() => ({
    view: document.querySelector('.nb-book-view') !== null ? 'book' : 'shelf',
    dock: document.querySelector('.shelf-dock') !== null,
    labels: [...document.querySelectorAll('button')]
      .map((b) => b.getAttribute('aria-label'))
      .filter((x) => x !== null)
      .slice(0, 12),
  }));
  console.log('   SKIPPED — no studio button. on screen:', JSON.stringify(seen));
} else {
  await measure('open the studio', async () => {
    await studioBtn.click();
  }, 1800);
  // Pressing a design is the expensive half — it re-bakes every case part.
  const swatch = page.locator('.nb-studio button, .nbq-studio button, [data-preset-id]').nth(6);
  if ((await swatch.count()) > 0) {
    await measure('change a design in the studio', async () => {
      await swatch.click();
    }, 2000);
  } else {
    console.log('   (no preset swatch found to press — open/close cost only)');
  }
  await measure('close the studio', async () => {
    await page.keyboard.press('Escape');
  }, 1600);
}

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
