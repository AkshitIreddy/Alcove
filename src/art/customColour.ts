/**
 * art/customColour.ts — the app's pigment shelf, and the reader's own colours.
 *
 * ## Why this exists
 *
 * Every place the app offered a colour offered between three and eight of
 * them, and each place offered a different eight. A reader who wanted "the
 * green from my bookmark" on a callout could not have it, and the honest
 * reason was that nobody had ever written down what the app's colours ARE —
 * `styles/tokens.css` has eleven pigment families, `script/vocab.ts` knew
 * seven names, `editor/nodes/callout` knew six, `art/charms.ts` knew eight.
 *
 * This module is the one answer: **twenty-four named pigments and a way to add
 * your own**, all of them standing on the rungs `tokens.css` already
 * established. It is deliberately not fifty free hexes. Eleven of the
 * twenty-four ARE the token families; nine more are two families mixed, so
 * they inherit the value and chroma band that makes a page of flat shapes read
 * as one drawing; four are the app's own neutrals (its oak, its parchment, its
 * two inks) which the families never covered.
 *
 * ## Two renderings of one table, and why they cannot drift
 *
 * A pigment has to be painted twice: into the DOM, where a library theme
 * retints `--wash-*` under it, and onto a canvas, which cannot read a custom
 * property at all. So each swatch carries a `css` triple and a `paint` triple —
 * but it DECLARES neither. Both are generated from one `source`
 * (`family` | `mix` | `fixed`), the CSS with `color-mix(in oklab, …)` and the
 * hex with `palette.mixOklab`, which is rectangular OKLab for exactly this
 * reason. One definition, two renderings, no third place to forget.
 *
 * ## The custom path
 *
 * A reader's colour is stored as a **hex**, never an index — indices are for
 * fixed tables and a custom colour is not in one. It is normalised on the way
 * in (`normaliseHex`), pulled into the pigment band on the way out
 * (`palette.washFaces`, which clamps lightness, caps chroma and holds the
 * result above `INK_FLOOR` so `FLAT.ink` still has an edge to be), and it
 * survives a resolver that is total in both directions: an id it does not
 * know does not wipe a hex it can read, and a hex handed in where an id was
 * expected is still honoured. A custom colour that silently degrades to amber
 * is worse than no custom colour at all.
 */

import { mixOklab, washFaces, type WashFaces } from './palette';

export type { WashFaces };

/* ============================== the families ============================== */

/**
 * The eleven pigment families `styles/tokens.css` authors, in its own order.
 *
 * A family is `--wash-<id>-light` / `--wash-<id>` / `--wash-<id>-deep`.
 */
export const WASH_FAMILIES = [
  'amber',
  'terracotta',
  'moss',
  'lemon',
  'sky',
  'blush',
  'plum',
  'coral',
  'turquoise',
  'violet',
  'lime',
] as const;

export type WashFamily = (typeof WASH_FAMILIES)[number];

/**
 * The families' DEFAULT-theme hexes, mirrored from `styles/tokens.css`.
 *
 * A mirror is a liability, so it is gated: `tests/custom-colour.test.ts` parses
 * `tokens.css` and fails if a single channel here has drifted. It exists at all
 * because a canvas has no `getComputedStyle` — `art/spines.ts` and friends
 * paint into an OffscreenCanvas on a worker thread, where a CSS custom property
 * does not exist in any form.
 *
 * The three light themes retint these and `night` swaps light for deep; that
 * retinting reaches the DOM through the `css` triples below and deliberately
 * does NOT reach the canvas, because a book keeps its own colours in every
 * room (the same rule `art/bookDesign.ts` is held to).
 */
