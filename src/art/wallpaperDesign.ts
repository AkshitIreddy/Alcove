/**
 * art/wallpaperDesign.ts — the wall, given a vocabulary.
 *
 * The wall used to be ONE FLAT TINT, and it was a flat tint for a good reason:
 * every version that had a pattern also had a visible seam. The reader saw a
 * "weird tiling effect" and "white bands in the corners" while panning, and the
 * fix each time was to delete the pattern rather than to fix the tile. So the
 * bar this module has to clear is not "draw a nice damask" — it is "draw
 * anything at all whose repeat cannot be found by eye".
 *
 * ## How seamlessness is structural here, not a property to be tested for
 *
 * Every mark in a tile is emitted through {@link emit}, which knows the tile is
 * a TORUS. A mark declares the span its ink occupies; if that span reaches past
 * an edge, the emitter draws the mark AGAIN, translated by exactly one tile, so
 * the part that left the right edge re-enters at the left as the same curve
 * with the same seed. Nothing is clipped into place and nothing is mirrored —
 * the far copy is bit-identical geometry, which is the only thing that makes a
 * hand-drawn wobble safe to run over an edge.
 *
 * Marks that run the whole width or height of the tile (stripes, chevrons)
 * cannot be handled that way, because a shape with a start and an end has caps,
 * and a cap landing mid-seam is exactly the pale band that got reported. Those
 * declare `null` for the axis they run along and instead carry a profile that
 * is PERIODIC in that axis by construction — a sine or a triangle wave whose
 * wavelength divides the tile — so the geometry at t = 0 and t = size is the
 * same number, not merely a similar one. `wobbleRect`'s quadratic bow is not
 * periodic and is therefore never used on a running mark.
 *
 * Lattices are fitted to the tile rather than the tile to the lattice: the
 * caller asks for a size and the cell is `size / round(size / cell)`, so the
 * repeat is always an exact integer count and the motif merely comes out a few
 * percent off its nominal scale. Half-drop and brick lattices additionally
 * force an even count, or the drop would not close.
 *
 * ## The style
 *
 * Flat fills, one soft ink outline, rounded everything, edges that bow — the
 * icon's language (`flat.ts`), one step quieter, because a wall is a backdrop
 * and the books are the subject. The wallpaper's ink is `FLAT.ink` mixed back
 * toward the wall so the pattern never competes with the case standing on it.
 *
 * Relief (the depth axis) is a SECOND FLAT FACE offset behind the motif, in a
 * solid colour, drawn in its own pass so a neighbour's face always covers it.
 * It is not a shadow: no blur, no alpha, no light direction. It is the same
 * trick the icon plays with a book's spine beside its cover, applied to a
 * repeat.
 *
 * ## Colour
 *
 * Everything is derived from `flatScheme()`, so redecorating the room repaints
 * the wall with it. A preset picks WHICH slot the motif borrows from — a shade
 * of the wall itself, the case timber, the recess, gilt, or the first book
 * cloth — never a literal hex, so no preset can look wrong in a room it was not
 * designed against.
 */

import {
  FLAT,
  contactShadow,
  flatScheme,
  flatSchemeTag,
  stroke,
  type FlatCtx,
} from './flat';
import { fnv1a } from './noise';

/* ============================== the axes ================================= */

/**
 * The motifs. Roughly a wallpaper book's table of contents: a few stripes, a
 * few geometrics, a few florals, a few scenics.
 */
export const WALLPAPER_PATTERNS = [
  'plain',
  'stripe',
  'pinstripe',
  'ticking',
  'gingham',
  'chevron',
  'herringbone',
  'honeycomb',
  'trellis',
  'scallop',
  'arch',
  'polka',
  'star',
  'moonstar',
  'sprig',
  'laurel',
  'damask',
  'bird',
  'toile',
] as const;

export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];

/**
 * How big the motif is, as a nominal cell in CSS px at zoom 1.
 *
 * Five stops rather than a slider: the difference between a 34px sprig and a
 * 38px sprig is not a decision anyone wants to make, and a named stop is
 * something a preset can be built out of.
 */
export const WALLPAPER_SCALES = ['petite', 'small', 'medium', 'large', 'grand'] as const;
export type WallpaperScale = (typeof WALLPAPER_SCALES)[number];

const SCALE_CELL: Record<WallpaperScale, number> = {
  petite: 34,
  small: 52,
  medium: 78,
  large: 116,
  grand: 168,
};

/**
 * How much the motif reads as raised, as the offset of its second face in
 * fractions of the cell. `flat` draws no second face at all.
 */
export const WALLPAPER_DEPTHS = ['flat', 'low', 'raised', 'carved'] as const;
export type WallpaperDepth = (typeof WALLPAPER_DEPTHS)[number];

/**
 * Offsets are small on purpose. Past about a twentieth of the cell the second
 * face stops reading as the motif's own thickness and starts reading as a
 * shadow cast by a lamp — which is the one thing the style forbids.
 */
const DEPTH_OFFSET: Record<WallpaperDepth, number> = {
  flat: 0,
  low: 0.016,
  raised: 0.032,
  carved: 0.055,
};

/**
 * Which slot of the live scheme the motif borrows its colour from.
 *
 * The wall is the lightest thing on screen and has to stay that way, so every
 * one of these is a MIX toward the wall rather than the slot's own hex — a
 * timber-inked trellis is a warm tea-stain of the case colour, not the case
 * colour.
 */
export const WALLPAPER_INKS = ['paper', 'deep', 'timber', 'recess', 'gilt', 'cloth'] as const;
export type WallpaperInk = (typeof WALLPAPER_INKS)[number];

/** A wallpaper, fully specified. Four axes, and nothing else. */
export interface WallpaperSpec {
  pattern: WallpaperPattern;
  scale: WallpaperScale;
  depth: WallpaperDepth;
  ink: WallpaperInk;
}

