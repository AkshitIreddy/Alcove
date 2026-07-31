/**
 * art/bookStyle.ts — the Book Studio's merged style model (library-themes §4).
 *
 * A book's look is `seed defaults → theme bias → per-book overrides`, and the
 * last one always wins: "themes only *bias* per-book art — an explicit
 * per-book override always wins, so a user's favourite red leather book keeps
 * its identity in every room."
 *
 * `resolveBookStyle` is the single entry point. It is:
 *  - **deterministic** — same (seed, themeDefaults, overrides) ⇒ byte-identical
 *    params, so baked atlas rects stay valid across sessions;
 *  - **total** — it never throws, whatever garbage comes out of the
 *    `cover_meta` JSON blob (this is user data round-tripped through SQLite);
 *  - **complete** — it hands back ready-to-render `SpineParams` *and*
 *    `CoverParams`, so shelf, pull-out and open book cannot drift apart.
 *
 * This module deliberately does NOT import `art/themes.ts`. The theme
 * defaults argument is structurally typed and tolerantly normalized, so the
 * theme module can evolve its `SpineTheming` shape without breaking here.
 */

import {
  CHARMS,
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_LABELS,
  isCharmKind,
  type CharmKind,
} from './charms';
import {
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  deriveCoverParams,
  type CoverOverrides,
  type CoverParams,
} from './covers';
import { clamp, mulberry32, type RandomFn } from './noise';
import {
  BINDING_MATERIALS,
  EDGE_LABELS,
  EDGE_TREATMENTS,
  MATERIAL_LABELS,
  MAX_RAISED_BANDS,
  ORNAMENT_COUNT,
  ORNAMENT_LABELS,
  PIGMENT_COUNT,
  PIGMENT_LABELS,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  MAX_BOARD_STYLE,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  THICKNESS_CLASSES,
  TITLE_PLATES,
  TITLE_PLATE_LABELS,
  WEAR_STOPS,
  composeShelfRow,
  deriveSpineParams,
  formatForHeight,
  heightForFormat,
  isBindingMaterial,
  isEdgeTreatment,
  isSpineFormat,
  isTitlePlateStyle,
  textureFromMaterial,
  thicknessClassFor,
  type BindingMaterial,
  type ComposeShelfRowOptions,
  type EdgeTreatment,
  type RowBookInput,
  type ShelfRowComposition,
  type SpineFormat,
  type SpineParams,
  type ThicknessClass,
  type TitlePlateStyle,
} from './spines';

export type {
  BindingMaterial,
  CharmKind,
  ComposeShelfRowOptions,
  EdgeTreatment,
  RowBookInput,
  ShelfRowComposition,
  SpineFormat,
  ThicknessClass,
  TitlePlateStyle,
};
/**
 * The studio panel's whole vocabulary, re-exported from one module so the rail
 * UI never has to reach into `spines.ts`/`charms.ts` directly (and so those two
 * stay free to reorganise).
 */
export {
  BINDING_MATERIALS,
  CHARMS,
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_LABELS,
  EDGE_LABELS,
  EDGE_TREATMENTS,
  MATERIAL_LABELS,
  MAX_BOARD_STYLE,
  MAX_RAISED_BANDS,
  ORNAMENT_COUNT,
  ORNAMENT_LABELS,
  PIGMENT_COUNT,
  PIGMENT_LABELS,
  SPINE_FORMATS,
  SPINE_FORMAT_IDS,
  SPINE_HEIGHT_RANGE,
  SPINE_THICKNESS_RANGE,
  THICKNESS_CLASSES,
  TITLE_PLATES,
  TITLE_PLATE_LABELS,
  WEAR_STOPS,
  composeShelfRow,
  formatForHeight,
  heightForFormat,
  isSpineFormat,
  thicknessClassFor,
};

/** Title faces, index-aligned with SpineParams.font / CoverParams.titleFont. */
export const TITLE_FONTS = ['Caveat', 'Kalam', 'Patrick Hand'] as const;

/** `ornament: -1` means "no stamp" — the 13th option in the studio's list. */
export const ORNAMENT_NONE = -1;

