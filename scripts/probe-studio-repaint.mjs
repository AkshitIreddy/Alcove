/**
 * scripts/probe-studio-repaint.mjs — what the reader SEES while a room preset
 * is applied, frame by frame.
 *
 * The four defects this exists for were all found by looking at frames of the
 * demo recording, so this probe looks at frames too — and, because a headless
 * SwiftShader run cannot be relied on to PRODUCE many, it also reads the
 * world's own state on every animation frame it manages to run.
 *
 * ## What it measures, and which defect each number is for
 *
 *   B  Texture identity for the four case parts and the wall, sampled per
 *      animation frame. A frame in which some parts have moved to the new
 *      bake and others have not is a bookcase that is two rooms at once, and
 *      that is reported as a count, not as an impression. `caseSpreadMs` is
 *      the gap between the first part landing and the last.
 *
 *   C  How many book sprites are sitting on the 1×1 `Texture.WHITE`
 *      placeholder rather than a baked spine, per animation frame. Plus
 *      `bookEdge` from the pictures — mean |Δluma| between horizontally
 *      adjacent pixels across the band the books actually occupy (taken from
 *      `__shelfSpineRect`). A bound spine has an outline, a label plate, gilt
 *      and a title; a placeholder slab has one flat colour.
 *
 *   A  `colours` — quantised distinct colours in the shelf region, judged
 *      against the SETTLED frame rather than against a constant. When a render
 *      goes down mid-frame the canvas keeps the clear it was given and the DOM
 *      wall shows through, so the region collapses to the studio panel's edge
 *      and whatever chrome floats over the shelf — the dock, the zoom pill, the
 *      dashed add-book slot. That is a blank world and it still scores in the
 *      hundreds, which is why the threshold is a RATIO. See `BLANK_RATIO`.
 *
 *   D  `stripMatch` / `worldMatch` — fraction of pixels in the preset strip,
 *      and in the shelf, already identical to the settled final frame. The
 *      first frame at which each reaches 1 is when that half of the screen
 *      finished changing. D is the gap between them: the room lands, the tick
 *      does not.
 *
 * Pictures come from a screenshot burst rather than `Page.startScreencast`:
 * the cast only fires on damage and headless starves rAF for whole seconds, so
 * it delivered six frames in six seconds. A screenshot forces a composite and
 * returns what is on screen, which samples the transition densely enough both
 * to measure and to look at.
 *
 * ## Proving the gate can still fail
 *
 * `--sabotage` breaks the app on purpose, for one transition, in exactly the
 * way the defect broke it: it frees the cornice texture out from under the live
 * sprite the moment the preset is clicked, and lets the case's own re-bake put
 * a fresh one back a few hundred milliseconds later. Every frame in between is
 * a render that throws after the renderer has already cleared the canvas — the
 * blank world, on demand, with the same shape and the same duration the demo
 * recording caught.
 *
 * It exists because a gate nobody has watched fail is a gate nobody has. The
 * blankness test here spent its whole life written as `colours <= 3`, which no
 * frame of a real window can reach, and the verdict line went on saying "no
 * blank world" through every run of the defect it was written for. Reverting
 * the fix is not an option for the next reader either — it is spread across the
 * spine factory, the case textures and the floor views, and none of them are
 * this file — so the self-test lives here instead.
 *
 * A sabotaged run is a FAILING run and exits as one; the flag does not invert
 * anything. What it adds is one line, `GATE ALIVE` or `GATE INERT`, which is
 * the only thing being asserted: that the blank check specifically fired.
 * `GATE INERT` means every "clean" this probe has ever printed meant nothing.
 *
 * Usage: node scripts/probe-studio-repaint.mjs [--url=http://localhost:1420]
 *                                              [--tile=2] [--tag=after]
 *                                              [--sabotage]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const TILE = Number(opt('tile', '2'));
const TAG = opt('tag', 'run');
/** How long to keep recording after the click. */
const RECORD_MS = Number(opt('record', '5000'));
/** Break the world on purpose for one transition — the gate's own self-test. */
const SABOTAGE = args.includes('--sabotage');

