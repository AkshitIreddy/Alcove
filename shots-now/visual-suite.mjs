/**
 * shots-now/visual-suite.mjs — the visual regression suite.
 *
 *     npm run visual              compare against qa/baseline/**
 *     npm run visual -- --update  re-baseline
 *
 * Those are the only two modes, and the split is the point: a comparison run
 * NEVER writes a baseline. A case with no committed picture fails and drops its
 * screenshot in the report folder to be looked at; `--update` is how a human
 * says yes to it. A suite allowed to accept its own output agrees with the app
 * by construction and is worth nothing.
 *
 * ## Three outcomes, not two
 *
 * A surface can also come back UNMEASURABLE. `settle()` waits for the screen to
 * stop and gives up after its deadline, reporting how many distinct frames it
 * saw. Those are marked `MOVE`, counted in their own column, and:
 *
 *  - `--update` will NOT write them down. A baseline captured from a moving
 *    surface is whichever moment the deadline fell on, so every later run
 *    compares against a coin toss.
 *  - a comparison run does NOT fail on them. There is nothing for a reviewer
 *    to act on except the instability itself, and a case that is red on every
 *    run forever teaches people to skim past the summary.
 *
 * That is deliberately not the same as passing them. The tally prints the count
 * on every run, so it can never read as full coverage while covering less.
 *
 * ### The six that used to move, and what they were doing
 *
 * Three surfaces — `tour-blocks`, `tour-settings` and `focus-spread` — reported
 * MOVE in six of their twelve cases, and WHICH six varied between runs. All
 * three are book-view surfaces, which was the clue: nothing on the shelf ever
 * did it. The note left behind at the time guessed "canvas or WebGL, because
 * `document.getAnimations()` is empty at rest". It was neither, and there were
 * two of them, both fixed elsewhere in the tree before this file was pointed at
 * them:
 *
 *  - `f00fc92` — EVERY offscreen page capture had been failing silently, so
 *    `rasterCache.capture()` fell through to its live path, which writes to the
 *    leaf the reader is looking at: `.snapshotting` (which hides the drag
 *    handle, the style switcher and the selection tint) plus inline paint on
 *    every SVG inside the page, held for the 200ms+ of the rasterise and then
 *    put back. A screenshot landing inside that window is a different picture
 *    from one landing outside it, and the window opens at idle — so it is
 *    intermittent, load-dependent, and invisible to `getAnimations()`. That is
 *    the whole shape of the symptom.
 *  - `53174e7` — the pagination drain published its removal to the store too
 *    late, so a carry re-materialised the block it had just moved, remounted
 *    the leaf synchronously, drained it again and queued another carry. A
 *    spread that rewrites and repaints itself cannot settle by definition.
 *
 * Confirmed rather than assumed, with a MutationObserver census over the whole
 * document while parked on each surface for twenty seconds: today the only
 * thing that changes is the offscreen staged sheet (`.nb-export-sheet`) and the
 * back chip receding once. `.snapshotting` never lands on a mounted leaf. All
 * three surfaces now settle in three frames and carry baselines.
 *
 * The lesson kept in code rather than in prose: a MOVE case now writes a
 * `.moving.png` (see `diagnoseMovement`), so the next one to appear arrives
 * with the answer attached instead of costing a day of driving the app by hand.
 *
 * ## Why this exists
 *
 * Every visual defect found in this tree was found by a human looking at a
 * screenshot. The 2449 unit tests did not catch 1.05:1 text on the first screen
 * a new reader sees, four tour steps that could not be satisfied, or the right
 * leaf of a spread hanging off the window. None of those are expressible as an
 * assertion about a function; all three are obvious in a picture.
 *
 * So: sixteen surfaces, each photographed at two window sizes in a light room
 * and a dark one, compared pixel by pixel against committed baselines —
 * sixty-four images. When one moves, a triptych is written showing baseline,
 * actual and the pixels that changed, and the run fails.
 *
 * ## What makes it worth trusting
 *
 * A flaky visual suite is ignored inside a week and is worse than none, so
 * every source of run-to-run variance is closed deliberately rather than
 * absorbed by a loose threshold:
 *
 *  - **The library is a fixture, not a seeding.** A real `createBook()` gives
 *    the book a `nanoid()` id and a `Math.random()` spine seed, and BOTH reach
 *    the art — `spineFactory.heightFraction` hashes `id|spineSeed`, so a
 *    freshly seeded shelf has a different skyline every run. This suite writes
 *    the browser-dev SQLite stub's blob (`notebook.stubdb.v1`) into
 *    localStorage before a line of app code runs, with fixed ids, fixed seeds,
 *    fixed cover metadata and fixed timestamps.
 *  - **The fixture is still built from the app's own code.** The welcome
 *    book's pages come from `buildWelcomePageDocs()` and each book's dressing
 *    from `freshBookStyleOverrides(seed)`, both called in-page on a throwaway
 *    boot. A change to the welcome content or to how a fresh book is dressed
 *    therefore shows up as a diff instead of being frozen out of the suite.
 *  - **`Math.random` is seeded** from an init script, for the handful of places
 *    the app still rolls (the studio dice, `randomSpineSeed`).
 *  - **Animation is off at the source**: the fixture sets `animationLevel:
 *    'off'`, which writes `--motion-scale: 0`, and every GSAP duration in this
 *    app is multiplied by it (`styles/motion.ts`). Playwright's
 *    `animations: 'disabled'` finishes CSS animations and transitions on top of
 *    that, and the caret is made transparent by an injected rule.
 *  - **Nothing is photographed until the screen stops moving.** `settle()`
 *    shoots until two consecutive frames have identical PIXELS, which means the
 *    compositor, the Pixi bake queue and every tween have finished. A far better
 *    guard than any fixed wait, because SwiftShader's frame budget varies with
 *    what else the machine is doing.
 *  - **Fonts are awaited**, both `document.fonts.ready` and an explicit
 *    `check()` for the five families the app renders in.
 *  - **Nothing is written to disk until every picture is taken.** The dev
 *    server watches the whole repo — `vite.config.ts` ignores only
 *    `src-tauri` — so a baseline PNG landing in `qa/baseline/` full-reloads
 *    the page being photographed. That is not a theory: the first version of
 *    this file wrote as it went, and the symptoms were a tour that vanished
 *    between two surfaces, a book that closed itself, and a screenshot that
 *    hung for forty-five seconds. And because other agents share the one dev
 *    server, a scene that sees ANY navigation after boot is thrown away and
 *    walked again rather than baselined.
 *
 * ### One thing deliberately NOT done
 *
 * `prefers-reduced-motion: reduce` is NOT emulated, even though it would be the
 * obvious way to still the app. `flip/PageFlipController.ts` reads that media
 * query directly and **skips the curl entirely** under it, crossfading instead
 * — so emulating it would silently replace the mid-curl surface with a picture
 * of a page at rest that still passed. The app-level `animationLevel: 'off'`
 * does the same job everywhere else without touching the flip.
 *
 * ## The comparison
 *
 * No image dependency is added: the repo has neither pixelmatch nor pngjs, and
 * a Chromium is already running. Both PNGs are decoded in an about:blank page
 * with `createImageBitmap` and compared in a canvas.
 *
 * A pixel counts as changed when its largest channel delta exceeds
 * `CHANNEL_TOL` **and** the colour cannot be found within one pixel in the
 * other image (and vice versa). That second clause is what makes the suite
 * ignore antialiasing and subpixel text rendering while still catching a moved
 * element: an edge that renders a shade differently has a neighbour that
 * matches, a label that moved four pixels does not.
 *
 * Two thresholds decide a failure, and both matter:
 *
 *  - `MAX_DIFF_RATIO` over the whole frame catches a wholesale repaint;
 *  - `CELL_FAIL` over a 16×16 grid catches a SMALL thing vanishing. A missing
 *    16px glyph is 0.02% of a 1280×800 frame and would slip under any global
 *    ratio worth having; it is ~30 changed pixels inside one cell, which is
 *    loud.
 *
 * ## Usage
 *
 *   node shots-now/visual-suite.mjs [--update] [--url=http://localhost:1420]
 *                                   [--only=<substring>[,<substring>…]]
 *                                   [--list] [--keep-passes] [--sabotage]
 *
 * `--only` matches the case name (`<size>-<room>-<surface>`) and selects what is
 * COMPARED, not what is walked: the scene still runs in order up TO the last
 * case you asked for, because half these surfaces are only reachable through
 * the ones before them. It stops there rather than walking out the rest of the
 * scene for nobody.
 *
 * It takes a COMMA-SEPARATED list, and that is not a convenience. The three
 * surfaces this suite could not measure (see `settle`) live at indices 8, 9 and
 * 10 of a sixteen-surface walk, so asking after all three at once costs one
 * walk to index 10 — while three separate `--only` runs would walk the whole
 * scene three times over to photograph one surface each. Anything that makes
 * chasing an unstable surface cheaper gets it chased.
 *
 * The full matrix takes 45–60 minutes on this machine — SwiftShader, four boots,
 * and a settle loop that waits for the screen rather than guessing. `--only=desk`
 * halves it, and a single early case (`--only=desk-day-shelf`) is under a minute
 * because the walk ends with it.
 *
 * Needs a dev server (`npm run dev`); it does not start one, because the tree's
 * other probes all share the one on :1420 and starting a second is how you end
 * up comparing against a build nobody else is looking at.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* ============================== the knobs ================================= */

/** Largest per-channel difference still counted as the same pixel. */
const CHANNEL_TOL = 20;

/** Fraction of the frame that may change before the case fails. */
const MAX_DIFF_RATIO = 0.0008;

/** Grid cell edge, px. Small enough that one glyph lands in one or two cells. */
const CELL = 16;

