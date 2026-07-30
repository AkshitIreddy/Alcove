/**
 * src/flip/cssFallback.ts — non-WebGL flip paths.
 *
 * 1. Rigid CSS 3D fold (design doc "REDUCED MOTION + FALLBACKS"): a
 *    two-faced leaf rotating around the spine, driven by the same p∈[0,1]
 *    progress as the GL curl so PageFlipController can swap paths without
 *    changing its gesture logic. The live leaf is the front face; a plain
 *    paper-backside div is the back face. Two gradient overlay divs (leaf
 *    shading + cast shadow) animate with OPACITY ONLY — no layout, no
 *    filter, per the doc. Used when WebGL is unavailable, after context
 *    loss, or when a snapshot fails.
 *
 * 2. 160ms opacity crossfade for prefers-reduced-motion: the spread swaps
 *    under a brief cream veil so live DOM is never seen mid-swap. GSAP
 *    drives the opacity because global.css zeroes CSS transition durations
 *    under reduced motion (a fade is acceptable motion; a fold is not).
 *
 * All class names live in src/styles/flip.css.
 */

import { gsap } from 'gsap';
import { CROSSFADE_MS, clamp01, type FlipDirection } from './math';

/* ----------------------------------------------------------------------------
   Rigid two-faced fold
   -------------------------------------------------------------------------- */

export interface RigidFoldHandle {
  /** Drive directly from the drag (writes transform + overlay opacity). */
  setProgress(p: number): void;
  /** Tween to 0 (cancel) or 1 (complete), then call back. */
  settle(target: 0 | 1, durationS: number, ease: string, onDone: () => void): void;
  /** Kill a live settle tween (re-grab); DOM state stays where it is. */
  kill(): void;
  /** Remove overlays/classes and clear transforms. Safe to call twice. */
  dispose(): void;
}

export interface RigidFoldOptions {
  /** The moving leaf (its live DOM is the front face). */
  leaf: HTMLElement;
  /** Spread root: receives the perspective class + hosts the shadow div. */
  container: HTMLElement;
  dir: FlipDirection;
}

/**
 * Prepare a leaf for a rigid fold. 'next' rotates the right leaf around its
 * left edge (the spine) 0 → -180°; 'prev' rotates the left leaf around its
 * right edge 0 → +180°.
 */
export function createRigidFold(options: RigidFoldOptions): RigidFoldHandle {
  const { leaf, container, dir } = options;
  const sign = dir === 'next' ? -1 : 1;

  container.classList.add('nb-flip-fallback-stage');
  leaf.classList.add('nb-flip-fallback-leaf');
  leaf.style.transformOrigin = dir === 'next' ? 'left center' : 'right center';

  // Back face: plain paper backside, pre-rotated 180° so it shows once the
  // leaf passes 90°. Positioned over the leaf's rect inside the container.
  const containerRect = container.getBoundingClientRect();
  const leafRect = leaf.getBoundingClientRect();
  const backside = document.createElement('div');
  backside.className = 'nb-flip-fallback-back';
  backside.style.left = `${leafRect.left - containerRect.left}px`;
  backside.style.top = `${leafRect.top - containerRect.top}px`;
  backside.style.width = `${leafRect.width}px`;
  backside.style.height = `${leafRect.height}px`;
  backside.style.transformOrigin = leaf.style.transformOrigin;

  // Gradient overlays — opacity-only animation.
  const shade = document.createElement('div');
  shade.className = 'nb-flip-fallback-shade';
  const shadow = document.createElement('div');
  shadow.className = 'nb-flip-fallback-shadow';
  shadow.style.left = backside.style.left;
  shadow.style.top = backside.style.top;
  shadow.style.width = backside.style.width;
  shadow.style.height = backside.style.height;
  if (dir === 'prev') shadow.classList.add('is-prev');

  leaf.appendChild(shade);
  container.appendChild(backside);
  container.appendChild(shadow);

  const proxy = { p: 0 };
  let tween: gsap.core.Tween | null = null;
  let disposed = false;

  const apply = (p: number): void => {
    const t = clamp01(p);
    const angle = sign * 180 * t;
    const lift = Math.sin(t * Math.PI);
    leaf.style.transform = `rotateY(${angle}deg)`;
    backside.style.transform = `rotateY(${angle + sign * 180}deg)`;
    // Front shading reads only while the front face is visible (t < 0.5).
    shade.style.opacity = String(0.18 * lift * (t < 0.5 ? 1 : 0.35));
    shadow.style.opacity = String(0.3 * lift);
  };

  return {
    setProgress(p) {
      if (disposed) return;
      proxy.p = clamp01(p);
      apply(proxy.p);
    },
    settle(target, durationS, ease, onDone) {
      if (disposed) return;
      tween?.kill();
      tween = gsap.to(proxy, {
        p: target,
        duration: durationS,
        ease,
        onUpdate: () => apply(proxy.p),
        onComplete: () => {
          tween = null;
          onDone();
        },
      });
    },
    kill() {
      tween?.kill();
      tween = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      tween?.kill();
      tween = null;
      shade.remove();
      backside.remove();
      shadow.remove();
      leaf.classList.remove('nb-flip-fallback-leaf');
      leaf.style.transform = '';
      leaf.style.transformOrigin = '';
      container.classList.remove('nb-flip-fallback-stage');
    },
  };
}

/* ----------------------------------------------------------------------------
   Reduced-motion crossfade
   -------------------------------------------------------------------------- */

export interface CrossfadeOptions {
  /** Spread root the veil covers. */
  container: HTMLElement;
  /** Called at full veil — swap the spread DOM here (never seen mid-swap). */
  onSwap: () => void;
  onDone?: () => void;
  /** Total fade in+out, ms (doc: 160). */
  durationMs?: number;
}

/**
 * 160ms opacity crossfade between spreads: cream veil fades in, the spread
 * swaps underneath, veil fades out. Returns a cancel function (removes the
 * veil immediately; onSwap still ran if the fade-in had finished).
 */
export function crossfadeSpread(options: CrossfadeOptions): () => void {
  const { container, onSwap, onDone } = options;
  const half = (options.durationMs ?? CROSSFADE_MS) / 2 / 1000;

  const veil = document.createElement('div');
  veil.className = 'nb-flip-veil';
  veil.style.opacity = '0';
  container.appendChild(veil);

  let cancelled = false;
  const cleanup = (): void => {
    veil.remove();
  };

  const timeline = gsap.timeline({
    onComplete: () => {
      cleanup();
      onDone?.();
    },
  });
  timeline
    .to(veil, { opacity: 1, duration: half, ease: 'power1.in' })
    .add(() => {
      if (!cancelled) onSwap();
    })
    .to(veil, { opacity: 0, duration: half, ease: 'power1.out' });

  return () => {
    cancelled = true;
    timeline.kill();
    cleanup();
  };
}