/*
 * How empty the shelf has to get before it counts as blank, as a fraction of
 * the settled frame's own colour count.
 *
 * This was `colours <= 3` and it could never fire. The measured region starts
 * where the studio panel ends and runs to the right edge of the window, which
 * means it always contains the dock, the zoom pill, the shelf/book toggle and
 * the dashed add-book slot — all DOM, all still perfectly drawn while the Pixi
 * canvas has nothing on it at all. Two frames kept from a run of the actual
 * defect (`qa/ui/studio-repaint-verifyBEFORE{1,2}-emptiest.png`, and they are
 * unmistakably a blank world to look at) score 140 and 152. Their settled
 * frames score 754 and 1048, so the ratios are 0.19 and 0.15; the same runs'
 * legitimate mid-transition frames sit at 0.4 and above and the settled frames
 * are 1.0 by definition. A third of the settled count separates them with room
 * on both sides.
 *
 * A ratio rather than a number because there is no absolute answer: the count
 * depends on the window size, on how much chrome the panel is covering, and on
 * how busy the room being applied is. What does not depend on any of that is
 * that a shelf which has lost its case, its wall, its books, its floor plates
 * and its plinth has lost most of its colours.
 */
const BLANK_RATIO = 0.3;
/**
 * ...and the floor under the ratio, for the degenerate case.
 *
 * If the settled frame were itself nearly blank the ratio would compare one
 * empty frame against another and pass everything. That is a broken run rather
 * than a clean one, and `settledColours` is checked separately for it below.
 */
const BLANK_FLOOR = 8;

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
// The demo's window, so the numbers are comparable to the frames on disk.
const page = await browser.newPage({
  viewport: { width: 1360, height: 850 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(200);
  }
};

/* ------------------------------ 1. get set ------------------------------- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

// A stocked shelf: the defect is proportional to how many spines have to be
// re-baked, and one Welcome book would not show it at all.
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(
    [
      'Cell Biology',
      'Kanji Practice',
      'Watercolor Basics',
      'The Long Field',
      'Marginalia',
      'Salt Houses',
      'Winter Almanac',
      'Copper & Ash',
      'Nine Rivers',
      'The Glasshouse',
      'Foxglove',
      'Quiet Machines',
    ],
    0,
  ),
);
await page.waitForTimeout(2500);

await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1600);

const strip = page.locator('[aria-label="Room presets"]');
await strip.waitFor({ timeout: 20000 });
const tile = strip.locator('button.nb-strip-tile:not(.nb-strip-more)').nth(TILE);
await tile.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);

const tileName = (await tile.textContent())?.trim().split('\n')[0];
const stripBox = await strip.boundingBox();

/* The band the books actually occupy, straight from the world's own bridge. */
const bands = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks();
  const rects = books
    .map((b) => globalThis.__shelfSpineRect(b.id))
    .filter((r) => r !== null && r.width > 4 && r.height > 8);
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { count: rects.length, left, right, top, bottom };
});
if (bands === null) throw new Error('no visible book rects — nothing to measure');

// Everything right of the studio panel is the world. The panel is anchored at
// left:68 and is at most 340 wide, so 440 clears it with room to spare.
const PANEL_EDGE = 440;
const worldRect = {
  x: Math.max(PANEL_EDGE, Math.round(bands.left - 120)),
  y: Math.max(0, Math.round(bands.top - 120)),
  w: 0,
  h: 0,
};
worldRect.w = Math.min(1360, Math.round(bands.right + 120)) - worldRect.x;
worldRect.h = Math.min(850, Math.round(bands.bottom + 90)) - worldRect.y;

const bookRect = {
  x: Math.max(PANEL_EDGE, Math.round(bands.left)),
  y: Math.round(bands.top + (bands.bottom - bands.top) * 0.45),
  w: 0,
  h: Math.max(8, Math.round((bands.bottom - bands.top) * 0.3)),
};
bookRect.w = Math.round(bands.right) - bookRect.x;

const panelRect = stripBox
  ? {
      x: Math.round(stripBox.x),
      y: Math.round(stripBox.y),
      w: Math.round(stripBox.width),
      h: Math.round(stripBox.height),
    }
  : null;

console.log(`\nprobe-studio-repaint  [${TAG}]`);
console.log(`  clicking preset tile ${TILE}: ${JSON.stringify(tileName)}`);
console.log(`  ${bands.count} visible spines`);
console.log(`  world region   ${JSON.stringify(worldRect)}`);
console.log(`  book band      ${JSON.stringify(bookRect)}`);
console.log(`  preset strip   ${JSON.stringify(panelRect)}`);

/* ------------------------- 2. record the change --------------------------- */

