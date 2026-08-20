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
 * Midway, the native Agent gets one unhurried documentary sequence: a reader
 * asks a question, then asks for study pages; the visible plan, actions,
 * native-page self-review, final preview and explicit approval advance on a
 * deterministic bridge. The words are frozen, human-vetted Cohere-authored
 * representative output from `fixtures/ai-agent-study-notes.md`. Playback
 * never calls a provider or saves an Agent row. The approval does exercise
 * BookView's real Script parser/page insertion seam, shows the resulting pages,
 * then returns to Welcome's own writing exercise for a direct edit without
 * disturbing the Agent's reviewed layout. The exact pre-demo book is restored
 * before the ordinary tour continues.
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
 *   node shots-now/demo-gif.mjs --qa-only   (render staged WebP + MP4, do not publish)
 *   node shots-now/demo-gif.mjs --promote-only (publish an accepted staged pair)
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  SHOWCASE_BINDINGS,
  SHOWCASE_FLOORS,
  SHOWCASE_STYLES,
  SHOWCASE_TITLES,
} from './showcase-library.mjs';

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

/*
 * The encoded film is 14fps at 1.1x playback, so one output frame represents
 * 78.57ms of scene time. CallContext exposes that exact value during the
 * deterministic render; snapshot/contact-sheet playback uses the real clock
 * and reports zero, so keep the authored value as its fallback. A literal
 * `advance(64)` used to claim it had bought two frames while buying less than
 * one. Geometry/readiness latches below now ask for frames, not hopeful ms.
 */
const DEMO_FPS = 14;
const DEMO_SPEED = 1.1;
const DEMO_FRAME_MS = (1_000 * DEMO_SPEED) / DEMO_FPS;

async function advanceSceneFrames(page, ctx, count = 1) {
  void page;
  const reported = Number(ctx?.frameMs);
  const frameMs = Number.isFinite(reported) && reported > 0 ? reported : DEMO_FRAME_MS;
  await advanceScene(page, ctx, (frameMs * Math.max(1, count)) + 0.5);
}

/**
 * A panel body existing in the DOM is not an open panel: RailPanel keeps its
 * children mounted after first use and parks the sheet off screen. Prove the
 * visible, fully-landed state before a beat is called a hold. Book Studio adds
 * one more promise: its portalled companion preview and active canvas exist.
 */
async function waitForPanelOpen(
  page,
  ctx,
  selector,
  { label, requireBookPreview = false } = {},
) {
  const name = label ?? selector;
  try {
    await settleScene(
      ctx,
      page.waitForFunction(
        ({ bodySelector, needsPreview }) => {
          const content = document.querySelector(bodySelector);
          const panel = content?.closest('.nb-rail-panel');
          if (!(content instanceof HTMLElement) || !(panel instanceof HTMLElement)) return false;
          const panelRect = panel.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const panelVisible =
            panel.getAttribute('aria-hidden') === 'false' &&
            !panel.classList.contains('is-sliding') &&
            getComputedStyle(panel).visibility === 'visible' &&
            panelRect.width > 40 && panelRect.height > 40 &&
            panelRect.left >= -0.5 && panelRect.right > 0 &&
            contentRect.width > 20 && contentRect.height > 20;
          if (!panelVisible) return false;
          if (!needsPreview) return true;
          const preview = document.querySelector('.nb-book-preview-dock');
          const canvas = preview?.querySelector('canvas[aria-hidden="false"]');
          if (!(preview instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) return false;
          const previewRect = preview.getBoundingClientRect();
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (context === null) return false;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let paintedSamples = 0;
          // One alpha sample per sixteen pixels is enough to distinguish the
          // fully transparent mount frame from a rendered binding without
          // turning a readiness poll into a full-image scan.
          for (let alpha = 3; alpha < pixels.length; alpha += 64) {
            if (pixels[alpha] > 8) paintedSamples += 1;
          }
          return (
            getComputedStyle(preview).display !== 'none' &&
            previewRect.width > 100 && previewRect.height > 100 &&
            canvas.width > 0 && canvas.height > 0 &&
            paintedSamples > 40
          );
        },
        { timeout: 15_000 },
        { bodySelector: selector, needsPreview: requireBookPreview },
      ),
      { capMs: 15_000, label: `open ${name}` },
    );
  } catch (cause) {
    const state = await page.evaluate((bodySelector) => {
      const content = document.querySelector(bodySelector);
      const panel = content?.closest('.nb-rail-panel');
      const preview = document.querySelector('.nb-book-preview-dock');
      return {
        content: content instanceof HTMLElement
          ? { width: content.getBoundingClientRect().width, height: content.getBoundingClientRect().height }
          : null,
        panel: panel instanceof HTMLElement
          ? {
              hidden: panel.getAttribute('aria-hidden'),
              sliding: panel.classList.contains('is-sliding'),
              visibility: getComputedStyle(panel).visibility,
              left: panel.getBoundingClientRect().left,
            }
          : null,
        preview: preview instanceof HTMLElement
          ? { display: getComputedStyle(preview).display, width: preview.getBoundingClientRect().width }
          : null,
      };
    }, selector);
    throw new Error(`demo-gif: ${name} did not open cleanly (${JSON.stringify(state)})`, { cause });
  }
  await advanceSceneFrames(page, ctx, 2);
}

async function waitForPanelClosed(page, ctx, selector, label = selector) {
  await settleScene(
    ctx,
    page.waitForFunction(
      (bodySelector) => {
        const content = document.querySelector(bodySelector);
        const panel = content?.closest('.nb-rail-panel');
        const edge = Number.parseFloat(
          document.documentElement.style.getPropertyValue('--nb-panel-edge'),
        ) || 0;
        const panelSettled = panel instanceof HTMLElement
          ? panel.getAttribute('aria-hidden') === 'true' &&
            !panel.classList.contains('is-sliding') &&
            getComputedStyle(panel).visibility === 'hidden'
          : [...document.querySelectorAll('.nb-rail-panel')].every(
            (candidate) =>
              candidate.getAttribute('aria-hidden') === 'true' &&
              !candidate.classList.contains('is-sliding'),
          );
        return panelSettled && Math.abs(edge) <= 0.5;
      },
      { timeout: 15_000 },
      selector,
    ),
    { capMs: 15_000, label: `close ${label}` },
  );
  // RailPanel's 300ms exit has landed. BookView then fits the spread from a
  // MutationObserver; give that observer and its geometry two captured frames.
  await advanceSceneFrames(page, ctx, 2);
}

/** Exact source-resolution QA poses; ignored by git, useful before encoding. */
async function writeQaStill(page, slug) {
  const capture = async () => page.screenshot({ type: 'png' });
  let png = await capture();
  // A root-scale camera shot can occasionally hit Chromium's empty
  // pre-composite surface even though the deterministic film frames around it
  // are correct. Treat a near-solid full-frame PNG as missing evidence, wait a
  // real compositor turn, and retry once. The byte threshold is deliberately
  // far below every genuine 1360×850 app still (normally 100–500KB) and above
  // the 12KB flat-parchment failure observed in this workflow.
  if (png.length < 40_000) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    png = await capture();
  }
  if (png.length < 40_000) {
    throw new Error(`demo-gif: QA still ${slug} captured an empty compositor surface`);
  }
  writeFileSync(`${QA_DIR}/target-${slug}.png`, png);
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
    const scroller = subject?.closest('.nb-ai-agent-scroll')
      ?? subject?.closest('.nb-rail-panel-body');
    if (!(subject instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;

    const from = scroller.scrollTop;
    if (destination === 'end') {
      return { from, to: Math.max(0, scroller.scrollHeight - scroller.clientHeight) };
    }

    if (destination === 'start') {
      const scrollerRect = scroller.getBoundingClientRect();
      const subjectRect = subject.getBoundingClientRect();
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const root = document.querySelector('#root');
      let cameraScale = 1;
      if (root instanceof HTMLElement) {
        try {
          const parsed = JSON.parse(root.dataset.demoCamera ?? '');
          if (Number.isFinite(parsed?.scale) && parsed.scale > 0) {
            cameraScale = parsed.scale;
          }
        } catch {
          // An ordinary untransformed product frame uses CSS-pixel deltas.
        }
      }
      return {
        from,
        // DOMRect is in transformed viewport pixels; scrollTop is in the
        // scroller's untransformed CSS pixels. Mixing them overshot long Agent
        // journeys whenever the documentary camera was already zoomed.
        to: Math.max(
          0,
          Math.min(max, from + ((subjectRect.top - scrollerRect.top) / cameraScale) - 10),
        ),
      };
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
      const subject = document.querySelector(selector);
      const scroller = subject?.closest('.nb-ai-agent-scroll')
        ?? subject?.closest('.nb-rail-panel-body');
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
 * A quiet documentary camera for the dense Agent panel.
 *
 * The product itself does not zoom its chrome. The README film does, because
 * 1360px is encoded down to 900px and a readable conversation would otherwise
 * become thumbnail text. This transform is recording-only, advances at exact
 * scene-frame boundaries, and always returns to identity before the next real
 * product interaction. Reframing from an existing focus works from the
 * untransformed geometry, so it never compounds scale or drifts.
 */
async function sceneCameraFocus(
  page,
  ctx,
  selector,
  {
    scale = 1.18,
    centerX = 365,
    centerY = 470,
    durationMs = 420,
  } = {},
) {
  const movement = await page.evaluate(
    ({ wanted, scale: nextScale, centerX: wantedX, centerY: wantedY }) => {
      const root = document.querySelector('#root');
      const subject = document.querySelector(wanted);
      if (!(root instanceof HTMLElement) || !(subject instanceof HTMLElement)) return null;
      const current = (() => {
        try {
          const parsed = JSON.parse(root.dataset.demoCamera ?? '');
          if (
            Number.isFinite(parsed?.tx) &&
            Number.isFinite(parsed?.ty) &&
            Number.isFinite(parsed?.scale) &&
            parsed.scale > 0
          ) return parsed;
        } catch {
          // First focus starts at the untransformed application frame.
        }
        return { tx: 0, ty: 0, scale: 1 };
      })();
      const rect = subject.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      const baseCenterX = (((rect.left + rect.right) / 2) - current.tx) / current.scale;
      const baseCenterY = (((rect.top + rect.bottom) / 2) - current.ty) / current.scale;
      const rootRect = root.getBoundingClientRect();
      const baseWidth = rootRect.width / current.scale;
      const baseHeight = rootRect.height / current.scale;
      const rawTx = wantedX - (baseCenterX * nextScale);
      const rawTy = wantedY - (baseCenterY * nextScale);
      // Documentary zoom may crop the app, but it must never translate the
      // app itself beyond an edge of the viewport. The old unconstrained
      // target calculation could become positive after a transcript reflow,
      // pushing the whole root down and leaving several flat pink frames.
      const minTx = Math.min(0, window.innerWidth - (baseWidth * nextScale));
      const minTy = Math.min(0, window.innerHeight - (baseHeight * nextScale));
      return {
        from: current,
        to: {
          tx: Math.max(minTx, Math.min(0, rawTx)),
          ty: Math.max(minTy, Math.min(0, rawTy)),
          scale: nextScale,
        },
      };
    },
    { wanted: selector, scale, centerX, centerY },
  );
  if (movement === null) {
    throw new Error(`demo-gif: camera subject is not visible (${selector})`);
  }

  const steps = Math.max(3, Math.ceil(durationMs / 70));
  for (let step = 1; step <= steps; step += 1) {
    const p = step / steps;
    const eased = p * p * (3 - (2 * p));
    const frame = {
      tx: movement.from.tx + ((movement.to.tx - movement.from.tx) * eased),
      ty: movement.from.ty + ((movement.to.ty - movement.from.ty) * eased),
      scale: movement.from.scale + ((movement.to.scale - movement.from.scale) * eased),
    };
    await page.evaluate((next) => {
      const root = document.querySelector('#root');
      if (!(root instanceof HTMLElement)) return;
      root.style.transformOrigin = '0 0';
      root.style.willChange = 'transform';
      root.style.transform = `translate3d(${next.tx}px, ${next.ty}px, 0) scale(${next.scale})`;
      root.dataset.demoCamera = JSON.stringify(next);
    }, frame);
    await advanceScene(page, ctx, durationMs / steps);
  }
}

async function sceneCameraReset(page, ctx, durationMs = 420) {
  const from = await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!(root instanceof HTMLElement)) return null;
    try {
      const parsed = JSON.parse(root.dataset.demoCamera ?? '');
      if (
        Number.isFinite(parsed?.tx) &&
        Number.isFinite(parsed?.ty) &&
        Number.isFinite(parsed?.scale)
      ) return parsed;
    } catch {
      // A missing camera pose is already identity.
    }
    return null;
  });
  if (from === null) return;

  const steps = Math.max(3, Math.ceil(durationMs / 70));
  for (let step = 1; step <= steps; step += 1) {
    const p = step / steps;
    const eased = p * p * (3 - (2 * p));
    const frame = {
      tx: from.tx * (1 - eased),
      ty: from.ty * (1 - eased),
      scale: from.scale + ((1 - from.scale) * eased),
    };
    await page.evaluate((next) => {
      const root = document.querySelector('#root');
      if (!(root instanceof HTMLElement)) return;
      root.style.transform = `translate3d(${next.tx}px, ${next.ty}px, 0) scale(${next.scale})`;
      root.dataset.demoCamera = JSON.stringify(next);
    }, frame);
    await advanceScene(page, ctx, durationMs / steps);
  }
  await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!(root instanceof HTMLElement)) return;
    root.style.removeProperty('transform');
    root.style.removeProperty('transform-origin');
    root.style.removeProperty('will-change');
    delete root.dataset.demoCamera;
  });
}

