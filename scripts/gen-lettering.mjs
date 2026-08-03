/**
 * scripts/gen-lettering.mjs — write the lettering rules from the vocabulary.
 *
 * THE BUG THIS CLOSES. The catalogue's "lettering" shelf offers 122 choices —
 * 50 hands, 50 inks, 12 sizes, 10 ways of ranging the lines — and not one of
 * them had a single line of CSS. `BlockEffects` wrote `data-font`, `data-ink`,
 * `data-size` and `data-align` onto the block exactly as designed, and nothing
 * anywhere read them. Every one was inert, on the page and in the picker
 * alike; the reported symptom ("every hand specimen renders an identical Aa")
 * was the shelf telling the truth.
 *
 * This is the same failure `scripts/gen-tints.mjs` was written for, and its
 * note says why it keeps happening: a value named in the vocabulary with no
 * rule here does not error. It quietly does nothing. Generating from the
 * vocabulary is what makes "named" and "works" the same fact, so both
 * generators read the tables rather than repeating them.
 *
 * HOW FIFTY HANDS COME OUT OF FIVE FAMILIES. The app bundles five faces
 * (tokens.css), so a hand here is a face plus a stationer's treatment: weight,
 * tracking, case, slope and set size. That is what the vocabulary's own names
 * describe — "widely spaced", "tightly set", "small caps", "shouting" are
 * treatments, not fonts — so the table below is a reading of those names
 * rather than an invention on top of them.
 *
 * THE TWO TYPE RULES IN CLAUDE.md ARE ENFORCED HERE, NOT TRUSTED:
 *
 *   - Never render a handwriting face below 13px. `size` and `font` each carry
 *     a scale and they MULTIPLY, so "footnote hand" at "caption" size would be
 *     10.6px on a 17px body. The shared rule clamps with `max(13px, …)`, which
 *     holds for every one of the 600 combinations rather than for the ones
 *     someone thought to check.
 *   - Caveat (--font-heading) is for 20px and up. Eleven hands use it, and any
 *     of them can be dragged under that floor by a small `size`. The generator
 *     computes the product for every such pair and emits a fallback to the
 *     body face where it falls short — which is why there is a block of
 *     two-attribute rules at the end of the hands.
 *
 * Usage: node scripts/gen-lettering.mjs   (writes into src/styles/effects.css
 * between the BEGIN/END markers)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/styles/effects.css');
const VOCAB = join(ROOT, 'src/editor/effects/vocabulary.ts');

const BEGIN = '/* === BEGIN generated lettering (scripts/gen-lettering.mjs) === */';
const END = '/* === END generated lettering === */';

const SCOPE = ':is(.nb-prose, .nb-fx-specimen)';

/** Body size in px, from tokens.css. The two floors below are read against it. */
const BODY_PX = 17;
/** --font-heading is documented as ">= 20px only". */
const HEADING_MIN_PX = 20;
/** No handwriting face below this, per CLAUDE.md. */
const HAND_MIN_PX = 13;

/* ========================================================================== *
 *                                  the hands                                 *
 * ========================================================================== */

/** The five bundled faces, plus the two generic stacks the "printed" hands want. */
const FAMILY = {
  body: 'var(--font-body)',
  accent: 'var(--font-accent)',
  heading: 'var(--font-heading)',
  label: 'var(--font-label)',
  ui: 'var(--font-ui)',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Mono", Consolas, "Courier New", monospace',
};

/** Which families are handwriting, and so subject to the 13px floor. */
const HANDWRITTEN = new Set(['body', 'accent', 'heading', 'label']);

/**
 * hand -> face + treatment.
 *
 * `scale` is set size relative to the body. Every `heading` hand is >= 1.18 so
 * that on its own it clears 20px; the pairs that a small `size` would drag
 * under are handled separately below.
 */
