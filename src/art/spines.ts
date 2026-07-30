/**
 * art/spines.ts — seeded procedural book spines (L2).
 *
 * A book's entire look derives from a 32-bit seed (fnv1a of its id):
 * seed → mulberry32 → SpineParams (~100 bytes, the only persisted state).
 * renderSpine draws one spine onto a canvas in ~0.3ms with NO SVG filters:
 * the watercolor look comes from layered multiply gradients + a 2px inset
 * pigment-pooling edge, the pencil look from per-vertex jittered
 * double-stroked polylines, and granulation from one shared 256² noise tile
 * composited with 'overlay' at alpha 0.06.
 */

import {
  charmColorCss,
  charmSpineReserve,
  charmTakesOrnamentSlot,
  drawSpineCharm,
  type CharmKind,
} from './charms';
import { clamp, mulberry32, type RandomFn } from './noise';

/* ------------------------------ studio vocab ------------------------------ */

/**
 * Binding materials (library-themes §4). Each one is a genuinely different
 * baked treatment in `paintBindingMaterial`, not a colour swap:
 * leather (pebble grain + creases + sheen) · cloth (fine even buckram weave,
 * matte) · paper (flat, fibre streaks, foxing specks) · vellum (parchment
 * lightening + translucency clouds + follicles) · linen (coarse irregular
 * slubby weave) · silk (satin sheen bands + watered moiré).
 */
export const BINDING_MATERIALS = [
  'leather',
  'cloth',
  'paper',
  'vellum',
  'linen',
  'silk',
] as const;
export type BindingMaterial = (typeof BINDING_MATERIALS)[number];

/** Title panel treatments on the spine (and, mirrored, on the cover). */
export const TITLE_PLATES = ['none', 'gilt', 'label', 'debossed'] as const;
export type TitlePlateStyle = (typeof TITLE_PLATES)[number];

/** Text-block edge treatments (the sliver of pages visible at the joint). */
export const EDGE_TREATMENTS = ['plain', 'gilt', 'marbled', 'speckled'] as const;
export type EdgeTreatment = (typeof EDGE_TREATMENTS)[number];

/** Number of curated pigment duos (shared with covers.ts). */
export const PIGMENT_COUNT = 12;
/** Number of ornament stamps (a book may also have none). */
export const ORNAMENT_COUNT = 12;
/** Maximum raised bands (cords) across a spine. */
export const MAX_RAISED_BANDS = 5;

/** Legal spine height range in world px. */
export const SPINE_HEIGHT_RANGE = { min: 150, max: 290 } as const;
/** Legal spine thickness range in world px. */
export const SPINE_THICKNESS_RANGE = { min: 20, max: 64 } as const;

/**
 * Book formats, the bibliographic sizes a real shelf mixes: a folio towers
 * over a pocket duodecimo. Heights are in world px and always inside
 * SPINE_HEIGHT_RANGE. The studio's height slider overrides them outright.
 */
export const SPINE_FORMATS = {
  folio: { min: 262, max: 288, label: 'Folio' },
  quarto: { min: 240, max: 264, label: 'Quarto' },
  octavo: { min: 214, max: 242, label: 'Octavo' },
  duodecimo: { min: 188, max: 216, label: 'Duodecimo' },
  pocket: { min: 162, max: 190, label: 'Pocket' },
} as const;
export type SpineFormat = keyof typeof SPINE_FORMATS;
export const SPINE_FORMAT_IDS = Object.keys(SPINE_FORMATS) as readonly SpineFormat[];

export function isSpineFormat(v: unknown): v is SpineFormat {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPINE_FORMATS, v);
}

/** The five named wear stops, pristine → well-loved (wear is continuous). */
export const WEAR_STOPS = [
  { id: 'pristine', label: 'Pristine', value: 0 },
  { id: 'gently-read', label: 'Gently read', value: 0.25 },
  { id: 'read', label: 'Read', value: 0.5 },
  { id: 'worn', label: 'Worn', value: 0.75 },
  { id: 'well-loved', label: 'Well-loved', value: 1 },
] as const;

/** Display names for the studio's material picker. */
export const MATERIAL_LABELS: Readonly<Record<BindingMaterial, string>> = {
  leather: 'Leather',
  cloth: 'Cloth',
  paper: 'Paper',
  vellum: 'Vellum',
  linen: 'Linen',
  silk: 'Silk',
};

/** Display names for the 12 pigment duos, index-aligned with PALETTES. */
export const PIGMENT_LABELS: readonly string[] = [
  'Amber',
  'Terracotta',
  'Moss',
  'Dusty blue',
  'Plum',
  'Ochre',
  'Sage',
  'Rust',
  'Clay',
  'Olive',
  'Slate',
  'Blush',
];

/** Display names for the 12 ornament stamps, index-aligned with drawOrnament. */
export const ORNAMENT_LABELS: readonly string[] = [
  'Diamond',
  'Laurel spray',
  'Star',
  'Blot',
  'Chevron',
  'Sun',
  'Moon',
  'Keyhole',
  'Laurel wreath',
  'Quill',
  'Tree',
  'Crescent & stars',
];

/** Display names for the title-plate treatments. */
export const TITLE_PLATE_LABELS: Readonly<Record<TitlePlateStyle, string>> = {
  none: 'None',
  gilt: 'Gilt panel',
  label: 'Paper label',
  debossed: 'Debossed',
};

/** Display names for the text-block edge treatments. */
export const EDGE_LABELS: Readonly<Record<EdgeTreatment, string>> = {
  plain: 'Plain',
  gilt: 'Gilt',
  marbled: 'Marbled',
  speckled: 'Speckled',
};

export function isBindingMaterial(v: unknown): v is BindingMaterial {
  return typeof v === 'string' && (BINDING_MATERIALS as readonly string[]).includes(v);
}
export function isTitlePlateStyle(v: unknown): v is TitlePlateStyle {
  return typeof v === 'string' && (TITLE_PLATES as readonly string[]).includes(v);
}
export function isEdgeTreatment(v: unknown): v is EdgeTreatment {
  return typeof v === 'string' && (EDGE_TREATMENTS as readonly string[]).includes(v);
}

/* --------------------------------- params -------------------------------- */

/** Horizontal rule across the spine. y is a fraction of spine height. */
export interface BandSpec {
  y: number;
  /** 0 = double-rule, 1 = thick band, 2 = gilt band. */
  kind: 0 | 1 | 2;
}

export interface SpineParams {
  /** The seed the params were derived from (kept for render-time jitter). */
  seed: number;
  /** Silhouette template 0–6: straight/taper-top/taper-bottom/banded/scalloped/rounded-top/waist. */
  silhouette: number;
  /** Index into the 12 curated warm pigment duos. */
  palette: number;
  /** Extra per-book hue rotation, ±6°. */
  hueJitter: number;
  /** 0–3 horizontal bands. */
  bands: BandSpec[];
  /**
   * Ornament stamp 0–11: diamond/laurel/star/blot/chevron/sun/moon/keyhole/
   * laurel-wreath/quill/tree/crescent-with-stars.
   */
  ornament: number;
  /** Cover texture: 0 = cloth, 1 = leather, 2 = paper. */
  texture: 0 | 1 | 2;
  /** Title face: 0 = Caveat, 1 = Kalam, 2 = Patrick Hand. */
  font: 0 | 1 | 2;
  /** Gilt (gold) bands/ornament/title. */
  gilt: boolean;
  /** Lean angle in degrees, ±1.2 — applied by the shelf compositor. */
  lean: number;
  /** Spine width in world px, 28–46 weighted toward 32–38. */
  w: number;
  /** Height jitter in world px, ±6 — applied by the shelf compositor. */
  hJitter: number;
  /** Two-tone binding: the head section is bound in the darker partner tone. */
  twoTone: boolean;
  /** Fraction of the height covered by the two-tone head section (0.26–0.48). */
  twoToneSplit: number;
  /** Striped head/tail bands (endbands) at the spine's top and bottom. */
  headTail: boolean;

  /* ---------------------- Book Studio additions (§4) ---------------------- */
  /* Every field below is OPTIONAL so hand-built params from before the studio
   * still typecheck and render; deriveSpineParams always populates them, and
   * renderSpine falls back to a seed-stable default when one is missing. */

  /** Binding material. Defaults to a material implied by `texture`. */
  material?: BindingMaterial;
  /** Raised cords across the spine, 0–5. >0 replaces the decorative `bands`. */
  raisedBands?: number;
  /** Gold rules flanking each raised cord. */
  bandGilt?: boolean;
  /** Endband stripe variant: 0 = blocks, 1 = chevron, 2 = wrapped cord. */
  headTailStyle?: number;
  /** False = no ornament stamp ("none" in the studio's 12 + none). */
  ornamentOn?: boolean;
  /** Title panel treatment. */
  titlePlate?: TitlePlateStyle;
  /** Wear, 0 (pristine) → 1 (well-loved): scuffs, bumped corners, sun-fade. */
  wear?: number;
  /** Text-block edge treatment. */
  edge?: EdgeTreatment;
  /** Bibliographic format the seeded `height` was drawn from. */
  format?: SpineFormat;
  /** Spine height in world px (drawn from `format`'s band by default). */
  height?: number;
  /** Charm carried on the shelf AND into the pull-out / open book. */
  charm?: CharmKind;
  /** Index into charms.CHARM_COLORS for the ribbon/twine/wax colourway. */
  charmColor?: number;
}

/** Suggested base spine height in world px (book zone is 280). */
export const SPINE_BASE_HEIGHT = 232;

interface HSL {
  h: number;
  s: number;
  l: number;
}

/** 12 curated warm pigment duos (top/light, bottom/dark). */
const PALETTES: ReadonlyArray<readonly [HSL, HSL]> = [
  [{ h: 38, s: 62, l: 52 }, { h: 30, s: 58, l: 38 }], // amber
  [{ h: 16, s: 55, l: 48 }, { h: 10, s: 52, l: 34 }], // terracotta
  [{ h: 95, s: 28, l: 42 }, { h: 100, s: 30, l: 30 }], // moss
  [{ h: 210, s: 26, l: 48 }, { h: 214, s: 30, l: 34 }], // dusty blue
  [{ h: 315, s: 24, l: 40 }, { h: 320, s: 28, l: 28 }], // plum
  [{ h: 44, s: 60, l: 46 }, { h: 40, s: 55, l: 33 }], // ochre
  [{ h: 130, s: 16, l: 52 }, { h: 135, s: 18, l: 38 }], // sage
  [{ h: 22, s: 60, l: 40 }, { h: 18, s: 58, l: 28 }], // rust
  [{ h: 28, s: 38, l: 52 }, { h: 24, s: 36, l: 38 }], // clay
  [{ h: 70, s: 30, l: 38 }, { h: 66, s: 32, l: 27 }], // olive
  [{ h: 200, s: 18, l: 42 }, { h: 204, s: 20, l: 30 }], // slate
  [{ h: 355, s: 32, l: 56 }, { h: 350, s: 30, l: 42 }], // blush
];

