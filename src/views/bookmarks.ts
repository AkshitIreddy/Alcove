/**
 * views/bookmarks.ts — ribbon bookmarks (roadmap #19) and the vocabulary they
 * are cut from.
 *
 * ## What is stored
 *
 * Both halves live inside the book's free-form `cover_meta` JSON:
 *
 *   cover_meta: {
 *     ...,
 *     bookmarks: [{ pageId, color, addedAt }, ...],   // which pages
 *     ribbon:    { cloth, weight, tail, material, charm, charmTone, preset },
 *   }
 *
 * `src/data/books.ts` (group A territory) has no bookmark helpers, so we code
 * defensively against the raw blob here: reads validate every field, writes go
 * through the public `updateBook` patch API and spread the rest of cover_meta
 * through untouched (cover art overrides, page defaults…).
 *
 * ## Why the ribbon is a design, not a colour
 *
 * The reader: *"user should have an option to customise their bookmarks with a
 * wide variety of options."* What shipped was six flat rectangles with one
 * fixed forked tail. This is the same treatment the case, the wall and the
 * bindings got — named entries, mood tags, drawn in the flat language, picked
 * from a strip that shows a handful and opens to the rest: a cloth, a weight,
 * a tail, a material and a charm, each its own table below (the tables are the
 * count — nothing here restates their length), with {@link RIBBON_PRESETS}
 * naming the combinations worth having and sorting them onto
 * {@link RIBBON_FAMILIES} so the picker classifies rather than just
 * enumerates.
 *
 * ## Why the ribbon paints itself through a stylesheet
 *
 * The ribbon a reader actually sees is a `<button class="nb-ribbon">` that
 * `BookView` renders and `spread.css` styles. A vocabulary this size cannot be
 * hand-written as static CSS, and the module that owns a vocabulary should own
 * its rendering — `bookDesign.ts` draws its own presets rather than asking the
 * shelf to. So {@link ribbonCss} prints the rules for the design in force and
 * {@link applyRibbonDesign} keeps one `<style>` element in `<head>` holding
 * them. It is generated from the same axis tables the picker reads and the
 * same polygons {@link ribbonSvg} previews, so the strip and the cover cannot
 * drift apart.
 *
 * The generated selectors are `:root .nb-ribbon[…]` rather than
 * `.nb-ribbon[…]`: `spread.css` already carries `.nb-ribbon[data-color='…']`
 * at (0,2,0), and matching that specificity would leave the winner to be
 * decided by sheet order — which is stable today and would silently invert the
 * day someone re-orders an import.
 */
import { createSignal } from 'solid-js';
import { getBook, updateBook } from '../data/books';
import type { Book } from '../data/types';

/* ========================================================================== *
 *                          which pages are marked                            *
 * ========================================================================== */

/**
 * The six per-mark slots.
 *
 * These are not really colours any more — they are positions in the chosen
 * cloth's own tonal run, so a row of ribbons in one book reads as one set
 * rather than as a paint chart. The names stay because they are what is
 * already written into every reader's `cover_meta`, and a stored `'moss'`
 * must keep meaning the same ribbon it meant before.
 */
export const RIBBON_COLORS = [
  'terracotta',
  'moss',
  'sky',
  'plum',
  'amber',
  'blush',
] as const;

export type RibbonColor = (typeof RIBBON_COLORS)[number];

export interface Bookmark {
  readonly pageId: string;
  readonly color: RibbonColor;
  /** ISO-8601 timestamp. */
  readonly addedAt: string;
}

const isRibbonColor = (value: unknown): value is RibbonColor =>
  typeof value === 'string' &&
  (RIBBON_COLORS as readonly string[]).includes(value);

/** Validated bookmarks from a book's cover_meta (corrupt entries dropped). */
export function readBookmarks(
  book: (Pick<Book, 'coverMeta'> & { readonly id?: string }) | null | undefined,
): Bookmark[] {
  // The book view's one call into this module on session load is also how the
  // ribbon skin learns which book is open — see `adoptRibbonBook`.
  adoptRibbonBook(book ?? null);
  const raw = book?.coverMeta?.bookmarks;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const { pageId, color, addedAt } = entry as Record<string, unknown>;
    if (typeof pageId !== 'string' || pageId === '' || seen.has(pageId)) {
      continue;
    }
    seen.add(pageId);
    out.push({
      pageId,
      color: isRibbonColor(color) ? color : 'terracotta',
      addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString(),
    });
  }
  return out;
}

/**
 * Toggle a page's bookmark in a list (pure). Adding picks the next palette
 * slot by cycle so neighbouring ribbons differ.
 */
export function toggleBookmark(
  bookmarks: readonly Bookmark[],
  pageId: string,
  now: Date = new Date(),
): Bookmark[] {
  const existing = bookmarks.filter((mark) => mark.pageId !== pageId);
  if (existing.length !== bookmarks.length) return existing;
  const color = RIBBON_COLORS[bookmarks.length % RIBBON_COLORS.length] as RibbonColor;
  return [...bookmarks, { pageId, color, addedAt: now.toISOString() }];
}

/** Merge a bookmark list into a cover_meta blob (pure, null-safe). */
export function mergeBookmarksIntoMeta(
  meta: Record<string, unknown> | null,
  bookmarks: readonly Bookmark[],
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  if (bookmarks.length === 0) delete next.bookmarks;
  else next.bookmarks = bookmarks.map((mark) => ({ ...mark }));
  return Object.keys(next).length > 0 ? next : null;
}

/** Persist a book's bookmark list (re-reads cover_meta to merge fresh). */
export async function saveBookmarks(
  bookId: string,
  bookmarks: readonly Bookmark[],
): Promise<void> {
  const book = await getBook(bookId);
  if (book === null) return;
  await updateBook(bookId, {
    coverMeta: mergeBookmarksIntoMeta(book.coverMeta, bookmarks),
  });
}

/* ========================================================================== *
 *                              the vocabulary                                *
 * ========================================================================== */

/** A word a reader might shop by. Shared across all five axes. */
export type RibbonTag =
  | 'quiet'
  | 'warm'
  | 'cool'
  | 'bright'
  | 'deep'
  | 'soft'
  | 'crisp'
  | 'plain'
  | 'ornate'
  | 'formal'
  | 'playful'
  | 'natural';

interface Named {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly RibbonTag[];
}

/* -------------------------------- cloths ---------------------------------- */

export interface RibbonCloth extends Named {
  /** The face of the ribbon. */
  readonly face: string;
  /** The fold: the same cloth turned, one flat step darker. */
  readonly fold: string;
}