const FAMILY_HEX: Readonly<Record<WashFamily, WashFaces>> = {
  amber: { light: '#f7e6bb', base: '#e8b64c', deep: '#7d5806' },
  terracotta: { light: '#f4d9c8', base: '#c96f4a', deep: '#96421d' },
  moss: { light: '#dfe7cd', base: '#7d915c', deep: '#4f6138' },
  lemon: { light: '#f8eec0', base: '#dfc451', deep: '#786608' },
  sky: { light: '#d6e3ea', base: '#5f7d8c', deep: '#3a5666' },
  blush: { light: '#f4dbe4', base: '#bd7791', deep: '#7c3b55' },
  plum: { light: '#e6d9e2', base: '#8a5a72', deep: '#5c3448' },
  coral: { light: '#f7dbd0', base: '#d4674c', deep: '#8f3319' },
  turquoise: { light: '#d2e7e1', base: '#5ea597', deep: '#2c5f56' },
  violet: { light: '#dedbeb', base: '#7c749f', deep: '#444063' },
  lime: { light: '#e9eec8', base: '#a9b45e', deep: '#5c6a1c' },
};

/** `--wash-moss-light` etc., as a CSS `var()` a style attribute can carry. */
function familyVar(family: WashFamily, face: keyof WashFaces): string {
  return face === 'base' ? `var(--wash-${family})` : `var(--wash-${family}-${face})`;
}

/* =============================== the shelf ================================ */

/**
 * Where a swatch's colour comes from. Never a hex triple written out by hand:
 * that is the thing that lets the CSS and the canvas disagree.
 *
 * - `family` — one of the eleven, straight through.
 * - `mix` — `pct` percent of `b` blended into `a`, in OKLab. An integer
 *   percent, not a fraction, so the CSS string and the hex arithmetic are fed
 *   the identical number rather than one rounded copy of it.
 * - `fixed` — a hex that is not in any family. Four of these: the app's own
 *   timber, its aged paper and its two inks, none of which the pigment
 *   families cover, and all of which a reader reaches for. They do not follow
 *   a library theme, which is the price of not being a family.
 */
export type WashSource =
  | { readonly kind: 'family'; readonly family: WashFamily }
  | { readonly kind: 'mix'; readonly a: WashFamily; readonly b: WashFamily; readonly pct: number }
  | { readonly kind: 'fixed'; readonly hex: string };

/** One pigment on the shelf. */
export interface WashSwatch {
  readonly id: string;
  readonly label: string;
  readonly source: WashSource;
  /** What the DOM paints with — follows the library theme where it can. */
  readonly css: WashFaces;
  /** What a canvas paints with — the default theme, resolved to hex. */
  readonly paint: WashFaces;
}

function family(id: WashFamily, label: string): WashSwatch {
  return build(id, label, { kind: 'family', family: id });
}

function mix(id: string, label: string, a: WashFamily, b: WashFamily, pct: number): WashSwatch {
  return build(id, label, { kind: 'mix', a, b, pct: Math.round(pct) });
}

function fixed(id: string, label: string, hex: string): WashSwatch {
  return build(id, label, { kind: 'fixed', hex });
}

function build(id: string, label: string, source: WashSource): WashSwatch {
  return { id, label, source, css: cssFaces(source), paint: paintFaces(source) };
}

function cssFaces(source: WashSource): WashFaces {
  if (source.kind === 'family') {
    return {
      light: familyVar(source.family, 'light'),
      base: familyVar(source.family, 'base'),
      deep: familyVar(source.family, 'deep'),
    };
  }
  if (source.kind === 'mix') {
    const face = (f: keyof WashFaces): string =>
      `color-mix(in oklab, ${familyVar(source.b, f)} ${source.pct}%, ${familyVar(source.a, f)})`;
    return { light: face('light'), base: face('base'), deep: face('deep') };
  }
  return washFaces(source.hex);
}

function paintFaces(source: WashSource): WashFaces {
  if (source.kind === 'family') return FAMILY_HEX[source.family];
  if (source.kind === 'mix') {
    const a = FAMILY_HEX[source.a];
    const b = FAMILY_HEX[source.b];
    const t = source.pct / 100;
    return {
      light: mixOklab(a.light, b.light, t),
      base: mixOklab(a.base, b.base, t),
      deep: mixOklab(a.deep, b.deep, t),
    };
  }
  return washFaces(source.hex);
}

