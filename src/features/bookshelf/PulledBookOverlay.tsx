/**
 * features/bookshelf/PulledBookOverlay.tsx — the DOM half of the pull-out.
 *
 * A fixed-position book cover that crossfades with the canvas ghost at the
 * ghost's exact screen rect, then animates (transform/opacity only) to center
 * stage — and the reverse on close. GPU-smooth world motion, DOM-crisp cover
 * where it matters.
 *
 * The face is REAL cover art: art/covers.renderCover baked once into a
 * device-pixel-ratio canvas (seeded from spine_seed, honoring cover_meta
 * overrides), so the pull-out shows the same intricate tooled cover the
 * opened BookView rests on — no more flat gradient rectangle.
 *
 * ## Why this is a hinge and not a scale
 *
 * The move it has to sell is a book turning from edge-on to face-on. The old
 * version did that as a plain FLIP: a spine-shaped rect stretching out to a
 * cover-shaped one, which is the same thing a modal does when it zooms open.
 * It looked like the artwork was being pulled wide, because it was.
 *
 * So the cover now swings on `rotationY` about its own left edge — the spine —
 * under a perspective, which is the hinge the object actually has. It arrives
 * along an arc rather than a straight line (books get carried, not teleported)
 * and it lands with an overshoot that settles, because a thing with mass does
 * not simply stop. All of it is transform and opacity; nothing here reads a
 * layout property, let alone writes one.
 */

import gsap from 'gsap';
import { onCleanup, onMount, type JSX } from 'solid-js';
import { resolveBookStyle } from '../../art/bookStyle';
import { renderCoverInto } from '../../art/covers';
import { getTheme } from '../../art/themes';
import { readShelfMeta } from '../../data/books';
import { bookStyleOverridesFor, themeSpineDefaults } from './bookIdentity';
import { libraryPrefs } from './libraryPrefs';
import type { Book } from '../../data/types';
import { prefersReducedMotion } from './env';
import type { RectLike } from './world';

export interface PulledOverlayProps {
  book: Book;
  /** The spine's screen rect (start for 'open', destination for 'close'). */
  spineRect: RectLike;
  mode: 'open' | 'close';
  /**
   * Crossfade moment: 'open' → fade the canvas ghost out; 'close' → the
   * overlay reached the spine rect, start the canvas push-in.
   */
  onHandoff(): void;
  /** Animation fully finished. */
  onDone(): void;
}

interface CenterLayout {
  width: number;
  height: number;
  x: number;
  y: number;
}

function centerLayout(): CenterLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Bigger presence than the old 520px cap — the pulled book is the hero.
  const height = Math.min(vh * 0.78, 660);
  const width = height * 0.72;
  return { width, height, x: (vw - width) / 2, y: (vh - height) / 2 };
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

export default function PulledBookOverlay(p: PulledOverlayProps): JSX.Element {
  let el!: HTMLDivElement;
  let coverCanvas: HTMLCanvasElement | undefined;

  onMount(() => {
    const m = prefersReducedMotion() ? 0 : 1;
    const center = centerLayout();
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

    // Closed on its spine, standing where the canvas ghost just finished.
    const atSpine = {
      x: p.spineRect.x,
      y: p.spineRect.y,
      scaleX: hingeScaleX(p.spineRect.width, center.width),
      scaleY: p.spineRect.height / center.height,
      rotationY: -HINGE_DEG,
    };
    // Open, square to the viewer, centered.
    const atCenter = { x: center.x, y: center.y, scaleX: 1, scaleY: 1, rotationY: 0 };
    const open = p.mode === 'open';
    const from = open ? atSpine : atCenter;
    const to = open ? atCenter : atSpine;

    gsap.set(el, {
      x: from.x,
      y: from.y,
      scaleX: from.scaleX,
      scaleY: from.scaleY,
      rotationY: from.rotationY,
      transformOrigin: '0 0',
      transformPerspective: PERSPECTIVE,
      opacity: open ? 0 : 1,
    });

    // Position rides the arc off a single progress value, which keeps x and y
    // on one curve; GSAP owns every other channel. `quickSetter` writes into
    // the same transform cache the tweens use (hence: created after the set
    // above has built it), so the two compose instead of trampling each other.
    const progress = { t: 0 };
    const setX = gsap.quickSetter(el, 'x', 'px') as (v: number) => void;
    const setY = gsap.quickSetter(el, 'y', 'px') as (v: number) => void;
    const flyPath = (): void => {
      const at = arcPoint(from, to, progress.t);
      setX(at.x);
      setY(at.y);
    };

    const tl = gsap.timeline({
      // Land the final position from the path itself rather than trusting a
      // last onUpdate to have run — under prefers-reduced-motion every
      // duration below is zero and there may not have been one.
      onComplete: () => {
        progress.t = 1;
        flyPath();
        p.onDone();
      },
    });
    if (open) {
      tl
        // Crossfade first, over a stationary frame or two: the canvas ghost is
        // still on screen underneath and the two must agree before either moves.
        .to(el, { opacity: 1, duration: 0.07 * m, ease: 'none', onStart: p.onHandoff }, 0)
        .to(progress, { t: 1, duration: 0.44 * m, ease: 'power2.inOut', onUpdate: flyPath }, 0)
        // The cover swings square a beat before the flight lands, so you are
        // reading the book's face by the time it arrives.
        .to(el, { rotationY: 0, duration: 0.42 * m, ease: 'power2.out' }, 0.02 * m)
        // Size is locked to the SAME ease as the path. On `power2.out` the
        // cover reached full width a quarter of the way across and then slid
        // there at that size, which is a modal zooming open, not a book being
        // carried; growth has to arrive when the book does.
        .to(
          el,
          { scaleX: 1.03, scaleY: 1.03, duration: 0.38 * m, ease: 'power2.inOut' },
          0,
        )
        // The settle. Everything above is the throw; this is the catch.
        .to(
          el,
          { scaleX: 1, scaleY: 1, duration: 0.22 * m, ease: 'elastic.out(1, 0.5)' },
          0.38 * m,
        );
    } else {
      tl
        // Anticipation on the way out too: it gathers itself before it goes.
        .to(el, { scaleX: 1.035, scaleY: 1.035, duration: 0.1 * m, ease: 'power2.out' }, 0)
        .to(progress, { t: 1, duration: 0.4 * m, ease: 'power2.in', onUpdate: flyPath }, 0.1 * m)
        .to(
          el,
          {
            scaleX: to.scaleX,
            scaleY: to.scaleY,
            duration: 0.4 * m,
            ease: 'power2.in',
          },
          0.1 * m,
        )
        .to(el, { rotationY: to.rotationY, duration: 0.34 * m, ease: 'power2.in' }, 0.14 * m)
        // Hand back to the canvas as the face turns away, not after it has.
        .to(el, { opacity: 0, duration: 0.1 * m, ease: 'none', onStart: p.onHandoff }, 0.46 * m);
    }
    onCleanup(() => tl.kill());
  });

  return (
    <div class="pulled-book" ref={el} role="presentation">
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
  );
}
