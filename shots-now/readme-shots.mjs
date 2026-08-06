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
 *  - the shelf carries sixty books over three FULL floors (sixty-one with the
 *    Welcome book, which is the count the studio card prints), because a
 *    part-filled floor is centred by `layout.ts` and photographs as an island
 *    of books in the middle of an empty case;
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
 * ## A run that cannot finish leaves the previous set exactly as it found it
 *
 * The 0.4.0 recapture died two thirds of the way down this file: `openRailPanel`
 * spent its full two minutes waiting for "Customize this book" on a dev server
 * that three other workflows were saving files into, and Playwright threw. By
 * then **seven pictures had already been written over the real ones**. Every one
 * of those seven was a valid PNG of a working app and not one of them was wrong
 * on its own — but the set as a whole was half 0.3.0 and half 0.4.0, which is
 * the one state nothing here could see. The manifest is what `checkShots()`
 * compares against the tree, and the manifest is written last, so it still
 * described the old set; the only tell that anything had happened at all was a
 * version string, and the repair was `git checkout` over files somebody first
 * had to work out were bad.
 *
 * So the run is now atomic at the set level. Every shot is taken into a staging
 * directory outside the repo, the manifest is written there too, and the whole
 * lot is moved over `docs/readme/img/` in one pass at the very end — see
 * {@link STAGING} and {@link commitShots}. A run that throws, times out or is
 * killed touches nothing the README shows.
 *
 * And a step that fails is retried before the run gives up on it ({@link step}):
 * a rail panel that will not open in 120s mid-HMR is a busy dev server far more
 * often than it is a broken app, so the page is reloaded and that ONE shot is
 * taken again, twice, with each retry printed. A slow run should be visible
 * rather than mysterious.
 *
 * ## Usage
 *
 *   npm run dev                                 (a dev server on :1420)
 *   node shots-now/readme-shots.mjs
 *
 * A DEV SERVER, not `vite preview` on a build. This script drives the app
 * through `import('/src/state/app.ts')` in a few places, and those URLs exist
 * only while Vite is serving source — against a production preview every one of
 * them is "Failed to fetch dynamically imported module". (The demo GIF is the
 * opposite case and IS recorded against a build: it photographs timing, and a
 * dev server's on-demand module graph makes the app look slower than it ships.)
 *   node shots-now/readme-shots.mjs --only=hero,spread     one or two of them
 *   node shots-now/readme-shots.mjs --url=http://localhost:1431
 *   node shots-now/readme-shots.mjs --sabotage=studio      break it on purpose
 *
 * `--only` rewrites just those entries in the manifest and leaves the rest
 * alone, so a single re-take does not claim the others were taken with it.
 *
 * `--sabotage=<shot>` makes that one shot throw once it has been taken, which is
 * how the paragraph above is checked rather than believed — see the note on the
 * flag itself. *"A gate you have not watched fail is not a gate"*, and this one
 * guards against a silent bad outcome, which is the worst kind.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ROOT,
  SHOTS_DIR,
  SHOTS_MANIFEST,
  appIdentity,
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

/**
 * The one URL every app shot is taken at, and BOTH parameters are load-bearing.
 *
 * `fx=force` is the old one: headless Chromium reports no WebGL worth having,
 * and without it the shelf draws in its reduced mode and the README shows an
 * app nobody runs.
 *
 * `dev=0` is the new one, and it fixes a defect that had shipped into every
 * picture on the front page. `App.tsx`'s `devChromeEnabled()` falls through to
 * `import.meta.env.DEV`, which is TRUE on the dev server these shots are taken
 * against — so the dev-only "shelf | book" view switcher was pinned over the
 * bottom-right corner of every single one of them, half across the page-curl
 * dog-ear. The README was showing readers a control the installed app does not
 * have, sitting on top of one it does. The gate already accepted `dev=0`;
 * nothing ever passed it.
 *
 * `tests/readme.test.ts` pins this line by READING this file rather than
 * importing it — importing would launch Playwright, because everything here
 * runs at the top level. The failure is otherwise silent: the shots still
 * render, still pass every size and freshness check, and the pill is small
 * enough to read as part of the app.
 */
const SHOT_URL = `${URL_BASE}/?fx=force&dev=0`;
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const wanted = (name) => ONLY.length === 0 || ONLY.includes(name);

/**
 * The name of one shot that is to fail on purpose, or ''.
 *
 * Not a debug aid and not dead weight: the guarantee this file now makes — *a
 * run that cannot finish leaves the committed pictures alone* — is a guarantee
 * about the FAILURE path, and a failure path nobody has walked is a guess. The
 * repo's own rule for this is `probe-studio-repaint.mjs --sabotage`: break the
 * thing deliberately, watch the check go red, and only then believe it.
 *
 * The throw lands in {@link shot}, AFTER the screenshot has been written, so the
 * staging directory holds a genuine half-set at the moment the run dies — which
 * is the shape of the real accident. What has to be true afterwards: the run
 * exits non-zero, `git status` shows `docs/readme/img/` untouched, and the
 * half-set is somewhere obviously named as debris.
 */
const SABOTAGE = opt('sabotage', '');

/* --------------------------- staging, and why ----------------------------- */

/**
 * Where the pictures live until every one of them has been taken.
 *
 * Outside the repo on purpose. Anywhere inside it and the half-set becomes
 * something `git status` has to be read past — and `docs/readme/img/` itself is
 * worse still, because `computeFacts()` counts every `.png` under that
 * directory RECURSIVELY, so a staging folder tucked in there would inflate
 * `readmeShots` and turn a capture run into a red README test.
 *
 * The directory is left behind when a run fails, and its name says what it is.
 * That is deliberate too: the pictures a failed run did manage to take are the
 * cheapest evidence of how far it got, and the alternative — deleting them — is
 * how you end up rerunning five minutes of capture to find out what step 10 did.
 */
const STAGING = mkdtempSync(join(tmpdir(), 'readme-shots-'));

/** `name.png` → its path in {@link STAGING}, for everything taken so far. */
const staged = new Map();

/** Flipped by {@link commitShots} once the set is really on disk. */
let committed = false;

/**
 * Say so on the way out, however the run ended.
 *
 * The whole point of the staging directory is that a wrecked run is INVISIBLE
 * in the repo afterwards, and something invisible needs saying out loud or the
 * next person assumes the pictures moved.
 */
process.on('exit', () => {
  if (committed) return;
  console.log(
    `\nNOTHING WAS COMMITTED — ${SHOTS_DIR} is byte for byte as this run found it.\n` +
      `  ${staged.size} shot(s) were staged; they are in ${STAGING}`,
  );
});

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
 * Sized by ARITHMETIC, after two rounds of sizing it by looking and getting it
 * wrong in both directions. Ten on a floor read as a showroom. Eleven — the
 * count that replaced it — read as sparse for a reason the picture makes
 * obvious once you know to look: `layout.ts` deliberately CENTRES a part-filled
 * row ("left-packing would be just as truthful, but it makes the case look
 * lopsided"), so eleven books do not sit at the left end of a wide case, they
 * sit as an island in the middle of it with empty arches on both sides. The
 * README's headline picture was a mostly-empty bookcase.
 *
 * The number that fills a floor falls straight out of the layout constants:
 * `avail = SHELF_WIDTH - 2 * LAYOUT_MARGIN_X` = 1200 - 2 x 64 = 1072 world px,
 * and a spine with its gap averages a little over 50 across the width band the
 * factory draws, so twenty is a full row with the ends still breathing.
 *
 * Three full floors over an empty arcade is also the more honest picture: a
 * library somebody has been keeping for a while, rather than one they opened
 * yesterday.
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
  'Rock Pools',
  'Tea',
  'First Aid',
  'Allotment',
  'Sea Glass',
  'Hedgerows',
  'Night Sky',
  'Bread',
  'Cold Frames',
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
  'Moths',
  'Orchards',
  'Stone Walls',
  'Cyanotype',
  'Beekeeping',
  'Lichen',
  'Seed Saving',
  'Rivers',
  'Paper Marbling',
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
  'Ferns',
  'Tide Tables',
  'Birds',
  'Rope Work',
  'Fermenting',
  'Woodcuts',
  'Constellations',
  'Frost Dates',
  'Bookbinding',
  'Hill Walks',
  'Winter Notes',
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
 * `{ bytes, sha256, width, height }` for a PNG at an absolute path.
 *
 * A near-copy of `measureShot()` in `scripts/check-readme.mjs`, and the
 * duplication is the point rather than an oversight. That one reads
 * `docs/readme/img/<file>`, which is exactly right for the CHECKER — it measures
 * the picture the README actually shows — and exactly wrong here, where the
 * picture has deliberately not got there yet. Called against a staged shot it
 * would measure the PREVIOUS release's file and write that digest into the new
 * manifest: a manifest that describes one set while the directory holds another
 * is a worse lie than the one this file exists to stop telling.
 */
function measurePng(abs) {
  const buf = readFileSync(abs);
  // IHDR is the first chunk of every PNG: 8-byte signature, 4-byte length,
  // 4-byte type, then width and height as big-endian uint32.
  const png = buf.length > 24 && buf.readUInt32BE(12) === 0x49484452;
  return {
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16),
    width: png ? buf.readUInt32BE(16) : 0,
    height: png ? buf.readUInt32BE(20) : 0,
  };
}

/**
 * Shoot the whole viewport into {@link STAGING} — never straight into
 * `docs/readme/img/`, for the reason in this file's header.
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
  const file = `${name}.png`;
  const path = join(STAGING, file);
  await page.screenshot({
    path,
    animations: freeze ? 'disabled' : 'allow',
    caret: 'hide',
  });
  // Thrown here rather than at the top of the function so the staging directory
  // holds a real, complete picture that never reaches the README — the shape of
  // the accident being guarded against, not a cartoon of it.
  if (SABOTAGE === name) {
    throw new Error(`readme-shots: --sabotage=${name}, so this shot fails on purpose`);
  }
  staged.set(file, path);
  const m = measurePng(path);
  taken.push({ file, ...m, at: RUN_AT, commit: STAMP });
  console.log(`  ${name}.png  ${m.width}×${m.height}  ${(m.bytes / 1024).toFixed(0)} kB`);
}

const wait = (page, ms) => page.waitForTimeout(ms);

/* ------------------------- one step, and its retries ---------------------- */

/** How many goes a step gets before the run gives up on it. */
const STEP_ATTEMPTS = 3;

/** What each step cost and what it took — printed as the report at the end. */
const timings = [];

/**
 * Put the app back to a known state WITHOUT touching the library.
 *
 * A plain reload, and emphatically not the boot at section 2: that one clears
 * localStorage first, which is where the browser build keeps its SQLite stand-in
 * (`src/data/db.ts` — "tables persist to localStorage, so a book created in the
 * browser survives"). Booting that way mid-run would throw away the sixty books
 * section 3 seeded and every picture after it would be of an empty case.
 *
 * What a reload does leave: no book open, every panel shut, the camera home at
 * 100%. That is the state each step below already has to reach from, which is
 * why a retry can simply be "reload, then do that step again".
 */
async function reboot(page) {
  await page.goto(SHOT_URL, { waitUntil: 'domcontentloaded' });
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
  await wait(page, 2500);
}

/**
 * Run one numbered section, and give it two more goes before the run dies.
 *
 * The failure this is for is not a broken app. `openRailPanel` waits 120s for a
 * sheet to slide in, and the thing that used up those 120s was a dev server
 * being written to by three other workflows — a Vite HMR update mid-click, the
 * toggle lost, the sheet never arriving. The app was fine the whole time; the
 * app is *always* fine the whole time in that failure. What it cost was the
 * other twenty-three pictures.
 *
 * So a step that throws gets a reload and another go. Three attempts, because
 * two is not enough to ride out a save-rebuild-save and four is long enough that
 * a genuinely broken step wastes eight minutes proving it. `page` may be null
 * for the sections that boot their own page — those retry by booting again,
 * which is the same idea with a bigger hammer.
 *
 * Every attempt is announced. A run that is quietly taking three times as long
 * as it should is indistinguishable from a hung one, and the person watching it
 * has no way to tell which without this.
 *
 * The body is handed its attempt number, because one step cannot simply be done
 * twice — see section 13, which WRITES to a book.
 */
async function step(page, label, body) {
  const began = Date.now();
  for (let attempt = 1; attempt <= STEP_ATTEMPTS; attempt += 1) {
    console.log(`\n${label}${attempt > 1 ? `  (attempt ${attempt}/${STEP_ATTEMPTS})` : ''}`);
    try {
      await body(attempt);
      timings.push({ label, ms: Date.now() - began, attempts: attempt });
      return;
    } catch (err) {
      const why = String(err?.message ?? err).split('\n')[0];
      if (attempt === STEP_ATTEMPTS) {
        timings.push({ label, ms: Date.now() - began, attempts: attempt, failed: why });
        console.log(`   ✗ ${label} failed ${STEP_ATTEMPTS} times, giving up: ${why}`);
        // Let the browser go before the throw unwinds. Node will not exit while
        // Playwright still holds a live one, and a run that has already decided
        // to fail should fail rather than hang.
        await browser.close().catch(() => {});
        throw err;
      }
      console.log(`   ! ${label} attempt ${attempt}/${STEP_ATTEMPTS} failed: ${why}`);
      console.log('     reloading the app and taking that step again');
      if (page !== null) await reboot(page).catch(() => {});
    }
  }
}

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
 *
 * ## Which leaf, and why it is asked rather than told
 *
 * This used to take the side as an argument, and both call sites passed a
 * guess. That is wrong, and it failed intermittently in a way that looked like
 * a regression in the app: **there is one editor per page**, so a spread holds
 * two independent ProseMirror states, and a NodeSelection lives in the state of
 * the page that owns the node. Clicking blank space on the RIGHT leaf focuses
 * the right editor and does nothing whatever to a selection sitting in the
 * left one — the node keeps `props.selected`, keeps its dashed frame, and the
 * guard fires. Whether that happened depended on which leaf the diagram
 * paginated onto, so the same script passed and failed on the same commit as
 * the Welcome book's length drifted.
 *
 * So the leaf is now READ from the selection rather than assumed, every leaf
 * holding one is clicked, and the whole thing is retried — a click that lands
 * while the flip is still settling is a click on a moving target.
 */
async function clearNodeSelection(page) {
  /** The leaves that actually own a selected diagram, front to back. */
  const owningSides = () =>
    page.evaluate(() => {
      const sides = new Set();
      for (const el of document.querySelectorAll('.nb-diagram.is-selected')) {
        if (el.closest('.nb-flip-leaf-left')) sides.add('left');
        else if (el.closest('.nb-flip-leaf-right')) sides.add('right');
      }
      return [...sides];
    });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sides = await owningSides();
    if (sides.length === 0) break;
    for (const side of sides) {
      const leaf = await page.locator(`.nb-flip-leaf-${side}`).boundingBox();
      if (leaf === null) continue;
      await page.mouse.click(leaf.x + leaf.width * 0.45, leaf.y + leaf.height * 0.95);
      await wait(page, 1400);
    }
  }

  const left = await owningSides();
  if (left.length > 0) {
    throw new Error(
      `readme-shots: a diagram on the ${left.join(' and ')} leaf will not deselect — ` +
        'its edit chrome is showing',
    );
  }

  /*
   * And then move the caret off any EMPTY block, which is a second piece of
   * edit chrome and had to be chased separately.
   *
   * Moving the selection off a diagram parks the caret in the blank ruled line
   * that was clicked, and TipTap's placeholder then writes "Type / for
   * commands..." into it — so the dashed frame is traded for a whisper rather
   * than removed. Blurring does NOT fix this and it is worth saying why: the
   * placeholder decoration follows the selection ANCHOR, not the focus, so a
   * blurred editor whose selection still sits in an empty paragraph keeps its
   * placeholder.
   *
   * That whisper is NOT chased any further, and the reason is worth recording
   * so nobody spends the afternoon on it twice. The rule in the extension is
   * `(hasAnchor || !showOnlyCurrent) && isEmpty`, and `showOnlyCurrent`
   * defaults to true — so it appears on exactly the empty block holding the
   * caret. That is the app's own designed affordance for a blank trailing line
   * (editor.css calls it "a soft pencil whisper"), which means a page shot
   * with a caret in blank space is showing a reader something real rather than
   * a capture artefact. Two attempts to move the anchor off it — Ctrl+Home,
   * then clicking the page heading — bought nothing and the second left the
   * back button sitting expanded, which is a worse thing to photograph than
   * the whisper.
   *
   * The blur stays: it costs nothing and keeps a caret from blinking mid-shot.
   */
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await wait(page, 600);
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

/**
 * Open the settings sheet and wait until it is really open.
 *
 * `.nbs-sheet` is MOUNTED whether the sheet is up or not — the same trap as the
 * rail panels, and `waitForSelector` reports "62 x locator resolved to hidden"
 * and then times out. So this presses the seal by its own class rather than by
 * an accessible name that also matches other things, and waits on POSITION
 * through `onScreen`, which is the honest signal everywhere else in this file.
 */
async function openSettings(target) {
  /*
   * REAL visibility, not `onScreen`. The rail panels are parked off-canvas when
   * shut, so position is the honest signal for them; the settings sheet is a
   * different animal — it stays where it is and goes `visibility: hidden`, so
   * `onScreen` answered true for a shut sheet and this returned happily, and
   * the next line then spent two minutes trying to type into a search box
   * nobody could see.
   */
  const up = () => target.locator('.nbs-sheet').first().isVisible();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await up())) await target.locator('.nbs-gear-button').first().click({ force: true });
    for (let i = 0; i < 30; i += 1) {
      if (await up()) {
        await wait(target, 1200);
        return;
      }
      await wait(target, 400);
    }
    console.log(`   retry ${attempt + 1}: the settings seal did not open the sheet`);
  }
  throw new Error('readme-shots: the settings sheet would not open');
}