/**
 * Changed pixels inside a single cell that fail the case on their own.
 *
 * Measured, not guessed: with the whole matrix compared against baselines taken
 * by an earlier, separate run of the suite, the worst case was the shelf at 19
 * changed pixels with 8 in its busiest cell — everything else was exactly zero.
 * Twenty leaves that 2.5× of headroom and still fires on a missing 16px glyph,
 * which is about thirty pixels in one or two cells. If the summary's "noisiest
 * passing case" line starts creeping towards this number, come back here before
 * somebody starts ignoring the suite.
 */
const CELL_FAIL = 20;

/** How long a surface may take to stop moving before we shoot it anyway. */
const SETTLE_BUDGET_MS = 30_000;

const BASELINE_DIR = 'qa/baseline';
const REPORT_DIR = join(BASELINE_DIR, '__report');

/* =============================== the matrix =============================== */

/**
 * Two windows, both real.
 *
 * `desk` is exactly what `src-tauri/tauri.conf.json` opens on, so it is the
 * shape almost every reader sees. `snug` is a hair above the configured
 * minimum (960×620) — the size at which a two-page spread stops fitting, which
 * is precisely the class of defect ("the right-hand page hangs off the
 * window") that shipped.
 */
const SIZES = [
  { id: 'desk', width: 1280, height: 800 },
  { id: 'snug', width: 1024, height: 660 },
];

/**
 * A light room and a dark one, and each is BOTH halves of the app's colour.
 *
 * The app has two independent palettes and photographing only one would miss
 * half the surfaces: `settings.theme` dresses the DOM (pages, rails, sheets,
 * dialogs — `data-theme` on <html>), while the library theme dresses the Pixi
 * world (timber, recess, wall). `night` + `ebonised` is the darkest honest
 * pairing in the app; `parchment` + `lapis` is what a new install opens on.
 */
const ROOMS = [
  { id: 'day', appTheme: 'parchment', libraryTheme: 'lapis' },
  { id: 'night', appTheme: 'night', libraryTheme: 'ebonised' },
];

/* ============================== the fixture =============================== */

/** Fixed ids. Nothing in the fixture may come from `nanoid()` or `Math.random`. */
const WELCOME_BOOK_ID = 'vs-book-welcome';
const CASE_ID = 'case-default';
const FIXED_TIME = '2026-01-02T09:15:00.000Z';

/**
 * The shelf, written out.
 *
 * Eleven books over three floors: enough that the case reads as a library
 * rather than a demo, few enough that every spine is legible at `snug`. The
 * titles span short and long because the label plate's text fitting is one of
 * the things a picture is good at catching. Seeds are arbitrary but FIXED —
 * they choose the binding, the cloth and the height, so changing one is
 * changing the picture.
 */
const SHELF_BOOKS = [
  { title: 'Cell Biology', floor: 0, slot: 0, seed: 0x1a2b3c4d },
  { title: 'Kanji Practice', floor: 0, slot: 1, seed: 0x2b3c4d5e },
  { title: 'Watercolour Basics', floor: 0, slot: 2, seed: 0x3c4d5e6f },
  { title: 'Tea Tasting Journal', floor: 0, slot: 4, seed: 0x4d5e6f70 },
  { title: 'Linear Algebra', floor: 1, slot: 0, seed: 0x5e6f7081 },
  { title: 'SQL Spellbook', floor: 1, slot: 1, seed: 0x6f708192 },
  { title: 'A Very Long Title About Bees', floor: 1, slot: 2, seed: 0x708192a3 },
  { title: 'Rope', floor: 1, slot: 3, seed: 0x8192a3b4 },
  { title: 'Sourdough', floor: 2, slot: 0, seed: 0x92a3b4c5 },
  { title: 'Field Notes', floor: 2, slot: 1, seed: 0xa3b4c5d6 },
  { title: 'Harbour Sketches', floor: 2, slot: 2, seed: 0xb4c5d6e7 },
];

/* ================================= CLI =================================== */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const URL_BASE = opt('url', 'http://localhost:1420');
const UPDATE = flag('update');
/** null = every case; otherwise the substrings a case name may match any of. */
const ONLY = (() => {
  const raw = opt('only', null);
  if (raw === null) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  return parts.length === 0 ? null : parts;
})();
const LIST = flag('list');
const KEEP_PASSES = flag('keep-passes');
/**
 * Break the screen on purpose, to check that "still moving" can still be said.
 *
 * A gate nobody has watched fail is not a gate. The third outcome is the
 * quietest thing this file does — a MOVE case does not fail the run — so a
 * `settle()` that started returning `settled: true` unconditionally would take
 * six surfaces out of coverage and the summary would get GREENER. That is the
 * worst possible failure mode for a suite, and the only defence is a switch
 * that makes a surface genuinely never stop and then checks the suite says so.
 *
 * `--sabotage` paints a 160×120 patch at (40, 200) that changes colour every
 * 200ms, in a Portal above everything, and expects every wanted case to come
 * back MOVE with a moving box over that patch. It prints GATE ALIVE or GATE
 * INERT and exits non-zero on INERT. Pair it with a cheap case:
 *
 *   node shots-now/visual-suite.mjs --sabotage --only=desk-day-shelf
 */
const SABOTAGE = flag('sabotage');
/** Where the sabotage patch sits, in CSS pixels. Checked against the mask. */
const SABOTAGE_RECT = { x: 40, y: 200, w: 160, h: 120 };

/* ============================ tiny utilities ============================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

/** ANSI-free status glyphs — this output gets pasted into issues. */
const MARK = {
  pass: 'ok  ',
  fail: 'FAIL',
  add: 'new ',
  upd: 'upd ',
  err: 'ERR ',
  // Photographed, but the screen never stopped moving, so the picture is of
  // a moment rather than of the app. Never written down as a baseline.
  skip: 'MOVE',
};

/* ========================== the surfaces to shoot ========================= */

/**
 * A surface is a name, the scene it lives in, and how to get there.
 *
 * `enter` leaves the app showing the thing; `leave` puts the app back somewhere
 * the next surface can start from. Both are given the page and a small context
 * (`ctx.size`, `ctx.room`, `ctx.geom`). A surface that throws is recorded as an
 * error for that one case and the walk carries on — one broken panel must not
 * cost the other sixteen pictures.
 */

/**
 * Order matters and is not alphabetical.
 *
 * One boot per (size, room) — a scene walk, not seventeen page loads — because
 * booting this app under SwiftShader costs about eight seconds and doing it
 * sixty-four times would put the suite past the point anyone runs it. The two
 * first-run surfaces come LAST because reaching them means emptying the case,
 * which cannot be undone within the session.
 */
