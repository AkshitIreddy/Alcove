/**
 * shots-now/readme-shots.mjs — every picture in the README, in one run.
 *
 * ## Why one script
 *
 * There used to be three — `readme-shots.mjs`, `readme-shots2.mjs` and
 * `readme-curl.mjs` — plus `readme-hero.mjs` for the banner, and the pictures
 * drifted apart exactly the way three scripts drift: `shelf.png` was shot in
 * one run, `studio.png` in another a day later, and the two show the same
 * library in two different rooms. Worse, all of them predated the rename: the
 * banner said *Bellanote* over the old blue mark and the open spread was headed
 * "Welcome to Bellanote", months after the app stopped being called that.
 *
 * So this file is the whole set. One boot, one seeded library, one room, one
 * pass down the README in the order a reader meets it, and one manifest written
 * at the end saying what was photographed. `scripts/check-readme.mjs` reads that
 * manifest back and fails the suite when the shots stop describing the app —
 * which is the half that could not be automated away, because nothing about a
 * stale PNG looks wrong until somebody reads the words in it.
 *
 * ## What it stages, and why each one is staged rather than posed
 *
 * Every picture has a sentence above it in `docs/readme/part-1-users.md` and has
 * to prove that sentence, so the app is driven into the state the sentence
 * claims rather than into something that photographs well:
 *
 *  - the shelf carries thirty-two books over three floors (thirty-three with
 *    the Welcome book, which is the count the studio card prints), because ten
 *    on one floor photographed as a showroom;
 *  - the room is left at the app's own DEFAULT — today `walnut` over
 *    `refectory`/`guilloche` under `trellis-gilt`, and whatever those four
 *    constants say tomorrow. A first screenshot that is not
 *    the first screen is exactly the failure being fixed here: the old shelf
 *    shots were taken back when the opening room was verdigris, and stayed
 *    green for months after it stopped being;
 *  - the page-turn is HELD part-way with a pointer drag rather than raced
 *    against the tween on a timer, and the spread it turns onto is visited
 *    first so the sheet has real paper on its back;
 *  - the script is inserted into an EMPTY book, because inserted into the
 *    middle of the tour it photographed as wreckage.
 *
 * Each of those is a paragraph of its own further down, next to the code.
 *
 * ## Usage
 *
 *   npm run dev                                 (a dev server on :1420)
 *   node shots-now/readme-shots.mjs
 *   node shots-now/readme-shots.mjs --only=hero,spread     one or two of them
 *   node shots-now/readme-shots.mjs --url=http://localhost:1431
 *
 * `--only` rewrites just those entries in the manifest and leaves the rest
 * alone, so a single re-take does not claim the others were taken with it.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ROOT,
  SHOTS_DIR,
  SHOTS_MANIFEST,
  appIdentity,
  measureShot,
  readShotsManifest,
  shotFiles,
  sourceDigests,
} from '../scripts/check-readme.mjs';

/* --------------------------------- options -------------------------------- */

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (name) => ONLY.length === 0 || ONLY.includes(name);

const OUT = join(ROOT, SHOTS_DIR);
mkdirSync(OUT, { recursive: true });

/** The app's window in the pictures. Wide enough that the rail, the spread and
 *  a pushed-aside panel all fit without the layout folding to its narrow mode. */
const VIEWPORT = { width: 1500, height: 940 };
/** 1×: the README shows these at 880 CSS px, so 1500 already downsamples. The
 *  banner is the exception — it is authored at its display size, so
 *  {@link HERO} doubles instead. */
const SCALE = 1;
const HERO = { width: 1040, height: 420, scale: 2 };

