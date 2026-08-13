/**
 * art/spines.ts — seeded book identity, and the flat drawing of one spine.
 *
 * A book's entire look still derives from a 32-bit seed (fnv1a of its id):
 * seed → mulberry32 → SpineParams (~100 bytes, the only persisted state).
 * What changed is what those params are *spent* on. They used to feed a brush
 * engine — layered multiply gradients, generated material tiles, a light rig
 * per row — which cost seconds of startup and still read as cheap.
 *
 * `renderSpine` now draws in the app's one vocabulary (`art/flat.ts`): flat
 * colour, one ink outline, rounded corners, nothing axis-true. The params it
 * has always carried are mapped onto that vocabulary rather than thrown away —
 * `palette` picks the cloth, `bands`/`raisedBands`/`gilt` decide the dressing,
 * `ornament` still picks from its append-only stamp table — so a book keeps the identity
 * it was created with and simply stops pretending to be a photograph.
 *
 * The pigment tables, the studio vocabulary and the row compositor below are
 * untouched: they are data and layout, and nothing about them was painterly.
 */

import { CHARM_COLORS, type CharmKind } from './charms';
import {
  bookPresetHasAuthoredFocal,
  drawBookSpine,
  drawOpenBinderTool,
  materialLookFor,
  resolveBookDesign,
  type BookDesign,
  type BookPresetId,
  type BroadFocalGlyph,
  type DesignBox,
} from './bookDesign';
import { normaliseHex } from './customColour';
import { CLOTH_LABELS, CLOTHS, FLAT, inkWidth, stroke as inkLine, wobbleRect } from './flat';
// `drawSpine` is no longer called from here — `drawBookSpine` covers the same
// ground and adds the shape and material axes. `flatSpineFor` survives for the
// one field the binding still takes from the old seeded spec: its focal
// compartment. `flatShelf.drawSpine` itself stays: `drawCaseCard` and `drawBookRow`
// draw books at card scale, where a binding's fine work would be a smudge.
import { flatSpineFor } from './flatShelf';
import { clamp, mulberry32, type RandomFn } from './noise';
import { colourContrast } from './titleContrast';

/* ---------------------- front-cover title graphemes ---------------------- */

/** The small `Intl.Segmenter` surface used here, typed without raising the app's ES2020 lib. */
interface GraphemeSegmenterLike {
  segment(input: string): Iterable<{ readonly index: number }>;
}

type GraphemeSegmenterConstructor = new (
  locales?: string | readonly string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenterLike;

const GraphemeSegmenter = (
  Intl as unknown as { readonly Segmenter?: GraphemeSegmenterConstructor }
).Segmenter;

/** One shared segmenter: cover-title fitting may remove several clusters in a row. */
const TITLE_GRAPHEME_SEGMENTER = GraphemeSegmenter === undefined
  ? null
  : new GraphemeSegmenter(undefined, { granularity: 'grapheme' });

const UNICODE_MARK = /^\p{M}$/u;

function isRegionalIndicator(point: string): boolean {
  const code = point.codePointAt(0) ?? -1;
  return code >= 0x1f1e6 && code <= 0x1f1ff;
}

/**
 * Conservative fallback for the old browser that has no `Intl.Segmenter`.
 *
 * Alcove ships on WebView2, where Segmenter is present; this path keeps a
 * degraded or test host safe too. It covers combining marks, variation and
 * skin-tone modifiers, keycaps, emoji tag sequences, flags, CRLF and ZWJ emoji
 * families. In doubtful suffixes it removes the whole joined run rather than
 * risk leaving half a visible glyph behind.
 */
function fallbackLastGraphemeStart(points: readonly string[]): number {
  const end = points.length - 1;
  if (end < 0) return 0;

  if (points[end] === '\n' && end > 0 && points[end - 1] === '\r') return end - 1;

  if (isRegionalIndicator(points[end]!)) {
    let first = end;
    while (first > 0 && isRegionalIndicator(points[first - 1]!)) first -= 1;
    const runLength = points.length - first;
    return points.length - (runLength % 2 === 0 ? 2 : 1);
  }

  const isExtend = (point: string): boolean => {
    const code = point.codePointAt(0) ?? -1;
    return UNICODE_MARK.test(point)
      || code === 0x200c // zero-width non-joiner
      || code === 0x200d // a trailing joiner belongs to the preceding glyph
      || (code >= 0xfe00 && code <= 0xfe0f) // variation selectors
      || (code >= 0xe0100 && code <= 0xe01ef) // variation selectors supplement
      || (code >= 0x1f3fb && code <= 0x1f3ff) // emoji skin tones
      || (code >= 0xe0020 && code <= 0xe007f); // emoji tag sequences
  };

  let start = end;
  while (start > 0 && isExtend(points[start]!)) start -= 1;

  // Emoji sequences bind the base on each side of a ZWJ into one grapheme.
  while (start > 0 && points[start - 1] === '\u200d') {
    start -= 1;
    while (start > 0 && isExtend(points[start - 1]!)) start -= 1;
    if (start > 0) start -= 1;
  }
  return start;
}

/**
 * Remove exactly one user-perceived character from the end of a title.
 *
 * Never use `slice(0, -1)` in a fitting loop: JavaScript indexes UTF-16 code
 * units, so that can leave half an emoji or detach an accent from its letter.
 * Front-cover shortening goes through this one boundary rule.
 */
export function withoutLastGrapheme(value: string): string {
  if (value.length === 0) return value;
  if (TITLE_GRAPHEME_SEGMENTER !== null) {
    let lastStart = 0;
    for (const segment of TITLE_GRAPHEME_SEGMENTER.segment(value)) lastStart = segment.index;
    return value.slice(0, lastStart);
  }
  const points = Array.from(value);
  return points.slice(0, fallbackLastGraphemeStart(points)).join('');
}

/* ------------------------------ studio vocab ------------------------------ */

/**
 * Binding materials (library-themes §4).
 *
 * These used to be seven simulated grains — pebbled leather, buckram weave,
 * vellum follicles — each a few thousand brush stamps deep. The flat spine
 * does not simulate a surface, so on the shelf a material now shows up in the
 * *silhouette and dressing* rather than in the texture: which bindings get
 * cords, how round the back is, how likely gilt is. The vocabulary is kept
 * whole because it is persisted per book and drives the Book Studio.
 */
export const BINDING_MATERIALS = [
  'leather',
  'cloth',
  'paper',
  'vellum',
  'linen',
  'silk',
  'marbled',
] as const;
export type BindingMaterial = (typeof BINDING_MATERIALS)[number];

/**
 * Sub-treatments *within* a material, rolled from the seed rather than chosen
 * in the studio: rather than inflate the studio's material picker to a dozen
 * entries, each material carries two or three grains and the seed picks one.
 * The flat spine does not draw a grain, but the distinction is persisted and
 * still shifts the silhouette:
 *
 * - leather: `0` smooth calf · `1` pebbled morocco · `2` crackled (craquelure)
 * - cloth:   `0` flat buckram · `1` ribbed (rep) cloth · `2` pyroxylin sheen
 * - paper:   `0` laid · `1` coated/glazed · `2` kraft
 * - vellum:  `0` pale skin · `1` tanned skin
 * - linen:   `0` coarse · `1` fine
 * - silk:    `0` satin · `1` watered/moiré
 * - marbled: `0` combed · `1` Spanish wave · `2` stone/shell
 */
export const MAX_BOARD_STYLE = 2;

/**
 * Words for what a binding FEELS like, so a picker can be steered.
 *
 * The same shape as `shelfDesign.BUILD_TAGS` and read by the same structural
 * `tagsOf` in `views/rail/designOptions.ts` — a spec is tagged if it carries a
 * `tags` array, and nothing imports anything to find that out. The list
 * deliberately overlaps the carpentry's words (`plain`, `ornate`, `antique`,
 * `cosy`…) so one "in the mood for" row can steer the case, the wall AND the
 * book instead of three disjoint rows of chips.
 */
export type SpineTag =
  | 'plain'
  | 'formal'
  | 'refined'
  | 'ornate'
  | 'fancy'
  | 'whimsical'
  | 'cosy'
  | 'rustic'
  | 'natural'
  | 'antique'
  | 'modern'
  | 'severe'
  | 'airy'
  | 'heavy'
  | 'utilitarian'
  | 'gilded'
  | 'dark'
  | 'pale'
  | 'warm'
  | 'cool'
  | 'bright'
  | 'muted'
  | 'botanical'
  | 'celestial'
  | 'nautical'
  | 'heraldic'
  | 'scholarly'
  | 'romantic';

/** Every mood word the binding vocabularies use, in picker order. */
export const SPINE_TAGS: readonly SpineTag[] = [
  'plain',
  'formal',
  'refined',
  'ornate',
  'fancy',
  'whimsical',
  'cosy',
  'rustic',
  'natural',
  'antique',
  'modern',
  'severe',
  'airy',
  'heavy',
  'utilitarian',
  'gilded',
  'dark',
  'pale',
  'warm',
  'cool',
  'bright',
  'muted',
  'botanical',
  'celestial',
  'nautical',
  'heraldic',
  'scholarly',
  'romantic',
];

/**
 * Front-cover title treatments.
 *
 * Fifty lettering-piece treatments, from "nothing at all" through paper slips,
 * sunk morocco labels, ruled boxes, roundels and gilt cartouches. The first
 * four ids are the originals and are pinned in that order: they are persisted
 * per book in `cover_meta.style`, and renaming one would silently redress
 * every book that already wears it. `none` stays first because it is the
 * commonest answer and because `PLATE_WEIGHTS` and the studio's picker both
 * lead with it.
 *
 * Spines deliberately carry no names or lettering pieces. These ids remain
 * persisted because the front cover still gives its title a composed ground,
 * frame and lettering treatment.
 */
export const TITLE_PLATES = [
  'none',
  'gilt',
  'label',
  'debossed',
  'morocco-label',
  'double-fillet',
  'triple-fillet',
  'blind-panel',
  'gilt-cartouche',
  'paper-slip',
  'ruled-box',
  'roundel',
  'lozenge-plate',
  'shield-plate',
  'scroll-plate',
  'stone-tablet',
  'oval-medallion',
  'bead-frame',
  'rope-frame',
  'dotted-rule',
  'corner-brackets',
  'notched-corners',
  'scallop-edge',
  'sunk-panel',
  'leather-onlay',
  'inlay-strip',
  'vellum-slip',
  'linen-tag',
  'gilt-band',
  'twin-rules',
  'ribbon-band',
  'blind-lettered',
  'gilt-direct',
  'ink-panel',
  'ivory-plate',
  'ebony-plate',
  'copper-plate',
  'enamel-plate',
  'crest-plate',
  'arched-plate',
  'pedimented',
  'chamfered-plate',
  'stepped-frame',
  'hatched-ground',
  'stippled-ground',
  'wreathed-plate',
  'starred-ends',
  'fleuron-ends',
  'lozenge-ends',
  'gothic-panel',
] as const;
export type TitlePlateStyle = (typeof TITLE_PLATES)[number];

/**
 * Text-block edge treatments (the sliver of pages visible at the joint).
 *
 * Fifty, and the first four are the originals in their original order for the
 * same persistence reason as the plates. The rest are the real vocabulary a
 * finisher works in: sprinkled and stained edges, the six named marblings,
 * gauffering, a painted fore-edge, rough-cut and deckle blocks, top-gilt only,
 * and the two that are not decoration at all — `foxed` and `well-thumbed`.
 *
 * `EDGE_SPECS` carries what each one draws. The spine itself never paints the
 * text block (the binding in `art/bookDesign.ts` owns the body), so the specs
 * exist for `art/covers.ts`, which paints the fore-edge sliver on the pull-out
 * board — see `edgeSpec`.
 */
export const EDGE_TREATMENTS = [
  'plain',
  'gilt',
  'marbled',
  'speckled',
  'sprinkled',
  'stained-red',
  'stained-blue',
  'stained-green',
  'yellow-edges',
  'top-gilt',
  'fore-edge-gilt',
  'all-edges-gilt',
  'gauffered',
  'rough-cut',
  'deckle',
  'uncut',
  'burnished',
  'antique-gilt',
  'red-under-gold',
  'stippled',
  'agate',
  'comb-marbled',
  'spanish-wave',
  'stone-marbled',
  'shell-marbled',
  'nonpareil',
  'peacock-marbled',
  'painted-fore-edge',
  'landscape-edge',
  'mottled',
  'tree-calf-edge',
  'spattered',
  'dusted',
  'charcoal-edge',
  'ink-edge',
  'sepia-edge',
  'tea-stained',
  'saffron-edge',
  'rose-edge',
  'sea-green-edge',
  'violet-edge',
  'two-tone',
  'banded',
  'striped',
  'chequered',
  'silvered',
  'copper-edge',
  'verdigris-edge',
  'foxed',
  'well-thumbed',
] as const;
export type EdgeTreatment = (typeof EDGE_TREATMENTS)[number];

/** Maximum manual raised cords; four equal stations turn a back into a ladder. */
export const MAX_RAISED_BANDS = 3;

/** Woven/sewn endbands which remain legible as construction at shelf size. */
export const ACTIVE_HEAD_TAIL_STYLES = [1, 2, 3] as const;
export const ACTIVE_HEAD_TAIL_OPTIONS = [
  { index: 1, label: 'woven chevron' },
  { index: 2, label: 'wrapped cord' },
  { index: 3, label: 'solid silk roll' },
] as const;

/** Unknown historical teeth become the continuous woven chevron. */
export function normalizeHeadTailStyle(value: unknown): (typeof ACTIVE_HEAD_TAIL_STYLES)[number] {
  return typeof value === 'number' && ACTIVE_HEAD_TAIL_STYLES.includes(value as 1 | 2 | 3)
    ? value as 1 | 2 | 3
    : 1;
}

/**
 * Legal spine height range in world px. Widened at both ends from the old
 * 150–290: the reference's skyline swings 20–30% between neighbours, and a
 * band that narrow could not express it.
 */
export const SPINE_HEIGHT_RANGE = { min: 132, max: 300 } as const;

/**
 * Legal spine thickness range in world px.
 *
 * The old floor of 20 was the single loudest "machine-made" tell on the shelf:
 * the reference has slivers you could lose a fingernail in sitting right next
 * to tomes four times their width. 8 → 58 gives that ratio. Anything relying
 * on a minimum drawable spine should clamp on its own side.
 */
export const SPINE_THICKNESS_RANGE = { min: 8, max: 58 } as const;

/**
 * Book formats, the bibliographic sizes a real shelf mixes: a folio towers
 * over a pocket duodecimo. Heights are in world px and always inside
 * SPINE_HEIGHT_RANGE. The studio's height slider overrides them outright.
 */
export const SPINE_FORMATS = {
  folio: { min: 268, max: 300, label: 'Folio' },
  quarto: { min: 238, max: 272, label: 'Quarto' },
  octavo: { min: 204, max: 244, label: 'Octavo' },
  duodecimo: { min: 170, max: 212, label: 'Duodecimo' },
  pocket: { min: 134, max: 178, label: 'Pocket' },
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
  marbled: 'Marbled boards',
};

/**
 * Display names for the binder's-brass stamps, index-aligned with
 * `drawOrnament`.
 *
 * The first twelve are the originals and keep their indices: `ornament` is
 * persisted per book, so shifting one would restamp somebody's book with a
 * different tool. Everything from 12 up is the binder's own brass: fleurons,
 * natural-history marks, learning tools and small heraldic emblems. New tools
 * are append-only: inserting one would restamp an existing library.
 *
 * Every one of them is vetted at true size. A stamp is struck at roughly a
 * third of the spine's width — 20–60 world px on an ordinary octavo, less on a
 * pamphlet — so anything that needs interior detail to be recognisable has no
 * business here. The rule the whole table follows: ONE silhouette, filled or
 * stroked in a single ink, plus at most two accents.
 */
export const ORNAMENT_LABELS: readonly string[] = [
  'Diamond',
  'Broad laurel branch',
  'Foliate starflower',
  'Acanthus arabesque',
  'Chevron',
  'Rising sun',
  'Moon',
  'Keyhole',
  'Laurel wreath',
  'Quill',
  'Tree',
  'Crescent & stars',
  'Fleuron',
  'Oak and acorn spray',
  'Thistle bloom',
  'Anchor',
  'Key',
  'Compass rose',
  'Bee',
  'Scallop shell',
  'Crown',
  'Lyre',
  'Hourglass',
  'Stemmed rosette',
  'Trefoil',
  'Quatrefoil',
  'Fleur-de-lis',
  'Paired ivy leaves',
  'Acanthus volutes',
  'Wheat sheaf',
  'Split pomegranate',
  'Open tulip',
  'Heraldic rose',
  'Comet',
  'Lantern',
  'Inkpot',
  'Open book',
  'Spectacles',
  'Pine cone and needle fans',
  'Beehive',
  'Butterfly',
  'Swallow',
  'Fish',
  'Five-leaf anthemion',
  'Bell',
  'Little ship',
  'Mountain',
  'Wave',
  'Snowflake',
  'Heart',
  'Owl',
  'Stag',
  'Fox',
  'Cat',
  'Hare',
  'Moth',
  'Split fern palmette',
  'Paired ginkgo fans',
  'Mushroom',
  'Telescope',
  'Globe',
  'Classical column',
  'Torch',
  'Balance scales',
  'Castle',
  'Lamp of learning',
  'Acanthus spear',
  'Carnation bloom',
  'Iris fan',
  'Artichoke finial',
  'Poppy seedhead',
  'Olive spray',
  'Strawberry sprig',
  'Vine cluster',
  'Honeysuckle scroll',
  'Lotus palmette',
  'Maple samara spray',
  'Willow catkin',
  'Rowan spray',
  'Columbine bell',
  'Primrose stem',
  'Dog-rose branch',
  'Cedar cone spray',
  'Reed bundle',
  'Moresque knot',
  'Tudor rose standard',
];

/** Number of ornament stamps (a book may also have none). */
export const ORNAMENT_COUNT = ORNAMENT_LABELS.length;

/**
 * The binder's tools offered by the Studio and used by every automatic draw.
 *
 * `ORNAMENT_LABELS` remains index-addressed so old JSON can be read, but it is
 * not a product catalogue. This is. A persisted retired index is translated
 * through `normalizeOrnamentIndex` before it reaches either face of the book;
 * no hidden legacy symbol can therefore leak back through a seed, a theme, or
 * a cover-only compatibility row.
 *
 * The final refutation removed four more attractive-at-detail tools which did
 * not survive the 30px shelf: acanthus 3, ivy 27, pine cone 38 and ginkgo 57.
 * Their persisted indices normalize to the closest clean broad tool below.
 */
export const ACTIVE_ORNAMENT_INDICES = [
  0, 1, 2, 5, 12, 13, 14, 20,
  23, 26, 28, 29, 30, 31, 43, 56,
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
  76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
] as const;

export interface ActiveOrnamentOption {
  readonly index: (typeof ACTIVE_ORNAMENT_INDICES)[number];
  readonly label: string;
}

/** One authoritative reader-facing ornament catalogue. */
export const ACTIVE_ORNAMENTS: readonly ActiveOrnamentOption[] =
  ACTIVE_ORNAMENT_INDICES.map((index) => ({
    index,
    label: ORNAMENT_LABELS[index] ?? `Binder's tool ${index + 1}`,
  }));

const ACTIVE_ORNAMENT_SET: ReadonlySet<number> = new Set(ACTIVE_ORNAMENT_INDICES);

/** The semantic binder-tool programme shared by the narrow spine renderer. */
const ACTIVE_ORNAMENT_GLYPHS: Readonly<Record<(typeof ACTIVE_ORNAMENT_INDICES)[number], BroadFocalGlyph>> = {
  0: 'shield',
  1: 'laurel',
  2: 'starflower',
  5: 'sunrise',
  12: 'fleuron',
  13: 'oak-spray',
  14: 'thistle',
  20: 'crown',
  23: 'rosette',
  26: 'fleur-de-lis',
  28: 'oak-volutes',
  29: 'wheat-saltire',
  30: 'pomegranate',
  31: 'tulip',
  43: 'palmette',
  56: 'fern-palmette',
  66: 'acanthus-spear',
  67: 'carnation',
  68: 'iris-fan',
  69: 'artichoke',
  70: 'poppy-seedhead',
  71: 'olive-spray',
  72: 'strawberry-sprig',
  73: 'vine-cluster',
  74: 'honeysuckle-scroll',
  75: 'lotus-palmette',
  76: 'maple-samara',
  77: 'willow-catkin',
  78: 'rowan-spray',
  79: 'columbine-bell',
  80: 'primrose-stem',
  81: 'dog-rose',
  82: 'cedar-cone',
  83: 'reed-bundle',
  84: 'moresque-knot',
  85: 'tudor-rose',
};

/** Total semantic lookup for the active catalogue; retired values normalise first. */
export function ornamentGlyph(value: unknown): BroadFocalGlyph | null {
  const index = normalizeOrnamentIndex(value);
  return index === -1
    ? null
    : ACTIVE_ORNAMENT_GLYPHS[index as (typeof ACTIVE_ORNAMENT_INDICES)[number]] ?? null;
}

/** Semantic replacements for every historical stamp that left the catalogue. */
const RETIRED_ORNAMENT_REPLACEMENTS: Readonly<Record<number, number>> = {
  3: 12,  // acanthus companion collapsed to a Y/horseshoe -> open fleuron
  4: 0,   // chevron -> lozenge
  7: 12,  // keyhole -> fleuron
  8: 1,   // laurel wreath closes into a ring at shelf scale -> open laurel branch
  9: 12,  // quill scratch -> fleuron
  10: 13, // tree -> acorn
  6: 12,  // moon pictogram -> one-piece fleuron
  11: 12, // crescent-and-stars cluster -> one-piece fleuron
  15: 0,  // anchor -> geometric lozenge
  16: 0,  // key -> lozenge
  17: 0,  // compass pictogram -> geometric lozenge
  18: 23, // bee/insect -> rosette
  19: 12, // scallop/umbrella silhouette -> one-piece fleuron
  21: 23, // lyre -> rosette
  22: 0,  // hourglass -> lozenge
  24: 12, // three-dot trefoil -> fleuron
  25: 23, // four-dot quatrefoil -> rosette
  27: 1,  // ivy companion became twin flowers/hardware -> open laurel branch
  32: 23, // dot-cluster rose -> rosette
  33: 2,  // comet -> star
  34: 0,  // lantern hardware -> lozenge
  35: 0,  // inkpot hardware -> lozenge
  36: 12, // open-book pictogram -> fleuron
  37: 0,  // spectacles/rings -> lozenge
  38: 13, // pine-cone companion became a bug/lamp -> oak-and-acorn spray
  39: 23, // beehive -> rosette
  40: 12, // butterfly -> fleuron
  41: 12, // swallow -> fleuron
  42: 12, // fish -> fleuron
  44: 20, // bell -> crown
  45: 0,  // ship -> geometric lozenge
  46: 0,  // mountain -> lozenge
  47: 12, // wave -> fleuron
  48: 23, // snowflake -> binder's rosette
  49: 23, // heart -> rosette
  50: 0,  // owl -> lozenge
  51: 20, // stag -> crown
  52: 13, // fox -> acorn
  53: 12, // cat -> fleuron
  54: 13, // hare -> acorn
  55: 12, // moth -> fleuron
  57: 31, // paired ginkgo companion became a Y-sprout -> open tulip
  58: 13, // mushroom -> acorn
  59: 0,  // telescope -> geometric lozenge
  60: 0,  // globe -> geometric lozenge
  61: 0,  // column/goblet hardware -> lozenge
  62: 20, // torch hardware -> crown
  63: 0,  // scales -> lozenge
  64: 20, // castle -> crown
  65: 0,  // lamp hardware -> lozenge
};

export function isActiveOrnamentIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && ACTIVE_ORNAMENT_SET.has(value);
}

/**
 * Hard-normalise a stored or generated stamp into the active binder's case.
 * `-1` is the explicit bare-binding choice and remains bare.
 */
export function normalizeOrnamentIndex(value: unknown, fallback = 12): number {
  if (value === -1) return -1;
  if (isActiveOrnamentIndex(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value)) {
    const replacement = RETIRED_ORNAMENT_REPLACEMENTS[value];
    if (replacement !== undefined && ACTIVE_ORNAMENT_SET.has(replacement)) return replacement;
  }
  return ACTIVE_ORNAMENT_SET.has(fallback) ? fallback : ACTIVE_ORNAMENT_INDICES[0];
}

