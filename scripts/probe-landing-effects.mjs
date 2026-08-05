/**
 * scripts/probe-landing-effects.mjs — the page arrives undressed, then dresses.
 *
 * The reader, on the turn: *"it doesn't have the shading — for example the
 * shadow in the middle — the page looks whitish for maybe 0.5 seconds and then
 * all of it comes. So it feels like it loads those effects when the user
 * finishes turning the pages."* And, narrowing it themselves: ONLY the shadow
 * and the page colour. The words and the blocks are there at once.
 *
 * This is NOT the landing flicker fixed in 28c7691 — that one was the raster
 * cache writing `.snapshotting` onto the leaf the reader was looking at, and
 * `scripts/probe-landing-flicker.mjs` proves it fires zero times now. So this
 * probe asks a different question of a different thing.
 *
 * ## What it measures, in two passes
 *
 * PASS A — **the DOM's own look, property by property.** For every value the
 * leaf's appearance is made of (the gutter band and its crease, the dog-ear,
 * the paper colour, the fore-edge hairlines, the ruling background stack, the
 * two doc attributes the ruling is computed from, the tokens resolved at the
 * leaf), when does it reach the value it settles on? Answered in ms after the
 * DOM swap.
 *
 * PASS B — **what is actually on the glass in the meantime.** The flip canvas
 * is `position:absolute; inset:0` over the whole spread at `z-index:
 * var(--z-flip)`, and the gutter used to be a plain DOM band at `z-index: 10`
 * underneath it. While the canvas covers it, none of the DOM's look reaches the
 * reader's eye no matter how correct it is — the GL frame is what they see.
 * This pass measures the overlap in pixels and the duration in ms, and it asks
 * the STACKING as well as the geometry: since the fix, spread.css lifts the
 * band and the dog-ear over the canvas for the length of a turn, and a
 * geometry-only test would call that buried too. See `buries()` below.
 *
 * Pass A is the one everybody writes and it comes back clean; pass B is where
 * the answer is. That ordering is the point — see the report at the end.
 *
 * ## Two instrumentation choices that decided the result
 *
 * SAMPLED ON A TIMER, NOT ON rAF. A landing saturates the main thread (the
 * raster cache resumes and stages offscreen pages, each mounting a TipTap
 * editor and running html-to-image), so headless SwiftShader drops to ~2.4
 * frames per second afterwards — three samples across the entire half second
 * being asked about. A timer keeps firing whatever the compositor is doing,
 * and computed style resolves on demand rather than on paint.
 *
 * ANCHORED ON THE DOM SWAP, NOT ON THE CANVAS COMING DOWN. `land()` calls
 * `navigate()` and only THEN waits a rAF to clear the overlay and another to
 * hide it. Two frames is ~33ms on the reader's machine and most of a second on
 * a saturated one, so anchoring on the canvas skips the entire transient and
 * pronounces the page settled. The first run of this probe did exactly that
 * and reported "nothing was late".
 *
 * FORCE FULL MOTION. Headless Chromium reports `prefers-reduced-motion:
 * reduce`, and the controller answers that by crossfading instead of curling —
 * a code path the reader never takes. Every flip probe in this repo measured
 * that shortcut once. `emulateMedia` below is not optional.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const TURNS = Number(process.argv.find((a) => a.startsWith('--turns='))?.slice(8) ?? 4);
const OUT = 'qa/turn/effects';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

console.log('1. open the welcome book');
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
// Long enough for the first spread to finish its own arrival: capacity
// measurement, the pagination drain, adjacent snapshots. Anything still moving
// after this is the turn's doing, not the open's.
await page.waitForTimeout(6000);

/*
 * The sampler. Re-installed before every turn rather than once, because other
 * agents are editing this tree and the dev server fires HMR mid-run: a reload
 * wipes globalThis, and a probe that installs once dies with
 * "Execution context was destroyed" halfway through its evidence.
 */
