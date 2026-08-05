/**
 * scripts/probe-book-opening.mjs — what is the reader looking at while a book opens?
 *
 * The way IN, and the mirror image of `probe-return-to-shelf.mjs`. That probe
 * asked whether the shelf comes back blank; this one asks what fills the window
 * between the cover leaving the case and the spread landing on the desk. In the
 * demo recording it is `qa/demo/frames/f0421.png` and the nineteen frames after
 * it: bare cream, the settings seal, and one small caption in the middle of a
 * 1440x900 window. At 14fps that is about a second and a half of nothing.
 *
 * ## Two questions, and the second one is the whole point
 *
 * 1. **How long?** Sampled every animation frame from inside the page, so no
 *    part of the gap can hide between two screenshots — the same reason the
 *    return probe stopped using `page.screenshot()` in a loop.
 *
 * 2. **Long because of WHAT?** A gap is not a defect you can fix, it is a
 *    symptom of one, and there are three candidate causes that look identical
 *    from the outside:
 *
 *      - the `lazy()` chunk (BookView plus the whole editor stack) still being
 *        fetched, which `preloadBookView()` in App.tsx exists to have already
 *        done. Whether that prefetch actually FIRED is a fact about the page,
 *        readable off `performance.getEntriesByType('resource')`: the module's
 *        request either started long before the press or it did not.
 *      - the session `createResource` reading the book and its pages. In a
 *        browser this is `data/db.ts`'s localStorage stub rather than SQLite,
 *        so it is timed rather than assumed — a stub that is instant here would
 *        say nothing about the packaged app, and the number is printed either
 *        way so the next person can see which world they are in.
 *      - neither: the chunk was warm, the read was instant, and the time went
 *        into mounting the spread — TipTap editors, the cover bake, the flip
 *        surface. That is the answer that says the fallback is the fix, because
 *        the work is real and has to happen somewhere.
 *
 * Every timing is taken from the press, and the press is a dispatched click on
 * the a11y mirror row rather than a drag off the shelf: the shelf's own theatre
 * (the pull, the cover coming forward) is a different beat that a reader is
 * watching happily, and folding it into the measurement would inflate the gap
 * with a second of animation nobody is complaining about.
 *
 * Usage: node scripts/probe-book-opening.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
/**
 * `--hold=<ms>` — photograph the fallback instead of timing the gap.
 *
 * The gap is real but it is not HOLDABLE: the fallback is in the DOM for about
 * one animation frame and then the spread's mount jams the main thread, so what
 * the reader stares at is a frozen composite of a tree that has already gone.
 * `page.screenshot()` cannot photograph that — it forces a fresh paint, of the
 * tree that is there NOW. So to look at what was drawn, the book module is held
 * at the network for a few seconds and the fallback is asked to do its real job
 * for longer than usual. Nothing about the markup or the styles changes; the
 * only difference from a reader's open is how long they get to look at it.
 */
const HOLD_MS = Number(opt('hold', '0'));

/** How long to watch after the press before giving up on the spread. */
const WATCH_MS = 6000;
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
// The PNG/JPEG decoder: an about:blank page with createImageBitmap, so the repo
// needs no image dependency (same trick as shots-now/visual-suite.mjs).
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

/** The share of a clip taken by its single commonest colour. See the return probe. */
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
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
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

if (HOLD_MS > 0) {
  // Only BookView itself, not the editor modules under it: holding the root is
  // enough to keep the `lazy()` unresolved, and holding everything would take
  // the hold out on the shelf's own boot too.
  await page.route(/\/src\/views\/BookView\.tsx/, async (route) => {
    await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });
}

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
// Long enough for the shelf to settle AND for the first idle to have come and
// gone — the prefetch is scheduled on `requestIdleCallback` with no timeout, so
// it only runs when the main thread lets it.
await page.waitForTimeout(4000);

/* --------------------- 2. did the prefetch fire? ------------------------- */

console.log('\n2. the book chunk, before anybody asked for it');
const prefetch = await page.evaluate(() => {
  const entries = performance
    .getEntriesByType('resource')
    .filter((e) => /BookView|PageEditor|tiptap|prosemirror/i.test(e.name));
  return {
    now: Math.round(performance.now()),
    count: entries.length,
    bookView: entries
      .filter((e) => /\/BookView\b/.test(e.name))
      .map((e) => ({ at: Math.round(e.startTime), ms: Math.round(e.duration) })),
    editorish: entries.length,
  };
});
console.log(`  ${prefetch.now}ms into the page's life`);
console.log(`  editor-ish modules already requested: ${prefetch.editorish}`);
console.log(`  BookView itself: ${JSON.stringify(prefetch.bookView)}`);

/* ------------------- 3. press, and watch every frame --------------------- */

console.log('\n3. open the Welcome book and watch every frame');

const row = page.locator('.shelf-a11y button', { hasText: WELCOME });
if ((await row.count()) === 0) throw new Error('no Welcome book on the shelf mirror');