const cloth = (
  id: string,
  name: string,
  face: string,
  fold: string,
  tags: readonly RibbonTag[],
): RibbonCloth => ({ id, name, face, fold, tags });

/**
 * The cloths, ordered warm → cool → neutral.
 *
 * The reader counted the old row: *"colours are still very few (whereever
 * colour is an option there are only like 8), like atleast 20"*. Every one is
 * a real dyed ribbon colour rather than a hue rotation of the last, and every
 * one sits in the app's warm-parchment register — a fluorescent ribbon on
 * aged paper reads as a bug, not as a choice.
 */
export const RIBBON_CLOTHS: readonly RibbonCloth[] = [
  cloth('postbox', 'Postbox', '#c0392b', '#8c2318', ['warm', 'bright']),
  cloth('ember', 'Ember', '#d4674c', '#8f3319', ['warm', 'bright']),
  cloth('terracotta', 'Terracotta', '#c96f4a', '#96421d', ['warm', 'natural']),
  cloth('rust', 'Rust', '#a85a32', '#6f3417', ['warm', 'deep']),
  cloth('clay', 'Clay', '#b98567', '#7d5138', ['warm', 'quiet']),
  cloth('marmalade', 'Marmalade', '#e08b2c', '#95500b', ['warm', 'bright']),
  cloth('honey', 'Honey', '#e8b64c', '#7d5806', ['warm', 'bright']),
  cloth('straw', 'Straw', '#dfc451', '#786608', ['warm', 'soft']),
  cloth('olive', 'Olive', '#8c8a3f', '#575618', ['natural', 'quiet']),
  cloth('moss', 'Moss', '#7d915c', '#4f6138', ['natural', 'quiet']),
  cloth('fern', 'Fern', '#5f8a53', '#33552c', ['natural', 'deep']),
  cloth('sage', 'Sage', '#9fae8b', '#61714e', ['natural', 'soft']),
  cloth('juniper', 'Juniper', '#4a7a63', '#26473a', ['cool', 'deep']),
  cloth('turquoise', 'Turquoise', '#5ea597', '#2c5f56', ['cool', 'bright']),
  cloth('lagoon', 'Lagoon', '#4f8b98', '#255560', ['cool', 'bright']),
  cloth('sky', 'Sky', '#5f7d8c', '#3a5666', ['cool', 'quiet']),
  cloth('cornflower', 'Cornflower', '#6b82b4', '#3b4b78', ['cool', 'soft']),
  cloth('indigo', 'Indigo', '#465a86', '#26314f', ['cool', 'deep']),
  cloth('slate', 'Slate', '#63707a', '#3b454d', ['cool', 'quiet']),
  cloth('lilac', 'Lilac', '#a288b0', '#6a4f74', ['cool', 'soft']),
  cloth('plum', 'Plum', '#8a5a72', '#5c3448', ['deep', 'quiet']),
  cloth('wine', 'Wine', '#7c3b55', '#4c1f33', ['deep', 'formal']),
  cloth('blush', 'Blush', '#bd7791', '#7c3b55', ['soft', 'playful']),
  cloth('oyster', 'Oyster', '#d8c8a8', '#9a8663', ['quiet', 'soft']),
  cloth('charcoal', 'Charcoal', '#4a4340', '#2b2624', ['deep', 'formal']),
];

/* -------------------------------- weights --------------------------------- */

export interface RibbonWeight extends Named {
  /** Ribbon width on the cover, px. */
  readonly w: number;
  /** How far it hangs below the cover's top edge, px. */
  readonly h: number;
}

/** From a hair of silk to a broad sash. */
export const RIBBON_WEIGHTS: readonly RibbonWeight[] = [
  { id: 'thread', name: 'Thread', w: 9, h: 34, tags: ['quiet', 'plain'] },
  { id: 'tape', name: 'Tape', w: 13, h: 38, tags: ['quiet', 'plain'] },
  { id: 'band', name: 'Band', w: 17, h: 44, tags: ['plain'] },
  { id: 'sash', name: 'Sash', w: 22, h: 50, tags: ['formal'] },
  { id: 'broadsash', name: 'Broad sash', w: 28, h: 58, tags: ['formal', 'ornate'] },
];

/* --------------------------------- tails ---------------------------------- */

/** A tail is a polygon in normalised 0-100 space, clockwise from top-left. */
export type RibbonPoly = readonly (readonly [number, number])[];

export interface RibbonTail extends Named {
  readonly poly: RibbonPoly;
}

const tail = (
  id: string,
  name: string,
  poly: RibbonPoly,
  tags: readonly RibbonTag[],
): RibbonTail => ({ id, name, poly, tags });

/**
 * The cuts of the bottom edge.
 *
 * Every one shares the top edge `(0,0) → (100,0)` so the ribbon still tucks
 * under the cover's lip, and none cuts above y=58 — a tail that eats half the
 * ribbon stops reading as a ribbon.
 */
export const RIBBON_TAILS: readonly RibbonTail[] = [
  tail('swallowtail', 'Swallowtail', [
    [0, 0], [100, 0], [100, 100], [50, 74], [0, 100],
  ], ['plain', 'crisp']),
  tail('straight', 'Straight cut', [
    [0, 0], [100, 0], [100, 100], [0, 100],
  ], ['plain', 'formal']),
  tail('fishtail', 'Fishtail', [
    [0, 0], [100, 0], [100, 100], [50, 58], [0, 100],
  ], ['crisp', 'ornate']),
  tail('point', 'Pointed', [
    [0, 0], [100, 0], [100, 70], [50, 100], [0, 70],
  ], ['crisp', 'formal']),
  tail('bias', 'Bias cut', [
    [0, 0], [100, 0], [100, 100], [0, 76],
  ], ['plain', 'playful']),
  tail('chamfer', 'Softened', [
    [0, 0], [100, 0], [100, 86], [82, 100], [18, 100], [0, 86],
  ], ['soft', 'quiet']),
  tail('notch', 'Notched', [
    [0, 0], [100, 0], [100, 100], [66, 100], [50, 84], [34, 100], [0, 100],
  ], ['crisp', 'quiet']),
  tail('scallop', 'Scalloped', [
    [0, 0], [100, 0], [100, 84], [84, 100], [67, 84], [50, 100],
    [33, 84], [16, 100], [0, 84],
  ], ['soft', 'ornate']),
  tail('dagged', 'Dagged', [
    [0, 0], [100, 0], [100, 72], [75, 100], [50, 72], [25, 100], [0, 72],
  ], ['ornate', 'playful']),
  tail('fringe', 'Fringed', [
    [0, 0], [100, 0], [100, 100], [88, 78], [75, 100], [63, 78], [50, 100],
    [38, 78], [25, 100], [13, 78], [0, 100],
  ], ['ornate', 'playful']),
];