const SURFACES = [
  {
    id: 'shelf',
    /** Eleven books, three floors, the dock, the zoom pill, the gear. */
    async enter(page) {
      await page.waitForFunction(
        () => (globalThis.__shelfVisibleBooks?.() ?? []).length >= 8,
        null,
        { timeout: 45_000 },
      );
    },
  },
  {
    id: 'tour-shelf-dock',
    async enter(page) {
      await startTour(page);
      await jumpTour(page, 'shelf-dock');
    },
  },
  {
    id: 'tour-shelf-studio',
    async enter(page) {
      await jumpTour(page, 'shelf-studio');
    },
    async leave(page) {
      await stopTour(page);
    },
  },
  {
    id: 'studio-library',
    /** The shelf studio: presets, carpentry, wallpaper, the reader's own rows. */
    async enter(page) {
      await tap(page, '.shelf-dock__btn[data-shelf-dock="studio"]');
      await page.waitForSelector('.nb-library-studio', { timeout: 30_000 });
      // The sheet lands scrolled to the top; make sure of it, because a panel
      // remembering a scroll offset from a previous surface would be the one
      // difference between two otherwise identical runs.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.nb-rail-panel, .nb-library-studio')) {
          el.scrollTop = 0;
          for (const inner of el.querySelectorAll('*')) inner.scrollTop = 0;
        }
      });
    },
  },
  {
    id: 'packs-dialog',
    /**
     * "Add your own" — the whole import story in one card: the file button, the
     * paste box, the copyable prompt and the honest list of what a pack cannot
     * carry yet.
     */
    async enter(page) {
      const yours = page.locator('[data-your-designs="wallpaper"]');
      await yours.waitFor({ timeout: 30_000 });
      await yours.scrollIntoViewIfNeeded();
      await yours.getByRole('button', { name: /add your own/i }).click();
      await page.waitForSelector('[data-nb-pack-dialog] [role="dialog"]', {
        timeout: 30_000,
      });
    },
    async leave(page) {
      await tidy(page);
    },
  },
  {
    id: 'book-spread',
    /** A book open on its first spread, both leaves, the rail down the left. */
    async enter(page, ctx) {
      await openBook(page);
      ctx.geom = await spreadGeometry(page);
    },
  },
  {
    id: 'studio-book',
    /** Customize this book — the binding pickers, previewing live. */
    async enter(page) {
      await tap(page, '.nb-rail-button[data-tool="customize"]');
      await page.waitForSelector('.nb-rail-panel[aria-hidden="false"]', { timeout: 30_000 });
    },
    async leave(page) {
      await tidy(page);
    },
  },
  {
    id: 'catalogue',
    /** The catalogue panel — stickers, papers, everything droppable. */
    async enter(page) {
      await tap(page, '.nb-rail-button[data-tool="catalogue"]');
      await page.waitForSelector('.nb-rail-panel[aria-hidden="false"]', { timeout: 30_000 });
    },
    async leave(page) {
      await tidy(page);
    },
  },
  {
    id: 'tour-blocks',
    /**
     * The step whose spotlight has to be the whole editable column — it was
     * once a hole barely bigger than one block, which gave the reader a
     * not-allowed cursor while following the tour. A picture shows that.
     */
    async enter(page) {
      await startTour(page);
      await jumpTour(page, 'blocks');
    },
  },
  {
    id: 'tour-settings',
    async enter(page) {
      await jumpTour(page, 'settings');
    },
    async leave(page) {
      await stopTour(page);
      await tidy(page);
    },
  },
  {
    id: 'focus-spread',
    /** Focus mode, top rung: the book, and the dial that walks the ladder. */
    async enter(page) {
      await tap(page, '.nb-rail-button[data-tool="focus"]');
      await page.waitForSelector('.nb-focus-dial', { timeout: 30_000 });
      await page.waitForFunction(
        () => document.querySelector('.nb-book-view')?.dataset.focusLevel === 'spread',
        null,
        { timeout: 30_000 },
      );
    },
  },
  {
    id: 'focus-page',
    /** Second rung: the boards come off. */
    async enter(page) {
      await focusRung(page, 'page');
    },
  },
  {
    id: 'focus-leaf',
    /** Third rung: one leaf, alone. */
    async enter(page) {
      await focusRung(page, 'leaf');
    },
    async leave(page) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => document.querySelector('.nb-book-view')?.dataset.focusLevel === 'off',
        null,
        { timeout: 20_000 },
      );
    },
  },
  {
    id: 'page-curl',
    /**
     * The turn, frozen a third of the way over.
     *
     * Not a tween caught mid-flight — a pointer drag IS the flip's `p`
     * (`flip/math.ts::dragToP`), so pressing the edge hotspot and holding the
     * pointer at a computed x parks the curl at an exact p with nothing
     * running. That is what makes a moving thing photographable at all.
     */
    async enter(page, ctx) {
      const geom = ctx.geom ?? (await spreadGeometry(page));
      const leaf = geom.right;
      const y = leaf.y + leaf.h * 0.5;
      const startX = leaf.x + leaf.w - 12;
      const targetX = leaf.x + leaf.w * (1 - 2 * 0.35);
      await page.mouse.move(startX, y);
      await page.mouse.down();
      await frames(page, 2);
      await page.mouse.move(targetX, y, { steps: 12 });
      await frames(page, 3);

      /**
       * Did the paper actually lift? Ask, and refuse the picture if it did not.
       *
       * This is the one surface in the suite whose subject is a thing that is
       * only there WHILE the pointer is down, so it is also the one that can
       * photograph a perfectly plausible substitute — a spread at rest — and
       * be believed. It did, for a while: the check here read
       * `.nb-flip-surface`'s `data-flip-phase`, an attribute no line of this
       * app has ever set (`grep -rn data-flip-phase src/` is empty), and put
       * the answer in a variable nothing read. So the reported "phase" was
       * always "no flip phase attribute" and nothing looked at it — a surface
       * that could not fail, which is the same as a surface that is not tested.
       *
       * `is-flip-gesture` is the honest signal: `PageFlipController.begin()`
       * puts it on the root on BOTH paths (WebGL curl and the rigid CSS fold
       * fallback), and `end()` takes it off. `is-flipping` on the canvas is the
       * WebGL half only — worth reporting, because a run that quietly fell back
       * to the fold is photographing a different thing, but not worth failing
       * on, since the fold is a legitimate rendering of this surface.
       */
      const curl = await page.evaluate(() => ({
        gesture: document.querySelector('.nb-flip-surface')?.classList.contains('is-flip-gesture') ?? false,
        webgl: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping') ?? false,
      }));
      if (!curl.gesture) {
        throw new Error('the drag never started a flip — this would photograph a spread at rest');
      }
      ctx.note = curl.webgl ? 'webgl curl' : 'rigid CSS fold (no WebGL curl)';
    },
    async leave(page) {
      await page.mouse.up();
      await sleep(600);
      await backToShelf(page);
    },
  },

  /* --------------------------- and then, nothing -------------------------- */

  {
    id: 'first-run-invite',
    /**
     * THE screen a new reader lands on with nothing in the library: a bare case
     * and one card asking for the first book. This is the frame that carried
     * 1.05:1 text, and no unit test in the tree could have said so.
     *
     * It has to be reached by EMPTYING a stocked case rather than by booting an
     * empty one, and that is not a shortcut. `features/bookshelf/data.ts` fills
     * an empty default case with a 37-book demo library whenever the SQLite
     * layer is the browser stub — which is every run of this suite — so a
     * fixture with no books photographs the demo shelf, not the invitation.
     * `demoFallbackFor` is deliberately sticky: a re-read never INVENTS the
     * demo books, so deleting the fixture's own books lands on the real screen.
     */
    async enter(page) {
      // Idempotent, and here rather than only in the previous surface's
      // `leave` so that a book-side surface falling over cannot cost this one
      // its picture too.
      await backToShelf(page);
      await page.evaluate(() => globalThis.__shelfEmptyLibrary());
      await page.waitForSelector('[data-testid="shelf-firstrun"]', { timeout: 45_000 });
    },
  },
  {
    id: 'first-run-greeting',
    /**
     * The same screen a beat later: the tour's greeting over the empty case.
     *
     * The length is deliberately NOT chosen here — this is the question as a
     * reader meets it, with neither card picked and nothing ticked.
     */
    async enter(page) {
      await startTour(page, null);
      await jumpTour(page, 'welcome');
    },
    async leave(page) {
      await stopTour(page);
    },
  },
];

/* ============================ app driving bits ============================ */

/** Click the middle of an element by measuring it, not by Playwright's retry.
 *
 * Several of these controls re-render the moment they are pressed (a rail
 * toggle, the first-run invite), and actionability retries then restart against
 * a node that no longer matches — a 30s timeout on a click that worked.
 *
 * ## But measuring a box is not the same as being able to press it
 *
 * Measuring alone cost `focus-spread` its picture: the surface before it leaves
 * the tour and calls `tidy()`, the settings sheet it opened is still sliding
 * out, and a rail button perfectly visible UNDER that sheet has a box like any
 * other. The click went into the sheet, the focus dial never appeared, and the
 * case was recorded as an error — one of the six surfaces this suite cannot
 * measure, lost to a timing race rather than to anything about the app.
 *
 * So the point is hit-tested before it is clicked: `elementFromPoint` has to
 * come back with the target or something inside it, and if it does not we wait
 * and look again. After the last attempt the click is sent ANYWAY rather than
 * thrown, because this helper's failure mode must stay "the next wait times
 * out and says what it was waiting for" — a throw here would replace a specific
 * complaint with a generic one.
 */
async function tap(page, selector) {
  await page.waitForSelector(selector, { state: 'visible', timeout: 30_000 });
  let box = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    box = await page.locator(selector).first().boundingBox();
    if (box === null) throw new Error(`no box for ${selector}`);
    const clear = await page.evaluate(
      ({ x, y, sel }) => {
        const hit = document.elementFromPoint(x, y);
        const want = document.querySelector(sel);
        return hit !== null && want !== null && (want === hit || want.contains(hit));
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2, sel: selector },
    );
    if (clear) break;
    await sleep(400);
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(250);
}

async function frames(page, n = 2) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const step = () => (left-- > 0 ? requestAnimationFrame(step) : resolve(true));
        step();
      }),
    n,
  );
}

/**
 * Put the tour on screen.
 *
 * `length` of `null` leaves the greeting's question unanswered, which is how a
 * reader first meets it; 'full' answers it, which is the only way to reach the
 * later steps by index.
 */
async function startTour(page, length = 'full') {
  await page.waitForFunction(() => typeof window.__nbTutorial?.start === 'function', null, {
    timeout: 45_000,
  });
  await page.evaluate((len) => {
    window.__nbTutorial.start();
    if (len !== null) window.__nbTutorial.chooseLength(len);
  }, length);
  await sleep(400);
}

async function stopTour(page) {
  await page.evaluate(() => window.__nbTutorial?.stop());
  await sleep(400);
}

/**
 * Land the tour on a named step and freeze it there.
 *
 * `hold()` cancels the auto-advance so the card cannot walk on while the
 * screen is settling, and the anchor is awaited rather than assumed: a step
 * that cannot find its target draws no spotlight, which is a real finding and
 * should fail loudly rather than quietly photograph a bare card.
 */
async function jumpTour(page, stepId) {
  const index = await page.evaluate((id) => {
    const s = window.__nbTutorial.getState();
    return s.stepIds.indexOf(id);
  }, stepId);
  if (index < 0) throw new Error(`the tour has no step "${stepId}"`);
  await page.evaluate((i) => {
    window.__nbTutorial.jumpTo(i);
    window.__nbTutorial.hold();
  }, index);
  await page.waitForFunction(
    (id) => window.__nbTutorial.getState().stepId === id,
    stepId,
    { timeout: 20_000 },
  );
  // The greeting is the one step with nothing to point at.
  if (stepId !== 'welcome') {
    await page.waitForFunction(() => window.__nbTutorial.getState().anchored === true, null, {
      timeout: 20_000,
    });
  }
  await page.evaluate(() => window.__nbTutorial.hold());
}

/** Close every panel, sheet and menu, whatever is up. */
async function tidy(page) {
  await page.evaluate(() => {
    for (const sel of [
      '.nb-pack-card .nb-ins-close',
      '.nb-rail-panel[aria-hidden="false"] .nb-rail-panel-close',
      '.nbs-sheet .nbs-close',
    ]) {
      for (const el of document.querySelectorAll(sel)) el.click();
    }
  });
  await sleep(300);
  await page.keyboard.press('Escape');
  await sleep(400);
}

/** Take the welcome book off the shelf and open it, the way a reader does. */
async function openBook(page) {
  await page.evaluate((id) => globalThis.__shelfPullOut(id), WELCOME_BOOK_ID);
  await page.waitForSelector('.pulled-book', { state: 'visible', timeout: 30_000 });
  await sleep(500);
  await tap(page, '.pulled-book');
  await page.waitForSelector('.nb-flip-surface', { timeout: 45_000 });
  await page.waitForSelector('.nb-prose', { timeout: 45_000 });
  await sleep(800);
}

/**
 * Close the book.
 *
 * The chip is clicked through the DOM rather than with the mouse because it
 * lives in the corner behind `is-away` — it fades out when the reader has not
 * asked for it, and a real click would first have to wake it with a keystroke
 * whose reveal animation is one more thing to wait on.
 */
