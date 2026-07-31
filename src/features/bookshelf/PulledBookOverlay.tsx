/**
 * features/bookshelf/PulledBookOverlay.tsx — the DOM half of the pull-out, and
 * the book's whole life while it is off the shelf.
 *
 * A fixed-position book cover that crossfades with the canvas ghost at the
 * ghost's exact screen rect, then animates (transform/opacity only) to center
 * stage — and the reverse on the way back. GPU-smooth world motion, DOM-crisp
 * cover where it matters.
 *
 * The face is REAL cover art: art/covers.renderCover baked once into a
 * device-pixel-ratio canvas (seeded from spine_seed, honoring cover_meta
 * overrides), so the pull-out shows the same intricate tooled cover the
 * opened BookView rests on — no more flat gradient rectangle.
 *
 * ## Taking a book out is not the same as reading it
 *
 * Pulling a spine used to run straight on into the book view: one click and
 * you were inside, with no way to say "wrong one" but to open it and close it
 * again. So the flight now ENDS here — the book comes to rest **held** in
 * front of the case, and two verbs sit under it: read it, or put it back.
 *
 * Held is deliberately not a dialog. The cover itself is the primary target
 * (click it and it opens), the read button takes focus so Enter opens, Escape
 * puts it back, and the book can be picked up and **dragged back onto the
 * bookcase**, which is the gesture the object suggests before any button does.
 * Two clicks to read, both of them on the book.
 *
 * ## Why the flight is a hinge and not a scale
 *
 * The move it has to sell is a book turning from edge-on to face-on. The old
 * version did that as a plain FLIP: a spine-shaped rect stretching out to a
 * cover-shaped one, which is the same thing a modal does when it zooms open.
 * It looked like the artwork was being pulled wide, because it was.
 *
 * So the cover swings on `rotationY` about its own left edge — the spine —
 * under a perspective, which is the hinge the object actually has. It arrives
 * along an arc rather than a straight line (books get carried, not teleported)
 * and it lands with an overshoot that settles, because a thing with mass does
 * not simply stop. All of it is transform and opacity; nothing here reads a
 * layout property, let alone writes one.
 */

import gsap from 'gsap';
import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { resolveBookStyle } from '../../art/bookStyle';
import { renderCoverInto } from '../../art/covers';
import { getTheme } from '../../art/themes';
import { readShelfMeta } from '../../data/books';
import { play } from '../../sound/engine';
import { bookStyleOverridesFor, themeSpineDefaults } from './bookIdentity';
import { libraryPrefs } from './libraryPrefs';
import type { Book } from '../../data/types';
import { prefersReducedMotion } from './env';
import type { RectLike } from './world';

export interface PulledOverlayProps {
  book: Book;
  /** The spine's screen rect: where the flight starts ('open') or ends ('close'). */
  spineRect: RectLike;
  /**
   * 'open'  — the canvas just pulled the book out; fly it to the reader and
   *            hold it there until they choose.
   * 'close' — the book view is unmounting; fly it back to its slot at once.
   */
  mode: 'open' | 'close';
  /** Where the book belongs on the shelf, read at the moment it is sent back. */
  homeRect(): RectLike;
  /** The bookcase in screen px — the drop target for dragging it back. */
  caseRect(): RectLike | null;
  /** The held book is (or is no longer) over the case: show the slot outline. */
  onOverCase(over: boolean): void;
  /**
   * Crossfade moment. `'out'`: the DOM cover has taken over and the canvas
   * ghost should fade. `'in'`: the DOM cover is back on the spine and the
   * canvas should push the book into the row.
   */
  onHandoff(phase: 'out' | 'in'): void;
  /** The reader chose to read it. */
  onOpen(): void;
  /** The overlay is finished with — unmount it. */
  onDone(): void;
}