const installSampler = () =>
  page.evaluate(() => {
    /*
     * The counter lives on globalThis, NOT in this closure.
     *
     * The sampler is re-installed before every turn (HMR), and a per-install
     * counter starts again at 1 while elements stamped by the previous install
     * keep their old numbers — so a freshly mounted page could be handed the
     * same generation as the one it replaced, and the swap detector saw no
     * change. Four turns in a row reported "no leaf remounted" at spreads that
     * demonstrably moved. Monotonic across installs, so a number is only ever
     * reused by the same element.
     */
    globalThis.__probeGenSeq ??= 0;
    const stamp = (el) => {
      if (el === null) return -1;
      if (el.__probeGen === undefined) {
        globalThis.__probeGenSeq += 1;
        el.__probeGen = globalThis.__probeGenSeq;
      }
      return el.__probeGen;
    };
    // Long background-image stacks are the whole point of the ruling, so keep a
    // fingerprint rather than the text: length + head is enough to tell `none`
    // from a repeating-linear-gradient, and one ruling from another.
    const brief = (value) => {
      if (value === undefined || value === null) return 'null';
      const text = String(value).replace(/\s+/g, ' ').trim();
      return text.length <= 46 ? text : `${text.slice(0, 46)}…(${text.length})`;
    };
    const box = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };

    const leafSnap = (side) => {
      const paper = document.querySelector(`.nb-leaf-paper[data-side='${side}']`);
      if (paper === null) return { there: false };
      const paperCs = getComputedStyle(paper);
      const pageEl = paper.querySelector('.nb-page');
      const prose = paper.querySelector('.ProseMirror');
      const proseCs = prose === null ? null : getComputedStyle(prose);
      const pageCs = pageEl === null ? null : getComputedStyle(pageEl);
      return {
        there: true,
        gen: stamp(pageEl),
        // The paper itself: colour, and the fore-edge hairlines that draw the
        // page stack (box-shadow, spread.css).
        paperBg: paperCs.backgroundColor,
        paperShadow: brief(paperCs.boxShadow),
        paperVis: `${paperCs.visibility}/${paperCs.opacity}`,
        // The two doc attributes the ruling is computed FROM. They are read
        // off the TipTap document after it parses, so if anything about the
        // page's look arrives late it should arrive late here first.
        style: pageEl?.getAttribute('data-style') ?? 'none',
        pitch: pageCs?.getPropertyValue('--page-rule-pitch').trim() ?? 'none',
        // The ruling: what is PRINTED on the paper.
        ruleImage: brief(proseCs?.backgroundImage),
        ruleSize: brief(proseCs?.backgroundSize),
        // Tokens resolved AT THE LEAF, so a theme token that has not cascaded
        // is separable from a rule that has not matched.
        cream: pageCs?.getPropertyValue('--paper-cream').trim() ?? 'none',
        ruleInk: brief(pageCs?.getPropertyValue('--rule-ink').trim()),
        // The part the reader says is NOT late — the control. A probe that
        // cannot confirm the half that works is not measuring the page.
        blocks: prose?.children.length ?? 0,
      };
    };

    const snap = () => {
      const gutter = document.querySelector('.nb-spread-gutter');
      const gutterCs = gutter === null ? null : getComputedStyle(gutter);
      const curl = document.querySelector('.nb-page-curl');
      const curlCs = curl === null ? null : getComputedStyle(curl);
      const canvas = document.querySelector('canvas.nb-flip-canvas');
      const canvasCs = canvas === null ? null : getComputedStyle(canvas);
      const canvasUp = canvas?.classList.contains('is-flipping') ?? false;

      /*
       * PASS B, per sample: is the gutter band underneath the GL overlay?
       *
       * Geometry AND STACKING — the first version of this asked geometry alone,
       * on the reasoning that the canvas is `inset: 0` on the flip surface at
       * `--z-flip` while the gutter is a plain band at z-index 10 underneath
       * it, so an intersection was enough. That reasoning was an assumption
       * about the fix as much as about the bug, and it stopped being true the
       * moment spread.css lifted the band over the canvas for the length of a
       * turn: the rects still intersect, and the band is now the thing on top.
       * A probe that reported "buried" either way could not tell the fix from
       * the defect. So the stacking goes in the question.
       *
       * The ground pass writes `vec4(color, 1.0)` over the moving leaf's whole
       * rect (curl.ts) and the curl mesh covers the other leaf once the sheet
       * is most of the way over, so an intersection while `is-flipping` is on
       * AND the canvas stacks above means the band is not reaching the reader.
       * Ties go to the band: it comes after the flip surface in the document,
       * so at equal z-index it paints last.
       */
      const gb = box(gutter);
      const cb = box(canvas);
      const overlapX = (a, b) =>
        a === null || b === null ? 0 : Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlap = overlapX(gb, cb);
      const zNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
      const canvasZNum = zNum(canvasCs?.zIndex);
      const buries = (el, elCs) =>
        canvasUp &&
        el !== null &&
        overlapX(box(el), cb) > 0 &&
        canvasZNum > zNum(elCs?.zIndex);
      /*
       * The dog-ear is the other flat piece of drawing on the spread, at
       * z-index 11 — also under the overlay, and sitting well inside the right
       * leaf's rect where the ground pass is opaque.
       *
       * The fore-edge hairlines are asked about the OTHER way round: they are
       * an outer box-shadow on the leaf, so they paint OUTSIDE the flip
       * surface's box and the canvas cannot be over them. That is a claim
       * worth checking rather than assuming, so the overhang is measured:
       * a positive number means the hairlines stick out past the canvas and
       * survive the turn, which is the difference between "the shading goes"
       * and "some of the shading goes".
       */
      const rightLeaf = document.querySelector('.nb-leaf-paper[data-side="right"]');
      const rb = box(rightLeaf);
      const edgeOverhang =
        rb === null || cb === null ? 0 : Math.round(cb.x + cb.w - (rb.x + rb.w));
      return {
        t: Math.round(performance.now()),
        canvasUp,
        canvasDisplay: canvasCs?.display ?? 'none',
        canvasZ: canvasCs?.zIndex ?? 'none',
        gutterThere: gutter !== null,
        gutterOpacity: gutterCs?.opacity ?? 'none',
        gutterBg: brief(gutterCs?.backgroundColor),
        gutterWidth: gutterCs?.width ?? 'none',
        gutterZ: gutterCs?.zIndex ?? 'none',
        // The reader's view of the band: present in the DOM AND not buried.
        gutterSeen: gutter !== null && !buries(gutter, gutterCs),
        // How much of the band the overlay is actually covering. 0 either
        // because the rects miss OR because the band is stacked above it.
        gutterOverlapPx: buries(gutter, gutterCs) ? Math.round(overlap) : 0,
        curlThere: curl !== null,
        curlOpacity: curlCs?.opacity ?? 'none',
        curlZ: curlCs?.zIndex ?? 'none',
        curlSeen: curl !== null && !buries(curl, curlCs),
        // Positive = the leaf's fore-edge hairlines hang past the canvas and
        // are NOT buried; 0 or negative would mean they go with the rest.
        edgeOverhangPx: edgeOverhang,
        left: leafSnap('left'),
        right: leafSnap('right'),
      };
    };

    globalThis.__probeStart = () => {
      globalThis.__trace = [];
      globalThis.__paints = [];
      globalThis.__tasks = [];
      globalThis.__go = true;
      /*
       * PAINTS, separately from samples. The style timeline says when a value
       * became right; the paint timeline says when the reader could have seen
       * it. A gap between two rAFs is a frame the screen did not change, and
       * the landing's gap is the whole complaint — so both are recorded.
       */
      const paint = () => {
        if (!globalThis.__go) return;
        globalThis.__paints.push(Math.round(performance.now()));
        requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);
      // …and WHAT was blocking, when it was. `longtask` entries name the
      // container but not the call, which is still enough to say whether the
      // landing stalls on the app's own work or on nothing at all.
      try {
        const obs = new PerformanceObserver((list) => {
          if (!globalThis.__go) return;
          for (const e of list.getEntries()) {
            globalThis.__tasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) });
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
        globalThis.__obs = obs;
      } catch {
        /* longtask unsupported — the rest still measures */
      }
      const timer = setInterval(() => {
        if (!globalThis.__go) {
          clearInterval(timer);
          globalThis.__obs?.disconnect();
          return;
        }
        globalThis.__trace.push(snap());
      }, 8);
    };
  });

