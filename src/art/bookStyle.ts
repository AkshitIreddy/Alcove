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
  ACTIVE_CHARMS,
  CHARMS,
  CHARM_COLORS,
  CHARM_COLOR_LABELS,
  CHARM_LABELS,
  charmColorCss,
  isCharmKind,
  normalizeCharmKind,
  type CharmKind,
} from './charms';
import {
  ACTIVE_COVER_HANDS,
  ACTIVE_COVER_HAND_INDICES,
  ACTIVE_COVER_FRAME_INDICES,
  COVER_FONT_KIN,
  COVER_TEXTURES,
  deriveCoverParams,
  normalizeCoverHandIndex,
  normalizeCoverFrameIndex,
  type CoverOverrides,
  type CoverParams,
} from './covers';
import {
  MATERIALS,
  bindingMaterialFor,
  bookPresetAuthoredFocalGlyph,
  bookPresetWantsCoverTitle,
  bookPreset,
  bookPresetHasAuthoredFocal,
  materialLookFor,
  presetForSeed,
  type BroadFocalGlyph,
  type BookPresetId,
} from './bookDesign';
import { normaliseHex } from './customColour';
import { clamp, mulberry32, type RandomFn } from './noise';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_HEAD_TAIL_OPTIONS,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_ORNAMENTS,
  ACTIVE_TITLE_PLATES,
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
  isActiveOrnamentIndex,
  isSpineFormat,
  isTitlePlateStyle,
  normalizeEdgeTreatment,
  normalizeHeadTailStyle,
  normalizeOrnamentIndex,
  normalizeTitlePlateStyle,
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
  ACTIVE_COVER_HANDS,
  ACTIVE_COVER_HAND_INDICES,
  ACTIVE_CHARMS,
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_HEAD_TAIL_OPTIONS,
  ACTIVE_HEAD_TAIL_STYLES,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_ORNAMENTS,
  ACTIVE_TITLE_PLATES,
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
  // The ONE folding of a charm colourway — index or the reader's own hex — so
  // the studio's swatches and wells resolve it exactly the way the spine and
  // the cover do. Re-exported rather than reached for directly because that is
  // this module's job: "the rail UI never has to reach into
  // `spines.ts`/`charms.ts`", and three modules folding one colour three ways
  // is what made a reader's Crimson come out green (see charms.charmCloth).
  charmColorCss,
  composeShelfRow,
  formatForHeight,
  heightForFormat,
  isSpineFormat,
  thicknessClassFor,
};

/** Seed-era cover-title faces, index-aligned with the shared `SpineParams.font`. */
export const TITLE_FONTS = ['Caveat', 'Kalam', 'Patrick Hand'] as const;

/** Quiet furniture allowed when the covering itself supplies the focal field. */
const SURFACE_LED_FRAMES: ReadonlySet<number> = new Set([0, 2, 20, 24]);
const SURFACE_LED_TITLE_PLATES: ReadonlySet<TitlePlateStyle> = new Set([
  'none',
  'debossed',
  'blind-lettered',
  'gilt-direct',
  'twin-rules',
]);

/**
 * Board-scale counterparts for the focal tools authored into named bindings.
 * Several historical glyphs deliberately converge on the final clean cover
 * vocabulary; this is semantic normalization, not a second random choice.
 */
const COVER_EMBLEM_FOR_AUTHORED_FOCAL: Readonly<
  Partial<Record<BroadFocalGlyph, number>>
> = {
  crown: 20,
  sprig: 13,
  laurel: 1,
  palmette: 43,
  fleuron: 12,
  rosette: 23,
  'fleur-de-lis': 26,
  starflower: 2,
  acanthus: 12,
  sunrise: 5,
  'oak-spray': 13,
  thistle: 14,
  'ivy-knot': 1,
  'oak-volutes': 28,
  'wheat-saltire': 29,
  pomegranate: 30,
  tulip: 31,
  pinecone: 13,
  'fern-palmette': 56,
  ginkgo: 31,
  compass: 0,
  shield: 0,
};

function authoredCoverEmblem(binding: BookPresetId): number {
  const glyph = bookPresetAuthoredFocalGlyph(binding);
  return glyph === null ? ORNAMENT_NONE : (COVER_EMBLEM_FOR_AUTHORED_FOCAL[glyph] ?? ORNAMENT_NONE);
}

/** `ornament: -1` means "no stamp" — after the sixteen live binder tools. */
export const ORNAMENT_NONE = -1;

/* ------------------------------- the style ------------------------------- */