/*
 * Two recorders, because the two questions are different.
 *
 * The STATE recorder runs inside the page on every animation frame and reads
 * what the world is actually holding: which Texture object each of the four
 * case parts and the wall are on, how many book sprites are sitting on the
 * 1×1 placeholder instead of a baked spine, and which studio tile is marked.
 * That is total coverage — every frame the app manages to run — and it is what
 * makes "the case repainted in two halves" a number rather than an impression.
 *
 * The PICTURE recorder is a screenshot burst. `Page.startScreencast` was the
 * obvious tool and is useless here: headless SwiftShader starves rAF for whole
 * seconds at a time, and the cast delivered six frames in six seconds. A
 * screenshot forces a composite and hands back the frame that is on screen, so
 * a burst of them samples the transition densely enough to LOOK at, and to
 * measure blankness and spine decoration on.
 */
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const strip = document.querySelector('[aria-label="Room presets"]');
  const log = [];
  globalThis.__repaintLog = log;
  const t0 = performance.now();
  globalThis.__repaintT0 = t0;

  // Stable small integers for Texture object identity, so the log says "the
  // plank moved to a new bake and the crown did not" instead of dumping GPU
  // objects across the bridge.
  const ids = new WeakMap();
  let nextId = 0;
  const idOf = (o) => {
    if (o === null || o === undefined) return 0;
    let v = ids.get(o);
    if (v === undefined) {
      v = ++nextId;
      ids.set(o, v);
    }
    return v;
  };

  const marked = () => {
    const tiles = [...(strip?.querySelectorAll('button.nb-strip-tile') ?? [])];
    return tiles.findIndex((t) => t.classList.contains('is-active'));
  };

  const sample = () => {
    const env = w.envTex;
    let placeholder = 0;
    let books = 0;
    for (const fv of w.floors.values()) {
      for (const v of fv.visuals) {
        books++;
        // The placeholder is `Texture.WHITE` — a 1×1 quad wearing a tint. Any
        // real spine is at least a few dozen texels wide.
        const tex = v.sprite.texture;
        if (tex === undefined || tex === null || tex.width <= 1 || tex.destroyed) placeholder++;
      }
    }
    return {
      at: Math.round(performance.now() - t0),
      plank: idOf(env.plank),
      back: idOf(env.back),
      rail: idOf(env.rail),
      crown: idOf(env.crown),
      wall: idOf(w.backdrop?.texture),
      books,
      placeholder,
      // Atlas pages are 2048² canvases and each `update()` re-uploads one.
      // Keeping the outgoing room's rects alive means the incoming room's
      // bakes pack in beside them, so this is the number that says whether
      // retirement cost a page — the one place it could get expensive.
      loPages: w.factory.loAtlas.pageCount,
      hiPages: w.factory.hiAtlas.pageCount,
      tile: marked(),
      shelf: globalThis.__shelfDesign().shelf,
      paper: globalThis.__shelfDesign().design.wallpaper.pattern,
    };
  };

  const beat = () => {
    log.push(sample());
    requestAnimationFrame(beat);
  };
  requestAnimationFrame(beat);
});

/*
 * Pictures come off the COMPOSITOR, not from `page.screenshot`.
 *
 * A screenshot is served by the renderer's main thread, which is precisely the
 * thread this transition blocks: a burst of them returned ONE picture in five
 * seconds, taken after everything had settled. `Page.screencastFrame` fires
 * from the compositor whenever a frame is presented, so it captures exactly
 * what the reader's eye had available — including the frames the main thread
 * was too busy to replace.
 */
const cdp = await page.context().newCDPSession(page);
const shots = [];
cdp.on('Page.screencastFrame', async (f) => {
  shots.push({ data: f.data, ts: f.metadata.timestamp });
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId });
  } catch {
    // the cast has already been stopped — nothing left to ack to
  }
});
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

