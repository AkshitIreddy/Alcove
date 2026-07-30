/**
 * art/flora.ts — the flora & growth system (docs/design/library-themes.md §3).
 *
 * "The thing that makes a shelf feel alive." Ten species grow on the case
 * itself — over rail tops, out of joint gaps, down from shelf undersides,
 * across crowns and into corners — all deterministic per
 * `(floorIndex, anchorId, themeSeed)` and all baked once into ImageBitmaps.
 *
 * Three layers, in order:
 *
 *   1. **Plan**  `planFlora()` — pure math. Picks which anchors grow what, at
 *      what scale, and returns placements with honest world-space bounds.
 *      No canvas, no DOM: safe to run in a worker or a unit test.
 *   2. **Grow**  `growFlora()` — turns a placement into `FloraGeometry`
 *      (stems, leaves, blooms, threads, pots, tags) in anchor-local coords.
 *   3. **Draw**  `drawFlora()` / `renderFloraSprite()` / `bakeFloraLayer()` —
 *      Canvas2D rendering of that geometry, once, into a sprite.
 *
 * ## Occlusion rule (binding)
 *
 * Flora renders **behind books** and must never cover a spine's title area.
 * The compositor enforces this with:
 *   - draw order: the flora layer is composited *before* the spine atlas;
 *   - `spineTitleKeepOut()` → per-book keep-out rects;
 *   - `enforceKeepOut()` → shrinks, then drops, any placement that would
 *     reach into one. `planFlora({ keepOut })` runs it for you.
 *
 * Bounds are deliberately conservative (leaves are bounded by a circle of
 * radius `leafBoundRadius`), so a placement that passes keep-out has margin.
 */

import { clamp, lerp, mulberry32, seededNoise1D, fnv1a, type RandomFn } from './noise';
import type { NoiseFunction1D } from './noise';
import {
  drawBlossom,
  drawLeaf,
  hsl,
  leafBoundRadius,
  traceSmooth,
  type LeafShape,
  type Pt,
} from './leaves';
import { bakeCached } from './bake';
import { getGranulationTile, type Canvas2D, type Ctx2D } from './spines';

/** Bump when the growth model or drawing changes — invalidates baked sprites. */
export const FLORA_RECIPE_VERSION = 1;

/**
 * Flora is decoration: the shelf compositor drops the whole layer below this
 * LOD tier (see bookshelf-rendering.md's 3-tier LOD).
 */
export const FLORA_MIN_LOD = 1;

/* ================================= types ================================== */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The ten species from the design doc. */
export type FloraSpeciesId =
  | 'ivy'
  | 'pothos'
  | 'moss'
  | 'fern'
  | 'herbBundle'
  | 'blossom'
  | 'hearts'
  | 'potted'
  | 'grassTuft'
  | 'cobweb';

export const FLORA_SPECIES: readonly FloraSpeciesId[] = [
  'ivy',
  'pothos',
  'moss',
  'fern',
  'herbBundle',
  'blossom',
  'hearts',
  'potted',
  'grassTuft',
  'cobweb',
];

/** Where on the case a plant may take hold. */
export type FloraAnchorKind =
  | 'railTop'
  | 'shelfUnderside'
  | 'caseCorner'
  | 'crownTop'
  | 'jointGap'
  | 'potPosition';

export const FLORA_ANCHOR_KINDS: readonly FloraAnchorKind[] = [
  'railTop',
  'shelfUnderside',
  'caseCorner',
  'crownTop',
  'jointGap',
  'potPosition',
];

export type FloraDensity = 'none' | 'sparse' | 'lush';

/** Fraction of eligible anchors that grow something, before the slider. */
export const DENSITY_COVERAGE: Record<FloraDensity, number> = {
  none: 0,
  sparse: 0.34,
  lush: 0.86,
};

export type FloraFacing = 'up' | 'down' | 'left' | 'right';

/** A spot on the case that flora may grow from. `id` must be stable. */
export interface FloraAnchor {
  /** Stable identifier — part of the seed, so it must not change per frame. */
  id: string;
  kind: FloraAnchorKind;
  /** Attachment point, world px (the shelf compositor's coordinate space). */
  x: number;
  y: number;
  /** Primary growth direction. Defaults per `kind` (see `defaultFacing`). */
  facing?: FloraFacing;
  /** Mirror the growth laterally. Default: derived from the seed. */
  flip?: boolean;
  /** Run available along the anchor in px (rail width, gap width…). */
  run?: number;
}

/** Theme-level hue/tone push, so a theme can dry out or cool its planting. */
export interface FloraPalette {
  hueShift?: number;
  satShift?: number;
  lightShift?: number;
  /** Pencil colour for every outline. Default a dark warm graphite-green. */
  ink?: string;
}

/** A theme's flora recipe — `LibraryTheme.flora` in `art/themes.ts`. */
export interface FloraSpec {
  /** Candidate species; the planner picks per anchor from the eligible ones. */
  species: readonly FloraSpeciesId[];
  density: FloraDensity;
  /** Anchor kinds this theme allows. Omit ⇒ every kind is eligible. */
  eligibleAnchors?: readonly FloraAnchorKind[];
  palette?: FloraPalette;
}

/** One planted specimen, ready to grow/draw. */
export interface FloraPlacement {
  /** `${floorIndex}:${anchor.id}` — unique within a floor. */
  id: string;
  anchor: FloraAnchor;
  species: FloraSpeciesId;
  /** Full 32-bit seed derived from (floorIndex, anchorId, themeSeed). */
  seed: number;
  scale: number;
  flip: boolean;
  facing: FloraFacing;
  palette: FloraPalette;
  /** World-space bounding box of everything this specimen draws. */
  bounds: Rect;
}

/* ------------------------------- geometry -------------------------------- */

export interface Tone {
  h: number;
  s: number;
  l: number;
}

export interface StemGeom {
  pts: Pt[];
  widths: number[];
  tone: Tone;
  /** 0 = green shoot, 1 = woody branch (drawn browner, harder-edged). */
  woody: number;
}

export interface LeafGeom {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  shape: LeafShape;
  bend: number;
  curl: number;
  tone: Tone;
  /** Variegated (pale-streaked) leaf — pothos and some herbs. */
  pale: boolean;
  seed: number;
}

export type BloomKind = 'blossom' | 'bud' | 'dandelion' | 'puff' | 'capsule' | 'dust' | 'berry';

export interface BloomGeom {
  x: number;
  y: number;
  r: number;
  kind: BloomKind;
  /** 0 = closed bud, 1 = fully open. */
  open: number;
  tone: Tone;
  seed: number;
}

export interface ThreadGeom {
  pts: Pt[];
  width: number;
  alpha: number;
  colour: string;
}

export interface PotGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'terracotta' | 'brass' | 'enamel';
}

export interface TagGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

/** A soft contact shadow that grounds a specimen on the surface it sits on. */
export interface ShadeGeom {
  x: number;
  y: number;
  rx: number;
  ry: number;
  alpha: number;
}

export interface FloraGeometry {
  stems: StemGeom[];
  leaves: LeafGeom[];
  blooms: BloomGeom[];
  threads: ThreadGeom[];
  pots: PotGeom[];
  tags: TagGeom[];
  shades: ShadeGeom[];
  ink: string;
  /** Anchor-local bounding box (add the anchor position for world space). */
  bounds: Rect;
}

/* ================================ seeding ================================= */

/** The one and only seed derivation: `(floorIndex, anchorId, themeSeed)`. */
export function floraSeed(floorIndex: number, anchorId: string, themeSeed: number): number {
  return fnv1a(`flora|${FLORA_RECIPE_VERSION}|${floorIndex}|${anchorId}|${themeSeed >>> 0}`);
}

/* ============================= species table ============================== */

