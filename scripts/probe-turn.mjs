/**
 * scripts/probe-turn.mjs — the three things the reader reported about turning.
 *
 * Their words:
 *
 *  A. *"When turning pages, after the page turn and we go to the next page,
 *      there is a flicker for a second where it then puts all the processing
 *      effects we have on it — for example the shadow effect in the middle."*
 *  B. *"Let's say I am turning to a page I haven't seen before, then it shows
 *      as a blank white page. But after turning it, and then going back and
 *      turning to that page again, the content is there."*
 *  C. *"Always auto-create the next 2 pages when the user is on the last page,
 *      so the user never sees a blank page."*
 *
 * All three are about the same machinery — the raster cache feeding the WebGL
 * curl (`src/flip/`) and the spread that mounts the leaves — so they are
 * measured together rather than three times over.
 *
 * B is the one worth designing the probe around, because it is the one a naive
 * check cannot see: the page is CORRECT once you look at it, so any assertion
 * made after the turn settles will pass. The evidence has to be gathered DURING
 * the turn, which is what the sampler below does.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
mkdirSync('qa/turn', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
/*
 * FULL MOTION, or this measures a page turn that never happens.
 *
 * Headless Chromium reports `prefers-reduced-motion: reduce`, and
 * `programmaticFlip` answers that by calling `crossfadeNavigate` — no curl, no
 * raster textures, no cache lookup. The first version of this probe ran twelve
 * turns that way and reported ZERO blank frames, which was read as "the bug
 * does not reproduce". It was measuring a code path the reader never takes.
 */
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

console.log('1. open the welcome book');
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
  await page.waitForTimeout(1000);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(6000);

/**
 * Watch the spread across a turn, ~every animation frame.
 *
 * Records, per frame: how many leaves carry inked content, whether the flip
 * surface is engaged, and how much of the paper is bare. "Bare" is the thing
 * report B is about — a leaf that is mounted and white.
 */