/**
 * Scroll the open settings sheet until one of its section headings sits just
 * under the sticky header.
 *
 * The sheet is 3,200px of paper behind a 940px window, so "open the settings"
 * is not an instruction that says which settings — whatever the last shot left
 * the scroll position at is what gets photographed. Asked for by the heading's
 * own text, not by an offset, because an offset is a count and the sheet grows
 * a row most weeks.
 *
 * ## The search box was tried first, and it is the wrong tool for this picture
 *
 * `search the settings…` looked like the honest way to reach Sound: it is the
 * feature built for exactly this, `pressSettingsRow` below already uses it, and
 * a query REVEALS collapsed groups. That last part is the problem. `Chapter` in
 * `SettingsPanel.tsx` answers a query that its own heading covers by handing
 * every row beneath it an empty term list — so "sound" lays out the whole
 * chapter — and the section's disclosures are written as `!searching()`, so the
 * shortlist of seven sets and its "more sound sets · show all 28" button fold
 * away and all TWENTY-EIGHT chips unroll in their place. The frame that comes
 * back is 940px of sound-set chips: no sliders, no ambience, no credits, and
 * nothing that says how many sets there are. Scrolled to instead, the same
 * section arrives in its resting shape and the whole mixer is in one frame.
 */
async function scrollSettingsTo(target, section) {
  const moved = await target.evaluate((name) => {
    const sheet = document.querySelector('.nbs-sheet');
    if (sheet === null) return 'the settings sheet is not in the DOM';
    const head = [...sheet.querySelectorAll('.nbs-section-title')].find(
      (el) => (el.textContent ?? '').trim().toLowerCase() === name.toLowerCase(),
    );
    if (head === undefined) return `the settings sheet has no “${name}” section`;
    const header = sheet.querySelector('.nbs-header');
    sheet.scrollTop +=
      head.getBoundingClientRect().top - (header?.getBoundingClientRect().bottom ?? 0) - 12;
    return sheet.scrollTop;
  }, section);
  if (typeof moved === 'string') throw new Error(`readme-shots: ${moved}`);
}

