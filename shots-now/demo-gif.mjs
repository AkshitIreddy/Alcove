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
 * ## It is rendered, not recorded
 *
 * `capture: 'deterministic'` puts the whole scene on Chromium's virtual clock:
 * gifsmith spends scene time one frame at a time and screenshots each frame
 * boundary, so a main-thread stall costs real seconds and no virtual ones and
 * cannot reach the output. This app is exactly the case that argues for it —
 * the artwork bakes, the raster cache warms, SQLite writes — and the first
 * screencast of this demo faithfully recorded every one of those pauses.
 *
 * The consequence for THIS file is the important part: **a `t.call()` may not
 * sleep.** `await new Promise((r) => setTimeout(r, 1900))` measures the
 * recording machine, which is the one thing the virtual clock exists to remove,
 * and under it those 1900ms buy zero rendered frames — so the animation the
 * sleep was waiting for is not merely mistimed, it is not in the GIF at all.
 * Every callback here therefore takes the clock as its second argument:
 *
 *   `ctx.advance(ms)` — spend ms of SCENE time (exactly ms/frameMs frames).
 *   `ctx.settle(p)`   — await something that can only finish while the page
 *                       paints, walking the clock forward underneath it.
 *
 * (Needs a gifsmith newer than 0.2.3, which handed `t.call` the bare Page.)
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

/*
 * The contact sheet is a QA artefact, NOT one of the README's pictures, so it
 * goes to qa/ — `check-readme.mjs` counts every PNG in `docs/readme/img` as a
 * screenshot and demands a page that shows it, and dropping one there quietly
 * broke the shot count.
 */
const QA_DIR = 'qa/demo';
mkdirSync(QA_DIR, { recursive: true });

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
 * What the studio tour presses, in order.
 *
 * By VISIBLE NAME rather than by preset id, through the `aria-label` every
 * `DesignStrip` tile already carries (`"<name> — <blurb>"`), which an attribute
 * prefix match reaches with ordinary CSS. gifsmith resolves selectors with
 * `querySelector`, so Playwright's `:has-text()` is a syntax error here — worth
 * saying out loud because the dry run is what caught it.
 *
 * Four axes, not one, because the point the reader asked for is *"so many
 * options in different areas of customisation … to show how you can change it
 * drastically"*: a whole room, then the timber under it, then the wall behind
 * it, then the colours over all of it. Repainting a room never straightens its
 * arches, so pressing them one after another shows four independent dials
 * rather than four versions of the same one.
 *
 * THE LAST ENTRY RETURNS TO THE OPENING ROOM. A room preset sets colour,
 * carpentry and paper together, so pressing The House Room again undoes all
 * three of the individual changes above it in one press — which is what lets
 * the scene come home, and the loop close without a crossfade. See the note at
 * the top of the file.
 */
const STUDIO_TOUR = [
  { strip: 'Room presets', name: 'Gilt Salon' },
  { strip: 'Room presets', name: 'Card Room' },
  { strip: 'Room presets', name: 'Carnival' },
  { strip: 'Bookcase build', index: 3 },
  { strip: 'Wallpaper', index: 4 },
  { strip: 'Library colours', index: 2 },
  { strip: 'Room presets', name: 'The House Room' },
];

/** A CSS selector for one tile in one named strip. */
const tileSelector = (step) =>
  step.name !== undefined
    ? `[aria-label="${step.strip}"] .nb-strip-tile[aria-label^="${step.name}"]`
    : `[aria-label="${step.strip}"] .nb-strip-tile:nth-of-type(${step.index})`;