/* ------------------------------- the style ------------------------------- */

/** A fully-resolved book style. Every field has a value; nothing is optional. */
export interface BookStyle {
  /* spine */
  material: BindingMaterial;
  /** Pigment index, 0–11. */
  pigment: number;
  /** Extra hue rotation in degrees, ±12. */
  hueJitter: number;
  /** Raised cords, 0–5. */
  raisedBands: number;
  /** Gold rules flanking each cord. */
  bandGilt: boolean;
  /** Striped head/tail endbands. */
  headTail: boolean;
  /** Endband variant: 0 blocks, 1 chevron, 2 wrapped cord. */
  headTailStyle: number;
  /** Ornament stamp 0–11, or ORNAMENT_NONE. */
  ornament: number;
  titlePlate: TitlePlateStyle;
  /** Title face index, 0–2. */
  titleFont: 0 | 1 | 2;
  /** Wear, 0 (pristine) → 1 (well-loved). */
  wear: number;
  edge: EdgeTreatment;
  /**
   * Bibliographic format band the height sits in. Always kept consistent with
   * `height`: setting `format` in an override picks that band's mid height,
   * and an explicit `height` re-derives the format it lands in.
   */
  format: SpineFormat;
  /** Spine height in world px. */
  height: number;
  /** Spine thickness in world px (defaults from page count). */
  thickness: number;
  /** Gilt tooling on bands, ornament and title. */
  gilt: boolean;
  charm: CharmKind;
  /** Index into CHARM_COLORS. */
  charmColor: number;
  /* cover */
  coverFrame: number;
  coverMedallion: number;
  cornerProtectors: boolean;
  insetPlate: boolean;
}

/** The user-overridable view of a BookStyle: every field optional. */
export type BookStyleOverrides = Partial<BookStyle>;

/** What `resolveBookStyle` hands back. */
export interface ResolvedBookStyle {
  /** The book's 32-bit art seed. */
  seed: number;
  /** The merged style, for the studio panel's controls. */
  style: BookStyle;
  /** Ready for `renderSpine`. */
  spine: SpineParams;
  /** Ready for `renderCover` / `coverDataUrl`. */
  cover: CoverParams;
  /**
   * Which fields came from the persisted override blob rather than from the
   * seed or the room.
   *
   * The merged style cannot say — every field in it has a value, whoever
   * supplied it. Some renderers need the difference: a binding preset carries
   * a covering of its own, and handing it the book's *inherited* material
   * flattens all sixty-two bindings into the seven the studio lists, while
   * handing it a material the reader actually picked is the whole point of the
   * chip.
   */
  pinned: ReadonlySet<keyof BookStyle>;
}

/* ---------------------------- theme defaults ----------------------------- */

/**
 * The theme-side bias, as `resolveBookStyle` reads it. Every field is
 * optional; unknown fields are ignored. Pools are "pick one of these using
 * the book's seed"; `*Chance` fields are probabilities in [0, 1].
 *
 * Field aliases are accepted so this can bridge to `art/themes.ts`'s
 * `SpineTheming` without a compile-time dependency (see normalizeThemeDefaults).
 */
export interface SpineThemeDefaults {
  /** Bias pool of binding materials. Alias: `materialBias`, `material`. */
  materials?: readonly BindingMaterial[];
  /** Bias pool of pigment indices 0–11. Alias: `pigmentRamp`, `pigments`. */
  pigments?: readonly number[];
  /** Max |hue jitter| in degrees (default 6). */
  hueJitter?: number;
  /** Probability the book is gilt. */
  giltChance?: number;
  /** Raised-cord count, or an inclusive [min, max] range. */
  raisedBands?: number | readonly [number, number];
  /** Probability of striped endbands. */
  headTailChance?: number;
  /** Bias pool of ornament stamps (use ORNAMENT_NONE for "no stamp"). */
  ornaments?: readonly number[];
  /** Probability the book carries an ornament at all. */
  ornamentChance?: number;
  titlePlates?: readonly TitlePlateStyle[];
  /** Bias pool of title faces, 0–2. */
  titleFonts?: readonly number[];
  /** Wear as a value or an inclusive [min, max] range. */
  wear?: number | readonly [number, number];
  edges?: readonly EdgeTreatment[];
  /** Bias pool of charms. */
  charms?: readonly CharmKind[];
  /** Probability a book gets a charm at all. */
  charmChance?: number;
  /** Bias pool of charm colour indices. */
  charmColors?: readonly number[];
  cornerProtectorChance?: number;
  insetPlateChance?: number;
}