// The sampler goes in FIRST so the frame the press lands on is recorded. It
// watches for each of the three things that can be on screen during the gap,
// separately: the App-level Suspense fallback (`.nb-book-opening`), BookView's
// own in-tree fallback (`.nb-book-empty`, which only shows if the boundary is
// NOT the one suspending), and the spread itself.
await page.evaluate(() => {
  const g = globalThis;
  g.__probe = { samples: [], on: true, t0: performance.now(), chunkMs: null, tasks: [] };
  // Long tasks, because the first reading of this probe found the DOM mounted
  // at +68ms and the window still optically empty a second and a half later.
  // A composited frame is only pushed when the compositor presents one, so a
  // hole in the recording is either "nothing changed" or "the main thread never
  // let go" — and only one of those is a defect anybody can fix.
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        g.__probe.tasks.push({
          t: Math.round(e.startTime - g.__probe.t0),
          ms: Math.round(e.duration),
        });
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    // No longtask support — the frame deltas below still show the jam.
  }
  // Re-ask for the module at the moment of the press. If the prefetch did its
  // job this settles in the same microtask turn and costs ~0; if it did not,
  // this is the fetch the reader is waiting on.
  const t = performance.now();
  void import('/src/views/BookView.tsx').then(() => {
    g.__probe.chunkMs = Math.round(performance.now() - t);
  });
  const tick = (now) => {
    if (!g.__probe.on) return;
    requestAnimationFrame(tick);
    g.__probe.samples.push({
      t: Math.round(now - g.__probe.t0),
      shelf: document.querySelector('.shelf-root:not(.is-away)') !== null,
      suspense: document.querySelector('.nb-book-opening') !== null,
      inTree: document.querySelector('.nb-book-empty') !== null,
      view: document.querySelector('.nb-book-view') !== null,
      rail: document.querySelector('.nb-rail') !== null,
      flip: document.querySelector('.nb-flip-surface') !== null,
      prose: document.querySelectorAll('.nb-prose').length,
    });
  };
  requestAnimationFrame(tick);
});

// The optical channel, started before the press so the last shelf frame is in
// the recording. Scored over the whole window rather than a crop: the thing
// being measured is "the window is empty", which is a claim about all of it.
const cdp = await page.context().newCDPSession(page);
const cast = [];
let pressedAt = Date.now();
cdp.on('Page.screencastFrame', (f) => {
  cast.push({ at: Date.now() - pressedAt, data: f.data });
  void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, everyNthFrame: 1 });
await page.waitForTimeout(400);

pressedAt = Date.now();
cast.length = 0;
await page.evaluate(() => {
  globalThis.__probe.t0 = performance.now();
  globalThis.__probe.samples.length = 0;
});
await row.first().dispatchEvent('click');

// A pull either hands straight to the book view or lands the cover in the hand.
await poll(
  () =>
    document.querySelector('.nb-book-view') !== null ||
    document.querySelector('.nb-book-opening') !== null ||
    document.querySelector('.pulled-book') !== null,
  60000,
  'the book to leave the shelf',
);
if (
  (await page.locator('.nb-book-view').count()) === 0 &&
  (await page.locator('.nb-book-opening').count()) === 0
) {
  await page.waitForTimeout(1600);
  // Re-zero: the flight is theatre the reader is enjoying, not the gap.
  pressedAt = Date.now();
  cast.length = 0;
  await page.evaluate(() => {
    globalThis.__probe.t0 = performance.now();
    globalThis.__probe.samples.length = 0;
  });
  await page.locator('.pulled-book').first().click();
}

if (HOLD_MS > 0) {
  await page.waitForSelector('.nb-book-opening', { timeout: 60000 });
  // `--theme=night` stamps the root the way applySettings does, so the fallback
  // can be looked at on a dark ground without walking the settings sheet. It
  // draws in tokens only, and this is how that claim gets checked rather than
  // asserted.
  const theme = opt('theme', '');
  if (theme) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  }
  // Two shots: one at the top of the beat, with the settle animation still
  // running, and one a second later, which is the frame a reader whose machine
  // is busy actually sits in front of.
  await page.waitForTimeout(120);
  await page.screenshot({ path: 'qa/ui/opening-fallback-early.png' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'qa/ui/opening-fallback.png' });
  console.log('  the fallback, held: qa/ui/opening-fallback{,-early}.png');
  await cdp.send('Page.stopScreencast').catch(() => {});
  console.log('\n=== page errors ===');
  if (errors.size === 0) console.log('none');
  else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);
  await browser.close();
  process.exit(0);
}

await page.waitForTimeout(WATCH_MS);
await cdp.send('Page.stopScreencast');

const optical = [];
for (const f of cast) optical.push({ at: f.at, ...(await flatness(f.data, 'image/jpeg')) });

const samples = await page.evaluate(() => {
  globalThis.__probe.on = false;
  return {
    samples: globalThis.__probe.samples,
    chunkMs: globalThis.__probe.chunkMs,
    tasks: globalThis.__probe.tasks,
  };
});

/* ------------------------ 4. what the read costs ------------------------- */