/** Flat key list, so a change in a nested leaf field is reportable by name. */
const KEYS = [
  'canvasUp', 'canvasDisplay', 'canvasZ',
  'gutterThere', 'gutterOpacity', 'gutterBg', 'gutterWidth', 'gutterZ',
  'gutterSeen', 'gutterOverlapPx',
  'curlThere', 'curlOpacity', 'curlZ', 'curlSeen', 'edgeOverhangPx',
];
const LEAF_KEYS = [
  'there', 'gen', 'paperBg', 'paperShadow', 'paperVis',
  'style', 'pitch', 'ruleImage', 'ruleSize', 'cream', 'ruleInk', 'blocks',
];
const ALL = [...KEYS, ...['left', 'right'].flatMap((s) => LEAF_KEYS.map((k) => `${s}.${k}`))];

const flatten = (frame) => {
  const out = { t: frame.t };
  for (const k of KEYS) out[k] = frame[k];
  for (const side of ['left', 'right']) {
    for (const k of LEAF_KEYS) out[`${side}.${k}`] = frame[side]?.[k] ?? 'absent';
  }
  return out;
};

console.log(`\n2. ${TURNS} turns, sampled every 8ms, anchored on the DOM swap\n`);
const lateness = new Map(ALL.map((k) => [k, []]));
const blindMs = [];
const dressed = [];
/*
 * Turns that actually reached a DOM swap with enough samples after it to say
 * anything. Caught in the wild: a run where the book never opened printed
 * "no leaf remounted" for all four turns and then, downstream, "nothing in
 * the DOM was late" and "everything already at its settled value" — an
 * honest description of an EMPTY dataset, read by anyone skimming the output
 * as a clean pass. A probe that can say "nothing was late" having watched
 * nothing is the exact failure CLAUDE.md names: a gate nobody has watched
 * fail is not a gate, and this one failed by going silent rather than red.
 */