/** A fully-resolved book style. Every field has a value; nothing is optional. */
export interface BookStyle {
  /* spine */
  material: BindingMaterial;
  /** Pigment index, 0–11. */
  pigment: number;
  /**
   * A cloth colour the READER typed, `#rrggbb`, or null to follow `pigment`.
   *
   * The fifty pigments are a vocabulary; this is the door out of it. Both are
   * kept rather than one replacing the other, and that is deliberate: clearing
   * a custom colour has to put the book back on the pigment it was wearing,
   * not on whatever the seed would roll today.
   *
   * It is a hex and never an index because it is by definition not in the
   * table — `art/customColour.ts` is the app's one statement of that rule, and
   * `normaliseHex` here is the same normaliser the callout tints use, so a
   * colour typed in one picker can be pasted into the other.
   *
   * It reaches the drawing through `SpineParams.clothHex` and
   * `CoverParams.clothHex`, and the pixels it changes are dropped rather than
   * re-keyed: a cloth colour is a `BookStyle` field, so editing one goes
   * through `persistBookStyle` → `SpineFactory.invalidate`, which destroys the
   * book's baked spine and releases its atlas rect. (`covers` does key on it
   * for real, in its own key. `bookDesign.bookDesignTag` spells it too and used
   * to be cited here as if a cache read that function; none does — see its
   * header.)
   */
  clothHex: string | null;
  /** Spine ground only; null inherits `clothHex`/pigment. */
  spineBaseHex: string | null;
  /** Spine's second leather/cloth/paper role; null uses the seeded partner. */
  spineAccentHex: string | null;
  /** Front/back board ground only; null inherits `clothHex`/pigment. */
  coverBaseHex: string | null;
  /** Cover insets, figured cloth and secondary binding; null uses its partner. */
  coverAccentHex: string | null;
  /** Rules, frames and front-cover title tooling; null follows gilt/blind tooling. */
  toolingHex: string | null;
  /** Spine stamp and cover medallion; null follows the tooling convention. */
  emblemHex: string | null;
  /** Clasps, corner plates and other fittings; null follows gilt/base metal. */
  hardwareHex: string | null;
  /** Extra hue rotation in degrees, ±12. */
  hueJitter: number;
  /** Raised cords, 0–5. */
  raisedBands: number;
  /** Gold rules flanking each cord. */
  bandGilt: boolean;
  /** Striped head/tail endbands. */
  headTail: boolean;
  /** Endband variant: 1 woven chevron, 2 wrapped cord, 3 solid silk roll. */
  headTailStyle: number;
  /** Ornament stamp index into `ORNAMENT_LABELS`, or ORNAMENT_NONE. */
  ornament: number;
  /** Front-cover title treatment. */
  titlePlate: TitlePlateStyle;
  /** Front-cover title hand, normalized into the curated manual specimen case. */
  titleFont: number;
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
  /**
   * Stand at the chosen height even where the case's carpentry is lower.
   *
   * A height is a request, and a bookcase can refuse it: an arcade, a gable or
   * a plate rail leaves less clear height than the flat plank-to-plank gap, so
   * by default `features/bookshelf/bookFit.ts` trims a book down to what its
   * bay actually has. That is the honest default — a book sliced off by an
   * arch reads as a rendering fault, a shorter book reads as a book — but it
   * is not always what the reader meant, and a book that quietly disobeyed a
   * number they typed is worse than one that overlaps.
   *
   * So this is the door out, offered next to the height in the book studio.
   * It is the ONE field here that changes no pixel of the spine: the drawing
   * never reads it, `spineParamsFor` never carries it, and the shelf's layout
   * is its only consumer.
   */
  overlap: boolean;
  /** Spine thickness in world px (defaults from page count). */
  thickness: number;
  /** Gilt tooling on bands, ornament and title. */
  gilt: boolean;
  charm: CharmKind;
  /**
   * The charm's colourway: an index into `CHARM_COLORS`, or a `#rrggbb` the
   * READER typed.
   *
   * One field carrying two representations rather than the `pigment` /
   * `clothHex` pair beside it, and the asymmetry is deliberate. A cloth needs
   * both because `pigment` goes on meaning something while a custom colour is
   * in force — it is what "back to the pigment" returns to. A charm's index
   * means nothing except the colour it names, so a second field would only be
   * a place for the two to disagree; clearing a charm colour drops the pin
   * instead, and the seed's own roll comes back.
   *
   * Nothing downstream had to change to accept this. `charms.charmColorCss`
   * has always read either — clamping a reader's hex up onto `CHARM_FLOOR` so
   * `FLAT.ink` still has an edge to be — and `CoverParams.charmColor` was
   * already typed `number | string` with the cover cache key interpolating it
   * raw, so two readers' greens are two keys. `SpineParams.charmColor` was the
   * one type left, and its own comment said so: it was waiting on this field.
   */
  charmColor: number | string;
  /* cover */
  coverFrame: number;
  /** Binder's stamp index; -1 intentionally leaves a closed composition bare. */
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
  return typeof v === 'number' && ACTIVE_COVER_HAND_INDICES.includes(
    Math.round(v) as (typeof ACTIVE_COVER_HAND_INDICES)[number],
  );
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
  if (orn) out.ornaments = [...new Set(orn.map((o) => normalizeOrnamentIndex(o)))];
  const oc = chance(src.ornamentChance);
  if (oc !== undefined) out.ornamentChance = oc;