/* ------------------------------- materials -------------------------------- */

/**
 * A hard-edged stripe layer. Hard-edged on purpose: a rib drawn as a soft
 * gradient is a light model, and this app does not have one. Flat bands of a
 * second tone are pattern, which the wallpaper module does at length.
 */
export interface RibbonStripe {
  /** 0 = stripes run down the ribbon, 90 = across it. */
  readonly angle: 0 | 90;
  /** Repeat length, px. */
  readonly period: number;
  /** How much of the repeat the second tone covers, px. */
  readonly on: number;
  readonly tone: 'fold' | 'face' | 'ink' | 'gilt' | 'light';
  /** 0-1, applied to `tone`. */
  readonly alpha: number;
}

export interface RibbonMaterial extends Named {
  readonly stripes: readonly RibbonStripe[];
  /** Width of the turned-over fold along the left edge, px. 0 = none. */
  readonly fold: number;
  /** Both long edges wear a dashed stitch line. */
  readonly stitch: boolean;
  /** Both long edges wear a gilt hairline. */
  readonly giltEdge: boolean;
  /** A crease down the middle, in ink. */
  readonly crease: boolean;
  /**
   * A gentle wash from the face to one step deeper down the ribbon's length.
   * Allowed — the app icon itself uses three gradients — because it reads as
   * dye taking unevenly, not as a lamp.
   */
  readonly wash: boolean;
  /** Face is the cloth's deeper tone (velvet, and nothing else so far). */
  readonly deepFace: boolean;
}

const material = (
  id: string,
  name: string,
  tags: readonly RibbonTag[],
  spec: Partial<Omit<RibbonMaterial, keyof Named>>,
): RibbonMaterial => ({
  id,
  name,
  tags,
  stripes: [],
  fold: 3,
  stitch: false,
  giltEdge: false,
  crease: false,
  wash: false,
  deepFace: false,
  ...spec,
});

/** The finishes. */
export const RIBBON_MATERIALS: readonly RibbonMaterial[] = [
  material('silk', 'Silk', ['soft', 'formal'], { wash: true }),
  material('grosgrain', 'Grosgrain', ['crisp', 'plain'], {
    stripes: [{ angle: 90, period: 4, on: 2, tone: 'fold', alpha: 0.45 }],
  }),
  material('velvet', 'Velvet', ['deep', 'formal'], { deepFace: true, fold: 5 }),
  material('linen', 'Linen', ['natural', 'quiet'], {
    stripes: [{ angle: 0, period: 5, on: 1, tone: 'light', alpha: 0.3 }],
    fold: 2,
  }),
  material('leather', 'Leather', ['deep', 'natural'], { fold: 4, stitch: true }),
  material('paper', 'Paper tape', ['plain', 'quiet'], { fold: 0, crease: true }),
  material('gilt', 'Gilt-edged', ['ornate', 'formal'], { giltEdge: true, wash: true }),
  material('tartan', 'Tartan', ['ornate', 'playful'], {
    stripes: [
      { angle: 90, period: 11, on: 3, tone: 'ink', alpha: 0.35 },
      { angle: 0, period: 9, on: 2, tone: 'light', alpha: 0.45 },
    ],
  }),
];

/* --------------------------------- charms --------------------------------- */

export type RibbonCharmShape =
  | { readonly kind: 'none' }
  | { readonly kind: 'disc' }
  | { readonly kind: 'poly'; readonly poly: RibbonPoly };

export interface RibbonCharm extends Named {
  readonly shape: RibbonCharmShape;
  /** Charm size as a fraction of the ribbon's width. */
  readonly scale: number;
}

const charm = (
  id: string,
  name: string,
  tags: readonly RibbonTag[],
  shape: RibbonCharmShape,
  scale = 0.62,
): RibbonCharm => ({ id, name, tags, shape, scale });

const poly = (...points: readonly (readonly [number, number])[]): RibbonCharmShape => ({
  kind: 'poly',
  poly: points,
});

/**
 * The charms, drawn as flat silhouettes.
 *
 * A silhouette rather than a filled shape with its own outline, because the
 * charm lands at nine to eighteen pixels across on a real cover: at that size
 * the outline IS the shape, and an outline drawn around a fill this small
 * fills in and reads as a blot. The tone (ink / gilt / cream) is the design's
 * own choice, so the same star can be a stamped one or a gilt one.
 */
export const RIBBON_CHARMS: readonly RibbonCharm[] = [
  charm('none', 'No charm', ['plain'], { kind: 'none' }),
  charm('bead', 'Bead', ['plain', 'quiet'], { kind: 'disc' }, 0.5),
  charm('coin', 'Coin', ['formal'], { kind: 'disc' }, 0.72),
  charm('star', 'Star', ['bright', 'playful'], poly(
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 92], [50, 70],
    [21, 92], [32, 57], [2, 35], [39, 35],
  )),
  charm('moon', 'Crescent', ['quiet', 'soft'], poly(
    [62, 2], [30, 14], [12, 44], [20, 76], [48, 96], [76, 92], [52, 78],
    [38, 52], [42, 26],
  )),
  charm('leaf', 'Leaf', ['natural', 'soft'], poly(
    [50, 0], [78, 24], [86, 56], [50, 100], [14, 56], [22, 24],
  )),
  charm('heart', 'Heart', ['playful', 'warm'], poly(
    [50, 22], [66, 2], [90, 10], [96, 38], [50, 98], [4, 38], [10, 10], [34, 2],
  )),
  charm('key', 'Key', ['formal', 'ornate'], poly(
    [42, 0], [62, 10], [62, 30], [52, 40], [52, 62], [70, 62], [70, 74],
    [52, 74], [52, 86], [66, 86], [66, 98], [40, 98], [40, 40], [30, 30],
    [30, 10],
  ), 0.7),
  charm('bell', 'Bell', ['bright', 'playful'], poly(
    [44, 0], [56, 0], [56, 12], [80, 44], [86, 80], [14, 80], [20, 44], [44, 12],
  )),
  charm('acorn', 'Acorn', ['natural', 'warm'], poly(
    [50, 0], [58, 8], [86, 18], [80, 36], [76, 70], [50, 98], [24, 70],
    [20, 36], [14, 18], [42, 8],
  )),
  charm('feather', 'Feather', ['natural', 'ornate'], poly(
    [56, 0], [78, 26], [70, 46], [82, 52], [62, 74], [66, 84], [46, 92],
    [40, 100], [34, 84], [26, 58], [30, 28],
  )),
  charm('knot', 'Knot', ['plain', 'crisp'], poly(
    [50, 0], [100, 50], [50, 100], [0, 50],
  ), 0.56),
  charm('tassel', 'Tassel', ['ornate', 'playful'], poly(
    [26, 0], [74, 0], [74, 22], [66, 22], [66, 100], [56, 74], [56, 100],
    [44, 74], [44, 100], [34, 22], [26, 22],
  ), 0.78),
];