let capturedTurns = 0;
/** Which way the next turn goes; flipped when the book runs out that way. */
let prefer = 'ArrowRight';

for (let turn = 0; turn < TURNS; turn += 1) {
  /*
   * ALTERNATE DIRECTIONS. The Welcome book is short, so four ArrowRights walk
   * off the end of it and the last two turns measure a keypress that could not
   * navigate — which the first run of this probe duly reported as "NO LEAF
   * REMOUNTED". Turning back and forth keeps every press a real turn, and a
   * 'prev' flip exercises the other half of the landing code besides.
   */
  /*
   * Wait for REST before pressing, and turn in whichever direction is still
   * open. Neither is fussiness: a landing here can be blocked for half a
   * second, so a fixed inter-turn wait put the next keypress inside the
   * previous flip (the controller ignores it) and four of six turns reported
   * "NO LEAF REMOUNTED" — a probe measuring its own impatience.
   */
  await page
    .waitForFunction(
      () => document.querySelector('canvas.nb-flip-canvas.is-flipping') === null,
      null,
      { timeout: 8000, polling: 200 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1200);
  const spreadBefore = await page.evaluate(() => {
    /*
     * Take the caret out of the page first.
     *
     * `FlipSurface.onKeyDown` ignores an arrow key whose target is editable —
     * correctly, since a reader mid-sentence means to move the caret. But a
     * landing can leave focus inside the newly mounted prose, and then every
     * later ArrowRight in this loop moves a caret instead of turning a page:
     * six of eight turns reported "NO LEAF REMOUNTED" and the probe was
     * measuring its own focus, not the app's landing.
     */
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    return Number(
      document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1,
    );
  });
  /*
   * Direction by MEASURED position, not by the hotspot's class.
   *
   * `.nb-flip-hotspot-next` is not disabled at the end of the book — BookView
   * lets a forward turn append a page — so "is the hotspot enabled" answered
   * ArrowRight forever and six of eight turns pressed a key that went nowhere.
   * The spread index is the thing that actually moves, so the probe walks
   * forward until it stops moving and then walks back.
   */
  const key = prefer;
  let raw;
  let paints = [];
  let tasks = [];
  try {
    await installSampler();
    await page.evaluate(() => globalThis.__probeStart());
    await page.keyboard.press(key);
    await page.waitForTimeout(2600);
    const got = await page.evaluate(() => {
      globalThis.__go = false;
      return { trace: globalThis.__trace, paints: globalThis.__paints, tasks: globalThis.__tasks };
    });
    raw = got.trace;
    paints = got.paints ?? [];
    tasks = got.tasks ?? [];
  } catch (err) {
    // Almost always an HMR reload from another agent's edit landing mid-turn.
    console.log(`  turn ${turn + 1}: lost the page (${String(err).split('\n')[0]}) — skipping`);
    await page.waitForTimeout(3000);
    continue;
  }
  const frames = raw.map(flatten);

  /*
   * LANDING = THE DOM SWAP: the sample where a leaf's `.nb-page` is a
   * different element than it was. Elements are numbered on sight, so a change
   * in `left.gen` IS a remount — an event, not an inference from a value that
   * happened to move. See the header for why this and not the canvas.
   */
  const swapAt = frames.findIndex(
    (f, i) =>
      i > 0 &&
      (f['left.gen'] !== frames[i - 1]['left.gen'] || f['right.gen'] !== frames[i - 1]['right.gen']),
  );
  if (swapAt < 0) {
    console.log(
      `  turn ${turn + 1} (${key}): no leaf remounted at spread ${spreadBefore} — ` +
        `end of the book that way; turning back for the next one`,
    );
    prefer = prefer === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    continue;
  }
  const after = frames.slice(swapAt);
  if (after.length < 8) {
    console.log(`  turn ${turn + 1}: only ${after.length} samples after the swap — window too short`);
    continue;
  }
  const t0 = after[0].t;
  const settled = after[after.length - 1];

  // PASS B: how long the reader could not see the gutter at all — from the
  // first sample of the turn, because the burial starts at pointerdown, not at
  // the landing. Reported both ways.
  const blindAll = frames.filter((f) => !f.gutterSeen);
  const blindTotal = blindAll.length === 0 ? 0 : blindAll[blindAll.length - 1].t - blindAll[0].t;
  const blindAfterSwap = after.filter((f) => !f.gutterSeen);
  const blindTail =
    blindAfterSwap.length === 0 ? 0 : blindAfterSwap[blindAfterSwap.length - 1].t - t0;
  blindMs.push({ total: blindTotal, tail: blindTail });

  const late = [];
  for (const key of ALL) {
    const target = settled[key];
    // The first sample from which it HOLDS the settled value to the end. A
    // value that flickers back gets the last crossing, which is the honest
    // answer to "when could the reader stop noticing".
    let since = after.length - 1;
    while (since > 0 && after[since - 1][key] === target) since -= 1;
    const ms = after[since].t - t0;
    lateness.get(key).push(ms);
    if (ms > 0) late.push({ key, ms, from: after[0][key], to: target });
  }

  late.sort((a, b) => b.ms - a.ms);
  const span = after[after.length - 1].t - t0;
  /*
   * THE NUMBER THE READER IS ACTUALLY QUOTING.
   *
   * The DOM is correct at t0 and the canvas class comes off a frame or two
   * later — but neither of those is when the shading reaches the glass. That
   * happens at the first PAINT after the overlay stops covering the spread,
   * and a landing is the busiest moment in the app: two PageEditors mount, two
   * TipTap documents parse, the pagination drain runs, and `cache.resume()`
   * re-arms the neighbours by staging offscreen pages. Until that lets go, the
   * screen keeps showing the last frame the GL overlay drew — a picture with
   * the words in it and none of the carpentry around them.
   *
   * So: the gap that CONTAINS the swap (the frame the reader is stuck on),
   * and the delay from the swap to the first paint the shading is in.
   *
   * ANCHORED ON THE SHADING, NOT ON THE CANVAS. This used to look for the
   * first paint after the overlay came DOWN, which quietly assumed that taking
   * the overlay down is the only way the band can reach the reader. It is not —
   * lifting the band over the overlay reaches it a frame sooner and two frames
   * sooner than the hide — and an assumption baked into a metric answers the
   * old question forever. So: when did the band first BECOME visible, and which
   * paint carried it? If it is already visible on the swap sample then it rides
   * the same paint as the words, which is the whole of what "lands already
   * wearing its shadow" means, and the answer is 0.
   */
  const gapAround = (at) => {
    for (let i = 1; i < paints.length; i += 1) {
      if (paints[i - 1] <= at && paints[i] >= at) return paints[i] - paints[i - 1];
    }
    return 0;
  };
  const swapGap = gapAround(t0);
  const seenFrom = after.find((f) => f.gutterSeen)?.t ?? null;
  const dressedMs =
    seenFrom === null
      ? null
      : seenFrom <= t0
        ? 0
        : (paints.find((p) => p >= seenFrom) ?? seenFrom) - t0;
  const blockers = tasks
    .filter((k) => k.t >= t0 - 80 && k.t <= t0 + 900)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3);
  capturedTurns += 1;
  console.log(
    `  turn ${turn + 1} (${key}): ${frames.length} samples, DOM swap at sample ${swapAt + 1}, ` +
      `${after.length} samples (${span}ms) watched after it`,
  );
  console.log(
    `           paint gap containing the swap: ${swapGap}ms;  shading first reachable at ` +
      `+${dressedMs === null ? '?' : dressedMs}ms` +
      (dressedMs === 0 ? ' (the same paint as the words)' : ' (first paint carrying the band)'),
  );
  console.log(
    `           ` +
      (blockers.length
        ? `blocking the landing: ${blockers.map((k) => `${k.ms}ms@+${k.t - t0}`).join(', ')}`
        : 'no long tasks recorded around the landing'),
  );
  if (dressedMs !== null) dressed.push(dressedMs);
  const curlBlind = frames.filter((f) => !f.curlSeen);
  console.log(
    `           gutter buried under the GL overlay for ${blindTotal}ms across the turn ` +
      `(${blindTail}ms of that AFTER the swap, ${frames[0].gutterOverlapPx || after[0].gutterOverlapPx}px wide); ` +
      `dog-ear buried for ${curlBlind.length === 0 ? 0 : curlBlind[curlBlind.length - 1].t - curlBlind[0].t}ms; ` +
      `fore-edge hairlines hang ${-frames[0].edgeOverhangPx}px past the canvas`,
  );
  if (late.length === 0) {
    console.log('           DOM: everything already at its settled value on the swap sample');
  }
  for (const row of late.slice(0, 12)) {
    console.log(`           +${String(row.ms).padStart(4)}ms  ${row.key.padEnd(18)} ${row.from}  ->  ${row.to}`);
  }
}