/** What each stamp feels like, index-aligned with ORNAMENT_LABELS. */
export const ORNAMENT_TAGS: readonly (readonly SpineTag[])[] = [
  ['plain', 'formal', 'severe'], // 0  diamond
  ['botanical', 'refined', 'antique'], // 1  laurel spray
  ['celestial', 'bright', 'plain'], // 2  star
  ['ornate', 'formal', 'antique'], // 3  arabesque
  ['modern', 'plain', 'utilitarian'], // 4  chevron
  ['celestial', 'bright', 'ornate'], // 5  sun
  ['celestial', 'romantic', 'cool'], // 6  moon
  ['antique', 'scholarly', 'plain'], // 7  keyhole
  ['botanical', 'formal', 'heraldic'], // 8  laurel wreath
  ['scholarly', 'antique', 'refined'], // 9  quill
  ['botanical', 'natural', 'cosy'], // 10 tree
  ['celestial', 'romantic', 'ornate'], // 11 crescent & stars
  ['ornate', 'antique', 'refined'], // 12 fleuron
  ['botanical', 'natural', 'cosy'], // 13 acorn
  ['botanical', 'rustic', 'heraldic'], // 14 thistle
  ['nautical', 'heavy', 'utilitarian'], // 15 anchor
  ['antique', 'scholarly', 'whimsical'], // 16 key
  ['nautical', 'formal', 'celestial'], // 17 compass rose
  ['whimsical', 'natural', 'bright'], // 18 bee
  ['nautical', 'natural', 'refined'], // 19 scallop shell
  ['heraldic', 'formal', 'gilded'], // 20 crown
  ['refined', 'romantic', 'antique'], // 21 lyre
  ['scholarly', 'severe', 'antique'], // 22 hourglass
  ['ornate', 'formal', 'fancy'], // 23 rosette
  ['heraldic', 'plain', 'refined'], // 24 trefoil
  ['heraldic', 'ornate', 'formal'], // 25 quatrefoil
  ['heraldic', 'formal', 'fancy'], // 26 fleur-de-lis
  ['botanical', 'natural', 'romantic'], // 27 ivy leaf
  ['botanical', 'rustic', 'natural'], // 28 oak leaf
  ['botanical', 'rustic', 'warm'], // 29 wheatsheaf
  ['botanical', 'ornate', 'warm'], // 30 pomegranate
  ['botanical', 'romantic', 'bright'], // 31 tulip
  ['heraldic', 'romantic', 'formal'], // 32 heraldic rose
  ['celestial', 'whimsical', 'bright'], // 33 comet
  ['cosy', 'antique', 'warm'], // 34 lantern
  ['scholarly', 'antique', 'utilitarian'], // 35 inkpot
  ['scholarly', 'plain', 'formal'], // 36 open book
  ['scholarly', 'whimsical', 'antique'], // 37 spectacles
  ['botanical', 'natural', 'cosy'], // 38 pine cone
  ['rustic', 'natural', 'cosy'], // 39 beehive
  ['whimsical', 'romantic', 'airy'], // 40 butterfly
  ['natural', 'airy', 'romantic'], // 41 swallow
  ['nautical', 'natural', 'whimsical'], // 42 fish
  ['ornate', 'refined', 'formal'], // 43 anthemion
  ['formal', 'antique', 'heavy'], // 44 bell
  ['nautical', 'whimsical', 'cosy'], // 45 little ship
  ['natural', 'severe', 'cool'], // 46 mountain
  ['nautical', 'natural', 'cool'], // 47 wave
  ['celestial', 'cool', 'refined'], // 48 snowflake
  ['romantic', 'whimsical', 'warm'], // 49 heart
  ['scholarly', 'natural', 'antique'], // 50 owl
  ['heraldic', 'natural', 'formal'], // 51 stag
  ['natural', 'whimsical', 'rustic'], // 52 fox
  ['cosy', 'whimsical', 'natural'], // 53 cat
  ['natural', 'airy', 'whimsical'], // 54 hare
  ['natural', 'romantic', 'antique'], // 55 moth
  ['botanical', 'natural', 'refined'], // 56 fern frond
  ['botanical', 'airy', 'refined'], // 57 ginkgo leaf
  ['botanical', 'cosy', 'whimsical'], // 58 mushroom
  ['scholarly', 'celestial', 'antique'], // 59 telescope
  ['scholarly', 'formal', 'modern'], // 60 globe
  ['formal', 'antique', 'severe'], // 61 classical column
  ['scholarly', 'heraldic', 'bright'], // 62 torch
  ['formal', 'scholarly', 'severe'], // 63 balance scales
  ['heraldic', 'antique', 'heavy'], // 64 castle
  ['scholarly', 'cosy', 'antique'], // 65 lamp of learning
  ['botanical', 'ornate', 'antique'], // 66 acanthus spear
  ['botanical', 'romantic', 'refined'], // 67 carnation bloom
  ['botanical', 'formal', 'airy'], // 68 iris fan
  ['botanical', 'heavy', 'antique'], // 69 artichoke finial
  ['botanical', 'scholarly', 'severe'], // 70 poppy seedhead
  ['botanical', 'refined', 'formal'], // 71 olive spray
  ['botanical', 'cosy', 'romantic'], // 72 strawberry sprig
  ['botanical', 'warm', 'ornate'], // 73 vine cluster
  ['botanical', 'romantic', 'airy'], // 74 honeysuckle scroll
  ['botanical', 'formal', 'refined'], // 75 lotus palmette
  ['botanical', 'natural', 'airy'], // 76 maple samara spray
  ['botanical', 'natural', 'muted'], // 77 willow catkin
  ['botanical', 'bright', 'rustic'], // 78 rowan spray
  ['botanical', 'romantic', 'whimsical'], // 79 columbine bell
  ['botanical', 'bright', 'plain'], // 80 primrose stem
  ['botanical', 'romantic', 'antique'], // 81 dog-rose branch
  ['botanical', 'natural', 'heavy'], // 82 cedar cone spray
  ['botanical', 'scholarly', 'severe'], // 83 reed bundle
  ['ornate', 'formal', 'antique'], // 84 moresque knot
  ['botanical', 'heraldic', 'formal'], // 85 Tudor rose standard
];

/* ----------------------- front-cover title metadata ---------------------- */

/** The ground a plate is filled with. `none` sets the title on bare covering. */
type PlateGround =
  | 'none'
  | 'cream'
  | 'creamDeep'
  | 'gilt'
  | 'giltPale'
  | 'ink'
  | 'timber'
  | 'terracotta'
  | 'slate'
  | 'moss'
  | 'plum';

/** The front-cover title field's silhouette. */
type PlateShape =
  | 'rect'
  | 'capsule'
  | 'oval'
  | 'lozenge'
  | 'shield'
  | 'scroll'
  | 'octagon'
  | 'arch'
  | 'stepped'
  | 'pediment';

/**
 * How the plate meets the covering it is laid on — the app's depth model,
 * applied to a label.
 *
 * `proud` puts a darker flat face under the plate, offset a hair down and
 * across: the same "this sits on that" `contactShadow` states for an object on
 * a shelf, cut to the plate's own silhouette because a label is a rectangle
 * rather than a ball. `sunk` puts that face INSIDE the silhouette instead, at
 * the head and the hinge side, which is what a compartment dropped below the
 * covering looks like when you have no light model to sink it with. `flush`
 * is for the treatments that are genuinely level with the covering — an inlaid
 * strip, a band wrapped round the spine, ink laid straight on.
 *
 * Every plate with a ground used to be `flush` by omission, and that is most of
 * why fifty labels read as fifty stickers.
 */
type PlateSeat = 'proud' | 'flush' | 'sunk';

/**
 * The small hardware struck at a plate's corners or ends.
 *
 * Four marks, and each one exists because a blurb already promised it and the
 * drawing did not deliver: the copper plate is "pinned at the corners", the
 * linen tag is "stitched down at both ends", the paper slip has "corners
 * already lifting", the vellum slip is "cut a shade proud of its panel".
 */
type PlateStud = 'none' | 'pins' | 'stitches' | 'lift' | 'proud-cut';

/** Rules and beading struck around the plate. */
type PlateFrame =
  | 'none'
  | 'single'
  | 'double'
  | 'triple'
  | 'dotted'
  | 'bead'
  | 'rope'
  | 'scallop'
  | 'brackets'
  | 'notched'
  | 'wreath'
  | 'gothic';

/** The marks that close the lettering off, head and tail. */
type PlateEnds =
  | 'none'
  | 'rule'
  | 'double-rule'
  | 'dots'
  | 'lozenge'
  | 'star'
  | 'fleuron'
  | 'bracket';

/** Which ink a plate's frame, ground pattern and lettering are struck in. */
type PlateInk = 'gilt' | 'ink' | 'soft' | 'cream' | 'auto';

/** A ground texture struck INTO the plate, under the lettering. */
type PlateGrain = 'none' | 'hatch' | 'stipple' | 'rule';

/** Metadata behind one front-cover title treatment. */
interface TitlePlateSpec {
  id: TitlePlateStyle;
  label: string;
  /** One line for the studio card. */
  blurb: string;
  tags: readonly SpineTag[];
  ground: PlateGround;
  shape: PlateShape;
  frame: PlateFrame;
  frameInk: PlateInk;
  ends: PlateEnds;
  /** Lettering colour. `auto` = gilt on a gilded book, soft ink otherwise. */
  letter: PlateInk;
  grain: PlateGrain;
  /** Outline weight multiplier on the plate itself; 0 draws no outline. */
  outline: number;
  /** Corner radius as a fraction of the plate's width. */
  radius: number;
  /**
   * How the plate sits on the covering. Absent means "proud if it has a
   * ground, flush if it has none" — the answer for four plates in five, so
   * only the exceptions are written down.
   */
  seat?: PlateSeat;
  /** Corner hardware. Absent means none. */
  stud?: PlateStud;
}

function plate(
  id: TitlePlateStyle,
  label: string,
  blurb: string,
  tags: readonly SpineTag[],
  spec: Omit<TitlePlateSpec, 'id' | 'label' | 'blurb' | 'tags'>,
): TitlePlateSpec {
  return { id, label, blurb, tags, ...spec };
}

/**
 * The fifty front-cover title treatments, keyed by id.
 *
 * Composed rather than drawn: a plate is (ground × silhouette × frame × ends ×
 * grain × lettering ink), and every one of those pieces was drawn once and
 * checked at 24 world px. That is what makes fifty of them worth having — each
 * entry is a composition somebody chose, not a number somebody incremented,
 * and no two share all six slots.
 */
const COVER_TITLE_TREATMENT_SPECS: Readonly<Record<TitlePlateStyle, TitlePlateSpec>> = {
  /* ---- nothing, and the three originals ---- */

  none: plate('none', 'None', 'The title struck straight onto the covering, and nothing else.',
    ['plain', 'utilitarian', 'severe'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'auto', ends: 'none',
      letter: 'auto', grain: 'none', outline: 0, radius: 0.18 }),

  gilt: plate('gilt', 'Gilt panel', 'A panel of foil with the title reserved out of it.',
    ['gilded', 'formal', 'fancy'],
    { ground: 'gilt', shape: 'rect', frame: 'single', frameInk: 'ink', ends: 'rule',
      letter: 'ink', grain: 'none', outline: 0.7, radius: 0.16 }),

  label: plate('label', 'Paper label', 'A slip of cream paper, pasted on and lettered by hand.',
    ['plain', 'cosy', 'antique'],
    { ground: 'cream', shape: 'rect', frame: 'none', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0.7, radius: 0.18 }),

  debossed: plate('debossed', 'Debossed', 'Struck into the covering with no colour in the depression.',
    ['severe', 'modern', 'plain'],
    { ground: 'none', shape: 'rect', frame: 'single', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0, radius: 0.12, seat: 'sunk' }),

  /* ---- sunk and laid-on labels ---- */

  'morocco-label': plate('morocco-label', 'Sunk morocco', 'A dark goatskin label let into the leather, lettered in gold.',
    ['formal', 'gilded', 'refined'],
    { ground: 'plum', shape: 'rect', frame: 'single', frameInk: 'gilt', ends: 'rule',
      letter: 'gilt', grain: 'none', outline: 1, radius: 0.14, seat: 'sunk' }),

  'leather-onlay': plate('leather-onlay', 'Leather onlay', 'A second skin pared thin and laid over the first.',
    ['ornate', 'warm', 'antique'],
    { ground: 'terracotta', shape: 'rect', frame: 'double', frameInk: 'gilt', ends: 'none',
      letter: 'cream', grain: 'none', outline: 1, radius: 0.2 }),

  'inlay-strip': plate('inlay-strip', 'Inlaid strip', 'A band of contrasting cloth inlaid flush with the covering.',
    ['modern', 'refined', 'plain'],
    { ground: 'slate', shape: 'rect', frame: 'none', frameInk: 'cream', ends: 'rule',
      letter: 'cream', grain: 'none', outline: 0.5, radius: 0.04, seat: 'flush' }),

  /*
   * The nine-plate cream cluster, and what was wrong with it.
   *
   * `shots-now/plate-signatures.mjs` renders every plate through `renderSpine`
   * and reduces the label band at the shelf's RESTING size — 34 world px baked
   * at 2 and drawn at zoom 0.8, so the whole plate is about 27 screen pixels
   * across and 10 down. At that size nine of these read as one plate:
   * `paper-slip`, `scroll-plate`, `rope-frame`, `notched-corners`,
   * `sunk-panel`, `vellum-slip`, `linen-tag`, `hatched-ground` and
   * `stippled-ground`. Every one of them was a `cream` or `creamDeep`
   * rectangle, and cream against creamDeep is one step of value; everything
   * that was supposed to tell them apart — a rope roll, a notch, a stitch, a
   * hatch, a stipple — is a sub-pixel mark at ten pixels tall.
   *
   * There are eleven grounds and this cluster was using two of them. So five of
   * the nine take a ground their own NAME already argues for: a woven tag is
   * not the colour of printed paper, a rope roll belongs on tan, a sunk panel
   * shows the covering it was cut into rather than a pale label. The frames and
   * grains stay exactly as they were — they are what the reader sees when the
   * book is pulled off the shelf, and this is only about which of them can be
   * told apart while it is still on it.
   */
  'vellum-slip': plate('vellum-slip', 'Vellum slip', 'A pale skin label, cut a shade proud of its panel.',
    ['pale', 'antique', 'refined'],
    { ground: 'creamDeep', shape: 'rect', frame: 'single', frameInk: 'soft', ends: 'none',
      letter: 'ink', grain: 'none', outline: 0.9, radius: 0.1, stud: 'proud-cut' }),

  'paper-slip': plate('paper-slip', 'Paper slip', 'A printed slip, corners already lifting.',
    ['plain', 'cosy', 'rustic'],
    { ground: 'cream', shape: 'rect', frame: 'dotted', frameInk: 'soft', ends: 'rule',
      letter: 'soft', grain: 'none', outline: 0.6, radius: 0.06, stud: 'lift' }),

  'linen-tag': plate('linen-tag', 'Linen tag', 'A woven tag stitched down at both ends.',
    ['rustic', 'natural', 'cosy'],
    { ground: 'timber', shape: 'rect', frame: 'notched', frameInk: 'soft', ends: 'dots',
      letter: 'soft', grain: 'rule', outline: 0.8, radius: 0.05, stud: 'stitches' }),

  'ivory-plate': plate('ivory-plate', 'Ivory plate', 'A pale tablet, cool against a dark binding.',
    ['pale', 'formal', 'refined'],
    { ground: 'cream', shape: 'octagon', frame: 'single', frameInk: 'ink', ends: 'lozenge',
      letter: 'ink', grain: 'none', outline: 1, radius: 0.1 }),

  'ebony-plate': plate('ebony-plate', 'Ebony plate', 'Near-black, with the letters cut back to gold.',
    ['dark', 'severe', 'gilded'],
    { ground: 'ink', shape: 'rect', frame: 'single', frameInk: 'gilt', ends: 'rule',
      letter: 'gilt', grain: 'none', outline: 0.6, radius: 0.08 }),

  'copper-plate': plate('copper-plate', 'Copper plate', 'A beaten metal plate pinned at the corners.',
    ['antique', 'heavy', 'warm'],
    { ground: 'timber', shape: 'rect', frame: 'bead', frameInk: 'ink', ends: 'dots',
      letter: 'ink', grain: 'hatch', outline: 1.1, radius: 0.06, stud: 'pins' }),

  'enamel-plate': plate('enamel-plate', 'Enamelled', 'A field of green enamel with a fine gold border.',
    ['ornate', 'fancy', 'cool'],
    { ground: 'moss', shape: 'capsule', frame: 'double', frameInk: 'gilt', ends: 'dots',
      letter: 'gilt', grain: 'none', outline: 0.8, radius: 0.5 }),

  /* ---- ruled and filleted panels, no label at all ---- */

  'double-fillet': plate('double-fillet', 'Double fillet', 'Two gold lines run round the panel and nothing more.',
    ['formal', 'gilded', 'plain'],
    { ground: 'none', shape: 'rect', frame: 'double', frameInk: 'gilt', ends: 'none',
      letter: 'gilt', grain: 'none', outline: 0, radius: 0.1 }),

  'triple-fillet': plate('triple-fillet', 'Triple fillet', 'Three rules, the middle one heavier than its neighbours.',
    ['formal', 'ornate', 'gilded'],
    { ground: 'none', shape: 'rect', frame: 'triple', frameInk: 'gilt', ends: 'rule',
      letter: 'gilt', grain: 'none', outline: 0, radius: 0.08 }),

  'blind-panel': plate('blind-panel', 'Blind panel', 'Tooled without foil — you read it by the shadow in the leather.',
    ['severe', 'antique', 'muted'],
    { ground: 'none', shape: 'rect', frame: 'double', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0, radius: 0.1, seat: 'sunk' }),

  'ruled-box': plate('ruled-box', 'Ruled box', 'A plain box in ink, the way a clerk would rule it.',
    ['plain', 'utilitarian', 'scholarly'],
    { ground: 'none', shape: 'rect', frame: 'single', frameInk: 'ink', ends: 'rule',
      letter: 'ink', grain: 'none', outline: 0, radius: 0.02 }),

  'twin-rules': plate('twin-rules', 'Twin rules', 'One rule above the title, one below, and open sides.',
    ['plain', 'modern', 'airy'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'gilt', ends: 'double-rule',
      letter: 'auto', grain: 'none', outline: 0, radius: 0 }),

  'dotted-rule': plate('dotted-rule', 'Dotted rule', 'A border of small round tools, struck one at a time.',
    ['refined', 'antique', 'ornate'],
    { ground: 'none', shape: 'rect', frame: 'dotted', frameInk: 'gilt', ends: 'dots',
      letter: 'auto', grain: 'none', outline: 0, radius: 0.1 }),

  'corner-brackets': plate('corner-brackets', 'Corner brackets', 'Four right angles that suggest a box without closing one.',
    ['modern', 'refined', 'airy'],
    { ground: 'none', shape: 'rect', frame: 'brackets', frameInk: 'gilt', ends: 'none',
      letter: 'auto', grain: 'none', outline: 0, radius: 0.04 }),

  'sunk-panel': plate('sunk-panel', 'Sunk panel', 'The whole compartment dropped a hair below the covering.',
    ['severe', 'heavy', 'formal'],
    // Its own ground is the COVERING — that is what "sunk" means, and a slate
    // label pasted on top said the opposite while also looking like
    // `stone-tablet` and `inlay-strip`, the two other blue plates. `none` plus
    // `sunk` leaves the sunk seat to do the whole job, which is the one thing
    // in this table that reads as a compartment rather than as a label.
    { ground: 'none', shape: 'rect', frame: 'double', frameInk: 'ink', ends: 'rule',
      letter: 'ink', grain: 'none', outline: 1.2, radius: 0.06, seat: 'sunk' }),

  'chamfered-plate': plate('chamfered-plate', 'Chamfered', 'Every corner taken off with one stroke.',
    ['modern', 'plain', 'refined'],
    { ground: 'cream', shape: 'octagon', frame: 'none', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0.8, radius: 0.1 }),

  'stepped-frame': plate('stepped-frame', 'Stepped frame', 'A frame inside a frame, each step a little narrower.',
    ['ornate', 'formal', 'heavy'],
    { ground: 'creamDeep', shape: 'stepped', frame: 'double', frameInk: 'ink', ends: 'rule',
      letter: 'ink', grain: 'none', outline: 1, radius: 0.06 }),

  /* ---- shaped cartouches ---- */

  'gilt-cartouche': plate('gilt-cartouche', 'Gilt cartouche', 'A scrolled gold cartouche with the title inside it.',
    ['ornate', 'gilded', 'fancy'],
    { ground: 'giltPale', shape: 'scroll', frame: 'single', frameInk: 'ink', ends: 'fleuron',
      letter: 'ink', grain: 'none', outline: 0.9, radius: 0.24 }),

  roundel: plate('roundel', 'Roundel', 'A long capsule with the lettering running through it.',
    ['refined', 'modern', 'plain'],
    { ground: 'cream', shape: 'capsule', frame: 'none', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0.8, radius: 0.5 }),

  'oval-medallion': plate('oval-medallion', 'Oval medallion', 'A true oval, bordered with a fine bead.',
    ['ornate', 'romantic', 'refined'],
    { ground: 'creamDeep', shape: 'oval', frame: 'bead', frameInk: 'gilt', ends: 'none',
      letter: 'ink', grain: 'none', outline: 0.9, radius: 0.5 }),

  'lozenge-plate': plate('lozenge-plate', 'Lozenge', 'A long diamond, points to head and tail.',
    ['heraldic', 'formal', 'fancy'],
    { ground: 'cream', shape: 'lozenge', frame: 'none', frameInk: 'gilt', ends: 'none',
      letter: 'ink', grain: 'none', outline: 0.9, radius: 0.1 }),

  'shield-plate': plate('shield-plate', 'Shield', 'A little escutcheon, pointed at the tail.',
    ['heraldic', 'formal', 'antique'],
    { ground: 'terracotta', shape: 'shield', frame: 'single', frameInk: 'gilt', ends: 'none',
      letter: 'cream', grain: 'none', outline: 1, radius: 0.14 }),

  'scroll-plate': plate('scroll-plate', 'Scroll', 'A ribbon of paper with both ends curled under.',
    ['romantic', 'antique', 'whimsical'],
    { ground: 'cream', shape: 'scroll', frame: 'none', frameInk: 'soft', ends: 'rule',
      letter: 'soft', grain: 'none', outline: 0.9, radius: 0.2 }),

  'stone-tablet': plate('stone-tablet', 'Tablet', 'A slab with a square shoulder, lettered like an inscription.',
    ['severe', 'heavy', 'formal'],
    { ground: 'slate', shape: 'rect', frame: 'double', frameInk: 'cream', ends: 'rule',
      letter: 'cream', grain: 'none', outline: 1.2, radius: 0.03 }),

  'arched-plate': plate('arched-plate', 'Arched', 'A round-headed panel, like a window in a chapter house.',
    ['antique', 'formal', 'romantic'],
    { ground: 'creamDeep', shape: 'arch', frame: 'single', frameInk: 'ink', ends: 'none',
      letter: 'ink', grain: 'none', outline: 1, radius: 0.5 }),

  pedimented: plate('pedimented', 'Pedimented', 'A gable over the head of the panel.',
    ['formal', 'heavy', 'antique'],
    { ground: 'cream', shape: 'pediment', frame: 'double', frameInk: 'ink', ends: 'lozenge',
      letter: 'ink', grain: 'none', outline: 1.1, radius: 0.08 }),

  'gothic-panel': plate('gothic-panel', 'Gothic panel', 'A pointed arch with a cusp at each shoulder.',
    ['ornate', 'antique', 'formal'],
    { ground: 'plum', shape: 'arch', frame: 'gothic', frameInk: 'gilt', ends: 'none',
      letter: 'gilt', grain: 'none', outline: 1, radius: 0.5 }),

  'crest-plate': plate('crest-plate', 'Crested', 'A plate with a small crest struck above the lettering.',
    ['heraldic', 'ornate', 'gilded'],
    { ground: 'giltPale', shape: 'shield', frame: 'single', frameInk: 'ink', ends: 'star',
      letter: 'ink', grain: 'none', outline: 1, radius: 0.12 }),

  /* ---- borders with a character of their own ---- */

  'bead-frame': plate('bead-frame', 'Beaded', 'A row of beads all the way round, struck with one tool.',
    ['ornate', 'refined', 'antique'],
    { ground: 'giltPale', shape: 'rect', frame: 'bead', frameInk: 'ink', ends: 'none',
      letter: 'ink', grain: 'none', outline: 0.7, radius: 0.14 }),

  'rope-frame': plate('rope-frame', 'Roped', 'A twisted cable border — a binder’s rope roll.',
    ['nautical', 'ornate', 'rustic'],
    { ground: 'terracotta', shape: 'rect', frame: 'rope', frameInk: 'cream', ends: 'none',
      letter: 'cream', grain: 'none', outline: 0.7, radius: 0.16 }),

  'scallop-edge': plate('scallop-edge', 'Scalloped', 'The label cut with a scalloped edge, like a paper doily.',
    ['whimsical', 'romantic', 'fancy'],
    { ground: 'cream', shape: 'capsule', frame: 'scallop', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0.6, radius: 0.2 }),

  'notched-corners': plate('notched-corners', 'Notched', 'Corners nicked out, the way a ticket is punched.',
    ['modern', 'utilitarian', 'plain'],
    { ground: 'cream', shape: 'octagon', frame: 'notched', frameInk: 'ink', ends: 'none',
      letter: 'ink', grain: 'none', outline: 0.8, radius: 0.02 }),

  'wreathed-plate': plate('wreathed-plate', 'Wreathed', 'A ring of small leaves closing the panel top and bottom.',
    ['botanical', 'ornate', 'formal'],
    { ground: 'plum', shape: 'lozenge', frame: 'wreath', frameInk: 'gilt', ends: 'none',
      letter: 'gilt', grain: 'none', outline: 0.7, radius: 0.16 }),

  'gilt-band': plate('gilt-band', 'Gilt band', 'A broad gold band across the spine, edge to edge.',
    ['gilded', 'heavy', 'formal'],
    { ground: 'gilt', shape: 'rect', frame: 'none', frameInk: 'ink', ends: 'double-rule',
      letter: 'ink', grain: 'none', outline: 0, radius: 0, seat: 'flush' }),

  'ribbon-band': plate('ribbon-band', 'Ribbon band', 'A band of coloured cloth wrapped round the compartment.',
    ['cosy', 'whimsical', 'warm'],
    { ground: 'terracotta', shape: 'rect', frame: 'none', frameInk: 'cream', ends: 'double-rule',
      letter: 'cream', grain: 'none', outline: 0.6, radius: 0, seat: 'flush' }),

  'ink-panel': plate('ink-panel', 'Ink panel', 'A block of solid ink with the title left out of it.',
    ['dark', 'modern', 'severe'],
    { ground: 'ink', shape: 'rect', frame: 'none', frameInk: 'cream', ends: 'none',
      letter: 'cream', grain: 'none', outline: 0, radius: 0.08, seat: 'flush' }),

  /* ---- grounds and end marks ---- */

  'hatched-ground': plate('hatched-ground', 'Hatched ground', 'The panel cross-hatched so the letters sit proud of it.',
    ['ornate', 'antique', 'scholarly'],
    { ground: 'moss', shape: 'rect', frame: 'single', frameInk: 'cream', ends: 'none',
      letter: 'cream', grain: 'hatch', outline: 0.9, radius: 0.1 }),

  'stippled-ground': plate('stippled-ground', 'Stippled ground', 'A ground of fine dots, punched rather than ruled.',
    ['refined', 'antique', 'muted'],
    { ground: 'cream', shape: 'rect', frame: 'single', frameInk: 'soft', ends: 'none',
      letter: 'ink', grain: 'stipple', outline: 0.8, radius: 0.12 }),

  'starred-ends': plate('starred-ends', 'Starred ends', 'A small star closing the title at head and tail.',
    ['celestial', 'whimsical', 'gilded'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'gilt', ends: 'star',
      letter: 'gilt', grain: 'none', outline: 0, radius: 0 }),

  'fleuron-ends': plate('fleuron-ends', 'Fleuron ends', 'A printer’s leaf above and below the lettering.',
    ['botanical', 'ornate', 'refined'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'gilt', ends: 'fleuron',
      letter: 'auto', grain: 'none', outline: 0, radius: 0 }),

  'lozenge-ends': plate('lozenge-ends', 'Lozenge ends', 'One small diamond at each end of the run.',
    ['formal', 'plain', 'refined'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'gilt', ends: 'lozenge',
      letter: 'auto', grain: 'none', outline: 0, radius: 0 }),

  'blind-lettered': plate('blind-lettered', 'Blind lettered', 'No panel, no foil — the title pressed into the covering.',
    ['severe', 'muted', 'plain'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'soft', ends: 'none',
      letter: 'soft', grain: 'none', outline: 0, radius: 0, seat: 'sunk' }),

  'gilt-direct': plate('gilt-direct', 'Gilt direct', 'Gold laid straight onto the covering, no ground beneath it.',
    ['gilded', 'plain', 'formal'],
    { ground: 'none', shape: 'rect', frame: 'none', frameInk: 'gilt', ends: 'none',
      letter: 'gilt', grain: 'none', outline: 0, radius: 0 }),
};

