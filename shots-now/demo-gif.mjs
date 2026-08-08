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
 * The Welcome book grew from sixteen to forty-eight leaves after that brief.
 * A literal turn through all twenty-four spreads made the book look like a
 * page-turn benchmark and buried the panels, so this cut keeps the substantial
 * tour while curating the strongest specimens: stationery, kittens, media,
 * diagrams, maths/code and linked notes. Contents and thumbnails are each used
 * once; real turns join the nearby spreads; every book panel gets its own beat.
 *
 * ## The loop is the constraint that shapes everything
 *
 * `loopAnchor()` makes gifsmith trim to the best hold-to-hold seam, with no
 * visible crossfade or ghosting. That only works if the scene genuinely comes
 * home, which has one consequence worth
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
 *   node shots-now/demo-gif.mjs --gifsmith-local=file:///C:/path/to/gifsmith/dist/index.js
 *   node shots-now/demo-gif.mjs --check     (dry run + contact sheet, no encode)
 */
import { writeFileSync, mkdirSync } from 'node:fs';

/*
 * Release work can exercise a locally-built gifsmith before that build is
 * published, without changing package.json or the sibling repository. Keep
 * the normal package import as the default; GIFSMITH_LOCAL or
 * --gifsmith-local is an explicit file URL such as
 * file:///C:/.../gifsmith/dist/index.js.
 */
const args = process.argv.slice(2);
const localArg = args.find((arg) => arg.startsWith('--gifsmith-local='));
const GIFSMITH_ENTRY = process.env.GIFSMITH_LOCAL
  || (localArg ? localArg.split('=').slice(1).join('=') : 'gifsmith');
const gifsmith = await import(GIFSMITH_ENTRY);
const props = await import(
  GIFSMITH_ENTRY !== 'gifsmith'
    ? new URL('./props/index.js', GIFSMITH_ENTRY).href
    : 'gifsmith/props'
);
const { render, timeline, dryRun, contactSheet } = gifsmith;
const { cursor, bezel } = props;

/**
 * Timeline callbacks receive gifsmith's capture clock during a render, while
 * its cheap snapshot/contact-sheet player deliberately calls them with only a
 * page. Keep one clock-shaped seam so `--check` exercises the exact same
 * callback code instead of crashing on the first `ctx.advance`.
 */