async function backToShelf(page) {
  const inBook = await page.evaluate(
    () => document.querySelector('.nb-back-button') !== null,
  );
  if (!inBook) return;
  await page.evaluate(() => document.querySelector('.nb-back-button').click());
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 45_000,
  });
  await page.waitForSelector('.shelf-dock__btn', { timeout: 45_000 });
  await sleep(900);
}

async function spreadGeometry(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { surface: box('.nb-flip-surface'), right: box('.nb-flip-leaf-right') };
  });
}

/** Walk the focus ladder with the same key the plate advertises. */
async function focusRung(page, level) {
  for (let i = 0; i < 4; i += 1) {
    const at = await page.evaluate(
      () => document.querySelector('.nb-book-view')?.dataset.focusLevel ?? null,
    );
    if (at === level) return;
    await page.keyboard.press(']');
    await sleep(400);
  }
  throw new Error(`focus mode would not reach the "${level}" rung`);
}

/* ============================ the fixture kit ============================= */

/**
 * One throwaway boot, to borrow two pure functions from the app.
 *
 * Hand-writing the welcome pages here would freeze them: the suite would keep
 * passing while the content it is supposed to be watching changed underneath.
 * Both of these are pure (`buildWelcomePageDocs` parses Notebook Script;
 * `freshBookStyleOverrides` is a seeded roll), so the usual "a probe's own
 * import can land on a second copy of the module" trap does not apply — there
 * is no store to write to.
 */
async function buildFixtureKit(browser) {
  // Three goes, because this boot is the one most likely to be interrupted:
  // it happens seconds after the suite has finished tidying its report folder,
  // and the dev server treats that as a reason to reload every open page.
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await buildFixtureKitOnce(browser);
    } catch (error) {
      last = error;
      if (!/Execution context was destroyed|Target closed|navigation/i.test(String(error))) {
        throw error;
      }
      console.log('  (the page navigated under the fixture build — trying again)');
      await sleep(1500);
    }
  }
  throw last;
}

async function buildFixtureKitOnce(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  try {
    await page.goto(`${URL_BASE}/?fx=force&dev=0`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });
    const seeds = SHELF_BOOKS.map((b) => b.seed);
    return await page.evaluate(async (bookSeeds) => {
      const seed = await import('/src/data/seed.ts');
      const style = await import('/src/art/bookStyle.ts');
      const count = seed.WELCOME_PAGE_SOURCES.length;
      const pageIds = Array.from(
        { length: count },
        (_, i) => `vs-page-welcome-${String(i + 1).padStart(2, '0')}`,
      );
      const built = seed.buildWelcomePageDocs({ bookId: 'vs-book-welcome', pageIds });
      return {
        seedVersion: seed.SEED_VERSION,
        seedVersionKey: seed.SEED_VERSION_KEY,
        welcomeTitle: seed.WELCOME_BOOK_TITLE,
        welcomeSpineSeed: seed.WELCOME_SPINE_SEED,
        welcomeBinding: seed.WELCOME_BINDING,
        welcomePageIds: pageIds,
        welcomePages: built.map((b) => ({ doc: b.doc, source: b.source })),
        dressings: bookSeeds.map((s) => style.freshBookStyleOverrides(s)),
      };
    }, seeds);
  } finally {
    await page.close();
  }
}

/**
 * The whole library, as the browser-dev SQLite stub stores it.
 *
 * Everything a screen can vary on is pinned here: ids, spine seeds, cover
 * metadata, timestamps, which room the case is dressed in, which app theme is
 * on, and the two markers that stop the tour and the taste questions putting
 * themselves on screen uninvited.
 */
function buildStubBlob(kit, room) {
  const libraryPrefs = {
    theme: room.libraryTheme,
    shelf: null,
    wall: null,
    timberHex: null,
    wallHex: null,
  };

  const books = [];
  const pages = [];

  {
    books.push({
      id: WELCOME_BOOK_ID,
      bookcase_id: CASE_ID,
      title: kit.welcomeTitle,
      floor: 0,
      slot: 3,
      spine_seed: kit.welcomeSpineSeed,
      cover_meta: JSON.stringify({ style: { ...kit.welcomeBinding } }),
      created_at: FIXED_TIME,
      updated_at: FIXED_TIME,
    });
    kit.welcomePages.forEach((p, i) => {
      pages.push({
        id: kit.welcomePageIds[i],
        book_id: WELCOME_BOOK_ID,
        ord: i,
        doc_json: JSON.stringify(p.doc),
        script_source: p.source,
        source_dirty: 0,
        updated_at: FIXED_TIME,
      });
    });
    SHELF_BOOKS.forEach((b, i) => {
      books.push({
        id: `vs-book-${String(i + 1).padStart(2, '0')}`,
        bookcase_id: CASE_ID,
        title: b.title,
        floor: b.floor,
        slot: b.slot,
        spine_seed: b.seed,
        cover_meta: JSON.stringify({ style: kit.dressings[i] }),
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
      });
      // One page each, so a book opened by accident is not blank and the
      // quick switcher has something to index.
      pages.push({
        id: `vs-page-${String(i + 1).padStart(2, '0')}`,
        book_id: `vs-book-${String(i + 1).padStart(2, '0')}`,
        ord: 0,
        doc_json: JSON.stringify({
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: b.title }] },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'A page, so the book is not empty.' }],
            },
          ],
        }),
        script_source: null,
        source_dirty: 0,
        updated_at: FIXED_TIME,
      });
    });
  }

  const settings = {
    // Animation off at the source: this is what writes `--motion-scale: 0`,
    // and every GSAP duration in the app is multiplied by it.
    animationLevel: 'off',
    theme: room.appTheme,
    // Silence, and no ambient bed trying to start on the first click.
    muteAll: true,
    ambientLoop: false,
    typingSounds: false,
    hourlyChime: false,
    // Off because it is a floating strip whose contents depend on how many
    // pages have been rasterised yet — a race, photographed.
    thumbnailsStrip: false,
    perfHud: false,
    confettiOnComplete: false,
    backupEnabled: false,
  };

  return {
    bookcases: [
      {
        id: CASE_ID,
        name: 'My Library',
        ord: 0,
        room: JSON.stringify(libraryPrefs),
        floors: 10,
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
      },
    ],
    books,
    pages,
    settings: [
      { key: 'app', value: JSON.stringify(settings) },
      { key: 'activeBookcase', value: CASE_ID },
      // Stop `seedIfEmpty` inventing a welcome book with a random id.
      { key: kit.seedVersionKey, value: String(kit.seedVersion) },
      // The tour and the taste questionnaire both put THEMSELVES on screen on
      // a fresh install. Marked seen, so a surface that wants them says so.
      { key: 'appState:tutorialCompleted', value: '1' },
      { key: 'appState:taste', value: JSON.stringify({ answers: {}, done: true }) },
    ],
  };
}

/* ============================== the capture =============================== */

/**
 * Everything that has to be true before app code runs.
 *
 * Order matters: the stub DB is read by `MemoryDb`'s constructor, which the
 * first `getDb()` triggers during boot, so the blob has to be in localStorage
 * before the module graph evaluates — an init script is the only place that is
 * guaranteed.
 */
async function installFixture(page, blob) {
  await page.addInitScript(
    ({ stub }) => {
      try {
        localStorage.clear();
        localStorage.setItem('notebook.stubdb.v1', JSON.stringify(stub));
      } catch {
        /* denied storage: the run will fail loudly at the first surface */
      }

      // A seeded PRNG for the few places the app still rolls: `randomSpineSeed`
      // and the studio dice. Fixed stream, so a run is a run.
      let s = 0x9e3779b9;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    { stub: blob },
  );
}

/** The stylesheet the suite adds, and the only one. */
const STILL_CSS = `
  /* A blinking caret is the one thing on the page that is never the same
     twice. Playwright's animations:'disabled' does not touch it. */
  * { caret-color: transparent !important; }
  /* Overlay scrollbars render on a timer after a scroll and fade out again. */
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
`;

/**
 * The deliberate defect: a patch that will not hold still.
 *
 * `setInterval` and an inline background colour, on purpose. It is not a CSS
 * animation and not a transition, because Playwright's `animations: 'disabled'`
 * would freeze either of those at screenshot time and the sabotage would be
 * inert — which is exactly the trap this switch exists to catch elsewhere. A
 * timer writing a style attribute is the same shape as the real instabilities
 * this suite has met, and nothing in the capture path can flatten it.
 */
async function installSabotage(page) {
  await page.evaluate((rect) => {
    const patch = document.createElement('div');
    patch.id = 'nb-visual-suite-sabotage';
    patch.style.cssText =
      `position:fixed;left:${rect.x}px;top:${rect.y}px;` +
      `width:${rect.w}px;height:${rect.h}px;z-index:2147483647;pointer-events:none;`;
    document.body.appendChild(patch);
    let n = 0;
    setInterval(() => {
      n += 1;
      patch.style.background = n % 2 === 0 ? '#ff1f9c' : '#1f9cff';
    }, 200);
  }, SABOTAGE_RECT);
}

/** Does any box the mask found overlap the patch we broke on purpose? */
function sabotageWasSeen(moving) {
  if (moving === null || moving === undefined) return false;
  const r = SABOTAGE_RECT;
  return moving.boxes.some(
    (b) =>
      b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y,
  );
}

async function bootScene(context, blob, size) {
  const page = await context.newPage();
  await installFixture(page, blob);
  page.setDefaultTimeout(45_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000,
  });
  await page.addStyleTag({ content: STILL_CSS });
  if (SABOTAGE) await installSabotage(page);
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 120_000,
  });
  await page.evaluate(() => {
    globalThis.__vsReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__vsReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__vsReady === true, null, { timeout: 120_000 });
  await awaitFonts(page);
  // Park the pointer somewhere with nothing under it, so no surface is
  // photographed wearing a hover state it did not ask for.
  await page.mouse.move(size.width - 2, 2);
  return { page, errors };
}