/**
 * Park the camera at a percentage before photographing anything with the shelf
 * behind it.
 *
 * Step 5 pulls the case all the way out to the 38% floor to photograph it as
 * one object, and the camera STAYS there for the rest of the run — so the
 * settings sheet was shot over a bookcase eight floors tall with three thin
 * rows of colour in the top of it. The reader's report on that picture was
 * "does not show sound options and just shows a very long shelf", and the
 * second half of that sentence is this line. 80% is where `shelf.png` and
 * `box.png` are taken, which is the zoom a book is still a book at.
 *
 * Driven through the pill's own buttons rather than through `world`, for the
 * reason every probe in this repo is driven that way: a dev server that has
 * served HMR updates can resolve an `import()` to a SECOND copy of a module,
 * and writes to that copy reach nothing. The reset button goes first because
 * the notches are multiplicative — six out and six back does not come home —
 * and 100% is the one position that can be asked for by name.
 */
async function parkZoom(target, percent) {
  if (percent > 100) throw new Error('readme-shots: parkZoom only ever comes down from 100%');
  const pill = target.locator('.shelf-zoom-pill__pct').first();
  if ((await pill.count()) === 0) throw new Error('readme-shots: no zoom pill — is the shelf up?');
  const read = async () =>
    Number.parseInt(((await pill.textContent()) ?? '').replace(/\D/g, ''), 10);
  /*
   * The number when it has STOPPED, which is the only reading worth having and
   * took two wrong pictures to arrive at. The camera tweens in log-zoom space
   * and the pill renders every frame of it, so a press from 100% is followed by
   * a second or so of 96, 92, 87 … 80 — and both cheaper reads get it wrong in
   * the same direction. Sleeping 400ms and reading gives 100 (stale, "that
   * press did nothing", press again); polling until the number CHANGES gives 89
   * (mid-tween, "still above 80", press again). Either way the loop pressed
   * twice and the settings sheet was photographed at 64% under a line of code
   * that asks for 80. Two equal readings in a row is the honest one.
   */
  const settled = async () => {
    let last = NaN;
    for (let poll = 0; poll < 24; poll += 1) {
      const now = await read();
      if (now === last) return now;
      last = now;
      await wait(target, 250);
    }
    return last;
  };
  await pill.click({ force: true });
  const zoomOut = target.getByRole('button', { name: /Zoom out/i }).first();
  for (let i = 0; i < 12; i += 1) {
    const now = await settled();
    if (Number.isNaN(now) || now <= percent) break;
    await zoomOut.click({ force: true });
    // A press that leaves the number where it was is the camera's own floor
    // (`minZoomFor`) answering. Photograph the wrong zoom rather than stand
    // here pressing a button that has stopped meaning anything.
    if ((await settled()) === now) break;
  }
  await wait(target, 1400);
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
  // Its own page, so a retry boots its own page too — `step` is passed null and
  // reloads nothing. The `finally` is what makes that safe: without it a failed
  // attempt would leak a page and the retry would photograph in a second one.
  await step(null, '1. the banner', async () => {
    const heroPage = await browser.newPage({
      viewport: { width: HERO.width, height: HERO.height },
      deviceScaleFactor: HERO.scale,
    });
    try {
      await heroPage.goto(pathToFileURL(resolve(ROOT, 'shots-now/readme-hero.html')).href, {
        waitUntil: 'networkidle',
      });
      await heroPage.evaluate(() => document.fonts.ready);
      await heroPage.waitForTimeout(600);
      await shot(heroPage, 'hero');
    } finally {
      await heroPage.close().catch(() => {});
    }
  });
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
  // Sections 13-16 below. Leaving these out is not "they get skipped by
  // default" — the whole `if (appShots.some(wanted))` block is gated on this
  // list, so `--only=share` opened a browser, booted the app and photographed
  // nothing at all.
  'share',
  'focus',
  'keyboard',
  // One open of the settings sheet, two frames of it — the top of the sheet for
  // "Making it yours", and the Sound section for "Sound". Both names have to be
  // here or `--only=appearance` boots a browser and photographs nothing.
  'appearance',
  'settings',
  // Sections 19-21: the three surfaces Part 1 described in prose and never
  // showed, once every other section had a picture beside it.
  'rail',
  'ai',
  'transfer',
];