interface SpeciesDef {
  id: FloraSpeciesId;
  label: string;
  /** Anchor kinds this species can grow from. */
  anchors: readonly FloraAnchorKind[];
  /** Scale range picked per specimen. */
  scale: [number, number];
  /** Nominal untransformed footprint width, used to fit `anchor.run`. */
  nominalW: number;
  grow: (gr: Grow) => void;
}

/** Human-readable species names (settings UI, debug boards). */
export const FLORA_LABELS: Record<FloraSpeciesId, string> = {
  ivy: 'ivy trail',
  pothos: 'pothos trail',
  moss: 'moss tuft',
  fern: 'fern frond',
  herbBundle: 'hanging herb bundle',
  blossom: 'blossom branch',
  hearts: 'string-of-hearts trail',
  potted: 'small potted plant',
  grassTuft: 'grass & dandelion tuft',
  cobweb: 'cobweb',
};

const DEFAULT_INK = 'hsl(96 22% 20%)';

function defaultFacing(kind: FloraAnchorKind): FloraFacing {
  switch (kind) {
    case 'shelfUnderside':
    case 'caseCorner':
    case 'railTop':
      return 'down';
    default:
      return 'up';
  }
}

function facingAngle(f: FloraFacing): number {
  switch (f) {
    case 'up':
      return -Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'right':
      return 0;
    default:
      return Math.PI / 2;
  }
}

/* ============================== growth core =============================== */

interface Grow {
  rnd: RandomFn;
  noise: NoiseFunction1D;
  scale: number;
  /** Base growth angle in canvas coords (y down). */
  dir: number;
  /** +1 or -1 lateral mirror. */
  flip: number;
  pal: FloraPalette;
  g: FloraGeometry;
}

function tone(gr: Grow, h: number, s: number, l: number): Tone {
  return {
    h: h + (gr.pal.hueShift ?? 0),
    s: clamp(s + (gr.pal.satShift ?? 0), 0, 100),
    l: clamp(l + (gr.pal.lightShift ?? 0), 0, 100),
  };
}

/** Uniform in [a, b). */
function rr(gr: Grow, a: number, b: number): number {
  return a + gr.rnd() * (b - a);
}

interface StemParams {
  x: number;
  y: number;
  angle: number;
  len: number;
  width: number;
  /** Tip width as a fraction of the base width. */
  taper?: number;
  /** 0 = ignores gravity, 1 = falls straight down within a few steps. */
  gravity?: number;
  /** Per-step angular noise amplitude (radians). */
  wobble?: number;
  woody?: number;
  tone: Tone;
  step?: number;
}

/**
 * Grow one wobbled, gravity-aware stem. The spine is a random walk in *angle*
 * (simplex, so it curves rather than jitters) with a pull toward straight
 * down — that single term is what makes trails droop and blades arc.
 */
function growStem(gr: Grow, p: StemParams): StemGeom {
  const step = p.step ?? 4;
  const n = Math.max(2, Math.round(p.len / step));
  const taper = p.taper ?? 0.3;
  const gravity = p.gravity ?? 0;
  const wobble = p.wobble ?? 0.05;
  const phase = gr.rnd() * 400;

  let a = p.angle;
  let x = p.x;
  let y = p.y;
  const pts: Pt[] = [{ x, y }];
  const widths: number[] = [p.width];

  for (let i = 1; i <= n; i++) {
    const t = i / n;
    a += gr.noise(phase + i * 0.42) * wobble;
    if (gravity > 0) {
      const raw = Math.PI / 2 - a;
      const d = Math.atan2(Math.sin(raw), Math.cos(raw));
      a += clamp(d, -0.45, 0.45) * gravity;
    }
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    pts.push({ x, y });
    widths.push(Math.max(0.4, p.width * lerp(1, taper, t)));
  }

  const stem: StemGeom = { pts, widths, tone: p.tone, woody: p.woody ?? 0 };
  gr.g.stems.push(stem);
  return stem;
}