/**
 * Fonts, properly.
 *
 * `document.fonts.ready` alone resolves before a face that nothing has asked
 * for yet has loaded — and this app swaps fonts per surface (Caveat for
 * headings, Architects Daughter only inside a diagram). Asking `check()` for
 * each family forces the load and then waits for it.
 */
async function awaitFonts(page) {
  await page.evaluate(async () => {
    const families = [
      'Caveat Variable',
      'Patrick Hand',
      'Kalam',
      'Architects Daughter',
      'Nunito Sans',
    ];
    for (const f of families) {
      try {
        await document.fonts.load(`16px "${f}"`);
      } catch {
        /* a family the build no longer bundles is not this suite's business */
      }
    }
    await document.fonts.ready;
  });
}

/**
 * Shoot when — and only when — the screen has stopped moving.
 *
 * Two screenshots with a gap between them; the same PIXELS twice running mean
 * nothing is tweening, no bake is outstanding and the compositor has caught up.
 * A fixed wait would not do: this runs on SwiftShader, where the frame budget
 * depends on what else the machine is doing.
 *
 * PIXELS, and not bytes — that distinction cost an afternoon. Chromium's PNG
 * encoder is NOT byte-stable: three screenshots of a provably identical screen
 * came back 184661, 184633 and 184613 bytes long (the filter/deflate choices
 * vary), so `Buffer.equals` reported the book studio as animating forever while
 * a pixel diff of the same pair reported zero differing pixels. The signature
 * below is taken over the decoded image, in the comparator page.
 *
 * ## The last few frames are kept, and that is the whole diagnosis
 *
 * When this gives up it used to hand back one picture and a count, which says
 * a surface moved and nothing about WHAT moved — and "find what is moving" was
 * then a day of driving the app by hand, guessing at candidates. So the tail is
 * retained: `MOVE_TAIL` frames, diffed against each other by `diagnoseMovement`
 * the moment the walk notices, while the browser is still alive and the page is
 * still standing on the surface. The mask that comes back names the pixels that
 * would not hold still, and the DOM under them.
 *
 * The tail and not every frame, because a surface that burns the full budget
 * shoots ninety times and ninety decoded 1280×800 frames is 360MB of ImageData
 * in the comparator page — which falls over, and an out-of-memory comparator
 * turns a diagnosable MOVE into an unexplained error.
 */
const MOVE_TAIL = 8;

async function settle(page, cmp) {
  const shoot = () =>
    page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      timeout: 60_000,
    });
  const tail = [];
  const keep = (b) => {
    tail.push(b);
    if (tail.length > MOVE_TAIL) tail.shift();
  };
  let buffer = await shoot();
  keep(buffer);
  let previous = await pixelSignature(cmp, buffer);
  const seen = new Set([previous]);
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  let stillFor = 0;
  let shots = 1;
  for (;;) {
    await sleep(320);
    buffer = await shoot();
    keep(buffer);
    shots += 1;
    const next = await pixelSignature(cmp, buffer);
    seen.add(next);
    if (next === previous) {
      stillFor += 1;
      // Twice in a row: one match can be two frames inside the same stall.
      if (stillFor >= 2) return { buffer, settled: true, shots, distinct: seen.size, tail: [] };
    } else {
      stillFor = 0;
    }
    previous = next;
    if (Date.now() > deadline) {
      return { buffer, settled: false, shots, distinct: seen.size, tail };
    }
  }
}

/* --------------------- what would not hold still, and where ---------------- */

/**
 * Union the changes across the tail, then ask the page what is under them.
 *
 * Two halves, and both are needed. The mask is the honest half — it is made of
 * photographs and cannot be argued with, and it answers "where" precisely
 * enough to point at one control. The DOM report is the lead: `getAnimations()`
 * for anything the engine is driving, the GSAP global timeline for anything the
 * app is driving, and an `elementsFromPoint` down the middle of each moving box
 * so the answer arrives as a selector rather than as a coordinate.
 *
 * The DOM half is asked LAST and separately on purpose: it is the half that can
 * lie (a tween that finished a frame ago leaves nothing behind), and the mask
 * stays true whatever it says.
 */
const MOVE_MASK_IN_PAGE = async ([b64s, cell]) => {
  const decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const out = { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
    bmp.close();
    return out;
  };

  const frames = [];
  for (const b of b64s) frames.push(await decode(b));
  const { w, h } = frames[0];
  const mask = new Uint8Array(w * h);
  const perPair = [];
  for (let f = 1; f < frames.length; f += 1) {
    const a = frames[f - 1].data;
    const b = frames[f].data;
    let n = 0;
    for (let p = 0; p < w * h; p += 1) {
      const i = p * 4;
      const d = Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      );
      if (d > 20) {
        mask[p] = 1;
        n += 1;
      }
    }
    perPair.push(n);
  }

  // Cluster at cell resolution so the answer is a handful of boxes rather than
  // a scatter of pixels — a box can be pointed at, a scatter cannot.
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const cells = new Int32Array(cols * rows);
  let moved = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (mask[y * w + x] === 0) continue;
      moved += 1;
      cells[Math.floor(y / cell) * cols + Math.floor(x / cell)] += 1;
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes = [];
  for (let r0 = 0; r0 < rows; r0 += 1) {
    for (let c0 = 0; c0 < cols; c0 += 1) {
      if (cells[r0 * cols + c0] === 0 || seen[r0 * cols + c0] === 1) continue;
      const stack = [[c0, r0]];
      seen[r0 * cols + c0] = 1;
      let minc = c0;
      let maxc = c0;
      let minr = r0;
      let maxr = r0;
      let px = 0;
      while (stack.length > 0) {
        const [c, r] = stack.pop();
        px += cells[r * cols + c];
        if (c < minc) minc = c;
        if (c > maxc) maxc = c;
        if (r < minr) minr = r;
        if (r > maxr) maxr = r;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
            if (seen[rr * cols + cc] === 1 || cells[rr * cols + cc] === 0) continue;
            seen[rr * cols + cc] = 1;
            stack.push([cc, rr]);
          }
        }
      }
      boxes.push({
        x: minc * cell,
        y: minr * cell,
        w: (maxc - minc + 1) * cell,
        h: (maxr - minr + 1) * cell,
        px,
      });
    }
  }
  boxes.sort((a, b) => b.px - a.px);

  // The picture: the last frame drained to grey, everything that moved in
  // magenta. Same treatment as the third panel of a failure triptych, so the
  // two read the same way.
  const last = frames[frames.length - 1].data;
  const marked = new Uint8ClampedArray(last.length);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (mask[p] === 1) {
      marked[i] = 0xff;
      marked[i + 1] = 0x1f;
      marked[i + 2] = 0x9c;
      marked[i + 3] = 0xff;
    } else {
      const grey = (last[i] * 0.299 + last[i + 1] * 0.587 + last[i + 2] * 0.114) * 0.35 + 140;
      marked[i] = grey;
      marked[i + 1] = grey;
      marked[i + 2] = grey;
      marked[i + 3] = 0xff;
    }
  }
  const out = new OffscreenCanvas(w, h);
  out.getContext('2d').putImageData(new ImageData(marked, w, h), 0, 0);
  const blob = await out.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return { moved, perPair, boxes: boxes.slice(0, 8), png: btoa(s) };
};

/** What the page itself says is running, and what sits under each moving box. */
const RUNNING_IN_PAGE = (boxes) => {
  const name = (el) =>
    el === null || el === undefined || el.tagName === undefined
      ? String(el)
      : `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` +
        `${el.classList.length > 0 ? `.${[...el.classList].join('.')}` : ''}`;

  const animations = [];
  try {
    for (const a of document.getAnimations()) {
      animations.push(
        `${a.animationName ?? a.transitionProperty ?? a.constructor.name}` +
          ` [${a.playState}] on ${name(a.effect?.target)}`,
      );
    }
  } catch {
    /* an engine without the Web Animations registry is not this suite's business */
  }

  const gsap = [];
  try {
    const g = globalThis.gsap;
    if (g !== undefined) {
      for (const t of g.globalTimeline.getChildren(true, true, true)) {
        if (t.paused?.() === true) continue;
        gsap.push(
          `${(t.targets?.() ?? []).map(name).slice(0, 2).join(', ') || '(no target)'}` +
            ` dur ${t.duration?.()} repeat ${t.vars?.repeat ?? 0}` +
            ` progress ${(t.progress?.() ?? 0).toFixed(2)}`,
        );
      }
    }
  } catch {
    /* GSAP not on the window in this build */
  }

  const under = boxes.map((b) => ({
    box: b,
    stack: document
      .elementsFromPoint(b.x + b.w / 2, b.y + b.h / 2)
      .slice(0, 4)
      .map(name),
  }));

  return { animations: animations.slice(0, 12), gsap: gsap.slice(0, 12), under };
};

/**
 * Called the instant a settle gives up, with the page still on the surface.
 *
 * Returns null rather than throwing on any failure: a diagnosis that falls over
 * must not cost the case its picture, which is still the thing the operator has
 * to look at.
 */
async function diagnoseMovement(page, cmp, tail) {
  if (tail.length < 2) return null;
  try {
    const mask = await cmp.evaluate(
      MOVE_MASK_IN_PAGE,
      [tail.map((b) => b.toString('base64')), CELL],
    );
    let running = null;
    try {
      running = await page.evaluate(RUNNING_IN_PAGE, mask.boxes);
    } catch {
      /* the page may have navigated out from under us; the mask still stands */
    }
    return { ...mask, running };
  } catch {
    return null;
  }
}

/** FNV-1a over the decoded RGBA, plus the dimensions. Cheap and exact. */
async function pixelSignature(cmp, buffer) {
  return cmp.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4) {
      h = Math.imul(h ^ data[i], 0x01000193);
      h = Math.imul(h ^ data[i + 1], 0x01000193);
      h = Math.imul(h ^ data[i + 2], 0x01000193);
    }
    return `${bmp.width}x${bmp.height}:${(h >>> 0).toString(16)}`;
  }, buffer.toString('base64'));
}