/** Display names for the title-plate treatments. */
export const TITLE_PLATE_LABELS: Readonly<Record<TitlePlateStyle, string>> =
  Object.fromEntries(
    TITLE_PLATES.map((id) => [id, COVER_TITLE_TREATMENT_SPECS[id].label]),
  ) as Record<TitlePlateStyle, string>;

/**
 * Front-cover title furniture that survived the systemic reset.
 *
 * Every entry is a continuous title programme: direct lettering, a ruled or
 * filleted field, one coherent cartouche, or a structural shaped panel. Beads,
 * ropes, dots, scallops, wallpaper grounds, dangling slips and duplicate crest
 * stickers remain readable only so old rows can be translated below.
 */
export const ACTIVE_TITLE_PLATES = [
  'none',
  'gilt',
  'label',
  'debossed',
  'morocco-label',
  'double-fillet',
  'blind-panel',
  'gilt-cartouche',
  'ruled-box',
  'leather-onlay',
  'inlay-strip',
  'gilt-band',
  'twin-rules',
  'gilt-direct',
  'ink-panel',
] as const satisfies readonly TitlePlateStyle[];

export const ACTIVE_TITLE_PLATE_OPTIONS = ACTIVE_TITLE_PLATES.map((id) => ({
  id,
  label: TITLE_PLATE_LABELS[id],
}));

const ACTIVE_TITLE_PLATE_SET: ReadonlySet<string> = new Set(ACTIVE_TITLE_PLATES);

const RETIRED_TITLE_PLATE_REPLACEMENTS: Readonly<Partial<Record<TitlePlateStyle, TitlePlateStyle>>> = {
  'paper-slip': 'label',
  roundel: 'ruled-box',
  'scroll-plate': 'gilt-cartouche',
  'stone-tablet': 'blind-panel',
  'oval-medallion': 'ruled-box',
  'bead-frame': 'double-fillet',
  'rope-frame': 'double-fillet',
  'dotted-rule': 'ruled-box',
  'notched-corners': 'ruled-box',
  'scallop-edge': 'ruled-box',
  'vellum-slip': 'label',
  'linen-tag': 'label',
  'ribbon-band': 'gilt-band',
  'ivory-plate': 'label',
  'ebony-plate': 'ink-panel',
  'copper-plate': 'morocco-label',
  'enamel-plate': 'morocco-label',
  'crest-plate': 'gilt-cartouche',
  'hatched-ground': 'blind-panel',
  'stippled-ground': 'blind-panel',
  'wreathed-plate': 'gilt-cartouche',
  'starred-ends': 'gilt-cartouche',
  'triple-fillet': 'double-fillet',
  'lozenge-plate': 'ruled-box',
  'shield-plate': 'gilt-cartouche',
  'corner-brackets': 'ruled-box',
  'sunk-panel': 'blind-panel',
  'blind-lettered': 'debossed',
  'arched-plate': 'ruled-box',
  pedimented: 'ruled-box',
  'chamfered-plate': 'ruled-box',
  'stepped-frame': 'double-fillet',
  'fleuron-ends': 'gilt-cartouche',
  'lozenge-ends': 'ruled-box',
  'gothic-panel': 'morocco-label',
};

export function isActiveTitlePlateStyle(value: unknown): value is (typeof ACTIVE_TITLE_PLATES)[number] {
  return typeof value === 'string' && ACTIVE_TITLE_PLATE_SET.has(value);
}

/** Hard-normalise old title furniture into one active continuous treatment. */
export function normalizeTitlePlateStyle(value: unknown): (typeof ACTIVE_TITLE_PLATES)[number] {
  if (isActiveTitlePlateStyle(value)) return value;
  if (typeof value === 'string' && isTitlePlateStyle(value)) {
    const replacement = RETIRED_TITLE_PLATE_REPLACEMENTS[value];
    if (isActiveTitlePlateStyle(replacement)) return replacement;
  }
  return 'none';
}

/** Mood words for the title-plate treatments. */
export const TITLE_PLATE_TAGS: Readonly<Record<TitlePlateStyle, readonly SpineTag[]>> =
  Object.fromEntries(
    TITLE_PLATES.map((id) => [id, COVER_TITLE_TREATMENT_SPECS[id].tags]),
  ) as Record<TitlePlateStyle, readonly SpineTag[]>;

/* ------------------------------- edge specs ------------------------------- */

/**
 * The text block's own colour before anything is laid over it.
 *
 * `ink` is the only near-black, and it exists because without it the two
 * treatments that are supposed to be BLACK — `ink-edge` and `charcoal-edge` —
 * had to borrow `slate`, which made "Ink edges" a byte-for-byte duplicate of
 * "Blue edges". Two rows of a fifty-row picker that paint the same pixels are
 * worse than forty-nine rows.
 */
export type EdgeGround =
  | 'cream'
  | 'creamDeep'
  | 'gilt'
  | 'giltPale'
  | 'timber'
  | 'terracotta'
  | 'slate'
  | 'sage'
  | 'moss'
  | 'plum'
  | 'ochre'
  | 'ink';

/** The marks laid over the block. */
export type EdgePattern =
  | 'none'
  | 'fleck'
  | 'sprinkle'
  | 'comb'
  | 'wave'
  | 'stone'
  | 'shell'
  | 'band'
  | 'stripe'
  | 'cheque'
  | 'ripple'
  | 'scene'
  | 'hatch';

/** Which edges of the block carry foil. */
export type EdgeGild = 'none' | 'top' | 'fore' | 'all';

/** How the block was cut. */
export type EdgeCut = 'smooth' | 'rough' | 'deckle';

/** One text-block edge treatment. */
export interface EdgeSpec {
  id: EdgeTreatment;
  label: string;
  blurb: string;
  tags: readonly SpineTag[];
  ground: EdgeGround;
  pattern: EdgePattern;
  /** How busy the pattern is, 0 → 1. */
  density: number;
  /** Pattern colour. */
  mark: EdgeGround;
  /** Second pattern colour, for the two-colour marblings. */
  mark2: EdgeGround;
  gild: EdgeGild;
  cut: EdgeCut;
  /**
   * The metal the `gild` is laid in. Absent means gold.
   *
   * A slot rather than "reuse `mark`", because the three entries that are not
   * gold want their foil and their PATTERN in different colours: copper edges
   * are copper leaf flecked green in the hollows, so `mark` is the verdigris
   * and the foil is the metal. Without this, "Silvered" — a treatment whose
   * entire idea is white metal — came out of the drawer wearing a gold band.
   */
  foil?: EdgeGround;
}

function edge(
  id: EdgeTreatment,
  label: string,
  blurb: string,
  tags: readonly SpineTag[],
  spec: Omit<EdgeSpec, 'id' | 'label' | 'blurb' | 'tags'>,
): EdgeSpec {
  return { id, label, blurb, tags, ...spec };
}

/**
 * The fifty text-block edges, keyed by id.
 *
 * Only a two-or-three-px sliver of this is ever visible beside the boards, so
 * every entry is judged on ONE question: does it change the colour or the
 * rhythm of that sliver? `plain` and `burnished` differ by a shade of cream and
 * that is enough; `agate` and `stone-marbled` differ by which two colours comb
 * through each other. Anything whose difference lives in the middle of the
 * block — where no one can see it — is not in the table.
 */
