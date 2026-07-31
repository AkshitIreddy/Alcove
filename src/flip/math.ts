/**
 * src/flip/math.ts — pure page-flip math, no DOM/GL/GSAP imports.
 *
 * Everything the gesture and renderer need to *decide* lives here so it can
 * be unit-tested in a plain node environment (tests/flip.test.ts):
 * fold-line position, curl radius easing, gesture→p mapping, corner fold
 * tilt, which page lands on which face of the moving sheet, release-velocity
 * decision, tween duration, snapshot pixel-ratio cap, sound-volume scaling
 * and the LRU used by the raster cache.
 *
 * Conventions
 * - `p ∈ [0,1]` is flip progress (0 = page at rest, 1 = fully flipped).
 * - Leaf-local coords: x ∈ [0, W] measured from the spine (gutter) toward
 *   the leaf's outer edge, y ∈ [0, H] top → bottom. The controller mirrors
 *   pointer x for the left leaf so both directions share one code path.
 * - Velocity `v` is measured in leaf-widths per second along +p.
 */

export type FlipDirection = 'next' | 'prev';

/** What the user grabbed: the vertical edge strip, or a corner. */
export type FlipGrip = 'edge' | 'corner-top' | 'corner-bottom';

/* ----------------------------------------------------------------------------
   Tunables (single source of truth — controller/shader read these)
   -------------------------------------------------------------------------- */

/** Width of the edge hotspot strip, CSS px (design doc: ~48px). */
export const HOTSPOT_STRIP_PX = 48;

/** Square corner hotspot size, CSS px. */
export const HOTSPOT_CORNER_PX = 72;

/** Release speed (leaf-widths/s) beyond which velocity wins over position. */
export const VELOCITY_COMPLETE_THRESHOLD = 0.5;

/** Max fold-line tilt for corner grips, radians (~22.5°). */
export const MAX_FOLD_TILT = Math.PI / 8;

/** Radius easing endpoints from the doc: mix(0.4W, 0.15W, sin(p·π)). */
export const RADIUS_MAX_FRAC = 0.4;
export const RADIUS_MIN_FRAC = 0.15;

/** LRU capacity for cached page bitmaps (doc: 6). */
export const RASTER_CACHE_CAPACITY = 6;

/** Snapshot dpr caps (doc: cap 2; 1.5 when deviceMemory < 8). */
export const DPR_CAP_DEFAULT = 2;
export const DPR_CAP_LOW_MEMORY = 1.5;
export const LOW_MEMORY_THRESHOLD_GB = 8;

/** Programmatic (tap / keyboard) flip duration, seconds (doc: 0.45s). */
export const TAP_FLIP_DURATION_S = 0.45;

/** Reduced-motion crossfade duration, ms (doc: 160ms). */
export const CROSSFADE_MS = 160;

/* ----------------------------------------------------------------------------
   Scalar helpers
   -------------------------------------------------------------------------- */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ----------------------------------------------------------------------------
   Fold geometry
   -------------------------------------------------------------------------- */

/**
 * Fold-line x (leaf-local, spine at 0) for progress `p`, leaf width `w`.
 * Sweeps from the outer edge (x = W at p=0) through the spine to x = -W at
 * p=1 — the doc's "fold line sweeps from x=W to x=-W". Values < 0 mean the
 * whole leaf is past the fold (fully wrapped, landing flat).
 */
export function foldLineX(p: number, w: number): number {
  return w * (1 - 2 * clamp01(p));
}

/**
 * Curl cylinder radius for progress `p`: r = mix(0.4W, 0.15W, sin(p·π)).
 * Tight mid-flip (pronounced curl), relaxing toward both ends so the page
 * flattens as it lands.
 */
export function radiusForP(p: number, w: number): number {
  return mix(RADIUS_MAX_FRAC * w, RADIUS_MIN_FRAC * w, Math.sin(clamp01(p) * Math.PI));
}

/**
 * Gesture→p mapping. `pointerX` is leaf-local x (spine at 0). Dragging the
 * outer edge (x = W) toward/past the spine sweeps p from 0 to 1:
 * p = clamp((W - pointerX) / (2W), 0, 1) — the grabbed edge travels 2W
 * (its full mirrored arc) over the gesture, matching foldLineX's sweep.
 */
export function dragToP(pointerX: number, w: number): number {
  if (w <= 0) return 0;
  return clamp01((w - pointerX) / (2 * w));
}

/**
 * Base fold tilt for a grip, from the pointer's normalized y (cy / H).
 * - 'edge' grips never tilt (vertical fold).
 * - Corner grips tilt most while the pointer hugs the gripped corner and
 *   straighten as it moves toward mid-height (iBooks-style).
 * Sign: bottom corner tilts positive (fold bottom leads), top negative.
 */
export function foldTilt(grip: FlipGrip, cyNorm: number): number {
  if (grip === 'edge') return 0;
  const y = clamp01(cyNorm);
  // 1 at the gripped corner, 0 at mid-height and beyond.
  const closeness = grip === 'corner-top' ? clamp01(1 - 2 * y) : clamp01(2 * y - 1);
  const sign = grip === 'corner-top' ? -1 : 1;
  const tilt = sign * closeness * MAX_FOLD_TILT;
  return tilt === 0 ? 0 : tilt; // normalize -0
}

/**
 * Tilt actually applied at progress `p`: fades out quadratically so the leaf
 * is exactly straight when it lands (p=1) — a tilted fold at p=1 would leave
 * the raster misaligned with the flat DOM it swaps back to.
 */
export function foldTiltAtP(baseTilt: number, p: number): number {
  const t = clamp01(p);
  return baseTilt * (1 - t * t);
}