/**
 * What a theme object may look like. `resolveBookStyle` accepts either a
 * whole `LibraryTheme`-shaped object (reading `.spineDefaults`) or a bare
 * `SpineThemeDefaults`.
 */
export interface BookStyleThemeInput {
  spineDefaults?: unknown;
}

/* ------------------------------ tiny helpers ----------------------------- */

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  const i = Math.round(n);
  return i >= min && i <= max ? i : undefined;
}

function chance(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return typeof v === 'boolean' ? (v ? 1 : 0) : undefined;
  return clamp(n, 0, 1);
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function poolOf<T>(v: unknown, guard: (x: unknown) => x is T): readonly T[] | undefined {
  const arr = asArray(v).filter(guard);
  return arr.length > 0 ? arr : undefined;
}

function pick<T>(pool: readonly T[], r: number): T {
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))] as T;
}

function isPigmentIndex(v: unknown): v is number {
  return intIn(v, 0, PIGMENT_COUNT - 1) !== undefined;
}
function isOrnamentIndex(v: unknown): v is number {
  return intIn(v, ORNAMENT_NONE, ORNAMENT_COUNT - 1) !== undefined;
}
function isFontIndex(v: unknown): v is number {
  return intIn(v, 0, TITLE_FONTS.length - 1) !== undefined;
}
function isCharmColorIndex(v: unknown): v is number {
  return intIn(v, 0, CHARM_COLORS.length - 1) !== undefined;
}

function range(v: unknown, lo: number, hi: number): readonly [number, number] | undefined {
  if (Array.isArray(v) && v.length >= 2) {
    const a = num(v[0]);
    const b = num(v[1]);
    if (a === undefined || b === undefined) return undefined;
    const min = clamp(Math.min(a, b), lo, hi);
    const max = clamp(Math.max(a, b), lo, hi);
    return [min, max];
  }
  const n = num(v);
  if (n === undefined) return undefined;
  const c = clamp(n, lo, hi);
  return [c, c];
}

/* -------------------- theme defaults: tolerant reading ------------------- */

/**
 * Read a theme's spine bias out of anything. Accepts a `LibraryTheme`-shaped
 * object (`{ spineDefaults: … }`), a bare defaults object, or junk (⇒ `{}`).
 * Recognized aliases: `materialBias`/`material` for `materials`,
 * `pigmentRamp`/`pigmentBias`/`palette` for `pigments`, `wearRange` for
 * `wear`, `edgeTreatments` for `edges`, `fonts` for `titleFonts`.
 */
