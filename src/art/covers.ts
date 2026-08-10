/**
 * art/covers.ts — the front cover, drawn in the icon's flat language.
 *
 * The app icon (`assets/brand/icon.svg`) *is* a book cover, seen at an angle,
 * and everything on it is a note about how a cover should be built: a flat
 * cloth board, a darker spine strip down one side, three gilt bands across
 * that spine, one pale ornamental frame inset from the edge with a dot at each
 * corner, a cream label carrying a few ruled lines, a small gilt medallion
 * below it, and a moss ribbon hanging out of the bottom. This file draws that,
 * parameterised, at any size.
 *
 * ## Why it is no longer painted
 *
 * The previous cover was a simulation: layered multiply gradients for the
 * board's form, photographic material tiles dyed to a pigment, a vignette, a
 * fore-edge highlight, blind-tooled relief passes, a granulation overlay and
 * four light-rig passes on top. It cost a second to bake a single cover and
 * still read as cheap, because a half-simulated leather sits in the uncanny
 * gap between drawing and photograph and gets no credit from either. A flat
 * illustration never makes that promise, so it never breaks it — and it bakes
 * in a couple of milliseconds.
 *
 * Depth here is what it is everywhere else in the app: a darker flat face
 * beside a lighter one. There is no light direction in this file, and there is
 * no gradient. See `art/flat.ts` for the vocabulary and the reasoning.
 *
 * ## What survived the restyle
 *
 * The whole parameter surface. A book's cover still derives from the same
 * 32-bit seed as its shelf spine, users can still override any knob through
 * `cover_meta`, and the Book Studio still drives all of it. New colour roles
 * extend that contract without replacing the old cloth/pigment fallback. Some
 * knobs simply express themselves differently now: `wear` rounds the boards'
 * corners rather than grinding dirt into them.
 *
 * ## The five vocabularies a board wears
 *
 * Every count derives from its authoritative table:
 *
 *   palette    50 pigments, DERIVED from `spines.PIGMENT_COUNT`
 *   covering   50 bindings, DERIVED from `bookDesign.MATERIAL_LOOKS`
 *   frame      50 tooled borders, COMPOSED from five orthogonal traits
 *   medallion  binder stamps, DERIVED from `spines.ORNAMENT_COUNT`
 *   titleFont  50 hands, COMPOSED from the five bundled faces
 *
 * Derived where the spine already has the vocabulary — a board and a spine are
 * two faces of ONE object, and a second table kept in step by hand is the
 * promise this file has already broken twice (see `COVER_PALETTE_COUNT`).
 * Composed where the cover is the only surface that has the room for it: a
 * frame and a hand are things a spine 25px wide cannot say at all.
 *
 * Every count is read off its own table. Not one of them is a literal.
 *
 * Bake-once: `coverDataUrl` memoizes the rendered PNG per
 * (seed+overrides+size+title) key so overlays and backdrops never re-paint.
 */

import { CHARM_COLORS, charmCloth, normalizeCharmKind, type CharmKind } from './charms';
import {
  MATERIALS,
  MATERIAL_LOOKS,
  bindingMaterialFor,
  materialLookFor,
  presetForSeed,
  type MaterialLook,
  type MaterialSpec,
} from './bookDesign';
import { normaliseHex } from './customColour';
import { clothPair as foldCloth } from './palette';
import { mixHex } from './shelfDesign';
import {
  CLOTHS,
  FLAT,
  flatSchemeTag,
  inkWidth,
  panel,
  stroke,
  wobbleRect,
  type FlatCtx,
} from './flat';
import { clamp, mulberry32 } from './noise';
import { textWidth } from './textMetrics';
import {
  TITLE_TEXT_MIN_CONTRAST,
  colourContrast,
  resolveTitleColours,
  type TitleColourResolution,
} from './titleContrast';
import {
  MAX_RAISED_BANDS,
  ORNAMENT_COUNT,
  PIGMENT_COUNT,
  clothForPalette,
  deriveSpineParams,
  materialFromTexture,
  normalizeEdgeTreatment,
  normalizeHeadTailStyle,
  normalizeOrnamentIndex,
  normalizeTitlePlateStyle,
  textureFromMaterial,
  isTitlePlateStyle,
  type BindingMaterial,
  type EdgeTreatment,
  type TitlePlateStyle,
} from './spines';

/* --------------------------------- params -------------------------------- */

/**
 * How wide a book's board is, as a fraction of its height.
 *
 * ONE number, because a book is a book: what changes between a folio and a
 * pocket duodecimo is how BIG the object is, not how differently shaped. The
 * pull-out overlay has always drawn its ghost at this ratio, so anything else
 * that shows a whole cover — the studio preview above all — has to use the
 * same one or the book changes proportion between two views of itself.
 *
 * That was the bug: the studio drew every cover into a fixed 214×292 box while
 * drawing the spine at the book's real height, so a pocket book previewed with
 * a short spine beside a folio-sized board.
 */
export const COVER_ASPECT = 0.72;

/**
 * How many pigment slots a cover's `palette` spans.
 *
 * DERIVED from `spines.PIGMENT_COUNT`, never written as a number. The spine
 * derives `palette` from the pigment table and `deriveCoverParams` copies it
 * across verbatim so the shelf and the pull-out agree about which book this is
 * — so the moment this constant disagrees with that table, the cover is
 * validating a range it does not actually receive. It was hard-coded 20, the
 * pigment table grew to 50, and covers started arriving with a palette outside
 * their own declared bound.
 */
export const COVER_PALETTE_COUNT = PIGMENT_COUNT;
/* COVER_FRAME_COUNT is exported beside the FRAMES table it counts, further
 * down. Restating it here as a literal is the exact mistake COVER_PALETTE_COUNT
 * made — it sat at 20 while the table it described grew to 50. */

/**
 * DERIVED from the spine's stamp table, not restated.
 *
 * The medallion IS the spine's ornament drawn large — one book, one tool. It
 * was hard-coded 8 and folded from a 12-then-50 entry table with `% 8`, so a
 * book's board carried a different device from its spine. Deriving it is also
 * the rule this file learned the hard way with COVER_PALETTE_COUNT, which sat
 * at 20 while the pigment table it described grew to 50.
 */
export const COVER_MEDALLION_COUNT = ORNAMENT_COUNT;

/**
 * The cover's premium binder-tool catalog, index-for-index with the spine.
 *
 * This is deliberately broader than a seven-icon starter set, but every live
 * entry still has to survive both a full board and the narrow turn of the
 * spine. The vocabulary therefore stays with historically plausible
 * bookbinder's brass: open botanical tools, formal centrepieces and a small
 * heraldic set. Animals, hardware, astrology marks, dots and novelty symbols
 * remain migration-only. `-1` remains the deliberate bare-board choice.
 */
export const ACTIVE_COVER_EMBLEM_INDICES = [
  0, 1, 2, 5, 12, 13, 14, 20, 23, 26, 28, 29, 30, 31, 43, 56,
] as const;

export type ActiveCoverEmblemIndex = (typeof ACTIVE_COVER_EMBLEM_INDICES)[number];

export const ACTIVE_COVER_EMBLEMS: readonly {
  index: ActiveCoverEmblemIndex;
  label: string;
}[] = [
  { index: 0, label: 'Foliate lozenge' },
  { index: 1, label: 'Broad laurel branch' },
  { index: 2, label: 'Foliate starflower' },
  { index: 5, label: 'Rising sun' },
  { index: 12, label: 'Three-leaf fleuron' },
  { index: 13, label: 'Oak-and-acorn spray' },
  { index: 14, label: 'Thistle bloom' },
  { index: 20, label: 'Open royal crown' },
  { index: 23, label: 'Stemmed rosette' },
  { index: 26, label: 'Broad fleur-de-lis' },
  { index: 28, label: 'Oak acanthus volutes' },
  { index: 29, label: 'Wheat sheaf' },
  { index: 30, label: 'Split pomegranate' },
  { index: 31, label: 'Open tulip' },
  { index: 43, label: 'Five-leaf anthemion' },
  { index: 56, label: 'Fern palmette' },
];

const ACTIVE_COVER_EMBLEM_SET: ReadonlySet<number> = new Set(ACTIVE_COVER_EMBLEM_INDICES);

/** Total migration from every legacy stamp index into the shared cover tools. */
export function normalizeCoverEmblemIndex(kind: number | undefined): number {
  if (kind === -1) return -1;
  const normalized = normalizeOrnamentIndex(kind);
  if (normalized === -1) return -1;
  return ACTIVE_COVER_EMBLEM_SET.has(normalized) ? normalized : 12;
}

/**
 * The fifty coverings a board can be bound in.
 *
 * DERIVED from the spine's own table (`bookDesign.MATERIAL_LOOKS`), not a
 * cover-specific fifty — and that was the choice, deliberately. A board and a
 * spine are two faces of ONE object: if the shelf shows a book grained like
 * goatskin and the pull-out shows a smooth cloth, the reader is looking at two
 * books. A second table of fifty would have had to be kept in step with the
 * first by hand, which is the same promise `COVER_PALETTE_COUNT` and
 * `COVER_MEDALLION_COUNT` both failed to keep before they were derived.
 *
 * This used to be three strings — labels for the legacy `texture` bucket — and
 * nothing read them. Those three now live on as `COVER_TEXTURE_BUCKETS`, which
 * is what `CoverParams.texture` still means.
 */
export const COVER_TEXTURES: readonly MaterialLook[] = MATERIAL_LOOKS;
/** How many coverings a board can wear. Derived, never restated. */
export const COVER_TEXTURE_COUNT = COVER_TEXTURES.length;
/** Display names for the studio's covering picker. */
export const COVER_TEXTURE_LABELS: readonly string[] = COVER_TEXTURES.map(
  (id) => MATERIALS[id].name,
);
/* COVER_FONTS / COVER_FONT_COUNT / COVER_FONT_KIN are exported beside the HANDS
 * table they describe, further down — a table and its count have to be able to
 * disagree only by someone deleting a line, never by someone forgetting one. */

export interface CoverParams {
  /** Seed the params were derived from (drives render-time jitter too). */
  seed: number;
  /**
   * Which cloth the boards are bound in — a pigment slot, inherited from the
   * spine's own palette roll and folded onto the house cloths by
   * `spines.clothForPalette`. `COVER_PALETTE_COUNT` wide, whatever that is
   * today.
   */
  palette: number;
  /**
   * A cloth colour the READER typed, `#rrggbb`, overruling `palette`.
   *
   * It is here and not only on the spine because the shelf and the pull-out
   * are two views of ONE book: an override that reached the spine alone is
   * exactly the split `tests/covers.test.ts` exists to catch — a book that
   * changes colour when you pick it up.
   */
  clothHex?: string | null;
  /** Front/back board ground only; null inherits `clothHex`/palette. */
  coverBaseHex?: string | null;
  /** Secondary board/inset covering; null uses the seeded partner cloth. */
  coverAccentHex?: string | null;
  /** Rules, frames and title tooling; null follows gilt/blind tooling. */
  toolingHex?: string | null;
  /** Centre medallion/stamp; null follows the tooling convention. */
  emblemHex?: string | null;
  /** Corner plates and other fittings; null uses authored metal. */
  hardwareHex?: string | null;
  /**
   * Legacy covering bucket: 0 = cloth, 1 = leather, 2 = paper. Kept because
   * `cover_meta` blobs in the wild carry it and `material` is derived from it.
   * `covering` is what actually grains a board now; this stays the three-way
   * bucket the older blobs and `spines.textureFromMaterial` speak in.
   */
  texture: 0 | 1 | 2;
  /**
   * Which of the fifty coverings the boards are bound in — an index into
   * `COVER_TEXTURES`, which IS the spine's table.
   *
   * Optional so that pre-covering `CoverParams` literals still render; absent,
   * `coveringSpecFor` falls back through the seven studio chips exactly as this
   * file did before the axis existed.
   */
  covering?: number;
  /** Tooled frame — an index into the fifty composed in `FRAMES`. */
  frame: number;
  /** Centre medallion; -1 deliberately leaves a closed composition un-stamped. */
  medallion: number;
  /**
   * Title hand — an index into `COVER_FONTS`, fifty of them.
   *
   * 0, 1 and 2 are still plain Caveat / Kalam / Patrick Hand, because the field
   * is index-addressed by saved `cover_meta` blobs; the other forty-seven are
   * those five bundled faces set as a binder letters a board (weight, tracking,
   * case, slope, size). It was typed `0 | 1 | 2` and is a plain number now.
   */
  titleFont: number;
  /** Gilt (gold) frame accents, medallion and title plate trim. */
  gilt: boolean;

  /** Raised cord stations on the visible cover-side back, shared with the shelf spine. */
  raisedBands?: number;
  /** Whether the raised-cord edges are tooled in gold. */
  bandGilt?: boolean;
  /** Whether sewn head/tail finishing is visible at the ends of the back. */
  headTail?: boolean;
  /** Woven chevron (1) or wrapped cord (2), shared with the shelf spine. */
  headTailStyle?: number;

  /* ---------------------- Book Studio additions (§4) ---------------------- */
  /* Optional, so pre-studio CoverParams literals still typecheck and render.
   * deriveCoverParams always fills them, inheriting from the spine so the
   * shelf → pull-out → open-book journey never changes the book's identity. */

  /**
   * Binding material. Flat art carries one distinction the eye can actually
   * make across a room: `vellum` and `paper` bind as a pale half-bound board,
   * everything else as dyed cloth.
   */
  material?: BindingMaterial;
  /** Front-cover title treatment, projected from the legacy shared params. */
  titlePlate?: TitlePlateStyle;
  /** Metal corner protectors on the four cover corners. */
  cornerProtectors?: boolean;
  /** Recess the title plate into a bevelled inset panel. */
  insetPlate?: boolean;
  /** Fore-edge treatment of the text block. */
  edge?: EdgeTreatment;
  /** Wear, 0 (pristine) → 1 (well-loved): rounder corners, less fine tooling. */
  wear?: number;
  /** The book's charm, drawn cover-side. */
  charm?: CharmKind;
  /** Index into charms.CHARM_COLORS, or a hex the reader chose themselves. */
  charmColor?: number | string;
  /**
   * Sub-treatment within the material (crackled vs pebbled leather, ribbed vs
   * flat cloth…), inherited from the spine. It described a grain, so nothing
   * on a flat board reads it; kept so the studio round-trips a book's saved
   * style untouched.
   */
  boardStyle?: number;
}

/** The user-overridable subset of CoverParams (everything but the seed). */
export type CoverOverrides = Partial<Omit<CoverParams, 'seed'>>;

/**
 * Tolerantly read a cover-override object out of untrusted JSON (the
 * `cover_meta.cover` blob). Unknown keys are dropped, invalid values are
 * dropped (never clamped into meaning), and a value-less result is null.
 */
export function normalizeCoverOverrides(raw: unknown): CoverOverrides | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const out: CoverOverrides = {};

  const int = (value: unknown, max: number): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max
      ? value
      : undefined;

  const palette = int(source.palette, COVER_PALETTE_COUNT);
  if (palette !== undefined) out.palette = palette;
  // A colour the reader typed. `null` is meaningful here and is NOT the same
  // as absent: it is "go back to the pigment", which a blob written by a
  // reader who cleared their own colour has to be able to say.
  if (source.clothHex === null) out.clothHex = null;
  else {
    const clothHex = normaliseHex(source.clothHex);
    if (clothHex !== null) out.clothHex = clothHex;
  }
  for (const key of [
    'coverBaseHex',
    'coverAccentHex',
    'toolingHex',
    'emblemHex',
    'hardwareHex',
  ] as const) {
    if (source[key] === null) out[key] = null;
    else {
      const value = normaliseHex(source[key]);
      if (value !== null) out[key] = value;
    }
  }
  const texture = int(source.texture, 3);
  if (texture !== undefined) out.texture = texture as 0 | 1 | 2;
  const covering = int(source.covering, COVER_TEXTURE_COUNT);
  if (covering !== undefined) out.covering = covering;
  if (typeof source.frame === 'number' && Number.isInteger(source.frame)) {
    out.frame = normalizeCoverFrameIndex(source.frame);
  }
  if (typeof source.medallion === 'number' && Number.isInteger(source.medallion)) {
    out.medallion = normalizeCoverEmblemIndex(source.medallion);
  }
  const titleFont = int(source.titleFont, COVER_FONT_COUNT);
  if (titleFont !== undefined) out.titleFont = titleFont;
  if (typeof source.gilt === 'boolean') out.gilt = source.gilt;
  const raisedBands = int(source.raisedBands, MAX_RAISED_BANDS + 1);
  if (raisedBands !== undefined) out.raisedBands = raisedBands;
  if (typeof source.bandGilt === 'boolean') out.bandGilt = source.bandGilt;
  if (typeof source.headTail === 'boolean') out.headTail = source.headTail;
  if (typeof source.headTailStyle === 'number' && Number.isInteger(source.headTailStyle)) {
    out.headTailStyle = normalizeHeadTailStyle(source.headTailStyle);
  }
  /*
   * A compatibility projection may carry the binding's effective title plate
   * for older cover-only readers. It is still inherited, not a reader pin:
   * current readers must resolve it again from the binding so a later binding
   * change can bring its own furniture. An unmarked value is a genuine legacy
   * cover choice and therefore remains an explicit override.
   */
  if (
    source.titlePlateSource !== 'inherited' &&
    isTitlePlateStyle(source.titlePlate)
  ) {
    out.titlePlate = normalizeTitlePlateStyle(source.titlePlate);
  }
  if (typeof source.edge === 'string') out.edge = normalizeEdgeTreatment(source.edge);
  if (typeof source.charm === 'string') out.charm = normalizeCharmKind(source.charm);
  // Hardware stacking is retired. Keep explicit false in migrated projections
  // so no older cover-only reader can fall through to a seeded true value.
  if (typeof source.cornerProtectors === 'boolean') out.cornerProtectors = false;
  if (typeof source.insetPlate === 'boolean') out.insetPlate = false;

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Derive the cover parameter set for one book. Shares palette, texture, gilt
 * and ornament identity with the spine derived from the same seed, and reads
 * the shared params' cover-only title face before rolling the other cover-only
 * knobs from an offset stream. `overrides` (already normalized) wins last.
 */
export function deriveCoverParams(
  seed: number,
  overrides?: CoverOverrides | null,
): CoverParams {
  const spine = deriveSpineParams(seed >>> 0);
  const rnd = mulberry32((seed ^ 0x0c0feba1) >>> 0);
  // The covering the book's BINDING wears — the same call `renderSpine` makes
  // when the reader has not pinned one, so an untouched book is grained the
  // same way on both of its faces.
  const bound = presetForSeed(seed >>> 0).material;
  const derived: CoverParams = {
    seed: seed >>> 0,
    palette: spine.palette,
    clothHex: spine.clothHex ?? null,
    coverBaseHex: null,
    coverAccentHex: null,
    toolingHex: null,
    emblemHex: null,
    hardwareHex: null,
    texture: spine.texture,
    covering: coveringIndex(bound),
    frame:
      ACTIVE_COVER_FRAME_INDICES[
        Math.floor(rnd() * ACTIVE_COVER_FRAME_INDICES.length)
      ] ?? 0,
    // The medallion IS the spine's stamp, and the two tables are the same table
    // now — the fold is kept because `ornament` is an index off a stream that
    // has no idea how wide the stamp table is.
    medallion: normalizeCoverEmblemIndex(spine.ornament),
    titleFont: handForFace(spine.font, seed >>> 0),
    gilt: spine.gilt || rnd() < 0.18,
    raisedBands: clamp(Math.round(spine.raisedBands ?? 0), 0, MAX_RAISED_BANDS),
    bandGilt: spine.bandGilt ?? false,
    headTail: spine.headTail,
    headTailStyle: normalizeHeadTailStyle(spine.headTailStyle),
    // Studio fields: inherited from the spine wherever the book already has
    // an opinion, plus two cover-only rolls.
    material: spine.material ?? materialFromTexture(spine.texture),
    titlePlate: normalizeTitlePlateStyle(spine.titlePlate),
    cornerProtectors: false,
    insetPlate: false,
    edge: normalizeEdgeTreatment(spine.edge),
    wear: spine.wear ?? 0.12,
    charm: normalizeCharmKind(spine.charm),
    charmColor: spine.charmColor ?? 0,
    // Sub-treatment within the material: a spine bound in crackled leather
    // must pull out into a cover in crackled leather.
    boardStyle: spine.boardStyle ?? 0,
  };
  const merged = overrides ? { ...derived, ...overrides } : derived;
  // A material override must drag the legacy texture bucket along, or the
  // two disagree and the cover paints a cloth weave under a silk sheen.
  if (overrides?.material !== undefined && overrides.texture === undefined) {
    merged.texture = textureFromMaterial(overrides.material);
  }
  // …and the covering with it, but ONLY when the chip disagrees with what the
  // binding already wears.
  //
  // The studio hands `material` down on every save, pinned or not (it is how a
  // chip reports what the reader is looking at — see `bindingMaterialFor`), so
  // dragging unconditionally would collapse all fifty coverings onto the seven
  // chips the moment anybody opened the panel, while the spine kept its fifty.
  // That is the exact split this file exists to catch, arriving through the one
  // door left open. A chip that no longer matches the binding is the reader
  // having MOVED it, and that does say "make the whole book this".
  if (
    overrides?.material !== undefined &&
    overrides.covering === undefined &&
    overrides.material !== bindingMaterialFor(bound)
  ) {
    merged.covering = coveringIndex(materialLookFor(overrides.material));
  }
  // A direct typed caller may bypass `normalizeCoverOverrides`; keep the
  // renderer contract hard at this seam too.
  merged.frame = normalizeCoverFrameIndex(merged.frame);
  merged.medallion = normalizeCoverEmblemIndex(merged.medallion);
  merged.raisedBands = clamp(Math.round(merged.raisedBands ?? 0), 0, MAX_RAISED_BANDS);
  merged.bandGilt = merged.bandGilt === true;
  merged.headTail = merged.headTail === true;
  merged.headTailStyle = normalizeHeadTailStyle(merged.headTailStyle);
  merged.titlePlate = normalizeTitlePlateStyle(merged.titlePlate);
  merged.edge = normalizeEdgeTreatment(merged.edge);
  merged.charm = normalizeCharmKind(merged.charm);
  merged.cornerProtectors = false;
  merged.insetPlate = false;
  return merged;
}

/** Where a covering sits in `COVER_TEXTURES`; unknown ones land on the first. */
function coveringIndex(look: MaterialLook): number {
  const i = COVER_TEXTURES.indexOf(look);
  return i < 0 ? 0 : i;
}

/**
 * The covering a set of params is bound in.
 *
 * Three answers, narrowest first: the `covering` index when there is one, the
 * seven studio chips when there is not (a pre-covering blob, or a caller that
 * only knows `material`), and the legacy three-way bucket under that. Total,
 * because a board with no covering at all is a board that cannot be drawn.
 */
export function coveringSpecFor(params: CoverParams): MaterialSpec {
  const i = params.covering;
  if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < COVER_TEXTURES.length) {
    return MATERIALS[COVER_TEXTURES[i] as MaterialLook];
  }
  return MATERIALS[materialLookFor(params.material ?? materialFromTexture(params.texture))];
}

/**
 * Construction underneath the cover's decoration.
 *
 * A frame, title plate and stamp are furniture; they cannot make an object a
 * book on their own.  The binding does that through its back, joint, board
 * turn-ins and head/tail finishing.  This recipe is derived from the exact
 * covering rather than persisted as more Studio knobs, so a quiet linen case
 * and a flexible paper wrapper remain recognisably different with every piece
 * of optional furniture switched off.
 */
export interface CoverConstruction {
  /** Back width as a fraction of the whole board. */
  spineRatio: number;
  /** Dark outer round as a fraction of that back. */
  roundRatio: number;
  /** The flat recessed joint immediately beside the back. */
  jointRatio: number;
  /** Raised supports or vellum ties, from head to tail. */
  supports: readonly number[];
  /** Support thickness as a fraction of the back width. */
  supportWeight: number;
  /** How the covering finishes around the three exposed board edges. */
  boardEdge: 'turned' | 'folded' | 'soft' | 'raw';
  /** How the head and tail of the back are closed. */
  endband: 'none' | 'woven' | 'plain' | 'tied' | 'stitched';
}

/** Even cord stations with a generous titleless centre bay. */
function coverCordStations(count: number): readonly number[] {
  const n = clamp(Math.round(count), 0, MAX_RAISED_BANDS);
  if (n <= 0) return [];
  if (n === 1) return [0.5];
  const start = 0.2;
  const end = 0.8;
  return Array.from({ length: n }, (_, index) => start + (index / (n - 1)) * (end - start));
}

/** Resolve the binding construction which `renderCoverInto` actually draws. */
export function coverConstructionFor(params: CoverParams): CoverConstruction {
  const spec = coveringSpecFor(params);
  // Wrapper stock still has a small physical turn; zero is not the only way a
  // material declares a flexible folded back in the reset vocabulary.
  const flexible = spec.turn <= 0.1;
  const turnNudge = (clamp(spec.turn, 0.14, 0.32) - 0.23) * 0.075;
  const resolve = (construction: CoverConstruction): CoverConstruction => {
    const explicitBands = typeof params.raisedBands === 'number';
    const supports = explicitBands
      ? coverCordStations(params.raisedBands ?? 0)
      : construction.supports;
    return {
      ...construction,
      supports,
      supportWeight:
        supports.length > 0 && construction.supportWeight <= 0
          ? 0.115
          : construction.supportWeight,
      endband: params.headTail === false ? 'none' : construction.endband,
    };
  };

  if (spec.id === 'sailcloth') {
    return resolve({
      spineRatio: 0.082,
      roundRatio: 0.12,
      jointRatio: 0.007,
      supports: [],
      supportWeight: 0,
      boardEdge: 'folded',
      endband: 'stitched',
    });
  }

  if (spec.group === 'paper' && flexible) {
    return resolve({
      spineRatio: 0.072,
      roundRatio: 0.1,
      jointRatio: 0.006,
      supports: [],
      supportWeight: 0,
      boardEdge: 'folded',
      endband: 'plain',
    });
  }

  if (spec.group === 'split') {
    return resolve({
      spineRatio: clamp(0.151 + turnNudge, 0.142, 0.16),
      roundRatio: 0.2,
      jointRatio: 0.015,
      supports: [0.18, 0.36, 0.64, 0.82],
      supportWeight: 0.13,
      boardEdge: spec.id === 'boards-exposed' ? 'raw' : 'turned',
      endband: spec.id === 'boards-exposed' ? 'plain' : 'woven',
    });
  }

  if (spec.group === 'leather' || spec.group === 'exotic') {
    return resolve({
      spineRatio: clamp(0.144 + turnNudge, 0.136, 0.154),
      roundRatio: 0.215,
      jointRatio: spec.joints > 1 ? 0.017 : 0.013,
      supports: [0.16, 0.33, 0.5, 0.67, 0.84],
      supportWeight: 0.125,
      boardEdge: spec.id === 'suede' ? 'soft' : 'turned',
      endband: 'woven',
    });
  }

  if (spec.group === 'vellum') {
    return resolve({
      spineRatio: clamp(0.132 + turnNudge, 0.126, 0.142),
      roundRatio: 0.17,
      jointRatio: spec.joints > 1 ? 0.016 : 0.012,
      supports: [0.205, 0.395, 0.605, 0.795],
      supportWeight: 0.075,
      boardEdge: 'turned',
      endband: 'tied',
    });
  }

  if (spec.group === 'paper') {
    return resolve({
      spineRatio: clamp(0.105 + turnNudge, 0.1, 0.116),
      roundRatio: 0.135,
      jointRatio: 0.009,
      supports: [],
      supportWeight: 0,
      boardEdge: 'folded',
      endband: 'plain',
    });
  }

  // Case-bound cloth and silk have smooth backs: inventing raised cords for
  // them made every quiet modern cover look like antique calf.  Their craft is
  // in a crisp joint, turn-ins and sewn endbands instead.
  return resolve({
    spineRatio: clamp(0.122 + turnNudge, 0.114, 0.132),
    roundRatio: 0.155,
    jointRatio: 0.01,
    supports: [],
    supportWeight: 0,
    boardEdge: spec.id === 'felt' ? 'soft' : 'turned',
    endband: 'woven',
  });
}

/* --------------------------------- colors -------------------------------- */

/**
 * The board a covering makes of the book's own colour.
 *
 * This used to be a two-way switch — `PALE_BINDINGS` held vellum and paper, and
 * everything else got the plain dyed cloth. The reasoning was that flat art has
 * no grain, so a material can only say one thing. That was true when materials
 * were seven near-identical entries; `bookDesign` now carries fifty coverings,
 * each with a `body` tone saying how it RELATES to the book's hue — a buckram
 * is the same book in its own darker value, a wrapper is washed most of the way
 * to paper, while natural vellum throws inherited pigment away and an explicit
 * front-board role becomes a restrained wash over the pale skin.
 *
 * So the cover asks the same table the spine reads rather than keeping its own
 * two-item opinion. Six relationships instead of two, and — the point — a board
 * that agrees with the spine it is bound to.
 *
 * It takes the resolved `MaterialSpec` rather than the studio's seven chips,
 * because the chips are a lossy REPORT of the fifty (`bindingMaterialFor`) and
 * folding through them threw away the forty-three the binding can actually
 * wear — a Library Buckram board came back as plain cloth while its own spine
 * stood there in the deep tone.
 */
function boardFor(
  spec: MaterialSpec,
  cloth: readonly [string, string],
  baseColourPinned = false,
): readonly [string, string] {
  const [face, dark] = cloth;
  switch (spec.body) {
    case 'pale':
      // Washed toward paper but still the book's own colour — a wrapper, not a
      // blank card.
      return [mixHex(face, FLAT.cream, 0.52), dark];
    case 'cream':
    case 'parchment':
      if (baseColourPinned) {
        // A dedicated front-board colour is a real reader instruction. Treat
        // it as a translucent dye over pale skin rather than replacing the
        // material with cloth: the board keeps plenty of paper, and the
        // calf/timber strip remains the structural half binding.
        return [
          mixHex(face, FLAT.cream, spec.body === 'cream' ? 0.6 : 0.54),
          PALE_BOARD[1],
        ];
      }
      // The pigment is thrown away and lives on the label. Half-bound with a
      // timber spine, because cream-on-cream lost the hinge line and the label
      // had nothing to sit against — and a vellum board with a calf spine is
      // how these were actually made.
      return PALE_BOARD;
    case 'deep':
      return [dark, mixHex(dark, FLAT.ink, 0.35)];
    case 'accent':
      return [face, mixHex(dark, FLAT.ink, 0.25)];
    case 'cloth':
    default:
      return cloth;
  }
}

/**
 * Resolve the actual flat board faces for one exact binding material.
 * `baseColourPinned` distinguishes a dedicated front-board choice from the
 * shared cloth which naturally pale skins deliberately ignore.
 * Used by the whole-book recipe guard so pale paper/vellum cannot receive
 * pale tooling merely because its pre-transform colour swatch was dark.
 */