/**
 * Titles for the shelf: three floors of them, plus the Welcome book.
 *
 * Sized by looking rather than by taste. Ten on a floor left the case reading
 * as a showroom — one part-filled row over eight empty bays — and the shelf is
 * the picture that has to say "this is where your notes live". Thirty-two
 * across three floors fills the top of the case at the reading zoom while
 * leaving the arcade below plainly empty, which is the honest shape of a
 * library somebody has started rather than a stock photograph of one.
 *
 * The titles are deliberately somebody's actual life — a language, a hobby, a
 * course, the tax return — because the quick switcher photographs this list and
 * "Notebook 1 / Notebook 2" would photograph as a demo.
 */
const FLOOR_0 = [
  'Field Notes',
  'Kanji Practice',
  'Watercolour Basics',
  'Cell Biology',
  'Recipes',
  'Dream Journal',
  'The Long Walk',
  'Chess Openings',
  'Garden Log',
  'Letters Home',
  'Bird Counts',
];
const FLOOR_1 = [
  'Sourdough',
  'Astronomy',
  'Icelandic',
  'Weekly Review',
  'Short Stories',
  'Tax 2026',
  'Piano Scales',
  'Sketchbook',
  'Quotes',
  'Marginalia',
  'Trail Notes',
];
const FLOOR_2 = [
  'Wine Notes',
  'Knots',
  'Latin',
  'Reading Log',
  'House Plants',
  'Film Diary',
  'Mushrooms',
  'Old Letters',
  'Recipes II',
  'Sea Glass',
];

/** The script typed into the insert sheet, and then rendered on the page. */
const SCRIPT = [
  '---',
  'title: Field Notes — Week 3',
  'paper: grid',
  'wash: moss',
  '---',
  '',
  '# Photosynthesis {sticker=leaf}',
  '',
  'Sunlight in, sugar out. The ==light-dependent=={color=amber} half runs in the thylakoid.',
  '',
  '::: sticky-note {color=lemon, rotate=-2, tape=corner}',
  'Exam **Friday** — learn both stages.',
  ':::',
  '',
  '```graph',
  'Sun -> Leaf: light',
  'Water -> Leaf',
  'Leaf -> Glucose, Oxygen',
  'Glucose {color=amber}',
  '```',
  '',
  '```timeline',
  '1771: Priestley — air is "restored"',
  '1779: Ingenhousz — only in the light',
  '1845: Mayer — sunlight becomes chemical energy',
  '```',
].join('\n');

/* --------------------------------- plumbing ------------------------------- */

const taken = [];
const errors = new Map();

/** Which tree this run is photographing. Stamped on every shot it takes. */
function head() {
  const git = (a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    const sha = git(['rev-parse', 'HEAD']);
    return { sha, short: sha.slice(0, 7), dirty: git(['status', '--porcelain']) !== '' };
  } catch {
    return { sha: 'unknown', short: 'unknown', dirty: true };
  }
}