/* ============================= the comparison ============================= */

/**
 * Decode, diff and draw — in the browser, because the repo has no image
 * library and a Chromium is already running.
 *
 * Returns the numbers plus a triptych PNG (baseline · actual · what changed).
 */
const COMPARE_IN_PAGE = async ([aB64, bB64, cfg]) => {
  const decode = async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    return {
      w: bmp.width,
      h: bmp.height,
      data: ctx.getImageData(0, 0, bmp.width, bmp.height).data,
    };
  };

  const A = await decode(aB64);
  const B = await decode(bB64);
  if (A.w !== B.w || A.h !== B.h) {
    return { sizeMismatch: { baseline: [A.w, A.h], actual: [B.w, B.h] } };
  }

  const { w, h, data: a } = A;
  const b = B.data;
  const tol = cfg.tol;

  const delta = (i, j) =>
    Math.max(
      Math.abs(a[i] - b[j]),
      Math.abs(a[i + 1] - b[j + 1]),
      Math.abs(a[i + 2] - b[j + 2]),
      Math.abs(a[i + 3] - b[j + 3]),
    );

  /**
   * Does `src`'s pixel at (x,y) have a near-enough twin within one pixel of
   * (x,y) in `dst`? This is the whole antialiasing tolerance: a rendered edge
   * that shifted a fraction of a pixel has a matching neighbour; a label that
   * moved four pixels does not.
   */
  const nearby = (srcData, dstData, x, y) => {
    const i = (y * w + x) * 4;
    for (let dy = -1; dy <= 1; dy += 1) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = (yy * w + xx) * 4;
        const d = Math.max(
          Math.abs(srcData[i] - dstData[j]),
          Math.abs(srcData[i + 1] - dstData[j + 1]),
          Math.abs(srcData[i + 2] - dstData[j + 2]),
          Math.abs(srcData[i + 3] - dstData[j + 3]),
        );
        if (d <= tol) return true;
      }
    }
    return false;
  };

  const cols = Math.ceil(w / cfg.cell);
  const rows = Math.ceil(h / cfg.cell);
  const cells = new Int32Array(cols * rows);
  const mask = new Uint8Array(w * h);
  let changed = 0;
  let softened = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (delta(i, i) <= tol) continue;
      if (nearby(a, b, x, y) && nearby(b, a, x, y)) {
        softened += 1;
        continue;
      }
      mask[y * w + x] = 1;
      changed += 1;
      cells[Math.floor(y / cfg.cell) * cols + Math.floor(x / cfg.cell)] += 1;
    }
  }

  let worstCell = 0;
  let worstAt = null;
  let hotCells = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const n = cells[r * cols + c];
      if (n === 0) continue;
      if (n >= cfg.cellHot) hotCells += 1;
      if (n > worstCell) {
        worstCell = n;
        worstAt = [c * cfg.cell, r * cfg.cell];
      }
    }
  }

  /* ------------------------------- the picture --------------------------- */

  const GUT = 10;
  const LABEL = 26;
  const out = new OffscreenCanvas(w * 3 + GUT * 4, h + LABEL + GUT * 2);
  const g = out.getContext('2d');
  g.fillStyle = '#1a1614';
  g.fillRect(0, 0, out.width, out.height);
  g.font = '13px system-ui, sans-serif';
  g.textBaseline = 'middle';

  const panel = new OffscreenCanvas(w, h);
  const pctx = panel.getContext('2d');
  const put = (arr) => {
    pctx.putImageData(new ImageData(new Uint8ClampedArray(arr), w, h), 0, 0);
    return panel.transferToImageBitmap();
  };

  const titles = ['baseline', 'actual', `changed · ${changed}px`];
  const images = [put(a), put(b)];

  // The third panel: the actual, drained of colour, with every changed pixel
  // painted magenta. Draining rather than blanking keeps the context — you can
  // see WHERE on the page the thing moved without flicking between two tabs.
  const marked = new Uint8ClampedArray(b.length);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    if (mask[p] === 1) {
      marked[i] = 0xff;
      marked[i + 1] = 0x1f;
      marked[i + 2] = 0x9c;
      marked[i + 3] = 0xff;
    } else {
      const grey = (b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114) * 0.35 + 140;
      marked[i] = grey;
      marked[i + 1] = grey;
      marked[i + 2] = grey;
      marked[i + 3] = 0xff;
    }
  }
  images.push(put(marked));

  images.forEach((img, n) => {
    const x = GUT + n * (w + GUT);
    g.fillStyle = '#e9e1d3';
    g.fillText(titles[n], x, LABEL / 2 + 2);
    g.drawImage(img, x, LABEL + GUT);
  });

  const blob = await out.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }

  return {
    width: w,
    height: h,
    pixels: w * h,
    changed,
    softened,
    ratio: changed / (w * h),
    hotCells,
    worstCell,
    worstAt,
    diffPng: btoa(s),
  };
};

async function compare(cmp, baselineBuf, actualBuf) {
  return cmp.evaluate(COMPARE_IN_PAGE, [
    baselineBuf.toString('base64'),
    actualBuf.toString('base64'),
    { tol: CHANNEL_TOL, cell: CELL, cellHot: Math.ceil(CELL_FAIL / 2) },
  ]);
}

/* ================================= run =================================== */

const CASES = [];
for (const size of SIZES) {
  for (const room of ROOMS) {
    for (const s of SURFACES) CASES.push({ surface: s, size, room });
  }
}
const caseName = (c) => `${c.size.id}-${c.room.id}-${c.surface.id}`;
const baselinePath = (c) => join(BASELINE_DIR, c.size.id, c.room.id, `${c.surface.id}.png`);

if (LIST) {
  for (const c of CASES) console.log(caseName(c));
  console.log(`\n${CASES.length} cases`);
  process.exit(0);
}

const wanted = CASES.filter(
  (c) => ONLY === null || ONLY.some((needle) => caseName(c).includes(needle)),
);
if (wanted.length === 0) {
  console.error(`--only=${ONLY.join(',')} matched nothing. Try --list.`);
  process.exit(2);
}

console.log(
  `visual suite — ${wanted.length} case${wanted.length === 1 ? '' : 's'}` +
    `${UPDATE ? ' (re-baselining)' : ''} against ${URL_BASE}`,
);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const cmp = await browser.newPage();
await cmp.goto('about:blank');

/**
 * Every picture taken, held in memory until the last one is.
 *
 * NOTHING may be written into the working tree while the browser is walking a
 * scene, and this is not tidiness. The dev server watches the whole repo
 * (`vite.config.ts` ignores only `src-tauri`), so a PNG landing in
 * `qa/baseline/` triggers a full page reload — mid-walk, under the very page
 * being photographed. The first version of this file wrote as it went and the
 * symptom was baffling: a tour that vanished between two surfaces, a book that
 * closed itself, and one screenshot that hung for 45 seconds. Sixty-four
 * buffers is about 16MB, which is a cheap price for a suite that means what it
 * says.
 */
const shots = [];
const results = [];
const record = (c, status, extra = {}) => {
  const row = { name: caseName(c), status, ...extra };
  results.push(row);
  const num =
    extra.changed === undefined
      ? ''
      : `  ${extra.changed}px changed, worst cell ${extra.worstCell}`;
  console.log(`  ${MARK[status]} ${row.name}${num}${extra.why ? `  — ${extra.why}` : ''}`);
};

let kit;
try {
  console.log('\nbuilding the fixture from the app’s own code…');
  kit = await buildFixtureKit(browser);
  console.log(
    `  welcome book: ${kit.welcomePages.length} pages, seed ${kit.welcomeSpineSeed}; ` +
      `${kit.dressings.length} dressed spines`,
  );
} catch (error) {
  console.error(`could not build the fixture: ${String(error).split('\n')[0]}`);
  console.error('is the dev server up?  npm run dev');
  await browser.close();
  process.exit(2);
}

/* --------------------------------- walk ---------------------------------- */

/**
 * Group into scenes, and keep the WHOLE scene even when `--only` wants one
 * surface of it.
 *
 * A scene is a sequence, not a bag: `studio-book` is reached by opening a book
 * in `book-spread`, and `first-run-invite` by emptying the case the fourteen
 * surfaces before it were photographed in. Filtering the walk itself would make
 * `--only=desk-day-focus-leaf` fail on the shelf, which is a trap for whoever
 * reaches for it while chasing one diff. So `--only` selects what is COMPARED;
 * every surface is still walked, and the ones nobody asked for skip the
 * screenshot (which is most of the cost).
 */
const wantedNames = new Set(wanted.map(caseName));
const byScene = new Map();
for (const c of CASES) {
  const key = `${c.size.id}|${c.room.id}`;
  if (!wanted.some((w) => w.size.id === c.size.id && w.room.id === c.room.id)) continue;
  if (!byScene.has(key)) byScene.set(key, []);
  byScene.get(key).push(c);
}

/**
 * Print the diagnosis under the case that earned it.
 *
 * On the console rather than only in the report page, because the person who
 * runs this suite is watching a terminal for forty-five minutes and the whole
 * point of the third outcome is that somebody eventually goes and fixes it.
 */
function reportMovement(moving) {
  console.log(
    `      what moved: ${moving.moved}px across the last ${moving.perPair.length + 1} frames` +
      ` (${moving.perPair.join(', ')} per pair)`,
  );
  for (const b of moving.boxes) {
    const under = moving.running?.under?.find((u) => u.box.x === b.x && u.box.y === b.y);
    console.log(
      `      · ${b.w}×${b.h} at ${b.x},${b.y} — ${b.px}px` +
        `${under === undefined ? '' : `  ${under.stack.join(' < ')}`}`,
    );
  }
  for (const a of moving.running?.animations ?? []) console.log(`      anim: ${a}`);
  for (const t of moving.running?.gsap ?? []) console.log(`      gsap: ${t}`);
}