export function coverBodyColours(
  material: MaterialLook,
  baseHex: string,
  baseColourPinned = false,
): readonly [string, string] {
  const base = normaliseHex(baseHex) ?? (CLOTHS[0]?.[0] as string);
  if (baseColourPinned && base === FLAT.cream && isPaleCovering(MATERIALS[material])) {
    return PALE_BOARD;
  }
  return boardFor(MATERIALS[material], foldCloth(base), baseColourPinned);
}

/**
 * Source pigments and representative flat fills for the two cover colour
 * controls.
 *
 * A source is what can safely be persisted and replayed. A visible colour is
 * what the painter actually puts on the board after the exact named covering
 * has interpreted that source. They differ for washed papers, deep buckram,
 * vellum and parchment, which is why Book Studio must never use one as the
 * other when it closes a Surprise lock.
 */
export interface CoverPainterColours {
  sources: { base: string; accent: string };
  visible: { base: string; accent: string };
}

/**
 * The natural parchment board, standing in for an uncoloured pale binding —
 * and half-bound, with a timber spine. Explicit role colours keep the same
 * construction while washing the first face.
 *
 * The first cut paired cream with creamDeep, which is what a pale binding
 * literally is, and every vellum cover came back as a blank card: the spine
 * strip vanished, the hinge line read as a stray mark and the label had
 * nothing to sit against. Half binding is both the fix and the truth — a
 * vellum board with a calf spine is exactly how these were made.
 */
const PALE_BOARD: readonly [string, string] = [FLAT.cream, FLAT.timber];

/** Pale skins keep their half-bound construction even after a colour wash. */
function isPaleCovering(spec: MaterialSpec): boolean {
  return spec.body === 'cream' || spec.body === 'parchment';
}

/**
 * The cloth a palette index lands on.
 *
 * `palette` still spans twenty slots because the spine derives it from a
 * twenty-entry pigment table and `deriveCoverParams` copies it across verbatim
 * — the shelf and the pull-out have to agree about which book this is. So the
 * fold onto the six flat cloths is NOT done here: `spines.clothForPalette` owns
 * it, and this defers to it. A local `palette % CLOTHS.length` looked
 * equivalent and was not — it gave the same book two colours, terracotta in the
 * hand and ochre on the shelf.
 *
 * The hexes come from the HOUSE `CLOTHS`, because that is what the spine reads.
 *
 * This used to read `flatScheme().cloths` — the ROOM's palette — on the
 * reasoning that the spine did too. The spine stopped doing that when a book
 * was made to keep its own colours in every room (see flatShelf.drawSpine), and
 * this was left behind. It survived only because both tables had six entries
 * and the room's six were near enough to the house six to pass for them.
 *
 * The day `CLOTHS` grew to fifty it became a real bug: a room has six cloths, so
 * every slot from 6 up hit the `?? cloths[0]` fallback and the cover came out
 * terracotta while the spine wore whatever it had been dressed in. That is the
 * exact split `tests/covers.test.ts` exists to catch — a book that changes
 * colour when you pick it up.
 */
function clothFor(palette: number, clothHex?: string | null): readonly [string, string] {
  // A colour the reader typed is not in the table, so it is folded rather than
  // looked up — by `palette.clothPair`, the same routine `art/bookDesign.ts`
  // folds the spine's custom cloth with, so the two faces of one book are
  // arrived at by one piece of arithmetic and cannot disagree.
  const own = normaliseHex(clothHex);
  if (own !== null) return foldCloth(own);
  const slot = clothForPalette(palette);
  return (CLOTHS[slot] ?? CLOTHS[0]!) as readonly [string, string];
}

/**
 * The book's SECOND cloth — what a figured silk is figured in, what a flecked
 * cloth is flecked with.
 *
 * The arithmetic is `bookDesign.resolveBookDesign`'s, character for character,
 * including its "the accent must never equal the cloth" guard. That is the
 * point of copying it rather than rolling a fresh one here: the spine already
 * has an accent for this book, and a board figured in a different second
 * colour from its own spine is the split this file exists to catch, arriving
 * one shade at a time instead of all at once.
 *
 * It is a house `CLOTHS` slot even when the reader has typed their own cloth,
 * exactly as it is on the spine — a custom colour leaves the second colour
 * where the seed put it rather than dragging the figuring along with it.
 */
function accentFor(palette: number, seed: number, ownAccent?: string | null): string {
  const own = normaliseHex(ownAccent);
  if (own !== null) return foldCloth(own)[0];
  const len = CLOTHS.length;
  const wrap = (n: number): number => ((Math.trunc(n) % len) + len) % len;
  const slot = clothForPalette(palette);
  const accent = wrap(slot + 1 + (((seed >>> 5) % (len - 1)) | 0));
  const pair = CLOTHS[accent === slot ? wrap(slot + 1) : accent] ?? CLOTHS[0]!;
  return pair[0] as string;
}

/** The exact board pair the cover renderer will paint for these params. */
function resolvedCoverBoard(params: CoverParams): readonly [string, string] {
  const ownBase = normaliseHex(params.coverBaseHex);
  const spec = coveringSpecFor(params);
  if (ownBase === FLAT.cream && isPaleCovering(spec)) return PALE_BOARD;
  return boardFor(
    spec,
    clothFor(params.palette, ownBase ?? params.clothHex),
    ownBase !== null,
  );
}

/** Resolve the colour wells from the same folds consumed by renderCoverInto. */
export function coverPainterColours(params: CoverParams): CoverPainterColours {
  const explicitBase = normaliseHex(params.coverBaseHex ?? params.clothHex);
  const basePair = clothFor(params.palette, params.coverBaseHex ?? params.clothHex);
  const explicitAccent = normaliseHex(params.coverAccentHex);
  const visibleAccent = accentFor(params.palette, params.seed >>> 0, params.coverAccentHex);
  return {
    sources: {
      // Preserve the reader's exact normalized input when one exists. Feeding
      // a lifted/folded face back through foldCloth a second time would move the
      // pixels even while a lock claimed to keep them.
      base: explicitBase ?? basePair[0],
      accent: explicitAccent ?? visibleAccent,
    },
    visible: {
      base: resolvedCoverBoard(params)[0],
      accent: visibleAccent,
    },
  };
}

/**
 * Resolve cover-title ink against the actual plate/board fill.
 * This is exported so recipe sweeps exercise the same decision as paintLabel.
 */
export function resolveCoverTitleColours(
  params: CoverParams,
  title = 'Title',
): TitleColourResolution {
  const board = resolvedCoverBoard(params);
  const [face, dark] = board;
  const pale = isPaleCovering(coveringSpecFor(params));
  const style: TitlePlateStyle = title.trim() ? (params.titlePlate ?? 'label') : 'label';
  const paper = style === 'label';
  const direct =
    style === 'none' ||
    style === 'gilt-direct' ||
    style === 'double-fillet' ||
    style === 'twin-rules';
  const giltBand = style === 'gilt-band';
  const inkBlock = style === 'ink-panel';
  const ground =
    direct
      ? face
      : paper
        ? pale
          ? FLAT.creamDeep
          : FLAT.cream
        : giltBand
          ? normaliseHex(params.toolingHex) ?? FLAT.gilt
          : inkBlock
            ? FLAT.ink
            : dark;
  const authored =
    direct
      ? pale
        ? FLAT.inkSoft
        : params.gilt || style === 'gilt-direct'
          ? FLAT.giltPale
          : FLAT.cream
      : paper
        ? FLAT.ink
        : giltBand
          ? FLAT.ink
          : inkBlock
            ? FLAT.cream
            : params.gilt || style === 'gilt'
              ? FLAT.giltPale
              : FLAT.cream;
  const preferred = params.toolingHex ?? authored;
  const resolved = resolveTitleColours(preferred, ground, !direct);
  if (!direct || colourContrast(resolved.ink, resolved.ground) >= TITLE_TEXT_MIN_CONTRAST) {
    return resolved;
  }

  /*
   * A mid-tone board can make both house text inks miss the guaranteed floor.
   * Direct lettering cannot solve that by pretending a different colour sits
   * behind it. Promote only that failing case to a small flat sunk field; the
   * painter detects the changed ground below and draws it. This keeps the
   * authored treatment visually direct in every ordinary case while making
   * the reported ground truthful in the one case that needs a plate.
   */
  return resolveTitleColours(preferred, dark, true);
}

/** Decorative tooling is smaller than title text, but it must not disappear. */
export const COVER_EMBLEM_MIN_CONTRAST = 1.9;

/**
 * Keep one emblem ink while adapting an unsafe reader colour toward the
 * nearest impressed-gold or blind-tooling value.
 *
 * This is not an outline or a lighting pass: the centrepiece still paints in
 * exactly one flat colour. It is the ornamental equivalent of the title
 * resolver above. A pale gold Star on ochre cloth previously fell below one
 * discernible tone at Studio size; darkening that same gold toward the house
 * ink makes it a legible blind-gilt strike without inventing a badge behind it.
 */
export function resolveCoverEmblemInk(preferred: string, ground: string): string {
  const ink = normaliseHex(preferred) ?? FLAT.gilt;
  const face = normaliseHex(ground) ?? FLAT.cream;
  if (colourContrast(ink, face) >= COVER_EMBLEM_MIN_CONTRAST) return ink;

  const candidates = [
    mixHex(ink, FLAT.ink, 0.45),
    mixHex(ink, FLAT.ink, 0.62),
    mixHex(ink, FLAT.cream, 0.5),
    mixHex(ink, FLAT.cream, 0.68),
    FLAT.inkSoft,
    FLAT.cream,
  ];
  return candidates.find((candidate) =>
    colourContrast(candidate, face) >= COVER_EMBLEM_MIN_CONTRAST
  ) ?? candidates.reduce((best, candidate) =>
    colourContrast(candidate, face) > colourContrast(best, face) ? candidate : best
  , ink);
}

/**
 * `#rrggbb` → `hsl(h s% l%)`.
 *
 * The customize panel wants CSS swatches, and `FLAT` is the single source of
 * truth for colour — so convert rather than keeping a parallel table that can
 * drift out of step with the art.
 */