/* ============================ colour plumbing ============================ */

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  if (!Number.isFinite(n)) return [233, 226, 208];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Straight linear mix, `t` of `b` into `a`. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Rough perceptual lightness 0–1, for keeping the wall the lightest surface. */
function luma(hex: string): number {
  const [r, g, b] = channels(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Roughly how much of the wall each pattern paints, as a damping factor on the
 * ink mix. 1 = a sprinkle of motifs on bare paper; 0.5 = the pattern IS the
 * wall and the mix has to be halved for the room to survive it.
 */
const COVERAGE: Record<WallpaperPattern, number> = {
  plain: 1,
  stripe: 0.7,
  pinstripe: 1,
  ticking: 0.9,
  gingham: 0.62,
  chevron: 0.8,
  herringbone: 0.85,
  honeycomb: 0.5,
  trellis: 1,
  scallop: 1,
  arch: 0.7,
  polka: 1,
  star: 1,
  moonstar: 1,
  sprig: 1,
  laurel: 1,
  damask: 0.92,
  bird: 1,
  toile: 0.9,
};

/**
 * The five colours a tile is drawn out of.
 *
 * Five, because the moment there is a sixth the wall starts competing with the
 * books. `ground` is the wall exactly as the room set it, so a wallpapered wall
 * and a plain one are the same colour at a distance.
 */
export interface WallpaperColours {
  /** The wall itself — `flatScheme().wall`, untouched. */
  ground: string;
  /** The motif's flat fill. */
  face: string;
  /** The motif's outline. Softer than `FLAT.ink`: a wall is not furniture. */
  ink: string;
  /** The second flat face behind the motif when depth > flat. */
  relief: string;
  /** One small detail colour — a berry, an eye, a gilt pip. */
  accent: string;
}

/**
 * How far each ink slot pulls the motif away from the wall colour.
 *
 * All modest, and that is the constraint rather than the taste: the wall has to
 * stay the lightest and quietest surface on screen or the books stop being the
 * subject. A half-strength gilt turned the whole room into a jewellery box the
 * first time these were tuned by eye alone.
 */
const INK_MIX: Record<WallpaperInk, { toward: (s: ReturnType<typeof flatScheme>) => string; t: number }> = {
  paper: { toward: () => FLAT.ink, t: 0.09 },
  deep: { toward: () => FLAT.ink, t: 0.2 },
  timber: { toward: (s) => s.timber, t: 0.4 },
  recess: { toward: (s) => s.recess, t: 0.32 },
  gilt: { toward: () => FLAT.gilt, t: 0.34 },
  cloth: { toward: (s) => s.cloths[0]?.[0] ?? FLAT.terracotta, t: 0.32 },
};

/**
 * Derive a tile's palette from the live scheme.
 *
 * Exported because `world.ts` needs the ground colour for the placeholder tint
 * it shows before the first bake lands, and a preview card needs the whole set.
 */
export function wallpaperColours(spec: WallpaperSpec): WallpaperColours {
  const room = flatScheme();
  const ground = room.wall;
  const rule = INK_MIX[spec.ink];
  // Damped by how much of the wall the pattern actually covers. The same mix
  // that reads as a sprinkle of gilt stars reads as a gold wall when it is a
  // honeycomb, because the honeycomb's cells meet edge to edge and there is no
  // paper left showing. The ink slot names a hue; coverage decides how much of
  // it the room can take.
  const face = mix(ground, rule.toward(room), rule.t * COVERAGE[spec.pattern]);

  // The outline is pulled back toward the wall so the repeat reads as a wash
  // rather than as a second set of furniture. Pulled back FURTHER on a dark
  // face, where a full-strength ink would only turn the motif into a blob.
  const inkPull = 0.34 + (1 - luma(face)) * 0.22;
  const ink = mix(FLAT.ink, ground, Math.min(0.62, inkPull));

  // The relief face sits between the motif and the wall in value, so the motif
  // reads as lifted OFF the wall rather than as casting anything onto it.
  const relief = mix(face, FLAT.ink, 0.2);

  // One warm pip. Gilt everywhere except on a gilt motif, where it would
  // vanish — there the accent goes the other way, into the paper.
  const accent = spec.ink === 'gilt' ? mix(face, ground, 0.55) : mix(face, FLAT.gilt, 0.62);

  return { ground, face, ink, relief, accent };
}

/** The monochrome palette the relief pass draws with: one solid face, no ink. */
function reliefColours(c: WallpaperColours): WallpaperColours {
  return { ground: c.ground, face: c.relief, ink: c.relief, relief: c.relief, accent: c.relief };
}

/* ============================== the torus ================================ */

type Pass = 'relief' | 'face';

/**
 * One thing drawn into the tile.
 *
 * `spanX`/`spanY` are the extent of the mark's INK on that axis, in tile space,
 * and `null` means "this mark is already periodic on that axis" — a stripe that
 * runs off both ends, a chevron whose zigzag wavelength divides the tile. A
 * span that pokes past an edge earns the mark a second (or fourth) draw one
 * tile over; a `null` earns it nothing, because there is nothing to close.
 */
interface Mark {
  /** Draw at the current origin. The emitter has already translated. */
  draw(ctx: FlatCtx, pass: Pass, c: WallpaperColours): void;
  spanX: readonly [number, number] | null;
  spanY: readonly [number, number] | null;
}

const NO_SHIFT: readonly number[] = [0];

/** The tile offsets a span needs so its ink closes across the seam. */
function shifts(span: readonly [number, number] | null, size: number): readonly number[] {
  if (span === null) return NO_SHIFT;
  const out = [0];
  if (span[1] > size) out.push(-size);
  if (span[0] < 0) out.push(size);
  return out;
}

/**
 * Draw every mark, plus every wrapped copy it needs, for one pass.
 *
 * Run twice per tile — all relief faces, then all motif faces — so that where
 * two motifs are close enough to touch, the neighbour's face covers the relief
 * rather than the relief cutting into the neighbour. Doing it per-mark instead
 * (relief, face, relief, face) is what makes a dense damask look chewed.
 */
function emit(ctx: FlatCtx, size: number, marks: readonly Mark[], pass: Pass, c: WallpaperColours): void {
  for (const mark of marks) {
    for (const ox of shifts(mark.spanX, size)) {
      for (const oy of shifts(mark.spanY, size)) {
        if (ox === 0 && oy === 0) {
          mark.draw(ctx, pass, c);
          continue;
        }
        ctx.save();
        ctx.translate(ox, oy);
        mark.draw(ctx, pass, c);
        ctx.restore();
      }
    }
  }
}

/* ============================ drawing helpers ============================ */

/** Fill the current path, then outline it. The one move every motif makes. */
function ink(ctx: FlatCtx, c: WallpaperColours, width: number, fill = true): void {
  if (fill) {
    ctx.fillStyle = c.face;
    ctx.fill();
  }
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Outline weight for a motif of radius `r`. Never below a visible hair. */
function motifInk(r: number): number {
  return Math.max(0.9, Math.min(4.2, r * 0.13));
}

/** A deterministic value in [-1, 1] from an integer — the wobble of `flat.ts`. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** A closed blob: a circle whose radius breathes by a few percent per lobe. */
function blob(ctx: FlatCtx, r: number, seed: number, lobes = 7, wobble = 0.07): void {
  ctx.beginPath();
  const steps = lobes * 6;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 + jitter(seed + Math.round((i / steps) * lobes) * 7) * wobble);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A leaf: two arcs meeting at a point at each end, tilted by `angle`. */
function leaf(ctx: FlatCtx, len: number, wide: number, angle: number): void {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wide, len * 0.42, 0, len);
  ctx.quadraticCurveTo(-wide, len * 0.42, 0, 0);
  ctx.closePath();
  ctx.restore();
}

/** A five-pointed star, point up. */
function starPath(ctx: FlatCtx, r: number, points = 5, inner = 0.42): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** A rounded polygon through the given points. */
function roundedPoly(ctx: FlatCtx, pts: readonly (readonly [number, number])[], radius: number): void {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const inLen = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const outLen = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const ri = Math.min(radius, inLen / 2, outLen / 2);
    const ax = cur[0] + ((prev[0] - cur[0]) / inLen) * ri;
    const ay = cur[1] + ((prev[1] - cur[1]) / inLen) * ri;
    const bx = cur[0] + ((next[0] - cur[0]) / outLen) * ri;
    const by = cur[1] + ((next[1] - cur[1]) / outLen) * ri;
    if (i === 0) ctx.moveTo(ax, ay);
    else ctx.lineTo(ax, ay);
    ctx.quadraticCurveTo(cur[0], cur[1], bx, by);
  }
  ctx.closePath();
}

/* ========================== periodic running marks ======================== */

/**
 * A displacement profile, carrying the largest displacement it can produce.
 *
 * The amplitude rides along because the marks that use a profile have to
 * declare how far their ink reaches, and a span that forgets the wave is a span
 * that fails to wrap a stripe which happened to bow past the edge. None of the
 * current patterns bow that far; the point is that the next one to be tuned
 * cannot break the wrap silently.
 */
interface Profile {
  (t: number): number;
  amp: number;
}

/**
 * A profile that is exactly periodic over the tile.
 *
 * `k` MUST be an integer: this is the whole reason a running stripe can cross
 * the tile edge at all. At t = 0 and t = size the sine has completed `k` whole
 * turns, so the two edges of the tile are the same number rather than two
 * numbers that happen to be close.
 */
function periodic(size: number, amp: number, k: number, phase: number): Profile {
  const w = (Math.PI * 2 * Math.max(1, Math.round(k))) / (size || 1);
  const f = (t: number): number => Math.sin(t * w + phase) * amp;
  f.amp = Math.abs(amp);
  return f;
}

/** Samples along the running axis. 96 is smooth at any tile we bake. */
const RUN_SAMPLES = 96;
/** How far a running mark overshoots the tile so its caps are never in shot. */
const RUN_OVERSHOOT = 6;

/**
 * A band running top-to-bottom (`axis = 'y'`) or left-to-right (`axis = 'x'`),
 * centred on `centre`, of half-width `half`, its centre-line displaced by a
 * periodic profile.
 *
 * The path closes OUTSIDE the tile at both ends, so the flat cap never lands
 * on the seam; only the two long edges are ever stroked.
 */
function runningBand(
  size: number,
  axis: 'x' | 'y',
  centre: number,
  half: number,
  profile: Profile,
  width: number,
  relief = 0,
): Mark {
  const t0 = -RUN_OVERSHOOT;
  const t1 = size + RUN_OVERSHOOT;
  const at = (t: number, side: -1 | 1): [number, number] => {
    const v = centre + profile(t) + side * half;
    return axis === 'y' ? [v, t] : [t, v];
  };

  const trace = (ctx: FlatCtx): void => {
    ctx.beginPath();
    for (let i = 0; i <= RUN_SAMPLES; i++) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, -1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = RUN_SAMPLES; i >= 0; i--) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, 1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  const edge = (ctx: FlatCtx, side: -1 | 1): void => {
    ctx.beginPath();
    for (let i = 0; i <= RUN_SAMPLES; i++) {
      const [x, y] = at(t0 + ((t1 - t0) * i) / RUN_SAMPLES, side);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  const reach = half + width + relief + profile.amp;
  const span: [number, number] = [centre - reach, centre + reach];
  return {
    spanX: axis === 'y' ? span : null,
    spanY: axis === 'y' ? null : span,
    draw(ctx, pass, c) {
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      // The second face is offset ACROSS the band only. Offsetting along the
      // run would slide the path's far-off caps toward the tile and put one on
      // screen; across, the band is infinite and there is nothing to expose.
      if (pass === 'relief') ctx.translate(axis === 'y' ? relief : 0, axis === 'y' ? 0 : relief);
      trace(ctx);
      ctx.fillStyle = pass === 'relief' ? c.relief : c.face;
      ctx.fill();
      if (pass === 'face' && width > 0) {
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = width;
        ctx.lineCap = 'butt';
        for (const side of [-1, 1] as const) {
          edge(ctx, side);
          ctx.stroke();
        }
        ctx.lineCap = 'round';
      }
      ctx.restore();
    },
  };
}

/** A single running line — a pinstripe, a chevron, a rule. No fill. */
function runningLine(
  size: number,
  axis: 'x' | 'y',
  centre: number,
  profile: Profile,
  width: number,
  colour: (c: WallpaperColours) => string,
): Mark {
  const t0 = -RUN_OVERSHOOT;
  const t1 = size + RUN_OVERSHOOT;
  const reach = width + profile.amp;
  const span: [number, number] = [centre - reach, centre + reach];
  return {
    spanX: axis === 'y' ? span : null,
    spanY: axis === 'y' ? null : span,
    draw(ctx, pass, c) {
      // A hairline has no silhouette worth a second face; the relief pass
      // widens it a hair instead of offsetting it, which would only read as a
      // doubled line.
      if (pass === 'relief') return;
      ctx.beginPath();
      for (let i = 0; i <= RUN_SAMPLES; i++) {
        const t = t0 + ((t1 - t0) * i) / RUN_SAMPLES;
        const v = centre + profile(t);
        const x = axis === 'y' ? v : t;
        const y = axis === 'y' ? t : v;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = colour(c);
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.stroke();
      ctx.lineCap = 'round';
    },
  };
}

/**
 * A zigzag running left-to-right, `k` full teeth across the tile.
 *
 * Integer `k` again: the triangle wave's value at x = 0 and x = size is the
 * same, so the chevron's point lands identically on both edges.
 */
function zigzag(
  size: number,
  centre: number,
  amp: number,
  k: number,
  width: number,
  phase: number,
  relief = 0,
): Mark {
  const teeth = Math.max(1, Math.round(k));
  const span: [number, number] = [centre - amp - width - relief, centre + amp + width + relief];
  const trace = (ctx: FlatCtx): void => {
    const period = size / teeth;
    ctx.beginPath();
    // Two extra teeth off each end so the mitre sitting on the seam is a real
    // mitre and not a line cap.
    for (let i = -2; i <= teeth * 2 + 2; i++) {
      const x = (i / 2) * period + phase;
      const y = centre + (i % 2 === 0 ? -amp : amp);
      if (i === -2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  return {
    spanX: null,
    spanY: span,
    draw(ctx, pass, c) {
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      if (pass === 'relief') ctx.translate(0, relief);
      trace(ctx);
      ctx.strokeStyle = pass === 'relief' ? c.relief : c.face;
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.stroke();
      if (pass === 'face') {
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = Math.max(0.8, width * 0.22);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
      ctx.restore();
    },
  };
}

/* ============================== the motifs =============================== */

/**
 * Where a motif sits on the lattice.
 *
 * A motif that flips, mirrors or turns has to do it from the CELL, not from a
 * random seed: a herringbone whose bars lean at random is a heap of sticks, and
 * a laurel that mirrors at random reads as a mistake rather than as a repeat.
 */
interface CellAt {
  col: number;
  row: number;
  /** True for the interstitial point of a `diamond` lattice. */
  alt: boolean;
}

/**
 * A motif draws itself around the origin, out to roughly `r`, in `c`.
 *
 * `seed` is derived from the LATTICE INDEX and never from the position, which
 * is what lets a wrapped copy come out identical: the copy is the same seed
 * under a translate.
 */
type MotifFn = (ctx: FlatCtx, r: number, seed: number, c: WallpaperColours, at: CellAt) => void;

/** A dot with a slightly uneven rim. */
const dot: MotifFn = (ctx, r, seed, c) => {
  blob(ctx, r * 0.5, seed, 6, 0.06);
  ink(ctx, c, motifInk(r * 0.5));
};

/** Five-point star with a pip in the middle. */
const star: MotifFn = (ctx, r, seed, c) => {
  ctx.save();
  ctx.rotate(jitter(seed) * 0.16);
  starPath(ctx, r * 0.52);
  ink(ctx, c, motifInk(r * 0.5));
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
};

/** A crescent moon with a small star tucked into its horn. */
const moonstar: MotifFn = (ctx, r, seed, c) => {
  const R = r * 0.72;
  const w = motifInk(R);
  // Crescent as a lune: outer circle minus a circle pushed off to the right.
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI * 0.42, Math.PI * 1.58, false);
  ctx.arc(R * 0.52, 0, R * 0.92, Math.PI * 1.42, Math.PI * 0.58, true);
  ctx.closePath();
  ink(ctx, c, w);
  ctx.save();
  ctx.translate(R * 0.86, -R * 0.72);
  ctx.rotate(jitter(seed + 3) * 0.3);
  starPath(ctx, R * 0.34);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(0.7, w * 0.6);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
};

/**
 * A stem with two pairs of leaves and a bud. The workhorse floral.
 *
 * The leaves have to be BROAD to survive being drawn 40px tall on a wall that
 * is behind everything else — the first version had them at a fifth of the
 * motif and the whole repeat read as a field of lollipops.
 */
const sprig: MotifFn = (ctx, r, seed, c) => {
  const h = r * 0.96;
  const w = motifInk(r * 0.6);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.2);
  // Stem.
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.quadraticCurveTo(r * 0.1, 0, 0, -h * 0.42);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
  // Four leaves in two pairs, the lower pair larger — a plant, not a symbol.
  for (const [t, side, len] of [
    [0.44, 1, 0.72],
    [0.24, -1, 0.62],
    [0.02, 1, 0.5],
    [-0.16, -1, 0.42],
  ] as const) {
    ctx.save();
    ctx.translate(0, h * t);
    leaf(ctx, r * len * side, r * len * 0.42 * side, side > 0 ? -1.15 : 1.15);
    ink(ctx, c, w * 0.85);
    ctx.restore();
  }
  // Bud. Small: at a quarter of the motif it stopped being a bud and the whole
  // repeat read as a field of lollipops.
  ctx.save();
  ctx.translate(0, -h * 0.44);
  blob(ctx, r * 0.17, seed + 5, 6, 0.1);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.85;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
};

/**
 * A laurel branch: an arc with broad leaves paired along it, a berry at the
 * tip.
 *
 * Mirrored by ROW rather than by seed. A laurel that flips at random reads as a
 * printing fault; flipped a row at a time it reads as a repeat with a rhythm,
 * which is what the real papers do.
 */
const laurel: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.7);
  const flip = at.row % 2 === 0 ? 1 : -1;
  // The branch as a quadratic from tail to tip, so the leaves can be hung off
  // the curve itself rather than off an approximation of it.
  const p0 = [-r * 0.78, r * 0.52] as const;
  const p1 = [r * 0.06, r * 0.3] as const;
  const p2 = [r * 0.72, -r * 0.6] as const;
  const on = (t: number): [number, number] => [
    (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];

  ctx.save();
  ctx.rotate(jitter(seed + 1) * 0.16);
  ctx.scale(flip, 1);
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const t = 0.1 + i * 0.24;
    const [bx, by] = on(t);
    const [nx, ny] = on(t + 0.01);
    const tilt = Math.atan2(ny - by, nx - bx);
    for (const side of [1, -1] as const) {
      ctx.save();
      ctx.translate(bx, by);
      // Leaves splay off the branch at a fixed angle to the tangent, so the
      // spray narrows toward the tip the way a real one does.
      ctx.rotate(tilt + side * 1.05);
      // `leaf` grows along +y, so -90° aims it down the rotation just applied.
      leaf(ctx, r * 0.52, r * 0.19, -Math.PI / 2);
      ink(ctx, c, w * 0.75);
      ctx.restore();
    }
  }
  ctx.beginPath();
  ctx.arc(p2[0], p2[1], r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
  ctx.restore();
};

/**
 * The damask: an ogee frame with a fan of leaves inside and a crown on top.
 *
 * Mirror-symmetric about its axis because that is what makes a damask read as
 * a damask rather than as a plant — the whole style is a heraldic device
 * repeated, and asymmetry breaks it.
 */
const damask: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8);
  const H = r * 0.98;
  const W = r * 0.66;
  // Ogee: a pointed oval, wider at the shoulders than at the waist.
  ctx.beginPath();
  ctx.moveTo(0, -H);
  ctx.bezierCurveTo(W * 0.9, -H * 0.62, W, -H * 0.05, W * 0.44, H * 0.46);
  ctx.bezierCurveTo(W * 0.24, H * 0.75, W * 0.1, H * 0.9, 0, H);
  ctx.bezierCurveTo(-W * 0.1, H * 0.9, -W * 0.24, H * 0.75, -W * 0.44, H * 0.46);
  ctx.bezierCurveTo(-W, -H * 0.05, -W * 0.9, -H * 0.62, 0, -H);
  ctx.closePath();
  ink(ctx, c, w);

  // Inner fan of three leaves, in the ink colour so the frame stays the shape.
  for (const [tilt, len] of [
    [0, 0.62],
    [-0.62, 0.46],
    [0.62, 0.46],
  ] as const) {
    ctx.save();
    ctx.translate(0, H * 0.36);
    leaf(ctx, -H * len, W * 0.3, tilt);
    ctx.fillStyle = c.ink;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Crown pip.
  ctx.beginPath();
  ctx.arc(0, -H * 0.72, r * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.65;
  ctx.stroke();
  // Two side scrolls, which is what stops an ogee looking like an egg.
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * W * 0.86, -H * 0.12);
    ctx.rotate(side * 0.5 + jitter(seed) * 0.06);
    leaf(ctx, r * 0.34, r * 0.12, side > 0 ? -1.9 : 1.9);
    ink(ctx, c, w * 0.7);
    ctx.restore();
  }
};

/** A perched bird on a twig — the chinoiserie note. Faces by column. */
const bird: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.8);
  const flip = (at.col + at.row) % 2 === 0 ? 1 : -1;
  ctx.save();
  ctx.scale(flip, 1);
  ctx.rotate(jitter(seed) * 0.08);

  // Twig with two leaves, under the bird's feet.
  ctx.beginPath();
  ctx.moveTo(-r * 0.86, r * 0.5);
  ctx.quadraticCurveTo(0, r * 0.72, r * 0.8, r * 0.42);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.lineCap = 'round';
  ctx.stroke();
  for (const [bx, tilt] of [
    [-r * 0.5, 1.1],
    [r * 0.46, -1.1],
  ] as const) {
    ctx.save();
    ctx.translate(bx, r * 0.6);
    leaf(ctx, r * 0.3, r * 0.1, tilt);
    ink(ctx, c, w * 0.7);
    ctx.restore();
  }

  // Body: a teardrop leaning forward, tail sweeping back and up.
  ctx.beginPath();
  ctx.moveTo(r * 0.42, -r * 0.36);
  ctx.bezierCurveTo(r * 0.66, -r * 0.1, r * 0.5, r * 0.34, r * 0.06, r * 0.42);
  ctx.bezierCurveTo(-r * 0.3, r * 0.48, -r * 0.52, r * 0.3, -r * 0.86, r * 0.06);
  ctx.bezierCurveTo(-r * 0.5, r * 0.06, -r * 0.28, -r * 0.12, -r * 0.06, -r * 0.34);
  ctx.bezierCurveTo(r * 0.08, -r * 0.5, r * 0.28, -r * 0.52, r * 0.42, -r * 0.36);
  ctx.closePath();
  ink(ctx, c, w);

  // Wing: one closed leaf on the flank, ink-toned so it reads as a fold.
  ctx.save();
  ctx.translate(r * 0.06, r * 0.02);
  leaf(ctx, r * 0.52, r * 0.2, -2.5);
  ctx.fillStyle = c.ink;
  ctx.globalAlpha = 0.42;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
  ctx.restore();

  // Head, beak, eye.
  ctx.beginPath();
  ctx.arc(r * 0.44, -r * 0.44, r * 0.2, 0, Math.PI * 2);
  ink(ctx, c, w * 0.85);
  ctx.beginPath();
  ctx.moveTo(r * 0.6, -r * 0.48);
  ctx.lineTo(r * 0.92, -r * 0.38);
  ctx.lineTo(r * 0.6, -r * 0.32);
  ctx.closePath();
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 0.46, -r * 0.48, Math.max(0.8, r * 0.05), 0, Math.PI * 2);
  ctx.fillStyle = c.ink;
  ctx.fill();
  ctx.restore();
};

