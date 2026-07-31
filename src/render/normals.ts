/**
 * render/normals.ts — the height/normal contribution API.
 *
 * The deferred pass needs a second buffer alongside the albedo: for every
 * texel, which way the surface faces and how far it stands above the back of
 * the case. This module is how an element contributes to that buffer *without*
 * hand-authored normal maps and without doing any lighting itself.
 *
 * The whole API is one idea: **a silhouette plus a profile**. A book spine is
 * a rounded box; a plank is a bevel; a leaf is a soft dome; the case back is a
 * plane. Nine profiles cover the entire shelf world, and each one is a closed
 * form — `sampleShape(shape, u, v)` — evaluated over a small cached image and
 * then stretched to whatever rectangle the element occupies.
 *
 * That stretch is the reason this is cheap. A 4000px-wide plank and a 40px
 * book both blit a ≤128px profile; nothing is computed per element per pixel,
 * so adding a hundred books to a shelf costs a hundred `drawImage` calls, not
 * a hundred shading loops. Compare the old path, where every element ran its
 * own gradient stack on the CPU — that is where the 118-second bake went.
 *
 * ## Encoding
 *
 * ```
 *   R = normal.x * 0.5 + 0.5     screen-space, +x right
 *   G = normal.y * 0.5 + 0.5     screen-space, +y DOWN (canvas convention)
 *   B = height, 0 = back plane, 1 = the front of the case
 *   A = coverage
 * ```
 *
 * `normal.z` is never stored; the shader reconstructs it, which buys a whole
 * channel for height and guarantees a unit normal.
 *
 * ## Order
 *
 * Contributions composite in the *same order as the albedo*, plain
 * source-over. Painter's algorithm: whatever is drawn last is in front, which
 * is exactly the layering the albedo already encodes. No depth test, no sort.
 */

/* ========================================================================== *
 *                                   types                                    *
 * ========================================================================== */

/** Canvas kinds accepted (mirrors art/lighting.ts). */
export type NormalCanvas = OffscreenCanvas | HTMLCanvasElement;
/** 2D contexts accepted. */
export type NormalCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** One evaluated surface point. */
export interface SurfacePoint {
  /** Normal x, -1…1 (+x right). */
  nx: number;
  /** Normal y, -1…1 (+y down). */
  ny: number;
  /** Height above the back plane, 0…1. */
  h: number;
  /** Coverage, 0…1. Outside the silhouette this is 0. */
  a: number;
}

/** Which axis a directional profile runs along. */
export type ProfileAxis = 'x' | 'y';

/** Which edges a bevel is cut on. */
export interface BevelEdges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/**
 * A height/normal profile.
 *
 * Every variant is normalized to the unit square: `u` and `v` run 0→1 across
 * whatever rectangle the element occupies, so one cached image serves every
 * size. Fields are optional with documented defaults so an element can emit a
 * spine with `{ kind: 'roundedBox' }` and nothing else.
 */