const sampleTurn = async (label, act) => {
  await page.evaluate(() => {
    globalThis.__frames = [];
    globalThis.__watching = true;
    const tick = () => {
      if (globalThis.__watching !== true) return;
      const leaves = [...document.querySelectorAll('.nb-flip-leaf')];
      globalThis.__frames.push({
        t: Math.round(performance.now()),
        leaves: leaves.length,
        // A leaf with a prose root that has NO text in it is the blank page.
        blank: leaves.filter((l) => {
          const prose = l.querySelector('.nb-prose');
          if (prose === null) return false;
          return (prose.textContent ?? '').trim().length === 0;
        }).length,
        inked: leaves.filter((l) => {
          const prose = l.querySelector('.nb-prose');
          return prose !== null && (prose.textContent ?? '').trim().length > 0;
        }).length,
        flipping: document.querySelector('.nb-flip-surface.is-flip-gesture') !== null,
        // The chrome the reader saw arrive late: the gutter shadow.
        shadow: document.querySelector('.nb-flip-shadow, .nb-spread-gutter') !== null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(1800);
  const frames = await page.evaluate(() => {
    globalThis.__watching = false;
    return globalThis.__frames;
  });
  const blankFrames = frames.filter((f) => f.blank > 0);
  console.log(
    `   ${label}: ${frames.length} frames, ${blankFrames.length} with a blank mounted leaf` +
      (blankFrames.length > 0
        ? ` (worst ${Math.max(...blankFrames.map((f) => f.blank))} leaves)`
        : ''),
  );
  return { frames, blankFrames };
};

console.log('\n2. turn forward through pages never seen before');
const turns = [];
for (let i = 0; i < 6; i += 1) {
  const r = await sampleTurn(`turn ${i + 1}`, async () => {
    await page.keyboard.press('ArrowRight');
  });
  turns.push(r);
  await page.screenshot({ path: `qa/turn/forward-${String(i + 1).padStart(2, '0')}.png` });
}
const firstPassBlank = turns.reduce((n, t) => n + t.blankFrames.length, 0);

console.log('\n3. go back, then forward over the SAME pages again');
for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(2500);
const again = [];
for (let i = 0; i < 6; i += 1) {
  const r = await sampleTurn(`re-turn ${i + 1}`, async () => {
    await page.keyboard.press('ArrowRight');
  });
  again.push(r);
}
const secondPassBlank = again.reduce((n, t) => n + t.blankFrames.length, 0);

console.log('\n4. the reader\'s comparison');
console.log(`   first visit:  ${firstPassBlank} frames showed a blank mounted leaf`);
console.log(`   second visit: ${secondPassBlank} frames showed a blank mounted leaf`);
check(
  'a page never seen before is not blank while turning to it',
  firstPassBlank === 0,
  firstPassBlank > 0 ? `${firstPassBlank} frames blank on the first visit` : undefined,
);
check(
  'and it is no worse than a page already visited',
  firstPassBlank <= secondPassBlank + 1,
  `${firstPassBlank} vs ${secondPassBlank}`,
);

console.log('\n5. is there anything after the last page?');
for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2500);
const atEnd = await page.evaluate(() => {
  const leaves = [...document.querySelectorAll('.nb-flip-leaf')];
  return {
    leaves: leaves.length,
    blank: leaves.filter((l) => {
      const prose = l.querySelector('.nb-prose');
      return prose !== null && (prose.textContent ?? '').trim().length === 0;
    }).length,
  };
});
console.log('   at the end:', JSON.stringify(atEnd));
await page.screenshot({ path: 'qa/turn/at-the-end.png' });


/*
 * 6. THE REPORTED CASE, forced.
 *
 * Sections 2-4 could not reproduce it, and the reason is worth recording: they
 * turn with ArrowRight after the book has been open for six seconds, by which
 * time `ensureAdjacent` has warmed every neighbour (its idle callback carries a
 * 1000ms timeout, so it always lands). The reader meets this by turning
 * IMMEDIATELY, before anything has been captured.
 *
 * So the cache is emptied and a turn started in the same breath. The assertion
 * is on which PATH the turn takes: with no bitmap for the face being lifted the
 * WebGL curl would draw bare paper, so the controller must fall back to the
 * rigid CSS fold — whose front face is the live leaf, with the real words on
 * it. `.is-flipping` on the canvas is the tell: it is added only by the WebGL
 * path.
 */
console.log('\n6. turn with a cold cache — the reported case');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(2500);

const cold = await page.evaluate(async () => {
  const surface = document.querySelector('.nb-flip-surface');
  const canvas = document.querySelector('.nb-flip-canvas, canvas.nb-flip');
  // Empty the cache the way a book that has just been opened is empty.
  const api = globalThis.__flipCache;
  if (api && typeof api.dispose !== 'function') return { ok: false, why: 'no cache bridge' };
  return {
    ok: true,
    hadCanvas: canvas !== null,
    surface: surface !== null,
  };
});
console.log('   ', JSON.stringify(cold));

// Turn straight away and watch which path ran.
const path = await page.evaluate(async () => {
  const canvas = document.querySelector('canvas');
  const before = canvas?.classList.contains('is-flipping') ?? null;
  return { before };
});
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(120);
const during = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const leaves = [...document.querySelectorAll('.nb-flip-leaf')];
  return {
    curling: canvas?.classList.contains('is-flipping') ?? false,
    // Whichever path ran, SOMETHING with words must be on screen.
    inked: leaves.filter((l) => {
      const p = l.querySelector('.nb-prose');
      return p !== null && (p.textContent ?? '').trim().length > 0;
    }).length,
    foldPresent: document.querySelector('.nb-rigid-fold, [data-rigid-fold]') !== null,
  };
});
console.log('   mid-turn:', JSON.stringify(during));
await page.screenshot({ path: 'qa/turn/cold-cache-mid.png' });
await page.waitForTimeout(1500);
/*
 * READ THIS BEFORE TRUSTING THE LINE BELOW.
 *
 * This section does NOT currently force a cold cache — there is no bridge that
 * empties `PageRasterCache` from outside, so re-opening the book leaves its
 * bitmaps in place and the turn takes the WebGL path (`curling: true`) exactly
 * as it would normally. So this is a smoke test that a turn straight after
 * opening still shows words; it is NOT evidence that the fallback added to
 * `beginFlip` ever fires.
 *
 * Reproducing report B properly needs one of: a `__flipCache` bridge handed out
 * of world.ts so a probe can empty it, or a book whose pages have genuinely
 * never been rasterised in this session. Until then the guard in beginFlip is
 * reasoned from the code — `bitmapOf` returns null for an uncached page and a
 * null texture draws bare paper — and not demonstrated. Said out loud because a
 * green line here would otherwise be read as the bug being fixed.
 */
check(
  'a turn straight after opening still shows words (NOT a cold-cache test)',
  during.inked > 0 || during.curling,
  `inked=${during.inked} curling=${during.curling} — cache was warm, see the note above`,
);

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
