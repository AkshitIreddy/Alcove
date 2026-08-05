/**
 * scripts/probe-return-to-shelf.mjs — is there a blank second on the way back?
 *
 * The reader's words: *"when 'back to shelf' is clicked, for a second it shows
 * just a blank screen."* It is in the demo recording — `qa/demo/frames/f1352.png`
 * is the dock and the zoom pill floating on bare cream with nothing behind them.
 * The cause was that the shelf was the FALLBACK of a `<Show>` in App.tsx and so
 * was unmounted for as long as a book was open: coming back did not return to a
 * room, it built one, from a new PixiJS application up through a fresh bake of
 * the case, the wall and every spine.
 *
 * ## What it measures, and why it takes two readings of the same thing
 *
 * A frame counts as BLANK when the reader is looking at the shelf and there is
 * nothing on the canvas for them to look at. That is a compound question, so it
 * is asked twice, in two different currencies:
 *
 *  - **Every animation frame**, from inside the page, off the world itself:
 *    is a world there at all, has it mounted any floors, has it ever PAINTED
 *    (`rendersRun`), and is the canvas visible rather than stood down behind a
 *    book. The case cannot be on screen unless all four are true, and this is
 *    the only sampler that runs at frame rate. `__shelfWorld` is handed out by
 *    world.ts under `?fx=force` — never by the probe importing modules of its
 *    own, which on a dev server that has served HMR updates can resolve to a
 *    second copy that the shelf has never heard of.
 *
 *  - **Optically**, from outside, off a CDP SCREENCAST: every composited frame
 *    Chromium presents, scored over a box in the middle of the case by how
 *    much of it is one flat colour. Bare cream is ~100% one colour; a bookcase
 *    is not. This is the only reading taken of what a reader would actually
 *    SEE, and it is what stops the first one from being a claim about
 *    bookkeeping.
 *
 * The screencast, and not `page.screenshot()` in a loop, because the loop was
 * tried first and could not see the thing: one shot cost 480ms on an idle
 * machine and 1.27s while the old build was rebuilding its world, so a defect
 * that lasts a second was sampled twice, both times too late, and the second
 * sample was reported at the timestamp of the first. A screencast frame is
 * pushed when the compositor presents one, which is exactly the event in
 * question.
 *
 * Reading the canvas back directly instead is not on the menu: the world runs
 * with `preserveDrawingBuffer` off (the default, and the right default), so
 * `readPixels` and `toDataURL` hand back a buffer that was cleared at the last
 * composite unless you happen to be inside the same task as the draw.
 *
 * The per-frame reading is the one that fails the run, because it is the one
 * that misses nothing — a screencast frame is only pushed when something
 * CHANGES, so a screen that stays blank stays one frame.
 *
 * Usage: node scripts/probe-return-to-shelf.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

/** How long to watch the shelf after the press. */
const WATCH_MS = 2000;
/** A clip is "blank" when this much of it is one flat colour. */
const FLAT_RATIO = 0.995;

const WELCOME = 'Welcome to Alcove';

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
// The PNG decoder: an about:blank page with createImageBitmap, the same trick
// `shots-now/visual-suite.mjs` uses so the repo needs no image dependency.
const cmp = await browser.newPage();
await cmp.goto('about:blank');

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