export type HeightShape =
  /** Dead flat. The case back, a wall, a sheet of paper lying on wood. */
  | {
      kind: 'plane';
      /** Height of the plane, 0…1. Default 0. */
      height?: number;
      /** Tilt the whole plane, radians of surface slope. Default 0. */
      tiltX?: number;
      tiltY?: number;
    }
  /**
   * **The book spine.** Flat front face with the sides rolling away — the
   * single most important profile in the app, because a shelf is two hundred
   * of them and their shared roll is what makes a row read as round objects
   * catching one light rather than a barcode.
   */
  | {
      kind: 'roundedBox';
      /** Which way the roll runs. Default `'x'`. */
      axis?: ProfileAxis;
      /** Fraction of the span the roll occupies each side, 0…0.5. Default 0.22. */
      radius?: number;
      /** Height of the flat face, 0…1. Default 0.6. */
      height?: number;
      /** Height at the rolled edge (the shoulder), 0…1. Default `height * 0.55`. */
      edgeHeight?: number;
      /** Extra roll on the cross axis (rounds the head and tail). Default 0.04. */
      crossRadius?: number;
      /** Lean, radians: tips the whole face so a leaning book leans in light too. */
      lean?: number;
    }
  /**
   * **The plank.** A plateau with chamfered edges. The bevel is what catches
   * the key along a shelf's front lip and throws the dark line underneath.
   */
  | {
      kind: 'bevel';
      /** Bevel width as a fraction of the shorter side, 0…0.5. Default 0.12. */
      size?: number;
      /** Plateau height, 0…1. Default 0.5. */
      height?: number;
      /** Height at the foot of the bevel. Default `height * 0.4`. */
      edgeHeight?: number;
      /** Which edges are cut. Default all four. */
      edges?: BevelEdges;
      /** 0 = straight chamfer, 1 = fully rounded ogee. Default 0.45. */
      round?: number;
    }
  /**
   * **The leaf.** A soft dome, optionally elongated, optionally creased down
   * the middle by a midrib. Overlapping domes at slightly different heights
   * are what give a foliage mass its depth under one light.
   */
  | {
      kind: 'dome';
      /** Peak height, 0…1. Default 0.55. */
      height?: number;
      /** Base height at the silhouette edge. Default `height * 0.35`. */
      edgeHeight?: number;
      /** Dome sharpness: 1 = spherical, >1 = pointier, <1 = flatter. Default 1. */
      power?: number;
      /** Midrib crease depth, 0…1. Default 0. */
      rib?: number;
      /** Midrib direction. Default `'y'`. */
      ribAxis?: ProfileAxis;
      /** Elongate along an axis, 0…1 (0 = circular). Default 0. */
      elongate?: number;
    }
  /** Half-cylinder — a stem, a rolled spine, a pipe, a candle. */
  | {
      kind: 'cylinder';
      axis?: ProfileAxis;
      /** Peak height. Default 0.5. */
      height?: number;
      /** Base height at the silhouette edge. Default 0.1. */
      edgeHeight?: number;
      /** Taper along the run, 0 = none, 1 = to a point. Default 0. */
      taper?: number;
    }
  /** A full sphere cap — berries, knobs, gems, bubbles. */
  | {
      kind: 'sphere';
      height?: number;
      /** Flatten toward a lens. Default 1 (full sphere). */
      squash?: number;
    }
  /** A linear ramp — a leaning surface, a raked shelf, a sloped roof. */
  | {
      kind: 'wedge';
      axis?: ProfileAxis;
      /** Height at u=0. Default 0.1. */
      from?: number;
      /** Height at u=1. Default 0.7. */
      to?: number;
      /** Round the arrival at the top, 0…1. Default 0.2. */
      round?: number;
    }
  /**
   * **A groove.** A recess rather than a rise: the joint where a plank meets
   * the case back, a hinge, a raised band's shadow trench. The AO pass eats
   * these for breakfast, which is exactly the point.
   */
  | {
      kind: 'groove';
      axis?: ProfileAxis;
      /** Surface height either side. Default 0.5. */
      height?: number;
      /** How far below the surface the floor of the groove sits. Default 0.18. */
      depth?: number;
      /** Fraction of the span the groove occupies. Default 0.35. */
      width?: number;
      /** 0 = square trench, 1 = soft dish. Default 0.6. */
      round?: number;
    }
  /**
   * **Raised bands.** A ribbed run — the raised cords across a leather spine,
   * corduroy, a stack of pages seen edge-on, a radiator. Cheap ridged noise in
   * closed form.
   */
  | {
      kind: 'ribs';
      axis?: ProfileAxis;
      /** Base surface height. Default 0.5. */
      height?: number;
      /** Rib prominence. Default 0.1. */
      amplitude?: number;
      /** Number of ribs across the span. Default 6. */
      count?: number;
      /** 0 = square ribs, 1 = sine. Default 0.75. */
      round?: number;
    };

