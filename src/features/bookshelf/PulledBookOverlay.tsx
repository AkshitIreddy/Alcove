/**
 * features/bookshelf/PulledBookOverlay.tsx — the DOM half of the pull-out.
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
 * ## Pulling a book out brings it FORWARD. A second click opens it.
 *
 * *"the book is auto opening when i click it should isntead just come in
 * foreview and only if user clicks on it does it go inside, with a back button
 * on top left"*
 *
 * So the flight ends here, with the book at rest in front of the case: out of
 * the shelf, big enough to read the cover, still in the room. Nothing has been
 * committed yet. From there:
 *
 *  - a tap on the cover opens it (Enter or Space, if you got here by keyboard);
 *  - the back arrow in the TOP-LEFT corner sends it home, and so does Escape;
 *  - it is still grabbable — carry it over the bookcase and drop it, and it
 *    goes back in its slot (the world draws the gilt outline of the gap it
 *    came from). Dropped anywhere else it simply stays where you put it.
 *
 * What this does NOT bring back is the label plate with "read it" and "put it
 * back" printed under the cover, which is what the reader threw out before
 * (*"no need for the menu with read it put it back, remove that and just have
 * back button on top left"*). The book itself is the button, and the way back
 * is one arrow in the corner every other exit in this app lives in.
 *
 * The flight is unchanged — the hinge, the arc, the overshoot — and it still
 * lands at the size the opened spread's cover board is, so the swap into the
 * pages reads as the same object opening.
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
   *            open it as it lands.
   * 'close' — the book view is unmounting; fly it back to its slot at once.
   */
  mode: 'open' | 'close';
  /** Where the book belongs on the shelf, read at the moment it is sent back. */
  homeRect(): RectLike;
  /** The bookcase in screen px — the drop target for carrying it back. */
  caseRect(): RectLike | null;
  /** The carried book is (or is no longer) over the case: show the slot outline. */
  onOverCase(over: boolean): void;
  /**
   * Crossfade moment. `'out'`: the DOM cover has taken over and the canvas
   * ghost should fade. `'in'`: the DOM cover is back on the spine and the
   * canvas should push the book into the row.
   */
  onHandoff(phase: 'out' | 'in'): void;
  /**
   * Open the book. Fired when the reader taps (or keys) the cover — never on
   * the landing itself, which only brings the book forward. Exactly once.
   */
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
 * Where the book arrives, and how big.
 *
 * Sized to the thing it becomes. The opened spread's cover board fills nearly
 * the whole window, so a closed cover that lands at nearly that height reads
 * as the same object opening; the 540px card this replaces (which had to make
 * room for a label plate under it) read as a thumbnail being swapped for a
 * book. Clamped so a very tall window does not produce a poster.
 */