/**
 * Walk one (size, room) once, filling `taken`.
 *
 * Returns the number of page navigations that happened after boot. Anything
 * above zero means the dev server reloaded underneath the walk — someone saved
 * a file in `src/` — and every picture after it is of a half-built app. The
 * caller throws the whole attempt away rather than baselining that.
 */
async function walkScene(group, taken) {
  const { size, room } = group[0];
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    // Fixed, because a locale reaches the page through date and number
    // formatting and a timezone reaches it through anything that prints a day.
    locale: 'en-GB',
    timezoneId: 'UTC',
  });
  const failures = [];
  let reloads = 0;
  let page = null;
  let errors = [];
  try {
    ({ page, errors } = await bootScene(context, buildStubBlob(kit, room), size));
  } catch (error) {
    await context.close();
    return { reloads: 0, fatal: `boot: ${String(error).split('\n')[0]}`, failures };
  }
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reloads += 1;
  });

  /**
   * Stop once the last surface anyone asked about has been photographed.
   *
   * `--only` cannot filter the walk — half these surfaces are only reachable
   * through the ones before them — but it can end it. Everything after the
   * last wanted case is pure cost: `enter()` still opens a book, still runs
   * the tour, still empties the library. The header promised that
   * `--only=<one case>` was "a couple of minutes" and it was not, because the
   * walk always ran to `first-run-greeting`; chasing one diff on the shelf
   * meant sitting through fifteen surfaces nobody was looking at.
   *
   * Note this is the LAST wanted index, not a filter: every surface before it
   * is still walked in order, so the sequence that makes the wanted one
   * reachable is untouched.
   */
  const lastWanted = group.reduce(
    (last, c, i) => (wantedNames.has(caseName(c)) ? i : last),
    -1,
  );

  const ctx = { size, room };
  for (const [index, c] of group.entries()) {
    const { surface } = c;
    if (index > lastWanted) break;
    // Bail the moment the page reloads rather than grinding through eleven
    // more surfaces that will each spend forty-five seconds discovering the
    // app is back on the shelf. The caller starts the scene over.
    if (reloads > 0) break;
    try {
      // A surface may leave a word about what it found on its way in (the curl
      // says which renderer painted it). Cleared first, so last surface's
      // remark cannot be printed against this one.
      ctx.note = null;
      await surface.enter(page, ctx);
      if (wantedNames.has(caseName(c))) {
        const { buffer, settled, shots: took, distinct, tail } = await settle(page, cmp);
        // The count is the useful half. "Still moving" with 2 distinct frames
        // out of 40 is a slow machine; with 40 out of 40 something is genuinely
        // animating and the comparison below will say so in pixels.
        const warning = settled
          ? null
          : `still moving after ${took} frames (${distinct} distinct)`;
        // Diagnose HERE, not in the write phase: the browser is closed by then,
        // and the only moment the page can be asked what it is running is while
        // it is still standing on the surface that would not hold still.
        const moving = settled ? null : await diagnoseMovement(page, cmp, tail);
        taken.set(caseName(c), { buffer, warning, moving });
        const said = [ctx.note, warning].filter((s) => s !== null && s !== undefined);
        console.log(`    · ${surface.id}${said.length === 0 ? '' : ` — ${said.join('; ')}`}`);
        if (moving !== null) reportMovement(moving);
      } else {
        console.log(`    (${surface.id} — walked past)`);
      }
      if (surface.leave) await surface.leave(page, ctx);
      await page.mouse.move(size.width - 2, 2);
    } catch (error) {
      console.log(`    ! ${surface.id} — ${String(error).split('\n')[0]}`);
      failures.push({ c, why: String(error).split('\n')[0] });
      // Put the app back somewhere the next surface can start from.
      try {
        await page.mouse.up();
      } catch {
        /* no button was down */
      }
      try {
        await stopTour(page);
        await tidy(page);
      } catch {
        /* the page may be past saving; the next surface will say so */
      }
    }
  }

  if (errors.length > 0) {
    const unique = [...new Set(errors)];
    console.log(`  (${unique.length} page error${unique.length === 1 ? '' : 's'} in this scene)`);
    for (const e of unique.slice(0, 5)) console.log(`     · ${e}`);
  }
  await context.close();
  return { reloads, fatal: null, failures };
}

for (const [, group] of byScene) {
  const { size, room } = group[0];
  console.log(`\n${size.id} · ${room.id}`);
  let outcome = null;
  let taken = new Map();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    taken = new Map();
    outcome = await walkScene(group, taken);
    if (outcome.fatal !== null || outcome.reloads === 0) break;
    console.log(
      `  (the dev server reloaded the page ${outcome.reloads}× mid-walk — starting the scene again)`,
    );
  }
  if (outcome.fatal !== null) {
    for (const c of group) record(c, 'err', { why: outcome.fatal });
    continue;
  }
  if (outcome.reloads > 0) {
    console.log('  (still reloading — these pictures are of a moving target)');
  }
  const excused = new Set(outcome.failures.map(({ c }) => caseName(c)));
  for (const { c, why } of outcome.failures) {
    if (wantedNames.has(caseName(c))) record(c, 'err', { why });
  }
  for (const c of group) {
    if (!wantedNames.has(caseName(c))) continue;
    const hit = taken.get(caseName(c));
    if (hit !== undefined) {
      shots.push({ c, ...hit });
    } else if (!excused.has(caseName(c))) {
      // Neither photographed nor blamed: the walk was cut short (a reload on the
      // last allowed attempt). Say so rather than letting the case drop out of
      // the tally, which is how a suite quietly stops covering something.
      record(c, 'err', { why: 'the scene ended before this surface was reached' });
    }
  }
}

/* ------------------------------- compare --------------------------------- */

/**
 * Nothing above this line touched the disk; nothing below it touches the
 * browser except the comparator, which only decodes and draws.
 *
 * This runs under `--update` too, and it has to: a baseline whose PIXELS are
 * unchanged must not be rewritten, or every re-baseline would churn sixty-four
 * binary files in git for nothing (Chromium's PNG bytes are not stable — see
 * `settle`). Only genuinely different pictures get written.
 */
const verdicts = [];
for (const { c, buffer, warning, moving } of shots) {
  const path = baselinePath(c);
  if (!existsSync(path)) {
    verdicts.push({ c, buffer, warning, moving, verdict: null });
    continue;
  }
  verdicts.push({
    c,
    buffer,
    warning,
    moving,
    verdict: await compare(cmp, readFileSync(path), buffer),
  });
}

await browser.close();

/* -------------------------------- write ---------------------------------- */

// The report folder is rebuilt every run: a stale diff from three runs ago
// sitting next to a fresh one is how you end up chasing a fixed bug.
rmSync(REPORT_DIR, { recursive: true, force: true });
mkdirSync(REPORT_DIR, { recursive: true });

/**
 * A MOVE case leaves two pictures, not one.
 *
 * `.actual.png` is the moment the deadline fell on; `.moving.png` is the union
 * of everything that changed over the last few frames, in magenta. The second
 * is the one that answers the question — a single still of a surface that never
 * stops tells you it moved and nothing else, and "find what is moving" was
 * previously a day of driving the app by hand.
 */
function writeMovementEvidence(name, buffer, moving) {
  write(join(REPORT_DIR, `${name}.actual.png`), buffer);
  if (moving === null || moving === undefined) return '';
  write(join(REPORT_DIR, `${name}.moving.png`), Buffer.from(moving.png, 'base64'));
  const worst = moving.boxes[0];
  if (worst === undefined) return '';
  const under = moving.running?.under?.[0]?.stack?.[0];
  return (
    `; ${moving.moved}px moved, biggest patch ${worst.w}×${worst.h}` +
    ` at ${worst.x},${worst.y}${under === undefined ? '' : ` (${under})`}`
  );
}

