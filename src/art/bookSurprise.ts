/**
 * art/bookSurprise.ts — constrained, lock-aware whole-book generation.
 *
 * Surprise is deliberately not a bag of independent dice. A binding has a
 * physical structure and a visual hierarchy: the silhouette and covering set
 * the period, the title needs an uninterrupted compartment, surface tooling
 * has a density, and metal/ink have to remain legible on the actual material
 * colour. The old generator chose a vetted named binding, but then crossed it
 * with independent bands, plates, ornaments, frames, fittings and charms. All
 * of those choices were individually legal; the cross-product was frequently
 * over-dressed and sometimes left no usable front-cover title compartment.
 *
 * This module now uses a small quality-diversity search:
 *
 *   1. build only from art-directed binding pools;
 *   2. apply reader locks exactly;
 *   3. repair unlocked neighbours around those locks;
 *   4. score physical legibility, period/material fit and decoration density;
 *   5. retain the best candidate in each visual cell, then choose
 *      deterministically among near-best cells.
 *
 * The result is still instantaneous (at most 192 plain-object candidates),
 * deterministic for a seed, and diverse across silhouette, palette and
 * furnishing density. This follows the useful part of quality-diversity
 * generation without putting an evolutionary runtime in a settings panel.
 */

import {
  BOOK_PRESET_IDS,
  BOOK_SURPRISE_DIRECTIONS,
  FORMAL_BOOK_PRESET_ID,
  MATERIALS,
  ROLLABLE_PRESETS,
  bindingMaterialFor,
  bookBodyColours,
  bookColourSources,
  bookPainterColours,
  bookPreset,
  bookPresetHasAuthoredFocal,
  bookPresetWantsCoverTitle,
  materialLookFor,
  parseOwnBinding,
  presetForSeed,
  resolveBookDesign,
  type BookDesign,
  type BookPreset,
  type BookPresetId,
  type BookSurpriseDirectionId,
  type Decoration,
  type MaterialLook,
  type SpineShape,
} from './bookDesign';
import {
  ACTIVE_COVER_FRAME_INDICES,
  ACTIVE_COVER_FRAMES,
  coverBodyColours,
  coverCompositionLayout,
  coverPainterColours,
  normalizeCoverFrameIndex,
  type CoverParams,
} from './covers';
import { FLAT } from './flat';
import {
  SPINE_FORMATS,
  SPINE_THICKNESS_RANGE,
  PIGMENT_COUNT,
  heightForFormat,
  type BookStyle,
  type BookStyleOverrides,
  type CharmKind,
  type EdgeTreatment,
  type SpineFormat,
  type TitlePlateStyle,
} from './bookStyle';
import { clamp, mulberry32, type RandomFn } from './noise';
import {
  ACTIVE_EDGE_TREATMENTS,
  ACTIVE_ORNAMENT_INDICES,
  ACTIVE_TITLE_PLATES,
  MAX_RAISED_BANDS,
  normalizeEdgeTreatment,
  normalizeHeadTailStyle,
  normalizeOrnamentIndex,
  normalizeTitlePlateStyle,
} from './spines';
import { colourContrast } from './titleContrast';

/* ========================================================================== *
 *                              public contract                               *
 * ========================================================================== */

/** Seven meaningful colour roles, chosen together rather than independently. */
export interface BookSurprisePalette {
  spineBaseHex: string;
  spineAccentHex: string;
  coverBaseHex: string;
  coverAccentHex: string;
  toolingHex: string;
  emblemHex: string;
  hardwareHex: string;
}

/**
 * Persistable sources behind the four material-dependent colour wells.
 *
 * The well itself is painter output. Saving that output as a new input would
 * apply the material transform twice (deep buckram gets darker again, worn
 * cloth fades again), while vellum cannot use it at all. Locks therefore carry
 * both views and replay these source pigments under a coupled material/wear
 * contract.
 */
export interface BookSurpriseBodyColourSources {
  spineBaseHex: string;
  spineAccentHex: string;
  coverBaseHex: string;
  coverAccentHex: string;
}

export interface BookSurpriseColourProjection {
  visible: BookSurprisePalette;
  sources: BookSurpriseBodyColourSources;
}

/**
 * Project the Studio wells through the exact same material folds as both
 * painters. Detail roles remain source controls because one shared tooling
 * value is painted against several different surfaces; body/accent roles each
 * have one authoritative representative flat fill.
 */
export function resolveBookSurpriseColourProjection(
  spine: BookDesign,
  cover: CoverParams,
  style: Pick<BookStyle, 'toolingHex' | 'emblemHex' | 'hardwareHex' | 'gilt'>,
): BookSurpriseColourProjection {
  const spineSources = bookColourSources(spine);
  const spineVisible = bookPainterColours(spine);
  const coverColours = coverPainterColours(cover);
  const tooling = style.toolingHex ?? (style.gilt ? FLAT.gilt : FLAT.inkSoft);
  return {
    visible: {
      spineBaseHex: spineVisible.base,
      spineAccentHex: spineVisible.accent,
      coverBaseHex: coverColours.visible.base,
      coverAccentHex: coverColours.visible.accent,
      toolingHex: tooling,
      emblemHex: style.emblemHex ?? tooling,
      hardwareHex: style.hardwareHex ?? (style.gilt ? FLAT.gilt : FLAT.timber),
    },
    sources: {
      spineBaseHex: spineSources.base,
      spineAccentHex: spineSources.accent,
      coverBaseHex: coverColours.sources.base,
      coverAccentHex: coverColours.sources.accent,
    },
  };
}

/** The binding components the generator selected or preserved. */
export interface BookSurpriseComponents {
  shape: SpineShape;
  material: MaterialLook;
  decorations: readonly Decoration[];
  gilt: boolean;
}

export type BookSurpriseQuality = 'excellent' | 'strong' | 'acceptable';

export interface BookSurpriseDiagnostic {
  code:
    | 'duplicate-bands'
    | 'furniture-density'
    | 'material-structure'
    | 'finish-direction'
    | 'composition-hierarchy'
    | 'direction-identity'
    | 'proportion'
    | 'colour-contrast'
    | 'colour-harmony'
    | 'locked-compromise'
    | 'curation-fallback';
  message: string;
  /** Points removed from the 100-point candidate score. */
  penalty: number;
  /** True when the generator retained the issue because a reader locked it. */
  locked?: boolean;
}

/**
 * Serializable locks used by Book Studio.
 *
 * Each id names a reader-visible decision, not an implementation field. Some
 * decisions own several fields (`bands`, `endbands`, `format`), which prevents
 * a lock from preserving half a physical treatment and randomising the other
 * half. `overlap` is deliberately absent: it is a shelf-safety preference and
 * Surprise always preserves it, locked or not.
 */
export const BOOK_SURPRISE_LOCK_IDS = [
  'binding',
  'binding.shape',
  'binding.material',
  'binding.decoration',
  'binding.gilt',
  'cover.material',
  'format',
  'thickness',
  'title.plate',
  'title.font',
  'title.gilt',
  'colour.palette',
  'colour.spine-base',
  'colour.spine-accent',
  'colour.cover-base',
  'colour.cover-accent',
  'colour.tooling',
  'colour.emblem',
  'bands',
  'endbands',
  'ornament',
  'wear',
  'edge',
  'cover.frame',
] as const;

export type BookSurpriseLockId = (typeof BOOK_SURPRISE_LOCK_IDS)[number];

/** JSON-safe lock set. Normalize before persisting or comparing. */
export type BookSurpriseLockSet = readonly BookSurpriseLockId[];

export type BookSurpriseDecisionGroup =
  | 'binding'
  | 'size'
  | 'title'
  | 'colour'
  | 'spine'
  | 'finish'
  | 'cover';

export interface BookSurpriseLockDefinition {
  id: BookSurpriseLockId;
  label: string;
  group: BookSurpriseDecisionGroup;
  /** Style fields preserved exactly by this lock. Empty for binding locks. */
  fields: readonly (keyof BookStyle)[];
}

/** One source of truth for UI labels and the exact fields each lock owns. */
export const BOOK_SURPRISE_LOCK_DEFINITIONS: Readonly<
  Record<BookSurpriseLockId, BookSurpriseLockDefinition>
> = Object.freeze({
  binding: lock('binding', 'binding', 'binding'),
  'binding.shape': lock('binding.shape', 'spine shape', 'binding'),
  'binding.material': lock('binding.material', 'binding covering', 'binding'),
  'binding.decoration': lock('binding.decoration', 'binding marks', 'binding'),
  'binding.gilt': lock('binding.gilt', 'binding tooling', 'binding'),
  'cover.material': lock('cover.material', 'material', 'binding', ['material']),
  format: lock('format', 'format and height', 'size', ['format', 'height']),
  thickness: lock('thickness', 'thickness', 'size', ['thickness']),
  'title.plate': lock('title.plate', 'title treatment', 'title', ['titlePlate']),
  'title.font': lock('title.font', 'title lettering', 'title', ['titleFont']),
  'title.gilt': lock('title.gilt', 'gilt', 'title', ['gilt']),
  'colour.palette': lock('colour.palette', 'book pigment', 'colour', [
    'pigment',
    'clothHex',
    'hueJitter',
  ]),
  'colour.spine-base': lock('colour.spine-base', 'spine cloth', 'colour', ['spineBaseHex']),
  'colour.spine-accent': lock('colour.spine-accent', 'spine accent', 'colour', ['spineAccentHex']),
  'colour.cover-base': lock('colour.cover-base', 'cover cloth', 'colour', ['coverBaseHex']),
  'colour.cover-accent': lock('colour.cover-accent', 'cover accent', 'colour', ['coverAccentHex']),
  'colour.tooling': lock('colour.tooling', 'tooling', 'colour', ['toolingHex']),
  'colour.emblem': lock('colour.emblem', 'emblems', 'colour', ['emblemHex']),
  bands: lock('bands', 'raised cords', 'spine', ['raisedBands', 'bandGilt']),
  endbands: lock('endbands', 'head and tail bands', 'spine', ['headTail', 'headTailStyle']),
  ornament: lock('ornament', 'spine ornament', 'spine', ['ornament']),
  wear: lock('wear', 'wear', 'finish', ['wear']),
  edge: lock('edge', 'page edges', 'finish', ['edge']),
  'cover.frame': lock('cover.frame', 'cover frame', 'cover', ['coverFrame']),
});

function lock(
  id: BookSurpriseLockId,
  label: string,
  group: BookSurpriseDecisionGroup,
  fields: readonly (keyof BookStyle)[] = [],
): BookSurpriseLockDefinition {
  return { id, label, group, fields };
}

const BOOK_SURPRISE_LOCK_ID_SET: ReadonlySet<string> = new Set(BOOK_SURPRISE_LOCK_IDS);

export function isBookSurpriseLockId(value: unknown): value is BookSurpriseLockId {
  return typeof value === 'string' && BOOK_SURPRISE_LOCK_ID_SET.has(value);
}

/**
 * Tolerantly read a lock collection from settings JSON, a Set or arbitrary
 * input. Unknown/future ids are dropped; duplicates are folded; declaration
 * order makes the serialized value stable across clicks and sessions.
 */
export function normalizeBookSurpriseLocks(raw: unknown): BookSurpriseLockSet {
  const values = raw instanceof Set ? [...raw] : Array.isArray(raw) ? raw : [];
  const present = new Set(values.filter(isBookSurpriseLockId));
  return Object.freeze(BOOK_SURPRISE_LOCK_IDS.filter((id) => present.has(id)));
}

/** The current, fully normalized appearance that locks preserve. */
export interface BookSurpriseCurrent {
  /** The effective binding visible now (seed binding included), never a fake id. */
  binding: BookPresetId;
  /** `resolveBookStyle(...).style`, not the sparse persistence blob. */
  style: BookStyle;
  /**
   * Which resolved style fields came from an actual per-book override.
   *
   * A fully resolved style cannot otherwise distinguish a visible value from
   * a latent seed value which the named binding overrules. Surprise needs that
   * distinction when a reader closes a lock: locking Cloth on a Gilt Quarto
   * must capture the cloth they can see, not the unrelated seed roll stored in
   * `style.material`. Omit this only in compatibility callers whose `style`
   * already represents the effective values they intend to preserve.
   */
  pinned?: ReadonlySet<keyof BookStyle>;
  /**
   * The seven colour wells exactly as presented to the reader after inherited
   * binding/pigment fallbacks have resolved. Nullable BookStyle fields cannot
   * carry this information on their own: locking an inherited spine cloth
   * must keep the cloth on the canvas, not preserve `null` while a generated
   * explicit colour quietly paints over it.
   */
  visibleColours?: BookSurprisePalette;
  /**
   * Persistable pigments behind the four material-dependent wells above.
   * Optional for compatibility callers; Book Studio always supplies it.
   */
  colourSources?: BookSurpriseBodyColourSources;
}

/** The four reader-curated binding lists that constrain whole-book Surprise. */
export interface BookSurpriseCuration {
  bindings?: readonly string[];
  shapes?: readonly string[];
  materials?: readonly string[];
  decorations?: readonly string[];
  /**
   * Removed ids from the Studio's non-binding curated rows. Values use the
   * exact persisted ids (`String(index)` for numeric vocabularies). Locks win
   * over removals: a reader who explicitly keeps a current hidden choice has
   * made the narrower, newer request.
   */
  style?: Partial<Readonly<Record<BookSurpriseStyleCurationAxis, readonly string[]>>>;
}

export type BookSurpriseStyleCurationAxis =
  | 'binding-material'
  | 'ornament'
  | 'title-plate'
  | 'lettering'
  | 'edge'
  | 'format'
  | 'charm'
  | 'cover-frame'
  | 'cover-medallion'
  | 'spine-cloth'
  | 'charm-colour';

export type BookSurprisePresetGuard = (preset: BookPreset) => boolean;

/** Object-form input used by the lock-aware Studio. */
export interface BookSurpriseRequest {
  direction: BookSurpriseDirectionId | null;
  seed: number;
  current?: BookSurpriseCurrent;
  locks?: BookSurpriseLockSet | ReadonlySet<BookSurpriseLockId> | unknown;
  curation?: BookSurpriseCuration;
  /** Compatibility seam for older callers with a pre-built curation guard. */
  guard?: BookSurprisePresetGuard;
  /** Softly avoid an unchanged press when no binding lock prevents it. */
  avoidBinding?: BookPresetId | null;
}

/** The complete result the Studio applies in one appearance transaction. */
export interface BookSurpriseRecipe {
  preset: BookPresetId;
  style: BookStyleOverrides;
  direction: BookSurpriseDirectionId;
  /** Authored whole-book grammar used to compose this result. */
  archetype: string;
  /** Search breadth, exposed so QA can distinguish search from a single roll. */
  candidatesEvaluated: number;
  locks: BookSurpriseLockSet;
  components: BookSurpriseComponents;
  /** 0–100; generated candidates normally land in the strong/excellent band. */
  score: number;
  quality: BookSurpriseQuality;
  /** Zero unless every available candidate violates an unlocked hard rule. */
  constraintViolations: number;
  diagnostics: readonly BookSurpriseDiagnostic[];
}

/**
 * One named binding's complete treatment roster inside a Surprise search.
 *
 * This is intentionally a summary rather than the generated styles themselves:
 * specimen tooling can prove breadth, reachability and construction safety
 * without growing the persisted recipe or depending on private scorer details.
 */
export interface BookSurprisePresetSearchAudit {
  preset: BookPresetId;
  archetype: string;
  treatmentsEvaluated: number;
  legalTreatments: number;
  minimumScore: number;
  maximumScore: number;
  /** False means the whole binding is removed before archetype/preset choice. */
  structurallyEligible: boolean;
  /** Distinct diagnostics carried by structurally rejected treatments. */
  violationCodes: readonly BookSurpriseDiagnostic['code'][];
  violationMessages: readonly string[];
  treatments: readonly BookSurpriseTreatmentSearchAudit[];
}

/** Reproducible treatment detail for specimen and negative-control tooling. */
export interface BookSurpriseTreatmentSearchAudit {
  treatment: number;
  style: BookStyleOverrides;
  score: number;
  constraintViolations: number;
  diagnostics: readonly BookSurpriseDiagnostic[];
}

/** Transparent, deterministic account of the exact production search. */
export interface BookSurpriseSearchInspection {
  direction: BookSurpriseDirectionId;
  candidatesEvaluated: number;
  selectedPreset: BookPresetId;
  selectedArchetype: string;
  presets: readonly BookSurprisePresetSearchAudit[];
}

/* ========================================================================== *
 *                           curation and feasibility                          *
 * ========================================================================== */

type OwnPart = 'shape' | 'material' | 'decoration';

const ACTIVE_NAMED_SURPRISE_PRESETS: ReadonlySet<string> = new Set(
  BOOK_PRESET_IDS,
);

/**
 * Resolve a stored binding through the reset boundary used by Surprise.
 *
 * `bookPreset` deliberately retains a very small compatibility catalogue for
 * ordinary rendering. Surprise has a stricter contract: a lock may preserve a
 * reader's current choice only when that choice is still in the active named
 * collection, or is an `own:` composition whose every axis passed the current
 * vocabulary parser. A historical brocade/pictogram/odd-shape id therefore
 * becomes the formal binding even when an old lock blob asks to keep it.
 */
function activePresetForSurpriseBinding(
  binding: BookPresetId | null | undefined,
): BookPreset {
  const resolved = bookPreset(binding);
  if (
    ACTIVE_NAMED_SURPRISE_PRESETS.has(resolved.id) ||
    parseOwnBinding(binding) !== null
  ) return resolved;
  return bookPreset(FORMAL_BOOK_PRESET_ID);
}

function hiddenPart(
  hidden: readonly string[] | undefined,
  part: OwnPart,
  value: string,
): boolean {
  if (hidden === undefined) return false;
  return hidden.some((id) => id === value || parseOwnBinding(id)?.[part] === value);
}

/** True when a named binding remains legal under the reader's removals. */
export function bookPresetAllowedByCuration(
  preset: BookPreset,
  curation: BookSurpriseCuration,
): boolean {
  if (curation.bindings?.includes(preset.id) === true) return false;
  if (hiddenPart(curation.shapes, 'shape', preset.shape)) return false;
  if (hiddenPart(curation.materials, 'material', preset.material)) return false;
  const marks = preset.decorations.length === 0 ? ['none'] : preset.decorations;
  return !marks.some((mark) => hiddenPart(curation.decorations, 'decoration', mark));
}