export function normalizeThemeDefaults(raw: unknown): SpineThemeDefaults {
  if (!isObj(raw)) return {};
  const src = isObj(raw.spineDefaults) ? (raw.spineDefaults as Record<string, unknown>) : raw;
  const out: SpineThemeDefaults = {};

  const materials = poolOf(
    src.materials ?? src.materialBias ?? src.material,
    isBindingMaterial,
  );
  if (materials) out.materials = materials;

  const pigments = poolOf(
    src.pigments ?? src.pigmentRamp ?? src.pigmentBias ?? src.palette,
    isPigmentIndex,
  );
  if (pigments) out.pigments = pigments.map((p) => Math.round(p));

  const hj = num(src.hueJitter);
  if (hj !== undefined) out.hueJitter = clamp(Math.abs(hj), 0, 12);

  const gc = chance(src.giltChance ?? src.gilt);
  if (gc !== undefined) out.giltChance = gc;

  const rb = range(src.raisedBands, 0, MAX_RAISED_BANDS);
  if (rb) out.raisedBands = rb;

  const ht = chance(src.headTailChance ?? src.headTail);
  if (ht !== undefined) out.headTailChance = ht;

  const orn = poolOf(src.ornaments, isOrnamentIndex);
  if (orn) out.ornaments = orn.map((o) => Math.round(o));
  const oc = chance(src.ornamentChance);
  if (oc !== undefined) out.ornamentChance = oc;

  const plates = poolOf(src.titlePlates ?? src.titlePlate, isTitlePlateStyle);
  if (plates) out.titlePlates = plates;

  const fonts = poolOf(src.titleFonts ?? src.fonts, isFontIndex);
  if (fonts) out.titleFonts = fonts.map((f) => Math.round(f));

  const wear = range(src.wear ?? src.wearRange, 0, 1);
  if (wear) out.wear = wear;

  const edges = poolOf(src.edges ?? src.edgeTreatments ?? src.edge, isEdgeTreatment);
  if (edges) out.edges = edges;

  const charms = poolOf(src.charms ?? src.charm, isCharmKind);
  if (charms) out.charms = charms;
  const cc = chance(src.charmChance);
  if (cc !== undefined) out.charmChance = cc;
  const charmColors = poolOf(src.charmColors, isCharmColorIndex);
  if (charmColors) out.charmColors = charmColors.map((c) => Math.round(c));

  const cp = chance(src.cornerProtectorChance);
  if (cp !== undefined) out.cornerProtectorChance = cp;
  const ip = chance(src.insetPlateChance);
  if (ip !== undefined) out.insetPlateChance = ip;

  return out;
}

/* ---------------------- overrides: tolerant reading ---------------------- */

/**
 * Validate a persisted override blob. Values outside their legal domain are
 * **dropped**, not coerced, so a corrupt field falls back to the theme/seed
 * default rather than silently meaning something else. Continuous values
 * (hueJitter, wear, height, thickness) ARE clamped — those are sliders, and a
 * slider that went out of band still expresses an intent.
 *
 * Returns `null` when nothing valid survived (the caller can then clear the
 * `cover_meta.style` section entirely).
 */
