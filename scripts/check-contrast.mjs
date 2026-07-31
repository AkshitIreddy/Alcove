/**
 * scripts/check-contrast.mjs — WCAG contrast gates for the design tokens.
 *
 * The palette is allowed to be loud (HANDOFF.md: "very colorful — not muted
 * or tasteful"), but every pairing that carries text or an essential icon
 * must clear a measured bar in EACH of the four UI themes (parchment,
 * pastel, botanical, night). That bar is checked here, not guessed:
 *
 *   body text / small text        >= 4.5:1  (WCAG AA normal)
 *   icons, deep rims, focus rings >= 3.0:1  (WCAG AA large / non-text UI)
 *
 * The script is zero-dependency: it reads src/styles/tokens.css (base
 * palette) and src/styles/settings.css (the sanctioned [data-theme] remaps
 * and the extra book washes), resolves var() chains per theme, computes the
 * WCAG 2.1 ratio for every gated pair, prints a per-theme table, and exits
 * non-zero on any violation. A pair whose token cannot be resolved counts
 * as a violation too — a renamed-away token must be LOUD, never silent.
 *
 * The pure functions are exported so tests/contrast.test.ts can gate the
 * same numbers in the unit suite (no browser needed, unlike the e2e
 * visual-audit spec which measures computed styles in-page).
 *
 *   node scripts/check-contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_CSS = join(ROOT, 'src', 'styles', 'tokens.css');
const SETTINGS_CSS = join(ROOT, 'src', 'styles', 'settings.css');

/* ------------------------------ CSS parsing ------------------------------ */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Pull the custom-property declarations out of a `{ ... }` block body.
 * Values are kept raw — `var(--x)` chains are resolved later, per theme.
 */
function parseDecls(body) {
  const out = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(body)) !== null) out.set(m[1].toLowerCase(), m[2].trim());
  return out;
}

/**
 * Extract every `:root`-family rule from a stylesheet, keyed by its
 * selector: ':root', ":root[data-theme='night']", ":root[data-ink=...]", ...
 */
function parseRootRules(css) {
  const clean = stripComments(css);
  const rules = new Map();
  const re = /(:root(?:\[[^\]]+\])?(?:\.[a-z-]+)?)\s*\{/gi;
  let m;
  while ((m = re.exec(clean)) !== null) {
    // Balanced-brace scan for the block body.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < clean.length && depth > 0) {
      if (clean[i] === '{') depth += 1;
      else if (clean[i] === '}') depth -= 1;
      i += 1;
    }
    rules.set(m[1], clean.slice(start, i - 1));
  }
  return rules;
}

/**
 * Load the four UI themes as fully merged token maps.
 * parchment = tokens.css :root + settings.css extra-wash :root.
 * The other three = parchment + their [data-theme] remap.
 */
export function loadThemes(rootDir = ROOT) {
  const tokens = readFileSync(join(rootDir, 'src', 'styles', 'tokens.css'), 'utf8');
  const settings = readFileSync(join(rootDir, 'src', 'styles', 'settings.css'), 'utf8');

  const base = new Map();
  for (const body of parseRootRules(tokens).values()) {
    for (const [k, v] of parseDecls(body)) base.set(k, v);
  }
  for (const [selector, body] of parseRootRules(settings)) {
    if (selector === ':root') {
      for (const [k, v] of parseDecls(body)) base.set(k, v);
    }
  }

  const themes = { parchment: new Map(base) };
  for (const [selector, body] of parseRootRules(settings)) {
    const m = selector.match(/^:root\[data-theme='([a-z]+)'\]$/i);
    if (!m) continue;
    const merged = new Map(base);
    for (const [k, v] of parseDecls(body)) merged.set(k, v);
    themes[m[1].toLowerCase()] = merged;
  }
  return themes;
}

/* ----------------------------- color resolving --------------------------- */

/** Resolve a token to { r, g, b, a } within a theme map; null if impossible. */
export function resolveColor(theme, token, seen = new Set()) {
  let raw = theme.get(token);
  if (raw === undefined) return null;
  const varMatch = raw.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (varMatch) {
    if (seen.has(varMatch[1])) return null; // cyclic alias
    seen.add(varMatch[1]);
    return resolveColor(theme, varMatch[1].toLowerCase(), seen);
  }
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    const n = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
      a: n.length === 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }
  return null;
}