/**
 * Remove the documentary crop between captured frames.
 *
 * A modal is viewport-level while the camera transform lives on `#root`.
 * Interpolating that root after the modal trigger produced the reported run
 * of flat pink frames: the old translated app left the viewport before the
 * portalled reviewer had painted.  Modal hand-offs use this atomic reset and
 * then spend two populated compositor frames at honest product geometry.
 */
async function sceneCameraSnapReset(page, ctx, label = 'camera snap') {
  const populated = await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!(root instanceof HTMLElement)) return false;
    root.style.removeProperty('transform');
    root.style.removeProperty('transform-origin');
    root.style.removeProperty('will-change');
    delete root.dataset.demoCamera;
    return root.getBoundingClientRect().width > 100 &&
      document.querySelector('.nb-spread-stage, .shelf-stage') !== null;
  });
  if (!populated) throw new Error(`demo-gif: ${label} lost the application frame`);
  await advanceSceneFrames(page, ctx, 2);
}

async function sceneType(page, ctx, selector, value, delayMs = 18) {
  const focused = await page.evaluate((wanted) => {
    const field = document.querySelector(wanted);
    if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) return false;
    field.focus();
    return true;
  }, selector);
  if (!focused) throw new Error(`demo-gif: typing field is unavailable (${selector})`);
  for (const character of value) {
    await page.keyboard.type(character);
    await advanceScene(page, ctx, delayMs);
  }
}

/**
 * A camera can make an element's centre land on screen while its scroller is
 * still clipping the top. Assert against the actual visible band before a QA
 * still—or an expensive encode—can claim a complete prompt card was shown.
 */