if (appShots.some(wanted)) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => {
    const k = e.message.split('\n')[0];
    errors.set(k, (errors.get(k) ?? 0) + 1);
  });

  // The ONE place localStorage is cleared. `reboot()` below deliberately does
  // not: everything from section 3 on stands on a library that lives there.
  await step(null, '2. boot', async () => {
    await page.goto(SHOT_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await reboot(page);
  });

  /* --------------------------- 3. stock the shelf ------------------------- */

  /*
   * Seeded OUTSIDE the retry, and that is not an oversight. `__shelfSeedBooks`
   * fills from `nextFreeSlot`, so seeding twice does not re-seed — it adds sixty
   * MORE books, on top of the sixty already there, and the picture that comes
   * back is of a case nobody has. A step is only safe to retry if doing it twice
   * is the same as doing it once; this one is not, so only the shot is retried
   * and a failure to seed ends the run honestly.
   */
  console.log('\n3. stock the shelf');
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 0), FLOOR_0);
  await wait(page, 1500);
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 1), FLOOR_1);
  await wait(page, 1500);
  await page.evaluate((t) => globalThis.__shelfSeedBooks(t, 2), FLOOR_2);
  await wait(page, 4500);
  if (wanted('shelf')) {
    await step(page, '3. the stocked shelf', async () => {
      await settle(page);
      await wait(page, 2500);
      await shot(page, 'shelf');
    });
  }

  /* --------------------------- 4. the library studio ---------------------- */

  /*
   * Before the zoom-out, and that ordering is load-bearing. The wheel is not
   * symmetric — six notches out and six notches back landed the camera at 250%,
   * and the first run of this script photographed the studio against four
   * gigantic empty arches because of it. Everything that needs the reading
   * zoom therefore happens while the camera has never been touched.
   */
  if (wanted('studio')) {
    // A reload puts the camera back at 100% with nothing open, which is exactly
    // the state this step wants — so the retry needs no restoring of its own.
    await step(page, '4. the library studio', async () => {
      await openRailPanel(page, '.shelf-dock', /Library studio/, '.nb-library-studio');
      await shot(page, 'studio');
      await closeRailPanel(page, '.nb-library-studio', 'Library studio');
    });
  }

  /* ------------------------- 5. the case as one object -------------------- */

  if (wanted('shelf-zoomout')) {
    await step(page, '5. pull the camera back', async () => {
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
       *
       * Written as a walk to the floor rather than as a number of presses, which
       * is also what makes it safe to retry: a reload leaves the camera at 100%,
       * and this arrives at the same place from wherever it starts.
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
    });
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

  /*
   * Open the Welcome book if it is not already open, and say nothing if it is.
   *
   * Two jobs, and it grew the second one. The first: the sections at the bottom
   * of this file have to stand on their own, because `--only` skips whatever came
   * before them, and the rail only exists INSIDE a book — the first version of
   * those went looking for "In and out" on a bare shelf and spent two minutes
   * timing out on a button that could not be there.
   *
   * The second: it is how a RETRY gets back. `reboot()` puts the book away with
   * everything else, so every step between here and section 12 begins by asking
   * for the book again rather than assuming the last step left it open. On the
   * first attempt that costs one `count()`.
   */
  const ensureBookOpen = async () => {
    if ((await page.locator('.nb-rail').count()) > 0) return;
    await page.evaluate(async () => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      const list = await books.listBooksByFloorRange(0, 20);
      const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
      app.appState.openBook(welcome.id);
    });
    await page.waitForSelector('.nb-prose', { timeout: 60_000 });
    await settle(page);
    await wait(page, 2500);
  };

  if (needsBook) {
    await step(page, '6. open the Welcome book', async () => {
      await ensureBookOpen();
      await page.waitForSelector('.nb-rail', { timeout: 60_000 });
      await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
      // Long, and on purpose: the flip's page snapshots (html-to-image, ~200ms of
      // main thread each) are taken at IDLE, and under SwiftShader idle arrives
      // late. Photographing the curl before they land gives a leaf with grey
      // where the paper should be — which is exactly what the first run produced.
      await wait(page, 9000);
      if (wanted('spread')) await shot(page, 'spread');
    });
  }

  /* ----------------------------- 7. the page turn ------------------------- */

  if (wanted('page-turn')) {
    await step(page, '7. hold the curl half-way', async () => {
      await ensureBookOpen();
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
    });
  }

  /* ----------------------------- 8. the slash menu ------------------------ */

  if (wanted('slash')) {
    await step(page, '8. the slash menu', async () => {
      await ensureBookOpen();
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
    });
  }

  /* ------------------------------ 9. the catalogue ------------------------ */

  if (wanted('catalogue')) {
    await step(page, '9. the catalogue', async () => {
      await ensureBookOpen();
      await openRailPanel(page, '.nb-rail', /Catalogue/, '.nb-catalogue');
      await shot(page, 'catalogue');
      await closeRailPanel(page, '.nb-catalogue', 'Catalogue');
    });
  }

  /* ----------------------------- 10. the book studio ---------------------- */

  /*
   * The step that killed the 0.4.0 run: `openRailPanel` waited its full two
   * minutes for "Customize this book" while the dev server was rebuilding under
   * it, threw, and took twenty-three other pictures down with it — seven of them
   * already written over the real ones. Both halves of that are fixed, and this
   * is the one to watch: a reload and two more goes, over a set that is not on
   * disk yet either way.
   */
  if (wanted('book-studio')) {
    await step(page, '10. the book studio', async () => {
      await ensureBookOpen();
      await openRailPanel(page, '.nb-rail', /Customize this book/, '.nb-book-studio');
      await shot(page, 'book-studio');
      await closeRailPanel(page, '.nb-book-studio', 'Customize this book');
    });
  }

  /* --------------------------- 11. the quick switcher --------------------- */

  if (wanted('quickswitch')) {
    await step(page, '11. the quick switcher', async () => {
      await ensureBookOpen();
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
    });
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
  /*
   * Lifted into a named function rather than wrapped in place, purely so that
   * handing it to `step` does not move a hundred and eighty lines of hard-bought
   * comment two spaces to the right in the diff. Sections with a short body are
   * wrapped inline above; these two are long enough that the churn would be the
   * only thing anybody could see in the change.
   */
  const shootDiagramSpread = async () => {
    await ensureBookOpen();
    /*
     * FOUND, not counted. This used to press ArrowRight twice, because the
     * decorated spread was the third one; the day the Welcome book grew a page
     * that stopped being true, and the shot became two blank ruled leaves with
     * a placeholder on them — a worse picture than the stale one it replaced.
     * Flipping until the spread is the picture is the same instruction stated
     * as a fact about the page rather than as a count.
     *
     * ## The leaf that HOLDS the chapter, not the leaf that names it
     *
     * The condition was "any `.nb-diagram` is on screen", and it stopped on the
     * first one it met — the third spread of the tour, "A library of your own"
     * facing "Dressing a book". That spread holds one small tree of bookcases
     * and is otherwise about leather and raised cords, and it sat under the
     * README's **Diagrams** section, which promises five kinds of diagram drawn
     * rather than embedded. One leaf out of two, and the wrong one.
     *
     * What is wanted is the tour's own diagram chapter — `src/data/seed.ts`
     * page 17, "Diagrams, drawn by hand": the hand-drawn `tree`, and the "Five
     * fences, no library" card that names all five kinds and says every line of
     * every one of them is drawn on the page.
     *
     * Matching its HEADING was tried first and produced two pages of cats and
     * columns. A heading is a block like any other, so the pagination contract
     * routinely leaves `# Diagrams, drawn by hand` as the last ruled line of
     * the PREVIOUS leaf and starts the chapter's body at the top of the facing
     * one — which means the leaf whose h1 says "Diagrams, drawn by hand" is
     * reliably the leaf that shows something else. So the walk looks for the
     * chapter's BODY instead: a leaf with a drawn diagram on it and the words
     * of its card in it. That is a description of the picture rather than of
     * the table of contents, and it holds however the blocks fall.
     *
     * ## Why not "a diagram on each leaf", which was measured
     *
     * It sounds like the better rule, and there is exactly one spread in the
     * book that satisfies it — the mindmap facing the flowchart — and both of
     * its leaves OVERFLOW: 346px and 179px of blocks past the bottom of the
     * paper, which photographs as a sentence sliced in half by the page edge
     * ("A comma fans out to several / at once"). Waiting does not drain it;
     * fifteen further seconds left both numbers exactly where they were. Every
     * other spread in the book measures zero. So the assertions below check the
     * overflow rather than trusting it: a clipped spread is a failed run rather
     * than a shipped picture, and if the pagination contract starts draining
     * those two leaves this is the line that will let the better spread in.
     *
     * ## Asked of the two LEAVES, not of the document
     *
     * `document.querySelectorAll('.nb-diagram')` is not the spread, and that
     * cost a run to learn as well. The flip's snapshot cache mounts
     * neighbouring pages offscreen to rasterise them (`src/flip/`), so at any
     * instant the document holds two to nine `.nb-prose` roots and only two of
     * them are ones a reader can see — a document-wide count answers "a diagram
     * exists somewhere in the raster queue", which flickers true a spread early
     * and false again depending on when the idle callback ran.
     */
    const DIAGRAM_CARD = 'five fences, no library';
    const spread = () =>
      page.evaluate(() => {
        const side = (sel) => {
          const leaf = document.querySelector(sel);
          const prose = leaf?.querySelector('.nb-prose') ?? null;
          return {
            headings: [...(leaf?.querySelectorAll('.nb-prose h1') ?? [])].map((h) =>
              (h.textContent ?? '').trim(),
            ),
            diagrams: leaf?.querySelectorAll('.nb-diagram').length ?? 0,
            /*
             * `textContent` PLUS every `data-title`, and the second half is not
             * belt and braces — a card's title is not text. `containers.ts`
             * keeps it as a `data-title` attribute and `effects.css` paints it
             * with `content: attr(data-title)`, so the words "Five fences, no
             * library" are on the page, in the picture, legible to a reader,
             * and absent from `textContent` entirely. A run spent forty turns
             * walking off the end of the book looking for them.
             */
            text: [
              prose?.textContent ?? '',
              ...[...(prose?.querySelectorAll('[data-title]') ?? [])].map(
                (el) => el.getAttribute('data-title') ?? '',
              ),
            ]
              .join(' ')
              .toLowerCase(),
            // How far the written column runs past the paper it is written on.
            // Zero on every page the contract has finished with.
            over: prose === null ? 0 : Math.round(prose.scrollHeight - prose.clientHeight),
          };
        };
        return { left: side('.nb-flip-leaf-left'), right: side('.nb-flip-leaf-right') };
      });
    const holdsChapter = (side) => side.diagrams > 0 && side.text.includes(DIAGRAM_CARD);
    const isDrawnSpread = (now) => holdsChapter(now.left) || holdsChapter(now.right);
    /*
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
    /*
     * Eight turns as the book stands today, capped at forty, and the settle
     * between them is 4.5s rather than 3s. All three numbers were bought:
     *
     *  - the settle is long because the pagination contract is still moving
     *    blocks while the sheet lands. Turned every 3s, the walk read spreads
     *    that were still being peeled. What each turn costs here is a second
     *    and a half; what it costs to photograph a half-paginated spread is the
     *    whole run;
     *  - the cap is not "what it takes now plus one", because every page the
     *    tour gains ahead of the diagram run pushes this one turn further out —
     *    a tight cap is the counted version wearing a loop;
     *  - and it is FORTY rather than twelve because a walk of this book can
     *    lose its place. Anything that remounts the book view puts it back on
     *    the first spread, and on a dev server the commonest cause is somebody
     *    else saving a file — a Vite HMR update to `BookView.tsx` mid-walk
     *    threw one run back to spread one four separate times. A search picks
     *    itself up and carries on; a count of turns cannot, which is the third
     *    argument for searching — but only if the cap leaves room for detours.
     *
     * The headings are printed rather than kept, because when this cannot find
     * the spread the only useful thing to know is what it walked past.
     */
    let turns = 0;
    let now = await spread();
    while (turns < 40 && !isDrawnSpread(now)) {
      await tapForward();
      turns += 1;
      await wait(page, 4500);
      now = await spread();
      console.log(
        `   turn ${turns}: ${[...now.left.headings, '|', ...now.right.headings].join(' ')} ` +
          `(${now.left.diagrams}+${now.right.diagrams} drawn)`,
      );
    }
    if (!isDrawnSpread(now)) {
      throw new Error(
        `readme-shots: nothing carrying the “${DIAGRAM_CARD}” card and a drawn diagram in the ` +
          'first forty spreads of the tour — either the card was reworded in src/data/seed.ts ' +
          'or the diagram renderers are not drawing',
      );
    }
    // Asserted rather than assumed — the run is five minutes long and a wrong
    // picture looks exactly like a right one until somebody reads it.
    if (now.left.over > 0 || now.right.over > 0) {
      throw new Error(
        `readme-shots: the diagram spread is clipped (${now.left.over}px left, ` +
          `${now.right.over}px right past the paper) — the pagination contract has not ` +
          'drained these leaves and the shot would ship a sentence cut in half',
      );
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
    await clearNodeSelection(page);
    await shot(page, 'diagrams');
  };

  if (wanted('diagrams')) {
    await step(page, '12. flip to the diagrams spread', shootDiagramSpread);
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
  /*
   * Named for the same reason as section 12, and taking its attempt number for a
   * reason of its own: this step WRITES. If it dies after the Insert button and
   * before the picture, the book it chose is no longer empty, and doing the whole
   * thing again would photograph the script twice over — the wreckage the note
   * above is about, arrived at from the other direction. So each attempt takes
   * the next untouched title off the first floor. Twenty of them, three attempts,
   * and the picture is of a page rather than of a book's name.
   */
  const shootScript = async (attempt) => {
    await page.evaluate(async (title) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      const list = await books.listBooksByFloorRange(0, 20);
      const target = list.find((b) => b.title === title);
      if (!target) throw new Error(`readme-shots: no book called ${title}`);
      app.appState.closeBook();
      app.appState.openBook(target.id);
    }, FLOOR_0[attempt - 1]);
    await page.waitForSelector('.nb-rail', { timeout: 60_000 });
    await wait(page, 4000);
    /*
     * TWO clicks, because insert script is no longer a rail icon of its own.
     * Insert, export, the AI spec and start-from-a-template used to be four
     * separate icons down the rail and are now four rows on the "In and out"
     * sheet (see `src/views/rail/SharePanel.tsx`) — so this used to wait two
     * minutes for a button that no longer exists and then die on a timeout.
     *
     * The row is found by `data-share`, not by its label. The labels here are
     * composed at render time as "title — hint (key cap)" and are meant to be
     * rewritten whenever the wording improves; the id is the thing the panel
     * actually keys off, so matching it is matching what the app calls the row
     * rather than what it currently says about it.
     */
    await page.getByRole('button', { name: /In and out/i }).first().click({ force: true });
    await page.waitForSelector('[data-share="insert"]', { timeout: 30_000 });
    await page.locator('[data-share="insert"]').first().click({ force: true });
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
      await clearNodeSelection(page);
      await wait(page, 1200);
      await shot(page, 'script-page');
    } else {
      await page.keyboard.press('Escape');
    }
  };

  if (wanted('script-dialog') || wanted('script-page')) {
    await step(page, '13. insert a script into an empty book', shootScript);
  }

  /* --------------- 13. the sheets that had no picture at all -------------- */

  /*
   * Part 1 is read by somebody who has not installed anything yet, and the
   * reader's note about it was about intimidation rather than accuracy:
   * *"we want part 1 to have as many pictures as possible, to not intimidate
   * users."* Four of its ten sections described a surface in prose and never
   * showed it — the keyboard, sound and settings, everything going in and out,
   * and focus mode. These are those four.
   */
  if (wanted('share')) {
    await step(page, '13. in and out', async () => {
      await ensureBookOpen();
      // `.nb-share`, not `.nb-share-panel` — the sheet's root carries the short
      // name like `.nb-catalogue` and `.nb-toc` above it. Guessed wrong once, and
      // the cost was not an error: `openRailPanel` retries by CLICKING, so it sat
      // there toggling the sheet open and shut against a selector that could
      // never match.
      await openRailPanel(page, '.nb-rail', /In and out/, '.nb-share');
      await shot(page, 'share');
      await closeRailPanel(page, '.nb-share', 'In and out');
    });
  }

  if (wanted('focus')) {
    await step(page, '14. focus mode', async () => {
      await ensureBookOpen();
      await page.keyboard.press('F9');
      await settle(page);
      await wait(page, 1600);
      await shot(page, 'focus');
      await page.keyboard.press('F9');
      await settle(page);
      await wait(page, 900);
    });
  }

  if (wanted('keyboard')) {
    await step(page, '15. the cheat sheet', async () => {
      await ensureBookOpen();
      /*
       * `?` is the binding, and it is gated on not-typing — the caret is in a
       * page at this point, so pressing it straight away types a question mark
       * into the Welcome book and photographs nothing. Blur first, then use the
       * real key: driving `runCommand` through the probe's own import would risk
       * the second-module-copy trap, and going through the keyboard proves the
       * binding a reader would use actually works.
       */
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
      });
      await wait(page, 500);
      await page.keyboard.press('?');
      // Its own veil, so this is a modal over the spread rather than a rail
      // sheet — `openRailPanel` would wait for a slide that never happens.
      await page.waitForSelector('.nb-cheat-card', { timeout: 30_000 });
      await wait(page, 1400);
      await shot(page, 'keyboard');
      await page.keyboard.press('Escape');
      await wait(page, 900);
    });
  }

  /*
   * TWO pictures out of one sheet, because the sheet answers two of the
   * README's sections and used to answer neither.
   *
   * `settings.png` sits under **Sound**, and for a whole release it was the
   * settings sheet at its resting scroll position — which is the top, which is
   * Appearance. Nine theme chips, six hands, a body-size slider and an ink row,
   * under a heading about ambience beds and volume sliders. The picture was not
   * stale and not broken; it was of a different part of the app than the
   * paragraph beside it, which is the one failure a freshness check cannot see.
   *
   * The Appearance frame itself was never the problem — it is a good picture of
   * the deepest colour choices in the app, and **Making it yours** was the
   * longest section on the page with nothing to look at. So it keeps its frame
   * under its own name and Sound gets the section it is about.
   *
   * One open, two shots, one scroll between them: opening the sheet twice would
   * photograph two sheets and invite them to drift apart, which is the whole
   * argument for this file existing.
   */
  if (wanted('appearance') || wanted('settings')) {
    await step(page, '16. the settings sheet — appearance, then sound', async () => {
      // The seal lives in the window's bottom-left corner, outside the book, so
      // the book goes back on the shelf first. A reload has already done that,
      // which is why the retry needs nothing extra: closing a book that is not
      // open is a no-op, and `parkZoom` walks down from wherever it finds the
      // camera.
      await page.evaluate(async () => {
        const app = await import('/src/state/app.ts');
        app.appState.closeBook();
      });
      await page.waitForSelector('.shelf-dock', { timeout: 30_000 });
      await wait(page, 2000);
      await parkZoom(page, 80);
      await openSettings(page);
      await settle(page, '.nbs-sheet');
      await wait(page, 1400);
      if (wanted('appearance')) await shot(page, 'appearance');
      if (wanted('settings')) {
        await scrollSettingsTo(page, 'Sound');
        await wait(page, 1400);
        await shot(page, 'settings');
      }
      await page.keyboard.press('Escape');
      await wait(page, 900);
    });
  }


  /* ------------- 19-21. the three that were still only words ------------- */

  if (wanted('rail')) {
    await step(page, '19. the rail, end to end', async () => {
      await ensureBookOpen();
      // Hovered, so the shot carries a hand-drawn tooltip and the reader can see
      // what the icons ARE — a column of glyphs on its own explains nothing.
      const target = page.locator('.nb-rail .nb-rail-button').nth(3);
      const box = await target.boundingBox();
      if (box !== null) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await wait(page, 1400);
      }
      await shot(page, 'rail', { park: false });
    });
  }

  if (wanted('ai')) {
    await step(page, '20. the AI front door', async () => {
      await ensureBookOpen();
      /*
       * The EMPTY insert dialog, not the filled one. `script-dialog.png` shows a
       * script already pasted and belongs to the language section; what the AI
       * section is about is the invitation — "paste Notebook Script, from your AI
       * or your own pen" — and the button that hands the whole spec to a chatbot.
       */
      await openRailPanel(page, '.nb-rail', /In and out/, '.nb-share');
      await page.getByRole('button', { name: /Paste a script in/i }).first().click({ force: true });
      // `.nb-ins-card`, its own root. `[role="dialog"]` was the first guess and
      // matched eight things — every rail panel is a dialog too, and they are all
      // MOUNTED whether open or shut, so the wait resolved on a hidden one and
      // then timed out on visibility.
      await page.waitForSelector('.nb-ins-card', { timeout: 30_000 });
      await wait(page, 1600);
      await shot(page, 'ai');
      await page.keyboard.press('Escape');
      await wait(page, 900);
    });
  }

  if (wanted('transfer')) {
    await step(page, '21. the parcel desk', async () => {
      await ensureBookOpen();
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
      });
      await page.keyboard.press('Control+Shift+E');
      await page.waitForSelector('.nb-tr-box', { timeout: 30_000 });
      await settle(page, '.nb-tr-box');
      await wait(page, 1600);
      await shot(page, 'transfer');
      await page.keyboard.press('Escape');
      await wait(page, 900);
    });
  }

  await page.close();
}