console.log('\n4. the session read, timed');
const dbMs = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const pages = await import('/src/data/pages.ts');
  const list = await books.listBooksByFloorRange(0, 999);
  const first = list[0];
  if (!first) return null;
  const t = performance.now();
  await books.getBook(first.id);
  await pages.listPages(first.id);
  return Math.round(performance.now() - t);
});
console.log(`  getBook + listPages: ${dbMs === null ? 'no books' : `${dbMs}ms`}`);
console.log(`  import('/src/views/BookView.tsx') at press time: ${samples.chunkMs}ms`);

/* ----------------------------- 5. the verdict ---------------------------- */

console.log('\n5. the frames');
const after = samples.samples;
const firstOf = (pred) => {
  const hit = after.find(pred);
  return hit === undefined ? null : hit.t;
};
const lastOf = (pred) => {
  let out = null;
  for (const s of after) if (pred(s)) out = s.t;
  return out;
};

/** Nothing to look at: no shelf behind, no spread yet. */
const isGap = (s) => !s.shelf && !s.flip && s.prose === 0;
const gap = after.filter(isGap);

console.log(`  frames sampled: ${after.length} over ${after.length ? after[after.length - 1].t : 0}ms`);
console.log(`  shelf hidden from:            ${firstOf((s) => !s.shelf)}ms`);
console.log(`  App Suspense fallback up:     ${firstOf((s) => s.suspense)} -> ${lastOf((s) => s.suspense)}ms`);
console.log(`  BookView's own fallback up:   ${firstOf((s) => s.inTree)} -> ${lastOf((s) => s.inTree)}ms`);
console.log(`  .nb-book-view mounted at:     ${firstOf((s) => s.view)}ms`);
console.log(`  the rail at:                  ${firstOf((s) => s.rail)}ms`);
console.log(`  the flip surface at:          ${firstOf((s) => s.flip)}ms`);
console.log(`  first prose at:               ${firstOf((s) => s.prose > 0)}ms`);
console.log(
  `  GAP frames (nothing but the fallback): ${gap.length}` +
    (gap.length ? `  from ${gap[0].t}ms to ${gap[gap.length - 1].t}ms` : ''),
);

// Where the main thread went. A rAF gap is the honest unit: whatever ran in it,
// the reader got no new picture for that long.
const gaps = [];
for (let i = 1; i < after.length; i += 1) {
  const d = after[i].t - after[i - 1].t;
  if (d >= 100) gaps.push({ from: after[i - 1].t, ms: d });
}
console.log(`\n  frames the reader never got (rAF gaps >= 100ms): ${gaps.length}`);
for (const g of gaps) console.log(`    at +${g.from}ms — ${g.ms}ms with no frame`);
const bigTasks = samples.tasks.filter((t) => t.ms >= 60).slice(0, 20);
console.log(`  long tasks >= 60ms: ${samples.tasks.filter((t) => t.ms >= 60).length}`);
for (const t of bigTasks) console.log(`    at +${t.t}ms — ${t.ms}ms`);

console.log('\n  optically — every composited frame, scored over the whole window:');
for (const o of optical) {
  console.log(
    `    +${String(o.at).padStart(4)}ms  ${(o.flat * 100).toFixed(1).padStart(5)}% one colour, ${String(
      o.colours,
    ).padStart(4)} colours  ${o.flat >= FLAT_RATIO ? 'BLANK' : 'drawn'}`,
  );
}
// The emptiest thing the reader was shown, whether or not it counts as blank —
// the point of this probe is that somebody LOOKS at that frame, and a run that
// passes its own threshold is exactly the run where nobody would think to.
const worst = optical.reduce((a, b) => (b.flat > a.flat ? b : a), optical[0]);
if (worst !== undefined) {
  const frame = cast.find((f) => f.at === worst.at);
  if (frame !== undefined) {
    writeFileSync('qa/ui/opening-worst-frame.jpg', Buffer.from(frame.data, 'base64'));
    console.log(
      `  the emptiest frame the reader got (+${worst.at}ms, ${(worst.flat * 100).toFixed(
        1,
      )}% one colour): qa/ui/opening-worst-frame.jpg`,
    );
  }
}

const opticalBlank = optical.filter((o) => o.flat >= FLAT_RATIO);
if (opticalBlank.length > 0) {
  const firstBlank = opticalBlank[0].at;
  const ended = optical.find((o) => o.at > firstBlank && o.flat < FLAT_RATIO);
  console.log(
    `  the window was blank from +${firstBlank}ms until ${
      ended === undefined ? 'the end of the recording' : `+${ended.at}ms`
    }`,
  );
  const frame = cast.find((f) => f.at === firstBlank);
  if (frame !== undefined) {
    writeFileSync('qa/ui/opening-blank-frame.jpg', Buffer.from(frame.data, 'base64'));
    console.log('  the blank frame itself: qa/ui/opening-blank-frame.jpg');
  }
}

await page.screenshot({ path: 'qa/ui/opening-settled.png' });
console.log('  the spread, settled: qa/ui/opening-settled.png');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