/*
 * The self-test, armed before the click so it lands inside the transition.
 *
 * The cornice is the target because it is one sprite on one texture, and the
 * damage it does is the damage the defect did: `Sprite.destroy` is deliberately
 * NOT used, because the failure mode is a LIVE sprite left holding a dead
 * texture. Pixi nulls a destroyed texture's source out from under the renderer,
 * the render throws after the canvas has already been cleared for the frame,
 * and the reader gets the DOM wall where their library was.
 *
 * ## It repairs itself, and that is not politeness
 *
 * The gate's threshold is a fraction of the SETTLED frame, so a run that never
 * settles has a blank denominator and every ratio comes out at 1.0 — the run
 * reports itself clean while showing nothing but an empty window. That is
 * exactly what the first cut of this did: it left the repair to the app, on the
 * theory that the case re-bakes the cornice anyway, and the recording ended
 * with all six presented frames blank and the self-test announcing GATE INERT
 * on a gate that was working perfectly.
 *
 * So the damage is undone on a timer of its own. Nothing about the renderer
 * needs coaxing back — pointing the sprite at any live texture and rendering
 * again restores the whole world on the next frame, which is measured, not
 * assumed — so the repair is one assignment and a dirty flag.
 */
if (SABOTAGE) {
  console.log('\n  !! --sabotage: freeing the cornice texture under its live sprite');
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    // Armed before the click and fired by the apply itself, on a timer rather
    // than on an animation frame: rAF is what the transition starves, and the
    // whole point is to land in the same gaps between bakes that the real blank
    // frames landed in.
    const before = globalThis.__shelfDesign().shelf;
    globalThis.__sabotaged = 0;
    globalThis.__repaired = 0;
    const t = setInterval(() => {
      if (globalThis.__shelfDesign().shelf === before) return;
      clearInterval(t);
      const tex = w.crown.texture;
      if (tex && !tex.destroyed) tex.destroy(true);
      globalThis.__sabotaged = Math.round(performance.now() - globalThis.__repaintT0);
      w.dirty = true;
      // Long enough that the compositor has presented the wreckage several
      // times over, short enough that the recording still has a settled tail.
      setTimeout(() => {
        const live = [w.envTex.crown, w.envTex.plank, w.backdrop.texture].find(
          (x) => x !== null && x !== undefined && !x.destroyed,
        );
        if (live === undefined) return;
        w.crown.texture = live;
        w.plinth.texture = live;
        globalThis.__repaired = Math.round(performance.now() - globalThis.__repaintT0);
        w.dirty = true;
      }, 900);
    }, 16);
  });
}

await page.waitForTimeout(900);
const clickAt = await page.evaluate(() => performance.now() - globalThis.__repaintT0);
const clickEpoch = Date.now() / 1000;
await tile.click();
await page.waitForTimeout(RECORD_MS);
await cdp.send('Page.stopScreencast');

const frames = shots.map((s) => ({ ms: Math.round((s.ts - clickEpoch) * 1000), data: s.data }));
if (frames.length === 0) throw new Error('the compositor presented no frames at all');

const stateLog = await page.evaluate(() => globalThis.__repaintLog);
const state = stateLog.map((s) => ({ ...s, ms: Math.round(s.at - clickAt) }));

/* ---- what the state log says, before a single pixel is looked at --------- */

const firstChange = (key) => {
  const base = state.find((s) => s.ms <= 0)?.[key] ?? state[0][key];
  const hit = state.find((s) => s.ms > 0 && s[key] !== base);
  return hit ? hit.ms : null;
};
const partLanding = {
  plank: firstChange('plank'),
  back: firstChange('back'),
  rail: firstChange('rail'),
  crown: firstChange('crown'),
  wall: firstChange('wall'),
};
const landed = Object.values(partLanding).filter((v) => v !== null);
// The CASE's own four parts, kept apart from the wall: the case is baked and
// published by `EnvTextures`, the wall by `world.applyWallpaper`, and they are
// two different fixes. Reporting one number for both hides which one moved.
const caseLanded = ['plank', 'back', 'rail', 'crown']
  .map((k) => partLanding[k])
  .filter((v) => v !== null);
const caseSpreadMs =
  caseLanded.length > 1 ? Math.max(...caseLanded) - Math.min(...caseLanded) : 0;
const wallLagMs =
  partLanding.wall !== null && caseLanded.length
    ? partLanding.wall - Math.max(...caseLanded)
    : null;

// A frame is "two rooms at once" when the case parts are not all on the same
// generation — i.e. some have moved to their new bake and some have not.
const baseline = state.find((s) => s.ms <= 0) ?? state[0];
const finalState = state[state.length - 1];
const mixedFrames = state.filter((s) => {
  if (s.ms <= 0) return false;
  const moved = ['plank', 'back', 'rail', 'crown'].map((k) => s[k] !== baseline[k]);
  return moved.some(Boolean) && !moved.every(Boolean);
});
const slabFrames = state.filter((s) => s.ms > 0 && s.placeholder > 0);
const rafGaps = [];
for (let i = 1; i < state.length; i++) rafGaps.push(state[i].ms - state[i - 1].ms);
const worstGap = rafGaps.length ? Math.max(...rafGaps) : 0;

