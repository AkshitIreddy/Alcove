/**
 * art/charms.ts — the charm VOCABULARY (library-themes §4).
 *
 * The historical charm ids and their colourways remain readable so old data
 * can be migrated without a parse failure. None are reader-facing book-surface
 * options now: every protruding ribbon, tassel, flower, clasp, seal and tag read
 * as an antenna, sticker or piece of hardware at shelf size.
 *
 * This module is names and colours ONLY. It used to also carry ~700 lines of
 * painterly canvas drawing (`drawSpineCharm` / `drawCoverCharm`, radial
 * specular highlights, soft radial drop shadows) from before the flat restyle.
 * That code had no callers left — `spines.drawSpineRibbon` and
 * `covers.paintCharm` draw charms in the flat language now — and every
 * remaining `createRadialGradient` in src/ lived in it, i.e. a light source in
 * a codebase whose depth model is "a darker flat face beside a lighter one".
 * It is gone. Charm art belongs next to the art it has to match: spine art in
 * spines.ts, cover art in covers.ts. Do not re-add a drawing function here.
 */

import { normaliseHex } from './customColour';
import { clothPair, liftTo, INK_FLOOR } from './palette';

/* --------------------------------- kinds --------------------------------- */

/** The charm vocabulary. 'none' is a first-class value (most books have none). */
export const CHARMS = [
  'none',
  'ribbon',
  'tassel',
  'pressed-flower',
  'clasp',
  'wax-seal',
  'tag',
] as const;

export type CharmKind = (typeof CHARMS)[number];

/** Display labels for the studio panel (index-aligned with CHARMS). */
export const CHARM_LABELS: Readonly<Record<CharmKind, string>> = {
  none: 'None',
  ribbon: 'Ribbon marker',
  tassel: 'Tassel',
  'pressed-flower': 'Pressed flower',
  clasp: 'Brass clasp',
  'wax-seal': 'Wax seal',
  tag: 'Dangling tag',
};

/**
 * Reader-facing charm catalogue after the binding reset.
 *
 * Historical ids remain parseable, but every one normalizes to `none`. This is
 * deliberately separate from the between-page bookmark feature, which is not
 * a painted binding furnishing and does not use this catalogue.
 */
export const ACTIVE_CHARMS = ['none'] as const satisfies readonly CharmKind[];

/** No applied charm art is active after the binding reset. */
export const CHARM_KINDS_WITH_ART: readonly Exclude<CharmKind, 'none'>[] = [];

const ACTIVE_CHARM_SET: ReadonlySet<string> = new Set(ACTIVE_CHARMS);

export function isActiveCharmKind(value: unknown): value is (typeof ACTIVE_CHARMS)[number] {
  return typeof value === 'string' && ACTIVE_CHARM_SET.has(value);
}

/** Retired applied objects become a clean binding, never a different sticker. */
export function normalizeCharmKind(value: unknown): (typeof ACTIVE_CHARMS)[number] {
  return isActiveCharmKind(value) ? value : 'none';
}

export function isCharmKind(value: unknown): value is CharmKind {
  return typeof value === 'string' && (CHARMS as readonly string[]).includes(value);
}

/* -------------------------------- colours -------------------------------- */

/**
 * The narrowest brightness gap that still reads as a fold on a ribbon, and the
 * floor a charm colour has to clear to have that fold at all.
 *
 * Restated from `palette.clothPair`'s own `CLOTH_GAP` rather than imported,
 * because `clothPair` does not export it — and it is checked against the real
 * arithmetic in `tests/charm-palette.test.ts` rather than trusted, so the two
 * cannot drift the way a copied constant usually does.
 */
export const CHARM_FLOOR = INK_FLOOR + 16;