interface CenterLayout {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Room the label plate under a held book needs: title, two verbs, the hint,
 * its padding and the gap above it. Measured from the rendered plate and
 * rounded up — it only has to be right enough to keep the plate off the zoom
 * pill on a short window.
 */
const HAND_H = 132;

/** Bottom of the window the plate must stay clear of (the zoom pill lives there). */
const HAND_FLOOR = 96;

/**
 * Where a held book stands, and how big.
 *
 * Smaller than the old 660px hero, and centred as cover-PLUS-plate rather than
 * as a cover: the two verbs live under the book now, and a hero sized to the
 * window alone pushed them off the bottom of a short one.
 */
function centerLayout(): CenterLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = Math.min(
    vh * 0.62,
    540,
    Math.max(220, vh - HAND_H - HAND_FLOOR - 24),
  );
  const width = height * 0.72;
  return {
    width,
    height,
    x: (vw - width) / 2,
    y: Math.max(20, (vh - height - HAND_H) / 2),
  };
}

/**
 * How far open the hinge starts. Not a full 90°: at 90° the cover is a line,
 * the crossfade has nothing to land on, and a single frame of sub-pixel width
 * flickers. 76° still reads as edge-on and always has pixels.
 */
const HINGE_DEG = 76;

/**
 * Perspective depth. Shallow enough to be felt, deep enough not to fisheye: a
 * cover this tall at 1100 splays into a trapezoid that hangs well below the
 * spine it is supposed to be standing in for, and the crossfade shows it.
 */
const PERSPECTIVE = 1500;

/** Pointer travel (px) that turns a press on the held cover into a carry. */
const CARRY_SLOP = 7;

/** Press held longer than this is a carry that went nowhere, not a click. */
const CLICK_MS = 320;

/**
 * The x-scale that makes a cover rotated to `HINGE_DEG` project to roughly the
 * width of the spine it is standing in for, so the DOM face and the canvas
 * ghost occupy the same footprint at the instant they crossfade.
 */
function hingeScaleX(spineWidth: number, coverWidth: number): number {
  const foreshorten = Math.cos((HINGE_DEG * Math.PI) / 180);
  const raw = spineWidth / Math.max(1, coverWidth * foreshorten);
  return Math.min(1.4, Math.max(0.08, raw));
}

/** A pose the cover can be in: position, the two scales, and the hinge angle. */
interface Pose {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationY: number;
}

/**
 * A quadratic arc between two screen points, bowed upward.
 *
 * The bow is what stops the flight reading as a tween: a straight line between
 * two points is the one path a carried object never takes. It scales with the
 * distance travelled, and is capped so a book pulled from the middle of the
 * screen does not loop.
 */
function arcPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const lift = Math.min(84, Math.max(16, dist * 0.16));
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2 - lift;
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  };
}

function inside(rect: RectLike | null, x: number, y: number): boolean {
  if (rect === null) return false;
  return (
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  );
}

