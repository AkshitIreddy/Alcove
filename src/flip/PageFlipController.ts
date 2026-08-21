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
 *   pointerup → tap ⇒ tween p→1 (power3.out, 0.45s); drag ⇒ velocity
 *       decision (complete vs cancel), gsap power3.out with
 *       duration clamp(0.55 − 0.1·|v|, 0.25, 0.55), or InertiaPlugin throw
 *       physics when the plugin is registered
 *   pointerdown mid-tween → tween.kill(), resume drag from current p
 *   land() → atomic flat-state swap: synchronously commit navigation (p=1),
 *       reveal the exact live destination and remove the moving canvas in one
 *       task; after its first paint opportunity resume snapshot work and emit
 *       the landed event. A cancelled turn simply reveals its original leaf.
 *
 * Fallbacks: WebGL unavailable → rigid CSS 3D fold (same gesture math);
 * context loss mid-flip → instant land via a crossfade veil; reduced motion
 * → 160ms crossfade, no curl.
 */

import { gsap } from 'gsap';
import { CurlRenderer } from './curl';
import { createFlipContext, type FlipContext } from './gl';
import { createRigidFold, crossfadeSpread, type RigidFoldHandle } from './cssFallback';
import { refreshPaperTone } from './paperTone';
import { waitForLandingMedia } from './landingMedia';
import type { PageRasterCache } from './rasterCache';
import { FlipReadinessGate, flipStartPath } from './readiness';
import {
  FLIP_SCENE_OVERSCAN_PX,
  FLIP_CORNER_OVERSCAN_HEIGHT_FRAC,
  readFlipSnapshotSceneStyle,
  type FlipSnapshotSceneIds,
} from './scene';
import {
  TAP_FLIP_DURATION_S,
  clamp01,
  decideFlipTarget,
  dragToP,
  flipDuration,
  foldTilt,
  hitTestHotspot,
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

/** Compatibility name for the complete four-page snapshot scene contract. */
export interface FlipPages extends FlipSnapshotSceneIds {}

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

type Phase = 'rest' | 'preparing' | 'dragging' | 'settling';

interface LeafGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SceneGeometry {
  rootW: number;
  rootH: number;
  left: LeafGeometry;
  right: LeafGeometry;
  moving: LeafGeometry;
}

const UNIT_LEAF: LeafGeometry = { x: 0, y: 0, w: 1, h: 1 };

/**
 * `getBoundingClientRect()` is in post-transform screen pixels. The flip
 * canvas, however, is absolutely positioned inside the spread and its CSS
 * width/height are in the spread's PRE-transform coordinate space. The book
 * is routinely scaled by `--nb-spread-fit` (and by focus zoom), so feeding a
 * bounding rect straight to WebGL shifts every sheet toward the canvas origin
 * and makes it snap back when the live DOM takes ownership at landing.
 *
 * Recover the root's local CSS box, then invert its axis scale for both leaf
 * rects. Translation cancels through the root-relative subtraction. Leaves
 * themselves are not transformed, so this is the exact DOM-local rectangle
 * the absolutely-positioned canvas overlays.
 */
function measureSceneGeometry(
  root: HTMLElement,
  leftElement: HTMLElement | null,
  rightElement: HTMLElement | null,
  movingSide: LeafSide,
): SceneGeometry {
  const rootRect = root.getBoundingClientRect();
  const rootStyle = getComputedStyle(root);
  const cssWidth = Number.parseFloat(rootStyle.width);
  const cssHeight = Number.parseFloat(rootStyle.height);
  const rootW = Number.isFinite(cssWidth) && cssWidth > 0
    ? cssWidth
    : Math.max(root.clientWidth, rootRect.width, 1);
  const rootH = Number.isFinite(cssHeight) && cssHeight > 0
    ? cssHeight
    : Math.max(root.clientHeight, rootRect.height, 1);
  const scaleX = rootRect.width > 0 ? rootRect.width / rootW : 1;
  const scaleY = rootRect.height > 0 ? rootRect.height / rootH : 1;

  const localRect = (element: HTMLElement | null): LeafGeometry | null => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: (rect.left - rootRect.left) / scaleX,
      y: (rect.top - rootRect.top) / scaleY,
      w: Math.max(rect.width / scaleX, 1),
      h: Math.max(rect.height / scaleY, 1),
    };
  };

  const measuredLeft = localRect(leftElement);
  const measuredRight = localRect(rightElement);
  const measuredMoving = movingSide === 'left' ? measuredLeft : measuredRight;
  const moving = measuredMoving ?? UNIT_LEAF;
  // Both wrappers are mounted in FlipSurface, including the empty first-page
  // left wrapper. These mirrored fallbacks are only for a torn-down/zero-size
  // host and keep the renderer finite while the normal exact path disappears.
  const left = measuredLeft ?? {
    x: movingSide === 'right' ? moving.x - moving.w : moving.x,
    y: moving.y,
    w: moving.w,
    h: moving.h,
  };
  const right = measuredRight ?? {
    x: movingSide === 'left' ? moving.x + moving.w : moving.x,
    y: moving.y,
    w: moving.w,
    h: moving.h,
  };

  return { rootW, rootH, left, right, moving };
}

