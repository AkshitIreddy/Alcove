/**
 * src/flip/PageFlipController.ts — gesture → curl → landing pipeline.
 *
 * Plain TS class, deliberately outside Solid reactivity (design doc: no
 * signals in the hot path). Owns pointer handling, the GSAP tween, the GL
 * frame loop and the landing sequence; Solid only mounts it (FlipSurface)
 * and reacts to its typed events.
 *
 * Lifecycle of a flip:
 *   pointerdown on a hotspot (right-edge 48px strip / corners)
 *     → save selection, blur editor, upload cached textures, hide the live
 *       leaf, show the canvas — all in the same frame (bitmaps are
 *       pre-cached so nothing rasterizes here)
 *   pointermove → p = clamp mapping, corner grips tilt the fold; direct
 *       proxy writes + one rAF-coalesced GL render per frame
 *   pointerup → tap ⇒ tween p→1 (power2.inOut, 0.45s); drag ⇒ velocity
 *       decision (complete vs cancel), gsap power3.out with
 *       duration clamp(0.55 − 0.1·|v|, 0.25, 0.55), or InertiaPlugin throw
 *       physics when the plugin is registered
 *   pointerdown mid-tween → tween.kill(), resume drag from current p
 *   land() → flat-state swap: commit navigation (p=1) or restore
 *       selection/focus (p=0), reveal live DOM under the canvas, wait one
 *       rAF for paint, then hide the canvas.
 *
 * Fallbacks: WebGL unavailable → rigid CSS 3D fold (same gesture math);
 * context loss mid-flip → instant land via a crossfade veil; reduced motion
 * → 160ms crossfade, no curl.
 */

import { gsap } from 'gsap';
import { play } from '../sound/engine';
import { CurlRenderer } from './curl';
import { createFlipContext, type FlipContext } from './gl';
import { createRigidFold, crossfadeSpread, type RigidFoldHandle } from './cssFallback';
import type { PageRasterCache } from './rasterCache';
import {
  TAP_FLIP_DURATION_S,
  clamp01,
  decideFlipTarget,
  dragToP,
  flipDuration,
  foldTilt,
  hitTestHotspot,
  soundVolumeForVelocity,
  type FlipDirection,
  type FlipGrip,
} from './math';

export type LeafSide = 'left' | 'right';

export interface FlipEvents {
  /** Canvas is up, live leaf hidden, gesture (or programmatic flip) began. */
  onFlipStart?: (direction: FlipDirection) => void;
  /** Flip completed and navigation was committed; canvas is coming down. */
  onLanded?: (direction: FlipDirection) => void;
  /** Flip cancelled back to p=0; selection/focus restored. */
  onCancel?: (direction: FlipDirection) => void;
}

/** Page ids for the three textures of a flip; null = plain cream paper. */
export interface FlipPages {
  /** Moving sheet's visible face (current right page for 'next'). */
  front: string | null;
  /** Sheet's other side (next left page for 'next', prev right for 'prev'). */
  back: string | null;
  /** Page uncovered beneath the sheet (next right / prev left). */
  revealed: string | null;
}

export interface PageFlipControllerOptions {
  /** Spread root: hotspot pointer events, canvas overlay parent, geometry frame. */
  root: HTMLElement;
  /** Canvas overlaying the whole spread (position:absolute inset:0 in root). */
  canvas: HTMLCanvasElement;
  cache: PageRasterCache;
  /** Live moving-leaf element per side ('next' flips right, 'prev' left). */
  getLeafElement(side: LeafSide): HTMLElement | null;
  /** Texture page ids for a direction; null = navigation impossible. */
  getFlipPages(dir: FlipDirection): FlipPages | null;
  /** Commit navigation in the host store (mounts the new spread's DOM). */
  navigate(dir: FlipDirection): void;
  events?: FlipEvents;
  /** Test seam; defaults to matchMedia('(prefers-reduced-motion: reduce)'). */
  prefersReducedMotion?: () => boolean;
}

type Phase = 'rest' | 'dragging' | 'settling';

interface LeafGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 300;

/** InertiaPlugin is free since GSAP 3.13 but may not be registered. */
function inertiaRegistered(): boolean {
  const core = (gsap as unknown as { core?: { globals?: () => Record<string, unknown> } }).core;
  const globals = core?.globals?.();
  return Boolean(globals && globals['InertiaPlugin']);
}