console.log('\n3. worst lateness per property, across every turn (ms after the DOM swap)\n');
const summary = [...lateness.entries()]
  .map(([key, xs]) => ({ key, worst: xs.length ? Math.max(...xs) : -1, xs }))
  .filter((row) => row.worst > 0)
  .sort((a, b) => b.worst - a.worst);
if (summary.length === 0) {
  console.log('   nothing in the DOM was late. Every sampled property held its settled');
  console.log('   value from the sample the new leaf appeared in.');
}
for (const row of summary) {
  console.log(`   ${row.key.padEnd(20)} worst ${String(row.worst).padStart(4)}ms   all: ${row.xs.join(', ')}`);
}
if (blindMs.length > 0) {
  const worstTotal = Math.max(...blindMs.map((b) => b.total));
  const worstTail = Math.max(...blindMs.map((b) => b.tail));
  console.log(
    `\n   gutter buried under the GL overlay: worst ${worstTotal}ms per turn, ` +
      `${worstTail}ms of it after the DOM swap`,
  );
  console.log(`   per turn: ${blindMs.map((b) => `${b.total}/${b.tail}`).join(', ')}  (total/after-swap)`);
}
if (dressed.length > 0) {
  console.log(
    `\n   the shading first reaches the glass ${Math.min(...dressed)}–${Math.max(...dressed)}ms ` +
      `after the DOM swap (per turn: ${dressed.join(', ')})`,
  );
  if (dressed.every((ms) => ms === 0)) {
    console.log('   — i.e. in the same paint as the words, on every turn.');
  }
}