/**
 * The twenty-four, laid out around the wheel so the picker reads as a spectrum
 * rather than as the order somebody happened to add them in.
 *
 * The first twenty are the spectrum and are what a picker shows before the
 * reader asks for more — that is not an arbitrary cut, it is where the eleven
 * families and the nine mixes end. The last four are the app's own neutrals,
 * which are the ones you go looking for rather than the ones you browse.
 *
 * ## The nine mixes were measured, not eyeballed
 *
 * The first draft of this table put a `honey` between amber and lemon and two
 * steps between sky and violet, and the specimen board showed exactly what was
 * wrong with it: amber, honey and lemon were one yellow printed three times,
 * and sky / denim / periwinkle / violet were four names for one blue. Two rows
 * of a picker that paint the same pixels are worse than one row.
 *
 * So every pair-and-percentage was scored on its OKLab distance to everything
 * already on the shelf, and the bar is not a number somebody liked: it is the
 * distance between **coral and terracotta**, the two token families that sit
 * closest together (0.0258). Nothing here may crowd the palette more than the
 * palette already crowds itself. `honey` measured 0.018 and is gone;
 * `periwinkle` measured 0.015 and is gone; the two that replaced them
 * (`persimmon`, `chartreuse`) were picked by taking the most SATURATED
 * candidate that cleared 0.045, because maximising distance alone walks
 * straight to the middle of the wheel and fills a picker with mud.
 *
 * Every one of the six original callout tints (amber, terracotta, moss, lemon,
 * sky, blush) is inside the first twenty on purpose: a document written before
 * this table existed must not have its tint hidden behind a "more" button.
 *
 * Ids are persisted in document JSON. Recolour one, never rename one.
 */
export const WASH_SWATCHES: readonly WashSwatch[] = [
  /* --- warm --- */
  family('coral', 'Coral'),
  family('terracotta', 'Terracotta'),
  mix('persimmon', 'Persimmon', 'amber', 'coral', 70),
  mix('marmalade', 'Marmalade', 'terracotta', 'amber', 50),
  family('amber', 'Amber'),
  family('lemon', 'Lemon'),
  /* --- green --- */
  mix('chartreuse', 'Chartreuse', 'lemon', 'lime', 50),
  family('lime', 'Lime'),
  mix('fern', 'Fern', 'lime', 'moss', 55),
  family('moss', 'Moss'),
  mix('eucalyptus', 'Eucalyptus', 'moss', 'turquoise', 50),
  family('turquoise', 'Turquoise'),
  /* --- cool --- */
  mix('teal', 'Teal', 'turquoise', 'sky', 50),
  family('sky', 'Sky'),
  mix('denim', 'Denim', 'sky', 'violet', 50),
  family('violet', 'Violet'),
  /* --- red end --- */
  mix('mulberry', 'Mulberry', 'violet', 'plum', 50),
  family('plum', 'Plum'),
  family('blush', 'Blush'),
  mix('rose', 'Rose', 'blush', 'coral', 50),
  /* --- the neutrals, behind "more" --- */
  fixed('timber', 'Timber', '#c08a52'),
  fixed('parchment', 'Parchment', '#c9ab7c'),
  fixed('graphite', 'Graphite', '#5d554a'),
  fixed('ink-blue', 'Ink blue', '#3c5a70'),
];

/** Swatch ids, in picker order. */
export const WASH_SWATCH_IDS: readonly string[] = WASH_SWATCHES.map((s) => s.id);

/**
 * How many options a picker shows before it offers "N more".
 *
 * The reader asked for this outright, and it is a rendering budget as much as a
 * layout one: several of the app's pickers draw their swatch on a CANVAS, so a
 * grid that shows everything at once is a grid that BAKES everything at once.
 * Twenty is where this table's spectrum ends, so the fold falls on a seam
 * rather than mid-row.
 */
export const PALETTE_PAGE = 20;

/** Derived, never restated: how many sit behind the "more" button. */
export const PALETTE_REST = Math.max(0, WASH_SWATCHES.length - PALETTE_PAGE);

const BY_ID: ReadonlyMap<string, WashSwatch> = new Map(WASH_SWATCHES.map((s) => [s.id, s]));

/** The swatch with this id, or undefined. Does not fall back — see `resolveWash`. */
export function washSwatch(id: unknown): WashSwatch | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** The id every fallback lands on. Amber, because it always was. */
export const DEFAULT_WASH_ID = 'amber';