async function assertAgentCardFullyVisible(page, selector, label) {
  const metrics = await page.evaluate((wanted) => {
    const card = document.querySelector(wanted);
    const scroller = card?.closest('.nb-ai-agent-scroll');
    if (!(card instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return null;
    const cardRect = card.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      cardHeight: cardRect.height,
      scrollerTop: scrollerRect.top,
      scrollerBottom: scrollerRect.bottom,
      scrollerHeight: scrollerRect.height,
      visible:
        cardRect.top >= scrollerRect.top - 1 &&
        cardRect.bottom <= scrollerRect.bottom + 1,
    };
  }, selector);
  if (metrics === null || !metrics.visible) {
    throw new Error(
      `demo-gif: ${label} is clipped by the Agent transcript (${JSON.stringify(metrics)})`,
    );
  }
  console.log(
    `[demo-gif] ${label} fully visible ` +
    `(card ${metrics.cardTop.toFixed(1)}..${metrics.cardBottom.toFixed(1)}, ` +
    `scroller ${metrics.scrollerTop.toFixed(1)}..${metrics.scrollerBottom.toFixed(1)})`,
  );
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
const QA_ONLY = args.includes('--qa-only');
const PROMOTE_ONLY = args.includes('--promote-only');
const URL_BASE = opt('url', 'http://localhost:1420');

/*
 * `fx=force` for the bridges and the full shelf; `dev=0` to suppress the dev
 * view switcher, which is a developer affordance and has no business in a
 * picture of the product. Both are the same two the README shots take.
 */
const APP_URL = `${URL_BASE}/?fx=force&dev=0`;

const AGENT_DEMO = Object.freeze({
  fixture: 'shots-now/fixtures/ai-agent-study-notes.md',
  provenance: 'shots-now/fixtures/ai-agent-study-notes.provenance.json',
  playback: 'frozen representative output; no provider request; reversible real page insertion',
  explainRequest:
    'Can you explain Huffman coding with kittens?',
  buildRequest:
    'Great — turn that into three study-note pages and use the kitten infographic I attached.',
});

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
const DEMO_OUT = `${OUT_DIR}/demo.webp`;
const DEMO_STAGING = `${QA_DIR}/demo.next.webp`;
const DEMO_MP4 = `${QA_DIR}/demo.mp4`;
const DEMO_MP4_STAGING = `${QA_DIR}/demo.next.mp4`;

/**
 * Publish the README film and its seekable review copy as one recoverable pair.
 * Windows reviewers commonly keep the MP4 open, which can lock that target;
 * replacing the WebP first would then leave two different cuts. Back up both
 * current outputs, move both staged outputs, and restore the old pair on any
 * failure. Gifsmith already publishes the staging pair atomically; this is the
 * outer repo-level transaction from qa/ into their final destinations.
 */
function promoteDemoPair() {
  const files = [
    { staged: DEMO_MP4_STAGING, final: DEMO_MP4, backup: `${DEMO_MP4}.previous` },
    { staged: DEMO_STAGING, final: DEMO_OUT, backup: `${DEMO_OUT}.previous` },
  ];
  for (const file of files) rmSync(file.backup, { force: true });
  const backedUp = [];
  const promoted = [];
  try {
    for (const file of files) {
      if (!existsSync(file.final)) continue;
      copyFileSync(file.final, file.backup);
      backedUp.push(file);
    }
    // Try the reviewer-held MP4 first. If it is locked, the README WebP has
    // not moved yet and the published pair remains untouched.
    for (const file of files) {
      renameSync(file.staged, file.final);
      promoted.push(file);
    }
    for (const file of backedUp) rmSync(file.backup, { force: true });
  } catch (error) {
    for (const file of promoted.reverse()) rmSync(file.final, { force: true });
    for (const file of backedUp) {
      if (existsSync(file.backup)) renameSync(file.backup, file.final);
    }
    throw error;
  }
}

const [FLOOR_1, FLOOR_2, FLOOR_3] = SHOWCASE_FLOORS;
const SEEDED_TITLES = SHOWCASE_TITLES;
const EXPECTED_SHELF_BOOKS = SEEDED_TITLES.length + 1; // the authored Welcome book

/**
 * What the studio tour presses, in order.
 *
 * By VISIBLE NAME rather than by preset id, through the `aria-label` every
 * `DesignStrip` tile already carries (`"<name> — <blurb>"`), which an attribute
 * prefix match reaches with ordinary CSS. gifsmith resolves selectors with
 * `querySelector`, so Playwright's `:has-text()` is a syntax error here — worth
 * saying out loud because the dry run is what caught it.
 *
 * Several axes, not one, because the point the reader asked for is *"so many
 * options in different areas of customisation … to show how you can change it
 * drastically"*: a whole room, then the construction and the carving as two
 * separate shelf axes, the shelf-only colour, the wall behind it, then the
 * colours over all of it. Repainting a room never straightens its arches, and
 * rebuilding it never removes the pattern worked into its timber. The named
 * Lapis → Garnet pair is intentional: it makes the shelf-only colour control
 * unmistakable instead of asking a viewer to infer it from two brown swatches.
 *
 * THE LAST ENTRY RETURNS TO THE OPENING ROOM. A room preset sets colour,
 * carpentry and paper together, so pressing The House Room again undoes all
 * of the individual changes above it in one press — which is what lets
 * the scene come home, and the loop close without a crossfade. See the note at
 * the top of the file.
 */
const STUDIO_TOUR = [
  { strip: 'Room presets', name: 'Gilt Salon' },
  // Near-black pointed bays after the golden salon remain legible even in a
  // 900px README film; the old bright-to-bright Carnival step read as only a
  // colour flicker once the whole shelf was reduced.
  { strip: 'Room presets', name: 'Chapter House' },
  { strip: 'Bookcase build', name: 'Atelier' },
  // A second direct carpentry press communicates structural range without
  // detouring into a search sheet in the middle of a visual tour.
  { strip: 'Bookcase build', name: 'Ladder Shelf' },
  // The carving/timber treatment is its own axis. Keep this explicit in the
  // film: changing only the build was previously easy to mistake for showing
  // the whole of shelf customisation.
  // A high-relief bead-and-quirk is available directly in the inline strip,
  // so this remains one obvious click instead of detouring through a search
  // sheet. It also survives README scale better than the old shallow fluting.
  { strip: 'Timber pattern', name: 'Bead & Quirk' },
  { strip: 'Wallpaper', name: 'Watered Silk' },
  { strip: 'Library colours', name: 'Limed Oak' },
  {
    strip: 'Shelf colours',
    name: 'Lapis Cabinet',
    qaStill: 'lapis-shelves',
    selector:
      '[aria-label="shelves colours"] .nb-chip-swatch[aria-label="shelves: Lapis Cabinet"]',
  },
  {
    strip: 'Shelf colours',
    name: 'Garnet',
    qaStill: 'garnet-shelves',
    selector:
      '[aria-label="shelves colours"] .nb-chip-swatch[aria-label="shelves: Garnet"]',
  },
  { strip: 'Room presets', name: 'The House Room' },
];

/** A CSS selector for one tile in one named strip. */
const tileSelector = (step) =>
  step.selector !== undefined
    ? step.selector
    : step.name !== undefined
      ? `[aria-label="${step.strip}"] .nb-strip-tile[aria-label^="${step.name}"]`
      : `[aria-label="${step.strip}"] .nb-strip-tile:nth-of-type(${step.index})`;

/**
 * An option is applied only when all three clocks agree: the named control is
 * pressed, the Studio's ordered save lane is idle, and the shelf has finished
 * its atomic room reveal. A declarative t.waitFor is warning-only and cannot
 * make that promise.
 */
async function waitForStudioChoice(page, ctx, selector, label, qaStill = null) {
  try {
    await settleScene(
      ctx,
      page.waitForFunction(
        (wanted) => {
          const option = document.querySelector(wanted);
          const studio = document.querySelector('.nb-library-studio');
          return (
            option instanceof HTMLElement &&
            option.getAttribute('aria-pressed') === 'true' &&
            studio instanceof HTMLElement &&
            studio.dataset.busy === 'false'
          );
        },
        { timeout: 15_000 },
        selector,
      ),
      { capMs: 15_000, label: `apply ${label}` },
    );
    await settleSpines(page, ctx, { label: `studio room after ${label}` });
    // The ordinary film beat only needs the two post-commit paints. A named QA
    // still also waits out gifsmith's 420ms click ripple, otherwise the exact
    // colour we are trying to review is photographed under a translucent ring.
    await advanceSceneFrames(page, ctx, qaStill === null ? 2 : 6);
    const stillApplied = await page.evaluate((wanted) => {
      const option = document.querySelector(wanted);
      const studio = document.querySelector('.nb-library-studio');
      return option?.getAttribute('aria-pressed') === 'true' && studio?.dataset.busy === 'false';
    }, selector);
    if (!stillApplied) throw new Error('the selected control changed while the room settled');
    if (qaStill !== null) await writeQaStill(page, qaStill);
  } catch (cause) {
    const state = await page.evaluate((wanted) => {
      const option = document.querySelector(wanted);
      const studio = document.querySelector('.nb-library-studio');
      return {
        found: option !== null,
        pressed: option?.getAttribute('aria-pressed'),
        busy: studio instanceof HTMLElement ? studio.dataset.busy : null,
        sheet: studio instanceof HTMLElement ? studio.dataset.sheet : null,
      };
    }, selector);
    throw new Error(`demo-gif: Studio did not apply ${label} (${JSON.stringify(state)})`, {
      cause,
    });
  }
}

async function waitForWarmNextFlip(page, ctx, heading) {
  // The rebuilt book art makes the first high-resolution cover/spine queue a
  // little heavier on SwiftShader. This is a preflight wait outside filmed
  // time, so give snapshot preparation room without changing the demo pace.
  const warmTimeoutMs = 45_000;
  try {
    await settleScene(
      ctx,
      page.waitForFunction(() => {
        const faces = globalThis.__flipCache?.facesFor?.('next');
        // The stationary leaf stays live DOM during a forward curl; only the
        // moving front/back and newly revealed face are sampled by the shader.
        // `faces.fresh` also includes that live stationary page, so requiring
        // it can deadlock even when every bitmap the curl consumes is ready.
        return Boolean(
          faces && faces.hasFront && faces.hasBack && faces.hasRevealed &&
          faces.quiet && faces.aheadPending === 0
        );
      }, { timeout: warmTimeoutMs }),
      { capMs: warmTimeoutMs, label: `warm curl before ${heading}` },
    );
  } catch (cause) {
    const state = await page.evaluate(() => globalThis.__flipCache?.facesFor?.('next') ?? null);
    throw new Error(
      `demo-gif: next curl was not warm before ${heading} (${JSON.stringify(state)})`,
      { cause },
    );
  }
}

/** Opening and closing shelf must be the same authored pose, not merely similar. */
async function assertDemoShelfHome(page, label) {
  const state = await page.evaluate(async ({ expectedCount, seededTitles }) => {
    const [{ DEFAULT_ROOM_DESIGN }, { DEFAULT_LIBRARY_PREFS }] = await Promise.all([
      import('/src/data/designPrefs.ts'),
      import('/src/features/bookshelf/libraryPrefs.ts'),
    ]);
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    const ids = books.map((book) => book.id);
    const titles = books.map((book) => book.title);
    const prefs = globalThis.__libraryPrefs?.current?.() ?? null;
    const applied = globalThis.__shelfDesign?.() ?? null;
    const design = applied?.design ?? null;
    const panelEdge = Number.parseFloat(
      document.documentElement.style.getPropertyValue('--nb-panel-edge'),
    ) || 0;
    const panelsClosed = [...document.querySelectorAll('.nb-rail-panel')].every(
      (panel) =>
        panel.getAttribute('aria-hidden') === 'true' &&
        !panel.classList.contains('is-sliding'),
    );
    const samePrefs = prefs !== null &&
      prefs.theme === DEFAULT_LIBRARY_PREFS.theme &&
      prefs.shelf === DEFAULT_LIBRARY_PREFS.shelf &&
      prefs.wall === DEFAULT_LIBRARY_PREFS.wall &&
      prefs.timberHex === DEFAULT_LIBRARY_PREFS.timberHex &&
      prefs.wallHex === DEFAULT_LIBRARY_PREFS.wallHex;
    const sameDesign = design !== null &&
      design.build === DEFAULT_ROOM_DESIGN.build &&
      design.pattern === DEFAULT_ROOM_DESIGN.pattern &&
      JSON.stringify(design.wallpaper) === JSON.stringify(DEFAULT_ROOM_DESIGN.wallpaper);
    const exactSeededTitles = seededTitles.every(
      (title) => titles.filter((candidate) => candidate === title).length === 1,
    );
    const welcomeCount = titles.filter((title) => /welcome/i.test(title)).length;
    const shelfVisible = (() => {
      const shelf = document.querySelector('.shelf-dock');
      if (!(shelf instanceof HTMLElement)) return false;
      const rect = shelf.getBoundingClientRect();
      return rect.width > 20 && rect.height > 20;
    })();
    return {
      ok:
        books.length === expectedCount &&
        new Set(ids).size === expectedCount &&
        exactSeededTitles &&
        welcomeCount === 1 &&
        samePrefs &&
        sameDesign &&
        panelsClosed &&
        Math.abs(panelEdge) <= 0.5 &&
        document.querySelector('.pulled-book') === null &&
        shelfVisible,
      count: books.length,
      uniqueIds: new Set(ids).size,
      missingSeeded: seededTitles.filter((title) => !titles.includes(title)),
      welcomeCount,
      prefs,
      design,
      expectedDesign: DEFAULT_ROOM_DESIGN,
      panelsClosed,
      panelEdge,
      pulled: document.querySelector('.pulled-book') !== null,
      shelfVisible,
    };
  }, { expectedCount: EXPECTED_SHELF_BOOKS, seededTitles: SEEDED_TITLES });
  if (!state.ok) {
    throw new Error(`demo-gif: ${label} is not the authored shelf home (${JSON.stringify(state)})`);
  }
}

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
    /*
     * Start on the AUTHORED DEFAULT even after an interrupted check left the
     * reusable demo database wearing the last room it tried. Read constants
     * from any Vite module instance, but write through the world's bridges:
     * the HMR duplicate-module warning applies to reactive stores, not to these
     * immutable values, and the bridges are the subscribed store instances.
     */
    await settleScene(
      ctx,
      page.evaluate(async () => {
        const [
          { DEFAULT_ROOM_DESIGN },
          { DEFAULT_LIBRARY_PREFS },
          { DEFAULT_SETTINGS },
        ] = await Promise.all([
          import('/src/data/designPrefs.ts'),
          import('/src/features/bookshelf/libraryPrefs.ts'),
          import('/src/data/defaults.ts'),
        ]);
        await globalThis.__libraryPrefs.save({ ...DEFAULT_LIBRARY_PREFS });
        await globalThis.__shelfSaveSettings({ theme: DEFAULT_SETTINGS.theme });
        await globalThis.__shelfSaveDesign({
          ...DEFAULT_ROOM_DESIGN,
          wallpaper: { ...DEFAULT_ROOM_DESIGN.wallpaper },
        });
      }),
      { capMs: 15_000, label: 'restore authored opening room' },
    );
    await advanceScene(page, ctx, 1_100);
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
    await settleScene(
      ctx,
      page.evaluate(async ({ titles, bindings, styles }) => {
        const visible = globalThis.__shelfVisibleBooks?.() ?? [];
        const byTitle = new Map(visible.map((book) => [book.title, book]));
        for (let index = 0; index < titles.length; index += 1) {
          const book = byTitle.get(titles[index]);
          if (!book) throw new Error(`missing demo book: ${titles[index]}`);
          await globalThis.__shelfSaveBinding(book.id, bindings[index]);
          const current = globalThis.__shelfBookStyle?.(book.id) ?? {};
          await globalThis.__shelfSetBookStyle(book.id, {
            ...current,
            ...styles[index],
          });
        }
      }, {
        titles: SEEDED_TITLES,
        bindings: SHOWCASE_BINDINGS,
        styles: SHOWCASE_STYLES,
      }),
      { capMs: 90_000, label: 'pin authored demo bindings and colours' },
    );
    await advanceScene(page, ctx, 2_400);
    // Opening the Welcome book later makes it the world's recent book and
    // adds the pale status ribbon to its spine. The loop closes after that
    // state change, so the anchor has to start with the same mark or the last
    // frame toggles one ornament as it returns to frame one. Use the world
    // instance the app exposes — importing the data module from this page can
    // resolve an HMR-duplicated store that the visible shelf never observes.
    const recent = await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      const welcomeBooks = books.filter((book) => /welcome/i.test(book.title));
      const welcome = welcomeBooks.length === 1 ? welcomeBooks[0] : null;
      if (!welcome || typeof globalThis.__shelfWorld?.noteBookOpened !== 'function') {
        return { ok: false, seen: books.length, welcomeCount: welcomeBooks.length };
      }
      globalThis.__shelfWorld.noteBookOpened(welcome.id);
      return { ok: true, title: welcome.title };
    });
    if (!recent.ok) {
      throw new Error(
        `demo-gif: cannot mark the one Welcome book recent ` +
        `(${recent.seen} visible, ${recent.welcomeCount} Welcome matches)`,
      );
    }
    await advanceScene(page, ctx, 3000);
    await settleSpines(page, ctx, { label: 'seeded shelf spines' });
  });
  t.call(async function settleShelfForSeam(page, ctx) {
    await settleSpines(page, ctx, { label: 'shelf seam spines' });
    // Puppeteer's pointer owns real :hover state; the drawn cursor is separate.
    // Start both on the same quiet point the closing shelf must reproduce.
    await page.mouse.move(LOOP_CURSOR_HOME.x, LOOP_CURSOR_HOME.y);
    await advanceSceneFrames(page, ctx, 1);
    await assertDemoShelfHome(page, 'opening loop anchor');
  }, { name: 'settle and verify opening shelf', seconds: 0.08 });
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
   * The first frame a GitHub reader sees. Start moving almost immediately so
   * a reader cannot mistake the shelf for a still and scroll past the demo.
   * The long matching hold at the end still gives the trimmer its clean seam.
   */
  t.hold(0.1);

  /* ---------------------------- 2. the studio ---------------------------- */

  t.click('[aria-label="Library studio"]', { via: 'cursor' });
  /*
   * WAIT UNTIL THE SHEET HAS LANDED AND A TILE IS ACTUALLY THERE TO PRESS.
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
  t.call(async function landLibraryStudio(page, ctx) {
    await waitForPanelOpen(page, ctx, '.nb-library-studio', { label: 'Library studio' });
    const firstTileReady = await page.evaluate(() => {
      const tile = document.querySelector('[aria-label="Room presets"] .nb-strip-tile');
      if (!(tile instanceof HTMLElement)) return false;
      const rect = tile.getBoundingClientRect();
      return rect.width > 8 && rect.height > 8 && rect.left >= 0 && rect.top < innerHeight;
    });
    if (!firstTileReady) {
      throw new Error('demo-gif: Library studio landed without a visible room-preset tile');
    }
  }, { name: 'land Library studio', seconds: 0.6 });
  /*
   * One beat to read that the studio opened — not 1.8s. The sheet slide and
   * the cursor glide to the first tile are the motion; this is just a settle.
   */
  t.hold(0.6);
  t.cue('studio');

  for (const step of STUDIO_TOUR) {
    const selector = tileSelector(step);
    // A pick can rebuild every preview card because its art depends on the
    // applied room. Wait for the named successor to exist after that rebuild;
    // otherwise a fast capture can scroll/click the one-frame gap and silently
    // omit a choice from the film.
    t.call(async function waitForStudioTile(page, ctx) {
      try {
        await settleScene(
          ctx,
          page.waitForFunction(
            (wanted) => {
              const option = document.querySelector(wanted);
              const studio = document.querySelector('.nb-library-studio');
              if (!(option instanceof HTMLElement) || !(studio instanceof HTMLElement)) return false;
              const rect = option.getBoundingClientRect();
              return studio.dataset.sheet === 'none' && rect.width > 8 && rect.height > 8;
            },
            { timeout: 15_000 },
            selector,
          ),
          { capMs: 15_000, label: `find ${step.name ?? step.strip} in Library studio` },
        );
      } catch (error) {
        throw new Error(`demo-gif: studio option ${step.strip} / ${step.name ?? step.index} did not become ready`, {
          cause: error,
        });
      }
    }, { name: `find ${step.name ?? `${step.strip} #${step.index}`}`, seconds: 0.08 });
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
    }, { name: `scroll to ${step.name ?? `${step.strip} #${step.index}`}`, seconds: 0.5 });
    t.click(selector, { via: 'cursor' });
    // Long enough to watch the case and wall actually repaint, and strict
    // enough that a missed click cannot turn the rest of the film into a lie.
    t.call(async function applyStudioOption(page, ctx) {
      await waitForStudioChoice(
        page,
        ctx,
        selector,
        step.name ?? step.strip,
        step.qaStill ?? null,
      );
    }, { name: `apply ${step.name ?? step.strip}`, seconds: 0.65 });
    if (step.qaStill !== undefined) t.cue(`qa-${step.qaStill}`);
    // The applied-state gate above owns correctness; this is only the beat in
    // which the viewer sees the finished choice. The former 1.5s pause after
    // every tile made the studio feel slower than the app.
    t.hold(step.qaStill === undefined ? 0.65 : 0.9);
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
  t.call(async function closeLibraryStudio(page, ctx) {
    await waitForPanelClosed(page, ctx, '.nb-library-studio', 'Library studio');
  }, { name: 'settle Library studio close', seconds: 0.5 });
  t.hold(0.25);

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
  // Use the product route exactly as a reader does. The old recording-only
  // split-screen photograph made the cover fly apart like a slide transition
  // and concealed the real opening fallback. Keeping the real pointer, pulled
  // cover, BookOpening sheet and first live spread gives the film the same
  // visual contract as the shipped app.
  t.click('.pulled-book', { via: 'cursor' });
  t.waitFor('.nb-prose');
  t.call(async function settleRealBookOpening(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelector('.nb-prose') instanceof HTMLElement &&
          document.querySelector('.pulled-book') === null &&
          document.querySelector('.nb-book-opening') === null,
        { timeout: 20_000 },
      ),
      { capMs: 20_000, label: 'settle the real product book opening' },
    );
    await advanceSceneFrames(page, ctx, 4);
  }, { name: 'settle the real product book opening', seconds: 0.38 });
  t.hold(1.25);
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
  const turn = (expectedHeading, expectedSpread, { requireWarmCurl = true } = {}) => {
    // Keep the filmed curl on the warmed path. A real reader can use the live
    // fold fallback immediately; the demo can wait briefly and show the
    // richer curl rather than filming a cache race.
    if (requireWarmCurl) {
      t.call(async function waitForWarmCurl(page, ctx) {
        await waitForWarmNextFlip(page, ctx, expectedHeading);
      }, { name: `warm curl before ${expectedHeading}`, seconds: 0.08 });
    }
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
    // Wait on the overlay itself. Gifsmith's declarative wait is intentionally
    // warning-only on timeout; a rejected, lost corner click then surfaced one
    // step later as misleading storyboard drift. Make landing a throwing gate
    // and let the capture clock film however many real curl frames it needs.
    t.call(async function waitForTurnToLand(page, ctx) {
      await settleScene(
        ctx,
        page.waitForFunction(
          ({ expectedSpread, expectedHeading }) =>
            document.querySelector('.nb-flip-canvas.is-flipping') === null &&
            !document.querySelector('.nb-flip-surface.is-flip-landing') &&
            Number(
              document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index'),
            ) === expectedSpread &&
            [...document.querySelectorAll('.nb-leaf-paper h1')].some(
              (heading) => heading.textContent?.trim() === expectedHeading,
            ),
          { timeout: 15_000 },
          { expectedSpread, expectedHeading },
        ),
        { capMs: 15_000, label: `land on ${expectedHeading}` },
      );
      await advanceSceneFrames(page, ctx, 1);
    }, { name: `land on ${expectedHeading}`, seconds: 0.6 });
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
    { hold = 1.25, showFoot = false, closeName = name, qaStill = null } = {},
  ) => {
    t.click(`.nb-rail button[aria-label^="${name}"]`, { via: 'cursor' });
    t.call(async function waitForBookPanelOpen(page, ctx) {
      await waitForPanelOpen(page, ctx, selector, {
        label: name,
        requireBookPreview: selector === '.nb-book-studio',
      });
      if (qaStill !== null) await writeQaStill(page, qaStill);
    }, { name: `land ${name}`, seconds: 0.6 });
    if (qaStill !== null) t.cue(`qa-${qaStill}`);
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
    t.call(async function waitForPanelClose(page, ctx) {
      await waitForPanelClosed(page, ctx, selector, closeName);
    }, { name: `settle ${closeName} close`, seconds: 0.5 });
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
  showPanel('Customize this book', '.nb-book-studio', {
    hold: 1.8,
    qaStill: 'book-studio',
  });
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
  t.call(async function waitForKittenPictures(page, ctx) {
    // Declarative gifsmith waits warn-and-continue on timeout. This is a
    // featured visual beat, so a missing/broken image must fail the demo gate
    // instead of silently producing a page of empty polaroids.
    try {
      await settleScene(
        ctx,
        page.waitForFunction(() => {
          const pictures = [...document.querySelectorAll('.nb-image-row .nb-image-img')];
          return pictures.length >= 3 && pictures.every(
            (picture) => picture instanceof HTMLImageElement &&
              picture.complete && picture.naturalWidth > 0,
          );
        }, { timeout: 20_000 }),
        { capMs: 22_000, label: 'three kitten pictures' },
      );
    } catch (cause) {
      const state = await page.evaluate(() => ({
        spread: Number(
          document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index'),
        ),
        headings: [...document.querySelectorAll('.nb-leaf-paper h1')]
          .map((heading) => heading.textContent?.trim()),
        rows: document.querySelectorAll('.nb-image-row').length,
        images: [...document.querySelectorAll('.nb-image-img')].map((picture) => ({
          src: picture.getAttribute('src'),
          currentSrc: picture instanceof HTMLImageElement ? picture.currentSrc : null,
          complete: picture instanceof HTMLImageElement ? picture.complete : null,
          naturalWidth: picture instanceof HTMLImageElement ? picture.naturalWidth : null,
          inRow: picture.closest('.nb-image-row') !== null,
        })),
      }));
      throw new Error(
        `demo-gif: kitten photographs did not become ready (${JSON.stringify(state)})`,
        { cause },
      );
    }
    await advanceSceneFrames(page, ctx, 1);
  }, { name: 'wait for the kitten photographs', seconds: 0.08 });
  t.hold(1.35);
  showRibbons();

  turn('Picture beside prose', 13);
  // spread 13: Picture beside prose · Sound and celebration
  turn('Local video', 14);
  // spread 14: Local video · Stickers of your own

  /* --------------------- 4a. the native Agent at work ------------------- */

  /*
   * This is a deterministic replay through the real panel and real disposable
   * page renderer. It is deliberately placed in the middle of the book tour,
   * not appended like a release-note advert. The Welcome book remains the
   * visual context. Approval runs the browser-only bridge through BookView's
   * real Script parser and page insertion seam; reset restores the exact
   * pre-demo checkpoint before the ordinary tour resumes.
   */
  t.call(async function prepareFrozenAgentDemo(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => typeof globalThis.__aiAgentDemo?.reset === 'function',
        { timeout: 30_000 },
      ),
      { capMs: 30_000, label: 'mount frozen Agent bridge' },
    );
    const publicMethods = await page.evaluate(() =>
      Object.keys(globalThis.__aiAgentDemo ?? {}).sort()
    );
    if (publicMethods.join(',') !== 'advance,open,reset,state') {
      throw new Error(
        `demo-gif: unsafe or incomplete Agent bridge (${publicMethods.join(', ')})`,
      );
    }
    // Placement in the fixture is "After the current page". The ordinary
    // page turns leave keyboard focus on the prior leaf, so explicitly focus
    // the visible right page before opening the Agent. That makes the filmed
    // placement and the reversible insertion anchor the same real page.
    const focusedVisiblePage = await page.evaluate(() => {
      const editor = document.querySelector(
        '.nb-leaf-paper[data-side="right"] .ProseMirror',
      );
      if (!(editor instanceof HTMLElement)) return false;
      editor.focus({ preventScroll: true });
      return true;
    });
    if (!focusedVisiblePage) {
      throw new Error('demo-gif: the visible right page could not become the Agent insertion target');
    }
    await settleScene(
      ctx,
      page.evaluate(async () => {
        await globalThis.__aiAgentDemo.reset('study-notes');
        globalThis.__aiAgentDemo.open();
      }),
      { capMs: 10_000, label: 'reset and open frozen Agent scene' },
    );
    await waitForPanelOpen(page, ctx, '.nb-ai-agent', { label: 'AI Agent' });
  }, { name: 'open the frozen native Agent demo', seconds: 0.65 });
  t.cue('agent');
  t.call(async function frameAgentComposer(page, ctx) {
    await sceneCameraFocus(page, ctx, '.nb-ai-composer-wrap', {
      scale: 1.2,
      centerX: 375,
      centerY: 665,
      durationMs: 440,
    });
  }, { name: 'camera finds the Agent composer', seconds: 0.44 });
  t.click('.nb-ai-composer textarea', { via: 'cursor', glideSeconds: 0.24 });
  t.call(async function typeConversationQuestion(page, ctx) {
    await sceneType(
      page,
      ctx,
      '.nb-ai-composer textarea',
      AGENT_DEMO.explainRequest,
      185,
    );
  }, { name: 'type a conversation-only question at a human reading pace', seconds: 8.9 });
  t.hold(0.9);
  t.click('.nb-ai-send', { via: 'cursor', glideSeconds: 0.18 });
  t.call(async function showConversationThinking(page, ctx) {
    await settleScene(
      ctx,
      page.waitForSelector('.nb-ai-working-whisper', { visible: true, timeout: 5_000 }),
      { capMs: 5_000, label: 'show conversational thinking beat' },
    );
    await sceneScroll(page, ctx, '.nb-ai-working-whisper', 'nearest', 260);
    await sceneCameraFocus(page, ctx, '.nb-ai-working-whisper', {
      scale: 1.2,
      centerX: 370,
      centerY: 430,
      durationMs: 300,
    });
    await writeQaStill(page, 'ai-agent-thinking-answer');
  }, { name: 'Agent takes a small thinking breath', seconds: 0.62 });
  t.hold(2.25);
  t.call(async function showConversationAnswer(page, ctx) {
    await settleScene(
      ctx,
      page.evaluate(() => globalThis.__aiAgentDemo.advance('answer')),
      { capMs: 5_000, label: 'publish frozen answer-only response' },
    );
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelectorAll('.nb-ai-message').length === 2 &&
          document.querySelector('.nb-ai-agent')?.getAttribute('data-stage') === 'complete',
        { timeout: 5_000 },
      ),
      { capMs: 5_000, label: 'land answer-only response' },
    );
    await sceneScroll(page, ctx, '.nb-ai-message[data-role="agent"]', 'nearest', 320);
    await sceneCameraFocus(page, ctx, '.nb-ai-message[data-role="agent"]', {
      scale: 1.22,
      centerX: 365,
      centerY: 385,
      durationMs: 360,
    });
    await writeQaStill(page, 'ai-agent-answer');
  }, { name: 'Agent answers without editing the book', seconds: 0.9 });
  t.hold(2.05);

  t.call(async function returnCameraToComposer(page, ctx) {
    await sceneCameraFocus(page, ctx, '.nb-ai-composer-wrap', {
      scale: 1.2,
      centerX: 375,
      centerY: 665,
      durationMs: 360,
    });
  }, { name: 'camera returns to the follow-up', seconds: 0.36 });
  t.click('.nb-ai-composer textarea', { via: 'cursor', glideSeconds: 0.2 });
  t.call(async function typeNotebookRequest(page, ctx) {
    await sceneType(
      page,
      ctx,
      '.nb-ai-composer textarea',
      AGENT_DEMO.buildRequest,
      165,
    );
  }, { name: 'type the study-page follow-up at a human reading pace', seconds: 15.4 });
  t.hold(0.9);
  t.click('.nb-ai-send', { via: 'cursor', glideSeconds: 0.18 });

  t.call(async function showNotebookThinking(page, ctx) {
    await settleScene(
      ctx,
      page.waitForSelector('.nb-ai-working-whisper', { visible: true, timeout: 5_000 }),
      { capMs: 5_000, label: 'show notebook thinking beat' },
    );
    await sceneScroll(page, ctx, '.nb-ai-working-whisper', 'nearest', 260);
    await sceneCameraFocus(page, ctx, '.nb-ai-working-whisper', {
      scale: 1.18,
      centerX: 370,
      centerY: 440,
      durationMs: 300,
    });
    await writeQaStill(page, 'ai-agent-thinking-pages');
  }, { name: 'Agent imagines the page shape', seconds: 0.62 });
  t.hold(2.2);

  t.call(async function showAgentPlan(page, ctx) {
    await settleScene(
      ctx,
      page.evaluate(() => globalThis.__aiAgentDemo.advance('plan')),
      { capMs: 5_000, label: 'publish frozen Agent plan' },
    );
    await settleScene(
      ctx,
      page.waitForSelector('.nb-ai-plan-card', { visible: true, timeout: 5_000 }),
      { capMs: 5_000, label: 'land Agent plan' },
    );
    await sceneScroll(page, ctx, '.nb-ai-plan-card', 'nearest', 300);
    await sceneCameraFocus(page, ctx, '.nb-ai-plan-card', {
      scale: 1.2,
      centerX: 365,
      centerY: 390,
      durationMs: 340,
    });
  }, { name: 'Agent plans the study pages', seconds: 0.9 });
  t.hold(1.45);

  t.call(async function showAgentSourceRead(page, ctx) {
    await page.evaluate(() => globalThis.__aiAgentDemo.advance('read'));
    await settleScene(
      ctx,
      page.waitForSelector('.nb-ai-tool-card', { visible: true, timeout: 5_000 }),
      { capMs: 5_000, label: 'land source-reading action' },
    );
    await sceneScroll(page, ctx, '.nb-ai-tool-card', 'nearest', 300);
  }, { name: 'Agent reads the representative source', seconds: 0.65 });
  t.hold(1.25);

  t.call(async function showAgentDraftAction(page, ctx) {
    await page.evaluate(() => globalThis.__aiAgentDemo.advance('draft'));
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelectorAll('.nb-ai-tool-card').length >= 2,
        { timeout: 5_000 },
      ),
      { capMs: 5_000, label: 'land notebook-draft action' },
    );
    const cards = await page.$$('.nb-ai-tool-card');
    if (cards.length < 2) throw new Error('demo-gif: draft action did not appear');
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.nb-ai-tool-card')];
      for (const card of cards) card.removeAttribute('data-demo-agent-action');
      cards.at(-1)?.setAttribute('data-demo-agent-action', 'draft');
    });
    await sceneScroll(
      page,
      ctx,
      '.nb-ai-tool-card[data-demo-agent-action="draft"]',
      'nearest',
      300,
    );
  }, { name: 'Agent builds native Notebook Script', seconds: 0.65 });
  t.hold(1.2);

  t.call(async function showAgentSelfReview(page, ctx) {
    // Pagination measures the real, untransformed page geometry. The recording
    // camera had been focused at 1.2x for the plan/actions; leaving that scale
    // on #root while the disposable renderer mounted could turn the exact
    // three-leaf fixture into a fourth spill leaf. Return to product identity
    // before rendering, then frame the landed review card afterwards.
    // The native renderer must measure at product identity.  Do not animate
    // the recording crop back to identity: translating the entire root while
    // the review panel changes height can leave only empty parchment in view.
    await sceneCameraSnapReset(page, ctx, 'prepare native self-review');
    await settleScene(
      ctx,
      page.evaluate(() => globalThis.__aiAgentDemo.advance('review')),
      { capMs: 60_000, label: 'render frozen pages for native self-review' },
    );
    await settleScene(
      ctx,
      page.waitForSelector('.nb-ai-review-gate', { visible: true, timeout: 15_000 }),
      { capMs: 15_000, label: 'land native-page review gate' },
    );
    await sceneScroll(page, ctx, '.nb-ai-review-gate', 'nearest', 340);
    await sceneCameraFocus(page, ctx, '.nb-ai-review-gate', {
      scale: 1.22,
      centerX: 365,
      centerY: 420,
      durationMs: 360,
    });
  }, { name: 'Agent inspects and repairs the real pages', seconds: 1.25 });
  t.hold(1.7);

  t.call(async function showAgentFinalPreview(page, ctx) {
    // The review card and final preview have very different transcript
    // heights. Change that product state from identity, otherwise the old
    // review-card crop becomes an invalid coordinate system while Solid
    // replaces the card and can drive the entire root outside the viewport.
    await sceneCameraSnapReset(page, ctx, 'prepare final Agent preview');
    await page.evaluate(() => globalThis.__aiAgentDemo.advance('ready'));
    await settleScene(
      ctx,
      page.waitForFunction(
        () => {
          const preview = document.querySelector('.nb-ai-final-preview');
          const images = [...document.querySelectorAll('.nb-ai-preview-stage img')];
          return preview instanceof HTMLElement && images.length >= 2 && images.every(
            (image) => image instanceof HTMLImageElement &&
              image.complete && image.naturalWidth > 0,
          );
        },
        { timeout: 20_000 },
      ),
      { capMs: 22_000, label: 'land reviewed native preview' },
    );
    await sceneScroll(page, ctx, '.nb-ai-final-preview', 'nearest', 460);
    await sceneCameraFocus(page, ctx, '.nb-ai-final-head', {
      scale: 1.18,
      centerX: 365,
      centerY: 300,
      durationMs: 380,
    });
  }, { name: 'Agent presents the final preview', seconds: 1.05 });
  t.hold(2.2);

  t.call(async function prepareFullReviewedPageClick(page, ctx) {
    // A viewport-level sheet must be opened from honest product geometry. The
    // old choreography invoked HTMLElement.click() while resetting the camera,
    // so the visible cursor never touched Review and a few flat transition
    // frames could precede the modal.
    await sceneCameraSnapReset(page, ctx, 'frame full-page review control');
    await sceneScroll(page, ctx, '.nb-ai-preview-stage', 'nearest', 300);
    await advanceSceneFrames(page, ctx, 2);
  }, { name: 'frame the full-page review control', seconds: 0.46 });
  t.click('.nb-ai-preview-stage', { via: 'cursor', glideSeconds: 0.32 });
  t.call(async function waitForFullReviewedPage(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => {
          const dialog = document.querySelector('.nb-ai-full-preview');
          const image = dialog?.querySelector('.nb-ai-full-preview-canvas > img');
          return dialog instanceof HTMLElement &&
            image instanceof HTMLImageElement &&
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 &&
            dialog.getBoundingClientRect().width > 700;
        },
        { timeout: 12_000 },
      ),
      { capMs: 12_000, label: 'open a populated full reviewed-page preview' },
    );
    await writeQaStill(page, 'ai-agent-full-preview');
  }, { name: 'open one exact reviewed page', seconds: 0.5 });
  t.hold(1.4);
  t.click('.nb-ai-full-preview-nav button[aria-label="Next reviewed page"]', { via: 'cursor', glideSeconds: 0.24 });
  t.call(async function showNextReviewedPage(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelector('.nb-ai-full-preview-nav')?.textContent?.includes('page 2 of 3') === true,
        { timeout: 5_000 },
      ),
      { capMs: 5_000, label: 'show the next reviewed page' },
    );
    await advanceSceneFrames(page, ctx, 3);
    await writeQaStill(page, 'ai-agent-full-preview-page-2');
  }, { name: 'inspect the next reviewed page', seconds: 0.42 });
  t.hold(1.35);
  t.click('.nb-ai-full-preview .nb-ai-modal-close', { via: 'cursor', glideSeconds: 0.24 });
  t.call(async function closeFullReviewedPage(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(() => {
        if (document.querySelector('.nb-ai-full-preview') !== null) return false;
        const preview = document.querySelector('.nb-ai-final-preview');
        const images = [...document.querySelectorAll('.nb-ai-preview-stage img')];
        return preview instanceof HTMLElement &&
          preview.getBoundingClientRect().width > 200 &&
          images.length >= 2 && images.every((image) =>
            image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
          );
      }),
      { capMs: 5_000, label: 'return from full reviewed-page preview' },
    );
    // Modal removal changes the viewport composition.  Reassert product
    // geometry atomically and require several populated frames before any
    // documentary crop is allowed to begin.  An animated reset here used to
    // translate the entire app out of view for a brief pink-screen interval.
    await sceneCameraSnapReset(page, ctx, 'return from full-page review');
    await advanceSceneFrames(page, ctx, 4);
  }, { name: 'return to the insertion decision', seconds: 0.32 });

  t.call(async function frameAgentApproval(page, ctx) {
    // Reframe from product identity. Interpolating either between the two
    // crops or back through the old crop's translated coordinates can drive
    // the whole root outside the viewport. Snap recording-only camera state
    // to identity between captured frames, hold that fully visible pose, then
    // begin the deliberate approval focus from clean product geometry.
    await sceneCameraSnapReset(page, ctx, 'frame final insertion choice');
    await sceneScroll(page, ctx, '.nb-ai-final-actions', 'end', 480);
    await sceneCameraFocus(page, ctx, '.nb-ai-final-actions', {
      scale: 1.15,
      centerX: 390,
      centerY: 610,
      durationMs: 380,
    });
    // Capture after the second settled reframe. Chromium occasionally exposes
    // a flat pre-composite surface immediately after the first root transform;
    // this point is the same reviewed preview, now with its placement and
    // insertion choice visible too.
    await writeQaStill(page, 'ai-agent-preview');
  }, { name: 'frame the final insertion choice', seconds: 0.62 });
  t.hold(1.15);
  t.click('.nb-ai-approve-action', { via: 'cursor', glideSeconds: 0.28 });
  t.call(async function showInsertionAfterActivation(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelector('.nb-ai-agent')?.getAttribute('data-stage') === 'applying' &&
          document.body.textContent?.includes('Adding the three reviewed pages') === true,
        { timeout: 5_000 },
      ),
      { capMs: 5_000, label: 'show insertion state after the visible approval click' },
    );
    await writeQaStill(page, 'ai-agent-pages-settling');
  }, { name: 'Agent begins inserting after approval', seconds: 0.55 });
  // The real application still owns this state until native page verification
  // finishes, but an extra documentary hold made the book look frozen after
  // the approval click. Keep enough time to read the status, then let the
  // actual insertion callback determine the remainder of the wait.
  t.hold(0.45);
  t.call(async function waitForReviewedPagesToLand(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => {
          const state = globalThis.__aiAgentDemo?.state();
          const headings = [...document.querySelectorAll('.nb-leaf-paper h1')]
            .map((node) => node.textContent?.trim());
          return state?.stage === 'inserted' && state.insertedPages === 3 &&
            document.querySelector('.nb-ai-agent')?.getAttribute('data-stage') === 'complete' &&
            headings.includes('Huffman Coding with Kittens') &&
            headings.includes('Build the Kitten Tree');
        },
        { timeout: 60_000 },
      ),
      { capMs: 60_000, label: 'insert the three reviewed pages' },
    );
    await page.evaluate(() => {
      const messages = [...document.querySelectorAll('.nb-ai-message[data-role="agent"]')];
      messages.forEach((message) => message.removeAttribute('data-demo-inserted-message'));
      messages.at(-1)?.setAttribute('data-demo-inserted-message', 'true');
    });
    await sceneScroll(page, ctx, '[data-demo-inserted-message="true"]', 'nearest', 320);
    await writeQaStill(page, 'ai-agent-inserted');
  }, { name: 'Agent inserts the reviewed pages', seconds: 1.25 });
  t.hold(2.0);

  t.call(async function leaveAgentCamera(page, ctx) {
    await sceneCameraReset(page, ctx, 440);
  }, { name: 'camera returns to the whole book', seconds: 0.44 });
  t.click('[aria-label^="Close AI agent"]', { via: 'cursor', glideSeconds: 0.26 });
  t.call(async function revealInsertedAgentPages(page, ctx) {
    await waitForPanelClosed(page, ctx, '.nb-ai-agent', 'AI agent');
    // The rail has closed, but BookView still needs captured scene time to
    // recompute its fitted spread and paint the newly inserted editors. A
    // real-time wait freezes Gifsmith's virtual clock here and can therefore
    // wait forever for pixels that were never allowed to advance.
    await advanceScene(page, ctx, 700);
    const headings = await page.$$eval('.nb-leaf-paper h1', (nodes) =>
      nodes.map((node) => node.textContent?.trim()),
    );
    if (
      !headings.includes('Huffman Coding with Kittens') ||
      !headings.includes('Build the Kitten Tree')
    ) {
      throw new Error(`demo-gif: insertion did not land on the first kitten spread (${headings.join(' | ')})`);
    }
  }, { name: 'close the Agent over the real book', seconds: 0.75 });
  t.hold(0.65);

  // The real insertion deliberately lands on the first reviewed spread. Show
  // it at rest before one ordinary curl visits the third study page.
  t.call(async function recordFirstInsertedSpread(page) {
    const headings = await page.$$eval('.nb-leaf-paper h1', (nodes) =>
      nodes.map((node) => node.textContent?.trim()),
    );
    if (
      !headings.includes('Huffman Coding with Kittens') ||
      !headings.includes('Build the Kitten Tree')
    ) {
      throw new Error(`demo-gif: first inserted spread is missing (${headings.join(' | ')})`);
    }
    await writeQaStill(page, 'ai-agent-inserted-pages');
  }, { name: 'show the first two inserted pages', seconds: 0.12 });
  t.hold(2.35);

  // One ordinary, deliberate page curl proves that all three inserted leaves
  // live in the book.  The prior cut jumped through thumbnails, so the third
  // page was easy to miss and the insertion itself looked like rapid paging.
  turn('Read, Check, Decode', 16, { requireWarmCurl: false });
  t.hold(2.0);

  t.click('.nb-rail button[aria-label^="Thumbnails strip"]', { via: 'cursor' });
  t.waitFor('.nb-thumb-strip');
  jumpWithThumbnail('Your first five minutes', 0, { hold: 0.85 });
  t.click('.nb-rail button[aria-label^="Thumbnails strip"]', { via: 'cursor' });
  t.waitUntil(() => document.querySelector('.nb-thumb-strip') === null);
  t.call(async function placeCaretInWelcomeWritingPage(page) {
    const paragraph = '.nb-leaf-paper[data-side="right"] .ProseMirror > p:first-of-type';
    const focused = await page.evaluate((wanted) => {
      const target = document.querySelector(wanted);
      const editor = target?.closest('.ProseMirror');
      if (!(target instanceof HTMLElement) || !(editor instanceof HTMLElement)) return false;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    }, paragraph);
    if (!focused) throw new Error('demo-gif: Welcome writing page is unavailable');
  }, { name: 'place the caret on Welcome’s writing exercise', seconds: 0.22 });
  t.type(
    '.nb-leaf-paper[data-side="right"] .ProseMirror',
    ' — and this sentence is mine.',
    { delayMs: 104 },
  );
  t.call(async function verifyWelcomePageWriting(page, ctx) {
    await settleScene(
      ctx,
      page.waitForFunction(
        () => document.querySelector('.nb-leaf-paper[data-side="right"] .ProseMirror')
          ?.textContent?.includes('and this sentence is mine.') === true,
        { timeout: 5_000 },
      ),
      { capMs: 5_000, label: 'write on Welcome’s dedicated writing exercise' },
    );
    await writeQaStill(page, 'welcome-writing-page');
  }, { name: 'verify ordinary writing without disturbing the Agent pages', seconds: 0.35 });
  t.hold(1.8);

  t.call(async function restoreFrozenAgentDemo(page, ctx) {
    await settleScene(
      ctx,
      page.evaluate(() => globalThis.__aiAgentDemo.reset('study-notes')),
      { capMs: 30_000, label: 'restore the exact pre-Agent notebook' },
    );
    const state = await page.evaluate(() => globalThis.__aiAgentDemo.state());
    const spread = await page.$eval('[data-spread-index]', (node) =>
      Number(node.getAttribute('data-spread-index')),
    );
    const writingLeaked = await page.evaluate(() =>
      document.body.textContent?.includes('and this sentence is mine.') === true
    );
    if (
      state.panelOpen || state.renderedPages !== 0 || state.insertedPages !== 0 ||
      state.stage !== 'idle' || spread !== 14 ||
      writingLeaked
    ) {
      throw new Error(
        `demo-gif: Agent reset leaked scene state (${JSON.stringify({ state, spread })})`,
      );
    }
    await writeQaStill(page, 'ai-agent-restored');
  }, { name: 'restore the exact pre-Agent notebook and writing page', seconds: 0.8 });
  t.hold(0.7);

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
    await assertDemoShelfHome(page, 'closing loop shelf');
  }, { name: 'settle return shelf and add-slot', seconds: 0.22 });
  // Match the anchor's pointer pose as well as its shelf pose. In practice the
  // back button already leaves it close to here, so this is a small retreat,
  // not a conspicuous cursor-only epilogue.
  t.call(async function returnBothPointersHome(page, ctx) {
    await settleScene(
      ctx,
      page.evaluate(
        ({ x, y }) => {
          if (typeof globalThis.__gifsmith?.cursorTo !== 'function') {
            throw new Error('demo-gif: gifsmith cursor bridge is unavailable at the loop return');
          }
          return globalThis.__gifsmith.cursorTo(x, y, 280, 'easeOut');
        },
        LOOP_CURSOR_HOME,
      ),
      { capMs: 1_280, label: 'return the drawn cursor to the loop anchor' },
    );
    await page.mouse.move(LOOP_CURSOR_HOME.x, LOOP_CURSOR_HOME.y);
    await advanceSceneFrames(page, ctx, 1);
  }, { name: 'return both pointers to loop anchor', seconds: 0.36 });
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
  // Never let a failed late storyboard gate truncate the README's current
  // film. Gifsmith opens its destination before capture, so write the whole
  // candidate under ignored QA first and promote it only after render returns.
  out: DEMO_STAGING,
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
    width: 900, fps: DEMO_FPS, speed: DEMO_SPEED, targetMB: 20,
    colors: 256, dither: 'none', palette: 'full',
  },
  // Gifsmith v0.3.4 derives a seekable H.264 review copy from the exact same
  // paced frames. It stays under qa/ for humans who need pause/scrub/frame
  // stepping; the README continues to embed only the publication WebP.
  mp4Sidecar: true,
};

