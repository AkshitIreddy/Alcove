/**
 * scripts/gen-underlines.mjs — write the underline rules from the vocabulary.
 *
 * The third axis found inert by the same check that caught the other two
 * (tests/catalogue-reach.test.ts, "everything the editor accepts, the
 * stylesheet paints"). `[data-underline]` existed in effects.css and set one
 * thing — `position: relative` — for a pseudo-element that was never written.
 * All fifty marks did nothing.
 *
 * WHY THESE ARE TEXT PROPERTIES AND NOT DRAWN SHAPES. The obvious way to draw
 * a mark under a block is a positioned `::before`/`::after`, and on this
 * element both are taken: tape reads `::before` and `::after` (`--tp-*` and
 * `--tp2-*`), washi the same, frame `::before`. `border` and `outline` belong
 * to frame too, and `background-image` to paper. A block can carry tape AND
 * paper AND a frame AND an underline at once, so an underline that borrowed
 * any of those would silently break a combination rather than fail loudly.
 *
 * What is genuinely free is the type itself: `text-decoration-*` and
 * `text-emphasis-*` were unused across the whole stylesheet. They are also the
 * honest tools — an underline is a property of the writing, not a shape parked
 * behind it — and they follow the text when it wraps, which a positioned bar
 * never does.
 *
 * ONE COMPROMISE, STATED. Five names — boxed, circled, pill, bracketed,
 * parens — describe an ENCLOSURE, and no text property draws one. They are set
 * as rules above and below with distinct styles, which is as close as this
 * element gets while the pseudo-elements belong to tape and frame. Better a
 * mark that reads clearly and is not quite the word than a fifth of the axis
 * doing nothing, which is where this started.
 *
 * Usage: node scripts/gen-underlines.mjs   (writes into src/styles/effects.css
 * between the BEGIN/END markers)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'src/styles/effects.css');
const VOCAB = join(ROOT, 'src/editor/effects/vocabulary.ts');

const BEGIN = '/* === BEGIN generated underlines (scripts/gen-underlines.mjs) === */';
const END = '/* === END generated underlines === */';

const SCOPE = ':is(.nb-prose, .nb-fx-specimen)';

/** A rule drawn with text-decoration. */
const d = (line, style, thickness, offset, color, skip) => ({
  kind: 'decoration',
  line,
  style,
  thickness,
  offset,
  color,
  skip,
});

/** A repeating mark set under every glyph, with text-emphasis. */
const e = (mark, color) => ({ kind: 'emphasis', mark, color });

const INK = 'var(--ink-sepia)';
const SOFT = 'var(--ink-sepia-soft)';
const GRAPHITE = 'var(--ink-graphite)';

const UNDERLINES = {
  /* --- rules, in the ordinary sense ------------------------------------- */
  ruled: d('underline', 'solid', '1.5px', '0.18em', INK),
  hairline: d('underline', 'solid', '1px', '0.22em', SOFT),
  thick: d('underline', 'solid', '6px', '0.12em', INK),
  double: d('underline', 'double', '1.5px', '0.14em', INK),
  triple: d('underline overline line-through', 'solid', '1px', '0.16em', SOFT),
  dotted: d('underline', 'dotted', '2px', '0.16em', INK),
  dashed: d('underline', 'dashed', '2px', '0.16em', INK),
  dotdash: d('underline', 'dashed', '3px', '0.2em', SOFT),
  rail: d('underline', 'double', '3px', '0.22em', SOFT),
  macron: d('overline', 'solid', '2px', '0.1em', INK),

  /* --- moving lines ------------------------------------------------------ */
  // Headings use a large handwritten face with deep descenders. The old
  // 2px/.16em wave sat inside those glyphs and looked like two broken strokes
  // rather than one underline. Lower and lighten it, while keeping the wave
  // continuous through the word.
  squiggle: d('underline', 'wavy', '1.5px', '0.28em', INK, 'none'),
  wavy: d('underline', 'wavy', '3px', '0.2em', INK),
  scribble: d('line-through', 'wavy', '3px', '0.1em', SOFT),
  tapered: d('underline', 'solid', '3px', '0.14em', SOFT, 'none'),

  /* --- struck through ---------------------------------------------------- */
  struck: d('line-through', 'solid', '2px', '0.1em', INK),
  redline: d('line-through', 'solid', '2.5px', '0.1em', 'var(--wash-terracotta-deep)'),

  /* --- pens and pencils, told apart by weight and colour ----------------- */
  pencilled: d('underline', 'solid', '1.5px', '0.17em', `color-mix(in srgb, ${GRAPHITE} 55%, transparent)`),
  fineliner: d('underline', 'solid', '1px', '0.1em', GRAPHITE),
  gel: d('underline', 'solid', '2.5px', '0.15em', 'var(--wash-violet-deep)'),
  chalked: d('underline', 'dotted', '3px', '0.2em', 'var(--wash-sky-deep)'),
  crayoned: d('underline', 'solid', '4px', '0.13em', 'var(--wash-coral-deep)', 'none'),
  brush: d('underline', 'solid', '5px', '0.05em', 'var(--wash-terracotta)', 'none'),

  /* --- sweeps: a thick rule pulled UP behind the words, so it reads as a
         highlighter rather than as a rule under them ------------------------ */
  marker: d('underline', 'solid', '0.7em', '-0.5em', 'color-mix(in srgb, var(--wash-lemon) 55%, transparent)', 'none'),
  sweep: d('underline', 'solid', '1.1em', '-0.78em', 'color-mix(in srgb, var(--wash-lemon) 40%, transparent)', 'none'),
  halfsweep: d('underline', 'solid', '0.5em', '-0.28em', 'color-mix(in srgb, var(--wash-lemon) 48%, transparent)', 'none'),
  fade: d('underline', 'solid', '0.8em', '-0.55em', 'color-mix(in srgb, var(--wash-amber) 22%, transparent)', 'none'),

  /* --- the five enclosures; see the note at the top ---------------------- */
  boxed: d('underline overline', 'solid', '2px', '0.12em', INK),
  circled: d('underline overline', 'wavy', '2px', '0.12em', INK),
  pill: d('underline overline', 'solid', '3px', '0.2em', SOFT),
  bracketed: d('underline overline', 'double', '1.5px', '0.14em', INK),
  parens: d('underline overline', 'dotted', '2px', '0.16em', SOFT),

  /* --- marks repeated under every glyph ---------------------------------- */
  caret: e('^', INK),
  tickmark: e('✓', 'var(--wash-moss-deep)'),
  chevrons: e('˅', INK),
  loops: e('◡', INK),
  coil: e('∿', INK),
  rungs: e('|', SOFT),
  comb: e('ı', SOFT),
  sawtooth: e('˄', INK),
  beaded: e('dot', INK),
  starred: e('*', 'var(--wash-amber-deep)'),
  ogee: e('˷', SOFT),
  swash: e('~', INK),
  flourish: e('⁓', 'var(--wash-plum-deep)'),
  tail: e('_', SOFT),
  hook: e('˒', INK),
  curl: e('˓', INK),
  kick: e('´', INK),
  arrow: e('›', INK),
  zigzag: e('v', SOFT),
  scribbleless: null, // placeholder removed below if the vocabulary lacks it
};
delete UNDERLINES.scribbleless;