/**
 * A toile vignette: a cottage, a tree and a ground line inside an oval frame.
 *
 * Toile is a SCENE repeated, and the joke of it only lands if the scene is
 * legible at a glance — so this is drawn large and used only at the bigger
 * scales.
 */
const toile: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.9);
  ctx.save();
  ctx.rotate(jitter(seed) * 0.04);

  // Frame.
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r * 0.78, 0, 0, Math.PI * 2);
  ink(ctx, c, w);

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r * 0.78, 0, 0, Math.PI * 2);
  ctx.clip();

  const ground = r * 0.4;
  // Ground line.
  ctx.beginPath();
  ctx.moveTo(-r, ground);
  ctx.quadraticCurveTo(0, ground - r * 0.1, r, ground);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.stroke();

  // Cottage: a box with a pitched roof and a door.
  const hw = r * 0.3;
  const hh = r * 0.36;
  ctx.beginPath();
  ctx.rect(-r * 0.52, ground - hh, hw * 2, hh);
  ctx.fillStyle = c.ground;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, ground - hh);
  ctx.lineTo(-r * 0.52 + hw, ground - hh - r * 0.3);
  ctx.lineTo(-r * 0.44 + hw * 2, ground - hh);
  ctx.closePath();
  ctx.fillStyle = c.accent;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(-r * 0.32, ground - hh * 0.62, hw * 0.4, hh * 0.62);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.6;
  ctx.stroke();

  // Tree: a blobby crown on a short trunk.
  ctx.save();
  ctx.translate(r * 0.42, ground - r * 0.34);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.34);
  ctx.lineTo(0, -r * 0.02);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.9;
  ctx.stroke();
  blob(ctx, r * 0.26, seed + 9, 8, 0.16);
  ctx.fillStyle = c.ground;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.8;
  ctx.stroke();
  ctx.restore();

  // Two birds, because an empty sky reads as an unfinished drawing.
  for (const [bx, by, s] of [
    [-r * 0.34, -r * 0.44, 1],
    [r * 0.1, -r * 0.56, 0.7],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.11 * s, by);
    ctx.quadraticCurveTo(bx - r * 0.05 * s, by - r * 0.07 * s, bx, by);
    ctx.quadraticCurveTo(bx + r * 0.05 * s, by - r * 0.07 * s, bx + r * 0.11 * s, by);
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = w * 0.6;
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
};