const HEAD = head();
const RUN_AT = new Date().toISOString();
/** Provenance stamp carried by each shot: `a173150` or `a173150+dirty`. */
const STAMP = `${HEAD.short}${HEAD.dirty ? '+dirty' : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

/**
 * Shoot the whole viewport into `docs/readme/img/`.
 *
 * `animations: 'disabled'` everywhere EXCEPT the page-turn: the option finishes
 * every running animation at its end state, which for a flip is precisely the
 * frame we are trying not to take.
 */
async function shot(page, name, { freeze = true, park = true } = {}) {
  // Park the pointer somewhere with nothing under it first. A cursor left over
  // a block wakes its hover chrome — the first run photographed the polaroid on
  // the diagrams spread wearing its resize handles and a floating toolbar,
  // which is a picture of the app being edited rather than of the page.
  if (park) await page.mouse.move(6, VIEWPORT.height - 6);
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    animations: freeze ? 'disabled' : 'allow',
    caret: 'hide',
  });
  const m = measureShot(`${name}.png`);
  taken.push({ file: `${name}.png`, ...m, at: RUN_AT, commit: STAMP });
  console.log(`  ${name}.png  ${m.width}×${m.height}  ${(m.bytes / 1024).toFixed(0)} kB`);
}

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Take the selection off a diagram before photographing the page it is on.
 *
 * A diagram is an atom, and a ProseMirror selection that lands on an atom is a
 * NodeSelection — so a page whose first block is a diagram opens with it
 * selected, and a diagram that was just INSERTED ends up selected too. Either
 * way it draws inside a dashed frame with its kind chip and edit pencil
 * showing, which photographs as the app being edited rather than as a page.
 *
 * Nothing is faked to fix it: the caret is put in empty ruled space low on the
 * leaf, which is the reader's own way out of the same state (clicking blank
 * ruled space starts typing there), and the selection moves off the node.
 */
async function clearNodeSelection(page, side) {
  if ((await page.locator('.nb-diagram.is-selected').count()) === 0) return;
  const leaf = await page.locator(`.nb-flip-leaf-${side}`).boundingBox();
  if (leaf !== null) {
    await page.mouse.click(leaf.x + leaf.width * 0.45, leaf.y + leaf.height * 0.95);
    await wait(page, 1400);
  }
  if ((await page.locator('.nb-diagram.is-selected').count()) > 0) {
    throw new Error('readme-shots: a diagram will not deselect — its edit chrome is showing');
  }
}

/**
 * Wait until the layout has stopped moving.
 *
 * Every rail panel arrives on a GSAP tween that PUSHES the world sideways
 * rather than covering it, so for most of a second after the sheet exists the
 * spread beside it is still sliding and resizing. Shot on a fixed timer, the
 * book-studio picture caught the spread mid-slide at the wrong size. Polling
 * the geometry until two consecutive samples agree costs nothing and cannot be
 * out-run by a slow frame.
 */
/**
 * Whatever the panels push aside: the open book's spread, or — when the shelf
 * is what is behind the sheet — the zoom pill, which rides the same carrier and
 * is the one piece of shelf chrome with a box worth measuring (the case itself
 * is inside a canvas, so its own geometry never changes).
 */
const STAGE = '.nb-spread-stage, .shelf-zoom-pill';

async function settle(page, selector = STAGE, tries = 40) {
  let last = '';
  let same = 0;
  for (let i = 0; i < tries; i += 1) {
    const box = await page.locator(selector).first().boundingBox().catch(() => null);
    const now = box === null ? 'gone' : `${box.x | 0},${box.y | 0},${box.width | 0},${box.height | 0}`;
    same = now === last ? same + 1 : 0;
    last = now;
    if (same >= 2) return;
    await wait(page, 250);
  }
}

/**
 * Open one of the left rail's panels and wait until it is really open.
 *
 * Retried, because these are TOGGLES and a click that lands while the previous
 * sheet is still animating out is simply lost: one run photographed the
 * "Catalogue" step as a bare spread with no panel on it at all, which is
 * exactly as wrong as a stale shot and much harder to notice. The retry checks
 * first — clicking a toggle that DID open would close it again.
 */
/**
 * Is that sheet actually on the screen?
 *
 * The question has to be asked this way round, and finding that out cost three
 * five-minute runs. A rail panel is **mounted whether it is open or shut** — it
 * is parked off-canvas at a negative x and slides in — so `count() > 0` is true
 * the whole time, `state: 'attached'` resolves instantly against a sheet nobody
 * can see, and `state: 'visible'` never resolves at all. Position is the only
 * honest signal: open means its left edge is inside the window.
 */
async function onScreen(page, selector) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  return box !== null && box.x >= 0 && box.width > 100;
}

async function openRailPanel(page, scope, name, selector) {
  const button = page.locator(scope).getByRole('button', { name }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await onScreen(page, selector))) await button.click({ force: true });
    for (let i = 0; i < 60; i += 1) {
      if (await onScreen(page, selector)) {
        await settle(page, selector);
        await settle(page);
        await wait(page, 900);
        return;
      }
      await wait(page, 500);
    }
    // Say WHY on the way past. A capture script that only reports "would not
    // open" sends the next person back to bisecting a five-minute run.
    console.log(
      `   retry ${attempt + 1}: ${selector} ×${await page.locator(selector).count()} ` +
        `off screen, ${scope} button ×${await button.count()}`,
    );
    await wait(page, 1500);
  }
  throw new Error(`readme-shots: ${selector} would not open`);
}

/**
 * Close it again through its own ✕, and wait for the world to have the room
 * back.
 *
 * NOT Escape, which was what this did first. Escape is also how a reader puts
 * the open book back on the shelf, so an Escape sent a beat after the sheet had
 * already gone closed the BOOK — and the run carried on and photographed the
 * quick switcher floating over the bookcase before failing outright looking for
 * a page to turn. The panel header's close button can only ever close the
 * panel, which is the whole reason exits live in the top-left corner.
 */
async function closeRailPanel(page, selector, title) {
  const close = page.getByRole('button', { name: `Close ${title}` }).first();
  if (await close.count()) await close.click({ force: true });
  else await page.keyboard.press('Escape');
  // Gone means back off the canvas, not removed from the DOM — see onScreen().
  for (let i = 0; i < 40; i += 1) {
    if (!(await onScreen(page, selector))) break;
    await wait(page, 400);
  }
  await settle(page);
  await wait(page, 600);
}

/* ------------------------------- 1. the banner ---------------------------- */

/*
 * A file:// load rather than the dev server: the banner deliberately pulls the
 * app's own bundled font files straight out of node_modules and the shipped
 * mark out of assets/brand, and Vite serves neither at a stable URL. Captured
 * at 2× and left there — the README shows it at full page width, so a 1× render
 * is visibly soft on any recent display.
 */
if (wanted('hero')) {
  console.log('\n1. the banner');
  const heroPage = await browser.newPage({
    viewport: { width: HERO.width, height: HERO.height },
    deviceScaleFactor: HERO.scale,
  });
  await heroPage.goto(pathToFileURL(resolve(ROOT, 'shots-now/readme-hero.html')).href, {
    waitUntil: 'networkidle',
  });
  await heroPage.evaluate(() => document.fonts.ready);
  await heroPage.waitForTimeout(600);
  await shot(heroPage, 'hero');
  await heroPage.close();
}

/* ------------------------------ 2. boot the app --------------------------- */

const appShots = [
  'shelf',
  'shelf-zoomout',
  'studio',
  'spread',
  'page-turn',
  'diagrams',
  'slash',
  'catalogue',
  'book-studio',
  'quickswitch',
  'script-dialog',
  'script-page',
];

if (appShots.some(wanted)) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => {
    const k = e.message.split('\n')[0];
    errors.set(k, (errors.get(k) ?? 0) + 1);
  });

  console.log('\n2. boot');
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click({ force: true });
  await wait(page, 1200);

  /* --------------------------- 3. stock the shelf ------------------------- */

  console.log('\n3. stock the shelf');
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 0), FLOOR_0);
  await wait(page, 1500);
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 1), FLOOR_1);
  await wait(page, 1500);
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 2), FLOOR_2);
  await wait(page, 4500);
  if (wanted('shelf')) await shot(page, 'shelf');

  /* --------------------------- 4. the library studio ---------------------- */

  /*
   * Before the zoom-out, and that ordering is load-bearing. The wheel is not
   * symmetric — six notches out and six notches back landed the camera at 250%,
   * and the first run of this script photographed the studio against four
   * gigantic empty arches because of it. Everything that needs the reading
   * zoom therefore happens while the camera has never been touched.
   */
  if (wanted('studio')) {
    console.log('\n4. the library studio');
    await openRailPanel(page, '.shelf-dock', /Library studio/, '.nb-library-studio');
    await shot(page, 'studio');
    await closeRailPanel(page, '.nb-library-studio', 'Library studio');
  }

  /* ------------------------- 5. the case as one object -------------------- */

  if (wanted('shelf-zoomout')) {
    console.log('\n5. pull the camera back');
    // Plain wheel is ZOOM in this app (shift+wheel pans), so scrolling down on
    // the canvas is how the reader pulls back to see the whole case. The camera
    // is left where this leaves it — the book view is a DOM overlay and does
    // not care, and nothing below photographs the shelf again.
    /*
     * All the way out, and "all the way" is asked rather than counted: the
     * camera has a floor (`minZoomFor(viewport)`, 38% at this window size), so
     * this presses the pill's own zoom-out button until the percentage stops
     * moving. Six wheel notches and eight wheel notches both landed on the same
     * number, which is what gave the floor away.
     *
     * NOT the pill's "fit" button, which was tried: `zoomFit` fits the case's
     * WIDTH to the window and here that means zooming IN, to 107%.
     */
    const pct = page.locator('.shelf-zoom-pill__pct');
    const zoomOut = page.getByRole('button', { name: /Zoom out/i }).first();
    let last = null;
    for (let i = 0; i < 24; i += 1) {
      const now = (await pct.textContent())?.trim() ?? '';
      if (now === last) break;
      last = now;
      await zoomOut.click();
      await wait(page, 400);
    }
    await wait(page, 4000);
    await shot(page, 'shelf-zoomout');
  }

  /* ------------------------------ 6. open a book -------------------------- */

  const needsBook = [
    'spread',
    'page-turn',
    'diagrams',
    'slash',
    'catalogue',
    'book-studio',
    'quickswitch',
    'script-dialog',
    'script-page',
  ].some(wanted);

  if (needsBook) {
    console.log('\n6. open the Welcome book');
    await page.evaluate(async () => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      const list = await books.listBooksByFloorRange(0, 20);
      const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
      app.appState.openBook(welcome.id);
    });
    await page.waitForSelector('.nb-rail', { timeout: 60_000 });
    await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
    // Long, and on purpose: the flip's page snapshots (html-to-image, ~200ms of
    // main thread each) are taken at IDLE, and under SwiftShader idle arrives
    // late. Photographing the curl before they land gives a leaf with grey
    // where the paper should be — which is exactly what the first run produced.
    await wait(page, 9000);
    if (wanted('spread')) await shot(page, 'spread');
  }

  /* ----------------------------- 7. the page turn ------------------------- */

  if (wanted('page-turn')) {
    console.log('\n7. hold the curl half-way');
    /*
     * Two things had to be got right here, and both were found by shooting it
     * wrong first (`shots-now/_probe` boards, not kept).
     *
     * **Held, not timed.** `readme-curl.mjs` used to fire a flip and shoot on a
     * short delay, which under SwiftShader — where rAF is throttled — landed on
     * whatever frame it landed on. A pointer drag is a POSITION rather than a
     * moment: `dragToP(x, w) = (w − x) / 2w`, so parking the pointer at 0.32·w
     * holds the curl at p ≈ 0.34 for as long as the shutter needs, and the
     * BOTTOM CORNER is gripped rather than the edge because a corner grip tilts
     * the fold (`foldTilt`) and a tilted fold is what reads as a page turning
     * rather than as a page cut in half.
     *
     * **The turn has to have somewhere to turn to.** The sheet's back and the
     * page uncovered beneath it belong to the NEXT spread, which is not mounted
     * at rest; they come from the raster cache's offscreen path, and under
     * SwiftShader that path had not delivered after thirty seconds of idle. So
     * the spread is visited and left again first: the pages come back from the
     * MOUNTED capture path, which works, and the curl then has real paper on
     * both faces instead of the grey band the first three attempts produced.
     */
    await page.keyboard.press('ArrowRight');
    await wait(page, 7000);
    await page.keyboard.press('ArrowLeft');
    await wait(page, 7000);

    const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
    if (leaf === null) throw new Error('readme-shots: no right leaf to turn');
    const grip = { x: leaf.x + leaf.width - 12, y: leaf.y + leaf.height * 0.93 };
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await wait(page, 250);
    await page.mouse.move(leaf.x + leaf.width * 0.32, leaf.y + leaf.height * 0.86, { steps: 26 });
    await wait(page, 1500);
    await shot(page, 'page-turn', { freeze: false, park: false });
    // Walk back to p ≈ 0 before letting go, so the release CANCELS the turn and
    // the book is still on its first spread for everything below.
    await page.mouse.move(grip.x, grip.y, { steps: 18 });
    await wait(page, 250);
    await page.mouse.up();
    await wait(page, 3000);
  }

  /* ----------------------------- 8. the slash menu ------------------------ */

  if (wanted('slash')) {
    console.log('\n8. the slash menu');
    /*
     * Opened by clicking blank ruled space on the RIGHT leaf, which is both the
     * gesture the sentence above the picture describes ("clicking empty ruled
     * space starts typing there") and the only way to say WHICH page it opens
     * on. Driving it through `activeEditor()` instead put the menu on whichever
     * of the two page editors had registered last — the left one about half the
     * time — so the same script produced two different pictures on two runs.
     */
    const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
    if (leaf === null) throw new Error('readme-shots: no right leaf to type on');
    await page.mouse.click(leaf.x + leaf.width * 0.45, leaf.y + leaf.height * 0.86);
    await wait(page, 900);
    await page.keyboard.type('/');
    await wait(page, 1600);
    await shot(page, 'slash');
    await page.keyboard.press('Escape');
    // And take the '/' back out. Escape closes the menu but leaves the
    // character that opened it, and a stray slash sat on the right-hand page
    // of the catalogue and book-studio shots for a whole run before anyone
    // noticed it.
    await page.keyboard.press('Backspace');
    await wait(page, 900);
  }

  /* ------------------------------ 9. the catalogue ------------------------ */

  if (wanted('catalogue')) {
    console.log('\n9. the catalogue');
    await openRailPanel(page, '.nb-rail', /Catalogue/, '.nb-catalogue');
    await shot(page, 'catalogue');
    await closeRailPanel(page, '.nb-catalogue', 'Catalogue');
  }

  /* ----------------------------- 10. the book studio ---------------------- */

  if (wanted('book-studio')) {
    console.log('\n10. the book studio');
    await openRailPanel(page, '.nb-rail', /Customize this book/, '.nb-book-studio');
    await shot(page, 'book-studio');
    await closeRailPanel(page, '.nb-book-studio', 'Customize this book');
  }

  /* --------------------------- 11. the quick switcher --------------------- */

  if (wanted('quickswitch')) {
    console.log('\n11. the quick switcher');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.nb-qs-bar', { state: 'visible', timeout: 20_000 });
    await wait(page, 1600);
    await shot(page, 'quickswitch');
    // Escape here is the palette's own dismiss — but Escape is ALSO how a
    // reader puts the book back on the shelf, so wait for the palette to be
    // gone rather than sending a second one blind.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nb-qs-bar', { state: 'detached', timeout: 15_000 })
      .catch(() => {});
    await wait(page, 800);
  }

  /* -------------------------- 12. the decorated spread -------------------- */

  /*
   * LAST of the Welcome book's shots, because it is the only one that walks
   * away from the first spread and there is no reliable way to walk back: the
   * tour reflows as its editors mount, so a spread counted on the way out is
   * not the same spread on the way home. Counting turns forward and pressing
   * ArrowLeft the same number of times landed four later shots on two blank
   * leaves. Going last means nothing has to come back.
   */
  if (wanted('diagrams')) {
    console.log('\n12. flip to the diagrams spread');
    /*
     * FOUND, not counted. This used to press ArrowRight twice, because the
     * decorated spread was the third one; the day the Welcome book grew a page
     * that stopped being true, and the shot became two blank ruled leaves with
     * a placeholder on them — a worse picture than the stale one it replaced.
     * Flipping until a diagram is on screen is the same instruction stated as a
     * fact about the page rather than as a count.
     *
     * Turned by TAPPING the leaf's edge hotspot rather than by ArrowRight, and
     * that is not a stylistic preference: arrow-key navigation left the landed
     * spread with a NODE SELECTION on it, so the tree diagram photographed
     * wearing its dashed selection frame, its "TREE" chip and its edit pencil —
     * a picture of the app being edited rather than of a page. A tap enters
     * through `beginFlip`, which blurs the editor and puts the selection away
     * before the sheet moves.
     */
    const tapForward = async () => {
      // count() first: boundingBox() on a missing leaf sits on its own 120s
      // timeout, which turned "the book got closed two steps ago" into two
      // silent minutes and then a stack trace about a locator.
      if ((await page.locator('.nb-flip-leaf-right').count()) === 0) {
        throw new Error('readme-shots: no book is open — something closed it before step 12');
      }
      const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
      if (leaf === null) throw new Error('readme-shots: the right leaf has no box');
      await page.mouse.click(leaf.x + leaf.width - 12, leaf.y + leaf.height * 0.5);
    };
    let turns = 0;
    while (turns < 12 && (await page.locator('.nb-diagram').count()) === 0) {
      await tapForward();
      turns += 1;
      await wait(page, 3000);
    }
    if ((await page.locator('.nb-diagram').count()) === 0) {
      throw new Error('readme-shots: no diagram in the first twelve spreads of the tour');
    }
    // The diagram renderers are lazy — a skeleton stands in until the drawing is
    // laid out. Shooting over a skeleton is the half-loaded capture this whole
    // exercise exists to stop shipping.
    await page.waitForFunction(
      () => document.querySelectorAll('.nb-diagram-skeleton').length === 0,
      null,
      { polling: 300, timeout: 60_000 },
    );
    await wait(page, 2600);
    await clearNodeSelection(page, 'right');
    await shot(page, 'diagrams');
  }

  /* ------------------------------ 13. the script -------------------------- */

  /*
   * Last, and in a DIFFERENT book, both deliberately.
   *
   * Last because inserting writes to whatever book is open, so every shot above
   * would otherwise be photographing a page the reader's own copy does not
   * have. In another book because the first attempt inserted into the middle of
   * the Welcome tour: the script landed among pages that were already full, the
   * overflow contract flowed the tour's own blocks around it, and what came out
   * was half a photosynthesis diagram wedged between a placeholder line and the
   * maths page — true of the app, and unreadable as a picture of what inserting
   * a script does. An empty book shows the script and nothing else, which is
   * what the sentence above the picture claims.
   */
  if (wanted('script-dialog') || wanted('script-page')) {
    console.log('\n13. insert a script into an empty book');
    await page.evaluate(async (title) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      const list = await books.listBooksByFloorRange(0, 20);
      const target = list.find((b) => b.title === title);
      if (!target) throw new Error(`readme-shots: no book called ${title}`);
      app.appState.closeBook();
      app.appState.openBook(target.id);
    }, FLOOR_0[0]);
    await page.waitForSelector('.nb-rail', { timeout: 60_000 });
    await wait(page, 4000);
    await page.getByRole('button', { name: /Insert script/i }).first().click({ force: true });
    await wait(page, 1400);
    const box = page.locator('textarea').first();
    await box.click({ force: true });
    await box.fill(SCRIPT);
    await wait(page, 2800);
    if (wanted('script-dialog')) await shot(page, 'script-dialog');
    if (wanted('script-page')) {
      await page
        .getByRole('button', { name: /^Insert$/i })
        .first()
        .click({ force: true });
      await wait(page, 4500);
      await page.waitForFunction(
        () => document.querySelectorAll('.nb-diagram-skeleton').length === 0,
        null,
        { polling: 300, timeout: 60_000 },
      );
      // The last thing inserted stays selected, so without this the timeline
      // photographs inside its dashed edit frame.
      await clearNodeSelection(page, 'left');
      await wait(page, 1200);
      await shot(page, 'script-page');
    } else {
      await page.keyboard.press('Escape');
    }
  }

  await page.close();
}

await browser.close();

/* ------------------------------- the manifest ----------------------------- */

/**
 * The identity strings the pictures spell out, read off the TypeScript by
 * regex rather than by import — this script is plain ESM run by node, and the
 * five values are all single literals declared once. `tests/readme.test.ts`
 * imports the same five properly and compares, so a regex that silently stopped
 * matching would fail there rather than pass here.
 */
function depicts() {
  const pick = (rel, re, what) => {
    const m = re.exec(readFileSync(join(ROOT, rel), 'utf8'));
    if (m === null) throw new Error(`readme-shots: cannot read ${what} out of ${rel}`);
    return m[1];
  };
  const shelf = readFileSync(join(ROOT, 'src/art/shelfDesign.ts'), 'utf8');
  const design = /DEFAULT_SHELF_DESIGN: ShelfDesign = \{\s*build: '([^']+)',\s*pattern: '([^']+)'/.exec(
    shelf,
  );
  if (design === null) throw new Error('readme-shots: cannot read DEFAULT_SHELF_DESIGN');
  return {
    welcomeTitle: pick(
      'src/data/seed.ts',
      /export const WELCOME_BOOK_TITLE = '([^']+)'/,
      'WELCOME_BOOK_TITLE',
    ),
    defaultTheme: pick(
      'src/art/themes.ts',
      /export const DEFAULT_THEME_ID: ThemeId = '([^']+)'/,
      'DEFAULT_THEME_ID',
    ),
    defaultBuild: design[1],
    defaultPattern: design[2],
    defaultWallpaper: pick(
      'src/art/wallpaperDesign.ts',
      /export const DEFAULT_WALLPAPER_ID = '([^']+)'/,
      'DEFAULT_WALLPAPER_ID',
    ),
  };
}

const previous = readShotsManifest();
/*
 * `--only` MERGES. Each shot carries its own `at` and `commit`, so a re-take of
 * one picture cannot quietly re-date the twelve it did not touch — which is the
 * same lie the three-script split used to tell, one field down.
 */
const kept = new Map((previous?.shots ?? []).map((s) => [s.file, s]));
for (const entry of taken) kept.set(entry.file, entry);
// A picture nobody took and nobody has is not a record, it is a rumour.
for (const file of [...kept.keys()]) {
  if (!shotFiles().includes(file)) kept.delete(file);
}

const manifest = {
  $schema: 'see scripts/check-readme.mjs — checkShots()',
  capturedBy: 'shots-now/readme-shots.mjs',
  // The LAST run. Per-shot provenance is on each entry below.
  lastRunAt: RUN_AT,
  app: appIdentity(),
  commit: HEAD,
  viewport: { ...VIEWPORT, scale: SCALE },
  depicts: depicts(),
  sources: sourceDigests(),
  shots: [...kept.values()].sort((a, b) => (a.file < b.file ? -1 : 1)),
};
writeFileSync(join(ROOT, SHOTS_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`\nwrote ${SHOTS_MANIFEST} — ${manifest.shots.length} shot(s)`);
console.log(`  app     ${manifest.app.product} ${manifest.app.version}`);
console.log(`  commit  ${manifest.commit.short}${manifest.commit.dirty ? ' (dirty)' : ''}`);
console.log(`  room    ${Object.values(manifest.depicts).slice(1).join(' / ')}`);
console.log('errors:', errors.size === 0 ? 'none' : [...errors.entries()]);