const FONTS: readonly string[] = [
  '"Caveat Variable", "Caveat", cursive',
  '"Kalam", cursive',
  '"Patrick Hand", cursive',
];

const GOLD = '#c9a227';
const GRAPHITE = 'rgba(58, 50, 42, 0.55)';

/**
 * Derive the full parameter set for one book from its seed.
 * Pure and deterministic: same seed ⇒ structurally identical params.
 */
export function deriveSpineParams(seed: number): SpineParams {
  const rnd = mulberry32(seed >>> 0);
  const silhouette = Math.floor(rnd() * 7);
  const palette = Math.floor(rnd() * PALETTES.length);
  const hueJitter = (rnd() * 2 - 1) * 6;

  const bandCount = Math.floor(rnd() * 4); // 0–3
  const bands: BandSpec[] = [];
  // Always consume the same number of rnd() calls so the parameter stream
  // stays aligned regardless of bandCount.
  for (let i = 0; i < 3; i++) {
    const y = 0.12 + rnd() * 0.76;
    const kind = Math.floor(rnd() * 3) as 0 | 1 | 2;
    if (i < bandCount) bands.push({ y, kind });
  }
  bands.sort((a, b) => a.y - b.y);

  const ornament = Math.floor(rnd() * 12);
  const texture = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const font = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const gilt = rnd() < 0.3;
  const lean = (rnd() * 2 - 1) * 1.2;
  // Average of two uniforms ⇒ triangular distribution peaked at the middle
  // of 28–46, i.e. weighted toward 32–38.
  const w = 28 + ((rnd() + rnd()) / 2) * 18;
  const hJitter = (rnd() * 2 - 1) * 6;
  // New draws are APPENDED so every earlier parameter keeps its value for a
  // given seed (the rnd stream stays aligned with the original recipe).
  const twoTone = rnd() < 0.3;
  const twoToneSplit = 0.26 + rnd() * 0.22;
  const headTail = rnd() < 0.55;

  // --- Book Studio rolls (appended: earlier fields keep their values) ---
  const material = pickWeighted(rnd(), MATERIAL_WEIGHTS);
  // Cords are a leather/vellum convention; cloth and paper books rarely have
  // them, so the count is biased by material.
  const cordBias = MATERIAL_CORD_BIAS[material];
  const cordRoll = rnd();
  const raisedBands =
    cordRoll < cordBias.none ? 0 : 1 + Math.floor(rnd() * cordBias.max);
  const bandGilt = rnd() < (gilt ? 0.75 : 0.34);
  const headTailStyle = Math.floor(rnd() * 3);
  const ornamentOn = rnd() < 0.82;
  const titlePlate = pickWeighted(rnd(), PLATE_WEIGHTS);
  // Skew hard toward the low end: most books are gently read, few are ruins.
  const wearRoll = rnd();
  const wear = clamp(wearRoll * wearRoll * (0.55 + MATERIAL_WEAR_BIAS[material]), 0, 1);
  const edge = pickWeighted(rnd(), EDGE_WEIGHTS);
  const charmRoll = rnd();
  const charm: CharmKind =
    charmRoll < 0.66
      ? 'none'
      : (['ribbon', 'tassel', 'pressed-flower', 'clasp', 'wax-seal', 'tag'] as const)[
          Math.floor(rnd() * 6)
        ] ?? 'none';
  const charmColor = Math.floor(rnd() * 8);

  // --- book format (appended last: every earlier field keeps its value) ---
  // A real shelf is not a row of identical rectangles — it is folios next to
  // pocket duodecimos. `hJitter` (±6px, consumed above) stays exactly as it
  // was for the legacy compositor; `height` now carries the format spread.
  const format = pickWeighted(rnd(), FORMAT_WEIGHTS);
  const span = SPINE_FORMATS[format];
  const height = clamp(
    span.min + rnd() * (span.max - span.min) + hJitter * 0.35,
    SPINE_HEIGHT_RANGE.min,
    SPINE_HEIGHT_RANGE.max,
  );

  return {
    format,
    seed: seed >>> 0,
    silhouette,
    palette,
    hueJitter,
    bands,
    ornament,
    texture,
    font,
    gilt,
    lean,
    w,
    hJitter,
    twoTone,
    twoToneSplit,
    headTail,
    material,
    raisedBands,
    bandGilt,
    headTailStyle,
    ornamentOn,
    titlePlate,
    wear,
    edge,
    height,
    charm,
    charmColor,
  };
}

/* --------------------------- weighted roll tables ------------------------- */

/** Pick from [value, weight] pairs with a roll already in [0, 1). */
function pickWeighted<T>(roll: number, table: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, wgt] of table) total += wgt;
  let acc = roll * total;
  for (const [value, wgt] of table) {
    acc -= wgt;
    if (acc < 0) return value;
  }
  return (table[table.length - 1] as readonly [T, number])[0];
}

const MATERIAL_WEIGHTS: ReadonlyArray<readonly [BindingMaterial, number]> = [
  ['leather', 22],
  ['cloth', 24],
  ['paper', 18],
  ['linen', 14],
  ['vellum', 10],
  ['silk', 12],
];

/** `none` = chance of zero cords; `max` = cords drawn as 1 + floor(r*max). */
const MATERIAL_CORD_BIAS: Readonly<Record<BindingMaterial, { none: number; max: number }>> = {
  leather: { none: 0.2, max: 5 },
  vellum: { none: 0.4, max: 4 },
  cloth: { none: 0.66, max: 3 },
  linen: { none: 0.7, max: 3 },
  paper: { none: 0.86, max: 2 },
  silk: { none: 0.78, max: 2 },
};

/** Added to the wear multiplier — soft bindings age faster than leather. */
const MATERIAL_WEAR_BIAS: Readonly<Record<BindingMaterial, number>> = {
  leather: 0.15,
  cloth: 0.3,
  paper: 0.45,
  vellum: 0.2,
  linen: 0.35,
  silk: 0.25,
};

const PLATE_WEIGHTS: ReadonlyArray<readonly [TitlePlateStyle, number]> = [
  ['none', 38],
  ['gilt', 24],
  ['label', 22],
  ['debossed', 16],
];

const FORMAT_WEIGHTS: ReadonlyArray<readonly [SpineFormat, number]> = [
  ['folio', 9],
  ['quarto', 20],
  ['octavo', 38],
  ['duodecimo', 22],
  ['pocket', 11],
];

const EDGE_WEIGHTS: ReadonlyArray<readonly [EdgeTreatment, number]> = [
  ['plain', 58],
  ['gilt', 18],
  ['speckled', 14],
  ['marbled', 10],
];

/** Material implied by the legacy 0|1|2 `texture` field. */
export function materialFromTexture(texture: 0 | 1 | 2): BindingMaterial {
  return texture === 0 ? 'cloth' : texture === 1 ? 'leather' : 'paper';
}

/** Legacy 0|1|2 texture bucket a material falls into (cover back-compat). */
export function textureFromMaterial(material: BindingMaterial): 0 | 1 | 2 {
  switch (material) {
    case 'leather':
      return 1;
    case 'cloth':
    case 'linen':
    case 'silk':
      return 0;
    default:
      return 2;
  }
}

/** Middle of a format's height band, in world px (the studio's preset value). */
export function heightForFormat(format: SpineFormat): number {
  const span = SPINE_FORMATS[format];
  return clamp((span.min + span.max) / 2, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
}

/** Which format band a height lands in (so the studio can label a slider). */
export function formatForHeight(height: number): SpineFormat {
  let best: SpineFormat = 'octavo';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of SPINE_FORMAT_IDS) {
    const span = SPINE_FORMATS[id];
    const d = height < span.min ? span.min - height : height > span.max ? height - span.max : 0;
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/** Resolved spine height in world px (studio override wins over the jitter). */
export function spineHeightPx(params: SpineParams): number {
  return clamp(
    params.height ?? SPINE_BASE_HEIGHT + params.hJitter,
    SPINE_HEIGHT_RANGE.min,
    SPINE_HEIGHT_RANGE.max,
  );
}

/**
 * Public alias for cover modules (the pulled-book overlay bakes a DOM/canvas
 * cover that must match the shelf spine exactly). Same seed ⇒ same params.
 */
export function getSpineParams(seed: number): SpineParams {
  return deriveSpineParams(seed);
}

/** CSS-usable palette of one spine, derived from its params. */
export interface SpinePaletteCss {
  /** Light/top pigment. */
  top: string;
  /** Dark/bottom pigment. */
  bottom: string;
  /** Deep ink used for bands/edges. */
  ink: string;
  /** Ornament/title color (gold when the book is gilt). */
  accent: string;
  /** The shared gilt gold. */
  gold: string;
}

/**
 * The canonical palette lookup for a book's params — exported so the cover
 * module (and the DOM overlay) never has to duplicate the pigment tables.
 */
export function getSpinePalette(params: SpineParams): SpinePaletteCss {
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const hue = params.hueJitter;
  return {
    top: hslStr(duo[0], hue),
    bottom: hslStr(duo[1], hue),
    ink: hslStr(duo[1], hue, -18),
    accent: params.gilt ? GOLD : hslStr(duo[1], hue, -24),
    gold: GOLD,
  };
}

/* --------------------------- granulation tile ---------------------------- */

export type Canvas2D = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const GRANULATION_SIZE = 256;
let granulationTile: Canvas2D | null = null;

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('spines: 2d context unavailable');
  return ctx as Ctx2D;
}

/**
 * The shared 256² high-frequency granulation noise tile (module-level lazy).
 * Drawn everywhere with globalCompositeOperation 'overlay' at alpha 0.06 —
 * cheaper than another filter chain, reused by spines, wood and washes.
 */
export function getGranulationTile(): Canvas2D {
  if (granulationTile) return granulationTile;
  const c = makeCanvas(GRANULATION_SIZE, GRANULATION_SIZE);
  const ctx = get2d(c);
  const img = ctx.createImageData(GRANULATION_SIZE, GRANULATION_SIZE);
  const rnd = mulberry32(0xa57a57);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    // Mid-gray ± noise: gray 128 is neutral under 'overlay'.
    const v = Math.round(128 + (rnd() * 2 - 1) * 56);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  granulationTile = c;
  return c;
}

/* ------------------------------ geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/**
 * Silhouette outline (clockwise from top-left) in local coords, before
 * jittering. Templates 0–6.
 */
function silhouetteOutline(silhouette: number, w: number, h: number): Pt[] {
  const tl: Pt = { x: 0, y: 0 };
  const tr: Pt = { x: w, y: 0 };
  const br: Pt = { x: w, y: h };
  const bl: Pt = { x: 0, y: h };
  switch (silhouette) {
    case 1: // tapered top
      return [{ x: w * 0.08, y: 0 }, { x: w * 0.92, y: 0 }, br, bl];
    case 2: // tapered bottom
      return [tl, tr, { x: w * 0.94, y: h }, { x: w * 0.06, y: h }];
    case 3: // banded — slight bulge at mid height
      return [
        tl, tr,
        { x: w * 1.03, y: h * 0.5 },
        br, bl,
        { x: -w * 0.03, y: h * 0.5 },
      ];
    case 4: // scalloped top edge
      return [
        tl,
        { x: w * 0.25, y: h * 0.012 },
        { x: w * 0.5, y: -h * 0.008 },
        { x: w * 0.75, y: h * 0.012 },
        tr, br, bl,
      ];
    case 5: // rounded (chamfered) top corners
      return [
        { x: 0, y: h * 0.02 },
        { x: w * 0.14, y: 0 },
        { x: w * 0.86, y: 0 },
        { x: w, y: h * 0.02 },
        br, bl,
      ];
    case 6: // waist
      return [
        tl, tr,
        { x: w * 0.95, y: h * 0.5 },
        br, bl,
        { x: w * 0.05, y: h * 0.5 },
      ];
    default: // 0 straight
      return [tl, tr, br, bl];
  }
}

/**
 * Densify a closed polygon (subdivide each edge every ~`step` px) and jitter
 * every vertex by ±amp. The jitter sequence comes from `rnd`, so identical
 * seeds reproduce identical outlines.
 */
function densifyJitter(pts: readonly Pt[], step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(1, Math.round(len / step));
    for (let k = 0; k < segs; k++) {
      const t = k / segs;
      out.push({
        x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
        y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
      });
    }
  }
  return out;
}