export default function PulledBookOverlay(p: PulledOverlayProps): JSX.Element {
  let el!: HTMLDivElement;
  let coverCanvas: HTMLCanvasElement | undefined;
  let readButton: HTMLButtonElement | undefined;

  /** True once the outbound flight has landed and the book is in the hand. */
  const [held, setHeld] = createSignal(false);
  /** True while the reader is carrying the held book around. */
  const [carrying, setCarrying] = createSignal(false);
  /** True while a carry is over the bookcase (the drop would put it back). */
  const [overCase, setOverCase] = createSignal(false);

  // One layout for the cover and for the verbs under it — they are one object
  // and must not be measured twice.
  const center = centerLayout();

  // Bound by the mount below; the chrome only calls them once it is on screen,
  // which is strictly after the flight that defines them.
  let openIt: () => void = () => undefined;
  let shelveIt: () => void = () => undefined;

  onMount(() => {
    const m = prefersReducedMotion() ? 0 : 1;
    el.style.width = `${center.width}px`;
    el.style.height = `${center.height}px`;

    // Bake the cover face at device resolution for the center size.
    if (coverCanvas) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      coverCanvas.width = Math.round(center.width * dpr);
      coverCanvas.height = Math.round(center.height * dpr);
      const ctx = coverCanvas.getContext('2d');
      if (ctx) {
        // Same resolver the shelf spine uses, so a customized book is
        // recognisably itself on the shelf, mid-pull-out and open (§4).
        const { cover } = resolveBookStyle(
          p.book.spineSeed,
          themeSpineDefaults(getTheme(libraryPrefs.theme)),
          bookStyleOverridesFor(p.book),
          { pageCount: readShelfMeta(p.book)?.pageCount },
        );
        renderCoverInto(
          ctx,
          coverCanvas.width,
          coverCanvas.height,
          cover,
          p.book.title,
        );
      }
    }

    /** Closed on its spine, standing where the canvas ghost is. */
    const spinePose = (rect: RectLike): Pose => ({
      x: rect.x,
      y: rect.y,
      scaleX: hingeScaleX(rect.width, center.width),
      scaleY: rect.height / center.height,
      rotationY: -HINGE_DEG,
    });
    /** Open, square to the viewer, wherever the reader last left it. */
    const heldPose = (): Pose => ({
      x: here.x,
      y: here.y,
      scaleX: 1,
      scaleY: 1,
      rotationY: 0,
    });

    // Where the cover is right now, in the coordinates GSAP writes. Kept by
    // hand because the carry, the snap-back and the return flight all have to
    // start from wherever the last one left it.
    const here = { x: center.x, y: center.y };

    // Position rides an arc off a single progress value, which keeps x and y
    // on one curve; GSAP owns every other channel. `quickSetter` writes into
    // the same transform cache the tweens use (hence: created after the first
    // `gsap.set` has built it), so the two compose instead of trampling.
    let setX: ((v: number) => void) | null = null;
    let setY: ((v: number) => void) | null = null;
    let tl: gsap.core.Timeline | null = null;
    let finished = false;

    const applyStart = (pose: Pose, opacity: number): void => {
      gsap.set(el, {
        x: pose.x,
        y: pose.y,
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
        rotationY: pose.rotationY,
        transformOrigin: '0 0',
        transformPerspective: PERSPECTIVE,
        opacity,
      });
      here.x = pose.x;
      here.y = pose.y;
      setX = gsap.quickSetter(el, 'x', 'px') as (v: number) => void;
      setY = gsap.quickSetter(el, 'y', 'px') as (v: number) => void;
    };

    /** Drive x/y along the arc from a 0→1 progress proxy. */
    const flyPath = (from: Pose, to: Pose, progress: { t: number }) => (): void => {
      const at = arcPoint(from, to, progress.t);
      here.x = at.x;
      here.y = at.y;
      setX?.(at.x);
      setY?.(at.y);
    };

    /* ------------------------------ outbound ------------------------------ */

    const flyOut = (): void => {
      const from = spinePose(p.spineRect);
      const to: Pose = { x: center.x, y: center.y, scaleX: 1, scaleY: 1, rotationY: 0 };
      applyStart(from, 0);
      const progress = { t: 0 };
      const path = flyPath(from, to, progress);
      tl = gsap.timeline({
        onComplete: () => {
          progress.t = 1;
          path();
          setHeld(true);
          // The read button, not the card: whoever arrived by keyboard should
          // be one Enter from the page, and whoever arrived by mouse should
          // see where the app thinks they are going.
          queueMicrotask(() => readButton?.focus({ preventScroll: true }));
        },
      });
      tl
        // Crossfade first, over a stationary frame or two: the canvas ghost is
        // still on screen underneath and the two must agree before either moves.
        .to(el, { opacity: 1, duration: 0.07 * m, ease: 'none', onStart: () => p.onHandoff('out') }, 0)
        .to(progress, { t: 1, duration: 0.44 * m, ease: 'power2.inOut', onUpdate: path }, 0)
        // The cover swings square a beat before the flight lands, so you are
        // reading the book's face by the time it arrives.
        .to(el, { rotationY: 0, duration: 0.42 * m, ease: 'power2.out' }, 0.02 * m)
        // Size is locked to the SAME ease as the path. On `power2.out` the
        // cover reached full width a quarter of the way across and then slid
        // there at that size, which is a modal zooming open, not a book being
        // carried; growth has to arrive when the book does.
        .to(el, { scaleX: 1.03, scaleY: 1.03, duration: 0.38 * m, ease: 'power2.inOut' }, 0)
        // The settle. Everything above is the throw; this is the catch.
        .to(
          el,
          { scaleX: 1, scaleY: 1, duration: 0.22 * m, ease: 'elastic.out(1, 0.5)' },
          0.38 * m,
        );
    };

    /* ------------------------------- inbound ------------------------------ */

    const flyHome = (from: Pose, to: Pose): void => {
      const progress = { t: 0 };
      const path = flyPath(from, to, progress);
      tl?.kill();
      tl = gsap.timeline({
        onComplete: () => {
          progress.t = 1;
          path();
          finished = true;
          p.onDone();
        },
      });
      tl
        // Anticipation on the way out too: it gathers itself before it goes.
        .to(el, { scaleX: from.scaleX * 1.035, scaleY: from.scaleY * 1.035, duration: 0.1 * m, ease: 'power2.out' }, 0)
        .to(progress, { t: 1, duration: 0.4 * m, ease: 'power2.in', onUpdate: path }, 0.1 * m)
        .to(
          el,
          { scaleX: to.scaleX, scaleY: to.scaleY, duration: 0.4 * m, ease: 'power2.in' },
          0.1 * m,
        )
        .to(el, { rotationY: to.rotationY, duration: 0.34 * m, ease: 'power2.in' }, 0.14 * m)
        // Hand back to the canvas as the face turns away, not after it has.
        .to(el, { opacity: 0, duration: 0.1 * m, ease: 'none', onStart: () => p.onHandoff('in') }, 0.46 * m);
    };

    /** Send the held book back to its slot. Idempotent. */
    const putBack = (): void => {
      if (finished || !held()) return;
      setHeld(false);
      setCarrying(false);
      setOverCase(false);
      p.onOverCase(false);
      flyHome(heldPose(), spinePose(p.homeRect()));
    };

    if (p.mode === 'open') {
      flyOut();
    } else {
      const from: Pose = { x: center.x, y: center.y, scaleX: 1, scaleY: 1, rotationY: 0 };
      applyStart(from, 1);
      flyHome(from, spinePose(p.spineRect));
    }

    /* -------------------------- carrying it around ------------------------ */
    /*
     * Pointer handling lives here rather than on JSX attributes because the
     * press has to be classified (a click on the cover opens the book, a drag
     * carries it) and because capture must survive the pointer leaving the
     * card — which it does within about 40px of any real throw.
     */

    let press: { id: number; x: number; y: number; t: number; cardX: number; cardY: number } | null =
      null;

    const onDown = (e: PointerEvent): void => {
      if (!held() || !e.isPrimary || e.button !== 0) return;
      // A previous drop may still be gliding back to centre; grabbing it again
      // has to take the position off that tween or the two fight over `here`.
      gsap.killTweensOf(here);
      el.setPointerCapture(e.pointerId);
      press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        cardX: here.x,
        cardY: here.y,
      };
    };

    const onMove = (e: PointerEvent): void => {
      const press_ = press;
      if (press_ === null || e.pointerId !== press_.id) return;
      const dx = e.clientX - press_.x;
      const dy = e.clientY - press_.y;
      if (!carrying()) {
        if (Math.hypot(dx, dy) < CARRY_SLOP) return;
        setCarrying(true);
        tl?.kill();
        void play('book-pull');
      }
      here.x = press_.cardX + dx;
      here.y = press_.cardY + dy;
      setX?.(here.x);
      setY?.(here.y);
      const over = inside(p.caseRect(), e.clientX, e.clientY);
      if (over !== overCase()) {
        setOverCase(over);
        p.onOverCase(over);
      }
    };

    const onUp = (e: PointerEvent): void => {
      const press_ = press;
      if (press_ === null || e.pointerId !== press_.id) return;
      press = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!carrying()) {
        // A tap on the cover is the fastest way in, and it is the target the
        // pointer is already on.
        if (e.timeStamp - press_.t <= CLICK_MS) p.onOpen();
        return;
      }
      setCarrying(false);
      if (overCase()) {
        putBack();
        return;
      }
      // Dropped in mid-air: it comes back to the reader rather than staying
      // wherever the hand let go, which would leave a book floating in a
      // corner with its verbs somewhere else.
      setOverCase(false);
      p.onOverCase(false);
      gsap.to(here, {
        x: center.x,
        y: center.y,
        duration: 0.34 * m,
        ease: 'power3.out',
        onUpdate: () => {
          setX?.(here.x);
          setY?.(here.y);
        },
      });
    };

    const onCancel = (e: PointerEvent): void => {
      if (press === null || e.pointerId !== press.id) return;
      press = null;
      setCarrying(false);
      setOverCase(false);
      p.onOverCase(false);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);

    // Escape puts it back — the one key that always means "I did not mean
    // this one". Capture phase, because the shelf's own document listener is
    // still attached behind the overlay.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !held()) return;
      e.preventDefault();
      e.stopPropagation();
      putBack();
    };
    document.addEventListener('keydown', onKey, true);

    // The chrome's buttons reach the flight through these.
    openIt = (): void => {
      if (!finished) p.onOpen();
    };
    shelveIt = putBack;

    onCleanup(() => {
      tl?.kill();
      gsap.killTweensOf(here);
      document.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      // The slot outline belongs to the world, not to this component, so it
      // would otherwise outlive the book that asked for it.
      p.onOverCase(false);
    });
  });

  return (
    <>
      {/*
        A flat wash over the room while a book is out. It is not decoration:
        the shelf is frozen underneath, and without it the dock rail and the
        zoom pill still look pressable. Clicking it shelves the book, which is
        the one thing "somewhere else" can mean here.
      */}
      <Show when={p.mode === 'open'}>
        <div
          class="pulled-book-scrim"
          classList={{ 'is-up': held() }}
          data-testid="pulled-book-scrim"
          aria-hidden="true"
          onClick={() => shelveIt()}
        />
      </Show>

      <div
        class="pulled-book"
        classList={{ 'is-held': held(), 'is-carried': carrying(), 'is-over-case': overCase() }}
        data-testid="pulled-book"
        ref={el}
        role="presentation"
      >
        {/* Inline-styled so the overlay needs no shelf.css additions
            (that stylesheet belongs to the shelf art wave). */}
        <canvas
          class="pulled-book__cover"
          ref={(node) => (coverCanvas = node)}
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: '0',
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />
      </div>

      {/*
        The verbs. A sibling of the cover, not a child: the cover is scaled,
        rotated and carried around, and type that rode those transforms would
        be unreadable for most of the journey. They hide while it is carried —
        the shelf itself is the affordance at that point.
      */}
      <Show when={p.mode === 'open' && held()}>
        <div
          class="pulled-book-hand"
          classList={{ 'is-carried': carrying() }}
          data-testid="pulled-book-hand"
          role="group"
          aria-label={`${p.book.title} — off the shelf`}
          style={{ top: `${center.y + center.height + 18}px` }}
        >
          <p class="pulled-book-hand__title">{p.book.title}</p>
          <div class="pulled-book-hand__verbs">
            <button
              type="button"
              class="pulled-book-hand__btn is-primary"
              data-testid="pulled-book-read"
              ref={(node) => (readButton = node)}
              onClick={() => openIt()}
            >
              read it
            </button>
            <button
              type="button"
              class="pulled-book-hand__btn"
              data-testid="pulled-book-shelve"
              onClick={() => shelveIt()}
            >
              put it back
            </button>
          </div>
          <p class="pulled-book-hand__hint">or carry it back to the shelf</p>
        </div>
      </Show>
    </>
  );
}