/** A rounded arch — a colonnade seen flat on. */
const arch: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8);
  const hw = r * 0.56;
  const hh = r * 0.9;
  ctx.beginPath();
  ctx.moveTo(-hw, hh);
  ctx.lineTo(-hw, -hh * 0.16);
  ctx.quadraticCurveTo(-hw, -hh, 0, -hh);
  ctx.quadraticCurveTo(hw, -hh, hw, -hh * 0.16);
  ctx.lineTo(hw, hh);
  ctx.closePath();
  ink(ctx, c, w);
  // Inner keystone line, so an arch is an arch and not a tombstone.
  ctx.beginPath();
  ctx.moveTo(-hw * 0.62, hh);
  ctx.lineTo(-hw * 0.62, -hh * 0.14);
  ctx.quadraticCurveTo(-hw * 0.62, -hh * 0.66, 0, -hh * 0.66);
  ctx.quadraticCurveTo(hw * 0.62, -hh * 0.66, hw * 0.62, -hh * 0.14);
  ctx.lineTo(hw * 0.62, hh);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w * 0.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -hh * 0.82, r * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  void seed;
};

/** One overlapping scale of a fish-scale repeat. */
const scallop: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.bezierCurveTo(-r, r * 1.28, r, r * 1.28, r, 0);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
  // A second, tighter arc inside — the shell line.
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, r * 0.12);
  ctx.bezierCurveTo(-r * 0.6, r * 0.86, r * 0.6, r * 0.86, r * 0.6, r * 0.12);
  ctx.lineWidth = w * 0.6;
  ctx.stroke();
  void seed;
  void c.face;
};