export function normalizeBookStyleOverrides(raw: unknown): BookStyleOverrides | null {
  if (!isObj(raw)) return null;
  const o: BookStyleOverrides = {};

  if (isBindingMaterial(raw.material)) o.material = raw.material;

  const pigment = intIn(raw.pigment, 0, PIGMENT_COUNT - 1);
  if (pigment !== undefined) o.pigment = pigment;

  const hue = num(raw.hueJitter);
  if (hue !== undefined) o.hueJitter = clamp(hue, -12, 12);

  const bands = intIn(raw.raisedBands, 0, MAX_RAISED_BANDS);
  if (bands !== undefined) o.raisedBands = bands;
  if (typeof raw.bandGilt === 'boolean') o.bandGilt = raw.bandGilt;
  if (typeof raw.headTail === 'boolean') o.headTail = raw.headTail;
  const hts = intIn(raw.headTailStyle, 0, 2);
  if (hts !== undefined) o.headTailStyle = hts;

  const ornament = intIn(raw.ornament, ORNAMENT_NONE, ORNAMENT_COUNT - 1);
  if (ornament !== undefined) o.ornament = ornament;

  if (isTitlePlateStyle(raw.titlePlate)) o.titlePlate = raw.titlePlate;

  const font = intIn(raw.titleFont, 0, TITLE_FONTS.length - 1);
  if (font !== undefined) o.titleFont = font as 0 | 1 | 2;

  const wear = num(raw.wear);
  if (wear !== undefined) o.wear = clamp(wear, 0, 1);

  if (isEdgeTreatment(raw.edge)) o.edge = raw.edge;

  // `height` wins over `format`; a lone `format` picks its band's mid height.
  if (isSpineFormat(raw.format)) o.format = raw.format;
  const height = num(raw.height);
  if (height !== undefined) {
    o.height = clamp(height, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
  } else if (o.format !== undefined) {
    o.height = heightForFormat(o.format);
  }
  const thickness = num(raw.thickness);
  if (thickness !== undefined) {
    o.thickness = clamp(thickness, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max);
  }

  if (typeof raw.gilt === 'boolean') o.gilt = raw.gilt;

  if (isCharmKind(raw.charm)) o.charm = raw.charm;
  const charmColor = intIn(raw.charmColor, 0, CHARM_COLORS.length - 1);
  if (charmColor !== undefined) o.charmColor = charmColor;

  const frame = intIn(raw.coverFrame, 0, COVER_FRAME_COUNT - 1);
  if (frame !== undefined) o.coverFrame = frame;
  const medallion = intIn(raw.coverMedallion, 0, COVER_MEDALLION_COUNT - 1);
  if (medallion !== undefined) o.coverMedallion = medallion;
  if (typeof raw.cornerProtectors === 'boolean') o.cornerProtectors = raw.cornerProtectors;
  if (typeof raw.insetPlate === 'boolean') o.insetPlate = raw.insetPlate;

  return Object.keys(o).length > 0 ? o : null;
}

/* -------------------------------- thickness ------------------------------ */

/**
 * A book's spine thickness from its page count. Sub-linear (√) so a 40-page
 * notebook is fat but not absurd, and every book still fits the shelf band.
 *
 * The base was dropped from 20 to 9 when the painterly rebuild widened
 * `SPINE_THICKNESS_RANGE`: with a floor of 20 a one-page book and a ten-page
 * book were within a few px of each other, and a young library — where every
 * book has a similar page count — came out as a picket fence.
 */
export function thicknessFromPageCount(pageCount: number | undefined): number | undefined {
  const n = num(pageCount);
  if (n === undefined || n <= 0) return undefined;
  return clamp(
    9 + Math.sqrt(n) * 5.4,
    SPINE_THICKNESS_RANGE.min,
    SPINE_THICKNESS_RANGE.max,
  );
}

/**
 * How much of a book's thickness comes from its seed rather than its page
 * count, when both are available.
 *
 * Page count alone is *correct* and *boring*: a fresh library's books all
 * have one or two pages, so they all come out the same width — precisely the
 * "near-uniform widths" the art direction rejects. The seed's multi-modal
 * roll (pamphlet → tome, see `spines.THICKNESS_CLASSES`) supplies the spread;
 * the page count still moves the needle, so a book that grows visibly fattens.
 */
export const SEEDED_THICKNESS_WEIGHT = 0.58;

/**
 * Blend a page-count thickness with the book's own seeded thickness class.
 * Exported so the studio's thickness slider can show what the default *would*
 * be for a given page count.
 */
export function blendThickness(seeded: number, fromPages: number | undefined): number {
  if (fromPages === undefined) return clamp(seeded, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max);
  return clamp(
    fromPages * (1 - SEEDED_THICKNESS_WEIGHT) + seeded * SEEDED_THICKNESS_WEIGHT,
    SPINE_THICKNESS_RANGE.min,
    SPINE_THICKNESS_RANGE.max,
  );
}

/* --------------------------------- resolve ------------------------------- */

export interface ResolveBookStyleOptions {
  /**
   * Page count, used for the default spine thickness. An explicit
   * `overrides.thickness` still wins.
   */
  pageCount?: number;
}

/**
 * Merge `seed defaults → theme bias → per-book overrides` into a fully
 * resolved style plus ready-to-render spine and cover params.
 *
 * Deterministic: the theme-bias PRNG draws a fixed number of values in a
 * fixed order regardless of which theme fields are present, so adding a field
 * to a theme never reshuffles the books that field does not touch.
 *
 * Total: `themeDefaults` and `overrides` may be anything at all (including
 * values parsed straight out of a user's `cover_meta` JSON).
 */
export function resolveBookStyle(
  seed: number,
  themeDefaults?: BookStyleThemeInput | SpineThemeDefaults | unknown,
  overrides?: BookStyleOverrides | unknown,
  opts: ResolveBookStyleOptions = {},
): ResolvedBookStyle {
  const s = seed >>> 0;
  const base = deriveSpineParams(s);
  const theme = normalizeThemeDefaults(themeDefaults);
  const over = normalizeBookStyleOverrides(overrides) ?? {};
  const rnd: RandomFn = mulberry32((s ^ 0xb00c57e1) >>> 0);

  // Every theme decision consumes its draws unconditionally (see the doc
  // comment): draw first, then decide whether the theme has an opinion.
  const rMaterial = rnd();
  const rPigment = rnd();
  const rHue = rnd();
  const rGilt = rnd();
  const rBands = rnd();
  const rHeadTail = rnd();
  const rOrnament = rnd();
  const rOrnamentOn = rnd();
  const rPlate = rnd();
  const rFont = rnd();
  const rWear = rnd();
  const rEdge = rnd();
  const rCharm = rnd();
  const rCharmOn = rnd();
  const rCharmColor = rnd();
  const rCorner = rnd();
  const rInset = rnd();

  const material: BindingMaterial =
    over.material ??
    (theme.materials ? pick(theme.materials, rMaterial) : (base.material ?? 'cloth'));

  const pigment =
    over.pigment ?? (theme.pigments ? pick(theme.pigments, rPigment) : base.palette);

  const hueLimit = theme.hueJitter ?? 6;
  const hueJitter =
    over.hueJitter ??
    (theme.hueJitter !== undefined ? (rHue * 2 - 1) * hueLimit : base.hueJitter);

  const gilt =
    over.gilt ?? (theme.giltChance !== undefined ? rGilt < theme.giltChance : base.gilt);

  let raisedBands: number;
  if (over.raisedBands !== undefined) {
    raisedBands = over.raisedBands;
  } else if (theme.raisedBands !== undefined) {
    const [lo, hi] = Array.isArray(theme.raisedBands)
      ? (theme.raisedBands as readonly [number, number])
      : ([theme.raisedBands as number, theme.raisedBands as number] as const);
    raisedBands = Math.round(lo + rBands * (hi - lo));
  } else {
    raisedBands = base.raisedBands ?? 0;
  }
  raisedBands = clamp(Math.round(raisedBands), 0, MAX_RAISED_BANDS);

  const bandGilt = over.bandGilt ?? base.bandGilt ?? gilt;

  const headTail =
    over.headTail ??
    (theme.headTailChance !== undefined ? rHeadTail < theme.headTailChance : base.headTail);
  const headTailStyle = clamp(Math.round(over.headTailStyle ?? base.headTailStyle ?? 0), 0, 2);

  let ornament: number;
  if (over.ornament !== undefined) {
    ornament = over.ornament;
  } else {
    const fromTheme = theme.ornaments ? pick(theme.ornaments, rOrnament) : base.ornament;
    const on =
      theme.ornamentChance !== undefined
        ? rOrnamentOn < theme.ornamentChance
        : (base.ornamentOn ?? true);
    ornament = on ? fromTheme : ORNAMENT_NONE;
  }
  ornament = clamp(Math.round(ornament), ORNAMENT_NONE, ORNAMENT_COUNT - 1);

  const titlePlate: TitlePlateStyle =
    over.titlePlate ??
    (theme.titlePlates ? pick(theme.titlePlates, rPlate) : (base.titlePlate ?? 'none'));

  const titleFont = clamp(
    Math.round(
      over.titleFont ?? (theme.titleFonts ? pick(theme.titleFonts, rFont) : base.font),
    ),
    0,
    2,
  ) as 0 | 1 | 2;

  let wear: number;
  if (over.wear !== undefined) {
    wear = over.wear;
  } else if (theme.wear) {
    const [lo, hi] = theme.wear as readonly [number, number];
    wear = lo + rWear * (hi - lo);
  } else {
    wear = base.wear ?? 0.12;
  }
  wear = clamp(wear, 0, 1);

  const edge: EdgeTreatment =
    over.edge ?? (theme.edges ? pick(theme.edges, rEdge) : (base.edge ?? 'plain'));

  const height = clamp(
    over.height ?? base.height ?? 232 + base.hJitter,
    SPINE_HEIGHT_RANGE.min,
    SPINE_HEIGHT_RANGE.max,
  );
  // The format label always describes the height that actually got used, so
  // the studio's preset dropdown can never disagree with its own slider.
  const format: SpineFormat = formatForHeight(height);

  const thickness = clamp(
    over.thickness ?? blendThickness(base.w, thicknessFromPageCount(opts.pageCount)),
    SPINE_THICKNESS_RANGE.min,
    SPINE_THICKNESS_RANGE.max,
  );

  let charm: CharmKind;
  if (over.charm !== undefined) {
    charm = over.charm;
  } else if (theme.charms || theme.charmChance !== undefined) {
    const pool = theme.charms ?? CHARMS.filter((c) => c !== 'none');
    const on = theme.charmChance !== undefined ? rCharmOn < theme.charmChance : true;
    charm = on ? pick(pool, rCharm) : 'none';
  } else {
    charm = base.charm ?? 'none';
  }

  const charmColor = clamp(
    Math.round(
      over.charmColor ??
        (theme.charmColors ? pick(theme.charmColors, rCharmColor) : (base.charmColor ?? 0)),
    ),
    0,
    CHARM_COLORS.length - 1,
  );

  // Cover-only knobs: the seed's own rolls unless the studio pins them.
  const coverBase = deriveCoverParams(s);
  const coverFrame = clamp(
    Math.round(over.coverFrame ?? coverBase.frame),
    0,
    COVER_FRAME_COUNT - 1,
  );
  const coverMedallion = clamp(
    Math.round(
      over.coverMedallion ??
        (ornament >= 0 ? ornament % COVER_MEDALLION_COUNT : coverBase.medallion),
    ),
    0,
    COVER_MEDALLION_COUNT - 1,
  );
  const cornerProtectors =
    over.cornerProtectors ??
    (theme.cornerProtectorChance !== undefined
      ? rCorner < theme.cornerProtectorChance
      : (coverBase.cornerProtectors ?? false));
  const insetPlate =
    over.insetPlate ??
    (theme.insetPlateChance !== undefined
      ? rInset < theme.insetPlateChance
      : (coverBase.insetPlate ?? false));

  const style: BookStyle = {
    material,
    pigment: clamp(Math.round(pigment), 0, PIGMENT_COUNT - 1),
    hueJitter: clamp(hueJitter, -12, 12),
    raisedBands,
    bandGilt,
    headTail,
    headTailStyle,
    ornament,
    titlePlate,
    titleFont,
    wear,
    edge,
    format,
    height,
    thickness,
    gilt,
    charm,
    charmColor,
    coverFrame,
    coverMedallion,
    cornerProtectors,
    insetPlate,
  };

  const pinned = new Set(Object.keys(over) as (keyof BookStyle)[]);
  return {
    seed: s,
    style,
    spine: spineParamsFor(base, style, pinned),
    cover: coverParamsFor(s, style),
    pinned,
  };
}

/** Project a resolved style onto renderable SpineParams. */
export function spineParamsFor(
  base: SpineParams,
  style: BookStyle,
  pinned: ReadonlySet<keyof BookStyle> = new Set(),
): SpineParams {
  return {
    ...base,
    materialPinned: pinned.has('material'),
    palette: style.pigment,
    hueJitter: style.hueJitter,
    // The legacy 0|1|2 texture bucket is kept in sync so any consumer that
    // still branches on it (older cover code, tests) agrees with the material.
    texture: textureFromMaterial(style.material),
    material: style.material,
    // ornament stays 0–11 (covers derive their medallion from it); the
    // "none" option rides on ornamentOn.
    ornament: style.ornament >= 0 ? style.ornament : base.ornament,
    ornamentOn: style.ornament >= 0,
    font: style.titleFont,
    gilt: style.gilt,
    raisedBands: style.raisedBands,
    bandGilt: style.bandGilt,
    headTail: style.headTail,
    headTailStyle: style.headTailStyle,
    titlePlate: style.titlePlate,
    wear: style.wear,
    edge: style.edge,
    format: style.format,
    height: style.height,
    w: style.thickness,
    charm: style.charm,
    charmColor: style.charmColor,
  };
}

/** Project a resolved style onto renderable CoverParams. */
export function coverParamsFor(seed: number, style: BookStyle): CoverParams {
  const overrides: CoverOverrides = {
    palette: style.pigment,
    texture: textureFromMaterial(style.material),
    frame: style.coverFrame,
    medallion: style.coverMedallion,
    titleFont: style.titleFont,
    gilt: style.gilt,
    material: style.material,
    titlePlate: style.titlePlate,
    cornerProtectors: style.cornerProtectors,
    insetPlate: style.insetPlate,
    edge: style.edge,
    wear: style.wear,
    charm: style.charm,
    charmColor: style.charmColor,
  };
  return deriveCoverParams(seed >>> 0, overrides);
}

/* ------------------------------ studio extras ---------------------------- */

/** Freeze a resolved style into a complete override blob (the studio's Save). */
export function bookStyleToOverrides(style: BookStyle): BookStyleOverrides {
  return { ...style };
}

/**
 * The character a brand-new book arrives with.
 *
 * There used to be a global "new books wear this palette" setting, which is
 * the wrong shape of answer twice over: it made every book a reader owned the
 * same colour, and it was never actually applied to anything. A library is
 * interesting because its books are not alike, so a new book rolls its whole
 * vocabulary instead — silhouette dressing, tooling, plate, format, charm,
 * cover fittings, the lot.
 *
 * With ONE deliberate hole: `pigment` and `hueJitter` are left unset, so the
 * room's palette still tints a new book. Colour is the axis a library theme
 * exists to control ("themes only *bias* per-book art"), and a creation-time
 * roll that pinned it would make every room's shelves the same rainbow and
 * quietly kill the feature. Everything a theme does NOT speak for is the
 * book's own from the moment it is made.
 */
export function freshBookStyleOverrides(seed: number): BookStyleOverrides {
  const { pigment: _pigment, hueJitter: _hueJitter, ...rest } = randomBookStyleOverrides(seed);
  return rest;
}

/**
 * "Surprise me": a complete, deterministic random override set. Uses the full
 * legal domain of every knob rather than the weighted seed distribution, so
 * repeated presses land somewhere genuinely different.
 */
export function randomBookStyleOverrides(seed: number): BookStyleOverrides {
  const rnd = mulberry32((seed ^ 0x5a4d0e) >>> 0);
  const charmPool = CHARMS;
  return {
    material: pick(BINDING_MATERIALS, rnd()),
    pigment: Math.floor(rnd() * PIGMENT_COUNT),
    hueJitter: (rnd() * 2 - 1) * 8,
    raisedBands: Math.floor(rnd() * (MAX_RAISED_BANDS + 1)),
    bandGilt: rnd() < 0.5,
    headTail: rnd() < 0.6,
    headTailStyle: Math.floor(rnd() * 3),
    ornament: rnd() < 0.15 ? ORNAMENT_NONE : Math.floor(rnd() * ORNAMENT_COUNT),
    titlePlate: pick(TITLE_PLATES, rnd()),
    titleFont: Math.floor(rnd() * 3) as 0 | 1 | 2,
    wear: rnd() * rnd(),
    edge: pick(EDGE_TREATMENTS, rnd()),
    height: heightForFormat(pick(SPINE_FORMAT_IDS, rnd())),
    gilt: rnd() < 0.4,
    charm: rnd() < 0.45 ? 'none' : pick(charmPool.filter((c) => c !== 'none'), rnd()),
    charmColor: Math.floor(rnd() * CHARM_COLORS.length),
    coverFrame: Math.floor(rnd() * COVER_FRAME_COUNT),
    coverMedallion: Math.floor(rnd() * COVER_MEDALLION_COUNT),
    cornerProtectors: rnd() < 0.3,
    insetPlate: rnd() < 0.45,
  };
}