/* ============================== custom colour ============================= */

/** The id a reader's own colour wears wherever a named swatch id is expected. */
export const CUSTOM_WASH_ID = 'custom';

const HEX_RE = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Any spelling of a hex colour → canonical lowercase `#rrggbb`, or null.
 *
 * Total, and deliberately generous about the input: `#A1B2C3`, `a1b2c3`,
 * `#abc`, and the same with whitespace round it all come back the same. What
 * it will NOT do is guess — `rebeccapurple`, `rgb(1 2 3)` and `''` are null,
 * because a colour this app cannot re-serialise as a hex is a colour it cannot
 * hand to a canvas.
 *
 * The null is the whole contract: a caller that receives null must keep what it
 * had rather than write a default over the reader's value.
 */
export function normaliseHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return null;
  const body = trimmed.replace(/^#/, '').toLowerCase();
  const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
  return `#${full}`;
}

/**
 * A reader's hex as the three faces the drawing needs.
 *
 * `palette.washFaces` does the work and does it by clamping rather than by
 * rejecting: lightness into the band the eleven families occupy, chroma capped
 * at the loudest of them, the base held above `INK_FLOOR` so the one brown
 * outline still has somewhere to be. `#000000` comes back as the darkest
 * pigment the style allows; `#00ff00` comes back as a green that belongs on
 * the page. Neither is refused, because refusing a colour a reader has already
 * chosen is the rudest thing a picker can do.
 */
export function customWashFaces(hex: string): WashFaces {
  return washFaces(hex);
}

/** One resolved colour, ready for both the DOM and a canvas. */
export interface ResolvedWash {
  /** `WASH_SWATCH_IDS` member, or `CUSTOM_WASH_ID`. */
  readonly id: string;
  /** The reader's own hex, canonical, when `id` is `CUSTOM_WASH_ID`. */
  readonly hex: string | null;
  readonly label: string;
  /** Paint the DOM with these (may be `var()` / `color-mix()` expressions). */
  readonly css: WashFaces;
  /** Paint a canvas with these (always plain hex). */
  readonly paint: WashFaces;
}

function customWash(hex: string): ResolvedWash {
  const faces = customWashFaces(hex);
  return { id: CUSTOM_WASH_ID, hex, label: hex.toUpperCase(), css: faces, paint: faces };
}

function swatchWash(swatch: WashSwatch): ResolvedWash {
  return { id: swatch.id, hex: null, label: swatch.label, css: swatch.css, paint: swatch.paint };
}

/**
 * Resolve a stored (id, hex) pair. Total, and it never throws away a colour it
 * can still read.
 *
 * The order is the point. A normaliser that runs `swatch(id) ?? DEFAULT` first
 * would answer "amber" for `('custom', '#3f7a5c')`, which is precisely the
 * silent degradation this feature exists to avoid — and it is what would happen
 * to every custom colour the moment some other code path forgot to carry the
 * id. So:
 *
 *  1. an explicit custom id with a readable hex → the reader's colour;
 *  2. a known swatch id → that swatch;
 *  3. a readable hex with an id nobody recognises (the id got lost, dropped by
 *     an older parser, or was never written) → still the reader's colour;
 *  4. a bare hex sitting in the id slot (a caller that only had one field) →
 *     still the reader's colour;
 *  5. only then, the default.
 */
export function resolveWash(id: unknown, hex?: unknown): ResolvedWash {
  const own = normaliseHex(hex);
  if (id === CUSTOM_WASH_ID && own !== null) return customWash(own);
  const named = washSwatch(id);
  if (named !== undefined) return swatchWash(named);
  if (own !== null) return customWash(own);
  const asHex = normaliseHex(id);
  if (asHex !== null) return customWash(asHex);
  return swatchWash(washSwatch(DEFAULT_WASH_ID) ?? (WASH_SWATCHES[0] as WashSwatch));
}