export type RibbonCharmTone = 'ink' | 'gilt' | 'cream';

/* ========================================================================== *
 *                             a resolved ribbon                              *
 * ========================================================================== */

export interface RibbonDesign {
  readonly cloth: string;
  readonly weight: string;
  readonly tail: string;
  readonly material: string;
  readonly charm: string;
  readonly charmTone: RibbonCharmTone;
  /** The preset this came from, when it came from one. */
  readonly preset: string | null;
}

/**
 * The ribbon a book that has never been dressed wears.
 *
 * Deliberately not the old flat rectangle: the reader called the shipped
 * defaults *"boring/bland/cheap"*, and the first ribbon anyone ever sees is a
 * default. A moss grosgrain band with a swallowtail and a gilt bead is still
 * quiet enough to sit on any cover.
 */
export const DEFAULT_RIBBON: RibbonDesign = {
  cloth: 'moss',
  weight: 'band',
  tail: 'swallowtail',
  material: 'grosgrain',
  charm: 'bead',
  charmTone: 'gilt',
  preset: 'reading-room',
};

const byId = <T extends Named>(list: readonly T[]): ReadonlyMap<string, T> =>
  new Map(list.map((item) => [item.id, item]));

const CLOTHS = byId(RIBBON_CLOTHS);
const WEIGHTS = byId(RIBBON_WEIGHTS);
const TAILS = byId(RIBBON_TAILS);
const MATERIALS = byId(RIBBON_MATERIALS);
const CHARMS = byId(RIBBON_CHARMS);

const CHARM_TONES: readonly RibbonCharmTone[] = ['ink', 'gilt', 'cream'];

/* -------------------------------- presets --------------------------------- */

/** The eight shelves the picker sorts presets onto. */
export const RIBBON_FAMILIES = [
  'library',
  'garden',
  'nautical',
  'atelier',
  'nocturne',
  'nursery',
  'archive',
  'festive',
] as const;

export type RibbonFamily = (typeof RIBBON_FAMILIES)[number];

export interface RibbonPreset {
  readonly id: string;
  readonly name: string;
  /** One line a reader can shop by. */
  readonly blurb: string;
  readonly family: RibbonFamily;
  readonly tags: readonly RibbonTag[];
  readonly design: Omit<RibbonDesign, 'preset'>;
}

const preset = (
  id: string,
  name: string,
  family: RibbonFamily,
  blurb: string,
  design: Omit<RibbonDesign, 'preset'>,
  tags: readonly RibbonTag[],
): RibbonPreset => ({ id, name, family, blurb, design, tags });

const mk = (
  cloth_: string,
  weight: string,
  tail_: string,
  material_: string,
  charm_: string,
  charmTone: RibbonCharmTone,
): Omit<RibbonDesign, 'preset'> => ({
  cloth: cloth_,
  weight,
  tail: tail_,
  material: material_,
  charm: charm_,
  charmTone,
});

/**
 * The named ribbons, five to each family in {@link RIBBON_FAMILIES}.
 *
 * Classified rather than listed, for the same reason the room presets were:
 * *"actually include well thought out presets with proper classifications"*.
 * A reader who wants their field notebook to look like a field notebook opens
 * `garden` and finds five that do, instead of scrolling a flat run of forty.
 */