function hexToHsl(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
  }
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%)`;
}

/** CSS color pair for one palette (UI swatches in the customize panel). */
export function coverPaletteCss(palette: number): { top: string; bottom: string } {
  const [face, dark] = clothFor(palette);
  return { top: hexToHsl(face), bottom: hexToHsl(dark) };
}


/* ------------------------------- the hands -------------------------------- */

/**
 * Fifty hands out of five faces.
 *
 * ## Why not fifty fonts
 *
 * The app bundles five (`tokens.css`), and it is going to keep bundling five —
 * every extra face is another webfont on the critical path for a mark that is
 * two words long. So a "hand" here is what it is in `scripts/gen-lettering.mjs`,
 * which solved this same problem for the page: a face plus a stationer's
 * treatment — weight, tracking, case, slope and set size. That is what the
 * names in a binder's specimen book describe anyway. "Widely spaced", "small
 * caps" and "shouting" are treatments, not typefaces.
 *
 * ## The typographic floors are solved here, not trusted to the picker
 *
 * A hand carries a `scale`, and the label already shrinks type to fit its
 * plate, so the two multiply — which is exactly how `gen-lettering.mjs`
 * described putting "footnote hand" at "caption" size under 13px without
 * anybody writing a number below 13 anywhere. `paintLabel` therefore:
 *
 *   - balances a complete title across up to three lines before shrinking it;
 *   - drops a Caveat hand to the body face when the fitted size lands under
 *     `--font-heading`'s documented 20px, which is the same fallback the
 *     generator emits as a block of two-attribute rules; and
 *   - changes to the printed face before an unusually long title goes below
 *     the handwriting floor. Identity text may tighten; it is never truncated.
 *
 * ## Kin
 *
 * The seed-era shared params carry one of three cover-title faces. Every hand
 * declares which seeded face it extends (`COVER_FONT_KIN`), and
 * `deriveCoverParams` rolls only among that face's kin. The two extra faces are
 * kin `-1`: offered to a reader who picks one, never handed out by the seed.
 */

/** The five bundled cover-title faces. 0–2 are seeded; 3–4 are reader-only. */
const FACE_STACKS: readonly string[] = [
  '"Caveat Variable", "Caveat", "Segoe Script", cursive',
  '"Kalam", "Segoe Print", cursive',
  '"Patrick Hand", "Segoe Print", cursive',
  '"Architects Daughter", "Segoe Print", cursive',
  '"Nunito Sans", "Segoe UI", system-ui, sans-serif',
];

/** Caveat's slot, which carries the >= 20px floor all of its own. */
const HEADING_FACE = 0;
/** Where a Caveat hand lands when the plate is too small for Caveat. */
const BODY_FACE = 2;
/** The printed micro-copy face used if a complete title needs a smaller set. */
const PRINTED_FACE = 4;
/** No handwriting below this, in the same unit the label's own floor uses. */
const HAND_FLOOR_PX = 14;
/** `--font-heading` is documented ">= 20px only". */
const HEADING_MIN_PX = 20;

interface HandSpec {
  id: string;
  name: string;
  /** Index into `FACE_STACKS`. */
  face: number;
  /** Set weight. Patrick Hand and Architects Daughter ship one; the browser
   * synthesises the rest, which is what the label has always done at 700. */
  weight: number;
  /** Oblique. Only Caveat and Kalam have a real italic; the rest are slanted. */
  slant: boolean;
  /** `upper` shouts; `small` is uppercase set down a size, which is as close to
   * small caps as a face without an sc axis gets. */
  caps: 'none' | 'upper' | 'small';
  /** Tracking, in ems of the set size. */
  track: number;
  /** Set size relative to what the plate would otherwise give the title. */
  scale: number;
}

const HAND_DEFAULTS: Omit<HandSpec, 'id' | 'name' | 'face'> = {
  weight: 700,
  slant: false,
  caps: 'none',
  track: 0,
  scale: 1,
};

function hand(
  id: string,
  name: string,
  face: number,
  spec: Partial<Omit<HandSpec, 'id' | 'name' | 'face'>> = {},
): HandSpec {
  return { ...HAND_DEFAULTS, ...spec, id, name, face };
}

/**
 * The fifty. **0, 1 and 2 are the originals and must stay where they are** —
 * `titleFont` is index-addressed by every `cover_meta` blob ever saved, and by
 * `bookStyle.TITLE_FONTS`, so reordering the head of this table re-letters
 * books people have already customised.
 */
const HANDS: readonly HandSpec[] = [
  /* --- the three the field has always meant, set exactly as they were --- */
  hand('caveat', 'Caveat', 0),
  hand('kalam', 'Kalam', 1),
  hand('patrick', 'Patrick Hand', 2),

  /* --- Caveat, set as a binder letters a presentation copy (kin 0) --- */
  hand('gilt-script', 'Gilt Script', 0, { scale: 1.1 }),
  hand('flourished', 'Flourished', 0, { slant: true }),
  hand('presentation', 'Presentation', 0, { slant: true, scale: 1.12 }),
  hand('titling', 'Titling', 0, { scale: 1.16, track: 0.02 }),
  hand('dedication', 'Dedication', 0, { weight: 400 }),
  hand('fine-script', 'Fine Script', 0, { weight: 400, slant: true, scale: 1.06 }),
  hand('rubric', 'Rubric', 0, { caps: 'upper', track: 0.07, scale: 0.94 }),
  hand('grand-manner', 'Grand Manner', 0, { scale: 1.28, track: 0.01 }),
  hand('spencerian', 'Spencerian', 0, { slant: true, track: 0.03, scale: 1.08 }),
  hand('vellum-hand', 'Vellum Hand', 0, { weight: 400, scale: 1.2 }),
  hand('scribed-caps', 'Scribed Caps', 0, { caps: 'small', track: 0.08 }),

  /* --- Kalam: the loud face, so the treatments are the loud ones (kin 1) --- */
  hand('light-kalam', 'Light Kalam', 1, { weight: 300 }),
  hand('wide-kalam', 'Wide Kalam', 1, { track: 0.12 }),
  hand('tight-kalam', 'Tight Kalam', 1, { track: -0.02 }),
  hand('marker', 'Marker', 1, { scale: 1.1 }),
  hand('shouted', 'Shouted', 1, { caps: 'upper', track: 0.06 }),
  hand('scrawl', 'Scrawl', 1, { slant: true, track: -0.01 }),
  hand('headline', 'Headline', 1, { scale: 1.24 }),
  hand('sharpie', 'Sharpie', 1, { scale: 1.14, track: 0.01 }),
  hand('crayon', 'Crayon', 1, { scale: 1.08, track: 0.04 }),
  hand('whisper', 'Whisper', 1, { weight: 300, scale: 0.92, track: 0.03 }),
  hand('kalam-caps', 'Kalam Caps', 1, { weight: 300, caps: 'small', track: 0.09 }),

  /* --- Patrick Hand: the quiet face, so the treatments are settings (kin 2) --- */
  hand('plain-set', 'Plain Set', 2, { weight: 400 }),
  hand('wide-set', 'Widely Set', 2, { track: 0.14 }),
  hand('close-set', 'Closely Set', 2, { track: -0.025 }),
  hand('quiet', 'Quiet', 2, { weight: 400, scale: 0.9 }),
  hand('bold-board', 'Bold Board', 2, { scale: 1.12 }),
  hand('slanted', 'Slanted', 2, { slant: true }),
  hand('small-caps', 'Small Caps', 2, { caps: 'small', track: 0.1 }),
  hand('shelf-label', 'Shelf Label', 2, { caps: 'upper', track: 0.08, scale: 0.92 }),
  hand('primer', 'Primer', 2, { scale: 1.06, track: 0.03 }),
  hand('pocket', 'Pocket', 2, { weight: 400, scale: 0.86, track: 0.02 }),
  hand('long-title', 'Long Title', 2, { slant: true, scale: 0.96, track: -0.01 }),

  /* --- Architects Daughter: drawn, upright, and NOT on the spine (kin -1) --- */
  hand('drawn', 'Drawn', 3),
  hand('drawn-wide', 'Drawn Wide', 3, { track: 0.12 }),
  hand('drafting', 'Drafting', 3, { caps: 'upper', track: 0.1, scale: 0.92 }),
  hand('copybook', 'Copybook', 3, { weight: 400, track: 0.04 }),
  hand('chalked', 'Chalked', 3, { scale: 1.08, track: 0.02 }),
  hand('field-note', 'Field Note', 3, { weight: 400, slant: true, scale: 0.94 }),
  hand('ticket', 'Ticket', 3, { caps: 'small', track: 0.09, scale: 0.9 }),

  /* --- Nunito Sans: the stamped trade board, the one printed voice (kin -1) --- */
  hand('printed', 'Printed', 4, { scale: 0.94 }),
  hand('engraved', 'Engraved', 4, { weight: 600, caps: 'upper', track: 0.16, scale: 0.86 }),
  hand('stencil', 'Stencil', 4, { weight: 800, caps: 'upper', track: 0.1, scale: 0.9 }),
  hand('imprint', 'Imprint', 4, { weight: 600, scale: 0.92, track: 0.01 }),
  hand('colophon', 'Colophon', 4, { weight: 600, caps: 'small', track: 0.14, scale: 0.86 }),
  hand('modern', 'Modern', 4, { weight: 400, scale: 0.96 }),
  hand('archive', 'Archive', 4, { weight: 600, caps: 'upper', track: 0.14, scale: 0.84 }),
];

/**
 * The ten manual lettering hands exposed by Book Studio.
 *
 * The fifty-entry table above remains the persistence and seeded-composition
 * vocabulary. A manual picker needs a smaller specimen case in which every
 * adjacent choice visibly changes face, weight, posture or case at true cover
 * size; fifty microscopic tracking variants would merely be fifty names for
 * the same chip. These ten span all five bundled faces and the historically
 * useful stationer's settings without letting a handwriting face fall below
 * its documented size floor.
 */
export const ACTIVE_COVER_HAND_INDICES = [
  0, 1, 2, 9, 18, 31, 36, 38, 43, 44,
] as const;

export type ActiveCoverHandIndex = (typeof ACTIVE_COVER_HAND_INDICES)[number];

export const ACTIVE_COVER_HANDS: readonly {
  readonly index: ActiveCoverHandIndex;
  readonly id: string;
  readonly label: string;
}[] = ACTIVE_COVER_HAND_INDICES.map((index) => ({
  index,
  id: HANDS[index]!.id,
  label: HANDS[index]!.name,
}));

const ACTIVE_COVER_HAND_SET: ReadonlySet<number> = new Set(ACTIVE_COVER_HAND_INDICES);

/** Fold any historical hand into the closest live specimen by actual setting. */
export function normalizeCoverHandIndex(value: unknown): ActiveCoverHandIndex {
  const index = typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : 0;
  if (ACTIVE_COVER_HAND_SET.has(index)) return index as ActiveCoverHandIndex;
  const spec = HANDS[index];
  if (!spec) return 0;
  if (spec.face === 0) {
    if (spec.caps !== 'none') return 9;
    return 0;
  }
  if (spec.face === 1) return spec.caps !== 'none' ? 18 : 1;
  if (spec.face === 2) return spec.caps !== 'none' ? 31 : 2;
  if (spec.face === 3) return spec.caps !== 'none' ? 38 : 36;
  return spec.caps !== 'none' ? 44 : 43;
}

/** Display names for the studio's title-hand picker. */
export const COVER_FONTS: readonly string[] = HANDS.map((f) => f.name);

/**
 * How many hands a title can be lettered in. DERIVED, never restated — the
 * mistake `COVER_PALETTE_COUNT`'s note describes, made once already in this
 * file, is a count that sat at 20 while its table grew to 50.
 */
export const COVER_FONT_COUNT = COVER_FONTS.length;

/**
 * Which of the seed-era three cover faces each hand extends, or `-1` for the
 * two reader-only faces that have no seed index.
 *
 * Index-aligned with `COVER_FONTS`. `deriveCoverParams` rolls only inside the
 * kin selected by the legacy shared `SpineParams.font` field.
 */
export const COVER_FONT_KIN: readonly number[] = HANDS.map((f) =>
  f.face <= BODY_FACE ? f.face : -1,
);

/** Hands grouped by kin, built once — `deriveCoverParams` runs per book. */
const KIN_HANDS: readonly (readonly number[])[] = [0, 1, 2].map((face) =>
  HANDS.map((_, i) => i).filter((i) => COVER_FONT_KIN[i] === face),
);

/**
 * One cover hand for a seed-era compatibility face, rolled from the book's seed.
 *
 * The shared `font` field is 0–2 and always will be; this is the widening. The
 * roll is on its own stream so that adding a hand re-letters some boards and
 * moves nothing else about a book, and an unknown face falls back to the plain
 * setting of face 0 rather than throwing — `deriveCoverParams` is total.
 */
export function handForFace(face: number, seed: number): number {
  const kin = KIN_HANDS[Math.trunc(face)] ?? KIN_HANDS[0]!;
  if (kin.length === 0) return 0;
  const roll = mulberry32((seed ^ 0x1e77e2ed) >>> 0)();
  return kin[Math.min(kin.length - 1, Math.floor(roll * kin.length))]!;
}

/** The hand a `titleFont` index means. Total: junk lands on plain Caveat. */
function handFor(index: number): HandSpec {
  const i = Math.trunc(index);
  return HANDS[i >= 0 && i < HANDS.length ? i : 0]!;
}

/**
 * Has the face this hand is set in actually arrived yet?
 *
 * Canvas does not trigger a webfont load — `ctx.font` with a face the document
 * has never used silently falls back and draws in the generic. That has always
 * been true here, and it stopped being harmless the day a hand could ask for a
 * face nothing else on screen is using: `coverDataUrl` MEMOIZES the PNG, so one
 * bake that lost the race gets served for the rest of the session. The bake
 * itself is fine to do — a fallback title is better than no cover — so the
 * answer is to refuse to CACHE it and let the next call re-bake.
 *
 * Fail-safe in the direction of caching: anything unexpected (no `document`, a
 * throw out of `check`) is treated as ready, because the cost of being wrong
 * that way is a stale face for one session and the cost of being wrong the
 * other way is never caching a cover again.
 */
function handLoaded(index: number, px: number): boolean {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts === undefined || typeof fonts.check !== 'function') return true;
  const h = handFor(index);
  try {
    const slope = h.slant ? 'italic ' : '';
    return fonts.check(`${slope}${h.weight} ${Math.max(10, Math.round(px))}px ${FACE_STACKS[h.face]}`);
  } catch {
    return true;
  }
}

/* ------------------------------- geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/** Trace a run of points as a path. Nothing is filled or stroked here. */
function tracePoly(ctx: FlatCtx, pts: readonly Pt[], close = true): void {
  const first = pts[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    ctx.lineTo(p.x, p.y);
  }
  if (close) ctx.closePath();
}

function polyPts(cx: number, cy: number, r: number, n: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function starPts(cx: number, cy: number, outer: number, inner: number, spikes: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** A filled dot. The frame's corner marks and every ornament centre. */
function dot(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.6, r), 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** Set up the pen for an ornament run: one colour, one weight, round ends. */
function pen(ctx: FlatCtx, colour: string, width: number): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(0.8, width);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------ the covering ------------------------------ */

/**
 * The fifty coverings, struck on a BOARD instead of a strip.
 *
 * `COVER_TEXTURES` is `bookDesign.MATERIAL_LOOKS` — the same fifty the spine
 * wears — and until this existed that derivation only reached the board's
 * COLOUR, through `MaterialSpec.body`. Fifty names folding onto six tones is a
 * count, not a vocabulary, and a shelf-full of books whose spines were pebbled,
 * ribbed, watered and laid all pulled out into the same plain rectangle.
 *
 * So the board reads the rest of the spec: `split` (where a second covering
 * sits), `grain` (the one mark the covering carries) and `joints`. The
 * arrangement is the spine's, re-proportioned — NOT the spine's code reused.
 * A spine is a 25px strip where a grain has room for six marks before it turns
 * grey, and `bookDesign` sizes every mark for that; a board is the widest thing
 * in the app and the same numbers there would draw six lines across a hand's
 * width of cloth. Same vocabulary, same tones, same names, own scale.
 *
 * Everything here is flat: filled marks and single-weight strokes in colours
 * mixed from the board's own two, drawn under the frame and the label. There is
 * no light in it — a nap is a darker flat band along the fore edge, not a
 * sheen, which is the same trick the spine's `nap` plays and the same one the
 * icon plays with its spine strip.
 */

/** The colour a covering's grain is struck in — the spine's own switch. */
function grainInk(
  spec: MaterialSpec,
  face: string,
  dark: string,
  accent: string,
  gilded: boolean,
  pale: boolean,
): string {
  // A pale board is cream, so every pale tone on it is invisible: `pale` and
  // `cream` marks are folded to the timber the half binding already uses. The
  // frame does the same thing one screen down (`frameInk`), for the same
  // reason — a mark nobody can see is worse than no mark, because the reader
  // is told the covering changed and sees nothing.
  const paled = pale ? mixHex(FLAT.cream, FLAT.timber, 0.55) : mixHex(face, FLAT.cream, 0.42);
  switch (spec.grainTone) {
    case 'deeper':
      return mixHex(dark, FLAT.ink, 0.32);
    case 'pale':
      return paled;
    case 'cream':
      return pale ? mixHex(FLAT.cream, FLAT.timber, 0.4) : FLAT.cream;
    case 'ink':
      return FLAT.inkSoft;
    case 'accent':
      return accent;
    case 'foil':
      // Without leaf a gilt grain is not gold, it is blind tooling: the board's
      // own darker value. Never a highlight.
      return gilded ? FLAT.gilt : mixHex(dark, FLAT.ink, 0.16);
    default:
      return mixHex(dark, FLAT.ink, 0.16);
  }
}

/**
 * The second covering, where a binding has two.
 *
 * On a spine a split is a band across the strip. On a board it is the shape a
 * reader actually recognises a half binding by — leather down the hinge and
 * out over the corners, boards in between — so each name is drawn as the
 * region it names, in the board's darker value with one ink line where the two
 * coverings meet. That line is the whole point: without it the darker region
 * reads as a shadow, and a shadow is the one thing this app does not draw.
 */
function paintSplit(
  ctx: FlatCtx,
  spec: MaterialSpec,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  dark: string,
  ink: number,
  seed: number,
): void {
  if (spec.split === 'none') return;
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const line = Math.max(0.9, ink * 0.55);

  /** A band of the second covering butted against the hinge. */
  const hinge = (frac: number): void => {
    const bandW = faceW * frac;
    ctx.fillStyle = dark;
    ctx.fillRect(faceX, by, bandW, bh);
    stroke(ctx, faceX + bandW, by, faceX + bandW, by + bh, FLAT.ink, line, seed + 1);
  };

  switch (spec.split) {
    case 'quarter':
      hinge(0.1);
      return;
    case 'half':
      hinge(0.26);
      return;
    case 'threeQuarter':
      hinge(0.52);
      return;
    case 'headBand': {
      // A cap over the head of the board — the one split that runs the other
      // way, and the reason `split` is not just a width.
      const capH = bh * 0.16;
      ctx.fillStyle = dark;
      ctx.fillRect(faceX, by, faceW, capH);
      stroke(ctx, faceX, by + capH, bx + bw, by + capH, FLAT.ink, line, seed + 2);
      return;
    }
    default: {
      // tips: leather corners only, cut on the diagonal, which is exactly what
      // a tipped binding looks like from across a room.
      const t = Math.min(faceW, bh) * 0.34;
      for (const [cx, cy, sx, sy] of [
        [faceX, by, 1, 1],
        [bx + bw, by, -1, 1],
        [bx + bw, by + bh, -1, -1],
        [faceX, by + bh, 1, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + sy * t);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + sx * t, cy);
        ctx.closePath();
        ctx.fillStyle = dark;
        ctx.fill();
        stroke(ctx, cx, cy + sy * t, cx + sx * t, cy, FLAT.ink, line, seed + 3);
      }
    }
  }
}

/**
 * The one grain the covering carries, laid over the board's face.
 *
 * Clipped to the face so a mark cannot cross the hinge or leak past the
 * outline — a grain struck over the joint reads as a printing fault, which is
 * the note `bookDesign` leaves about the same problem on the strip.
 */
function paintGrain(
  ctx: FlatCtx,
  spec: MaterialSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  seed: number,
): void {
  if (spec.grain === 'none') return;
  const rnd = mulberry32((seed ^ 0x9e37) >>> 0);
  // The spine's count is read for a strip six marks wide. A board is roughly
  // five times the width and one and a half times the height of one, so the
  // count is stretched rather than reused: a "sprinkle" of 26 that covered a
  // spine leaves a board almost bare.
  const n = Math.max(2, Math.round(spec.grainCount));
  const unit = Math.min(w, h);
  const fine = Math.max(0.9, unit * 0.006);
  const bold = Math.max(1.1, unit * 0.011);

  const hLine = (t: number, a: number, b: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t, x + w * b, y + h * t, colour, weight, seed + 200 + k);
  const vLine = (a: number, t0: number, t1: number, weight: number, k: number): void =>
    stroke(ctx, x + w * a, y + h * t0, x + w * a, y + h * t1, colour, weight, seed + 260 + k);
  const mark = (cx: number, cy: number, r: number): void => dot(ctx, cx, cy, r, colour);

  /** A stratified field: one mark per cell of a rows × cols lattice. */
  const field = (
    rows: number,
    cols: number,
    draw: (cx: number, cy: number, i: number) => void,
  ): void => {
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        // Half-drop, the way a binder's roll actually repeats, plus a jitter
        // inside the cell so the lattice never reads as graph paper.
        const off = r % 2 === 0 ? 0 : 0.5;
        const cx = x + w * (((c + off + 0.5) % cols) / cols + (rnd() - 0.5) * 0.03);
        const cy = y + h * ((r + 0.5) / rows + (rnd() - 0.5) * 0.02);
        draw(cx, cy, i);
      }
    }
  };

  /** A column of wave, drawn as one path — the moiré / comb family. */
  const wave = (cx: number, amp: number, cycles: number, k: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx, y);
    const steps = Math.max(4, Math.round(cycles * 2));
    for (let i = 0; i < steps; i++) {
      const y0 = y + (h * i) / steps;
      const y1 = y + (h * (i + 1)) / steps;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.quadraticCurveTo(cx + amp * dir, (y0 + y1) / 2, cx, y1);
    }
    pen(ctx, colour, fine);
    ctx.stroke();
    void k;
  };

  /** A small filled lozenge — the tooling motif half the paper family uses. */
  const lozenge = (cx: number, cy: number, r: number): void => {
    tracePoly(ctx, [
      { x: cx, y: cy - r },
      { x: cx + r * 0.62, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r * 0.62, y: cy },
    ]);
    ctx.fillStyle = colour;
    ctx.fill();
  };

  switch (spec.grain) {
    /* ---- woven cloth: rules across, sometimes rules down ---- */
    case 'ribs':
      // Rep is a field of weft ribs, not ruled paper. Break each course into
      // staggered floats so the eye reads woven continuity without seeing a
      // ruler dragged from one board edge to the other.
      for (let i = 1; i < n * 2; i++) {
        const t = i / (n * 2);
        for (let c = 0; c < 3; c++) {
          const stagger = i % 2 === 0 ? 0 : 0.035;
          const a = Math.max(0, c / 3 + 0.025 + stagger);
          const b = Math.min(1, (c + 1) / 3 - 0.045 + stagger);
          if (b > a) hLine(t, a, b, fine * 0.72, i * 4 + c);
        }
      }
      break;
    case 'weave':
      // Linen is an over-under field of short floats. Full horizontal and
      // vertical rules made the cover look like graph paper.
      field(Math.max(7, n + 2), 6, (cx, cy, i) => {
        const dx = unit * 0.024;
        const dy = unit * 0.014;
        if (i % 2 === 0) {
          stroke(ctx, cx - dx, cy, cx + dx, cy, colour, fine * 0.72, seed + 240 + i);
        } else {
          stroke(ctx, cx, cy - dy, cx, cy + dy, colour, fine * 0.72, seed + 240 + i);
        }
      });
      break;
    case 'twill':
      // A cover is wide enough that full-width diagonals read as notebook
      // ruling, not canvas. Twill is made of many short staggered floats: each
      // mark leans the same way, but none crosses the whole board. This keeps
      // the surface visibly woven without turning it into a striped object.
      field(Math.max(7, n), 7, (cx, cy, i) => {
        const len = unit * (0.032 + (i % 3) * 0.004);
        stroke(
          ctx,
          cx - len * 0.55,
          cy + len * 0.34,
          cx + len * 0.55,
          cy - len * 0.34,
          colour,
          fine * 0.82,
          seed + 300 + i,
        );
      });
      break;
    case 'coarse':
      for (let i = 0; i < n * 2; i++) {
        hLine(0.03 + (i * 0.94) / (n * 2), rnd() * 0.08, 1 - rnd() * 0.1, bold, i);
      }
      break;
    case 'stitchRun':
      // Sailcloth is seamed in long panels. Twelve horizontal dashed rows
      // looked like a ruled exercise book; three vertical seams, each made of
      // discrete running stitches, read as construction at cover scale.
      for (let seam = 0; seam < 3; seam++) {
        const a = 0.2 + seam * 0.3;
        for (let d = 0; d < Math.max(9, Math.round(n * 0.9)); d++) {
          const t0 = 0.035 + (d * 0.91) / Math.max(9, Math.round(n * 0.9));
          vLine(a, t0, t0 + 0.045, fine, seam * 20 + d);
        }
      }
      break;
    case 'fleck':
      field(Math.ceil(n / 3) + 2, 4, (cx, cy, i) => {
        hLine((cy - y) / h, (cx - x) / w, (cx - x) / w + 0.07, fine, i);
      });
      break;
    // Three soft coverings, three different pieces of evidence. Keeping them
    // as one fore-edge band made Felt, Velvet and Suede three labels for the
    // same picture — exactly the vocabulary collapse the binding rewrite was
    // meant to remove.
    case 'napEdge': {
      // Felt shows a cut, slightly tufted fore edge. The small bites are flat
      // geometry, not fuzz or a blurred texture. Keep it a narrow cut edge;
      // the old fourteen-percent slab looked like a second covering.
      ctx.fillStyle = colour;
      ctx.fillRect(x + w * 0.92, y, w * 0.08, h);
      for (let i = 0; i < Math.max(9, n * 4); i++) {
        const cy = y + h * ((i + 0.5) / Math.max(9, n * 4));
        const tooth = unit * (i % 2 === 0 ? 0.018 : 0.012);
        stroke(ctx, x + w * 0.905, cy, x + w * 0.92 + tooth, cy, colour, bold * 0.8, seed + 410 + i);
      }
      break;
    }
    case 'pile':
      // Velvet remains one continuous deep face. A few paired, slightly bowed
      // pile turns distinguish it from plain cloth without simulating sheen or
      // adding the giant contrast strip that read as a second cover.
      for (let i = 0; i < Math.max(5, n * 2); i++) {
        const cy = y + h * (0.1 + ((i + 0.35 + rnd() * 0.3) * 0.8) / Math.max(5, n * 2));
        const cx = x + w * (0.12 + rnd() * 0.64);
        const len = w * (0.08 + rnd() * 0.08);
        stroke(ctx, cx, cy, cx + len, cy + h * 0.004, colour, fine * 0.75, seed + 430 + i * 2);
        stroke(ctx, cx + len * 0.12, cy + unit * 0.012, cx + len * 0.72, cy + unit * 0.014, mixHex(colour, FLAT.ink, 0.18), fine * 0.62, seed + 431 + i * 2);
      }
      break;
    case 'brushed':
      // Suede is the flesh side brushed in several directions. Short sparse
      // strokes survive at preview size without forming a stripe or a grid.
      field(Math.max(5, n + 2), 5, (cx, cy, i) => {
        const len = unit * (0.018 + rnd() * 0.018);
        const a = -0.9 + rnd() * 1.8;
        stroke(
          ctx,
          cx - Math.cos(a) * len,
          cy - Math.sin(a) * len,
          cx + Math.cos(a) * len,
          cy + Math.sin(a) * len,
          colour,
          fine * 0.78,
          seed + 450 + i,
        );
      });
      break;

    /* ---- silk: waves and figures ---- */
    case 'watered':
      // Legacy only: shallow contour pairs, not a wall of liquid-looking
      // vertical waves. The material remains renderable for saved books.
      for (let i = 0; i < Math.max(3, n); i++) {
        const t = 0.16 + (i * 0.68) / Math.max(1, Math.max(3, n) - 1);
        const x0 = x + w * (0.1 + rnd() * 0.08);
        const x1 = x + w * (0.82 + rnd() * 0.08);
        ctx.beginPath();
        ctx.moveTo(x0, y + h * t);
        ctx.quadraticCurveTo(x + w * (0.42 + rnd() * 0.16), y + h * (t - 0.02), x1, y + h * (t + 0.006));
        pen(ctx, colour, fine * 0.72);
        ctx.stroke();
      }
      break;
    case 'figured':
      field(n, 4, (cx, cy) => {
        pen(ctx, colour, fine);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.035, 0.6, Math.PI * 1.5);
        ctx.stroke();
        mark(cx, cy, fine * 0.9);
      });
      break;
    case 'damask':
      field(n, 3, (cx, cy) => {
        for (const a of [0, 1, 2, 3]) {
          const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
          lozenge(cx + Math.cos(ang) * unit * 0.03, cy + Math.sin(ang) * unit * 0.03, unit * 0.018);
        }
      });
      break;

    /* ---- leather and skin: worked contours, veins, plates ---- */
    case 'pebble': {
      /**
       * Morocco stays a CLEAN dyed face at cover scale.
       *
       * The first painter enlarged the spine's pebble into a field of filled
       * discs; that looked like a rash. Replacing each disc with a broken oval
       * merely changed the rash into rows of horseshoes. Both versions made a
       * material treatment read as wallpaper, and both contradicted the flat
       * vocabulary: this app identifies leather through the rounded back,
       * recessed joint, turned board edges and its tooling, not by simulating
       * the skin. A quiet face also gives a binder's authored composition room
       * to be the ornament instead of competing with all-over noise.
       */
      break;
    }
    case 'pinDot':
      field(Math.ceil(n / 2) + 2, 6, (cx, cy) => mark(cx, cy, unit * 0.006));
      break;
    case 'sprinkle':
      field(Math.ceil(n / 3) + 4, 8, (cx, cy) => mark(cx, cy, unit * 0.008 * (0.5 + rnd())));
      break;
    case 'mottle':
      field(n, 3, (cx, cy, i) => {
        const r = unit * (0.03 + rnd() * 0.025);
        tracePoly(
          ctx,
          polyPts(cx, cy, r, 9, i).map((p, k) => ({
            x: p.x + Math.cos(k * 2.4) * r * 0.22,
            y: p.y + Math.sin(k * 1.7) * r * 0.22,
          })),
        );
        ctx.fillStyle = colour;
        ctx.fill();
      });
      break;
    case 'panelled':
      // Blind panels ruled inside one another — the calf binder's whole idea of
      // ornament, and the reason this material's count is 1.
      for (let i = 0; i < n + 1; i++) {
        const g = 0.06 + i * 0.07;
        if (g > 0.4) break;
        pen(ctx, colour, fine);
        wobbleRect(ctx, x + w * g, y + h * g * 0.62, w * (1 - g * 2), h * (1 - g * 1.24), unit * 0.02, seed + i);
        ctx.stroke();
      }
      break;
    case 'flame':
      for (let i = 0; i < n * 2; i++) wave(x + (w * (i + 0.5)) / (n * 2), w * 0.045, 3, i);
      break;
    case 'scales':
      field(n + 2, 6, (cx, cy) => {
        pen(ctx, colour, fine);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.028, Math.PI * 0.05, Math.PI * 0.95);
        ctx.stroke();
      });
      break;
    case 'shagreen':
      field(n + 3, 8, (cx, cy) => {
        pen(ctx, colour, fine * 0.8);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.014, 0, Math.PI * 2);
        ctx.stroke();
      });
      break;
    case 'plates':
      for (let i = 1; i < n; i++) hLine(i / n, 0, 1, fine * 0.8, i);
      for (let i = 1; i < 5; i++) vLine(i / 5, 0, 1, fine * 0.8, i + 50);
      field(n, 5, (cx, cy) => mark(cx, cy, unit * 0.007));
      break;
    case 'creases':
      // Cockling begins at handled edges. Long rules across the face made
      // parchment look cut into strips, so these are short, shallow bows that
      // alternate between the joint and fore edge and die out in the board.
      for (let i = 0; i < Math.max(5, n * 2); i++) {
        const fromJoint = i % 2 === 0;
        const cy = y + h * (0.1 + (i * 0.8) / Math.max(1, Math.max(5, n * 2) - 1));
        const len = w * (0.12 + rnd() * 0.13);
        const x0 = fromJoint ? x + w * 0.025 : x + w * 0.975;
        const x1 = fromJoint ? x0 + len : x0 - len;
        ctx.beginPath();
        ctx.moveTo(x0, cy);
        ctx.quadraticCurveTo((x0 + x1) / 2, cy + (i % 3 - 1) * h * 0.012, x1, cy + h * 0.007);
        pen(ctx, colour, fine * 0.82);
        ctx.stroke();
      }
      break;
    case 'scuffs':
      for (let i = 0; i < n * 2; i++) {
        const cx = x + w * (0.08 + rnd() * 0.84);
        const cy = y + h * (0.06 + rnd() * 0.88);
        const len = unit * (0.05 + rnd() * 0.06);
        stroke(ctx, cx, cy, cx + len, cy - len * 0.4, colour, fine, seed + 340 + i);
      }
      break;

    /* ---- marbled and decorated papers ---- */
    case 'combedVeins':
      // Broad, nearly parallel ribbons of pigment with a pale comb echo. The
      // old sparse diagonal veins read as scratches; these cross most of the
      // sheet and bend together, which is the visual fact of combed marbling.
      for (let i = 0; i < Math.max(6, n + 3); i++) {
        const rows = Math.max(6, n + 3);
        const t0 = 0.065 + (i * 0.84) / Math.max(1, rows - 1);
        const direction = i % 2 === 0 ? 1 : -1;
        const a0 = 0.025;
        const a1 = 0.975;
        const midY = t0 + direction * (0.025 + rnd() * 0.018);
        const endY = t0 - direction * (0.012 + rnd() * 0.018);
        ctx.beginPath();
        ctx.moveTo(x + w * a0, y + h * t0);
        ctx.quadraticCurveTo(x + w * 0.24, y + h * (midY - direction * 0.01), x + w * 0.5, y + h * midY);
        ctx.quadraticCurveTo(x + w * 0.76, y + h * (midY + direction * 0.012), x + w * a1, y + h * endY);
        pen(ctx, colour, bold * 0.82);
        ctx.stroke();

        const echo = mixHex(colour, FLAT.cream, 0.3);
        ctx.beginPath();
        ctx.moveTo(x + w * a0, y + h * (t0 + 0.012));
        ctx.quadraticCurveTo(x + w * 0.28, y + h * (midY + 0.008), x + w * 0.52, y + h * (midY + 0.012));
        ctx.quadraticCurveTo(x + w * 0.78, y + h * (midY + direction * 0.018), x + w * a1, y + h * (endY + 0.012));
        pen(ctx, echo, fine * 0.7);
        ctx.stroke();

        // Every other ribbon carries one short fork where the comb split it.
        if (i % 2 === 0) {
          const forkX = 0.32 + rnd() * 0.34;
          stroke(
            ctx,
            x + w * forkX,
            y + h * midY,
            x + w * (forkX + 0.09),
            y + h * (midY - direction * 0.035),
            colour,
            fine * 0.68,
            seed + 680 + i,
          );
        }
      }
      break;
    case 'spanishWave':
      for (let i = 0; i < n * 2; i++) {
        const t = (i + 0.5) / (n * 2);
        ctx.beginPath();
        ctx.moveTo(x, y + h * t);
        for (let k = 0; k < 8; k++) {
          const x0 = x + (w * k) / 8;
          const x1 = x + (w * (k + 1)) / 8;
          ctx.quadraticCurveTo((x0 + x1) / 2, y + h * (t + (k % 2 === 0 ? 0.02 : -0.02)), x1, y + h * t);
        }
        pen(ctx, colour, fine);
        ctx.stroke();
      }
      break;
    case 'stoneVein':
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        let px = x + w * rnd();
        let py = y;
        ctx.moveTo(px, py);
        for (let k = 0; k < 6; k++) {
          const nx = px + (rnd() - 0.5) * w * 0.3;
          const ny = py + h / 6;
          ctx.quadraticCurveTo(px, (py + ny) / 2, nx, ny);
          px = nx;
          py = ny;
        }
        pen(ctx, colour, fine);
        ctx.stroke();
      }
      break;
    case 'shellSpots':
      field(n, 4, (cx, cy) => {
        pen(ctx, colour, fine * 0.9);
        ctx.beginPath();
        ctx.arc(cx, cy, unit * 0.03, 0, Math.PI * 2);
        ctx.stroke();
        mark(cx, cy, unit * 0.008);
      });
      break;
    case 'pasteComb': {
      // Paste paper is worked in LOCAL comb pulls. A half-drop field of small
      // three-tooth fans reads handmade and intricate; four board-wide waves
      // looked like placeholder underlines.
      const rows = Math.max(5, n + 1);
      const cols = 3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const halfDrop = row % 2 === 0 ? 0 : 0.5;
          const cx = x + w * (((col + halfDrop + 0.5) % cols) / cols);
          const cy = y + h * ((row + 0.5) / rows);
          const span = w * (0.18 + ((row + col) % 2) * 0.025);
          const bow = (row + col) % 2 === 0 ? 1 : -1;
          for (let tooth = 0; tooth < 3; tooth++) {
            const oy = (tooth - 1) * unit * 0.014;
            const left = cx - span / 2;
            const right = cx + span / 2;
            const lift = bow * unit * (0.024 + tooth * 0.004);
            ctx.beginPath();
            ctx.moveTo(left, cy + oy);
            ctx.quadraticCurveTo(cx, cy + oy + lift, right, cy + oy);
            pen(ctx, colour, tooth === 1 ? fine * 0.68 : fine * 0.88);
            ctx.stroke();
          }
          // A tiny heel at the pull's starting edge shows the comb was lifted,
          // rather than turning the motif into a printed scallop.
          stroke(ctx, cx - span / 2, cy - unit * 0.012, cx - span / 2, cy + unit * 0.012, colour, fine * 0.62, seed + 740 + row * cols + col);
        }
      }
      break;
    }
    case 'lozenges':
      field(n, 4, (cx, cy) => lozenge(cx, cy, unit * 0.026));
      break;
    case 'sprigs':
      // A small two-leaf printer's block. The half-drop field keeps the paper
      // lively while the generous air between motifs preserves a quiet board.
      field(Math.max(4, n), 4, (cx, cy, i) => {
        const s = unit * 0.022;
        stroke(ctx, cx, cy + s * 0.9, cx, cy - s * 0.8, colour, fine * 0.78, seed + 520 + i);
        for (const side of [-1, 1] as const) {
          ctx.beginPath();
          ctx.moveTo(cx, cy - s * 0.04);
          ctx.quadraticCurveTo(cx + side * s * 0.95, cy - s * 0.68, cx + side * s * 0.74, cy + s * 0.14);
          ctx.quadraticCurveTo(cx + side * s * 0.34, cy + s * 0.3, cx, cy - s * 0.04);
          ctx.fillStyle = colour;
          ctx.fill();
        }
      });
      break;
    case 'floret':
      field(n, 4, (cx, cy) => {
        for (let p = 0; p < 5; p++) {
          const a = -Math.PI / 2 + (p / 5) * Math.PI * 2;
          mark(cx + Math.cos(a) * unit * 0.018, cy + Math.sin(a) * unit * 0.018, unit * 0.007);
        }
        mark(cx, cy, unit * 0.006);
      });
      break;
    case 'fibres':
      for (let i = 0; i < n * 2; i++) {
        const cx = x + w * (0.04 + rnd() * 0.92);
        const cy = y + h * (0.04 + rnd() * 0.92);
        const len = unit * (0.03 + rnd() * 0.04);
        const a = rnd() * Math.PI;
        stroke(ctx, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, colour, fine * 0.8, seed + 360 + i);
      }
      break;
    case 'laidLines':
      // Laid paper: fine chain lines one way, a few heavier ones the other.
      for (let i = 1; i < n * 6; i++) vLine(i / (n * 6), 0, 1, fine * 0.7, i);
      for (let i = 1; i < 5; i++) hLine(i / 5, 0, 1, bold * 0.8, i + 60);
      break;
    case 'giltDots':
      field(n, 5, (cx, cy) => mark(cx, cy, unit * 0.012));
      break;
    case 'stripes':
      // `grainCount` already says three broad stripes. Multiplying it by three
      // produced nine bars covering more than a third of the board — a circus
      // awning rather than a patterned paper. Honour the authored count.
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        ctx.fillStyle = colour;
        ctx.fillRect(x + w * (t - 0.027), y, w * 0.054, h);
      }
      break;
    case 'chequer': {
      const cells = Math.max(3, Math.round(n / 2));
      const cw = w / cells;
      const ch = h / Math.round(cells * 1.4);
      ctx.fillStyle = colour;
      for (let r = 0; r * ch < h; r++) {
        for (let c = 0; c < cells; c++) {
          if ((r + c) % 2 === 0) continue;
          ctx.fillRect(x + c * cw, y + r * ch, cw, Math.min(ch, y + h - (y + r * ch)));
        }
      }
      break;
    }
    case 'wrapperRules':
      // A printed wrapper: two heavy rules boxing the board, nothing else.
      for (let i = 0; i < Math.max(2, n); i++) {
        const g = 0.05 + i * 0.035;
        pen(ctx, colour, bold);
        wobbleRect(ctx, x + w * g, y + h * g * 0.7, w * (1 - g * 2), h * (1 - g * 1.4), unit * 0.01, seed + i);
        ctx.stroke();
      }
      break;
    case 'newsRules':
      for (let i = 1; i < n * 2; i++) hLine(i / (n * 2), 0.04, 0.96, fine * 0.7, i);
      vLine(0.5, 0.04, 0.96, fine * 0.7, 99);
      break;
  }
}

/**
 * Everything a covering says about a board, in one call.
 *
 * Clipped to the board and confined to the FACE — the spine strip is the
 * board turning away from us and carries the icon's gilt bands, so a grain run
 * over it would be a mark on a surface the reader is meant to read as an edge.
 */
function paintCovering(
  ctx: FlatCtx,
  spec: MaterialSpec,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  radius: number,
  face: string,
  dark: string,
  accent: string,
  ink: number,
  gilded: boolean,
  pale: boolean,
  wear: number,
  seed: number,
): void {
  // The spine drops a covering's fine work below `floor` px of strip, because
  // under that the marks land on less than a pixel and read as dirt. The board
  // has the same rule against its own width: `floor` is written for a strip of
  // 8–20px, and a board is about four of those across. A thoroughly worn book
  // loses the grain for the reason it loses its gilt — it has been rubbed off.
  if (bw < spec.floor * 4 || wear >= 0.78) return;

  ctx.save();
  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.clip();

  paintSplit(ctx, spec, bx, by, bw, bh, spineW, dark, ink, seed + 3);

  const faceX = bx + spineW;
  const faceW = bw - spineW;
  // Inset a hair from the hinge and the fore edge so a round cap cannot land
  // on either outline.
  const gx = faceX + faceW * 0.03;
  const gw = faceW * 0.94;
  const gy = by + bh * 0.02;
  const gh = bh * 0.96;
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, gy, gw, gh);
  ctx.clip();
  paintGrain(
    ctx,
    spec,
    gx,
    gy,
    gw,
    gh,
    grainInk(spec, face, dark, accent, gilded, pale),
    seed + 71,
  );
  ctx.restore();

  // The joints: fine ink lines down the hinge, and on a two-joint binding down
  // the fore edge as well, which is what makes a back read as rounded.
  if (spec.joints > 0) {
    const line = Math.max(0.8, ink * 0.4);
    stroke(ctx, faceX + faceW * 0.035, by + bh * 0.03, faceX + faceW * 0.035, by + bh * 0.97, FLAT.ink, line, seed + 81);
    if (spec.joints > 1) {
      stroke(ctx, bx + bw * 0.965, by + bh * 0.03, bx + bw * 0.965, by + bh * 0.97, FLAT.ink, line, seed + 82);
    }
  }

  ctx.restore();
}

/* ------------------------------ render pieces ----------------------------- */

/**
 * The sliver of text block showing past the fore-edge.
 *
 * The icon puts the page block *behind* the cover and lets it peek out, and
 * that one overlap is most of why a flat rectangle reads as a book rather than
 * a card. It is drawn first so the board can sit in front of it.
 */
function paintTextBlock(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  edge: EdgeTreatment,
  seed: number,
): void {
  const finish = normalizeEdgeTreatment(edge);
  const ground = finish === 'gilt'
    ? FLAT.gilt
    : finish === 'stained-red'
      ? FLAT.terracotta
      : finish === 'sepia-edge'
        ? FLAT.timber
        : finish === 'red-under-gold'
          ? FLAT.terracottaDark
          : finish === 'deckle'
            ? FLAT.creamDeep
            : FLAT.cream;
  panel(ctx, x, y, w, h, ground, {
    radius: w * 0.4,
    seed,
    width: Math.max(1, inkWidth(w) * 0.9),
  });

  // The icon draws the leaves as three pale curves down the block; only the
  // outer half of this strip is ever visible, so the lines live out there.
  const rule = Math.max(0.8, w * 0.1);
  const ruleInk = finish === 'gilt'
    ? FLAT.ochreDark
    : finish === 'stained-red'
      ? FLAT.terracottaDark
      : finish === 'sepia-edge'
        ? FLAT.timberDark
        : finish === 'red-under-gold'
          ? FLAT.giltPale
          : FLAT.creamDeep;
  for (const t of [0.58, 0.8]) {
    stroke(ctx, x + w * t, y + h * 0.05, x + w * t, y + h * 0.95, ruleInk, rule, seed + t * 10);
  }

  if (finish === 'red-under-gold') {
    // Burnished gold laid over a crimson bole. The narrow exposed strip keeps
    // both materials legible: a broad gold face and one deliberate red reveal.
    ctx.save();
    wobbleRect(ctx, x, y, w, h, w * 0.4, seed);
    ctx.clip();
    ctx.fillStyle = FLAT.gilt;
    ctx.fillRect(x + w * 0.8, y, w * 0.26, h);
    stroke(ctx, x + w * 0.77, y + h * 0.04, x + w * 0.77, y + h * 0.96, FLAT.giltPale, Math.max(0.8, w * 0.11), seed + 21);
    ctx.restore();
  }

  if (finish === 'deckle') {
    // Six broad irregular cuts on the visible edge. These are separated
    // fibres in the physical silhouette, not speckles scattered over paper.
    ctx.save();
    wobbleRect(ctx, x, y, w, h, w * 0.4, seed);
    ctx.clip();
    for (let i = 0; i < 6; i += 1) {
      const cy = y + h * ((i + 0.5) / 6);
      const bite = w * (i % 2 === 0 ? 0.34 : 0.22);
      stroke(
        ctx,
        x + w,
        cy - h * 0.012,
        x + w - bite,
        cy + h * 0.014,
        FLAT.inkSoft,
        Math.max(0.8, w * 0.13),
        seed + 31 + i,
      );
    }
    ctx.restore();
  }
}

/**
 * The board before it is decorated: recessed joint, turned/folded covering and
 * the mitres where the head and tail turn-ins meet the fore-edge turn-in.
 *
 * These marks sit right against the physical edges, well outside the frame.
 * That separation matters: a second inset rectangle would be more furniture;
 * this open three-sided rule is the board being wrapped.
 */
function paintBoardConstruction(
  ctx: FlatCtx,
  spec: MaterialSpec,
  construction: CoverConstruction,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  radius: number,
  face: string,
  dark: string,
  ink: number,
  seed: number,
): void {
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const jointW = Math.max(1.1, faceW * construction.jointRatio);
  const edgeGap = Math.max(1.7, Math.min(faceW, bh) * 0.018);
  const line = Math.max(0.75, ink * 0.36);

  ctx.save();
  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.clip();

  // A recessed joint is a third FLAT face, not a shadow.  Flexible wrappers
  // get the narrowest fold; rounded calf and split bindings get a deeper
  // gutter because the board really does stand away from the back there.
  ctx.fillStyle = mixHex(face, dark, construction.boardEdge === 'folded' ? 0.22 : 0.38);
  ctx.fillRect(faceX, by - radius, jointW, bh + radius * 2);
  stroke(
    ctx,
    faceX + jointW,
    by + bh * 0.018,
    faceX + jointW,
    by + bh * 0.982,
    FLAT.ink,
    line,
    seed + 4,
  );

  const x0 = faceX + Math.max(jointW + edgeGap * 0.5, faceW * 0.025);
  const x1 = bx + bw - edgeGap;
  const y0 = by + edgeGap;
  const y1 = by + bh - edgeGap;

  if (construction.boardEdge === 'soft') {
    // A cut soft covering has no crisp turn-in.  Short, separated bites along
    // the three exposed edges say "cut cloth" without fuzz, blur or texture.
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.25) / steps;
      const len = i % 2 === 0 ? edgeGap * 0.72 : edgeGap * 0.48;
      stroke(ctx, x1 - len, by + bh * t, x1, by + bh * t, FLAT.ink, line, seed + 20 + i);
    }
    for (const y of [y0, y1]) {
      for (let i = 0; i < 7; i++) {
        const t = (i + 0.35) / 7;
        const cx = x0 + (x1 - x0) * t;
        stroke(ctx, cx, y, cx + edgeGap * 0.36, y, FLAT.ink, line, seed + 40 + i + y);
      }
    }
    ctx.restore();
    return;
  }

  // One open U: head turn-in → fore-edge turn-in → tail turn-in.  Keeping the
  // hinge side open prevents it from becoming a second ornamental frame.
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - radius * 0.3, y0);
  ctx.quadraticCurveTo(x1, y0, x1, y0 + radius * 0.3);
  ctx.lineTo(x1, y1 - radius * 0.3);
  ctx.quadraticCurveTo(x1, y1, x1 - radius * 0.3, y1);
  ctx.lineTo(x0, y1);
  pen(ctx, FLAT.ink, line);
  ctx.stroke();

  if (construction.boardEdge === 'turned') {
    // Tiny mitres are the join between three pieces of the same turned-in
    // covering. They are construction detail, not corner ornaments.
    const m = edgeGap * 1.18;
    stroke(ctx, x1 - m, y0, x1, y0 + m, FLAT.ink, line, seed + 62);
    stroke(ctx, x1 - m, y1, x1, y1 - m, FLAT.ink, line, seed + 63);
  } else if (construction.boardEdge === 'folded') {
    // Paper and sailcloth turn as one sheet. A pair of registration nicks at
    // the fore edge is enough to distinguish a fold from a leather mitre.
    for (const t of [0.31, 0.69] as const) {
      stroke(
        ctx,
        x1 - edgeGap * 0.72,
        by + bh * t,
        x1,
        by + bh * t,
        FLAT.ink,
        line,
        seed + t * 100,
      );
    }
  } else if (construction.boardEdge === 'raw') {
    // Millboard has a cut edge: three uneven fibres break the otherwise clean
    // fore-edge rule. Still crisp flat marks, never a distressed overlay.
    for (let i = 0; i < 3; i++) {
      const cy = by + bh * (0.26 + i * 0.24);
      stroke(ctx, x1 - edgeGap * 0.45, cy, x1 + edgeGap * 0.15, cy + (i - 1) * edgeGap * 0.22, FLAT.ink, line, seed + 70 + i);
    }
  }

  // Double-jointed skins turn over the far board joint as well. Its second
  // rule is kept short of the head and tail so it cannot read as another frame.
  if (spec.joints > 1) {
    stroke(
      ctx,
      x1 - edgeGap * 1.45,
      by + bh * 0.055,
      x1 - edgeGap * 1.45,
      by + bh * 0.945,
      FLAT.ink,
      Math.max(0.7, line * 0.82),
      seed + 79,
    );
  }

  ctx.restore();
}

/** Sew or finish one head/tail of the back in the binding's own vocabulary. */
function paintEndband(
  ctx: FlatCtx,
  construction: CoverConstruction,
  bx: number,
  by: number,
  bh: number,
  spineW: number,
  face: string,
  dark: string,
  accent: string,
  ink: number,
  headTailStyle: number | undefined,
  seed: number,
): void {
  if (construction.endband === 'none') return;
  const x0 = bx + spineW * (construction.roundRatio + 0.08);
  const x1 = bx + spineW * 0.88;
  const rule = Math.max(0.72, ink * 0.34);

  for (const [edge, t] of [[0, 0.035], [1, 0.965]] as const) {
    const y = by + bh * t;
    if (construction.endband === 'plain') {
      stroke(ctx, x0, y, x1, y, FLAT.ink, Math.max(0.8, ink * 0.5), seed + edge);
      continue;
    }

    if (construction.endband === 'stitched') {
      stroke(ctx, x0, y, x1, y, dark, Math.max(0.8, ink * 0.55), seed + 8 + edge);
      for (let i = 0; i < 4; i++) {
        const cx = x0 + ((i + 0.5) / 4) * (x1 - x0);
        const dy = edge === 0 ? spineW * 0.045 : -spineW * 0.045;
        stroke(ctx, cx - spineW * 0.035, y - dy, cx + spineW * 0.035, y + dy, FLAT.ink, rule, seed + 14 + edge * 10 + i);
      }
      continue;
    }

    // Woven endbands and vellum ties are real two-colour sewing. Their short
    // alternating pieces provide fine craft without inventing highlights.
    stroke(ctx, x0, y, x1, y, FLAT.ink, Math.max(1, ink * 0.64), seed + 30 + edge);
    const endbandStyle = normalizeHeadTailStyle(headTailStyle);
    if (endbandStyle === 3) {
      // Solid silk roll: one broad sewn core with restrained edge seams. Its
      // geometry is continuous and materially heavier than either a chevron
      // or individually wrapped cord, even at the held spine's true width.
      const silk = mixHex(accent, FLAT.cream, 0.55);
      stroke(ctx, x0, y, x1, y, silk, Math.max(1.8, ink * 0.88), seed + 32 + edge);
      const seam = Math.max(0.65, ink * 0.26);
      const offset = spineW * 0.045 * (edge === 0 ? 1 : -1);
      stroke(ctx, x0, y + offset, x1, y + offset, dark, seam, seed + 33 + edge);
      stroke(ctx, x0, y - offset * 0.45, x1, y - offset * 0.45, FLAT.cream, seam * 0.72, seed + 35 + edge);
      continue;
    }
    if (endbandStyle === 2) {
      // Wrapped cord: one continuous coloured core with measured dark wraps.
      const cord = mixHex(accent, FLAT.cream, 0.32);
      stroke(ctx, x0, y, x1, y, cord, Math.max(1.35, ink * 0.68), seed + 34 + edge);
      for (let i = 0; i < 3; i += 1) {
        const cx = x0 + ((i + 0.5) / 3) * (x1 - x0);
        const dy = spineW * 0.06 * (edge === 0 ? 1 : -1);
        stroke(ctx, cx - spineW * 0.045, y - dy, cx + spineW * 0.045, y + dy, dark, Math.max(rule, 0.8), seed + 36 + edge * 10 + i);
      }
      continue;
    }
    // Woven chevron: two continuous interlaced paths, never a row of pale
    // stitch-dots. Four broad turns are the most this true-width back can hold.
    const steps = 4;
    const amplitude = spineW * 0.055 * (edge === 0 ? 1 : -1);
    for (const [phase, thread] of [
      [0, construction.endband === 'tied' ? face : mixHex(accent, FLAT.cream, 0.28)],
      [1, FLAT.cream],
    ] as const) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i += 1) {
        const px = x0 + (i / steps) * (x1 - x0);
        const py = y + ((i + phase) % 2 === 0 ? -amplitude : amplitude);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      pen(ctx, thread, Math.max(0.75, ink * 0.42));
      ctx.stroke();
    }
  }
}

/**
 * Carry a dedicated binder's companion tool onto the visible turn of the
 * back. This is deliberately titleless and unframed: the physical raised
 * cords already define its compartment, so another outlined box would read
 * as a sticker. These are purpose-cut shelf-scale strikes, never thumbnails
 * of the richer front-cover blocks.
 */
function paintCoverSpineTool(
  ctx: FlatCtx,
  programme: CoverEmblemProgramme,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
): void {
  const leaf = (
    x: number,
    y: number,
    angle: number,
    length = r * 0.72,
    width = r * 0.25,
  ): void => petal(ctx, x, y, angle, length, width, colour);
  const ivy = (x: number, y: number, angle: number, size: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, size * 0.38);
    ctx.quadraticCurveTo(-size * 0.46, size * 0.16, -size * 0.58, -size * 0.18);
    ctx.quadraticCurveTo(-size * 0.24, -size * 0.18, 0, -size * 0.7);
    ctx.quadraticCurveTo(size * 0.24, -size * 0.18, size * 0.58, -size * 0.18);
    ctx.quadraticCurveTo(size * 0.46, size * 0.16, 0, size * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  pen(ctx, colour, line);

  switch (programme) {
    case 'lozenge-fleuron':
      lozengeOutline(ctx, cx, cy, r * 0.72, colour, line * 0.78);
      leaf(cx, cy + r * 0.18, -Math.PI / 2, r * 0.82, r * 0.25);
      break;

    case 'laurel-branch': {
      // One broad bowed branch with alternating, full-size leaves. The former
      // three-leaf diagonal compressed into a tiny heraldic crest here.
      pen(ctx, colour, line * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.9, cy + r * 0.62);
      ctx.quadraticCurveTo(cx - r * 0.02, cy + r * 0.28, cx + r * 0.9, cy - r * 0.62);
      ctx.stroke();
      for (const [x, y, angle] of [
        [-0.56, 0.38, -2.02],
        [-0.28, 0.22, 0.46],
        [0.06, -0.04, -2.02],
        [0.38, -0.3, 0.46],
      ] as const) {
        leaf(cx + r * x, cy + r * y, angle, r * 0.66, r * 0.25);
      }
      break;
    }

    case 'stellar-palmette':
      for (const angle of [-Math.PI * 0.72, -Math.PI / 2, -Math.PI * 0.28]) {
        leaf(cx, cy + r * 0.45, angle, r * 0.92, r * 0.25);
      }
      stroke(ctx, cx - r * 0.62, cy + r * 0.5, cx + r * 0.62, cy + r * 0.5, colour, line, 511);
      break;

    case 'acanthus-arabesque':
      // Low opposed S-scrolls keep an open horizontal silhouette; nothing
      // rises from a shared bowl, so this cannot become a U or horseshoe.
      pen(ctx, colour, line * 0.9);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.04, cy + r * 0.26);
        ctx.bezierCurveTo(
          cx + side * r * 0.34,
          cy - r * 0.34,
          cx + side * r * 1.02,
          cy + r * 0.18,
          cx + side * r * 0.78,
          cy - r * 0.5,
        );
        ctx.stroke();
        leaf(
          cx + side * r * 0.72,
          cy - r * 0.34,
          side < 0 ? -2.7 : -0.44,
          r * 0.72,
          r * 0.26,
        );
      }
      leaf(cx, cy + r * 0.28, -Math.PI / 2, r * 0.5, r * 0.2);
      break;

    case 'solar-palms':
      for (const side of [-1, 1] as const) {
        leaf(cx + side * r * 0.08, cy + r * 0.38, side < 0 ? -Math.PI * 0.72 : -Math.PI * 0.28, r * 0.88, r * 0.26);
      }
      stroke(ctx, cx, cy - r * 0.82, cx, cy + r * 0.5, colour, line, 521);
      stroke(ctx, cx - r * 0.42, cy - r * 0.38, cx + r * 0.42, cy - r * 0.38, colour, line, 523);
      break;

    case 'upright-fleuron':
      stroke(ctx, cx, cy + r * 0.82, cx, cy - r * 0.08, colour, line, 531);
      leaf(cx, cy + r * 0.05, -Math.PI / 2, r * 0.86, r * 0.27);
      leaf(cx, cy + r * 0.3, -Math.PI * 0.78, r * 0.72, r * 0.24);
      leaf(cx, cy + r * 0.3, -Math.PI * 0.22, r * 0.72, r * 0.24);
      break;

    case 'oak-sprig':
      // A balanced three-leaf oak spray, reduced for the turn but never to a
      // diagonal chain. The two hanging fruits anchor the botanical reading.
      stroke(ctx, cx, cy + r * 0.82, cx, cy - r * 0.58, colour, line * 0.9, 541);
      stroke(ctx, cx, cy + r * 0.28, cx - r * 0.7, cy - r * 0.26, colour, line * 0.78, 543);
      stroke(ctx, cx, cy + r * 0.28, cx + r * 0.7, cy - r * 0.26, colour, line * 0.78, 545);
      leaf(cx, cy - r * 0.42, -Math.PI / 2, r * 0.76, r * 0.29);
      leaf(cx - r * 0.48, cy - r * 0.12, -2.55, r * 0.66, r * 0.28);
      leaf(cx + r * 0.48, cy - r * 0.12, -0.59, r * 0.66, r * 0.28);
      leaf(cx - r * 0.22, cy + r * 0.42, Math.PI / 2, r * 0.34, r * 0.16);
      leaf(cx + r * 0.22, cy + r * 0.42, Math.PI / 2, r * 0.34, r * 0.16);
      break;

    case 'thistle-bloom':
      stroke(ctx, cx, cy + r * 0.78, cx, cy - r * 0.12, colour, line, 545);
      leaf(cx, cy + r * 0.5, -Math.PI * 0.78, r * 0.62, r * 0.22);
      leaf(cx, cy + r * 0.5, -Math.PI * 0.22, r * 0.62, r * 0.22);
      for (const x of [-0.28, 0, 0.28]) {
        leaf(cx + r * x, cy - r * 0.18, -Math.PI / 2, r * 0.62, r * 0.16);
      }
      break;

    case 'open-state-crown': {
      const bandTop = cy + r * 0.12;
      const bandBottom = cy + r * 0.5;

      // At this width an arch becomes a dome and a dome becomes a tent. The
      // side companion therefore carries the crown's irreducible silhouette:
      // three broad points growing directly out of one bowed circlet. It is a
      // simplified strike of the front-cover block, not the old pictogram.
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.82, bandTop);
      ctx.quadraticCurveTo(cx - r * 0.76, cy - r * 0.28, cx - r * 0.62, cy - r * 0.5);
      ctx.quadraticCurveTo(cx - r * 0.46, cy - r * 0.28, cx - r * 0.34, bandTop);
      ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.34, cx, cy - r * 0.8);
      ctx.quadraticCurveTo(cx + r * 0.2, cy - r * 0.34, cx + r * 0.34, bandTop);
      ctx.quadraticCurveTo(cx + r * 0.46, cy - r * 0.28, cx + r * 0.62, cy - r * 0.5);
      ctx.quadraticCurveTo(cx + r * 0.76, cy - r * 0.28, cx + r * 0.82, bandTop);
      ctx.lineTo(cx + r * 0.72, bandBottom);
      ctx.quadraticCurveTo(cx, bandBottom + r * 0.1, cx - r * 0.72, bandBottom);
      ctx.closePath();
      ctx.fill();

      // A second bowed rule makes the solid base read as a circlet rather
      // than a castle wall. No dome, cross or laurel is introduced here.
      pen(ctx, colour, line * 0.72);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.74, bandTop + r * 0.18);
      ctx.quadraticCurveTo(cx, bandTop + r * 0.28, cx + r * 0.74, bandTop + r * 0.18);
      ctx.stroke();

      break;
    }

    case 'rosette-arabesque':
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        leaf(cx, cy, angle, r * 0.78, r * 0.28);
      }
      break;

    case 'broad-fleur-de-lis':
      leaf(cx, cy + r * 0.3, -Math.PI / 2, r * 1.02, r * 0.24);
      leaf(cx - r * 0.04, cy + r * 0.18, -Math.PI * 0.78, r * 0.9, r * 0.3);
      leaf(cx + r * 0.04, cy + r * 0.18, -Math.PI * 0.22, r * 0.9, r * 0.3);
      stroke(ctx, cx - r * 0.54, cy + r * 0.44, cx + r * 0.54, cy + r * 0.44, colour, line, 551);
      stroke(ctx, cx - r * 0.4, cy + r * 0.64, cx + r * 0.4, cy + r * 0.64, colour, line * 0.62, 553);
      break;

    case 'ivy-knot':
      // Persisted programme name retained for compatibility; the live tool is
      // the honest paired-ivy construction shared with the shelf companion.
      pen(ctx, colour, line * 0.84);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.72);
      ctx.quadraticCurveTo(cx - r * 0.18, cy + r * 0.02, cx - r * 0.58, cy - r * 0.46);
      ctx.moveTo(cx, cy + r * 0.72);
      ctx.quadraticCurveTo(cx + r * 0.18, cy + r * 0.02, cx + r * 0.58, cy - r * 0.46);
      ctx.stroke();
      ivy(cx - r * 0.58, cy - r * 0.46, -2.32, r * 0.7);
      ivy(cx + r * 0.58, cy - r * 0.46, -0.82, r * 0.7);
      break;

    case 'oak-acanthus-volutes':
      // Horizontal C-volutes with upright terminals; the old V construction
      // made two outward leaves read as a dove in flight.
      pen(ctx, colour, line * 0.86);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.04, cy + r * 0.34);
        ctx.bezierCurveTo(
          cx + side * r * 0.38,
          cy - r * 0.22,
          cx + side * r * 1.02,
          cy + r * 0.22,
          cx + side * r * 0.78,
          cy - r * 0.46,
        );
        ctx.stroke();
        leaf(cx + side * r * 0.76, cy - r * 0.38, -Math.PI / 2, r * 0.7, r * 0.27);
      }
      leaf(cx, cy + r * 0.34, -Math.PI / 2, r * 0.48, r * 0.19);
      break;

    case 'wheat-saltire':
      // Bowed stalks meet only at the low binding tie; their large grains,
      // rather than the crossing, own the silhouette.
      pen(ctx, colour, line * 0.72);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - side * r * 0.2, cy + r * 0.8);
        ctx.quadraticCurveTo(cx + side * r * 0.02, cy + r * 0.08, cx + side * r * 0.52, cy - r * 0.82);
        ctx.stroke();
        for (const [x, y, angle] of [
          [0.24, -0.18, -0.46],
          [0.36, -0.46, -2.04],
          [0.48, -0.7, -0.46],
        ] as const) {
          leaf(cx + side * r * x, cy + r * y, side < 0 ? Math.PI - angle : angle, r * 0.44, r * 0.18);
        }
      }
      stroke(ctx, cx - r * 0.34, cy + r * 0.52, cx + r * 0.34, cy + r * 0.52, colour, line, 563);
      break;

    case 'split-pomegranate':
      // Two open fruit halves leave a visible central seam and open base, so
      // the tiny strike never becomes a coin, eye or cabinet pull.
      pen(ctx, colour, line * 0.86);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.12, cy - r * 0.42);
        ctx.quadraticCurveTo(cx + side * r * 0.82, cy - r * 0.5, cx + side * r * 0.7, cy + r * 0.28);
        ctx.quadraticCurveTo(cx + side * r * 0.58, cy + r * 0.66, cx + side * r * 0.18, cy + r * 0.5);
        ctx.stroke();
        leaf(cx + side * r * 0.44, cy + r * 0.06, -Math.PI / 2, r * 0.36, r * 0.17);
      }
      leaf(cx - r * 0.24, cy - r * 0.42, -2.08, r * 0.44, r * 0.17);
      leaf(cx, cy - r * 0.46, -Math.PI / 2, r * 0.5, r * 0.18);
      leaf(cx + r * 0.24, cy - r * 0.42, -1.06, r * 0.44, r * 0.17);
      break;

    case 'open-tulip':
      pen(ctx, colour, line * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.62, cy - r * 0.42);
      ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.14, cx, cy + r * 0.22);
      ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.14, cx + r * 0.62, cy - r * 0.42);
      ctx.quadraticCurveTo(cx + r * 0.24, cy - r * 0.2, cx, cy - r * 0.72);
      ctx.quadraticCurveTo(cx - r * 0.24, cy - r * 0.2, cx - r * 0.62, cy - r * 0.42);
      ctx.stroke();
      stroke(ctx, cx, cy + r * 0.2, cx, cy + r * 0.74, colour, line, 571);
      leaf(cx, cy + r * 0.56, -Math.PI * 0.76, r * 0.54, r * 0.18);
      leaf(cx, cy + r * 0.5, -Math.PI * 0.24, r * 0.54, r * 0.18);
      break;

    case 'pinecone-needles':
      // A tall cone crosses one asymmetric needle branch. Bilateral antennae
      // were what made the previous reduction read as an insect or UFO.
      pen(ctx, colour, line * 0.82);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.86, cy + r * 0.42);
      ctx.quadraticCurveTo(cx - r * 0.12, cy + r * 0.08, cx + r * 0.88, cy - r * 0.48);
      ctx.stroke();
      for (const [x, y, tx, ty] of [
        [-0.5, 0.24, -0.92, -0.04],
        [-0.34, 0.14, -0.72, 0.54],
        [0.5, -0.24, 0.94, -0.72],
      ] as const) {
        stroke(ctx, cx + r * x, cy + r * y, cx + r * tx, cy + r * ty, colour, line * 0.58, 581 + x);
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.78);
      ctx.quadraticCurveTo(cx - r * 0.42, cy - r * 0.36, cx - r * 0.34, cy + r * 0.46);
      ctx.quadraticCurveTo(cx, cy + r * 0.82, cx + r * 0.34, cy + r * 0.46);
      ctx.quadraticCurveTo(cx + r * 0.42, cy - r * 0.36, cx, cy - r * 0.78);
      ctx.stroke();
      leaf(cx, cy - r * 0.28, Math.PI / 2, r * 0.34, r * 0.18);
      leaf(cx - r * 0.1, cy + r * 0.12, Math.PI / 2, r * 0.34, r * 0.17);
      leaf(cx + r * 0.1, cy + r * 0.12, Math.PI / 2, r * 0.34, r * 0.17);
      break;

    case 'anthemion-fan':
      // Five open leaves flow from a curled base; there is no horizontal
      // circlet for the fan to masquerade as a crown.
      for (const [angle, length, width] of [
        [-2.82, 0.78, 0.22],
        [-2.18, 0.9, 0.22],
        [-Math.PI / 2, 1.02, 0.24],
        [-0.96, 0.9, 0.22],
        [-0.32, 0.78, 0.22],
      ] as const) {
        leaf(cx, cy + r * 0.5, angle, r * length, r * width);
      }
      pen(ctx, colour, line * 0.72);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.58);
      ctx.quadraticCurveTo(cx - r * 0.42, cy + r * 0.78, cx - r * 0.68, cy + r * 0.54);
      ctx.moveTo(cx, cy + r * 0.58);
      ctx.quadraticCurveTo(cx + r * 0.42, cy + r * 0.78, cx + r * 0.68, cy + r * 0.54);
      ctx.stroke();
      break;

    case 'fern-palmette':
      // Two bowed rachises with three broad pinnae apiece form a split fan,
      // not a diagonal fern sprig or paired lung outline.
      for (const side of [-1, 1] as const) {
        pen(ctx, colour, line * 0.82);
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.72);
        ctx.quadraticCurveTo(cx + side * r * 0.62, cy + r * 0.02, cx + side * r * 0.32, cy - r * 0.78);
        ctx.stroke();
        for (const [x, y] of [[0.18, 0.38], [0.34, 0], [0.34, -0.36]] as const) {
          leaf(
            cx + side * r * x,
            cy + r * y,
            side < 0 ? -2.58 : -0.56,
            r * 0.5,
            r * 0.2,
          );
        }
      }
      break;

    case 'ginkgo-fans':
      // Two upward, notched fans on separate bowed stems. Keeping them open
      // eliminates the filled bow-tie / lamp silhouette of the old strike.
      for (const side of [-1, 1] as const) {
        const stemX = cx + side * r * 0.46;
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.08, cy + r * 0.7);
        ctx.quadraticCurveTo(cx + side * r * 0.18, cy + r * 0.08, stemX, cy - r * 0.22);
        ctx.moveTo(stemX, cy - r * 0.22);
        ctx.quadraticCurveTo(cx + side * r * 0.9, cy - r * 0.34, cx + side * r * 0.76, cy - r * 0.82);
        ctx.quadraticCurveTo(cx + side * r * 0.54, cy - r * 0.64, cx + side * r * 0.46, cy - r * 0.88);
        ctx.quadraticCurveTo(cx + side * r * 0.32, cy - r * 0.62, cx + side * r * 0.14, cy - r * 0.78);
        ctx.quadraticCurveTo(cx + side * r * 0.08, cy - r * 0.32, stemX, cy - r * 0.22);
        pen(ctx, colour, line * 0.82);
        ctx.stroke();
        stroke(ctx, stemX, cy - r * 0.22, cx + side * r * 0.64, cy - r * 0.66, colour, line * 0.54, 611 + side);
      }
      leaf(cx, cy + r * 0.58, -Math.PI / 2, r * 0.38, r * 0.17);
      break;

  }
  ctx.restore();
}

function paintCoverSpineEmblem(
  ctx: FlatCtx,
  construction: CoverConstruction,
  bx: number,
  by: number,
  bh: number,
  spineW: number,
  ornament: number,
  colour: string,
): void {
  const kind = normalizeCoverEmblemIndex(ornament);
  if (kind < 0) return;

  const stations = [...construction.supports].sort((a, b) => a - b);
  const bounds = [0.1, ...stations, 0.9];
  let gapStart = bounds[0]!;
  let gapEnd = bounds[1] ?? 0.9;
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i]!;
    const end = bounds[i + 1]!;
    if (end - start > gapEnd - gapStart) {
      gapStart = start;
      gapEnd = end;
    }
  }

  const x0 = bx + spineW * Math.max(0.08, construction.roundRatio * 0.62);
  const x1 = bx + spineW * 0.9;
  const cx = (x0 + x1) / 2;
  const cy = by + bh * ((gapStart + gapEnd) / 2);
  const gapHeight = bh * (gapEnd - gapStart);
  const r = Math.min(spineW * 0.43, (x1 - x0) * 0.5, gapHeight * 0.2, bh * 0.05);
  if (r < 1.2) return;

  paintCoverSpineTool(
    ctx,
    coverEmblemProgramme(kind),
    cx,
    cy,
    r,
    colour,
    Math.max(0.75, r * 0.14),
  );
}

/**
 * The darker strip down the hinge side, with its gilt bands.
 *
 * This is the icon's whole depth model in one shape: the board turns away from
 * us and becomes a second, darker flat colour. It is clipped to the board so
 * the outline stays a single unbroken line, then the board's edge is
 * re-stroked because a clip always nibbles the stroke it runs through.
 */
function paintSpineStrip(
  ctx: FlatCtx,
  spec: MaterialSpec,
  construction: CoverConstruction,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  spineW: number,
  radius: number,
  face: string,
  dark: string,
  accent: string,
  ink: number,
  gilded: boolean,
  params: CoverParams,
  seed: number,
): void {
  ctx.save();
  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.clip();
  // Overshoot on three sides so only the strip's inner edge shows a curve.
  wobbleRect(ctx, bx - radius, by - radius, spineW + radius, bh + radius * 2, radius, seed + 5);
  ctx.fillStyle = dark;
  ctx.fill();
  // The board TURNING AWAY: the outermost sliver of the strip is the round of
  // the back, a third flat face deeper again. The icon does exactly this and
  // the cover was drawing the spine as one flat slab, which is why it read as
  // a stripe painted on rather than as an edge.
  ctx.fillStyle = mixHex(dark, FLAT.ink, 0.3);
  ctx.fillRect(
    bx - radius,
    by - radius,
    spineW * construction.roundRatio + radius,
    bh + radius * 2,
  );
  stroke(
    ctx,
    bx + spineW * construction.roundRatio,
    by + bh * 0.012,
    bx + spineW * 0.2,
    by + bh * 0.988,
    FLAT.ink,
    Math.max(0.8, ink * 0.45),
    seed + 6,
  );
  ctx.restore();

  wobbleRect(ctx, bx, by, bw, bh, radius, seed);
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // The hinge: one ink line where the strip meets the face.
  stroke(ctx, bx + spineW, by + bh * 0.012, bx + spineW, by + bh * 0.988, FLAT.ink, ink * 0.8, seed + 2);

  // Raised supports belong to leather, vellum and split bindings. Case-bound
  // cloth and flexible paper deliberately have none: giving every material
  // the icon's same three gilt stripes made all fifty covers one generic prop.
  // They stop short of both edges so the rounded back remains one silhouette.
  //
  // Without foil the band becomes the board's own lighter face, so a raised
  // cord still shows as the strip stepping back up towards us. That is the
  // icon's depth model rather than a highlight.
  //
  // Each band is a CORD now, not a stripe: one ink hairline along each edge of
  // it, which is what a raised band under the leather actually shows and what
  // separates three painted lines from three ridges.
  const band = spineW * construction.supportWeight;
  const x0 = bx + spineW * (construction.roundRatio + 0.07);
  const x1 = bx + spineW * 0.87;
  const gold = (params.bandGilt ?? gilded) ? (params.toolingHex ?? FLAT.gilt) : face;
  const cord = Math.max(0.7, ink * 0.35);
  for (const [index, t] of construction.supports.entries()) {
    const weight = construction.endband === 'tied' ? (index % 2 === 0 ? 0.74 : 0.58) : 1;
    const cy = by + bh * t;
    stroke(ctx, x0, cy, x1, cy, gold, band * weight, seed + t * 100);
    for (const s of [-1, 1] as const) {
      const ey = cy + (s * band * weight) / 2;
      stroke(ctx, x0, ey, x1, ey, FLAT.ink, cord, seed + t * 100 + s * 3);
    }
    if (construction.endband === 'tied') {
      dot(ctx, x1 - spineW * 0.035, cy, Math.max(0.65, band * 0.28), accent);
    }
  }

  if (construction.endband === 'stitched') {
    // The seam holding a flexible sailcloth wrapper together.  Discrete
    // stitches make it construction, while one continuous rule looked like a
    // decorative stripe painted down the back.
    for (let i = 0; i < 8; i++) {
      const t0 = 0.09 + i * 0.105;
      stroke(
        ctx,
        bx + spineW * 0.58,
        by + bh * t0,
        bx + spineW * 0.58,
        by + bh * (t0 + 0.052),
        FLAT.ink,
        Math.max(0.72, ink * 0.35),
        seed + 150 + i,
      );
    }
  } else if (spec.group === 'paper' && construction.supports.length === 0) {
    // One long fold down a flexible/paper back; again, not a support band.
    stroke(
      ctx,
      bx + spineW * 0.6,
      by + bh * 0.06,
      bx + spineW * 0.6,
      by + bh * 0.94,
      FLAT.ink,
      Math.max(0.7, ink * 0.32),
      seed + 151,
    );
  }

  const emblemInk = resolveCoverEmblemInk(
    params.emblemHex ?? params.toolingHex ?? (gilded ? FLAT.giltPale : face),
    dark,
  );
  paintCoverSpineEmblem(
    ctx,
    construction,
    bx,
    by,
    bh,
    spineW,
    params.medallion,
    emblemInk,
  );

  paintEndband(
    ctx,
    construction,
    bx,
    by,
    bh,
    spineW,
    face,
    dark,
    accent,
    ink,
    params.headTailStyle,
    seed + 170,
  );
}

/**
 * The ornamental frame inset into the face — fifty of them.
 *
 * ## Composed, not enumerated
 *
 * Fifty hand-written branches would be fifty chances to draw a frame that does
 * not match its siblings, and the family resemblance is the point: every one of
 * these is the same pale rule the app icon carries, elaborated. So a frame is a
 * spec of five orthogonal traits and the painter reads them:
 *
 *   rules    how many concentric rules, and their relative weights
 *   corner   what sits at the four corners
 *   side     what sits at the middle of each side
 *   radius   how the rule turns — square, soft, or a drawn-out ogee
 *   band     an optional filled border between two of the rules
 *
 * Fifty combinations that a reader can tell apart, all provably siblings,
 * because they are made of the same four marks in different arrangements.
 *
 * ## Why these marks and not others
 *
 * A cover is seen LARGE — the pull-out overlay and the open book — which is the
 * opposite constraint to a spine, where an ornament has thirty pixels and has
 * to survive being a smudge. Here detail reads, so the marks can be finer. What
 * does NOT change is the flat rule: one ink colour, no shading, no blur. Depth
 * on a frame is a second rule at a different weight, never a shadow.
 *
 * The lozenge at the middle of each side is the one mark that was got wrong
 * first time and is worth keeping a note about: it started as a tick laid ALONG
 * the rule, which was invisible, because a mark drawn on top of a line reads as
 * a thicker line. A mark that sits ACROSS the rule is the only kind that reads
 * on a frame.
 */

/** What sits at the four corners of a frame. */
type FrameCorner =
  | 'none'
  | 'dot'
  | 'ring'
  | 'lozenge'
  | 'bracket'
  | 'fleuron'
  | 'acanthus'
  | 'renaissance'
  | 'stud';

/** What sits at the middle of each side. */
type FrameSide = 'none' | 'lozenge' | 'tick' | 'dot' | 'arc' | 'pair';

/** How the rule turns at a corner. */
type FrameTurn = 'square' | 'soft' | 'round' | 'ogee' | 'shouldered';

interface FrameSpec {
  id: string;
  name: string;
  /** Relative weights of the concentric rules, outermost first. 1 = full. */
  rules: readonly number[];
  corner: FrameCorner;
  side: FrameSide;
  turn: FrameTurn;
  /** Fill the gap between rule 0 and rule 1 with a flat band. */
  band?: boolean;
}

/** The binder's structural weight, used to author matching corner tools. */
export type FrameToolTier = 'single' | 'double' | 'fillet' | 'triple' | 'banded';

/**
 * How far a rule's corner is rounded off, so a corner TOOL can be put where
 * the rule actually turns rather than where the maths corner is.
 *
 * Shared with `traceFrameRect` — the two read the same number, because a corner
 * ornament placed at the geometric corner of a `round` frame floats outside its
 * own rule, which is precisely how the first specimen's corner marks came to
 * look like specks flicked at the board.
 */
function frameTurnRadius(turn: FrameTurn, m: number): number {
  if (turn === 'square') return m * 0.008;
  if (turn === 'round') return m * 0.16;
  if (turn === 'soft') return m * 0.05;
  if (turn === 'shouldered') return m * 0.055;
  return m * 0.065; // restrained ogee, never a rounded UI-card turn
}

function frame(
  id: string,
  name: string,
  rules: readonly number[],
  corner: FrameCorner,
  side: FrameSide,
  turn: FrameTurn,
  band = false,
): FrameSpec {
  return { id, name, rules, corner, side, turn, band };
}

/**
 * A corner tool belongs to its surrounding fillets. A single-rule bracket is
 * a spare return, while a triple or banded programme needs a deeper, broader
 * cut. Keeping the tier derived from the frame spec prevents the old result
 * where several names painted the same tiny corner stamp.
 */
function frameToolTier(spec: FrameSpec): FrameToolTier {
  if (spec.band === true) return 'banded';
  if (spec.rules.length >= 3) return 'triple';
  if (spec.rules.length === 2 && Math.min(...spec.rules) <= 0.45) return 'fillet';
  if (spec.rules.length === 2) return 'double';
  return 'single';
}

/**
 * Fifty frames. The first four are the originals, hex-for-hex in behaviour —
 * `frame` is index-addressed by saved book data, so reordering the head of this
 * table silently redresses every book anyone has already customised.
 */
const FRAMES: readonly FrameSpec[] = [
  frame('plain-rule', 'Plain Rule', [1], 'none', 'none', 'soft'),
  frame('corner-dots', 'Corner Dots', [1], 'dot', 'none', 'soft'),
  frame('double-rule', 'Double Rule', [1, 0.7], 'none', 'none', 'soft'),
  frame('tooled-lozenge', 'Tooled Lozenge', [1], 'dot', 'lozenge', 'soft'),

  /* --- single rules, varying the corner --- */
  frame('ringed', 'Ringed Corners', [1], 'ring', 'none', 'soft'),
  frame('bracketed', 'Bracketed Fillet', [1], 'bracket', 'none', 'square'),
  frame('acanthus-return', 'Open Acanthus Return', [1, 0.4], 'acanthus', 'none', 'square'),
  frame('studded', 'Studded', [1], 'stud', 'none', 'square'),
  frame('lozenge-corners', 'Corner Lozenges', [1], 'lozenge', 'none', 'soft'),
  frame('round-rule', 'Round Rule', [1], 'none', 'none', 'round'),

  /* --- single rules, varying the side mark --- */
  frame('side-ticks', 'Side Ticks', [1], 'none', 'tick', 'soft'),
  frame('side-dots', 'Side Dots', [1], 'none', 'dot', 'soft'),
  frame('side-arcs', 'Side Arcs', [1], 'none', 'arc', 'round'),
  frame('side-pairs', 'Paired Sides', [1], 'none', 'pair', 'soft'),
  frame('centred-lozenge', 'Compass Lozenges', [1], 'none', 'lozenge', 'square'),

  /* --- double rules --- */
  frame('double-dots', 'Double with Dots', [1, 0.7], 'dot', 'none', 'soft'),
  frame('double-rings', 'Double with Rings', [1, 0.7], 'ring', 'none', 'soft'),
  frame('double-brackets', 'Double Bracket', [1, 0.7], 'bracket', 'none', 'square'),
  frame('double-ticks', 'Double with Ticks', [1, 0.7], 'none', 'tick', 'soft'),
  frame('double-lozenge', 'Double Lozenges', [1, 0.7], 'lozenge', 'lozenge', 'soft'),
  frame('restrained-ogee', 'Shouldered Ogee Panel', [1, 0.42], 'none', 'none', 'shouldered'),
  frame('double-fleuron', 'Double Fleurons', [1, 0.7], 'fleuron', 'none', 'soft'),
  frame('double-round', 'Double Round', [1, 0.7], 'none', 'arc', 'round'),
  frame('double-stud', 'Double Studded', [1, 0.7], 'stud', 'dot', 'square'),

  /* --- fillet: a heavy rule with a fine one inside --- */
  frame('fillet', 'Broad Fillet', [1.35, 0.28], 'none', 'none', 'square'),
  frame('fillet-dots', 'Fillet & Dots', [1, 0.4], 'dot', 'none', 'soft'),
  frame('fillet-fleuron', 'Fleuron Fillet', [1, 0.4], 'fleuron', 'none', 'soft'),
  frame('fillet-ogee', 'Ogee & Lozenges', [1, 0.4], 'none', 'lozenge', 'ogee'),
  frame('fine-fillet', 'Fine Fillet', [0.5, 1], 'none', 'none', 'soft'),
  frame('fine-fillet-ring', 'Fine Fillet & Ring', [0.5, 1], 'ring', 'none', 'soft'),

  /* --- triple rules --- */
  frame('triple-rule', 'Triple Fillet', [1, 0.7, 0.45], 'none', 'none', 'soft'),
  frame('triple-dots', 'Triple with Dots', [1, 0.7, 0.45], 'dot', 'none', 'soft'),
  frame('triple-lozenge', 'Triple Lozenges', [1, 0.7, 0.45], 'lozenge', 'lozenge', 'soft'),
  frame('triple-square', 'Triple Square', [1, 0.7, 0.45], 'stud', 'none', 'square'),
  frame('triple-ogee', 'Triple Ogee', [1, 0.6, 0.35], 'none', 'none', 'ogee'),
  frame('triple-bracket', 'Triple Bracket', [1, 0.7, 0.45], 'bracket', 'none', 'square'),

  /* --- banded: a flat border between two rules --- */
  frame('banded', 'Banded Fillet', [1, 0.7], 'none', 'none', 'square', true),
  frame('banded-dots', 'Banded & Dots', [1, 0.7], 'dot', 'none', 'soft', true),
  frame('banded-ring', 'Banded & Rings', [1, 0.7], 'ring', 'none', 'soft', true),
  frame('banded-lozenge', 'Banded Lozenge', [1, 0.7], 'lozenge', 'lozenge', 'soft', true),
  frame('banded-square', 'Banded Square', [1, 0.7], 'stud', 'none', 'square', true),
  frame('banded-ogee', 'Banded Ogee', [1, 0.7], 'none', 'none', 'ogee', true),
  frame('banded-triple', 'Banded Triple', [1, 0.7, 0.4], 'dot', 'tick', 'soft', true),
  frame('banded-fleuron', 'Banded Fleurons', [1, 0.7], 'fleuron', 'none', 'soft', true),

  /* --- the elaborate end --- */
  frame('panelled', 'Panelled', [1, 0.75, 0.5, 0.3], 'dot', 'lozenge', 'soft'),
  frame('cathedral', 'Cathedral Fleurons', [1, 0.6, 0.35], 'fleuron', 'none', 'ogee'),
  frame('coffered', 'Coffered', [1, 0.8, 0.55, 0.35], 'stud', 'dot', 'square', true),
  frame('rosace', 'Rosace', [1, 0.5], 'fleuron', 'pair', 'round'),
  frame('renaissance-panel', 'Renaissance Panel', [1, 0.55], 'renaissance', 'none', 'square', true),
  frame('gothic-panel', 'Gothic Panel', [1, 0.65, 0.4], 'bracket', 'none', 'ogee', true),
];

/**
 * The only cover frames readers and automatic recipes can reach.
 *
 * Historical indices stay addressable for migration, while every live entry
 * is built solely from continuous rules, fillets, brackets, fleurons,
 * lozenges and ogee arcs. Dots, studs, rings and ticks are absent by data, not
 * by a picker hiding them after the painter already chose one.
 */
export const ACTIVE_COVER_FRAME_INDICES = [
  0, 2, 5, 6, 8, 17, 20, 24, 26, 36, 43, 48,
] as const;

export interface ActiveCoverFrameOption {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  /** Structural audit fields exposed with the catalogue so tests and tools
   * can reject a dotted/studded legacy recipe without copying FRAMES. */
  readonly rules: readonly number[];
  readonly corner: FrameCorner;
  readonly side: FrameSide;
  readonly turn: FrameTurn;
  readonly band: boolean;
  readonly tier: FrameToolTier;
}

/** One authoritative reader-facing cover-frame catalogue. */
export const ACTIVE_COVER_FRAMES: readonly ActiveCoverFrameOption[] =
  ACTIVE_COVER_FRAME_INDICES.map((index) => ({
    index,
    id: FRAMES[index]?.id ?? `frame-${index}`,
    label: FRAMES[index]?.name ?? `Frame ${index + 1}`,
    rules: FRAMES[index]?.rules ?? [1],
    corner: FRAMES[index]?.corner ?? 'none',
    side: FRAMES[index]?.side ?? 'none',
    turn: FRAMES[index]?.turn ?? 'soft',
    band: FRAMES[index]?.band ?? false,
    tier: frameToolTier(FRAMES[index] ?? FRAMES[0]!),
  }));

const ACTIVE_COVER_FRAME_SET: ReadonlySet<number> = new Set(ACTIVE_COVER_FRAME_INDICES);

/** Semantic translations for retired frame programmes. */
const RETIRED_COVER_FRAME_REPLACEMENTS: Readonly<Record<number, number>> = {
  1: 0,
  3: 8,
  4: 5,
  7: 26,
  9: 0,
  10: 8,
  11: 0,
  12: 2,
  13: 8,
  14: 8,
  15: 2,
  16: 5,
  18: 2,
  19: 8,
  21: 26,
  22: 2,
  23: 26,
  25: 24,
  27: 2,
  28: 24,
  29: 24,
  30: 2,
  31: 2,
  32: 8,
  33: 2,
  34: 2,
  35: 5,
  37: 36,
  38: 36,
  39: 8,
  40: 36,
  41: 36,
  42: 36,
  44: 43,
  45: 43,
  46: 5,
  47: 43,
  49: 5,
};

export function isActiveCoverFrameIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && ACTIVE_COVER_FRAME_SET.has(value);
}

/** Hard-normalise old frame furniture into the active continuous case. */
export function normalizeCoverFrameIndex(value: unknown, fallback = 0): number {
  if (isActiveCoverFrameIndex(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value)) {
    const replacement = RETIRED_COVER_FRAME_REPLACEMENTS[value];
    if (replacement !== undefined && ACTIVE_COVER_FRAME_SET.has(replacement)) return replacement;
  }
  return ACTIVE_COVER_FRAME_SET.has(fallback) ? fallback : ACTIVE_COVER_FRAME_INDICES[0];
}

/**
 * Frames quiet enough to share a board with one hanging accent.
 *
 * A charm already supplies the cover's secondary furnishing.  A frame with
 * corner tools, side tools, a filled border, three or more rules, or an ogee
 * programme supplies another one even when its numeric index happens to be
 * small.  Keeping this decision beside the authored frame table prevents the
 * generator from inferring visual density from index ranges again.
 *
 * The rule follows the physical hierarchy visible in historic bindings: the
 * board keeps a plain fillet while the applied furniture is allowed to be the
 * accent.  See the Library of Congress binding terminology diagram and the
 * Met's Vitruvius binding survey, which distinguish structural bands/panels
 * from applied decorative programmes:
 * https://tile.loc.gov/storage-services/master/gdc/gdcebookspublic/20/19/45/27/33/2019452733/2019452733.pdf
 * https://www.metmuseum.org/perspectives/vitruvius
 */
export const HANGING_ACCENT_FRAME_IDS: readonly number[] = ACTIVE_COVER_FRAME_INDICES.flatMap(
  (index) => {
    const spec = FRAMES[index]!;
    return (
    spec.rules.length <= 2 &&
    spec.corner === 'none' &&
    spec.side === 'none' &&
    spec.turn !== 'ogee' &&
    spec.turn !== 'shouldered' &&
    spec.band !== true
      ? [index]
      : []
    );
  },
);

const HANGING_ACCENT_FRAME_SET: ReadonlySet<number> = new Set(
  HANGING_ACCENT_FRAME_IDS,
);

/** Whether a frame leaves one calm board for a ribbon, flower, seal or clasp. */
export function coverFrameSupportsHangingAccent(frameIndex: number): boolean {
  return Number.isInteger(frameIndex) && HANGING_ACCENT_FRAME_SET.has(frameIndex);
}

/** How many tooled frames a cover can wear. Derived, never restated. */
export const COVER_FRAME_COUNT = FRAMES.length;

/** Display names for the studio's frame picker. */
export const FRAME_LABELS: readonly string[] = FRAMES.map((f) => f.name);

/** Trace one rectangle in the frame's turn style. */
function traceFrameRect(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  turn: FrameTurn,
  seed: number,
): void {
  const m = Math.min(w, h);
  if (turn === 'shouldered') {
    // A clipped square shoulder with a short reverse step. This keeps the
    // historic ogee idea—one change of direction at the corner—without
    // turning the entire board into a rounded app-card capsule.
    const r = frameTurnRadius(turn, m);
    const k = r * 0.42;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.lineTo(x + w - k, y + k);
    ctx.lineTo(x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.lineTo(x + w - k, y + h - k);
    ctx.lineTo(x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.lineTo(x + k, y + h - k);
    ctx.lineTo(x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x + k, y + k);
    ctx.closePath();
    return;
  }
  if (turn !== 'ogee') {
    wobbleRect(ctx, x, y, w, h, frameTurnRadius(turn, m), seed);
    return;
  }
  // ogee — the corner is drawn out into a shallow S, which is what separates a
  // "binding" frame from a rounded rectangle. Traced by hand because a radius
  // cannot express a reversing curve.
  const r = frameTurnRadius('ogee', m);
  const k = r * 0.55;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.bezierCurveTo(x + w - k, y, x + w, y + k, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.bezierCurveTo(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.bezierCurveTo(x + k, y + h, x, y + h - k, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.bezierCurveTo(x, y + k, x + k, y, x + r, y);
  ctx.closePath();
}

/** A hairline circle. The collar on half the corner tools. */
function ringMark(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string, line: number): void {
  pen(ctx, colour, line);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.8, r), 0, Math.PI * 2);
  ctx.stroke();
}

/** A filled lozenge, `r` tall and 0.68r wide. The binder's commonest tool. */
function lozengeMark(ctx: FlatCtx, cx: number, cy: number, r: number, colour: string): void {
  tracePoly(ctx, [
    { x: cx, y: cy - r },
    { x: cx + r * 0.68, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r * 0.68, y: cy },
  ]);
  ctx.fillStyle = colour;
  ctx.fill();
}

/** The same lozenge, open. */
function lozengeOutline(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
): void {
  tracePoly(ctx, [
    { x: cx, y: cy - r },
    { x: cx + r * 0.68, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r * 0.68, y: cy },
  ]);
  pen(ctx, colour, line);
  ctx.stroke();
}

/**
 * One petal of a fleuron: a teardrop thrown from (x0,y0) along `ang`.
 *
 * Two quadratics rather than the four-point polygon this used to be. The
 * polygon's petal was a kite — straight sides, a hard point at the base — and
 * three kites in a corner read as a scratch rather than a flower. A curve costs
 * the same and is the difference between "ornament" and "damage".
 */
function petal(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  ang: number,
  len: number,
  wide: number,
  colour: string,
  /** How far the tip swings off the petal's own axis. 0 is a straight leaf. */
  curl = 0,
): void {
  const tx = x0 + Math.cos(ang + curl) * len;
  const ty = y0 + Math.sin(ang + curl) * len;
  const nx = Math.cos(ang + Math.PI / 2) * wide;
  const ny = Math.sin(ang + Math.PI / 2) * wide;
  const mx = x0 + Math.cos(ang) * len * 0.45;
  const my = y0 + Math.sin(ang) * len * 0.45;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, x0, y0);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * The four corner tools, drawn as TOOLS rather than as marks.
 *
 * ## Why each of these is now two or three shapes instead of one
 *
 * The first cut gave every corner a single primitive at `min(w,h) * 0.022` —
 * about two pixels on the studio preview and six on the pull-out. On the sheet
 * that mattered (`shots-now/out/*-frames-studio.png`) entries 0 through 14 were
 * one picture: fifty frames that a reader could sort into six. A dot the size
 * of a full stop cannot be told from a ring the size of a full stop, so the
 * vocabulary was real in the table and absent on the board.
 *
 * So each tool is a small COMPOSITION — a filled centre with a collar, a
 * bracket with an inner return, a fleuron with a heart and a tip — sized off
 * the frame rather than off nothing. That is richness by drawing: no shading
 * was added, and the only colour is still the frame's own.
 *
 * `sx`/`sy` point inward along the two rules, so a bracket knows which way its
 * arms run and a fleuron knows which way to throw its petals.
 */