export class PageFlipController {
  private phase: Phase = 'rest';
  private readonly flip = { p: 0 };
  private dir: FlipDirection = 'next';
  private grip: FlipGrip = 'edge';
  private baseTilt = 0;
  private velocity = 0;
  private lastP = 0;
  private lastMoveTime = 0;
  private downX = 0;
  private downY = 0;
  private downTime = 0;
  private pointerId: number | null = null;
  private reducedPendingDir: FlipDirection | null = null;

  private rootRect: DOMRect | null = null;
  private leaf: LeafGeometry = { x: 0, y: 0, w: 1, h: 1 };
  private leafElement: HTMLElement | null = null;

  private tween: gsap.core.Tween | null = null;
  private fold: RigidFoldHandle | null = null;
  private cancelCrossfade: (() => void) | null = null;
  private renderScheduled = false;
  private destroyed = false;

  /**
   * Landing bookkeeping. `landing` is true from the moment navigation is
   * committed until the overlay is back at rest — a re-grab in that window
   * would drive a gesture against an already-swapped spread. `landToken`
   * invalidates a landing's queued frames the instant a new flip (or a
   * destroy / context loss) takes over, so a stale frame can never rip the
   * canvas away mid-gesture.
   */
  private landing = false;
  private landToken = 0;

  private ctx: FlipContext | null = null;
  private renderer: CurlRenderer | null = null;

  private savedRanges: Range[] = [];
  private savedActive: HTMLElement | null = null;

  constructor(private readonly options: PageFlipControllerOptions) {
    // WebGL2 context created once at book-open (doc: avoid context-creation
    // jank at gesture start). null → CSS rigid-fold fallback path.
    this.ctx = createFlipContext(options.canvas, {
      onLost: () => this.handleContextLost(),
      onRestored: () => this.handleContextRestored(),
    });
    if (this.ctx) {
      try {
        this.renderer = new CurlRenderer(this.ctx);
      } catch {
        this.ctx.dispose();
        this.ctx = null;
        this.renderer = null;
      }
    }
    const root = options.root;
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('pointercancel', this.onPointerCancel);
  }

  /** True when the GPU curl path is active (false = CSS fallback). */
  get usesWebGL(): boolean {
    return this.renderer !== null && this.ctx !== null && !this.ctx.isLost();
  }

  get isFlipping(): boolean {
    return this.phase !== 'rest';
  }

  /** Optional: paper-fibre tile shared with the resting CSS background. */
  setPaperTexture(tile: ImageBitmap | HTMLCanvasElement, tileCssSize: number): void {
    this.renderer?.setPaperTexture(tile, tileCssSize);
  }

  /** Programmatic flip (tap-to-flip target, keyboard →). */
  flipNext(): void {
    this.programmaticFlip('next');
  }

  /** Programmatic flip (keyboard ←). */
  flipPrev(): void {
    this.programmaticFlip('prev');
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const root = this.options.root;
    root.removeEventListener('pointerdown', this.onPointerDown);
    root.removeEventListener('pointermove', this.onPointerMove);
    root.removeEventListener('pointerup', this.onPointerUp);
    root.removeEventListener('pointercancel', this.onPointerCancel);
    this.landToken++; // drop any queued landing frames
    this.tween?.kill();
    this.tween = null;
    this.cancelCrossfade?.();
    this.fold?.dispose();
    this.fold = null;
    // Leave nothing of the overlay behind: the host may keep the leaves
    // mounted (book stays open, surface remounts) after this controller goes.
    this.options.canvas.classList.remove('is-flipping');
    if (this.leafElement) this.leafElement.style.visibility = '';
    this.leafElement = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.ctx?.dispose();
    this.ctx = null;
  }