/** A hexagon outline with a pip in the middle. */
const honeycombCell: MotifFn = (ctx, r, seed, c) => {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  roundedPoly(ctx, pts, r * 0.18);
  ink(ctx, c, motifInk(r));
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = c.accent;
  ctx.fill();
  void seed;
};

/** A trellis diamond: a rounded lozenge outline with a leaf at each waist. */
const trellisCell: MotifFn = (ctx, r, seed, c) => {
  const w = motifInk(r * 0.8);
  roundedPoly(
    ctx,
    [
      [0, -r],
      [r, 0],
      [0, r],
      [-r, 0],
    ],
    r * 0.34,
  );
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.stroke();
  for (const side of [1, -1] as const) {
    ctx.save();
    ctx.translate(side * r * 0.86, 0);
    leaf(ctx, r * 0.34 * side, r * 0.12 * side, side > 0 ? -1.57 : 1.57);
    ink(ctx, c, w * 0.7);
    ctx.restore();
  }
  void seed;
};

/**
 * One woven bar of a herringbone.
 *
 * The lean comes from `col + row`, not from the seed: a herringbone is a WEAVE,
 * and a weave whose bars lean at random is a heap of sticks. With the brick
 * lattice's half-step, `col + row` puts each bar's end against the next bar's
 * flank, which is the whole look.
 */
const herringboneBar: MotifFn = (ctx, r, seed, c, at) => {
  const w = motifInk(r * 0.7);
  ctx.save();
  ctx.rotate(((at.col + at.row) % 2 === 0 ? 1 : -1) * (Math.PI / 4));
  roundedPoly(
    ctx,
    [
      [-r, -r * 0.3],
      [r, -r * 0.3],
      [r, r * 0.3],
      [-r, r * 0.3],
    ],
    r * 0.22,
  );
  ink(ctx, c, w);
  ctx.restore();
  void seed;
};

/**
 * A gingham crossing — the square where warp meets weft.
 *
 * Rounded, because a hard-cornered rectangle is the one shape the icon's
 * language does not contain, and a wall of them reads as a spreadsheet.
 */
const ginghamCross: MotifFn = (ctx, r, seed, c) => {
  roundedPoly(
    ctx,
    [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ],
    r * 0.36,
  );
  ctx.fillStyle = c.relief;
  ctx.fill();
  void seed;
};

const MOTIFS: Partial<Record<WallpaperPattern, MotifFn>> = {
  polka: dot,
  star,
  moonstar,
  sprig,
  laurel,
  damask,
  bird,
  toile,
  arch,
  scallop,
  honeycomb: honeycombCell,
  trellis: trellisCell,
  herringbone: herringboneBar,
  gingham: ginghamCross,
};

/* ============================== the lattices ============================= */

/**
 * How a pattern arranges its cells.
 *
 * `halfdrop` shifts every other COLUMN down by half a cell, `brick` shifts
 * every other ROW along by half — the two arrangements that keep a repeat from
 * reading as a grid of stamps. Both need an EVEN count on the shifted axis or
 * the drop does not close across the tile, which `fitCount` enforces.
 */
type Lattice = 'grid' | 'halfdrop' | 'brick' | 'diamond';

/** Per-pattern nominal cell multiplier and arrangement. */
interface PatternPlan {
  lattice: Lattice;
  /** Cell size relative to the scale's nominal cell. */
  cell: number;
  /** Motif radius as a fraction of the pitch named by `radiusFrom`. */
  radius: number;
  /** Rows are this fraction of the column pitch (1 = square cells). */
  aspect: number;
  /**
   * Which fitted pitch the radius is measured against.
   *
   * `min` suits a motif that must not touch its neighbours. A motif that is
   * MEANT to meet its neighbours edge to edge — a hexagon, a fish-scale — has
   * to measure against the axis it meets along, or a non-square cell shrinks it
   * out of contact and the field falls apart into confetti.
   */
  radiusFrom: 'min' | 'col' | 'row';
}

const PLANS: Record<WallpaperPattern, PatternPlan> = {
  plain: { lattice: 'grid', cell: 1, radius: 0, aspect: 1, radiusFrom: 'min' },
  stripe: { lattice: 'grid', cell: 1.15, radius: 0, aspect: 1, radiusFrom: 'min' },
  pinstripe: { lattice: 'grid', cell: 0.5, radius: 0, aspect: 1, radiusFrom: 'min' },
  ticking: { lattice: 'grid', cell: 1.05, radius: 0, aspect: 1, radiusFrom: 'min' },
  gingham: { lattice: 'grid', cell: 0.9, radius: 0.5, aspect: 1, radiusFrom: 'min' },
  chevron: { lattice: 'grid', cell: 1.1, radius: 0, aspect: 1, radiusFrom: 'min' },
  herringbone: { lattice: 'brick', cell: 0.72, radius: 0.6, aspect: 1, radiusFrom: 'min' },
  // 0.866 and 0.577 are not taste: they are what makes a pointy-top hexagon
  // grid close. Width √3·R across, 1.5·R down.
  honeycomb: { lattice: 'brick', cell: 0.95, radius: 0.577, aspect: 0.866, radiusFrom: 'col' },
  trellis: { lattice: 'grid', cell: 1, radius: 0.5, aspect: 1, radiusFrom: 'min' },
  scallop: { lattice: 'brick', cell: 1, radius: 0.5, aspect: 0.56, radiusFrom: 'col' },
  arch: { lattice: 'grid', cell: 1.05, radius: 0.62, aspect: 1.2, radiusFrom: 'col' },
  polka: { lattice: 'diamond', cell: 1.15, radius: 0.42, aspect: 1, radiusFrom: 'min' },
  star: { lattice: 'diamond', cell: 1.25, radius: 0.46, aspect: 1, radiusFrom: 'min' },
  moonstar: { lattice: 'halfdrop', cell: 1.1, radius: 0.46, aspect: 1, radiusFrom: 'min' },
  sprig: { lattice: 'halfdrop', cell: 1.05, radius: 0.44, aspect: 1.1, radiusFrom: 'min' },
  laurel: { lattice: 'halfdrop', cell: 1.2, radius: 0.44, aspect: 1, radiusFrom: 'min' },
  damask: { lattice: 'halfdrop', cell: 1.5, radius: 0.44, aspect: 1.25, radiusFrom: 'min' },
  bird: { lattice: 'halfdrop', cell: 1.7, radius: 0.44, aspect: 1, radiusFrom: 'min' },
  toile: { lattice: 'halfdrop', cell: 2.1, radius: 0.46, aspect: 1, radiusFrom: 'min' },
};

/**
 * How many cells fit across `size`, as an exact integer count.
 *
 * The lattice is fitted to the tile, never the other way round: whatever cell
 * the scale asked for, the one actually drawn is `size / count`, so the repeat
 * closes exactly and the motif merely comes out a few percent off nominal. A
 * lattice that shifts alternate rows or columns needs that count to be even,
 * or the shifted half lands on the unshifted half across the seam.
 */
function fitCount(size: number, cell: number, even: boolean, min = 2): number {
  const raw = Math.max(min, Math.round(size / Math.max(1, cell)));
  if (!even) return raw;
  return Math.max(min % 2 === 0 ? min : min + 1, raw % 2 === 0 ? raw : raw + 1);
}

const ORIGIN_CELL: CellAt = { col: 0, row: 0, alt: false };