const tileFlipMs = (() => {
  const base = baseline.tile;
  const hit = state.find((s) => s.ms > 0 && s.tile !== base);
  return hit ? hit.ms : null;
})();
const designMs = (() => {
  const hit = state.find((s) => s.ms > 0 && s.shelf !== baseline.shelf);
  return hit ? hit.ms : null;
})();

/*
 * What the main thread was doing when it stopped answering.
 *
 * `art/bake.ts` keeps a ring buffer of every timed unit of bake work and hands
 * it out on `globalThis.__bakeProfile` under any `?fx=` flag. A frame gap is
 * only half a finding — this says which bake filled it, which is the
 * difference between "the transition is expensive" and "I made it expensive".
 */
const bakeLog = await page.evaluate(() => {
  const t0 = globalThis.__repaintT0;
  return (globalThis.__bakeProfile ?? []).map((s) => ({
    what: s.what,
    ms: Math.round(s.ms * 10) / 10,
    at: Math.round(s.at - t0),
  }));
});
const bakeAfter = bakeLog
  .map((s) => ({ ...s, at: Math.round(s.at - clickAt) }))
  .filter((s) => s.at > -200);

console.log(`\n  ${state.length} animation frames, worst gap ${worstGap}ms`);
console.log(`  ${frames.length} presented frames over ${RECORD_MS}ms`);
console.log('\n  --- state, per animation frame ---');
console.log('     ms   plank back rail crown wall   slabs/books  tile  shelf');
for (const s of state) {
  const mark =
    s.ms > 0 && mixedFrames.includes(s) ? '  <- TWO ROOMS' : s.placeholder > 0 ? '  <- SLABS' : '';
  console.log(
    `  ${String(s.ms).padStart(6)}   ${String(s.plank).padStart(3)}  ${String(s.back).padStart(3)} ` +
      ` ${String(s.rail).padStart(3)}  ${String(s.crown).padStart(3)}  ${String(s.wall).padStart(3)}` +
      `   ${String(s.placeholder).padStart(3)}/${String(s.books).padEnd(3)}` +
      `      ${String(s.tile).padStart(2)}  ${s.shelf}${mark}`,
  );
}
console.log('\n  part landings (ms after click):', JSON.stringify(partLanding));
console.log(`  case spread (first part → last part): ${caseSpreadMs}ms`);
console.log(`  wall behind the case: ${wallLagMs}ms`);
console.log(`  frames showing two rooms at once: ${mixedFrames.length}`);
console.log(`  frames with placeholder slabs:    ${slabFrames.length}`);
console.log(
  `  atlas pages lo ${baseline.loPages} -> ${finalState.loPages},` +
    ` hi ${baseline.hiPages} -> ${finalState.hiPages}`,
);

console.log('\n  --- bake work after the click (art/bake.ts ring buffer) ---');
const bakeTotal = bakeAfter.reduce((a, s) => a + s.ms, 0);
for (const s of bakeAfter) {
  console.log(`  +${String(s.at).padStart(5)}ms  ${String(s.ms).padStart(7)}ms  ${s.what}`);
}
console.log(`  ${bakeAfter.length} units, ${Math.round(bakeTotal)}ms of bake work in total`);

/* --------------------------- 3. measure the frames ------------------------ */

/*
 * Decoding happens in a second Chromium page (`about:blank` + createImageBitmap),
 * the same trick `shots-now/visual-suite.mjs` uses to avoid adding an image
 * dependency the repo does not have.
 */