export const RIBBON_PRESETS: readonly RibbonPreset[] = [
  /* library — the sober end, what a reference book wears */
  preset('reading-room', 'Reading room', 'library', 'moss grosgrain, gilt bead',
    mk('moss', 'band', 'swallowtail', 'grosgrain', 'bead', 'gilt'), ['quiet', 'natural']),
  preset('law-report', 'Law report', 'library', 'charcoal silk, straight cut',
    mk('charcoal', 'tape', 'straight', 'silk', 'none', 'ink'), ['formal', 'plain']),
  preset('folio-red', 'Folio red', 'library', 'postbox velvet with a gilt coin',
    mk('postbox', 'band', 'point', 'velvet', 'coin', 'gilt'), ['deep', 'formal']),
  preset('bookbinder', "Bookbinder's tape", 'library', 'oyster paper tape, creased',
    mk('oyster', 'tape', 'straight', 'paper', 'none', 'ink'), ['plain', 'quiet']),
  preset('reference', 'Reference', 'library', 'slate linen, notched',
    mk('slate', 'band', 'notch', 'linen', 'knot', 'ink'), ['quiet', 'crisp']),

  /* garden — leaf, soil and afternoon */
  preset('botanist', "Botanist's tape", 'garden', 'sage linen with a leaf',
    mk('sage', 'tape', 'bias', 'linen', 'leaf', 'ink'), ['natural', 'soft']),
  preset('kitchen-garden', 'Kitchen garden', 'garden', 'fern grosgrain, fishtail',
    mk('fern', 'band', 'fishtail', 'grosgrain', 'acorn', 'ink'), ['natural', 'quiet']),
  preset('orchard', 'Orchard', 'garden', 'marmalade silk with an acorn',
    mk('marmalade', 'band', 'chamfer', 'silk', 'acorn', 'ink'), ['warm', 'natural']),
  preset('hedgerow', 'Hedgerow', 'garden', 'olive linen, fringed',
    mk('olive', 'tape', 'fringe', 'linen', 'none', 'ink'), ['natural', 'playful']),
  preset('glasshouse', 'Glasshouse', 'garden', 'turquoise silk with a leaf',
    mk('turquoise', 'band', 'point', 'silk', 'leaf', 'cream'), ['cool', 'bright']),

  /* nautical — rope, flag and weather */
  preset('signal-flag', 'Signal flag', 'nautical', 'lagoon grosgrain, swallowtail',
    mk('lagoon', 'sash', 'swallowtail', 'grosgrain', 'none', 'cream'), ['cool', 'crisp']),
  preset('deep-water', 'Deep water', 'nautical', 'indigo velvet with a gilt star',
    mk('indigo', 'band', 'fishtail', 'velvet', 'star', 'gilt'), ['deep', 'formal']),
  preset('ships-log', "Ship's log", 'nautical', 'sky leather, stitched',
    mk('sky', 'band', 'straight', 'leather', 'knot', 'cream'), ['cool', 'plain']),
  preset('harbour', 'Harbour', 'nautical', 'juniper grosgrain with a bell',
    mk('juniper', 'tape', 'notch', 'grosgrain', 'bell', 'gilt'), ['cool', 'quiet']),
  preset('rope-and-brass', 'Rope and brass', 'nautical', 'clay linen, gilt knot',
    mk('clay', 'band', 'dagged', 'linen', 'knot', 'gilt'), ['warm', 'natural']),

  /* atelier — the studio: ink, paint and paper */
  preset('inkwell', 'Inkwell', 'atelier', 'charcoal velvet with a cream feather',
    mk('charcoal', 'tape', 'point', 'velvet', 'feather', 'cream'), ['deep', 'ornate']),
  preset('sketchbook', 'Sketchbook', 'atelier', 'oyster paper tape, bias cut',
    mk('oyster', 'thread', 'bias', 'paper', 'none', 'ink'), ['plain', 'quiet']),
  preset('vermilion', 'Vermilion', 'atelier', 'ember silk, pointed',
    mk('ember', 'tape', 'point', 'silk', 'none', 'ink'), ['warm', 'bright']),
  preset('gouache', 'Gouache', 'atelier', 'cornflower silk with a cream star',
    mk('cornflower', 'band', 'chamfer', 'silk', 'star', 'cream'), ['cool', 'soft']),
  preset('press-proof', 'Press proof', 'atelier', 'straw grosgrain, fringed',
    mk('straw', 'band', 'fringe', 'grosgrain', 'none', 'ink'), ['bright', 'playful']),

  /* nocturne — the late shelf */
  preset('midnight', 'Midnight', 'nocturne', 'indigo silk with a gilt crescent',
    mk('indigo', 'band', 'swallowtail', 'silk', 'moon', 'gilt'), ['deep', 'quiet']),
  preset('observatory', 'Observatory', 'nocturne', 'slate velvet, gilt star',
    mk('slate', 'sash', 'point', 'velvet', 'star', 'gilt'), ['deep', 'formal']),
  preset('candlelight', 'Candlelight', 'nocturne', 'wine gilt-edged sash',
    mk('wine', 'sash', 'dagged', 'gilt', 'coin', 'gilt'), ['deep', 'ornate']),
  preset('moth', 'Moth', 'nocturne', 'plum linen with a cream feather',
    mk('plum', 'tape', 'fishtail', 'linen', 'feather', 'cream'), ['quiet', 'soft']),
  preset('long-night', 'Long night', 'nocturne', 'charcoal grosgrain, straight',
    mk('charcoal', 'thread', 'straight', 'grosgrain', 'none', 'ink'), ['deep', 'plain']),

  /* nursery — bright, soft, unserious */
  preset('bedtime', 'Bedtime', 'nursery', 'blush silk with a cream crescent',
    mk('blush', 'band', 'chamfer', 'silk', 'moon', 'cream'), ['soft', 'playful']),
  preset('sweetshop', 'Sweetshop', 'nursery', 'honey grosgrain, scalloped',
    mk('honey', 'sash', 'scallop', 'grosgrain', 'heart', 'cream'), ['bright', 'playful']),
  preset('paper-boat', 'Paper boat', 'nursery', 'sky paper tape with a knot',
    mk('sky', 'tape', 'point', 'paper', 'knot', 'cream'), ['cool', 'playful']),
  preset('lilac-hour', 'Lilac hour', 'nursery', 'lilac linen, scalloped',
    mk('lilac', 'band', 'scallop', 'linen', 'bead', 'cream'), ['soft', 'quiet']),
  preset('circus', 'Circus', 'nursery', 'postbox tartan with a bell',
    mk('postbox', 'sash', 'fringe', 'tartan', 'bell', 'gilt'), ['bright', 'ornate']),

  /* archive — old paper, string and stamps */
  preset('index-card', 'Index card', 'archive', 'oyster linen, straight',
    mk('oyster', 'thread', 'straight', 'linen', 'none', 'ink'), ['plain', 'quiet']),
  preset('parcel-string', 'Parcel string', 'archive', 'clay grosgrain, fringed',
    mk('clay', 'thread', 'fringe', 'grosgrain', 'knot', 'ink'), ['natural', 'plain']),
  preset('rubber-stamp', 'Rubber stamp', 'archive', 'rust leather with a coin',
    mk('rust', 'band', 'notch', 'leather', 'coin', 'cream'), ['warm', 'deep']),
  preset('ledger', 'Ledger', 'archive', 'juniper leather, stitched',
    mk('juniper', 'band', 'straight', 'leather', 'none', 'gilt'), ['formal', 'deep']),
  preset('strongroom', 'Strongroom', 'archive', 'charcoal leather with a gilt key',
    mk('charcoal', 'sash', 'swallowtail', 'leather', 'key', 'gilt'), ['formal', 'ornate']),

  /* festive — the ones that are simply lovely */
  preset('gift', 'Gift', 'festive', 'postbox silk, swallowtail',
    mk('postbox', 'sash', 'swallowtail', 'silk', 'none', 'gilt'), ['bright', 'warm']),
  preset('gilded', 'Gilded', 'festive', 'wine gilt-edged with a gilt tassel',
    mk('wine', 'broadsash', 'dagged', 'gilt', 'tassel', 'gilt'), ['ornate', 'formal']),
  preset('confetti', 'Confetti', 'festive', 'turquoise tartan, scalloped',
    mk('turquoise', 'sash', 'scallop', 'tartan', 'star', 'cream'), ['bright', 'playful']),
  preset('rose-window', 'Rose window', 'festive', 'blush gilt-edged sash',
    mk('blush', 'broadsash', 'point', 'gilt', 'heart', 'gilt'), ['soft', 'ornate']),
  preset('harvest', 'Harvest', 'festive', 'marmalade tartan with an acorn',
    mk('marmalade', 'broadsash', 'fishtail', 'tartan', 'acorn', 'ink'), ['warm', 'ornate']),
];

const PRESETS = new Map(RIBBON_PRESETS.map((p) => [p.id, p]));

/** Presets on one shelf, in table order. */
export function ribbonPresetsOf(family: RibbonFamily): readonly RibbonPreset[] {
  return RIBBON_PRESETS.filter((p) => p.family === family);
}

/* -------------------------------- resolving -------------------------------- */

const pick = (
  value: unknown,
  table: ReadonlyMap<string, Named>,
  fallback: string,
): string => (typeof value === 'string' && table.has(value) ? value : fallback);