/** The discriminant strings, handy for tests and pickers. */
export const HEIGHT_SHAPE_KINDS = [
  'plane',
  'roundedBox',
  'bevel',
  'dome',
  'cylinder',
  'sphere',
  'wedge',
  'groove',
  'ribs',
] as const;

/* ========================================================================== *
 *                                   maths                                    *
 * ========================================================================== */

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function num(v: number | undefined, fallback: number, lo = -1e6, hi = 1e6): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/**
 * Build a normal from a height field's slope.
 *
 * `dhdu`/`dhdv` are the height derivatives in *normalized* space; `scale`
 * converts them into the steepness the shader should see. Kept as one helper
 * so every profile faces the light with the same vocabulary — the coherence
 * the whole design is chasing starts here.
 */
function normalFromSlope(dhdu: number, dhdv: number, scale = 1): SurfacePoint {
  const nx = -dhdu * scale;
  const ny = -dhdv * scale;
  const len = Math.hypot(nx, ny, 1);
  return { nx: nx / len, ny: ny / len, h: 0, a: 1 };
}

/* ========================================================================== *
 *                              shape evaluation                              *
 * ========================================================================== */

/**
 * Evaluate a profile at normalized `(u, v)` inside its rectangle.
 *
 * **Total.** An unknown shape, a NaN coordinate or a nonsense parameter all
 * come back as a flat, fully-covered surface rather than throwing — this runs
 * over theme data and user overrides.
 */