if (UPDATE) {
  for (const { c, buffer, warning, moving, verdict } of verdicts) {
    /*
     * A surface that never stopped moving is NOT baselined, by either path.
     *
     * `settle()` gives up after its deadline and hands the picture over with a
     * warning saying how many distinct frames it saw. Writing that frame down
     * as the truth is the same mistake this file already refuses to make for a
     * missing baseline, arriving from the other direction: the picture is not
     * of the app at rest, it is of whichever moment the deadline fell on, so
     * the next run compares against a coin toss and fails forever. Six cases
     * did this when the rule was written; re-baselining them would have
     * converted a loud, accurate "still moving" into six cases nobody could
     * ever get green and everybody would learn to ignore. (They were real
     * defects and are fixed — see the header — but the rule is not about those
     * six, it is about the next one.)
     *
     * So it keeps whatever baseline it has and stays reported, now with the
     * moving-pixel mask beside it. The fix is to find what is moving — not to
     * photograph it harder.
     */
    if (warning !== undefined && warning !== null) {
      // The evidence is written even under `--update`, which is the one place
      // this branch is NOT symmetric with a comparison run: `--update` is what
      // somebody runs after they think they have fixed the instability, and it
      // is exactly then that they need the picture that says they have not.
      const found = writeMovementEvidence(caseName(c), buffer, moving);
      record(c, 'skip', {
        why: `${warning}${found} — not baselined; find what is moving first`,
        sawSabotage: sabotageWasSeen(moving),
      });
      continue;
    }
    if (verdict === null) {
      write(baselinePath(c), buffer);
      record(c, 'add', { why: warning ?? undefined });
      continue;
    }
    // Identical pixels: leave the committed file exactly as it is.
    const same = !verdict.sizeMismatch && verdict.changed === 0 && verdict.softened === 0;
    if (same) {
      record(c, 'pass', { changed: 0, worstCell: 0, why: warning ?? undefined });
      continue;
    }
    write(baselinePath(c), buffer);
    record(c, 'upd', {
      changed: verdict.changed,
      worstCell: verdict.worstCell,
      why: warning ?? undefined,
    });
  }
} else {
  for (const { c, buffer, warning, moving, verdict } of verdicts) {
    const name = caseName(c);
    /*
     * Symmetric with the `--update` branch above, and it has to be.
     *
     * `--update` refuses to write a baseline for a surface that never stopped
     * moving. If comparison then treated the same surface as an ordinary case,
     * it would be measured against a baseline that by definition cannot match,
     * and the suite would carry a handful of cases that are red on every run
     * forever — which is how a team learns to skim past the summary line.
     *
     * "Still moving" is not a regression signal. It is the suite saying it
     * COULD NOT MEASURE this surface, and that is a third outcome, not a bad
     * second one. It is reported by name on every run and counted in its own
     * column so the tally can never read as full coverage while quietly
     * covering less — but it does not fail the run, because there is nothing
     * here for a reviewer to act on except the underlying instability, which
     * is written down as its own piece of work rather than as noise on this
     * one.
     *
     * The picture is still written to the report folder, because the fastest
     * way to find what is moving is to look at two of them.
     */
    if (warning !== undefined && warning !== null) {
      const found = writeMovementEvidence(name, buffer, moving);
      record(c, 'skip', {
        why: `${warning}${found} — cannot be measured, so not judged`,
        sawSabotage: sabotageWasSeen(moving),
      });
      continue;
    }
    if (verdict === null) {
      /**
       * A missing baseline FAILS. It is never written by a comparison run.
       *
       * This used to write the picture and carry on green, which reads as
       * friendly and is the single worst thing this file could do: `--update`
       * is the deliberate act, and a comparison run that quietly enshrines
       * whatever the app looked like at that moment is a suite that agrees
       * with the app by construction. It costs nothing when everything is
       * fine and everything when it is not — delete a baseline, or add a
       * seventeenth surface, or rename a size, and the very first run adopts
       * the current pixels as the truth, regression and all, and says PASS.
       *
       * The picture is still written, into the report folder, so the operator
       * can look at it before deciding. That is the whole difference: looked
       * at, then accepted with a flag, rather than accepted and never seen.
       */
      write(join(REPORT_DIR, `${name}.actual.png`), buffer);
      record(c, 'fail', {
        why:
          'no baseline for this case — look at ' +
          `${name}.actual.png, then accept it with --update`,
      });
      continue;
    }
    if (verdict.sizeMismatch) {
      write(join(REPORT_DIR, `${name}.actual.png`), buffer);
      record(c, 'fail', {
        why:
          `size changed: baseline ${verdict.sizeMismatch.baseline.join('×')} ` +
          `vs actual ${verdict.sizeMismatch.actual.join('×')}`,
      });
      continue;
    }
    // A surface that would not stop moving is reported, not failed on its own:
    // if it is genuinely unstable the pixels will say so, and if it was only
    // slow then failing on it would be failing on the machine's mood — which is
    // exactly how a suite earns its reputation for crying wolf.
    const failed = verdict.ratio > MAX_DIFF_RATIO || verdict.worstCell >= CELL_FAIL;
    if (failed || KEEP_PASSES) {
      write(join(REPORT_DIR, `${name}.diff.png`), Buffer.from(verdict.diffPng, 'base64'));
      write(join(REPORT_DIR, `${name}.actual.png`), buffer);
    }
    record(c, failed ? 'fail' : 'pass', {
      changed: verdict.changed,
      worstCell: verdict.worstCell,
      softened: verdict.softened,
      ratio: verdict.ratio,
      worstAt: verdict.worstAt,
      why: warning ?? undefined,
    });
  }
}

/* -------------------------------- report ---------------------------------- */


const failures = results.filter((r) => r.status === 'fail' || r.status === 'err');
const passes = results.filter((r) => r.status === 'pass');
const added = results.filter((r) => r.status === 'add');
const updated = results.filter((r) => r.status === 'upd');
const unstable = results.filter((r) => r.status === 'skip');

// A run whose only news is "these could not be measured" still writes the page:
// the moving-pixel masks are the only lead anyone has on the third outcome, and
// a lead nobody can open is not a lead.
if (failures.length > 0 || unstable.length > 0 || KEEP_PASSES) writeReportPage(results);

console.log('\n────────────────────────────────────────────────');
console.log(
  `  ${passes.length} unchanged · ${updated.length} re-baselined · ` +
    `${added.length} new · ${failures.length} failed` +
    (unstable.length > 0 ? ` · ${unstable.length} still moving (not baselined)` : ''),
);

// The noise floor, printed on every run whether or not anything failed. If the
// biggest "unchanged" case starts creeping towards CELL_FAIL, the thresholds
// need looking at before somebody starts ignoring the suite.
const noisiest = passes
  .filter((p) => p.changed !== undefined)
  .sort((x, y) => y.worstCell - x.worstCell)[0];
if (noisiest !== undefined) {
  console.log(
    `  noisiest passing case: ${noisiest.name} — ${noisiest.changed}px, ` +
      `worst cell ${noisiest.worstCell}/${CELL_FAIL}`,
  );
}

/*
 * The sabotage verdict, and it answers a different question from the tally.
 *
 * Under `--sabotage` a run is not asking whether the app looks right — it is
 * asking whether this file can still NOTICE. Two things have to be true and
 * both are checked: every wanted case came back `skip` (the third outcome was
 * reached at all), and the moving-pixel mask put a box over the patch we broke
 * (the diagnosis points somewhere true rather than anywhere). A mask that
 * reported movement in the wrong place would be worse than none, because it
 * would send the next person chasing the wrong element.
 */
if (SABOTAGE) {
  const missed = results.filter((r) => r.status !== 'skip');
  const blind = unstable.filter((r) => r.sawSabotage !== true);
  console.log('');
  if (missed.length === 0 && blind.length === 0 && unstable.length > 0) {
    console.log(
      `  GATE ALIVE — all ${unstable.length} sabotaged case(s) reported MOVE, ` +
        'and the mask found the patch',
    );
  } else {
    console.log('  GATE INERT — the suite did not notice a screen that never stops:');
    for (const r of missed) console.log(`   · ${r.name} came back "${r.status}", not MOVE`);
    for (const r of blind) console.log(`   · ${r.name} reported MOVE but the mask missed the patch`);
    if (unstable.length === 0 && missed.length === 0) console.log('   · nothing was measured at all');
    process.exit(3);
  }
}

if (failures.length > 0) {
  console.log('\n  failed:');
  for (const f of failures) console.log(`   · ${f.name}${f.why ? ` — ${f.why}` : ''}`);
  console.log(`\n  look at them:  ${join(REPORT_DIR, 'index.html')}`);
  process.exit(1);
}
console.log('  PASS');

/**
 * One page listing every failure, baseline beside actual beside the mask.
 *
 * The brief for this suite was "writes a diff image for every failure so the
 * change can be SEEN" — a folder of PNGs technically satisfies that and nobody
 * opens seventeen of them. This is one file to open.
 */
function writeReportPage(rows) {
  const shown = rows.filter((r) => r.status !== 'pass' || KEEP_PASSES);
  const esc = (s) => String(s).replace(/[<&>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const card = (r) => {
    // Four states, and the two middle ones are the point. A case with no
    // baseline has no triptych to show but DOES have a picture, and the whole
    // reason it failed is so somebody looks at that picture before accepting
    // it. A case that never settled has TWO pictures — the moment the deadline
    // fell on, and the union of everything that would not hold still — and the
    // second goes first, because it is the one that answers the question.
    const has = (suffix) => existsSync(join(REPORT_DIR, `${r.name}.${suffix}.png`));
    const shot = (suffix, caption) =>
      `<figure><figcaption>${caption}</figcaption>` +
      `<img src="${r.name}.${suffix}.png" alt="${esc(`${r.name} — ${caption}`)}"></figure>`;
    const img = has('diff')
      ? shot('diff', 'baseline · actual · what changed')
      : has('moving')
        ? shot('moving', 'everything that would not hold still, in magenta') +
          (has('actual') ? shot('actual', 'the frame the deadline fell on') : '')
        : has('actual')
          ? shot('actual', 'the picture nobody has accepted yet')
          : `<p class="none">no image — ${esc(r.why ?? 'the case never got as far as a screenshot')}</p>`;
    const stats =
      r.changed === undefined
        ? ''
        : `<span>${r.changed} px changed (${(r.ratio * 100).toFixed(4)}%)</span>` +
          `<span>worst 16px cell: ${r.worstCell} / ${CELL_FAIL}</span>` +
          `<span>${r.softened} px forgiven as antialiasing</span>` +
          (r.worstAt ? `<span>worst at ${r.worstAt.join(', ')}</span>` : '');
    return `<section>
      <h2>${esc(r.name)} <em>${r.status}</em></h2>
      <div class="stats">${stats}${r.why ? `<span>${esc(r.why)}</span>` : ''}</div>
      ${img}
    </section>`;
  };
  const html = `<!doctype html><meta charset="utf-8">
<title>visual suite — ${shown.length} to look at</title>
<style>
  body { background:#171310; color:#e9e1d3; font:14px/1.5 system-ui,sans-serif; margin:0; padding:24px 20px 60px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  .sub { color:#a2968a; margin:0 0 28px; }
  section { margin:0 0 34px; }
  h2 { font-size:15px; font-weight:600; margin:0 0 6px; }
  h2 em { font-style:normal; font-size:11px; letter-spacing:.08em; text-transform:uppercase;
          background:#7c2033; color:#ffd9df; padding:2px 7px; border-radius:9px; margin-left:8px; }
  .stats { display:flex; flex-wrap:wrap; gap:14px; color:#a2968a; font-size:12px; margin:0 0 10px; }
  img { max-width:100%; display:block; border:1px solid #2e2721; border-radius:4px; }
  figure { margin:0 0 12px; }
  figcaption { color:#a2968a; font-size:12px; margin:0 0 4px; }
  .none { color:#c08a72; }
</style>
<h1>visual suite</h1>
<p class="sub">${esc(new Date().toISOString())} · ${shown.length} of ${rows.length} cases shown ·
each strip is baseline, then actual, then the pixels that changed in magenta</p>
${shown.map(card).join('\n')}`;
  write(join(REPORT_DIR, 'index.html'), html);
}