/* ------------------- 17. the first launch, on a clean slate ---------------- */

/*
 * A PAGE PER SHOT, and both of them separate from everything above.
 *
 * Everything above runs after "skip the tour" has been pressed, because
 * twenty-two pictures of the app should not have a tour card sitting on them. The
 * two things a first-time reader actually meets first are the taste questions
 * and the tour, so they are taken here instead.
 *
 * NOT by clearing localStorage, which was the first attempt and timed out
 * waiting for a panel that was never going to open: the taste answers live in
 * the SQLite `settings` table (`tasteStore.ts`), so wiping web storage resets
 * nothing and the questionnaire stays answered. Each is reopened the way a
 * reader reopens it, from Settings — which has the side benefit of
 * photographing a state that is actually reachable.
 *
 * And each gets its OWN page because the two do not compose: answering the
 * questionnaire leaves a modal layer that swallows the next press of the
 * settings seal, so taking them in sequence on one page spent four retries
 * reporting "the settings seal did not open the sheet". Two pages cost one
 * extra boot and cannot interfere.
 */
async function bootFresh() {
  const fresh = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  fresh.setDefaultTimeout(120_000);
  await fresh.goto(SHOT_URL, { waitUntil: 'domcontentloaded' });
  await fresh.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await fresh.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await fresh.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  const skipFirst = fresh.getByText('skip the tour');
  if (await skipFirst.count()) {
    await skipFirst.first().click({ force: true });
    await wait(fresh, 900);
  }
  return fresh;
}