async function advanceScene(page, ctx, durationMs) {
  if (typeof ctx?.advance === 'function') {
    await ctx.advance(durationMs);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function settleScene(ctx, promise, options) {
  if (typeof ctx?.settle === 'function') return ctx.settle(promise, options);
  return promise;
}

/**
 * Click one exact viewport point with the pointer the film shows.
 *
 * gifsmith's selector click intentionally aims its cursor at an element's
 * centre. That is right for buttons, but two of this demo's real affordances
 * are regions rather than DOM buttons: a Pixi spine and the page's bottom
 * corner grip. Moving only Puppeteer's hidden pointer made those actions look
 * telepathic; aiming at the centre of the full-height flip hotspot made a
 * valid click look detached from the dog-ear that teaches the gesture.
 *
 * Keep the synthetic cursor, ripple and browser pointer on the SAME point.
 * `settleScene` walks the virtual clock while the in-page cursor tween runs,
 * so deterministic capture records the journey rather than its last frame.
 */
async function cursorClickPoint(
  page,
  ctx,
  point,
  { durationMs = 520, label = 'point click' } = {},
) {
  await settleScene(
    ctx,
    page.evaluate(
      ({ x, y, duration }) => globalThis.__gifsmith?.cursorTo(x, y, duration, 'easeInOut'),
      { x: point.x, y: point.y, duration: durationMs },
    ),
    { capMs: durationMs + 1_000, label: `${label} cursor` },
  );
  await page.mouse.move(point.x, point.y);
  await page.evaluate(
    ({ x, y }) => globalThis.__gifsmith?.ripple(x, y),
    { x: point.x, y: point.y },
  );
  await page.mouse.click(point.x, point.y);
}

/**
 * Native smooth scrolling is scheduled by Chromium's compositor. Deterministic
 * capture advances the page's virtual clock, not that compositor timeline, so
 * `behavior: 'smooth'` can sit still for the whole call and then jump on its
 * last frame. Move the scroll position explicitly at scene-frame boundaries;
 * this makes the motion both visible and reproducible in the encoded demo.
 */
async function sceneScroll(page, ctx, selector, destination, durationMs) {
  const range = await page.evaluate(({ selector, destination }) => {
    const subject = document.querySelector(selector);
    const scroller = subject?.closest('.nb-rail-panel-body');
    if (!(subject instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;

    const from = scroller.scrollTop;
    if (destination === 'end') {
      return { from, to: Math.max(0, scroller.scrollHeight - scroller.clientHeight) };
    }

    subject.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const to = scroller.scrollTop;
    scroller.scrollTop = from;
    return { from, to };
  }, { selector, destination });
  if (!range || Math.abs(range.to - range.from) < 1) return;

  const steps = Math.max(2, Math.ceil(durationMs / 70));
  for (let step = 1; step <= steps; step += 1) {
    const p = step / steps;
    const eased = 1 - ((1 - p) ** 3);
    await page.evaluate(({ selector, top }) => {
      const scroller = document.querySelector(selector)?.closest('.nb-rail-panel-body');
      if (scroller instanceof HTMLElement) scroller.scrollTop = top;
    }, { selector, top: range.from + ((range.to - range.from) * eased) });
    await advanceScene(page, ctx, durationMs / steps);
  }
}

/** Deterministic horizontal counterpart used by the page filmstrip. */
async function sceneScrollInline(page, ctx, selector, durationMs) {
  const range = await page.evaluate((wanted) => {
    const subject = document.querySelector(wanted);
    const scroller = subject?.closest('.nb-thumb-strip');
    if (!(subject instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;
    const from = scroller.scrollLeft;
    const stripRect = scroller.getBoundingClientRect();
    const subjectRect = subject.getBoundingClientRect();
    const subjectCenter =
      from + (subjectRect.left + subjectRect.right) / 2 - stripRect.left;
    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const to = Math.max(0, Math.min(max, subjectCenter - scroller.clientWidth / 2));
    return { from, to };
  }, selector);
  if (!range || Math.abs(range.to - range.from) < 1) return;

  const steps = Math.max(2, Math.ceil(durationMs / 70));
  for (let step = 1; step <= steps; step += 1) {
    const p = step / steps;
    const eased = p * p * (3 - 2 * p);
    await page.evaluate(({ left }) => {
      const strip = document.querySelector('.nb-thumb-strip');
      if (strip instanceof HTMLElement) strip.scrollLeft = left;
    }, { left: range.from + ((range.to - range.from) * eased) });
    await advanceScene(page, ctx, durationMs / steps);
  }
}

/**
 * Wait until every mounted spine has finished baking before a declared hold.
 * The temporal review caught lo/hi arrivals two seconds into holds at f0206
 * and f0322; `ctx.advance` alone cannot see worker completions.
 */
async function settleSpines(page, ctx, { hi = true, label = 'spines' } = {}) {
  const promise = page.evaluate((wantHi) => globalThis.__shelfWhenSpinesReady(wantHi), hi);
  await settleScene(ctx, promise, { capMs: 30_000, label });
}

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

/*
 * The anchor sees the cursor before its first journey. Bring it back to this
 * exact quiet corner before the closing hold too, otherwise the app itself
 * loops perfectly while the synthetic pointer alone teleports at the seam.
 * This is explicit rather than relying on gifsmith's viewport-derived default
 * so a future viewport edit cannot silently move one end of the loop.
 */
const LOOP_CURSOR_HOME = Object.freeze({ x: 54, y: 24 });

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
    await settleScene(
      ctx,
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
    await advanceScene(page, ctx, 900);
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
      await settleScene(
        ctx,
        page.evaluate(
          ([f, list]) => globalThis.__shelfSeedBooks(list, f),
          [floor, titles],
        ),
        { capMs: 20_000, label: `__shelfSeedBooks(floor ${floor})` },
      );
      await advanceScene(page, ctx, 1400);
    }
    // Opening the Welcome book later makes it the world's recent book and
    // adds the pale status ribbon to its spine. The loop closes after that
    // state change, so the anchor has to start with the same mark or the last
    // frame toggles one ornament as it returns to frame one. Use the world
    // instance the app exposes — importing the data module from this page can
    // resolve an HMR-duplicated store that the visible shelf never observes.
    const recent = await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      const welcome = books.find((book) => /welcome/i.test(book.title)) ?? books[0];
      if (!welcome || typeof globalThis.__shelfWorld?.noteBookOpened !== 'function') {
        return { ok: false, seen: books.length };
      }
      globalThis.__shelfWorld.noteBookOpened(welcome.id);
      return { ok: true, title: welcome.title };
    });
    if (!recent.ok) {
      throw new Error(`demo-gif: cannot mark Welcome recent (${recent.seen} visible)`);
    }
    await advanceScene(page, ctx, 3000);
    await settleSpines(page, ctx, { label: 'seeded shelf spines' });
  });
  t.call(async function settleShelfForSeam(page, ctx) {
    await settleSpines(page, ctx, { label: 'shelf seam spines' });
  }, { name: 'settle shelf spines' });
  /*
   * Trimmed before the loop — only needs the shelf to be still, not held long
   * enough to read. The old 2.0s here bought nothing in the shipped WebP.
   */
  t.hold(0.4);

  /*
   * THE SEAM. Everything above is setup the reader never sees — the trim
   * starts here, on a quiet, fully-painted shelf, and the scene has to come
   * back to this exact pose at the end.
   */
  t.loopAnchor();
  t.cue('shelf');
  /*
   * The first frame a GitHub reader sees. It used to hold 1.8s — long enough
   * to scroll past before the cursor moved. Half a second is plenty for the
   * loop trimmer to find a matching seam; motion starts on the studio click.
   */
  t.hold(0.5);

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
  /*
   * One beat to read that the studio opened — not 1.8s. The sheet slide and
   * the cursor glide to the first tile are the motion; this is just a settle.
   */
  t.hold(0.6);
  t.cue('studio');

  for (const step of STUDIO_TOUR) {
    const selector = tileSelector(step);
    // Bring it into the sheet's own scroll before pointing at it — the later
    // axes are below the fold, and a cursor glide to an off-screen tile lands
    // on nothing.
    /*
     * `nearest`, NOT `center`, and the difference is visible in the recording.
     *
     * The sheet has a PINNED tab row (`.nb-studio-tabs`, sticky, opaque). With
     * `center` the scroller happily parks a heading halfway under it, and the
     * frame review picked that up as a defect — "My Library" sliced through its
     * cap height, reading as "my Ciorary", held byte-identical for the whole
     * time the studio was open. The app was behaving correctly; a pinned strip
     * is SUPPOSED to cover what scrolls beneath it. It was the demo that chose
     * a scroll position where the covering line fell through a word.
     *
     * `nearest` scrolls the least it can to bring the tile into view, so a tile
     * already on screen does not move at all and one below the fold arrives at
     * the bottom edge rather than dragging the section headings under the tabs.
     */
    t.call(async function scrollTileIntoView(page, ctx) {
      // Not a pause — this IS the smooth scroll, one deterministic scene-frame
      // step at a time. Sleeping here would leave the sheet mid-scroll for the
      // click, while native smooth scrolling collapses to a cut under CDP's
      // virtual clock.
      await sceneScroll(page, ctx, selector, 'nearest', 500);
    }, { name: `scroll to ${step.name ?? `${step.strip} #${step.index}`}` });
    t.click(selector, { via: 'cursor' });
    // Long enough to watch the case and the wall actually repaint, which is
    // the whole point of this section.
    t.call(async function settleStudioRepaint(page, ctx) {
      await settleSpines(page, ctx, { label: `studio spines after ${step.name ?? step.strip}` });
      // The dashed add-slot is a DOM overlay the world can publish a beat after
      // the Pixi room settles; spend its 180ms fade before the declared hold.
      await advanceScene(page, ctx, 190);
    }, { name: `settle spines after ${step.name ?? step.strip}` });
    // The applied-state gate above owns correctness; this is only the beat in
    // which the viewer sees the finished choice. The former 1.5s pause after
    // every tile made the studio feel slower than the app.
    t.hold(0.65);
  }

  /* The studio has a second, materially different surface for the reader's
   * own packs. Show it without replacing or shortening the room tour above,
   * then restore the library pane before closing so the handoff remains
   * legible and the loop still ends on the restored House Room. */
  t.click('[data-studio-tab="own"]', { via: 'cursor' });
  t.waitFor('[role="tabpanel"][aria-label="Your own"]');
  t.hold(0.85);
  t.click('[data-studio-tab="library"]', { via: 'cursor' });
  t.waitFor('[role="tabpanel"][aria-label="This library"]');
  t.hold(0.45);

  t.click('[aria-label="Close Library studio"]', { via: 'cursor' });
  t.hold(0.65);

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
  t.call(async function pullOutTheBook(page, ctx) {
    const target = await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      const welcome = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
      if (!welcome) return { ok: false, seen: books.length };
      const rect = globalThis.__shelfSpineRect?.(welcome.id);
      if (!rect) return { ok: false, seen: books.length };
      return {
        ok: true,
        title: welcome.title,
        seen: books.length,
        point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      };
    });
    if (!target.ok) throw new Error(`demo-gif: no book spine to click (${target.seen} visible)`);
    await cursorClickPoint(page, ctx, target.point, {
      durationMs: 620,
      label: `click ${target.title}`,
    });
  }, { name: 'click the Welcome spine', seconds: 0.62 });
  t.waitFor('.pulled-book');
  // Let the hinge, the arc and the overshoot finish before touching it.
  t.hold(1.1);
  /*
   * A REAL pointer, which `via: 'cursor'` gives. The cover listens for pointer
   * events, so a synthetic `element.click()` does nothing at all — checked,
   * because it silently left the demo on the shelf for the rest of the scene.
   *
   * The click is also a route boundary: the pulled cover unmounts and the live
   * spread mounts in one product frame. Chrome's View Transition API looked
   * right in a live dry run but `Page.captureScreenshot` did not expose its
   * pseudo-layer to deterministic capture, so the encoded demo still hard-cut.
   *
   * Keep an exact, full-resolution photograph of the REAL pre-click frame over
   * the route swap, split it at the book's gutter, then part the two OPAQUE
   * halves over the REAL live spread. A crossfade is the wrong transition for
   * two detailed scenes: its middle necessarily shows the cover, shelf and
   * readable pages at once. The centre reveal gives every pixel one owner and
   * still reads as the same book opening. Transform is stepped on gifsmith's
   * scene clock, so every intermediate paint is guaranteed to become an
   * output frame. The synthetic cursor is hidden only while the photograph is
   * taken and remains live/crisp above it.
   */
  t.call(async function stageRealBookHandoff(page) {
    const cursorVisibility = await page.evaluate(() => {
      const cursor = document.getElementById('__gifsmith_cursor');
      if (cursor === null) return null;
      const before = cursor.style.visibility;
      cursor.style.visibility = 'hidden';
      return before;
    });
    const pngBase64 = await page.screenshot({ type: 'png', encoding: 'base64' });
    await page.evaluate((visibility) => {
      const cursor = document.getElementById('__gifsmith_cursor');
      if (cursor !== null) cursor.style.visibility = visibility ?? '';
    }, cursorVisibility);
    const dataUrl = `data:image/png;base64,${pngBase64}`;
    const staged = await page.evaluate(async (src) => {
      if (!document.querySelector('.pulled-book')) return false;
      document.getElementById('__demo-book-handoff')?.remove();
      const handoff = document.createElement('div');
      handoff.id = '__demo-book-handoff';
      handoff.style.cssText = [
        'position:fixed',
        'inset:0',
        'overflow:hidden',
        'pointer-events:none',
        // Above the app + captured bezel, below gifsmith's live cursor/ripple.
        'z-index:2147483640',
      ].join(';');

      const half = (side) => {
        const image = document.createElement('img');
        image.alt = '';
        image.src = src;
        image.dataset.demoHandoffHalf = side;
        image.style.cssText = [
          'position:absolute',
          'inset:0',
          'width:100%',
          'height:100%',
          'object-fit:fill',
          `clip-path:${side === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)'}`,
          'transform:translate3d(0,0,0)',
          'will-change:transform',
        ].join(';');
        handoff.append(image);
        return image;
      };

      const halves = [half('left'), half('right')];
      document.body.append(handoff);
      try {
        await Promise.all(halves.map((image) => image.decode()));
      } catch {
        handoff.remove();
        return false;
      }
      return halves.every((image) => image.complete && image.naturalWidth > 0);
    }, dataUrl);
    if (!staged) throw new Error('demo-gif: cannot stage cover-to-spread handoff');
  }, { name: 'stage real cover-to-spread handoff' });
  t.click('.pulled-book', { via: 'cursor' });
  t.waitFor('.nb-prose');
  t.call(async function revealRealBookHandoff(page, ctx) {
    const steps = Math.max(7, Math.round(440 / Math.max(1, ctx?.frameMs || 63)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t * t * (3 - 2 * t);
      const present = await page.evaluate((progress) => {
        const handoff = document.getElementById('__demo-book-handoff');
        const left = handoff?.querySelector('[data-demo-handoff-half="left"]');
        const right = handoff?.querySelector('[data-demo-handoff-half="right"]');
        if (!(left instanceof HTMLImageElement) || !(right instanceof HTMLImageElement)) {
          return false;
        }
        // Each image is viewport-wide but exposes one half, so 50% clears it.
        left.style.transform = `translate3d(${-50 * progress}%,0,0)`;
        right.style.transform = `translate3d(${50 * progress}%,0,0)`;
        return true;
      }, eased);
      if (!present) throw new Error('demo-gif: staged book handoff disappeared early');
      await advanceScene(page, ctx, 440 / steps);
    }
    await page.evaluate(() => document.getElementById('__demo-book-handoff')?.remove());
  }, { name: 'reveal real cover-to-spread handoff', seconds: 0.44 });
  t.hold(1.1);
  t.cue('book');
  t.call(async function normalizeBookChrome(page, ctx) {
    // A failed prior check can leave the persistent thumbnail preference on.
    // Start from the same chrome every time, then restore it after the finale.
    await settleScene(
      ctx,
      page.evaluate(() => globalThis.__shelfSaveSettings({ thumbnailsStrip: false })),
      { capMs: 5_000, label: 'hide thumbnails before storyboard' },
    );
    await advanceScene(page, ctx, 250);
  }, { name: 'normalize book chrome', seconds: 0.25 });

  /* --------------------- 4. the forty-eight-leaf field guide -------------- */

  /*
   * A READER'S PACE, and it is not only about the look.
   *
   * The raster cache warms the faces for the NEXT turn in idle time, so how
   * fast you turn decides whether the curl has textures to draw. Measured
   * earlier: at 1.6s between turns 2 of 4 turns had all three, at 3s it was
   * 4 of 4. Turning faster than that outruns the warm, and a turn that outruns
   * it now falls back to the rigid fold rather than curling onto blank paper —
   * correct, but the demo should show the curl, because that is what a reader
   * gets.
   */
  /*
   * HOW THE MISSING TURN WAS FOUND, kept because the reasoning outlived it.
   *
   * The reader: *"page turn animation is not even visible in the gif"*. The
   * cause was that this file pressed →, and `arrowFlipAction(key, isTyping)`
   * returned null whenever the caret sat in a typing target — which, once a
   * book has been opened, is always. Every ArrowRight here was a caret move.
   *
   * Measured both ways before changing anything (`probe-curl-capture.mjs`):
   * with the editor blurred the flip ran for 17 frames and the CDP screencast
   * caught 11 of them, the curl plainly visible in the captured JPEG. So
   * neither the app nor the recorder was ever at fault; the demo was pressing a
   * key that, in that focus state, did not turn a page.
   *
   * The workaround was to blur first. The finding was written into TODO.md as a
   * question for the owner rather than quietly worked around forever — *"that
   * the app cannot be turned with the arrows while the caret sits in the page
   * is a real question about the app, not about this file"* — and they ruled:
   * arrows do not turn pages at all. So the blur is gone with the key, and this
   * file drives the affordance the app actually has.
   */
  /*
   * THE TURN WAITS ON ITS REAL PHASES, NOT ON A FIXED PAUSE.
   *
   * The visible cursor journey is advanced on gifsmith's scene clock, the app
   * owns the curl's duration, and the landing gate below waits for both the
   * canvas and its handoff class to clear. That records however many frames the
   * real turn needs without padding every turn with the old fixed 1.9 seconds.
   */
  /*
   * THE DEMO CLICKS THE PAGE EDGE. It used to press →, and that key no longer
   * turns a page at all.
   *
   * The owner's ruling, after being shown that the Welcome book's own first
   * page said "click the ruled lines and type" and then, four lines later,
   * "arrow keys turn pages" — do the first and the second stops being true:
   *
   *   *"well we can not make arrow keys turn pages then"*
   *
   * So `arrowFlipAction` is gone, and with it the blur-then-press dance above,
   * which existed ONLY to work around the very conflict that ruling removes.
   *
   * `.nb-flip-hotspot-next` is the real thing: a 48px strip down the outer edge
   * of the right leaf, `cursor: grab`, `display: none` when there is nowhere to
   * turn to (so `t.click` waiting on it is also the check that a turn is
   * possible). A pointerdown and pointerup inside 6px and 300ms is a TAP, which
   * `PageFlipController` tweens to a full turn in `TAP_FLIP_DURATION_S`.
   *
   * And it is a better demo for it. A recording of somebody pressing a key
   * shows nothing; a cursor going to the edge of the page and the page peeling
   * after it shows the reader what to do with their hand.
   *
   * The pacing is still deliberate: the readiness gate waits for warm faces,
   * the app runs its real turn, and only then does the page get a short reading
   * beat. A cache race therefore cannot turn a shorter demo pause into a blank
   * or rigid-fold frame.
   */
  const turn = (expectedHeading, expectedSpread) => {
    // Keep the filmed curl on the warmed path. A real reader can use the live
    // fold fallback immediately; the demo can wait briefly and show the
    // richer curl rather than filming a cache race.
    t.waitUntil(() => {
      const faces = globalThis.__flipCache?.facesFor?.('next');
      return Boolean(
        faces && faces.hasFront && faces.hasRevealed && faces.fresh &&
        faces.quiet && faces.aheadPending === 0
      );
    });
    t.call(async function clickTheVisiblePageCorner(page, ctx) {
      const before = await page.$eval('[data-spread-index]', (node) =>
        Number(node.getAttribute('data-spread-index')),
      );
      if (before + 1 !== expectedSpread) {
        throw new Error(
          `demo-gif: storyboard drift before "${expectedHeading}" ` +
          `(at spread ${before}, expected ${expectedSpread - 1})`,
        );
      }
      await page.evaluate(({ spread, heading }) => {
        globalThis.__demoExpectedSpread = spread;
        globalThis.__demoExpectedHeading = heading;
      }, { spread: expectedSpread, heading: expectedHeading });
      const point = await page.$eval('.nb-flip-hotspot-next', (hotspot) => {
        const rect = hotspot.getBoundingClientRect();
        return { x: rect.right - 18, y: rect.bottom - 18 };
      });
      await cursorClickPoint(page, ctx, point, {
        durationMs: 480,
        label: 'click the bottom-right page corner',
      });
    }, { name: 'click the visible page corner', seconds: 0.48 });
    // Wait on the overlay itself. A fixed 1.9s wait filmed more still paper
    // than animation and could still be wrong on a stalled frame.
    t.waitUntil(() =>
      document.querySelector('.nb-flip-canvas.is-flipping') === null &&
      !document.querySelector('.nb-flip-surface.is-flip-landing') &&
      Number(document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index')) ===
        globalThis.__demoExpectedSpread &&
      [...document.querySelectorAll('.nb-leaf-paper h1')].some(
        (heading) => heading.textContent?.trim() === globalThis.__demoExpectedHeading,
      )
    );
    t.hold(0.6);
  };

  /*
   * Open one substantial book sheet, let it be read, and close it through its
   * own button. The contents sheet is deliberately not handled here: choosing
   * a chapter from it closes it as part of the real navigation path.
   */
  const showPanel = (
    name,
    selector,
    { hold = 1.25, showFoot = false, closeName = name } = {},
  ) => {
    t.click(`.nb-rail button[aria-label^="${name}"]`, { via: 'cursor' });
    t.waitFor(selector);
    if (showFoot) {
      /*
       * This is the one panel whose last explanatory sentence sits just below
       * the fold at the demo viewport. Holding the unscrolled sheet filmed a
       * sentence cut after "only" for three seconds. Read the errands first,
       * then deliberately show that the sheet scrolls and let its foot land in
       * full; the total reading time remains unhurried.
       */
      t.hold(0.85);
      t.call(async function showSharePanelFoot(page, ctx) {
        await sceneScroll(page, ctx, selector, 'end', 520);
      }, { name: 'scroll In and out to its foot', seconds: 0.52 });
      t.hold(0.9);
    } else {
      t.hold(hold);
    }
    // Close through the same visible pointer used to open the panel. A direct
    // ElementHandle.click closed the sheet while the filmed cursor remained on
    // the rail icon, which read as a second telepathic action.
    t.click(`[aria-label^="Close ${closeName}"]`, { via: 'cursor' });
    t.hold(0.4);
  };

  /*
   * A distant jump the viewer can understand.
   *
   * TOC rows have truthful visible text but no page-specific selector. Mark
   * the exact row in the live sheet, scroll that sheet to it one deterministic
   * frame at a time, then let gifsmith's cursor click the real button. Going
   * through the product is both clearer and safer than setting spread state
   * through a private QA bridge.
   */
  const jumpToChapter = (
    title,
    spread,
    { hold = 1.1, waitFor = [], waitUntil = null } = {},
  ) => {
    t.click('.nb-rail button[aria-label^="Table of contents"]', { via: 'cursor' });
    t.waitFor('.nb-toc');
    t.call(async function findChapterInContents(page, ctx) {
      const marked = await page.evaluate((wanted) => {
        for (const row of document.querySelectorAll('.nb-toc-row')) {
          row.removeAttribute('data-demo-toc-target');
        }
        const row = [...document.querySelectorAll('.nb-toc-row')].find((candidate) => {
          const text = candidate.querySelector('.nb-toc-text')?.textContent?.trim();
          return text === wanted;
        });
        if (!(row instanceof HTMLElement)) return false;
        row.setAttribute('data-demo-toc-target', 'true');
        return true;
      }, title);
      if (!marked) throw new Error(`demo-gif: TOC has no chapter named "${title}"`);
      await sceneScroll(
        page,
        ctx,
        '.nb-toc-row[data-demo-toc-target="true"]',
        'nearest',
        500,
      );
    }, { name: `find ${title} in contents`, seconds: 0.5 });
    t.click('.nb-toc-row[data-demo-toc-target="true"]', { via: 'cursor' });
    t.call(async function waitForChapterToLand(page, ctx) {
      await settleScene(
        ctx,
        page.waitForFunction(
          ({ expectedSpread, expectedTitle }) => {
            const stage = document.querySelector('.nb-spread-stage');
            const at = Number(stage?.getAttribute('data-spread-index'));
            const headings = [...document.querySelectorAll('.nb-leaf-paper h1')];
            return (
              at === expectedSpread &&
              headings.some((heading) => heading.textContent?.trim() === expectedTitle)
            );
          },
          { timeout: 15_000 },
          { expectedSpread: spread, expectedTitle: title },
        ),
        { capMs: 15_000, label: `land on ${title}` },
      );
      await advanceScene(page, ctx, 380);
    }, { name: `land on ${title}`, seconds: 0.38 });
    for (const selector of waitFor) t.waitFor(selector);
    if (waitUntil !== null) t.waitUntil(waitUntil);
    t.hold(hold);
  };

  /**
   * The filmstrip is the quick route once the demo has introduced the TOC.
   * It keeps the action attached to the pages (and visibly proves the current
   * previews contain real ink) without reopening the same sheet for every
   * chapter. Scroll, click and landing are all product interactions.
   */
  const jumpWithThumbnail = (
    title,
    spread,
    { hold = 0.95, waitFor = [], waitUntil = null } = {},
  ) => {
    const selector = `.nb-thumb[aria-label^="Jump to ${title}"]`;
    t.call(async function bringThumbnailIntoView(page, ctx) {
      // Browser hover and gifsmith's filmed cursor are separate pointers. Park
      // the real one over quiet chrome before the strip scrolls; its old
      // tooltip fades during this 420ms movement instead of remaining pinned
      // to the previous thumbnail while the visible cursor travels away.
      // BookView summons its back button inside x<=280/y<=160. (110,24)
      // looked like quiet chrome but was inside that zone, so the real hidden
      // pointer expanded/faded the button while the filmed cursor remained on
      // a thumbnail. Keep both facts honest by parking just outside the zone.
      await page.mouse.move(320, 24);
      await sceneScrollInline(page, ctx, selector, 420);
    }, { name: `scroll the filmstrip to ${title}`, seconds: 0.42 });
    t.click(selector, { via: 'cursor', glideSeconds: 0.34 });
    t.call(async function waitForThumbnailDestination(page, ctx) {
      await settleScene(
        ctx,
        page.waitForFunction(
          ({ expectedSpread, expectedTitle }) => {
            const stage = document.querySelector('.nb-spread-stage');
            const at = Number(stage?.getAttribute('data-spread-index'));
            const headings = [...document.querySelectorAll('.nb-leaf-paper h1')];
            return (
              at === expectedSpread &&
              headings.some((heading) => heading.textContent?.trim() === expectedTitle)
            );
          },
          { timeout: 15_000 },
          { expectedSpread: spread, expectedTitle: title },
        ),
        { capMs: 15_000, label: `land on ${title} from filmstrip` },
      );
      await advanceScene(page, ctx, 260);
    }, { name: `land on ${title} from filmstrip`, seconds: 0.26 });
    for (const required of waitFor) t.waitFor(required);
    if (waitUntil !== null) t.waitUntil(waitUntil);
    // The current pair must have content-bearing document previews, not the
    // blank ruled shells the old, un-centred demo held for ten seconds.
    t.waitUntil(() => {
      const current = [...document.querySelectorAll('.nb-thumb.is-current .nb-thumb-paper')];
      return current.length > 0 && current.every((paper) => paper.classList.contains('has-preview'));
    });
    t.hold(hold);
  };

  /**
   * The ribbon control is both an action and the doorway to its full drawer.
   * Show the complete panel, then remove the temporary mark before moving on:
   * that proves page-local ribbons without changing the Welcome book at the
   * loop boundary or making a bookmark appear to follow the next turn.
   */
  const showRibbons = () => {
    const ribbonButton = '.nb-rail button[data-tool="bookmark"]';
    t.click(ribbonButton, { via: 'cursor' });
    t.waitFor('.nb-ribbon-plate');
    t.hold(0.65);
    t.click('.nb-ribbon-plate-actions button:last-child', { via: 'cursor' });
    t.waitFor('.nb-ribbon-drawer');
    t.hold(1.2);
    t.click('[aria-label^="Close Ribbons"]', { via: 'cursor' });
    t.hold(0.35);
    t.click(ribbonButton, { via: 'cursor' });
    t.waitUntil(() => document.querySelector('.nb-ribbon-plate') === null);
    t.hold(0.25);
  };

  /** Open both reveal controls on the Welcome spread that teaches them. */
  const showFoldedAside = () => {
    const markVisibleControl = (selector, mark) =>
      t.call(async function markRevealControl(page) {
        const found = await page.evaluate(({ wanted, attribute }) => {
          for (const prior of document.querySelectorAll(`[${attribute}]`)) {
            prior.removeAttribute(attribute);
          }
          const control = [...document.querySelectorAll(wanted)].find((candidate) => {
            if (!(candidate instanceof HTMLElement)) return false;
            if (candidate.closest('[aria-hidden="true"]') !== null) return false;
            const rect = candidate.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 &&
              rect.left < innerWidth && rect.right > 0 &&
              rect.top < innerHeight && rect.bottom > 0;
          });
          if (!(control instanceof HTMLElement)) return false;
          control.setAttribute(attribute, 'true');
          return true;
        }, { wanted: selector, attribute: mark });
        if (!found) throw new Error(`demo-gif: no visible reveal control for ${selector}`);
      }, { name: `mark visible ${selector}` });

    markVisibleControl('[data-type="details"] > button', 'data-demo-details');
    t.click('[data-demo-details="true"]', { via: 'cursor' });
    t.waitUntil(() => {
      const content = document
        .querySelector('[data-demo-details="true"]')
        ?.closest('[data-type="details"]')
        ?.querySelector('[data-type="detailsContent"]');
      if (!(content instanceof HTMLElement)) return false;
      const rect = content.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    markVisibleControl('.nb-spoiler-toggle', 'data-demo-spoiler');
    t.click('[data-demo-spoiler="true"]', { via: 'cursor' });
    t.waitUntil(() =>
      document.querySelector('[data-demo-spoiler="true"]')
        ?.closest('.nb-spoiler')
        ?.classList.contains('is-revealed') === true
    );
    t.hold(1.0);
    // Leave the seeded Welcome page as it arrived. Closing also returns its
    // geometry to the cached shape before the next real curl.
    t.click('[data-demo-spoiler="true"]', { via: 'cursor' });
    t.waitUntil(() =>
      document.querySelector('[data-demo-spoiler="true"]')
        ?.closest('.nb-spoiler')
        ?.classList.contains('is-revealed') === false
    );
    t.click('[data-demo-details="true"]', { via: 'cursor' });
    t.waitUntil(() => {
      const content = document
        .querySelector('[data-demo-details="true"]')
        ?.closest('[data-type="details"]')
        ?.querySelector('[data-type="detailsContent"]');
      return !(content instanceof HTMLElement) || content.getBoundingClientRect().height === 0;
    });
    t.hold(0.25);
  };

  /* Opening: nearby chapters are joined by honest curls, with a different
     panel between them so the tour never becomes a run of repeated turns. */
  turn('The shelf is a room', 1);
  // spread 1: The shelf is a room · More than one bookcase
  showPanel('Customize this book', '.nb-book-studio', { hold: 1.2 });
  turn('Dress the room', 2);
  // spread 2: Dress the room · Dress this book
  showPanel('Page style', '.nb-pagestyle', { hold: 1.25 });
  turn('Paper and ribbons', 3);
  // spread 3: Paper and ribbons · Four ways to begin
  turn('Write by blocks', 4);
  // spread 4: Write by blocks · Headings and dividers
  showPanel('Catalogue', '.nb-catalogue', { hold: 1.3 });

  /* Contents is introduced once and does useful work: it lands on the ledger
     specimen so the film proves prose remains seated on its printed rules
     after a special block. The kitten spread then arrives through ordinary
     page turns, keeping navigation legible without making it repetitive. */
  jumpToChapter('Cards with a purpose', 9, {
    hold: 1.35,
    waitFor: ['[data-type="ledger"]', '[data-type="postcard"]'],
  });

  turn('Keepsakes', 10);
  // spread 10: keepsakes · Fold it away
  showFoldedAside();
  turn('Washes and fasteners', 11);
  // spread 11: washes and fasteners · lettering cabinet
  turn('Pictures, starring kittens', 12);
  // spread 12: Pictures, starring kittens · One picture, properly
  t.waitFor('.nb-image-row .nb-image-img');
  t.waitUntil(() => {
    const pictures = [...document.querySelectorAll('.nb-image-row .nb-image-img')];
    return pictures.length >= 3 && pictures.every(
      (picture) => picture instanceof HTMLImageElement &&
        picture.complete && picture.naturalWidth > 0,
    );
  });
  t.hold(1.35);
  showRibbons();

  turn('Picture beside prose', 13);
  // spread 13: Picture beside prose · Sound and celebration
  turn('Local video', 14);
  // spread 14: Local video · Stickers of your own

  /* One filmstrip jump introduces the other navigation surface. Its live page
     previews remain on screen long enough to be read, then the strip closes
     and ordinary page turns resume. */
  t.click('.nb-rail button[aria-label^="Thumbnails strip"]', { via: 'cursor' });
  t.waitFor('.nb-thumb-strip');
  jumpWithThumbnail('A tree of ideas', 15, {
    hold: 1.35,
    waitUntil: () => document.querySelectorAll('.nb-diagram svg').length >= 2,
  });
  t.click('.nb-rail button[aria-label^="Thumbnails strip"]', { via: 'cursor' });
  t.waitUntil(() => document.querySelector('.nb-thumb-strip') === null);
  t.hold(0.25);

  turn('A graph of connections', 16);
  // spread 16: A graph of connections · A process, step by step
  t.waitUntil(() => document.querySelectorAll('.nb-diagram svg').length >= 2);
  t.hold(1.0);
  turn('A timeline', 17);
  // spread 17: A timeline · Diagrams stay editable
  turn('Maths in the margins', 18);
  // spread 18: Maths in the margins · Code, kept exactly
  turn('Notes at the foot', 19);
  // spread 19: Notes at the foot · Pages point at pages
  turn('Find anything again', 20);
  // spread 20: Find anything again · Four ways through

  /* The closing feature pages now meet their controls instead of being
     omitted: focus beside its guide, history beside autosave, then the full
     transfer panel beside Notebook Script and the final invitation. */
  turn('Focus, zoom, and leaf', 21);
  // spread 21: Focus, zoom, and leaf · History and autosave
  t.click('.nb-rail button[data-tool="focus"]', { via: 'cursor' });
  t.hold(0.9);
  t.click('[aria-label="Leave focus mode (Escape)"]', { via: 'cursor' });
  t.hold(0.45);
  showPanel('Page history', '.nb-history', {
    hold: 1.1,
    closeName: 'Turn back time',
  });
  turn('Daily pages and templates', 22);
  // spread 22: Daily pages and templates · Notebook Script
  turn('In, out, and safekeeping', 23);
  // spread 23 (the 24th/final spread): In, out, and safekeeping · This leaf is yours
  showPanel('In and out', '.nb-share', { showFoot: true });
  t.hold(1.15);

  /* --------------------------- 5. back to the shelf ----------------------- */

  // The collapsed pencil/arrow is itself the affordance and remains clickable.
  // Drive it directly: the visible cursor glide summons its label on the way,
  // instead of holding a finished page for nearly a second before acting.
  t.click('.nb-back-button', { via: 'cursor', glideSeconds: 0.36 });
  t.call(async function filmRealBookReturn(page, ctx) {
    /*
     * The app already owns this movement: spread → closing cover, the same
     * cover flying home over the resumed room, then the short canvas settle
     * into its slot. A plain timeline `waitFor('.shelf-dock')` lets those
     * animations finish while deterministic capture's clock is parked, which
     * records only their endpoints as two hard cuts. Settle on the real phase
     * boundaries while gifsmith advances its capture clock instead.
     */
    await settleScene(
      ctx,
      page.waitForSelector('.nb-book-close-bridge.is-active', {
        visible: true,
        timeout: 0,
      }),
      { capMs: 500, label: 'book close bridge starts' },
    );
    await settleScene(
      ctx,
      page.waitForSelector('[data-testid="pulled-book-return-wash"]', {
        visible: true,
        timeout: 0,
      }),
      { capMs: 900, label: 'closing cover reaches return route' },
    );
    await settleScene(
      ctx,
      page.waitForSelector('.pulled-book', { hidden: true, timeout: 0 }),
      { capMs: 1_000, label: 'returning DOM cover reaches its shelf slot' },
    );
    // The final owner is Pixi's short insertion ghost (0.56s at motion=1).
    // It has no DOM node to await, so spend its declared duration plus one
    // capture frame before the still-shelf gate below is allowed to begin.
    await advanceScene(page, ctx, 640);
  }, { name: 'film the real book return', seconds: 1.5 });
  t.waitFor('.shelf-dock');
  t.call(async function settleReturnShelf(page, ctx) {
    await settleSpines(page, ctx, { label: 'return shelf spines' });
    // The dashed add-book affordance arrives independently of the Pixi
    // spines. Gate on its real, visible DOM node, then spend more than its
    // declared 180ms `shelf-addslot-arrive` animation before the final hold is
    // allowed to begin. That keeps motion out of a beat the ledger calls still.
    await settleScene(
      ctx,
      page.waitForSelector('.shelf-addslot', { visible: true, timeout: 0 }),
      { capMs: 2_000, label: 'return shelf add-slot' },
    );
    await advanceScene(page, ctx, 220);
  }, { name: 'settle return shelf and add-slot', seconds: 0.22 });
  // Match the anchor's pointer pose as well as its shelf pose. In practice the
  // back button already leaves it close to here, so this is a small retreat,
  // not a conspicuous cursor-only epilogue.
  t.cursorTo(LOOP_CURSOR_HOME, 0.28, 'easeOut');
  /*
   * Land, and settle into the SAME pose the anchor was taken in. This hold is
   * what gives the trimmer a matching frame to cut on; too short and the seam
   * lands mid-animation.
   */
  t.hold(1.8);
});

const scene = {
  target: {
    url: APP_URL,
    // The shelf is WebGL, and a headless Chrome with no GPU silently falls
    // back to a canvas that never paints. SwiftShader is the same software
    // rasteriser every probe in this repo uses.
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  },
  out: `${OUT_DIR}/demo.webp`,
  viewport: { width: 1360, height: 850 },
  props: [cursor({ start: LOOP_CURSOR_HOME }), bezel()],
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
   * Read the paced frames as a sequence while the renderer still owns the
   * executed step ledger. A standalone review can still find flashes and
   * reversals, but without this opt-in it cannot distinguish motion promised
   * by a click/turn from motion leaking into a declared hold, or compare peer
   * turns against one another.
   */
  review: { dir: `${QA_DIR}/review`, maxFindings: 24, controls: 5 },
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
  const sheet = await contactSheet(scene, 16);
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
