/**
 * shots-now/demo-gif.mjs — the looping demo on the front page.
 *
 * Built with the owner's own `gifsmith`, to their storyboard:
 *
 *   *"start with showing the bookshelf (pick a fancy, grand-looking preset for
 *   wallpaper, books and shelves, and fill up the shelf with some books for
 *   this demo), click on studio to show that it has so many options in
 *   different areas of customisation — in fact try clicking many different
 *   categories to show how it customises in real time, to show how you can
 *   change it drastically — then close it and open the welcome book, turn
 *   through the pages to show them one by one, occasionally opening a panel in
 *   between so that you open all panels, and then finally once you reach all
 *   the pages go back by pressing the back button and end, so it will look like
 *   it goes to the shelf but it is the beginning of the GIF."*
 *
 * ## The loop is the constraint that shapes everything
 *
 * `loopAnchor()` makes gifsmith trim to the best hold-to-hold seam, and the
 * last frame then IS the first frame — no crossfade, no ghosting. That only
 * works if the scene genuinely comes home, which has one consequence worth
 * stating because it is easy to get wrong: **the studio has to finish on the
 * room it started in.** A demo that shows off four rooms and stops on the
 * fourth cannot loop, because the shelf the reader lands back on is not the
 * shelf they started from. So the tour of the presets ends by pressing The
 * House Room again, which is also just what a person does when they are
 * browsing rather than deciding.
 *
 * ## Why it can drive the app at all
 *
 * The books are drawn inside a Pixi canvas, so there is no DOM node to click
 * for one. `world.ts` hands out the bridges this needs — `__shelfSeedBooks` to
 * stock the shelf, `__shelfVisibleBooks` and `__shelfSpineRect` to find a book
 * and where it is on screen, `__shelfPullOut` to pull it off the shelf with its
 * real animation. The synthetic cursor is sent to the spine's own rect first,
 * so the pull reads as the cursor having done it.
 *
 * Those bridges are only handed out under `?fx=force`, which is also what stops
 * the shelf from degrading its effects — see `world.ts`.
 *
 *   npm run dev          (a dev server on :1420)
 *   node shots-now/demo-gif.mjs
 *   node shots-now/demo-gif.mjs --check     (dry run + contact sheet, no encode)
 */
import { render, timeline, web, dryRun, contactSheet } from 'gifsmith';
import { cursor, bezel } from 'gifsmith/props';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const CHECK = args.includes('--check');
const URL_BASE = opt('url', 'http://localhost:1420');

/*
 * `fx=force` for the bridges and the full shelf; `dev=0` to suppress the dev
 * view switcher, which is a developer affordance and has no business in a
 * picture of the product. Both are the same two the README shots take.
 */
const APP_URL = `${URL_BASE}/?fx=force&dev=0`;

const OUT_DIR = 'docs/readme/img';
mkdirSync(OUT_DIR, { recursive: true });

/** The books on the shelf. Plausible titles, not lorem — this is a portrait. */
const FLOOR_1 = [
  'Sea Glass', 'Sourdough', 'Field Notes', 'Old Letters', 'Mushrooms',
  'House Plants', 'Film Diary', 'Knots', 'Latin', 'Reading Log',
];
const FLOOR_2 = [
  'Wine Notes', 'Trail Notes', 'Recipes II', 'Birds', 'Tide Tables',
  'Ferns', 'Paper Marbling', 'Cold Frames', 'Bread', 'Rivers',
];
const FLOOR_3 = [
  'Moths', 'Orchards', 'Stone Walls', 'Cyanotype', 'Beekeeping',
  'Lichen', 'Seed Saving', 'Hedgerows',
];

/**
 * The rooms the studio tours, in order, ending where it began.
 *
 * By VISIBLE NAME rather than by preset id: the cards are the thing being
 * demonstrated, so the demo should press what the reader would press. The last
 * entry is the opening room — see the note about the loop at the top.
 */
const ROOM_TOUR = ['Gilt Salon', 'Card Room', 'Carnival', 'The House Room'];