const FONTS = {
  /* the faces, plainly set */
  hand: { family: 'body' },
  casual: { family: 'accent' },
  marker: { family: 'accent', weight: 700, scale: 1.06 },
  script: { family: 'heading', scale: 1.25 },
  chalk: { family: 'label', spacing: '0.02em' },
  note: { family: 'label', scale: 0.88 },
  serif: { family: 'serif', scale: 0.96 },
  book: { family: 'serif', scale: 0.98, spacing: '0.005em' },
  mono: { family: 'mono', scale: 0.92 },

  /* the same faces, set as a stationer would */
  display: { family: 'heading', weight: 700, scale: 1.6 },
  smallcaps: { family: 'ui', transform: 'uppercase', spacing: '0.08em', scale: 0.92 },
  wide: { family: 'body', spacing: '0.14em' },
  tight: { family: 'body', spacing: '-0.02em', word: '-0.04em' },
  shout: { family: 'accent', transform: 'uppercase', weight: 700, spacing: '0.06em' },
  quiet: { family: 'body', scale: 0.84 },
  typed: { family: 'mono', scale: 0.92, spacing: '0.02em' },
  ledger: { family: 'mono', scale: 0.9, spacing: '0.04em' },
  italic: { family: 'body', style: 'italic' },
  heavy: { family: 'body', weight: 700 },
  light: { family: 'label', scale: 0.96 },
  label: { family: 'label', transform: 'uppercase', spacing: '0.1em', scale: 0.86 },
  copperplate: { family: 'heading', style: 'italic', scale: 1.3 },
  engrave: { family: 'ui', transform: 'uppercase', spacing: '0.16em', weight: 600, scale: 0.9 },
  titling: { family: 'heading', scale: 1.45, spacing: '0.02em' },
  byline: { family: 'label', style: 'italic', scale: 0.88 },
  stencil: { family: 'ui', transform: 'uppercase', weight: 800, spacing: '0.1em', scale: 0.94 },
  telegram: { family: 'mono', transform: 'uppercase', spacing: '0.08em', scale: 0.9 },
  receipt: { family: 'mono', scale: 0.86, spacing: '0.01em' },
  blackboard: { family: 'label', transform: 'uppercase', spacing: '0.07em', scale: 1.05 },
  lecture: { family: 'heading', scale: 1.3 },
  signature: { family: 'heading', style: 'italic', scale: 1.35 },
  flyleaf: { family: 'serif', style: 'italic', scale: 1.0 },
  colophon: { family: 'serif', transform: 'uppercase', spacing: '0.12em', scale: 0.84 },
  footnote: { family: 'body', scale: 0.8 },
  epigraph: { family: 'serif', style: 'italic', scale: 0.94 },
  pullquote: { family: 'heading', style: 'italic', scale: 1.5 },
  headline: { family: 'accent', weight: 700, scale: 1.35 },
  poster: { family: 'heading', weight: 700, scale: 1.7, spacing: '0.01em' },
  graffiti: { family: 'heading', style: 'italic', weight: 700, scale: 1.4 },
  sharpie: { family: 'accent', weight: 700, scale: 1.12, word: '0.02em' },
  crayon: { family: 'accent', weight: 700, scale: 1.08, spacing: '0.03em' },
  pencilled: { family: 'label', scale: 0.98 },
  biro: { family: 'body', scale: 0.98, spacing: '0.01em' },
  fountain: { family: 'heading', scale: 1.22 },
  copybook: { family: 'label', spacing: '0.04em' },
  primer: { family: 'heading', scale: 1.28, spacing: '0.03em' },
  scrawl: { family: 'accent', style: 'italic', spacing: '-0.01em' },
  neat: { family: 'ui', scale: 0.95 },
  draft: { family: 'label', style: 'italic', scale: 0.95 },
  archive: { family: 'ui', transform: 'uppercase', spacing: '0.14em', scale: 0.85, weight: 600 },
};

/* ========================================================================== *
 *                                  the inks                                  *
 * ========================================================================== */

/**
 * ink -> [wash family, shift], read exactly as gen-tints.mjs reads a tint:
 * negative pulls toward the family's light end, positive toward its deep one.
 *
 * An ink is not a wash, though — it has to stay legible as TEXT on cream — so
 * every one is taken to the family's deep end and then cut with graphite.
 * That is what keeps "mint" and "blossom" readable without turning the fifty
 * into fifty greys.
 */