/**
 * A ribbon out of any blob at all, total.
 *
 * Junk out of SQLite gives the house ribbon and never a throw — the same
 * contract `resolveShelfDesign` keeps, and for the same reason: this runs on
 * data a reader's disk may have mangled, inside a render.
 */
export function resolveRibbonDesign(raw: unknown): RibbonDesign {
  if (raw === null || typeof raw !== 'object') return DEFAULT_RIBBON;
  const blob = raw as Record<string, unknown>;
  // A stored preset id is a complete answer on its own; explicit axes on top
  // of it are the reader having adjusted one row of the picker.
  const presetId = typeof blob.preset === 'string' ? blob.preset : null;
  const base = presetId !== null ? PRESETS.get(presetId) : undefined;
  const seed: Omit<RibbonDesign, 'preset'> = base?.design ?? DEFAULT_RIBBON;
  const tone = blob.charmTone;
  return {
    cloth: pick(blob.cloth, CLOTHS, seed.cloth),
    weight: pick(blob.weight, WEIGHTS, seed.weight),
    tail: pick(blob.tail, TAILS, seed.tail),
    material: pick(blob.material, MATERIALS, seed.material),
    charm: pick(blob.charm, CHARMS, seed.charm),
    charmTone:
      typeof tone === 'string' && (CHARM_TONES as readonly string[]).includes(tone)
        ? (tone as RibbonCharmTone)
        : seed.charmTone,
    preset: base !== undefined ? base.id : null,
  };
}

/** The design as it will be stored, with `preset` kept only when it still fits. */
export function ribbonFromPreset(id: string): RibbonDesign {
  const found = PRESETS.get(id);
  if (found === undefined) return DEFAULT_RIBBON;
  return { ...found.design, preset: found.id };
}

/** Which preset (if any) a design is exactly — used to light the picker up. */
export function ribbonPresetOf(design: RibbonDesign): string | null {
  for (const p of RIBBON_PRESETS) {
    const d = p.design;
    if (
      d.cloth === design.cloth &&
      d.weight === design.weight &&
      d.tail === design.tail &&
      d.material === design.material &&
      d.charm === design.charm &&
      d.charmTone === design.charmTone
    ) {
      return p.id;
    }
  }
  return null;
}

/** The resolved parts of a design, for the two renderers. */
export interface RibbonParts {
  readonly cloth: RibbonCloth;
  readonly weight: RibbonWeight;
  readonly tail: RibbonTail;
  readonly material: RibbonMaterial;
  readonly charm: RibbonCharm;
  readonly charmTone: RibbonCharmTone;
}

/**
 * Resolve one axis, falling back to the house ribbon's own choice and only
 * then to the head of the table.
 *
 * Written this way rather than with an index per axis on purpose: an index is
 * a second copy of "which one is the default", and the two go out of step the
 * first time somebody re-orders a table. `DEFAULT_RIBBON` is the single
 * statement of it.
 */
function axis<T extends Named>(
  table: ReadonlyMap<string, T>,
  list: readonly T[],
  wanted: string,
  house: string,
): T {
  const found = table.get(wanted) ?? table.get(house) ?? list[0];
  // The tables are module-level literals and never empty; this satisfies
  // noUncheckedIndexedAccess without inventing a runtime failure mode.
  return found as T;
}

export function ribbonParts(design: RibbonDesign): RibbonParts {
  return {
    cloth: axis(CLOTHS, RIBBON_CLOTHS, design.cloth, DEFAULT_RIBBON.cloth),
    weight: axis(WEIGHTS, RIBBON_WEIGHTS, design.weight, DEFAULT_RIBBON.weight),
    tail: axis(TAILS, RIBBON_TAILS, design.tail, DEFAULT_RIBBON.tail),
    material: axis(MATERIALS, RIBBON_MATERIALS, design.material, DEFAULT_RIBBON.material),
    charm: axis(CHARMS, RIBBON_CHARMS, design.charm, DEFAULT_RIBBON.charm),
    charmTone: design.charmTone,
  };
}