/** Tangent angle of a stem at index i. */
function stemAngle(stem: StemGeom, i: number): number {
  const a = stem.pts[Math.max(0, i - 1)] as Pt;
  const b = stem.pts[Math.min(stem.pts.length - 1, i + 1)] as Pt;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

interface LeafParams {
  shape: LeafShape | readonly LeafShape[];
  /** Arclength between leaves (or leaf pairs), px. */
  every: number;
  len: number;
  width: number;
  /** Splay from the stem tangent, radians. */
  splay: number;
  paired?: boolean;
  from?: number;
  to?: number;
  tone: Tone;
  hueJitter?: number;
  /** Relative leaf size at the stem tip (the taper the doc asks for). */
  sizeTaper?: number;
  curlChance?: number;
  paleChance?: number;
  /** Probability a leaf is an older, darker one. */
  darkChance?: number;
}

/**
 * Alternate (or pair) leaves along a stem at jittered angles and sizes,
 * tapering toward the tip, with occasional curled/darker older leaves.
 */
function leafify(gr: Grow, stem: StemGeom, p: LeafParams): void {
  const from = p.from ?? 0.1;
  const to = p.to ?? 0.98;
  const sizeTaper = p.sizeTaper ?? 0.45;
  const hueJitter = p.hueJitter ?? 9;
  const curlChance = p.curlChance ?? 0.16;
  const darkChance = p.darkChance ?? 0.18;
  const paleChance = p.paleChance ?? 0;
  const shapes: readonly LeafShape[] = Array.isArray(p.shape)
    ? (p.shape as readonly LeafShape[])
    : [p.shape as LeafShape];

  let acc = 0;
  let next = p.every * rr(gr, 0.45, 0.9);
  let side = gr.rnd() < 0.5 ? 1 : -1;
  const n = stem.pts.length;

  for (let i = 1; i < n; i++) {
    const a = stem.pts[i - 1] as Pt;
    const b = stem.pts[i] as Pt;
    acc += Math.hypot(b.x - a.x, b.y - a.y);
    const t = i / (n - 1);
    if (t < from || t > to || acc < next) continue;
    acc = 0;
    next = p.every * rr(gr, 0.72, 1.3);

    const tangent = stemAngle(stem, i);
    const size = lerp(1, sizeTaper, t) * rr(gr, 0.82, 1.16);
    const sides = p.paired ? [1, -1] : [side];
    for (const s of sides) {
      const dark = gr.rnd() < darkChance;
      const curl = gr.rnd() < curlChance ? rr(gr, 0.28, 0.62) : 0;
      const lt: Tone = {
        h: p.tone.h + (gr.rnd() * 2 - 1) * hueJitter,
        s: clamp(p.tone.s + (gr.rnd() * 2 - 1) * 7 - (dark ? 4 : 0), 0, 100),
        l: clamp(p.tone.l + (gr.rnd() * 2 - 1) * 5 - (dark ? 9 : 0), 0, 100),
      };
      gr.g.leaves.push({
        x: b.x,
        y: b.y,
        angle: tangent + s * gr.flip * (p.splay + (gr.rnd() * 2 - 1) * 0.28),
        len: p.len * size,
        width: p.width * size,
        shape: shapes[Math.floor(gr.rnd() * shapes.length) as number] ?? 'oval',
        bend: (gr.rnd() * 2 - 1) * p.len * 0.16,
        curl,
        tone: lt,
        pale: gr.rnd() < paleChance,
        seed: (gr.rnd() * 0xffffffff) >>> 0,
      });
    }
    if (!p.paired) side = -side;
  }
}

/* --------------------------- trailing species ---------------------------- */

interface TrailDef {
  len: number;
  width: number;
  gravity: number;
  wobble: number;
  /** Initial sideways lean off the anchor's facing, radians. */
  spread: number;
  shape: LeafShape | readonly LeafShape[];
  leafLen: number;
  leafW: number;
  every: number;
  splay: number;
  tone: [number, number, number];
  branches: number;
  paired?: boolean;
  paleChance?: number;
  curlChance?: number;
  sizeTaper?: number;
}

const TRAILS: Record<'ivy' | 'pothos' | 'hearts', TrailDef> = {
  ivy: {
    len: 148,
    width: 2.2,
    gravity: 0.17,
    wobble: 0.055,
    spread: 0.95,
    shape: 'lobed',
    leafLen: 18,
    leafW: 20,
    every: 13,
    splay: 1.0,
    tone: [104, 31, 33],
    branches: 2,
    curlChance: 0.17,
    sizeTaper: 0.5,
  },
  pothos: {
    len: 132,
    width: 2.8,
    gravity: 0.21,
    wobble: 0.048,
    spread: 1.05,
    shape: 'heart',
    leafLen: 24,
    leafW: 22,
    every: 20,
    splay: 0.92,
    tone: [95, 34, 36],
    branches: 1,
    paleChance: 0.3,
    curlChance: 0.12,
    sizeTaper: 0.5,
  },
  hearts: {
    len: 176,
    width: 1.1,
    gravity: 0.44,
    wobble: 0.03,
    spread: 0.3,
    shape: 'heart',
    leafLen: 9.5,
    leafW: 10.5,
    every: 18,
    splay: 1.38,
    tone: [116, 15, 44],
    branches: 1,
    paired: true,
    curlChance: 0.1,
    sizeTaper: 0.72,
  },
};

function growTrail(gr: Grow, def: TrailDef): void {
  const s = gr.scale;
  const t = tone(gr, def.tone[0], def.tone[1], def.tone[2]);
  const stemTone: Tone = { h: t.h - 4, s: clamp(t.s + 4, 0, 100), l: clamp(t.l + 4, 0, 100) };
  const main = growStem(gr, {
    x: 0,
    y: 0,
    angle: gr.dir + gr.flip * def.spread * rr(gr, 0.75, 1.2),
    len: def.len * s * rr(gr, 0.86, 1.14),
    width: def.width * s,
    taper: 0.32,
    gravity: def.gravity,
    wobble: def.wobble,
    tone: stemTone,
  });
  const leaves: LeafParams = {
    shape: def.shape,
    every: def.every * s,
    len: def.leafLen * s,
    width: def.leafW * s,
    splay: def.splay,
    tone: t,
    paired: def.paired ?? false,
    paleChance: def.paleChance ?? 0,
    curlChance: def.curlChance ?? 0.16,
    sizeTaper: def.sizeTaper ?? 0.45,
  };
  leafify(gr, main, leaves);

  // 1–2 side branches off the first two thirds of the main stem.
  for (let b = 0; b < def.branches; b++) {
    if (gr.rnd() < 0.22) continue;
    const at = Math.floor(main.pts.length * rr(gr, 0.22, 0.62));
    const p = main.pts[at] as Pt;
    const branch = growStem(gr, {
      x: p.x,
      y: p.y,
      angle: stemAngle(main, at) + gr.flip * (gr.rnd() < 0.5 ? -1 : 1) * rr(gr, 0.4, 0.9),
      len: def.len * s * rr(gr, 0.34, 0.56),
      width: def.width * s * 0.66,
      taper: 0.3,
      gravity: def.gravity * 1.25,
      wobble: def.wobble * 1.2,
      tone: stemTone,
    });
    leafify(gr, branch, {
      ...leaves,
      len: leaves.len * 0.82,
      width: leaves.width * 0.82,
      every: leaves.every * 0.92,
    });
  }
}

/* --------------------------- the ten species ----------------------------- */

function growFern(gr: Grow): void {
  const s = gr.scale;
  const t = tone(gr, 126, 30, 29);
  const rachis = growStem(gr, {
    x: 0,
    y: 0,
    angle: gr.dir + gr.flip * rr(gr, 0.5, 0.85),
    len: 104 * s * rr(gr, 0.85, 1.15),
    width: 2.6 * s,
    taper: 0.14,
    gravity: 0.3,
    wobble: 0.028,
    tone: { h: t.h - 6, s: t.s + 6, l: t.l + 8 },
  });
  leafify(gr, rachis, {
    shape: 'needle',
    every: 7 * s,
    len: 18 * s,
    width: 5.4 * s,
    splay: 1.12,
    paired: true,
    from: 0.08,
    tone: t,
    sizeTaper: 0.2,
    curlChance: 0.08,
    darkChance: 0.14,
    hueJitter: 7,
  });
  // Fiddlehead: an unfurling spiral at the tip, on about half the seeds.
  if (gr.rnd() < 0.5) {
    const tip = rachis.pts[rachis.pts.length - 1] as Pt;
    const a0 = stemAngle(rachis, rachis.pts.length - 1);
    const pts: Pt[] = [];
    const turn = gr.flip * (gr.rnd() < 0.5 ? 1 : -1);
    for (let i = 0; i <= 26; i++) {
      const u = i / 26;
      const r = 8 * s * (1 - u * 0.94);
      const a = a0 + turn * u * Math.PI * 2.1;
      pts.push({ x: tip.x + Math.cos(a) * r - Math.cos(a0) * 8 * s, y: tip.y + Math.sin(a) * r - Math.sin(a0) * 8 * s });
    }
    gr.g.threads.push({ pts, width: 1.7 * s, alpha: 0.95, colour: hsl(t.h - 4, t.s + 8, t.l + 6) });
  }
}

function growMoss(gr: Grow): void {
  const s = gr.scale;
  const t = tone(gr, 94, 34, 32);
  const up = gr.dir;
  const flipY = up < 0 ? 1 : -1;
  const halfW = 22 * s;
  const height = 15 * s;
  gr.g.shades.push({ x: 0, y: 0, rx: halfW * 1.05, ry: 3.4 * s, alpha: 0.3 });
  // Two layers: a darker, denser cushion behind a brighter front fringe, so
  // the tuft reads as a mound with volume instead of a flat smear.
  for (const layer of [0, 1]) {
    const count = layer === 0 ? 34 + Math.floor(gr.rnd() * 14) : 26 + Math.floor(gr.rnd() * 12);
    const spread = layer === 0 ? 0.88 : 1;
    for (let i = 0; i < count; i++) {
      const u = ((i + gr.rnd()) / count) * 2 - 1;
      // A cushion: tallest in the middle, thinning at the edges.
      const mound = Math.pow(Math.max(0, 1 - u * u), 0.55);
      const x = u * halfW * spread;
      const y = -mound * rr(gr, 0.12, 1) * height * (layer === 0 ? 1 : 0.62);
      gr.g.leaves.push({
        x,
        y: y * flipY,
        angle: up + (gr.rnd() * 2 - 1) * 0.8 + u * 0.7,
        len: rr(gr, 4.6, 9) * s * (layer === 0 ? 1 : 0.82),
        width: rr(gr, 3, 5.6) * s,
        shape: gr.rnd() < 0.5 ? 'round' : 'needle',
        bend: (gr.rnd() * 2 - 1) * 1.8 * s,
        curl: 0,
        tone: {
          h: t.h + (gr.rnd() * 2 - 1) * 16,
          s: clamp(t.s + (gr.rnd() * 2 - 1) * 12, 0, 100),
          l: clamp(
            t.l + (gr.rnd() * 2 - 1) * 9 + (layer === 0 ? -7 : 5) - (gr.rnd() < 0.15 ? 7 : 0),
            0,
            100,
          ),
        },
        pale: false,
        seed: (gr.rnd() * 0xffffffff) >>> 0,
      });
    }
  }
  // Sporophytes: bare hairs with a tiny capsule.
  const hairs = 4 + Math.floor(gr.rnd() * 4);
  for (let i = 0; i < hairs; i++) {
    const x = (gr.rnd() * 2 - 1) * halfW * 0.7;
    const len = rr(gr, 11, 20) * s;
    const stem = growStem(gr, {
      x,
      y: 0,
      angle: up + (gr.rnd() * 2 - 1) * 0.35,
      len,
      width: 0.9 * s,
      taper: 0.7,
      gravity: up < 0 ? 0.06 : 0,
      wobble: 0.05,
      step: 3,
      tone: { h: t.h + 8, s: t.s - 12, l: t.l + 22 },
    });
    const tip = stem.pts[stem.pts.length - 1] as Pt;
    gr.g.blooms.push({
      x: tip.x,
      y: tip.y,
      r: rr(gr, 1.3, 2.1) * s,
      kind: 'capsule',
      open: 1,
      tone: { h: 36, s: 40, l: 44 },
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
}

function growHerbBundle(gr: Grow): void {
  const s = gr.scale;
  const t = tone(gr, 76, 19, 47);
  const twine = 'hsl(38 26% 52%)';
  const knotY = 12 * s;
  // Twine: a loop over the shelf edge, down to the knot.
  gr.g.threads.push({
    pts: [
      { x: -4 * s, y: -6 * s },
      { x: -3 * s, y: 1 * s },
      { x: -1.5 * s, y: knotY - 2 * s },
    ],
    width: 1.3 * s,
    alpha: 0.9,
    colour: twine,
  });
  gr.g.threads.push({
    pts: [
      { x: 4 * s, y: -6 * s },
      { x: 3 * s, y: 1 * s },
      { x: 1.5 * s, y: knotY - 2 * s },
    ],
    width: 1.3 * s,
    alpha: 0.9,
    colour: twine,
  });
  const stems = 6 + Math.floor(gr.rnd() * 4);
  for (let i = 0; i < stems; i++) {
    const spread = ((i + 0.5) / stems - 0.5) * 1.05;
    const stem = growStem(gr, {
      x: (gr.rnd() * 2 - 1) * 1.5 * s,
      y: knotY,
      angle: Math.PI / 2 + spread + (gr.rnd() * 2 - 1) * 0.1,
      len: rr(gr, 38, 60) * s,
      width: 1.4 * s,
      taper: 0.5,
      gravity: 0.14,
      wobble: 0.035,
      step: 3.5,
      tone: { h: t.h - 6, s: t.s + 6, l: t.l - 6 },
    });
    leafify(gr, stem, {
      shape: 'needle',
      every: 7.5 * s,
      len: 9.5 * s,
      width: 3.6 * s,
      splay: 1.25,
      paired: true,
      from: 0.16,
      tone: t,
      hueJitter: 16,
      sizeTaper: 0.6,
      curlChance: 0.3,
      darkChance: 0.28,
    });
    // Lavender-ish flower spikes on some stems.
    if (gr.rnd() < 0.3) {
      const tip = stem.pts[stem.pts.length - 1] as Pt;
      for (let k = 0; k < 4; k++) {
        gr.g.blooms.push({
          x: tip.x + (gr.rnd() * 2 - 1) * 1.6 * s,
          y: tip.y - k * 2.4 * s,
          r: rr(gr, 1.2, 2) * s,
          kind: 'bud',
          open: 0.2,
          tone: { h: 268, s: 22, l: 52 },
          seed: (gr.rnd() * 0xffffffff) >>> 0,
        });
      }
    }
  }
  // The knot itself, and sometimes a paper tag.
  gr.g.threads.push({
    pts: [
      { x: -4 * s, y: knotY },
      { x: 4 * s, y: knotY + 1 * s },
      { x: -4 * s, y: knotY + 2.4 * s },
      { x: 4 * s, y: knotY + 3.6 * s },
    ],
    width: 1.6 * s,
    alpha: 0.95,
    colour: twine,
  });
  if (gr.rnd() < 0.45) {
    gr.g.tags.push({
      x: 6 * s,
      y: knotY + 4 * s,
      w: 11 * s,
      h: 7 * s,
      angle: rr(gr, -0.35, 0.1),
    });
  }
}

function growBlossom(gr: Grow): void {
  const s = gr.scale;
  const wood: Tone = tone(gr, 26, 22, 30);
  const petal: Tone = tone(gr, 344, 46, 82);
  const branch = growStem(gr, {
    x: 0,
    y: 0,
    angle: gr.dir + gr.flip * rr(gr, 0.85, 1.25),
    len: 150 * s * rr(gr, 0.85, 1.12),
    width: 3.4 * s,
    taper: 0.22,
    gravity: 0.07,
    wobble: 0.038,
    woody: 1,
    tone: wood,
  });
  const twigs = 3 + Math.floor(gr.rnd() * 3);
  const tips: Pt[] = [];
  for (let i = 0; i < twigs; i++) {
    const at = Math.floor(branch.pts.length * ((i + 0.6) / (twigs + 0.6)) * 0.95);
    const p = branch.pts[at] as Pt;
    const twig = growStem(gr, {
      x: p.x,
      y: p.y,
      angle: stemAngle(branch, at) + (gr.rnd() < 0.5 ? -1 : 1) * rr(gr, 0.5, 1.05),
      len: rr(gr, 22, 40) * s,
      width: 1.7 * s,
      taper: 0.35,
      gravity: 0.05,
      wobble: 0.05,
      step: 3.5,
      woody: 1,
      tone: wood,
    });
    tips.push(twig.pts[twig.pts.length - 1] as Pt);
    // Blossoms cluster along the twig, not just at the end.
    const n = 1 + Math.floor(gr.rnd() * 3);
    for (let k = 0; k < n; k++) {
      const q = twig.pts[Math.floor(twig.pts.length * rr(gr, 0.4, 1)) - 1] ?? twig.pts[0];
      const qq = q as Pt;
      gr.g.blooms.push({
        x: qq.x + (gr.rnd() * 2 - 1) * 2 * s,
        y: qq.y + (gr.rnd() * 2 - 1) * 2 * s,
        r: rr(gr, 5.4, 9.4) * s,
        kind: gr.rnd() < 0.26 ? 'bud' : 'blossom',
        open: rr(gr, 0.35, 1),
        tone: {
          h: petal.h + (gr.rnd() * 2 - 1) * 8,
          s: clamp(petal.s + (gr.rnd() * 2 - 1) * 10, 0, 100),
          l: clamp(petal.l + (gr.rnd() * 2 - 1) * 7, 0, 100),
        },
        seed: (gr.rnd() * 0xffffffff) >>> 0,
      });
    }
    // A couple of young leaves per twig.
    leafify(gr, twig, {
      shape: 'oval',
      every: 14 * s,
      len: 9 * s,
      width: 5 * s,
      splay: 1.05,
      tone: tone(gr, 108, 26, 38),
      sizeTaper: 0.7,
      curlChance: 0.06,
      darkChance: 0.1,
    });
  }
  // A few blossoms straight off the main branch too.
  for (let i = 0; i < 2; i++) {
    const p = branch.pts[Math.floor(branch.pts.length * rr(gr, 0.3, 0.95))] as Pt;
    gr.g.blooms.push({
      x: p.x + (gr.rnd() * 2 - 1) * 3 * s,
      y: p.y + (gr.rnd() * 2 - 1) * 3 * s,
      r: rr(gr, 4.6, 7.6) * s,
      kind: 'blossom',
      open: rr(gr, 0.5, 1),
      tone: petal,
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
}

function growPotted(gr: Grow): void {
  const s = gr.scale;
  const t = tone(gr, 108, 30, 34);
  const potW = 30 * s;
  const potH = 24 * s;
  gr.g.shades.push({ x: 0, y: 0, rx: potW * 0.72, ry: 4 * s, alpha: 0.34 });
  const kinds: PotGeom['kind'][] = ['terracotta', 'terracotta', 'enamel', 'brass'];
  gr.g.pots.push({
    x: -potW / 2,
    y: -potH,
    w: potW,
    h: potH,
    kind: kinds[Math.floor(gr.rnd() * kinds.length)] ?? 'terracotta',
  });
  const stems = 5 + Math.floor(gr.rnd() * 5);
  for (let i = 0; i < stems; i++) {
    const spread = ((i + 0.5) / stems - 0.5) * 1.9;
    const stem = growStem(gr, {
      x: (gr.rnd() * 2 - 1) * 4 * s,
      y: -potH - 2 * s,
      angle: -Math.PI / 2 + spread + (gr.rnd() * 2 - 1) * 0.14,
      len: rr(gr, 24, 44) * s,
      width: 1.5 * s,
      taper: 0.5,
      gravity: 0.19,
      wobble: 0.05,
      step: 3.5,
      tone: { h: t.h - 4, s: t.s + 6, l: t.l + 6 },
    });
    leafify(gr, stem, {
      shape: ['round', 'oval'],
      every: 11 * s,
      len: 11 * s,
      width: 10 * s,
      splay: 1.0,
      from: 0.3,
      tone: t,
      sizeTaper: 0.75,
      curlChance: 0.14,
      darkChance: 0.2,
    });
  }
  // A little soil line + one fallen leaf beside the pot.
  gr.g.threads.push({
    pts: [
      { x: -potW * 0.42, y: -potH + 1.5 * s },
      { x: 0, y: -potH + 2.6 * s },
      { x: potW * 0.42, y: -potH + 1.5 * s },
    ],
    width: 2.2 * s,
    alpha: 0.55,
    colour: 'hsl(28 24% 26%)',
  });
}

function growGrassTuft(gr: Grow): void {
  const s = gr.scale;
  const t = tone(gr, 86, 32, 40);
  const blades = 9 + Math.floor(gr.rnd() * 6);
  for (let i = 0; i < blades; i++) {
    const u = (i + 0.5) / blades - 0.5;
    const dry = gr.rnd() < 0.22;
    gr.g.leaves.push({
      x: u * 9 * s + (gr.rnd() * 2 - 1) * 1.4 * s,
      y: 0,
      angle: gr.dir + u * 1.5 + (gr.rnd() * 2 - 1) * 0.22,
      len: rr(gr, 20, 40) * s,
      width: rr(gr, 2.6, 4.2) * s,
      shape: 'needle',
      bend: (u >= 0 ? 1 : -1) * rr(gr, 5, 14) * s,
      curl: gr.rnd() < 0.12 ? rr(gr, 0.3, 0.6) : 0,
      tone: dry
        ? { h: 44, s: 30, l: 52 }
        : {
            h: t.h + (gr.rnd() * 2 - 1) * 12,
            s: clamp(t.s + (gr.rnd() * 2 - 1) * 10, 0, 100),
            l: clamp(t.l + (gr.rnd() * 2 - 1) * 9, 0, 100),
          },
      pale: false,
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
  // One or two dandelions: a bare stalk with a bloom or a seed-head puff.
  const stalks = 1 + (gr.rnd() < 0.4 ? 1 : 0);
  for (let i = 0; i < stalks; i++) {
    const stem = growStem(gr, {
      x: (gr.rnd() * 2 - 1) * 5 * s,
      y: 0,
      angle: gr.dir + (gr.rnd() * 2 - 1) * 0.3,
      len: rr(gr, 34, 54) * s,
      width: 1.4 * s,
      taper: 0.8,
      gravity: 0.05,
      wobble: 0.03,
      step: 4,
      tone: { h: t.h - 6, s: t.s - 6, l: t.l + 4 },
    });
    const tip = stem.pts[stem.pts.length - 1] as Pt;
    const puff = gr.rnd() < 0.45;
    gr.g.blooms.push({
      x: tip.x,
      y: tip.y,
      r: puff ? rr(gr, 6.5, 9) * s : rr(gr, 3.6, 5.2) * s,
      kind: puff ? 'puff' : 'dandelion',
      open: 1,
      tone: puff ? { h: 44, s: 12, l: 84 } : { h: 48, s: 76, l: 58 },
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
}

function growCobweb(gr: Grow): void {
  const s = gr.scale;
  const colour = 'hsl(40 12% 82%)';
  const spokes = 6 + Math.floor(gr.rnd() * 3);
  const reach = rr(gr, 46, 72) * s;
  // Sweep from the facing direction toward the horizontal on the flip side.
  const a0 = gr.dir;
  const a1 = gr.flip > 0 ? gr.dir + Math.PI / 2 : gr.dir - Math.PI / 2;
  const radials: Pt[][] = [];
  const ends: number[] = [];
  for (let i = 0; i < spokes; i++) {
    const a = lerp(a0, a1, (i + 0.5) / spokes) + (gr.rnd() * 2 - 1) * 0.05;
    const len = reach * rr(gr, 0.72, 1);
    ends.push(len);
    const pts: Pt[] = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5;
      // A touch of sag so the threads are not laser-straight.
      const sag = Math.sin(Math.PI * u) * len * 0.035;
      pts.push({
        x: Math.cos(a) * len * u + Math.cos(a + Math.PI / 2) * sag,
        y: Math.sin(a) * len * u + Math.sin(a + Math.PI / 2) * sag,
      });
    }
    radials.push(pts);
    gr.g.threads.push({ pts, width: 0.75, alpha: 0.34, colour });
  }
  // Catenary rings between consecutive radials, with a few missing spans.
  const rings = 4 + Math.floor(gr.rnd() * 3);
  for (let r = 1; r <= rings; r++) {
    const u = 0.22 + (r / rings) * 0.78;
    for (let i = 0; i < spokes - 1; i++) {
      if (gr.rnd() < 0.13) continue; // broken web
      const aA = lerp(a0, a1, (i + 0.5) / spokes);
      const aB = lerp(a0, a1, (i + 1.5) / spokes);
      const lA = (ends[i] as number) * u;
      const lB = (ends[i + 1] as number) * u;
      const pA = { x: Math.cos(aA) * lA, y: Math.sin(aA) * lA };
      const pB = { x: Math.cos(aB) * lB, y: Math.sin(aB) * lB };
      const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
      const sag = 1 + u * 0.18;
      gr.g.threads.push({
        pts: [pA, { x: mid.x * sag, y: mid.y * sag }, pB],
        width: 0.7,
        alpha: 0.28 + gr.rnd() * 0.1,
        colour,
      });
    }
  }
  // Dust caught in the silk.
  for (let i = 0; i < 3; i++) {
    const a = lerp(a0, a1, gr.rnd());
    const l = reach * rr(gr, 0.25, 0.9);
    gr.g.blooms.push({
      x: Math.cos(a) * l,
      y: Math.sin(a) * l,
      r: rr(gr, 0.7, 1.5),
      kind: 'dust',
      open: 1,
      tone: { h: 40, s: 10, l: 70 },
      seed: (gr.rnd() * 0xffffffff) >>> 0,
    });
  }
}

const SPECIES: Record<FloraSpeciesId, SpeciesDef> = {
  ivy: {
    id: 'ivy',
    label: FLORA_LABELS.ivy,
    anchors: ['railTop', 'caseCorner', 'crownTop', 'potPosition', 'shelfUnderside'],
    scale: [0.8, 1.15],
    nominalW: 150,
    grow: (gr) => growTrail(gr, TRAILS.ivy),
  },
  pothos: {
    id: 'pothos',
    label: FLORA_LABELS.pothos,
    anchors: ['railTop', 'shelfUnderside', 'potPosition', 'caseCorner'],
    scale: [0.8, 1.1],
    nominalW: 140,
    grow: (gr) => growTrail(gr, TRAILS.pothos),
  },
  hearts: {
    id: 'hearts',
    label: FLORA_LABELS.hearts,
    anchors: ['railTop', 'shelfUnderside', 'potPosition'],
    scale: [0.85, 1.2],
    nominalW: 60,
    grow: (gr) => growTrail(gr, TRAILS.hearts),
  },
  fern: {
    id: 'fern',
    label: FLORA_LABELS.fern,
    anchors: ['railTop', 'potPosition', 'crownTop', 'caseCorner'],
    scale: [0.85, 1.2],
    nominalW: 110,
    grow: growFern,
  },
  moss: {
    id: 'moss',
    label: FLORA_LABELS.moss,
    anchors: ['jointGap', 'railTop', 'crownTop', 'caseCorner'],
    scale: [0.75, 1.25],
    nominalW: 40,
    grow: growMoss,
  },
  herbBundle: {
    id: 'herbBundle',
    label: FLORA_LABELS.herbBundle,
    anchors: ['shelfUnderside'],
    scale: [0.85, 1.15],
    nominalW: 46,
    grow: growHerbBundle,
  },
  blossom: {
    id: 'blossom',
    label: FLORA_LABELS.blossom,
    anchors: ['crownTop', 'caseCorner', 'railTop'],
    scale: [0.85, 1.15],
    nominalW: 160,
    grow: growBlossom,
  },
  potted: {
    id: 'potted',
    label: FLORA_LABELS.potted,
    anchors: ['potPosition', 'railTop'],
    scale: [0.85, 1.2],
    nominalW: 60,
    grow: growPotted,
  },
  grassTuft: {
    id: 'grassTuft',
    label: FLORA_LABELS.grassTuft,
    anchors: ['jointGap', 'railTop', 'crownTop'],
    scale: [0.8, 1.2],
    nominalW: 46,
    grow: growGrassTuft,
  },
  cobweb: {
    id: 'cobweb',
    label: FLORA_LABELS.cobweb,
    anchors: ['caseCorner', 'crownTop', 'shelfUnderside'],
    scale: [0.85, 1.3],
    nominalW: 70,
    grow: growCobweb,
  },
};

/** Which anchor kinds a species can grow from. */
export function speciesAnchors(id: FloraSpeciesId): readonly FloraAnchorKind[] {
  return SPECIES[id].anchors;
}

/** Can this species take hold on this kind of anchor? */
export function speciesFitsAnchor(id: FloraSpeciesId, kind: FloraAnchorKind): boolean {
  return SPECIES[id].anchors.includes(kind);
}

/* ================================ growing ================================= */

const geometryMemo = new Map<string, FloraGeometry>();
const GEOMETRY_MEMO_CAP = 512;

function emptyGeometry(ink: string): FloraGeometry {
  return {
    stems: [],
    leaves: [],
    blooms: [],
    threads: [],
    pots: [],
    tags: [],
    shades: [],
    ink,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
  };
}

function computeBounds(g: FloraGeometry): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const hit = (x: number, y: number, r: number): void => {
    if (x - r < minX) minX = x - r;
    if (y - r < minY) minY = y - r;
    if (x + r > maxX) maxX = x + r;
    if (y + r > maxY) maxY = y + r;
  };
  for (const s of g.stems) {
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i] as Pt;
      hit(p.x, p.y, (s.widths[i] ?? 1) / 2 + 0.5);
    }
  }
  for (const l of g.leaves) hit(l.x, l.y, leafBoundRadius(l.len, l.width) + Math.abs(l.bend));
  for (const b of g.blooms) hit(b.x, b.y, b.r * 1.35 + 1);
  for (const t of g.threads) for (const p of t.pts) hit(p.x, p.y, t.width + 0.5);
  for (const p of g.pots) {
    hit(p.x, p.y, 0);
    hit(p.x + p.w, p.y + p.h, 0);
    hit(p.x - 3, p.y - 7, 0); // rim overhang
    hit(p.x + p.w + 3, p.y + p.h, 0);
  }
  for (const t of g.tags) {
    const r = Math.hypot(t.w, t.h);
    hit(t.x, t.y, r);
  }
  for (const sh of g.shades) hit(sh.x, sh.y, Math.max(sh.rx, sh.ry));
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = 1.5;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * Grow a specimen's geometry in **anchor-local** coordinates (the anchor is
 * the origin). Pure and deterministic; memoized because keep-out resolution
 * regrows the same specimen at a few different scales.
 */
export function growFlora(p: FloraPlacement): FloraGeometry {
  const pal = p.palette;
  const key = `${p.species}|${p.seed}|${p.scale.toFixed(4)}|${p.flip ? 1 : 0}|${p.facing}|${pal.hueShift ?? 0}|${pal.satShift ?? 0}|${pal.lightShift ?? 0}`;
  const hit = geometryMemo.get(key);
  if (hit) return hit;

  const g = emptyGeometry(pal.ink ?? DEFAULT_INK);
  const gr: Grow = {
    rnd: mulberry32(p.seed >>> 0),
    noise: seededNoise1D((p.seed ^ 0x5bf03635) >>> 0),
    scale: p.scale,
    dir: facingAngle(p.facing),
    flip: p.flip ? -1 : 1,
    pal,
    g,
  };
  SPECIES[p.species].grow(gr);
  g.bounds = computeBounds(g);

  if (geometryMemo.size > GEOMETRY_MEMO_CAP) geometryMemo.clear();
  geometryMemo.set(key, g);
  return g;
}

/** Drop every memoized geometry (tests / theme switches). */
export function clearFloraMemo(): void {
  geometryMemo.clear();
}

/* =============================== keep-out ================================= */

/** Do two rects overlap (touching edges do not count)? */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Grow a rect outward by `pad` on every side. */
export function inflateRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
}

/**
 * The band of a spine that carries its title, as a keep-out rect.
 *
 * Spines are vertical, and the title runs down the middle of the spine with
 * bands/ornaments above and below it, so the protected band is the middle
 * ~70% of the spine height across its full width — plus `pad` of breathing
 * room so a leaf tip never even brushes a letter.
 */
export const SPINE_TITLE_BAND = { top: 0.15, bottom: 0.85 } as const;

export function spineTitleKeepOut(spine: Rect, pad = 3): Rect {
  const y = spine.y + spine.h * SPINE_TITLE_BAND.top;
  const h = spine.h * (SPINE_TITLE_BAND.bottom - SPINE_TITLE_BAND.top);
  return inflateRect({ x: spine.x, y, w: spine.w, h }, pad);
}

/** Convenience: title keep-outs for a row of book spine rects. */
export function spineKeepOuts(spines: readonly Rect[], pad = 3): Rect[] {
  return spines.map((s) => spineTitleKeepOut(s, pad));
}

export interface KeepOutOptions {
  /** Smallest scale a specimen may be shrunk to before it is dropped. */
  minScale?: number;
  /** Multiplier applied per shrink attempt. Default 0.82. */
  shrink?: number;
  /** Max shrink attempts. Default 4. */
  attempts?: number;
}

/** World-space bounds of a placement (local geometry + anchor position). */
export function placementBounds(p: FloraPlacement): Rect {
  const b = growFlora(p).bounds;
  return { x: b.x + p.anchor.x, y: b.y + p.anchor.y, w: b.w, h: b.h };
}

/** Does a placement currently reach into any keep-out rect? */
export function violatesKeepOut(p: FloraPlacement, keepOut: readonly Rect[]): boolean {
  if (keepOut.length === 0) return false;
  const b = p.bounds;
  for (const k of keepOut) if (rectsOverlap(b, k)) return true;
  return false;
}

/**
 * Enforce the occlusion rule: any specimen whose bounds reach into a keep-out
 * rect (a spine's title area) is shrunk back toward its anchor, and dropped
 * entirely if it still does not fit. The returned placements are guaranteed
 * not to overlap any keep-out rect.
 */
export function enforceKeepOut(
  placements: readonly FloraPlacement[],
  keepOut: readonly Rect[],
  opts: KeepOutOptions = {},
): FloraPlacement[] {
  if (keepOut.length === 0) return placements.slice();
  const minScale = opts.minScale ?? 0.42;
  const shrink = opts.shrink ?? 0.82;
  const attempts = opts.attempts ?? 4;

  const out: FloraPlacement[] = [];
  for (const p of placements) {
    let cur = p;
    let ok = !violatesKeepOut(cur, keepOut);
    for (let i = 0; !ok && i < attempts; i++) {
      const scale = cur.scale * shrink;
      if (scale < minScale) break;
      cur = { ...cur, scale };
      cur = { ...cur, bounds: placementBounds(cur) };
      ok = !violatesKeepOut(cur, keepOut);
    }
    if (ok) out.push(cur);
  }
  return out;
}

/* ================================ planning ================================ */

export interface FloraPlanOptions {
  floorIndex: number;
  themeSeed: number;
  spec: FloraSpec;
  anchors: readonly FloraAnchor[];
  /**
   * The settings slider. 0 = a completely clean shelf, 1 = the theme's own
   * density, up to 2 = overgrown. Clamped to [0, 2].
   */
  densityMultiplier?: number;
  /** Title keep-out rects (see `spineKeepOuts`). */
  keepOut?: readonly Rect[];
  keepOutOptions?: KeepOutOptions;
}

/**
 * Decide what grows where on one floor.
 *
 * Deterministic: identical options ⇒ identical placements, and the accept
 * test is a threshold on a per-anchor random value, so raising the density
 * multiplier only ever *adds* specimens (a sparse shelf is a subset of a
 * lush one — no reshuffling as the user drags the slider).
 */
export function planFlora(o: FloraPlanOptions): FloraPlacement[] {
  const mult = clamp(o.densityMultiplier ?? 1, 0, 2);
  const coverage = clamp(DENSITY_COVERAGE[o.spec.density] * mult, 0, 1);
  const eligible = o.spec.eligibleAnchors ?? FLORA_ANCHOR_KINDS;
  const palette = o.spec.palette ?? {};
  if (coverage <= 0 || o.spec.species.length === 0) return [];

  const placements: FloraPlacement[] = [];
  for (const anchor of o.anchors) {
    if (!eligible.includes(anchor.kind)) continue;
    const candidates = o.spec.species.filter((s) => speciesFitsAnchor(s, anchor.kind));
    if (candidates.length === 0) continue;

    const seed = floraSeed(o.floorIndex, anchor.id, o.themeSeed);
    const rnd = mulberry32(seed);
    if (rnd() >= coverage) continue;

    const species = candidates[Math.floor(rnd() * candidates.length)] as FloraSpeciesId;
    const def = SPECIES[species];
    // Lush rooms grow slightly larger specimens as well as more of them.
    const densityScale = lerp(0.92, 1.06, clamp(coverage, 0, 1));
    let scale = lerp(def.scale[0], def.scale[1], rnd()) * densityScale;
    if (anchor.run && anchor.run > 0) {
      scale = Math.min(scale, Math.max(0.45, (anchor.run * 1.6) / def.nominalW));
    }
    const facing = anchor.facing ?? defaultFacing(anchor.kind);
    const flip = anchor.flip ?? rnd() < 0.5;

    const placement: FloraPlacement = {
      id: `${o.floorIndex}:${anchor.id}`,
      anchor,
      species,
      seed,
      scale,
      flip,
      facing,
      palette,
      bounds: { x: 0, y: 0, w: 0, h: 0 },
    };
    placement.bounds = placementBounds(placement);
    placements.push(placement);
  }

  return o.keepOut && o.keepOut.length > 0
    ? enforceKeepOut(placements, o.keepOut, o.keepOutOptions)
    : placements;
}

/** Union of every placement's bounds — the size of the floor's flora layer. */
export function floraLayerBounds(placements: readonly FloraPlacement[]): Rect | null {
  if (placements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placements) {
    minX = Math.min(minX, p.bounds.x);
    minY = Math.min(minY, p.bounds.y);
    maxX = Math.max(maxX, p.bounds.x + p.bounds.w);
    maxY = Math.max(maxY, p.bounds.y + p.bounds.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ================================ drawing ================================= */

function toneStr(t: Tone, dl = 0, ds = 0, a = 1): string {
  return hsl(t.h, t.s + ds, t.l + dl, a);
}

function drawRibbon(ctx: Ctx2D, s: StemGeom, ink: string): void {
  const n = s.pts.length;
  if (n < 2) return;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = s.pts[Math.max(0, i - 1)] as Pt;
    const b = s.pts[Math.min(n - 1, i + 1)] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    const w = Math.max(0.45, (s.widths[i] ?? 1) / 2);
    left.push({ x: (s.pts[i] as Pt).x - (dy / m) * w, y: (s.pts[i] as Pt).y + (dx / m) * w });
    right.push({ x: (s.pts[i] as Pt).x + (dy / m) * w, y: (s.pts[i] as Pt).y - (dx / m) * w });
  }
  const outline = left.concat(right.reverse());
  ctx.save();
  traceSmooth(ctx, outline, true);
  const t = s.tone;
  const first = s.pts[0] as Pt;
  const last = s.pts[n - 1] as Pt;
  const g = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
  g.addColorStop(0, toneStr(t, s.woody > 0.5 ? -4 : 0));
  g.addColorStop(1, toneStr(t, 7));
  ctx.fillStyle = g;
  ctx.fill();
  // Pencil edge — heavier on woody branches.
  ctx.strokeStyle = ink;
  ctx.globalAlpha = s.woody > 0.5 ? 0.5 : 0.34;
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.restore();
}

function drawBloom(ctx: Ctx2D, b: BloomGeom, ink: string): void {
  ctx.save();
  ctx.translate(b.x, b.y);
  const rnd = mulberry32(b.seed >>> 0);
  switch (b.kind) {
    case 'blossom':
    case 'bud': {
      drawBlossom(ctx, b.r, b.kind === 'bud' ? Math.min(0.3, b.open) : b.open, b.seed, {
        petalBase: toneStr(b.tone, -8, 4),
        petalTip: toneStr(b.tone, 9),
        ink,
        centre: hsl(46, 62, 58),
        stamen: hsl(40, 40, 40, 0.8),
      });
      break;
    }
    case 'dandelion': {
      // A shaggy little sunburst.
      ctx.fillStyle = toneStr(b.tone);
      ctx.strokeStyle = toneStr(b.tone, -18, 6);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        const r = b.r * (0.62 + rnd() * 0.42);
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r * 0.86;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'puff': {
      // Seed head: fine radiating hairs, each tipped with a seed.
      ctx.strokeStyle = 'hsl(46 14% 88% / 0.85)';
      ctx.lineWidth = 0.55;
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2;
        const r = b.r * (0.55 + rnd() * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.stroke();
        ctx.fillStyle = 'hsl(42 18% 92% / 0.9)';
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'hsl(60 12% 82% / 0.55)';
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'capsule': {
      ctx.fillStyle = toneStr(b.tone);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * 0.75, b.r, rnd() * 0.6 - 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'dust': {
      ctx.fillStyle = 'hsl(40 10% 72% / 0.5)';
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = toneStr(b.tone);
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawPot(ctx: Ctx2D, p: PotGeom, ink: string): void {
  const ramp: Record<PotGeom['kind'], [string, string, string]> = {
    terracotta: ['#a9603f', '#c07450', '#84492f'],
    brass: ['#b08d3e', '#d0ae5c', '#8a6c2c'],
    enamel: ['#8fa79a', '#b7cabf', '#6c8478'],
  };
  const [a, b, c] = ramp[p.kind];
  ctx.save();
  const g = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
  g.addColorStop(0, a);
  g.addColorStop(0.45, b);
  g.addColorStop(1, c);
  ctx.fillStyle = g;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + p.w, p.y);
  ctx.lineTo(p.x + p.w - p.h * 0.2, p.y + p.h);
  ctx.lineTo(p.x + p.h * 0.2, p.y + p.h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  // Rim.
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = a;
  ctx.beginPath();
  ctx.rect(p.x - p.w * 0.09, p.y - p.h * 0.26, p.w * 1.18, p.h * 0.27);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawTag(ctx: Ctx2D, t: TagGeom, ink: string): void {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle);
  ctx.fillStyle = 'hsl(44 34% 88%)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(t.w, t.h * 0.22);
  ctx.lineTo(t.w, t.h * 0.86);
  ctx.lineTo(0, t.h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  // Two scribbled "words".
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(t.w * 0.18, t.h * (0.38 + i * 0.24));
    ctx.lineTo(t.w * (0.72 - i * 0.14), t.h * (0.38 + i * 0.24));
    ctx.stroke();
  }
  ctx.restore();
}

export interface FloraDrawOptions {
  /** Overall opacity, e.g. for a crossfade on theme switch. Default 1. */
  alpha?: number;
  /** Add the shared granulation tile over the specimen. Default false. */
  granulate?: boolean;
}

/**
 * Draw a grown specimen at the current transform origin (= its anchor).
 * Draw order is back-to-front: threads, stems, leaves, blooms, pot, tag.
 */
export function drawFloraGeometry(
  ctx: Ctx2D,
  g: FloraGeometry,
  opts: FloraDrawOptions = {},
): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const t of g.threads) {
    ctx.save();
    ctx.globalAlpha = (opts.alpha ?? 1) * t.alpha;
    ctx.strokeStyle = t.colour;
    ctx.lineWidth = t.width;
    traceSmooth(ctx, t.pts, false);
    ctx.stroke();
    ctx.restore();
  }

  for (const s of g.stems) drawRibbon(ctx, s, g.ink);

  for (const l of g.leaves) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.angle);
    const base = l.pale
      ? toneStr(l.tone, 16, -14)
      : toneStr(l.tone);
    const tip = l.pale ? toneStr(l.tone, 26, -20) : toneStr(l.tone, 11, -4);
    drawLeaf(
      ctx,
      {
        shape: l.shape,
        len: l.len,
        width: l.width,
        bend: l.bend,
        curl: l.curl,
        jitter: 0.45,
        seed: l.seed,
        steps: l.len > 14 ? 20 : 14,
      },
      {
        fillBase: base,
        fillTip: tip,
        ink: g.ink,
        vein: toneStr(l.tone, -12, 4),
        lineWidth: clamp(l.len * 0.055, 0.55, 1.05),
      },
    );
    ctx.restore();
  }

  for (const b of g.blooms) drawBloom(ctx, b, g.ink);
  for (const p of g.pots) drawPot(ctx, p, g.ink);
  for (const t of g.tags) drawTag(ctx, t, g.ink);

  ctx.restore();
}

/**
 * Draw a placement into a caller-provided context, in that context's world
 * coordinates (i.e. the anchor's x/y are honoured). Composite this *before*
 * the book/spine layer.
 */
export function drawFlora(ctx: Ctx2D, p: FloraPlacement, opts: FloraDrawOptions = {}): void {
  const g = growFlora(p);
  ctx.save();
  ctx.translate(p.anchor.x, p.anchor.y);
  drawFloraGeometry(ctx, g, opts);
  ctx.restore();
}

/** Draw a whole floor's flora in one pass (still one canvas, no per-frame work). */
export function drawFloraLayer(
  ctx: Ctx2D,
  placements: readonly FloraPlacement[],
  opts: FloraDrawOptions = {},
): void {
  for (const p of placements) drawFlora(ctx, p, opts);
}

/* ================================= baking ================================= */

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('flora: 2d context unavailable');
  return ctx as Ctx2D;
}

function granulate(ctx: Ctx2D, w: number, h: number): void {
  const tile = getGranulationTile();
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  const pat = ctx.createPattern(tile as CanvasImageSource, 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

export interface FloraSpriteResult {
  canvas: Canvas2D;
  /** World-space rect the canvas maps onto (draw it at bounds.x/bounds.y). */
  bounds: Rect;
  dpr: number;
}

/**
 * Render one specimen into its own tightly-cropped canvas — the sprite-friendly
 * form. `bounds` is where to blit it in world space.
 */
export function renderFloraSprite(
  p: FloraPlacement,
  dpr = 1,
  opts: FloraDrawOptions = {},
): FloraSpriteResult {
  const g = growFlora(p);
  const b = p.bounds.w > 0 ? p.bounds : placementBounds(p);
  const w = Math.max(1, Math.ceil(b.w * dpr));
  const h = Math.max(1, Math.ceil(b.h * dpr));
  const canvas = makeCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.scale(dpr, dpr);
  // Anchor-local origin → sprite-local origin.
  ctx.translate(p.anchor.x - b.x, p.anchor.y - b.y);
  drawFloraGeometry(ctx, g, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.granulate !== false) granulate(ctx, w, h);
  return { canvas, bounds: b, dpr };
}

/**
 * Render a whole floor's flora into ONE canvas covering the union of the
 * placements' bounds. This is what the shelf compositor wants: a single
 * sprite drawn behind the spine atlas.
 */
export function renderFloraLayerCanvas(
  placements: readonly FloraPlacement[],
  dpr = 1,
  opts: FloraDrawOptions = {},
): FloraSpriteResult | null {
  const b = floraLayerBounds(placements);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const w = Math.max(1, Math.ceil(b.w * dpr));
  const h = Math.max(1, Math.ceil(b.h * dpr));
  const canvas = makeCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.scale(dpr, dpr);
  ctx.translate(-b.x, -b.y);
  drawFloraLayer(ctx, placements, opts);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.granulate !== false) granulate(ctx, w, h);
  return { canvas, bounds: b, dpr };
}

/** Cache key covering everything that affects the pixels of a flora layer. */
export function floraLayerCacheKey(placements: readonly FloraPlacement[]): string {
  const parts = placements.map(
    (p) =>
      `${p.species}:${p.seed.toString(16)}:${p.scale.toFixed(3)}:${p.flip ? 1 : 0}:${p.facing}:` +
      `${Math.round(p.anchor.x)},${Math.round(p.anchor.y)}`,
  );
  return `flora|v${FLORA_RECIPE_VERSION}|${parts.join('|')}`;
}

export interface BakedFloraLayer {
  bitmap: ImageBitmap;
  /** World rect to blit the bitmap into. */
  bounds: Rect;
}

/**
 * Bake a floor's flora once into an ImageBitmap (memory + disk cached through
 * `art/bake.ts`). Returns null when nothing grows on that floor.
 */
export async function bakeFloraLayer(
  placements: readonly FloraPlacement[],
  dpr = 1,
  opts: FloraDrawOptions = {},
): Promise<BakedFloraLayer | null> {
  const bounds = floraLayerBounds(placements);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;
  const bitmap = await bakeCached(floraLayerCacheKey(placements), dpr, async () => {
    const res = renderFloraLayerCanvas(placements, dpr, opts);
    if (!res) throw new Error('flora: empty layer');
    return res.canvas as OffscreenCanvas;
  });
  return { bitmap, bounds };
}