const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 300;
/** Never hold the cheaper raster endpoint on screen for a broken/lazy image. */
const LANDING_MEDIA_CAP_MS = 96;

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
  /** Pointer-up navigation for the explicit reduced-motion path only. */
  private reducedPendingDir: FlipDirection | null = null;
  private preparing:
    | {
        readonly dir: FlipDirection;
        readonly grip: FlipGrip;
        readonly sceneKey: string;
        released: boolean;
        ready: boolean;
      }
    | null = null;
  private readonly readiness: FlipReadinessGate<FlipPages>;

  /** Absolute post-transform screen rect used only for pointer gesture math. */
  private pointerLeaf: LeafGeometry = { ...UNIT_LEAF };
  /** Untransformed CSS geometry used only by the local WebGL scene. */
  private scene: SceneGeometry | null = null;
  /** Symmetric canvas room for flat fore-edges (x) and lifted curl (y). */
  private sceneOverscan = {
    x: FLIP_SCENE_OVERSCAN_PX,
    y: FLIP_SCENE_OVERSCAN_PX,
  };

  private tween: gsap.core.Tween | null = null;
  private fold: RigidFoldHandle | null = null;
  private cancelCrossfade: (() => void) | null = null;
  private renderScheduled = false;
  private destroyed = false;

  /**
   * Landing bookkeeping. `landing` is true from the DOM commit until the
   * exact live destination has painted — a re-grab in that window would drive
   * against an already-swapped spread.
   * `landToken` invalidates queued frames the instant a new flip (or a destroy
   * / context loss) takes over, so stale work can never rip the canvas away
   * mid-gesture.
   */
  private landing = false;
  /** True only after a completed landing has actually committed navigation. */
  private landingCommitted = false;
  private landToken = 0;

  private ctx: FlipContext | null = null;
  private renderer: CurlRenderer | null = null;

  private savedRanges: Range[] = [];
  private savedActive: HTMLElement | null = null;

  constructor(private readonly options: PageFlipControllerOptions) {
    this.readiness = new FlipReadinessGate<FlipPages>({
      ensure: (pageId) => this.options.cache.ensure(pageId),
      sceneKeyNow: () => {
        const pending = this.preparing;
        if (pending === null) return null;
        const pages = this.options.getFlipPages(pending.dir);
        return pages === null ? null : this.flipPagesKey(pages);
      },
      isReady: (pages) => this.curlFacesReady(pages, false),
      // Custom node views can finish intrinsic layout immediately after their
      // first capture. Give those mutations two paint boundaries to settle
      // before asking for the next transaction-valid bitmap.
      scheduleRetry: (run) => requestAnimationFrame(() => requestAnimationFrame(run)),
      maxPasses: 4,
    });
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

  /** Programmatic forward flip (the UI turns pages through pointer hotspots). */
  flipNext(): void {
    this.programmaticFlip('next');
  }

  /** Programmatic backward flip (the UI turns pages through pointer hotspots). */
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
    this.landingCommitted = false;
    this.tween?.kill();
    this.tween = null;
    this.cancelCrossfade?.();
    this.cancelPreparation();
    // A flip torn down mid-flight never reaches land(), so release the
    // capture hold here or the cache stays frozen for the rest of its life.
    this.options.cache.resume();
    this.fold?.dispose();
    this.fold = null;
    // Leave nothing of the overlay behind: the host may keep the leaves
    // mounted (book stays open, surface remounts) after this controller goes.
    this.options.canvas.classList.remove('is-flipping');
    this.options.canvas.classList.remove('is-flip-releasing');
    this.options.root.classList.remove('is-flip-gesture');
    this.revealLiveLeaves();
    this.options.root.classList.remove('is-flip-scene');
    this.revealLiveLeaves();
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
    const pages = this.options.getFlipPages(hit.dir);
    if (!pages) return;

    const path = flipStartPath(
      this.reducedMotion(),
      this.usesWebGL,
      this.curlFacesReady(pages, false),
    );
    if (path === 'crossfade') {
      this.reducedPendingDir = hit.dir;
      this.capturePointer(event);
      return;
    }
    if (path === 'prepare') {
      this.capturePointer(event);
      this.beginPreparation(hit.dir, hit.grip, pages, false);
      return;
    }
    this.beginGesture(hit.dir, hit.grip, event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.phase !== 'dragging' || event.pointerId !== this.pointerId) return;
    const local = this.toLeafLocal(event.clientX, event.clientY);
    const p = dragToP(local.x, this.pointerLeaf.w);
    this.baseTilt = foldTilt(this.grip, local.y / this.pointerLeaf.h);

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
    if (this.preparing !== null) {
      this.preparing.released = true;
      this.startPreparedFlipIfReady();
      return;
    }
    if (this.phase !== 'dragging') return;

    const isTap =
      Math.abs(event.clientX - this.downX) < TAP_SLOP_PX &&
      Math.abs(event.clientY - this.downY) < TAP_SLOP_PX &&
      event.timeStamp - this.downTime < TAP_MAX_MS;

    if (isTap) {
      /*
       * A tap begins from a still page, so an ease-in/out spends its slow tail
       * straightening the already-flat destination: the paper appears landed
       * while cards and headings still creep the last 6–15px into place. The
       * drag path has always used power3.out for exactly this handoff. Give a
       * tap the same fast-out landing so its residual motion happens while the
       * page is visibly turning, not as an afterthought on the final frames.
       */
      this.settle(1, TAP_FLIP_DURATION_S, 'power3.out', null);
      return;
    }

    const v = this.velocity;
    const target = decideFlipTarget(this.flip.p, v);
    this.settle(target, flipDuration(v), 'power3.out', v);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.reducedPendingDir = null;
    if (this.preparing !== null) {
      this.cancelPreparation();
      return;
    }
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
    const x =
      this.dir === 'next'
        ? clientX - this.pointerLeaf.x
        : this.pointerLeaf.x + this.pointerLeaf.w - clientX;
    return {
      x,
      y:
        clamp01((clientY - this.pointerLeaf.y) / this.pointerLeaf.h) *
        this.pointerLeaf.h,
    };
  }

  /* ------------------------------ flip phases ------------------------------ */

  private beginGesture(dir: FlipDirection, grip: FlipGrip, event: PointerEvent): boolean {
    if (!this.beginFlip(dir, grip)) return false;
    this.capturePointer(event);
    this.downX = event.clientX;
    this.downY = event.clientY;
    this.downTime = event.timeStamp;
    const local = this.toLeafLocal(event.clientX, event.clientY);
    this.flip.p = dragToP(local.x, this.pointerLeaf.w);
    this.lastP = this.flip.p;
    this.lastMoveTime = event.timeStamp;
    this.velocity = 0;
    this.renderNow(); // same frame as the leaf hide — see beginFlip
    return true;
  }

  /**
   * A GPU turn begins only when its complete scene exists. A missing opposite
   * page, backside or revealed page is not allowed to degrade into cream: that
   * is exactly the late-arriving destination state this contract removes.
   */
  private curlFacesReady(pages: FlipPages, warmMissing: boolean): boolean {
    const ids = [pages.front, pages.back, pages.revealed].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    const missing = ids.filter((id) => this.options.cache.getUsable(id)?.bitmap == null);
    if (warmMissing) {
      for (const id of missing) void this.options.cache.ensure(id);
    }
    return missing.length === 0;
  }

  private flipPagesKey(pages: FlipPages): string {
    return [pages.stationary, pages.front, pages.back, pages.revealed]
      .map((id) => id ?? '-')
      .join('|');
  }

  private curlFaceIds(pages: FlipPages): string[] {
    return [pages.front, pages.back, pages.revealed].filter(
      (id): id is string =>
        typeof id === 'string' &&
        id.length > 0,
    );
  }

  /**
   * Keep a cold turn as a pending ordinary-motion turn.  Capture may take
   * hundreds of milliseconds on image-heavy pages, so it starts at the press,
   * but navigation is withheld until the exact scene has become usable.
   */
  private beginPreparation(
    dir: FlipDirection,
    grip: FlipGrip,
    pages: FlipPages,
    released: boolean,
  ): void {
    this.cancelPreparation();
    const pending = {
      dir,
      grip,
      sceneKey: this.flipPagesKey(pages),
      released,
      ready: false,
    };
    this.preparing = pending;
    this.phase = 'preparing';
    this.options.root.classList.add('is-flip-preparing');
    this.readiness.prepare(
      {
        scene: pages,
        sceneKey: pending.sceneKey,
        // Pass every required face, not only those cold at admission. A node
        // view can invalidate a formerly ready mounted face while a neighbour
        // is being captured; ensure() is a cheap no-op when it stayed fresh
        // and repairs it on the next bounded pass when it did not.
        missingIds: this.curlFaceIds(pages),
      },
      {
        ready: () => {
          if (this.preparing !== pending) return;
          pending.ready = true;
          this.startPreparedFlipIfReady();
        },
        unavailable: () => {
          if (this.preparing !== pending) return;
          // A rejected/failed raster must not leave the controller wedged.
          // Keep the existing safe veil only as the terminal failure path.
          const shouldNavigate = pending.released;
          const failedDir = pending.dir;
          this.cancelPreparation();
          if (shouldNavigate) this.crossfadeNavigate(failedDir);
        },
        stale: () => {
          if (this.preparing !== pending) return;
          this.cancelPreparation();
        },
      },
    );
  }

  private startPreparedFlipIfReady(): void {
    const pending = this.preparing;
    if (pending === null || !pending.released || !pending.ready) return;
    const pages = this.options.getFlipPages(pending.dir);
    if (
      pages === null ||
      this.flipPagesKey(pages) !== pending.sceneKey ||
      !this.curlFacesReady(pages, false)
    ) {
      this.cancelPreparation();
      return;
    }
    const dir = pending.dir;
    const grip = pending.grip;
    this.preparing = null;
    this.options.root.classList.remove('is-flip-preparing');
    this.phase = 'rest';
    if (!this.beginFlip(dir, grip)) return;
    this.settle(1, TAP_FLIP_DURATION_S, 'power3.out', null);
  }

  private cancelPreparation(): void {
    this.readiness?.cancel();
    this.preparing = null;
    this.options.root.classList.remove('is-flip-preparing');
    if (this.phase === 'preparing') this.phase = 'rest';
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
    this.landingCommitted = false;
    this.options.root.classList.remove('is-flip-scene');
    this.options.canvas.classList.remove('is-flip-releasing');

    // No page rasterization from here until the overlay is down: one capture
    // is 200ms+ of main thread and it lands wherever it likes — mid-tween
    // (the turn stutters) or mid-landing (the swap frames stretch out).
    this.options.cache.suspend();

    const rect = leafElement.getBoundingClientRect();
    this.pointerLeaf = {
      x: rect.left,
      y: rect.top,
      w: Math.max(rect.width, 1),
      h: Math.max(rect.height, 1),
    };
    this.scene = measureSceneGeometry(
      this.options.root,
      this.options.getLeafElement('left'),
      this.options.getLeafElement('right'),
      side,
    );
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
     * `cache.getUsable(id)?.bitmap ?? null` — and a null texture draws as bare
     * paper.
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
     * Ordinary cold turns are now held by the tokenized preparation barrier
     * before they reach this method. This local check remains the last guard
     * against a face invalidated in the few instructions between readiness and
     * upload; that rare race takes the rigid fallback rather than blank paper.
     */
    const cachedFor = (id: string | null): ImageBitmap | null =>
      id === null ? null : (this.options.cache.getUsable(id)?.bitmap ?? null);
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
     * All three moving faces are required. A plain underside was once allowed,
     * but it made a prepared curl visibly lose the destination's inner leaf.
     * The alternative when this says no is the rigid fallback, never a blank
     * WebGL texture.
     */
    const faceReady = (id: string | null): boolean =>
      id === null || cachedFor(id) !== null;
    const canCurl =
      faceReady(pages.front) &&
      faceReady(pages.back) &&
      faceReady(pages.revealed);

    if (this.usesWebGL && this.ctx && this.renderer && canCurl) {
      // What colour is blank paper today? The reader may have changed theme
      // since the last turn, and `--paper-cream` is a theme token — the shader
      // bakes it in, so this has to happen BEFORE anything is drawn or the
      // page turns parchment for the length of the flip (see paperTone.ts).
      refreshPaperTone();
      this.renderer.setPaperCream();
      // Only transaction-valid bitmaps. In particular, a mounted leaf cannot
      // curl from the older offscreen reconstruction that warmed it while it
      // was still a neighbour.
      const cache = this.options.cache;
      const bitmapOf = (id: string | null): ImageBitmap | null =>
        id ? (cache.getUsable(id)?.bitmap ?? null) : null;
      this.renderer.setSnapshotScene(
        {
          // The opposite page remains live DOM; this slot is retained only as
          // scene-contract compatibility for older renderer callers.
          stationary: null,
          front: bitmapOf(pages.front),
          back: bitmapOf(pages.back),
          revealed: bitmapOf(pages.revealed),
        },
        readFlipSnapshotSceneStyle(this.options.root),
      );
      /*
       * A tilted corner curl moves vertices along the fold's tangent. Numeric
       * evaluation of the shader at the shipped leaf ratio reaches about 16%
       * of leaf height; 24% leaves room across progress, direction and fit
       * variants. Edge turns retain their source y and need only the base
       * fore-edge/projection room. Settled DOM remains unchanged.
       */
      this.sceneOverscan = {
        x: FLIP_SCENE_OVERSCAN_PX,
        y:
          grip === 'edge'
            ? FLIP_SCENE_OVERSCAN_PX
            : Math.max(
                FLIP_SCENE_OVERSCAN_PX,
                Math.ceil(this.scene.moving.h * FLIP_CORNER_OVERSCAN_HEIGHT_FRAC),
              ),
      };
      this.options.canvas.style.setProperty(
        '--nb-flip-overscan-x',
        `${this.sceneOverscan.x}px`,
      );
      this.options.canvas.style.setProperty(
        '--nb-flip-overscan-y',
        `${this.sceneOverscan.y}px`,
      );
      this.ctx.resize(
        this.scene.rootW + this.sceneOverscan.x * 2,
        this.scene.rootH + this.sceneOverscan.y * 2,
        Math.min(window.devicePixelRatio || 1, 2),
      );
      // Draw the resting frame NOW, in the same task that hides the leaf.
      // requestRender() would only paint on the NEXT rAF, and for that one
      // frame the leaf is hidden with an empty canvas over it: the page
      // blinks out at the start of every flip, which is most of what made a
      // click-to-turn feel like it jumped rather than moved.
      this.hideMovingLeaf(side); // the opposite live page remains its own exact pixels
      this.options.canvas.classList.remove('is-flip-releasing');
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
    const pages = this.options.getFlipPages(dir);
    if (!pages) return;
    const path = flipStartPath(
      this.reducedMotion(),
      this.usesWebGL,
      this.curlFacesReady(pages, false),
    );
    if (path === 'crossfade') {
      this.crossfadeNavigate(dir);
      return;
    }
    if (path === 'prepare') {
      this.beginPreparation(dir, 'edge', pages, true);
      return;
    }
    if (!this.beginFlip(dir, 'edge')) return;
    this.settle(1, TAP_FLIP_DURATION_S, 'power3.out', null);
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
      onUpdate: () => {
        this.renderNow();
      },
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
   * Return the complete snapshot scene to live DOM in one non-blended swap.
   *
   * The destination is mounted under an opaque scene that already contains
   * all four sheets and the binding. Media decode, the submitted endpoint and
   * one browser paint opportunity are awaited; then the scene canvas becomes
   * transparent in the same task that both live leaves become visible. There
   * is no landing-only gutter, edge proxy or opacity crossfade to arrive late.
   */
  private land(target: 0 | 1): void {
    if (this.landing) return;
    this.landing = true;
    this.landingCommitted = false;
    const token = ++this.landToken;
    this.tween = null;
    this.flip.p = target;
    const dir = this.dir;

    this.options.root.classList.remove('is-flip-gesture');
    if (this.fold) {
      this.fold.dispose();
      this.fold = null;
    }

    // Pin the complete scene to its exact endpoint before changing the DOM.
    this.renderNow();

    const superseded = (): boolean => this.destroyed || this.landToken !== token;

    // Mount the real destination in the same animation tick as the final scene
    // draw. It remains opacity-hidden, but is laid out and paintable below.
    if (target === 1) {
      this.clearSelection();
      this.options.navigate(dir);
      this.landingCommitted = true;
    }

    void waitForLandingMedia(this.options.root, LANDING_MEDIA_CAP_MS).then(() => {
      if (superseded()) return;
      const release = (): void => {
        if (superseded()) return;
        // One paint opportunity with destination DOM mounted underneath the
        // complete scene. The following task is the one atomic owner change.
        requestAnimationFrame(() => {
          if (superseded()) return;
          const canvas = this.options.canvas;
          canvas.classList.add('is-flip-releasing');
          this.revealLiveLeaves();

          requestAnimationFrame(() => {
            if (superseded()) return;
            this.renderer?.clear();
            this.phase = 'rest';
            this.landing = false;
            this.landingCommitted = false;
            if (target === 1) {
              this.savedRanges = [];
              this.savedActive = null;
              this.options.events?.onLanded?.(dir);
            } else {
              this.restoreSelection();
              this.options.events?.onCancel?.(dir);
            }

            requestAnimationFrame(() => {
              if (superseded()) return;
              canvas.classList.remove('is-flipping', 'is-flip-releasing');
              this.options.cache.resume();
            });
          });
        });
      };
      if (typeof this.renderer?.afterSubmittedFrame === 'function') {
        this.renderer.afterSubmittedFrame(release);
      } else {
        release();
      }
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
    // Context loss before the atomic live commit needs the veil; loss after
    // the swap must never navigate a second time.
    const committed = this.landingCommitted;
    this.landToken++; // the veil owns the landing from here
    this.landing = false;
    this.landingCommitted = false;
    this.tween?.kill();
    this.tween = null;
    const dir = this.dir;
    const target: 0 | 1 = this.flip.p > 0.5 ? 1 : 0;
    this.options.canvas.classList.remove('is-flipping');
    this.options.canvas.classList.remove('is-flip-releasing');
    this.options.root.classList.remove('is-flip-gesture');

    const finish = (): void => {
      this.phase = 'rest';
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
    if (this.destroyed || !this.renderer || !this.scene) return;
    const { moving, left, right, rootW, rootH } = this.scene;
    const { x: overscanX, y: overscanY } = this.sceneOverscan;
    this.renderer.render({
      p: this.flip.p,
      baseTilt: this.baseTilt,
      dir: this.dir,
      leafX: moving.x + overscanX,
      leafY: moving.y + overscanY,
      leafW: moving.w,
      leafH: moving.h,
      leftX: left.x + overscanX,
      leftY: left.y + overscanY,
      leftW: left.w,
      leftH: left.h,
      rightX: right.x + overscanX,
      rightY: right.y + overscanY,
      rightW: right.w,
      rightH: right.h,
      canvasW: rootW + overscanX * 2,
      canvasH: rootH + overscanY * 2,
    });
  }

  /**
   * Hide both live sheets only after the renderer has a complete scene.
   * Opacity (via CSS), not visibility: Chromium may prepaint the destination
   * underneath, so the final class swap does not ask it to invent the page.
   */
  private hideMovingLeaf(side: LeafSide): void {
    this.options.root.dataset.flipMoving = side;
    this.options.root.classList.add('is-flip-scene');
  }

  /** Atomic counterpart used for landing, cancel, destroy and context loss. */
  private revealLiveLeaves(): void {
    this.options.root.classList.remove('is-flip-scene');
    delete this.options.root.dataset.flipMoving;
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