/** Read the value names straight out of the vocabulary. */
function names() {
  const src = readFileSync(VOCAB, 'utf8');
  const start = src.indexOf('const UNDERLINE: readonly EffectValue[] = [');
  if (start < 0) throw new Error('UNDERLINE table not found in vocabulary.ts');
  const end = src.indexOf('];', start);
  return [...src.slice(start, end).matchAll(/\bv\('([^']+)'/g)].map((m) => m[1]);
}

const list = names();
const missing = list.filter((n) => UNDERLINES[n] === undefined);
const extra = Object.keys(UNDERLINES).filter((n) => !list.includes(n));
if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) console.error(`nothing mapped for: ${missing.join(', ')}`);
  if (extra.length > 0) console.error(`mapped but not in the vocabulary: ${extra.join(', ')}`);
  process.exit(1);
}

function decls(spec) {
  if (spec.kind === 'emphasis') {
    return {
      // `filled`/`open` only apply to the keyword forms; a string mark ignores
      // them, which is why the keyword entry (`beaded`) carries one and the
      // rest do not.
      'text-emphasis-style': spec.mark === 'dot' ? 'filled dot' : `'${spec.mark}'`,
      'text-emphasis-color': spec.color,
      'text-emphasis-position': 'under left',
    };
  }
  const out = {
    'text-decoration-line': spec.line,
    'text-decoration-style': spec.style,
    'text-decoration-thickness': spec.thickness,
    'text-underline-offset': spec.offset,
    'text-decoration-color': spec.color,
  };
  // Descenders punch a hole through a thin rule, which is right for a pen and
  // wrong for a highlighter sweep.
  if (spec.skip !== undefined) out['text-decoration-skip-ink'] = spec.skip;
  return out;
}

const rules = list
  .map((name) => {
    const body = Object.entries(decls(UNDERLINES[name]))
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `${SCOPE} [data-underline='${name}'] {\n${body}\n}`;
  })
  .join('\n\n');

const block = [
  BEGIN,
  `/* ${list.length} marks, drawn with text-decoration and text-emphasis because`,
  `   this block's ::before, ::after, border, outline and background already`,
  `   belong to tape, washi, frame and paper — and a mark that follows the text`,
  `   when it wraps is the right one anyway.`,
  `   Do not edit by hand — run: node scripts/gen-underlines.mjs */`,
  '',
  rules,
  END,
].join('\n');

const css = readFileSync(CSS, 'utf8');
const b = css.indexOf(BEGIN);
const en = css.indexOf(END);
const next =
  b >= 0 && en > b
    ? css.slice(0, b) + block + css.slice(en + END.length)
    : `${css.trimEnd()}\n\n${block}\n`;

writeFileSync(CSS, next, 'utf8');
console.log(`wrote ${list.length} underline rules into ${CSS.replace(ROOT, '.')}`);