function paintFrameCorner(
  ctx: FlatCtx,
  kind: FrameCorner,
  cx: number,
  cy: number,
  s: number,
  colour: string,
  line: number,
  sx: number,
  sy: number,
  tier: FrameToolTier,
): void {
  switch (kind) {
    case 'none':
      return;
    case 'dot':
      // A dot struck inside a collar — the plainest corner tool there is, and
      // the one a plain rule wants. Two circles, not one.
      dot(ctx, cx, cy, s * 0.3, colour);
      ringMark(ctx, cx, cy, s * 0.74, colour, line * 0.7);
      return;
    case 'stud': {
      // A metal boss: a heavy centre, a collar, and two spurs running back
      // along the rules so it reads as fixed to the frame rather than laid on.
      dot(ctx, cx, cy, s * 0.46, colour);
      ringMark(ctx, cx, cy, s * 0.92, colour, line * 0.85);
      pen(ctx, colour, line * 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 1.15, cy);
      ctx.lineTo(cx + sx * s * 1.95, cy);
      ctx.moveTo(cx, cy + sy * s * 1.15);
      ctx.lineTo(cx, cy + sy * s * 1.95);
      ctx.stroke();
      return;
    }
    case 'ring':
      // An eyelet: two concentric rules and a pip in the middle.
      ringMark(ctx, cx, cy, s * 0.95, colour, line * 0.85);
      ringMark(ctx, cx, cy, s * 0.5, colour, line * 0.6);
      dot(ctx, cx, cy, line * 0.85, colour);
      return;
    case 'lozenge':
      // A lozenge inside a lozenge, which is how a corner diaper is actually
      // built up; one alone was a speck.
      lozengeOutline(ctx, cx, cy, s * 1.2, colour, line * 0.7);
      lozengeMark(ctx, cx, cy, s * 0.62, colour);
      return;
    case 'bracket': {
      // The mark a binder's corner tool leaves: an L along both rules and a
      // tier-specific set of continuous returns. The triple-bracket is now a
      // genuinely deeper tool rather than the single bracket under more rules.
      pen(ctx, colour, line);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 2.4, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * s * 2.4);
      ctx.stroke();
      const returns = tier === 'triple' ? 3 : tier === 'double' || tier === 'banded' ? 2 : 1;
      for (let i = 0; i < returns; i += 1) {
        const g = s * (0.62 + i * 0.48);
        const arm = s * Math.max(1.18, 1.92 - i * 0.2);
        pen(ctx, colour, line * Math.max(0.42, 0.68 - i * 0.1));
        ctx.beginPath();
        ctx.moveTo(cx + sx * arm, cy + sy * g);
        ctx.lineTo(cx + sx * g, cy + sy * g);
        ctx.lineTo(cx + sx * g, cy + sy * arm);
        ctx.stroke();
      }
      return;
    }
    case 'fleuron': {
      // A corner vine, not a radial flower. The former five-petal burst
      // collapsed into a scratch/star at real cover pixels; two broad leaves
      // attached to one continuous return stay botanical and structural.
      const reach = s * (tier === 'banded' ? 3.15 : 2.65);
      pen(ctx, colour, line * 0.74);
      ctx.beginPath();
      ctx.moveTo(cx + sx * reach, cy);
      ctx.quadraticCurveTo(cx + sx * s * 0.72, cy, cx, cy);
      ctx.quadraticCurveTo(cx, cy + sy * s * 0.72, cx, cy + sy * reach);
      ctx.stroke();

      petal(
        ctx,
        cx + sx * s * 0.45,
        cy + sy * s * 0.08,
        sx > 0 ? 0 : Math.PI,
        s * 1.55,
        s * 0.42,
        colour,
        sy * 0.16,
      );
      petal(
        ctx,
        cx + sx * s * 0.08,
        cy + sy * s * 0.45,
        sy > 0 ? Math.PI / 2 : -Math.PI / 2,
        s * 1.55,
        s * 0.42,
        colour,
        -sx * 0.16,
      );

      if (tier === 'banded') {
        const g = s * 0.58;
        pen(ctx, colour, line * 0.48);
        ctx.beginPath();
        ctx.moveTo(cx + sx * reach, cy + sy * g);
        ctx.lineTo(cx + sx * g, cy + sy * g);
        ctx.lineTo(cx + sx * g, cy + sy * reach);
        ctx.stroke();
      }
      return;
    }
    case 'acanthus': {
      // Two continuous S-returns grow out of the corner and end in broad cut
      // leaves. It is an open corner programme, never a radial fleuron stamp.
      const reach = s * 3.15;
      pen(ctx, colour, line * 0.72);
      ctx.beginPath();
      ctx.moveTo(cx + sx * reach, cy);
      ctx.bezierCurveTo(
        cx + sx * s * 2.2,
        cy + sy * s * 0.08,
        cx + sx * s * 0.78,
        cy + sy * s * 0.18,
        cx + sx * s * 0.38,
        cy + sy * s * 0.7,
      );
      ctx.bezierCurveTo(
        cx + sx * s * 0.08,
        cy + sy * s * 1.16,
        cx + sx * s * 0.08,
        cy + sy * s * 2.24,
        cx,
        cy + sy * reach,
      );
      ctx.stroke();
      petal(
        ctx,
        cx + sx * s * 1.05,
        cy + sy * s * 0.18,
        sx > 0 ? 0 : Math.PI,
        s * 1.5,
        s * 0.44,
        colour,
        sy * 0.18,
      );
      petal(
        ctx,
        cx + sx * s * 0.18,
        cy + sy * s * 1.05,
        sy > 0 ? Math.PI / 2 : -Math.PI / 2,
        s * 1.5,
        s * 0.44,
        colour,
        -sx * 0.18,
      );
      return;
    }
    case 'renaissance': {
      // An open spandrel cut from two long reversing curves. The filled border
      // supplies the architecture; the corner therefore needs neither a
      // cluster of leaves nor a stack of tiny Ls. At true size it reads as one
      // Renaissance return rather than the scratchy fleuron used elsewhere.
      pen(ctx, colour, line * 0.78);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 3.25, cy + sy * s * 0.52);
      ctx.bezierCurveTo(
        cx + sx * s * 1.72,
        cy + sy * s * 0.5,
        cx + sx * s * 0.5,
        cy + sy * s * 1.72,
        cx + sx * s * 0.52,
        cy + sy * s * 3.25,
      );
      ctx.stroke();
      pen(ctx, colour, line * 0.48);
      ctx.beginPath();
      ctx.moveTo(cx + sx * s * 2.6, cy + sy * s * 1.02);
      ctx.quadraticCurveTo(
        cx + sx * s * 1.02,
        cy + sy * s * 1.02,
        cx + sx * s * 1.02,
        cy + sy * s * 2.6,
      );
      ctx.stroke();
      return;
    }
  }
}