/**
 * ## Where a pigment meets a cache, and why there is no `colourTag()` here
 *
 * A new axis of variation in BAKED pixels has to reach the key of whatever
 * cache holds them, or the cache serves the old art forever and nothing fails.
 * That rule is why `flatSchemeTag()` / `shelfDesignTag()` exist. It was worth
 * checking whether these twenty-four need a tag of their own, and they do not —
 * but the answer is a fact about two specific caches rather than an assumption,
 * so it is written down:
 *
 *  - The **page raster cache** (`flip/rasterCache.ts`) holds a bitmap per page
 *    and is invalidated by a `MutationObserver` on the live leaf
 *    (`flip/FlipSurface.tsx`). Painting a callout writes `data-tint` and the
 *    three `--co-*` properties onto the element, which is an attribute
 *    mutation, so the snapshot is already stale-marked the moment the colour
 *    changes. A key fragment would be a second, weaker copy of that.
 *  - The **cover bake** (`art/covers.ts`) is the one baked surface that takes a
 *    reader-chosen colourway, and its key interpolates `params.charmColor`
 *    directly between `|` separators — so an index and a hex are both carried,
 *    and two readers' greens are two keys.
 *
 * A generic tag built on `resolveWash` would in fact have been WRONG for the
 * second of those: a charm colourway is an index into `art/charms.ts`, not a
 * swatch id, so every index would have resolved to the default and all
 * twenty-four would have shared one key.
 */

/* ========================== the reader's own shelf ======================== */

/**
 * How many of the reader's own colours are kept.
 *
 * The same twenty-four as the shelf above, which is not a coincidence: past
 * two dozen a swatch grid stops being a palette and starts being a history,
 * and the reader already has the one they want on whatever block they put it.
 */
export const CUSTOM_COLOUR_LIMIT = 24;

const STORE_KEY = 'bellanote.customColours';

let remembered: string[] | null = null;
const listeners = new Set<() => void>();

/**
 * `localStorage` if there is one.
 *
 * `src/art/` is loaded by node tests and by an OffscreenCanvas worker, neither
 * of which has a `window`; every access here is guarded rather than assumed,
 * and a throwing storage (private mode, a quota) degrades to in-memory rather
 * than taking the picker down with it.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function load(): string[] {
  if (remembered !== null) return remembered;
  const raw = store()?.getItem(STORE_KEY) ?? null;
  const out: string[] = [];
  if (raw !== null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const hex = normaliseHex(entry);
        if (hex !== null && !out.includes(hex)) out.push(hex);
        if (out.length >= CUSTOM_COLOUR_LIMIT) break;
      }
    }
  }
  remembered = out;
  return out;
}

function persist(): void {
  try {
    store()?.setItem(STORE_KEY, JSON.stringify(remembered ?? []));
  } catch {
    /* A full or refusing store must not cost the reader the colour on screen. */
  }
  for (const fn of listeners) fn();
}

/** The reader's own colours, most recent first. */
export function customColours(): readonly string[] {
  return load();
}

/**
 * Keep a colour on the reader's shelf. Returns the canonical hex, or null if
 * it was not a colour — the null is the caller's signal to leave the field
 * alone rather than to write a default into it.
 *
 * Re-adding one that is already there MOVES it to the front rather than
 * duplicating it, so the shelf stays a palette and not a log.
 */
export function rememberCustomColour(value: unknown): string | null {
  const hex = normaliseHex(value);
  if (hex === null) return null;
  const list = load();
  const at = list.indexOf(hex);
  if (at === 0) return hex;
  if (at > 0) list.splice(at, 1);
  list.unshift(hex);
  if (list.length > CUSTOM_COLOUR_LIMIT) list.length = CUSTOM_COLOUR_LIMIT;
  persist();
  return hex;
}

/** Take a colour off the shelf. Unknown values are a no-op. */
export function forgetCustomColour(value: unknown): void {
  const hex = normaliseHex(value);
  if (hex === null) return;
  const list = load();
  const at = list.indexOf(hex);
  if (at < 0) return;
  list.splice(at, 1);
  persist();
}

/** Called whenever the shelf changes. Returns its own unsubscribe. */
export function subscribeCustomColours(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam: drop the in-memory copy so the next read re-reads storage. */
export function resetCustomColours(): void {
  remembered = null;
}