const channel = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (r, g, b) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG 2.1 contrast ratio; foreground alpha is flattened onto the ground. */
export function contrastRatio(fg, bg) {
  const mix = (f, b) => f * fg.a + b * (1 - fg.a);
  const l1 = luminance(mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b));
  const l2 = luminance(bg.r, bg.g, bg.b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* --------------------------------- pairs --------------------------------- */

const WASHES = [
  'amber', 'terracotta', 'moss', 'lemon', 'sky', 'blush', 'plum',
  'coral', 'turquoise', 'violet', 'lime',
  'peach', 'sage', 'lavender', 'sand', 'slate',
];

/* Deep pigments the tokens.css contract allows as TYPE (danger labels,
   pressed-chip rims that sit under bold text, warning lines). These must
   clear the full 4.5:1 body bar on the darkest paper ground. */
const TYPE_DEEPS = ['amber', 'terracotta', 'moss', 'sky', 'blush', 'plum'];

const AA_TEXT = 4.5;
const AA_UI = 3.0;

/** [group, label, fg token, bg token, gate] — gate 0 = informational row. */
export function buildPairs() {
  const pairs = [
    /* body ink on paper grounds — the reading contract */
    ['body', 'ink-sepia / paper-cream', '--ink-sepia', '--paper-cream', AA_TEXT],
    ['body', 'ink-sepia / paper-aged', '--ink-sepia', '--paper-aged', AA_TEXT],
    ['body', 'ink-sepia / paper-deep', '--ink-sepia', '--paper-deep', AA_TEXT],
    ['body', 'ink-sepia-soft / paper-aged', '--ink-sepia-soft', '--paper-aged', AA_TEXT],
    ['body', 'ink-sepia-soft / paper-cream', '--ink-sepia-soft', '--paper-cream', AA_TEXT],
    ['body', 'ink-graphite / paper-aged', '--ink-graphite', '--paper-aged', AA_TEXT],
    ['body', 'ink-graphite-soft / paper-aged', '--ink-graphite-soft', '--paper-aged', AA_TEXT],
    ['body', 'ink-graphite-soft / paper-cream', '--ink-graphite-soft', '--paper-cream', AA_TEXT],
    ['body', 'ink-accent / paper-aged', '--ink-accent', '--paper-aged', AA_TEXT],
    ['body', 'ink-blue / paper-aged', '--ink-blue', '--paper-aged', AA_TEXT],

    /* chrome: buttons, pressed chips, tooltips, menu items, quick switcher */
    ['chrome', 'ink-sepia / accent-light (pressed chip, QS row)', '--ink-sepia', '--accent-light', AA_TEXT],
    ['chrome', 'accent-ink / accent-light (primary button label)', '--accent-ink', '--accent-light', AA_TEXT],
    // Every filled-accent control in the app paints --on-accent on
    // --accent-deep, never on plain --accent (which stays a rim/wash colour) —
    // so that is the only pairing worth gating.
    ['chrome', 'on-accent / accent-deep (filled + hover)', '--on-accent', '--accent-deep', AA_TEXT],
    // Night inverts --ink-line to a LIGHT value but --gilt-face stays bright
    // gold in every theme, so anything drawn as "ink on gilt" (chip ticks, the
    // active tab, the pulled-book rule) went to 1.14:1 after dark. --on-gilt is
    // the one ink token that does NOT invert; this is the gate that catches it
    // drifting back.
    ['chrome', 'on-gilt / gilt-face (chip tick, active tab)', '--on-gilt', '--gilt-face', AA_TEXT],
    ['chrome', 'gilt-ink / wash-lemon-light (gilt chip)', '--gilt-ink', '--wash-lemon-light', AA_TEXT],
    ['chrome', 'gilt-deep / wash-lemon-light (theme ✓)', '--gilt-deep', '--wash-lemon-light', AA_TEXT],

    /* essential non-text: focus ring + rims that identify a control */
    ['rim', 'accent-deep / paper-aged (focus ring)', '--accent-deep', '--paper-aged', AA_UI],
    ['rim', 'accent-deep / paper-cream (focus ring)', '--accent-deep', '--paper-cream', AA_UI],
    ['rim', 'accent-deep / accent-light (primary rim)', '--accent-deep', '--accent-light', AA_UI],
    ['rim', 'gilt / paper-aged (gilt rim)', '--gilt', '--paper-aged', AA_UI],
    ['rim', 'gilt / wash-lemon-light (✓ rim)', '--gilt', '--wash-lemon-light', AA_UI],

    /* informational — printed, not gated */
    ['info', 'ink-sepia / wash-amber (solid fill — keep unused for type)', '--ink-sepia', '--wash-amber', 0],
    ['info', 'paper-edge / paper-aged (hairlines)', '--paper-edge', '--paper-aged', 0],
    ['info', 'accent / paper-aged (scrollbar thumb, decorative)', '--accent', '--paper-aged', 0],
  ];

  for (const w of WASHES) {
    pairs.push([
      'wash', `ink-sepia / wash-${w}-light (hover rows, toasts)`,
      '--ink-sepia', `--wash-${w}-light`, AA_TEXT,
    ]);
  }
  for (const w of WASHES) {
    pairs.push([
      'wash-rim', `wash-${w}-deep / wash-${w}-light (glyphs, rims)`,
      `--wash-${w}-deep`, `--wash-${w}-light`, AA_UI,
    ]);
  }
  for (const w of TYPE_DEEPS) {
    pairs.push([
      'wash-type', `wash-${w}-deep / paper-aged (deep pigment as type)`,
      `--wash-${w}-deep`, '--paper-aged', AA_TEXT,
    ]);
  }
  return pairs;
}

/* --------------------------------- runner -------------------------------- */

export function checkAll(themes) {
  const pairs = buildPairs();
  const perTheme = new Map();
  const violations = [];
  for (const [name, theme] of Object.entries(themes)) {
    const rows = [];
    for (const [group, label, fgToken, bgToken, gate] of pairs) {
      const fg = resolveColor(theme, fgToken);
      const bg = resolveColor(theme, bgToken);
      if (!fg || !bg) {
        const missing = !fg ? fgToken : bgToken;
        rows.push({ group, label, ratio: null, gate, status: 'UNRESOLVED' });
        violations.push({ theme: name, label, gate, why: `unresolved token ${missing}` });
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      const status = gate === 0 ? 'info' : ratio >= gate ? 'PASS' : 'FAIL';
      rows.push({ group, label, ratio, gate, status });
      if (status === 'FAIL') violations.push({ theme: name, label, ratio, gate });
    }
    perTheme.set(name, rows);
  }
  return { perTheme, violations };
}

/* --------------------------------- table --------------------------------- */

const pad = (cols) =>
  cols.map(([t, w, right]) => (right ? String(t).padStart(w) : String(t).padEnd(w))).join('  ');

function printTheme(name, rows) {
  console.log(`\ntheme: ${name}`);
  console.log(pad([['pair', 62], ['ratio', 8, 1], ['gate', 5, 1], ['result', 10]]));
  console.log(pad([['----', 62], ['-----', 8, 1], ['----', 5, 1], ['------', 10]]));
  for (const r of rows) {
    console.log(pad([
      [`${r.group} ${r.label}`.slice(0, 62), 62],
      [r.ratio === null ? '  —' : r.ratio.toFixed(2), 8, 1],
      [r.gate === 0 ? 'info' : r.gate.toFixed(1), 5, 1],
      [r.status, 10],
    ]));
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const themes = loadThemes();
  const names = Object.keys(themes);
  console.log(`check-contrast: ${names.length} themes (${names.join(', ')})`);
  console.log('gates: text >= 4.5:1 (WCAG AA) · essential icons/rims >= 3:1');

  const { perTheme, violations } = checkAll(themes);
  for (const [name, rows] of perTheme) printTheme(name, rows);

  console.log('');
  if (violations.length > 0) {
    console.error(`${violations.length} contrast violation(s):`);
    for (const v of violations) {
      console.error(
        `  ${v.theme}: ${v.label}` +
          (v.why ? ` — ${v.why}` : ` — ${v.ratio.toFixed(2)}:1 under the ${v.gate}:1 gate`),
      );
    }
    process.exit(1);
  }
  const gated = [...perTheme.values()].flat().filter((r) => r.gate > 0).length;
  console.log(`contrast clean: ${gated} gated pairs pass in every theme.`);
}