/** A motif placed on the lattice, ready to be wrapped by {@link emit}. */
function motifMark(
  cx: number,
  cy: number,
  r: number,
  seed: number,
  relief: number,
  fn: MotifFn,
  at: CellAt = ORIGIN_CELL,
): Mark {
  // Generous: a motif's own paths stay inside r, but leaves, beaks and ink
  // width push past it, and a span that is too small is the one bug in this
  // module that produces a seam. Over-declaring costs an extra draw call.
  const pad = r * 1.5 + relief + 4;
  return {
    spanX: [cx - pad, cx + pad],
    spanY: [cy - pad, cy + pad],
    draw(ctx, pass, c) {
      const off = pass === 'relief' ? relief : 0;
      if (pass === 'relief' && relief <= 0) return;
      ctx.save();
      ctx.translate(cx + off, cy + off);
      fn(ctx, r, seed, pass === 'relief' ? reliefColours(c) : c, at);
      ctx.restore();
    },
  };
}

/**
 * Walk a lattice, handing each cell centre to `place` along with the pitch that
 * was actually fitted (which is never quite the nominal cell).
 */
function lattice(
  size: number,
  plan: PatternPlan,
  nominal: number,
  place: (cx: number, cy: number, index: number, colW: number, rowH: number, at: CellAt) => void,
): void {
  // A half-drop or brick lattice needs an EVEN count on the shifted axis, or
  // the shifted half meets the unshifted half across the seam. Everything else
  // may go down to a single cell, which is what lets a grand toile show one
  // large vignette in a tile rather than four small ones.
  const wantEvenCols = plan.lattice === 'halfdrop';
  const wantEvenRows = plan.lattice === 'brick';
  const cols = fitCount(size, nominal * plan.cell, wantEvenCols, wantEvenCols ? 2 : 1);
  const rows = fitCount(size, nominal * plan.cell * plan.aspect, wantEvenRows, wantEvenRows ? 2 : 1);
  const colW = size / cols;
  const rowH = size / rows;

  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dropY = plan.lattice === 'halfdrop' && col % 2 === 1 ? rowH / 2 : 0;
      const dropX = plan.lattice === 'brick' && row % 2 === 1 ? colW / 2 : 0;
      place((col + 0.5) * colW + dropX, (row + 0.5) * rowH + dropY, index++, colW, rowH, {
        col,
        row,
        alt: false,
      });
      if (plan.lattice === 'diamond') {
        // The interstitial half-step, which is what turns a grid of dots into
        // a field of them. Offset index stream so the two populations wobble
        // independently rather than in lockstep.
        place((col + 1) * colW, (row + 1) * rowH, index++ + 0x5000, colW, rowH, {
          col,
          row,
          alt: true,
        });
      }
    }
  }
}

/* ============================ the tile builder =========================== */

/**
 * Build the mark list for one tile.
 *
 * Separated from the drawing so a test can count and bound the marks without a
 * canvas, and so the two passes share one list rather than re-deriving it.
 */
function buildMarks(size: number, spec: WallpaperSpec, seed: number): Mark[] {
  const plan = PLANS[spec.pattern];
  const nominal = SCALE_CELL[spec.scale];
  const relief = DEPTH_OFFSET[spec.depth] * nominal * plan.cell;
  const marks: Mark[] = [];

  switch (spec.pattern) {
    case 'plain':
      break;

    case 'stripe': {
      // Broad bands with a lazy wave in them, half the pitch wide.
      const n = fitCount(size, nominal * plan.cell, false);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        marks.push(
          runningBand(
            size,
            'y',
            centre,
            pitch * 0.27,
            periodic(size, pitch * 0.045, 1, i * 1.7),
            Math.max(0.9, pitch * 0.05),
            relief,
          ),
        );
      }
      break;
    }

    case 'pinstripe': {
      // A hairline every pitch, with a second, fainter one between — the
      // difference between "pinstripe" and "narrow stripe".
      const n = fitCount(size, nominal * plan.cell, false, 4);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const w = Math.max(0.9, pitch * 0.075);
        marks.push(
          runningLine(size, 'y', centre, periodic(size, pitch * 0.05, 1, i * 2.3), w, (c) => c.ink),
        );
        marks.push(
          runningLine(
            size,
            'y',
            centre + pitch * 0.5,
            periodic(size, pitch * 0.04, 1, i * 1.1 + 0.9),
            w * 0.6,
            (c) => c.face,
          ),
        );
      }
      break;
    }

    case 'ticking': {
      // Mattress ticking: a solid band flanked by a thin twin.
      const n = fitCount(size, nominal * plan.cell, false);
      const pitch = size / n;
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        const wave = periodic(size, pitch * 0.04, 1, i * 0.9);
        marks.push(
          runningBand(size, 'y', centre, pitch * 0.14, wave, Math.max(0.8, pitch * 0.04), relief),
        );
        // The twins are INK, not face: mattress ticking is a broad band with a
        // hairline either side of it, and a face-coloured twin on a
        // face-coloured band is nothing at all.
        for (const off of [-0.32, 0.32] as const) {
          marks.push(
            runningLine(
              size,
              'y',
              centre + pitch * off,
              wave,
              Math.max(0.8, pitch * 0.035),
              (c) => c.ink,
            ),
          );
        }
      }
      break;
    }

    case 'gingham': {
      // Warp, weft, then the deeper squares where they cross.
      const n = fitCount(size, nominal * plan.cell, false);
      const pitch = size / n;
      const half = pitch * 0.26;
      // One shared wave per axis, so the crossing squares can be displaced by
      // exactly the same amount the two bands are and land back on the
      // intersection. A gingham whose checks slid off its stripes would read as
      // a rendering fault rather than as a hand-drawn check.
      const warp = periodic(size, pitch * 0.035, 1, 0.6);
      const weft = periodic(size, pitch * 0.035, 1, 2.1);
      for (let i = 0; i < n; i++) {
        const centre = (i + 0.5) * pitch;
        marks.push(runningBand(size, 'y', centre, half, warp, 0, relief));
        marks.push(runningBand(size, 'x', centre, half, weft, 0, relief));
      }
      for (let r = 0; r < n; r++) {
        for (let col = 0; col < n; col++) {
          const cx = (col + 0.5) * pitch;
          const cy = (r + 0.5) * pitch;
          marks.push(motifMark(cx + warp(cy), cy + weft(cx), half, 0, 0, ginghamCross));
        }
      }
      break;
    }

    case 'chevron': {
      const rows = fitCount(size, nominal * plan.cell, false);
      const teeth = fitCount(size, nominal * plan.cell * 1.1, false);
      const rowH = size / rows;
      for (let i = 0; i < rows; i++) {
        marks.push(
          zigzag(size, (i + 0.5) * rowH, rowH * 0.22, teeth, Math.max(1.4, rowH * 0.3), 0, relief),
        );
      }
      break;
    }

    default: {
      // Everything else is a motif on a lattice.
      const fn = MOTIFS[spec.pattern];
      if (fn === undefined) break;
      // `colW`/`rowH` are only known once the lattice has been fitted, so the
      // radius is resolved inside the walk rather than up front.
      lattice(size, plan, nominal, (cx, cy, index, colW, rowH, at) => {
        const pitch =
          plan.radiusFrom === 'col' ? colW : plan.radiusFrom === 'row' ? rowH : Math.min(colW, rowH);
        // Math.imul: the plain product overflows the float mantissa and the
        // mixing degrades to whatever survived the rounding.
        const s = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
        marks.push(motifMark(cx, cy, pitch * plan.radius, s, relief, fn, at));
      });
      break;
    }
  }

  return marks;
}

/* ============================== the exports ============================== */

/**
 * Draw one wallpaper tile into `ctx`, filling `[0, size] × [0, size]`.
 *
 * `size` may be anything: the lattice is fitted to it. What the caller must
 * NOT do is draw the tile at a size other than the one it was rendered at and
 * expect it to still tile — the repeat closes at `size`, not at a multiple of
 * the cell.
 *
 * The context is clipped to the tile for the duration, so a caller may hand in
 * a bigger canvas (an atlas slot, a preview card) without the wrapped copies
 * leaking out of their box.
 */
export function renderWallpaperTile(ctx: FlatCtx, size: number, spec: WallpaperSpec): void {
  if (!(size > 0)) return;
  const c = wallpaperColours(spec);
  const seed = fnv1a(`${spec.pattern}|${spec.scale}|${spec.depth}|${spec.ink}`);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();

  ctx.fillStyle = c.ground;
  ctx.fillRect(0, 0, size, size);

  const marks = buildMarks(size, spec, seed);
  emit(ctx, size, marks, 'relief', c);
  emit(ctx, size, marks, 'face', c);

  ctx.restore();
}