const fails = [];
const check = (what, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) fails.push(`${what}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The share of a clip taken by its single commonest colour.
 *
 * Deliberately not "is it the wall hex": the wall is a scheme value and the
 * placeholder tint is another, and a probe that hard-codes either is one
 * repaint away from passing a blank screen. "Almost all of this box is one
 * colour" is true of an empty window under every scheme there is and false of
 * a drawn bookcase under all of them.
 *
 * `mime` because the two sources are different formats: a screenshot arrives
 * as PNG and a screencast frame as JPEG. `createImageBitmap` reads a Blob, so
 * the only thing that has to change between them is the type.
 */
async function flatness(base64, mime = 'image/png', clip = null) {
  return cmp.evaluate(
    async ([b64, type, box]) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      const w = box === null ? bmp.width : box.width;
      const h = box === null ? bmp.height : box.height;
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (box === null) ctx.drawImage(bmp, 0, 0);
      else ctx.drawImage(bmp, box.x, box.y, box.width, box.height, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const counts = new Map();
      let total = 0;
      // Every 4th pixel across and down: 16x fewer samples and the same answer
      // to three decimal places on a box this size.
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          // Quantised to 5 bits a channel. SwiftShader dithers its gradients
          // and JPEG rings around every edge; a wall that is 236,231,214 in one
          // pixel and 236,231,215 in the next is still one flat wall.
          const key =
            ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          total += 1;
        }
      }
      let top = 0;
      for (const n of counts.values()) if (n > top) top = n;
      return { flat: top / total, colours: counts.size, sampled: total };
    },
    [base64, mime, clip],
  );
}

/* ------------------------------ 1. boot --------------------------------- */

console.log('1. boot the shelf');
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'world hook');
await poll(
  () => document.querySelector('.shelf-a11y button') !== null,
  120000,
  'the a11y mirror',
);
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1500);

await page.evaluate(() =>
  globalThis.__shelfSeedBooks(
    ['Cell Biology', 'Kanji Practice', 'Watercolor', 'Tea Journal', 'Birdsong'],
    0,
  ),
);
await page.waitForTimeout(2500);
console.log(
  '  books on the mirror:',
  await page.evaluate(() => document.querySelectorAll('.shelf-a11y button').length),
);

// Where the case is, so the optical samples look at the bookcase and not at the
// dock or the zoom pill (both of which are DOM and were drawn perfectly well in
// the frame that started all this).
// Small on purpose: the whole cost of an optical sample is the capture and the
// PNG encode, and a smaller box is a faster cadence. 320px square over the
// middle of a case that is ~960px wide on screen at the opening zoom is all
// bookcase and no wall, which is what makes "almost all one colour" decisive.
const CLIP = { x: 560, y: 250, width: 320, height: 320 };
const settled = await page.screenshot({ clip: CLIP });
const settledFlat = await flatness(settled.toString('base64'));
console.log(`  the case, settled: flat=${settledFlat.flat.toFixed(4)} colours=${settledFlat.colours}`);
await page.screenshot({ path: 'qa/ui/return-00-shelf.png' });

/* --------------------------- 2. open a book ------------------------------ */

console.log('\n2. open the Welcome book');
const row = page.locator('.shelf-a11y button', { hasText: WELCOME });
if ((await row.count()) === 0) throw new Error('no Welcome book on the shelf mirror');
// The mirror is offscreen behind the canvas by design, so activation is
// dispatched rather than clicked — the same way tests/e2e/pull-out.spec.ts
// opens a book without a drag.
await row.first().dispatchEvent('click');

// A pull either hands straight over to the book view (the floor was not
// mounted at LOD0, so there was no spine to fly) or the book comes to rest in
// the hand in front of the case. In the second case the BOOK is the button —
// there is no "read it" plate any more, by the reader's own instruction — so
// wait for the flight to land and tap the cover.
try {
  await poll(
    () =>
      document.querySelector('.nb-book-view') !== null ||
      document.querySelector('.pulled-book') !== null,
    60000,
    'the book to leave the shelf',
  );
} catch (e) {
  // A probe that only says "timed out" sends the next person hunting through
  // the thing they just changed. This one has been seen to fail because the
  // BOOK half never arrived — a dev server mid-HMR serving a broken chunk to a
  // `lazy()` — which has nothing to do with the shelf and looks identical from
  // the outside, so the state is printed before the throw.
  console.log(
    '  nothing left the shelf. the room, at the moment it gave up:',
    JSON.stringify(
      await page.evaluate(() => {
        const w = globalThis.__shelfWorld;
        return {
          frozen: w?.frozen ?? null,
          tier: w?.tier ?? null,
          floors: w?.floors?.size ?? null,
          mirrorRows: document.querySelectorAll('.shelf-a11y button').length,
          bookOpening: document.querySelector('.nb-book-opening') !== null,
          tourUp: document.querySelector('[data-tutorial-step]') !== null,
        };
      }),
    ),
  );
  throw e;
}
if ((await page.locator('.nb-book-view').count()) === 0) {
  await page.waitForTimeout(1600);
  await page.locator('.pulled-book').first().click();
}
await page.waitForSelector('.nb-book-view', { timeout: 60000 });
await page.waitForTimeout(3000);
console.log('  the book is open');

const away = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const root = document.querySelector('.shelf-root');
  return {
    shelfRootPresent: root !== null,
    isAway: root !== null && root.classList.contains('is-away'),
    inert: root !== null && root.hasAttribute('inert'),
    visibility: root === null ? null : getComputedStyle(root).visibility,
    paused: w === undefined ? null : (w.isPaused ?? null),
    frames: w === undefined ? null : (w.framesRun ?? null),
  };
});
console.log('  the shelf, from inside the book:', JSON.stringify(away));

// The command bus is one map keyed by id, last claim wins, and BookView claims
// `templates` as well. A shelf that outlives the switch and keeps hold of its
// ids would have them overwritten on the way in and DELETED on the way out, by
// BookView's own cleanup releasing the id it was by then holding — so the key
// would work until the first time a book was closed. Both directions are
// checked, because only checking the second one passes on a shelf that never
// let go at all.
const inBookCommands = await page.evaluate(() => globalThis.__shelfCommands?.() ?? []);
check(
  'the shelf gives up its keys inside a book',
  !inBookCommands.includes('new-book') && !inBookCommands.includes('add-floor'),
  `still live: ${inBookCommands.filter((c) => c === 'new-book' || c === 'add-floor').join(', ')}`,
);

/* ------------- 3. the ticker must not run behind the book ---------------- */

console.log('\n3. does the hidden shelf burn frames?');
const framesA = await page.evaluate(() => globalThis.__shelfWorld?.framesRun ?? null);
await page.waitForTimeout(2000);
const framesB = await page.evaluate(() => globalThis.__shelfWorld?.framesRun ?? null);
console.log(`  framesRun over 2s behind an open book: ${framesA} -> ${framesB}`);
check(
  'the hidden shelf runs no frames',
  framesA === null || framesB === null || framesB === framesA,
  `${framesB - framesA} frames burned while nobody was looking`,
);

/* ------------------------ 4. press the way back -------------------------- */

console.log('\n4. press "back to shelf" and watch every frame');

// The sampler goes in FIRST, so the very frame the press lands on is recorded.
await page.evaluate(() => {
  const g = globalThis;
  g.__probe = { samples: [], on: true, t0: performance.now() };
  const tick = (t) => {
    if (!g.__probe.on) return;
    requestAnimationFrame(tick);
    const w = g.__shelfWorld;
    const root = document.querySelector('.shelf-root');
    const canvas = document.querySelector('canvas.shelf-canvas');
    const hidden =
      root === null ||
      root.classList.contains('is-away') ||
      getComputedStyle(root).visibility === 'hidden';
    g.__probe.samples.push({
      t: Math.round(t - g.__probe.t0),
      // The book view going is what "after the press" means; there is no
      // earlier signal that both builds agree on.
      inBook: document.querySelector('.nb-book-view') !== null,
      canvas: canvas !== null,
      hidden,
      // A destroyed world leaves this global pointing at itself, floors and
      // all cleared — which is exactly the state the old build spent the
      // blank second in, so it reads as no case rather than as no world.
      floors: w === undefined ? -1 : (w.floors?.size ?? -1),
      renders: typeof w?.rendersRun === 'number' ? w.rendersRun : null,
      frames: typeof w?.framesRun === 'number' ? w.framesRun : null,
      // The room's art, as opposed to the room's furniture. A world that has
      // mounted its floors but not yet finished `applyLibrary` is drawing the
      // case in flat placeholder tints — better than cream, still not the room
      // the reader walked out of. It is empty on a world that has just been
      // built and stays set for the life of one that was kept.
      applied: w === undefined ? null : (w.appliedLibraryKey ?? null),
    });
  };
  requestAnimationFrame(tick);
});

// Into the corner, the way a reader goes looking for it: the button recedes
// once you are settled and comes back on intent.
await page.mouse.move(40, 30);
const backButton = page.getByRole('button', { name: /back to shelf/i });
await backButton.waitFor({ timeout: 30000 });

// The box is read BEFORE the press and the press itself is a raw mouse click
// into it, rather than `locator.click()`. Same physical event, but the
// actionability checks that wrap the locator form took 275ms to clear on
// SwiftShader — and that is 275ms of the blank window this probe exists to
// photograph, spent before the first screenshot could be asked for.
const box = await backButton.boundingBox();
if (box === null) throw new Error('the way back has no box to press');

// The optical channel: every frame Chromium composites, pushed as it is
// presented. Started BEFORE the press, so the last frame of the open book is
// in the recording and the first frame of whatever replaces it is timed
// against a press that has already happened.
const cdp = await page.context().newCDPSession(page);
const cast = [];
let pressedAt = Date.now();
cdp.on('Page.screencastFrame', (f) => {
  cast.push({ at: Date.now() - pressedAt, data: f.data });
  // Unacked frames stall the stream after the first one or two.
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });
await page.waitForTimeout(400);

pressedAt = Date.now();
cast.length = 0;
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

await page.waitForTimeout(WATCH_MS);

// Stop the stream before scoring: decoding a hundred JPEGs in the comparator
// page while the app is still being watched would be measuring the probe.
await cdp.send('Page.stopScreencast');
const optical = [];
for (const f of cast) {
  optical.push({ at: f.at, ...(await flatness(f.data, 'image/jpeg', CLIP)) });
}

await page.waitForTimeout(200);
const samples = await page.evaluate(() => {
  globalThis.__probe.on = false;
  return globalThis.__probe.samples;
});

/* ----------------------------- 5. the verdict ---------------------------- */

console.log('\n5. the frames');

const pressIndex = samples.findIndex((s) => !s.inBook);
if (pressIndex < 0) throw new Error('the book view never went away — nothing was measured');
const after = samples.slice(pressIndex);

/**
 * Two questions, in the order the reader asks them.
 *
 * BLANK is the reported bug: they are out of the book, so the case is what
 * they asked for, and none of it can be on the canvas — no canvas, or it is
 * hidden, or the world has no floors mounted, or it has never painted.
 *
 * UNPAINTED is the tail of the same second: a world that has just been built
 * has its floors up before `applyLibrary` has finished, so the case is
 * standing there in flat placeholder tints. Not cream, and not the room
 * either. A world that was kept never passes through it.
 */
const isBlank = (s) =>
  !s.canvas || s.hidden || s.floors <= 0 || (s.renders !== null && s.renders <= 0);
const isUnpainted = (s) => !isBlank(s) && s.applied !== null && s.applied === '';
const state = (s) => (isBlank(s) ? 'BLANK' : isUnpainted(s) ? 'unpainted' : 'the room');

const blank = after.filter(isBlank);
const unpainted = after.filter(isUnpainted);
const firstRoom = after.find((s) => !isBlank(s) && !isUnpainted(s));
const span = (list) =>
  list.length === 0 ? 0 : list[list.length - 1].t - list[0].t + 17;

console.log(`  frames sampled before the press: ${pressIndex}`);
console.log(
  `  frames sampled after the press:  ${after.length} over ${after[after.length - 1].t - after[0].t}ms`,
);
console.log(`  BLANK frames (nothing on the canvas):     ${blank.length}  (~${span(blank)}ms)`);
console.log(`  UNPAINTED frames (case, but not the room): ${unpainted.length}  (~${span(unpainted)}ms)`);
console.log(
  `  the reader's own room is back after: ${
    firstRoom === undefined ? 'never' : `+${firstRoom.t - after[0].t}ms`
  }`,
);
console.log('\n  first 12 frames after the press:');
for (const s of after.slice(0, 12)) {
  console.log(
    `    +${String(s.t - after[0].t).padStart(4)}ms  canvas=${s.canvas ? 'y' : 'n'}  hidden=${
      s.hidden ? 'y' : 'n'
    }  floors=${String(s.floors).padStart(2)}  renders=${String(s.renders ?? '-').padStart(
      4,
    )}  ${state(s)}`,
  );
}

console.log(
  `\n  optically — ${optical.length} composited frames, scored over the middle of the case:`,
);
for (const o of optical) {
  const flatPct = (o.flat * 100).toFixed(1);
  console.log(
    `    +${String(o.at).padStart(4)}ms  ${flatPct.padStart(5)}% one colour, ${String(
      o.colours,
    ).padStart(4)} colours  ${o.flat >= FLAT_RATIO ? 'BLANK' : 'drawn'}`,
  );
}
const opticalBlank = optical.filter((o) => o.flat >= FLAT_RATIO);
// A screencast frame is pushed on presentation, so a blank screen lasts until
// the frame that ends it: the honest duration is from the first blank frame to
// the first drawn one after it, not the spread of the blank frames themselves.
if (opticalBlank.length > 0) {
  const firstBlank = opticalBlank[0].at;
  const ended = optical.find((o) => o.at > firstBlank && o.flat < FLAT_RATIO);
  console.log(
    `  the window was blank from +${firstBlank}ms until ${
      ended === undefined ? 'the end of the recording' : `+${ended.at}ms`
    }`,
  );
  // The evidence, whole and full-frame rather than the scored crop, because a
  // number that says a window was empty is worth much less than the picture
  // of the empty window — which is how this defect was found in the first
  // place (`qa/demo/frames/f1352.png`).
  const frame = cast.find((f) => f.at === firstBlank);
  if (frame !== undefined) {
    writeFileSync('qa/ui/return-blank-frame.jpg', Buffer.from(frame.data, 'base64'));
    console.log('  the blank frame itself: qa/ui/return-blank-frame.jpg');
  }
}

await page.waitForTimeout(2500);
await page.screenshot({ path: 'qa/ui/return-01-back.png' });

console.log('\n6. verdict');
check(
  'no blank frame after "back to shelf"',
  blank.length === 0,
  `${blank.length} of ${after.length} frames had nothing on the canvas`,
);
check(
  'the room is the reader’s own from the first frame',
  unpainted.length === 0,
  `${unpainted.length} of ${after.length} frames drew the case in placeholder tints`,
);
check(
  'nothing optically blank after "back to shelf"',
  opticalBlank.length === 0,
  `${opticalBlank.length} of ${optical.length} screenshots were ${(FLAT_RATIO * 100).toFixed(
    1,
  )}%+ one flat colour`,
);
check(
  'the loop is running again',
  after[after.length - 1].frames === null ||
    after[after.length - 1].frames > after[0].frames,
  'framesRun did not advance after the return',
);

const backCommands = await page.evaluate(() => globalThis.__shelfCommands?.() ?? []);
const missing = ['new-book', 'add-floor', 'library-studio', 'open-trash', 'templates'].filter(
  (id) => !backCommands.includes(id),
);
check(
  'the shelf has its keys back',
  missing.length === 0,
  `no live command for ${missing.join(', ')} after closing a book`,
);

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();

if (fails.length > 0 || errors.size > 0) {
  console.log(`\n${fails.length} FAILED:\n  ${fails.join('\n  ') || '(none)'}`);
  process.exit(1);
}
console.log('\nall checks passed');