/* ========================================================================== *
 *                                   colour                                   *
 * ========================================================================== */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: readonly [number, number, number]): string =>
  `#${rgb.map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Flat mix of two hexes — no blend modes, just arithmetic on the pigment. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const k = clamp01(t);
  return toHex([
    x[0] + (y[0] - x[0]) * k,
    x[1] + (y[1] - x[1]) * k,
    x[2] + (y[2] - x[2]) * k,
  ]);
}

const INK = '#4f3120';
const GILT = '#e8b64c';
const CREAM = '#f7f1e3';

/**
 * How far each of the six slots is pushed toward the fold.
 *
 * Not evenly spaced and not in slot order: the run is 0, .30, .12, .22, .06,
 * .16, so two ribbons that happen to land next to each other on a cover are
 * never one step apart, and the whole set still reads as one dye lot.
 */
const SLOT_STEP: Readonly<Record<RibbonColor, number>> = {
  terracotta: 0,
  moss: 0.3,
  sky: 0.12,
  plum: 0.22,
  amber: 0.06,
  blush: 0.16,
};

/** The face colour a given mark wears under a given design. */
export function ribbonSlotColor(parts: RibbonParts, slot: RibbonColor): string {
  const base = parts.material.deepFace
    ? mixHex(parts.cloth.face, parts.cloth.fold, 0.55)
    : parts.cloth.face;
  return mixHex(base, parts.cloth.fold, SLOT_STEP[slot] ?? 0);
}

function toneHex(parts: RibbonParts, tone: RibbonStripe['tone'], face: string): string {
  switch (tone) {
    case 'fold':
      return parts.cloth.fold;
    case 'ink':
      return INK;
    case 'gilt':
      return GILT;
    case 'light':
      return mixHex(face, CREAM, 0.55);
    default:
      return face;
  }
}

/* ========================================================================== *
 *                                  drawing                                   *
 * ========================================================================== */

/**
 * Where the charm's bottom edge sits, as a fraction of the ribbon's height
 * measured from the bottom.
 *
 * DERIVED from the tail rather than fixed, and that is not fussiness: the
 * charm and the tail are both clipped by the same polygon, so a charm parked
 * at a constant 14% was whole on a straight cut, sitting in the fork of a
 * swallowtail, and cut clean away by a fishtail — the deepest cuts are the
 * ones that reach furthest up. Sitting it just above the HIGHEST point of the
 * cut puts it on cloth for all ten of them. (Geometry that ignores the shape
 * it is landing on is how a rule ended up striking through the label it had
 * cleared by 1.8px of arithmetic.)
 */
export function charmBottomFraction(tail: RibbonTail): number {
  // Skip the two points of the top edge; what is left is the cut.
  const cut = tail.poly.slice(2);
  const highest = cut.length === 0 ? 100 : Math.min(...cut.map(([, y]) => y));
  return (100 - highest) / 100 + 0.06;
}

/**
 * The box a ribbon is drawn in: its own width and height, plus a pixel all
 * round for the ink line to sit inside. A stroke centred on the outline is
 * half outside it, and half a line clipped off the left edge of the cover's
 * first ribbon is the kind of thing nobody sees and everybody feels.
 */
export function ribbonBox(parts: RibbonParts): { w: number; h: number } {
  return { w: parts.weight.w + INK_ROOM * 2, h: parts.weight.h + INK_ROOM * 2 };
}

const INK_ROOM = 1;

/** `<svg …>` → a `url("data:…")` a stylesheet can wear. */
export function svgDataUri(svg: string): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/**
 * The whole stylesheet for one design.
 *
 * The ribbon is painted by its own drawing rather than by a stack of CSS
 * gradients, and that decision is worth the paragraph. Gradients could do the
 * cloth, the ribs and the fold — they could not do the one thing the visual
 * language is most insistent about, which is the single dark outline on
 * everything: `clip-path` cuts a shape, it does not stroke one, and a
 * `drop-shadow` outline is a blur by another name. Handing the element the
 * same SVG the picker draws gets the ink line, gets the two surfaces exactly
 * identical by construction rather than by discipline, and costs one data URI
 * per slot, rebuilt only when the reader changes something.
 *
 * Exported (rather than only applied) so a test can read what a design
 * compiles to without a DOM, and so a maintainer who would rather this lived
 * in `spread.css` can print the block and paste it.
 */
export function ribbonCss(design: RibbonDesign): string {
  const parts = ribbonParts(design);
  const box = ribbonBox(parts);
  const out: string[] = [
    `/* generated by views/bookmarks.ts — ribbon "${design.preset ?? 'custom'}" */`,
    `:root .nb-ribbon {
  width: ${box.w}px;
  height: ${box.h}px;
  border-radius: 0;
  /* The drawing carries the cut; a clip on top of it would shave the ink. */
  clip-path: none;
  /* Flat language: depth is the fold beside the face, never a soft drop. */
  box-shadow: none;
  background-repeat: no-repeat;
  background-position: 0 0;
  background-size: 100% 100%;
}`,
  ];
  const paint = (selector: string, slot: RibbonColor): string =>
    `${selector} { background-image: ${svgDataUri(ribbonSvg(design, { slot }))}; }`;
  for (const slot of RIBBON_COLORS) {
    out.push(paint(`:root .nb-ribbon[data-color='${slot}']`, slot));
  }
  // Anything not in the six slots (older data, future slots) still gets cloth.
  out.push(paint(':root .nb-ribbon:not([data-color])', 'terracotta'));
  return out.join('\n');
}

const STYLE_ID = 'nb-ribbon-skin';

/**
 * Put the design in force. Idempotent, DOM-free-safe, and cheap enough to call
 * on every keystroke of a picker: it rewrites one `<style>` element's text,
 * which restyles every ribbon on the cover in the same frame and never
 * re-rasterizes a page.
 */
export function applyRibbonDesign(design: RibbonDesign): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID);
  if (el === null) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  const css = ribbonCss(design);
  if (el.textContent !== css) el.textContent = css;
}

/* ========================================================================== *
 *                       the drawing, once, for both                          *
 * ========================================================================== */

export interface RibbonSvgOptions {
  /**
   * Drawing height in px, the ribbon's own width following from it.
   *
   * Height rather than width, because a picker row shows five weights side by
   * side and they must line up along the cover's lip — sizing by width would
   * scale a thread up and a broad sash down until every one of them looked the
   * same, which is the one thing that row exists to show.
   */
  readonly height?: number;
  /** Overall width of the drawing, px. Overrides `height` when both are set. */
  readonly width?: number;
  /** Which of the six slots to paint. Defaults to the first. */
  readonly slot?: RibbonColor;
  /** Draw the cover lip the ribbon tucks under. */
  readonly lip?: boolean;
}

const svgPoly = (p: RibbonPoly, x: number, y: number, w: number, h: number): string =>
  p.map(([px, py]) => `${(x + (px / 100) * w).toFixed(2)},${(y + (py / 100) * h).toFixed(2)}`).join(' ');

/**
 * The ribbon, drawn — once, for the picker tile AND for the cover.
 *
 * There is deliberately no second renderer. The first cut of this file had the
 * cover painted by a stack of CSS gradients and the tile painted by this, and
 * that is the shape of a bug this codebase has already shipped: two modules
 * folding one design differently, so a book was one colour on the shelf and
 * another in the hand. {@link ribbonCss} hands the element this drawing as a
 * data URI instead, which also buys the ink outline no `clip-path` can give.
 *
 * Markup, not a canvas: a tile is a dozen elements and a strip shows eight of
 * them, where eight canvases would be eight bakes on every re-render.
 */
export function ribbonSvg(design: RibbonDesign, opts: RibbonSvgOptions = {}): string {
  const parts = ribbonParts(design);
  const { weight, tail, material, charm: ch } = parts;
  const face = ribbonSlotColor(parts, opts.slot ?? 'terracotta');
  const box = ribbonBox(parts);
  const lip = opts.lip === true ? 5 : 0;
  const boxW = box.w;
  const boxH = box.h + lip;
  const x = INK_ROOM;
  const y = INK_ROOM + lip;
  const w = weight.w;
  const h = weight.h;
  // Every axis in the id: a picker row puts eight of these drawings in ONE
  // document, and two `<clipPath>` elements sharing an id means seven tiles
  // silently wearing the first one's cut.
  const clipId = [
    'rb',
    design.cloth,
    design.weight,
    design.tail,
    design.material,
    design.charm,
    opts.slot ?? 'terracotta',
    lip,
  ].join('-');
  const bits: string[] = [];

  bits.push(
    `<clipPath id="${clipId}"><polygon points="${svgPoly(tail.poly, x, y, w, h)}"/></clipPath>`,
  );
  const g: string[] = [];
  if (material.wash) {
    // A real gradient, not a second rect with a hard edge across the middle.
    // Gentle gradients are inside the visual language — the app icon uses
    // three — and a hard band at 45% reads as a mistake rather than as dye
    // taking unevenly, which is the whole point of a wash.
    const washId = `${clipId}-wash`;
    bits.push(
      `<linearGradient id="${washId}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${face}"/>` +
        `<stop offset="1" stop-color="${mixHex(face, parts.cloth.fold, 0.42)}"/>` +
        `</linearGradient>`,
    );
    // `#` here, not `%23`: this string is used inline in the DOM too, and
    // `svgDataUri` is what percent-encodes it on the way into a stylesheet.
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${washId})"/>`);
  } else {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${face}"/>`);
  }
  for (const s of material.stripes) {
    const colour = toneHex(parts, s.tone, face);
    if (s.angle === 90) {
      for (let ty = 0; ty < h; ty += s.period) {
        g.push(
          `<rect x="${x}" y="${(y + ty).toFixed(2)}" width="${w}" height="${s.on}" fill="${colour}" opacity="${s.alpha}"/>`,
        );
      }
    } else {
      for (let tx = 0; tx < w; tx += s.period) {
        g.push(
          `<rect x="${(x + tx).toFixed(2)}" y="${y}" width="${s.on}" height="${h}" fill="${colour}" opacity="${s.alpha}"/>`,
        );
      }
    }
  }
  if (material.fold > 0) {
    g.push(
      `<rect x="${x}" y="${y}" width="${material.fold}" height="${h}" fill="${parts.cloth.fold}"/>`,
    );
  }
  if (material.crease) {
    g.push(
      `<rect x="${(x + w / 2 - 0.5).toFixed(2)}" y="${y}" width="1" height="${h}" fill="${INK}" opacity="0.28"/>`,
    );
  }
  if (material.giltEdge) {
    g.push(`<rect x="${x}" y="${y}" width="1.5" height="${h}" fill="${GILT}"/>`);
    g.push(
      `<rect x="${(x + w - 1.5).toFixed(2)}" y="${y}" width="1.5" height="${h}" fill="${GILT}"/>`,
    );
  }
  if (material.stitch) {
    for (const sx of [x + 2, x + w - 2.8]) {
      for (let ty = 2; ty < h - 2; ty += 7) {
        g.push(
          `<rect x="${sx.toFixed(2)}" y="${(y + ty).toFixed(2)}" width="0.8" height="3" fill="${CREAM}" opacity="0.72"/>`,
        );
      }
    }
  }
  if (ch.shape.kind !== 'none') {
    const tone =
      parts.charmTone === 'gilt' ? GILT : parts.charmTone === 'cream' ? CREAM : INK;
    const size = Math.max(5, w * ch.scale);
    const cx = x + w / 2 - size / 2;
    // The same seat the stylesheet gives it — see charmBottomFraction.
    const cy = y + h * (1 - charmBottomFraction(tail)) - size;
    if (ch.shape.kind === 'disc') {
      g.push(
        `<circle cx="${(cx + size / 2).toFixed(2)}" cy="${(cy + size / 2).toFixed(2)}" r="${(size / 2).toFixed(2)}" fill="${tone}"/>`,
      );
    } else {
      g.push(`<polygon points="${svgPoly(ch.shape.poly, cx, cy, size, size)}" fill="${tone}"/>`);
    }
  }
  bits.push(`<g clip-path="url(#${clipId})">${g.join('')}</g>`);
  // The one ink outline the language asks for, on the ribbon's own edge.
  bits.push(
    `<polygon points="${svgPoly(tail.poly, x, y, w, h)}" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>`,
  );
  if (opts.lip === true) {
    bits.push(
      `<rect x="0" y="0" width="${boxW}" height="6" rx="2" fill="${CREAM}" stroke="${INK}" stroke-width="1.2"/>`,
    );
  }

  const scale =
    opts.width !== undefined
      ? opts.width / boxW
      : opts.height !== undefined
        ? opts.height / boxH
        : 1;
  // `xmlns` is not optional: the same string is served to `background-image`
  // as a data URI, and an SVG document without its namespace does not render
  // as an image at all — inline in the DOM it would have got away with it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${boxW} ${boxH}"` +
    ` width="${(boxW * scale).toFixed(1)}" height="${(boxH * scale).toFixed(1)}"` +
    ` role="img" aria-hidden="true" focusable="false">${bits.join('')}</svg>`
  );
}