/**
 * Press one of the settings sheet's "start" buttons, found by the label of its
 * own row.
 *
 * Through the sheet's own SEARCH box, because the sections collapse and a row
 * inside a shut one is not there to click. Typing reveals collapsed groups,
 * which is exactly what the search was built to do, so this drives the feature
 * rather than working around it. Scoping to the row matters as well: two rows
 * carry a button that says "start", and a bare text match is a coin flip.
 */
async function pressSettingsRow(target, query, rowText) {
  await openSettings(target);
  await target.getByPlaceholder('search the settings…').first().fill(query);
  await wait(target, 900);
  await target
    .locator('.nbs-row', { hasText: rowText })
    .getByRole('button', { name: /^start$/ })
    .first()
    .click({ force: true });
}

/*
 * What you actually get, on the day you install it: one bookcase, ten floors,
 * and a single Welcome book. No sample library, no demo content to clear out.
 * `bootFresh` already skips the tour, so this is just the shelf.
 */
/*
 * These three retry by BOOTING AGAIN rather than by reloading — `step` is passed
 * null, and the body opens its own page every time. It is the same idea with a
 * bigger hammer, and it is free here because each of them already pays for a
 * boot. The `finally` is what stops a failed attempt leaking the page it was
 * using into the next one.
 */
if (wanted('box')) {
  await step(null, '22. what is in the box', async () => {
    const fresh = await bootFresh();
    try {
      await wait(fresh, 2500);
      await shot(fresh, 'box');
    } finally {
      await fresh.close().catch(() => {});
    }
  });
}

