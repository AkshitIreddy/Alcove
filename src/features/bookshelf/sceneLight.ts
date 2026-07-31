/**
 * features/bookshelf/sceneLight.ts — the shelf, lit by one light.
 *
 * `src/render/` builds a deferred lighting pass: elements emit **albedo only**,
 * a half-resolution height field says what shape everything is, and a single
 * fullscreen shader applies key, fill, ambient occlusion, contact shadows, rim,
 * temperature split, bloom, vignette and grade over the composed frame. This
 * module is the shelf's half of that contract: it owns the height field, keeps
 * it aligned with the camera, and hangs the filter on the world container.
 *
 * ## Why the shelf needs it
 *
 * Every spine used to shade itself at bake time. A hundred books each lit by
 * their own private sun average out to no light at all — which is exactly what
 * the flat, pastel shelf in the review screenshots looked like, and exactly
 * what `docs/design/painted-rendering.md` says a painted scene cannot do. The
 * reference image's richness is raking light across a whole row: one direction,
 * one falloff, near-black between the books and hot gold on the edges facing
 * the window. That can only come from a pass that sees the whole picture.
 *
 * ## What is emitted
 *
 * Screen-space, once per changed frame, back to front:
 *
 * | element      | profile           | why                                    |
 * |--------------|-------------------|----------------------------------------|
 * | back panel   | `plane`, recessed | the recess the books sit inside        |
 * | side rails   | `roundedBox`      | the case frame, standing proud         |
 * | shelf plank  | `bevel`           | its front lip catches the key and casts |
 * | cornice      | `bevel`           | the overhang above floor 0             |
 * | each spine   | `roundedBox` + lean | the roll that makes a row read round |
 *
 * Nothing else: flora, plaques and props ride on whatever the surface under
 * them is doing, which is both cheaper and more correct than giving a painted
 * leaf its own geometry.
 *
 * ## Cost
 *
 * The buffer is half resolution and only repainted when the camera or the
 * composition actually changed. `emitHeight` memoizes one raster per distinct
 * profile, so a shelf of two hundred books draws two hundred `drawImage`s of a
 * handful of cached canvases — measured well inside a frame. The lighting
 * itself is one fullscreen pass, independent of book count.
 *
 * ## Failure is always "unlit", never "broken"
 *
 * WebGPU (no GLSL twin), a renderer that will not compile the program, or
 * `?scenelight=0` all end with `enabled === false` and the world drawing its
 * plain albedo — which is precisely what it did before this file existed.
 */

import { Rectangle, type Container, type Renderer } from 'pixi.js';

import type { LightRig } from '../../art/lighting';
import { SHELF_DEFAULT_RIG } from './lightRig';
import {
  CanvasNormalBuffer,
  DeferredLightingFilter,
  emitHeight,
  isDeferredLightingSupported,
  type HeightShape,
  type LightingQuality,
} from '../../render';
import { BOOK_ZONE_H, CROWN_H, CROWN_LIP, FLOOR_H, RAIL_W, SHELF_WIDTH } from './constants';

export { rigForTheme, SHELF_DEFAULT_RIG } from './lightRig';

/* ========================================================================== *
 *                              scene description                             *
 * ========================================================================== */

/** One spine's geometry, in WORLD coordinates. */
export interface LitSpine {
  /** Centre of the spine on its floor. */
  centerX: number;
  /** Absolute world y of the spine's foot (it stands on the plank). */
  baseY: number;
  w: number;
  h: number;
  /** Lean in radians (the compositor's rotation about the foot). */
  lean: number;
  /**
   * How far the book stands proud of the shelf front, world px. Positive
   * pulls it toward the viewer (a brighter face, a longer contact shadow);
   * negative sinks it into the recess.
   */
  proud: number;
}

/** One mounted floor, in WORLD coordinates. */
export interface LitFloor {
  /** Absolute world y of the floor's top. */
  y: number;
  spines: readonly LitSpine[];
}

export interface LitScene {
  cameraX: number;
  cameraY: number;
  zoom: number;
  viewportW: number;
  viewportH: number;
  floors: readonly LitFloor[];
  /** Draw the cornice's height (only true when floor 0 is mounted). */
  crown: boolean;
}

/* ========================================================================== *
 *                                  profiles                                  *
 * ========================================================================== */

/**
 * Quantize a number onto a grid.
 *
 * `shapeKey` folds every profile parameter AND the raster size into its cache
 * key, so passing raw per-book values would mint a fresh raster for every
 * book — hundreds of canvases for a difference no one can see. Rounding lean
 * to a fiftieth of a radian and sizes to four pixels collapses a whole shelf
 * onto a handful of profiles.
 */