/**
 * A sensible pixel size for a baked tile of this spec.
 *
 * Two competing wants: enough cells that the eye cannot latch onto the repeat,
 * and a texture small enough to be worth caching. Aim for a tile around 320
 * CSS px, and — the part that matters — make it a WHOLE NUMBER OF CELLS.
 *
 * A tile 1.45 cells wide is not merely 45% wasteful: `fitCount` rounds it to
 * one cell and stretches that cell to the full tile. A grand toile asked for at
 * 640px came out as a single vignette floating over a band of empty wall,
 * because 640 ÷ 353 rounds down. Sizing the tile FROM the cell instead of
 * clamping it afterwards removes the whole class of that bug.
 */
const TILE_TARGET_PX = 320;
const TILE_MAX_PX = 768;

export function wallpaperTilePx(spec: WallpaperSpec, dpr = 1): number {
  const plan = PLANS[spec.pattern];
  const cell = SCALE_CELL[spec.scale] * plan.cell;
  // Half-drop and brick need two cells to show their offset at all.
  const min = plan.lattice === 'halfdrop' || plan.lattice === 'brick' ? 2 : 1;
  const repeats = Math.max(min, Math.round(TILE_TARGET_PX / Math.max(1, cell)));
  const css = Math.min(TILE_MAX_PX, Math.max(96, Math.round(cell * repeats)));
  return Math.round(css * Math.max(1, dpr));
}

/**
 * Cache key for a rendered tile.
 *
 * Carries `flatSchemeTag()` because every colour in the tile is derived from
 * the live scheme — without it the disk cache would serve the athenaeum's
 * damask forever after the reader moved to the reef, which is the exact bug the
 * cover memo had.
 */
export function wallpaperTileKey(spec: WallpaperSpec, size: number, dpr = 1): string {
  return `wall|${flatSchemeTag()}|${spec.pattern}|${spec.scale}|${spec.depth}|${spec.ink}|${Math.round(size)}|${dpr}`;
}

/* ============================== the presets ============================== */

/** A named wallpaper, as offered in the picker. */
export interface WallpaperPreset {
  id: string;
  name: string;
  /** One line for the picker card. */
  blurb: string;
  spec: WallpaperSpec;
}

function paper(
  id: string,
  name: string,
  blurb: string,
  pattern: WallpaperPattern,
  scale: WallpaperScale,
  depth: WallpaperDepth,
  inkSlot: WallpaperInk,
): WallpaperPreset {
  return { id, name, blurb, spec: { pattern, scale, depth, ink: inkSlot } };
}

/**
 * The book of papers.
 *
 * Composed rather than enumerated: nineteen motifs across five scales, four
 * reliefs and six ink slots is 2280 combinations, and the job of a preset list
 * is to be the fifty that are actually worth hanging. Ordered roughly quiet →
 * loud, because that is the order someone shops in.
 */
export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [
  /* --- plain and near-plain --- */
  paper('plain-parchment', 'Plain Parchment', 'The wall, and nothing on it.', 'plain', 'medium', 'flat', 'paper'),
  paper('pin-quiet', 'Quiet Pinstripe', 'A hairline every inch, and a ghost between.', 'pinstripe', 'petite', 'flat', 'paper'),
  paper('pin-study', 'Study Pinstripe', 'Close-ruled in the case timber.', 'pinstripe', 'petite', 'flat', 'timber'),
  paper('pin-wide', 'Drawing Room Rule', 'Wider ruling, deeper ink.', 'pinstripe', 'small', 'flat', 'deep'),

  /* --- stripes --- */
  paper('stripe-regency', 'Regency Stripe', 'Broad bands with a lazy wave in them.', 'stripe', 'medium', 'low', 'paper'),
  paper('stripe-tea', 'Tea Room Stripe', 'Warm timber bands, gently raised.', 'stripe', 'medium', 'raised', 'timber'),
  paper('stripe-awning', 'Awning Stripe', 'Wide cloth bands, seaside-loud.', 'stripe', 'large', 'low', 'cloth'),
  paper('stripe-hall', 'Long Hall Stripe', 'Grand bands for a tall wall.', 'stripe', 'grand', 'raised', 'recess'),
  paper('ticking-mattress', 'Mattress Ticking', 'A solid band flanked by its thin twin.', 'ticking', 'small', 'flat', 'deep'),
  paper('ticking-linen', 'Linen Ticking', 'Ticking in pale timber.', 'ticking', 'medium', 'low', 'timber'),
  paper('ticking-cloth', 'Bindery Ticking', 'Ticking taken from the book cloth.', 'ticking', 'medium', 'flat', 'cloth'),

  /* --- checks and weaves --- */
  paper('gingham-kitchen', 'Kitchen Gingham', 'Warp, weft, and the darker square between.', 'gingham', 'small', 'flat', 'paper'),
  paper('gingham-picnic', 'Picnic Check', 'A bolder check in book cloth.', 'gingham', 'medium', 'flat', 'cloth'),
  paper('gingham-shadow', 'Shadow Check', 'Deep check, deeply set.', 'gingham', 'medium', 'raised', 'recess'),
  paper('herring-tweed', 'Tweed Herringbone', 'Little woven bars, both ways at once.', 'herringbone', 'petite', 'flat', 'paper'),
  paper('herring-parquet', 'Parquet Herringbone', 'The floor pattern, put on the wall.', 'herringbone', 'small', 'low', 'timber'),
  paper('herring-carved', 'Carved Herringbone', 'Woven, and standing off the plaster.', 'herringbone', 'medium', 'carved', 'timber'),
  paper('chevron-zig', 'Chevron', 'Rows of tidy zigzag.', 'chevron', 'small', 'flat', 'deep'),
  paper('chevron-bold', 'Bold Chevron', 'The same zigzag, three times the size.', 'chevron', 'large', 'flat', 'cloth'),

  /* --- geometrics --- */
  paper('honey-comb', 'Honeycomb', 'Hexagons with a gilt pip in each.', 'honeycomb', 'small', 'flat', 'gilt'),
  paper('honey-raised', 'Raised Honeycomb', 'Hexagons lifted off the wall.', 'honeycomb', 'medium', 'raised', 'timber'),
  paper('honey-grand', 'Grand Honeycomb', 'One big comb for a big room.', 'honeycomb', 'large', 'low', 'recess'),
  paper('trellis-garden', 'Garden Trellis', 'Lozenges with a leaf at every waist.', 'trellis', 'medium', 'flat', 'paper'),
  paper('trellis-conservatory', 'Conservatory Trellis', 'Trellis in painted timber.', 'trellis', 'large', 'low', 'timber'),
  paper('trellis-gilt', 'Gilt Trellis', 'A gilded lattice, raised.', 'trellis', 'medium', 'raised', 'gilt'),
  paper('scallop-shell', 'Scallop', 'Overlapping shells, small and even.', 'scallop', 'small', 'flat', 'paper'),
  paper('scallop-tide', 'Tide Scallop', 'Shells in the deeper wash.', 'scallop', 'medium', 'low', 'deep'),
  paper('scallop-grand', 'Grand Scallop', 'Big shells, carved out.', 'scallop', 'large', 'carved', 'recess'),
  paper('arch-cloister', 'Cloister Arches', 'A colonnade, drawn flat on.', 'arch', 'medium', 'low', 'paper'),
  paper('arch-reading', 'Reading Room Arches', 'Arches in the case timber.', 'arch', 'large', 'raised', 'timber'),
  paper('arch-gilt', 'Gilded Arcade', 'Arches with a gilt keystone.', 'arch', 'large', 'carved', 'gilt'),

  /* --- spots and stars --- */
  paper('polka-pin', 'Pin Spot', 'The smallest dot that still reads.', 'polka', 'petite', 'flat', 'deep'),
  paper('polka-parlour', 'Parlour Spot', 'An even field of soft dots.', 'polka', 'small', 'low', 'paper'),
  paper('polka-cloth', 'Bindery Spot', 'Dots taken from the book cloth.', 'polka', 'medium', 'raised', 'cloth'),
  paper('star-night', 'Star Field', 'Small stars, evenly sown.', 'star', 'small', 'flat', 'deep'),
  paper('star-gilt', 'Gilt Stars', 'Gold stars with a pale pip.', 'star', 'medium', 'low', 'gilt'),
  paper('star-grand', 'Grand Stars', 'Big stars, standing proud.', 'star', 'large', 'carved', 'cloth'),
  paper('moon-nursery', 'Moon and Star', 'A crescent with a star in its horn.', 'moonstar', 'small', 'flat', 'paper'),
  paper('moon-gilt', 'Gilded Crescents', 'Moons in gold leaf.', 'moonstar', 'medium', 'raised', 'gilt'),
  paper('moon-deep', 'Night Watch', 'Crescents in the deepest wash.', 'moonstar', 'medium', 'low', 'recess'),

  /* --- florals --- */
  paper('sprig-cottage', 'Cottage Sprig', 'A stem, two leaves and a bud.', 'sprig', 'small', 'flat', 'paper'),
  paper('sprig-meadow', 'Meadow Sprig', 'The same sprig, larger and lifted.', 'sprig', 'medium', 'low', 'cloth'),
  paper('sprig-shade', 'Shaded Sprig', 'Sprigs in the recess colour.', 'sprig', 'medium', 'raised', 'recess'),
  paper('laurel-wreath', 'Laurel', 'Branches with a berry at each tip.', 'laurel', 'medium', 'flat', 'paper'),
  paper('laurel-gilt', 'Gilt Laurel', 'Laurel in gold, standing off the wall.', 'laurel', 'medium', 'raised', 'gilt'),
  paper('laurel-grand', 'Grand Laurel', 'Laurel at ballroom scale.', 'laurel', 'large', 'low', 'timber'),
  paper('damask-athenaeum', 'Athenaeum Damask', 'The house damask — ogee, fan and crown.', 'damask', 'large', 'raised', 'paper'),
  paper('damask-quiet', 'Quiet Damask', 'The same device, barely there.', 'damask', 'medium', 'flat', 'paper'),
  paper('damask-timber', 'Tea-Stain Damask', 'Damask washed in the case timber.', 'damask', 'large', 'low', 'timber'),
  paper('damask-gilt', 'Gilt Damask', 'The grand one. Gold, and carved.', 'damask', 'grand', 'carved', 'gilt'),

  /* --- scenics --- */
  paper('bird-chinoiserie', 'Chinoiserie Birds', 'A bird on a twig, facing both ways.', 'bird', 'large', 'flat', 'paper'),
  paper('bird-gilt', 'Gilded Aviary', 'Birds in gold, lifted off the wall.', 'bird', 'large', 'raised', 'gilt'),
  paper('bird-cloth', 'Aviary Cloth', 'Birds in the binding colour.', 'bird', 'grand', 'low', 'cloth'),
  paper('toile-cottage', 'Cottage Toile', 'A house, a tree and two birds, in an oval.', 'toile', 'grand', 'flat', 'deep'),
  paper('toile-timber', 'Country Toile', 'The same vignette, washed warm.', 'toile', 'grand', 'low', 'timber'),
];