const INKS = {
  sepia: ['token', 'var(--ink-sepia)'],
  graphite: ['token', 'var(--ink-graphite)'],
  'ink-blue': ['sky', 0.7],
  charcoal: ['sky', 0.9],
  irongall: ['violet', 0.85],
  slate: ['sky', 0.45],
  amber: ['amber', 0],
  gold: ['amber', -0.2],
  ochre: ['amber', 0.4],
  mustard: ['lemon', 0.45],
  sand: ['amber', -0.6],
  bronze: ['amber', 0.65],
  copper: ['coral', 0.2],
  crimson: ['coral', 0.5],
  terracotta: ['terracotta', 0],
  coral: ['coral', 0],
  brick: ['terracotta', 0.4],
  rust: ['terracotta', 0.7],
  wine: ['plum', 0.75],
  burgundy: ['plum', 0.85],
  madder: ['coral', 0.4],
  oxblood: ['terracotta', 0.9],
  blossom: ['blush', -0.5],
  peach: ['coral', -0.7],
  moss: ['moss', 0],
  olive: ['lime', 0.5],
  forest: ['moss', 0.7],
  pine: ['moss', 0.85],
  sage: ['moss', -0.6],
  lime: ['lime', 0],
  fern: ['moss', -0.3],
  teal: ['turquoise', 0.35],
  turquoise: ['turquoise', 0],
  jade: ['turquoise', 0.6],
  mint: ['turquoise', -0.75],
  seafoam: ['turquoise', -0.55],
  skyink: ['sky', 0],
  denim: ['sky', 0.3],
  cobalt: ['sky', 0.6],
  navy: ['sky', 0.8],
  indigo: ['violet', 0.7],
  violet: ['violet', 0],
  plum: ['plum', 0],
  mulberry: ['blush', 0.6],
  orchid: ['violet', -0.3],
  lilac: ['violet', -0.55],
  lavender: ['violet', -0.7],
  umber: ['terracotta', 0.8],
  walnut: ['amber', 0.85],
  clay: ['terracotta', -0.35],
};

/** The ink colour for one family + shift. */
function inkColor(family, shift) {
  if (family === 'token') return shift;
  const base = `var(--wash-${family})`;
  const light = `var(--wash-${family}-light)`;
  const deep = `var(--wash-${family}-deep)`;
  const toward = shift < 0 ? light : deep;
  const amount = Math.round(Math.abs(shift) * 100);
  const mid = amount === 0 ? base : `color-mix(in srgb, ${toward} ${amount}%, ${base})`;
  // Down to the family's deep end so it reads as pigment on paper...
  const deepened = `color-mix(in srgb, ${deep} 55%, ${mid})`;
  // ...then cut with graphite so even the palest name is still writing.
  return `color-mix(in srgb, ${deepened} 82%, var(--ink-graphite))`;
}

/* ========================================================================== *
 *                             the sizes and ranging                          *
 * ========================================================================== */

/** size -> set size relative to the body. `caption` is 13.3px on a 17px body. */
const SIZES = {
  caption: 0.78,
  xs: 0.84,
  sm: 0.9,
  compact: 0.95,
  md: 1.0,
  roomy: 1.08,
  lg: 1.2,
  xl: 1.4,
  jumbo: 1.7,
  giant: 2.1,
  colossal: 2.6,
  marquee: 3.2,
};

/** ranging -> the declarations that range the lines that way. */
const ALIGNS = {
  left: { 'text-align': 'left' },
  center: { 'text-align': 'center' },
  right: { 'text-align': 'right' },
  justify: { 'text-align': 'justify', hyphens: 'auto' },
  indent: { 'text-align': 'left', 'text-indent': '2.2em' },
  hanging: { 'text-align': 'left', 'text-indent': '-1.8em', 'padding-left': '1.8em' },
  outdent: { 'text-align': 'left', 'text-indent': '-0.9em', 'margin-left': '0.9em' },
  // text-wrap does the typesetting the names ask for; both degrade to normal
  // wrapping where it is unsupported, which is the right way to fail.
  balance: { 'text-align': 'left', 'text-wrap': 'balance' },
  tidy: { 'text-align': 'left', 'text-wrap': 'pretty' },
  narrow: { 'text-align': 'left', 'max-width': '26ch' },
};

/* ========================================================================== *
 *                                  generate                                  *
 * ========================================================================== */

/** Read one vocabulary table's value names, so nothing here is invented. */
function names(table) {
  const src = readFileSync(VOCAB, 'utf8');
  const start = src.indexOf(`const ${table}: readonly EffectValue[] = [`);
  if (start < 0) throw new Error(`${table} table not found in vocabulary.ts`);
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/\bv\('([^']+)'/g)].map((m) => m[1]);
}

/** Fail loudly when the vocabulary grows a value this file has no rule for. */
function checked(table, map) {
  const list = names(table);
  const missing = list.filter((n) => map[n] === undefined);
  if (missing.length > 0) {
    console.error(`${table}: nothing mapped for ${missing.join(', ')}`);
    process.exit(1);
  }
  const extra = Object.keys(map).filter((n) => !list.includes(n));
  if (extra.length > 0) {
    console.error(`${table}: mapped but not in the vocabulary: ${extra.join(', ')}`);
    process.exit(1);
  }
  return list;
}