/**
 * The four side tools, at the middle of each rule.
 *
 * Same enlargement as the corners, and the same rule they were already written
 * to: a mark laid ALONG the rule is just a thicker rule, so every one of these
 * crosses it. The additions are flanking pips — a tool is struck between two
 * stops on a real board, and two pips are what turn one mark into a run.
 */
function paintFrameSide(
  ctx: FlatCtx,
  kind: FrameSide,
  mx: number,
  my: number,
  s: number,
  colour: string,
  line: number,
  horizontal: boolean,
  /** +1 if the board's middle lies in the positive direction across the rule. */
  dir: number,
): void {
  /** Step along the rule, whichever way it runs. */
  const along = (d: number): [number, number] =>
    horizontal ? [mx + d, my] : [mx, my + d];

  switch (kind) {
    case 'none':
      return;
    case 'dot': {
      dot(ctx, mx, my, s * 0.32, colour);
      ringMark(ctx, mx, my, s * 0.78, colour, line * 0.65);
      for (const d of [-s * 1.7, s * 1.7]) {
        const [px, py] = along(d);
        dot(ctx, px, py, line * 0.85, colour);
      }
      return;
    }
    case 'lozenge': {
      lozengeMark(ctx, mx, my, s * 1.05, colour);
      return;
    }
    case 'tick': {
      pen(ctx, colour, line);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(mx, my - s * 1.15);
        ctx.lineTo(mx, my + s * 1.15);
      } else {
        ctx.moveTo(mx - s * 1.15, my);
        ctx.lineTo(mx + s * 1.15, my);
      }
      ctx.stroke();
      // Stops at both ends, so the tick reads as a bar and not as a nick in
      // the rule it crosses.
      const ends: Array<[number, number]> = horizontal
        ? [[mx, my - s * 1.15], [mx, my + s * 1.15]]
        : [[mx - s * 1.15, my], [mx + s * 1.15, my]];
      for (const [px, py] of ends) dot(ctx, px, py, line * 0.9, colour);
      return;
    }
    case 'pair': {
      pen(ctx, colour, line * 0.85);
      const off = s * 1.5;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(mx - off, my - s);
        ctx.lineTo(mx - off, my + s);
        ctx.moveTo(mx + off, my - s);
        ctx.lineTo(mx + off, my + s);
      } else {
        ctx.moveTo(mx - s, my - off);
        ctx.lineTo(mx + s, my - off);
        ctx.moveTo(mx - s, my + off);
        ctx.lineTo(mx + s, my + off);
      }
      ctx.stroke();
      lozengeMark(ctx, mx, my, s * 0.72, colour);
      return;
    }
    case 'arc': {
      // A fan: two continuous arcs, one inside the other. It opens toward the
      // middle of the board — the
      // first cut used one angle for all four sides, so the fan at the head
      // pointed off the board while the one at the tail pointed into it.
      const inward = horizontal
        ? dir > 0
          ? 0
          : Math.PI
        : dir > 0
          ? Math.PI * 1.5
          : Math.PI * 0.5;
      pen(ctx, colour, line * 0.9);
      ctx.beginPath();
      ctx.arc(mx, my, s * 1.35, inward, inward + Math.PI);
      ctx.stroke();
      pen(ctx, colour, line * 0.6);
      ctx.beginPath();
      ctx.arc(mx, my, s * 0.78, inward, inward + Math.PI);
      ctx.stroke();
      return;
    }
  }
}

function paintFrame(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  style: number,
  colour: string,
  /** The flat tone a `band` frame's border is filled in. */
  bandFill: string,
  detail: boolean,
  seed: number,
): void {
  const spec = FRAMES[normalizeCoverFrameIndex(style)]!;
  const m = Math.min(w, h);
  const base = Math.max(1, m * 0.012);
  const gap = m * 0.042;

  /**
   * The band, drawn as a band.
   *
   * It used to be two traced rects and one `fill('evenodd')`, which never drew
   * a border at all: `wobbleRect` opens a fresh path, so the second trace threw
   * the first away and the even-odd fill flooded the WHOLE panel with the frame
   * colour at 0.16 alpha. Every one of the ten banded frames therefore painted
   * the same picture — a board a shade lighter, with the covering's grain
   * washed out under it — and the sheet showed ten names and one entry.
   *
   * The fix is also the simpler drawing: the gap between rule 0 and rule 1 IS a
   * stroke of width `gap` down the middle of that gap, so one stroked path in a
   * flat opaque tone gives a real border, follows the turn for free, and leaves
   * the two rules to land on its edges.
   */
  if (spec.band === true && spec.rules.length > 1) {
    traceFrameRect(ctx, x + gap / 2, y + gap / 2, w - gap, h - gap, spec.turn, seed + 3);
    ctx.strokeStyle = bandFill;
    ctx.lineWidth = gap;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  spec.rules.forEach((weight, i) => {
    const g = gap * i;
    if (w - g * 2 < base * 6 || h - g * 2 < base * 6) return;
    traceFrameRect(ctx, x + g, y + g, w - g * 2, h - g * 2, spec.turn, seed + i * 7);
    pen(ctx, colour, base * weight);
    ctx.stroke();
  });

  if (!detail) return;

  // Tools are struck on the INNERMOST rule, and big enough to be a tool.
  //
  // 0.022 of the frame's short side is two pixels on the studio preview, which
  // is why fifty frames sorted into six pictures there: a two-pixel ring, dot,
  // stud and lozenge are one two-pixel speck. 0.048 is a mark a reader can name
  // at 160px and an ornament at pull-out size.
  const s = m * 0.048;
  const inner = gap * Math.max(0, spec.rules.length - 1);
  // …and pushed in far enough to clear the turn. A mark at the geometric corner
  // of a `round` frame floats outside its own rule.
  const off = inner + frameTurnRadius(spec.turn, m) * 0.34 + s * 0.55;

  for (const [cx, cy, sx, sy] of [
    [x + off, y + off, 1, 1],
    [x + w - off, y + off, -1, 1],
    [x + w - off, y + h - off, -1, -1],
    [x + off, y + h - off, 1, -1],
  ] as const) {
    paintFrameCorner(
      ctx,
      spec.corner,
      cx,
      cy,
      s,
      colour,
      base,
      sx,
      sy,
      frameToolTier(spec),
    );
  }

  for (const [mx, my, horiz, dir] of [
    [x + w / 2, y + inner, true, 1],
    [x + w / 2, y + h - inner, true, -1],
    [x + inner, y + h / 2, false, 1],
    [x + w - inner, y + h / 2, false, -1],
  ] as const) {
    paintFrameSide(ctx, spec.side, mx, my, s, colour, base, horiz, dir);
  }
}

/**
 * The title compartment used when the board's centre tool is the Crown.
 *
 * This is one authored programme, not another material pattern. Historic
 * state bindings organise the eye around a central blazon: a ruled perimeter,
 * a deliberate title field, then the crowned seal and its laurel. The Met's
 * 1624 Royal Stuart binding is the useful compositional reference here — its
 * richness comes from hierarchy around one device, not from filling every
 * inch of the ground:
 * https://www.metmuseum.org/art/collection/search/228992
 *
 * Two interrupted fillets and inward-facing fleurons make direct gilt title
 * lettering feel bound into that hierarchy. They deliberately leave the
 * leather between title and seal empty; quiet dyed ground is part of the
 * composition, not unfinished space.
 */
function paintCrownTitleCompartment(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  seed: number,
): void {
  const unit = Math.min(w, h * 4);
  const line = Math.max(0.8, unit * 0.008);
  const cx = x + w / 2;
  const left = x + w * 0.035;
  const right = x + w * 0.965;
  const gap = Math.max(unit * 0.065, w * 0.075);
  const flourish = unit * 0.046;

  const divider = (cy: number, inward: 1 | -1, k: number): void => {
    // The heavy rule and its fine companion are a proper binder's fillet. Both
    // stop at the central tool instead of running behind it.
    for (const [offset, weight] of [
      [0, 1],
      [inward * line * 2.25, 0.52],
    ] as const) {
      stroke(ctx, left, cy + offset, cx - gap, cy + offset, colour, line * weight, seed + k + offset * 10);
      stroke(ctx, cx + gap, cy + offset, right, cy + offset, colour, line * weight, seed + k + 1 + offset * 10);
    }

    // A compact three-leaf palmette. Filled leaves survive at held-book size;
    // pips or dots would put the rejected spotty language straight back in.
    const base = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (const a of [-1, 0, 1] as const) {
      petal(
        ctx,
        cx,
        cy,
        base + a * 0.58,
        flourish * (a === 0 ? 1.18 : 0.96),
        flourish * 0.34,
        colour,
        a * 0.16,
      );
    }
    lozengeMark(ctx, cx, cy, flourish * 0.24, colour);

    // One curled terminal at either end turns a line into intentional tooling
    // without repeating a motif across the field.
    pen(ctx, colour, line * 0.72);
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.quadraticCurveTo(left - flourish * 0.8, cy, left - flourish * 0.72, cy + inward * flourish * 0.72);
    ctx.moveTo(right, cy);
    ctx.quadraticCurveTo(right + flourish * 0.8, cy, right + flourish * 0.72, cy + inward * flourish * 0.72);
    ctx.stroke();
  };

  divider(y - h * 0.24, 1, 0);
  divider(y + h * 1.24, -1, 11);
}

/**
 * The authored finishing programme surrounding one unified binder's stamp.
 *
 * This is deliberately semantic rather than `kind % n`. A Crown needs the
 * open architecture of a state binding, while an Acorn belongs to an oak
 * sprig. Folding distinct identities through anonymous circles was how a
 * curated vocabulary became clip art wearing the same badge.
 */
export type CoverEmblemProgramme =
  | 'lozenge-fleuron'
  | 'laurel-branch'
  | 'stellar-palmette'
  | 'acanthus-arabesque'
  | 'solar-palms'
  | 'upright-fleuron'
  | 'oak-sprig'
  | 'thistle-bloom'
  | 'open-state-crown'
  | 'rosette-arabesque'
  | 'broad-fleur-de-lis'
  | 'ivy-knot'
  | 'oak-acanthus-volutes'
  | 'wheat-saltire'
  | 'split-pomegranate'
  | 'open-tulip'
  | 'pinecone-needles'
  | 'anthemion-fan'
  | 'fern-palmette'
  | 'ginkgo-fans';

const COVER_EMBLEM_PROGRAMMES: Readonly<Record<number, CoverEmblemProgramme>> = {
  0: 'lozenge-fleuron',
  1: 'laurel-branch',
  2: 'stellar-palmette',
  3: 'acanthus-arabesque',
  5: 'solar-palms',
  12: 'upright-fleuron',
  13: 'oak-sprig',
  14: 'thistle-bloom',
  20: 'open-state-crown',
  23: 'rosette-arabesque',
  26: 'broad-fleur-de-lis',
  27: 'ivy-knot',
  28: 'oak-acanthus-volutes',
  29: 'wheat-saltire',
  30: 'split-pomegranate',
  31: 'open-tulip',
  38: 'pinecone-needles',
  43: 'anthemion-fan',
  56: 'fern-palmette',
  57: 'ginkgo-fans',
};

/** Per-programme optical scale: open linework needs more board than a badge. */
const COVER_EMBLEM_DEVICE_SCALES: Readonly<Record<CoverEmblemProgramme, number>> = {
  'lozenge-fleuron': 1.34,
  'laurel-branch': 1.28,
  'stellar-palmette': 1.36,
  'acanthus-arabesque': 1.24,
  'solar-palms': 1.3,
  'upright-fleuron': 1.16,
  'oak-sprig': 1.22,
  'thistle-bloom': 1.18,
  'open-state-crown': 1.2,
  'rosette-arabesque': 1.2,
  'broad-fleur-de-lis': 1.18,
  'ivy-knot': 1.22,
  'oak-acanthus-volutes': 1.24,
  'wheat-saltire': 1.22,
  'split-pomegranate': 1.22,
  'open-tulip': 1.18,
  'pinecone-needles': 1.22,
  'anthemion-fan': 1.2,
  'fern-palmette': 1.24,
  'ginkgo-fans': 1.24,
};

/** The actual cover-finishing programme reached by a persisted ornament id. */
export function coverEmblemProgramme(kind: number): CoverEmblemProgramme {
  return COVER_EMBLEM_PROGRAMMES[normalizeCoverEmblemIndex(kind)] ?? 'lozenge-fleuron';
}

/** A paired S-scroll used as a base, never as an enclosing badge. */
function paintOpenScrollBase(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
  width = 1,
): void {
  pen(ctx, colour, line * 0.72);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + side * r * 0.08, cy);
    ctx.bezierCurveTo(
      cx + side * r * 0.48,
      cy + r * 0.22,
      cx + side * r * 1.08 * width,
      cy + r * 0.16,
      cx + side * r * 1.24 * width,
      cy - r * 0.12,
    );
    ctx.bezierCurveTo(
      cx + side * r * 1.36 * width,
      cy - r * 0.34,
      cx + side * r * 1.12 * width,
      cy - r * 0.42,
      cx + side * r * 0.94 * width,
      cy - r * 0.28,
    );
    ctx.stroke();
  }
  lozengeMark(ctx, cx, cy + r * 0.02, r * 0.16, colour);
}