/* ========================================================================== *
 *                         where the choice is kept                           *
 * ========================================================================== */

/** A ribbon design as it goes into cover_meta. */
export function mergeRibbonIntoMeta(
  meta: Record<string, unknown> | null,
  design: RibbonDesign | null,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(meta ?? {}) };
  if (design === null) delete next.ribbon;
  else next.ribbon = { ...design };
  return Object.keys(next).length > 0 ? next : null;
}

/** The ribbon a book wears, resolved (never throws, never null). */
export function readRibbonDesign(
  book: Pick<Book, 'coverMeta'> | null | undefined,
): RibbonDesign {
  return resolveRibbonDesign(book?.coverMeta?.ribbon ?? null);
}

/**
 * The open book and its ribbon, for the rail.
 *
 * `BookRail` has no book prop and `BookView` is not this module's file to add
 * one to, so the two meet here: the book view hydrates this on session load
 * (through {@link readBookmarks}, its one call into this module), and the rail
 * is the only writer. The same shape `data/designPrefs.ts` uses for readers
 * that are not inside the Solid tree — a signal, a snapshot, one owner.
 */
const [openBook, setOpenBook] = createSignal<{
  id: string | null;
  design: RibbonDesign;
}>({ id: null, design: DEFAULT_RIBBON });

/** The open book's id and ribbon. Reactive. */
export const currentRibbon = openBook;

/** Called from {@link readBookmarks}: a new book is on screen. */
function adoptRibbonBook(book: (Pick<Book, 'coverMeta'> & { readonly id?: string }) | null): void {
  const design = readRibbonDesign(book);
  const id = typeof book?.id === 'string' ? book.id : null;
  const now = openBook();
  if (now.id === id && sameRibbon(now.design, design)) return;
  setOpenBook({ id, design });
  applyRibbonDesign(design);
}

export function sameRibbon(a: RibbonDesign, b: RibbonDesign): boolean {
  return (
    a.cloth === b.cloth &&
    a.weight === b.weight &&
    a.tail === b.tail &&
    a.material === b.material &&
    a.charm === b.charm &&
    a.charmTone === b.charmTone
  );
}

/**
 * Dress the open book. Applies immediately (so the cover's ribbons change
 * under the reader's hand) and persists in the background.
 */
export async function saveRibbonDesign(design: RibbonDesign): Promise<void> {
  const { id } = openBook();
  const stamped: RibbonDesign = { ...design, preset: ribbonPresetOf(design) };
  setOpenBook({ id, design: stamped });
  applyRibbonDesign(stamped);
  if (id === null) return;
  const book = await getBook(id);
  if (book === null) return;
  await updateBook(id, { coverMeta: mergeRibbonIntoMeta(book.coverMeta, stamped) });
}