if (wanted('first-run')) {
  await step(null, '17. the taste questions', async () => {
    const fresh = await bootFresh();
    try {
      await pressSettingsRow(fresh, 'choose my look', 'choose my look again');
      await fresh.waitForSelector('.nbq-layer', { timeout: 60_000 });
      await wait(fresh, 2200);
      await shot(fresh, 'first-run');
    } finally {
      await fresh.close().catch(() => {});
    }
  });
}

if (wanted('tour')) {
  await step(null, '18. the guided tour', async () => {
    const fresh = await bootFresh();
    try {
      await pressSettingsRow(fresh, 'replay', 'replay the tour');
      await fresh.waitForSelector('.nbt-card', { timeout: 60_000 });
      /*
       * Long enough for the card to have finished arriving AND for its pencil
       * arrow to have drawn itself on — the arrow is the part that says what the
       * card is pointing at, and a shot taken at 1s catches it half-drawn.
       */
      await wait(fresh, 3200);
      await shot(fresh, 'tour');
    } finally {
      await fresh.close().catch(() => {});
    }
  });
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
/*
 * A picture nobody took and nobody has is not a record, it is a rumour.
 *
 * Asked of the set as it will be AFTER the commit below, not as it is now:
 * `shotFiles()` reads `docs/readme/img/`, and a shot taken for the first time
 * this run is not there yet. Asked the old way, a brand new picture would be
 * staged, committed, and then deleted from its own manifest — present on disk,
 * unrecorded, and reported by `checkShots()` as "nothing knows how old it is".
 */
const willExist = new Set([...shotFiles(), ...staged.keys()]);
for (const file of [...kept.keys()]) {
  if (!willExist.has(file)) kept.delete(file);
}

/*
 * THE SET'S IDENTITY IS ONLY REWRITTEN BY A RUN THAT TOOK THE WHOLE SET.
 *
 * `app`, `depicts` and `sources` describe the twenty-four PICTURES, not the
 * run: "these are what the app looked like at this version, in this room, with
 * these sources". `--only=hero` takes one of them and leaves twenty-three alone —
 * and used to stamp today's tree onto all twenty-four anyway, which is a
 * strictly worse outcome than the drift it was meant to record. `checkShots()`
 * compares this block against the tree, so a one-shot run silenced the
 * "pictures are 0.3.0, the app says 0.4.0" alarm for the entire set. The
 * pictures did not change. The only thing that changed was the alarm.
 *
 * Found while testing the staging work, by hitting it: a partial run had to be
 * reverted by hand because the manifest quietly agreed with a tree the pictures
 * had never seen. Same family as the half-set this run is built to prevent — a
 * result that looks fine and is not.
 *
 * So a partial run keeps whatever the previous manifest said, and prints that
 * it did. `lastRunAt`, `commit` and the per-shot provenance still move, because
 * those describe the run and the individual pictures it did take, both of which
 * are true.
 */
const complete = ONLY.length === 0;
const identity = complete
  ? { app: appIdentity(), depicts: depicts(), sources: sourceDigests() }
  : {
      app: previous?.app ?? appIdentity(),
      depicts: previous?.depicts ?? depicts(),
      sources: previous?.sources ?? sourceDigests(),
    };
if (!complete) {
  console.log(
    `\n  PARTIAL RUN (--only) — the set's identity is left at ${identity.app?.version ?? '?'}` +
      ` as the previous manifest recorded it.\n  Only a full run may say what the whole set depicts.`,
  );
}

const manifest = {
  $schema: 'see scripts/check-readme.mjs — checkShots()',
  capturedBy: 'shots-now/readme-shots.mjs',
  // The LAST run. Per-shot provenance is on each entry below.
  lastRunAt: RUN_AT,
  commit: HEAD,
  viewport: { ...VIEWPORT, scale: SCALE },
  ...identity,
  shots: [...kept.values()].sort((a, b) => (a.file < b.file ? -1 : 1)),
};
// Into the staging directory with everything else. The manifest is part of the
// set, not a note about it: a shots.json describing pictures that are not there
// is exactly the half-and-half state this run is built to make impossible.
const manifestName = SHOTS_MANIFEST.split('/').pop();
writeFileSync(join(STAGING, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/**
 * Move the staged set over the committed one — the last thing this run does.
 *
 * Two passes, because "move twenty-five files" is not one operation and the gap
 * between the first and the last is precisely the state being made impossible.
 * Everything is COPIED into `docs/readme/img/` first under an `.incoming`
 * suffix — invisible to `shotFiles()` and to `computeFacts()`, which both match
 * on `.png` — and only then renamed into place. A rename inside one directory is
 * the cheapest thing a filesystem does, so the whole set turns over in a few
 * milliseconds with nothing between the renames that can fail; a copy that dies
 * part way through has renamed nothing at all, and its leavings are swept.
 *
 * This is not POSIX atomicity and does not claim to be. What it guarantees is
 * the thing that was actually wanted: **no picture the README shows is written
 * until every picture has been taken and the manifest describing them exists.**
 * A run that throws at shot nineteen of twenty-four now leaves a repo it never
 * touched, instead of a library that is two thirds of one release and one third
 * of another.
 *
 * The manifest goes last, so it is never newer than the pictures it describes.
 */
function commitShots() {
  const target = join(ROOT, SHOTS_DIR);
  mkdirSync(target, { recursive: true });
  const order = [...staged.entries(), [manifestName, join(STAGING, manifestName)]];
  const moves = [];
  try {
    for (const [name, from] of order) {
      const incoming = join(target, `${name}.incoming`);
      copyFileSync(from, incoming);
      moves.push([incoming, join(target, name)]);
    }
  } catch (err) {
    for (const [incoming] of moves) rmSync(incoming, { force: true });
    throw err;
  }
  for (const [incoming, real] of moves) renameSync(incoming, real);
  committed = true;
  return moves.length;
}

const moved = commitShots();
// The staging copy has done its job the moment the set is committed. Kept only
// when the run FAILED, where it is the cheapest evidence of how far it got.
rmSync(STAGING, { recursive: true, force: true });

/* -------------------------------- the report ------------------------------ */

/*
 * What it did, in a form somebody can check — and specifically in a form that
 * answers the two questions asked of a capture run: is this the whole set, and
 * what is it a picture of? A run that prints only "done" is a run whose retries,
 * and therefore whose slow steps, are invisible.
 */
// `staged.size` rather than `taken.length`: a step that photographed something
// and then failed later pushes twice, and the number that matters is how many
// PICTURES were committed, not how many times the shutter went.
console.log(
  `\ncommitted ${moved} file(s) to ${SHOTS_DIR} — ${staged.size} picture(s) and the manifest`,
);
for (const t of timings) {
  const secs = `${(t.ms / 1000).toFixed(1)}s`.padStart(7);
  const again = t.attempts > 1 ? `  ← ${t.attempts} attempts` : '';
  console.log(`  ${secs}  ${t.label}${again}`);
}
const retried = timings.filter((t) => t.attempts > 1);
console.log(
  retried.length === 0
    ? '  every step passed first time'
    : `  retried: ${retried.map((t) => `${t.label} (×${t.attempts})`).join(', ')}`,
);
console.log(`\nwrote ${SHOTS_MANIFEST} — ${manifest.shots.length} shot(s) listed`);
console.log(`  app     ${manifest.app.product} ${manifest.app.version}`);
console.log(`  commit  ${manifest.commit.short}${manifest.commit.dirty ? ' (dirty)' : ''}`);
console.log(`  room    ${Object.values(manifest.depicts).slice(1).join(' / ')}`);
console.log('errors:', errors.size === 0 ? 'none' : [...errors.entries()]);