/** A short interrupted double fillet: structure without another container. */
function paintCentrepieceFillet(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
  half = 1.32,
): void {
  for (const [dy, weight] of [[0, 0.8], [r * 0.16, 0.44]] as const) {
    stroke(ctx, cx - r * half, cy + dy, cx - r * 0.28, cy + dy, colour, line * weight, 311 + dy);
    stroke(ctx, cx + r * 0.28, cy + dy, cx + r * half, cy + dy, colour, line * weight, 317 + dy);
  }
  petal(ctx, cx, cy + r * 0.08, -Math.PI / 2, r * 0.34, r * 0.13, colour);
}

/**
 * Two short lateral pallets give a small centre tool command of the lower
 * board without drawing a box around it. The turned terminals are deliberately
 * continuous curves—no studs, dots or row of repeated marks.
 */
function paintLateralFillets(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
  inner = 0.9,
  outer = 1.7,
): void {
  for (const [dy, weight, turn] of [
    [-r * 0.09, 0.78, -1],
    [r * 0.09, 0.44, 1],
  ] as const) {
    for (const side of [-1, 1] as const) {
      stroke(
        ctx,
        cx + side * r * inner,
        cy + dy,
        cx + side * r * outer,
        cy + dy,
        colour,
        line * weight,
        353 + side * 7 + dy,
      );
      pen(ctx, colour, line * weight * 0.8);
      ctx.beginPath();
      ctx.moveTo(cx + side * r * outer, cy + dy);
      ctx.quadraticCurveTo(
        cx + side * r * (outer + 0.24),
        cy + dy,
        cx + side * r * (outer + 0.2),
        cy + dy + turn * r * 0.28,
      );
      ctx.stroke();
    }
  }
}

/**
 * The Welcome Crown as an open piece of bookbinder's tooling.
 *
 * There is intentionally no shield, oval, roundel or filled ground here. The
 * former Crown was a pictogram placed on a dark escutcheon inside two rings;
 * at held-book size it read as a badge pasted onto the cover. This design is
 * built the way a centrepiece block is composed: one bowed circlet and three
 * broad leaf finials. The title fillets around it belong to the board's
 * finishing programme, not to a crest or wreath welded onto the crown. One
 * gold ink describes all of it.
 *
 * The construction follows the historical finishing distinction between a
 * larger blocked centrepiece and the individual heated tools used for fillets
 * and leaves, rather than borrowing the visual grammar of a modern crest icon:
 * https://manuscriptsandmore.liverpool.ac.uk/g-is-for-gilt-and-gold/
 * https://www.vam.ac.uk/blog/museum-life/tradition-and-transformation-in-19th-century-bookbinding
 */
function paintOpenStateCrown(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  colour: string,
): void {
  const bandTop = cy + r * 0.1;
  const bandBottom = cy + r * 0.52;
  const left = cx - r;
  const right = cx + r;

  // One continuous block unites the bowed circlet and three leaf points. The
  // former detached teardrops looked like candles sitting on a shelf; these
  // wide curved valleys make the crown recognisable from silhouette alone.
  ctx.beginPath();
  ctx.moveTo(left, bandTop);
  ctx.quadraticCurveTo(cx - r * 0.94, cy - r * 0.26, cx - r * 0.76, cy - r * 0.56);
  ctx.quadraticCurveTo(cx - r * 0.54, cy - r * 0.3, cx - r * 0.34, bandTop);
  ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.34, cx, cy - r * 0.92);
  ctx.quadraticCurveTo(cx + r * 0.2, cy - r * 0.34, cx + r * 0.34, bandTop);
  ctx.quadraticCurveTo(cx + r * 0.54, cy - r * 0.3, cx + r * 0.76, cy - r * 0.56);
  ctx.quadraticCurveTo(cx + r * 0.94, cy - r * 0.26, right, bandTop);
  ctx.lineTo(right - r * 0.08, bandBottom);
  ctx.quadraticCurveTo(cx, bandBottom + r * 0.08, left + r * 0.08, bandBottom);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();

}

/**
 * One purpose-cut front-cover tool.
 *
 * These are not the shelf-spine pictograms enlarged. A large board needs open
 * linework, recognisable silhouette and a physical finishing logic: engraved
 * outline blocks, leaf tools and short fillets. Keeping this painter local to
 * covers also means a future shelf-scale simplification cannot silently turn
 * the front of every book back into a row of app icons.
 */
function paintCoverCentreTool(
  ctx: FlatCtx,
  programme: Exclude<CoverEmblemProgramme, 'open-state-crown'>,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
): void {
  const openLeaf = (
    baseX: number,
    baseY: number,
    tipX: number,
    tipY: number,
    width: number,
    weight = 0.68,
  ): void => {
    const dx = tipX - baseX;
    const dy = tipY - baseY;
    const length = Math.max(0.01, Math.hypot(dx, dy));
    const nx = (-dy / length) * width;
    const ny = (dx / length) * width;
    const mx = baseX + dx * 0.48;
    const my = baseY + dy * 0.48;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(mx + nx, my + ny, tipX, tipY);
    ctx.quadraticCurveTo(mx - nx, my - ny, baseX, baseY);
    ctx.closePath();
    pen(ctx, colour, line * weight);
    ctx.stroke();
  };

  /** A deliberately coarse lobed leaf: six broad cuts survive at true size. */
  const lobedLeaf = (
    baseX: number,
    baseY: number,
    tipX: number,
    tipY: number,
    width: number,
  ): void => {
    const dx = tipX - baseX;
    const dy = tipY - baseY;
    const length = Math.max(0.01, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const point = (t: number, n: number): readonly [number, number] => [
      baseX + ux * length * t + nx * width * n,
      baseY + uy * length * t + ny * width * n,
    ];
    const points = [
      point(0, 0),
      point(0.2, 0.78),
      point(0.34, 0.34),
      point(0.48, 1),
      point(0.62, 0.34),
      point(0.76, 0.7),
      point(1, 0),
      point(0.76, -0.7),
      point(0.62, -0.34),
      point(0.48, -1),
      point(0.34, -0.34),
      point(0.2, -0.78),
    ];
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    stroke(ctx, baseX, baseY, tipX, tipY, colour, line * 0.38, 449 + tipX);
  };

  /** One broad three-lobed ivy leaf, cut as a single binder's stamp. */
  const ivyLeaf = (
    baseX: number,
    baseY: number,
    angle: number,
    size: number,
  ): void => {
    ctx.save();
    ctx.translate(baseX, baseY);
    ctx.rotate(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, size * 0.42);
    ctx.quadraticCurveTo(-size * 0.5, size * 0.2, -size * 0.62, -size * 0.18);
    ctx.quadraticCurveTo(-size * 0.28, -size * 0.18, -size * 0.36, -size * 0.58);
    ctx.quadraticCurveTo(-size * 0.08, -size * 0.4, 0, -size * 0.76);
    ctx.quadraticCurveTo(size * 0.08, -size * 0.4, size * 0.36, -size * 0.58);
    ctx.quadraticCurveTo(size * 0.28, -size * 0.18, size * 0.62, -size * 0.18);
    ctx.quadraticCurveTo(size * 0.5, size * 0.2, 0, size * 0.42);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.restore();
  };

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (programme) {
    case 'lozenge-fleuron': {
      // Two bowed stems interlace into one foliate lozenge; four leaves make
      // it a binder's tool rather than a nested-diamond app icon.
      pen(ctx, colour, line * 0.76);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 1.02);
        ctx.bezierCurveTo(
          cx + side * r * 0.82,
          cy - r * 0.62,
          cx + side * r * 0.86,
          cy + r * 0.5,
          cx,
          cy + r * 1.02,
        );
        ctx.stroke();
      }
      openLeaf(cx - r * 0.56, cy - r * 0.08, cx - r * 1.02, cy - r * 0.16, r * 0.2);
      openLeaf(cx + r * 0.56, cy + r * 0.08, cx + r * 1.02, cy + r * 0.16, r * 0.2);
      openLeaf(cx, cy - r * 0.55, cx, cy - r * 1.1, r * 0.18);
      openLeaf(cx, cy + r * 0.55, cx, cy + r * 1.1, r * 0.18);
      lozengeOutline(ctx, cx, cy, r * 0.28, colour, line * 0.64);
      break;
    }

    case 'laurel-branch': {
      // One broad, bowed branch rather than a closed wreath. Six large smooth
      // leaves make the plant legible at true size; the previous hairline
      // outlines collapsed into one crest-like diagonal scratch.
      pen(ctx, colour, line * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.18, cy + r * 0.78);
      ctx.bezierCurveTo(
        cx - r * 0.42,
        cy + r * 0.48,
        cx + r * 0.38,
        cy - r * 0.3,
        cx + r * 1.16,
        cy - r * 0.82,
      );
      ctx.stroke();
      // A shorter parallel cut gives the branch physical breadth instead of
      // adding fragile veins to every leaf.
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.98, cy + r * 0.7);
      ctx.bezierCurveTo(
        cx - r * 0.34,
        cy + r * 0.42,
        cx + r * 0.34,
        cy - r * 0.2,
        cx + r * 0.94,
        cy - r * 0.68,
      );
      ctx.stroke();
      for (const [x, y, angle, length, width] of [
        [-0.72, 0.5, -1.88, 0.62, 0.2],
        [-0.62, 0.44, 0.54, 0.58, 0.19],
        [-0.12, 0.06, -1.88, 0.68, 0.22],
        [0, -0.04, 0.54, 0.64, 0.21],
        [0.5, -0.42, -1.88, 0.62, 0.2],
        [0.62, -0.5, 0.54, 0.56, 0.18],
      ] as const) {
        petal(
          ctx,
          cx + r * x,
          cy + r * y,
          angle,
          r * length,
          r * width,
          colour,
        );
      }
      petal(ctx, cx + r * 1.02, cy - r * 0.72, -0.58, r * 0.5, r * 0.17, colour);
      break;
    }

    case 'stellar-palmette': {
      // An engraved eight-point rosette: open outline, alternating point
      // lengths and a central lozenge. It cannot collapse into the former
      // filled five-point rating star.
      ctx.beginPath();
      for (let i = 0; i < 16; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 8;
        const radius = r * (i % 2 === 0 ? 1 : 0.46);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      pen(ctx, colour, line * 0.7);
      ctx.stroke();
      lozengeOutline(ctx, cx, cy, r * 0.22, colour, line * 0.56);
      break;
    }

    case 'acanthus-arabesque': {
      // An asymmetric scrolling acanthus branch. Three open blade leaves ride
      // one doubled S-stem; abandoning bilateral heads removes the moustache,
      // birds and horseshoe readings at true size.
      pen(ctx, colour, line * 0.72);
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.18, cy + r * 0.46);
      ctx.bezierCurveTo(
        cx - r * 0.62,
        cy - r * 0.72,
        cx + r * 0.28,
        cy + r * 0.72,
        cx + r * 1.18,
        cy - r * 0.42,
      );
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.94, cy + r * 0.42);
      ctx.bezierCurveTo(
        cx - r * 0.48,
        cy - r * 0.48,
        cx + r * 0.22,
        cy + r * 0.5,
        cx + r * 0.9,
        cy - r * 0.36,
      );
      ctx.stroke();
      openLeaf(cx - r * 0.68, cy + r * 0.02, cx - r * 1.04, cy - r * 0.82, r * 0.3);
      openLeaf(cx - r * 0.04, cy + r * 0.2, cx + r * 0.28, cy - r * 0.82, r * 0.32);
      openLeaf(cx + r * 0.62, cy - r * 0.02, cx + r * 1.08, cy + r * 0.52, r * 0.28);
      ivyLeaf(cx - r * 1.02, cy + r * 0.34, 2.62, r * 0.34);
      break;
    }

    case 'solar-palms': {
      // Twelve separate rays around an open lozenge. There is deliberately no
      // filled disc or face-like ring, which is what made Sun read as emoji.
      pen(ctx, colour, line * 0.62);
      ctx.beginPath();
      for (let i = 0; i < 12; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 6;
        const inner = r * 0.52;
        const outer = r * (i % 2 === 0 ? 1.05 : 0.88);
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      }
      ctx.stroke();
      lozengeOutline(ctx, cx, cy, r * 0.34, colour, line * 0.72);
      break;
    }

    case 'upright-fleuron': {
      stroke(ctx, cx, cy + r * 0.92, cx, cy - r * 0.16, colour, line * 0.7, 461);
      petal(ctx, cx, cy - r * 0.02, -Math.PI / 2, r * 0.96, r * 0.28, colour);
      petal(ctx, cx, cy + r * 0.22, -Math.PI * 0.78, r * 0.72, r * 0.23, colour, -0.08);
      petal(ctx, cx, cy + r * 0.22, -Math.PI * 0.22, r * 0.72, r * 0.23, colour, 0.08);
      stroke(ctx, cx - r * 0.58, cy + r * 0.48, cx + r * 0.58, cy + r * 0.48, colour, line * 0.7, 463);
      break;
    }

    case 'oak-sprig': {
      // One unmistakable acorn hangs between two coarse, deeply lobed oak
      // leaves. At true size the old three filled leaves became diamonds;
      // this larger triad keeps fruit, cap and lobes separately legible.
      pen(ctx, colour, line * 0.68);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.94);
      ctx.quadraticCurveTo(cx - r * 0.08, cy + r * 0.2, cx, cy - r * 0.42);
      ctx.moveTo(cx, cy + r * 0.24);
      ctx.quadraticCurveTo(cx - r * 0.32, cy - r * 0.02, cx - r * 0.9, cy - r * 0.42);
      ctx.moveTo(cx, cy + r * 0.24);
      ctx.quadraticCurveTo(cx + r * 0.32, cy - r * 0.02, cx + r * 0.9, cy - r * 0.42);
      ctx.stroke();
      lobedLeaf(cx - r * 0.24, cy + r * 0.02, cx - r * 1.16, cy - r * 0.64, r * 0.28);
      lobedLeaf(cx + r * 0.24, cy + r * 0.02, cx + r * 1.16, cy - r * 0.64, r * 0.28);
      petal(ctx, cx, cy + r * 0.06, Math.PI / 2, r * 0.66, r * 0.3, colour);
      stroke(ctx, cx - r * 0.32, cy - r * 0.04, cx + r * 0.32, cy - r * 0.04, colour, line * 0.82, 471);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy - r * 0.04);
      ctx.quadraticCurveTo(cx, cy - r * 0.28, cx + r * 0.3, cy - r * 0.04);
      ctx.stroke();
      break;
    }

    case 'thistle-bloom': {
      // A single architectural thistle: one sturdy stem, a broad engraved
      // flower and two cut leaves. Sparse large bracts survive true size much
      // better than the former spray of needle-like spikes.
      stroke(ctx, cx, cy + r * 1.04, cx, cy + r * 0.1, colour, line * 0.72, 481);
      openLeaf(cx, cy + r * 0.72, cx - r * 0.82, cy + r * 0.32, r * 0.28);
      openLeaf(cx, cy + r * 0.58, cx + r * 0.88, cy + r * 0.12, r * 0.3);
      pen(ctx, colour, line * 0.72);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.58, cy - r * 0.2);
      ctx.quadraticCurveTo(cx - r * 0.54, cy - r * 0.7, cx - r * 0.28, cy - r * 0.92);
      ctx.quadraticCurveTo(cx - r * 0.12, cy - r * 0.7, cx, cy - r * 1.1);
      ctx.quadraticCurveTo(cx + r * 0.12, cy - r * 0.7, cx + r * 0.28, cy - r * 0.92);
      ctx.quadraticCurveTo(cx + r * 0.54, cy - r * 0.7, cx + r * 0.58, cy - r * 0.2);
      ctx.quadraticCurveTo(cx, cy + r * 0.18, cx - r * 0.58, cy - r * 0.2);
      ctx.stroke();
      for (const x of [-0.34, 0, 0.34]) {
        petal(ctx, cx + r * x, cy - r * 0.1, -Math.PI / 2, r * 0.54, r * 0.17, colour);
      }
      break;
    }

    case 'rosette-arabesque': {
      // Six broad outlined petals on one open ring. No jagged central star,
      // duplicate halo or filled coin survives at shelf preview size.
      pen(ctx, colour, line * 0.68);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.27, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 3;
        const baseX = cx + Math.cos(angle) * r * 0.22;
        const baseY = cy + Math.sin(angle) * r * 0.22;
        openLeaf(
          baseX,
          baseY,
          cx + Math.cos(angle) * r * 0.98,
          cy + Math.sin(angle) * r * 0.98,
          r * 0.27,
          0.7,
        );
      }
      break;
    }

    case 'broad-fleur-de-lis': {
      // The waist is deliberately low and the side lobes materially wider
      // than the centre lance. That silhouette cannot collapse into a cross,
      // sword or ankh when the cover is reduced to its Studio card.
      pen(ctx, colour, line * 0.76);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.08);
      ctx.quadraticCurveTo(cx - r * 0.34, cy - r * 0.54, cx - r * 0.18, cy + r * 0.08);
      ctx.quadraticCurveTo(cx - r * 0.66, cy - r * 0.5, cx - r * 1.12, cy - r * 0.22);
      ctx.quadraticCurveTo(cx - r * 0.88, cy + r * 0.3, cx - r * 0.34, cy + r * 0.38);
      ctx.lineTo(cx - r * 0.3, cy + r * 0.58);
      ctx.quadraticCurveTo(cx, cy + r * 0.48, cx + r * 0.3, cy + r * 0.58);
      ctx.lineTo(cx + r * 0.34, cy + r * 0.38);
      ctx.quadraticCurveTo(cx + r * 0.88, cy + r * 0.3, cx + r * 1.12, cy - r * 0.22);
      ctx.quadraticCurveTo(cx + r * 0.66, cy - r * 0.5, cx + r * 0.18, cy + r * 0.08);
      ctx.quadraticCurveTo(cx + r * 0.34, cy - r * 0.54, cx, cy - r * 1.08);
      ctx.stroke();
      stroke(ctx, cx - r * 0.42, cy + r * 0.4, cx + r * 0.42, cy + r * 0.4, colour, line * 0.82, 491);
      stroke(ctx, cx - r * 0.34, cy + r * 0.62, cx + r * 0.34, cy + r * 0.62, colour, line * 0.58, 493);
      petal(ctx, cx, cy + r * 0.74, Math.PI / 2, r * 0.34, r * 0.14, colour);
      break;
    }

    case 'ivy-knot': {
      // The persisted programme id remains `ivy-knot`, but the live shared
      // semantic is an honest paired-ivy tool: two broad lobed leaves on
      // upright bowed stems, with only low tendrils for binder's movement.
      pen(ctx, colour, line * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.92);
      ctx.quadraticCurveTo(cx - r * 0.12, cy + r * 0.04, cx - r * 0.58, cy - r * 0.42);
      ctx.moveTo(cx, cy + r * 0.92);
      ctx.quadraticCurveTo(cx + r * 0.12, cy + r * 0.04, cx + r * 0.58, cy - r * 0.42);
      ctx.stroke();
      ivyLeaf(cx - r * 0.58, cy - r * 0.42, -2.3, r * 0.78);
      ivyLeaf(cx + r * 0.58, cy - r * 0.42, -0.84, r * 0.78);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.06, cy + r * 0.56);
      ctx.quadraticCurveTo(cx - r * 0.56, cy + r * 0.82, cx - r * 0.82, cy + r * 0.5);
      ctx.moveTo(cx + r * 0.06, cy + r * 0.56);
      ctx.quadraticCurveTo(cx + r * 0.56, cy + r * 0.82, cx + r * 0.82, cy + r * 0.5);
      ctx.stroke();
      break;
    }

    case 'oak-acanthus-volutes': {
      // A horizontal pair of deeply rolled C-volutes with coarse oak leaves
      // following their tangents. The open centres are visibly scrollwork;
      // no paired bead terminals or shared U remains to suggest a face.
      pen(ctx, colour, line * 0.72);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.06, cy + r * 0.34);
        ctx.bezierCurveTo(
          cx + side * r * 0.34,
          cy - r * 0.46,
          cx + side * r * 1.2,
          cy - r * 0.34,
          cx + side * r * 1.08,
          cy + r * 0.34,
        );
        ctx.bezierCurveTo(
          cx + side * r * 1.02,
          cy + r * 0.66,
          cx + side * r * 0.66,
          cy + r * 0.58,
          cx + side * r * 0.72,
          cy + r * 0.24,
        );
        ctx.stroke();
        lobedLeaf(
          cx + side * r * 0.7,
          cy - r * 0.18,
          cx + side * r * 1.18,
          cy - r * 0.72,
          r * 0.22,
        );
      }
      petal(ctx, cx, cy + r * 0.34, Math.PI / 2, r * 0.46, r * 0.18, colour);
      break;
    }

    case 'wheat-saltire': {
      // Persisted programme id aside, the live semantic is a wheat sheaf:
      // two bowed stalks cross only below a strong binding tie. Each upper
      // half is a dense six-grain ear, so the botanical heads—not an X—own
      // the silhouette at true pixels.
      pen(ctx, colour, line * 0.58);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - side * r * 0.22, cy + r * 0.92);
        ctx.quadraticCurveTo(
          cx + side * r * 0.04,
          cy + r * 0.22,
          cx + side * r * 0.48,
          cy - r * 1.06,
        );
        ctx.stroke();
        for (const [x, y, turn] of [
          [0.22, -0.18, -1],
          [0.3, -0.18, 1],
          [0.3, -0.46, -1],
          [0.4, -0.46, 1],
          [0.4, -0.74, -1],
          [0.5, -0.74, 1],
        ] as const) {
          petal(
            ctx,
            cx + side * r * x,
            cy + r * y,
            side < 0 ? (turn < 0 ? -2.48 : -0.66) : (turn < 0 ? -0.66 : -2.48),
            r * 0.44,
            r * 0.19,
            colour,
          );
        }
        petal(ctx, cx + side * r * 0.48, cy - r * 0.88, -Math.PI / 2, r * 0.48, r * 0.18, colour);
      }
      stroke(ctx, cx - r * 0.5, cy + r * 0.56, cx + r * 0.5, cy + r * 0.56, colour, line, 507);
      stroke(ctx, cx - r * 0.34, cy + r * 0.72, cx + r * 0.34, cy + r * 0.72, colour, line * 0.66, 509);
      break;
    }

    case 'split-pomegranate': {
      // A tall, open split fruit with one vertical seed seam. Removing paired
      // side seeds eliminates the eye/bug face; the high three-leaf calyx and
      // open foot keep it botanical rather than coin- or hardware-like.
      pen(ctx, colour, line * 0.72);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx + side * r * 0.1, cy - r * 0.48);
        ctx.quadraticCurveTo(
          cx + side * r * 0.9,
          cy - r * 0.42,
          cx + side * r * 0.76,
          cy + r * 0.34,
        );
        ctx.quadraticCurveTo(
          cx + side * r * 0.66,
          cy + r * 0.86,
          cx + side * r * 0.16,
          cy + r * 0.72,
        );
        ctx.stroke();
      }
      for (const [y, size] of [[-0.08, 0.34], [0.24, 0.36], [0.54, 0.32]] as const) {
        petal(ctx, cx, cy + r * y, Math.PI / 2, r * size, r * 0.15, colour);
      }
      petal(ctx, cx - r * 0.18, cy - r * 0.46, -2.1, r * 0.58, r * 0.19, colour);
      petal(ctx, cx, cy - r * 0.5, -Math.PI / 2, r * 0.7, r * 0.2, colour);
      petal(ctx, cx + r * 0.18, cy - r * 0.46, -1.04, r * 0.58, r * 0.19, colour);
      stroke(ctx, cx - r * 0.5, cy + r * 0.84, cx - r * 0.12, cy + r * 0.7, colour, line * 0.56, 513);
      stroke(ctx, cx + r * 0.5, cy + r * 0.84, cx + r * 0.12, cy + r * 0.7, colour, line * 0.56, 515);
      break;
    }

    case 'open-tulip': {
      // One outlined cup with three distinct upper petals, carried by a short
      // stem and two broad leaves. The open base avoids a goblet silhouette.
      pen(ctx, colour, line * 0.74);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.68, cy - r * 0.48);
      ctx.quadraticCurveTo(cx - r * 0.64, cy + r * 0.12, cx, cy + r * 0.24);
      ctx.quadraticCurveTo(cx + r * 0.64, cy + r * 0.12, cx + r * 0.68, cy - r * 0.48);
      ctx.quadraticCurveTo(cx + r * 0.36, cy - r * 0.26, cx + r * 0.22, cy - r * 0.9);
      ctx.quadraticCurveTo(cx, cy - r * 0.52, cx - r * 0.22, cy - r * 0.9);
      ctx.quadraticCurveTo(cx - r * 0.36, cy - r * 0.26, cx - r * 0.68, cy - r * 0.48);
      ctx.stroke();
      stroke(ctx, cx, cy + r * 0.22, cx, cy + r * 1.02, colour, line * 0.72, 511);
      openLeaf(cx, cy + r * 0.72, cx - r * 0.78, cy + r * 0.42, r * 0.24);
      openLeaf(cx, cy + r * 0.62, cx + r * 0.82, cy + r * 0.3, r * 0.24);
      petal(ctx, cx, cy - r * 0.18, -Math.PI / 2, r * 0.48, r * 0.15, colour);
      break;
    }

    case 'pinecone-needles': {
      // One cone hangs below the right half of a bowed pine bough while a
      // single needle fan opens to the left. The intentionally asymmetric
      // silhouette cannot collapse into an insect or centred lozenge.
      pen(ctx, colour, line * 0.68);
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.18, cy - r * 0.2);
      ctx.quadraticCurveTo(cx - r * 0.08, cy - r * 0.58, cx + r * 1.16, cy - r * 0.18);
      ctx.stroke();
      for (const [x, y, tx, ty] of [
        [-0.78, -0.28, -1.3, -0.72],
        [-0.7, -0.3, -1.34, -0.28],
        [-0.62, -0.34, -1.2, 0.18],
        [-0.48, -0.38, -0.9, 0.3],
      ] as const) {
        stroke(
          ctx,
          cx + r * x,
          cy + r * y,
          cx + r * tx,
          cy + r * ty,
          colour,
          line * 0.5,
          521 + x * 10,
        );
      }
      stroke(ctx, cx + r * 0.44, cy - r * 0.4, cx + r * 0.4, cy - r * 0.04, colour, line * 0.66, 527);
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.4, cy - r * 0.04);
      ctx.quadraticCurveTo(cx - r * 0.02, cy + r * 0.28, cx + r * 0.06, cy + r * 0.92);
      ctx.quadraticCurveTo(cx + r * 0.4, cy + r * 1.26, cx + r * 0.74, cy + r * 0.92);
      ctx.quadraticCurveTo(cx + r * 0.82, cy + r * 0.28, cx + r * 0.4, cy - r * 0.04);
      ctx.stroke();
      for (const [x, y] of [
        [0.4, 0.24],
        [0.24, 0.54],
        [0.56, 0.54],
        [0.4, 0.82],
      ] as const) {
        petal(ctx, cx + r * x, cy + r * y, Math.PI / 2, r * 0.38, r * 0.18, colour);
      }
      break;
    }

    case 'anthemion-fan': {
      // Five open anthemion leaves rise independently above two low volutes.
      // There is no filled centre point or horizontal circlet, so the fan
      // cannot become a second crown when reduced.
      for (const [angle, length, width] of [
        [-2.88, 0.98, 0.24],
        [-2.18, 1.1, 0.23],
        [-Math.PI / 2, 1.24, 0.22],
        [-0.96, 1.1, 0.23],
        [-0.26, 0.98, 0.24],
      ] as const) {
        openLeaf(
          cx,
          cy + r * 0.62,
          cx + Math.cos(angle) * r * length,
          cy + r * 0.62 + Math.sin(angle) * r * length,
          r * width,
        );
      }
      paintOpenScrollBase(ctx, cx, cy + r * 0.82, r * 0.62, colour, line, 0.9);
      break;
    }

    case 'fern-palmette': {
      // A split symmetrical fern palmette cut from two bowed rachises. Six
      // broad filled pinnae carry the silhouette; it is neither a lone frond
      // nor a pair of empty lung outlines.
      pen(ctx, colour, line * 0.68);
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(cx, cy + r * 0.88);
        ctx.quadraticCurveTo(
          cx + side * r * 0.76,
          cy + r * 0.08,
          cx + side * r * 0.32,
          cy - r * 1.02,
        );
        ctx.stroke();
        for (const [x, y, tx, ty, width] of [
          [0.18, 0.5, 0.74, 0.3, 0.23],
          [0.38, 0.12, 0.98, -0.08, 0.24],
          [0.4, -0.3, 0.88, -0.66, 0.22],
        ] as const) {
          petal(
            ctx,
            cx + side * r * x,
            cy + r * y,
            Math.atan2(ty - y, side * (tx - x)),
            r * Math.hypot(tx - x, ty - y),
            r * width,
            colour,
          );
        }
      }
      lozengeMark(ctx, cx, cy + r * 0.78, r * 0.16, colour);
      break;
    }

    case 'ginkgo-fans': {
      // Two upward ginkgo fans grow from separate bowed stems. Their broad,
      // notched tops and engraved veins do the reading; no filled bow-tie,
      // antenna or lamp silhouette remains.
      for (const side of [-1, 1] as const) {
        const baseX = cx + side * r * 0.08;
        const baseY = cy + r * 0.9;
        const joinX = cx + side * r * 0.5;
        const joinY = cy - r * 0.08;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(cx + side * r * 0.16, cy + r * 0.24, joinX, joinY);
        ctx.moveTo(joinX, joinY);
        ctx.quadraticCurveTo(cx + side * r * 1.12, cy - r * 0.24, cx + side * r * 0.98, cy - r * 0.9);
        ctx.quadraticCurveTo(cx + side * r * 0.72, cy - r * 0.68, cx + side * r * 0.5, cy - r * 1.02);
        ctx.quadraticCurveTo(cx + side * r * 0.3, cy - r * 0.68, cx + side * r * 0.02, cy - r * 0.88);
        ctx.quadraticCurveTo(cx - side * r * 0.02, cy - r * 0.24, joinX, joinY);
        pen(ctx, colour, line * 0.7);
        ctx.stroke();
        for (const fanX of [0.26, 0.5, 0.74] as const) {
          stroke(
            ctx,
            joinX,
            joinY,
            cx + side * r * fanX,
            cy - r * (0.74 + Math.abs(0.5 - fanX) * 0.36),
            colour,
            line * 0.45,
            531 + side * 8 + fanX,
          );
        }
      }
      lozengeMark(ctx, cx, cy + r * 0.82, r * 0.15, colour);
      break;
    }

  }

  ctx.restore();
}