function tracePoly(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  ctx.beginPath();
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

/** Jittered open polyline between two points (for band rules etc.). */
function jitteredSegment(a: Pt, b: Pt, step: number, amp: number, rnd: RandomFn): Pt[] {
  const out: Pt[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const segs = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    out.push({
      x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
      y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp,
    });
  }
  return out;
}

/** Stroke a rectangle as four jittered pencil segments. */
function jitterRectStroke(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
  amp: number,
  rnd: RandomFn,
): void {
  const c: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  for (let i = 0; i < 4; i++) {
    tracePoly(ctx, jitteredSegment(c[i] as Pt, c[(i + 1) % 4] as Pt, step, amp, rnd), false);
    ctx.stroke();
  }
}

/* -------------------------------- colors --------------------------------- */

function hslStr(c: HSL, hueShift: number, dl = 0, ds = 0, alpha = 1): string {
  const h = ((c.h + hueShift) % 360 + 360) % 360;
  const s = clamp(c.s + ds, 0, 100);
  const l = clamp(c.l + dl, 0, 100);
  return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;
}

/* ------------------------------- ornaments ------------------------------- */

function strokePts(ctx: Ctx2D, pts: readonly Pt[], close: boolean): void {
  tracePoly(ctx, pts, close);
  ctx.stroke();
}

/**
 * The 12 procedural ornament stamps, drawn as simple wobbled paths:
 * 0 diamond, 1 laurel, 2 star, 3 blot, 4 chevron, 5 sun, 6 moon, 7 keyhole,
 * 8 laurel wreath, 9 quill, 10 tree, 11 crescent-with-stars.
 */
function drawOrnament(
  ctx: Ctx2D,
  kind: number,
  cx: number,
  cy: number,
  s: number,
  rnd: RandomFn,
): void {
  const j = (v: number) => v + (rnd() * 2 - 1) * s * 0.06;
  const pt = (x: number, y: number): Pt => ({ x: j(cx + x * s), y: j(cy + y * s) });

  switch (kind) {
    case 0: { // diamond
      strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
      break;
    }
    case 1: { // laurel spray — two mirrored stems with FILLED leaves
      // Hairline leaf ticks vanish at 14px; solid leaves survive.
      for (const side of [-1, 1]) {
        strokePts(ctx, [pt(side * 0.12, 0.92), pt(side * 0.42, 0.1), pt(side * 0.34, -0.86)], false);
        for (let i = 0; i < 4; i++) {
          const t = 0.1 + i * 0.27;
          const bx = side * (0.12 + (0.42 - 0.12) * Math.min(1, t * 1.6));
          const by = 0.92 - t * 1.78;
          const ang = side * (0.5 + i * 0.12);
          ctx.beginPath();
          ctx.ellipse(
            cx + (bx + side * 0.26) * s,
            cy + (by - 0.06) * s,
            s * 0.3,
            s * 0.12,
            ang,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      // Tie at the foot.
      strokePts(ctx, [pt(-0.2, 1), pt(0, 0.84), pt(0.2, 1)], false);
      break;
    }
    case 2: { // star (5-point)
      const star: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.45;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(pt(Math.cos(a) * r, Math.sin(a) * r));
      }
      strokePts(ctx, star, true);
      break;
    }
    case 3: { // blot — irregular filled blob
      const blob: Pt[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = 0.55 + rnd() * 0.4;
        blob.push({ x: cx + Math.cos(a) * r * s, y: cy + Math.sin(a) * r * s });
      }
      tracePoly(ctx, blob, true);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 4: { // chevron — two stacked zigzags
      for (const dy of [-0.22, 0.22]) {
        strokePts(
          ctx,
          [pt(-0.8, dy - 0.25), pt(-0.4, dy + 0.25), pt(0, dy - 0.25), pt(0.4, dy + 0.25), pt(0.8, dy - 0.25)],
          false,
        );
      }
      break;
    }
    case 5: { // sun — circle + 8 rays
      // 20 samples, not 12: at 14px a 12-gon reads as a lumpy pentagon.
      const circle: Pt[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        circle.push({
          x: cx + Math.cos(a) * 0.55 * s,
          y: cy + Math.sin(a) * 0.55 * s,
        });
      }
      strokePts(ctx, circle, true);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        strokePts(ctx, [pt(Math.cos(a) * 0.7, Math.sin(a) * 0.7), pt(Math.cos(a) * 1.05, Math.sin(a) * 1.05)], false);
      }
      break;
    }
    case 6: { // moon — crescent
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.85, -Math.PI * 0.55, Math.PI * 0.55, false);
      ctx.arc(cx + s * 0.42, cy, s * 0.62, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.8;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      break;
    }
    case 7: { // keyhole
      const circle: Pt[] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        circle.push({
          x: cx + Math.cos(a) * 0.42 * s,
          y: cy + (-0.35 + Math.sin(a) * 0.42) * s,
        });
      }
      strokePts(ctx, circle, true);
      strokePts(ctx, [pt(-0.16, -0.05), pt(-0.3, 0.85), pt(0.3, 0.85), pt(0.16, -0.05)], true);
      break;
    }
    case 8: { // laurel wreath — open-topped ring of FILLED leaves
      const leaves = 12;
      for (let i = 0; i < leaves; i++) {
        // Sweep from the bottom up both sides, leaving a gap at the crown.
        const t = i / (leaves - 1);
        const a = Math.PI / 2 + (t < 0.5 ? -1 : 1) * ((t < 0.5 ? 1 - t * 2 : t * 2 - 1) * Math.PI * 0.86);
        const bx = Math.cos(a) * 0.78;
        const by = Math.sin(a) * 0.78;
        ctx.beginPath();
        ctx.ellipse(cx + bx * s, cy + by * s, s * 0.3, s * 0.13, a + Math.PI / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ribbon knot at the bottom.
      ctx.lineWidth = Math.max(1, ctx.lineWidth);
      strokePts(ctx, [pt(-0.26, 1.02), pt(0, 0.8), pt(0.26, 1.02)], false);
      break;
    }
    case 9: { // quill — a solid feather blade on a curved shaft
      const shaftPt = (t: number): Pt =>
        pt(-0.72 + t * 1.44, 0.9 - t * 1.6 - Math.sin(t * Math.PI) * 0.3);
      // Blade: one closed vane down one side of the shaft.
      const vane: Pt[] = [];
      for (let i = 0; i <= 8; i++) vane.push(shaftPt(0.2 + (i / 8) * 0.8));
      for (let i = 8; i >= 0; i--) {
        const t = 0.2 + (i / 8) * 0.8;
        const p = shaftPt(t);
        const bulge = Math.sin(((t - 0.2) / 0.8) * Math.PI) * 0.42;
        vane.push({ x: p.x - bulge * s, y: p.y + bulge * 0.42 * s });
      }
      tracePoly(ctx, vane, true);
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.85;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      // Shaft + nib, drawn over the blade.
      const shaft: Pt[] = [];
      for (let i = 0; i <= 8; i++) shaft.push(shaftPt(i / 8));
      strokePts(ctx, shaft, false);
      strokePts(ctx, [shaftPt(0), pt(-0.94, 1.06)], false);
      break;
    }
    case 10: { // tree — trunk, three branch tiers, root flare
      strokePts(ctx, [pt(0, 1), pt(0, -0.25)], false);
      for (const [ty, sp] of [
        [0.45, 0.72],
        [0.05, 0.55],
        [-0.35, 0.36],
      ] as const) {
        strokePts(ctx, [pt(-sp, ty + 0.35), pt(0, ty - 0.2), pt(sp, ty + 0.35)], false);
      }
      strokePts(ctx, [pt(-0.3, 1), pt(0, 0.82), pt(0.3, 1)], false);
      // Tiny crown dot.
      ctx.beginPath();
      ctx.arc(cx, cy - 0.62 * s, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: { // 11 crescent-with-stars
      // A fatter crescent tipped back, so the horns read even at 14px.
      ctx.beginPath();
      ctx.arc(cx - s * 0.22, cy, s * 0.86, -Math.PI * 0.46, Math.PI * 0.46, false);
      ctx.arc(cx + s * 0.16, cy, s * 0.6, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = prevAlpha * 0.92;
      ctx.fill();
      ctx.globalAlpha = prevAlpha;
      // Filled four-point sparkles instead of hairline outlines.
      for (const [sx, sy, sr] of [
        [0.6, -0.62, 0.3],
        [0.86, 0.16, 0.19],
      ] as const) {
        tracePoly(
          ctx,
          [pt(sx, sy - sr), pt(sx + sr * 0.36, sy), pt(sx, sy + sr), pt(sx - sr * 0.36, sy)],
          true,
        );
        ctx.fill();
      }
      break;
    }
  }
}

/* ---------------------------- material tiles ----------------------------- */

/**
 * Neutral-grey (128) tiles composited with 'overlay', so they add structure
 * without shifting hue — the same trick as the granulation tile, but with
 * shaped marks instead of white noise. Lazily built, shared forever.
 */
type MaterialTileKind = 'pebble' | 'weave' | 'linen' | 'laid';
const materialTiles = new Map<MaterialTileKind, Canvas2D>();

const TILE_SIZE: Readonly<Record<MaterialTileKind, number>> = {
  pebble: 128,
  weave: 48,
  linen: 64,
  laid: 64,
};

/**
 * One cell of a plain (over-under) weave. `warp` true ⇒ the vertical thread
 * passes over the horizontal one in this cell. Threads are drawn as rounded
 * bars with a lit crown and a shadowed underside so the cloth reads as
 * *fabric* rather than a grid of lines.
 */
function weaveCell(
  ctx: Ctx2D,
  x: number,
  y: number,
  c: number,
  warp: boolean,
  thread: number,
  contrast: number,
): void {
  const half = thread / 2;
  const drawBar = (vertical: boolean, over: boolean): void => {
    const a = over ? contrast : contrast * 0.55;
    const cx = x + c / 2;
    const cy = y + c / 2;
    if (vertical) {
      const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
      g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
      g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
      g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(cx - half, y - 0.4, thread, c + 0.8);
    } else {
      const g = ctx.createLinearGradient(0, cy - half, 0, cy + half);
      g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
      g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
      g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 0.4, cy - half, c + 0.8, thread);
    }
  };
  // Under first, over second — that is what makes the interlace read.
  drawBar(!warp, false);
  drawBar(warp, true);
}

function getMaterialTile(kind: MaterialTileKind): Canvas2D {
  const hit = materialTiles.get(kind);
  if (hit) return hit;
  const size = TILE_SIZE[kind];
  const c = makeCanvas(size, size);
  const ctx = get2d(c);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(
    kind === 'pebble' ? 0x9e3b17 : kind === 'linen' ? 0x51c0de : kind === 'laid' ? 0x1a1d0e : 0x2b17a4,
  );

  if (kind === 'pebble') {
    // Leather grain: clustered irregular cells with dark valleys between the
    // lit crowns. Two passes — big soft cells, then fine crazing on top —
    // so the grain still reads once the tile is scaled up on a cover.
    for (let i = 0; i < 320; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 3.4 + rnd() * 6.5;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.05, x, y, r);
      g.addColorStop(0, 'rgba(236,236,236,0.30)');
      g.addColorStop(0.62, 'rgba(150,150,150,0.06)');
      g.addColorStop(1, 'rgba(28,28,28,0.30)');
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.68 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const r = 0.8 + rnd() * 2.2;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.7), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = rnd() < 0.55 ? 'rgba(30,30,30,0.22)' : 'rgba(236,236,236,0.18)';
      ctx.fill();
    }
  } else if (kind === 'weave') {
    // Book cloth (buckram): a TIGHT, perfectly even plain weave. The cells are
    // small and regular — that regularity is what separates cloth from linen.
    const cell = size / 12;
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 12; i++) {
        weaveCell(ctx, i * cell, j * cell, cell, (i + j) % 2 === 0, cell * 0.72, 0.4);
      }
    }
    // A whisper of sizing/starch sheen across the whole tile.
    ctx.fillStyle = 'rgba(220,220,220,0.05)';
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'linen') {
    // Linen: the SAME interlace at 3× the pitch, with irregular thread
    // thickness, drifting spacing and slubs. Coarse, hand-woven, alive.
    const cells = 5;
    const cell = size / cells;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        weaveCell(
          ctx,
          i * cell,
          j * cell,
          cell,
          (i + j) % 2 === 0,
          cell * (0.52 + rnd() * 0.3),
          0.42 + rnd() * 0.22,
        );
      }
    }
    // Slubs: short fat thread bulges that only linen has.
    for (let i = 0; i < 18; i++) {
      const x = rnd() * size;
      const y = Math.floor(rnd() * cells) * cell + cell * 0.5;
      ctx.fillStyle = `rgba(26,26,26,${(0.2 + rnd() * 0.2).toFixed(3)})`;
      ctx.fillRect(x, y - cell * 0.22, 5 + rnd() * 11, cell * 0.44);
      ctx.fillStyle = 'rgba(240,240,240,0.2)';
      ctx.fillRect(x, y - cell * 0.26, 5 + rnd() * 9, 1.2);
    }
    // Undyed neps caught in the weave.
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(246,246,246,0.26)';
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2.4, 1 + rnd() * 1.4);
    }
  } else {
    // Laid paper: widely spaced chain lines across faint laid lines — the
    // mould marks a hand-made sheet carries. The laid lines are deliberately
    // whisper-quiet and one-directional; give them any real weight and paper
    // starts reading as another woven cloth.
    for (let x = 0; x < size; x += 3.6) {
      ctx.fillStyle = `rgba(104,104,104,${(0.05 + rnd() * 0.04).toFixed(3)})`;
      ctx.fillRect(x, 0, 1.3, size);
    }
    for (let y = 0; y < size; y += 19) {
      ctx.fillStyle = 'rgba(242,242,242,0.34)';
      ctx.fillRect(0, y, size, 1.8);
      ctx.fillStyle = 'rgba(64,64,64,0.2)';
      ctx.fillRect(0, y + 2, size, 1.2);
    }
    // Pulp flecks and the odd embedded fibre.
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(48,48,48,0.14)' : 'rgba(244,244,244,0.18)';
      ctx.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.8, 0.9);
    }
    for (let i = 0; i < 14; i++) {
      ctx.save();
      ctx.translate(rnd() * size, rnd() * size);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = 'rgba(228,228,228,0.28)';
      ctx.fillRect(0, 0, 5 + rnd() * 14, 0.9);
      ctx.restore();
    }
  }

  materialTiles.set(kind, c);
  return c;
}