export const EDGE_SPECS: Readonly<Record<EdgeTreatment, EdgeSpec>> = {
  plain: edge('plain', 'Plain', 'Cut smooth and left alone.',
    ['plain', 'utilitarian', 'pale'],
    { ground: 'cream', pattern: 'none', density: 0, mark: 'creamDeep', mark2: 'creamDeep', gild: 'none', cut: 'smooth' }),

  gilt: edge('gilt', 'Gilt', 'All three edges laid with gold leaf and burnished.',
    ['gilded', 'formal', 'fancy'],
    { ground: 'gilt', pattern: 'none', density: 0, mark: 'ochre', mark2: 'ochre', gild: 'all', cut: 'smooth' }),

  marbled: edge('marbled', 'Marbled', 'Combed pigment floated on size and lifted onto the block.',
    ['ornate', 'antique', 'warm'],
    { ground: 'cream', pattern: 'comb', density: 0.7, mark: 'terracotta', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  speckled: edge('speckled', 'Speckled', 'Flicked with ink from a brush held over the block.',
    ['rustic', 'plain', 'muted'],
    { ground: 'cream', pattern: 'fleck', density: 0.5, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  sprinkled: edge('sprinkled', 'Sprinkled', 'A finer, denser spray than speckling, in two colours.',
    ['rustic', 'antique', 'warm'],
    { ground: 'creamDeep', pattern: 'sprinkle', density: 0.8, mark: 'terracotta', mark2: 'moss', gild: 'none', cut: 'smooth' }),

  'stained-red': edge('stained-red', 'Red edges', 'Dipped in red, the commonest edge on a schoolbook.',
    ['warm', 'plain', 'bright'],
    { ground: 'terracotta', pattern: 'none', density: 0, mark: 'terracotta', mark2: 'terracotta', gild: 'none', cut: 'smooth' }),

  'stained-blue': edge('stained-blue', 'Blue edges', 'Stained a flat slate blue right through.',
    ['cool', 'plain', 'muted'],
    { ground: 'slate', pattern: 'none', density: 0, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  'stained-green': edge('stained-green', 'Green edges', 'A quiet moss stain, faded unevenly at the head.',
    ['natural', 'muted', 'cool'],
    { ground: 'moss', pattern: 'none', density: 0, mark: 'moss', mark2: 'moss', gild: 'none', cut: 'smooth' }),

  'yellow-edges': edge('yellow-edges', 'Yellow edges', 'The bright yellow of a cheap edition, and none the worse.',
    ['bright', 'plain', 'warm'],
    { ground: 'ochre', pattern: 'none', density: 0, mark: 'ochre', mark2: 'ochre', gild: 'none', cut: 'smooth' }),

  'top-gilt': edge('top-gilt', 'Top edge gilt', 'Gold on the head only; the other two left rough.',
    ['gilded', 'refined', 'antique'],
    { ground: 'creamDeep', pattern: 'none', density: 0, mark: 'gilt', mark2: 'gilt', gild: 'top', cut: 'rough' }),

  'fore-edge-gilt': edge('fore-edge-gilt', 'Fore-edge gilt', 'Only the long edge is gilded, and it glows.',
    ['gilded', 'refined', 'formal'],
    { ground: 'cream', pattern: 'none', density: 0, mark: 'gilt', mark2: 'gilt', gild: 'fore', cut: 'smooth' }),

  'all-edges-gilt': edge('all-edges-gilt', 'All edges gilt', 'Gilt on solid gold, the full presentation binding.',
    ['gilded', 'fancy', 'formal'],
    { ground: 'gilt', pattern: 'none', density: 0, mark: 'giltPale', mark2: 'ochre', gild: 'all', cut: 'smooth' }),

  gauffered: edge('gauffered', 'Gauffered', 'Gilt, then tooled with heated brass into a lattice.',
    ['ornate', 'gilded', 'fancy'],
    { ground: 'gilt', pattern: 'cheque', density: 0.7, mark: 'ochre', mark2: 'ochre', gild: 'all', cut: 'smooth' }),

  'rough-cut': edge('rough-cut', 'Rough cut', 'Trimmed with a knife and not much care.',
    ['rustic', 'plain', 'natural'],
    { ground: 'creamDeep', pattern: 'none', density: 0, mark: 'creamDeep', mark2: 'creamDeep', gild: 'none', cut: 'rough' }),

  deckle: edge('deckle', 'Deckle', 'The paper’s own feathered edge, never trimmed at all.',
    ['natural', 'refined', 'pale'],
    { ground: 'cream', pattern: 'none', density: 0, mark: 'creamDeep', mark2: 'creamDeep', gild: 'none', cut: 'deckle' }),

  uncut: edge('uncut', 'Uncut', 'Folded sheets still joined at the head, waiting for a paperknife.',
    ['antique', 'natural', 'scholarly'],
    { ground: 'creamDeep', pattern: 'none', density: 0, mark: 'cream', mark2: 'cream', gild: 'none', cut: 'deckle' }),

  burnished: edge('burnished', 'Burnished', 'Rubbed with an agate until the paper takes a sheen.',
    ['refined', 'pale', 'plain'],
    { ground: 'creamDeep', pattern: 'none', density: 0, mark: 'cream', mark2: 'cream', gild: 'none', cut: 'smooth' }),

  'antique-gilt': edge('antique-gilt', 'Antique gilt', 'Old gold gone dull and brown at the corners.',
    ['antique', 'gilded', 'muted'],
    { ground: 'ochre', pattern: 'none', density: 0, mark: 'timber', mark2: 'timber', gild: 'all', cut: 'rough', foil: 'ochre' }),

  'red-under-gold': edge('red-under-gold', 'Red under gold', 'Gold laid over a red stain, so the edge burns where it wears.',
    ['gilded', 'ornate', 'warm'],
    { ground: 'gilt', pattern: 'band', density: 0.4, mark: 'terracotta', mark2: 'terracotta', gild: 'all', cut: 'smooth' }),

  stippled: edge('stippled', 'Stippled', 'A dense punched dot pattern, almost a tone.',
    ['refined', 'muted', 'antique'],
    { ground: 'cream', pattern: 'fleck', density: 0.9, mark: 'timber', mark2: 'timber', gild: 'none', cut: 'smooth' }),

  agate: edge('agate', 'Agate', 'Bands of grey and cream like a cut stone.',
    ['cool', 'refined', 'muted'],
    { ground: 'creamDeep', pattern: 'band', density: 0.6, mark: 'slate', mark2: 'cream', gild: 'none', cut: 'smooth' }),

  'comb-marbled': edge('comb-marbled', 'Comb marbled', 'Drawn once with a wide comb — long even teeth of colour.',
    ['ornate', 'formal', 'cool'],
    { ground: 'cream', pattern: 'comb', density: 0.9, mark: 'slate', mark2: 'moss', gild: 'none', cut: 'smooth' }),

  'spanish-wave': edge('spanish-wave', 'Spanish wave', 'Rocked as it is lifted, so the colour ripples across.',
    ['ornate', 'antique', 'warm'],
    { ground: 'cream', pattern: 'wave', density: 0.8, mark: 'terracotta', mark2: 'ochre', gild: 'none', cut: 'smooth' }),

  'stone-marbled': edge('stone-marbled', 'Stone marbled', 'Thrown on without combing; it breaks into islands.',
    ['rustic', 'antique', 'muted'],
    { ground: 'creamDeep', pattern: 'stone', density: 0.7, mark: 'timber', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  'shell-marbled': edge('shell-marbled', 'Shell marbled', 'Each drop haloed in pale, the way a shell pattern breaks.',
    ['ornate', 'refined', 'warm'],
    { ground: 'cream', pattern: 'shell', density: 0.7, mark: 'ochre', mark2: 'terracotta', gild: 'none', cut: 'smooth' }),

  nonpareil: edge('nonpareil', 'Nonpareil', 'The finest comb of all — teeth barely a hair apart.',
    ['refined', 'ornate', 'formal'],
    { ground: 'cream', pattern: 'comb', density: 1, mark: 'plum', mark2: 'sage', gild: 'none', cut: 'smooth' }),

  'peacock-marbled': edge('peacock-marbled', 'Peacock', 'Combed twice at right angles into rows of feather eyes.',
    ['ornate', 'fancy', 'cool'],
    { ground: 'cream', pattern: 'shell', density: 0.9, mark: 'slate', mark2: 'moss', gild: 'none', cut: 'smooth' }),

  'painted-fore-edge': edge('painted-fore-edge', 'Painted fore-edge', 'A picture painted on the fanned block, hidden when shut.',
    ['romantic', 'fancy', 'ornate'],
    { ground: 'gilt', pattern: 'scene', density: 0.8, mark: 'sage', mark2: 'slate', gild: 'all', cut: 'smooth' }),

  'landscape-edge': edge('landscape-edge', 'Landscape edge', 'Hills and a sky, in three colours and no more.',
    ['romantic', 'natural', 'whimsical'],
    { ground: 'creamDeep', pattern: 'scene', density: 0.6, mark: 'moss', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  mottled: edge('mottled', 'Mottled', 'Blotched with acid, the way a calf binding is mottled.',
    ['antique', 'rustic', 'warm'],
    { ground: 'creamDeep', pattern: 'stone', density: 0.5, mark: 'timber', mark2: 'timber', gild: 'none', cut: 'smooth' }),

  'tree-calf-edge': edge('tree-calf-edge', 'Tree pattern', 'Water run down the block so the stain branches like a tree.',
    ['antique', 'ornate', 'warm'],
    { ground: 'creamDeep', pattern: 'ripple', density: 0.7, mark: 'timber', mark2: 'ochre', gild: 'none', cut: 'smooth' }),

  spattered: edge('spattered', 'Spattered', 'Big careless drops, half of them run together.',
    ['rustic', 'whimsical', 'muted'],
    { ground: 'cream', pattern: 'sprinkle', density: 0.5, mark: 'plum', mark2: 'plum', gild: 'none', cut: 'rough' }),

  dusted: edge('dusted', 'Dusted', 'A faint bloom of colour, as if breathed onto the paper.',
    ['pale', 'muted', 'airy'],
    { ground: 'cream', pattern: 'fleck', density: 0.2, mark: 'sage', mark2: 'sage', gild: 'none', cut: 'smooth' }),

  'charcoal-edge': edge('charcoal-edge', 'Charcoal edges', 'Rubbed black, so the closed book is a solid dark slab.',
    ['dark', 'modern', 'severe'],
    { ground: 'ink', pattern: 'none', density: 0, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'rough' }),

  'ink-edge': edge('ink-edge', 'Ink edges', 'Dipped in ink to the depth of a fingernail.',
    ['dark', 'severe', 'cool'],
    { ground: 'ink', pattern: 'none', density: 0, mark: 'ink', mark2: 'ink', gild: 'none', cut: 'smooth' }),

  'sepia-edge': edge('sepia-edge', 'Sepia edges', 'The warm brown of an old photograph.',
    ['antique', 'warm', 'muted'],
    { ground: 'timber', pattern: 'none', density: 0, mark: 'timber', mark2: 'timber', gild: 'none', cut: 'smooth' }),

  'tea-stained': edge('tea-stained', 'Tea stained', 'Tannin, unevenly, and a tide line where it stopped.',
    ['antique', 'cosy', 'warm'],
    { ground: 'creamDeep', pattern: 'ripple', density: 0.4, mark: 'timber', mark2: 'timber', gild: 'none', cut: 'rough' }),

  'saffron-edge': edge('saffron-edge', 'Saffron edges', 'A hot orange-yellow that catches the eye across a room.',
    ['bright', 'warm', 'fancy'],
    { ground: 'ochre', pattern: 'band', density: 0.3, mark: 'terracotta', mark2: 'terracotta', gild: 'none', cut: 'smooth' }),

  'rose-edge': edge('rose-edge', 'Rose edges', 'A soft pink stain, deeper toward the head.',
    ['romantic', 'pale', 'warm'],
    { ground: 'plum', pattern: 'none', density: 0, mark: 'plum', mark2: 'plum', gild: 'none', cut: 'smooth' }),

  'sea-green-edge': edge('sea-green-edge', 'Sea green edges', 'The colour of shallow water over sand.',
    ['cool', 'nautical', 'natural'],
    { ground: 'sage', pattern: 'none', density: 0, mark: 'sage', mark2: 'sage', gild: 'none', cut: 'smooth' }),

  'violet-edge': edge('violet-edge', 'Violet edges', 'A deep purple that reads almost black at a distance.',
    ['dark', 'romantic', 'cool'],
    { ground: 'plum', pattern: 'none', density: 0, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  // Density 0.25 is not a shrug: `band` derives its count from it, and this is
  // the one entry in the table whose whole idea is TWO bands and no more.
  'two-tone': edge('two-tone', 'Two tone', 'Head one colour, tail another, meeting halfway.',
    ['modern', 'whimsical', 'bright'],
    { ground: 'cream', pattern: 'band', density: 0.25, mark: 'terracotta', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  banded: edge('banded', 'Banded', 'Three broad bands down the block, evenly spaced.',
    ['modern', 'plain', 'cool'],
    { ground: 'cream', pattern: 'band', density: 0.7, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  striped: edge('striped', 'Striped', 'Fine stripes the whole length, like a ticking.',
    ['plain', 'utilitarian', 'modern'],
    { ground: 'cream', pattern: 'stripe', density: 0.8, mark: 'terracotta', mark2: 'terracotta', gild: 'none', cut: 'smooth' }),

  chequered: edge('chequered', 'Chequered', 'A small checker, struck through a stencil.',
    ['whimsical', 'modern', 'bright'],
    { ground: 'cream', pattern: 'cheque', density: 0.8, mark: 'slate', mark2: 'slate', gild: 'none', cut: 'smooth' }),

  silvered: edge('silvered', 'Silvered', 'White metal leaf instead of gold; cooler, and it tarnishes.',
    ['cool', 'refined', 'formal'],
    { ground: 'slate', pattern: 'none', density: 0, mark: 'cream', mark2: 'cream', gild: 'all', cut: 'smooth', foil: 'cream' }),

  'copper-edge': edge('copper-edge', 'Copper', 'Copper leaf, gone a little green in the hollows.',
    ['warm', 'antique', 'ornate'],
    { ground: 'timber', pattern: 'none', density: 0, mark: 'moss', mark2: 'moss', gild: 'all', cut: 'smooth', foil: 'terracotta' }),

  'verdigris-edge': edge('verdigris-edge', 'Verdigris', 'The blue-green bloom that grows on old bronze.',
    ['antique', 'cool', 'natural'],
    { ground: 'sage', pattern: 'none', density: 0, mark: 'moss', mark2: 'cream', gild: 'none', cut: 'rough' }),

  foxed: edge('foxed', 'Foxed', 'Rust-brown spots through the paper, and no way back.',
    ['antique', 'rustic', 'muted'],
    { ground: 'creamDeep', pattern: 'fleck', density: 0.6, mark: 'timber', mark2: 'ochre', gild: 'none', cut: 'rough' }),

  'well-thumbed': edge('well-thumbed', 'Well thumbed', 'Grey where a hand has held it for thirty years.',
    ['cosy', 'rustic', 'muted'],
    { ground: 'creamDeep', pattern: 'ripple', density: 0.5, mark: 'slate', mark2: 'timber', gild: 'none', cut: 'rough' }),
};

/** Display names for the text-block edge treatments. */
export const EDGE_LABELS: Readonly<Record<EdgeTreatment, string>> = Object.fromEntries(
  EDGE_TREATMENTS.map((id) => [id, EDGE_SPECS[id].label]),
) as Record<EdgeTreatment, string>;

/**
 * Reader-facing page edges that are visibly distinct in the shipping cover
 * painter at held-book size.  The old fifty-name catalogue remains above only
 * as a persistence vocabulary; almost all of it fell through to the same cream
 * sliver and therefore lied in the Studio.
 */
export const ACTIVE_EDGE_TREATMENTS = [
  'plain',
  'gilt',
  'stained-red',
  'sepia-edge',
  'deckle',
  'red-under-gold',
] as const satisfies readonly EdgeTreatment[];

export const ACTIVE_EDGE_OPTIONS = ACTIVE_EDGE_TREATMENTS.map((id) => ({
  id,
  label: EDGE_LABELS[id],
}));

const ACTIVE_EDGE_SET: ReadonlySet<string> = new Set(ACTIVE_EDGE_TREATMENTS);

const RETIRED_GILT_EDGES: ReadonlySet<EdgeTreatment> = new Set([
  'gilt',
  'top-gilt',
  'fore-edge-gilt',
  'all-edges-gilt',
  'gauffered',
  'antique-gilt',
  'red-under-gold',
  'painted-fore-edge',
]);

const RETIRED_RED_EDGES: ReadonlySet<EdgeTreatment> = new Set([
  'stained-red',
  'rose-edge',
]);

const RETIRED_UMBER_EDGES: ReadonlySet<EdgeTreatment> = new Set([
  'sepia-edge',
  'tea-stained',
  'antique-gilt',
  'well-thumbed',
]);

const RETIRED_ROUGH_EDGES: ReadonlySet<EdgeTreatment> = new Set([
  'rough-cut',
  'deckle',
  'uncut',
  'foxed',
]);

const RETIRED_BURNISHED_EDGES: ReadonlySet<EdgeTreatment> = new Set([
  'red-under-gold',
  'burnished',
  'two-tone',
]);

export function isActiveEdgeTreatment(value: unknown): value is (typeof ACTIVE_EDGE_TREATMENTS)[number] {
  return typeof value === 'string' && ACTIVE_EDGE_SET.has(value);
}

/** Hard-normalise every historical edge to one of six honest held-book finishes. */
export function normalizeEdgeTreatment(value: unknown): (typeof ACTIVE_EDGE_TREATMENTS)[number] {
  if (isActiveEdgeTreatment(value)) return value;
  if (typeof value === 'string' && isEdgeTreatment(value)) {
    if (RETIRED_GILT_EDGES.has(value)) return 'gilt';
    if (RETIRED_RED_EDGES.has(value)) return 'stained-red';
    if (RETIRED_UMBER_EDGES.has(value)) return 'sepia-edge';
    if (RETIRED_ROUGH_EDGES.has(value)) return 'deckle';
    if (RETIRED_BURNISHED_EDGES.has(value)) return 'red-under-gold';
    return 'plain';
  }
  return 'plain';
}

/** Mood words for the text-block edge treatments. */
export const EDGE_TAGS: Readonly<Record<EdgeTreatment, readonly SpineTag[]>> =
  Object.fromEntries(
    EDGE_TREATMENTS.map((id) => [id, EDGE_SPECS[id].tags]),
  ) as Record<EdgeTreatment, readonly SpineTag[]>;

/**
 * The spec for an edge id, total: junk falls back to `plain`.
 *
 * This is the seam `art/covers.ts` should read.  The active catalogue is kept
 * deliberately equal to what the held-cover renderer can prove visually.
 */
export function edgeSpec(id: unknown): EdgeSpec {
  return EDGE_SPECS[normalizeEdgeTreatment(id)];
}

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
  /**
   * A cloth colour the READER typed, `#rrggbb`, overruling `palette`.
   *
   * Absent/null is the normal case and means "whatever `clothForPalette`
   * folds `palette` onto" — the fifty house cloths. It is a hex and not an
   * index because it is by definition not in the table: see
   * `bookDesign.BookDesign.cloth`, which does the folding, and
   * `art/customColour.ts`, which is the app's one answer to "the reader wants
   * a colour we do not own".
   *
   * It reaches every cache that holds spine pixels for free, though not the
   * way this comment used to claim. It is not in a key: the studio's edit goes
   * through `cover_meta.style` → `persistBookStyle` → `spineFactory.invalidate`,
   * which drops the book's baked spine, releases its atlas rect and clears its
   * cached params. The spine caches are invalidation-keyed throughout — see
   * `bookDesign.bookDesignTag`, which spells `design.cloth` and which no cache
   * has ever consulted.
   */
  clothHex?: string | null;
  /** Spine ground only; null inherits the shared cloth/pigment. */
  spineBaseHex?: string | null;
  /** Spine's secondary covering role. */
  spineAccentHex?: string | null;
  /** Spine tooling and front-cover title trim. */
  toolingHex?: string | null;
  /** Spine stamp and cover medallion. */
  emblemHex?: string | null;
  /** Clasps and corner fittings. */
  hardwareHex?: string | null;
  /** Extra per-book hue rotation, ±6°. */
  hueJitter: number;
  /** 0–3 horizontal bands. */
  bands: BandSpec[];
  /** Ornament stamp index into the append-only `ORNAMENT_LABELS` table. */
  ornament: number;
  /** Cover texture: 0 = cloth, 1 = leather, 2 = paper. */
  texture: 0 | 1 | 2;
  /** Front-cover title face: 0 = Caveat, 1 = Kalam, 2 = Patrick Hand. */
  font: 0 | 1 | 2;
  /** Gilt (gold) bands, ornament and front-cover title. */
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
  /**
   * Whether `material` was CHOSEN rather than inherited.
   *
   * Every active binding carries an exact covering of its own, and a book that hands
   * one down unasked flattens the whole table into the seven the studio knows.
   * So the covering only overrules its binding when the reader actually
   * touched the chip — which is exactly what `resolveBookStyle` reports.
   */
  materialPinned?: boolean;
  /** Raised cords across the spine, 0–5. >0 replaces the decorative `bands`. */
  raisedBands?: number;
  /** Gold rules flanking each raised cord. */
  bandGilt?: boolean;
  /** Endband stripe variant: 0 = blocks, 1 = chevron, 2 = wrapped cord. */
  headTailStyle?: number;
  /** False = no ornament stamp (the Studio's explicit “None” choice). */
  ornamentOn?: boolean;
  /** Front-cover title treatment, carried here for seed compatibility. */
  titlePlate?: TitlePlateStyle;
  /** True when the raised-cord count was explicitly chosen in the Studio. */
  raisedBandsPinned?: boolean;
  /** True when the ornament was explicitly chosen rather than inherited. */
  ornamentPinned?: boolean;
  /** True when endbands were explicitly enabled/disabled by the reader. */
  headTailPinned?: boolean;
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
  /**
   * The ribbon/twine/wax colourway: an index into `charms.CHARM_COLORS`, or a
   * `#rrggbb` the reader typed in the Book Studio.
   *
   * Read through `charms.charmColorCss`, which has always accepted either —
   * clamping a reader's hex up onto `CHARM_FLOOR` so `FLAT.ink` still has an
   * edge to be. This type was the last one holding out, and it was deliberately
   * left narrow until `art/bookStyle.ts` had somewhere to put such a colour:
   * `resolveBookStyle` used to round and clamp this value unconditionally, so a
   * union arriving early would only have been a type error in a module with no
   * way to use it. That module now keeps the hex whole (`BookStyle.charmColor`
   * carries both representations), so the union is real.
   *
   * Seeded params still roll an INDEX — a hex only ever arrives from the studio.
   */
  charmColor?: number | string;
  /**
   * A binding pinned in the Book Studio (`art/bookDesign.ts`), overriding the
   * one the seed would have picked.
   *
   * Null/absent is the normal case and is NOT the same as a default: it means
   * "whatever `presetForSeed` says", so a book that has never been dressed
   * still gets one vetted binding rather than a house wrapper. It is last
   * in the params on purpose — `deriveSpineParams` appends its draw, so adding
   * it reshuffles nothing that came before.
   */
  binding?: BookPresetId | null;

  /* ------------------- painterly rebuild additions (§1, §3) ---------------- */
  /* All optional, all seed-derived, none exposed in the studio. These were the
   * facts a *simulated* surface needed — how far the boards stand proud, how
   * much foil has lifted, how round the back is — and the flat spine reads
   * none of them: it has no light model and no surface to wear. They stay on
   * the type because they are persisted per book, because `proud` is still the
   * shelf compositor's depth offset, and because a params migration buys
   * nothing here. Treat them as history, not as knobs. */

  /**
   * Sub-treatment within the material (see MAX_BOARD_STYLE): crackled vs
   * pebbled leather, ribbed vs flat cloth, combed vs stone marbling…
   */
  boardStyle?: number;
  /**
   * How much of the text block's fore-edge shows beside the spine, as a
   * fraction of the spine's drawn width (0.05–0.24). The reference has a
   * visible cream page-block next to *every* spine; we had none.
   */
  pageBlock?: number;
  /**
   * How far the book stands proud of (positive) or recessed behind (negative)
   * the shelf's front edge, in world px, ±10. Drives the compositor's depth
   * offset, the AO on recessed books and the contact shadow's gap.
   */
  proud?: number;
  /** Extra sun-fade on the side facing the key, 0–1 (independent of `wear`). */
  sunFade?: number;
  /** How much of the foil tooling has rubbed away, 0 (crisp) → 1 (ghost). */
  foilWear?: number;
  /** The book's own bump/knock history: 0–1, drives corner and cap damage. */
  knock?: number;
  /** Squab: a slightly convex (rounded) spine, 0 (flat back) → 1 (full round). */
  round?: number;
}

/** Suggested base spine height in world px (book zone is 280). */
export const SPINE_BASE_HEIGHT = 232;

interface HSL {
  h: number;
  s: number;
  l: number;
}

/** One pigment: a name, its mood words, and the light/dark duo it paints. */
interface PigmentSpec {
  name: string;
  tags: readonly SpineTag[];
  /** Light/top pigment. */
  top: HSL;
  /** Dark/bottom pigment. */
  bottom: HSL;
}

const pig = (
  name: string,
  tags: readonly SpineTag[],
  top: HSL,
  bottom: HSL,
): PigmentSpec => ({ name, tags, top, bottom });

/**
 * The 50 curated pigment duos (top/light, bottom/dark).
 *
 * Order is append-only and always has been: 0–11 are the original hue
 * families, 12–19 the deep range the reference row is built from, and 20–49
 * the thirty added when the cloth vocabulary went to fifty. A book's colour
 * identity lives in `palette`, so an index that moved would repaint somebody's
 * shelf.
 *
 * The thirty new ones are not a gradient of the old twenty. They fill the
 * holes: there were no true purples, no honest reds between terracotta and
 * oxblood, one pink, no pale cool neutrals, and nothing between `sage` and
 * `forest`. Every duo was checked against its nearest existing neighbour on
 * hue AND on value — two pigments 8° apart at the same lightness are one
 * pigment with two names, and the picker would be lying about how much choice
 * it offers.
 *
 * Dark partners are genuinely dark (the flat style has no shading pass, so the
 * dark face beside the light one IS the depth) and every entry carries mood
 * words, so "something dark and formal" can steer the roll.
 */
const PIGMENTS: readonly PigmentSpec[] = [
  /* ---- the original hue families ---- */
  pig('Amber', ['warm', 'bright', 'cosy'], { h: 38, s: 64, l: 52 }, { h: 28, s: 62, l: 31 }),
  pig('Terracotta', ['warm', 'rustic', 'natural'], { h: 16, s: 58, l: 47 }, { h: 8, s: 56, l: 27 }),
  pig('Moss', ['natural', 'botanical', 'cosy'], { h: 95, s: 30, l: 41 }, { h: 102, s: 34, l: 23 }),
  pig('Dusty blue', ['cool', 'muted', 'refined'], { h: 210, s: 28, l: 46 }, { h: 216, s: 34, l: 26 }),
  pig('Plum', ['romantic', 'muted', 'refined'], { h: 315, s: 26, l: 39 }, { h: 322, s: 32, l: 21 }),
  pig('Ochre', ['warm', 'antique', 'rustic'], { h: 44, s: 62, l: 46 }, { h: 38, s: 58, l: 27 }),
  pig('Sage', ['natural', 'muted', 'pale'], { h: 130, s: 18, l: 51 }, { h: 136, s: 22, l: 31 }),
  pig('Rust', ['warm', 'rustic', 'antique'], { h: 22, s: 62, l: 39 }, { h: 16, s: 62, l: 22 }),
  pig('Clay', ['warm', 'muted', 'natural'], { h: 28, s: 40, l: 51 }, { h: 22, s: 38, l: 31 }),
  pig('Olive', ['natural', 'muted', 'utilitarian'], { h: 70, s: 32, l: 37 }, { h: 64, s: 36, l: 21 }),
  pig('Slate', ['cool', 'severe', 'muted'], { h: 200, s: 20, l: 41 }, { h: 206, s: 24, l: 23 }),
  pig('Blush', ['pale', 'romantic', 'warm'], { h: 355, s: 34, l: 55 }, { h: 348, s: 34, l: 35 }),
  /* ---- the deep range the reference is actually built from ---- */
  pig('Oxblood', ['dark', 'formal', 'antique'], { h: 2, s: 54, l: 33 }, { h: 356, s: 56, l: 17 }),
  pig('Navy', ['dark', 'formal', 'cool'], { h: 220, s: 46, l: 29 }, { h: 226, s: 50, l: 15 }),
  pig('Forest', ['dark', 'natural', 'botanical'], { h: 148, s: 36, l: 27 }, { h: 154, s: 40, l: 14 }),
  pig('Tan', ['warm', 'plain', 'rustic'], { h: 33, s: 46, l: 60 }, { h: 27, s: 42, l: 40 }),
  pig('Cream', ['pale', 'refined', 'airy'], { h: 44, s: 40, l: 83 }, { h: 38, s: 32, l: 62 }),
  pig('Ink', ['dark', 'severe', 'modern'], { h: 212, s: 12, l: 25 }, { h: 214, s: 14, l: 11 }),
  pig('Teal', ['cool', 'refined', 'nautical'], { h: 186, s: 36, l: 33 }, { h: 192, s: 40, l: 18 }),
  pig('Saffron', ['bright', 'warm', 'fancy'], { h: 36, s: 76, l: 55 }, { h: 28, s: 72, l: 34 }),
  /* ---- reds and pinks ---- */
  pig('Burgundy', ['dark', 'formal', 'romantic'], { h: 338, s: 44, l: 31 }, { h: 332, s: 48, l: 17 }),
  pig('Vermilion', ['bright', 'warm', 'fancy'], { h: 6, s: 78, l: 52 }, { h: 0, s: 74, l: 32 }),
  pig('Coral', ['bright', 'warm', 'whimsical'], { h: 14, s: 66, l: 63 }, { h: 8, s: 58, l: 43 }),
  pig('Rose', ['romantic', 'warm', 'fancy'], { h: 338, s: 50, l: 57 }, { h: 332, s: 48, l: 37 }),
  /* ---- purples ---- */
  pig('Aubergine', ['dark', 'severe', 'formal'], { h: 300, s: 30, l: 25 }, { h: 294, s: 34, l: 13 }),
  pig('Amethyst', ['romantic', 'ornate', 'cool'], { h: 272, s: 32, l: 49 }, { h: 266, s: 36, l: 30 }),
  pig('Lavender', ['pale', 'romantic', 'airy'], { h: 260, s: 30, l: 67 }, { h: 254, s: 28, l: 47 }),
  pig('Heather', ['muted', 'natural', 'cosy'], { h: 288, s: 18, l: 57 }, { h: 282, s: 20, l: 37 }),
  /* ---- blues ---- */
  pig('Indigo', ['dark', 'cool', 'scholarly'], { h: 246, s: 38, l: 33 }, { h: 250, s: 42, l: 18 }),
  pig('Lapis', ['bright', 'cool', 'formal'], { h: 222, s: 56, l: 43 }, { h: 228, s: 58, l: 26 }),
  pig('Storm', ['muted', 'cool', 'severe'], { h: 232, s: 20, l: 39 }, { h: 238, s: 24, l: 23 }),
  pig('Sky', ['pale', 'cool', 'airy'], { h: 202, s: 44, l: 65 }, { h: 206, s: 42, l: 45 }),
  pig('Peacock', ['bright', 'cool', 'ornate'], { h: 192, s: 54, l: 37 }, { h: 196, s: 58, l: 21 }),
  /* ---- greens ---- */
  pig('Verdigris', ['cool', 'antique', 'natural'], { h: 176, s: 40, l: 44 }, { h: 180, s: 44, l: 26 }),
  pig('Jade', ['cool', 'refined', 'botanical'], { h: 156, s: 38, l: 48 }, { h: 160, s: 42, l: 29 }),
  pig('Celadon', ['pale', 'refined', 'airy'], { h: 140, s: 22, l: 67 }, { h: 144, s: 24, l: 47 }),
  pig('Fern', ['botanical', 'natural', 'bright'], { h: 120, s: 38, l: 37 }, { h: 116, s: 42, l: 22 }),
  pig('Bottle green', ['dark', 'formal', 'severe'], { h: 124, s: 50, l: 19 }, { h: 128, s: 54, l: 10 }),
  /* ---- yellows ---- */
  pig('Chartreuse', ['bright', 'whimsical', 'botanical'], { h: 76, s: 46, l: 53 }, { h: 70, s: 46, l: 33 }),
  pig('Buttercup', ['bright', 'warm', 'whimsical'], { h: 50, s: 72, l: 61 }, { h: 44, s: 68, l: 41 }),
  pig('Straw', ['pale', 'warm', 'rustic'], { h: 52, s: 46, l: 71 }, { h: 46, s: 40, l: 51 }),
  /* ---- browns ---- */
  pig('Chocolate', ['dark', 'warm', 'cosy'], { h: 22, s: 32, l: 27 }, { h: 18, s: 34, l: 15 }),
  pig('Chestnut', ['warm', 'rustic', 'antique'], { h: 14, s: 38, l: 35 }, { h: 8, s: 40, l: 21 }),
  pig('Umber', ['muted', 'antique', 'scholarly'], { h: 32, s: 26, l: 37 }, { h: 26, s: 28, l: 22 }),
  pig('Bronze', ['warm', 'antique', 'gilded'], { h: 36, s: 50, l: 41 }, { h: 30, s: 50, l: 24 }),
  /* ---- neutrals ---- */
  pig('Linen', ['pale', 'plain', 'natural'], { h: 40, s: 16, l: 85 }, { h: 34, s: 16, l: 65 }),
  pig('Oyster', ['pale', 'muted', 'refined'], { h: 38, s: 14, l: 72 }, { h: 32, s: 14, l: 52 }),
  pig('Dove', ['pale', 'cool', 'refined'], { h: 216, s: 10, l: 66 }, { h: 220, s: 12, l: 46 }),
  pig('Pewter', ['muted', 'cool', 'utilitarian'], { h: 210, s: 8, l: 45 }, { h: 214, s: 10, l: 27 }),
  pig('Charcoal', ['dark', 'severe', 'modern'], { h: 28, s: 7, l: 26 }, { h: 24, s: 9, l: 14 }),
];

const PALETTES: ReadonlyArray<readonly [HSL, HSL]> = PIGMENTS.map(
  (p) => [p.top, p.bottom] as readonly [HSL, HSL],
);

/**
 * The 50 pigment duos, exported for features-side helpers that must mirror
 * the renderer's exact colours (placeholder tints, DOM pull-out gradients,
 * neighbour-bleed colours). `spinePalette.ts` used to keep a hand-copied —
 * and silently drifting — 12-entry duplicate of this table.
 */
export const SPINE_PALETTES = PALETTES;

/** Number of curated pigment duos (shared with covers.ts). */
export const PIGMENT_COUNT = PIGMENTS.length;

/** Display names for the pigment duos, index-aligned with SPINE_PALETTES. */
export const PIGMENT_LABELS: readonly string[] = PIGMENTS.map((p) => p.name);

/** Mood words for the pigment duos, index-aligned with PIGMENT_LABELS. */
export const PIGMENT_TAGS: readonly (readonly SpineTag[])[] = PIGMENTS.map((p) => p.tags);

const GOLD = '#c9a227';

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

  const ornament =
    ACTIVE_ORNAMENT_INDICES[Math.floor(rnd() * ACTIVE_ORNAMENT_INDICES.length)] ?? 12;
  const texture = Math.floor(rnd() * 3) as 0 | 1 | 2;
  const font = Math.floor(rnd() * 3) as 0 | 1 | 2;
  // Gold is the reference row's sparkle: rather more than half its spines
  // carry tooled foil somewhere. At 0.3 our shelf had almost none of it.
  const gilt = rnd() < 0.55;
  const lean = (rnd() * 2 - 1) * 1.2;
  // Spine thickness. The old recipe (triangular, 28–46) is exactly the
  // "near-uniform widths" the art direction calls out: a triangular
  // distribution puts four books in five inside a 10px band, and a row of
  // those reads as a fence.
  //
  // A real shelf is a *mixture*: mostly ordinary octavos, but with a long
  // thin tail of pamphlets and slim verse, and a short fat tail of atlases
  // and bound volumes. So roll a class first, then a width inside it — a
  // genuine multi-modal draw with the tails the reference has.
  const w = thicknessRoll(rnd);
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
  const headTailStyle =
    ACTIVE_HEAD_TAIL_STYLES[Math.floor(rnd() * ACTIVE_HEAD_TAIL_STYLES.length)] ?? 1;
  const ornamentOn = rnd() < 0.82;
  const titlePlate = pickWeighted(rnd(), PLATE_WEIGHTS);
  // Skew hard toward the low end: most books are gently read, few are ruins.
  const wearRoll = rnd();
  const wear = clamp(wearRoll * wearRoll * (0.55 + MATERIAL_WEAR_BIAS[material]), 0, 1);
  const edge = pickWeighted(rnd(), EDGE_WEIGHTS);
  const charmRoll = rnd();
  // Both pools are READ from `art/charms.ts` rather than copied out of it. The
  // copies that used to be here restated their sizes as the literals 6 and 8,
  // which is the quietest way this codebase has found to lose a vocabulary: add
  // a charm or a colourway there and the seed would simply never roll it, with
  // nothing failing anywhere.
  // Applied tags, seals, clasps and tassels were tiny stickers on the shelf.
  // Keep the old stream consumption stable, but new seed defaults stay clean;
  // the integrated ribbon remains an explicit Studio choice.
  if (charmRoll >= 0.66) rnd();
  const charm: CharmKind = 'none';
  const charmColor = Math.floor(rnd() * CHARM_COLORS.length);

  // --- painterly rebuild rolls (appended: earlier fields keep their values) ---
  const boardStyle = Math.floor(rnd() * (MAX_BOARD_STYLE + 1));
  // Thin books show proportionally MORE page block (there is less spine to
  // hide it behind), which is exactly what makes a row of slivers read as
  // books rather than as coloured strips.
  const pageBlock = clamp(0.07 + rnd() * 0.14 + (w < 20 ? 0.07 : 0), 0.06, 0.28);
  // Most books sit flush; a quarter are noticeably pushed back or pulled
  // forward. Squaring the roll keeps the extremes rare.
  const proudRoll = rnd() * 2 - 1;
  const proud = Math.sign(proudRoll) * proudRoll * proudRoll * 10;
  const sunFade = rnd() * rnd();
  const foilWear = clamp(rnd() * rnd() * 1.5, 0, 1);
  const knock = rnd() * rnd();
  // Round backs are a hand-binding convention: leather and vellum almost
  // always, cloth sometimes, paper wrappers never.
  const round =
    material === 'leather' || material === 'vellum'
      ? 0.55 + rnd() * 0.45
      : material === 'cloth' || material === 'linen'
        ? rnd() * 0.6
        : rnd() * 0.25;

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
    spineBaseHex: null,
    spineAccentHex: null,
    toolingHex: null,
    emblemHex: null,
    hardwareHex: null,
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
    raisedBands: clamp(raisedBands, 0, MAX_RAISED_BANDS),
    bandGilt,
    headTailStyle,
    ornamentOn,
    titlePlate: normalizeTitlePlateStyle(titlePlate),
    wear,
    edge: normalizeEdgeTreatment(edge),
    height,
    charm,
    charmColor,
    boardStyle,
    pageBlock,
    proud,
    sunFade,
    foilWear,
    knock,
    round,
  };
}

/* ------------------------------ thickness ---------------------------------- */

/**
 * The six thickness classes a real shelf mixes, with the share of books that
 * fall in each. The spread — a 7px pamphlet standing next to a 54px atlas —
 * is the single most important silhouette fact in the art direction.
 */
export const THICKNESS_CLASSES = [
  { id: 'pamphlet', label: 'Pamphlet', min: 8, max: 13, weight: 9 },
  { id: 'slim', label: 'Slim', min: 13, max: 20, weight: 17 },
  { id: 'trade', label: 'Trade', min: 20, max: 28, weight: 26 },
  { id: 'standard', label: 'Standard', min: 28, max: 37, weight: 24 },
  { id: 'stout', label: 'Stout', min: 37, max: 46, weight: 15 },
  { id: 'tome', label: 'Tome', min: 46, max: 58, weight: 9 },
] as const;

export type ThicknessClass = (typeof THICKNESS_CLASSES)[number]['id'];

/**
 * Draw one spine thickness in world px. Consumes exactly two values from
 * `rnd` (class, then position inside the class) so the parameter stream stays
 * aligned for every seed.
 */
export function thicknessRoll(rnd: RandomFn): number {
  const roll = rnd();
  let total = 0;
  for (const c of THICKNESS_CLASSES) total += c.weight;
  let acc = roll * total;
  let chosen = THICKNESS_CLASSES[2] as (typeof THICKNESS_CLASSES)[number];
  for (const c of THICKNESS_CLASSES) {
    acc -= c.weight;
    if (acc < 0) {
      chosen = c;
      break;
    }
  }
  return clamp(
    chosen.min + rnd() * (chosen.max - chosen.min),
    SPINE_THICKNESS_RANGE.min,
    SPINE_THICKNESS_RANGE.max,
  );
}

/** Which thickness class a width lands in (for tests and the studio label). */
export function thicknessClassFor(w: number): ThicknessClass {
  for (const c of THICKNESS_CLASSES) {
    if (w < c.max) return c.id;
  }
  return 'tome';
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
  ['leather', 21],
  ['cloth', 22],
  ['paper', 16],
  ['linen', 13],
  ['vellum', 9],
  ['silk', 10],
  ['marbled', 9],
];

/** `none` = chance of zero cords; `max` = cords drawn as 1 + floor(r*max). */
const MATERIAL_CORD_BIAS: Readonly<Record<BindingMaterial, { none: number; max: number }>> = {
  leather: { none: 0.1, max: 2 },
  vellum: { none: 0.3, max: 2 },
  cloth: { none: 0.48, max: 2 },
  linen: { none: 0.55, max: 2 },
  paper: { none: 0.74, max: 2 },
  silk: { none: 0.78, max: 2 },
  // Marbled boards are the classic half-leather binding: the spine IS leather,
  // so cords are the norm.
  marbled: { none: 0.24, max: 2 },
};

/** Added to the wear multiplier — soft bindings age faster than leather. */
const MATERIAL_WEAR_BIAS: Readonly<Record<BindingMaterial, number>> = {
  leather: 0.15,
  cloth: 0.3,
  paper: 0.45,
  vellum: 0.2,
  linen: 0.35,
  silk: 0.25,
  marbled: 0.4,
};

/**
 * How often each front-cover title treatment turns up on an untouched book.
 *
 * This is cover-only metadata retained on the shared seeded params. It is
 * heavily skewed so closed covers do not read as a fifty-treatment sample
 * sheet: `none`, paper and plain ruled fields are ordinary, while shaped
 * cartouches, enamels and gothic panels stay rare. Everything not named here
 * gets `1`, so adding a treatment cannot silently fall out of the seed roll.
 */
const PLATE_WEIGHT_OVERRIDES: Readonly<Partial<Record<TitlePlateStyle, number>>> = {
  none: 150,
  label: 60,
  gilt: 42,
  debossed: 32,
  'paper-slip': 26,
  'morocco-label': 22,
  'double-fillet': 20,
  'ruled-box': 18,
  'blind-panel': 16,
  'gilt-direct': 15,
  'blind-lettered': 14,
  'twin-rules': 13,
  'vellum-slip': 12,
  'sunk-panel': 11,
  'triple-fillet': 10,
  roundel: 9,
  'dotted-rule': 9,
  'corner-brackets': 8,
  'gilt-band': 8,
  'linen-tag': 7,
  'ink-panel': 6,
  'lozenge-ends': 6,
  'stone-tablet': 5,
  'bead-frame': 5,
  'gilt-cartouche': 4,
  'oval-medallion': 4,
  'gothic-panel': 2,
  'enamel-plate': 2,
  'crest-plate': 2,
};

const PLATE_WEIGHTS: ReadonlyArray<readonly [TitlePlateStyle, number]> = ACTIVE_TITLE_PLATES.map(
  (id) => [id, PLATE_WEIGHT_OVERRIDES[id] ?? 1] as const,
);

const FORMAT_WEIGHTS: ReadonlyArray<readonly [SpineFormat, number]> = [
  ['folio', 12],
  ['quarto', 18],
  ['octavo', 34],
  ['duodecimo', 22],
  ['pocket', 14],
];

/**
 * How often each edge turns up unasked. Same shape and same reasoning as
 * `PLATE_WEIGHT_OVERRIDES`: most books were simply cut and left, a fair number
 * were stained or sprinkled, and the six named marblings and the painted
 * fore-edge are the ones worth finding. Unlisted ids get `1`.
 */
const EDGE_WEIGHT_OVERRIDES: Readonly<Partial<Record<EdgeTreatment, number>>> = {
  plain: 190,
  speckled: 42,
  gilt: 34,
  sprinkled: 26,
  'rough-cut': 24,
  'stained-red': 20,
  marbled: 18,
  'top-gilt': 16,
  burnished: 14,
  'stained-blue': 12,
  'well-thumbed': 12,
  foxed: 11,
  deckle: 10,
  'yellow-edges': 9,
  'stained-green': 9,
  mottled: 8,
  spattered: 8,
  stippled: 7,
  dusted: 7,
  'sepia-edge': 6,
  'antique-gilt': 6,
  'comb-marbled': 5,
  'stone-marbled': 5,
  'tea-stained': 5,
  'ink-edge': 4,
  'all-edges-gilt': 3,
  gauffered: 2,
  'painted-fore-edge': 1,
};

const EDGE_WEIGHTS: ReadonlyArray<readonly [EdgeTreatment, number]> = ACTIVE_EDGE_TREATMENTS.map(
  (id) => [id, EDGE_WEIGHT_OVERRIDES[id] ?? 1] as const,
);

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
    // Half-bound marbled boards read as leather on the pull-out cover: the
    // spine and corners the user actually sees up close are calf.
    case 'marbled':
      return 1;
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
  /** Ornament/rule color (gold when the book is gilt). */
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

/* ------------------------------- canvases -------------------------------- */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* ------------------------------ geometry --------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/** Lay a polyline into the current path, optionally closing it. */
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
 * The procedural ornament stamps — a binder's brass, drawn as paths.
 *
 * Index-aligned with `ORNAMENT_LABELS`. The unit box is roughly [-1, 1] in
 * both axes and `s` is the half-size in canvas px, so a stamp is struck about
 * `2s` across; `drawSpineOrnament` caps `s` at a third of the spine's width,
 * which on the shelf means 20–60 px for the whole mark.
 *
 * **Everything here is designed for that size and nothing else.** The rules
 * every stamp follows, learned the hard way from the first twelve:
 *
 *  - one silhouette, not an assembly. If you have to explain which bit is
 *    which, it will be four grey pixels on a pamphlet.
 *  - fill beats stroke. A hairline vanishes; a filled leaf survives. Where a
 *    stamp must be open (the fish, the pine cone, the beehive) it is STROKED
 *    at `lineWidth` ≈ 0.17s, never hatched — fill and stroke are the same ink
 *    here, so an interior line drawn on a filled body is invisible by
 *    construction.
 *  - at most two accent marks after the main shape.
 *
 * `rnd` supplies a per-book wobble so two copies of the same tool are not
 * pixel-identical, exactly as the rest of the flat vocabulary does.
 */
export function drawOrnament(
  ctx: Ctx2D,
  kind: number,
  cx: number,
  cy: number,
  s: number,
  rnd: RandomFn,
): void {
  const j = (v: number) => v + (rnd() * 2 - 1) * s * 0.06;
  const pt = (x: number, y: number): Pt => ({ x: j(cx + x * s), y: j(cy + y * s) });
  /** Filled closed polygon in unit space. */
  const fillPoly = (pts: readonly Pt[]): void => {
    tracePoly(ctx, pts, true);
    ctx.fill();
  };
  /** Filled disc. */
  const disc = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(cx + x * s, cy + y * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  };
  /** Stroked circle. */
  const ring = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(cx + x * s, cy + y * s, r * s, 0, Math.PI * 2);
    ctx.stroke();
  };
  /** Filled ellipse, `rot` in radians. */
  const blob = (x: number, y: number, rx: number, ry: number, rot = 0): void => {
    ctx.beginPath();
    ctx.ellipse(cx + x * s, cy + y * s, rx * s, ry * s, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  /** Stroked arc. */
  const bow = (x: number, y: number, r: number, a0: number, a1: number, ccw = false): void => {
    ctx.beginPath();
    ctx.arc(cx + x * s, cy + y * s, r * s, a0, a1, ccw);
    ctx.stroke();
  };
  /** A straight run between two unit-space points. */
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    strokePts(ctx, [pt(x0, y0), pt(x1, y1)], false);
  };
  /** Short ruled shoulders make a motif part of the binding, not a sticker. */
  const shoulders = (y = 0.68, inner = 0.58, outer = 1.18): void => {
    line(-outer, y, -inner, y);
    line(inner, y, outer, y);
  };
  /** One broad outlined binder's leaf with an explicit midrib. */
  const openLeaf = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    rot: number,
  ): void => {
    ctx.save();
    ctx.translate(cx + x * s, cy + y * s);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -ry * s);
    ctx.quadraticCurveTo(rx * s, 0, 0, ry * s);
    ctx.quadraticCurveTo(-rx * s, 0, 0, -ry * s);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -ry * s * 0.62);
    ctx.lineTo(0, ry * s * 0.62);
    ctx.stroke();
    ctx.restore();
  };
  const openTool = (glyph: BroadFocalGlyph): void => {
    const colour = typeof ctx.strokeStyle === 'string'
      ? ctx.strokeStyle
      : typeof ctx.fillStyle === 'string'
        ? ctx.fillStyle
        : FLAT.gilt;
    drawOpenBinderTool(
      ctx,
      glyph,
      cx,
      cy,
      s * 2.05,
      colour,
      Math.max(ctx.lineWidth, s * 0.13),
    );
  };

  // Every shipping stamp takes the same broad open-tool lane. The historical
  // switch below remains an index-addressed archive for migration diagnosis,
  // but can no longer leak a tiny pictogram into a current spine.
  const activeGlyph = ornamentGlyph(kind);
  if (activeGlyph !== null) {
    openTool(activeGlyph);
    return;
  }

  // The historical switch stays useful as a drawing archive, but callers can
  // only reach the current binder's case. This is the final defence for old
  // SpineParams constructed outside `bookStyle.ts`.
  switch (normalizeOrnamentIndex(kind)) {
    case 0: { // diamond — an integrated heraldic lozenge tool
      shoulders(0, 0.67, 1.2);
      strokePts(ctx, [pt(0, -0.98), pt(0.67, 0), pt(0, 0.98), pt(-0.67, 0)], true);
      strokePts(ctx, [pt(0, -0.56), pt(0.38, 0), pt(0, 0.56), pt(-0.38, 0)], true);
      line(0, -0.56, 0, 0.56);
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
    case 2: { // star — a star-flower growing from a foliate binder's foot
      shoulders(0.82, 0.52, 1.18);
      line(0, 0.78, 0, 0.02);
      openLeaf(-0.42, 0.27, 0.19, 0.38, -0.86);
      openLeaf(0.42, 0.14, 0.19, 0.38, 0.86);
      const star: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 0.58 : 0.28;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        star.push(pt(Math.cos(a) * r, Math.sin(a) * r - 0.48));
      }
      strokePts(ctx, star, true);
      break;
    }
    case 3: { // arabesque — one mirrored S-scroll with leaf terminals
      // The discarded blot was literally a disease-like splatter. A binder's
      // arabesque earns the same amount of visual energy through a continuous
      // line: mirrored scrolls grow from one stem and close in four solid
      // leaves. There are no detached pips to become spots at shelf size.
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.96);
      ctx.quadraticCurveTo(cx - s * 0.08, cy + s * 0.26, cx - s * 0.62, cy + s * 0.18);
      ctx.quadraticCurveTo(cx - s * 1.02, cy + s * 0.1, cx - s * 0.7, cy - s * 0.34);
      ctx.quadraticCurveTo(cx - s * 0.48, cy - s * 0.64, cx - s * 0.15, cy - s * 0.5);
      ctx.moveTo(cx, cy + s * 0.96);
      ctx.quadraticCurveTo(cx + s * 0.08, cy + s * 0.26, cx + s * 0.62, cy + s * 0.18);
      ctx.quadraticCurveTo(cx + s * 1.02, cy + s * 0.1, cx + s * 0.7, cy - s * 0.34);
      ctx.quadraticCurveTo(cx + s * 0.48, cy - s * 0.64, cx + s * 0.15, cy - s * 0.5);
      ctx.stroke();
      blob(-0.68, -0.42, 0.34, 0.13, -0.62);
      blob(0.68, -0.42, 0.34, 0.13, 0.62);
      blob(-0.38, 0.28, 0.29, 0.12, 0.46);
      blob(0.38, 0.28, 0.29, 0.12, -0.46);
      fillPoly([pt(0, -1.02), pt(0.25, -0.56), pt(0, -0.23), pt(-0.25, -0.56)]);
      fillPoly([pt(-0.23, 0.9), pt(0, 0.64), pt(0.23, 0.9), pt(0, 1.08)]);
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
    case 5: { // sun — a classical rising-sun tool, never a full asterisk
      shoulders(0.64, 0.54, 1.18);
      line(-0.56, 0.64, 0.56, 0.64);
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.64, s * 0.5, Math.PI, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 5; i += 1) {
        const a = Math.PI * (1.12 + i * 0.19);
        strokePts(
          ctx,
          [
            pt(Math.cos(a) * 0.62, 0.64 + Math.sin(a) * 0.62),
            pt(Math.cos(a) * 1.02, 0.64 + Math.sin(a) * 1.02),
          ],
          false,
        );
      }
      break;
    }
    case 6: { // moon — crescent
      /*
       * The faintest mark in the whole table, measured: 3.8% of its own box,
       * the only one under the floor `shots-now/ornament-signatures.mjs`
       * reports. The lune was degenerate — the bite circle (centre +0.42,
       * r 0.62) reaches x = 1.04 while the disc it is cut out of only reaches
       * 0.85, so along the middle of the mark the crescent had NO body at all
       * and what survived was two hairline horns. Then it was filled at 0.8
       * alpha on top of that.
       *
       * Two full circles, the second wound the other way, is the construction
       * that cannot degenerate: the bite is always strictly inside the disc on
       * the far side, so the belly of the crescent is 0.6s wherever the horns
       * are. Solid ink, for the same reason as the blot above.
       */
      ctx.beginPath();
      ctx.arc(cx - s * 0.08, cy, s * 0.88, -Math.PI * 0.62, Math.PI * 0.62);
      ctx.arc(cx + s * 0.34, cy, s * 0.73, Math.PI * 0.62, -Math.PI * 0.62, true);
      ctx.closePath();
      ctx.stroke();
      bow(-0.04, 0, 0.58, -Math.PI * 0.58, Math.PI * 0.58);
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
    case 9: { // quill — one fat tilted vane, with the nib run out below it
      // The old recipe traced a thin vane AROUND a curved shaft and then
      // stroked the shaft over it. At the size this is actually struck (s≈9,
      // an ordinary octavo) the vane was a couple of pixels deep and the whole
      // mark collapsed to a bare diagonal slash. Fill beats stroke: the feather
      // has to BE a solid shape, not an outline drawn around a line.
      blob(0.12, -0.26, 0.6, 0.26, -0.62);
      // The nib. Only the stretch below the vane shows — inside it the stroke
      // is the same ink as the fill — and that is exactly the bit that says pen.
      line(-0.66, 0.84, 0.36, -0.46);
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
    case 11: { // crescent & star
      // Built from the SAME arc pair as the moon (case 6), which is the one
      // construction here proven to hold its horns. The bespoke pair this used
      // to carry cut a lune only a pixel or two deep at s≈9 and broke into a
      // squiggle; there is no reason for two crescents in one table to be
      // drawn two different ways.
      // …and it inherited the moon's degenerate lune along with the idea. Same
      // two-full-circles fix, pulled left and down so the star has its corner.
      // Smaller and pushed into its own corner, because the fix made it the
      // same fat crescent as case 6 and the pair of them read as one mark.
      ctx.beginPath();
      ctx.arc(cx - s * 0.3, cy + s * 0.28, s * 0.68, 0, Math.PI * 2, false);
      ctx.arc(cx + s * 0.14, cy + s * 0.28, s * 0.62, 0, Math.PI * 2, true);
      ctx.fill();
      // ONE star, and a big one. The old pair put a 0.19 sparkle on the shelf,
      // which at this size is a speck of dirt rather than a second mark.
      const sr = 0.42;
      tracePoly(
        ctx,
        [pt(0.5, -0.62 - sr), pt(0.5 + sr * 0.44, -0.62), pt(0.5, -0.62 + sr), pt(0.5 - sr * 0.44, -0.62)],
        true,
      );
      ctx.fill();
      break;
    }

    /* ---------------------------- the brass ------------------------------ */

    case 12: { // fleuron — the printer's leaf, a three-lobed palmette
      openTool('fleuron');
      break;
    }
    case 13: { // acorn — a complete oak sprig, not an isolated nut pictogram
      shoulders(0.88, 0.46, 1.18);
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.88);
      ctx.bezierCurveTo(cx - s * 0.1, cy + s * 0.32, cx + s * 0.14, cy - s * 0.34, cx, cy - s * 0.92);
      ctx.stroke();
      openLeaf(-0.42, 0.28, 0.22, 0.46, -0.86);
      openLeaf(0.4, -0.14, 0.22, 0.45, 0.86);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy - s * 0.48);
      ctx.quadraticCurveTo(cx, cy - s * 0.7, cx + s * 0.34, cy - s * 0.48);
      ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.12, cx, cy + s * 0.04);
      ctx.quadraticCurveTo(cx - s * 0.3, cy - s * 0.12, cx - s * 0.34, cy - s * 0.48);
      ctx.stroke();
      line(-0.32, -0.48, 0.32, -0.48);
      break;
    }
    case 14: { // thistle
      // Spikes struck from ONE point at the crown of the bulb; fanned from the
      // bulb's edge instead they splay into something like a hand.
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.2;
        line(0, 0.1, Math.cos(a) * 0.58, 0.1 + Math.sin(a) * 0.86);
      }
      blob(0, 0.4, 0.42, 0.42);
      blob(-0.46, 0.86, 0.3, 0.12, -0.45);
      blob(0.46, 0.86, 0.3, 0.12, 0.45);
      break;
    }
    case 15: { // anchor
      ring(0, -0.76, 0.22);
      line(0, -0.52, 0, 0.62);
      line(-0.52, -0.26, 0.52, -0.26);
      bow(0, 0.16, 0.72, Math.PI * 0.12, Math.PI * 0.88);
      line(-0.7, 0.26, -0.9, 0.06);
      line(0.7, 0.26, 0.9, 0.06);
      break;
    }
    case 16: { // key
      ring(0, -0.58, 0.34);
      line(0, -0.22, 0, 0.96);
      line(0, 0.5, 0.44, 0.5);
      line(0, 0.78, 0.32, 0.78);
      break;
    }
    case 17: { // compass rose
      openTool('compass');
      break;
    }
    case 18: { // bee
      blob(0, 0.2, 0.32, 0.5);
      disc(0, -0.48, 0.2);
      blob(-0.5, -0.14, 0.4, 0.19, -0.7);
      blob(0.5, -0.14, 0.4, 0.19, 0.7);
      line(-0.1, -0.64, -0.28, -0.94);
      line(0.1, -0.64, 0.28, -0.94);
      break;
    }
    case 19: { // scallop shell — ribs seated into a flat binder's ledge
      shoulders(0.68, 0.52, 1.2);
      line(-0.54, 0.68, 0.54, 0.68);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.86, cy + s * 0.56);
      ctx.quadraticCurveTo(cx - s * 0.72, cy - s * 0.62, cx, cy - s * 0.88);
      ctx.quadraticCurveTo(cx + s * 0.72, cy - s * 0.62, cx + s * 0.86, cy + s * 0.56);
      ctx.lineTo(cx + s * 0.5, cy + s * 0.68);
      ctx.lineTo(cx - s * 0.5, cy + s * 0.68);
      ctx.closePath();
      ctx.stroke();
      for (const [bx, ex, ey] of [
        [-0.38, -0.56, -0.46], [-0.18, -0.28, -0.7], [0, 0, -0.84],
        [0.18, 0.28, -0.7], [0.38, 0.56, -0.46],
      ] as const) {
        line(bx, 0.64, ex, ey);
      }
      break;
    }
    case 20: { // crown
      openTool('crown');
      break;
    }
    case 21: { // lyre
      // The arms must bow OUTSIDE the strings and the crossbar overhang them,
      // or the three parts close up into a shield with lines ruled on it.
      strokePts(ctx, [pt(-0.26, 0.72), pt(-0.7, 0.3), pt(-0.9, -0.3), pt(-0.62, -0.66)], false);
      strokePts(ctx, [pt(0.26, 0.72), pt(0.7, 0.3), pt(0.9, -0.3), pt(0.62, -0.66)], false);
      line(-0.78, -0.62, 0.78, -0.62);
      for (const sx of [-0.22, 0, 0.22]) line(sx, -0.56, sx, 0.6);
      fillPoly([pt(-0.44, 0.72), pt(0.44, 0.72), pt(0.3, 0.98), pt(-0.3, 0.98)]);
      break;
    }
    case 22: { // hourglass
      fillPoly([pt(-0.6, -0.82), pt(0.6, -0.82), pt(0, 0)]);
      fillPoly([pt(-0.6, 0.82), pt(0.6, 0.82), pt(0, 0)]);
      line(-0.76, -0.94, 0.76, -0.94);
      line(-0.76, 0.94, 0.76, 0.94);
      break;
    }
    case 23: { // rosette — eight petals with the bays cut between them
      openTool('rosette');
      break;
    }
    case 24: { // trefoil
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        disc(Math.cos(a) * 0.5, Math.sin(a) * 0.5 - 0.1, 0.4);
      }
      line(0, 0.42, 0, 1);
      break;
    }
    case 25: { // quatrefoil
      // Lobes just barely overlapping. At the obvious spacing (offset 0.5,
      // radius 0.46) four circles in one ink merge into a rounded square.
      // Pushed further out again, because at 0.58/0.44 the four bays were
      // shallower than the five of `heraldic rose` and the two read as one
      // mark: a quatrefoil is a CROSS of lobes, and the cross is the bays.
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 2;
        disc(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0.42);
      }
      break;
    }
    case 26: { // fleur-de-lis
      openTool('fleur-de-lis');
      break;
    }
    case 27: { // ivy leaf
      /*
       * A five-lobed leaf on a stalk a fifth of a pixel wide is a LOLLIPOP at
       * the size this is struck, and it was: a round head over a stick, sitting
       * in the same cluster as the rosette, the trefoil and the pine cone.
       *
       * Ivy is recognised by its NOTCHES, and a notch has to be a third of the
       * mark to exist at 15px. Three deep points, two deep bays, a heart-cut
       * base — one silhouette, no stalk. The stalk is the part nobody can see
       * and the part that was making it a lollipop.
       */
      // Five equal points is a STAR, which is what the first attempt at this
      // drew and what the board showed — checked, not assumed. An ivy leaf is
      // THREE lobes over a notch with the tip hanging down: one long point at
      // the foot, two shoulders, and a bay cut into the head between them.
      fillPoly([
        pt(0, 1),
        pt(0.72, 0.12),
        pt(0.98, -0.62),
        pt(0.32, -0.5),
        pt(0, -0.98),
        pt(-0.32, -0.5),
        pt(-0.98, -0.62),
        pt(-0.72, 0.12),
      ]);
      break;
    }
    case 28: { // oak leaf
      // 7.5% of its own box — one of the smallest marks in the table, and a
      // 0.26 wobble on a 0.62 radius is a scalloped edge rather than the deep
      // paired lobes an oak leaf is known by. Bigger, and cut nearly twice as
      // deep, so the lobes survive the downsample.
      const lobes: Pt[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        // 0.44 of 0.74 is a five-pointed star, not a lobed leaf — the board
        // said so. 0.28 is a lobe you can see that is still an edge, not a point.
        const r = 0.78 + 0.28 * Math.cos(5 * a);
        lobes.push(pt(Math.sin(a) * r * 0.74, -Math.cos(a) * r * 1.1));
      }
      fillPoly(lobes);
      break;
    }
    case 29: { // wheatsheaf — one ear of wheat, not a bundle
      /*
       * Six grains 0.28 × 0.13 either side of a hairline stem, plus a tie: at
       * 15px that is a PLUS SIGN with a dot on it, filed in with the keyhole,
       * the key and the anchor. Fewer grains, much fatter, swept up hard, and
       * a stem thick enough to be a stem — an ear of wheat is a feathered
       * spike, and the feathering is the whole recognition.
       *
       * A sheaf proper (bound in the middle, flaring at both ends) was the
       * other way to draw it and would have collided with the hourglass, which
       * is exactly that outline.
       */
      strokePts(ctx, [pt(0, 1), pt(0, -0.1)], false);
      // Swept up and held APART: at 0.42 long on a 0.3 offset the four pairs
      // ran into each other and the ear came out as one solid spade. The gap
      // between grains is the feathering, and the feathering is the mark.
      for (let i = 0; i < 4; i++) {
        const y = -0.14 - i * 0.3;
        blob(-0.26, y, 0.36, 0.15, -1.05);
        blob(0.26, y, 0.36, 0.15, 1.05);
      }
      blob(0, -0.9, 0.15, 0.3);
      break;
    }
    case 30: { // pomegranate
      disc(0, 0.2, 0.68);
      for (let i = 0; i < 4; i++) {
        const a = -Math.PI / 2 + (i - 1.5) * 0.42;
        line(0, -0.42, Math.cos(a) * 0.46, -0.42 + Math.sin(a) * 0.62);
      }
      break;
    }
    case 31: { // tulip
      fillPoly([
        pt(-0.56, -0.42),
        pt(-0.34, -0.98),
        pt(-0.12, -0.46),
        pt(0, -0.96),
        pt(0.12, -0.46),
        pt(0.34, -0.98),
        pt(0.56, -0.42),
        pt(0.3, 0.06),
        pt(-0.3, 0.06),
      ]);
      line(0, 0.06, 0, 1);
      blob(-0.34, 0.56, 0.3, 0.12, -0.45);
      blob(0.34, 0.66, 0.3, 0.12, 0.45);
      break;
    }
    case 32: { // heraldic rose
      // Five overlapping discs became one near-solid coin at shelf size. A
      // heraldic rose is the five PETALS and their bays, so each petal is a
      // separate broad strike around a small boss; the paper-coloured gaps do
      // more work than another interior line ever could at fifteen pixels.
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        blob(Math.cos(a) * 0.64, Math.sin(a) * 0.64, 0.33, 0.23, a);
      }
      disc(0, 0, 0.18);
      break;
    }
    case 33: { // comet — a head and one wedge of tail
      // Three parallel strokes behind a disc read as a SLASH: the strokes are
      // the same ink as the head, they touch it, and the eye joins the lot into
      // one diagonal bar. The table's own rule is one silhouette — so the tail
      // is a wedge that starts at the head's width and runs out to a point,
      // which is also what a comet's tail does.
      // …and a SHORT wide wedge under a big head is a ladle. The tail has to
      // be much longer than the head is wide, and run out to an actual point.
      fillPoly([
        pt(0.5, -0.3),
        pt(-1, 0.94),
        pt(0.12, -0.66),
      ]);
      disc(0.5, -0.52, 0.36);
      break;
    }
    case 34: { // lantern
      fillPoly([pt(-0.42, -0.32), pt(0.42, -0.32), pt(0.52, 0.5), pt(-0.52, 0.5)]);
      fillPoly([pt(-0.56, -0.34), pt(0.56, -0.34), pt(0.3, -0.62), pt(-0.3, -0.62)]);
      fillPoly([pt(-0.62, 0.52), pt(0.62, 0.52), pt(0.62, 0.72), pt(-0.62, 0.72)]);
      bow(0, -0.68, 0.24, Math.PI, Math.PI * 2);
      break;
    }
    case 35: { // inkpot
      fillPoly([pt(-0.56, 0.12), pt(0.56, 0.12), pt(0.64, 0.9), pt(-0.64, 0.9)]);
      fillPoly([pt(-0.28, -0.2), pt(0.28, -0.2), pt(0.32, 0.12), pt(-0.32, 0.12)]);
      line(-0.4, -0.2, 0.4, -0.2);
      line(0.1, -0.24, 0.72, -0.96);
      blob(0.78, -1.02, 0.14, 0.08, -0.85);
      break;
    }
    case 36: { // open book
      fillPoly([pt(-0.96, -0.28), pt(-0.06, -0.56), pt(-0.06, 0.5), pt(-0.96, 0.74)]);
      fillPoly([pt(0.96, -0.28), pt(0.06, -0.56), pt(0.06, 0.5), pt(0.96, 0.74)]);
      break;
    }
    case 37: { // spectacles
      ring(-0.52, 0.02, 0.4);
      ring(0.52, 0.02, 0.4);
      strokePts(ctx, [pt(-0.12, -0.02), pt(0, -0.2), pt(0.12, -0.02)], false);
      line(-0.92, -0.06, -1.06, -0.4);
      line(0.92, -0.06, 1.06, -0.4);
      break;
    }
    case 38: { // pine cone — stroked, so the scales read
      const shell: Pt[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        shell.push(pt(Math.sin(a) * 0.46, -Math.cos(a) * 0.76 + 0.08));
      }
      strokePts(ctx, shell, true);
      for (let i = 0; i < 3; i++) {
        const y = -0.34 + i * 0.36;
        strokePts(ctx, [pt(-0.34, y), pt(0, y + 0.22), pt(0.34, y)], false);
      }
      line(-0.12, -0.7, -0.28, -1);
      line(0.12, -0.7, 0.28, -1);
      break;
    }
    case 39: { // beehive (skep)
      bow(0, 0.62, 0.88, Math.PI, Math.PI * 2);
      line(-0.88, 0.62, 0.88, 0.62);
      for (let i = 1; i <= 3; i++) bow(0, 0.62, 0.88 - i * 0.22, Math.PI, Math.PI * 2);
      disc(0, 0.44, 0.15);
      break;
    }
    case 40: { // butterfly — ONE waisted silhouette, not four merging blobs
      // Four overlapping ellipses plus a body line was the obvious build and
      // the wrong one: in a single ink the overlaps fuse, the body line is
      // invisible against the fill it sits on, and at s≈9 the whole thing came
      // out a lumpy disc with two antennae. Wings only read if the OUTLINE
      // says butterfly — so the notches at head and tail do the work the
      // (invisible) body line was supposed to do.
      fillPoly([
        pt(0, -0.34),
        pt(0.38, -0.94),
        pt(0.94, -0.58),
        pt(0.62, -0.04),
        pt(0.92, 0.5),
        pt(0.38, 0.9),
        pt(0, 0.32),
        pt(-0.38, 0.9),
        pt(-0.92, 0.5),
        pt(-0.62, -0.04),
        pt(-0.94, -0.58),
        pt(-0.38, -0.94),
      ]);
      break;
    }
    case 41: { // swallow — a side-on bird, not a mirrored moustache
      strokePts(
        ctx,
        [
          pt(1, -0.16), // beak
          pt(0.62, -0.34),
          pt(0.34, -0.28),
          pt(-0.18, -0.92), // high swept wing
          pt(-0.48, -0.72),
          pt(-0.24, -0.14),
          pt(-0.98, 0.12), // forked tail
          pt(-0.46, 0.28),
          pt(-0.88, 0.66),
          pt(-0.08, 0.4),
          pt(0.48, 0.28),
          pt(0.72, 0.04),
        ],
        true,
      );
      strokePts(ctx, [pt(-0.2, -0.66), pt(0.12, -0.12), pt(0.46, 0.12)], false);
      disc(0.58, -0.17, 0.07);
      break;
    }
    case 42: { // fish — stroked outline, one filled eye
      strokePts(
        ctx,
        [pt(0.82, 0), pt(0.32, -0.4), pt(-0.2, -0.36), pt(-0.5, 0), pt(-0.2, 0.36), pt(0.32, 0.4)],
        true,
      );
      strokePts(ctx, [pt(-0.5, 0), pt(-0.98, -0.42), pt(-0.98, 0.42)], true);
      disc(0.44, -0.12, 0.11);
      break;
    }
    case 43: { // anthemion — a classical seven-leaf palmette
      // This replaces the nailed horseshoe. Each leaf shares one foot, so the
      // fan reads as a single brass impression rather than a repeated symbol.
      // Filled lancets retain their hierarchy after the shelf downsample.
      const leaves = [
        [-0.78, -0.4, -0.18, 0.14],
        [-0.54, -0.72, -0.12, 0.08],
        [-0.28, -0.94, -0.07, 0.02],
        [0, -1.08, 0, -0.04],
        [0.28, -0.94, 0.07, 0.02],
        [0.54, -0.72, 0.12, 0.08],
        [0.78, -0.4, 0.18, 0.14],
      ] as const;
      for (const [tx, ty, bx, by] of leaves) {
        fillPoly([
          pt(0, 0.38),
          pt(bx - 0.11, by + 0.08),
          pt(tx, ty),
          pt(bx + 0.11, by + 0.08),
        ]);
      }
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.86, cy + s * 0.18);
      ctx.quadraticCurveTo(cx - s * 0.62, cy + s * 0.72, cx, cy + s * 0.58);
      ctx.quadraticCurveTo(cx + s * 0.62, cy + s * 0.72, cx + s * 0.86, cy + s * 0.18);
      ctx.stroke();
      fillPoly([pt(-0.58, 0.66), pt(0, 0.52), pt(0.58, 0.66), pt(0.42, 0.88), pt(-0.42, 0.88)]);
      fillPoly([pt(-0.32, 0.9), pt(0.32, 0.9), pt(0.2, 1.08), pt(-0.2, 1.08)]);
      break;
    }
    case 44: { // bell
      fillPoly([
        pt(-0.68, 0.52),
        pt(-0.48, -0.1),
        pt(-0.22, -0.6),
        pt(0.22, -0.6),
        pt(0.48, -0.1),
        pt(0.68, 0.52),
      ]);
      fillPoly([pt(-0.8, 0.52), pt(0.8, 0.52), pt(0.8, 0.7), pt(-0.8, 0.7)]);
      bow(0, -0.68, 0.18, Math.PI, Math.PI * 2);
      disc(0, 0.88, 0.14);
      break;
    }
    case 45: { // little ship
      fillPoly([pt(-0.92, 0.44), pt(0.92, 0.44), pt(0.6, 0.86), pt(-0.6, 0.86)]);
      line(0, 0.44, 0, -0.96);
      fillPoly([pt(0.07, -0.84), pt(0.07, 0.3), pt(0.76, 0.3)]);
      fillPoly([pt(-0.07, -0.58), pt(-0.07, 0.3), pt(-0.64, 0.3)]);
      break;
    }
    case 46: { // mountain
      fillPoly([pt(-1, 0.7), pt(-0.36, -0.5), pt(-0.06, -0.04), pt(0.26, -0.86), pt(1, 0.7)]);
      break;
    }
    case 47: { // wave
      for (let row = 0; row < 3; row++) {
        const y = -0.5 + row * 0.5;
        const run: Pt[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          run.push(pt(-1 + t * 2, y + Math.sin(t * Math.PI * 2 + row * 0.6) * 0.22));
        }
        strokePts(ctx, run, false);
      }
      break;
    }
    case 48: { // snowflake
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const ax = Math.cos(a);
        const ay = Math.sin(a);
        line(0, 0, ax, ay);
        for (const side of [-0.6, 0.6]) {
          const b = a + side;
          line(ax * 0.58, ay * 0.58, ax * 0.58 + Math.cos(b) * 0.36, ay * 0.58 + Math.sin(b) * 0.36);
        }
      }
      disc(0, 0, 0.13);
      break;
    }
    case 49: { // heart
      const heart: Pt[] = [];
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        const hx = Math.pow(Math.sin(t), 3);
        const hy =
          -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
        heart.push(pt(hx * 1.02, hy * 1.02));
      }
      fillPoly(heart);
      break;
    }
    case 50: { // owl — horned head, two great eyes and a distinct feathered body
      strokePts(ctx, [
        pt(-0.82, 0),
        pt(-0.82, -0.68),
        pt(-0.64, -1),
        pt(-0.38, -0.74),
        pt(0, -0.82),
        pt(0.38, -0.74),
        pt(0.64, -1),
        pt(0.82, -0.68),
        pt(0.82, 0),
        pt(0.54, 0.22),
        pt(0, 0.32),
        pt(-0.54, 0.22),
      ], true);
      ctx.beginPath();
      ctx.ellipse(cx, cy + 0.52 * s, 0.54 * s, 0.52 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      ring(-0.3, -0.3, 0.27);
      ring(0.3, -0.3, 0.27);
      disc(-0.3, -0.3, 0.07);
      disc(0.3, -0.3, 0.07);
      fillPoly([pt(0, -0.04), pt(0.16, 0.18), pt(-0.16, 0.18)]);
      strokePts(ctx, [pt(-0.44, 0.38), pt(-0.18, 0.82), pt(0, 0.92)], false);
      strokePts(ctx, [pt(0.44, 0.38), pt(0.18, 0.82), pt(0, 0.92)], false);
      break;
    }
    case 51: { // stag — shield-like head and antlers kept outside it
      fillPoly([
        pt(0, -0.55),
        pt(0.42, -0.2),
        pt(0.28, 0.62),
        pt(0, 0.98),
        pt(-0.28, 0.62),
        pt(-0.42, -0.2),
      ]);
      for (const side of [-1, 1]) {
        line(side * 0.22, -0.42, side * 0.62, -0.98);
        line(side * 0.42, -0.7, side * 0.84, -0.7);
        line(side * 0.56, -0.88, side * 0.86, -1.08);
      }
      break;
    }
    case 52: { // fox — the unmistakable mask, not a miniature animal scene
      strokePts(
        ctx,
        [
          pt(-0.92, -0.9),
          pt(-0.36, -0.58),
          pt(0, -0.74),
          pt(0.36, -0.58),
          pt(0.92, -0.9),
          pt(0.7, 0.18),
          pt(0, 0.94),
          pt(-0.7, 0.18),
        ],
        true,
      );
      fillPoly([pt(-0.48, -0.18), pt(-0.12, 0.02), pt(-0.5, 0.18)]);
      fillPoly([pt(0.48, -0.18), pt(0.12, 0.02), pt(0.5, 0.18)]);
      disc(0, 0.48, 0.13);
      break;
    }
    case 53: { // cat — seated in profile, with its tail clearly outside
      fillPoly([
        pt(-0.28, 0.88),
        pt(-0.42, 0.48),
        pt(-0.36, 0.04),
        pt(-0.14, -0.28),
        pt(-0.2, -0.62),
        pt(0.02, -0.94), // near ear
        pt(0.18, -0.62),
        pt(0.52, -0.86), // far ear
        pt(0.5, -0.5),
        pt(0.82, -0.28), // muzzle
        pt(0.5, -0.08),
        pt(0.4, 0.68),
        pt(0.68, 0.9),
      ]);
      ctx.save();
      ctx.lineWidth = Math.max(1.4, ctx.lineWidth * 1.45);
      strokePts(ctx, [pt(-0.18, 0.68), pt(-0.72, 0.46), pt(-0.82, -0.14), pt(-0.56, -0.46)], false);
      ctx.restore();
      break;
    }
    case 54: { // hare — side profile, swept ears and a separate white-tail cue
      blob(-0.16, 0.42, 0.64, 0.48, -0.08);
      blob(0.42, -0.18, 0.34, 0.3, -0.08);
      blob(0.2, -0.68, 0.16, 0.58, -0.34);
      blob(0.46, -0.68, 0.13, 0.5, -0.18);
      fillPoly([pt(0.62, -0.3), pt(0.98, -0.1), pt(0.62, 0.02)]);
      disc(-0.78, 0.3, 0.16);
      break;
    }
    case 55: { // moth — separate swept wings, long body and visible antennae
      strokePts(ctx, [
        pt(-0.18, -0.46),
        pt(-0.94, -0.82),
        pt(-0.78, 0.02),
        pt(-0.38, 0.66),
        pt(-0.16, 0.16),
      ], true);
      strokePts(ctx, [
        pt(0.18, -0.46),
        pt(0.94, -0.82),
        pt(0.78, 0.02),
        pt(0.38, 0.66),
        pt(0.16, 0.16),
      ], true);
      fillPoly([pt(-0.14, -0.5), pt(0.14, -0.5), pt(0.18, 0.7), pt(0, 1), pt(-0.18, 0.7)]);
      disc(0, -0.68, 0.2);
      line(-0.08, -0.82, -0.48, -1);
      line(0.08, -0.82, 0.48, -1);
      break;
    }
    case 56: { // fern frond — one curved rachis, paired solid leaflets
      strokePts(ctx, [pt(-0.28, 0.98), pt(-0.08, 0.38), pt(0.08, -0.3), pt(0, -1)], false);
      for (let i = 0; i < 5; i++) {
        const y = 0.55 - i * 0.32;
        const reach = 0.62 - i * 0.07;
        blob(-reach * 0.56, y + 0.05, reach * 0.48, 0.13, -0.42);
        blob(reach * 0.56, y - 0.08, reach * 0.48, 0.13, 0.42);
      }
      break;
    }
    case 57: { // ginkgo — a fan with a shallow cleft and long stem
      fillPoly([
        pt(0, -0.08),
        pt(-0.82, -0.42),
        pt(-0.92, -0.9),
        pt(-0.38, -0.78),
        pt(0, -1),
        pt(0.38, -0.78),
        pt(0.92, -0.9),
        pt(0.82, -0.42),
      ]);
      ctx.save();
      ctx.lineWidth = Math.max(1.2, ctx.lineWidth * 1.2);
      line(0, -0.12, 0, 1);
      ctx.restore();
      break;
    }
    case 58: { // mushroom — one cap and one broad stem
      ctx.beginPath();
      ctx.ellipse(cx, cy - 0.3 * s, 0.92 * s, 0.55 * s, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(cx + 0.92 * s, cy - 0.18 * s);
      ctx.lineTo(cx - 0.92 * s, cy - 0.18 * s);
      ctx.closePath();
      ctx.fill();
      fillPoly([pt(-0.3, -0.16), pt(0.3, -0.16), pt(0.48, 0.92), pt(-0.48, 0.92)]);
      break;
    }
    case 59: { // telescope — short optical tube over a bold triangular tripod
      strokePts(ctx, [
        pt(-0.62, -0.62),
        pt(0.5, -0.36),
        pt(0.42, -0.06),
        pt(-0.7, -0.34),
      ], true);
      strokePts(ctx, [pt(0.46, -0.42), pt(0.8, -0.34), pt(0.7, 0.02), pt(0.38, -0.06)], true);
      strokePts(ctx, [pt(-0.64, -0.6), pt(-0.9, -0.64), pt(-0.96, -0.4), pt(-0.7, -0.34)], true);
      disc(0, -0.02, 0.17);
      ctx.save();
      ctx.lineWidth = Math.max(1.5, ctx.lineWidth * 1.55);
      strokePts(ctx, [pt(0, 0.1), pt(-0.68, 0.96), pt(0.64, 0.96), pt(0, 0.1)], false);
      line(0, 0.1, 0, 0.96);
      ctx.restore();
      break;
    }
    case 60: { // globe — sphere, meridian and a proper stand
      ring(0, -0.22, 0.7);
      ctx.beginPath();
      ctx.ellipse(cx, cy - 0.22 * s, 0.3 * s, 0.7 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
      bow(0, -0.22, 0.7, Math.PI * 0.08, Math.PI * 0.92);
      line(0, 0.5, 0, 0.82);
      line(-0.5, 0.92, 0.5, 0.92);
      break;
    }
    case 61: { // classical column — capital, shaft and stepped base
      fillPoly([pt(-0.78, -0.94), pt(0.78, -0.94), pt(0.62, -0.68), pt(-0.62, -0.68)]);
      fillPoly([pt(-0.44, -0.62), pt(0.44, -0.62), pt(0.32, 0.62), pt(-0.32, 0.62)]);
      fillPoly([pt(-0.58, 0.62), pt(0.58, 0.62), pt(0.74, 0.9), pt(-0.74, 0.9)]);
      break;
    }
    case 62: { // torch — detached pointed flame, broad cup and tapered footed grip
      fillPoly([
        pt(0, -1.22),
        pt(-0.12, -0.78),
        pt(-0.48, -0.5),
        pt(-0.36, -0.18),
        pt(0, -0.1),
        pt(0.42, -0.28),
        pt(0.5, -0.62),
        pt(0.2, -0.96),
      ]);
      fillPoly([pt(-0.66, 0.14), pt(0.66, 0.14), pt(0.32, 0.4), pt(-0.32, 0.4)]);
      fillPoly([pt(-0.2, 0.36), pt(0.2, 0.36), pt(0.12, 0.9), pt(-0.12, 0.9)]);
      fillPoly([pt(-0.3, 0.9), pt(0.3, 0.9), pt(0.22, 1.04), pt(-0.22, 1.04)]);
      break;
    }
    case 63: { // balance scales — one beam, two bowls, no fine chains
      line(0, -0.8, 0, 0.82);
      line(-0.86, -0.48, 0.86, -0.48);
      fillPoly([pt(-0.92, 0.18), pt(-0.34, 0.18), pt(-0.48, 0.46), pt(-0.78, 0.46)]);
      fillPoly([pt(0.92, 0.18), pt(0.34, 0.18), pt(0.48, 0.46), pt(0.78, 0.46)]);
      line(-0.72, -0.46, -0.78, 0.18);
      line(-0.48, -0.46, -0.34, 0.18);
      line(0.72, -0.46, 0.78, 0.18);
      line(0.48, -0.46, 0.34, 0.18);
      fillPoly([pt(-0.48, 0.82), pt(0.48, 0.82), pt(0.7, 1), pt(-0.7, 1)]);
      break;
    }
    case 64: { // castle — a single battlement silhouette
      fillPoly([
        pt(-0.92, 0.88),
        pt(-0.92, -0.72),
        pt(-0.56, -0.72),
        pt(-0.56, -0.36),
        pt(-0.22, -0.36),
        pt(-0.22, -0.78),
        pt(0.22, -0.78),
        pt(0.22, -0.36),
        pt(0.56, -0.36),
        pt(0.56, -0.72),
        pt(0.92, -0.72),
        pt(0.92, 0.88),
      ]);
      break;
    }
    case 65: { // lamp of learning — symmetric oil bowl and centred flame
      fillPoly([pt(-0.76, 0.08), pt(0.76, 0.08), pt(0.54, 0.56), pt(-0.54, 0.56)]);
      fillPoly([pt(-0.34, -0.06), pt(0.34, -0.06), pt(0.24, 0.1), pt(-0.24, 0.1)]);
      strokePts(ctx, [
        pt(0, -0.06),
        pt(-0.28, -0.48),
        pt(0, -1),
        pt(0.28, -0.48),
      ], true);
      strokePts(ctx, [pt(-0.62, 0.58), pt(-0.44, 0.78), pt(0.44, 0.78), pt(0.62, 0.58)], false);
      break;
    }

    default: { // an index from a future table: the house diamond, never nothing
      strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
      break;
    }
  }
}

/* ---------------------------- the block edge ------------------------------ */

const EDGE_GROUND_HEX: Readonly<Record<EdgeGround, string>> = {
  cream: FLAT.cream,
  creamDeep: FLAT.creamDeep,
  gilt: FLAT.gilt,
  giltPale: FLAT.giltPale,
  timber: FLAT.timber,
  terracotta: FLAT.terracotta,
  slate: FLAT.slate,
  sage: FLAT.sage,
  moss: FLAT.moss,
  plum: FLAT.plum,
  ochre: FLAT.ochre,
  ink: FLAT.ink,
};

/**
 * Trace the text block's silhouette, which is where `cut` lives.
 *
 * Only the FORE edge (the right-hand side) is ever seen — the boards overlap
 * the rest — so that is the only side the cut is spent on. A rough block steps
 * in and out down that edge; a deckle block bulges out in shallow scallops,
 * the paper's own untrimmed selvedge. Both are cut at a scale of the block's
 * WIDTH rather than its height, because the sliver is four or five px across
 * and a notch measured off the height would swallow it whole.
 */
function traceBlockEdge(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: EdgeCut,
  seed: number,
): void {
  if (cut === 'smooth') {
    wobbleRect(ctx, x, y, w, h, w * 0.4, seed);
    return;
  }
  const rnd = mulberry32((seed ^ 0x9e37) >>> 0);
  const r = Math.min(w * 0.4, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  if (cut === 'rough') {
    // A knife, not a guillotine: steps of a third of the width, none of them
    // the same depth, and never so deep that the strip loses its line.
    const steps = Math.max(4, Math.round(h / Math.max(3, w * 1.5)));
    for (let i = 1; i <= steps; i++) {
      const ey = y + r + ((h - r * 2) * i) / steps;
      ctx.lineTo(x + w - rnd() * w * 0.34, ey - (h - r * 2) / (steps * 2));
      ctx.lineTo(x + w - rnd() * w * 0.2, ey);
    }
  } else {
    // Deckle: shallow arcs bulging PAST the edge, so the feather reads as the
    // sheet's own edge rather than as damage.
    const steps = Math.max(4, Math.round(h / Math.max(4, w * 2.2)));
    const span = (h - r * 2) / steps;
    for (let i = 0; i < steps; i++) {
      const y0 = y + r + span * i;
      ctx.quadraticCurveTo(x + w + w * (0.16 + rnd() * 0.2), y0 + span / 2, x + w, y0 + span);
    }
  }
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw the sliver of text block that shows past the boards.
 *
 * **This is the whole of what an edge treatment ever gets.** `art/covers.ts`
 * lays the block at `pageW = max(4, w * 0.055)` and then overlaps 38% of it
 * with the board, so on the Book Studio's 142px board the reader sees a strip
 * FIVE PIXELS wide and the height of the book. Everything below is sized off
 * `w` for that reason: a mark measured in absolute px, or off the height, is
 * either invisible or eats the strip.
 *
 * Composed the same way a plate is — ground → leaves → pattern → gild — so the
 * fifty entries are fifty compositions of six slots rather than fifty branches.
 * The pattern is clipped to the block and drawn from `visibleFrom` outward,
 * because the inner half is under the board and marks put there are marks
 * nobody can see. (That is not a guess: the first cut of the speckled edge in
 * `covers.ts` centred its flecks and they were invisible on the shelf.)
 *
 * Flat rules hold: every mark is a flat fill or a flat stroke in one of the
 * palette's colours, the halo on `shell` is a second flat face rather than a
 * blur, and nothing here reads a light direction.
 */
export function drawBlockEdge(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spec: EdgeSpec,
  seed: number,
  opts: { visibleFrom?: number } = {},
): void {
  const from = x + w * (opts.visibleFrom ?? 0.38);
  const span = x + w - from;
  const mid = (from + x + w) / 2;
  const ground = EDGE_GROUND_HEX[spec.ground];
  const mark = EDGE_GROUND_HEX[spec.mark];
  const mark2 = EDGE_GROUND_HEX[spec.mark2];
  const rnd = mulberry32((seed ^ 0x5ed6) >>> 0);
  const ink = Math.max(0.8, inkWidth(w) * 0.9);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* ---- ground ---- */
  traceBlockEdge(ctx, x, y, w, h, spec.cut, seed);
  ctx.fillStyle = ground;
  ctx.fill();
  ctx.strokeStyle = FLAT.ink;
  ctx.lineWidth = ink;
  ctx.stroke();

  /* ---- the leaves, two pale rules down the outer half ---- */
  // The icon draws the block as leaves rather than as a slab, and these two
  // lines are the whole of that. They go UNDER the pattern: a marbling laid on
  // top of them is a marbling laid on paper, which is what it is.
  const leaf =
    spec.ground === 'gilt' || spec.ground === 'giltPale'
      ? FLAT.ochreDark
      : spec.ground === 'ink' || spec.ground === 'slate' || spec.ground === 'plum'
        ? FLAT.ink
        : FLAT.creamDeep;
  const rule = Math.max(0.7, w * 0.09);
  for (const t of [0.58, 0.82]) {
    inkLine(ctx, x + w * t, y + h * 0.05, x + w * t, y + h * 0.95, leaf, rule, seed + t * 10);
  }

  /* ---- pattern, clipped inside the block ---- */
  if (spec.pattern !== 'none' && spec.density > 0) {
    ctx.save();
    traceBlockEdge(ctx, x, y, w, h, spec.cut, seed);
    ctx.clip();
    const d = clamp(spec.density, 0, 1);
    const dot = (dx: number, dy: number, r: number, colour: string): void => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const tooth = (dy: number, colour: string, weight: number, from0 = from): void => {
      inkLine(ctx, from0, dy, x + w + w * 0.1, dy, colour, weight, seed + dy);
    };

    switch (spec.pattern) {
      case 'fleck': {
        // Flicked from a brush: nothing lines up, and the drop sizes vary.
        // The floor on the radius is what makes this survive — a drop of
        // `w * 0.07` on a five-px strip is a third of a pixel, and the first
        // cut of this board came back with a speckle nobody could see.
        const n = Math.max(6, Math.round((h / Math.max(2.4, w * 0.9)) * d));
        for (let i = 0; i < n; i++) {
          dot(
            from + rnd() * span * 0.9,
            y + h * ((i + rnd()) / n),
            Math.max(0.85, w * (0.12 + rnd() * 0.12)),
            rnd() < 0.72 ? mark : mark2,
          );
        }
        break;
      }
      case 'sprinkle': {
        // Finer and denser than a fleck, and in two colours by definition.
        const n = Math.max(10, Math.round((h / Math.max(1.8, w * 0.55)) * d));
        for (let i = 0; i < n; i++) {
          dot(
            from + rnd() * span * 0.9,
            y + h * ((i + rnd()) / n),
            Math.max(0.7, w * (0.09 + rnd() * 0.07)),
            i % 2 === 0 ? mark : mark2,
          );
        }
        break;
      }
      case 'comb': {
        // Even teeth of colour, alternating the two pigments. The step is what
        // separates a wide comb from a nonpareil, so it rides `density`.
        const step = Math.max(1.6, w * (1.5 - d));
        let i = 0;
        for (let dy = y + step; dy < y + h; dy += step, i++) {
          tooth(dy, i % 2 === 0 ? mark : mark2, Math.max(0.7, w * 0.16));
        }
        break;
      }
      case 'wave': {
        // Rocked as it lifts: the same teeth, but each one starts further in.
        const step = Math.max(2, w * (1.7 - d));
        let i = 0;
        for (let dy = y + step; dy < y + h; dy += step, i++) {
          const phase = Math.sin(i * 0.9) * 0.5 + 0.5;
          tooth(
            dy + Math.sin(i * 0.9) * step * 0.3,
            i % 2 === 0 ? mark : mark2,
            Math.max(0.7, w * 0.16),
            from + span * phase * 0.5,
          );
        }
        break;
      }
      case 'stone': {
        // Thrown on and broken into islands: blobs, not dots, and they touch.
        const n = Math.max(5, Math.round((h / Math.max(4, w * 2.2)) * (0.5 + d)));
        for (let i = 0; i < n; i++) {
          const by = y + h * ((i + 0.5) / n) + (rnd() * 2 - 1) * h * 0.02;
          ctx.fillStyle = i % 2 === 0 ? mark : mark2;
          ctx.beginPath();
          ctx.ellipse(
            mid + (rnd() * 2 - 1) * span * 0.3,
            by,
            span * (0.35 + rnd() * 0.3),
            h * (0.012 + rnd() * 0.02),
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        break;
      }
      case 'shell': {
        // Each drop haloed in pale — a SECOND FLAT FACE under the drop, not a
        // glow. That is the one construction that makes shell read as shell
        // rather than as a fleck at this width.
        const n = Math.max(5, Math.round((h / Math.max(4.5, w * 2.4)) * (0.5 + d)));
        for (let i = 0; i < n; i++) {
          const by = y + h * ((i + 0.5) / n);
          const bx = mid + (rnd() * 2 - 1) * span * 0.22;
          const r = Math.max(1, span * (0.36 + rnd() * 0.16));
          dot(bx, by, r * 1.5, spec.ground === 'cream' ? FLAT.creamDeep : FLAT.cream);
          dot(bx, by, r, i % 2 === 0 ? mark : mark2);
        }
        break;
      }
      case 'band': {
        // Broad bands stacked head to tail, filling the strip — NOT stripes
        // floating on the ground. Contiguous is what lets one pattern serve
        // both ends of the vocabulary: at n = 2 it is `two-tone` (head one
        // colour, tail another, meeting halfway) and at n = 4 it is `agate`.
        // Where the spec names only one mark the second band falls back to the
        // ground, so `red-under-gold` burns red through gold rather than
        // painting red on red.
        const n = Math.max(2, Math.round(1 + d * 4));
        const second = mark2 === mark ? ground : mark2;
        const bh = h / n;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 === 0 ? mark : second;
          ctx.fillRect(from - w * 0.1, y + bh * i, span + w * 0.2, bh + 0.6);
        }
        break;
      }
      case 'stripe': {
        // Fine ticking the whole length, one colour, tight.
        const step = Math.max(1.4, w * (1.1 - d * 0.6));
        for (let dy = y + step; dy < y + h; dy += step) {
          tooth(dy, mark, Math.max(0.6, w * 0.12));
        }
        break;
      }
      case 'cheque': {
        // A small checker: two columns across the visible strip, offset rows.
        const cell = Math.max(1.6, span * 0.5);
        let row = 0;
        for (let dy = y; dy < y + h; dy += cell, row++) {
          for (let k = 0; k < 2; k++) {
            if ((row + k) % 2 !== 0) continue;
            ctx.fillStyle = k === 0 ? mark : mark2;
            ctx.fillRect(from + cell * k, dy, cell, cell);
          }
        }
        break;
      }
      case 'ripple': {
        // Water run down the block: long wavering verticals, not horizontals.
        const lines = Math.max(2, Math.round(2 + d * 2));
        for (let i = 0; i < lines; i++) {
          const bx = from + span * ((i + 0.5) / lines);
          ctx.strokeStyle = i % 2 === 0 ? mark : mark2;
          ctx.lineWidth = Math.max(0.6, w * 0.11);
          ctx.beginPath();
          ctx.moveTo(bx, y);
          const segs = 6;
          for (let k = 1; k <= segs; k++) {
            const t = k / segs;
            ctx.quadraticCurveTo(
              bx + (rnd() * 2 - 1) * span * 0.4,
              y + h * (t - 0.5 / segs),
              bx + (rnd() * 2 - 1) * span * 0.18,
              y + h * t,
            );
          }
          ctx.stroke();
        }
        break;
      }
      case 'scene': {
        // Hills and a sky in three colours and no more, painted on the fanned
        // block. At five px across that is exactly as much picture as fits.
        ctx.fillStyle = mark2;
        ctx.fillRect(from - w * 0.1, y, span + w * 0.2, h * 0.44);
        ctx.fillStyle = mark;
        ctx.beginPath();
        ctx.moveTo(from - w * 0.1, y + h * 0.52);
        for (let k = 0; k <= 6; k++) {
          const t = k / 6;
          ctx.quadraticCurveTo(
            from + span * (t + 0.08),
            y + h * (0.4 + (k % 2 === 0 ? 0.02 : 0.1)),
            from - w * 0.1 + (span + w * 0.2) * t,
            y + h * 0.5,
          );
        }
        ctx.lineTo(x + w + w * 0.1, y + h);
        ctx.lineTo(from - w * 0.1, y + h);
        ctx.closePath();
        ctx.fill();
        // One tiny sun, the only thing small enough to survive being a detail.
        dot(mid, y + h * 0.22, Math.max(0.8, span * 0.3), FLAT.giltPale);
        break;
      }
      default: {
        // hatch: short diagonals, the gauffering tool's lattice at this width.
        const step = Math.max(2, w * (1.3 - d * 0.5));
        let i = 0;
        for (let dy = y; dy < y + h; dy += step, i++) {
          const dir = i % 2 === 0 ? 1 : -1;
          inkLine(
            ctx,
            from,
            dy,
            x + w,
            dy + step * 0.8 * dir,
            i % 2 === 0 ? mark : mark2,
            Math.max(0.6, w * 0.12),
            seed + dy,
          );
        }
        break;
      }
    }
    ctx.restore();
  }

  /* ---- gild ---- */
  // Foil is a flat band of the palette's gold laid ON the block, with the
  // darker ochre for its own edge — a second flat face, never a highlight.
  if (spec.gild !== 'none') {
    ctx.save();
    traceBlockEdge(ctx, x, y, w, h, spec.cut, seed);
    ctx.clip();
    const gold =
      spec.foil !== undefined
        ? EDGE_GROUND_HEX[spec.foil]
        : spec.ground === 'gilt'
          ? FLAT.giltPale
          : FLAT.gilt;
    // The foil's own edge is a DARKER FLAT FACE of the same metal, which is
    // the house's whole depth model. Silver takes creamDeep for it; anything
    // warm takes the dark ochre.
    const foilEdge = gold === FLAT.cream ? FLAT.creamDeep : FLAT.ochreDark;
    if (spec.gild === 'top' || spec.gild === 'all') {
      const cap = Math.max(1.6, h * 0.014);
      ctx.fillStyle = gold;
      ctx.fillRect(x, y, w, cap);
      inkLine(ctx, x, y + cap, x + w, y + cap, foilEdge, Math.max(0.6, w * 0.1), seed + 3);
    }
    if (spec.gild === 'fore' || spec.gild === 'all') {
      const band = Math.max(1, w * 0.3);
      ctx.fillStyle = gold;
      ctx.fillRect(x + w - band, y, band, h);
      inkLine(
        ctx,
        x + w - band,
        y + h * 0.03,
        x + w - band,
        y + h * 0.97,
        foilEdge,
        Math.max(0.6, w * 0.09),
        seed + 4,
      );
    }
    ctx.restore();
  }

  ctx.restore();
}

/* ========================================================================== *
 *                        drawing one spine, flat                             *
 * ========================================================================== */

/**
 * Every pigment mapped onto a book cloth in `art/flat.ts`'s CLOTHS.
 *
 * The cloth comes from `palette` rather than from the raw seed on purpose:
 * `palette` is the field a book's colour identity has always lived in, so a
 * book that was amber stays amber.
 *
 * ## This table is why the pigment names used to lie
 *
 * There were six cloths and twenty pigments, so fourteen of the twenty names
 * were decoration: "Oxblood" folded onto terracotta, the same cloth every
 * unstyled book already wore, and the studio's swatch row had to be cut down
 * to six entries because the other fourteen repainted nothing. The Welcome
 * book shipped the wrong colour behind exactly that fold — authored oxblood,
 * drawn terracotta — and neither the compiler nor a test caught it.
 *
 * ## What fifty cloths actually bought
 *
 * Twenty-six of the fifty pigments now land on a cloth of the SAME NAME, which
 * is the whole point of the change: Oxblood paints oxblood, Aubergine paints
 * aubergine, Plum finally paints plum.
 *
 * The other twenty-four land on the nearest cloth by eye, because `art/flat.ts`
 * has no cloth of that name to give them. That is not laziness in this table —
 * it is a real gap between two vocabularies that were drawn independently. The
 * cloths run rich in bright greens, cyans and pinks (Emerald, Turquoise,
 * Magenta, Blossom, Apricot are the five no pigment can reach) and thin in the
 * deep browns and near-blacks a library is mostly made of: there is exactly ONE
 * dark brown (Chestnut) for Chocolate, Chestnut and Umber to share, and exactly
 * one near-black (Graphite) for Ink and Charcoal. Closing that gap means adding
 * cloths in `art/flat.ts`, not shuffling numbers here.
 *
 * ## Why this is not written as `pigment N wears cloth N`
 *
 * It was, and it was wrong for forty-one of the fifty. Both tables are ordered
 * append-only and both keep the icon's six cloths at 0–5, and from that it
 * looked as though the two would stay in lockstep. They do not and cannot:
 * `flat.ts` groups its fifty by hue family (all the reds, then the yellows,
 * then the greens…) while `PIGMENTS` grows in the order colours were needed.
 * Index parity between two independently ordered tables is a coincidence, and
 * writing it down as a contract is how "Oxblood" came to paint apricot.
 *
 * So every row below is stated explicitly, and `PIGMENT_CLOTH_NAMES` reads the
 * result back out of `flat.ts`'s own labels — if a cloth is renamed or the
 * order changes again, the mismatch is a value a test can see rather than a
 * comment that has quietly gone stale.
 */
const CLOTH_FOR_PIGMENT: readonly number[] = [
  /* ---- the twenty-six that carry their own name ---- *
     Read these as the table's spine. Everything else is an approximation; these
     are the rows where the studio's caption and the drawn cloth are the same
     word, and they are what "fifty cloths" was for. */
  9, //  0 Amber        → Tangerine   · golden orange; Ochre is its namesake's
  0, //  1 Terracotta   → Terracotta  ✔ (house)
  5, //  2 Moss         → Moss        ✔ (house)
  31, //  3 Dusty blue  → Denim       · 209°/26/55 against 210°/28/46
  2, //  4 Plum         → Plum        ✔ (house)
  3, //  5 Ochre        → Ochre       ✔ (house)
  4, //  6 Sage         → Sage        ✔ (house)
  8, //  7 Rust         → Rust        ✔
  44, //  8 Clay        → Camel       · the muted mid-brown
  18, //  9 Olive       → Olive       ✔
  1, // 10 Slate        → Slate       ✔ (house)
  11, // 11 Blush       → Blush       ✔
  7, // 12 Oxblood      → Oxblood     ✔ — the fold this whole change existed for
  33, // 13 Navy        → Ink blue    · the deepest formal blue on offer
  20, // 14 Forest      → Forest      ✔
  45, // 15 Tan         → Sand        · tan and sand are the same cloth twice
  46, // 16 Cream       → Bone        · the warm off-white
  49, // 17 Ink         → Graphite    · pigment is 12% sat, so read as neutral
  26, // 18 Teal        → Teal        ✔
  13, // 19 Saffron     → Saffron     ✔
  42, // 20 Burgundy    → Claret      · 347°/37/47 against 338°/44/31
  6, // 21 Vermilion    → Vermilion   ✔
  10, // 22 Coral       → Coral       ✔
  41, // 23 Rose        → Rose        ✔
  37, // 24 Aubergine   → Aubergine   ✔
  35, // 25 Amethyst    → Violet      · the light-purple slot
  36, // 26 Lavender    → Lavender    ✔
  38, // 27 Heather     → Mulberry    · muted mauve, the nearest heather there is
  34, // 28 Indigo      → Indigo      ✔
  32, // 29 Lapis       → Cobalt      · 220°/52/53 against 222°/56/43
  30, // 30 Storm       → Cornflower  · hue is right, value is not; only mid blue
  28, // 31 Sky         → Sky         ✔
  27, // 32 Peacock     → Peacock     ✔
  24, // 33 Verdigris   → Verdigris   ✔
  22, // 34 Jade        → Jade        ✔
  23, // 35 Celadon     → Seafoam     · the pale blue-green
  17, // 36 Fern        → Leaf        ✔ in all but spelling
  19, // 37 Bottle green→ Bottle green ✔
  16, // 38 Chartreuse  → Pistachio   · 80°/47/61 against 76°/46/53
  14, // 39 Buttercup   → Butter      ✔ in all but spelling
  15, // 40 Straw       → Lemon       · the pale-yellow slot
  43, // 41 Chocolate   → Chestnut    · see the note on browns above
  43, // 42 Chestnut    → Chestnut    ✔
  43, // 43 Umber       → Chestnut    · the only dark brown, shared three ways
  3, // 44 Bronze       → Ochre       · 37°/57/52 against 36°/50/41
  47, // 45 Linen       → Ash         · the pale neutral, shared with Oyster
  47, // 46 Oyster      → Ash         · 35°/14/74 against 38°/14/72
  29, // 47 Dove        → Mist        · the one pale cool neutral
  48, // 48 Pewter      → Pewter      ✔
  49, // 49 Charcoal    → Graphite    · shared with Ink, the only near-black
];

/**
 * The name of the cloth each pigment actually paints, index-aligned with
 * `PIGMENT_LABELS`.
 *
 * Read out of `art/flat.ts`'s own `CLOTH_LABELS` rather than restated here, so
 * it cannot go stale: this is the honest answer to "the studio says Oxblood —
 * what colour is the book?", and comparing it against `PIGMENT_LABELS` is how a
 * test sees the fold drifting instead of a reader seeing it on a shelf.
 *
 * The predecessor of this export ran the other way — it declared what `flat.ts`
 * SHOULD name each slot — and that inversion is precisely how forty-one
 * pigments came to lie: a comment cannot impose an order on another module, and
 * when `flat.ts` grouped its fifty by hue instead, nothing anywhere noticed.
 */
export const PIGMENT_CLOTH_NAMES: readonly string[] = CLOTH_FOR_PIGMENT.map(
  (slot) => CLOTH_LABELS[slot % CLOTH_LABELS.length] ?? '',
);

/**
 * THE palette → cloth rule, for the spine and the cover alike.
 *
 * It lives here because the table above is index-aligned with `PALETTES`, but
 * `covers.ts` imports it rather than folding `palette` onto six cloths its own
 * way. That is not tidiness: a book's spine on the shelf and its board in the
 * pull-out both derive their colour from the same `palette` integer, and two
 * different foldings of it mean a book that changes colour when you pick it
 * up. (It did — the spine used this table while the cover used `palette % 6`,
 * so an amber book was ochre on the shelf and terracotta in your hand.)
 *
 * Wrapping happens at the pigment slots first, so `palette` keeps its full
 * range as a knob (`COVER_PALETTE_COUNT` must therefore stay equal to
 * `PIGMENT_COUNT`), and only then lands inside CLOTHS. Negative and fractional
 * inputs normalise rather than falling off the end.
 *
 * The trailing `% CLOTHS.length` is what makes this safe while `art/flat.ts`
 * is still growing its palette: against six cloths the fifty pigments fold
 * back onto six the way they always did, against fifty they are one-to-one,
 * and against any count in between nothing throws and nothing goes blank.
 */
export function clothForPalette(palette: number): number {
  const n = CLOTH_FOR_PIGMENT.length;
  const slot = ((Math.trunc(palette) % n) + n) % n;
  return (CLOTH_FOR_PIGMENT[slot] ?? 0) % CLOTHS.length;
}


/**
 * The ornament stamp, struck straight onto the cloth.
 *
 * `drawOrnament` was always pure paths — no gradient, no tile — so the twelve
 * stamps survive the restyle intact. All that changes is the ink: one flat
 * colour, gilt on a gilded book and soft ink otherwise, with none of the
 * stencil/foil/relief machinery that used to composite it.
 */
function drawSpineOrnament(
  ctx: Ctx2D,
  decor: DesignBox,
  params: SpineParams,
  top: number,
  bottom: number,
  scale: number,
): void {
  // `top`/`bottom` are the binding's OWN free compartment, not a fixed
  // fraction of the height. The old floor of 0.79 was right for one dressing
  // and wrong for the rest: on a corded book it lands on a cord, and on a half
  // binding 0.30 puts the stamp on the leather rather than in the panel.
  // A binder's tool must occupy most of a 30px shelf spine to retain its
  // negative space. The former 0.30W cap reduced even the authored open tools
  // to isolated 15px pictograms; 0.38W yields a 75–80% broad strike.
  const size = Math.min(decor.w * 0.38, 15 * scale, (bottom - top) / 2.2);
  if (size < 2.4 || decor.w < 12) return;
  const preferred = normaliseHex(params.emblemHex ?? params.toolingHex)
    ?? (params.gilt ? FLAT.gilt : FLAT.inkSoft);
  const ground = normaliseHex(params.spineBaseHex ?? params.clothHex)
    ?? CLOTHS[clothForPalette(params.palette)]?.[0]
    ?? FLAT.cream;
  const colour = colourContrast(preferred, ground) >= 2.35
    ? preferred
    : [FLAT.ink, FLAT.cream, FLAT.gilt].reduce((best, candidate) =>
        colourContrast(candidate, ground) > colourContrast(best, ground) ? candidate : best,
      preferred);
  ctx.save();
  ctx.lineWidth = Math.max(1, size * 0.17);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  drawOrnament(
    ctx,
    normalizeOrnamentIndex(params.ornament),
    decor.x + decor.w / 2,
    (top + bottom) / 2,
    size,
    mulberry32((params.seed ^ 0x0c17) >>> 0),
  );
  ctx.restore();
}

export interface RenderSpineOptions {
  /**
   * Retained for worker-message compatibility. Spines no longer carry text,
   * so semantic zoom changes detail density without ever adding lettering.
   */
  hiRes?: boolean;

  /* ------------------------- accepted and ignored ------------------------- */
  /* These four described where a book stood in the room's light rig. Flat art
   * has no light model at all — a spine is the same colour wherever it stands,
   * and that is the whole point of the style, not an omission. They stay in
   * the signature because the shelf's bake jobs still carry them across the
   * worker boundary, and churning four files to delete a number that is
   * already free would buy no pixels. */

  /** Where this book sits along the row, 0 → 1. */
  rowPhase?: number;
  /** How far back in the shelf the book sits, 0 → 1. */
  depth?: number;
  /** The neighbouring spines' colours. */
  neighbourLeft?: string | null;
  neighbourRight?: string | null;
}

/** Resolve the exact binding object the spine renderer will paint. */
export function resolveSpineBinding(params: SpineParams): BookDesign {
  const seeded = flatSpineFor(params.seed);
  const ownBase = normaliseHex(params.spineBaseHex);
  return resolveBookDesign({
    seed: params.seed,
    cloth: ownBase ?? params.clothHex ?? clothForPalette(params.palette),
    // The dedicated role and the shared cloth can legitimately contain the
    // same hex. Keep their provenance: vellum/parchment stays naturally pale
    // while inherited, but accepts a restrained colour wash when the reader
    // explicitly picks the spine face.
    baseColourPinned: ownBase !== null,
    accent: params.spineAccentHex ?? undefined,
    tooling: params.toolingHex ?? null,
    emblem: params.emblemHex ?? null,
    hardware: params.hardwareHex ?? null,
    gilt: params.gilt,
    focusAt: seeded.labelAt,
    preset: params.binding ?? null,
    material: params.materialPinned === true ? materialLookFor(params.material) : null,
    bands: clamp(Math.round(params.raisedBands ?? 0), 0, MAX_RAISED_BANDS),
    bandGilt: params.bandGilt ?? params.gilt,
    headTail: params.headTail ? normalizeHeadTailStyle(params.headTailStyle) : null,
    wear: params.wear ?? 0,
  });
}

/**
 * Render one spine at (x, y) on `ctx`. hPx is the spine height in canvas px;
 * `scale` converts world px → canvas px (params.w * scale = drawn width).
 *
 * params.lean and params.hJitter are NOT applied here — spines are baked
 * upright into atlas rects; the shelf compositor applies lean/height when
 * placing the sprite.
 *
 * Layer order: binding construction → restrained tooling → one optional
 * ornament. Book titles now belong to the FRONT COVER only. Applied charms
 * are retired at both resolver and renderer boundaries, so no ribbon or
 * pennant can protrude above a shelf book.
 *
 * The binding is a THIRD axis on top of the params: `presetForSeed` gives every
 * book one vetted whole-book preset deterministically, and `params.binding`
 * pins it when the reader has chosen in the studio. Nothing here consults `flatScheme()` — a
 * book keeps its own colours in every room, which is what lets you recognise
 * it after a repaint.
 */
export function renderSpine(
  ctx: Ctx2D,
  params: SpineParams,
  x: number,
  y: number,
  hPx: number,
  scale: number,
  opts: RenderSpineOptions = {},
): void {
  const w = params.w * scale;
  const h = hPx;
  const design = resolveSpineBinding(params);
  const f = drawBookSpine(ctx, x, y, w, h, design, { noContact: false });

  if ((params.ornamentOn ?? true) && !bookPresetHasAuthoredFocal(params.binding ?? design.preset)) {
    drawSpineOrnament(ctx, f.decor, params, f.freeTop, f.freeBottom, scale);
  }

  // Keep future-facing render context live without restoring title pixels.
  void opts;
}

/* ========================================================================== *
 *                        shelf-row composition (§3)                          *
 * ========================================================================== *
 *
 * "Per shelf, generate a *composition*, not a row: choose a rhythm of
 *  thick/thin, tall/short, leaning/upright, proud/recessed; cluster similar
 *  bindings then break the pattern; leave occasional gaps and stacked-flat
 *  books."
 *
 * The old layout put every book in a slot of its own width with a 1–5px gap.
 * That is a *packing*, and packings look packed. What follows is a
 * composition: a plan of runs, each with a character, laid out left to right,
 * with the books ASSIGNED to runs by how well they suit the run's character
 * rather than taken in order.
 *
 * Everything here is pure and deterministic — same (books, seed) ⇒ identical
 * composition — so it can be unit-tested in node and cached by the shelf.
 */

/** How a book sits on the plank. */
export type BookPose =
  /** Standing square, the ordinary case. */
  | 'upright'
  /** Standing but tipped several degrees into an adjacent gap. */
  | 'leaning'
  /** Lying on its side in a stack, spine outward. */
  | 'flat'
  /** Standing, but pivoted a little so a corner of the board shows. */
  | 'angled';

/** The character of one run of books within a row. */
export type RunCharacter =
  /** A tight block of thin books — the row's rhythm section. */
  | 'thin-run'
  /** Ordinary mixed widths, the connective tissue. */
  | 'mixed'
  /** Two or three heavy tomes, the row's anchors. */
  | 'heavy'
  /** A cluster whose last book has fallen into the gap beside it. */
  | 'leaning-cluster'
  /** A short stack of books lying flat, filling a gap. */
  | 'flat-stack'
  /** Deliberately empty. */
  | 'gap';

/** One book handed to the composer. */
export interface RowBookInput {
  /** Stable id, echoed back on the placement (usually the book row id). */
  id: string;
  /** Art seed. */
  seed: number;
  /**
   * Pre-resolved params. When omitted the composer derives them from `seed`,
   * so a caller with no style overrides can pass an id and seed alone.
   */
  params?: SpineParams;
}

/** Where one book ended up. */
export interface RowPlacement {
  id: string;
  /** Index into the composer's input array. */
  index: number;
  params: SpineParams;
  /** Left edge of the book's footprint, world px from the row's origin. */
  x: number;
  /** Footprint width (the thickness, widened when the book leans). */
  width: number;
  /** Drawn spine height, world px. */
  height: number;
  /** Lean in degrees; positive tips the top to the right. */
  leanDeg: number;
  /**
   * Depth into the case: -1 pulled fully proud of the shelf edge,
   * 0 flush, +1 pushed to the back board. Feeds `renderSpine`'s `depth`
   * (remapped to 0–1) and the contact shadow's gap.
   */
  depth: number;
  /** 0–1 along the row, for `renderSpine`'s `rowPhase`. */
  phase: number;
  pose: BookPose;
  /** Which run this book belongs to. */
  run: number;
  runCharacter: RunCharacter;
  /** For `flat` books: how high off the plank the book lies, world px. */
  stackY: number;
  /** Empty width immediately after this book, world px. */
  gapAfter: number;
}

/** An empty stretch of plank. */
export interface RowGap {
  x: number;
  width: number;
  /** True when the gap exists because a book leans into it. */
  leanedInto: boolean;
}

/** The finished composition. */
export interface ShelfRowComposition {
  placements: RowPlacement[];
  /** Gaps between runs, for flora and props to grow into. */
  gaps: RowGap[];
  /** Total width consumed, world px. */
  width: number;
  /** Tallest drawn height in the row, world px. */
  maxHeight: number;
  /** Shortest drawn height in the row, world px. */
  minHeight: number;
  /** The run plan, in order — useful for tests and for debugging a bad row. */
  runs: RunCharacter[];
  /**
   * The row's skyline variation: (max - min) / max. The art direction asks for
   * 20–30%; the composer targets it explicitly and reports what it achieved.
   */
  skylineVariation: number;
  /** Ratio of the fattest book to the thinnest. */
  thicknessRatio: number;
}

export interface ComposeShelfRowOptions {
  /** Total width available, world px. Default 900. */
  width?: number;
  /** Composition seed. Same seed ⇒ same composition. */
  seed?: number;
  /**
   * Target skyline variation, (max-height − min-height) / max-height.
   * Default 0.26, the middle of the spec's 20–30%.
   */
  skylineTarget?: number;
  /** Allow books to lean. Default true. */
  lean?: boolean;
  /** Allow flat-stacked runs. Default true. */
  flatStacks?: boolean;
  /** Allow gaps. Default true. */
  gaps?: boolean;
  /** Minimum gap between two neighbouring upright books, world px. Default 0.6. */
  minKerf?: number;
}

/** Weighted pick of a run character, avoiding repeating the previous one. */
function pickRunCharacter(
  rnd: RandomFn,
  previous: RunCharacter | null,
  remaining: number,
  allowFlat: boolean,
  allowGap: boolean,
): RunCharacter {
  const table: Array<readonly [RunCharacter, number]> = [
    ['mixed', 30],
    ['thin-run', 20],
    ['heavy', 14],
    ['leaning-cluster', 14],
    ['flat-stack', allowFlat && remaining >= 2 ? 10 : 0],
    ['gap', allowGap ? 12 : 0],
  ];
  // A run never immediately repeats itself — that repetition is exactly the
  // "uniform slots" failure the art direction calls out. Two gaps in a row is
  // especially bad: it reads as a missing shelf, not as breathing room.
  const filtered = table.map(([c, wgt]) =>
    c === previous ? ([c, wgt * 0.12] as const) : ([c, wgt] as const),
  );
  let total = 0;
  for (const [, wgt] of filtered) total += wgt;
  if (total <= 0) return 'mixed';
  let acc = rnd() * total;
  for (const [c, wgt] of filtered) {
    acc -= wgt;
    if (acc < 0) return c;
  }
  return 'mixed';
}

/** How many books a run of this character wants. */
function runSize(character: RunCharacter, rnd: RandomFn, remaining: number): number {
  switch (character) {
    case 'gap':
      return 0;
    case 'heavy':
      return Math.min(remaining, 1 + Math.floor(rnd() * 2.4));
    case 'flat-stack':
      return Math.min(remaining, 2 + Math.floor(rnd() * 3));
    case 'thin-run':
      return Math.min(remaining, 3 + Math.floor(rnd() * 4));
    case 'leaning-cluster':
      return Math.min(remaining, 2 + Math.floor(rnd() * 3));
    default:
      return Math.min(remaining, 2 + Math.floor(rnd() * 4));
  }
}

/**
 * Score how well a book suits a run's character. Higher is better. This is
 * the compositional heart of the module: a shelf looks *arranged* because the
 * thin books ended up together and the tomes anchor the ends, not because
 * every book got its own equal slot.
 */
function suitability(params: SpineParams, character: RunCharacter): number {
  const bw = params.w;
  const bh = spineHeightPx(params);
  switch (character) {
    case 'thin-run':
      return 100 - bw * 2.2;
    case 'heavy':
      return bw * 2.4 + bh * 0.16;
    case 'flat-stack':
      // Flat books want to be wide-ish and NOT tall (a folio lying flat eats
      // the whole shelf).
      return bw * 1.1 - Math.abs(bh - 200) * 0.28;
    case 'leaning-cluster':
      // A leaning book should be slim enough to fall convincingly.
      return 60 - Math.abs(bw - 24) * 1.5;
    default:
      return 40 - Math.abs(bw - 30) * 0.6;
  }
}

/**
 * Compose a pleasing row.
 *
 * The pipeline:
 *  1. plan a sequence of runs (thin / mixed / heavy / leaning / flat / gap),
 *     never repeating a character back to back;
 *  2. assign books to runs by suitability, so like bindings cluster;
 *  3. break the pattern — swap members between long runs, because a perfectly
 *     sorted run is its own kind of uniform;
 *  4. fix the skyline: nudge heights until the row hits its variation target
 *     and no three neighbours share a height;
 *  5. lay out x positions, kerf, leans, depths and gaps;
 *  6. scale gaps to fill (or compress to fit) the available width.
 */
export function composeShelfRow(
  books: readonly RowBookInput[],
  opts: ComposeShelfRowOptions = {},
): ShelfRowComposition {
  const width = Math.max(60, opts.width ?? 900);
  const rnd = mulberry32(((opts.seed ?? 0x5e1f) ^ 0x9e3779b1) >>> 0);
  const allowLean = opts.lean !== false;
  const allowFlat = opts.flatStacks !== false;
  const allowGap = opts.gaps !== false;
  const minKerf = opts.minKerf ?? 0.6;
  const skylineTarget = clamp(opts.skylineTarget ?? 0.26, 0.05, 0.6);

  if (books.length === 0) {
    return {
      placements: [],
      gaps: [{ x: 0, width, leanedInto: false }],
      width: 0,
      maxHeight: 0,
      minHeight: 0,
      runs: ['gap'],
      skylineVariation: 0,
      thicknessRatio: 1,
    };
  }

  interface Candidate {
    input: RowBookInput;
    index: number;
    params: SpineParams;
    height: number;
  }

  const pool: Candidate[] = books.map((b, index) => {
    const params = b.params ?? deriveSpineParams(b.seed);
    return { input: b, index, params, height: spineHeightPx(params) };
  });

  /* ---------------- 1. plan the runs ---------------------------------- */
  const runs: RunCharacter[] = [];
  const runMembers: Candidate[][] = [];
  const unassigned = pool.slice();
  let previous: RunCharacter | null = null;
  let guard = 0;
  while (unassigned.length > 0 && guard++ < 400) {
    // Always open on something solid rather than a gap; a row that starts with
    // a hole reads as broken rather than as composed.
    const character: RunCharacter =
      runs.length === 0
        ? rnd() < 0.4
          ? 'heavy'
          : 'mixed'
        : pickRunCharacter(rnd, previous, unassigned.length, allowFlat, allowGap);
    previous = character;
    if (character === 'gap') {
      runs.push('gap');
      runMembers.push([]);
      continue;
    }
    const want = Math.max(1, runSize(character, rnd, unassigned.length));
    // 2. assign by suitability, with a little noise so the sort is not rigid.
    const scored = unassigned
      .map((c) => ({ c, s: suitability(c.params, character) + rnd() * 18 }))
      .sort((a, b) => b.s - a.s);
    const taken = scored.slice(0, want).map((entry) => entry.c);
    for (const t of taken) {
      const at = unassigned.indexOf(t);
      if (at >= 0) unassigned.splice(at, 1);
    }
    runs.push(character);
    runMembers.push(taken);
  }
  if (runs.length === 0) {
    runs.push('mixed');
    runMembers.push(pool.slice());
  }

  /* ---------------- 3. break the pattern ------------------------------ */
  // Swap one member between two long runs. A run of five perfectly graded
  // thin books is as machine-made as a run of five identical ones; the
  // reference always has one book that does not belong where it is.
  for (let i = 0; i < runMembers.length; i++) {
    const a = runMembers[i] as Candidate[];
    if (a.length < 3 || runs[i] === 'gap' || runs[i] === 'flat-stack') continue;
    for (let j = i + 1; j < runMembers.length; j++) {
      const b = runMembers[j] as Candidate[];
      if (b.length < 3 || runs[j] === 'gap' || runs[j] === 'flat-stack') continue;
      if (rnd() < 0.6) {
        const ai = Math.floor(rnd() * a.length);
        const bi = Math.floor(rnd() * b.length);
        const tmp = a[ai] as Candidate;
        a[ai] = b[bi] as Candidate;
        b[bi] = tmp;
      }
      break;
    }
  }

  // Shuffle within each run so suitability sorting does not leave a visible
  // monotone ramp of widths inside every cluster.
  for (const members of runMembers) {
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = members[i] as Candidate;
      members[i] = members[j] as Candidate;
      members[j] = tmp;
    }
  }

  /* ---------------- 4. fix the skyline -------------------------------- */
  const flatList = runMembers.flat();
  if (flatList.length >= 2) {
    let maxH = -Infinity;
    let minH = Infinity;
    for (const c of flatList) {
      maxH = Math.max(maxH, c.height);
      minH = Math.min(minH, c.height);
    }
    const variation = maxH > 0 ? (maxH - minH) / maxH : 0;
    if (variation < skylineTarget) {
      // Not enough spread: push the shortest down and the tallest up, in
      // proportion to how far each already sits from the row's mean, so the
      // skyline gains range without any book losing its format identity.
      const mean = flatList.reduce((s, c) => s + c.height, 0) / flatList.length;
      const need = (skylineTarget - variation) * maxH;
      const span = Math.max(1, maxH - minH);
      for (const c of flatList) {
        const away = c.height - mean;
        const push = Math.sign(away) * need * (0.35 + (Math.abs(away) / span) * 0.5);
        c.height = clamp(c.height + push, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
      }
    }
    // No three consecutive books within 3% of each other — the "irregular
    // skyline" note. A plateau of three is the eye's threshold for "these are
    // all the same height".
    for (let i = 2; i < flatList.length; i++) {
      const a = flatList[i - 2] as Candidate;
      const b = flatList[i - 1] as Candidate;
      const c = flatList[i] as Candidate;
      const near = (p: number, q: number): boolean => Math.abs(p - q) / Math.max(1, p) < 0.03;
      if (near(a.height, b.height) && near(b.height, c.height)) {
        const dir = rnd() < 0.5 ? -1 : 1;
        b.height = clamp(
          b.height + dir * b.height * (0.06 + rnd() * 0.08),
          SPINE_HEIGHT_RANGE.min,
          SPINE_HEIGHT_RANGE.max,
        );
      }
    }
  }

  /* ---------------- 5. lay out ---------------------------------------- */
  const placements: RowPlacement[] = [];
  const gaps: RowGap[] = [];
  let cursor = 0;

  for (let r = 0; r < runs.length; r++) {
    const character = runs[r] as RunCharacter;
    const members = runMembers[r] as Candidate[];

    if (character === 'gap') {
      const g = 14 + rnd() * 34;
      gaps.push({ x: cursor, width: g, leanedInto: false });
      cursor += g;
      continue;
    }

    if (character === 'flat-stack' && members.length >= 2) {
      // A flat stack: books lying on their sides, biggest at the bottom, each
      // one offset a little so the stack reads as hand-made. The stack's
      // FOOTPRINT is the tallest book's height; its own height is the sum of
      // the thicknesses. Real shelves are full of these and we had none.
      const sorted = [...members].sort((a, b) => b.height - a.height);
      const footprint = Math.max(...sorted.map((c) => c.height)) * 0.94;
      let stackY = 0;
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i] as Candidate;
        const jitterX = (rnd() * 2 - 1) * Math.min(10, footprint * 0.05);
        placements.push({
          id: c.input.id,
          index: c.index,
          params: c.params,
          x: cursor + jitterX + (footprint - c.height * 0.94) / 2,
          width: c.height * 0.94,
          height: c.params.w,
          leanDeg: (rnd() * 2 - 1) * 1.6,
          depth: 0.1 + rnd() * 0.3,
          phase: 0,
          pose: 'flat',
          run: r,
          runCharacter: character,
          stackY,
          gapAfter: 0,
        });
        stackY += c.params.w;
      }
      cursor += footprint + 2 + rnd() * 8;
      continue;
    }

    const leanLast =
      allowLean &&
      (character === 'leaning-cluster' || (character !== 'heavy' && rnd() < 0.16)) &&
      members.length >= 2;
    // A whole cluster shares a depth bias — books get pushed back in groups
    // when someone reshelves a handful at once.
    const runDepth = (rnd() * 2 - 1) * 0.42;

    for (let i = 0; i < members.length; i++) {
      const c = members[i] as Candidate;
      const isLast = i === members.length - 1;
      const doLean = leanLast && isLast;
      const leanDeg = doLean
        ? (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 9)
        : c.params.lean + (rnd() * 2 - 1) * 0.9;
      const rad = Math.abs(leanDeg) * (Math.PI / 180);
      // A leaning book occupies more floor: its footprint is the thickness
      // projected plus the height's contribution.
      const footprint = c.params.w * Math.cos(rad) + c.height * Math.sin(rad);
      // Per-book depth: the cluster bias plus the book's own `proud`, plus a
      // little noise. Recessed books gain AO and haze in renderSpine.
      const proud = (c.params.proud ?? 0) / 10;
      const depth = clamp(runDepth * 0.7 + proud * 0.8 + (rnd() * 2 - 1) * 0.18, -1, 1);
      // 'angled': a book pivoted so a sliver of its board shows. Rare, and
      // never on a leaner (that would read as a rendering bug).
      const pose: BookPose = doLean ? 'leaning' : rnd() < 0.07 ? 'angled' : 'upright';

      placements.push({
        id: c.input.id,
        index: c.index,
        params: c.params,
        x: cursor,
        width: footprint,
        height: c.height,
        leanDeg,
        depth,
        phase: 0,
        pose,
        run: r,
        runCharacter: character,
        stackY: 0,
        gapAfter: 0,
      });

      // Kerf: books inside a run touch. Only a leaner opens a real space.
      const kerf = isLast ? 0 : minKerf + rnd() * (character === 'thin-run' ? 0.8 : 2.2);
      cursor += footprint + kerf;
    }

    // A leaner needs somewhere to fall into.
    if (leanLast) {
      const last = placements[placements.length - 1] as RowPlacement;
      const g = Math.max(10, last.height * Math.sin(Math.abs(last.leanDeg) * (Math.PI / 180)) * 0.9);
      gaps.push({ x: cursor, width: g, leanedInto: true });
      cursor += g;
    } else if (r < runs.length - 1 && runs[r + 1] !== 'gap') {
      // Between two runs, a small breath.
      const g = 3 + rnd() * 9;
      gaps.push({ x: cursor, width: g, leanedInto: false });
      cursor += g;
    }
  }

  /* ---------------- 6. fit to the available width --------------------- */
  //
  // Density is a compositional property, not a leftover.
  //
  // The old version poured *all* the slack into the gaps, so a shelf given 26
  // books and 1200px of plank came back as five clumps separated by 90px
  // voids. That is the single most unfinished-looking thing the old row did,
  // and it is nothing like the reference, where the books are shoulder to
  // shoulder for the whole run with one or two deliberate holes.
  //
  // So the row is re-packed from scratch here rather than nudged: group the
  // placements (a flat stack is ONE group, since its books share an x range),
  // cap every space between groups at a plausible book-sized hole, spend any
  // remaining slack on making the books thicker, and only then admit a single
  // trailing hole — which is where a bookend or a trailing vine wants to be
  // anyway.
  {
    interface Group {
      members: RowPlacement[];
      x0: number;
      x1: number;
      /** Space to the next group in the original layout. */
      after: number;
      flat: boolean;
      leanedInto: boolean;
    }

    const byRun = new Map<number, RowPlacement[]>();
    for (const p of placements) {
      const key = p.pose === 'flat' ? p.run : p.index + 1e6;
      const list = byRun.get(key);
      if (list) list.push(p);
      else byRun.set(key, [p]);
    }
    const groups: Group[] = [];
    for (const members of byRun.values()) {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const m of members) {
        x0 = Math.min(x0, m.x);
        x1 = Math.max(x1, m.x + m.width);
      }
      groups.push({ members, x0, x1, after: 0, flat: members[0]?.pose === 'flat', leanedInto: false });
    }
    groups.sort((a, b) => a.x0 - b.x0);

    // A leaner needs the hole it is falling into; everything else is packed.
    const leanGap = new Set<number>();
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Group;
      const next = groups[i + 1];
      g.after = next ? Math.max(0, next.x0 - g.x1) : 0;
      const tipped = g.members.some((m) => Math.abs(m.leanDeg) > 4);
      if (tipped) leanGap.add(i);
      g.leanedInto = tipped;
    }

    const holeCap = Math.min(52, Math.max(20, width * 0.04));
    let spacing = groups.map((g, i) => {
      if (i === groups.length - 1) return 0;
      const tight = minKerf + (g.after > 0 ? Math.min(g.after, 3.2) : 0);
      return leanGap.has(i) ? Math.min(Math.max(g.after, 10), holeCap) : tight;
    });

    const bookSpan = (): number => groups.reduce((s, g) => s + (g.x1 - g.x0), 0);
    const spanTotal = (): number => bookSpan() + spacing.reduce((s, v) => s + v, 0);

    let slack = width - spanTotal();

    // 1. Fatten the books. Bounded at +38%: past that a duodecimo becomes a
    //    folio and the format identity the studio panel controls goes away.
    if (slack > 2) {
      const total = bookSpan();
      if (total > 1) {
        const k = Math.min(1.38, 1 + slack / total);
        if (k > 1.001) {
          for (const g of groups) {
            const gx0 = g.x0;
            for (const m of g.members) {
              const rel = m.x - gx0;
              if (m.pose === 'flat') {
                // A flat book's drawn "width" is its height lying down; leave
                // the volume alone and only re-anchor it.
                m.x = gx0 + rel * k;
              } else {
                m.x = gx0 + rel * k;
                m.width *= k;
                m.params = {
                  ...m.params,
                  w: clamp(m.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25),
                };
              }
            }
            g.x1 = gx0 + (g.x1 - gx0) * k;
          }
          slack = width - spanTotal();
        }
      }
    }

    // 2. Any slack left widens the holes, up to the cap.
    if (slack > 1 && groups.length > 1) {
      const holes = spacing.length - 1;
      const room = spacing.map((v, i) => (i < holes ? Math.max(0, holeCap - v) : 0));
      const roomTotal = room.reduce((s, v) => s + v, 0);
      if (roomTotal > 0.5) {
        const take = Math.min(slack, roomTotal);
        spacing = spacing.map((v, i) => v + (room[i] as number) * (take / roomTotal));
        slack = width - spanTotal();
      }
    }

    // 3. Overfull: squeeze the spaces, then the books.
    if (slack < 0) {
      const spaceTotal = spacing.reduce((s, v) => s + v, 0);
      const cut = Math.min(spaceTotal * 0.85, -slack);
      if (spaceTotal > 0.5) {
        const k = 1 - cut / spaceTotal;
        spacing = spacing.map((v) => v * k);
        slack = width - spanTotal();
      }
      if (slack < -1) {
        const total = bookSpan();
        const k = Math.max(0.55, (total + slack) / Math.max(1, total));
        for (const g of groups) {
          const gx0 = g.x0;
          for (const m of g.members) {
            const rel = m.x - gx0;
            m.x = gx0 + rel * k;
            if (m.pose !== 'flat') {
              m.width *= k;
              m.params = {
                ...m.params,
                w: clamp(m.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25),
              };
            }
          }
          g.x1 = gx0 + (g.x1 - gx0) * k;
        }
        slack = width - spanTotal();
      }
    }

    // 4. Re-pack left to right and rebuild the gap list from what is left.
    gaps.length = 0;
    let cur = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] as Group;
      const shift = cur - g.x0;
      for (const m of g.members) m.x += shift;
      g.x1 += shift;
      cur = g.x1;
      const gapW = spacing[i] as number;
      if (gapW > 4) gaps.push({ x: cur, width: gapW, leanedInto: g.leanedInto });
      cur += gapW;
      for (const m of g.members) m.gapAfter = gapW;
    }
    if (width - cur > 6) gaps.push({ x: cur, width: width - cur, leanedInto: false });
  }
  /* ---------------- finalize ------------------------------------------ */
  let maxHeight = 0;
  let minHeight = Infinity;
  let maxW = 0;
  let minW = Infinity;
  const total = Math.max(
    1,
    placements.reduce((s, p) => Math.max(s, p.x + p.width), 0),
  );
  for (const p of placements) {
    p.phase = clamp((p.x + p.width / 2) / total, 0, 1);
    const drawn = p.pose === 'flat' ? p.stackY + p.height : p.height;
    maxHeight = Math.max(maxHeight, drawn);
    minHeight = Math.min(minHeight, drawn);
    maxW = Math.max(maxW, p.params.w);
    minW = Math.min(minW, p.params.w);
  }
  // gapAfter, for flora and props.
  for (const p of placements) {
    const right = p.x + p.width;
    let best = 0;
    for (const g of gaps) {
      if (g.x >= right - 0.5 && g.x - right < 3) best = Math.max(best, g.width);
    }
    p.gapAfter = best;
  }
  if (!Number.isFinite(minHeight)) minHeight = 0;
  if (!Number.isFinite(minW)) minW = 1;

  return {
    placements,
    gaps,
    width: total,
    maxHeight,
    minHeight,
    runs,
    skylineVariation: maxHeight > 0 ? (maxHeight - minHeight) / maxHeight : 0,
    thicknessRatio: minW > 0 ? maxW / minW : 1,
  };
}