  /* ------------------------------ pointer flow ----------------------------- */

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.destroyed || event.button !== 0) return;

    // Interrupt a settling tween: kill it and resume the drag from the
    // current p — the overlay is already up, so a re-grab costs nothing.
    // Not once land() has run though: navigation is committed by then and
    // the leaf/textures the gesture would drive belong to the old spread.
    if (this.phase === 'settling' && !this.landing && !this.reducedMotion()) {
      this.tween?.kill();
      this.tween = null;
      // The CSS fallback drives its own tween; leaving it alive let it fight
      // the drag and then land() on its own halfway through the new gesture.
      this.fold?.kill();
      this.phase = 'dragging';
      this.capturePointer(event);
      this.lastP = this.flip.p;
      this.lastMoveTime = event.timeStamp;
      this.velocity = 0;
      this.downX = event.clientX;
      this.downY = event.clientY;
      this.downTime = event.timeStamp;
      return;
    }
    if (this.phase !== 'rest') return;

    const hit = this.hitTest(event);
    if (!hit) return;
    if (!this.options.getFlipPages(hit.dir)) return;

    if (this.reducedMotion()) {
      // No curl under reduced motion: remember intent, navigate on release.
      this.reducedPendingDir = hit.dir;
      this.capturePointer(event);
      return;
    }
    this.beginGesture(hit.dir, hit.grip, event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.phase !== 'dragging' || event.pointerId !== this.pointerId) return;
    const local = this.toLeafLocal(event.clientX, event.clientY);
    const p = dragToP(local.x, this.leaf.w);
    this.baseTilt = foldTilt(this.grip, local.y / this.leaf.h);

    const dt = (event.timeStamp - this.lastMoveTime) / 1000;
    if (dt > 0.001) {
      const instant = (p - this.lastP) / dt;
      this.velocity = this.velocity * 0.6 + instant * 0.4; // light smoothing
      this.lastP = p;
      this.lastMoveTime = event.timeStamp;
    }
    this.flip.p = p;
    this.fold?.setProgress(p);
    this.requestRender();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;

    if (this.reducedPendingDir) {
      const dir = this.reducedPendingDir;
      this.reducedPendingDir = null;
      this.crossfadeNavigate(dir);
      return;
    }
    if (this.phase !== 'dragging') return;

    const isTap =
      Math.abs(event.clientX - this.downX) < TAP_SLOP_PX &&
      Math.abs(event.clientY - this.downY) < TAP_SLOP_PX &&
      event.timeStamp - this.downTime < TAP_MAX_MS;

    if (isTap) {
      // Tap-to-flip: full programmatic sweep.
      this.settle(1, TAP_FLIP_DURATION_S, 'power2.inOut', null);
      void play('page-flip', { volume: soundVolumeForVelocity(1) });
      return;
    }

    const v = this.velocity;
    const target = decideFlipTarget(this.flip.p, v);
    // Page-flip rustle at launch, volume scaled by release velocity; the
    // engine rotates page-flip-1..3 with no immediate repeats.
    if (target === 1) void play('page-flip', { volume: soundVolumeForVelocity(v) });
    this.settle(target, flipDuration(v), 'power3.out', v);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.reducedPendingDir = null;
    if (this.phase === 'dragging') this.settle(0, flipDuration(0), 'power3.out', null);
  };

  private capturePointer(event: PointerEvent): void {
    this.pointerId = event.pointerId;
    try {
      this.options.root.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone; drag still works.
    }
  }

  /* ------------------------------ hit testing ------------------------------ */

  private hitTest(event: PointerEvent): { dir: FlipDirection; grip: FlipGrip } | null {
    for (const dir of ['next', 'prev'] as const) {
      const el = this.options.getLeafElement(dir === 'next' ? 'right' : 'left');
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      // Leaf-local x measured from the spine toward the outer edge.
      const x = dir === 'next' ? event.clientX - rect.left : rect.right - event.clientX;
      const y = event.clientY - rect.top;
      const grip = hitTestHotspot(x, y, rect.width, rect.height);
      if (grip) return { dir, grip };
    }
    return null;
  }

  private toLeafLocal(clientX: number, clientY: number): { x: number; y: number } {
    const root = this.rootRect;
    const rx = root ? clientX - root.left : clientX;
    const ry = root ? clientY - root.top : clientY;
    const x =
      this.dir === 'next' ? rx - this.leaf.x : this.leaf.x + this.leaf.w - rx;
    return { x, y: clamp01((ry - this.leaf.y) / this.leaf.h) * this.leaf.h };
  }

  /* ------------------------------ flip phases ------------------------------ */

  private beginGesture(dir: FlipDirection, grip: FlipGrip, event: PointerEvent): boolean {
    if (!this.beginFlip(dir, grip)) return false;
    this.capturePointer(event);
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = event.timeStamp;
    const local = this.toLeafLocal(event.clientX, event.clientY);
    this.flip.p = dragToP(local.x, this.leaf.w);
    this.lastP = this.flip.p;
    this.lastMoveTime = event.timeStamp;
    this.velocity = 0;
    this.requestRender();
    return true;
  }

  /**
   * Shared flip setup: geometry, selection save + editor blur, texture
   * upload, leaf hide + canvas reveal — all synchronous in one frame.
   */
  private beginFlip(dir: FlipDirection, grip: FlipGrip): boolean {
    const pages = this.options.getFlipPages(dir);
    if (!pages) return false;
    const side: LeafSide = dir === 'next' ? 'right' : 'left';
    const leafElement = this.options.getLeafElement(side);
    if (!leafElement) return false;

    // Any landing still holding queued frames is now history — its hide-the-
    // canvas frame must not fire in the middle of this flip.
    this.landToken++;
    this.landing = false;

    this.rootRect = this.options.root.getBoundingClientRect();
    const rect = leafElement.getBoundingClientRect();
    this.leaf = {
      x: rect.left - this.rootRect.left,
      y: rect.top - this.rootRect.top,
      w: Math.max(rect.width, 1),
      h: Math.max(rect.height, 1),
    };
    this.leafElement = leafElement;
    this.dir = dir;
    this.grip = grip;
    this.baseTilt = 0;
    this.flip.p = 0;

    // Blur the editor; remember selection so a cancelled flip restores it.
    this.saveSelection();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if (this.usesWebGL && this.ctx && this.renderer) {
      // Cached bitmaps only — a ≤300ms-stale frame is accepted by design
      // (content is unreadable mid-flip; landings always swap to live DOM).
      const cache = this.options.cache;
      const bitmapOf = (id: string | null): ImageBitmap | null =>
        id ? (cache.get(id)?.bitmap ?? null) : null;
      this.renderer.setPageTextures(
        bitmapOf(pages.front),
        bitmapOf(pages.back),
        bitmapOf(pages.revealed),
      );
      this.ctx.resize(
        this.rootRect.width,
        this.rootRect.height,
        Math.min(window.devicePixelRatio || 1, 2),
      );
      leafElement.style.visibility = 'hidden'; // keeps layout
      this.options.canvas.classList.add('is-flipping');
    } else {
      // Rigid CSS 3D fold: the live leaf itself is the front face.
      this.fold = createRigidFold({
        leaf: leafElement,
        container: this.options.root,
        dir,
      });
    }

    this.phase = 'dragging';
    this.options.events?.onFlipStart?.(dir);
    return true;
  }

  private programmaticFlip(dir: FlipDirection): void {
    if (this.destroyed || this.phase !== 'rest') return;
    if (!this.options.getFlipPages(dir)) return;
    if (this.reducedMotion()) {
      this.crossfadeNavigate(dir);
      return;
    }
    if (!this.beginFlip(dir, 'edge')) return;
    void play('page-flip', { volume: soundVolumeForVelocity(1) });
    this.settle(1, TAP_FLIP_DURATION_S, 'power2.inOut', null);
  }

  /** Tween p to its target and land. `velocity` non-null enables inertia. */
  private settle(target: 0 | 1, durationS: number, ease: string, velocity: number | null): void {
    this.phase = 'settling';
    if (this.fold) {
      this.fold.settle(target, durationS, ease, () => this.land(target));
      return;
    }
    const vars: gsap.TweenVars = {
      onUpdate: () => this.requestRender(),
      onComplete: () => this.land(this.flip.p > 0.5 ? 1 : 0),
    };
    if (velocity !== null && inertiaRegistered()) {
      // Free throw physics since GSAP 3.13: momentum decides the landing
      // (min/max clamp keeps p in range, end snaps to a page state).
      vars.inertia = { p: { velocity, end: [0, 1], min: 0, max: 1 } };
      vars.duration = durationS;
    } else {
      vars.p = target;
      vars.duration = durationS;
      vars.ease = ease;
    }
    this.tween = gsap.to(this.flip, vars);
  }

  /**
   * Flat-state swap (the seamless trick): the page is geometrically flat at
   * p∈{0,1}, so we commit/restore the live DOM under the canvas, wait one
   * rAF so it paints, then wipe and hide the overlay — raster→DOM is
   * pixel-identical.
   *
   * The wipe and the hide are DELIBERATELY different frames. `display:none`
   * pulls the canvas out of compositing, so a gl.clear() issued in the same
   * frame is never presented: the layer keeps the last curl frame, and that
   * ghost sheet hangs over the settled spread (and flashes straight back the
   * next time the canvas is shown). Clear while it is still displayed, hide
   * it once the transparent frame has been composited.
   */
  private land(target: 0 | 1): void {
    if (this.landing) return; // a landing is already in flight
    this.landing = true;
    const token = ++this.landToken;
    this.tween = null;
    this.flip.p = target;
    const dir = this.dir;
    const leafElement = this.leafElement;

    if (this.fold) {
      this.fold.dispose();
      this.fold = null;
    }

    if (target === 1) {
      this.options.navigate(dir); // new spread mounts under the canvas
    } else if (leafElement) {
      leafElement.style.visibility = '';
    }

    // A newer flip (or destroy / context loss) bumps landToken and owns the
    // overlay from that moment; these frames must then do nothing.
    const superseded = (): boolean => this.destroyed || this.landToken !== token;

    requestAnimationFrame(() => {
      if (superseded()) return;
      // One painted frame with the (new or restored) live DOM beneath the
      // canvas; now the overlay can vanish without a visible pop.
      requestAnimationFrame(() => {
        if (superseded()) return;
        this.renderer?.clear();
        // The old leaf element may have been unmounted by navigation; clear
        // the inline style anyway in case the host recycles it.
        if (leafElement) leafElement.style.visibility = '';
        this.phase = 'rest';
        this.landing = false;
        this.leafElement = null;
        if (target === 1) {
          this.savedRanges = [];
          this.savedActive = null;
          this.options.events?.onLanded?.(dir);
        } else {
          this.restoreSelection(); // focus/selection come back only on cancel
          this.options.events?.onCancel?.(dir);
        }
        requestAnimationFrame(() => {
          if (superseded()) return;
          this.options.canvas.classList.remove('is-flipping');
        });
      });
    });
  }

  /* ------------------------- reduced motion / loss ------------------------- */

  private reducedMotion(): boolean {
    if (this.options.prefersReducedMotion) return this.options.prefersReducedMotion();
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private crossfadeNavigate(dir: FlipDirection): void {
    if (this.phase !== 'rest') return;
    this.phase = 'settling';
    this.options.events?.onFlipStart?.(dir);
    void play('page-flip', { volume: 0.6 });
    this.cancelCrossfade = crossfadeSpread({
      container: this.options.root,
      onSwap: () => this.options.navigate(dir),
      onDone: () => {
        this.cancelCrossfade = null;
        this.phase = 'rest';
        this.options.events?.onLanded?.(dir);
      },
    });
  }

  /** GPU reset mid-flip: land instantly on the CSS path (doc RISKS #5). */
  private handleContextLost(): void {
    this.renderer = null; // programs are gone with the context
    if (this.phase === 'rest') return;
    const committed = this.landing; // land() already navigated
    this.landToken++; // the veil owns the landing from here
    this.landing = false;
    this.tween?.kill();
    this.tween = null;
    const dir = this.dir;
    const target: 0 | 1 = this.flip.p > 0.5 ? 1 : 0;
    const leafElement = this.leafElement;
    this.options.canvas.classList.remove('is-flipping');

    const finish = (): void => {
      this.phase = 'rest';
      this.leafElement = null;
      if (target === 1) this.options.events?.onLanded?.(dir);
      else {
        this.restoreSelection();
        this.options.events?.onCancel?.(dir);
      }
    };

    if (committed) {
      // The spread already swapped and its live DOM is painted underneath —
      // nothing to mask, and navigating twice would skip a spread.
      if (leafElement) leafElement.style.visibility = '';
      finish();
      return;
    }

    // Mask the pop with the reduced-motion veil, swap at full cover.
    crossfadeSpread({
      container: this.options.root,
      onSwap: () => {
        if (target === 1) this.options.navigate(dir);
        if (leafElement) leafElement.style.visibility = '';
      },
      onDone: finish,
    });
  }

  private handleContextRestored(): void {
    // Recreate GL resources lazily; if this fails we stay on the CSS path.
    if (this.destroyed || !this.ctx) return;
    try {
      this.renderer = new CurlRenderer(this.ctx);
    } catch {
      this.renderer = null;
    }
  }

  /* ------------------------------- rendering ------------------------------- */

  private requestRender(): void {
    if (this.renderScheduled || !this.renderer) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      if (this.destroyed || this.phase === 'rest' || !this.renderer || !this.rootRect) return;
      this.renderer.render({
        p: this.flip.p,
        baseTilt: this.baseTilt,
        dir: this.dir,
        leafX: this.leaf.x,
        leafY: this.leaf.y,
        leafW: this.leaf.w,
        leafH: this.leaf.h,
        canvasW: this.rootRect.width,
        canvasH: this.rootRect.height,
      });
    });
  }

  /* ---------------------------- selection state ---------------------------- */

  private saveSelection(): void {
    const selection = window.getSelection();
    this.savedRanges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
      : [];
    this.savedActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private restoreSelection(): void {
    if (this.savedActive?.isConnected) this.savedActive.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection && this.savedRanges.length > 0) {
      selection.removeAllRanges();
      for (const range of this.savedRanges) {
        try {
          selection.addRange(range);
        } catch {
          // Range may be invalid if the doc mutated; focus alone is fine.
        }
      }
    }
    this.savedRanges = [];
    this.savedActive = null;
  }
}