  const plates = poolOf(src.titlePlates ?? src.titlePlate, isTitlePlateStyle);
  if (plates) out.titlePlates = [...new Set(plates.map(normalizeTitlePlateStyle))];

  const fonts = poolOf(src.titleFonts ?? src.fonts, isFontIndex);
  if (fonts) out.titleFonts = fonts.map((f) => Math.round(f));

  const wear = range(src.wear ?? src.wearRange, 0, 1);
  if (wear) out.wear = wear;

  const edges = poolOf(src.edges ?? src.edgeTreatments ?? src.edge, isEdgeTreatment);
  if (edges) out.edges = [...new Set(edges.map(normalizeEdgeTreatment))];

  const charms = poolOf(src.charms ?? src.charm, isCharmKind);
  if (charms) out.charms = [...new Set(charms.map(normalizeCharmKind))];
  const cc = chance(src.charmChance);
  if (cc !== undefined) out.charmChance = cc;
  const charmColors = poolOf(src.charmColors, isCharmColorIndex);
  if (charmColors) out.charmColors = charmColors.map((c) => Math.round(c));

  // Independent cover hardware is no longer an active axis. Old themes still
  // parse, but these probabilities deliberately do not enter the live model.

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

  // `null` is a VALUE here, not an absence: "I had a colour of my own and I
  // cleared it". Dropping it the way an invalid field is dropped would make
  // the clear a no-op the moment the blob round-tripped through SQLite.
  if (raw.clothHex === null) o.clothHex = null;
  else {
    const clothHex = normaliseHex(raw.clothHex);
    if (clothHex !== null) o.clothHex = clothHex;
  }

  const readRole = (
    key:
      | 'spineBaseHex'
      | 'spineAccentHex'
      | 'coverBaseHex'
      | 'coverAccentHex'
      | 'toolingHex'
      | 'emblemHex',
  ): void => {
    if (raw[key] === null) o[key] = null;
    else {
      const value = normaliseHex(raw[key]);
      if (value !== null) o[key] = value;
    }
  };
  readRole('spineBaseHex');
  readRole('spineAccentHex');
  readRole('coverBaseHex');
  readRole('coverAccentHex');
  readRole('toolingHex');
  readRole('emblemHex');
  // `hardwareHex` belonged only to corner plates and hanging fittings. Those
  // surfaces are retired, so old persisted values are deliberately discarded
  // instead of surviving as an invisible customization.

  const hue = num(raw.hueJitter);
  if (hue !== undefined) o.hueJitter = clamp(hue, -12, 12);

  if (typeof raw.raisedBands === 'number' && Number.isFinite(raw.raisedBands)) {
    o.raisedBands = clamp(Math.round(raw.raisedBands), 0, MAX_RAISED_BANDS);
  }
  if (typeof raw.bandGilt === 'boolean') o.bandGilt = raw.bandGilt;
  if (typeof raw.headTail === 'boolean') o.headTail = raw.headTail;
  if (typeof raw.headTailStyle === 'number' && Number.isInteger(raw.headTailStyle)) {
    o.headTailStyle = normalizeHeadTailStyle(raw.headTailStyle);
  }

  /*
   * One emblem, two renderer compatibility fields. Prefer an explicit active
   * cover medallion, then an active spine tool, then a semantic replacement
   * for either retired index. An explicit None keeps both faces bare.
   */
  const rawMedallion =
    typeof raw.coverMedallion === 'number' && Number.isInteger(raw.coverMedallion)
      ? raw.coverMedallion
      : undefined;
  const rawOrnament =
    typeof raw.ornament === 'number' && Number.isInteger(raw.ornament)
      ? raw.ornament
      : undefined;
  if (rawMedallion !== undefined || rawOrnament !== undefined) {
    let emblem = ORNAMENT_NONE;
    if (isActiveOrnamentIndex(rawMedallion)) emblem = rawMedallion;
    else if (isActiveOrnamentIndex(rawOrnament)) emblem = rawOrnament;
    else if (rawMedallion !== undefined && rawMedallion !== ORNAMENT_NONE) {
      emblem = normalizeOrnamentIndex(rawMedallion);
    } else if (rawOrnament !== undefined && rawOrnament !== ORNAMENT_NONE) {
      emblem = normalizeOrnamentIndex(rawOrnament);
    }
    o.ornament = emblem;
    o.coverMedallion = emblem;
  }

