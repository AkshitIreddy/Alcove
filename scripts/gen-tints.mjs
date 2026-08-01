/**
 * scripts/gen-tints.mjs — write the tint rules from the tint vocabulary.
 *
 * The `color` axis carries fifty pigments and each one retargets three custom
 * properties (`--fx-light / --fx-base / --fx-deep`) that the sticky note, the
 * callout, the banner, the quote card, the envelope and the washi strip all
 * already read. That is the whole design: one new pigment is a new look on
 * every piece of stationery at once.
 *
 * It shipped with none of those rules written, so all fifty were inert — the
 * washi CSS read `--fx-base` and nothing on the page ever set it.
 *
 * Generated rather than hand-written because the failure mode is silent: a
 * pigment named in the vocabulary with no rule here does not error, it just
 * quietly does nothing when a reader picks it. Generating from the vocabulary
 * makes "named" and "works" the same fact.
 *
 * Each tint is a FAMILY from tokens.css plus a shift, so every one is mixed
 * from the eleven wash families the rest of the app is painted with rather
 * than being fifty free-floating hexes. `shift` moves the base toward the
 * family's own light or deep end: two pigments on one family stay siblings
 * and still read apart.
 *
 * Usage: node scripts/gen-tints.mjs   (writes into src/styles/effects.css
 * between the BEGIN/END markers)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/styles/effects.css');
const VOCAB = join(ROOT, 'src/editor/effects/vocabulary.ts');

const BEGIN = '/* === BEGIN generated tints (scripts/gen-tints.mjs) === */';
const END = '/* === END generated tints === */';

/**
 * tint name -> [family, shift]
 *
 * shift: -1 pulls the base toward the family's light end, +1 toward its deep
 * end, 0 leaves it. Chosen by what the WORD means — "peach" is a pale coral,
 * "wine" is a deep cherry — so the picker's labels tell the truth.
 */
const MAP = {
  /* the seven the writing language already knew — unshifted, so they stay
     exactly the colours the script has always produced */
  amber: ['amber', 0],
  terracotta: ['terracotta', 0],
  moss: ['moss', 0],
  lemon: ['lemon', 0],
  sky: ['sky', 0],
  blush: ['blush', 0],
  graphite: ['sky', 1],

  /* warm */
  honey: ['amber', -0.35],
  apricot: ['coral', -0.5],
  peach: ['coral', -0.7],
  straw: ['lemon', -0.55],
  mustard: ['lemon', 0.45],
  ochre: ['amber', 0.4],
  sand: ['amber', -0.6],

  /* red */
  coral: ['coral', 0],
  cherry: ['coral', 0.35],
  brick: ['terracotta', 0.4],
  rust: ['terracotta', 0.7],
  wine: ['plum', 0.75],

  /* pink / purple */
  petal: ['blush', -0.55],
  mulberry: ['blush', 0.6],
  plum: ['plum', 0],
  violet: ['violet', 0],
  orchid: ['violet', -0.3],
  lilac: ['violet', -0.55],
  lavender: ['violet', -0.7],

  /* blue */
  periwinkle: ['violet', -0.15],
  cornflower: ['sky', -0.45],
  denim: ['sky', 0.3],
  navy: ['sky', 0.8],
  indigo: ['violet', 0.7],

  /* blue-green */
  teal: ['turquoise', 0.35],
  turquoise: ['turquoise', 0],
  seafoam: ['turquoise', -0.55],
  mint: ['turquoise', -0.75],
  jade: ['turquoise', 0.6],

  /* green */
  fernwash: ['moss', -0.4],
  olive: ['lime', 0.5],
  sage: ['moss', -0.6],
  lime: ['lime', 0],
  forest: ['moss', 0.7],

  /* brown / neutral */
  clay: ['terracotta', -0.35],
  copper: ['coral', 0.2],
  bronze: ['amber', 0.65],
  cocoa: ['terracotta', 0.85],
  walnut: ['amber', 0.85],
  ash: ['sky', 0.55],
  stone: ['sky', -0.2],
  pebble: ['sky', -0.65],
  slate: ['sky', 0.45],
};

/** Read the tint value names straight out of the vocabulary. */
function tintNames() {
  const src = readFileSync(VOCAB, 'utf8');
  const start = src.indexOf('const TINT:');
  if (start < 0) throw new Error('TINT table not found in vocabulary.ts');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/\bv\('([^']+)'/g)].map((m) => m[1]);
}

/**
 * One slot, as a color-mix off the family's three tokens.
 *
 * A shift toward light mixes the family's base with its light token; toward
 * deep, with its deep one. Staying inside the family's own three values is
 * what keeps fifty pigments looking like one palette.
 */
function slot(family, shift, which) {
  const base = `var(--wash-${family})`;
  const light = `var(--wash-${family}-light)`;
  const deep = `var(--wash-${family}-deep)`;
  const toward = shift < 0 ? light : deep;
  const amount = Math.round(Math.abs(shift) * 100);

  const mid = amount === 0 ? base : `color-mix(in srgb, ${toward} ${amount}%, ${base})`;
  if (which === 'base') return mid;
  // The light and deep slots are the same pigment stepped either side of it,
  // so a tint keeps a usable range for the stationery that reads all three.
  if (which === 'light') return `color-mix(in srgb, ${light} 62%, ${mid})`;
  return `color-mix(in srgb, ${deep} 58%, ${mid})`;
}

const names = tintNames();
const missing = names.filter((n) => MAP[n] === undefined);
if (missing.length > 0) {
  console.error(`no family mapped for: ${missing.join(', ')}`);
  process.exit(1);
}

const rules = names
  .map((name) => {
    const [family, shift] = MAP[name];
    return (
      `:is(.nb-prose, .nb-fx-specimen) [data-color='${name}'] {\n` +
      `  --fx-light: ${slot(family, shift, 'light')};\n` +
      `  --fx-base: ${slot(family, shift, 'base')};\n` +
      `  --fx-deep: ${slot(family, shift, 'deep')};\n` +
      `}`
    );
  })
  .join('\n\n');

const block =
  `${BEGIN}\n` +
  `/* ${names.length} pigments, each mixed from the wash families in tokens.css.\n` +
  `   Do not edit by hand — run: node scripts/gen-tints.mjs */\n\n` +
  `${rules}\n` +
  `${END}`;

const css = readFileSync(CSS, 'utf8');
const b = css.indexOf(BEGIN);
const e = css.indexOf(END);
const next =
  b >= 0 && e > b
    ? css.slice(0, b) + block + css.slice(e + END.length)
    : `${css.trimEnd()}\n\n${block}\n`;

writeFileSync(CSS, next, 'utf8');
console.log(`wrote ${names.length} tint rules into ${CSS.replace(ROOT, '.')}`);
