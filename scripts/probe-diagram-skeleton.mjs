/**
 * scripts/probe-diagram-skeleton.mjs — does a laid-out diagram fall back to its
 * loading placeholder when the page turns?
 *
 * Frame 629 of the recorded demo: the hand-drawn tree on the right page of the
 * Welcome book's "A library of your own" spread is gone, and in its place sits
 * the empty dashed rectangle `.nb-diagram-skeleton` — the box the diagram node
 * shows while it is waiting to be laid out. The callout below it has slid up by
 * the height difference, so this is not a paint artefact: the DOM really did
 * swap a finished drawing for its own placeholder, and a reader turning a page
 * watches a diagram become a loading box.
 *
 * The suspicion is the leaf remount. `BookView` keys each leaf on `id@version`,
 * so anything that bumps a page's doc version around a turn tears the whole
 * `PageEditor` down and builds it again — and `editor/nodes/diagram.tsx` starts
 * every fresh node view at `visible = false`, waiting on an IntersectionObserver
 * callback that cannot possibly arrive in the same frame.
 *
 * Two measurements, because either one alone is arguable:
 *
 *  - a per-animation-frame trace of what each `.nb-diagram` block is showing
 *    (drawn / skeleton / empty) across several turns, which counts the defect;
 *  - a strip of screenshots at fixed delays after a turn LANDS on the diagram
 *    spread, so the placeholder can be looked at rather than believed. rAF is
 *    throttled under SwiftShader, so the trace alone under-reports.
 *
 * Both assert on what is ON SCREEN, not on what the node view believes.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'run';
const OUT = `qa/diagram-skeleton/${TAG}`;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(5000);

/**
 * What every diagram block is currently showing, and WHERE it lives — a live
 * leaf the reader is looking at, or the `.nb-export-offscreen` staging the flip
 * rasterizes its back and revealed faces from. The two are different bugs
 * wearing the same dashed box, and counting them together hides one of them.
 */
const blocks = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-diagram')].map((d) => {
      const state = d.querySelector('.nb-diagram-skeleton') ? 'skeleton'
        : d.querySelector('.nb-dg-svg') ? 'drawn' : 'empty';
      const where = d.closest('.nb-export-offscreen') ? 'staged' : 'leaf';
      return `${where}:${state}`;
    }),
  );

/**
 * Walk FORWARD to the next spread that holds a diagram. Forward only: the
 * Welcome book carries diagrams on several spreads, and hammering ArrowLeft to
 * get back to a known page walks off the front of the book instead.
 */
const gotoDiagramSpread = async () => {
  for (let k = 0; k < 10; k += 1) {
    if ((await page.locator('.nb-diagram').count()) > 0) return k;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2200);
  }
  return -1;
};
const spreads = await gotoDiagramSpread();
console.log(`diagram spread reached after ${spreads} turn(s); showing ${JSON.stringify(await blocks())}\n`);
await page.screenshot({ path: `${OUT}/00-at-rest.png` });

// ---------------------------------------------------------------- the counting
let flashes = 0;
for (let i = 0; i < 4; i += 1) {
  const back = i % 2 === 1;
  await page.evaluate(() => {
    globalThis.__r = [];
    globalThis.__go = true;
    const tick = () => {
      if (!globalThis.__go) return;
      globalThis.__r.push({
        t: Math.round(performance.now()),
        blocks: [...document.querySelectorAll('.nb-diagram')].map((d) => {
          const state = d.querySelector('.nb-diagram-skeleton') ? 'skeleton'
            : d.querySelector('.nb-dg-svg') ? 'drawn' : 'empty';
          return `${d.closest('.nb-export-offscreen') ? 'staged' : 'leaf'}:${state}`;
        }),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press(back ? 'ArrowLeft' : 'ArrowRight');
  await page.waitForTimeout(2600);
  const trace = await page.evaluate(() => { globalThis.__go = false; return globalThis.__r; });

  const skeletonFrames = trace.filter((f) => f.blocks.includes('leaf:skeleton'));
  const stagedFrames = trace.filter((f) => f.blocks.includes('staged:skeleton'));
  if (skeletonFrames.length > 0) flashes += 1;
  console.log(
    `  ${skeletonFrames.length === 0 ? 'ok    ' : 'FLASH '} turn ${i + 1} ` +
      `(${back ? 'back' : 'forward'}): ${trace.length} frames, ` +
      `${skeletonFrames.length} showed a skeleton on a live leaf, ` +
      `${stagedFrames.length} on a staged sheet`,
  );
}

// ---------------------------------------------------------------- the looking
// Turn away and come straight back, so the landing spread is the diagram one,
// then photograph it while it is settling. A leaf that remounts clean will show
// the placeholder here and nowhere else.
console.log('\nturning away and back, photographing the landing:');
await gotoDiagramSpread();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
await page.keyboard.press('ArrowLeft');
const strip = [];
for (const delay of [120, 260, 420, 700, 1100, 1800]) {
  await page.waitForTimeout(delay - (strip.at(-1)?.delay ?? 0));
  const state = await blocks();
  const file =
    `${OUT}/land-${String(delay).padStart(4, '0')}ms-` +
    `${state.join('+').replace(/:/g, '-') || 'none'}.png`;
  await page.screenshot({ path: file });
  strip.push({ delay, state });
  console.log(`  +${delay}ms  ${JSON.stringify(state)}  ${file}`);
}

// -------------------------------------------------------------- the turn itself
// The DOM counts above cannot see the flip: once the curl is up, the reader is
// looking at TEXTURES, and the back and revealed faces of a turn are rasterized
// from the staged sheet. So drag the corner slowly by hand — a keyboard turn is
// over in a few throttled frames — and photograph the spread while the curl is
// held open. This is the frame the demo caught.
console.log('\nholding a corner mid-turn and photographing the curl:');
await gotoDiagramSpread();
const surface = await page.locator('.nb-flip-surface').boundingBox();
if (surface) {
  const y = surface.y + surface.height * 0.5;
  await page.mouse.move(surface.x + surface.width - 12, y);
  await page.mouse.down();
  for (const [k, fraction] of [0.82, 0.66, 0.5].entries()) {
    await page.mouse.move(surface.x + surface.width * fraction, y, { steps: 12 });
    await page.waitForTimeout(360);
    const file = `${OUT}/curl-${k + 1}.png`;
    await page.screenshot({ path: file });
    console.log(`  held at ${Math.round(fraction * 100)}% width  ${file}`);
  }
  await page.mouse.move(surface.x + surface.width - 12, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

console.log(`\n${flashes} of 4 turns showed a diagram fall back to its placeholder.`);
console.log(
  `landing strip: ${strip.some((s) => s.state.includes('leaf:skeleton')) ? 'SKELETON SEEN ON A LIVE LEAF' : 'no skeleton on a live leaf'}`,
);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