  if (isTitlePlateStyle(raw.titlePlate)) o.titlePlate = normalizeTitlePlateStyle(raw.titlePlate);

  if (typeof raw.titleFont === 'number' && Number.isFinite(raw.titleFont)) {
    o.titleFont = normalizeCoverHandIndex(raw.titleFont);
  }

  const wear = num(raw.wear);
  if (wear !== undefined) o.wear = clamp(wear, 0, 1);

  if (isEdgeTreatment(raw.edge)) o.edge = normalizeEdgeTreatment(raw.edge);

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

  if (typeof raw.overlap === 'boolean') o.overlap = raw.overlap;

  if (typeof raw.gilt === 'boolean') o.gilt = raw.gilt;

  if (isCharmKind(raw.charm)) o.charm = normalizeCharmKind(raw.charm);
  // A hex first, because a reader's own colour is the one value here that
  // cannot be re-derived from anything else — an index that failed to read
  // still lands on a colourway, a hex that gets dropped is simply gone.
  const charmHex = normaliseHex(raw.charmColor);
  if (charmHex !== null) o.charmColor = charmHex;
  else {
    const charmColor = intIn(raw.charmColor, 0, CHARM_COLORS.length - 1);
    if (charmColor !== undefined) o.charmColor = charmColor;
  }

  if (typeof raw.coverFrame === 'number' && Number.isInteger(raw.coverFrame)) {
    o.coverFrame = normalizeCoverFrameIndex(raw.coverFrame);
  }
  if (typeof raw.cornerProtectors === 'boolean') o.cornerProtectors = false;
  if (typeof raw.insetPlate === 'boolean') o.insetPlate = false;

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
  /**
   * Exact named/composed binding selected outside `cover_meta`.
   * Null means the book's seeded binding; omitted has the same art meaning.
   * The cover needs this even though only SpineParams persists the pin: both
   * faces must wear the same exact MaterialLook.
   */
  binding?: BookPresetId | null;
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
  const effectiveBinding = opts.binding ?? presetForSeed(s).id;
  const bindingOwnsFocal = bookPresetHasAuthoredFocal(effectiveBinding);
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
  const exactMaterial =
    over.material !== undefined
      ? materialLookFor(material)
      : bookPreset(effectiveBinding).material;
  const materialSpec = MATERIALS[exactMaterial];
  const surfaceLed =
    materialSpec.split !== 'none' ||
    (materialSpec.grain !== 'none' && materialSpec.grainCount > 3);

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
  const headTailStyle = normalizeHeadTailStyle(over.headTailStyle ?? base.headTailStyle);

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
  ornament = normalizeOrnamentIndex(ornament);
  if (bindingOwnsFocal || surfaceLed) ornament = ORNAMENT_NONE;

  let titlePlate: TitlePlateStyle = normalizeTitlePlateStyle(
    over.titlePlate ??
      (theme.titlePlates ? pick(theme.titlePlates, rPlate) : (base.titlePlate ?? 'none')),
  );
  if (surfaceLed && !SURFACE_LED_TITLE_PLATES.has(titlePlate)) {
    titlePlate = normalizeTitlePlateStyle(gilt ? 'gilt-direct' : 'blind-lettered');
  }

  const titleFont = normalizeCoverHandIndex(
    over.titleFont ?? (theme.titleFonts ? pick(theme.titleFonts, rFont) : base.font),
  );
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

  const edge: EdgeTreatment = normalizeEdgeTreatment(
    over.edge ?? (theme.edges ? pick(theme.edges, rEdge) : (base.edge ?? 'plain')),
  );

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

  // Applied charms are retired as a surface class. Preserve the historical
  // random draws so changing this rule never reshuffles later seeded choices.
  void rCharm;
  void rCharmOn;
  const charm: CharmKind = 'none';