const analyser = await browser.newPage();
await analyser.goto('about:blank');
await analyser.evaluate(() => {
  globalThis.__decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx;
  };
  globalThis.__box = (ctx, r) => ({
    x: Math.round((r.x * ctx.canvas.width) / 1360),
    y: Math.round((r.y * ctx.canvas.height) / 850),
    w: Math.max(1, Math.round((r.w * ctx.canvas.width) / 1360)),
    h: Math.max(1, Math.round((r.h * ctx.canvas.height) / 850)),
  });
  globalThis.__measure = async (b64, world, book, panel, refs) => {
    const ctx = await globalThis.__decode(b64);
    const box = (r) => globalThis.__box(ctx, r);

    // A: does the shelf canvas have ANY content? A stage that rendered nothing
    // leaves the transparent canvas showing the DOM's cream, so the whole
    // region collapses to one or two quantised colours.
    const wb = box(world);
    const wd = ctx.getImageData(wb.x, wb.y, wb.w, wb.h).data;
    const seen = new Set();
    for (let i = 0; i < wd.length; i += 8) {
      seen.add(((wd[i] >> 3) << 10) | ((wd[i + 1] >> 3) << 5) | (wd[i + 2] >> 3));
    }

    // B/C: how much decoration the book band carries. Mean |Δluma| between
    // horizontally adjacent pixels — an outlined, plated, gilt, titled spine
    // against a flat tinted slab.
    const bb = box(book);
    const bd = ctx.getImageData(bb.x, bb.y, bb.w, bb.h).data;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < bb.h; y++) {
      const row = y * bb.w * 4;
      for (let x = 0; x < bb.w - 1; x++) {
        const a = row + x * 4;
        const l0 = 0.299 * bd[a] + 0.587 * bd[a + 1] + 0.114 * bd[a + 2];
        const l1 = 0.299 * bd[a + 4] + 0.587 * bd[a + 5] + 0.114 * bd[a + 6];
        sum += Math.abs(l1 - l0);
        n++;
      }
    }

    const ratio = (rect, ref) => {
      if (!ref) return null;
      const r = box(rect);
      const d = ctx.getImageData(r.x, r.y, r.w, r.h).data;
      if (d.length !== ref.length) return null;
      let same = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (
          Math.abs(d[i] - ref[i]) <= 8 &&
          Math.abs(d[i + 1] - ref[i + 1]) <= 8 &&
          Math.abs(d[i + 2] - ref[i + 2]) <= 8
        ) {
          same++;
        }
      }
      return same / (d.length / 4);
    };

    return {
      colours: seen.size,
      edge: n === 0 ? 0 : sum / n,
      worldMatch: ratio(world, refs?.world ?? null),
      stripMatch: panel ? ratio(panel, refs?.strip ?? null) : null,
    };
  };
  globalThis.__grab = async (b64, rect) => {
    const ctx = await globalThis.__decode(b64);
    const r = globalThis.__box(ctx, rect);
    return [...ctx.getImageData(r.x, r.y, r.w, r.h).data];
  };
});

const last = frames[frames.length - 1];
const refs = {
  world: await analyser.evaluate(([b, r]) => globalThis.__grab(b, r), [last.data, worldRect]),
  strip: panelRect
    ? await analyser.evaluate(([b, r]) => globalThis.__grab(b, r), [last.data, panelRect])
    : null,
};

const rows = [];
for (let i = 0; i < frames.length; i++) {
  const f = frames[i];
  const m = await analyser.evaluate(
    ([b, w, bk, p, rf]) => globalThis.__measure(b, w, bk, p, rf),
    [f.data, worldRect, bookRect, panelRect, refs],
  );
  rows.push({ i, ms: f.ms, ...m });
}

/* ------------------------------ 4. the report ----------------------------- */

const baseEdge = Math.max(...rows.map((r) => r.edge));
const baseColours = Math.max(...rows.map((r) => r.colours));

/*
 * The settled frame is the denominator, not the busiest one.
 *
 * `refs.world` is taken from the LAST presented frame and `worldMatch` is
 * measured against it, so by construction the last row is the room the reader
 * ends up with — the one frame in the run that is definitely whole. Using
 * `max(colours)` instead would let an unusually busy mid-transition frame raise
 * the bar and quietly re-inflate the threshold.
 */
const settledColours = rows[rows.length - 1].colours;
const blankBelow = Math.max(BLANK_FLOOR, Math.round(settledColours * BLANK_RATIO));

console.log('\n  --- pixels, per screenshot ---');
console.log(
  `  blank below ${blankBelow} colours` +
    ` (${BLANK_RATIO} x the settled frame's ${settledColours})`,
);
console.log('  frame     ms   colours   bookEdge   worldMatch  stripMatch');
for (const r of rows) {
  const flag =
    r.colours < blankBelow ? '  <- BLANK' : r.edge < baseEdge * 0.6 ? '  <- FLAT BOOK BAND' : '';
  console.log(
    `  ${String(r.i).padStart(5)} ${String(r.ms).padStart(6)}` +
      `   ${String(r.colours).padStart(6)}` +
      `   ${r.edge.toFixed(2).padStart(8)}` +
      `   ${(r.worldMatch ?? 0).toFixed(4).padStart(9)}` +
      `   ${r.stripMatch === null ? '     -' : r.stripMatch.toFixed(4).padStart(9)}` +
      flag,
  );
}