/** Draw the open authored setting for one non-Crown centre tool. */
function paintEmblemSetting(
  ctx: FlatCtx,
  programme: CoverEmblemProgramme,
  cx: number,
  cy: number,
  r: number,
  colour: string,
  line: number,
): number {
  switch (programme) {
    case 'lozenge-fleuron': {
      paintLateralFillets(ctx, cx, cy, r, colour, line, 1.02, 1.74);
      paintOpenScrollBase(ctx, cx, cy + r * 1.28, r * 0.68, colour, line, 0.82);
      return 0.88;
    }
    case 'laurel-branch':
      return 1.08;
    case 'stellar-palmette': {
      paintLateralFillets(ctx, cx, cy, r, colour, line, 1.08, 1.76);
      paintCentrepieceFillet(ctx, cx, cy + r * 1.28, r * 0.68, colour, line, 1.08);
      return 0.94;
    }
    case 'acanthus-arabesque': {
      paintCentrepieceFillet(ctx, cx, cy + r * 1.18, r * 0.7, colour, line, 1.16);
      return 0.98;
    }
    case 'solar-palms': {
      paintLateralFillets(ctx, cx, cy, r, colour, line, 1.08, 1.78);
      paintOpenScrollBase(ctx, cx, cy + r * 1.28, r * 0.64, colour, line, 0.8);
      return 0.94;
    }
    case 'upright-fleuron': {
      paintLateralFillets(ctx, cx, cy + r * 0.12, r, colour, line, 1.02, 1.68);
      paintOpenScrollBase(ctx, cx, cy + r * 1.32, r * 0.68, colour, line, 0.82);
      return 0.98;
    }
    case 'oak-sprig': {
      return 1.08;
    }
    case 'thistle-bloom': {
      paintLateralFillets(ctx, cx, cy + r * 0.12, r, colour, line, 1, 1.66);
      return 0.98;
    }
    case 'rosette-arabesque': {
      paintLateralFillets(ctx, cx, cy, r, colour, line, 1.04, 1.7);
      paintOpenScrollBase(ctx, cx, cy + r * 1.28, r * 0.66, colour, line, 0.8);
      return 0.96;
    }
    case 'broad-fleur-de-lis': {
      paintLateralFillets(ctx, cx, cy + r * 0.08, r, colour, line, 1.08, 1.72);
      return 0.98;
    }
    case 'ivy-knot': {
      paintCentrepieceFillet(ctx, cx, cy + r * 1.16, r * 0.7, colour, line, 1.12);
      return 0.98;
    }
    case 'oak-acanthus-volutes':
    case 'wheat-saltire':
      return 1.06;
    case 'split-pomegranate':
      return 1.04;
    case 'open-tulip': {
      paintLateralFillets(ctx, cx, cy + r * 0.18, r, colour, line, 0.98, 1.64);
      return 0.98;
    }
    case 'pinecone-needles':
      return 1.04;
    case 'anthemion-fan':
      return 1.02;
    case 'fern-palmette':
    case 'ginkgo-fans':
      return 1.06;
    case 'open-state-crown':
      return 1;
  }
}

/**
 * The centrepiece below the cover title field — the same semantic device the
 * spine wears, enlarged and integrated into an authored binder's programme.
 *
 * The previous compositor put every device on a filled oval with two rings.
 * It was consistent, but consistently badge-like: Star looked like a rating
 * icon on a coin and Crown like a shield logo. These programmes remain one
 * ink, flat and deterministic, but the surrounding strokes now belong to the
 * identity of the tool and stay open to the cloth around them.
 */
function paintMedallion(
  ctx: FlatCtx,
  cx: number,
  cy: number,
  r: number,
  kind: number,
  colour: string,
  /** False once the book is worn enough to have lost its fine tooling. */
  detail: boolean,
): void {
  const k = normalizeCoverEmblemIndex(kind);

  ctx.save();
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const programme = coverEmblemProgramme(k);
  const deviceR = detail ? r * COVER_EMBLEM_DEVICE_SCALES[programme] : r;
  const line = Math.max(1, deviceR * 0.09);
  ctx.lineWidth = Math.max(1, deviceR * 0.16);
  if (programme === 'open-state-crown') {
    if (detail) {
      // The crown is the sole heraldic focal, but it is not a logo floating in
      // empty cloth. Two interrupted state-binding fillets grow out of its
      // circlet and terminate as open returns. The Renaissance perimeter and
      // title dividers can therefore lead into one continuous hierarchy
      // without adding a shield, wreath, second crown or repeated field.
      paintLateralFillets(
        ctx,
        cx,
        cy + deviceR * 0.22,
        deviceR,
        colour,
        line,
        1.08,
        1.82,
      );
    }
    paintOpenStateCrown(ctx, cx, cy - deviceR * 0.08, deviceR, colour);
  } else {
    const scale = detail
      ? paintEmblemSetting(ctx, programme, cx, cy, deviceR, colour, line)
      : 1;
    paintCoverCentreTool(ctx, programme, cx, cy, deviceR * scale, colour, line);
  }
  ctx.restore();
}

/** Everything the label needs to know about the book it belongs to. */
interface LabelSpec {
  style: TitlePlateStyle;
  inset: boolean;
  gilded: boolean;
  /** Reader-owned tooling role, kept separate from the one dark outline. */
  tooling: string | null;
  /** Actual plate/board ground and its legibility-guarded title ink. */
  titleColours: TitleColourResolution;
  /** The board's darker tone, for plates tooled straight onto the binding. */
  dark: string;
  /** The actual board face, used to detect a contrast-forced direct title field. */
  face: string;
  /**
   * The board's own colour taken a step toward the ink — the flat second face
   * used for the sunk panel behind an inset plate and for the offset plate
   * under a paper label. Never a blur, and never derived from a light
   * direction: it is the same "darker face beside a lighter one" the spine
   * strip and the medallion field are.
   */
  sunk: string;
  /** Pale bindings need a label that is not the same cream as the board. */
  paleBoard: boolean;
  /** Which of the fifty hands the title is lettered in. */
  hand: HandSpec;
  seed: number;
  /** Detail scale, only used to keep handwriting above its legibility floor. */
  s: number;
}

/**
 * Set the pen for one hand at one size, and hand back the string to draw.
 *
 * Tracking goes through `ctx.letterSpacing`, which `measureText` honours, so
 * the fit loop below stays correct for a widely-set hand. It is guarded rather
 * than assumed: the property is a recent addition to the 2D context, and a
 * hand that silently sets nothing is better than a throw that takes the whole
 * cover with it.
 */
