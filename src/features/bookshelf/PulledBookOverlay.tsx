/**
 * features/bookshelf/PulledBookOverlay.tsx — the DOM half of the pull-out.
 *
 * A fixed-position book cover that crossfades with the canvas ghost at the
 * ghost's exact screen rect, then FLIP-animates (transform/opacity only) to
 * center stage — and the reverse on close. GPU-smooth world motion, DOM-crisp
 * cover where it matters.
 */

import gsap from 'gsap';
import { onCleanup, onMount, type JSX } from 'solid-js';
import { deriveSpineParams } from '../../art/spines';
import type { Book } from '../../data/types';
import { prefersReducedMotion } from './env';
import { paletteCss } from './spineFactory';
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
  const height = Math.min(vh * 0.68, 520);
  const width = height * 0.72;
  return { width, height, x: (vw - width) / 2, y: (vh - height) / 2 };
}

export default function PulledBookOverlay(p: PulledOverlayProps): JSX.Element {
  let el!: HTMLDivElement;
  const params = deriveSpineParams(p.book.spineSeed);
  const colors = paletteCss(params);

  onMount(() => {
    const m = prefersReducedMotion() ? 0 : 1;
    const center = centerLayout();
    el.style.width = `${center.width}px`;
    el.style.height = `${center.height}px`;
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
    <div
      class="pulled-book"
      ref={el}
      role="presentation"
      style={{
        '--cover-top': colors.top,
        '--cover-bottom': colors.bottom,
      }}
    >
      <div class="pulled-book__spine-edge" />
      <div class="pulled-book__face">
        <h2 class="pulled-book__title">{p.book.title}</h2>
        <div class="pulled-book__rule" />
      </div>
    </div>
  );
}