const blank = rows.filter((r) => r.colours < blankBelow);
const flat = rows.filter((r) => r.colours >= blankBelow && r.edge < baseEdge * 0.6);
const span = (list) =>
  list.length === 0 ? null : { frames: list.length, from: list[0].ms, to: list[list.length - 1].ms };

const settled = (key) => {
  for (let i = rows.length - 1; i >= 0; i--) {
    if ((rows[i][key] ?? 0) < 0.999) return rows[i + 1]?.ms ?? null;
  }
  return rows[0]?.ms ?? null;
};
const worldLanded = settled('worldMatch');
const stripLanded = panelRect ? settled('stripMatch') : null;

const summary = {
  tag: TAG,
  preset: tileName,
  animationFrames: state.length,
  worstRafGapMs: worstGap,
  presentedFrames: frames.length,
  /* B — the case painting as two rooms */
  partLandingMs: partLanding,
  caseSpreadMs,
  wallLagMs,
  twoRoomFrames: mixedFrames.length,
  atlasPages: {
    lo: `${baseline.loPages} -> ${finalState.loPages}`,
    hi: `${baseline.hiPages} -> ${finalState.hiPages}`,
  },
  /* C — the books losing their art */
  slabFrames: slabFrames.length,
  maxSlabs: Math.max(0, ...state.map((s) => s.placeholder)),
  books: finalState.books,
  minEdge: Number(Math.min(...rows.map((r) => r.edge)).toFixed(2)),
  baselineEdge: Number(baseEdge.toFixed(2)),
  /* A — the world blanking */
  sabotaged: SABOTAGE,
  blankWindow: span(blank),
  flatBandWindow: span(flat),
  minColours: Math.min(...rows.map((r) => r.colours)),
  baselineColours: baseColours,
  settledColours,
  blankBelow,
  /*
   * How many presented frames were NOT already the settled room.
   *
   * Zero looks like a run that sampled nothing and is in fact the strongest
   * result the picture half can give. A WebGL canvas is only re-presented when
   * it is redrawn: if the world had gone blank the canvas WOULD have been
   * redrawn — blank — and the compositor would have handed that frame over.
   * Nought transition frames therefore means the canvas was never touched
   * between the click and the new room landing, which is precisely the old room
   * being held whole. It is reported rather than hidden because the sentence
   * above is the only thing that makes a five-frame run mean anything.
   */
  transitionFrames: rows.filter((r) => (r.worldMatch ?? 1) < 0.999).length,
  /*
   * The emptiest frame as a fraction of the settled one — the number the gate
   * actually reads, kept in the file so two runs can be compared without
   * re-deriving it. A clean run is 1.0 or very near it; the recorded defect
   * sits at 0.15–0.19.
   */
  emptiestRatio: Number((Math.min(...rows.map((r) => r.colours)) / settledColours).toFixed(3)),
  /*
   * D — does the marked tile agree with the room the reader is looking at?
   *
   * `tickLagMs` is the tile's mark measured against the case actually
   * repainting. Positive means the reader sees the room change before the tick
   * moves, which is the reported bug; negative means the tick moves first,
   * which is what the panel has always in fact done.
   *
   * `stripRedrawnMs` is NOT this. Every preset card is a little painting of
   * its own room, so the whole strip re-draws when the scheme moves and the
   * pixel ratio climbs for as long as that takes — which says nothing about
   * when the tick landed. It is reported because a slow strip re-draw is worth
   * knowing about, not because it measures D.
   */
  designReachedWorldMs: designMs,
  tileMarkedMs: tileFlipMs,
  casePaintedMs: landed.length ? Math.max(...landed) : null,
  tickLagMs:
    tileFlipMs !== null && landed.length ? tileFlipMs - Math.max(...landed) : null,
  worldRepaintedMs: worldLanded,
  stripRedrawnMs: stripLanded,
};

console.log('\n=== summary ===');
console.log(JSON.stringify(summary, null, 2));
writeFileSync(
  `qa/ui/studio-repaint-${TAG}.json`,
  JSON.stringify({ summary, state, rows }, null, 2),
);
console.log(`\n  wrote qa/ui/studio-repaint-${TAG}.json`);