if (PROMOTE_ONLY) {
  const stagedBytes = statSync(DEMO_STAGING).size;
  const stagedMp4Bytes = statSync(DEMO_MP4_STAGING).size;
  if (stagedBytes <= 0 || stagedMp4Bytes <= 0) {
    throw new Error('demo-gif: cannot promote an empty staged WebP/MP4 pair');
  }
  promoteDemoPair();
  console.log(`promoted accepted demo -> ${DEMO_OUT} (${stagedBytes} bytes)`);
  console.log(`promoted accepted review -> ${DEMO_MP4} (${stagedMp4Bytes} bytes)`);
} else if (CHECK) {
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
    console.log(
      `targeted stills -> ${QA_DIR}/{target-book-studio,target-lapis-shelves,target-garnet-shelves,ai-agent-thinking-answer,ai-agent-answer,ai-agent-thinking-pages,ai-agent-full-preview,ai-agent-preview,ai-agent-pages-settling,ai-agent-inserted,ai-agent-inserted-pages,welcome-writing-page,ai-agent-restored}.png`,
    );
    console.log(`Agent fixture -> ${JSON.stringify(AGENT_DEMO)}`);
  } else {
    console.log('\ncontact sheet keys:', Object.keys(sheet).join(', '));
  }
} else {
  const result = await render(scene);
  const stagedBytes = statSync(DEMO_STAGING).size;
  if (stagedBytes <= 0) {
    throw new Error('demo-gif: renderer returned without a non-empty staged film');
  }
  const stagedMp4Bytes = statSync(DEMO_MP4_STAGING).size;
  if (stagedMp4Bytes <= 0) {
    throw new Error('demo-gif: renderer returned without a non-empty seekable MP4 review copy');
  }
  if (QA_ONLY) {
    console.log(`QA-only candidate retained -> ${DEMO_STAGING} (${stagedBytes} bytes)`);
    console.log(`QA-only review retained -> ${DEMO_MP4_STAGING} (${stagedMp4Bytes} bytes)`);
  } else {
    promoteDemoPair();
    console.log(`promoted complete demo -> ${DEMO_OUT} (${stagedBytes} bytes)`);
    console.log(`promoted seekable review -> ${DEMO_MP4} (${stagedMp4Bytes} bytes)`);
  }
  console.log(JSON.stringify(result, null, 2));
}