const tl = timeline((t) => {
  /* ----------------------------- 1. the shelf ---------------------------- */

  t.waitFor('.shelf-dock');
  t.call(async function stockTheShelf(page, ctx) {
    // Wait for the world's own ready promise, not a timer: the case is baked
    // art and a shot taken before it lands photographs bare arches.
    //
    // Through `settle`, because this is the textbook deadlock: an awaited async
    // `page.evaluate` cannot resolve unless the page runs, and under a paused
    // virtual clock the page does not run until we spend some. Awaiting it
    // directly hangs the render with no timeout and no output.
    await ctx.settle(
      page.evaluate(async () => {
        await globalThis.__shelfWorld.ready;
      }),
      { capMs: 20_000, label: '__shelfWorld.ready' },
    );
    /*
     * PUPPETEER, not Playwright. gifsmith drives puppeteer-core, which has no
     * `text=` selector engine — `page.$('text=skip the tour')` is not "no match",
     * it throws, and the failure surfaced a long way from here as `.nb-prose`
     * timing out because the tour card was still sitting over the shelf.
     * Everything in this file that touches the page has to be puppeteer's API.
     */
    await page.evaluate(() => {
      const skip = [...document.querySelectorAll('button, a')].find((el) =>
        /skip the tour/i.test(el.textContent ?? ''),
      );
      skip?.click();
    });
    await ctx.advance(900);
    // Stock three floors. Awaited one floor at a time — each is a run of
    // inserts plus a store refresh, and firing all three at once races the
    // slot allocator. The insert run is async inside the page, so it is a
    // `settle` too; the pause after it is scene time the shelf spends baking
    // the spines it was just handed.
    for (const [floor, titles] of [
      [0, FLOOR_1],
      [1, FLOOR_2],
      [2, FLOOR_3],
    ]) {
      await ctx.settle(
        page.evaluate(
          ([f, list]) => globalThis.__shelfSeedBooks(list, f),
          [floor, titles],
        ),
        { capMs: 20_000, label: `__shelfSeedBooks(floor ${floor})` },
      );
      await ctx.advance(1400);
    }
    await ctx.advance(3000);
  });
  t.hold(2.0);

  /*
   * THE SEAM. Everything above is setup the reader never sees — the trim
   * starts here, on a quiet, fully-painted shelf, and the scene has to come
   * back to this exact pose at the end.
   */
  t.loopAnchor();
  t.cue('shelf');
  t.hold(1.8);

  /* ---------------------------- 2. the studio ---------------------------- */

  t.click('[aria-label="Library studio"]', { via: 'cursor' });
  t.waitFor('.nb-library-studio');
  /*
   * AND WAIT UNTIL A TILE IS ACTUALLY THERE TO PRESS.
   *
   * `.nb-library-studio` is the sheet root and it exists the instant the sheet
   * mounts — before it has slid in, and before its strips have been laid out.
   * A tour gated on the root alone can therefore start pressing tiles that are
   * in the DOM and nowhere on screen, which is what one full render did: all
   * seven presses reported the tile as unclickable, the tour came out as a
   * minute of an unchanged shelf, and the frames showed the sheet painted
   * blank. So the gate is the thing the tour actually needs — a tile with a box,
   * on screen — rather than the thing that is easiest to name.
   */
  t.waitUntil(() => {
    const el = document.querySelector('[aria-label="Room presets"] .nb-strip-tile');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.left >= 0 && r.top < window.innerHeight;
  });
  t.hold(1.8);
  t.cue('studio');

  for (const step of STUDIO_TOUR) {
    const selector = tileSelector(step);
    // Bring it into the sheet's own scroll before pointing at it — the later
    // axes are below the fold, and a cursor glide to an off-screen tile lands
    // on nothing.
    t.call(async function scrollTileIntoView(page, ctx) {
      await page.evaluate((sel) => {
        document.querySelector(sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, selector);
      // Not a pause — this IS the smooth scroll, and it only happens in scene
      // time. Sleeping here would leave the sheet mid-scroll for the click.
      await ctx.advance(500);
    }, { name: `scroll to ${step.name ?? `${step.strip} #${step.index}`}` });
    t.click(selector, { via: 'cursor' });
    // Long enough to watch the case and the wall actually repaint, which is
    // the whole point of this section.
    t.hold(2.3);
  }

  t.click('[aria-label="Close Library studio"]', { via: 'cursor' });
  t.hold(1.5);

  /* -------------------------- 3. open a book ----------------------------- */

  /*
   * TWO BEATS, because that is what the app does.
   *
   * `pullOut` does NOT open a book. `world.ts:1163` flies the spine out of the
   * case on a hinge and leaves it standing in front of the shelf, big enough to
   * read the cover, with nothing committed — and the cover itself is then the
   * button ("no need for the menu with read it put it back"). So the demo pulls
   * it out, lets the flight land, and clicks the cover.
   *
   * Which is the better demo anyway: the reader sees the book leave the shelf
   * and then sees it opened, rather than the shelf cutting to a spread.
   */
  t.call(async function pullOutTheBook(page) {
    const opened = await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      const welcome = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
      if (!welcome) return { ok: false, seen: books.length };
      globalThis.__shelfPullOut(welcome.id);
      return { ok: true, title: welcome.title, seen: books.length };
    });
    if (!opened.ok) throw new Error(`demo-gif: no book to pull out (${opened.seen} visible)`);
  });
  t.waitFor('.pulled-book');
  // Let the hinge, the arc and the overshoot finish before touching it.
  t.hold(1.7);
  /*
   * A REAL pointer, which `via: 'cursor'` gives. The cover listens for pointer
   * events, so a synthetic `element.click()` does nothing at all — checked,
   * because it silently left the demo on the shelf for the rest of the scene.
   */
  t.click('.pulled-book', { via: 'cursor' });
  t.waitFor('.nb-prose');
  t.hold(2.4);
  t.cue('book');

  /* ------------------ 4. turn pages, opening panels between --------------- */

  /*
   * One panel between turns, so all of them are opened without the middle of
   * the demo becoming a list of panels. Each is opened by its own rail button
   * and closed by its own ✕ — never Escape, which is also how a reader puts
   * the book back and would end the scene early.
   */
  /*
   * The sheet roots carry the SHORT name — `.nb-share`, not `.nb-share-panel`,
   * and `.nb-pagestyle`, not `.nb-page-style`. Guessing these cost a
   * five-minute run in `readme-shots.mjs`, because a wrong selector does not
   * error: the opener just keeps clicking a toggle and waiting.
   */
  const PANELS = [
    ['Page style', '.nb-pagestyle'],
    ['Catalogue', '.nb-catalogue'],
    ['Table of contents', '.nb-toc'],
    ['Customize this book', '.nb-book-studio'],
    ['In and out', '.nb-share'],
  ];

  /*
   * A READER'S PACE, and it is not only about the look.
   *
   * The raster cache warms the faces for the NEXT turn in idle time, so how
   * fast you turn decides whether the curl has textures to draw. Measured
   * earlier: at 1.6s between turns 2 of 4 turns had all three, at 3s it was
   * 4 of 4. Hammering the key outruns the warm, and a turn that outruns it now
   * falls back to the rigid fold rather than curling onto blank paper — correct,
   * but the demo should show the curl, because that is what a reader gets.
   */
  /*
   * BLUR FIRST, or the page does not curl — and that is why the reader said
   * *"page turn animation is not even visible in the gif"*.
   *
   * `arrowFlipAction(key, isTyping)` in views/spread.ts returns null when the
   * active element is a typing target, so the arrow can move the caret instead
   * of turning the leaf. Once a book has been opened the caret is IN the page,
   * so every ArrowRight in this demo was a caret move.
   *
   * Measured both ways before changing anything (`probe-curl-capture.mjs`):
   * with the editor blurred the flip runs for 17 frames and the CDP screencast
   * catches 11 of them — the curl is plainly visible in the captured JPEG. So
   * neither the app nor the recorder was at fault; the demo was pressing a key
   * that, in that focus state, does not turn a page.
   *
   * (That the app cannot be turned with the arrows while the caret sits in the
   * page is a real question about the app, not about this file. It is written
   * down in TODO.md for the owner to rule on rather than quietly changed here.)
   */
  /*
   * AND THE 1900 IS NOW SCENE TIME, WHICH IS THE WHOLE POINT.
   *
   * As a real-time sleep this was the recording machine's 1900ms: enough on a
   * quiet run, not enough while the raster cache was warming, and under the
   * virtual clock not a single rendered frame — the curl would have been
   * skipped over rather than filmed. `ctx.advance(1900)` is 1900ms of the
   * SCENE, so at 14fps and speed 1.1 it is exactly 24 frames of page turn, on
   * this machine and on anyone else's.
   */
  const turn = () => {
    t.call(async function turnThePage(page, ctx) {
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
      });
      await ctx.advance(250);
      await page.keyboard.press('ArrowRight');
      await ctx.advance(1900);
    });
    t.hold(1.5);
  };

  turn();
  for (const [name, selector] of PANELS) {
    t.click(`.nb-rail button[aria-label^="${name}"]`, { via: 'cursor' });
    t.waitFor(selector);
    /*
     * Long enough to actually READ the panel. *"not enough time is given to
     * view the panels sometimes"* — and a panel is the densest thing in the
     * demo: the catalogue alone is forty labelled tiles.
     */
    t.hold(3.2);
    t.call(async function closeThePanel(page, ctx) {
      const close = await page.$(`[aria-label^="Close ${name}"]`);
      // `click()` scrolls the element into view and resolves a clickable point
      // first, and both of those can need the page to move — so it goes through
      // the clock rather than being awaited into a stopped scene.
      if (close) await ctx.settle(close.click(), { capMs: 3_000, label: `Close ${name}` });
      await ctx.advance(900);
    }, { name: `close ${name}` });
    t.hold(0.7);
    turn();
  }
  turn();

  /* --------------------------- 5. back to the shelf ----------------------- */

  t.call(async function summonTheBackButton(page, ctx) {
    // The way back lives in the top-left corner and fades to a pencil mark
    // once the reader has settled in, so it has to be summoned before it can
    // be pressed: the pointer entering the corner is one of the three things
    // that brings it back (see BookView's BACK_ZONE). The 700ms is its fade,
    // which is scene time like every other animation in the file.
    await page.mouse.move(80, 70);
    await ctx.advance(700);
  });
  t.click('.nb-back-button', { via: 'cursor' });
  t.waitFor('.shelf-dock');
  /*
   * Land, and settle into the SAME pose the anchor was taken in. This hold is
   * what gives the trimmer a matching frame to cut on; too short and the seam
   * lands mid-animation.
   */
  t.hold(2.6);
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
  /*
   * RENDERED, NOT RECORDED — and the frames kept lossless on the way out.
   *
   * `deterministic` is the offline-renderer backend: virtual time, one
   * screenshot per frame, so the artwork bake and the raster warm-up cost real
   * seconds and no scene time at all. `format: 'png'` removes the only lossy
   * stage before the encoder — this backend never resamples, so the quantiser
   * sees exactly what Chromium composited. Measured on this walkthrough's own
   * 1336 frames, the JPEG stage costs 45.4dB PSNR / 0.991 SSIM against what
   * Chromium drew — and, because JPEG ringing around ink on pale paper is
   * high-frequency noise in a picture that had none, it also made the GIF 27%
   * BIGGER (14.2MB against 11.2MB, same frames, same encoder).
   */
  capture: { mode: 'deterministic', format: 'png' },
  /*
   * A FLOOR ON THE LOOP, or the trim throws the tour away.
   *
   * The scene holds still on the shelf for a beat after `loopAnchor()` — that
   * hold is what makes an artifact-free seam possible — but it also means every
   * pair of frames inside it matches almost perfectly. gifsmith 0.2.2 answered
   * with the shortest qualifying loop: anchor 45, end 105, seam MSE 0.0, and a
   * 4.29-second clip of a bookshelf doing nothing. Fixed in gifsmith 0.2.3
   * (equally-invisible seams now prefer the longest span); this floor says out
   * loud what this particular demo needs, and costs nothing if the rule already
   * gets it right.
   */
  loop: { strategy: 'anchor', minCycleSeconds: 30 },
  /*
   * Sized against the file, not against taste. The first full-length render
   * came out at 79.6s and a 10.8MB GIF — a correct demo nobody would wait for.
   * A product tour is mostly holds, so playback carries a lot of speed before
   * anything reads as hurried; the rest comes off the frame budget.
   */
  /*
   * Unhurried, on purpose. The reader on seeing the first cut: *"the gif is
   * moving too fast, like make sure it is slow"* — and *"i dont mind if gif is
   * big readme has space"*. So playback is near real time, the frame rate is
   * up for smoothness, and the size budget is loose enough not to fight it.
   */
  /*
   * AND THE PALETTE IS WHERE THE MUSH WAS. *"i feel this gif is very lossy …
   * it is not always the same spot that gets messy"* — that last clause is the
   * diagnosis: a moving mess is a dither, not a fixed artefact. gifsmith's
   * defaults (128 colours, a Bayer dither, a palette weighted toward the pixels
   * that CHANGE) are tuned for size, and on a page of cream paper and fine ink
   * they are a coarse approximation whose worst part follows the motion around.
   *
   * This art is flat colour with one ink outline, which is the case where a
   * dither buys nothing at all: 256 colours cover it, and turning the dither
   * off removes the noise instead of hiding it. Measured on this very
   * walkthrough — see the gifsmith README's table.
   */
  encode: {
    width: 900, fps: 14, speed: 1.1, targetMB: 20,
    colors: 256, dither: 'none', palette: 'full',
  },
};

if (CHECK) {
  const plan = await dryRun(scene);
  console.log(JSON.stringify(plan, null, 2));
  const sheet = await contactSheet(scene, 9);
  // The shape varies by version, so take whichever field carries the base64
  // rather than assuming one — an object handed to Buffer.from throws.
  const b64 = typeof sheet === 'string' ? sheet : (sheet.gridBase64 ?? sheet.png ?? sheet.base64);
  const file = `${QA_DIR}/demo-contact.png`;
  if (typeof b64 === 'string') {
    writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log(`\ncontact sheet -> ${file}`);
  } else {
    console.log('\ncontact sheet keys:', Object.keys(sheet).join(', '));
  }
} else {
  const result = await render(scene);
  console.log(JSON.stringify(result, null, 2));
}