/** The wallpaper a library opens with — the wall as it has always been. */
export const DEFAULT_WALLPAPER_ID = 'plain-parchment';

const BY_ID = new Map(WALLPAPER_PRESETS.map((p) => [p.id, p]));

/**
 * The four values `settings.wallpaperPattern` has been storing since before
 * there was any wallpaper to draw, mapped to their nearest paper.
 *
 * Kept because the setting was live in the picker the whole time it was inert:
 * a reader who chose "botanical" three months ago picked something, and landing
 * them on a bare wall now would read as their choice having been thrown away.
 * Aliases only — none of these are offered, and nothing writes them back.
 */
const LEGACY_IDS: Readonly<Record<string, string>> = {
  plain: 'plain-parchment',
  damask: 'damask-athenaeum',
  stars: 'star-night',
  botanical: 'sprig-cottage',
  constellation: 'star-night',
};

/** Narrowing guard for persisted / user-supplied ids. Accepts legacy names. */
export function isWallpaperId(value: unknown): value is string {
  return typeof value === 'string' && (BY_ID.has(value) || value in LEGACY_IDS);
}

/**
 * Look up a preset. Unknown ids fall back to plain, the same way `getTheme`
 * falls back to the athenaeum — a library saved against a paper that has since
 * been renamed opens on a bare wall rather than failing to open.
 */
export function getWallpaper(id: string | null | undefined): WallpaperPreset {
  if (id === null || id === undefined) return BY_ID.get(DEFAULT_WALLPAPER_ID)!;
  return (
    BY_ID.get(id) ??
    BY_ID.get(LEGACY_IDS[id] ?? '') ??
    BY_ID.get(DEFAULT_WALLPAPER_ID)!
  );
}

/** The spec for an id, for callers that only want to draw. */
export function wallpaperSpec(id: string | null | undefined): WallpaperSpec {
  return getWallpaper(id).spec;
}

/* ---------------------------- preview drawing ---------------------------- */

/**
 * An offscreen square canvas, wherever we happen to be running.
 *
 * Workers have `OffscreenCanvas` and no `document`; older embeddings have the
 * reverse. Returns null in neither, which only happens under node, where
 * nothing draws a card anyway.
 */
function scratchCanvas(size: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  }
  return null;
}

/**
 * A picker card: the paper, with one shelf board sitting against it so the
 * reader can judge the pattern at the size it will actually be seen.
 *
 * Goes through an offscreen tile and `createPattern`, NOT through repeated
 * `translate` + `renderWallpaperTile` calls. That shortcut is what put a pale
 * cross through the middle of every card in the first specimen: the clip in
 * `renderWallpaperTile` lands on a fractional pixel when the tile pitch is not
 * an integer, and the antialiased clip edge shows as exactly the "white band"
 * this whole module exists to avoid. The tile itself was fine; the way it was
 * laid down was not. Any caller tiling this art has the same obligation —
 * integer texture, integer offsets.
 *
 * Uses the same tile renderer as the wall, so a card cannot preview a paper you
 * cannot get — the drift the case cards suffered when the shelf went flat and
 * the cards did not.
 */
export function drawWallpaperCard(ctx: FlatCtx, w: number, h: number, spec: WallpaperSpec): void {
  // The tile is drawn at its NATURAL size and then scaled DOWN through the
  // pattern transform, never re-rendered smaller: re-rendering refits the
  // lattice, which would show every paper at the same motif size and make the
  // scale picker look broken. Scaling the pattern keeps the ratio between motif
  // and card honest, and a repeat-mode pattern resamples with wraparound, so
  // the downscale cannot manufacture the seam this module exists to avoid.
  const size = Math.round(wallpaperTilePx(spec));
  const cell = SCALE_CELL[spec.scale] * PLANS[spec.pattern].cell;
  // Aim for a cell about half the card's short side — two-and-a-bit motifs,
  // which is the least that reads as a repeat rather than as a picture.
  const k = Math.max(0.18, Math.min(1, (Math.min(w, h) * 0.5) / cell));
  const scratch = scratchCanvas(size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  const sctx = scratch?.getContext('2d') ?? null;
  if (scratch !== null && sctx !== null) {
    renderWallpaperTile(sctx as FlatCtx, size, spec);
    const pattern = ctx.createPattern(scratch as CanvasImageSource, 'repeat');
    if (pattern !== null) {
      if (k < 1) pattern.setTransform({ a: k, b: 0, c: 0, d: k, e: 0, f: 0 });
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    ctx.fillStyle = wallpaperColours(spec).ground;
    ctx.fillRect(0, 0, w, h);
  }
  // A board and its contact shadow, so the paper is judged next to the timber
  // it has to live with rather than on its own.
  const room = flatScheme();
  const boardY = h * 0.74;
  const boardH = Math.max(4, h * 0.08);
  contactShadow(ctx, w / 2, boardY + boardH, w * 0.44, boardH * 0.4, 0.16);
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH);
  ctx.fillStyle = room.timberDark;
  ctx.fill();
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH * 0.72);
  ctx.fillStyle = room.timber;
  ctx.fill();
  stroke(ctx, w * 0.06, boardY, w * 0.94, boardY, FLAT.ink, Math.max(1, boardH * 0.14), 3);
  ctx.beginPath();
  ctx.rect(w * 0.06, boardY, w * 0.88, boardH);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = Math.max(1, boardH * 0.16);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
