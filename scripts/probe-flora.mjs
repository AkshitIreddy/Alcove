/**
 * scripts/probe-flora.mjs — flora composition visual QA probe.
 *
 * Loads the shelf headless (SwiftShader, ?fx=force&bakeprof=1), waits for the
 * bake storm to drain, then captures zoomed crops of the composition's key
 * zones out of the page with Playwright's clip:
 *
 *   <shot>-crown.png        the crown board: blossom branch close-up
 *   <shot>-edge-left.png    floor 0 left rail/corner: vine curtain close-up
 *   <shot>-edge-right.png   floor 1 right rail zone
 *   <shot>-centre.png       floor 1 central book field (negative-space check)
 *   <shot>-corner-tuft.png  floor 0 bottom-left plank joint: moss/grass tufts
 *
 * Assumes books were already seeded (scripts/probe-books.mjs); skips seeding
 * when 60+ books exist.
 *
 * Usage: node scripts/probe-flora.mjs [--url=http://localhost:1420] [--shot=qa/flora]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const SHOT = opt('shot', 'qa/flora');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  timeout: 300000,
  polling: 500,
});
console.log(`world object after ${Date.now() - t0}ms`);
await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, {
  timeout: 300000,
  polling: 500,
});

/* ---------------------------- bake drain ------------------------------- */
let lastCount = -1;
let stableSince = Date.now();
const drainStart = Date.now();
for (;;) {
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => {
    const samples = Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile : [];
    const w = globalThis.__shelfWorld;
    return { n: samples.length, dirty: w ? w.dirty === true : false };
  });
  if (state.n !== lastCount) {
    lastCount = state.n;
    stableSince = Date.now();
  }
  const quiet = Date.now() - stableSince > 2500 && !state.dirty;
  if (quiet || Date.now() - drainStart > 90000) break;
}
console.log(`bake drain settled after ${Date.now() - drainStart}ms (${lastCount} samples)`);
await page.waitForTimeout(1200);

/* ---------------------------- screenshots ------------------------------ */
async function shot(name, clip) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: `${SHOT}-${name}.png`, clip, timeout: 45000 });
      console.log(`shot ${SHOT}-${name}.png`);
      return;
    } catch {
      console.log(`[warn] shot ${name} attempt ${attempt + 1} timed out`);
      await page.waitForTimeout(1500);
    }
  }
}

await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomFit();
  w.dirty = true;
});
await page.waitForFunction(() => globalThis.__shelfWorld?.dirty === false, null, {
  timeout: 20000,
  polling: 250,
}).catch(() => undefined);
await page.waitForTimeout(700);

/** Screen rect (CSS px) of a world rect, via the app's own camera math. */
async function worldRectToScreen(x0, y0, x1, y1) {
  return page.evaluate(
    ([wx0, wy0, wx1, wy1]) => {
      const w = globalThis.__shelfWorld;
      const cam = w['camera'];
      return {
        x: (wx0 - cam.x) * cam.zoom,
        y: (wy0 - cam.y) * cam.zoom,
        width: (wx1 - wx0) * cam.zoom,
        height: (wy1 - wy0) * cam.zoom,
      };
    },
    [x0, y0, x1, y1],
  );
}

// The crown board + the top of floor 0 (blossom branch close-up).
await shot('crown', await worldRectToScreen(300, -84, 1200, 80));
// Floor 0's left rail + upper corner + plank joint, top to plank.
await shot('edge-left', await worldRectToScreen(0, 0, 340, 320));
// Floor 1's right rail zone (the mirror side, one floor down).
await shot('edge-right', await worldRectToScreen(860, 320, 1200, 640));
// Floor 1's central book field — the negative-space check.
await shot('centre', await worldRectToScreen(380, 320, 820, 640));
// Floor 0's bottom-left plank joint: the moss/grass tuft close-up.
await shot('corner-tuft', await worldRectToScreen(0, 180, 400, 360));

await browser.close();