function sameDecorations(a: readonly Decoration[], b: readonly Decoration[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasLock(locks: ReadonlySet<BookSurpriseLockId>, id: BookSurpriseLockId): boolean {
  return locks.has('binding') || locks.has(id);
}

/**
 * Compatibility callers predate pin provenance and pass values they already
 * consider effective. When provenance is present, only a member of the set is
 * an authored style override; every other field is allowed to yield to the
 * named binding exactly as the renderer does.
 */
function currentFieldPinned(
  current: BookSurpriseCurrent,
  field: keyof BookStyle,
): boolean {
  const recorded = current.pinned === undefined || current.pinned.has(field);
  if (!recorded) return false;
  // Null colour roles are the UI's explicit "inherit" state. They may remain
  // as keys in older blobs so clearing survives a round trip, but they do not
  // own a pigment or turn a natural vellum body into a dyed one.
  if (
    (field === 'spineBaseHex'
      || field === 'spineAccentHex'
      || field === 'coverBaseHex'
      || field === 'coverAccentHex')
    && current.style[field] === null
  ) return false;
  return true;
}

const BODY_COLOUR_LOCKS = [
  'colour.spine-base',
  'colour.spine-accent',
  'colour.cover-base',
  'colour.cover-accent',
] as const satisfies readonly BookSurpriseLockId[];

const SPINE_BODY_COLOUR_LOCKS = [
  'colour.spine-base',
  'colour.spine-accent',
] as const satisfies readonly BookSurpriseLockId[];

type BodyColourField = keyof BookSurpriseBodyColourSources;

function hasOneOf(
  locks: ReadonlySet<BookSurpriseLockId>,
  ids: readonly BookSurpriseLockId[],
): boolean {
  return ids.some((id) => locks.has(id));
}

function isBodyColourField(field: keyof BookStyle): field is BodyColourField {
  return field === 'spineBaseHex'
    || field === 'spineAccentHex'
    || field === 'coverBaseHex'
    || field === 'coverAccentHex';
}

/** Exact named covering whose material transform is visible right now. */
function effectiveCurrentMaterialLook(current: BookSurpriseCurrent): MaterialLook {
  return currentFieldPinned(current, 'material')
    ? materialLookFor(current.style.material)
    : activePresetForSurpriseBinding(current.binding).material;
}

/** The coarse material family painted on both faces right now. */
function effectiveCurrentMaterial(current: BookSurpriseCurrent): BookStyle['material'] {
  return currentFieldPinned(current, 'material')
    ? current.style.material
    : (bindingMaterialFor(activePresetForSurpriseBinding(current.binding).material) as BookStyle['material']);
}

/**
 * The title treatment the front cover paints right now.
 *
 * A latent `none` may still inherit the named binding's authored cover label;
 * an explicitly pinned `none` remains an instruction to keep the cover bare.
 */
function effectiveCurrentTitlePlate(current: BookSurpriseCurrent): BookStyle['titlePlate'] {
  if (currentFieldPinned(current, 'titlePlate') || current.style.titlePlate !== 'none') {
    return current.style.titlePlate;
  }
  return bookPresetWantsCoverTitle(activePresetForSurpriseBinding(current.binding).id)
    ? 'label'
    : 'none';
}

function effectiveCurrentStyleField(
  current: BookSurpriseCurrent,
  field: keyof BookStyle,
): BookStyle[keyof BookStyle] {
  if (field === 'material') return effectiveCurrentMaterial(current);
  if (field === 'titlePlate') return effectiveCurrentTitlePlate(current);
  if (isBodyColourField(field)) {
    const body = MATERIALS[effectiveCurrentMaterialLook(current)].body;
    const naturalPaleBase =
      (field === 'spineBaseHex' || field === 'coverBaseHex')
      && !currentFieldPinned(current, field)
      && (body === 'cream' || body === 'parchment');
    // A painter-visible colour is OUTPUT, not a safe input. Replaying the
    // output through deep/pale/wear transforms moves it a second time. Studio
    // supplies the exact source; older callers retain their previous visible-
    // value behavior as a compatibility fallback.
    //
    // Natural vellum/parchment is the one exception. A lock turns an inherited
    // role into an explicit one, so replaying the hidden shared cloth would
    // newly dye the page-white surface. Seed the new explicit role from the
    // visible natural face instead; its pale wash is then pixel-stable.
    return (naturalPaleBase ? current.visibleColours?.[field] : undefined)
      ?? current.colourSources?.[field]
      ?? current.visibleColours?.[field]
      ?? current.style[field];
  }
  if (current.visibleColours !== undefined) {
    if (field === 'toolingHex') return current.visibleColours.toolingHex;
    if (field === 'emblemHex') return current.visibleColours.emblemHex;
  }
  return current.style[field];
}

function allowedWithLockedExceptions(
  preset: BookPreset,
  request: NormalizedRequest,
): boolean {
  const current = request.current === undefined
    ? null
    : activePresetForSurpriseBinding(request.current.binding);
  const exactLocked = request.lockSet.has('binding') && current?.id === preset.id;
  if (!exactLocked && request.guard !== undefined && !request.guard(preset)) return false;
  const c = request.curation;
  if (c === undefined) return true;

  if (
    c.bindings?.includes(preset.id) === true &&
    !(request.lockSet.has('binding') && current?.id === preset.id)
  ) return false;
  if (
    hiddenPart(c.shapes, 'shape', preset.shape) &&
    !(hasLock(request.lockSet, 'binding.shape') && current?.shape === preset.shape)
  ) return false;
  if (
    hiddenPart(c.materials, 'material', preset.material) &&
    !(hasLock(request.lockSet, 'binding.material') && current?.material === preset.material)
  ) return false;

  const marks = preset.decorations.length === 0 ? ['none'] : preset.decorations;
  if (
    marks.some((mark) => hiddenPart(c.decorations, 'decoration', mark)) &&
    !(
      hasLock(request.lockSet, 'binding.decoration') &&
      current !== null &&
      sameDecorations(current.decorations, preset.decorations)
    )
  ) return false;
  return true;
}

function respectsComponentLocks(preset: BookPreset, request: NormalizedRequest): boolean {
  if (request.current === undefined) return true;
  const current = activePresetForSurpriseBinding(request.current.binding);
  if (request.lockSet.has('binding')) return preset.id === current.id;
  if (request.lockSet.has('binding.shape') && preset.shape !== current.shape) return false;
  if (request.lockSet.has('binding.material') && preset.material !== current.material) return false;
  if (
    request.lockSet.has('binding.decoration') &&
    !sameDecorations(preset.decorations, current.decorations)
  ) return false;
  if (request.lockSet.has('binding.gilt') && preset.gilt !== current.gilt) return false;
  // The coarse material chip overrules the exact named covering at render
  // time. When that chip is locked, choose a binding whose authored material
  // belongs to the same family so its name/tooling do not tell another story.
  if (
    request.lockSet.has('cover.material') &&
    bindingMaterialFor(preset.material) !== effectiveCurrentMaterial(request.current)
  ) return false;
  /*
   * A material is part of a colour transformation, not decoration around it:
   * deep buckram darkens the source, paper washes it, inherited vellum replaces
   * it while an explicit vellum face becomes a pale dye, and split bindings
   * decide whether the accent is present. When no explicit
   * coarse-material override already owns that transform, a visible body or
   * accent lock therefore constrains Surprise to the exact current covering.
   * The current preset remains the total fallback, so this can never empty the
   * operation even after aggressive picker curation.
   */
  if (
    hasOneOf(request.lockSet, BODY_COLOUR_LOCKS)
    && !currentFieldPinned(request.current, 'material')
    && preset.material !== effectiveCurrentMaterialLook(request.current)
  ) return false;
  return true;
}

/* ========================================================================== *
 *                              authored palettes                             *
 * ========================================================================== */

function palette(
  spineBaseHex: string,
  spineAccentHex: string,
  coverBaseHex: string,
  coverAccentHex: string,
  toolingHex: string,
  emblemHex: string,
  hardwareHex: string,
): BookSurprisePalette {
  return {
    spineBaseHex,
    spineAccentHex,
    coverBaseHex,
    coverAccentHex,
    toolingHex,
    emblemHex,
    hardwareHex,
  };
}

/**
 * Authored colour families. The spine and board may differ, but they share a
 * temperature/value story; none is assembled by independently crossing seven
 * swatches. Six families per direction are enough for real variety while
 * remaining small enough to inspect as a complete board.
 */
export const BOOK_SURPRISE_PALETTES: Readonly<
  Record<BookSurpriseDirectionId, readonly BookSurprisePalette[]>
> = {
  formal: [
    palette('#344f67', '#7b3e46', '#405d73', '#c4ad7d', '#efd37e', '#f4dda0', '#c99a49'),
    palette('#743b43', '#315449', '#82464c', '#c8b788', '#efd37e', '#f5dfa1', '#bd8d42'),
    palette('#3e4b45', '#755040', '#4b5b51', '#c0a878', '#e9c96f', '#f0d58d', '#b8863d'),
    palette('#42485d', '#765044', '#50576d', '#b8a47f', '#ead181', '#f1dda7', '#a97c42'),
    palette('#67414b', '#394d5b', '#744b55', '#9b7c70', '#efcf75', '#f5dda0', '#b98843'),
    palette('#31564f', '#68434a', '#3c645c', '#ad9578', '#ecd17c', '#f3dfa6', '#b58141'),
  ],
  grand: [
    palette('#65405a', '#315b50', '#744c67', '#b88a6f', '#f0cf69', '#f6df94', '#c6933b'),
    palette('#2f5a50', '#714552', '#3b695c', '#b49763', '#efd06d', '#f5df98', '#c08c3e'),
    palette('#394c70', '#7c4b42', '#475d82', '#c2a46f', '#f1d16f', '#f7e09a', '#bd8840'),
    palette('#5f3846', '#294e55', '#714554', '#a78265', '#f0cd67', '#f7df94', '#c38f3b'),
    palette('#413969', '#70463d', '#51477b', '#ad8967', '#f1d170', '#f7e09a', '#bf8940'),
    palette('#294f47', '#6b3c50', '#356057', '#a88967', '#efd06b', '#f5dc91', '#bd873b'),
  ],
  antique: [
    palette('#664838', '#94704f', '#765542', '#c3a477', '#d8b667', '#ead08d', '#9f723e'),
    palette('#635841', '#82624b', '#74684d', '#bda474', '#d8bd72', '#ead59c', '#927149'),
    palette('#70433c', '#8c704d', '#805047', '#c4a978', '#dcb969', '#edd497', '#a57a43'),
    palette('#54483d', '#79644e', '#645548', '#b69b72', '#d9bb70', '#ead39a', '#917048'),
    palette('#725447', '#8e7657', '#826354', '#c2aa80', '#d8b96d', '#ead29a', '#a07848'),
    palette('#4f5645', '#80604a', '#606552', '#b9a378', '#d8bd73', '#ead59e', '#957344'),
  ],
  storybook: [
    palette('#597895', '#a24f4b', '#6a88a2', '#c97961', '#f1d77f', '#f7e29e', '#c39243'),
    palette('#9c5545', '#4b6d72', '#ad6755', '#78939a', '#efd27a', '#f6dfa0', '#b9823d'),
    palette('#6e5680', '#b66a52', '#806991', '#d19471', '#f0d67d', '#f7e2a1', '#c08d43'),
    palette('#3f7470', '#b36a55', '#518681', '#d09a75', '#f0d580', '#f8e4aa', '#bd8844'),
    palette('#8a566d', '#54788a', '#9d697d', '#84a0ac', '#efd583', '#f7e3aa', '#bc8743'),
    palette('#5d6f94', '#9f6551', '#6e81a5', '#ca9472', '#f0d37b', '#f7e09e', '#c18b42'),
  ],
  botanical: [
    palette('#53664a', '#a86646', '#637458', '#c1ad75', '#e5cd74', '#f0dda0', '#aa7b42'),
    palette('#46675b', '#9a5947', '#58796c', '#bda475', '#e7cd76', '#f2dea1', '#a97640'),
    palette('#6a6846', '#a5684b', '#7a7954', '#c5b57b', '#e7cf77', '#f0dda0', '#a57a42'),
    palette('#3f624f', '#8b6544', '#506f5d', '#b69f74', '#e4ca73', '#f0dda4', '#a47741'),
    palette('#5d704d', '#9b6b4f', '#6d815c', '#bea980', '#e4cd79', '#f1dfa8', '#a57945'),
    palette('#4b665f', '#8f5a45', '#5d776f', '#bba179', '#e6cd78', '#f2dfa4', '#aa7840'),
  ],
  cosy: [
    palette('#9a5545', '#587180', '#ac6653', '#c78d6d', '#edd17c', '#f4dfa2', '#af7b40'),
    palette('#71556b', '#a86a4e', '#82677b', '#ca9474', '#ecd17c', '#f4dfa1', '#b17d43'),
    palette('#526c68', '#a85d4c', '#64807b', '#c68d70', '#eed37e', '#f5e0a2', '#b58042'),
    palette('#83545d', '#526f78', '#956771', '#91a4a8', '#ecd181', '#f4e0a7', '#ae7d47'),
    palette('#a0654f', '#5f6c82', '#b27660', '#8d9bb0', '#edd382', '#f5e1aa', '#b27e43'),
    palette('#65627d', '#a26753', '#77738f', '#ca9578', '#edd281', '#f5e1a8', '#b17d44'),
  ],
  rustic: [
    palette('#79513d', '#9a774b', '#895f47', '#b49561', '#d9b868', '#ead28f', '#966a39'),
    palette('#596044', '#8e5c42', '#6a704f', '#b29261', '#d9bd6d', '#ead59a', '#96703f'),
    palette('#6a5544', '#8e714c', '#7b6550', '#b99b69', '#dabd70', '#ebd69a', '#99713f'),
    palette('#69483a', '#876347', '#795746', '#aa895e', '#d6b66a', '#e9d195', '#91683c'),
    palette('#4f5b43', '#7c5840', '#5f694f', '#a98d66', '#d7bc73', '#ead59c', '#926d42'),
    palette('#755b45', '#92764f', '#856b52', '#b09a70', '#d9bd72', '#ebd7a0', '#987143'),
  ],
  quiet: [
    palette('#4f6170', '#776370', '#60727f', '#a99a83', '#e1cca0', '#ecdcb8', '#9f7d55'),
    palette('#5c5a64', '#68746b', '#6e6b75', '#aca18c', '#e3cea1', '#edddba', '#9d7c57'),
    palette('#586866', '#76636c', '#687977', '#aaa08c', '#e2cda1', '#edddba', '#9e7c56'),
    palette('#455a62', '#716168', '#566b72', '#a29584', '#dfcba3', '#ebdcb9', '#987b58'),
    palette('#5a604f', '#75645d', '#6b705e', '#aaa08d', '#e0cda6', '#ecddbb', '#9a7c59'),
    palette('#59566a', '#6d6f64', '#6b687b', '#aaa08e', '#e1cca2', '#edddba', '#9b7c58'),
  ],
};

/* ========================================================================== *
 *                          direction design profiles                         *
 * ========================================================================== */

interface DirectionProfile {
  formats: readonly SpineFormat[];
  /** Title faces, index-aligned with BookStyle.TITLE_FONTS. */
  fonts: readonly (0 | 1 | 2)[];
  thickness: readonly [number, number];
  bands: readonly [number, number];
  wear: readonly [number, number];
  plates: readonly TitlePlateStyle[];
  ornaments: readonly number[];
  frames: readonly number[];
  edges: readonly EdgeTreatment[];
  charms: readonly Exclude<CharmKind, 'none'>[];
  charmChance: number;
  ornamentChance: number;
  headTailChance: number;
  cornerChance: number;
  insetChance: number;
  /** Preferred total visual-furniture score, inclusive. */
  density: readonly [number, number];
}

function profile(value: DirectionProfile): DirectionProfile {
  return value;
}

/**
 * These ranges are intentionally conservative. A named preset already brings
 * material marks and authored tooling; Surprise supplies the second layer,
 * not a second binding on top of it. In particular, raised cords start at
 * zero and are repaired away whenever the named binding already draws bands.
 */
const DIRECTIONS: Readonly<Record<BookSurpriseDirectionId, DirectionProfile>> = {
  formal: profile({
    formats: ['quarto', 'octavo'], fonts: [0, 1], thickness: [25, 45], bands: [0, 3], wear: [0, 0.18],
    plates: ['label', 'morocco-label', 'presentation-shoulder', 'double-fillet', 'split-binding-band'],
    ornaments: [0, 8, 12, 17, 20, 26, 51, 61, 62, 63, 64],
    frames: [0, 2, 5, 15, 24, 28, 30], edges: ['plain', 'top-gilt', 'all-edges-gilt', 'stained-red'],
    charms: ['ribbon', 'clasp'], charmChance: 0.14, ornamentChance: 0.58,
    headTailChance: 0.72, cornerChance: 0.24, insetChance: 0.34, density: [2.1, 5.2],
  }),
  grand: profile({
    formats: ['folio', 'quarto'], fonts: [0, 1], thickness: [34, 54], bands: [0, 3], wear: [0, 0.13],
    plates: ['presentation-shoulder', 'split-binding-band', 'gilt-direct', 'oxford-compartment'],
    ornaments: [12, 20, 21, 26, 32, 51, 61, 63, 64],
    frames: [16, 19, 21, 26, 30, 34, 38, 42, 44, 45, 47, 48],
    edges: ['all-edges-gilt', 'gauffered', 'antique-gilt', 'red-under-gold'],
    charms: ['tassel', 'clasp', 'wax-seal'], charmChance: 0.24, ornamentChance: 0.76,
    headTailChance: 0.82, cornerChance: 0.48, insetChance: 0.52, density: [4.2, 7.1],
  }),
  antique: profile({
    formats: ['folio', 'quarto', 'octavo'], fonts: [0, 1, 2], thickness: [25, 47], bands: [0, 3], wear: [0.26, 0.66],
    plates: ['morocco-label', 'calf-compartment', 'vellum-ink-field', 'oxford-compartment'],
    ornaments: [8, 9, 13, 17, 20, 22, 26, 38, 50, 61],
    frames: [0, 2, 5, 15, 24, 28, 29], edges: ['rough-cut', 'deckle', 'uncut', 'antique-gilt', 'tea-stained', 'foxed'],
    charms: ['ribbon', 'pressed-flower', 'wax-seal'], charmChance: 0.2, ornamentChance: 0.55,
    headTailChance: 0.74, cornerChance: 0.28, insetChance: 0.34, density: [2.2, 5.5],
  }),
  storybook: profile({
    formats: ['quarto', 'octavo', 'duodecimo'], fonts: [0, 1, 2], thickness: [21, 40], bands: [0, 2], wear: [0.06, 0.31],
    plates: ['label', 'vellum-ink-field', 'printer-imprint', 'inlay-strip', 'split-binding-band'],
    ornaments: [2, 5, 6, 9, 21, 33, 34, 36, 40, 41, 45, 49, 52, 53, 54, 58, 64, 65],
    frames: [1, 3, 4, 6, 8, 12, 19, 21], edges: ['plain', 'speckled', 'stained-blue', 'yellow-edges', 'rose-edge'],
    charms: ['ribbon', 'tassel', 'pressed-flower', 'tag'], charmChance: 0.28, ornamentChance: 0.7,
    headTailChance: 0.45, cornerChance: 0.14, insetChance: 0.38, density: [2.4, 5.7],
  }),
  botanical: profile({
    formats: ['quarto', 'octavo', 'duodecimo'], fonts: [0, 1, 2], thickness: [22, 41], bands: [0, 2], wear: [0.1, 0.38],
    plates: ['label', 'vellum-ink-field', 'printer-imprint', 'double-fillet', 'oxford-compartment'],
    ornaments: [1, 8, 10, 13, 14, 23, 27, 28, 29, 31, 38, 40, 55, 56, 57, 58],
    frames: [1, 4, 6, 11, 16, 21, 25, 26], edges: ['plain', 'speckled', 'sprinkled', 'sea-green-edge', 'tea-stained'],
    charms: ['ribbon', 'pressed-flower', 'tag'], charmChance: 0.24, ornamentChance: 0.72,
    headTailChance: 0.56, cornerChance: 0.12, insetChance: 0.34, density: [2.3, 5.5],
  }),
  cosy: profile({
    formats: ['octavo', 'duodecimo', 'pocket'], fonts: [0, 1, 2], thickness: [19, 37], bands: [0, 2], wear: [0.14, 0.43],
    plates: ['label', 'vellum-ink-field', 'printer-imprint', 'twin-rules', 'inlay-strip'],
    ornaments: [9, 13, 19, 23, 27, 34, 35, 36, 37, 40, 49, 50, 52, 53, 54, 58, 65],
    frames: [0, 1, 3, 4, 6, 11, 12], edges: ['plain', 'speckled', 'yellow-edges', 'rose-edge', 'tea-stained'],
    charms: ['ribbon', 'tassel', 'pressed-flower', 'tag'], charmChance: 0.3, ornamentChance: 0.62,
    headTailChance: 0.48, cornerChance: 0.1, insetChance: 0.3, density: [1.9, 5],
  }),
  rustic: profile({
    formats: ['quarto', 'octavo', 'duodecimo'], fonts: [1, 2], thickness: [22, 44], bands: [0, 2], wear: [0.36, 0.72],
    plates: ['label', 'morocco-label', 'calf-compartment', 'split-binding-band', 'oxford-compartment'],
    ornaments: [10, 13, 14, 15, 22, 28, 29, 35, 38, 39, 43, 46, 51, 56, 58],
    frames: [0, 1, 5, 7, 10, 13, 24], edges: ['rough-cut', 'deckle', 'uncut', 'tea-stained', 'spattered', 'well-thumbed'],
    charms: ['ribbon', 'pressed-flower', 'clasp', 'tag'], charmChance: 0.18, ornamentChance: 0.5,
    headTailChance: 0.38, cornerChance: 0.2, insetChance: 0.18, density: [1.5, 4.4],
  }),
  quiet: profile({
    formats: ['octavo', 'duodecimo', 'pocket'], fonts: [1, 2], thickness: [19, 36], bands: [0, 1], wear: [0.02, 0.22],
    plates: ['label', 'vellum-ink-field', 'printer-imprint', 'debossed', 'twin-rules'],
    ornaments: [0, 8, 9, 17, 22, 23, 24, 37, 48, 50, 60, 61],
    frames: [0, 2, 4, 9, 10, 13, 28], edges: ['plain', 'top-gilt', 'stained-blue', 'ink-edge'],
    charms: ['ribbon'], charmChance: 0.05, ornamentChance: 0.3,
    headTailChance: 0.32, cornerChance: 0.04, insetChance: 0.18, density: [0.7, 3.4],
  }),
};

/**
 * Density targets for the reset grammar.
 *
 * The legacy profiles above describe books that could stack a plate, ornate
 * frame, charm and board hardware. Keeping those old minima after retiring the
 * furniture made a coherent title-led Grand book score as "sparse" and forced
 * every winning candidate to add a stamp. These ranges measure the quieter
 * rule-only binding as a finished object, not as an unfinished version of the
 * old costume vocabulary.
 */
const ACTIVE_SURPRISE_DENSITY: Readonly<
  Record<BookSurpriseDirectionId, readonly [number, number]>
> = {
  formal: [1.05, 3.7],
  grand: [1.35, 4.2],
  antique: [1.05, 3.7],
  storybook: [1, 3.7],
  botanical: [1, 3.7],
  cosy: [0.85, 3.35],
  rustic: [0.75, 3.2],
  quiet: [0.45, 2.8],
};

/**
 * A direction is not one enormous cross-product. Each row below is a complete
 * binding grammar: a shortlist of compatible named bindings plus the plate,
 * border, emblem and furniture cadence that belongs on that kind of book.
 *
 * The preset lists are intentionally explicit. Tags are useful search words
 * in the Studio, but they are too broad to art-direct a finished object: both
 * velvet and marbled paper can be "fancy" while asking for very different
 * cover furniture. A preset can occur in only one grammar for a direction, so
 * inspection and deterministic replay never have a hidden second identity.
 */
type CoverCompositionMode = 'restrained' | 'balanced' | 'statement';

interface CompositionGrammar {
  id: string;
  presetIds: readonly BookPresetId[];
  /** Repetition is deliberate weighting, not an accidental duplicate. */
  modes: readonly CoverCompositionMode[];
  plates: readonly TitlePlateStyle[];
  frames: readonly number[];
  ornaments: readonly number[];
  edges?: readonly EdgeTreatment[];
  charms?: readonly Exclude<CharmKind, 'none'>[];
  bands?: readonly [number, number];
  ornamentChance: number;
  charmChance: number;
  headTailChance: number;
  cornerChance: number;
  insetChance: number;
  /** Number of simultaneous statement devices the composition may carry. */
  maxStatements: number;
  /** Preferred aggregate surface load, before direction-wide bounds apply. */
  targetLoad: readonly [number, number];
}

function compositionGrammar(value: CompositionGrammar): CompositionGrammar {
  return value;
}

const COMPOSITION_GRAMMARS: Readonly<
  Record<BookSurpriseDirectionId, readonly CompositionGrammar[]>
> = {
  formal: [
    compositionGrammar({
      id: 'formal-library',
      presetIds: ['lettered-cloth', 'college-buckram'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'morocco-label', 'presentation-shoulder', 'double-fillet'],
      frames: [0, 2, 5, 15, 24, 28],
      ornaments: [0, 8, 17, 61],
      edges: ['plain', 'top-gilt', 'stained-red'],
      ornamentChance: 0.36, charmChance: 0.05, headTailChance: 0.58,
      cornerChance: 0.04, insetChance: 0.12, maxStatements: 2, targetLoad: [1.8, 3.5],
    }),
    compositionGrammar({
      id: 'formal-gilt',
      presetIds: ['gilt-quarto', 'banded-cloth', 'full-morocco', 'tips-and-bands'],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['morocco-label', 'split-binding-band', 'presentation-shoulder', 'gilt-direct'],
      frames: [0, 2, 5, 15, 24, 28, 30],
      ornaments: [8, 12, 20, 26, 51, 61, 63],
      edges: ['top-gilt', 'all-edges-gilt', 'stained-red'],
      ornamentChance: 0.56, charmChance: 0.1, headTailChance: 0.8,
      cornerChance: 0.14, insetChance: 0.2, maxStatements: 2, targetLoad: [2.7, 4.6],
    }),
    compositionGrammar({
      id: 'formal-presentation',
      presetIds: [
        'panelled-cloth', 'panelled-calf', 'russia-folio',
        'launder-patterned-sides',
      ],
      modes: ['balanced', 'balanced', 'statement'],
      plates: ['morocco-label', 'presentation-shoulder', 'oxford-compartment'],
      frames: [15, 19, 24, 28, 30, 34],
      ornaments: [12, 20, 26, 51, 61, 62, 63, 64],
      edges: ['top-gilt', 'all-edges-gilt', 'red-under-gold'],
      ornamentChance: 0.62, charmChance: 0.1, headTailChance: 0.84,
      cornerChance: 0.16, insetChance: 0.22, maxStatements: 2, targetLoad: [3.2, 5],
    }),
  ],
  grand: [
    compositionGrammar({
      id: 'grand-presentation',
      presetIds: ['panelled-cloth', 'presentation-binding', 'gilt-quarto'],
      modes: ['balanced', 'statement', 'statement'],
      plates: ['split-binding-band', 'gilt-direct', 'presentation-shoulder', 'oxford-compartment'],
      frames: [19, 21, 26, 30, 34, 38, 42, 44],
      ornaments: [12, 20, 21, 26, 32, 51, 61, 63, 64],
      edges: ['all-edges-gilt', 'gauffered', 'red-under-gold'],
      charms: ['tassel', 'clasp'], bands: [0, 2],
      ornamentChance: 0.78, charmChance: 0.18,
      headTailChance: 0.84, cornerChance: 0.26, insetChance: 0.3,
      maxStatements: 2, targetLoad: [3.7, 5.7],
    }),
    compositionGrammar({
      id: 'grand-armorial',
      presetIds: [
        'full-morocco', 'panelled-calf', 'russia-folio', 'monogrammed-letters',
        'armorial-calf',
      ],
      modes: ['balanced', 'statement', 'statement'],
      plates: [
        'split-binding-band', 'morocco-label',
        'presentation-shoulder', 'calf-compartment', 'oxford-compartment',
      ],
      frames: [0, 2, 5, 16, 19, 21, 26, 30, 34, 38, 42, 44, 45, 47, 48],
      ornaments: [12, 20, 21, 26, 32, 51, 61, 63, 64],
      edges: ['all-edges-gilt', 'gauffered', 'antique-gilt', 'red-under-gold'],
      charms: ['tassel', 'clasp', 'wax-seal'], bands: [0, 2],
      ornamentChance: 0.82, charmChance: 0.18,
      headTailChance: 0.88, cornerChance: 0.2, insetChance: 0.22,
      maxStatements: 2, targetLoad: [4.1, 6.1],
    }),
    compositionGrammar({
      id: 'grand-textile',
      presetIds: ['damask-presentation', 'velvet-presentation'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['split-binding-band', 'morocco-label', 'presentation-shoulder', 'double-fillet'],
      frames: [0, 2, 5, 15, 19, 21, 26],
      ornaments: [12, 20, 21, 26, 32, 51, 61, 63],
      edges: ['all-edges-gilt', 'antique-gilt'],
      ornamentChance: 0.52, charmChance: 0, headTailChance: 0.68,
      cornerChance: 0, insetChance: 0.08, maxStatements: 2, targetLoad: [3.3, 5.2],
    }),
  ],
  antique: [
    compositionGrammar({
      id: 'antique-calf-library',
      presetIds: [
        'blind-calf', 'plain-calf', 'half-calf', 'russia-folio', 'quarter-calf',
      ],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['morocco-label', 'calf-compartment', 'vellum-ink-field', 'oxford-compartment'],
      frames: [0, 2, 5, 15, 24, 28, 29],
      ornaments: [8, 9, 13, 17, 20, 22, 26, 38, 50, 61],
      edges: ['rough-cut', 'uncut', 'antique-gilt', 'tea-stained', 'foxed'],
      ornamentChance: 0.52, charmChance: 0.14, headTailChance: 0.8,
      cornerChance: 0.12, insetChance: 0.18, maxStatements: 2, targetLoad: [2.5, 4.5],
    }),
    compositionGrammar({
      id: 'antique-vellum-archive',
      presetIds: ['gilt-vellum', 'stiff-vellum-quarto'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint'],
      frames: [0, 2, 5, 9, 13],
      ornaments: [8, 9, 13, 17, 22, 38, 50, 61],
      edges: ['rough-cut', 'deckle', 'uncut', 'tea-stained', 'foxed'],
      ornamentChance: 0.4, charmChance: 0.12, headTailChance: 0.34,
      cornerChance: 0, insetChance: 0.08, maxStatements: 2, targetLoad: [1.5, 3.4],
    }),
    compositionGrammar({
      id: 'antique-reading-room',
      presetIds: ['marbled-boards', 'launder-patterned-sides', 'quarter-cloth'],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['morocco-label', 'label', 'vellum-ink-field', 'double-fillet'],
      frames: [0, 2, 5, 15, 24, 28],
      ornaments: [8, 9, 13, 17, 20, 22, 26, 38, 50, 61],
      edges: ['rough-cut', 'deckle', 'uncut', 'antique-gilt', 'tea-stained'],
      ornamentChance: 0.48, charmChance: 0.14, headTailChance: 0.68,
      cornerChance: 0.08, insetChance: 0.14, maxStatements: 2, targetLoad: [2.1, 4],
    }),
  ],
  storybook: [
    compositionGrammar({
      id: 'storybook-patterned-tale',
      presetIds: ['patterned-boards', 'diaper-paper'],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'split-binding-band'],
      frames: [1, 3, 4, 6, 8, 12, 19],
      ornaments: [2, 5, 6, 9, 21, 33, 34, 36, 40, 41, 45, 49, 52, 53, 54, 58, 64, 65],
      edges: ['plain', 'speckled', 'stained-blue', 'yellow-edges', 'rose-edge'],
      ornamentChance: 0.64, charmChance: 0.2, headTailChance: 0.28,
      cornerChance: 0.02, insetChance: 0.12, maxStatements: 2, targetLoad: [2.2, 4.2],
    }),
    compositionGrammar({
      id: 'storybook-cloth-companion',
      presetIds: [
        'tweed-gilt', 'laurel-prize', 'half-cloth',
        'felt-common-room', 'cased-nature-diary', 'linen-quarto',
      ],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'inlay-strip'],
      frames: [1, 3, 4, 6, 8, 12, 19, 21],
      ornaments: [2, 5, 6, 9, 21, 33, 34, 36, 40, 41, 45, 49, 52, 53, 54, 58, 64, 65],
      edges: ['plain', 'speckled', 'stained-blue', 'yellow-edges', 'rose-edge'],
      ornamentChance: 0.7, charmChance: 0.22, headTailChance: 0.48,
      cornerChance: 0.05, insetChance: 0.17, maxStatements: 2, targetLoad: [2.4, 4.5],
    }),
    compositionGrammar({
      id: 'storybook-keepsake',
      presetIds: ['paste-paper-keepsake', 'rounded-roan-almanac'],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'presentation-shoulder', 'split-binding-band'],
      frames: [1, 3, 4, 6, 8, 12, 19],
      ornaments: [2, 5, 6, 9, 21, 33, 34, 36, 40, 41, 45, 49, 52, 53, 54, 58, 64, 65],
      edges: ['plain', 'speckled', 'yellow-edges', 'rose-edge'],
      ornamentChance: 0.7, charmChance: 0.22, headTailChance: 0.38,
      cornerChance: 0.02, insetChance: 0.12, maxStatements: 2, targetLoad: [2.2, 4.3],
    }),
  ],
  botanical: [
    compositionGrammar({
      id: 'botanical-field-journal',
      presetIds: ['linen-quarto', 'linen-herbarium', 'suede-field-book'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint'],
      frames: [1, 4, 6, 11, 16],
      ornaments: [1, 8, 10, 13, 14, 27, 28, 29, 31, 38, 40, 55, 56, 57, 58],
      edges: ['plain', 'speckled', 'sprinkled', 'sea-green-edge', 'tea-stained'],
      ornamentChance: 0.62, charmChance: 0.18, headTailChance: 0.38,
      cornerChance: 0.02, insetChance: 0.14, maxStatements: 2, targetLoad: [2, 4],
    }),
    compositionGrammar({
      id: 'botanical-herbarium',
      presetIds: [
        'marbled-boards', 'patterned-boards', 'half-cloth',
        'cased-nature-diary', 'paste-paper-keepsake', 'launder-patterned-sides',
      ],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'double-fillet', 'oxford-compartment'],
      frames: [1, 4, 6, 11, 16, 21, 25, 26],
      ornaments: [1, 8, 10, 13, 14, 27, 28, 29, 31, 38, 40, 55, 56, 57, 58],
      edges: ['plain', 'speckled', 'sprinkled', 'sea-green-edge', 'tea-stained'],
      ornamentChance: 0.72, charmChance: 0.22, headTailChance: 0.5,
      cornerChance: 0.04, insetChance: 0.14, maxStatements: 2, targetLoad: [2.4, 4.5],
    }),
    compositionGrammar({
      id: 'botanical-prize-binding',
      presetIds: ['laurel-prize'],
      modes: ['balanced', 'balanced', 'statement'],
      plates: ['double-fillet', 'oxford-compartment', 'presentation-shoulder'],
      frames: [4, 6, 11, 16, 21, 25, 26],
      ornaments: [1, 8, 10, 13, 14, 27, 28, 29, 31, 38, 40, 55, 56, 57, 58],
      edges: ['plain', 'top-gilt', 'sea-green-edge'],
      ornamentChance: 0.78, charmChance: 0.14, headTailChance: 0.7,
      cornerChance: 0.06, insetChance: 0.18, maxStatements: 2, targetLoad: [2.9, 4.8],
    }),
  ],
  cosy: [
    compositionGrammar({
      id: 'cosy-pocket-diary',
      presetIds: ['rounded-roan-almanac', 'linen-quarto'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint'],
      frames: [0, 1, 3, 4, 6, 11],
      ornaments: [9, 13, 19, 23, 27, 34, 35, 36, 37, 40, 49, 50, 52, 53, 54, 58, 65],
      edges: ['plain', 'speckled', 'yellow-edges', 'rose-edge', 'tea-stained'],
      ornamentChance: 0.5, charmChance: 0.2, headTailChance: 0.3,
      cornerChance: 0, insetChance: 0.1, maxStatements: 2, targetLoad: [1.6, 3.6],
    }),
    compositionGrammar({
      id: 'cosy-cloth-companion',
      presetIds: ['tweed-gilt', 'felt-common-room', 'half-cloth', 'plain-cloth'],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'twin-rules', 'inlay-strip'],
      frames: [0, 1, 3, 4, 6, 11, 12],
      ornaments: [9, 13, 19, 23, 27, 34, 35, 36, 37, 40, 49, 50, 52, 53, 54, 58, 65],
      edges: ['plain', 'speckled', 'yellow-edges', 'rose-edge', 'tea-stained'],
      ornamentChance: 0.62, charmChance: 0.24, headTailChance: 0.46,
      cornerChance: 0.02, insetChance: 0.16, maxStatements: 2, targetLoad: [2, 4.1],
    }),
    compositionGrammar({
      id: 'cosy-keepsake',
      presetIds: [
        'patterned-boards', 'paste-paper-keepsake',
        'launder-patterned-sides', 'cased-nature-diary',
      ],
      modes: ['restrained', 'balanced', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'twin-rules'],
      frames: [0, 1, 3, 4, 6, 11, 12],
      ornaments: [9, 13, 19, 23, 27, 34, 35, 36, 37, 40, 49, 50, 52, 53, 54, 58, 65],
      edges: ['plain', 'speckled', 'yellow-edges', 'rose-edge'],
      ornamentChance: 0.66, charmChance: 0.24, headTailChance: 0.38,
      cornerChance: 0.02, insetChance: 0.16, maxStatements: 2, targetLoad: [2.1, 4.2],
    }),
  ],
  rustic: [
    compositionGrammar({
      id: 'rustic-workshop-ledger',
      presetIds: [
        'duck-canvas', 'half-cloth', 'quarter-cloth', 'roan-schoolbook',
        'sailcloth-field-ledger', 'half-roan',
      ],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'morocco-label', 'calf-compartment', 'split-binding-band'],
      frames: [0, 1, 5, 7, 10, 13, 24],
      ornaments: [10, 13, 14, 15, 22, 28, 29, 35, 38, 39, 43, 46, 51, 56, 58],
      edges: ['rough-cut', 'deckle', 'uncut', 'tea-stained', 'spattered', 'well-thumbed'],
      ornamentChance: 0.42, charmChance: 0.12, headTailChance: 0.36,
      cornerChance: 0.12, insetChance: 0.1, maxStatements: 2, targetLoad: [1.4, 3.5],
    }),
    compositionGrammar({
      id: 'rustic-sewn-journal',
      presetIds: ['suede-field-book', 'linen-sewn-journal'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'morocco-label', 'calf-compartment', 'oxford-compartment'],
      frames: [0, 1, 5, 7, 10, 13],
      ornaments: [10, 13, 14, 15, 22, 28, 29, 35, 38, 39, 43, 46, 51, 56, 58],
      edges: ['rough-cut', 'deckle', 'uncut', 'tea-stained', 'well-thumbed'],
      ornamentChance: 0.4, charmChance: 0.1, headTailChance: 0.28,
      cornerChance: 0, insetChance: 0.06, maxStatements: 2, targetLoad: [1.4, 3.4],
    }),
    compositionGrammar({
      id: 'rustic-cased-field-book',
      presetIds: ['rounded-roan-almanac', 'cased-nature-diary'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'morocco-label', 'calf-compartment'],
      frames: [0, 1, 5, 7, 10, 13],
      ornaments: [10, 13, 14, 15, 22, 28, 29, 35, 38, 39, 43, 46, 51, 56, 58],
      edges: ['rough-cut', 'deckle', 'uncut', 'tea-stained', 'well-thumbed'],
      ornamentChance: 0.38, charmChance: 0.1, headTailChance: 0.28,
      cornerChance: 0, insetChance: 0.04, maxStatements: 2, targetLoad: [1.4, 3.3],
    }),
  ],
  quiet: [
    compositionGrammar({
      id: 'quiet-library-cloth',
      presetIds: [
        'lettered-cloth', 'blind-cloth', 'plain-cloth',
        'plain-buckram', 'reading-room-buckram',
      ],
      modes: ['restrained', 'restrained', 'restrained', 'balanced'],
      plates: ['label', 'printer-imprint', 'debossed', 'twin-rules'],
      frames: [0, 2, 4, 9, 10, 13, 28],
      ornaments: [0, 8, 9, 17, 22, 23, 24, 37, 48, 50, 60, 61],
      edges: ['plain', 'top-gilt', 'stained-blue', 'ink-edge'],
      ornamentChance: 0.24, charmChance: 0.025, headTailChance: 0.3,
      cornerChance: 0, insetChance: 0.08, maxStatements: 1, targetLoad: [0.9, 2.8],
    }),
    compositionGrammar({
      id: 'quiet-sober-leather',
      presetIds: ['plain-calf', 'roan-schoolbook', 'quarter-cloth'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint', 'debossed'],
      frames: [0, 2, 4, 9, 10, 13, 28],
      ornaments: [0, 8, 9, 17, 22, 23, 24, 37, 48, 50, 60, 61],
      edges: ['plain', 'top-gilt', 'stained-blue', 'ink-edge'],
      ornamentChance: 0.22, charmChance: 0.02, headTailChance: 0.3,
      cornerChance: 0, insetChance: 0.06, maxStatements: 1, targetLoad: [0.8, 2.7],
    }),
    compositionGrammar({
      id: 'quiet-vellum-note',
      presetIds: ['stiff-vellum-quarto', 'launder-patterned-sides'],
      modes: ['restrained', 'restrained', 'balanced'],
      plates: ['label', 'vellum-ink-field', 'printer-imprint'],
      frames: [0, 2, 4, 9],
      ornaments: [0, 8, 9, 17, 22, 23, 24, 37, 48, 50, 60, 61],
      edges: ['plain', 'stained-blue', 'ink-edge'],
      ornamentChance: 0.18, charmChance: 0, headTailChance: 0.2,
      cornerChance: 0, insetChance: 0.04, maxStatements: 1, targetLoad: [0.8, 2.5],
    }),
  ],
};

/**
 * Automatic frames are divided by visual role, never by append-only index.
 * Quiet rules support another focal idea; architectural frames are complete
 * cover programmes in their own right. Both sets are derived from the active
 * cover authority so a later retirement cannot survive in Surprise alone.
 */
const SURPRISE_QUIET_FRAME_IDS: ReadonlySet<number> = new Set(
  ACTIVE_COVER_FRAMES.flatMap((frame) => (
    frame.rules.length <= 2
    && frame.corner === 'none'
    && frame.side === 'none'
    && frame.turn !== 'ogee'
    && !frame.band
      ? [frame.index]
      : []
  )),
);
const SURPRISE_FOCAL_FRAME_IDS: ReadonlySet<number> = new Set(
  ACTIVE_COVER_FRAME_INDICES.filter((frame) => !SURPRISE_QUIET_FRAME_IDS.has(frame)),
);

/**
 * Automatic emblems must survive on the spine, not merely look good in the
 * large cover medallion. Native-scale refutation retired every tool that read
 * as a scratch, insect, charm or tiny piece of hardware at 21–37 px. Keep the
 * automatic subset to the sixteen broad integrated binder's tools that passed
 * the final cover-and-spine boards. This is deliberately the same authority
 * as the Studio: every surviving tool has now been refuted on both faces at
 * true shelf size, so Surprise no longer needs a second, smaller shadow
 * catalogue.
 */
const SHELF_LEGIBLE_EMBLEM_CANDIDATES: ReadonlySet<number> = new Set([
  0, 1, 2, 5, 12, 13, 14, 20,
  23, 26, 28, 29, 30, 31, 43, 56,
]);

export const BOOK_SURPRISE_EMBLEM_INDICES: readonly number[] =
  ACTIVE_ORNAMENT_INDICES.filter((index) => SHELF_LEGIBLE_EMBLEM_CANDIDATES.has(index));

const SURPRISE_SAFE_ORNAMENT_IDS: ReadonlySet<number> = new Set(
  BOOK_SURPRISE_EMBLEM_INDICES,
);

/**
 * These pools carry meaning rather than merely changing frequency. Ceremonial
 * crowns, suns and fleurs-de-lis belong naturally to Grand; measured lozenges,
 * laurels and palmettes give Formal an institutional hand; Botanical receives
 * only broad plant silhouettes. Every entry is filtered through the live spine
 * authority below, so a future retirement cannot leak through this preference.
 */
const DIRECTION_EMBLEM_CANDIDATES: Readonly<
  Record<BookSurpriseDirectionId, readonly number[]>
> = {
  formal: [0, 1, 12, 20, 23, 26, 28, 43],
  grand: [0, 2, 5, 12, 20, 23, 26, 30, 31, 43],
  antique: [0, 1, 12, 13, 14, 23, 26, 28, 29, 30, 43, 56],
  storybook: [2, 5, 12, 13, 14, 23, 30, 31, 43, 56],
  botanical: [1, 12, 13, 14, 23, 28, 29, 30, 31, 43, 56],
  cosy: [1, 2, 12, 13, 23, 31, 43, 56],
  rustic: [0, 1, 12, 13, 14, 23, 28, 29, 30, 43, 56],
  quiet: [0, 1, 12, 23, 28, 43],
};

/**
 * Direction-led architectural frames. These are the intricate but book-like
 * members of the active authority: nested rules, brackets, ogees, lozenges
 * and fleurons, never dots, studs, wallpaper fields or applied hardware.
 */
const DIRECTION_ARCHITECTURAL_FRAME_CANDIDATES: Readonly<
  Record<BookSurpriseDirectionId, readonly number[]>
> = {
  formal: [5, 17, 20, 24],
  grand: [6, 26, 36, 43, 48],
  antique: [5, 8, 17, 20, 24],
  storybook: [6, 8, 17, 26, 43],
  botanical: [6, 26, 43, 48],
  cosy: [5, 6, 17, 26, 36],
  rustic: [5, 8, 17, 20, 24, 36],
  quiet: [],
};

function activeDirectionEmblems(
  directionId: BookSurpriseDirectionId,
): readonly number[] {
  const preferred = DIRECTION_EMBLEM_CANDIDATES[directionId].filter(
    (index) => SURPRISE_SAFE_ORNAMENT_IDS.has(index),
  );
  return preferred.length > 0 ? preferred : BOOK_SURPRISE_EMBLEM_INDICES;
}

function activeDirectionArchitecturalFrames(
  directionId: BookSurpriseDirectionId,
): readonly number[] {
  const preferred = DIRECTION_ARCHITECTURAL_FRAME_CANDIDATES[directionId].filter(
    (index) => SURPRISE_FOCAL_FRAME_IDS.has(index),
  );
  if (preferred.length > 0 || directionId === 'quiet') return preferred;
  // Totality under a future frame retirement: retain the focal role using the
  // remaining active authority rather than quietly regressing to plain rules.
  return ACTIVE_COVER_FRAME_INDICES.filter((index) => SURPRISE_FOCAL_FRAME_IDS.has(index));
}

function uniqueValues<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

/**
 * Rebuild one direction on the reset vocabularies.
 *
 * The large table above is archival mood input: its old preset assignments,
 * furniture budgets and independent charm/hardware chances are not executable
 * composition rules anymore. We retain only its direction-specific colour-era
 * vocabulary, pass every value through the current authoritative normalizers,
 * and attach it to the final `BOOK_SURPRISE_DIRECTIONS` roster as ONE binding
 * programme. This makes a later retirement propagate into Surprise without a
 * second numeric keep-list, while preserving recognisable Formal/Antique/etc.
 */
function activeCompositionGrammar(
  direction: (typeof BOOK_SURPRISE_DIRECTIONS)[number],
): CompositionGrammar {
  const moodRows = COMPOSITION_GRAMMARS[direction.id];
  const profile = DIRECTIONS[direction.id];
  const plates = uniqueValues(
    [...moodRows.flatMap((row) => row.plates), ...profile.plates]
      .map(normalizeTitlePlateStyle),
  );
  const frames = uniqueValues([
    ...ACTIVE_COVER_FRAME_INDICES.filter((frame) => SURPRISE_QUIET_FRAME_IDS.has(frame)),
    ...activeDirectionArchitecturalFrames(direction.id),
  ]);
  const ornaments = uniqueValues(activeDirectionEmblems(direction.id));
  const edges = uniqueValues(
    [...moodRows.flatMap((row) => row.edges ?? []), ...profile.edges]
      .map(normalizeEdgeTreatment),
  );
  const modes: readonly CoverCompositionMode[] = direction.id === 'grand'
    ? ['balanced', 'statement']
    : direction.id === 'quiet'
      ? ['restrained', 'restrained', 'balanced']
      : direction.id === 'cosy' || direction.id === 'rustic'
        ? ['restrained', 'balanced']
        : ['restrained', 'balanced', 'balanced'];

  return compositionGrammar({
    id: `${direction.id}-binding-programme`,
    presetIds: direction.presetIds,
    modes,
    plates,
    frames,
    ornaments,
    edges,
    bands: [0, 1],
    ornamentChance: direction.id === 'quiet' ? 0.28 : 0.62,
    charmChance: 0,
    headTailChance: profile.headTailChance,
    cornerChance: 0,
    insetChance: 0,
    maxStatements: 1,
    targetLoad: direction.id === 'grand' ? [1.8, 3.8] : [1.1, 3.2],
  });
}

/** The only composition grammars the production generator executes. */
const ACTIVE_COMPOSITION_GRAMMARS: Readonly<
  Record<BookSurpriseDirectionId, readonly CompositionGrammar[]>
> = Object.fromEntries(
  BOOK_SURPRISE_DIRECTIONS.map((direction) => [
    direction.id,
    [activeCompositionGrammar(direction)],
  ]),
) as unknown as Readonly<Record<BookSurpriseDirectionId, readonly CompositionGrammar[]>>;

export interface BookSurpriseArchetypeDescriptor {
  id: string;
  direction: BookSurpriseDirectionId;
  presetIds: readonly BookPresetId[];
}

/** Read-only authored coverage map for specimen boards and release gates. */
export const BOOK_SURPRISE_ARCHETYPES: readonly BookSurpriseArchetypeDescriptor[] =
  Object.freeze(
    BOOK_SURPRISE_DIRECTIONS.flatMap((direction) =>
      ACTIVE_COMPOSITION_GRAMMARS[direction.id].map((grammar) => Object.freeze({
        id: grammar.id,
        direction: direction.id,
        presetIds: grammar.presetIds,
      })),
    ),
  );

function grammarForPreset(
  direction: BookSurpriseDirectionId,
  preset: BookPreset,
): CompositionGrammar | null {
  const grammars = ACTIVE_COMPOSITION_GRAMMARS[direction];
  return grammars.find((grammar) => grammar.presetIds.includes(preset.id))
    ?? grammars[0]
    ?? null;
}

/* ========================================================================== *
 *                             deterministic tools                            *
 * ========================================================================== */

function pick<T>(values: readonly T[], rnd: RandomFn): T {
  return values[Math.min(values.length - 1, Math.floor(rnd() * values.length))] as T;
}

function between(range: readonly [number, number], rnd: RandomFn): number {
  return range[0] + (range[1] - range[0]) * rnd();
}

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mixSeed(seed: number, salt: number, index = 0): number {
  let x = (seed ^ salt ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function chosenDirection(
  requested: BookSurpriseDirectionId | null,
  seed: number,
): BookSurpriseDirectionId {
  if (requested !== null) return requested;
  return pick(
    BOOK_SURPRISE_DIRECTIONS.map((item) => item.id),
    mulberry32(mixSeed(seed, 0x7a11c0de)),
  );
}

/** Backward-compatible recipe-test name for the shared contrast metric. */
export const bookColourContrast = colourContrast;

function readableRole(candidate: string, bases: readonly string[]): string {
  const candidates = [candidate, '#f2d991', '#432934'] as const;
  const score = (colour: string): number =>
    Math.min(...bases.map((base) => bookColourContrast(colour, base)));
  if (score(candidate) >= 2.35) return candidate;
  return candidates.reduce((best, colour) => (score(colour) > score(best) ? colour : best));
}

function guardedPalette(
  source: BookSurprisePalette,
  preset: BookPreset,
  seed: number,
): BookSurprisePalette {
  const spine = resolveBookDesign({
    seed,
    preset: preset.id,
    cloth: source.spineBaseHex,
    baseColourPinned: true,
    accent: source.spineAccentHex,
  });
  const [spineFace] = bookBodyColours(spine);
  const [coverFace] = coverBodyColours(preset.material, source.coverBaseHex, true);
  const bases = [spineFace, coverFace] as const;
  return {
    ...source,
    toolingHex: readableRole(source.toolingHex, bases),
    emblemHex: readableRole(source.emblemHex, bases),
    hardwareHex: readableRole(source.hardwareHex, [coverFace]),
  };
}

interface NormalizedRequest {
  direction: BookSurpriseDirectionId | null;
  seed: number;
  current?: BookSurpriseCurrent;
  locks: BookSurpriseLockSet;
  lockSet: ReadonlySet<BookSurpriseLockId>;
  curation?: BookSurpriseCuration;
  guard?: BookSurprisePresetGuard;
  avoidBinding?: BookPresetId | null;
  legacy: boolean;
}

function normalizeRequest(
  first: BookSurpriseRequest | BookSurpriseDirectionId | null,
  seed?: number,
  guard?: BookSurprisePresetGuard,
): NormalizedRequest {
  if (first !== null && typeof first === 'object') {
    const locks = normalizeBookSurpriseLocks(first.locks);
    return {
      direction: first.direction,
      seed: first.seed >>> 0,
      ...(first.current === undefined ? {} : { current: first.current }),
      locks,
      lockSet: new Set(locks),
      ...(first.curation === undefined ? {} : { curation: first.curation }),
      ...(first.guard === undefined ? {} : { guard: first.guard }),
      ...(first.avoidBinding === undefined ? {} : { avoidBinding: first.avoidBinding }),
      legacy: false,
    };
  }
  return {
    direction: first,
    seed: (seed ?? 0) >>> 0,
    locks: Object.freeze([]),
    lockSet: new Set(),
    ...(guard === undefined ? {} : { guard }),
    legacy: true,
  };
}

/* ========================================================================== *
 *                               candidate pool                               *
 * ========================================================================== */

interface PresetPool {
  presets: readonly BookPreset[];
  curationFallback: boolean;
}

function presetPool(request: NormalizedRequest, directionId: BookSurpriseDirectionId): PresetPool {
  if (request.current !== undefined && request.lockSet.has('binding')) {
    return {
      presets: [activePresetForSurpriseBinding(request.current.binding)],
      curationFallback: false,
    };
  }

  const descriptor = BOOK_SURPRISE_DIRECTIONS.find((row) => row.id === directionId);
  const local = (descriptor?.presetIds ?? [])
    .map((id) => bookPreset(id))
    .filter((preset) => allowedWithLockedExceptions(preset, request))
    .filter((preset) => respectsComponentLocks(preset, request));
  if (local.length > 0) return { presets: local, curationFallback: false };

  const wider = ROLLABLE_PRESETS
    .filter((preset) => allowedWithLockedExceptions(preset, request))
    .filter((preset) => respectsComponentLocks(preset, request));
  if (wider.length > 0) return { presets: wider, curationFallback: true };

  // Partial component locks can describe a combination represented only by
  // the current named/composed binding. Preserving it is better than breaking
  // a lock. If there is no current appearance at all, use the formal recovery
  // book — the same total fallback as designPrefs.
  const fallback = request.current === undefined
    ? bookPreset(FORMAL_BOOK_PRESET_ID)
    : activePresetForSurpriseBinding(request.current.binding);
  return { presets: [fallback], curationFallback: true };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values];
  const rnd = mulberry32(seed >>> 0);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

interface CandidateAssignment {
  preset: BookPreset;
  /** Stable within a binding even when curation removes an unrelated preset. */
  treatment: number;
}

function candidateAssignments(
  pool: readonly BookPreset[],
  seed: number,
): readonly CandidateAssignment[] {
  /*
   * A binding is only half the candidate. Palette, title treatment, cover
   * hierarchy and furniture are stochastic too, and one draw can make an
   * otherwise excellent binding look absurd. The former search evaluated one
   * treatment for each normal twelve-preset direction; there was therefore no
   * search at all inside a binding. Give every normal binding six independent
   * authored treatments, tapering only when curation widens the pool. Ninety-
   * six candidates remains comfortably below the module's 192-object budget.
   */
  const treatmentsPerBinding = pool.length <= 16 ? 6 : pool.length <= 32 ? 3 : 2;
  const maximumPresets = Math.max(1, Math.floor(96 / treatmentsPerBinding));
  const considered = pool.length <= maximumPresets
    ? [...pool]
    : shuffled(pool, mixSeed(seed, 0x48ce_5a31)).slice(0, maximumPresets);
  const out: CandidateAssignment[] = [];
  for (let treatment = 0; treatment < treatmentsPerBinding; treatment += 1) {
    const order = shuffled(considered, mixSeed(seed, 0x51b1d17e, treatment));
    for (const preset of order) out.push({ preset, treatment });
  }
  return out;
}

/* ========================================================================== *
 *                        composition and lock repair                         *
 * ========================================================================== */

/**
 * Every shape accepted by the reset vocabulary is a straight cased back.
 * Retired flexible/mechanical silhouettes remain renderer diagnostics only;
 * Surprise never names them or carries a parallel compatibility roster.
 */
const FLEXIBLE_SHAPES: ReadonlySet<SpineShape> = new Set();

const BAND_DECORATIONS: ReadonlySet<Decoration> = new Set([
  'gilt-bands',
  'double-bands',
  'triple-bands',
  'beaded-band',
  'dentil-band',
  'zigzag-band',
  'chequer-band',
  'rope-band',
  'chain-band',
  'marbled-band',
]);

const BUSY_DECORATIONS: ReadonlySet<Decoration> = new Set([
  'gilt-panel',
  'double-frame',
  'blind-stamped-frame',
  'blind-panel',
  'arch-panel',
  'gothic-panel',
  'cartouche',
  'lattice-panel',
  'fleur-seme',
  'vine-trail',
  'laurel-spray',
]);

const PALE_OR_PAPER_MATERIALS: ReadonlySet<MaterialLook> = new Set([
  'vellum',
  'parchment',
  'alum-tawed',
  'marbled-paper',
  'spanish-marble',
  'stone-marble',
  'shell-marble',
  'paste-paper',
  'patterned-paper',
  'block-print',
  'washi-print',
  'japanese-paper',
  'dutch-gilt',
  'stripe-paper',
  'paper-wrapper',
  'newsprint',
]);

function bindingHasBands(preset: BookPreset): boolean {
  return preset.decorations.some((mark) => BAND_DECORATIONS.has(mark));
}

function curatedValues<T>(
  values: readonly T[],
  axis: BookSurpriseStyleCurationAxis,
  idOf: (value: T) => string,
  request: NormalizedRequest,
): readonly T[] {
  const hidden = request.curation?.style?.[axis];
  if (hidden === undefined || hidden.length === 0) return values;
  const hiddenSet = new Set(hidden);
  const remaining = values.filter((value) => !hiddenSet.has(idOf(value)));
  // Match shelfOfMine.rollPool: removing an entire vocabulary must not turn a
  // total Surprise operation into `undefined`. The full authored pool is the
  // last resort and the diagnostic reports a curation fallback at selection.
  return remaining.length > 0 ? remaining : values;
}

function curatedPick<T>(
  values: readonly T[],
  axis: BookSurpriseStyleCurationAxis,
  idOf: (value: T) => string,
  request: NormalizedRequest,
  rnd: RandomFn,
): T {
  return pick(curatedValues(values, axis, idOf, request), rnd);
}

/**
 * Prefer the grammar's narrow vocabulary, but if the reader hid every member
 * widen to the direction's authored vocabulary before admitting a hidden
 * value. This keeps curation authoritative without making a one-item grammar
 * capable of turning Surprise into a partial operation.
 */
function curatedGrammarValues<T>(
  preferred: readonly T[],
  wider: readonly T[],
  axis: BookSurpriseStyleCurationAxis,
  idOf: (value: T) => string,
  request: NormalizedRequest,
): readonly T[] {
  const hidden = request.curation?.style?.[axis];
  if (hidden === undefined || hidden.length === 0) return preferred;
  const hiddenSet = new Set(hidden);
  const primary = preferred.filter((value) => !hiddenSet.has(idOf(value)));
  if (primary.length > 0) return primary;
  const secondary = wider.filter((value) => !hiddenSet.has(idOf(value)));
  return secondary.length > 0 ? secondary : preferred;
}

/**
 * Directions have a recognisable cadence, but none collapses to one layout.
 * The three values are cumulative cut points for restrained/balanced/rich
 * board furniture. Keeping the decision authored here is what stops a quiet
 * diary and a grand folio from sampling the same cross-product with merely a
 * different colour.
 */
const COMPOSITION_WEIGHTS: Readonly<
  Record<BookSurpriseDirectionId, readonly [number, number]>
> = {
  formal: [0.3, 0.76],
  grand: [0.08, 0.4],
  antique: [0.3, 0.78],
  storybook: [0.2, 0.66],
  botanical: [0.19, 0.64],
  cosy: [0.38, 0.86],
  rustic: [0.41, 0.84],
  quiet: [0.7, 0.96],
};

function compositionMode(direction: BookSurpriseDirectionId, rnd: RandomFn): CoverCompositionMode {
  const [restrained, balanced] = COMPOSITION_WEIGHTS[direction];
  const roll = rnd();
  return roll < restrained ? 'restrained' : roll < balanced ? 'balanced' : 'statement';
}

function plateMaterialEligible(plate: TitlePlateStyle, preset?: BookPreset): boolean {
  const materialGroup = preset === undefined ? null : MATERIALS[preset.material].group;
    // Manual Studio choices stay reader-owned, but Surprise treats physical
    // labels as physical materials. A calf/morocco piece belongs on leather
    // or a split binding; dyed cross-bands belong on cloth/leather, while a
    // vellum ticket is welcome on the paper/vellum archive families.
    if (materialGroup === null) return true;
    if (
      plate === 'morocco-label' ||
      plate === 'presentation-shoulder' ||
      plate === 'calf-compartment'
    ) return materialGroup === 'leather' || materialGroup === 'split';
    if (plate === 'split-binding-band') {
      return materialGroup === 'leather' || materialGroup === 'cloth' || materialGroup === 'split';
    }
    if (plate === 'vellum-ink-field') {
      return materialGroup === 'vellum' || materialGroup === 'paper' || materialGroup === 'split';
    }
    return true;
}

function platePoolForComposition(
  values: readonly TitlePlateStyle[],
  mode: CoverCompositionMode,
  preset?: BookPreset,
): readonly TitlePlateStyle[] {
  const materialEligible = values.filter((plate) => plateMaterialEligible(plate, preset));
  const candidates = materialEligible.length > 0 ? materialEligible : values;
  const selected = candidates.filter((plate) => {
    const family = coverCompositionLayout(plate, 0, 0).family;
    if (mode === 'restrained') return family === 'direct' || family === 'ticket' || family === 'band';
    if (mode === 'statement') return family === 'heraldic' || family === 'round' || family === 'panel' || family === 'band';
    return family !== 'direct';
  });
  return selected.length > 0 ? selected : candidates;
}

function framePoolForComposition(
  values: readonly number[],
  mode: CoverCompositionMode,
): readonly number[] {
  if (values.length < 3) return values;
  const ordered = [...values].sort((a, b) => a - b);
  const lowEnd = Math.max(1, Math.ceil(ordered.length * 0.48));
  const highStart = Math.min(ordered.length - 1, Math.floor(ordered.length * 0.45));
  const selected = mode === 'restrained'
    ? ordered.slice(0, lowEnd)
    : mode === 'statement'
      ? ordered.slice(highStart)
      : ordered.slice(Math.floor(ordered.length * 0.18), Math.ceil(ordered.length * 0.82));
  return selected.length > 0 ? selected : values;
}

interface GeneratedTreatment {
  style: BookStyleOverrides;
  grammar: CompositionGrammar | null;
  /** The one authored idea allowed to lead this treatment. */
  programme: FocalProgramme;
}

function generatedStyle(
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  seed: number,
  request: NormalizedRequest,
): GeneratedTreatment {
  const p = DIRECTIONS[directionId];
  const rnd = mulberry32(seed >>> 0);
  const grammar = grammarForPreset(directionId, preset);
  const composition = grammar === null
    ? compositionMode(directionId, rnd)
    : pick(grammar.modes, rnd);
  const colours = guardedPalette(pick(BOOK_SURPRISE_PALETTES[directionId], rnd), preset, seed);
  const format = pick(curatedGrammarValues(
    PRESET_FORMATS[preset.id] ?? p.formats,
    p.formats,
    'format',
    String,
    request,
  ), rnd);
  const band = SPINE_FORMATS[format];
  const height = clamp(
    heightForFormat(format) + Math.round((rnd() * 2 - 1) * 7),
    band.min,
    band.max,
  );
  // Preserve the seeded draw stream used by existing Surprise recipes. These
  // two compatibility slots no longer produce fields or affect rendering.
  rnd();
  rnd();
  const authoredOrnaments = grammar?.ornaments ?? p.ornaments;
  const ornamentPool = curatedGrammarValues(
    [-1, ...authoredOrnaments],
    [-1, ...p.ornaments],
    'ornament',
    String,
    request,
  );
  const nonEmptyOrnaments = ornamentPool.filter((value) => value >= 0);
  const ornamentChance = (grammar?.ornamentChance ?? p.ornamentChance) * (
    composition === 'restrained' ? 0.62 : composition === 'statement' ? 1.08 : 1
  );
  const ornament =
    rnd() < ornamentChance && nonEmptyOrnaments.length > 0
      ? pick(nonEmptyOrnaments, rnd)
      : ornamentPool.includes(-1)
        ? -1
        : pick(ornamentPool, rnd);
  const gilt = preset.gilt;
  const pigment = curatedPick(
    Array.from({ length: PIGMENT_COUNT }, (_, index) => index),
    'spine-cloth',
    String,
    request,
    rnd,
  );
  const curatedPlates = curatedGrammarValues(
    grammar?.plates ?? p.plates,
    p.plates,
    'title-plate',
    String,
    request,
  );
  const titlePlate = pick(platePoolForComposition(curatedPlates, composition, preset), rnd);
  const curatedFrames = curatedGrammarValues(
    grammar?.frames ?? p.frames,
    p.frames,
    'cover-frame',
    String,
    request,
  );
  const coverFrame = pick(
    framePoolForComposition(curatedFrames, composition),
    rnd,
  );

  const generated: BookStyleOverrides = {
    // Explicit role colours own the book after Surprise. The legacy pigment
    // stays in a stable neutral slot rather than applying a hidden second hue.
    pigment,
    clothHex: null,
    ...colours,
    hardwareHex: null,
    hueJitter: 0,
    raisedBands: Math.round(between(grammar?.bands ?? p.bands, rnd)),
    bandGilt: gilt,
    headTail: rnd() < (grammar?.headTailChance ?? p.headTailChance),
    headTailStyle: Math.floor(rnd() * 3),
    ornament,
    titlePlate,
    titleFont: curatedPick(p.fonts, 'lettering', String, request, rnd),
    wear: between(p.wear, rnd),
    edge: pick(curatedGrammarValues(
      grammar?.edges ?? p.edges,
      p.edges,
      'edge',
      String,
      request,
    ), rnd),
    format,
    height,
    thickness: clamp(
      Math.round(between(p.thickness, rnd)),
      SPINE_THICKNESS_RANGE.min,
      SPINE_THICKNESS_RANGE.max,
    ),
    overlap: false,
    gilt,
    charm: 'none',
    charmColor: colours.coverAccentHex,
    coverFrame,
    // These renderer compatibility fields are derived constants, not hidden
    // Surprise decisions. `ornament` is the one unified emblem control.
    coverMedallion: ornament,
    cornerProtectors: false,
    insetPlate: false,
  };
  const focused = focusGeneratedTreatment(
    generated,
    preset,
    directionId,
    request,
    grammar,
    composition,
    seed,
  );
  return { grammar, style: focused.style, programme: focused.programme };
}

function applyStyleLocks(
  generated: BookStyleOverrides,
  request: NormalizedRequest,
): BookStyleOverrides {
  if (request.current === undefined) return generated;
  const out: BookStyleOverrides = { ...generated };
  for (const id of request.locks) {
    for (const field of BOOK_SURPRISE_LOCK_DEFINITIONS[id].fields) {
      // BookStyle is fully resolved, so every field is a concrete value. This
      // assignment is intentionally not normalized or rounded: locked means
      // byte-for-byte preserved, including a reader's own colour string. The
      // two binding-owned fields first resolve the value the reader can SEE;
      // their latent seed fields are not the thing the lock is closing around.
      (out as Record<keyof BookStyle, BookStyle[keyof BookStyle]>)[field] =
        effectiveCurrentStyleField(request.current, field);
    }

    /*
     * The shared pigment is the fallback for every unpinned colour role. Keep
     * that inheritance relationship while its lock is closed: generated role
     * hexes otherwise outrank the unchanged pigment and make the lock look
     * broken. An individually pinned role is handled by its own lock above;
     * an already-explicit but unlocked role remains free to change.
     */
    if (id === 'colour.palette') {
      for (const [field, roleLock] of [
        ['spineBaseHex', 'colour.spine-base'],
        ['spineAccentHex', 'colour.spine-accent'],
        ['coverBaseHex', 'colour.cover-base'],
        ['coverAccentHex', 'colour.cover-accent'],
        ['toolingHex', 'colour.tooling'],
        ['emblemHex', 'colour.emblem'],
      ] as const) {
        if (
          request.current.style[field] === null &&
          !request.lockSet.has(roleLock)
        ) out[field] = null;
      }
    }
  }
  const bodyColourHeld = hasOneOf(request.lockSet, BODY_COLOUR_LOCKS);
  const spineColourHeld = hasOneOf(request.lockSet, SPINE_BODY_COLOUR_LOCKS);

  /*
   * These are transformation dependencies, not surprise decisions smuggled
   * into the lock count. A spine colour passes through wear, so changing wear
   * while promising the painted colour is invariant would be a broken promise.
   * An explicitly pinned coarse material likewise owns the transform even when
   * its own lock is open; retain it while any material-dependent colour is
   * closed. An inherited material is constrained at preset selection instead.
   */
  if (spineColourHeld) out.wear = request.current.style.wear;
  if (bodyColourHeld && currentFieldPinned(request.current, 'material')) {
    out.material = request.current.style.material;
  }

  /* Some authored coverings use the secondary cloth AS their body tone. */
  if (
    request.lockSet.has('colour.spine-base')
    && MATERIALS[effectiveCurrentMaterialLook(request.current)].body === 'accent'
  ) {
    out.spineAccentHex = request.current.colourSources?.spineAccentHex
      ?? request.current.visibleColours?.spineAccentHex
      ?? request.current.style.spineAccentHex;
  }
  // Shelf collision policy is user intent, never decoration.
  out.overlap = request.current.style.overlap;
  return out;
}


const PATTERN_DOMINANT_MATERIALS: ReadonlySet<MaterialLook> = new Set([
  'silk-moire', 'brocade', 'damask', 'sprig-paper-sides',
  'marbled-paper', 'spanish-marble',
  'stone-marble', 'shell-marble', 'paste-paper', 'patterned-paper',
  'block-print', 'washi-print', 'japanese-paper', 'dutch-gilt', 'stripe-paper',
]);

/**
 * Grains made from many separate marks. At book scale these are the materials
 * most liable to read as wallpaper, spots or confetti instead of a binding.
 * They are not removed from the Studio: Surprise simply treats the field as
 * the book's one decorative programme and spends no second budget over it.
 */
const REPEATED_MARK_GRAINS: ReadonlySet<string> = new Set([
  'ribs', 'weave', 'twill', 'coarse', 'fleck', 'brushed', 'figured', 'damask',
  'sprinkle', 'scales', 'plates', 'pinDot', 'shellSpots', 'lozenges', 'sprigs',
  'floret', 'fibres', 'laidLines', 'giltDots', 'chequer', 'newsRules',
]);

/** Larger continuous gestures still occupy a surface, but do not tile it. */
const FIGURED_FIELD_GRAINS: ReadonlySet<string> = new Set([
  'watered', 'flame', 'mottle', 'combedVeins', 'spanishWave', 'stoneVein',
  'pasteComb', 'stripes',
]);

/** All-over spot/tile fields remain manual Studio materials, never auto-dice. */
const AUTOMATIC_SURPRISE_WALLPAPER_GRAINS: ReadonlySet<string> = new Set([
  'fleck', 'figured', 'damask', 'sprinkle', 'pinDot', 'shellSpots',
  'lozenges', 'sprigs', 'floret', 'giltDots', 'chequer',
]);

/**
 * Complexity contributed by the covering alone, before any frame, stamp or
 * furniture is added. Exported for deterministic QA and specimen labelling.
 */
export function bookSurpriseMaterialSurfaceComplexity(preset: BookPreset): number {
  const material = MATERIALS[preset.material];
  if (material.grain === 'none') return 0;
  if (REPEATED_MARK_GRAINS.has(material.grain)) {
    return clamp(0.66 + material.grainCount * 0.052, 0.66, 1.55);
  }
  if (FIGURED_FIELD_GRAINS.has(material.grain)) {
    return clamp(0.42 + material.grainCount * 0.035, 0.42, 0.82);
  }
  // Pile, nap, joints, creases and scuffs read as material evidence rather
  // than a repeating motif, but they still consume a little visual attention.
  return clamp(0.2 + material.grainCount * 0.025, 0.2, 0.52);
}

/**
 * The manual picker offers every curated material. The automatic button has a
 * narrower job: hand back a book, not a wallpaper swatch. Locks/curation can
 * still force one of these bindings, at which point the focal repair makes it
 * the sole surface programme instead of silently breaking the request.
 */
export function bookPresetAllowedForAutomaticSurprise(preset: BookPreset): boolean {
  const material = MATERIALS[preset.material];
  return !PATTERN_DOMINANT_MATERIALS.has(preset.material)
    && !AUTOMATIC_SURPRISE_WALLPAPER_GRAINS.has(material.grain);
}

const PAPER_LIKE_MATERIALS: ReadonlySet<MaterialLook> = new Set([
  ...PALE_OR_PAPER_MATERIALS,
  'quarter-bound', 'half-cloth-paper',
]);

/** The authoritative authored-programme verdict from `bookDesign.ts`. */
function bindingOwnsFocalProgramme(preset: BookPreset): boolean {
  return bookPresetHasAuthoredFocal(preset.id);
}

/**
 * Some retained/manual coverings are already the whole visual idea. Surprise
 * must not lay a frame or badge over a figured field merely to satisfy the
 * non-Quiet focal contract. Active automatic bindings are smooth; this branch
 * is the lock/curation-safe escape hatch for an explicitly focal construction.
 */
function bindingSuppliesFocalProgramme(preset: BookPreset): boolean {
  return bindingOwnsFocalProgramme(preset)
    || bookSurpriseMaterialSurfaceComplexity(preset) >= 0.42
    || PATTERN_DOMINANT_MATERIALS.has(preset.material);
}

const FORMAT_THICKNESS_CEILINGS: Readonly<Record<SpineFormat, number>> = {
  folio: 56,
  quarto: 50,
  octavo: 44,
  duodecimo: 38,
  pocket: 28,
};

/** Minimum generated spine-to-height ratio by art direction. */
export const BOOK_SURPRISE_SPINE_RATIO_FLOORS: Readonly<Record<BookSurpriseDirectionId, number>> = {
  formal: 0.105,
  grand: 0.12,
  antique: 0.105,
  storybook: 0.105,
  botanical: 0.105,
  cosy: 0.105,
  rustic: 0.11,
  quiet: 0.095,
};

/** Shelf-scale legibility floor for the sturdy bindings Surprise is allowed to use. */
export const BOOK_SURPRISE_SPINE_WIDTH_FLOORS: Readonly<Record<BookSurpriseDirectionId, number>> = {
  formal: 24,
  grand: 30,
  antique: 24,
  storybook: 22,
  botanical: 23,
  cosy: 22,
  rustic: 24,
  quiet: 22,
};

/** Binding names that make a bibliographic size promise to the reader. */
const PRESET_FORMATS: Readonly<Partial<Record<BookPresetId, readonly SpineFormat[]>>> = {
  'gilt-quarto': ['quarto'],
  'russia-folio': ['folio'],
  'hollow-octavo': ['octavo'],
  'sprinkled-octavo': ['octavo'],
  'linen-quarto': ['quarto'],
  'tweed-octavo': ['octavo'],
  'stiff-vellum-quarto': ['quarto'],
};

function titlePlateStatement(plate: TitlePlateStyle): number {
  const family = coverCompositionLayout(plate, 0, 0, false).family;
  if (family === 'heraldic') return 1.2;
  if (family === 'round' || family === 'panel') return 1;
  if (family === 'band' || family === 'classic') return 0.62;
  if (family === 'ticket') return 0.42;
  return 0.16;
}

function frameStatement(frame: number): number {
  if (SURPRISE_QUIET_FRAME_IDS.has(frame)) return frame === 0 ? 0.22 : 0.42;
  if (frame >= 44) return 1.55;
  if (frame >= 30) return 1.15;
  if (frame >= 15 || SURPRISE_FOCAL_FRAME_IDS.has(frame)) return 0.72;
  // Manual novelty/tool fields consume a programme even when their stable
  // persistence index happens to be small.
  return 0.72;
}

/**
 * One complete visual idea, not one knob. A matched emblem is allowed to
 * repeat the SAME tool on spine and cover; it is still one programme. What we
 * avoid is a patterned field plus an unrelated frame plus another stamp.
 */
type FocalProgramme =
  | 'binding-surface'
  | 'title-led'
  | 'matched-emblem'
  | 'frame-led';

interface FocusedTreatment {
  style: BookStyleOverrides;
  programme: FocalProgramme;
}

function styleChoiceAvailable(
  axis: BookSurpriseStyleCurationAxis,
  value: string | number,
  request: NormalizedRequest,
): boolean {
  return request.curation?.style?.[axis]?.includes(String(value)) !== true;
}

function focalValues<T>(
  preferred: readonly T[],
  wider: readonly T[],
  axis: BookSurpriseStyleCurationAxis,
  request: NormalizedRequest,
  predicate: (value: T) => boolean,
): readonly T[] {
  const available = (values: readonly T[]): readonly T[] => values.filter(
    (value) => styleChoiceAvailable(axis, String(value), request) && predicate(value),
  );
  const primary = available(preferred);
  if (primary.length > 0) return primary;
  const secondary = available(wider);
  if (secondary.length > 0) return secondary;
  // Total fallback when a reader removes the complete axis. This matches the
  // rest of Surprise's curation semantics and is reported by its diagnostics.
  const authored = preferred.filter(predicate);
  return authored.length > 0 ? authored : wider.filter(predicate);
}

function quietPlateForProgramme(
  grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  request: NormalizedRequest,
  salt: string,
): TitlePlateStyle {
  const preferred = grammar?.plates ?? DIRECTIONS[directionId].plates;
  const wider = DIRECTIONS[directionId].plates;
  const quiet = focalValues(
    preferred,
    wider,
    'title-plate',
    request,
    (plate) => titlePlateStatement(plate) <= 0.62 && plateMaterialEligible(plate, preset),
  );
  const authored = quiet.length > 0 ? quiet : curatedGrammarValues(
    preferred,
    DIRECTIONS[directionId].plates,
    'title-plate',
    String,
    request,
  );
  const eligible = authored.filter((plate) => plateMaterialEligible(plate, preset));
  const values = eligible.length > 0
    ? eligible
    : ACTIVE_TITLE_PLATES.filter((plate) =>
        plateMaterialEligible(plate, preset) && titlePlateStatement(plate) <= 0.62);
  return deterministicMember(values, `${preset.id}:${salt}:plate`)
    ?? 'label';
}

function quietFrameForProgramme(
  grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  request: NormalizedRequest,
  salt: string,
): number {
  const quiet = focalValues(
    grammar?.frames ?? DIRECTIONS[directionId].frames,
    DIRECTIONS[directionId].frames,
    'cover-frame',
    request,
    (frame) => frameStatement(frame) <= 0.42,
  );
  return deterministicMember(quiet, `${preset.id}:${salt}:frame`)
    ?? 0;
}

function architecturalFramePoolForProgramme(
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  request: NormalizedRequest,
): readonly number[] {
  const materialAllows = (frame: number): boolean =>
    SURPRISE_FOCAL_FRAME_IDS.has(frame)
    && (!PAPER_LIKE_MATERIALS.has(preset.material) || frame < 30);
  return focalValues(
    activeDirectionArchitecturalFrames(directionId),
    ACTIVE_COVER_FRAME_INDICES,
    'cover-frame',
    request,
    materialAllows,
  );
}

function architecturalFrameForProgramme(
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  request: NormalizedRequest,
  salt: string,
): number | undefined {
  return deterministicMember(
    architecturalFramePoolForProgramme(directionId, preset, request),
    `${preset.id}:${salt}:architectural-frame`,
  );
}

function motifPoolForProgramme(
  _grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  request: NormalizedRequest,
): readonly number[] {
  const preferred = activeDirectionEmblems(directionId);
  // The cover stamp IS the spine stamp. There is no second cover-emblem axis:
  // one direction-safe ornament choice drives both render fields.
  return focalValues(
    preferred,
    BOOK_SURPRISE_EMBLEM_INDICES,
    'ornament',
    request,
    (value) => value >= 0 && SURPRISE_SAFE_ORNAMENT_IDS.has(value),
  );
}

function chooseFocalProgramme(
  preset: BookPreset,
  directionId: BookSurpriseDirectionId,
  request: NormalizedRequest,
  grammar: CompositionGrammar | null,
  composition: CoverCompositionMode,
  seed: number,
): FocalProgramme {
  if (bindingSuppliesFocalProgramme(preset)) return 'binding-surface';

  // Removing "none" from an axis is an explicit request for that focal idea.
  // Honour it by choosing the compatible programme rather than generating a
  // nominally quiet book which later repairs into an unrelated decoration.
  const noneMotifAllowed = styleChoiceAvailable('ornament', -1, request);
  if (!noneMotifAllowed && motifPoolForProgramme(grammar, directionId, request).length > 0) {
    return 'matched-emblem';
  }

  // Non-Quiet books always receive one visible authored idea. The previous
  // title-plus-rule fallback was legal but visually unfinished in 381/512
  // sampled recipes; architectural frames now spend the same single budget
  // without reviving studs, charms, corners, wallpaper or applied hardware.
  const programmeWeights: Readonly<Record<BookSurpriseDirectionId, readonly FocalProgramme[]>> = {
    formal: ['frame-led', 'frame-led', 'matched-emblem'],
    grand: ['frame-led', 'frame-led', 'matched-emblem', 'matched-emblem', 'matched-emblem'],
    antique: ['frame-led', 'frame-led', 'frame-led', 'matched-emblem', 'matched-emblem'],
    storybook: ['frame-led', 'frame-led', 'matched-emblem', 'matched-emblem', 'matched-emblem'],
    botanical: ['frame-led', 'frame-led', 'matched-emblem', 'matched-emblem', 'matched-emblem'],
    cosy: ['frame-led', 'frame-led', 'frame-led', 'matched-emblem', 'matched-emblem'],
    rustic: ['frame-led', 'frame-led', 'frame-led', 'matched-emblem', 'matched-emblem'],
    quiet: ['title-led'],
  };
  const hasMotifs = motifPoolForProgramme(grammar, directionId, request).length > 0;
  const hasFrames = architecturalFramePoolForProgramme(
    directionId,
    preset,
    request,
  ).length > 0;
  const pool = programmeWeights[directionId].filter((programme) =>
    programme === 'title-led'
    || (programme === 'matched-emblem' && hasMotifs)
    || (programme === 'frame-led' && hasFrames));
  // Restrained modes still receive an authored focal idea, but favour the
  // quieter of the two rich programmes outside the three showcase directions.
  if (
    composition === 'restrained'
    && directionId !== 'grand'
    && directionId !== 'storybook'
    && directionId !== 'botanical'
    && hasFrames
  ) pool.push('frame-led');
  return deterministicMember(pool, `${directionId}:${preset.id}:${seed}:programme`) ?? 'title-led';
}

function clearGeneratedMotifs(
  out: BookStyleOverrides,
  request: NormalizedRequest,
): void {
  if (styleChoiceAvailable('ornament', -1, request)) {
    out.ornament = -1;
    out.coverMedallion = -1;
  }
}

function clearGeneratedCharm(out: BookStyleOverrides): void {
  out.charm = 'none';
}

/**
 * Spend the generated decoration budget on exactly one focal programme.
 * Reader locks are applied afterwards and therefore still win byte-for-byte;
 * reconciliation/scoring report any compromise created by those locks.
 */
function focusGeneratedTreatment(
  source: BookStyleOverrides,
  preset: BookPreset,
  directionId: BookSurpriseDirectionId,
  request: NormalizedRequest,
  grammar: CompositionGrammar | null,
  composition: CoverCompositionMode,
  seed: number,
): FocusedTreatment {
  const out: BookStyleOverrides = { ...source };
  let programme = chooseFocalProgramme(
    preset,
    directionId,
    request,
    grammar,
    composition,
    seed,
  );
  const salt = `${programme}:${seed}`;
  const quietenStructure = (maximumBands: number): void => {
    out.raisedBands = Math.min(maximumBands, Math.max(0, Math.round(out.raisedBands ?? 0)));
    out.bandGilt = (out.raisedBands ?? 0) > 0 && out.gilt === true;
    out.cornerProtectors = false;
    out.insetPlate = false;
  };
  const quietenTitle = (): void => {
    out.titlePlate = quietPlateForProgramme(
      grammar,
      directionId,
      preset,
      request,
      salt,
    );
  };
  const quietenTitleAndFrame = (): void => {
    quietenTitle();
    out.coverFrame = quietFrameForProgramme(
      grammar,
      directionId,
      preset,
      request,
      salt,
    );
  };

  if (programme === 'binding-surface') {
    quietenTitleAndFrame();
    clearGeneratedMotifs(out, request);
    clearGeneratedCharm(out);
    // A repeated/figured field already divides the spine. Added cords turn it
    // into striped wallpaper, so the authored binding gets the whole surface.
    quietenStructure(materialSurfaceLoad(preset) >= 0.55 ? 0 : 1);
  }

  if (programme === 'frame-led') {
    const frame = architecturalFrameForProgramme(
      directionId,
      preset,
      request,
      salt,
    );
    if (frame === undefined) {
      programme = motifPoolForProgramme(grammar, directionId, request).length > 0
        ? 'matched-emblem'
        : 'title-led';
    } else {
      quietenTitle();
      out.coverFrame = frame;
      clearGeneratedMotifs(out, request);
      clearGeneratedCharm(out);
      quietenStructure(1);
    }
  }

  if (programme === 'matched-emblem') {
    const motifs = motifPoolForProgramme(grammar, directionId, request);
    const motif = deterministicMember(motifs, `${preset.id}:${salt}:motif`);
    if (motif === undefined) {
      programme = 'title-led';
    } else {
      quietenTitleAndFrame();
      out.ornament = motif;
      out.coverMedallion = motif;
      clearGeneratedCharm(out);
      quietenStructure(1);
    }
  }

  if (programme === 'title-led') {
    const plates = curatedGrammarValues(
      grammar?.plates ?? DIRECTIONS[directionId].plates,
      DIRECTIONS[directionId].plates,
      'title-plate',
      String,
      request,
    );
    const titlePool = platePoolForComposition(
      plates,
      composition === 'restrained' ? 'balanced' : 'statement',
      preset,
    );
    out.titlePlate = deterministicMember(titlePool, `${preset.id}:${salt}:title`) ?? 'label';
    out.coverFrame = quietFrameForProgramme(
      grammar,
      directionId,
      preset,
      request,
      salt,
    );
    clearGeneratedMotifs(out, request);
    clearGeneratedCharm(out);
    quietenStructure(1);
  }

  return { style: out, programme };
}

/**
 * Hard compatibility boundary for the reset vocabulary.
 *
 * Locks preserve reader choices inside the active grammar; they do not revive
 * archived dot/ring/stud frames, unrelated emblem pairs or applied sticker
 * furniture. Old values are normalized to the same calm primitives a fresh
 * Surprise treatment uses.
 */
function normalizeRetiredSurpriseFurniture(
  source: BookStyleOverrides,
  preset: BookPreset,
  request: NormalizedRequest,
): BookStyleOverrides {
  const out: BookStyleOverrides = { ...source };
  const normalizedTitle = normalizeTitlePlateStyle(out.titlePlate);
  const availableTitles = ACTIVE_TITLE_PLATES.filter((value) =>
    styleChoiceAvailable('title-plate', value, request));
  out.titlePlate = styleChoiceAvailable('title-plate', normalizedTitle, request)
    ? normalizedTitle
    : deterministicMember(availableTitles, `${preset.id}:active-title`)
      ?? normalizedTitle;
  const normalizedEdge = normalizeEdgeTreatment(out.edge);
  const availableEdges = ACTIVE_EDGE_TREATMENTS.filter((value) =>
    styleChoiceAvailable('edge', value, request));
  out.edge = styleChoiceAvailable('edge', normalizedEdge, request)
    ? normalizedEdge
    : deterministicMember(availableEdges, `${preset.id}:active-edge`)
      ?? normalizedEdge;
  const frame = out.coverFrame ?? 0;
  const normalizedFrame = normalizeCoverFrameIndex(frame);
  const availableFrames = ACTIVE_COVER_FRAME_INDICES.filter((value) =>
    styleChoiceAvailable('cover-frame', value, request));
  out.coverFrame = styleChoiceAvailable('cover-frame', normalizedFrame, request)
    ? normalizedFrame
    : deterministicMember(availableFrames, `${preset.id}:active-frame`)
      ?? normalizedFrame;

  const ornament = out.ornament ?? -1;
  const safeOrnament = ornament >= 0
    ? normalizeOrnamentIndex(ornament)
    : -1;
  const availableMotifs = ACTIVE_ORNAMENT_INDICES.filter((value) =>
    styleChoiceAvailable('ornament', value, request));
  // `ornament` is the sole emblem decision. The renderer still accepts a
  // cover-medallion field, so mirror the normalized tool into it here.
  const preferredMotif = safeOrnament >= 0
    && styleChoiceAvailable('ornament', safeOrnament, request)
    ? safeOrnament
    : -1;
  const motif = ornament >= 0
    ? (preferredMotif >= 0 ? preferredMotif : undefined)
      ?? deterministicMember(availableMotifs, `${preset.id}:active-emblem`)
      ?? -1
    : -1;
  out.ornament = motif;
  out.coverMedallion = motif;

  out.charm = 'none';
  out.cornerProtectors = false;
  out.insetPlate = false;
  out.headTailStyle = normalizeHeadTailStyle(out.headTailStyle);
  out.raisedBands = clamp(
    Math.round(out.raisedBands ?? 0),
    0,
    Math.min(2, MAX_RAISED_BANDS),
  );
  // `bands` owns both fields. A reader may have deliberately kept foil on the
  // cords while allowing the rest of the finish to change, so only force the
  // impossible zero-band state off; do not derive this lock from `gilt`.
  if ((out.raisedBands ?? 0) === 0) out.bandGilt = false;
  return out;
}

function bindingDecorationLoad(preset: BookPreset): number {
  return preset.decorations.reduce((sum, mark) => {
    if (mark === 'plain') return sum;
    if (BUSY_DECORATIONS.has(mark)) return sum + 1.45;
    if (BAND_DECORATIONS.has(mark)) return sum + 0.82;
    if (mark === 'bosses' || mark === 'corner-tooling' || mark === 'crown-tooling') {
      return sum + 1.05;
    }
    return sum + 0.58;
  }, 0);
}

function materialSurfaceLoad(preset: BookPreset): number {
  let load = bookSurpriseMaterialSurfaceComplexity(preset);
  if (MATERIALS[preset.material].tags.includes('ornate')) load += 0.18;
  if (MATERIALS[preset.material].tags.includes('fancy')) load += 0.08;
  return load;
}

interface CompositionAudit {
  load: number;
  statements: number;
  plateFamily: ReturnType<typeof coverCompositionLayout>['family'];
  proportionExcess: number;
}

export type BookSurpriseActiveFocalProgramme =
  | 'authored-surface'
  | 'title-ground'
  | 'matched-emblem'
  | 'architectural-frame'
  | 'gilt-cords';

export interface BookSurpriseSurfaceComplexityAudit {
  material: number;
  authoredBinding: number;
  added: number;
  total: number;
  repeatedField: boolean;
  programmes: readonly BookSurpriseActiveFocalProgramme[];
}

function surfaceComplexityAudit(
  style: BookStyleOverrides,
  preset: BookPreset,
): BookSurpriseSurfaceComplexityAudit {
  const material = bookSurpriseMaterialSurfaceComplexity(preset);
  const authoredBinding = bindingDecorationLoad(preset);
  const programmes: BookSurpriseActiveFocalProgramme[] = [];
  const authoredSurface = bindingSuppliesFocalProgramme(preset);
  if (authoredSurface) programmes.push('authored-surface');

  const plateLoad = titlePlateStatement(style.titlePlate ?? 'label');
  const frameLoad = frameStatement(style.coverFrame ?? 0);
  const hasMotif = (style.ornament ?? -1) >= 0;
  const giltCords = (style.raisedBands ?? 0) >= 2 && style.bandGilt === true;
  if (plateLoad >= 1) programmes.push('title-ground');
  if (hasMotif) programmes.push('matched-emblem');
  if (frameLoad >= 0.72) programmes.push('architectural-frame');
  if (giltCords) programmes.push('gilt-cords');

  const added =
    (plateLoad >= 1 ? plateLoad : 0) +
    (hasMotif ? 0.82 : 0) +
    (frameLoad >= 0.72 ? frameLoad : 0) +
    (giltCords ? 0.58 : 0);
  return {
    material,
    authoredBinding,
    added,
    total: material + authoredBinding + added,
    repeatedField: material >= 0.66,
    programmes,
  };
}

/** Public deterministic seam for specimen boards and bad-tail sweeps. */
export function inspectBookSurpriseSurfaceComposition(
  recipe: Pick<BookSurpriseRecipe, 'preset' | 'style'>,
): BookSurpriseSurfaceComplexityAudit {
  return surfaceComplexityAudit(
    recipe.style,
    activePresetForSurpriseBinding(recipe.preset),
  );
}

function compositionAudit(
  style: BookStyleOverrides,
  preset: BookPreset,
): CompositionAudit {
  const frame = style.coverFrame ?? 0;
  const plate = style.titlePlate ?? 'label';
  const plateFamily = coverCompositionLayout(
    plate,
    frame,
    style.ornament ?? -1,
    false,
  ).family;
  const patternDominant = PATTERN_DOMINANT_MATERIALS.has(preset.material);
  const busyBinding = bindingDecorationLoad(preset) >= 1;
  const authoredHierarchy = patternDominant || busyBinding;
  const primaryTitleGround =
    plateFamily === 'heraldic' ||
    plateFamily === 'round' ||
    plateFamily === 'panel';
  const statements =
    (authoredHierarchy ? 1 : 0) +
    (primaryTitleGround ? 1 : 0) +
    (frame >= 30 ? 1 : 0) +
    ((style.raisedBands ?? 0) >= 2 ? 1 : 0);
  const format = style.format ?? 'octavo';
  const thickness = style.thickness ?? 28;
  const proportionExcess = Math.max(0, thickness - FORMAT_THICKNESS_CEILINGS[format]);
  const load =
    bindingDecorationLoad(preset) +
    materialSurfaceLoad(preset) +
    titlePlateStatement(plate) +
    frameStatement(frame) +
    (style.raisedBands ?? 0) * 0.38 +
    ((style.ornament ?? -1) >= 0 ? 0.58 : 0) +
    (style.headTail ? 0.18 : 0);
  return { load, statements, plateFamily, proportionExcess };
}

function statementBudget(
  grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  _preset: BookPreset,
): number {
  // maxStatements is an absolute whole-composition budget. The authored
  // material and decoration are counted as one coherent primary hierarchy,
  // not charged twice and not ignored as a sunk cost. A patterned or tooled
  // binding therefore keeps room for one quiet secondary decision, never a
  // second complete cover assembled from every available control.
  return grammar?.maxStatements ?? (directionId === 'grand' ? 3 : 2);
}

function deterministicMember<T>(values: readonly T[], salt: string): T | undefined {
  if (values.length === 0) return undefined;
  return values[hashText(salt) % values.length];
}

function calmerFrame(
  grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  current: number,
  ceiling = 30,
): number {
  const authored = grammar?.frames ?? DIRECTIONS[directionId].frames;
  const eligible = authored.filter(
    (frame) => frame < ceiling && SURPRISE_QUIET_FRAME_IDS.has(frame),
  );
  const wider = ACTIVE_COVER_FRAME_INDICES.filter(
    (frame) => frame < ceiling && SURPRISE_QUIET_FRAME_IDS.has(frame),
  );
  return deterministicMember(
    eligible.length > 0 ? eligible : wider,
    `${preset.id}:frame:${current}`,
  ) ?? 0;
}

function calmerPlate(
  grammar: CompositionGrammar | null,
  directionId: BookSurpriseDirectionId,
  preset: BookPreset,
  current: TitlePlateStyle,
): TitlePlateStyle {
  const authored = grammar?.plates ?? DIRECTIONS[directionId].plates;
  const eligible = authored.filter((plate) => {
    const family = coverCompositionLayout(plate, 0, 0, false).family;
    return plateMaterialEligible(plate, preset)
      && (family === 'direct' || family === 'ticket' || family === 'band');
  });
  const wider = ACTIVE_TITLE_PLATES.filter((plate) => {
    const family = coverCompositionLayout(plate, 0, 0, false).family;
    return plateMaterialEligible(plate, preset)
      && (family === 'direct' || family === 'ticket' || family === 'band');
  });
  return deterministicMember(
    eligible.length > 0 ? eligible : wider,
    `${preset.id}:plate:${current}`,
  ) ?? 'label';
}

/**
 * Modify only UNLOCKED neighbours so locked intent remains visible.
 *
 * Structural repairs affect only unlocked neighbours: a locked cord count,
 * thickness or format remains reader intent even when another combination
 * would score more cleanly.
 */
function reconcileUnlocked(
  source: BookStyleOverrides,
  preset: BookPreset,
  directionId: BookSurpriseDirectionId,
  request: NormalizedRequest,
  grammar: CompositionGrammar | null,
): BookStyleOverrides {
  const out: BookStyleOverrides = { ...source };
  const locks = request.lockSet;
  const bandsLocked = locks.has('bands');
  const thicknessLocked = locks.has('thickness');

  // Retired applied furniture has no lock or curation semantics. These fields
  // remain only because the shared renderer schema is append-only.
  out.charm = 'none';
  out.cornerProtectors = false;
  out.insetPlate = false;
  out.coverMedallion = out.ornament ?? -1;

  if (thicknessLocked && !locks.has('format')) {
    const thickness = out.thickness ?? 28;
    const ratio = BOOK_SURPRISE_SPINE_RATIO_FLOORS[directionId];
    const currentHeight = out.height ?? heightForFormat(out.format ?? 'octavo');
    if (thickness / Math.max(1, currentHeight) < ratio) {
      const formats = [...DIRECTIONS[directionId].formats]
        .sort((a, b) => heightForFormat(b) - heightForFormat(a));
      const fitting = formats.find((format) => heightForFormat(format) * ratio <= thickness);
      if (fitting !== undefined) {
        out.format = fitting;
        out.height = heightForFormat(fitting);
      }
    }
  }

  if (!bandsLocked) {
    const structuralMaximum = FLEXIBLE_SHAPES.has(preset.shape) || bindingHasBands(preset)
      ? 0
      : 3;
    out.raisedBands = clamp(Math.round(out.raisedBands ?? 0), 0, structuralMaximum);
    out.bandGilt = (out.raisedBands ?? 0) > 0 && out.gilt === true;
  }
  if (!bandsLocked && bindingOwnsFocalProgramme(preset)) {
    out.raisedBands = 0;
    out.bandGilt = false;
  }

  if (!thicknessLocked) {
    const bands = out.raisedBands ?? 0;
    const proportionFloor = Math.ceil(
      (out.height ?? heightForFormat(out.format ?? 'octavo')) *
      BOOK_SURPRISE_SPINE_RATIO_FLOORS[directionId],
    );
    const required = Math.max(
      18 + Math.max(0, bands - 2) * 1.5,
      proportionFloor,
      BOOK_SURPRISE_SPINE_WIDTH_FLOORS[directionId],
    );
    const format = out.format ?? 'octavo';
    const ceiling = FORMAT_THICKNESS_CEILINGS[format];
    out.thickness = clamp(
      Math.min(
        Math.max(out.thickness ?? 28, Math.round(required), SPINE_THICKNESS_RANGE.min),
        Math.max(ceiling, Math.round(required)),
      ),
      SPINE_THICKNESS_RANGE.min,
      SPINE_THICKNESS_RANGE.max,
    );
  }

  if (!locks.has('endbands') && FLEXIBLE_SHAPES.has(preset.shape)) {
    out.headTail = false;
    out.headTailStyle = 0;
  }

  if (PAPER_LIKE_MATERIALS.has(preset.material) && !locks.has('cover.frame')) {
    const plateIsStatement = titlePlateStatement(out.titlePlate ?? 'label') >= 1;
    if ((out.coverFrame ?? 0) >= (plateIsStatement ? 15 : 30)) {
      out.coverFrame = calmerFrame(
        grammar,
        directionId,
        preset,
        out.coverFrame ?? 0,
        plateIsStatement ? 15 : 30,
      );
    }
  }

  // Pattern is already the board's main event. Preserve it by quieting the
  // furniture around it instead of stacking a ceremonial frame and inset on
  // top of a second complete composition.
  if (PATTERN_DOMINANT_MATERIALS.has(preset.material)) {
    const plate = out.titlePlate ?? 'label';
    const plateIsStatement = titlePlateStatement(plate) >= 1;
    if (!locks.has('cover.frame') && (out.coverFrame ?? 0) >= (plateIsStatement ? 15 : 30)) {
      out.coverFrame = calmerFrame(
        grammar,
        directionId,
        preset,
        out.coverFrame ?? 0,
        plateIsStatement ? 15 : 30,
      );
    }
  }

  if (bindingOwnsFocalProgramme(preset)) {
    if (!locks.has('bands')) {
      out.raisedBands = 0;
      out.bandGilt = false;
    }
    if (!locks.has('ornament')) {
      out.ornament = -1;
      out.coverMedallion = -1;
    }
    if (!locks.has('cover.frame') && (out.coverFrame ?? 0) >= 15) {
      out.coverFrame = calmerFrame(grammar, directionId, preset, out.coverFrame ?? 0, 15);
    }
    if (
      !locks.has('title.plate') &&
      titlePlateStatement(out.titlePlate ?? 'label') >= 1
    ) {
      out.titlePlate = calmerPlate(grammar, directionId, preset, out.titlePlate ?? 'label');
    }
  }

  // Enforce each grammar's hierarchy by removing only unlocked secondary
  // statements. This is a repair pass, not another roll, so the same request
  // always converges to the same finished object.
  const maxStatements = statementBudget(grammar, directionId, preset);
  let audit = compositionAudit(out, preset);
  if (audit.statements > maxStatements && !locks.has('cover.frame')) {
    out.coverFrame = calmerFrame(grammar, directionId, preset, out.coverFrame ?? 0, 30);
    audit = compositionAudit(out, preset);
  }
  if (audit.statements > maxStatements && !locks.has('bands') && (out.raisedBands ?? 0) >= 2) {
    out.raisedBands = 1;
    out.bandGilt = out.gilt === true;
    audit = compositionAudit(out, preset);
  }
  if (audit.statements > maxStatements && !locks.has('title.plate')) {
    out.titlePlate = calmerPlate(
      grammar,
      directionId,
      preset,
      out.titlePlate ?? 'label',
    );
    audit = compositionAudit(out, preset);
  }

  out.coverMedallion = out.ornament ?? -1;

  if (!locks.has('title.gilt')) out.gilt = preset.gilt;
  if (!locks.has('bands')) out.bandGilt = (out.raisedBands ?? 0) > 0 && out.gilt === true;

  // Seal the repair as a fixed point. Earlier repairs can legitimately change
  // the title family (for example, an inset yields to a direct title), which in
  // turn changes the frame ceiling. Re-evaluating the final hierarchy here
  // prevents an order-dependent treatment from escaping with a frame that was
  // legal only for the title it had before reconciliation.
  const finalPlateIsStatement = titlePlateStatement(out.titlePlate ?? 'label') >= 1;
  const restrainedSurface =
    PAPER_LIKE_MATERIALS.has(preset.material) ||
    PATTERN_DOMINANT_MATERIALS.has(preset.material);
  if (restrainedSurface && !locks.has('cover.frame')) {
    const ceiling = finalPlateIsStatement ? 15 : 30;
    if ((out.coverFrame ?? 0) >= ceiling) {
      out.coverFrame = calmerFrame(
        grammar,
        directionId,
        preset,
        out.coverFrame ?? 0,
        ceiling,
      );
    }
  }
  // Surprise normally owns the exact binding covering. A visible colour lock
  // temporarily couples an existing coarse override because removing the
  // transform would change the promised pixels even if the source hex stayed
  // byte-identical.
  const colourCouplesPinnedMaterial = request.current !== undefined
    && hasOneOf(locks, BODY_COLOUR_LOCKS)
    && currentFieldPinned(request.current, 'material');
  if (!locks.has('cover.material') && !colourCouplesPinnedMaterial) delete out.material;

  return out;
}

/* ========================================================================== *
 *                                  scoring                                   *
 * ========================================================================== */

interface ScoredCandidate {
  preset: BookPreset;
  style: BookStyleOverrides;
  score: number;
  diagnostics: readonly BookSurpriseDiagnostic[];
  cell: string;
  serial: number;
  treatment: number;
  /** Unlocked construction/category violations. Zero dominates every nonzero value. */
  constraintViolations: number;
  /** Soft repeat avoidance becomes a dominance tier when another binding exists. */
  avoidanceViolation: number;
  archetype: string;
}

function pushPenalty(
  diagnostics: BookSurpriseDiagnostic[],
  code: BookSurpriseDiagnostic['code'],
  message: string,
  penalty: number,
  locked = false,
): number {
  if (penalty <= 0) return 0;
  diagnostics.push({ code, message, penalty, ...(locked ? { locked: true } : {}) });
  return penalty;
}

function hexRgb(hex: string | null | undefined): readonly [number, number, number] | null {
  if (typeof hex !== 'string') return null;
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) return null;
  const n = Number.parseInt(match[1] as string, 16);
  return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function colourDistance(a: string | null | undefined, b: string | null | undefined): number {
  const ra = hexRgb(a);
  const rb = hexRgb(b);
  if (ra === null || rb === null) return 0.35;
  const dr = (ra[0] - rb[0]) / 255;
  const dg = (ra[1] - rb[1]) / 255;
  const db = (ra[2] - rb[2]) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

function decorationDensity(style: BookStyleOverrides, preset: BookPreset): number {
  let density = preset.decorations.filter((mark) => mark !== 'plain').length * 0.8;
  // A cover title ground is real authored furniture. Omitting it from this
  // measure made title-led books look artificially bare beside an otherwise
  // identical emblem-led candidate and caused the elite search to stamp every
  // Grand, Botanical and Storybook result.
  density += titlePlateStatement(style.titlePlate ?? 'label') * 0.75;
  density += (style.raisedBands ?? 0) * 0.55;
  density += (style.ornament ?? -1) >= 0 ? 0.75 : 0;
  density += (style.coverFrame ?? 0) >= 44 ? 1.8 : (style.coverFrame ?? 0) >= 30 ? 1.25 : (style.coverFrame ?? 0) >= 15 ? 0.8 : 0.45;
  density += BUSY_DECORATIONS.has(preset.decorations[0] as Decoration) ? 0.5 : 0;
  return density;
}

function scoreCandidate(
  preset: BookPreset,
  style: BookStyleOverrides,
  directionId: BookSurpriseDirectionId,
  request: NormalizedRequest,
  serial: number,
  treatment: number,
  curationFallback: boolean,
  grammar: CompositionGrammar | null,
): ScoredCandidate {
  const diagnostics: BookSurpriseDiagnostic[] = [];
  let penalty = 0;
  let constraintViolations = 0;
  const locks = request.lockSet;

  const hardConstraint = (
    problem: boolean,
    code: BookSurpriseDiagnostic['code'],
    message: string,
    points: number,
    heldBy: readonly BookSurpriseLockId[],
  ): void => {
    if (!problem) return;
    const locked = heldBy.some((id) => locks.has(id));
    if (!locked) constraintViolations += 1;
    penalty += pushPenalty(
      diagnostics,
      locked ? 'locked-compromise' : code,
      message,
      points,
      locked,
    );
  };

  const bands = style.raisedBands ?? 0;
  hardConstraint(
    !SURPRISE_QUIET_FRAME_IDS.has(style.coverFrame ?? 0) &&
      !SURPRISE_FOCAL_FRAME_IDS.has(style.coverFrame ?? 0),
    'composition-hierarchy',
    'The cover frame belongs to the retired dot, ring, stud or repeated-side vocabulary.',
    18,
    ['cover.frame'],
  );
  hardConstraint(
    ((style.ornament ?? -1) >= 0 && !SURPRISE_SAFE_ORNAMENT_IDS.has(style.ornament ?? -1)) ||
      ((style.coverMedallion ?? -1) >= 0 && !SURPRISE_SAFE_ORNAMENT_IDS.has(style.coverMedallion ?? -1)),
    'composition-hierarchy',
    'The emblem belongs to the retired novelty-stamp vocabulary.',
    18,
    ['ornament'],
  );
  if (bands > 0 && bindingHasBands(preset)) {
    const locked = locks.has('bands') || hasLock(locks, 'binding.decoration') || hasLock(locks, 'binding.shape');
    penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'duplicate-bands',
      'Raised cords repeat bands already built into the binding.', 18 + bands * 2.5, locked);
    if (!locked) constraintViolations += 1;
  }

  hardConstraint(
    bindingOwnsFocalProgramme(preset) && bands > 0,
    'composition-hierarchy',
    'This authored surface cannot carry an independent second band programme.',
    16 + bands * 2,
    ['bands'],
  );
  hardConstraint(
    bindingOwnsFocalProgramme(preset) && frameStatement(style.coverFrame ?? 0) >= 0.72,
    'composition-hierarchy',
    'This closed binding cannot carry an independent heavy cover frame.',
    16,
    ['cover.frame'],
  );
  hardConstraint(
    bindingOwnsFocalProgramme(preset) && (style.ornament ?? -1) >= 0,
    'composition-hierarchy',
    'This closed binding already has an authored spine tool and cannot take another emblem.',
    14,
    ['ornament'],
  );
  if (FLEXIBLE_SHAPES.has(preset.shape) && style.headTail === true) {
    const locked = locks.has('endbands') || hasLock(locks, 'binding.shape');
    penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'material-structure',
      'A flexible sewing structure is carrying rigid case endbands.', 9, locked);
    if (!locked) constraintViolations += 1;
  }
  hardConstraint(
    FLEXIBLE_SHAPES.has(preset.shape) && bands > 0,
    'material-structure',
    'A flexible or visibly sewn spine cannot carry a second set of raised cords.',
    22 + bands * 3,
    ['bands'],
  );
  const composition = compositionAudit(style, preset);
  const surfaceComplexity = surfaceComplexityAudit(style, preset);
  const maxStatements = statementBudget(grammar, directionId, preset);
  hardConstraint(
    composition.statements > maxStatements,
    'composition-hierarchy',
    `The ${grammar?.id ?? directionId} composition carries too many statement devices.`,
    10 + (composition.statements - maxStatements) * 5,
    [
      'binding', 'binding.decoration', 'title.plate', 'cover.frame',
      'ornament', 'bands',
    ],
  );
  hardConstraint(
    PATTERN_DOMINANT_MATERIALS.has(preset.material) &&
      (style.coverFrame ?? 0) >=
        (titlePlateStatement(style.titlePlate ?? 'label') >= 1 ? 15 : 30),
    'composition-hierarchy',
    'Patterned covering and ceremonial board tooling are both trying to lead.',
    14,
    ['binding', 'binding.material', 'cover.frame', 'title.plate'],
  );
  hardConstraint(
    PAPER_LIKE_MATERIALS.has(preset.material) && (style.coverFrame ?? 0) >= 30,
    'material-structure',
    'Paper and vellum need a restrained frame rather than heavy case tooling.',
    12,
    ['binding', 'binding.material', 'cover.frame'],
  );
  hardConstraint(
    surfaceComplexity.programmes.length > 1,
    'composition-hierarchy',
    surfaceComplexity.repeatedField
      ? 'A repeated material field must remain the only decorative programme on the book.'
      : 'The book carries several focal programmes instead of one composed hierarchy.',
    17 + (surfaceComplexity.programmes.length - 1) * 6,
    [
      'binding', 'binding.material', 'binding.decoration', 'title.plate',
      'ornament', 'cover.frame', 'bands',
    ],
  );
  hardConstraint(
    surfaceComplexity.material >= 0.42 && (
      frameStatement(style.coverFrame ?? 0) >= 0.72 ||
      (style.ornament ?? -1) >= 0 ||
      (style.coverMedallion ?? -1) >= 0
    ),
    'composition-hierarchy',
    'Intricate frames and emblems require a smooth field, not a figured or micro-patterned covering.',
    15 + surfaceComplexity.material * 3,
    ['binding', 'binding.material', 'cover.frame', 'ornament'],
  );
  hardConstraint(
    ((style.ornament ?? -1) >= 0) !== ((style.coverMedallion ?? -1) >= 0) ||
    (
      (style.ornament ?? -1) >= 0 &&
      (style.coverMedallion ?? -1) >= 0 &&
      style.ornament !== style.coverMedallion
    ),
    'composition-hierarchy',
    'Spine and cover emblems must repeat one authored tool rather than unrelated stamps.',
    14,
    ['ornament'],
  );

  const height = style.height ?? heightForFormat(style.format ?? 'octavo');
  const thickness = style.thickness ?? 28;
  const ratioFloor = BOOK_SURPRISE_SPINE_RATIO_FLOORS[directionId];
  const ratioDeficit = Math.max(0, ratioFloor - thickness / Math.max(1, height));
  hardConstraint(
    ratioDeficit > 0.004,
    'proportion',
    'The spine is too slight to remain recognisable beside books of this height.',
    ratioDeficit * 180,
    ['format', 'thickness'],
  );
  hardConstraint(
    thickness < BOOK_SURPRISE_SPINE_WIDTH_FLOORS[directionId],
    'proportion',
    'The generated spine is too narrow to read at shelf scale.',
    (BOOK_SURPRISE_SPINE_WIDTH_FLOORS[directionId] - thickness) * 1.6,
    ['thickness'],
  );
  if (
    style.material !== undefined &&
    bindingMaterialFor(preset.material) !== style.material
  ) {
    const locked = locks.has('cover.material');
    if (!locked) constraintViolations += 1;
    penalty += pushPenalty(
      diagnostics,
      locked ? 'locked-compromise' : 'material-structure',
      'The cover material override contradicts the selected binding construction.',
      24,
      locked,
    );
  }

  if (style.gilt !== undefined && style.gilt !== preset.gilt) {
    const locked = locks.has('title.gilt') || hasLock(locks, 'binding.gilt');
    penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'finish-direction',
      'The applied tooling finish differs from the binding family.', 3.5, locked);
  }

  const density = decorationDensity(style, preset);
  // Surface-led bindings carry their information in material and authored
  // tooling. They must not be "fixed" by adding unrelated knobs merely to
  // satisfy Grand's ordinary furniture-density floor — that pressure was the
  // source of patterned fields acquiring a frame, emblem and hardware.
  const surfaceLed = surfaceComplexity.programmes.length === 1
    && surfaceComplexity.programmes[0] === 'authored-surface';
  const [minDensity, maxDensity] = surfaceLed
    ? [0.9, 3.6] as const
    : ACTIVE_SURPRISE_DENSITY[directionId];
  if (density < minDensity) {
    penalty += pushPenalty(diagnostics, 'finish-direction',
      `The finish is sparse for ${directionId}.`, (minDensity - density) * 2.2);
  } else if (density > maxDensity) {
    const locked = locks.has('bands') || locks.has('ornament') || locks.has('cover.frame');
    penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'furniture-density',
      'Too many independent details compete with the title.', (density - maxDensity) * 4.8, locked);
  }

  const spine = resolveBookDesign({
    seed: request.seed,
    preset: preset.id,
    cloth: style.spineBaseHex ?? undefined,
    baseColourPinned: typeof style.spineBaseHex === 'string',
    accent: style.spineAccentHex ?? undefined,
  });
  const [spineFace] = bookBodyColours(spine);
  const [coverFace] = coverBodyColours(
    preset.material,
    style.coverBaseHex ?? '#5b6670',
    typeof style.coverBaseHex === 'string',
  );
  for (const [role, colour, bases] of [
    ['tooling', style.toolingHex, [spineFace, coverFace]],
    ['emblem', style.emblemHex, [spineFace, coverFace]],
  ] as const) {
    if (typeof colour !== 'string') continue;
    const contrast = Math.min(...bases.map((base) => bookColourContrast(colour, base)));
    if (contrast < 2.35) {
      const id = role === 'tooling' ? 'colour.tooling' : 'colour.emblem';
      const locked = locks.has(id);
      penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'colour-contrast',
        `${role} is too close to the surface beneath it.`, (2.35 - contrast) * 7.5, locked);
    }
  }

  const spinePair = colourDistance(style.spineBaseHex, style.spineAccentHex);
  const coverPair = colourDistance(style.coverBaseHex, style.coverAccentHex);
  if (spinePair < 0.055 || coverPair < 0.055) {
    const locked = locks.has('colour.spine-base') || locks.has('colour.spine-accent') ||
      locks.has('colour.cover-base') || locks.has('colour.cover-accent');
    penalty += pushPenalty(diagnostics, locked ? 'locked-compromise' : 'colour-harmony',
      'Primary and secondary coverings are too similar to read as separate materials.', 5.5, locked);
  }
  if (spinePair > 0.62 || coverPair > 0.62) {
    penalty += pushPenalty(diagnostics, 'colour-harmony',
      'The two coverings pull too far apart for one binding.', 3.5);
  }

  if (request.avoidBinding && !locks.has('binding') && preset.id === request.avoidBinding) {
    penalty += 2.75;
  }
  if (curationFallback) {
    penalty += pushPenalty(diagnostics, 'curation-fallback',
      'The selected direction had no legal binding under the current locks and removals.', 0.5);
  }

  if (grammar !== null) {
    const grammarMisses: string[] = [];
    if (!grammar.plates.includes(style.titlePlate ?? 'label')) grammarMisses.push('title treatment');
    if (!grammar.frames.includes(style.coverFrame ?? 0)) grammarMisses.push('cover frame');
    if (
      (style.ornament ?? -1) >= 0 &&
      !grammar.ornaments.includes(style.ornament ?? -1)
    ) grammarMisses.push('spine emblem');
    if (
      grammar.edges !== undefined &&
      !grammar.edges.includes(style.edge ?? 'plain')
    ) grammarMisses.push('page edge');
    if (grammarMisses.length > 0) {
      const locked = locks.has('title.plate') || locks.has('cover.frame') ||
        locks.has('ornament') || locks.has('edge');
      penalty += pushPenalty(
        diagnostics,
        locked ? 'locked-compromise' : 'direction-identity',
        `${grammarMisses.join(', ')} sit outside the ${grammar.id} composition grammar.`,
        grammarMisses.length * 2.4,
        locked,
      );
    }
  }

  /*
   * Aesthetic tie-breaks deliberately remain below diagnostic severity. The
   * old score started at 100 and most legal candidates stayed there, so its
   * ordering could not distinguish an elegantly balanced composition from a
   * merely non-broken one. These small continuous costs rank the frontier
   * without pretending there is one maximally decorated ideal book.
   */
  const targetDensity = (minDensity + maxDensity) / 2;
  const densityCadence = Math.abs(density - targetDensity) * 0.48;
  const targetPair = directionId === 'grand' || directionId === 'storybook'
    ? 0.24
    : directionId === 'quiet'
      ? 0.16
      : 0.2;
  const colourCadence = (Math.abs(spinePair - targetPair) + Math.abs(coverPair - targetPair)) * 2.1;
  const coverLayout = coverCompositionLayout(
    style.titlePlate ?? 'label',
    style.coverFrame ?? 0,
    style.ornament ?? -1,
    false,
  );
  let hierarchyCadence = 0;
  if (coverLayout.family === 'round' && (style.coverFrame ?? 0) >= 44) hierarchyCadence += 0.55;
  if (coverLayout.family === 'ticket' && (style.coverFrame ?? 0) >= 44) hierarchyCadence += 0.35;
  if (PALE_OR_PAPER_MATERIALS.has(preset.material) && (style.coverFrame ?? 0) >= 44) hierarchyCadence += 0.5;

  const [targetLoadMin, targetLoadMax] = grammar?.targetLoad ?? [minDensity, maxDensity];
  const targetLoad = (targetLoadMin + targetLoadMax) / 2;
  const loadCadence = Math.abs(composition.load - targetLoad) * 0.82;
  const loadOverflow = Math.max(0, composition.load - targetLoadMax) * 2.4;
  const proportionCadence = composition.proportionExcess * 0.7;

  // The authored binding weight is a light tie-breaker, not permission for a
  // common preset to beat a visibly better one. Starting below 100 keeps the
  // result informative instead of saturating nearly every legal candidate.
  const authoredBonus = Math.min(1.8, Math.log2(Math.max(1, preset.weight)) * 0.55);
  const score = clamp(
    96.5 - penalty - densityCadence - colourCadence - hierarchyCadence -
      loadCadence - loadOverflow - proportionCadence + authoredBonus * 0.45,
    0,
    99.7,
  );
  const densityCell = density < 2.25 ? 'restrained' : density < 4.8 ? 'balanced' : 'ornate';
  const frame = style.coverFrame ?? 0;
  const frameCell = frame < 15 ? 'plain' : frame < 30 ? 'detailed' : frame < 44 ? 'architectural' : 'ceremonial';
  const cell = [
    preset.id,
    preset.shape,
    MATERIALS[preset.material].group,
    grammar?.id ?? 'widened',
    coverLayout.family,
    frameCell,
    style.titlePlate ?? 'label',
    frame,
    style.ornament ?? -1,
    densityCell,
  ].join('|');
  const avoidanceViolation = request.avoidBinding && !locks.has('binding') && preset.id === request.avoidBinding
    ? 1
    : 0;
  return {
    preset,
    style,
    score,
    diagnostics,
    cell,
    serial,
    treatment,
    constraintViolations,
    avoidanceViolation,
    archetype: grammar?.id ?? `${directionId}-widened`,
  };
}

