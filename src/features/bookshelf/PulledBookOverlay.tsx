/**
 * features/bookshelf/PulledBookOverlay.tsx — the DOM half of the pull-out.
 *
 * A fixed-position book cover that crossfades with the canvas ghost at the
 * ghost's exact screen rect, then FLIP-animates (transform/opacity only) to
 * center stage — and the reverse on close. GPU-smooth world motion, DOM-crisp
 * cover where it matters.
 *
 * The face is REAL cover art: art/covers.renderCover baked once into a
 * device-pixel-ratio canvas (seeded from spine_seed, honoring cover_meta
 * overrides), so the pull-out shows the same intricate tooled cover the
 * opened BookView rests on — no more flat gradient rectangle.
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

    const atSpine = {
      x: p.spineRect.x,
      y: p.spineRect.y,
      scaleX: p.spineRect.width / center.width,
      scaleY: p.spineRect.height / center.height,
    };
    const atCenter = { x: center.x, y: center.y, scaleX: 1, scaleY: 1 };

    const tl = gsap.timeline({ onComplete: p.onDone });
    if (p.mode === 'open') {
      gsap.set(el, { ...atSpine, opacity: 0, transformOrigin: '0 0' });
      tl.to(el, {
        opacity: 1,
        duration: 0.08 * m,
        ease: 'none',
        onStart: p.onHandoff,
      }).to(el, { ...atCenter, duration: 0.35 * m, ease: 'power3.inOut' });
    } else {
      gsap.set(el, { ...atCenter, opacity: 1, transformOrigin: '0 0' });
      tl.to(el, { ...atSpine, duration: 0.4 * m, ease: 'power3.inOut' }).to(el, {
        opacity: 0,
        duration: 0.12 * m,
        ease: 'none',
        onStart: p.onHandoff,
      });
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