// Keep frames to LOOK at: the emptiest, the flattest, and the settled one.
const worstBlank = rows.reduce((a, b) => (a.colours <= b.colours ? a : b), rows[0]);
const worstFlat = rows.reduce((a, b) => (a.edge <= b.edge ? a : b), rows[0]);
for (const [name, row] of [
  ['emptiest', worstBlank],
  ['flattest', worstFlat],
  ['settled', { i: frames.length - 1 }],
]) {
  writeFileSync(
    `qa/ui/studio-repaint-${TAG}-${name}.png`,
    Buffer.from(frames[row.i].data, 'base64'),
  );
  console.log(`  shot qa/ui/studio-repaint-${TAG}-${name}.png  (frame ${row.i})`);
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

if (summary.transitionFrames === 0) {
  console.log(
    '\n  note: the compositor presented no frame before the room had settled.' +
      '\n  That is not an unsampled run — a canvas is only re-presented when it is' +
      '\n  redrawn, so a blank one would have been handed over. The old room was held.',
  );
}

/*
 * The verdict, so this is a gate and not just a report.
 *
 * There is no unit test for any of this: the property lives in Pixi Texture
 * identity and in what the compositor presented, and the suite runs in `node`
 * with no DOM. CLAUDE.md's seam-QA rule says as much — a specimen board proves
 * a module draws well in isolation and says nothing about whether the app can
 * reach that state — so the assertion belongs here, on the running app.
 */
const failures = [];
if (summary.twoRoomFrames > 0) {
  failures.push(`the case was two rooms at once for ${summary.twoRoomFrames} frame(s)`);
}
if (summary.caseSpreadMs > 0) {
  failures.push(`the four case parts landed ${summary.caseSpreadMs}ms apart`);
}
if (summary.maxSlabs > 0) {
  failures.push(`${summary.maxSlabs} of ${summary.books} books fell back to placeholder slabs`);
}
/*
 * A run whose own settled frame has almost no colour in it measured the wrong
 * rectangle, or never settled. Say so instead of dividing by it: every ratio
 * below would come out at 1.0 and the run would report itself clean.
 */
if (settledColours < 60) {
  failures.push(
    `the settled frame itself has only ${settledColours} colours —` +
      ` the world rect ${JSON.stringify(worldRect)} is not measuring the shelf`,
  );
}
if (summary.blankWindow !== null) {
  failures.push(
    `the world was blank for ${summary.blankWindow.frames} presented frame(s)` +
      ` (emptiest ${summary.minColours} colours, ${summary.emptiestRatio} of the settled frame)`,
  );
}
if (errors.size > 0) {
  // The messages, not just the count: a render that goes down under a freed
  // texture says `Cannot read properties of null (reading 'addressModeU')`, and
  // a reader who sees that line knows the cause without another run.
  failures.push(`${errors.size} distinct page error(s): ${[...errors.keys()].join(' / ')}`);
}

/*
 * The self-test does NOT get its own exit code.
 *
 * A sabotaged run is a failing run and reports itself as one — that is the
 * whole demonstration, and inverting the exit code to mean "the gate worked"
 * would make the one command anybody runs mean two different things depending
 * on a flag. What the flag adds is a line saying whether the BLANK check
 * specifically fired, because a sabotaged run also trips the page-error check
 * and a non-zero exit on its own would not tell you which.
 */
if (SABOTAGE) {
  const caught = summary.blankWindow !== null;
  const when = await page.evaluate(() => ({
    broke: globalThis.__sabotaged ?? 0,
    fixed: globalThis.__repaired ?? 0,
  }));
  console.log(
    `\n=== self-test (--sabotage: cornice freed at ${when.broke}ms,` +
      ` sprite re-pointed at ${when.fixed}ms, clock shared with the state log) ===`,
  );
  console.log(
    caught
      ? '  GATE ALIVE  the blank check fired on a world that was blanked on purpose'
      : '  GATE INERT  the world was blanked on purpose and the blank check said nothing',
  );
  if (!caught) failures.push('the blank check did not fire on a deliberately blanked world');
}

console.log('\n=== verdict ===');
if (failures.length === 0) console.log('  clean: no mixed room, no slabs, no blank world');
else for (const f of failures) console.log(`  FAIL  ${f}`);

await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