function centerLayout(): CenterLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = Math.max(220, Math.min(vh * 0.82, 720));
  const width = height * 0.72;
  return {
    width,
    height,
    x: (vw - width) / 2,
    y: (vh - height) / 2,
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

/** Pointer travel (px) that turns a press on the flying cover into a carry. */
const CARRY_SLOP = 7;

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

  /**
   * True while the book is out of the shelf and its fate is still open — the
   * window in which it can be caught, carried and put back. Cleared the moment
   * it opens or starts flying home.
   */
  const [live, setLive] = createSignal(p.mode === 'open');
  /** True while the reader is carrying the book around. */
  const [carrying, setCarrying] = createSignal(false);
  /** True while a carry is over the bookcase (the drop would put it back). */
  const [overCase, setOverCase] = createSignal(false);
  /** The wash over the frozen room. Raised a frame late so it fades in. */
  const [dim, setDim] = createSignal(false);
  /** True once the flight has landed and the book is resting in the room. */
  const [held, setHeld] = createSignal(false);

  /**
   * "Put it back", reachable from the JSX below.
   *
   * It is built inside `onMount` because it closes over the timeline, the pose
   * bookkeeping and the press state; the corner arrow is rendered out here, so
   * it needs a handle rather than a copy. (Opening needs no such handle — the
   * cover's own pointer and key handlers are the only way in.)
   */
  let putBackNow: () => void = () => {};

  const center = centerLayout();

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

    // Where the cover is right now, in the coordinates GSAP writes. Kept by
    // hand because the carry, the snap-back and the return flight all have to
    // start from wherever the last one left it.
    const here = { x: center.x, y: center.y };

    /**
     * The pose on screen this instant. Read back off GSAP rather than assumed:
     * a book caught in mid-flight is part-turned and part-grown, and the
     * return has to start from exactly that and not from a tidy 1/1/0°.
     */
    const currentPose = (): Pose => ({
      x: here.x,
      y: here.y,
      scaleX: Number(gsap.getProperty(el, 'scaleX')) || 1,
      scaleY: Number(gsap.getProperty(el, 'scaleY')) || 1,
      rotationY: Number(gsap.getProperty(el, 'rotationY')) || 0,
    });

    // Position rides an arc off a single progress value, which keeps x and y
    // on one curve; GSAP owns every other channel. `quickSetter` writes into
    // the same transform cache the tweens use (hence: created after the first
    // `gsap.set` has built it), so the two compose instead of trampling.
    let setX: ((v: number) => void) | null = null;
    let setY: ((v: number) => void) | null = null;
    let tl: gsap.core.Timeline | null = null;
    let opened = false;
    let returning = false;
    let finished = false;
    /**
     * The live press on the cover, if any (see "catching it in flight"). It is
     * declared up here rather than beside its handlers because the outbound
     * flight's landing has to ask whether a hand is already on the book.
     */
    let press: { id: number; x: number; y: number; cardX: number; cardY: number } | null =
      null;

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
          // The landing decides NOTHING. The book is simply out here now,
          // face on, waiting to be opened, put back, or picked up again.
          setHeld(true);
          // Focus follows the book out of the case: `held` is what gives the
          // cover its tabindex, so this has to come after the flag, and after
          // Solid has written the attribute.
          queueMicrotask(() => {
            if (!opened && !returning && !finished) el.focus({ preventScroll: true });
          });
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
      // A catch mid-flight leaves a squaring tween running on the same
      // channels this timeline is about to own; two owners fight.
      gsap.killTweensOf(el);
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

    /* ------------------------------ the two ends -------------------------- */

    /** Open the book. Idempotent, and the only path into the pages. */
    const openNow = (): void => {
      if (opened || returning || finished) return;
      opened = true;
      press = null;
      setLive(false);
      setHeld(false);
      setCarrying(false);
      if (overCase()) {
        setOverCase(false);
        p.onOverCase(false);
      }
      tl?.kill();
      p.onOpen();
    };

    /** Send the book back to its slot. Idempotent. */
    const putBack = (): void => {
      if (opened || returning || finished) return;
      returning = true;
      press = null;
      setLive(false);
      setHeld(false);
      setCarrying(false);
      setOverCase(false);
      p.onOverCase(false);
      flyHome(currentPose(), spinePose(p.homeRect()));
    };

    putBackNow = putBack;

    if (p.mode === 'open') {
      flyOut();
      // A frame late so the wash TRANSITIONS in behind the flight instead of
      // being painted at full strength on the mount frame.
      requestAnimationFrame(() => setDim(!opened && !returning));
    } else {
      const from: Pose = { x: center.x, y: center.y, scaleX: 1, scaleY: 1, rotationY: 0 };
      applyStart(from, 1);
      flyHome(from, spinePose(p.spineRect));
    }

    /* -------------------------- catching it in flight --------------------- */
    /*
     * Pointer handling lives here rather than on JSX attributes because the
     * press has to be classified (a tap on the cover opens the book, a drag
     * carries it) and because capture must survive the pointer leaving the
     * card — which it does within about 40px of any real throw.
     */

    const onDown = (e: PointerEvent): void => {
      if (!live() || !e.isPrimary || e.button !== 0) return;
      // A previous drop may still be gliding; grabbing it again has to take
      // the position off that tween or the two fight over `here`.
      gsap.killTweensOf(here);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // A pointer id with no live pointer behind it (a synthetic event from
        // a probe, a device that has already lifted) throws here. Capture is
        // an improvement to the carry, not a precondition for it — the moves
        // still arrive, they just stop following once they leave the cover.
      }
      press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
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
        // Caught mid-hinge: square it to the hand over one short beat, so what
        // the reader is carrying is a book and not a book at 40° of turn.
        gsap.to(el, {
          rotationY: 0,
          scaleX: 1,
          scaleY: 1,
          duration: 0.14 * m,
          ease: 'power2.out',
          overwrite: 'auto',
        });
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

    /**
     * What a release means, which depends entirely on whether the pointer
     * MOVED.
     *
     * A tap is the second click the reader asked for: it opens the book. A
     * carry that ends over the bookcase shelves it. A carry that ends anywhere
     * else leaves the book exactly where it was dropped and still held — that
     * third state is the whole point of the change, and it must not be
     * collapsed back into "any release opens it".
     */
    const settle = (): void => {
      if (carrying()) {
        if (overCase()) putBack();
        else {
          setCarrying(false);
          // A book caught in mid-flight never ran the landing, so this is
          // where it comes to rest — and the corner arrow has to appear for
          // it exactly as it would have.
          setHeld(true);
        }
        return;
      }
      openNow();
    };

    const onUp = (e: PointerEvent): void => {
      const press_ = press;
      if (press_ === null || e.pointerId !== press_.id) return;
      press = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      settle();
    };

    const onCancel = (e: PointerEvent): void => {
      if (press === null || e.pointerId !== press.id) return;
      press = null;
      settle();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);

    // The two verbs from the keyboard: Escape always means "I did not mean
    // this one", and Enter/Space on the resting book is the second click that
    // opens it. Capture phase, because the shelf's own document listener is
    // still attached behind the overlay.
    const onKey = (e: KeyboardEvent): void => {
      if (!live()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        putBack();
        return;
      }
      // Only once it has landed: a book still in the air has not arrived at
      // the thing the key would be confirming.
      if (!held()) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        e.stopPropagation();
        openNow();
      }
    };
    document.addEventListener('keydown', onKey, true);

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
        A flat wash over the room while the book is in the air. It is not
        decoration: the shelf is frozen underneath, and it carries the eye onto
        the one thing that is moving. It swallows nothing — the flight is
        short, and a scrim you can click was only ever there to serve the
        resting card that is gone.
      */}
      <Show when={p.mode === 'open'}>
        <div
          class="pulled-book-scrim"
          classList={{ 'is-up': dim() && live() }}
          data-testid="pulled-book-scrim"
          aria-hidden="true"
        />
      </Show>

      {/*
        The way back, and it is the TOP-LEFT corner because every exit in this
        app is (docs in views/BookView.tsx; tests/top-left-exits.test.ts is the
        check). Inline-styled for the same reason the cover canvas below is:
        this overlay adds nothing to shelf.css. It appears only once the book
        has actually landed — an arrow chasing a book through the air is chrome
        arguing with the animation.
      */}
      <Show when={p.mode === 'open' && held() && live()}>
        <button
          type="button"
          class="pulled-book-back"
          data-testid="pulled-book-back"
          aria-label="Put the book back on the shelf"
          onClick={() => putBackNow()}
          style={{
            position: 'fixed',
            left: '20px',
            top: '18px',
            'z-index': 'calc(var(--z-overlay) + 1)',
            display: 'inline-flex',
            'align-items': 'center',
            gap: '8px',
            padding: '7px 14px 7px 11px',
            color: 'var(--ink-sepia)',
            background: 'var(--paper-aged)',
            border: 'var(--stroke-ink)',
            'border-radius': 'var(--radius-wobble-sm)',
            'box-shadow': 'var(--shadow-md)',
            font: '500 13px/1 var(--font-ui)',
            'letter-spacing': '0.01em',
            cursor: 'pointer',
          }}
        >
          {/* Pre-wobbled static path — the same hand as the book view's own
              back arrow. Stroke only, so a missing stylesheet cannot turn it
              into a black box. */}
          <svg viewBox="0 0 34 20" width="20" height="12" aria-hidden="true">
            <path
              d="M 31.5 10.4 C 24 9.6 14.5 10.5 6.2 10.1 M 12.8 3.4 C 10.4 5.8 7.6 8.2 4.1 10.2 C 7.4 12 10.2 14.4 12.4 16.9"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          back to the shelf
        </button>
      </Show>

      <div
        class="pulled-book"
        classList={{
          'is-live': live(),
          'is-carried': carrying(),
          'is-over-case': overCase(),
          'is-held': held(),
        }}
        data-testid="pulled-book"
        ref={el}
        // The book at rest IS the button that opens it — there is no plate of
        // verbs under it. Keyboard readers get the same two moves the pointer
        // has: Enter/Space opens, Escape shelves it (see `onKey`).
        role={held() ? 'button' : 'presentation'}
        tabindex={held() ? 0 : undefined}
        aria-label={held() ? `Open ${p.book.title}` : undefined}
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
    </>
  );
}