function tileOver(
  ctx: Ctx2D,
  tile: Canvas2D,
  w: number,
  h: number,
  tileSize: number,
  alpha: number,
  mode: GlobalCompositeOperation = 'overlay',
): void {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  for (let ty = 0; ty < h; ty += tileSize) {
    for (let tx = 0; tx < w; tx += tileSize) {
      ctx.drawImage(tile, tx, ty, tileSize, tileSize);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/* --------------------------- binding materials --------------------------- */

/**
 * Pigment accessors for a material pass. `light`/`dark` are the two tones of
 * the book's pigment duo; each takes (lightnessDelta, saturationDelta, alpha)
 * so a material can reach for a paler or deeper version of the same pigment.
 */
export interface MaterialTones {
  light: (dl?: number, ds?: number, a?: number) => string;
  dark: (dl?: number, ds?: number, a?: number) => string;
}

/**
 * Paint one of the six binding materials over an already-based, clipped
 * region of `w`×`h`. Shared verbatim by spines and covers so a linen spine
 * pulls out into a linen cover.
 *
 * Each material is a distinct *treatment*, tuned so the six are separable at
 * a glance even at 36px spine width:
 *  - leather  pebble-grain tile, soft creases, a broad waxy sheen
 *  - cloth    fine even two-way weave, cool matte veil, zero sheen
 *  - paper    flat, long fibre streaks, foxing specks, chalky veil
 *  - vellum   strong parchment lightening, translucency clouds, follicles
 *  - linen    coarse slubby weave, warm natural veil, visible flecks
 *  - silk     vertical satin sheen bands + watered (moiré) ripples
 */
export function paintBindingMaterial(
  ctx: Ctx2D,
  w: number,
  h: number,
  material: BindingMaterial,
  tones: MaterialTones,
  s: number,
  rnd: RandomFn,
): void {
  const px = Math.max(0.5, s);
  ctx.save();
  ctx.lineCap = 'round';

  switch (material) {
    case 'leather': {
      tileOver(ctx, getMaterialTile('pebble'), w, h, Math.max(44, 78 * px), 0.66);
      tileOver(ctx, getGranulationTile(), w, h, GRANULATION_SIZE * 2, 0.1, 'multiply');
      // Creases: long soft folds that follow the way a spine flexes.
      ctx.strokeStyle = tones.dark(-16, 0, 0.16);
      ctx.lineWidth = Math.max(0.7, 1.1 * px);
      for (let i = 0; i < 5; i++) {
        const cy = (0.08 + rnd() * 0.84) * h;
        ctx.beginPath();
        ctx.moveTo(-w * 0.05, cy);
        ctx.quadraticCurveTo(w * 0.5, cy + (rnd() * 2 - 1) * 9 * px, w * 1.05, cy + (rnd() * 2 - 1) * 6 * px);
        ctx.stroke();
      }
      // Waxy sheen down the crown of the spine.
      const sheen = ctx.createLinearGradient(0, 0, w, 0);
      sheen.addColorStop(0, 'rgba(255,246,226,0)');
      sheen.addColorStop(0.34, 'rgba(255,246,226,0.15)');
      sheen.addColorStop(0.52, 'rgba(255,246,226,0.06)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'cloth': {
      // Tight, perfectly even buckram grain.
      tileOver(ctx, getMaterialTile('weave'), w, h, Math.max(20, 34 * px), 0.72);
      // Matte veil: cloth eats light, never returns a highlight.
      ctx.fillStyle = 'rgba(238, 236, 230, 0.07)';
      ctx.fillRect(0, 0, w, h);
      // Cloth is dyed in the piece, so the colour sits slightly uneven.
      for (let i = 0; i < 4; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const r = (0.16 + rnd() * 0.3) * Math.max(w, h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, tones.dark(-6, 2, 0.07));
        g.addColorStop(1, tones.dark(-6, 2, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }
    case 'paper': {
      // Flat and chalky: no gloss anywhere, but the mould's laid + chain
      // lines are unmistakable.
      ctx.fillStyle = 'rgba(246, 240, 226, 0.12)';
      ctx.fillRect(0, 0, w, h);
      tileOver(ctx, getMaterialTile('laid'), w, h, Math.max(40, 68 * px), 0.42);
      ctx.strokeStyle = tones.light(16, -12, 0.1);
      ctx.lineWidth = Math.max(0.5, 0.7 * px);
      for (let i = 0; i < 9; i++) {
        const xx = rnd() * w;
        const y0 = rnd() * h * 0.6;
        ctx.beginPath();
        ctx.moveTo(xx, y0);
        ctx.quadraticCurveTo(xx + (rnd() * 2 - 1) * 3 * px, y0 + h * 0.2, xx + (rnd() * 2 - 1) * 2 * px, y0 + h * 0.4);
        ctx.stroke();
      }
      // Foxing: the little rust specks old paper grows.
      for (let i = 0; i < 40; i++) {
        const r = (0.4 + rnd() * 1.3) * px;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(126, 88, 46, ${(0.05 + rnd() * 0.13).toFixed(3)})`;
        ctx.fill();
      }
      break;
    }
    case 'vellum': {
      // Parchment lightening is the signature move — vellum reads as skin,
      // not pigment, so the duo is heavily veiled toward cream.
      ctx.fillStyle = 'rgba(242, 231, 199, 0.46)';
      ctx.fillRect(0, 0, w, h);
      // Uneven translucency: soft clouds where the skin is thinner/thicker.
      for (let i = 0; i < 9; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const r = (0.1 + rnd() * 0.3) * Math.max(w, h);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const dark = rnd() < 0.45;
        g.addColorStop(0, dark ? 'rgba(150, 124, 82, 0.16)' : 'rgba(255, 250, 232, 0.2)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // Hair follicles: faint paired pinpricks in drifting rows.
      ctx.fillStyle = 'rgba(122, 96, 58, 0.24)';
      for (let i = 0; i < 90; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        ctx.fillRect(x, y, 0.9 * px, 0.9 * px);
        if (rnd() < 0.5) ctx.fillRect(x + 1.6 * px, y + 0.7 * px, 0.8 * px, 0.8 * px);
      }
      // Waxy translucent sheen.
      const vg = ctx.createLinearGradient(0, 0, w, 0);
      vg.addColorStop(0, 'rgba(120, 96, 56, 0.14)');
      vg.addColorStop(0.42, 'rgba(255, 252, 238, 0.2)');
      vg.addColorStop(1, 'rgba(120, 96, 56, 0.16)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'linen': {
      tileOver(ctx, getMaterialTile('linen'), w, h, Math.max(26, 44 * px), 0.78);
      // Warm natural-fibre veil (linen is never as cool as buckram).
      ctx.fillStyle = 'rgba(226, 208, 172, 0.14)';
      ctx.fillRect(0, 0, w, h);
      // Undyed flecks in the weave.
      for (let i = 0; i < 34; i++) {
        ctx.fillStyle = `rgba(246, 238, 214, ${(0.12 + rnd() * 0.24).toFixed(3)})`;
        ctx.fillRect(rnd() * w, rnd() * h, (1 + rnd() * 3) * px, 0.9 * px);
      }
      break;
    }
    default: {
      // silk — the only material with a hard specular.
      const bands = 5;
      for (let i = 0; i < bands; i++) {
        const cx = ((i + 0.5) / bands) * w;
        const bw = w / bands;
        const g = ctx.createLinearGradient(cx - bw * 0.5, 0, cx + bw * 0.5, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.14)');
        g.addColorStop(0.42, 'rgba(255,252,240,0.24)');
        g.addColorStop(0.62, 'rgba(255,252,240,0.1)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - bw * 0.5, 0, bw, h);
      }
      // Watered (moiré) ripples across the sheen.
      ctx.lineWidth = Math.max(0.5, 0.8 * px);
      for (let i = 0; i < 16; i++) {
        const y0 = (i / 16) * h + rnd() * h * 0.02;
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,252,240,0.11)' : tones.dark(-12, 0, 0.09);
        ctx.beginPath();
        ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += Math.max(2, 3 * px)) {
          ctx.lineTo(x, y0 + Math.sin((x / Math.max(6, w)) * 7 + i) * 2.2 * px);
        }
        ctx.stroke();
      }
      // Crisp catchlight where the silk turns.
      const spec = ctx.createLinearGradient(w * 0.2, 0, w * 0.46, 0);
      spec.addColorStop(0, 'rgba(255,255,248,0)');
      spec.addColorStop(0.5, 'rgba(255,255,248,0.3)');
      spec.addColorStop(1, 'rgba(255,255,248,0)');
      ctx.fillStyle = spec;
      ctx.fillRect(w * 0.2, 0, w * 0.26, h);
      break;
    }
  }

  ctx.restore();
}

/* ---------------------------- edge treatments ---------------------------- */

/**
 * Paint the visible sliver of the text block's edge — on a spine that is the
 * ~3px strip at the joint, on a cover the fore-edge down the right side.
 * Four treatments: plain (cream leaves), gilt (burnished gold), marbled
 * (combed veins), speckled (spattered pigment).
 */
export function paintEdgeTreatment(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: EdgeTreatment,
  s: number,
  rnd: RandomFn,
): void {
  if (w <= 0.4 || h <= 0.4) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Cream page block with the leaf lines that any edge shows.
  const base = ctx.createLinearGradient(x, 0, x + w, 0);
  base.addColorStop(0, '#cbbc99');
  base.addColorStop(0.35, '#eae0c4');
  base.addColorStop(1, '#c9b995');
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(96, 82, 58, 0.22)';
  ctx.lineWidth = Math.max(0.4, 0.5 * s);
  const pitch = Math.max(1.4, 2 * s);
  ctx.beginPath();
  for (let yy = y; yy < y + h; yy += pitch) {
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
  }
  ctx.stroke();

  if (edge === 'gilt') {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#8a6a14');
    g.addColorStop(0.3, '#f3dc93');
    g.addColorStop(0.52, '#c9a227');
    g.addColorStop(0.78, '#f7e7ab');
    g.addColorStop(1, '#7d5f12');
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // Burnish streaks.
    ctx.strokeStyle = 'rgba(255, 248, 214, 0.4)';
    ctx.lineWidth = Math.max(0.4, 0.5 * s);
    for (let i = 0; i < 8; i++) {
      const yy = y + rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy + (rnd() * 2 - 1) * 2 * s);
      ctx.stroke();
    }
  } else if (edge === 'marbled') {
    const veins = ['#8d3a2a', '#2f4a6b', '#7b6a2c', '#5d3a5c'];
    ctx.globalAlpha = 0.62;
    for (let i = 0; i < 14; i++) {
      const col = veins[Math.floor(rnd() * veins.length)] as string;
      const y0 = y + rnd() * h;
      const amp = (0.9 + rnd() * 2.6) * s;
      const thick = (0.9 + rnd() * 2.4) * s;
      ctx.strokeStyle = col;
      ctx.lineWidth = thick;
      ctx.beginPath();
      ctx.moveTo(x - 1, y0);
      const steps = Math.max(2, Math.ceil(w / Math.max(1, s)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        ctx.lineTo(x + t * (w + 2), y0 + Math.sin(t * 6 + i) * amp);
      }
      ctx.stroke();
    }
    // Comb ticks pulled across the veins.
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#f0e6cb';
    ctx.lineWidth = Math.max(0.4, 0.6 * s);
    for (let i = 0; i < 18; i++) {
      const yy = y + rnd() * h;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy + 3 * s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (edge === 'speckled') {
    const specks = ['#7a3a24', '#4a3c2a', '#8f6a24'];
    const count = Math.max(24, Math.round((w * h) / Math.max(2, 6 * s * s)));
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = specks[Math.floor(rnd() * specks.length)] as string;
      ctx.globalAlpha = 0.25 + rnd() * 0.5;
      const r = (0.3 + rnd() * 0.9) * s;
      ctx.beginPath();
      ctx.arc(x + rnd() * w, y + rnd() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Shadow where the block meets the board.
  const sh = ctx.createLinearGradient(x, 0, x + Math.max(1, w * 0.4), 0);
  sh.addColorStop(0, 'rgba(38, 30, 20, 0.45)');
  sh.addColorStop(1, 'rgba(38, 30, 20, 0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x, y, Math.max(1, w * 0.4), h);
  ctx.restore();
}

/* --------------------------------- wear ---------------------------------- */

/**
 * Round and bump a silhouette's corners in proportion to wear. Books that
 * have been shelved for decades lose their sharp board corners first — this
 * chamfers every vertex and knocks the two tail corners in a little further.
 */
export function applyOutlineWear(
  pts: readonly Pt[],
  wear: number,
  s: number,
  rnd: RandomFn,
): Pt[] {
  if (wear <= 0.02 || pts.length < 3) return pts.slice();
  const r = (0.8 + wear * 5) * s;
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n] as Pt;
    const cur = pts[i] as Pt;
    const next = pts[(i + 1) % n] as Pt;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const ri = Math.min(r, inLen * 0.45);
    const ro = Math.min(r, outLen * 0.45);
    // Bumped corner: knock the vertex itself inward a touch.
    const bump = wear * 1.8 * s * rnd();
    out.push({
      x: cur.x + ((prev.x - cur.x) / inLen) * ri,
      y: cur.y + ((prev.y - cur.y) / inLen) * ri,
    });
    out.push({
      x: cur.x + ((prev.x - cur.x) / inLen + (next.x - cur.x) / outLen) * bump,
      y: cur.y + ((prev.y - cur.y) / inLen + (next.y - cur.y) / outLen) * bump,
    });
    out.push({
      x: cur.x + ((next.x - cur.x) / outLen) * ro,
      y: cur.y + ((next.y - cur.y) / outLen) * ro,
    });
  }
  return out;
}

/**
 * The wear pass: sun-faded panel, edge scuffs, rubbed patches where the
 * pigment has gone back to board, grime pooled at the tail, and hairline
 * cracks once a book is genuinely well-loved. Runs inside the silhouette
 * clip, over the finished artwork.
 */
export function paintWear(
  ctx: Ctx2D,
  w: number,
  h: number,
  wear: number,
  tones: MaterialTones,
  s: number,
  rnd: RandomFn,
): void {
  if (wear <= 0.02) return;
  const px = Math.max(0.5, s);
  ctx.save();

  // --- sun-faded panel: a soft band of light that lay across the spine for
  // years. Feathered on BOTH sides and inset from the joint — a hard-edged
  // stripe starting at x=0 reads as a printing fault, not as sunlight. ---
  const fadeC = w * 0.4;
  const fadeR = w * (0.34 + wear * 0.34);
  const fade = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
  const fadeA = 0.06 + wear * 0.2;
  fade.addColorStop(0, 'rgba(222, 210, 182, 0)');
  fade.addColorStop(0.34, `rgba(224, 212, 184, ${(fadeA * 0.75).toFixed(3)})`);
  fade.addColorStop(0.52, `rgba(226, 214, 186, ${fadeA.toFixed(3)})`);
  fade.addColorStop(1, 'rgba(222, 210, 182, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  // Desaturate the same band so it reads as bleached, not merely lighter.
  ctx.globalCompositeOperation = 'saturation';
  ctx.globalAlpha = 0.14 + wear * 0.4;
  const sat = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
  sat.addColorStop(0, 'hsl(0 0% 60% / 0)');
  sat.addColorStop(0.5, 'hsl(0 0% 60%)');
  sat.addColorStop(1, 'hsl(0 0% 60% / 0)');
  ctx.fillStyle = sat;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- edge scuffs: rubs along both joints ---
  const scuffs = Math.round(3 + wear * 16);
  ctx.lineCap = 'round';
  for (let i = 0; i < scuffs; i++) {
    const edgeX = rnd() < 0.5 ? (0.6 + rnd() * 1.6) * px : w - (0.6 + rnd() * 1.6) * px;
    const wy = rnd() * h;
    const len = (4 + rnd() * 22) * px;
    ctx.strokeStyle = tones.light(28 + rnd() * 14, -20, 0.14 + wear * 0.34);
    ctx.lineWidth = (0.5 + rnd() * 0.9) * px;
    ctx.beginPath();
    ctx.moveTo(edgeX, wy);
    ctx.lineTo(edgeX + (rnd() * 2 - 1) * 1.2 * px, wy + len);
    ctx.stroke();
  }

  // --- rubbed patches: pigment gone, board showing through ---
  if (wear > 0.3) {
    const patches = Math.round(1 + wear * 5);
    for (let i = 0; i < patches; i++) {
      const cx = rnd() < 0.5 ? (1 + rnd() * 3) * px : w - (1 + rnd() * 3) * px;
      const cy = rnd() * h;
      const rx = (2 + rnd() * 5) * px;
      const ry = (5 + rnd() * 26) * px;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      g.addColorStop(0, tones.light(30, -26, 0.34 * wear));
      g.addColorStop(1, tones.light(30, -26, 0));
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.fillRect(-Math.max(rx, ry), -Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
      ctx.restore();
    }
  }

  // --- bumped corners: pale wedges where the board has been knocked ---
  for (const [cx, cy] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ] as const) {
    const r = (1.6 + wear * 6 + rnd() * 2) * px;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, tones.light(34, -28, 0.2 + wear * 0.42));
    g.addColorStop(1, tones.light(34, -28, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // --- grime pooled at the tail (books are shelved bottom-first) ---
  const grime = ctx.createLinearGradient(0, h * 0.86, 0, h);
  grime.addColorStop(0, 'rgba(44, 34, 22, 0)');
  grime.addColorStop(1, `rgba(44, 34, 22, ${(0.08 + wear * 0.22).toFixed(3)})`);
  ctx.fillStyle = grime;
  ctx.fillRect(0, h * 0.86, w, h * 0.14);

  // --- worn through: the head and tail caps of a truly well-loved book give
  // out first, and the joint frays back to the board underneath ---
  if (wear > 0.8) {
    const t = (wear - 0.8) / 0.2;
    for (const capY of [0, h] as const) {
      const dir = capY === 0 ? 1 : -1;
      const capH = (2.5 + t * 5) * px;
      const g = ctx.createLinearGradient(0, capY, 0, capY + dir * capH);
      g.addColorStop(0, tones.light(36, -32, 0.3 + t * 0.34));
      g.addColorStop(1, tones.light(36, -32, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(capY, capY + dir * capH), w, capH);
      // A nick out of the cap.
      ctx.fillStyle = tones.light(30, -30, 0.24 + t * 0.3);
      const nx = (0.2 + rnd() * 0.6) * w;
      ctx.beginPath();
      ctx.ellipse(nx, capY, (1.6 + rnd() * 3) * px, (1.4 + t * 3.4) * px, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- hairline cracks in the joint, only when truly well-loved ---
  if (wear > 0.62) {
    ctx.strokeStyle = 'rgba(38, 28, 18, 0.34)';
    ctx.lineWidth = Math.max(0.4, 0.6 * px);
    const cracks = Math.round((wear - 0.62) * 12);
    for (let i = 0; i < cracks; i++) {
      const x0 = rnd() < 0.5 ? 1.5 * px : w - 1.5 * px;
      const y0 = rnd() < 0.5 ? rnd() * h * 0.22 : h * (0.78 + rnd() * 0.22);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      let cxp = x0;
      let cyp = y0;
      for (let k = 0; k < 4; k++) {
        cxp += (rnd() * 2 - 1) * 3 * px;
        cyp += (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 5) * px;
        ctx.lineTo(cxp, cyp);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* ------------------------------ panel layout ----------------------------- */

interface Panel {
  y0: number;
  y1: number;
}

/**
 * Split the spine into the panels a binder would work with: the zone between
 * head and tail, cut by the raised cords and by whatever band the charm
 * occupies. Title goes in one panel, the ornament stamp in another — exactly
 * how real tooled spines are laid out.
 */
function spinePanels(
  cordYs: readonly number[],
  reserve: Panel | null,
  /**
   * Half-thickness of a cut (cord or band rule) as a fraction of the spine
   * height. Panels are held clear of it — otherwise a raised cord runs
   * straight through the middle of the lettering, which is exactly what the
   * first pass of this did.
   */
  cutPad = 0,
): Panel[] {
  const zoneTop = 0.055;
  const zoneBot = 0.945;
  const cuts: Panel[] = [];
  let prev = zoneTop;
  for (const y of [...cordYs].sort((a, b) => a - b)) {
    if (y - cutPad > prev) cuts.push({ y0: prev, y1: y - cutPad });
    prev = Math.max(prev, y + cutPad);
  }
  if (zoneBot > prev) cuts.push({ y0: prev, y1: zoneBot });

  if (!reserve) return cuts;
  const out: Panel[] = [];
  for (const p of cuts) {
    if (reserve.y1 <= p.y0 || reserve.y0 >= p.y1) {
      out.push(p);
      continue;
    }
    if (reserve.y0 > p.y0) out.push({ y0: p.y0, y1: reserve.y0 });
    if (reserve.y1 < p.y1) out.push({ y0: reserve.y1, y1: p.y1 });
  }
  return out;
}

/* -------------------------------- render --------------------------------- */

export interface RenderSpineOptions {
  /**
   * Hi-res variant: adds the vertical title with per-glyph baseline wobble.
   * Lo-res LOD bakes skip text entirely (illegible at that size anyway).
   */
  hiRes?: boolean;
}

/**
 * Render one spine at (x, y) on `ctx`. hPx is the spine height in canvas px;
 * `scale` converts world px → canvas px (params.w * scale = drawn width).
 *
 * params.lean and params.hJitter are NOT applied here — spines are baked
 * upright into atlas rects; the shelf compositor applies lean/height when
 * placing the sprite.
 *
 * Layer order per the docs: base silhouette fill → two layered multiply
 * watercolor gradients → 2px inset pigment-pooling edge → texture → bands →
 * ornament stamp → title (hiRes) → shared granulation overlay → pencil edges.
 */
export function renderSpine(
  ctx: Ctx2D,
  params: SpineParams,
  x: number,
  y: number,
  hPx: number,
  scale: number,
  title: string,
  opts: RenderSpineOptions = {},
): void {
  const w = params.w * scale;
  const h = hPx;
  const duo = PALETTES[params.palette % PALETTES.length] as readonly [HSL, HSL];
  const [colA, colB] = duo;
  const hue = params.hueJitter;
  const rnd = mulberry32((params.seed ^ 0x51ab) >>> 0);

  // --- resolved studio style (all optional fields get a stable default) ---
  const material = params.material ?? materialFromTexture(params.texture);
  const wear = clamp(params.wear ?? 0.12, 0, 1);
  const raisedBands = clamp(Math.round(params.raisedBands ?? 0), 0, MAX_RAISED_BANDS);
  const bandGilt = params.bandGilt ?? params.gilt;
  const headTailStyle = clamp(Math.round(params.headTailStyle ?? 0), 0, 2);
  const ornamentOn = params.ornamentOn ?? true;
  const titlePlate: TitlePlateStyle = params.titlePlate ?? 'none';
  const edge = params.edge ?? 'plain';
  const charm: CharmKind = params.charm ?? 'none';
  const tones: MaterialTones = {
    light: (dl = 0, ds = 0, a = 1) => hslStr(colA, hue, dl, ds, a),
    dark: (dl = 0, ds = 0, a = 1) => hslStr(colB, hue, dl, ds, a),
  };

  ctx.save();
  ctx.translate(x, y);

  // --- silhouette fill path (jittered, corners worn round) ---
  const outline = applyOutlineWear(silhouetteOutline(params.silhouette, w, h), wear, scale, rnd);
  const step = Math.max(4, 6 * scale);
  const fillPts = densifyJitter(outline, step, 0.6 * scale, rnd);
  tracePoly(ctx, fillPts, true);
  ctx.fillStyle = hslStr(colA, hue);
  ctx.fill();

  // Everything painterly happens clipped to the silhouette.
  ctx.save();
  tracePoly(ctx, fillPts, true);
  ctx.clip();

  // --- two layered multiply watercolor gradients ---
  const g1 = ctx.createLinearGradient(0, 0, 0, h);
  g1.addColorStop(0, hslStr(colA, hue, 8));
  g1.addColorStop(0.55, hslStr(colA, hue));
  g1.addColorStop(1, hslStr(colB, hue));
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = g1;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, hslStr(colB, hue, -6));
  g2.addColorStop(0.18, hslStr(colA, hue, 10));
  g2.addColorStop(0.82, hslStr(colA, hue, 6));
  g2.addColorStop(1, hslStr(colB, hue, -8));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g2;
  ctx.fillRect(-w * 0.05, 0, w * 1.1, h);

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- two-tone binding: darker partner tone over the head section ---
  if (params.twoTone) {
    const splitY = params.twoToneSplit * h;
    const g3 = ctx.createLinearGradient(0, 0, 0, splitY);
    g3.addColorStop(0, hslStr(colB, hue, -2, 4, 0.92));
    g3.addColorStop(1, hslStr(colB, hue, -10, 2, 0.92));
    ctx.fillStyle = g3;
    ctx.fillRect(-w * 0.05, 0, w * 1.1, splitY);
    // Separating rule where the tones meet: gilt on gilt books, ink else.
    if (params.gilt) {
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.04, splitY - 1.1 * scale, w * 0.92, 2.2 * scale);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = hslStr(colB, hue, -22, 0, 0.7);
    ctx.lineWidth = Math.max(0.7, 0.8 * scale);
    strokePts(
      ctx,
      jitteredSegment({ x: 0, y: splitY }, { x: w, y: splitY }, step, 0.4 * scale, rnd),
      false,
    );
  }

  // --- 2px inset pigment-pooling edge (stroke inside the clip) ---
  tracePoly(ctx, fillPts, true);
  ctx.lineWidth = 4 * scale; // clipped: only the inner ~2px shows
  ctx.strokeStyle = hslStr(colB, hue, -12, 0, 0.5);
  ctx.stroke();

  // --- binding material (six distinct baked treatments) ---
  ctx.globalAlpha = 1;
  paintBindingMaterial(ctx, w, h, material, tones, scale, rnd);

  // --- text-block edge: the sliver of pages showing at the fore-joint ---
  const edgeW = clamp(w * 0.075, 1.6 * scale, 4 * scale);
  paintEdgeTreatment(ctx, w - edgeW, h * 0.012, edgeW, h * 0.976, edge, scale, rnd);

  // --- bands (embossed: every dark rule carries a catchlight rule above) ---
  const inkBand = hslStr(colB, hue, -18, 0, 0.8);
  const embossLight = hslStr(colA, hue, 26, -8, 0.5);
  const legacyBands = raisedBands > 0 ? [] : params.bands;
  for (const band of legacyBands) {
    const by = band.y * h;
    if (band.kind === 0) {
      // embossed double-rule: light/dark pairs read as raised cords
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-1.8 * scale, 1.8 * scale]) {
        ctx.strokeStyle = embossLight;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy - 0.9 * scale }, { x: w * 0.94, y: by + dy - 0.9 * scale }, step, 0.35 * scale, rnd), false);
        ctx.strokeStyle = inkBand;
        strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy }, { x: w * 0.94, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else if (band.kind === 1) {
      // thick raised band: shaded fill, catchlight on top, shadow below
      ctx.fillStyle = hslStr(colB, hue, -8, 0, 0.65);
      ctx.fillRect(0, by - 3 * scale, w, 6 * scale);
      ctx.strokeStyle = embossLight;
      ctx.lineWidth = Math.max(0.6, 0.6 * scale);
      strokePts(ctx, jitteredSegment({ x: 0, y: by - 3.8 * scale }, { x: w, y: by - 3.8 * scale }, step, 0.35 * scale, rnd), false);
      ctx.strokeStyle = inkBand;
      ctx.lineWidth = Math.max(0.7, 0.7 * scale);
      for (const dy of [-3 * scale, 3 * scale]) {
        strokePts(ctx, jitteredSegment({ x: 0, y: by + dy }, { x: w, y: by + dy }, step, 0.4 * scale, rnd), false);
      }
    } else {
      // gilt band with an embossed shadow under the gold
      ctx.fillStyle = hslStr(colB, hue, -20, 0, 0.4);
      ctx.fillRect(w * 0.05, by + 1.2 * scale, w * 0.9, 1.2 * scale);
      ctx.fillStyle = GOLD;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(w * 0.05, by - 1.4 * scale, w * 0.9, 2.8 * scale);
      ctx.globalAlpha = prevAlpha;
      ctx.fillStyle = 'rgba(255, 244, 214, 0.55)';
      ctx.fillRect(w * 0.08, by - 1.4 * scale, w * 0.84, 0.8 * scale);
      ctx.strokeStyle = hslStr(colB, hue, -20, 0, 0.5);
      ctx.lineWidth = Math.max(0.5, 0.5 * scale);
      strokePts(ctx, jitteredSegment({ x: w * 0.05, y: by }, { x: w * 0.95, y: by }, step, 0.3 * scale, rnd), false);
    }
  }

  // --- raised bands (cords sewn under the leather), 0–5, optionally gilt ---
  const cordYs: number[] = [];
  if (raisedBands > 0) {
    const zTop = 0.085;
    const zBot = 0.915;
    for (let i = 0; i < raisedBands; i++) {
      cordYs.push(zTop + ((i + 1) / (raisedBands + 1)) * (zBot - zTop));
    }
  }
  const cordH = clamp(w * 0.17, 3.2 * scale, 7.5 * scale);
  for (const cy of cordYs) {
    const by = cy * h;
    const top = by - cordH / 2;
    // Cylindrical shading: shadow above, lit crown, deep shadow beneath.
    const cg = ctx.createLinearGradient(0, top - cordH * 0.45, 0, top + cordH * 1.5);
    cg.addColorStop(0, hslStr(colB, hue, -26, 0, 0.55));
    cg.addColorStop(0.24, hslStr(colA, hue, 20, -6, 0.85));
    cg.addColorStop(0.44, hslStr(colA, hue, 4, 0, 0.9));
    cg.addColorStop(0.72, hslStr(colB, hue, -12, 0, 0.85));
    cg.addColorStop(1, hslStr(colB, hue, -30, 0, 0.5));
    ctx.fillStyle = cg;
    ctx.fillRect(0, top - cordH * 0.45, w, cordH * 1.95);
    // Crown catchlight + the seat line under the cord.
    ctx.lineWidth = Math.max(0.6, 0.7 * scale);
    ctx.strokeStyle = hslStr(colA, hue, 34, -10, 0.5);
    strokePts(ctx, jitteredSegment({ x: 0, y: top + cordH * 0.24 }, { x: w, y: top + cordH * 0.24 }, step, 0.3 * scale, rnd), false);
    ctx.strokeStyle = hslStr(colB, hue, -30, 0, 0.6);
    strokePts(ctx, jitteredSegment({ x: 0, y: top + cordH * 1.05 }, { x: w, y: top + cordH * 1.05 }, step, 0.35 * scale, rnd), false);
    if (bandGilt) {
      // A gold rule tooled tight against each side of the cord.
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(w * 0.07, top - cordH * 0.62, w * 0.86, Math.max(0.8, 1.1 * scale));
      ctx.fillRect(w * 0.07, top + cordH * 1.28, w * 0.86, Math.max(0.8, 1.1 * scale));
      ctx.globalAlpha = 1;
    }
  }

  // --- head/tail endbands: striped caps at the very top and bottom ---
  if (params.headTail) {
    // Real endbands are a *fine* two-colour silk twist, only a few threads
    // deep. Kept low-contrast and shallow here: at shelf scale a loud band
    // reads as hazard tape across the top of every book.
    const bandH = 3.2 * scale;
    const stripeW = Math.max(1.5 * scale, 2);
    const capColor = params.gilt ? GOLD : hslStr(colB, hue, -6, -6);
    const creamColor = 'hsl(41 40% 82%)';
    for (const [cy0, edgeY] of [
      [0.6 * scale, 0],
      [h - bandH - 0.6 * scale, h],
    ] as const) {
      ctx.fillStyle = creamColor;
      ctx.globalAlpha = 0.62;
      ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = capColor;
      if (headTailStyle === 1) {
        // Chevron endband: slanted stripes, the classic two-colour sewing.
        for (let sx = w * 0.02; sx < w * 0.98; sx += stripeW * 2) {
          ctx.beginPath();
          ctx.moveTo(sx, cy0 + bandH);
          ctx.lineTo(sx + stripeW, cy0 + bandH);
          ctx.lineTo(sx + stripeW + bandH * 0.8, cy0);
          ctx.lineTo(sx + bandH * 0.8, cy0);
          ctx.closePath();
          ctx.fill();
        }
      } else if (headTailStyle === 2) {
        // Wrapped cord: a rounded core with thread spiralling round it.
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = creamColor;
        ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
        ctx.globalAlpha = 0.62;
        ctx.strokeStyle = capColor;
        ctx.lineWidth = Math.max(0.7, 0.9 * scale);
        for (let sx = w * 0.03; sx < w * 0.99; sx += stripeW * 1.35) {
          ctx.beginPath();
          ctx.moveTo(sx, cy0 + bandH);
          ctx.lineTo(sx + bandH * 0.75, cy0);
          ctx.stroke();
        }
        // Crown highlight so the cord reads round.
        ctx.strokeStyle = 'rgba(255, 250, 232, 0.32)';
        ctx.lineWidth = Math.max(0.5, 0.6 * scale);
        ctx.beginPath();
        ctx.moveTo(w * 0.05, cy0 + bandH * 0.3);
        ctx.lineTo(w * 0.95, cy0 + bandH * 0.3);
        ctx.stroke();
      } else {
        for (let sx = w * 0.04; sx < w * 0.96; sx += stripeW * 2) {
          ctx.fillRect(sx, cy0, Math.min(stripeW, w * 0.96 - sx), bandH);
        }
      }
      ctx.globalAlpha = 1;
      // Seat line where the endband meets the boards.
      ctx.strokeStyle = hslStr(colB, hue, -24, 0, 0.4);
      ctx.lineWidth = Math.max(0.5, 0.5 * scale);
      const seamY = edgeY === 0 ? cy0 + bandH : cy0;
      strokePts(ctx, jitteredSegment({ x: w * 0.03, y: seamY }, { x: w * 0.97, y: seamY }, step, 0.35 * scale, rnd), false);
    }
  }

  // --- tooling panels: title in one, ornament in another ---
  const reserve = charmSpineReserve(charm);
  // Anything drawn ACROSS the spine is a cut the lettering has to respect:
  // the sewn cords when there are any, the decorative rules when there are not.
  const cutYs = raisedBands > 0 ? cordYs : legacyBands.map((b) => b.y);
  const cutPad = h > 0 ? (raisedBands > 0 ? cordH * 0.95 : 4.6 * scale) / h : 0;
  const panels = spinePanels(cutYs, reserve, cutPad).filter((p) => p.y1 - p.y0 > 0.045);
  let titlePanel: Panel | null = null;
  let ornamentPanel: Panel | null = null;
  if (panels.length > 0) {
    // Binder's convention: title goes in the second panel from the head when
    // there is one, otherwise the tallest panel in the upper half.
    const upper = panels.filter((p) => (p.y0 + p.y1) / 2 < 0.68);
    const pool = upper.length > 0 ? upper : panels;
    const tallest = pool.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
    const second = panels.length > 1 ? (panels[1] as Panel) : null;
    // Follow the convention only when it costs (almost) nothing: on a heavily
    // corded spine the second panel can be much shorter than the best one, and
    // an elided title is a worse crime than an unconventional one.
    titlePanel =
      second !== null && second.y1 - second.y0 >= (tallest.y1 - tallest.y0) * 0.8
        ? second
        : tallest;
    const below = panels.filter((p) => p !== titlePanel && p.y0 >= (titlePanel as Panel).y1 - 1e-6);
    const rest = below.length > 0 ? below : panels.filter((p) => p !== titlePanel);
    if (rest.length > 0) {
      ornamentPanel = rest.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
      if (ornamentPanel.y1 - ornamentPanel.y0 < 0.085) ornamentPanel = null;
    }
    if (!ornamentPanel && panels.length === 1) {
      // Single panel: give the ornament the tail quarter and shorten the title.
      const only = panels[0] as Panel;
      ornamentPanel = { y0: only.y0 + (only.y1 - only.y0) * 0.74, y1: only.y1 };
      titlePanel = { y0: only.y0, y1: ornamentPanel.y0 };
    }
  }

  // --- title plate + vertical title ---
  const trnd = mulberry32((params.seed ^ 0x7115) >>> 0);
  if (titlePanel) {
    const py0 = titlePanel.y0 * h;
    const py1 = titlePanel.y1 * h;
    const pad = 4 * scale;
    const availLen = Math.max(0, py1 - py0 - pad * 2);
    const family = FONTS[params.font] as string;
    // A binder letters the title to FIT the panel: he picks smaller tools
    // before he abbreviates. So shrink the face first (down to the legibility
    // floor), and only then elide — a spine that says "Constellati…" is a bug,
    // one that says "Cons" is a disaster.
    const maxFont = clamp(w * 0.52, 10 * scale, 20 * scale);
    const minFont = Math.max(6.5 * scale, maxFont * 0.52);
    // Cursive faces overhang their advance width; keep a little air so the
    // last glyph's tail never crosses the plate border.
    const fitLen = Math.max(0, availLen - pad * 0.9);
    let fontPx = maxFont;
    let text = title.trim();
    const measure = (t: string): number => {
      ctx.font = `${fontPx.toFixed(2)}px ${family}`;
      let sum = 0;
      for (const ch of t) sum += ctx.measureText(ch).width;
      return sum;
    };
    if (opts.hiRes && text.length > 0 && fitLen > 0) {
      while (measure(text) > fitLen && fontPx > minFont) fontPx = Math.max(minFont, fontPx * 0.94);
      if (measure(text) > fitLen) {
        // Still too long at the floor: elide on a word boundary when one is
        // near the end, otherwise clip and mark it with an ellipsis.
        while (text.length > 1 && measure(`${text}…`) > fitLen) text = text.slice(0, -1);
        const trimmed = text.replace(/[\s,;:.-]+$/u, '');
        text = `${trimmed.length > 0 ? trimmed : text}…`;
      }
    } else {
      text = '';
    }
    ctx.font = `${fontPx.toFixed(2)}px ${family}`;

    const glyphs: Array<{ ch: string; adv: number }> = [];
    let textLen = 0;
    for (const ch of text) {
      const cw = ctx.measureText(ch).width;
      glyphs.push({ ch, adv: cw });
      textLen += cw;
    }
    const plateLen =
      textLen > 0
        ? Math.min(availLen, textLen + pad * 2.6)
        : Math.min(availLen, (py1 - py0) * 0.6);
    const plateW = Math.min(w * 0.78, fontPx * 1.9);
    const plateX = w * 0.5 - plateW / 2;
    const plateY = (py0 + py1) / 2 - plateLen / 2;

    if (titlePlate !== 'none' && plateLen > 6 * scale) {
      ctx.save();
      if (titlePlate === 'gilt') {
        ctx.fillStyle = hslStr(colB, hue, -8, 2, 0.32);
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(0.9, 1.3 * scale);
        jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.4 * scale, rnd);
        ctx.strokeStyle = 'rgba(201, 162, 39, 0.55)';
        ctx.lineWidth = Math.max(0.5, 0.7 * scale);
        // Inner rule inset proportionally, so small plates do not end up with
        // two rules sitting on top of each other.
        const gi = Math.min(3.2 * scale, plateW * 0.14, plateLen * 0.1);
        jitterRectStroke(ctx, plateX + gi, plateY + gi, plateW - gi * 2, plateLen - gi * 2, step, 0.35 * scale, rnd);
      } else if (titlePlate === 'label') {
        ctx.fillStyle = 'rgba(40, 32, 22, 0.32)';
        ctx.fillRect(plateX + 1.2 * scale, plateY + 1.6 * scale, plateW, plateLen);
        ctx.fillStyle = '#efe3c4';
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        // Ruled border + a hint of the paper's own tone at the edges.
        ctx.strokeStyle = 'rgba(120, 96, 58, 0.55)';
        ctx.lineWidth = Math.max(0.5, 0.7 * scale);
        jitterRectStroke(ctx, plateX + 1.8 * scale, plateY + 1.8 * scale, plateW - 3.6 * scale, plateLen - 3.6 * scale, step, 0.4 * scale, rnd);
        ctx.strokeStyle = 'rgba(150, 124, 82, 0.4)';
        jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.5 * scale, rnd);
      } else {
        // debossed: pressed into the binding — dark top/left, lit bottom/right
        ctx.fillStyle = hslStr(colB, hue, -12, 0, 0.4);
        ctx.fillRect(plateX, plateY, plateW, plateLen);
        ctx.strokeStyle = hslStr(colB, hue, -32, 0, 0.7);
        ctx.lineWidth = Math.max(0.7, 1 * scale);
        ctx.beginPath();
        ctx.moveTo(plateX, plateY + plateLen);
        ctx.lineTo(plateX, plateY);
        ctx.lineTo(plateX + plateW, plateY);
        ctx.stroke();
        ctx.strokeStyle = hslStr(colA, hue, 28, -8, 0.55);
        ctx.beginPath();
        ctx.moveTo(plateX + plateW, plateY);
        ctx.lineTo(plateX + plateW, plateY + plateLen);
        ctx.lineTo(plateX, plateY + plateLen);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (glyphs.length > 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Letter the title in whatever actually reads against the panel it sits
      // on. A binder never tools dark ink onto navy cloth — he uses gold or a
      // white foil — and "near-black on near-black" was the single worst
      // legibility bug on the shelf.
      const lift = material === 'vellum' ? 20 : material === 'paper' ? 9 : 0;
      const panelL = colA.l * 0.55 + colB.l * 0.45 + lift + wear * 6;
      const onLabel = titlePlate === 'label';
      const goldTitle = !onLabel && (titlePlate === 'gilt' || params.gilt);
      const paleTitle = !onLabel && !goldTitle && panelL < 48;
      const titleInk = onLabel
        ? hslStr(colB, hue, -34, 6, 0.95)
        : goldTitle
          ? GOLD
          : paleTitle
            ? hslStr(colA, hue, clamp(94 - colA.l, 0, 100), -46, 0.94)
            : hslStr(colB, hue, -38, 0, 0.94);
      // Every tooled title is stamped INTO the binding, so it always carries a
      // relief edge. Drawing it unconditionally (not just for `debossed`) is
      // also the belt-and-braces that keeps a title readable on a ground whose
      // lightness sits right on the pale/deep decision boundary.
      const reliefInk = onLabel
        ? null
        : paleTitle
          ? hslStr(colB, hue, -30, 0, 0.5)
          : hslStr(colA, hue, 26, -12, 0.5);
      ctx.save();
      ctx.translate(w / 2, (py0 + py1) / 2 - textLen / 2);
      ctx.rotate(Math.PI / 2);
      let advance = 0;
      for (const g of glyphs) {
        // Per-glyph baseline wobble: rnd()*1.2 - 0.6 px (scaled).
        const wob = (trnd() * 1.2 - 0.6) * scale;
        if (reliefInk !== null) {
          ctx.fillStyle = reliefInk;
          ctx.fillText(g.ch, advance + 0.75 * scale, wob + 0.75 * scale);
        }
        ctx.fillStyle = titleInk;
        ctx.fillText(g.ch, advance, wob);
        advance += g.adv;
      }
      ctx.restore();
    }
  }

  // --- ornament stamp (12 + none; the wax seal charm takes its slot) ---
  if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
    const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
    const ocy = ((oPanel.y0 + oPanel.y1) / 2) * h;
    const oSize = Math.min(w * 0.36, 14 * scale, ((oPanel.y1 - oPanel.y0) * h) / 2.1);
    const inkColor = params.gilt ? GOLD : hslStr(colB, hue, -24, 0, 0.85);
    ctx.strokeStyle = inkColor;
    ctx.fillStyle = inkColor;
    ctx.lineWidth = Math.max(1, 1.1 * scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawOrnament(ctx, params.ornament, w / 2, ocy, Math.max(2, oSize), rnd);
  }

  // --- shared granulation overlay ---
  const tile = getGranulationTile();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.06;
  for (let ty = 0; ty < h; ty += GRANULATION_SIZE) {
    for (let tx = 0; tx < w; tx += GRANULATION_SIZE) {
      ctx.drawImage(tile, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // --- wear: sun-fade, scuffs, rubbed patches, grime, cracks ---
  paintWear(ctx, w, h, wear, tones, scale, rnd);

  // --- charm: the identity cue carried to the cover and the open book ---
  if (charm !== 'none') {
    drawSpineCharm(ctx, charm, w, h, {
      color: charmColorCss(params.charmColor ?? 0),
      scale,
      rnd: mulberry32((params.seed ^ 0xc4a7) >>> 0),
      gilt: params.gilt,
    });
  }

  ctx.restore(); // end clip

  // --- pencil edges: per-vertex jittered, double-stroked, alpha 0.55 ---
  ctx.strokeStyle = GRAPHITE;
  ctx.lineWidth = Math.max(0.8, 0.9 * scale);
  ctx.lineJoin = 'round';
  const passA = densifyJitter(outline, step, 0.7 * scale, rnd);
  tracePoly(ctx, passA, true);
  ctx.stroke();
  const passB = densifyJitter(outline, step, 0.55 * scale, rnd);
  ctx.save();
  ctx.translate(0.5 * scale, -0.4 * scale);
  tracePoly(ctx, passB, true);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}
