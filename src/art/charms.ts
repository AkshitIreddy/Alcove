/**
 * art/charms.ts — the charm VOCABULARY (library-themes §4).
 *
 * Six charms — ribbon marker, tassel, pressed flower, brass clasp, wax seal,
 * dangling tag — plus their eight colourways. A book with a crimson ribbon is
 * recognisably that book in every context, which is the whole point: the charm
 * is the fastest identity cue a reader has.
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

/** Charms that actually draw something (studio "surprise me" pool). */
export const CHARM_KINDS_WITH_ART: readonly CharmKind[] = CHARMS.filter(
  (c): c is Exclude<CharmKind, 'none'> => c !== 'none',
);

export function isCharmKind(value: unknown): value is CharmKind {
  return typeof value === 'string' && (CHARMS as readonly string[]).includes(value);
}

/* -------------------------------- colours -------------------------------- */

/**
 * Eight ribbon/twine/wax colourways. The INDEX is what gets persisted, so this
 * list may be recoloured but never reordered — `covers.ts` and `spines.ts`
 * each map the same index into their own flat palette.
 */
export const CHARM_COLORS: readonly string[] = [
  '#9c2b2b', // crimson
  '#2f5d4a', // forest
  '#2b4260', // navy
  '#e2d4b2', // cream
  '#c9a227', // gold
  '#6b3f63', // plum
  '#a5552b', // rust
  '#2e6b73', // teal
];

export const CHARM_COLOR_LABELS: readonly string[] = [
  'Crimson',
  'Forest',
  'Navy',
  'Cream',
  'Gold',
  'Plum',
  'Rust',
  'Teal',
];

/** Wrap-safe lookup into CHARM_COLORS. */
export function charmColorCss(index: number): string {
  const n = CHARM_COLORS.length;
  const i = ((Math.trunc(index) % n) + n) % n;
  return CHARM_COLORS[i] as string;
}
