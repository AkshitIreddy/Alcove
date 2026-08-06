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
 *       leaf, show the canvas AND draw its first frame — all in the same
 *       frame (bitmaps are pre-cached so nothing rasterizes here; page
 *       snapshotting is suspended for the duration of the flip)
 *   pointermove → p = clamp mapping, corner grips tilt the fold; direct
 *       proxy writes + one rAF-coalesced GL render per frame
 *   pointerup → tap ⇒ tween p→1 (power2.inOut, 0.45s); drag ⇒ velocity
 *       decision (complete vs cancel), gsap power3.out with
 *       duration clamp(0.55 − 0.1·|v|, 0.25, 0.55), or InertiaPlugin throw
 *       physics when the plugin is registered
 *   pointerdown mid-tween → tween.kill(), resume drag from current p
 *   land() → flat-state swap: draw the end state, commit navigation (p=1) or
 *       restore selection/focus (p=0) under the canvas, reveal the moving leaf
 *       in that same frame, then wait one rAF for the new DOM to paint before
 *       clearing the overlay and one more before hiding the canvas (see
 *       land() for the frame-by-frame, and for why the landing frame has to be
 *       a complete picture of the spread rather than merely a matching one)
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
import { refreshPaperTone } from './paperTone';
import { waitForLandingMedia } from './landingMedia';
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
    // A flip torn down mid-flight never reaches land(), so release the
    // capture hold here or the cache stays frozen for the rest of its life.
    this.options.cache.resume();
    this.fold?.dispose();
    this.fold = null;
    // Leave nothing of the overlay behind: the host may keep the leaves
    // mounted (book stays open, surface remounts) after this controller goes.
    this.options.canvas.classList.remove('is-flipping');
    this.options.root.classList.remove('is-flip-gesture');
    this.options.root.classList.remove('is-flip-landing');
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
    this.renderNow(); // same frame as the leaf hide — see beginFlip
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
    this.options.root.classList.remove('is-flip-landing');

    // No page rasterization from here until the overlay is down: one capture
    // is 200ms+ of main thread and it lands wherever it likes — mid-tween
    // (the turn stutters) or mid-landing (the swap frames stretch out).
    this.options.cache.suspend();

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
    // No text sweeping while the paper is being dragged (see flip.css).
    this.options.root.classList.add('is-flip-gesture');

    /*
     * A PAGE NOBODY HAS RASTERISED YET MUST NOT BE TURNED AS BLANK PAPER.
     *
     * The WebGL curl is fed entirely from the raster cache — `bitmapOf` returns
     * `cache.get(id)?.bitmap ?? null` — and a null texture draws as bare paper.
     * For a page the reader has never visited there is nothing cached, so the
     * sheet curls over showing nothing at all. Turn back and forward again and
     * it is perfect, because by then it has been captured. That is exactly what
     * was reported:
     *
     *   "let's say I am turning to a page I haven't seen before, then it shows
     *    as a blank white page. But after turning it, and then going back and
     *    turning to that page again, the content is there as usual during the
     *    page turn"
     *
     * The warm path is not broken — `ensureAdjacent` queues the neighbours and
     * `whenIdle` carries a 1000ms timeout — it is just not INSTANT, and a
     * reader who turns straight after opening a book beats it. Waiting for the
     * capture here is not an option either: one is 200ms+ of synchronous main
     * thread, which is a stall in the middle of the gesture.
     *
     * So when a texture is missing, this turn takes the rigid CSS fold instead,
     * which needs no snapshot at all — its front face IS the live leaf, with
     * the real words on it. A slightly plainer fold beats a blank page every
     * time, and the reader never learns there were two paths. The missing page
     * is also requested outright rather than left to idle, so the NEXT turn has
     * its bitmap and gets the curl.
     */
    const cachedFor = (id: string | null): ImageBitmap | null =>
      id === null ? null : (this.options.cache.get(id)?.bitmap ?? null);
    const wanted = [pages.front, pages.back, pages.revealed].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const missing = wanted.filter((id) => cachedFor(id) === null);
    if (missing.length > 0) {
      // Not awaited: this turn is already committed to the fold, and the point
      // is to have it ready for the next one.
      for (const id of missing) void this.options.cache.ensure(id);
    }
    /*
     * BOTH BIG FACES, not just the front.
     *
     * This used to require only `front`, on the reasoning that "the other two
     * only matter once it is part-way over, by which time an idle capture has
     * usually landed". Usually is the problem. `revealed` is the PAGE UNDER THE
     * CURL — the thing the reader is turning towards, and the largest area on
     * screen for most of the gesture — and when its bitmap has not landed the
     * shader samples nothing and draws bare paper. The result is a spread that
     * goes completely blank mid-turn and fills in afterwards, which is the
     * defect this whole subsystem has now been through twice.
     *
     * Seen in the README's demo, which turns pages about a second apart: four
     * frames of an empty book between one spread and the next. Not seen by any
     * probe here, because they all measure the DOM — and during a curl the DOM
     * leaves are `visibility: hidden` WITH their text still in them, so a leaf
     * reads as inked while the reader is looking at a blank canvas.
     *
     * `back` is deliberately NOT required: it is the underside of the turning
     * sheet, seen briefly and at a steep angle, and blank paper is what the
     * back of a sheet looks like anyway.
     *
     * The alternative when this says no is not "nothing" — it is the rigid CSS
     * fold, whose faces are the live leaves, so it always has the real words on
     * it. A plainer turn beats a blank one.
     */
    const faceReady = (id: string | null): boolean =>
      id === null || cachedFor(id) !== null;
    const canCurl = faceReady(pages.front) && faceReady(pages.revealed);

    if (this.usesWebGL && this.ctx && this.renderer && canCurl) {
      // What colour is blank paper today? The reader may have changed theme
      // since the last turn, and `--paper-cream` is a theme token — the shader
      // bakes it in, so this has to happen BEFORE anything is drawn or the
      // page turns parchment for the length of the flip (see paperTone.ts).
      refreshPaperTone();
      this.renderer.setPaperCream();
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
      // Draw the resting frame NOW, in the same task that hides the leaf.
      // requestRender() would only paint on the NEXT rAF, and for that one
      // frame the leaf is hidden with an empty canvas over it: the page
      // blinks out at the start of every flip, which is most of what made a
      // click-to-turn feel like it jumped rather than moved.
      leafElement.style.visibility = 'hidden'; // keeps layout
      this.options.canvas.classList.add('is-flipping');
      this.renderNow();
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
      // Draw inside GSAP's own tick rather than queueing another rAF: a
      // queued render always paints the PREVIOUS tick's value, so the whole
      // settle ran a frame behind the tween. Pointer moves stay coalesced
      // (they can fire more than once per frame); a tween cannot.
      onUpdate: () => this.renderNow(),
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
   * p∈{0,1}, so we commit/restore the live DOM under the canvas, let it
   * paint, then wipe and hide the overlay — raster→DOM is pixel-identical.
   *
   * FRAME ORDER (this is the whole trick, and it used to cost a frame more
   * than it needed to):
   *
   *   frame N  — we are inside a rAF callback (GSAP's ticker drives the
   *              tween, so onComplete lands here). Draw the p=target frame
   *              synchronously, THEN commit navigation, THEN drop the moving
   *              leaf's `visibility: hidden`. Raster, new DOM and the leaf's
   *              own fore-edge hairlines are therefore all painted at the end
   *              of this same frame, one exactly on top of the other.
   *   frame N+1 — once destination images are decoded, the new DOM is on
   *              screen (under the canvas) and proven painted. Clear the GL
   *              colour buffer.
   *   frame N+2 — display:none the canvas.
   *
   * FRAME N IS THE ONE THAT HAS TO BE RIGHT ON ITS OWN, and that is a stronger
   * requirement than "the swap is seamless". A landing is the busiest moment in
   * the app, so frames N+1 and N+2 can be starved for hundreds of milliseconds
   * (218–665ms long tasks, measured) and the reader sits on frame N for all of
   * it. Everything the settled spread wears, frame N must already wear: the
   * page textures (this method's renderNow), the gutter band and the dog-ear
   * (spread.css lifts them over the canvas for this flat landing only) and the
   * page-stack hairlines (the reveal below). Anything left for N+1 is not a
   * frame late — it is half a second late, and it reads as the page loading its
   * shading after it lands.
   *
   * It used to wait two rAFs before the clear, which held a stale raster over
   * the already-committed spread for an extra frame; with the main thread
   * busy (a page capture used to be able to land right here) that frame
   * stretched into hundreds of milliseconds and read as a second flip
   * flickering over unchanged pages. Suspending captures for the whole
   * landing keeps these frames short, and the render before navigate() means
   * frame N can never show a half-updated overlay.
   *
   * The wipe and the hide stay DELIBERATELY on different frames. `display:
   * none` pulls the canvas out of compositing, so a gl.clear() issued in the
   * same frame is never presented: the layer keeps the last curl frame, and
   * that ghost sheet flashes back the next time the canvas is shown.
   */
  private land(target: 0 | 1): void {
    if (this.landing) return; // a landing is already in flight
    this.landing = true;
    const token = ++this.landToken;
    this.tween = null;
    this.flip.p = target;
    const dir = this.dir;
    const leafElement = this.leafElement;

    // Selection is drag-and-drop-able again from here; restoreSelection()
    // below also needs the surface selectable to put a cancelled flip back.
    this.options.root.classList.remove('is-flip-gesture');

    if (this.fold) {
      this.fold.dispose();
      this.fold = null;
    }

    // Pin the overlay to the exact end state before the DOM changes beneath
    // it. A queued render would arrive a frame late, i.e. after navigation.
    this.renderNow();

    // The real gutter and dog-ear belong above the FLAT landing frame, but not
    // above the moving curl: a straight DOM band across a bending sheet reads
    // as a rendering tear. This class lasts through the clear/hide handoff and
    // changes nothing about the settled spread.
    this.options.root.classList.add('is-flip-landing');

    if (target === 1) {
      // Drop the live selection BEFORE the swap. Its endpoints sit in the
      // spread that is about to be unmounted, and a range whose container is
      // removed does not vanish — the browser reparents the boundary onto the
      // surviving ancestor, which leaves it spanning the entire new leaf. That
      // is what made a turn arrive with every word on the page highlighted.
      // The saved ranges are clones, so a cancelled flip can still restore.
      this.clearSelection();
      this.options.navigate(dir); // new spread mounts under the canvas
    }

    /*
     * THE MOVING LEAF COMES BACK NOW, IN THE FRAME THAT SWAPPED — not in the
     * rAF below, and not on both branches at different times.
     *
     * A cancelled flip has always revealed it here; a completed one waited for
     * frame N+1, and the asymmetry was costing the landing a piece of its
     * shading. `visibility: hidden` on the leaf wrapper takes its
     * `.nb-leaf-paper` box-shadow with it — the five offset hairlines that draw
     * the fore-edges of the pages beneath (see the leaf rules above) — and
     * those paint OUTSIDE the leaf's border box, which is to say outside the
     * canvas, which is to say the overlay cannot draw them back. So for every
     * frame between the swap and rAF #1 the new page stood there with no page
     * stack down its outer edge, and `probe-landing-effects.mjs` duly reported
     * `right.paperVis` moving hidden → visible 26–48ms after the DOM was
     * already correct. On a starved landing that is the same half second as
     * everything else.
     *
     * Safe to do under the overlay because the overlay is opaque exactly where
     * this leaf is: the ground pass writes `vec4(color, 1.0)` over the moving
     * leaf's whole rect at every p (curl.ts), and at p=1 the curl mesh covers
     * the other leaf's rect as well. Nothing of the live DOM reaches the glass
     * a frame early — only the hairlines just outside it, which is the point.
     */
    if (leafElement) leafElement.style.visibility = '';

    // A newer flip (or destroy / context loss) bumps landToken and owns the
    // overlay from that moment; these frames must then do nothing.
    const superseded = (): boolean => this.destroyed || this.landToken !== token;

    // Navigation mounts image elements synchronously, but decoding their new
    // sources can finish one paint later. The flat raster already contains
    // those pictures, so keep it as the veil until the live replacements can
    // paint. Image-free landings still take exactly the old one-rAF path.
    void waitForLandingMedia(this.options.root).then(() => {
      if (superseded()) return;
      requestAnimationFrame(() => {
        if (superseded()) return;
        // The live DOM committed above has now been painted once beneath the
        // canvas, so the overlay can go without a visible pop.
        this.renderer?.clear();
        // Belt and braces: the reveal happened in frame N, but a host that
        // recycles the wrapper (or a re-entrant landing) must never be left
        // holding an inline `hidden`.
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
          this.options.root.classList.remove('is-flip-landing');
          // Snapshots may run again — the overlay is down and the new spread's
          // neighbours are the next thing worth rasterizing.
          this.options.cache.resume();
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
      onSwap: () => {
        this.clearSelection(); // same reparenting trap as land() — see there
        this.options.navigate(dir);
      },
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
    this.options.root.classList.remove('is-flip-gesture');
    this.options.root.classList.remove('is-flip-landing');

    const finish = (): void => {
      this.phase = 'rest';
      this.leafElement = null;
      this.options.cache.resume(); // the overlay is gone; snapshots may run
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
        if (target === 1) {
          this.clearSelection(); // see land()
          this.options.navigate(dir);
        }
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
      if (this.phase === 'rest') return; // landing owns the overlay now
      this.renderNow();
    });
  }

  /**
   * Draw immediately, inside the current task. Used where the overlay becomes
   * visible (or must match the DOM) in this very frame — a queued rAF render
   * would leave one frame of empty canvas over a hidden leaf.
   */
  private renderNow(): void {
    if (this.destroyed || !this.renderer || !this.rootRect) return;
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

  /** Collapse the document selection (the pages it addressed are leaving). */
  private clearSelection(): void {
    window.getSelection()?.removeAllRanges();
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