/**
 * Twenty-four ribbon / twine / wax colourways.
 *
 * ## Why the eight became twenty-four
 *
 * "Wherever colour is an option there are only like 8." This was one of them,
 * and the eight were also authored in a band the app never actually paints in
 * — `#2b4260` (navy) is brightness 63, and `FLAT.ink` is brightness 56, so a
 * navy ribbon and its own outline were 1.1:1 apart. The shelf therefore did
 * NOT draw these hexes. `art/spines.ts` pushed them through
 * `palette.intoWashBand`, `art/covers.ts` hand-mapped the same index onto eight
 * unrelated `FLAT` constants, and the Book Studio painted its swatch with the
 * raw value. Three foldings of one index, so the chip labelled *Navy* was one
 * colour in the panel, a second on the spine and a third on the pulled-out
 * board — and nothing anywhere failed.
 *
 * So the table is now authored as **what actually gets painted**: every entry
 * is a `palette.clothPair` FIXED POINT above `CHARM_FLOOR`, which means
 * `clothPair(entry)[0] === entry` exactly, and the swatch, the spine and the
 * cover are one colour by construction rather than by three modules agreeing.
 * The first eight keep their names, their hue and their order — the INDEX is
 * persisted per book — and only their lightness moved, up onto the floor the
 * art was already lifting them to.
 *
 * ## Where the sixteen came from
 *
 * The eleven `--wash-*` families in `styles/tokens.css`, sampled at chosen
 * lightnesses, plus three of the app's own neutrals. Not fifty free hexes: a
 * ribbon has to sit on a spine beside a book cloth without either of them
 * leaving the drawing, and the families are what the drawing is made of.
 *
 * Each candidate was scored on its OKLab distance to everything already on the
 * shelf, and the bar is measured rather than chosen: it is the distance between
 * **forest and teal** (0.0486), the closest pair among the original eight.
 * Nothing new may crowd the palette more than the palette already crowds
 * itself. `tests/charm-palette.test.ts` holds that line, which is what stops a
 * twenty-fifth entry from being a second navy.
 *
 * This list may be recoloured but never REORDERED, and entries may only be
 * appended: the index is what a book carries.
 */
export const CHARM_COLORS: readonly string[] = [
  /* --- the original eight, same hues, lifted onto the floor the art paints --- */
  '#bb4643', // crimson
  '#4a7964', // forest
  '#536c8c', // navy
  '#e2d4b2', // cream
  '#c9a227', // gold
  '#85567c', // plum
  '#a7552b', // rust
  '#3e7983', // teal
  /* --- warm: coral, terracotta and amber at three depths --- */
  '#d4674c', // coral
  '#f0a688', // apricot
  '#af8100', // honey
  '#dec351', // lemon
  /* --- green --- */
  '#818b34', // olive
  '#96ab75', // sage
  '#5ea597', // jade
  '#83cbbc', // seafoam
  /* --- cool --- */
  '#658da0', // sky
  '#a29ac8', // lilac
  '#796fa0', // iris
  /* --- red end --- */
  '#dea8c2', // orchid
  '#d089a3', // rose
  /* --- the neutrals a ribbon is genuinely made in --- */
  '#8a8b86', // greige
  '#c9ab7c', // parchment
  '#70675c', // charcoal
];

/** Display names, index-aligned with `CHARM_COLORS`. */
export const CHARM_COLOR_LABELS: readonly string[] = [
  'Crimson',
  'Forest',
  'Navy',
  'Cream',
  'Gold',
  'Plum',
  'Rust',
  'Teal',
  'Coral',
  'Apricot',
  'Honey',
  'Lemon',
  'Olive',
  'Sage',
  'Jade',
  'Seafoam',
  'Sky',
  'Lilac',
  'Iris',
  'Orchid',
  'Rose',
  'Greige',
  'Parchment',
  'Charcoal',
];

/**
 * A charm colourway, from either a fixed index or a reader's own hex.
 *
 * Two kinds of value arrive here and both are honoured:
 *
 *  - a NUMBER is an index into `CHARM_COLORS`, wrapped rather than clamped so
 *    a book saved against a longer table still lands on a colour;
 *  - a STRING is the reader's own colour, in any spelling of hex
 *    (`#A1B2C3`, `abc`, whitespace), pulled up onto `CHARM_FLOOR` so
 *    `FLAT.ink` still has an edge to be. A colour a reader chose is never
 *    refused and never silently replaced with a default — it is CLAMPED, which
 *    is the only way this style can accept an arbitrary colour at all.
 *
 * Anything else (null, undefined, `'rebeccapurple'`, an object) is the first
 * colourway. Total in every direction, because the one thing a normaliser in
 * this codebase must not do is drop a colour it could still read.
 */
export function charmColorCss(value: unknown): string {
  if (typeof value === 'string') {
    const hex = normaliseHex(value);
    if (hex !== null) return liftTo(hex, CHARM_FLOOR);
  }
  const n = CHARM_COLORS.length;
  const raw = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
  return CHARM_COLORS[((raw % n) + n) % n] as string;
}

/**
 * The ONE folding of a charm colour: the face, and the same silk turning away.
 *
 * Every surface that draws a charm reads this — the spine's ribbon, the
 * pulled-out board's ribbon and knot, the studio's swatch. That is the whole
 * point of it existing: three modules folding one index three ways is what
 * made a reader's *Crimson* come out green on the shelf, and the fix is not
 * three tables that agree but one table nobody else is allowed to keep.
 *
 * Because the entries are `clothPair` fixed points, `charmCloth(i)[0]` is
 * `CHARM_COLORS[i]` byte for byte; a custom hex folds by the same arithmetic.
 */
export function charmCloth(value: unknown): readonly [string, string] {
  return clothPair(charmColorCss(value));
}