function eliteCandidates(candidates: readonly ScoredCandidate[]): readonly ScoredCandidate[] {
  const cells = new Map<string, ScoredCandidate>();
  for (const candidate of candidates) {
    const prior = cells.get(candidate.cell);
    if (
      prior === undefined ||
      candidate.score > prior.score ||
      (candidate.score === prior.score && candidate.serial < prior.serial)
    ) cells.set(candidate.cell, candidate);
  }
  return [...cells.values()].sort((a, b) => b.score - a.score || a.serial - b.serial);
}

function allTreatmentsLegalPresetIds(
  candidates: readonly ScoredCandidate[],
): ReadonlySet<BookPresetId> {
  const groups = new Map<BookPresetId, ScoredCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.preset.id) ?? [];
    group.push(candidate);
    groups.set(candidate.preset.id, group);
  }
  return new Set(
    [...groups.entries()]
      .filter(([, group]) => group.length > 0 && group.every((candidate) => candidate.constraintViolations === 0))
      .map(([presetId]) => presetId),
  );
}

function chooseElite(candidates: readonly ScoredCandidate[], seed: number): ScoredCandidate {
  /*
   * Constraint dominance comes before aesthetics. A structurally invalid book
   * is never allowed onto the quality frontier merely because its colours are
   * attractive. Fully locked impossible states remain total: when every
   * candidate carries the same unavoidable compromise, the least-violating
   * tier is still returned and the diagnostics explain why.
   */
  // A binding does not earn a place in the weighted preset draw because one
  // lucky treatment repaired cleanly. Every treatment generated for it must
  // satisfy construction rules; otherwise exclude the whole preset before
  // choosing an archetype. This prevents a rare bad roll from reappearing as
  // soon as the same approved binding is drawn with another palette/layout.
  const safePresetIds = allTreatmentsLegalPresetIds(candidates);
  const safetyConditioned = safePresetIds.size > 0
    ? candidates.filter((candidate) => safePresetIds.has(candidate.preset.id))
    : candidates;
  // The picker may still expose patterned papers, flecked textiles and other
  // specialist bindings. Automatic Surprise deliberately does not. If locks
  // or aggressive curation leave only those choices, the operation remains
  // total and returns the quiet surface-led treatment instead.
  const calmSurfaceCandidates = safetyConditioned.filter((candidate) =>
    bookPresetAllowedForAutomaticSurprise(candidate.preset));
  const surfaceConditioned = calmSurfaceCandidates.length > 0
    ? calmSurfaceCandidates
    : safetyConditioned;
  const fewestViolations = Math.min(...surfaceConditioned.map((candidate) => candidate.constraintViolations));
  const structurallyLegal = surfaceConditioned.filter(
    (candidate) => candidate.constraintViolations === fewestViolations,
  );
  const bestAvoidance = Math.min(...structurallyLegal.map((candidate) => candidate.avoidanceViolation));
  const nonRepeating = structurallyLegal.filter(
    (candidate) => candidate.avoidanceViolation === bestAvoidance,
  );
  /*
   * Direction -> archetype -> treatment is a conditional generator. Choosing
   * a global winner first lets the largest/easiest archetype swallow the
   * others even when each is excellent (the old Rustic sweep produced only
   * workshop ledgers). Pick uniformly among authored archetypes that clear a
   * strict global quality gate, then optimize inside that grammar. This makes
   * a "Botanical field journal" an identity rather than a losing score term.
   */
  const globalBest = Math.max(...nonRepeating.map((candidate) => candidate.score));
  const archetypeGroups = new Map<string, ScoredCandidate[]>();
  for (const candidate of nonRepeating) {
    const group = archetypeGroups.get(candidate.archetype) ?? [];
    group.push(candidate);
    archetypeGroups.set(candidate.archetype, group);
  }
  const eligibleArchetypes = [...archetypeGroups.entries()]
    .filter(([, group]) => {
      const best = Math.max(...group.map((candidate) => candidate.score));
      return best >= 90 && best >= globalBest - 2.5;
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const archetypePool = eligibleArchetypes.length > 0 ? eligibleArchetypes : [...archetypeGroups.entries()];
  const selectedArchetype = archetypePool[
    Math.floor(mulberry32(mixSeed(seed, 0x6a7c_4e21))() * archetypePool.length)
  ];
  const archetypeConditioned = selectedArchetype?.[1] ?? nonRepeating;

  // The active preset collection is itself a visual keep-list. Pick a binding
  // inside the chosen grammar before comparing its treatments, otherwise a
  // common square cloth can beat a rarer but equally approved half binding on
  // every seed. Authored shelf weights remain a gentle frequency signal; the
  // square root keeps niche books visible without turning the shelf into a
  // specimen cabinet.
  const presetGroups = new Map<BookPresetId, ScoredCandidate[]>();
  for (const candidate of archetypeConditioned) {
    const group = presetGroups.get(candidate.preset.id) ?? [];
    group.push(candidate);
    presetGroups.set(candidate.preset.id, group);
  }
  const archetypeBest = Math.max(...archetypeConditioned.map((candidate) => candidate.score));
  const eligiblePresets = [...presetGroups.entries()]
    .filter(([, group]) => {
      const best = Math.max(...group.map((candidate) => candidate.score));
      return best >= 90 && best >= archetypeBest - 2.5;
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const presetPool = eligiblePresets.length > 0 ? eligiblePresets : [...presetGroups.entries()];
  const presetWeights = presetPool.map(([, group]) => Math.sqrt(Math.max(1, group[0]?.preset.weight ?? 1)));
  const presetWeightTotal = presetWeights.reduce((sum, weight) => sum + weight, 0);
  let presetCursor = mulberry32(mixSeed(seed, 0x41b5_93d7))() * presetWeightTotal;
  let selectedPreset = presetPool[presetPool.length - 1];
  for (let i = 0; i < presetPool.length; i += 1) {
    presetCursor -= presetWeights[i] as number;
    if (presetCursor <= 0) {
      selectedPreset = presetPool[i];
      break;
    }
  }
  const conditioned = selectedPreset?.[1] ?? archetypeConditioned;
  const elites = eliteCandidates(conditioned);
  const best = elites[0] as ScoredCandidate;
  // The old best-minus-3.75 band admitted nearly the entire 94-98 score range.
  // A 1.05-point frontier still retains several genuinely equivalent cells
  // after six treatments per binding, without showing the reader a known-worse
  // tail just to make the output look random on paper.
  const threshold = Math.max(82, best.score - 1.05);
  const nearBest = elites.filter((candidate) => candidate.score >= threshold);
  if (nearBest.length <= 1) return best;

  // Quadratic weighting favours the top of the already narrow frontier. Seeded
  // choice and treatment diversity still prevent one universal "best" book.
  const weights = nearBest.map((candidate) => {
    const position = candidate.score - threshold + 0.2;
    return position * position;
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = mulberry32(mixSeed(seed, 0x2e5a77d1))() * total;
  for (let i = 0; i < nearBest.length; i += 1) {
    cursor -= weights[i] as number;
    if (cursor <= 0) return nearBest[i] as ScoredCandidate;
  }
  return nearBest[nearBest.length - 1] as ScoredCandidate;
}

function qualityFor(score: number): BookSurpriseQuality {
  if (score >= 93) return 'excellent';
  if (score >= 82) return 'strong';
  return 'acceptable';
}

interface CandidateSearchResult {
  direction: BookSurpriseDirectionId;
  candidates: readonly ScoredCandidate[];
}

function buildCandidateSearch(request: NormalizedRequest): CandidateSearchResult {
  const direction = chosenDirection(request.direction, request.seed);
  const pool = presetPool(request, direction);
  // The positional overload exists for compatibility with seed sweeps and
  // older callers that cannot supply locks/current state. Its single authored
  // draw receives the same repair/scoring pass, while the object-form Studio
  // call runs the full quality-diversity search. This keeps historical test and
  // shelf seed paths cheap without weakening the interactive feature.
  const assignments: readonly CandidateAssignment[] = request.legacy
    ? [{
        preset: shuffled(pool.presets, mixSeed(request.seed, 0x51b1d17e))[0] as BookPreset,
        treatment: 0,
      }]
    : candidateAssignments(pool.presets, request.seed);
  const candidates: ScoredCandidate[] = [];

  for (let serial = 0; serial < assignments.length; serial += 1) {
    const assignment = assignments[serial] as CandidateAssignment;
    const preset = assignment.preset;
    const candidateSeed = mixSeed(
      request.seed,
      hashText(`${direction}:${preset.id}`),
      assignment.treatment,
    );
    const generated = generatedStyle(direction, preset, candidateSeed, request);
    let style = generated.style;
    style = applyStyleLocks(style, request);
    style = reconcileUnlocked(style, preset, direction, request, generated.grammar);
    style = normalizeRetiredSurpriseFurniture(
      style,
      preset,
      request,
    );
    candidates.push(scoreCandidate(
      preset,
      style,
      direction,
      request,
      serial,
      assignment.treatment,
      pool.curationFallback,
      generated.grammar,
    ));
  }
  return { direction, candidates };
}

/* ========================================================================== *
 *                                  public                                    *
 * ========================================================================== */

export function surpriseBookRecipe(request: BookSurpriseRequest): BookSurpriseRecipe;
/** Compatibility overload retained while Book Studio adopts the object form. */
export function surpriseBookRecipe(
  direction: BookSurpriseDirectionId | null,
  seed: number,
  guard?: BookSurprisePresetGuard,
): BookSurpriseRecipe;
export function surpriseBookRecipe(
  first: BookSurpriseRequest | BookSurpriseDirectionId | null,
  seed?: number,
  guard?: BookSurprisePresetGuard,
): BookSurpriseRecipe {
  const request = normalizeRequest(first, seed, guard);
  const search = buildCandidateSearch(request);
  const chosen = chooseElite(search.candidates, request.seed);
  return {
    preset: chosen.preset.id,
    style: chosen.style,
    direction: search.direction,
    archetype: chosen.archetype,
    candidatesEvaluated: search.candidates.length,
    locks: request.locks,
    components: {
      shape: chosen.preset.shape,
      material: chosen.preset.material,
      decorations: chosen.preset.decorations,
      gilt: chosen.preset.gilt,
    },
    score: Math.round(chosen.score * 10) / 10,
    quality: qualityFor(chosen.score),
    constraintViolations: chosen.constraintViolations,
    diagnostics: chosen.diagnostics,
  };
}

/**
 * Inspect the complete object-form production search without rendering it.
 * This is the release gate's answer to two otherwise opaque questions: did
 * every binding receive the promised treatment breadth, and was an unsafe
 * binding removed before the weighted archetype/preset draw?
 */
export function inspectBookSurpriseSearch(
  request: BookSurpriseRequest,
): BookSurpriseSearchInspection {
  const normalized = normalizeRequest(request);
  const search = buildCandidateSearch(normalized);
  const chosen = chooseElite(search.candidates, normalized.seed);
  const safePresetIds = allTreatmentsLegalPresetIds(search.candidates);
  const groups = new Map<BookPresetId, ScoredCandidate[]>();
  for (const candidate of search.candidates) {
    const group = groups.get(candidate.preset.id) ?? [];
    group.push(candidate);
    groups.set(candidate.preset.id, group);
  }
  const presets = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([preset, treatments]): BookSurprisePresetSearchAudit => ({
      preset,
      archetype: treatments[0]?.archetype ?? `${search.direction}-widened`,
      treatmentsEvaluated: treatments.length,
      legalTreatments: treatments.filter((candidate) => candidate.constraintViolations === 0).length,
      minimumScore: Math.round(Math.min(...treatments.map((candidate) => candidate.score)) * 10) / 10,
      maximumScore: Math.round(Math.max(...treatments.map((candidate) => candidate.score)) * 10) / 10,
      structurallyEligible: safePresetIds.has(preset),
      violationCodes: [...new Set(
        treatments
          .filter((candidate) => candidate.constraintViolations > 0)
          .flatMap((candidate) => candidate.diagnostics)
          .filter((diagnostic) => diagnostic.locked !== true)
          .map((diagnostic) => diagnostic.code),
      )].sort(),
      violationMessages: [...new Set(
        treatments
          .filter((candidate) => candidate.constraintViolations > 0)
          .flatMap((candidate) => candidate.diagnostics)
          .filter((diagnostic) => diagnostic.locked !== true)
          .map((diagnostic) => diagnostic.message),
      )].sort(),
      treatments: treatments
        .map((candidate): BookSurpriseTreatmentSearchAudit => ({
          treatment: candidate.treatment,
          style: candidate.style,
          score: Math.round(candidate.score * 10) / 10,
          constraintViolations: candidate.constraintViolations,
          diagnostics: candidate.diagnostics,
        }))
        .sort((a, b) => a.treatment - b.treatment),
    }));
  return {
    direction: search.direction,
    candidatesEvaluated: search.candidates.length,
    selectedPreset: chosen.preset.id,
    selectedArchetype: chosen.archetype,
    presets,
  };
}

/**
 * Public inspection hook for tests/specimen tooling. It deliberately shares
 * the production scorer so a gate cannot claim quality using a weaker proxy.
 */
export function inspectBookSurpriseRecipe(
  recipe: Pick<BookSurpriseRecipe, 'preset' | 'style'>,
  direction: BookSurpriseDirectionId,
  current?: BookSurpriseCurrent,
  locks?: BookSurpriseLockSet | ReadonlySet<BookSurpriseLockId>,
): Pick<BookSurpriseRecipe, 'score' | 'quality' | 'constraintViolations' | 'diagnostics'> {
  const normalizedLocks = normalizeBookSurpriseLocks(locks);
  const request: NormalizedRequest = {
    direction,
    seed: 0,
    ...(current === undefined ? {} : { current }),
    locks: normalizedLocks,
    lockSet: new Set(normalizedLocks),
    legacy: false,
  };
  const preset = activePresetForSurpriseBinding(recipe.preset);
  const scored = scoreCandidate(
    preset,
    recipe.style,
    direction,
    request,
    0,
    0,
    false,
    grammarForPreset(direction, preset),
  );
  return {
    score: Math.round(scored.score * 10) / 10,
    quality: qualityFor(scored.score),
    constraintViolations: scored.constraintViolations,
    diagnostics: scored.diagnostics,
  };
}

/**
 * The seed-path binding remains intentionally simple and stable. Exporting a
 * helper here makes it clear that Surprise's random seed and a book's identity
 * seed are separate things when the UI constructs `current.binding`.
 */
export function effectiveBookBindingForSurprise(
  pinned: BookPresetId | null | undefined,
  bookSeed: number,
): BookPresetId {
  return pinned === null || pinned === undefined
    ? presetForSeed(bookSeed >>> 0).id
    : activePresetForSurpriseBinding(pinned).id;
}