  /**
   * The charm's colourway.
   *
   * A colour of the reader's own passes through UNTOUCHED; only an index is
   * rounded and clamped. That split is the whole change: this was one
   * `clamp(Math.round(…))` over the whole expression, and `Math.round('#00b3a4')`
   * is NaN, which `clamp` then pins to 0 — so a reader's colour would have come
   * back as the first crimson on the shelf. Silent degradation of a colour
   * somebody chose is exactly what `art/customColour.ts` forbids.
   *
   * A theme may BIAS the colourway (`theme.charmColors` is a pool of indices)
   * but may not invent a hex, for the same reason the cloth's does not: a room
   * does not get to hand out "your own" colours.
   */
  const ownCharm = normaliseHex(over.charmColor);
  const asIndex = (value: unknown): number =>
    clamp(Math.round(typeof value === 'number' ? value : 0), 0, CHARM_COLORS.length - 1);
  let charmColor: number | string;
  if (ownCharm !== null) charmColor = ownCharm;
  else if (typeof over.charmColor === 'number') charmColor = asIndex(over.charmColor);
  else if (theme.charmColors) charmColor = asIndex(pick(theme.charmColors, rCharmColor));
  else charmColor = normaliseHex(base.charmColor) ?? asIndex(base.charmColor);

  // Cover-only knobs: the seed's own rolls unless the studio pins them.
  const coverBase = deriveCoverParams(s);
  let coverFrame = normalizeCoverFrameIndex(over.coverFrame ?? coverBase.frame);
  if (surfaceLed && !SURFACE_LED_FRAMES.has(coverFrame)) coverFrame = 2;
  // One emblem axis drives both faces. A binding-authored centrepiece spends
  // that focal budget itself, so the compatibility fields stay bare.
  const coverMedallion = bindingOwnsFocal || surfaceLed ? ORNAMENT_NONE : ornament;
  const cornerProtectors = false;
  const insetPlate = false;
  void rCorner;
  void rInset;