/*
 * 4. THE PICTURE PASS.
 *
 * Numbers say the band is buried; a picture says what buried looks like. Three
 * shots of the gutter strip and of the whole spread — at rest, as soon after
 * the keypress as the harness can manage (the overlay is up), and settled.
 * Screenshotting over a live WebGL canvas can fail outright under load
 * (`Unable to capture screenshot`), so every shot is guarded and a miss is
 * reported rather than thrown.
 */
console.log('\n4. pictures of the same three moments\n');
try {
  const box = await page.locator('.nb-spread').first().boundingBox();
  if (box === null) throw new Error('no .nb-spread box');
  const spread = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  // A band 130px either side of the crease: the gutter, its two facing page
  // edges, and nothing else to look at.
  const strip = {
    x: Math.round(box.x + box.width / 2 - 130),
    y: Math.round(box.y + box.height * 0.2),
    width: 260,
    height: Math.round(box.height * 0.6),
  };
  const shoot = async (name, clip) => {
    try {
      writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ clip }));
      return true;
    } catch (err) {
      console.log(`   (${name} could not be captured: ${String(err).split('\n')[0]})`);
      return false;
    }
  };
  await shoot('1-rest-spread', spread);
  await shoot('1-rest-gutter', strip);
  await installSampler();
  await page.evaluate(() => globalThis.__probeStart());
  /*
   * Turn in whichever direction still has somewhere to go, and shoot while the
   * overlay is genuinely up rather than after a fixed wait. A fixed 120ms
   * photographed a keypress that could not navigate at all on the first run —
   * the canvas was already down and the "mid-turn" picture was a resting
   * spread, which is the most convincing wrong answer available.
   */
  const dir = await page.evaluate(
    () => document.querySelector('.nb-flip-hotspot-next.is-disabled') === null,
  );
  await page.keyboard.press(dir ? 'ArrowRight' : 'ArrowLeft');
  await page.waitForFunction(
    () => document.querySelector('canvas.nb-flip-canvas.is-flipping') !== null,
    null,
    { timeout: 4000, polling: 'raf' },
  ).catch(() => console.log('   (the canvas never came up — no curl to photograph)'));
  await page.waitForTimeout(160);
  const midturn = await page.evaluate(() => {
    const t = globalThis.__trace ?? [];
    return t[t.length - 1] ?? null;
  });
  await shoot('2-midturn-spread', spread);
  await shoot('2-midturn-gutter', strip);
  await page.evaluate(() => {
    globalThis.__go = false;
  });
  await page.waitForTimeout(2600);
  await shoot('3-settled-spread', spread);
  await shoot('3-settled-gutter', strip);
  console.log(`   wrote ${OUT}/*.png`);
  if (midturn) {
    console.log(
      `   at the mid-turn shot: canvas ${midturn.canvasUp ? 'UP' : 'down'} (display ${midturn.canvasDisplay}, ` +
        `z ${midturn.canvasZ} over the gutter's z ${midturn.gutterZ}), ` +
        `gutter in the DOM: ${midturn.gutterThere}, gutter reaching the reader: ${midturn.gutterSeen}`,
    );
  }
} catch (err) {
  console.log(`   picture pass failed: ${String(err).split('\n')[0]}`);
}