function q(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * The back of the case: flat, and set back from everything on it — but well
 * clear of the WALL, which is height 0. The case is furniture standing in a
 * room, so it has to occlude and cast onto the wall behind it; at the old 0.06
 * the whole bookcase was practically flush with the plaster.
 */
const BACK_PANEL: HeightShape = { kind: 'plane', height: 0.16 };

/**
 * The plank's front edge — a dark board with ONE hot arris along its top.
 *
 * This profile is the app's clearest hierarchy control. A four-sided bevel
 * (what this was) turns the whole 40px strip into a surface angled toward a
 * raking key, so every plank in the frame lit up gold along its entire length
 * and the shelf fronts became the brightest thing in the picture — above the
 * books they are supposed to be framing. The reference does the opposite: its
 * shelf fronts are dark boards, and only the top few pixels of the lip catch
 * the sun. So: bevel the top only, keep the face flat and facing the viewer
 * (which a low key barely reaches), and let the arris be the highlight.
 */
const PLANK: HeightShape = {
  kind: 'bevel',
  size: 0.3,
  height: 0.5,
  edgeHeight: 0.34,
  edges: { top: true },
  round: 0.75,
};

/** The cornice: a deeper plateau, it overhangs. Same top-only lit lip. */
const CROWN: HeightShape = {
  kind: 'bevel',
  size: 0.24,
  height: 0.78,
  edgeHeight: 0.52,
  edges: { top: true, bottom: true },
  round: 0.6,
};

/** A side rail: a tall rounded column standing off the back panel. */
const RAIL: HeightShape = { kind: 'roundedBox', axis: 'x', radius: 0.3, height: 0.6 };

/** The spine profile, per book (radius and lean vary). */
function spineShape(lean: number, radius: number, height: number): HeightShape {
  return {
    kind: 'roundedBox',
    axis: 'x',
    radius: q(radius, 0.04),
    height: q(height, 0.05),
    edgeHeight: q(height * 0.55, 0.05),
    crossRadius: 0.05,
    lean: q(lean, 0.02),
  };
}

/* ========================================================================== *
 *                                 the pass                                   *
 * ========================================================================== */

function flagOff(name: string): boolean {
  if (typeof location === 'undefined') return false;
  return new RegExp(`[?&]${name}=0`).test(location.search);
}

export interface SceneLightOptions {
  /** Half-res by default; drop to 0.35 on a weak GPU. */
  resolution?: number;
  quality?: LightingQuality;
}

export class SceneLight {
  private buffer: CanvasNormalBuffer | null = null;
  private filter: DeferredLightingFilter | null = null;
  private target: Container | null = null;
  private vpW = 1;
  private vpH = 1;
  /** Signature of the last painted scene — repaint only when it changes. */
  private lastSig = '';
  private destroyed = false;

  readonly enabled: boolean;

  constructor(renderer: Renderer | null, opts: SceneLightOptions = {}) {
    this.enabled = !flagOff('scenelight') && isDeferredLightingSupported(renderer);
    if (!this.enabled) return;
    this.buffer = new CanvasNormalBuffer({
      width: 1,
      height: 1,
      resolution: opts.resolution ?? 0.5,
    });
    this.filter = new DeferredLightingFilter({
      rig: SHELF_DEFAULT_RIG,
      normals: this.buffer,
      quality: opts.quality ?? 'medium',
      sceneWidth: 1,
      sceneHeight: 1,
    });
  }

  /** Hang the pass on the world container. Safe to call once. */
  attach(target: Container): void {
    if (!this.enabled || this.filter === null || this.destroyed) return;
    this.target = target;
    target.filters = [this.filter];
  }

  /** Take the pass back off (degrade mode, teardown). */
  detach(): void {
    if (this.target !== null) this.target.filters = [];
    this.target = null;
  }

  setRig(rig: LightRig): void {
    this.filter?.setRig(rig);
  }

  /** Seconds, for drifting shafts and any animated light. */
  setTime(seconds: number): void {
    this.filter?.setTime(seconds);
  }

  resize(width: number, height: number): void {
    if (!this.enabled || this.buffer === null || this.filter === null) return;
    this.vpW = Math.max(1, Math.round(width));
    this.vpH = Math.max(1, Math.round(height));
    this.buffer.resize(this.vpW, this.vpH);
    this.filter.setSceneSize(this.vpW, this.vpH);
    this.lastSig = '';
  }

  /**
   * Repaint the height field for this frame, and keep the filter's area
   * pinned to the viewport in world coordinates.
   *
   * Pixi transforms `filterArea` by the container's world transform, so the
   * rect handed over is in WORLD units — get that wrong and the pass either
   * renders the entire endless shelf into one texture or clips the frame.
   */
  update(scene: LitScene): void {
    if (!this.enabled || this.buffer === null || this.filter === null || this.destroyed) return;
    if (scene.viewportW !== this.vpW || scene.viewportH !== this.vpH) {
      this.resize(scene.viewportW, scene.viewportH);
    }
    // The pass hangs on the SCREEN-SPACE scene container (`world.ts` puts the
    // wall, the wall lighting, the camera-transformed case and the lamp pools
    // inside it), so the filter area is the viewport, full stop. It used to
    // hang on the camera-transformed `world`, where Pixi transforms the rect
    // by the container's world matrix and the area therefore had to be given
    // in world units — get that wrong there and the pass rendered the entire
    // endless shelf into one texture.
    if (this.target !== null) {
      this.target.filterArea = new Rectangle(0, 0, scene.viewportW, scene.viewportH);
    }

    const sig = signature(scene);
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    const buffer = this.buffer;
    const ctx = buffer.ctx;
    buffer.reset();

    const z = scene.zoom;
    const sx = (wx: number): number => (wx - scene.cameraX) * z;
    const sy = (wy: number): number => (wy - scene.cameraY) * z;

    const caseL = sx(0);
    const caseW = SHELF_WIDTH * z;

    for (const floor of scene.floors) {
      const top = sy(floor.y);
      // 1. The recess the books stand in.
      emitHeight(ctx, BACK_PANEL, {
        x: caseL,
        y: top,
        width: caseW,
        height: BOOK_ZONE_H * z,
      });
      // 2. The plank, and its chamfered front lip.
      emitHeight(ctx, PLANK, {
        x: caseL,
        y: sy(floor.y + BOOK_ZONE_H),
        width: caseW,
        height: (FLOOR_H - BOOK_ZONE_H) * z,
      });
      // 3. The case frame. Drawn after the panel so the rails stand on it.
      for (const rx of [0, SHELF_WIDTH - RAIL_W]) {
        emitHeight(ctx, RAIL, {
          x: sx(rx),
          y: top,
          width: RAIL_W * z,
          height: FLOOR_H * z,
        });
      }
      // 4. The books.
      for (const spine of floor.spines) {
        const w = spine.w * z;
        const h = spine.h * z;
        if (w < 1.5 || h < 1.5) continue;
        // A book that stands proud is BOTH taller in the height field and
        // lifted off the back plane; one without the other reads as a decal.
        const proud = Math.max(-0.18, Math.min(0.22, spine.proud / 48));
        emitHeight(ctx, spineShape(spine.lean, radiusFor(spine.w), 0.62 + proud), {
          x: sx(spine.centerX - spine.w / 2),
          y: sy(spine.baseY - spine.h),
          width: w,
          height: h,
          rotation: spine.lean,
          heightOffset: proud * 0.5,
        });
      }
    }

    // 5. The cornice, over everything, overhanging both sides.
    if (scene.crown) {
      emitHeight(ctx, CROWN, {
        x: sx(-CROWN_LIP),
        y: sy(-CROWN_H),
        width: (SHELF_WIDTH + CROWN_LIP * 2) * z,
        height: CROWN_H * z,
      });
    }

    buffer.flush();
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
    this.filter?.destroy();
    this.filter = null;
    this.buffer?.destroy();
    this.buffer = null;
  }
}

/**
 * A thicker book rolls over a smaller FRACTION of its width — the physical
 * radius of the joint is roughly constant, so a 46px folio's shoulder is a
 * smaller share of its face than a 28px duodecimo's.
 */
function radiusFor(widthWorldPx: number): number {
  return Math.max(0.12, Math.min(0.34, 8 / Math.max(8, widthWorldPx)));
}

/**
 * Cheap identity for a painted frame.
 *
 * Repainting the height field costs a few hundred `drawImage`s and a texture
 * upload; doing it on a frame where nothing moved is pure waste, and the shelf
 * renders continuously (motes, hover springs, momentum). Quantized so that a
 * sub-pixel camera drift does not force a repaint the eye could not see.
 */
function signature(scene: LitScene): string {
  const parts: (string | number)[] = [
    Math.round(scene.cameraX * 2),
    Math.round(scene.cameraY * 2),
    Math.round(scene.zoom * 400),
    scene.viewportW,
    scene.viewportH,
    scene.crown ? 1 : 0,
    scene.floors.length,
  ];
  for (const floor of scene.floors) {
    parts.push(Math.round(floor.y), floor.spines.length);
    for (const s of floor.spines) {
      parts.push(
        Math.round(s.centerX),
        Math.round(s.baseY),
        Math.round(s.w),
        Math.round(s.h),
        Math.round(s.lean * 50),
      );
    }
  }
  return parts.join(',');
}