  const style: BookStyle = {
    material,
    pigment: clamp(Math.round(pigment), 0, PIGMENT_COUNT - 1),
    // No seed roll and no theme bias behind it on purpose. A room may BIAS the
    // pigment a book is bound in; it may not invent a colour the reader typed,
    // and a dice that rolled one would be handing out "your own" colours.
    clothHex: over.clothHex ?? null,
    spineBaseHex: over.spineBaseHex ?? null,
    spineAccentHex: over.spineAccentHex ?? null,
    coverBaseHex: over.coverBaseHex ?? null,
    coverAccentHex: over.coverAccentHex ?? null,
    toolingHex: over.toolingHex ?? null,
    emblemHex: over.emblemHex ?? null,
    hardwareHex: over.hardwareHex ?? null,
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
    // Never rolled and never biased by a room: standing a book through the
    // carpentry is a decision, and a dice that made it would be overruling the
    // case on the reader's behalf.
    overlap: over.overlap ?? false,
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
  // A binding may author a front-cover label even when the seed's latent title
  // treatment is `none`. Resolve that inherited choice once for cover drawing;
  // keeping the latent value on `style` still lets persistence distinguish
  // "untouched" from an explicit reader-picked None.
  const renderedTitlePlate = effectiveBookTitlePlate(
    s,
    style,
    opts.binding ?? null,
    pinned.has('titlePlate'),
  );
  const renderedStyle =
    renderedTitlePlate === style.titlePlate
      ? style
      : { ...style, titlePlate: renderedTitlePlate };
  return {
    seed: s,
    style,
    spine: spineParamsFor(base, renderedStyle, pinned),
    cover: coverParamsFor(
      s,
      renderedStyle,
      opts.binding ?? null,
      pinned.has('material'),
    ),
    pinned,
  };
}

/**
 * Resolve the title treatment a reader actually sees on the front cover.
 *
 * `none` is overloaded in old data: when it is merely the seed/default value,
 * a binding-authored label plate is allowed to show; when the reader pinned
 * None, it must suppress that label. Spines do not consume this value; it is
 * retained on SpineParams only as seed-era compatibility data for cover-only
 * readers that still derive a cover from the shared parameter object.
 */
export function effectiveBookTitlePlate(
  seed: number,
  style: Pick<BookStyle, 'titlePlate'>,
  binding: BookPresetId | null,
  titlePlatePinned: boolean,
): TitlePlateStyle {
  if (titlePlatePinned || style.titlePlate !== 'none') return style.titlePlate;
  const preset = binding === null ? presetForSeed(seed >>> 0) : bookPreset(binding);
  return bookPresetWantsCoverTitle(preset.id)
    ? normalizeTitlePlateStyle('label')
    : 'none';
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
    clothHex: style.clothHex,
    spineBaseHex: style.spineBaseHex,
    spineAccentHex: style.spineAccentHex,
    toolingHex: style.toolingHex,
    emblemHex: style.emblemHex,
    hardwareHex: style.hardwareHex,
    hueJitter: style.hueJitter,
    // The legacy 0|1|2 texture bucket is kept in sync so any consumer that
    // still branches on it (older cover code, tests) agrees with the material.
    texture: textureFromMaterial(style.material),
    material: style.material,
    // Ornament stays an append-only table index (covers derive their
    // medallion from it); the "none" option rides on ornamentOn.
    ornament: style.ornament >= 0 ? style.ornament : base.ornament,
    ornamentOn: style.ornament >= 0,
    font: Math.max(0, COVER_FONT_KIN[style.titleFont] ?? 0) as 0 | 1 | 2,
    gilt: style.gilt,
    raisedBands: style.raisedBands,
    bandGilt: style.bandGilt,
    headTail: style.headTail,
    headTailStyle: style.headTailStyle,
    titlePlate: style.titlePlate,
    raisedBandsPinned: pinned.has('raisedBands'),
    ornamentPinned: pinned.has('ornament'),
    headTailPinned: pinned.has('headTail') || pinned.has('headTailStyle'),
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
export function coverParamsFor(
  seed: number,
  style: BookStyle,
  binding: BookPresetId | null = null,
  materialPinned = false,
): CoverParams {
  const bindingPreset = binding === null ? presetForSeed(seed >>> 0) : bookPreset(binding);
  // A reader's explicit coarse material chip is allowed to replace the named
  // covering on both faces. Otherwise preserve the preset's exact MaterialLook
  // (brocade, tree calf, vellum…), not the seed/theme's unrelated seven-way
  // BindingMaterial roll.
  const materialLook = materialPinned
    ? materialLookFor(style.material)
    : bindingPreset.material;
  const covering = Math.max(0, COVER_TEXTURES.indexOf(materialLook));
  const coverMaterial = materialPinned
    ? style.material
    : (bindingMaterialFor(materialLook) as BindingMaterial);
  const bindingEmblem = authoredCoverEmblem(bindingPreset.id);
  const overrides: CoverOverrides = {
    palette: style.pigment,
    clothHex: style.clothHex,
    coverBaseHex: style.coverBaseHex,
    coverAccentHex: style.coverAccentHex,
    toolingHex: style.toolingHex,
    emblemHex: style.emblemHex,
    hardwareHex: style.hardwareHex,
    texture: textureFromMaterial(coverMaterial),
    covering,
    frame: style.coverFrame,
    // A binding-authored focal suppresses the optional shelf ornament, but its
    // semantic counterpart still belongs on the front board. This is why the
    // crowned Welcome spine and its held cover remain the same book.
    medallion: bindingEmblem >= 0 ? bindingEmblem : style.coverMedallion,
    titleFont: style.titleFont,
    gilt: style.gilt,
    raisedBands: style.raisedBands,
    bandGilt: style.bandGilt,
    headTail: style.headTail,
    headTailStyle: style.headTailStyle,
    material: coverMaterial,
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
 * Ordinary proportions for a book nobody has deliberately redressed.
 *
 * Eight-to-fifty-eight pixels is a useful manual range and a dangerous dice:
 * crossed independently with 132-to-300px heights it can make a paving slab
 * or a ruler. Fresh books stay inside a recognisable width/height envelope;
 * the Studio's explicit sliders still retain the whole legal range.
 */
export const FRESH_BOOK_PROPORTION_RANGE = { min: 0.06, max: 0.205 } as const;

const FRESH_FORMAT_POOL: readonly SpineFormat[] = [
  'pocket',
  'pocket',
  'duodecimo',
  'duodecimo',
  'duodecimo',
  'duodecimo',
  'duodecimo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'octavo',
  'quarto',
  'quarto',
  'quarto',
  'folio',
];

/** Calm board frames: a structural rule, never a second ornament programme. */
const FRESH_COVER_FRAMES: readonly number[] = [0, 0, 0, 2, 2, 5, 24, 24, 24];

/** One-stroke binder's tools that stay legible at shelf scale. */
const FRESH_EMBLEMS: readonly number[] = [
  0, 1, 2, 5, 12, 13, 14, 20,
  23, 26, 28, 29, 30, 31, 43, 56,
];

type FreshFurniture = 'none' | 'bands' | 'emblem';
type FreshPreset = ReturnType<typeof presetForSeed>;

function freshFormatFor(preset: FreshPreset, r: number): SpineFormat {
  const name = `${preset.id} ${preset.label}`.toLowerCase();
  if (name.includes('folio')) return pick(['folio', 'folio', 'quarto'] as const, r);
  if (name.includes('quarto')) return pick(['quarto', 'quarto', 'octavo'] as const, r);
  if (name.includes('octavo')) return pick(['octavo', 'octavo', 'duodecimo'] as const, r);
  if (preset.tags.includes('pocket')) {
    return pick(['pocket', 'pocket', 'pocket', 'duodecimo'] as const, r);
  }
  if (preset.tags.includes('heavy')) {
    return pick(['octavo', 'quarto', 'quarto', 'folio'] as const, r);
  }
  if (preset.group === 'wrappers') {
    return pick(['pocket', 'duodecimo', 'duodecimo', 'octavo'] as const, r);
  }
  return pick(FRESH_FORMAT_POOL, r);
}

function freshDimensions(
  preset: FreshPreset,
  formatRoll: number,
  heightRollA: number,
  heightRollB: number,
  profileRoll: number,
  thicknessRoll: number,
): { height: number; thickness: number } {
  const format = freshFormatFor(preset, formatRoll);
  const span = SPINE_FORMATS[format];
  // A triangular roll favours the recognisable centre of a format without
  // turning the five format bands into five identical heights.
  const height = Math.round(
    span.min + ((heightRollA + heightRollB) / 2) * (span.max - span.min),
  );

  let lo: number;
  let hi: number;
  if (preset.group === 'wrappers' || preset.tags.includes('pocket')) {
    [lo, hi] = [0.065, 0.115];
  } else if (preset.tags.includes('heavy')) {
    [lo, hi] = [0.14, 0.2];
  } else if (profileRoll < 0.16) {
    [lo, hi] = [0.07, 0.1];
  } else if (profileRoll < 0.84) {
    [lo, hi] = [0.105, 0.155];
  } else {
    [lo, hi] = [0.16, 0.2];
  }

  const ratio = lo + thicknessRoll * (hi - lo);
  const minWidth = Math.max(
    SPINE_THICKNESS_RANGE.min,
    Math.ceil(height * FRESH_BOOK_PROPORTION_RANGE.min),
  );
  const maxWidth = Math.min(
    SPINE_THICKNESS_RANGE.max,
    Math.floor(height * FRESH_BOOK_PROPORTION_RANGE.max),
  );
  return {
    height,
    thickness: Math.round(clamp(height * ratio, minWidth, maxWidth)),
  };
}

function freshTitlePlateFor(preset: FreshPreset, r: number): TitlePlateStyle {
  if (preset.decorations.includes('label-plate')) return 'label';
  const material = MATERIALS[preset.material];
  if (material.group === 'vellum') return 'vellum-slip';
  if (material.group === 'paper') return r < 0.72 ? 'paper-slip' : 'ink-panel';
  if (material.group === 'leather') {
    return preset.gilt
      ? (r < 0.62 ? 'morocco-label' : 'gilt-direct')
      : (r < 0.62 ? 'blind-lettered' : 'debossed');
  }
  if (material.group === 'split') return r < 0.68 ? 'label' : 'blind-lettered';
  if (preset.gilt) return r < 0.64 ? 'gilt-direct' : 'double-fillet';
  return r < 0.62 ? 'blind-lettered' : 'debossed';
}

function freshEdgeFor(preset: FreshPreset, r: number): EdgeTreatment {
  // The held-book painter has two genuinely distinct text-block finishes.
  // Gilded bindings may spend one quiet accent on the edge; everything else
  // stays honest cream instead of choosing a catalogue name with identical art.
  return preset.gilt && r >= 0.58 ? 'gilt' : 'plain';
}

function freshFurnitureFor(preset: FreshPreset, r: number): FreshFurniture {
  const authored = preset.decorations.filter(
    (decoration) => decoration !== 'plain' && decoration !== 'label-plate',
  );
  const material = MATERIALS[preset.material];
  const busySurface = material.grain !== 'none' && material.grainCount > 3;

  // A named binding already carrying a panel, stamp, band programme or figured
  // covering needs no second designer. Only a quiet binding enters this roll.
  if (authored.length > 0 || busySurface || preset.tier === 'niche') return 'none';
  if (r < 0.09 && preset.shape !== 'ribbed') return 'bands';
  if (r < 0.17) return 'emblem';
  return 'none';
}

/**
 * The restrained character a brand-new book arrives with.
 *
 * The exact named binding selected by `presetForSeed` is the authority: this
 * function deliberately omits `material`, `pigment` and `hueJitter`, so it
 * cannot collapse brocade/tree-calf/vellum into a coarse material chip or pin
 * a room's colour at creation time. It only supplies an ordinary proportion,
 * quiet cover structure, finish and — on an otherwise bare preset — at most
 * ONE secondary furniture programme.
 *
 * Every off switch is explicit. Seed defaults used to leak five cords, a stamp,
 * a charm, a medallion and corner hardware back into the same book whenever a
 * field happened not to be present. The complete neutral baseline below makes
 * the one chosen programme genuinely exclusive.
 *
 * Spine text is not part of this recipe. `titlePlate` and `titleFont` remain
 * because the front cover still carries the book title.
 */
export function freshBookStyleOverrides(seed: number): BookStyleOverrides {
  const s = seed >>> 0;
  const preset = presetForSeed(s);
  const rnd = mulberry32((s ^ 0xf2e5b00c) >>> 0);

  // Consume a fixed draw budget before interpreting any decision. A later
  // compatibility guard may turn an accent off, but it never reshuffles every
  // other feature on the book.
  const dimensions = freshDimensions(preset, rnd(), rnd(), rnd(), rnd(), rnd());
  const titlePlate = normalizeTitlePlateStyle(freshTitlePlateFor(preset, rnd()));
  const titleFont = pick([0, 0, 0, 1, 1, 2] as const, rnd());
  const edge = normalizeEdgeTreatment(freshEdgeFor(preset, rnd()));
  const wear = Math.min(0.46, rnd() * rnd() * 0.58);
  const headTailChance =
    MATERIALS[preset.material].group === 'paper'
      ? 0.12
      : MATERIALS[preset.material].group === 'leather' ||
          MATERIALS[preset.material].group === 'vellum' ||
          MATERIALS[preset.material].group === 'split'
        ? 0.52
        : 0.34;
  const headTail = rnd() < headTailChance;
  const headTailStyle = pick(ACTIVE_HEAD_TAIL_STYLES, rnd());
  const furniture = freshFurnitureFor(preset, rnd());
  const furnitureDetail = rnd();
  const frameRoll = rnd();

  const bands = furniture === 'bands' ? 1 + Math.floor(furnitureDetail * 2) : 0;
  const emblem =
    furniture === 'emblem' ? pick(FRESH_EMBLEMS, furnitureDetail) : ORNAMENT_NONE;
  const coverFrame = pick(FRESH_COVER_FRAMES, frameRoll);

  const result: BookStyleOverrides = {
    height: dimensions.height,
    thickness: dimensions.thickness,
    raisedBands: bands,
    bandGilt: bands > 0 && preset.gilt,
    headTail,
    headTailStyle,
    ornament: emblem,
    titlePlate,
    titleFont,
    wear,
    edge,
    gilt: preset.gilt,
    charm: 'none',
    coverFrame,
    coverMedallion: emblem,
    cornerProtectors: false,
    insetPlate: false,
  };
  return result;
}

/**
 * "Surprise me": a complete, deterministic random override set. Uses the full
 * legal domain of every knob rather than the weighted seed distribution, so
 * repeated presses land somewhere genuinely different.
 */
export function randomBookStyleOverrides(seed: number): BookStyleOverrides {
  const rnd = mulberry32((seed ^ 0x5a4d0e) >>> 0);
  const emblem =
    rnd() < 0.34
      ? pick(ACTIVE_ORNAMENT_INDICES, rnd())
      : ORNAMENT_NONE;
  return {
    material: pick(BINDING_MATERIALS, rnd()),
    pigment: Math.floor(rnd() * PIGMENT_COUNT),
    // Always cleared, never rolled. The dice has fifty pigments to land on and
    // a custom colour outranks all of them, so leaving one in place would make
    // every press of "randomise" repaint everything about the book EXCEPT the
    // thing the reader is looking at.
    clothHex: null,
    // Role colours inherit on the general dice. Named Surprise directions use
    // `bookSurprise.ts`, which chooses the whole palette as one guarded recipe
    // instead of rolling seven unrelated hexes.
    spineBaseHex: null,
    spineAccentHex: null,
    coverBaseHex: null,
    coverAccentHex: null,
    toolingHex: null,
    emblemHex: null,
    hardwareHex: null,
    hueJitter: (rnd() * 2 - 1) * 8,
    // Automatic bindings stop at two cords; the third remains a deliberate
    // manual Studio choice so random shelves never fall back into ladder backs.
    raisedBands: Math.floor(rnd() * 3),
    bandGilt: rnd() < 0.5,
    headTail: rnd() < 0.6,
    headTailStyle: pick(ACTIVE_HEAD_TAIL_STYLES, rnd()),
    ornament: emblem,
    titlePlate: pick(ACTIVE_TITLE_PLATES, rnd()),
    titleFont: pick(ACTIVE_COVER_HAND_INDICES, rnd()),
    wear: rnd() * rnd(),
    edge: pick(ACTIVE_EDGE_TREATMENTS, rnd()),
    height: heightForFormat(pick(SPINE_FORMAT_IDS, rnd())),
    gilt: rnd() < 0.4,
    charm: 'none',
    charmColor: Math.floor(rnd() * CHARM_COLORS.length),
    coverFrame: pick(ACTIVE_COVER_FRAME_INDICES, rnd()),
    coverMedallion: emblem,
    cornerProtectors: false,
    insetPlate: false,
  };
}