function setHand(
  ctx: FlatCtx,
  hand: HandSpec,
  stack: string,
  px: number,
  text: string,
  track = hand.track,
): string {
  const slope = hand.slant ? 'italic ' : '';
  // Small caps are uppercase set down a size: none of the five faces carries an
  // sc axis, and faking one by drawing two runs at two sizes would put a seam
  // in the middle of a two-word title.
  const size = hand.caps === 'small' ? px * 0.86 : px;
  ctx.font = `${slope}${hand.weight} ${size.toFixed(1)}px ${stack}`;
  const tracking = track * size;
  if ('letterSpacing' in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking.toFixed(2)}px`;
  }
  return hand.caps === 'none' ? text : text.toUpperCase();
}

interface BrokenCoverTitle {
  lines: readonly string[];
  /** Width of the widest shaped line at the size currently set on `ctx`. */
  maxWidth: number;
  /** Tie-breaker: among equal widest lines, prefer the more even setting. */
  squareWidth: number;
}

interface CoverTitleLayout {
  lines: readonly string[];
  fontPx: number;
  stack: string;
  track: number;
}

/**
 * Break a title on words into exactly `lineCount` non-empty, ordered lines.
 *
 * A greedy wrap makes a label depend on which unusually wide word happens to
 * arrive first. This tiny dynamic programme instead minimises the widest
 * shaped line, then the sum of squared widths. Cover titles are generally two
 * to eight words, so the handful of cached `measureText` calls is both cheap
 * and deterministic.
 */
function balancedCoverTitleLines(
  ctx: FlatCtx,
  text: string,
  lineCount: number,
): BrokenCoverTitle {
  const words = text.split(/\s+/u).filter(Boolean);
  const count = Math.max(1, Math.min(Math.trunc(lineCount), words.length));
  if (count === 1 || words.length === 1) {
    const width = textWidth(ctx, text);
    return { lines: [text], maxWidth: width, squareWidth: width * width };
  }

  const memo = new Map<string, BrokenCoverTitle | null>();
  const solve = (from: number, linesLeft: number): BrokenCoverTitle | null => {
    const key = `${from}:${linesLeft}`;
    if (memo.has(key)) return memo.get(key) ?? null;
    if (linesLeft === 1) {
      const line = words.slice(from).join(' ');
      const width = textWidth(ctx, line);
      const result = { lines: [line], maxWidth: width, squareWidth: width * width };
      memo.set(key, result);
      return result;
    }

    let best: BrokenCoverTitle | null = null;
    // Leave at least one word for every remaining line.
    const lastEnd = words.length - linesLeft + 1;
    for (let end = from + 1; end <= lastEnd; end += 1) {
      const tail = solve(end, linesLeft - 1);
      if (tail === null) continue;
      const line = words.slice(from, end).join(' ');
      const width = textWidth(ctx, line);
      const candidate: BrokenCoverTitle = {
        lines: [line, ...tail.lines],
        maxWidth: Math.max(width, tail.maxWidth),
        squareWidth: width * width + tail.squareWidth,
      };
      if (
        best === null ||
        candidate.maxWidth < best.maxWidth - 0.01 ||
        (
          Math.abs(candidate.maxWidth - best.maxWidth) <= 0.01 &&
          candidate.squareWidth < best.squareWidth
        )
      ) {
        best = candidate;
      }
    }
    memo.set(key, best);
    return best;
  };

  return solve(0, count) ?? balancedCoverTitleLines(ctx, text, 1);
}

/**
 * Find the largest complete-title setting that fits the label.
 *
 * One line remains the natural answer whenever it is large enough. Longer
 * titles may use two or three optically balanced lines. The normal
 * handwriting floor is a preference, not permission to delete the reader's
 * title: only if no complete multiline setting reaches that floor do we set
 * the whole title a little smaller. A final Canvas `maxWidth` guard in the
 * painter protects even a single unbroken pathological word without ever
 * inventing an ellipsis glyph.
 */
function fitCoverTitle(
  ctx: FlatCtx,
  text: string,
  hand: HandSpec,
  stack: string,
  startPx: number,
  floorPx: number,
  maxWidth: number,
  labelHeight: number,
  verticalShare: number,
): CoverTitleLayout {
  const capScale = hand.caps === 'small' ? 0.86 : 1;
  const maxLines = Math.min(3, Math.max(1, text.split(/\s+/u).filter(Boolean).length));

  const solveForTrack = (track: number): CoverTitleLayout => {
    const cased = setHand(ctx, hand, stack, startPx, text, track);
    let best: CoverTitleLayout | null = null;
    let firstComfortable: CoverTitleLayout | null = null;
    for (let lineCount = 1; lineCount <= maxLines; lineCount += 1) {
      const broken = balancedCoverTitleLines(ctx, cased, lineCount);
      const horizontalPx = broken.maxWidth <= maxWidth
        ? startPx
        : (startPx * maxWidth * 0.975) / Math.max(0.01, broken.maxWidth);
      // Text occupies the quiet field above the short finishing rule. The cap
      // is on the whole block, not each baseline, so a second line never
      // crowds the rule or escapes the top of a direct-gilt treatment.
      const verticalPx = (labelHeight * verticalShare) / (lineCount * 1.08 * capScale);
      const fontPx = Math.min(startPx, horizontalPx, verticalPx);
      const candidate: CoverTitleLayout = {
        lines: broken.lines,
        fontPx,
        stack,
        track,
      };
      // Once a setting is comfortably above the handwriting floor, keep the
      // first (and therefore least fragmented) line count that achieves it.
      // Below that bar, additional lines are worth using to rescue legibility.
      if (firstComfortable === null && candidate.fontPx >= floorPx * 1.25) {
        firstComfortable = candidate;
      }
      if (
        best === null ||
        candidate.fontPx > best.fontPx + 0.01 ||
        (
          Math.abs(candidate.fontPx - best.fontPx) <= 0.01 &&
          candidate.lines.length < best.lines.length
        )
      ) {
        best = candidate;
      }
    }
    return firstComfortable ?? best!;
  };

  let best = solveForTrack(hand.track);
  // Loose tracking is decorative. If it alone would force the complete title
  // under the preferred legibility floor, close the setting before shrinking
  // the letters. The historical -0.025em fallback remains the lower bound.
  if (best.fontPx < floorPx && hand.track > -0.025) {
    const compact = solveForTrack(-0.025);
    if (compact.fontPx > best.fontPx) best = compact;
  }
  return best;
}

/**
 * The physical title furniture actually painted on the board.
 *
 * This is intentionally one-for-one with the active catalogue. A treatment
 * must change construction, not merely recolour the same rounded capsule.
 */
export type CoverTitleFurniture =
  | 'direct-lettering'
  | 'stepped-gilt-panel'
  | 'paper-ticket'
  | 'debossed-field'
  | 'morocco-ticket'
  | 'open-double-fillet'
  | 'blind-stepped-panel'
  | 'open-cartouche'
  | 'ruled-square'
  | 'leather-onlay'
  | 'inlay-strip'
  | 'gilt-band'
  | 'open-twin-rules'
  | 'direct-gilt'
  | 'ink-block';

export function coverTitleFurniture(style: TitlePlateStyle): CoverTitleFurniture {
  switch (normalizeTitlePlateStyle(style)) {
    case 'gilt': return 'stepped-gilt-panel';
    case 'label': return 'paper-ticket';
    case 'debossed': return 'debossed-field';
    case 'morocco-label': return 'morocco-ticket';
    case 'double-fillet': return 'open-double-fillet';
    case 'blind-panel': return 'blind-stepped-panel';
    case 'gilt-cartouche': return 'open-cartouche';
    case 'ruled-box': return 'ruled-square';
    case 'leather-onlay': return 'leather-onlay';
    case 'inlay-strip': return 'inlay-strip';
    case 'gilt-band': return 'gilt-band';
    case 'twin-rules': return 'open-twin-rules';
    case 'gilt-direct': return 'direct-gilt';
    case 'ink-panel': return 'ink-block';
    case 'none':
    default:
      return 'direct-lettering';
  }
}

/** A square ticket with clipped corners; no pill silhouette. */
function traceClippedTitleTicket(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  const c = clamp(cut, 0, Math.min(w, h) * 0.34);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
}

/** A blind panel cut with stepped shoulders instead of rounded UI corners. */
function traceSteppedTitlePanel(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number,
): void {
  const s = clamp(step, 0, Math.min(w * 0.16, h * 0.32));
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w - s, y);
  ctx.lineTo(x + w - s, y + s * 0.42);
  ctx.lineTo(x + w, y + s * 0.42);
  ctx.lineTo(x + w, y + h - s * 0.42);
  ctx.lineTo(x + w - s, y + h - s * 0.42);
  ctx.lineTo(x + w - s, y + h);
  ctx.lineTo(x + s, y + h);
  ctx.lineTo(x + s, y + h - s * 0.42);
  ctx.lineTo(x, y + h - s * 0.42);
  ctx.lineTo(x, y + s * 0.42);
  ctx.lineTo(x + s, y + s * 0.42);
  ctx.closePath();
}

function fillAndRuleTitleShape(
  ctx: FlatCtx,
  fill: string,
  rule: string,
  line: number,
): void {
  ctx.fillStyle = fill;
  ctx.fill();
  pen(ctx, rule, line);
  ctx.stroke();
}

function paintTitleFillets(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
  line: number,
  seed: number,
  doubled: boolean,
): void {
  const inset = w * 0.025;
  const gap = Math.max(line * 1.8, h * 0.075);
  const top = y + h * 0.1;
  const bottom = y + h * 0.9;
  stroke(ctx, x + inset, top, x + w - inset, top, colour, line, seed);
  stroke(ctx, x + inset, bottom, x + w - inset, bottom, colour, line, seed + 1);
  if (!doubled) return;
  stroke(ctx, x + w * 0.075, top + gap, x + w * 0.925, top + gap, colour, line * 0.58, seed + 2);
  stroke(ctx, x + w * 0.075, bottom - gap, x + w * 0.925, bottom - gap, colour, line * 0.58, seed + 3);
}

/**
 * Paint the material or open tooling behind a title. Every branch uses flat
 * board faces and one outline ink; hierarchy comes from construction, never a
 * lighting pass or a repeating pattern.
 */
function paintTitleFurniture(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: LabelSpec,
  furniture: CoverTitleFurniture,
  forcedDirectField: boolean,
): void {
  const line = Math.max(1, Math.min(w, h) * 0.03);
  const fill = spec.titleColours.ground;
  const blind = spec.dark;
  const tooling = spec.tooling ?? (spec.gilded ? FLAT.giltPale : blind);

  if (forcedDirectField) {
    traceSteppedTitlePanel(ctx, x, y, w, h, h * 0.24);
    fillAndRuleTitleShape(ctx, fill, tooling, line * 0.78);
    return;
  }

  switch (furniture) {
    case 'direct-lettering':
    case 'direct-gilt':
      return;

    case 'paper-ticket': {
      const lift = Math.max(1, h * 0.075);
      wobbleRect(ctx, x + lift * 0.5, y + lift, w, h, 0, spec.seed + 8);
      ctx.fillStyle = spec.sunk;
      ctx.fill();
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 9);
      fillAndRuleTitleShape(ctx, fill, FLAT.ink, line * 0.9);
      return;
    }

    case 'stepped-gilt-panel': {
      traceSteppedTitlePanel(ctx, x, y, w, h, h * 0.26);
      fillAndRuleTitleShape(ctx, fill, tooling, line);
      const g = h * 0.13;
      wobbleRect(ctx, x + g, y + g, w - g * 2, h - g * 2, 0, spec.seed + 3);
      pen(ctx, tooling, line * 0.48);
      ctx.stroke();
      return;
    }

    case 'debossed-field': {
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 5);
      fillAndRuleTitleShape(ctx, fill, blind, line * 1.02);
      const g = h * 0.12;
      wobbleRect(ctx, x + g, y + g, w - g * 2, h - g * 2, 0, spec.seed + 6);
      pen(ctx, mixHex(blind, spec.face, 0.3), line * 0.52);
      ctx.stroke();
      return;
    }

    case 'morocco-ticket': {
      traceClippedTitleTicket(ctx, x, y, w, h, h * 0.24);
      fillAndRuleTitleShape(ctx, fill, tooling, line);
      const g = h * 0.13;
      traceClippedTitleTicket(ctx, x + g, y + g, w - g * 2, h - g * 2, h * 0.1);
      pen(ctx, tooling, line * 0.5);
      ctx.stroke();
      return;
    }

    case 'open-double-fillet':
      paintTitleFillets(ctx, x, y, w, h, tooling, line * 0.72, spec.seed + 11, true);
      return;

    case 'blind-stepped-panel': {
      traceSteppedTitlePanel(ctx, x, y, w, h, h * 0.3);
      fillAndRuleTitleShape(ctx, fill, blind, line * 0.9);
      const c = h * 0.19;
      const arm = h * 0.28;
      pen(ctx, tooling, line * 0.5);
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [
        [x + c, y + c, 1, 1],
        [x + w - c, y + c, -1, 1],
        [x + w - c, y + h - c, -1, -1],
        [x + c, y + h - c, 1, -1],
      ] as const) {
        ctx.moveTo(cx + sx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + sy * arm);
      }
      ctx.stroke();
      return;
    }

    case 'open-cartouche': {
      const shoulder = Math.min(w * 0.18, h * 0.78);
      ctx.beginPath();
      ctx.moveTo(x + shoulder, y);
      ctx.quadraticCurveTo(x + shoulder * 0.62, y + h * 0.1, x + shoulder * 0.3, y + h * 0.24);
      ctx.quadraticCurveTo(x - shoulder * 0.08, y + h * 0.36, x + shoulder * 0.18, y + h * 0.5);
      ctx.quadraticCurveTo(x - shoulder * 0.08, y + h * 0.64, x + shoulder * 0.3, y + h * 0.76);
      ctx.quadraticCurveTo(x + shoulder * 0.62, y + h * 0.9, x + shoulder, y + h);
      ctx.lineTo(x + w - shoulder, y + h);
      ctx.quadraticCurveTo(x + w - shoulder * 0.62, y + h * 0.9, x + w - shoulder * 0.3, y + h * 0.76);
      ctx.quadraticCurveTo(x + w + shoulder * 0.08, y + h * 0.64, x + w - shoulder * 0.18, y + h * 0.5);
      ctx.quadraticCurveTo(x + w + shoulder * 0.08, y + h * 0.36, x + w - shoulder * 0.3, y + h * 0.24);
      ctx.quadraticCurveTo(x + w - shoulder * 0.62, y + h * 0.1, x + w - shoulder, y);
      ctx.closePath();
      fillAndRuleTitleShape(ctx, fill, tooling, line * 0.9);
      // The concave shoulders themselves are the cartouche. External curls
      // became knob-like hardware at true size, so the open programme stops
      // at two clean lateral pallets within the title field.
      stroke(ctx, x + shoulder * 0.18, y + h * 0.5, x + shoulder * 0.72, y + h * 0.5, tooling, line * 0.5, spec.seed + 15);
      stroke(ctx, x + w - shoulder * 0.72, y + h * 0.5, x + w - shoulder * 0.18, y + h * 0.5, tooling, line * 0.5, spec.seed + 16);
      return;
    }

    case 'ruled-square': {
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 17);
      fillAndRuleTitleShape(ctx, fill, tooling, line * 0.85);
      const g = h * 0.14;
      wobbleRect(ctx, x + g, y + g, w - g * 2, h - g * 2, 0, spec.seed + 18);
      pen(ctx, tooling, line * 0.46);
      ctx.stroke();
      return;
    }

    case 'leather-onlay': {
      const lift = Math.max(1, h * 0.08);
      traceSteppedTitlePanel(ctx, x + lift * 0.65, y + lift, w, h, h * 0.28);
      ctx.fillStyle = spec.sunk;
      ctx.fill();
      traceSteppedTitlePanel(ctx, x, y, w, h, h * 0.28);
      fillAndRuleTitleShape(ctx, fill, blind, line);
      const g = h * 0.12;
      wobbleRect(ctx, x + g, y + g, w - g * 2, h - g * 2, 0, spec.seed + 21);
      pen(ctx, tooling, line * 0.48);
      ctx.stroke();
      return;
    }

    case 'inlay-strip': {
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 23);
      ctx.fillStyle = fill;
      ctx.fill();
      paintTitleFillets(ctx, x, y, w, h, tooling, line * 0.68, spec.seed + 24, false);
      return;
    }

    case 'gilt-band': {
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 27);
      ctx.fillStyle = fill;
      ctx.fill();
      paintTitleFillets(ctx, x, y, w, h, spec.titleColours.ink, line * 0.62, spec.seed + 28, false);
      const terminal = h * 0.2;
      stroke(ctx, x + w * 0.045, y + terminal, x + w * 0.045, y + h - terminal, spec.titleColours.ink, line * 0.55, spec.seed + 30);
      stroke(ctx, x + w * 0.955, y + terminal, x + w * 0.955, y + h - terminal, spec.titleColours.ink, line * 0.55, spec.seed + 31);
      return;
    }

    case 'open-twin-rules':
      paintTitleFillets(ctx, x, y, w, h, tooling, line * 0.72, spec.seed + 33, false);
      return;

    case 'ink-block': {
      wobbleRect(ctx, x, y, w, h, 0, spec.seed + 37);
      fillAndRuleTitleShape(ctx, fill, tooling, line);
      const g = h * 0.11;
      stroke(ctx, x + g, y + g, x + w - g, y + g, spec.titleColours.ink, line * 0.42, spec.seed + 38);
      stroke(ctx, x + g, y + h - g, x + w - g, y + h - g, spec.titleColours.ink, line * 0.42, spec.seed + 39);
      return;
    }
  }
}

/**
 * The cream label — the icon's loudest mark, and the one thing on a cover a
 * reader looks at first.
 *
 * With a title it carries the title and one short rule beneath; without one it
 * carries the icon's three ruled lines, which is what an untitled book looks
 * like on a shelf anyway.
 */
function paintLabel(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  spec: LabelSpec,
): void {
  const line = Math.max(1, Math.min(w, h) * 0.03);

  if (spec.inset && spec.style !== 'none') {
    // A recess, flattened into what a recess actually looks like when it is
    // DRAWN rather than lit: a sunk face a step deeper than the board, its own
    // ink outline, a fine rule inside it, and a nick across each corner where
    // the panel is cut away. One stroked rounded rectangle — which is all this
    // was — reads as a stray box somebody forgot to erase.
    const g = h * 0.22;
    const px = x - g;
    const py = y - g * 0.86;
    const pw = w + g * 2;
    const ph = h + g * 1.72;
    const rule = spec.tooling ?? (spec.gilded ? FLAT.giltPale : spec.dark);
    traceSteppedTitlePanel(ctx, px, py, pw, ph, h * 0.24);
    fillAndRuleTitleShape(ctx, spec.sunk, FLAT.ink, Math.max(1, line * 0.7));
    const inset = g * 0.34;
    wobbleRect(ctx, px + inset, py + inset, pw - inset * 2, ph - inset * 2, 0, spec.seed + 6);
    pen(ctx, rule, line * 0.55);
    ctx.stroke();
    // The four cut corners: the mark that says "sunk" without a light source.
    const nick = g * 0.62;
    for (const [nx, ny, sx, sy] of [
      [px + inset, py + inset, 1, 1],
      [px + pw - inset, py + inset, -1, 1],
      [px + pw - inset, py + ph - inset, -1, -1],
      [px + inset, py + ph - inset, 1, -1],
    ] as const) {
      stroke(ctx, nx + sx * nick, ny, nx, ny + sy * nick, rule, line * 0.5, spec.seed + nx + ny);
    }
  }

  const ink = spec.titleColours.ink;
  const furniture = coverTitleFurniture(spec.style);
  const directStyle =
    furniture === 'direct-lettering' ||
    furniture === 'direct-gilt' ||
    furniture === 'open-double-fillet' ||
    furniture === 'open-twin-rules';
  const expandedDirectTitle =
    furniture === 'direct-gilt' ||
    furniture === 'open-double-fillet' ||
    furniture === 'open-twin-rules';
  const forcedDirectField = directStyle && spec.titleColours.ground !== spec.face;
  paintTitleFurniture(ctx, x, y, w, h, spec, furniture, forcedDirectField);

  const text = title.trim();
  if (!text) {
    // The icon's ruled label: three lines, each shorter than the last.
    for (let i = 0; i < 3; i++) {
      const ry = y + h * (0.32 + i * 0.2);
      stroke(
        ctx,
        x + w * 0.12,
        ry,
        x + w * (0.88 - i * 0.16),
        ry,
        ink,
        Math.max(1, h * 0.075),
        spec.seed + i,
      );
    }
    return;
  }

  // Fit the title. The preferred floor is the handwriting legibility floor
  // from CLAUDE.md (13 CSS px), expressed in the canvas's own pixels. It is
  // tested against the FINAL multiline setting: if the complete title cannot
  // meet it, the renderer changes to the printed micro-copy face rather than
  // drawing tiny handwriting or deleting the tail.
  // The outline and the hand wobble need a little air, but 16% was far more
  // than they need. At specimen-card scale it made even a two-word title
  // ellipsise inside a visibly broad plate. Nine percent is still a generous
  // bookbinder's margin and, crucially, agrees with the width the eye reads.
  const maxWidth = w * 0.91;
  const floorPx = HAND_FLOOR_PX * spec.s;
  const hand = spec.hand;
  // The plate's vertical cap holds whatever the hand asks for: a hand set at
  // 1.28 that overflowed its own label would be a hand nobody would pick.
  const startPx = Math.min(h * 0.52, Math.min(h * 0.46, 30 * spec.s) * hand.scale);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let stack = FACE_STACKS[hand.face] ?? FACE_STACKS[0]!;
  // A directly tooled title has no physical plate edge to protect. Give its
  // lettering more of the invisible composition field and move the short rule
  // below it; treating that field like a pasted label made long gilt-direct
  // titles needlessly microscopic despite a broad, empty board around them.
  const openRuleField =
    furniture === 'open-double-fillet' || furniture === 'open-twin-rules';
  const materialBand =
    furniture === 'inlay-strip' || furniture === 'gilt-band' || furniture === 'ink-block';
  const verticalShare =
    furniture === 'direct-gilt' ? 0.74 : openRuleField || materialBand ? 0.64 : 0.58;
  let layout = fitCoverTitle(
    ctx,
    text,
    hand,
    stack,
    startPx,
    floorPx,
    maxWidth,
    h,
    verticalShare,
  );
  // Caveat's documented floor is about the face, not the words. If the full
  // title needs a smaller setting, retain every word and move to the body hand.
  if (hand.face === HEADING_FACE && layout.fontPx < HEADING_MIN_PX * spec.s) {
    stack = FACE_STACKS[BODY_FACE]!;
    layout = fitCoverTitle(
      ctx,
      text,
      hand,
      stack,
      startPx,
      floorPx,
      maxWidth,
      h,
      verticalShare,
    );
  }
  if (hand.face !== PRINTED_FACE && layout.fontPx < floorPx) {
    stack = FACE_STACKS[PRINTED_FACE]!;
    layout = fitCoverTitle(
      ctx,
      text,
      hand,
      stack,
      startPx,
      floorPx,
      maxWidth,
      h,
      verticalShare,
    );
  }

  let fontPx = Math.max(1, layout.fontPx);
  const lines = layout.lines;
  // Confirm the closed-form fit against the browser's final shaping. This is
  // one shared correction for every line, so their hierarchy cannot drift.
  setHand(ctx, hand, layout.stack, fontPx, text, layout.track);
  const widest = Math.max(...lines.map((lineText) => textWidth(ctx, lineText)));
  if (widest > maxWidth && fontPx > 1) {
    fontPx = Math.max(1, fontPx * (maxWidth / widest) * 0.975);
    setHand(ctx, hand, layout.stack, fontPx, text, layout.track);
  }

  const actualFontPx = fontPx * (hand.caps === 'small' ? 0.86 : 1);
  const lineHeight = actualFontPx * 1.08;
  const centredField = openRuleField || materialBand;
  const centreY = y + h * (
    centredField
      ? lines.length === 1 ? 0.5 : 0.48
      : lines.length === 1 ? 0.44 : 0.41
  );
  const firstY = centreY - ((lines.length - 1) * lineHeight) / 2;
  ctx.fillStyle = ink;
  lines.forEach((lineText, index) => {
    // `maxWidth` is an emergency guard for an unbroken pathological title or
    // a font backend whose metrics are not quite linear. It condenses the full
    // run; it never substitutes, clips or appends UI punctuation.
    ctx.fillText(lineText, x + w / 2, firstY + index * lineHeight, maxWidth);
  });
  // Tracking is part of the drawing state, so it would leak into the ruled
  // flourish below and out into whatever the caller draws next.
  ctx.restore();

  // Open fillets and full material bands already supply a lower rule. Other
  // treatments keep one short binder's finishing stroke beneath the title.
  if (
    furniture !== 'open-double-fillet' &&
    furniture !== 'open-twin-rules' &&
    furniture !== 'inlay-strip' &&
    furniture !== 'gilt-band' &&
    furniture !== 'ink-block'
  ) {
    stroke(
      ctx,
      x + w * 0.34,
      y + h * (expandedDirectTitle && lines.length > 1 ? 0.9 : 0.78),
      x + w * 0.66,
      y + h * (expandedDirectTitle && lines.length > 1 ? 0.9 : 0.78),
      spec.style === 'label' ? FLAT.inkSoft : ink,
      Math.max(0.9, h * 0.05),
      spec.seed + 7,
    );
  }
}

/**
 * Metal corner plates.
 *
 * Flat, so a plate is a filled corner shape with the one ink outline — no
 * bevel, no rivet catchlight, nothing that implies a light source. Depth is
 * where it is everywhere else: a darker flat face beside a lighter one, here a
 * lip of the second metal tone along the plate's cut edge.
 *
 * ## The silhouette was wrong, and that is what read as cheap
 *
 * The first cut turned a hard right angle at the board's corner while the board
 * itself is drawn with a `radius` — so every plate's point stuck out past the
 * cover's own outline, four times per book. A corner piece is dressed to the
 * board it protects; this one now follows the same curve, which is the whole
 * fix for "a gold triangle stuck on".
 *
 * The rest is drawing rather than lighting: a lip along the cut, a fine rule
 * inside it, and three rivets — one in the elbow and one down each arm, which
 * is where they are on a real plate because that is where the leather needs
 * holding.
 */
function paintCornerPlates(
  ctx: FlatCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  gilded: boolean,
  ink: number,
  hardwareHex?: string | null,
): void {
  const size = Math.min(w * 0.17, h * 0.13);
  const own = normaliseHex(hardwareHex);
  const fill = own ?? (gilded ? FLAT.gilt : FLAT.timber);
  const deep = own !== null ? mixHex(own, FLAT.ink, 0.28) : gilded ? FLAT.ochreDark : FLAT.timberDark;
  // Never let the corner curve eat the plate: a well-worn book rounds to
  // `radius`, and a plate the size of its own corner is not a plate.
  const r = Math.min(radius, size * 0.55);

  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x + w, y + h, -1, -1],
    [x, y + h, 1, -1],
  ] as const) {
    /** The outer edge: down one side, round the board's own corner, out the other. */
    const traceOuter = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * size);
      ctx.lineTo(cx, cy + dy * r);
      ctx.quadraticCurveTo(cx, cy, cx + dx * r, cy);
      ctx.lineTo(cx + dx * size, cy);
    };
    /** The cut, scooped toward the corner exactly as a real plate is cut. */
    const scoop = (): void => {
      ctx.quadraticCurveTo(cx + dx * size * 0.4, cy + dy * size * 0.4, cx, cy + dy * size);
    };

    traceOuter();
    scoop();
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // The lip: the second metal face, laid along the cut and clipped to the
    // plate so it cannot bleed onto the board.
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(cx + dx * size, cy);
    scoop();
    pen(ctx, deep, size * 0.19);
    ctx.stroke();
    ctx.restore();

    traceOuter();
    scoop();
    ctx.closePath();
    pen(ctx, FLAT.ink, ink * 0.7);
    ctx.stroke();

    // A fine rule inside the cut, and the three rivets.
    ctx.beginPath();
    ctx.moveTo(cx + dx * size * 0.72, cy + dy * size * 0.06);
    ctx.quadraticCurveTo(
      cx + dx * size * 0.3,
      cy + dy * size * 0.3,
      cx + dx * size * 0.06,
      cy + dy * size * 0.72,
    );
    pen(ctx, FLAT.ink, ink * 0.4);
    ctx.stroke();
    for (const [ax, ay] of [
      [0.26, 0.26],
      [0.6, 0.13],
      [0.13, 0.6],
    ] as const) {
      dot(ctx, cx + dx * size * ax, cy + dy * size * ay, ink * 0.6, FLAT.ink);
    }
  }
}

/**
 * The charm — the fastest identity cue a reader has, so it is drawn cover-side
 * as well as spine-side. Six kinds, all flat fills with one ink outline.
 */
function paintCharm(
  ctx: FlatCtx,
  kind: Exclude<CharmKind, 'none'>,
  x: number,
  y: number,
  w: number,
  h: number,
  colourway: number | string,
  /** The board's own face, so the charm never disappears into it. */
  board: string,
  ink: number,
  seed: number,
): void {
  // ONE folding of the colourway, shared with the spine and the studio swatch:
  // `charms.charmCloth` hands back the ribbon face and the tone its knot turns
  // away in. This used to be a local table of eight FLAT constants in an order
  // of its own, so the chip labelled *Crimson* painted a terracotta ribbon
  // here, a green one on the shelf, and a third colour in the panel.
  //
  // The wrap is the TABLE's length, not the literal 8 it used to be: the day
  // the colourways grew past eight, `% 8` would have quietly folded every new
  // choice back onto an old one, with nothing failing anywhere.
  const wrap = CHARM_COLORS.length;
  let slot: number | string = colourway;
  if (typeof slot === 'number') slot = ((Math.trunc(slot) % wrap) + wrap) % wrap;
  // A crimson ribbon on a crimson board is a ribbon nobody can see. Step to
  // the next colourway rather than tinting this one, which would put a colour
  // outside the palette on screen. A reader's own hex has no "next", so it is
  // folded darker instead — still their colour, still visible.
  if (charmCloth(slot)[0] === board) {
    slot = typeof slot === 'number' ? (slot + 1) % wrap : charmCloth(slot)[1];
  }
  const [face, dark] = charmCloth(slot);
  const unit = Math.min(w, h);

  switch (kind) {
    case 'ribbon': {
      // A marker slipped down the fore-edge side, notched at the tail — the
      // icon's ribbon, stood up rather than hanging out of the bottom. It runs
      // outboard of the label on purpose; a ribbon laid across the title was
      // the first thing that looked wrong in the specimen. The darker face is
      // only the short fold where the marker leaves the head. A full-height
      // dark stripe beside the cloth read as a second bookmark on the large
      // pulled-out cover, even though it was technically part of the first.
      const rw = w * 0.075;
      const rx = x + w * 0.848;
      const tail = y + h * 0.26;
      ctx.beginPath();
      ctx.moveTo(rx, y - unit * 0.02);
      ctx.lineTo(rx + rw, y - unit * 0.02);
      ctx.lineTo(rx + rw, tail);
      ctx.lineTo(rx + rw / 2, tail - rw * 0.55);
      ctx.lineTo(rx, tail);
      ctx.closePath();
      ctx.fillStyle = face;
      ctx.fill();

      // One small turned face at the head, contained inside the same outer
      // silhouette. Keeping it short makes the tail read as one strip.
      ctx.beginPath();
      ctx.moveTo(rx + rw * 0.7, y - unit * 0.02);
      ctx.lineTo(rx + rw, y - unit * 0.02);
      ctx.lineTo(rx + rw, y + rw * 0.72);
      ctx.lineTo(rx + rw * 0.7, y + rw * 0.98);
      ctx.closePath();
      ctx.fillStyle = dark;
      ctx.fill();

      pen(ctx, FLAT.ink, ink * 0.8);
      ctx.beginPath();
      ctx.moveTo(rx, y - unit * 0.02);
      ctx.lineTo(rx + rw, y - unit * 0.02);
      ctx.lineTo(rx + rw, tail);
      ctx.lineTo(rx + rw / 2, tail - rw * 0.55);
      ctx.lineTo(rx, tail);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'tassel': {
      const cx = x + w * 0.85;
      const top = y + h * 0.05;
      const headR = unit * 0.045;
      pen(ctx, dark, ink * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - headR * 1.6, top);
      ctx.quadraticCurveTo(cx, top + headR * 1.2, cx + headR * 1.6, top);
      ctx.stroke();
      panel(ctx, cx - headR, top + headR * 0.9, headR * 2, headR * 1.9, face, {
        radius: headR * 0.6,
        seed,
        width: Math.max(1, ink * 0.7),
      });
      for (let i = 0; i < 5; i++) {
        const fx = cx - headR * 0.8 + (i / 4) * headR * 1.6;
        stroke(ctx, fx, top + headR * 2.6, fx, top + headR * 4.6, dark, headR * 0.3, seed + i);
      }
      break;
    }
    case 'pressed-flower': {
      const cx = x + w * 0.76;
      const cy = y + h * 0.84;
      const pr = unit * 0.055;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * pr * 0.7, cy + Math.sin(a) * pr * 0.7, pr * 0.6, pr * 0.38, a, 0, Math.PI * 2);
        ctx.fillStyle = face;
        ctx.fill();
        pen(ctx, FLAT.ink, ink * 0.6);
        ctx.stroke();
      }
      dot(ctx, cx, cy, pr * 0.3, FLAT.gilt);
      break;
    }
    case 'clasp': {
      // A strap reaching round the fore-edge with a small plate on the end.
      const cy = y + h * 0.52;
      const sh = unit * 0.055;
      panel(ctx, x + w * 0.78, cy - sh / 2, w * 0.22, sh, face, {
        radius: sh * 0.35,
        seed,
        width: Math.max(1, ink * 0.7),
      });
      panel(ctx, x + w * 0.74, cy - sh * 0.9, sh * 1.5, sh * 1.8, FLAT.gilt, {
        radius: sh * 0.4,
        seed: seed + 3,
        width: Math.max(1, ink * 0.7),
      });
      break;
    }
    case 'wax-seal': {
      const cx = x + w * 0.76;
      const cy = y + h * 0.84;
      const sr = unit * 0.06;
      // A wax blob is a circle a hand pressed: a many-sided polygon reads far
      // more like poured wax than ctx.arc does.
      const blob = polyPts(cx, cy, sr, 11).map((p, i) => ({
        x: p.x + Math.cos(i * 2.1) * sr * 0.09,
        y: p.y + Math.sin(i * 3.3) * sr * 0.09,
      }));
      tracePoly(ctx, blob);
      ctx.fillStyle = face;
      ctx.fill();
      pen(ctx, FLAT.ink, ink * 0.8);
      ctx.stroke();
      tracePoly(ctx, starPts(cx, cy, sr * 0.5, sr * 0.22, 5));
      pen(ctx, dark, ink * 0.7);
      ctx.stroke();
      break;
    }
    default: {
      // Dangling tag: string over the head of the board, then the card.
      const cx = x + w * 0.84;
      const top = y + h * 0.04;
      const tw = unit * 0.16;
      const th = unit * 0.1;
      stroke(ctx, cx, top, cx, top + th * 0.5, FLAT.inkSoft, Math.max(1, ink * 0.6), seed);
      panel(ctx, cx - tw / 2, top + th * 0.5, tw, th, face, {
        radius: th * 0.3,
        seed: seed + 2,
        width: Math.max(1, ink * 0.7),
      });
      stroke(
        ctx,
        cx - tw * 0.28,
        top + th * 1.05,
        cx + tw * 0.28,
        top + th * 1.05,
        dark,
        Math.max(0.9, th * 0.1),
        seed + 5,
      );
      break;
    }
  }
}

/* --------------------------------- render --------------------------------- */

export interface RenderCoverOptions {
  /** Skip the title plate even when a title is given (page backdrops). */
  plate?: boolean;
}

/**
 * The broad composition of the front board, derived from the furniture the
 * reader already chose. It deliberately is not another persisted dial: a
 * ribbon label belongs high, a heraldic plate needs a deeper field, and a
 * roundel title must not sit on top of a second roundel. Those are binding
 * rules, not arbitrary coordinates.
 *
 * Exporting the decision lets the Surprise sweep group genuinely different
 * covers instead of treating six recolours of one vertical stack as variety.
 */
export interface CoverCompositionLayout {
  titleWidth: number;
  titleHeight: number;
  titleCenterY: number;
  medallionCenterY: number;
  medallionScale: number;
  family: 'direct' | 'band' | 'ticket' | 'heraldic' | 'round' | 'panel' | 'classic';
}

const BAND_TITLE_PLATES = new Set<TitlePlateStyle>([
  'gilt-band', 'ribbon-band', 'inlay-strip', 'twin-rules', 'double-fillet',
  'triple-fillet', 'dotted-rule', 'starred-ends', 'fleuron-ends', 'lozenge-ends',
]);
const TICKET_TITLE_PLATES = new Set<TitlePlateStyle>([
  'label', 'morocco-label', 'paper-slip', 'vellum-slip', 'linen-tag',
  'ivory-plate', 'ebony-plate', 'copper-plate', 'enamel-plate', 'leather-onlay',
]);
const HERALDIC_TITLE_PLATES = new Set<TitlePlateStyle>([
  'shield-plate', 'crest-plate', 'scroll-plate', 'arched-plate', 'pedimented',
  'gilt-cartouche', 'gothic-panel',
]);
const ROUND_TITLE_PLATES = new Set<TitlePlateStyle>([
  'roundel', 'oval-medallion', 'lozenge-plate', 'wreathed-plate',
  'scallop-edge', 'bead-frame',
]);
const PANEL_TITLE_PLATES = new Set<TitlePlateStyle>([
  'blind-panel', 'ruled-box', 'corner-brackets', 'notched-corners', 'sunk-panel',
  'stepped-frame', 'chamfered-plate', 'hatched-ground', 'stippled-ground',
  'rope-frame', 'stone-tablet', 'ink-panel',
]);

export function coverCompositionLayout(
  plate: TitlePlateStyle,
  frame: number,
  medallion: number,
  inset = false,
): CoverCompositionLayout {
  plate = normalizeTitlePlateStyle(plate);
  frame = normalizeCoverFrameIndex(frame);
  medallion = normalizeCoverEmblemIndex(medallion);
  let layout: CoverCompositionLayout;
  if (plate === 'gilt-direct') {
    layout = {
      // There is no physical ticket here: this is an invisible lettering
      // field on the board. Its extra height lets a long direct title use two
      // proper lines while the finishing rule still clears the medallion.
      family: 'direct', titleWidth: 0.82, titleHeight: 0.25,
      titleCenterY: 0.29, medallionCenterY: 0.59, medallionScale: 0.094,
    };
  } else if (plate === 'none') {
    layout = {
      family: 'direct', titleWidth: 0.82, titleHeight: 0.22,
      titleCenterY: 0.29, medallionCenterY: 0.59, medallionScale: 0.094,
    };
  } else if (plate === 'debossed' || plate === 'gilt') {
    layout = {
      family: 'panel', titleWidth: 0.76, titleHeight: 0.18,
      titleCenterY: 0.34, medallionCenterY: 0.7, medallionScale: 0.082,
    };
  } else if (BAND_TITLE_PLATES.has(plate)) {
    layout = {
      family: 'band', titleWidth: 0.86, titleHeight: 0.16,
      titleCenterY: 0.29, medallionCenterY: 0.66, medallionScale: 0.086,
    };
  } else if (TICKET_TITLE_PLATES.has(plate)) {
    layout = {
      family: 'ticket', titleWidth: 0.75, titleHeight: 0.17,
      titleCenterY: 0.34, medallionCenterY: 0.70, medallionScale: 0.083,
    };
  } else if (HERALDIC_TITLE_PLATES.has(plate)) {
    layout = {
      family: 'heraldic', titleWidth: 0.77, titleHeight: 0.20,
      titleCenterY: 0.39, medallionCenterY: 0.76, medallionScale: 0.076,
    };
  } else if (ROUND_TITLE_PLATES.has(plate)) {
    layout = {
      family: 'round', titleWidth: 0.57, titleHeight: 0.18,
      titleCenterY: 0.41, medallionCenterY: 0.77, medallionScale: 0.071,
    };
  } else if (PANEL_TITLE_PLATES.has(plate)) {
    layout = {
      family: 'panel', titleWidth: 0.76, titleHeight: 0.19,
      titleCenterY: 0.36, medallionCenterY: 0.72, medallionScale: 0.08,
    };
  } else {
    layout = {
      family: 'classic', titleWidth: 0.64, titleHeight: 0.17,
      titleCenterY: 0.35, medallionCenterY: 0.70, medallionScale: 0.082,
    };
  }

  // Dense perimeter tooling leaves a slightly narrower quiet field; a sunk
  // title plate gains a touch of width because its outer recess supplies the
  // breathing room. The device index introduces only a minute vertical
  // cadence, never a random placement.
  const elaborateFrame = frame === 36 || frame === 43;
  return {
    ...layout,
    titleWidth: clamp(layout.titleWidth + (inset ? 0.018 : 0) - (elaborateFrame ? 0.015 : 0), 0.54, 0.88),
    titleCenterY: clamp(layout.titleCenterY + (elaborateFrame ? 0.012 : 0), 0.26, 0.43),
    medallionCenterY: clamp(
      layout.medallionCenterY + (elaborateFrame ? 0.012 : 0) + ((Math.abs(medallion) % 3) - 1) * 0.012,
      0.57,
      0.79,
    ),
  };
}

/**
 * Render one front cover at w×h onto a fresh canvas and return it.
 * Deterministic per (params, size, title).
 */
export function renderCover(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): HTMLCanvasElement {
  const canvas = makeCanvas(Math.max(2, Math.round(w)), Math.max(2, Math.round(h)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  renderCoverInto(ctx, canvas.width, canvas.height, params, title, opts);
  return canvas;
}

/**
 * Paint a cover into an existing 2d context (harness/preview reuse).
 *
 * Three call sites hand this three different aspect ratios — a 0.72 portrait
 * for the pull-out, a 720×500 landscape for the open book's backdrop, and the
 * studio's 214×292 preview — so every measurement below is a fraction of the
 * box rather than a fixed distance. Only type sizes use the detail scale `s`,
 * because a font has an absolute floor below which it stops being readable.
 */
export function renderCoverInto(
  ctx: FlatCtx,
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): void {
  params = {
    ...params,
    frame: normalizeCoverFrameIndex(params.frame),
    medallion: normalizeCoverEmblemIndex(params.medallion),
    titlePlate: normalizeTitlePlateStyle(params.titlePlate),
    edge: normalizeEdgeTreatment(params.edge),
    charm: normalizeCharmKind(params.charm),
    cornerProtectors: false,
    insetPlate: false,
  };
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const seed = params.seed >>> 0;
  const s = Math.max(0.5, Math.min(w / 380, h / 520));
  const wear = clamp(params.wear ?? 0, 0, 1);
  // The covering — one of the fifty the SPINE wears, resolved through the same
  // table. It decides three things about a board: its tone (`boardFor`), where
  // a second covering sits, and the one grain it carries.
  const covering = coveringSpecFor(params);
  const construction = coverConstructionFor(params);
  const board = resolvedCoverBoard(params);
  const pale = isPaleCovering(covering);
  const [face, dark] = board;
  const accent = accentFor(params.palette, seed, params.coverAccentHex);
  const gilded = params.gilt;

  /* ---- layout ---- */
  const pad = Math.min(w, h) * 0.016;
  // The text block peeks past the fore-edge. It has to show *enough* to read
  // as leaves rather than as a stray line, and the boards have to overlap it
  // by more than their own bow or the two shapes visibly come apart.
  const pageW = Math.max(4, w * 0.055);
  const bx = pad;
  const by = pad;
  const bw = w - pad * 2 - pageW * 0.62;
  const bh = h - pad * 2;
  // A well-loved book is a rounder book. That is the whole of `wear` now: the
  // old pass ground dirt and bleach into the boards, which is exactly the kind
  // of simulated grubbiness flat art cannot carry.
  const radius = Math.min(bw, bh) * (0.04 + wear * 0.03);
  const spineW = bw * construction.spineRatio;
  const faceX = bx + spineW;
  const faceW = bw - spineW;
  const ink = inkWidth(Math.min(bw, bh));

  /* ---- text block, then the board over it ---- */
  paintTextBlock(
    ctx,
    w - pad - pageW,
    by + bh * 0.035,
    pageW,
    bh * 0.93,
    params.edge ?? 'plain',
    seed + 21,
  );
  panel(ctx, bx, by, bw, bh, face, { radius, seed, width: ink });
  // The covering goes on before the strip, because a half binding's leather
  // runs UNDER the spine — the strip and the split band are one piece of skin,
  // and drawing the band on top of the strip put a seam through the middle of
  // it.
  paintCovering(
    ctx,
    covering,
    bx,
    by,
    bw,
    bh,
    spineW,
    radius,
    face,
    dark,
    accent,
    ink,
    gilded,
    pale,
    wear,
    seed + 61,
  );
  paintBoardConstruction(
    ctx,
    covering,
    construction,
    bx,
    by,
    bw,
    bh,
    spineW,
    radius,
    face,
    dark,
    ink,
    seed + 83,
  );
  paintSpineStrip(
    ctx,
    covering,
    construction,
    bx,
    by,
    bw,
    bh,
    spineW,
    radius,
    face,
    dark,
    accent,
    ink,
    gilded,
    params,
    seed,
  );

  /* ---- ornament ---- */
  // The icon's frame is pale gilt on a terracotta board. A book with no foil
  // gets the same frame blind-tooled instead — the board's own darker tone,
  // which is what a binder without gold leaf actually does. A cream board
  // swallows both pale tones, so parchment tools in the deeper ochre.
  const frameInk = params.toolingHex ?? (pale ? FLAT.ochreDark : gilded ? FLAT.giltPale : dark);
  const ornInk = resolveCoverEmblemInk(
    params.emblemHex ?? params.toolingHex ?? (pale ? FLAT.ochreDark : gilded ? FLAT.gilt : dark),
    face,
  );
  /**
   * The board's own colour taken a step toward the ink.
   *
   * ONE tone, shared by the three places this file now shows depth as a second
   * flat face — a banded frame's border, the sunk panel behind an inset plate,
   * the field a medallion is struck into. Deriving all three from `face` is
   * what keeps them reading as the same board rather than as three
   * decorations: a board darkens one way, and it darkens by the same amount
   * wherever it is cut into.
   */
  const sunk = mixHex(face, FLAT.ink, 0.17);
  const frameBand = mixHex(face, FLAT.ink, 0.29);
  // Fine ornament is the first thing to go as a book wears.
  const fineDetail = wear < 0.7;
  const fx = faceX + faceW * 0.085;
  const fy = by + bh * 0.055;
  paintFrame(
    ctx,
    fx,
    fy,
    faceW * 0.83,
    bh * 0.89,
    params.frame,
    frameInk,
    frameBand,
    fineDetail,
    seed + 31,
  );

  /* ---- label ---- */
  const plateStyle: TitlePlateStyle = params.titlePlate ?? 'label';
  const composition = coverCompositionLayout(
    plateStyle,
    params.frame,
    params.medallion,
    params.insetPlate === true,
  );
  const labelW = faceW * composition.titleWidth;
  const labelH = Math.min(bh * composition.titleHeight, labelW * 0.62);
  const labelX = faceX + (faceW - labelW) / 2;
  const labelY = by + bh * composition.titleCenterY - labelH / 2;
  if (opts.plate !== false) {
    if (params.medallion === 20 && fineDetail) {
      paintCrownTitleCompartment(
        ctx,
        labelX,
        labelY,
        labelW,
        labelH,
        frameInk,
        seed + 37,
      );
    }
    paintLabel(ctx, labelX, labelY, labelW, labelH, title, {
      style: title ? plateStyle : 'label',
      inset: params.insetPlate === true,
      gilded,
      tooling: params.toolingHex ?? null,
      titleColours: resolveCoverTitleColours(params, title),
      face,
      dark,
      sunk,
      paleBoard: pale,
      hand: handFor(params.titleFont),
      seed: seed + 41,
      s,
    });
  }

  /* ---- medallion ---- */
  // Sat where the icon sits it: below the label, on the lower third of the
  // board, so the two marks read as a pair rather than a stack.
  const medR = Math.min(faceW, bh) * composition.medallionScale;
  const medX = faceX + faceW * 0.5;
  const medY = by + bh * (opts.plate === false ? 0.62 : composition.medallionCenterY);
  // No shadow, badge field or enclosing ring. A centrepiece is tooled directly
  // into the board; its open stems let the covering remain part of the design.
  if (params.medallion >= 0) {
    paintMedallion(ctx, medX, medY, medR, params.medallion, ornInk, fineDetail);
  }

  /* ---- fittings ---- */
  if (params.cornerProtectors) {
    paintCornerPlates(ctx, bx, by, bw, bh, radius, gilded, ink, params.hardwareHex);
  }
  if (params.charm && params.charm !== 'none') {
    paintCharm(ctx, params.charm, bx, by, bw, bh, params.charmColor ?? 0, face, ink, seed + 51);
  }

  ctx.restore();
}

/* ------------------------------- bake cache ------------------------------- */

const urlCache = new Map<string, string>();

/**
 * The identity of one baked cover.
 *
 * Exported so a node test can hold it up against `CoverParams` field by field
 * — `tests/covers.test.ts` turns every knob in turn and fails on any that does
 * not move the key. That gate is worth a named function, because getting this
 * wrong is INVISIBLE: a cache validates nothing about a hit, so a key missing
 * an axis serves the wrong board to everyone who already has the right one
 * under that key, and keeps serving it until the app is reloaded. This file
 * has met that failure twice already, both times through a count that had
 * stopped describing its own table.
 *
 * The room leads it: a cover's cloth comes from the live scheme, so the same
 * params in two rooms are two different PNGs.
 *
 * `covering` is folded through `coveringSpecFor` rather than written raw,
 * because that is the function the drawing reads — a book with no `covering`
 * and a book pinned to the covering its material resolves to are the same
 * picture, and they should be the same PNG.
 */
export function coverCacheKey(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): string {
  return `${flatSchemeTag()}|${params.seed}|${params.palette}|${params.clothHex ?? '-'}|${params.coverBaseHex ?? '-'}|${params.coverAccentHex ?? '-'}|${params.toolingHex ?? '-'}|${params.emblemHex ?? '-'}|${params.hardwareHex ?? '-'}|${params.texture}|${coveringSpecFor(params).id}|${params.frame}|${params.medallion}|${params.titleFont}|${params.gilt ? 1 : 0}|${params.raisedBands ?? '-'}|${params.bandGilt ? 1 : 0}|${params.headTail ? 1 : 0}|${params.headTailStyle ?? '-'}|${params.material ?? '-'}|${params.titlePlate ?? '-'}|${params.cornerProtectors ? 1 : 0}|${params.insetPlate ? 1 : 0}|${params.edge ?? '-'}|${(params.wear ?? 0).toFixed(3)}|${params.charm ?? '-'}|${params.charmColor ?? 0}|${Math.round(w)}x${Math.round(h)}|${opts.plate === false ? 0 : 1}|${title}`;
}

/**
 * Bake-once data-URL for a cover. Keyed by seed, overrides, size and title —
 * repeated calls (overlay opens, backdrop re-renders) hit the cache.
 *
 * Every knob that changes a pixel has to appear in this key or the cover will
 * not re-bake when the studio turns it.
 */
export function coverDataUrl(
  w: number,
  h: number,
  params: CoverParams,
  title = '',
  opts: RenderCoverOptions = {},
): string {
  const key = coverCacheKey(w, h, params, title, opts);
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached;
  const url = renderCover(w, h, params, title, opts).toDataURL('image/png');
  // A cover baked before its title face arrived is a cover lettered in the
  // generic. Draw it — a titled cover in the wrong hand beats a blank wait —
  // but do not let it become the answer for the rest of the session.
  if (title.trim() !== '' && !handLoaded(params.titleFont, h * 0.08)) return url;
  // Guard the cache: keep it bounded (covers are ~100-300KB each).
  if (urlCache.size > 24) {
    const first = urlCache.keys().next().value;
    if (first !== undefined) urlCache.delete(first);
  }
  urlCache.set(key, url);
  return url;
}