/* ----------------------------------------------------------------------------
   Face selection (which page lands on which side of the moving sheet)
   -------------------------------------------------------------------------- */

/** A settled spread's ids plus the two spreads either side of it. */
export interface SpreadNeighbourIds {
  left: string | null;
  right: string | null;
  /** Pages behind the current right leaf ('next' flip). */
  nextLeft?: string | null;
  nextRight?: string | null;
  /** Pages before the current left leaf ('prev' flip). */
  prevLeft?: string | null;
  prevRight?: string | null;
}

/** The three snapshots a flip needs; null = plain cream paper. */
export interface FlipFaceIds {
  /** The moving sheet's visible face at rest. */
  front: string | null;
  /** The same sheet's other side — what sweeps in past the crest. */
  back: string | null;
  /** The page uncovered beneath the sheet. */
  revealed: string | null;
}

/**
 * Which page belongs on which face of the moving sheet.
 *
 * 'next' turns the RIGHT leaf: its visible face is the current right page,
 * its backside is the next spread's LEFT page, and the next spread's right
 * page lies uncovered beneath. 'prev' turns the LEFT leaf and is the exact
 * mirror — face = current left, backside = the previous spread's RIGHT page,
 * revealed = the previous spread's left page. Mirroring this wrong shows the
 * wrong page for the whole gesture, so the table lives here where it is
 * testable rather than inline in the Solid component.
 */
export function flipFaceIds(dir: FlipDirection, ids: SpreadNeighbourIds): FlipFaceIds {
  return dir === 'next'
    ? {
        front: ids.right,
        back: ids.nextLeft ?? null,
        revealed: ids.nextRight ?? null,
      }
    : {
        front: ids.left,
        back: ids.prevRight ?? null,
        revealed: ids.prevLeft ?? null,
      };
}

/* ----------------------------------------------------------------------------
   Hotspots
   -------------------------------------------------------------------------- */

/**
 * Hit-test a pointer against the leaf's outer-edge hotspots (leaf-local
 * coords, spine at x=0, outer edge at x=w). Corners win over the strip.
 * Returns null when the point is outside every hotspot.
 */
export function hitTestHotspot(
  x: number,
  y: number,
  w: number,
  h: number,
  stripPx: number = HOTSPOT_STRIP_PX,
  cornerPx: number = HOTSPOT_CORNER_PX,
): FlipGrip | null {
  if (x < 0 || x > w || y < 0 || y > h) return null;
  const nearOuterEdge = x >= w - cornerPx;
  if (nearOuterEdge && y <= cornerPx) return 'corner-top';
  if (nearOuterEdge && y >= h - cornerPx) return 'corner-bottom';
  if (x >= w - stripPx) return 'edge';
  return null;
}

/* ----------------------------------------------------------------------------
   Release decision + timing
   -------------------------------------------------------------------------- */

/**
 * Where the page goes on release: 1 = complete the flip, 0 = cancel.
 * Velocity wins when |v| exceeds the threshold (throw), otherwise the page
 * settles to whichever side it is mostly on (p > 0.5 completes).
 */
export function decideFlipTarget(p: number, v: number): 0 | 1 {
  if (v > VELOCITY_COMPLETE_THRESHOLD) return 1;
  if (v < -VELOCITY_COMPLETE_THRESHOLD) return 0;
  return p > 0.5 ? 1 : 0;
}

/**
 * Release-tween duration in seconds: clamp(0.55 − 0.1·|v|, 0.25, 0.55) —
 * faster throws land sooner (doc's clamp(0.25, 0.55 − |v|·0.1, 0.55)).
 */
export function flipDuration(v: number): number {
  return clamp(0.55 - 0.1 * Math.abs(v), 0.25, 0.55);
}

/**
 * Page-flip sample gain from release velocity: gentle drags whisper
 * (0.55), fast throws snap (up to 1). Linear in |v|, clamped.
 */
export function soundVolumeForVelocity(v: number): number {
  return clamp(0.55 + 0.25 * Math.abs(v), 0.55, 1);
}

/* ----------------------------------------------------------------------------
   Snapshot pixel ratio
   -------------------------------------------------------------------------- */

/**
 * Effective snapshot pixelRatio: the device ratio capped at 2, or 1.5 on
 * low-memory machines (navigator.deviceMemory < 8; undefined = assume ok).
 */
export function snapshotPixelRatio(devicePixelRatio: number, deviceMemoryGb: number | undefined): number {
  const cap =
    deviceMemoryGb !== undefined && deviceMemoryGb < LOW_MEMORY_THRESHOLD_GB
      ? DPR_CAP_LOW_MEMORY
      : DPR_CAP_DEFAULT;
  return Math.min(Math.max(devicePixelRatio, 0.5), cap);
}

/* ----------------------------------------------------------------------------
   LRU map (raster cache backbone)
   -------------------------------------------------------------------------- */

/**
 * Tiny LRU built on Map's insertion order: get() refreshes recency, set()
 * beyond capacity evicts the least-recently-used entry and reports it via
 * `onEvict` so callers can close ImageBitmaps.
 */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    readonly capacity: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LruMap: capacity must be a positive integer, got ${capacity}`);
    }
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns the value and marks it most-recently-used. */
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** Reads without touching recency (for introspection/tests). */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      /* c8 ignore next */
      if (oldest.done) break;
      const evicted = this.map.get(oldest.value) as V;
      this.map.delete(oldest.value);
      this.onEvict?.(oldest.value, evicted);
    }
  }

  delete(key: K): boolean {
    if (!this.map.has(key)) return false;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.onEvict?.(key, value);
    return true;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.map) this.onEvict(key, value);
    }
    this.map.clear();
  }

  /** Keys in least→most recently used order. */
  keys(): K[] {
    return [...this.map.keys()];
  }
}