export function sampleShape(shape: HeightShape, u: number, v: number): SurfacePoint {
  const uu = clamp01(Number.isFinite(u) ? u : 0);
  const vv = clamp01(Number.isFinite(v) ? v : 0);
  switch (shape?.kind) {
    case 'plane': {
      const h = num(shape.height, 0, 0, 1);
      const tx = num(shape.tiltX, 0, -1.5, 1.5);
      const ty = num(shape.tiltY, 0, -1.5, 1.5);
      const n = normalFromSlope(Math.tan(tx), Math.tan(ty), 1);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    case 'roundedBox': {
      const axis = shape.axis === 'y' ? 'y' : 'x';
      const r = num(shape.radius, 0.22, 0.001, 0.5);
      const top = num(shape.height, 0.6, 0, 1);
      const edge = num(shape.edgeHeight, top * 0.55, 0, 1);
      const cross = num(shape.crossRadius, 0.04, 0, 0.5);
      const lean = num(shape.lean, 0, -1.2, 1.2);

      const main = axis === 'x' ? uu : vv;
      const off = axis === 'x' ? vv : uu;

      // Distance in from the nearest rolled edge, 0 at the silhouette, 1 at
      // the flat face.
      const dMain = Math.min(main, 1 - main) / r;
      const tMain = clamp01(dMain);
      // Quarter-cosine roll: the shoulder arrives tangent to the flat face, so
      // a row of spines does not show a seam where the roll meets the front.
      const rollMain = Math.sin((tMain * Math.PI) / 2);
      const hMain = edge + (top - edge) * rollMain;
      // Slope of the roll: steepest at the silhouette, zero on the face.
      const slopeMag =
        tMain >= 1
          ? 0
          : ((top - edge) * (Math.PI / 2) * Math.cos((tMain * Math.PI) / 2)) / Math.max(1e-3, r);
      // Sign of dh/du, not of the direction the face turns. On the left
      // shoulder the height *rises* toward the centre, so dh/du is positive
      // and `normalFromSlope` negates it into a left-facing normal. Getting
      // this backwards inverts the roll on every spine in the app: the shaded
      // side lands where the lit side belongs, and the picture still looks
      // plausible enough to ship, which is exactly why it is pinned by a test.
      const signMain = main < 0.5 ? 1 : -1;

      let hCross = 1;
      let slopeCross = 0;
      if (cross > 0.001) {
        const dCross = clamp01(Math.min(off, 1 - off) / cross);
        hCross = 0.72 + 0.28 * Math.sin((dCross * Math.PI) / 2);
        slopeCross =
          dCross >= 1
            ? 0
            : (0.28 * (Math.PI / 2) * Math.cos((dCross * Math.PI) / 2)) / Math.max(1e-3, cross);
        slopeCross *= off < 0.5 ? 1 : -1;
      }

      const h = clamp01(hMain * hCross);
      const dU = axis === 'x' ? slopeMag * signMain : slopeCross * hMain;
      const dV = axis === 'x' ? slopeCross * hMain : slopeMag * signMain;
      const n = normalFromSlope(dU + Math.tan(lean), dV, 1.35);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    case 'bevel': {
      const size = num(shape.size, 0.12, 0.001, 0.5);
      const top = num(shape.height, 0.5, 0, 1);
      const edge = num(shape.edgeHeight, top * 0.4, 0, 1);
      const round = num(shape.round, 0.45, 0, 1);
      const e = shape.edges ?? { left: true, right: true, top: true, bottom: true };

      // Distance to the plateau, per edge, in bevel widths.
      const dl = e.left === false ? 1 : uu / size;
      const dr = e.right === false ? 1 : (1 - uu) / size;
      const dt = e.top === false ? 1 : vv / size;
      const db = e.bottom === false ? 1 : (1 - vv) / size;

      const ramp = (d: number): number => {
        const t = clamp01(d);
        return round <= 0 ? t : t * (1 - round) + smoothstep01(t) * round;
      };
      const rl = ramp(dl);
      const rr = ramp(dr);
      const rt = ramp(dt);
      const rb = ramp(db);
      const tMin = Math.min(rl, rr, rt, rb);
      const h = clamp01(edge + (top - edge) * tMin);

      // Only the *governing* edge contributes slope, so a corner blends the
      // two rather than doubling them into a spike.
      const grad = (d: number, sign: number): number => {
        const t = clamp01(d);
        if (t >= 1) return 0;
        const base = round <= 0 ? 1 : 1 - round + round * 6 * t * (1 - t);
        return (sign * (top - edge) * base) / Math.max(1e-3, size);
      };
      let dU = 0;
      let dV = 0;
      if (rl === tMin) dU += grad(dl, 1);
      if (rr === tMin) dU += grad(dr, -1);
      if (rt === tMin) dV += grad(dt, 1);
      if (rb === tMin) dV += grad(db, -1);

      const n = normalFromSlope(dU, dV, 1.15);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    case 'dome': {
      const top = num(shape.height, 0.55, 0, 1);
      const edge = num(shape.edgeHeight, top * 0.35, 0, 1);
      const power = num(shape.power, 1, 0.15, 6);
      const rib = num(shape.rib, 0, 0, 1);
      const ribAxis = shape.ribAxis === 'x' ? 'x' : 'y';
      const elongate = num(shape.elongate, 0, 0, 0.95);

      const cx = uu * 2 - 1;
      const cy = vv * 2 - 1;
      const sx = 1 - elongate * 0.0;
      const sy = 1 / (1 - elongate * 0.85);
      const ex = cx * sx;
      const ey = cy / sy;
      const r2 = ex * ex + ey * ey;
      if (r2 >= 1) return { nx: 0, ny: 0, h: edge, a: 0 };

      const dome = Math.pow(1 - r2, 0.5 * power);
      let h = edge + (top - edge) * dome;
      // d/dr of (1-r²)^(p/2) = -p·r·(1-r²)^(p/2-1)
      const k = -(top - edge) * power * Math.pow(Math.max(1e-4, 1 - r2), 0.5 * power - 1);
      let dU = k * ex * sx * 2;
      let dV = (k * ey * 2) / sy;

      if (rib > 0.001) {
        const t = ribAxis === 'y' ? cx : cy;
        const crease = Math.exp(-(t * t) / 0.02);
        h -= rib * 0.16 * crease * dome;
        const dcrease = ((-2 * t) / 0.02) * crease;
        if (ribAxis === 'y') dU -= rib * 0.16 * dcrease * dome * 2;
        else dV -= rib * 0.16 * dcrease * dome * 2;
      }

      const n = normalFromSlope(dU, dV, 0.85);
      // Feather the last few percent of the silhouette so overlapping leaves
      // do not stack hard rings.
      const a = smoothstep01((1 - Math.sqrt(r2)) / 0.06);
      return { nx: n.nx, ny: n.ny, h: clamp01(h), a };
    }

    case 'cylinder': {
      const axis = shape.axis === 'y' ? 'y' : 'x';
      const top = num(shape.height, 0.5, 0, 1);
      const edge = num(shape.edgeHeight, 0.1, 0, 1);
      const taper = num(shape.taper, 0, 0, 1);
      const across = axis === 'x' ? vv : uu;
      const along = axis === 'x' ? uu : vv;
      const width = 1 - taper * along;
      const c = (across - 0.5) / Math.max(1e-3, width * 0.5) / 2 + 0.5;
      const t = (clamp01(c) - 0.5) * 2;
      if (Math.abs(t) >= 1) return { nx: 0, ny: 0, h: edge, a: 0 };
      const prof = Math.sqrt(Math.max(0, 1 - t * t));
      const h = clamp01(edge + (top - edge) * prof);
      const slope = (-(top - edge) * t) / Math.max(1e-3, prof) / Math.max(1e-3, width);
      const dU = axis === 'x' ? 0 : slope;
      const dV = axis === 'x' ? slope : 0;
      const n = normalFromSlope(dU, dV, 0.9);
      const a = smoothstep01((1 - Math.abs(t)) / 0.09);
      return { nx: n.nx, ny: n.ny, h, a };
    }

    case 'sphere': {
      const top = num(shape.height, 0.6, 0, 1);
      const squash = num(shape.squash, 1, 0.1, 1);
      const cx = uu * 2 - 1;
      const cy = vv * 2 - 1;
      const r2 = cx * cx + cy * cy;
      if (r2 >= 1) return { nx: 0, ny: 0, h: 0, a: 0 };
      const z = Math.sqrt(1 - r2);
      const h = clamp01(top * z * squash);
      const len = Math.hypot(cx, cy, z / Math.max(0.1, squash));
      const a = smoothstep01((1 - Math.sqrt(r2)) / 0.05);
      return { nx: cx / len, ny: cy / len, h, a };
    }

    case 'wedge': {
      const axis = shape.axis === 'y' ? 'y' : 'x';
      const from = num(shape.from, 0.1, 0, 1);
      const to = num(shape.to, 0.7, 0, 1);
      const round = num(shape.round, 0.2, 0, 1);
      const t = axis === 'x' ? uu : vv;
      const shaped = t * (1 - round) + smoothstep01(t) * round;
      const h = clamp01(from + (to - from) * shaped);
      const d = (to - from) * (1 - round + round * 6 * t * (1 - t));
      const n = normalFromSlope(axis === 'x' ? d : 0, axis === 'x' ? 0 : d, 1);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    case 'groove': {
      const axis = shape.axis === 'y' ? 'y' : 'x';
      const surface = num(shape.height, 0.5, 0, 1);
      const depth = num(shape.depth, 0.18, 0, 1);
      const width = num(shape.width, 0.35, 0.01, 1);
      const round = num(shape.round, 0.6, 0, 1);
      const t = axis === 'x' ? uu : vv;
      const d = Math.abs(t - 0.5) / (width * 0.5);
      const inside = clamp01(1 - d);
      const dish = round <= 0 ? (d < 1 ? 1 : 0) : Math.pow(inside, 1 + round);
      const h = clamp01(surface - depth * dish);
      const slope =
        d >= 1 ? 0 : (depth * (1 + round) * Math.pow(Math.max(1e-4, inside), round)) / (width * 0.5);
      const sign = t < 0.5 ? -1 : 1;
      const dU = axis === 'x' ? slope * sign : 0;
      const dV = axis === 'x' ? 0 : slope * sign;
      const n = normalFromSlope(dU, dV, 1.5);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    case 'ribs': {
      const axis = shape.axis === 'y' ? 'y' : 'x';
      const base = num(shape.height, 0.5, 0, 1);
      const amp = num(shape.amplitude, 0.1, 0, 1);
      const count = Math.max(1, Math.round(num(shape.count, 6, 1, 64)));
      const round = num(shape.round, 0.75, 0, 1);
      const t = axis === 'x' ? uu : vv;
      const phase = t * count * Math.PI * 2;
      const sine = (Math.sin(phase) + 1) * 0.5;
      const square = sine > 0.5 ? 1 : 0;
      const prof = square * (1 - round) + sine * round;
      const h = clamp01(base + amp * (prof - 0.5));
      const d = amp * round * Math.cos(phase) * count * Math.PI;
      const n = normalFromSlope(axis === 'x' ? d : 0, axis === 'x' ? 0 : d, 1);
      return { nx: n.nx, ny: n.ny, h, a: 1 };
    }

    default:
      return { nx: 0, ny: 0, h: 0, a: 1 };
  }
}

/* ========================================================================== *
 *                                  encoding                                  *
 * ========================================================================== */

/** Encode a surface point into the buffer's four bytes. */
export function encodeSurface(p: SurfacePoint): [number, number, number, number] {
  const q = (v: number): number => {
    const x = Math.round((clamp01(v * 0.5 + 0.5) * 255));
    return x < 0 ? 0 : x > 255 ? 255 : x;
  };
  return [q(p.nx), q(p.ny), Math.round(clamp01(p.h) * 255), Math.round(clamp01(p.a) * 255)];
}

/** Decode four bytes back into a surface point. Inverse of {@link encodeSurface}. */
export function decodeSurface(r: number, g: number, b: number, a: number): SurfacePoint {
  return {
    nx: (r / 255) * 2 - 1,
    ny: (g / 255) * 2 - 1,
    h: b / 255,
    a: a / 255,
  };
}

/** The bytes an untouched texel should hold: flat, at the back, uncovered. */
export const EMPTY_SURFACE_BYTES: readonly [number, number, number, number] = [128, 128, 0, 0];

/* ========================================================================== *
 *                              profile rasterizer                            *
 * ========================================================================== */

/**
 * Cap on the rasterized profile. Above this the profile is generated smaller
 * and stretched — a book spine's roll has no detail worth 400 samples, and the
 * cap is what keeps the height pass off the CPU's critical path.
 */
export const PROFILE_MAX = 128;

/** Directional profiles only need one texel on their invariant axis. */
function profileSize(shape: HeightShape, w: number, h: number): [number, number] {
  const cw = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(w)));
  const ch = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(h)));
  switch (shape.kind) {
    case 'plane':
      return [2, 2];
    case 'wedge':
    case 'groove':
    case 'ribs':
      return shape.axis === 'y' ? [2, ch] : [cw, 2];
    case 'roundedBox':
      // The cross roll needs a couple of rows even on the invariant axis.
      return shape.axis === 'y' ? [24, ch] : [cw, 24];
    case 'cylinder':
      return shape.axis === 'y' ? [cw, 16] : [16, ch];
    default:
      return [cw, ch];
  }
}

/** Stable cache key for a shape at a raster size. */
export function shapeKey(shape: HeightShape, w: number, h: number): string {
  const [pw, ph] = profileSize(shape, w, h);
  const parts: string[] = [shape.kind, String(pw), String(ph)];
  for (const [k, v] of Object.entries(shape as Record<string, unknown>)) {
    if (k === 'kind') continue;
    if (typeof v === 'number') parts.push(`${k}:${v.toFixed(4)}`);
    else if (typeof v === 'boolean') parts.push(`${k}:${v ? 1 : 0}`);
    else if (v !== null && typeof v === 'object') parts.push(`${k}:${JSON.stringify(v)}`);
  }
  return parts.join('|');
}

/**
 * Rasterize a profile into raw RGBA bytes.
 *
 * Exposed separately from the canvas path so it can be unit-tested with no DOM
 * at all — every claim the tests make about the height buffer is made against
 * this function.
 */
export function rasterizeShape(
  shape: HeightShape,
  width: number,
  height: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const [w, h] = profileSize(shape, width, height);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = h === 1 ? 0.5 : (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = w === 1 ? 0.5 : (x + 0.5) / w;
      const p = sampleShape(shape, u, v);
      const [r, g, b, a] = encodeSurface(p);
      const i = (y * w + x) * 4;
      // Store straight (non-premultiplied); the canvas path premultiplies on
      // upload and the shader divides it back out.
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { data, width: w, height: h };
}

/* ========================================================================== *
 *                               canvas emitter                               *
 * ========================================================================== */

const canvasCache = new Map<string, NormalCanvas>();

function makeCanvas(w: number, h: number): NormalCanvas | null {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(cw, ch);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

/**
 * Get (and memoize) the rasterized profile as a drawable canvas.
 *
 * The cache is keyed by shape parameters, so an entire shelf of books that
 * share a spine profile pays for exactly one raster. Returns `null` in
 * environments with no canvas at all (node unit tests), which every caller
 * treats as "skip the height contribution" rather than an error.
 */
export function shapeCanvas(shape: HeightShape, w: number, h: number): NormalCanvas | null {
  const key = shapeKey(shape, w, h);
  const hit = canvasCache.get(key);
  if (hit !== undefined) return hit;

  const raster = rasterizeShape(shape, w, h);
  const canvas = makeCanvas(raster.width, raster.height);
  if (canvas === null) return null;
  const ctx = canvas.getContext('2d') as NormalCtx | null;
  if (ctx === null) return null;
  const img = ctx.createImageData(raster.width, raster.height);
  img.data.set(raster.data);
  ctx.putImageData(img, 0, 0);
  canvasCache.set(key, canvas);
  return canvas;
}

/** Drop every cached profile (theme switch, memory pressure, tests). */
export function clearShapeCache(): void {
  canvasCache.clear();
}

/** How many profiles are currently cached — the number tests assert on. */
export function shapeCacheSize(): number {
  return canvasCache.size;
}

/** Where and how a contribution lands in the buffer. */
export interface EmitOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation about the rect's centre, radians. Default 0. */
  rotation?: number;
  /** Scale the emitted height (a recessed book stands less proud). Default 1. */
  heightScale?: number;
  /** Lift the whole contribution (a book pulled proud of the shelf). Default 0. */
  heightOffset?: number;
  /** Coverage multiplier, for soft or partial contributions. Default 1. */
  opacity?: number;
  /** Clip the contribution to the current path already set on the context. */
  clip?: boolean;
}

/**
 * Emit one element's height/normal contribution into the buffer.
 *
 * This is the whole element-facing API. An element that knows its silhouette
 * calls this once and is done — no shading, no gradients, no per-pixel work.
 *
 * `heightScale`/`heightOffset` are applied with a composite trick rather than
 * a re-raster, so a hundred books at a hundred depths still share one cached
 * profile.
 */
export function emitHeight(ctx: NormalCtx, shape: HeightShape, opts: EmitOptions): void {
  const w = opts.width;
  const h = opts.height;
  if (!(w > 0) || !(h > 0)) return;
  const canvas = shapeCanvas(shape, w, h);
  if (canvas === null) return;

  const rot = opts.rotation ?? 0;
  const alpha = clamp01(opts.opacity ?? 1);
  if (alpha <= 0.002) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'source-over';
  if (rot !== 0) {
    ctx.translate(opts.x + w / 2, opts.y + h / 2);
    ctx.rotate(rot);
    ctx.translate(-w / 2, -h / 2);
    ctx.drawImage(canvas as CanvasImageSource, 0, 0, w, h);
  } else {
    ctx.drawImage(canvas as CanvasImageSource, opts.x, opts.y, w, h);
  }
  ctx.restore();

  const scale = opts.heightScale ?? 1;
  const offset = opts.heightOffset ?? 0;
  if (scale === 1 && offset === 0) return;

  // Height lives in the blue channel; adjust it in place without touching the
  // normal. `multiply` scales it down, a blue add lifts it.
  ctx.save();
  if (rot !== 0) {
    ctx.translate(opts.x + w / 2, opts.y + h / 2);
    ctx.rotate(rot);
    ctx.translate(-w / 2 - opts.x, -h / 2 - opts.y);
  }
  if (scale !== 1) {
    ctx.globalCompositeOperation = 'multiply';
    const k = Math.round(clamp01(scale) * 255);
    ctx.fillStyle = `rgb(255, 255, ${k})`;
    ctx.fillRect(opts.x, opts.y, w, h);
  }
  if (offset !== 0) {
    ctx.globalCompositeOperation = offset > 0 ? 'lighter' : 'multiply';
    const k = Math.round(clamp01(Math.abs(offset)) * 255);
    ctx.fillStyle =
      offset > 0 ? `rgb(0, 0, ${k})` : `rgb(255, 255, ${Math.max(0, 255 - k)})`;
    ctx.fillRect(opts.x, opts.y, w, h);
  }
  ctx.restore();
}

/**
 * Fill the whole buffer with a base plane — the case back, the sky, the wall.
 *
 * Always call this first: an all-zero buffer decodes to *uncovered*, and an
 * uncovered backdrop takes no light at all, which reads as a hole rather than
 * a wall.
 */
export function emitBackplane(ctx: NormalCtx, w: number, h: number, height = 0): void {
  const [r, g, b, a] = encodeSurface({ nx: 0, ny: 0, h: clamp01(height), a: 1 });
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/* ========================================================================== *
 *                            composition helpers                             *
 * ========================================================================== */

/**
 * A shelf of books, expressed as height contributions.
 *
 * The pattern every caller repeats — one rounded box per spine, each at its own
 * proudness — hoisted so the app and the harness build the same geometry and a
 * regression in one shows up in the other.
 */
export interface SpineContribution {
  x: number;
  y: number;
  width: number;
  height: number;
  /** How far the book stands proud of its neighbours, 0…1. */
  proud?: number;
  /** Lean in radians. */
  lean?: number;
  /** Roll radius as a fraction of width. */
  radius?: number;
  /** Raised bands across the spine. */
  bands?: number;
}

/** Emit a run of book spines plus the ribs of any that have raised bands. */
export function emitSpines(ctx: NormalCtx, books: readonly SpineContribution[]): void {
  for (const b of books) {
    const proud = clamp01(b.proud ?? 0.5);
    emitHeight(
      ctx,
      {
        kind: 'roundedBox',
        axis: 'x',
        radius: b.radius ?? 0.24,
        height: 0.42 + proud * 0.5,
        edgeHeight: (0.42 + proud * 0.5) * 0.5,
        crossRadius: 0.035,
        ...(b.lean !== undefined ? { lean: b.lean } : {}),
      },
      { x: b.x, y: b.y, width: b.width, height: b.height, ...(b.lean !== undefined ? { rotation: b.lean * 0.35 } : {}) },
    );
    const bands = b.bands ?? 0;
    if (bands > 0) {
      emitHeight(
        ctx,
        { kind: 'ribs', axis: 'y', height: 0.5, amplitude: 0.16, count: bands, round: 0.55 },
        {
          x: b.x + b.width * 0.06,
          y: b.y + b.height * 0.06,
          width: b.width * 0.88,
          height: b.height * 0.88,
          opacity: 0.5,
        },
      );
    }
  }
}