const tl = timeline((t) => {
  /* ----------------------------- 1. the shelf ---------------------------- */

  t.waitFor('.shelf-dock');
  t.call(async (page) => {
    // Wait for the world's own ready promise, not a timer: the case is baked
    // art and a shot taken before it lands photographs bare arches.
    await page.evaluate(async () => {
      await globalThis.__shelfWorld.ready;
    });
    const skip = await page.$('text=skip the tour');
    if (skip) {
      await skip.click();
      await new Promise((r) => setTimeout(r, 900));
    }
    // Stock three floors. Awaited one floor at a time — each is a run of
    // inserts plus a store refresh, and firing all three at once races the
    // slot allocator.
    for (const [floor, titles] of [
      [0, FLOOR_1],
      [1, FLOOR_2],
      [2, FLOOR_3],
    ]) {
      await page.evaluate(
        ([f, list]) => globalThis.__shelfSeedBooks(list, f),
        [floor, titles],
      );
      await new Promise((r) => setTimeout(r, 1400));
    }
    await new Promise((r) => setTimeout(r, 3000));
  });
  t.hold(1.8);

  /*
   * THE SEAM. Everything above is setup the reader never sees — the trim
   * starts here, on a quiet, fully-painted shelf, and the scene has to come
   * back to this exact pose at the end.
   */
  t.loopAnchor();
  t.cue('shelf');
  t.hold(1.4);

  /* ---------------------------- 2. the studio ---------------------------- */

  t.click('[aria-label="Library studio"]', { via: 'cursor' });
  t.waitFor('.nb-library-studio');
  t.hold(1.6);
  t.cue('studio');

  for (const room of ROOM_TOUR) {
    t.call(async (page) => {
      await page.evaluate((name) => {
        const card = [...document.querySelectorAll('.nb-library-studio button')].find(
          (b) => (b.textContent ?? '').trim().startsWith(name),
        );
        card?.scrollIntoView({ block: 'center' });
      }, room);
      await new Promise((r) => setTimeout(r, 500));
    });
    t.click(`.nb-library-studio button:has-text("${room}")`, { via: 'cursor' });
    // Long enough to watch the case and the wall actually repaint, which is
    // the point of this section.
    t.hold(1.7);
  }

  t.click('[aria-label="Close Library studio"]', { via: 'cursor' });
  t.hold(1.2);

  /* -------------------------- 3. open a book ----------------------------- */

  t.call(async (page) => {
    const rect = await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks();
      const welcome = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
      return welcome ? { id: welcome.id, ...globalThis.__shelfSpineRect(welcome.id) } : null;
    });
    if (rect) globalThis.__alcoveBook = rect;
  });
  t.hold(0.4);
  t.call(async (page) => {
    // Pull it out the way the shelf does it, so the book leaves the case with
    // its own animation rather than the view simply cutting to a spread.
    await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks();
      const welcome = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
      if (welcome) globalThis.__shelfPullOut(welcome.id);
    });
    await new Promise((r) => setTimeout(r, 1600));
  });
  t.waitFor('.nb-prose');
  t.hold(2.0);
  t.cue('book');

  /* ------------------ 4. turn pages, opening panels between --------------- */

  /*
   * One panel between turns, so all of them are opened without the middle of
   * the demo becoming a list of panels. Each is opened by its own rail button
   * and closed by its own ✕ — never Escape, which is also how a reader puts
   * the book back and would end the scene early.
   */
  const PANELS = [
    ['Page style', '.nb-page-style-panel'],
    ['Catalogue', '.nb-catalogue-panel'],
    ['Table of contents', '.nb-toc-panel'],
    ['Customize this book', '.nb-book-studio'],
    ['In and out', '.nb-share-panel'],
  ];

  const turn = () => {
    t.call(async (page) => {
      await page.keyboard.press('ArrowRight');
      await new Promise((r) => setTimeout(r, 1500));
    });
    t.hold(1.1);
  };

  turn();
  for (const [name, selector] of PANELS) {
    t.click(`.nb-rail button[aria-label^="${name}"]`, { via: 'cursor' });
    t.waitFor(selector);
    t.hold(1.5);
    t.call(async (page) => {
      const close = await page.$(`[aria-label^="Close ${name}"]`);
      if (close) await close.click();
      await new Promise((r) => setTimeout(r, 900));
    });
    t.hold(0.5);
    turn();
  }
  turn();

  /* --------------------------- 5. back to the shelf ----------------------- */

  t.call(async (page) => {
    // The way back lives in the top-left corner and fades to a pencil mark
    // once the reader has settled in, so it has to be summoned before it can
    // be pressed: the pointer entering the corner is one of the three things
    // that brings it back (see BookView's BACK_ZONE).
    await page.mouse.move(80, 70);
    await new Promise((r) => setTimeout(r, 700));
  });
  t.click('.nb-back-button', { via: 'cursor' });
  t.waitFor('.shelf-dock');
  /*
   * Land, and settle into the SAME pose the anchor was taken in. This hold is
   * what gives the trimmer a matching frame to cut on; too short and the seam
   * lands mid-animation.
   */
  t.hold(2.2);
});

const scene = {
  target: {
    url: APP_URL,
    // The shelf is WebGL, and a headless Chrome with no GPU silently falls
    // back to a canvas that never paints. SwiftShader is the same software
    // rasteriser every probe in this repo uses.
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  },
  out: `${OUT_DIR}/demo.gif`,
  alsoEmit: ['webp'],
  viewport: { width: 1360, height: 850 },
  props: [cursor(), bezel()],
  timeline: tl,
  loop: 'anchor',
  encode: { width: 900, fps: 14, speed: 1.25, colors: 128, targetMB: 6 },
};

if (CHECK) {
  const plan = await dryRun(scene);
  console.log(JSON.stringify(plan, null, 2));
  const sheet = await contactSheet(scene, 9);
  const file = `${OUT_DIR}/demo-contact.png`;
  writeFileSync(file, Buffer.from(sheet.png ?? sheet, 'base64'));
  console.log(`\ncontact sheet -> ${file}`);
} else {
  const result = await render(scene);
  console.log(JSON.stringify(result, null, 2));
}