const fontNames = checked('FONT', FONTS);
const inkNames = checked('INK', INKS);
const sizeNames = checked('SIZE', SIZES);
const alignNames = checked('ALIGN', ALIGNS);

const rule = (selector, decls) =>
  `${selector} {\n${Object.entries(decls)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;

/* --- the shared size rule: one place where the two scales multiply -------- */

const shared = [
  `/* The hands and the sizes both scale the type, so they meet HERE rather`,
  `   than each writing font-size and the last one winning. max() is the 13px`,
  `   floor from CLAUDE.md, applied to every combination by construction. */`,
  rule(`${SCOPE} [data-font],\n${SCOPE} [data-size]`, {
    'font-size': `max(${HAND_MIN_PX}px, calc(1em * var(--fx-font-scale, 1) * var(--fx-size-scale, 1)))`,
  }),
].join('\n');

/* --- hands ---------------------------------------------------------------- */

const fontRules = fontNames
  .map((name) => {
    const f = FONTS[name];
    const decls = { 'font-family': FAMILY[f.family] };
    if (f.scale !== undefined) decls['--fx-font-scale'] = String(f.scale);
    if (f.weight !== undefined) decls['font-weight'] = String(f.weight);
    if (f.style !== undefined) decls['font-style'] = f.style;
    if (f.transform !== undefined) decls['text-transform'] = f.transform;
    if (f.spacing !== undefined) decls['letter-spacing'] = f.spacing;
    if (f.word !== undefined) decls['word-spacing'] = f.word;
    return rule(`${SCOPE} [data-font='${name}']`, decls);
  })
  .join('\n\n');

/* --- the heading-face floor, pair by pair --------------------------------- */

const pairs = [];
for (const fname of fontNames) {
  const f = FONTS[fname];
  if (f.family !== 'heading') continue;
  for (const sname of sizeNames) {
    const px = BODY_PX * (f.scale ?? 1) * SIZES[sname];
    if (px >= HEADING_MIN_PX) continue;
    pairs.push(
      rule(`${SCOPE} [data-font='${fname}'][data-size='${sname}']`, {
        // Caveat is unreadable small; the body hand is the nearest face that
        // is not, so the block keeps its size and gives up only the face.
        'font-family': FAMILY.body,
      }),
    );
  }
}

/* --- inks, sizes, ranging ------------------------------------------------- */

const inkRules = inkNames
  .map((name) => rule(`${SCOPE} [data-ink='${name}']`, { color: inkColor(...INKS[name]) }))
  .join('\n\n');

const sizeRules = sizeNames
  .map((name) => rule(`${SCOPE} [data-size='${name}']`, { '--fx-size-scale': String(SIZES[name]) }))
  .join('\n\n');

const alignRules = alignNames
  .map((name) => rule(`${SCOPE} [data-align='${name}']`, ALIGNS[name]))
  .join('\n\n');

/* --- assemble ------------------------------------------------------------- */

const block = [
  BEGIN,
  `/* ${fontNames.length} hands, ${inkNames.length} inks, ${sizeNames.length} sizes,`,
  `   ${alignNames.length} ways of ranging — the whole "lettering" shelf, which`,
  `   shipped with no CSS at all and so did nothing at all.`,
  `   Do not edit by hand — run: node scripts/gen-lettering.mjs */`,
  '',
  shared,
  '',
  `/* ---- hands ---- */`,
  '',
  fontRules,
  '',
  `/* ${pairs.length} pairs where a small size would drag the heading face under`,
  `   ${HEADING_MIN_PX}px, which it is documented never to go. */`,
  '',
  pairs.join('\n\n'),
  '',
  `/* ---- inks ---- */`,
  '',
  inkRules,
  '',
  `/* ---- sizes ---- */`,
  '',
  sizeRules,
  '',
  `/* ---- ranging ---- */`,
  '',
  alignRules,
  END,
].join('\n');

const css = readFileSync(CSS, 'utf8');
const b = css.indexOf(BEGIN);
const e = css.indexOf(END);
const next =
  b >= 0 && e > b
    ? css.slice(0, b) + block + css.slice(e + END.length)
    : `${css.trimEnd()}\n\n${block}\n`;

writeFileSync(CSS, next, 'utf8');
console.log(
  `wrote ${fontNames.length} hands (+${pairs.length} floor pairs), ${inkNames.length} inks, ` +
    `${sizeNames.length} sizes, ${alignNames.length} rangings into ${CSS.replace(ROOT, '.')}`,
);