/*
 * 5. THE GUTTER CANNOT BE IN A SNAPSHOT — measured, not reasoned.
 *
 * The reader named two things, the middle shadow and "the page colour". §2
 * settles the timing; this settles the STRUCTURE, which is what says whether a
 * preload could ever have helped.
 *
 * The overlay draws page textures, and a page texture is a capture of a
 * `.nb-sheet-paper`. The gutter band, its crease and the dog-ear are siblings
 * of the flip surface, not descendants of either sheet — so no snapshot of any
 * page, warmed however far in advance, can contain them. Warming more bitmaps
 * is therefore the one fix that provably cannot work, and that is worth
 * asserting on rather than arguing.
 *
 * (The obvious companion question — does the capture keep the ruling and the
 * paper tone? — could not be re-measured here: html-to-image rejects with a
 * bare `Event` on this page under headless SwiftShader, on the leaf and on the
 * prose alike, even with an image placeholder. It is left explicitly open
 * rather than guessed at, because a probe that reports an unrun capture as a
 * missing ruling is worse than a probe that reports nothing.)
 */
console.log('\n5. can a snapshot contain the shading at all?\n');
try {
  const containment = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('.nb-sheet-paper')];
    const named = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return `${sel}: absent`;
      const inside = sheets.some((s) => s.contains(el));
      return `${sel}: ${inside ? 'INSIDE a sheet (would be captured)' : 'outside every sheet — no capture can contain it'}`;
    };
    return {
      sheets: sheets.length,
      rows: ['.nb-spread-gutter', '.nb-page-curl'].map(named),
      // Where it sits instead, so the report names the real parent.
      gutterParent: document.querySelector('.nb-spread-gutter')?.parentElement?.className ?? 'none',
      surfaceParent: document.querySelector('.nb-flip-surface')?.parentElement?.className ?? 'none',
    };
  });
  console.log(`   ${containment.sheets} sheets in the DOM`);
  for (const row of containment.rows) console.log(`   ${row}`);
  console.log(
    `   the gutter's parent is "${containment.gutterParent}", the same element the flip surface ` +
      `hangs off ("${containment.surfaceParent}") — a sibling, never a child`,
  );
} catch (err) {
  console.log(`   containment check failed: ${String(err).split('\n')[0]}`);
}

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

/*
 * THE GUARD ITSELF. `capturedTurns === 0` means every turn above hit "no leaf
 * remounted" or "window too short" — the book likely never opened, probably
 * another agent's edit landing as an HMR reload mid-run (see the header). In
 * that state every count above (`lateness`, `blindMs`, `dressed`) is empty,
 * and section 2's "nothing in the DOM was late" and 3's "everything already
 * at its settled value" are both true of zero observations. Distinguishing
 * that from a real all-clear is the whole point of exiting non-zero here.
 */
if (capturedTurns === 0) {
  console.log(
    '\nVERDICT: NOTHING MEASURED — 0 of the attempted turns produced a DOM swap ' +
      'with enough samples after it. Every "nothing was late" line above is true ' +
      'of an empty dataset, not of the app. Re-run on a tree nothing else is ' +
      'editing.',
  );
  process.exitCode = 1;
} else {
  console.log(`\nVERDICT: measured ${capturedTurns} turn(s).`);
}
