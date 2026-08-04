/**
 * scripts/check-control-contrast.mjs — contrast gates for the RULES, not the
 * tokens.
 *
 * `check-contrast.mjs` gates a hand-written list of token PAIRS. That list is
 * only as good as the pairings somebody thought to add to it, and it shipped
 * with this row:
 *
 *   ['info', 'ink-sepia / wash-amber (solid fill — keep unused for type)', 0]
 *
 * — an ungated note asking the stylesheets not to do a thing, while
 * `tutorial.css` was doing exactly that on the tour's primary "next" button.
 * On night with fountain-blue ink that button measured 1.05:1: the least
 * readable thing on the first card a new reader ever sees.
 *
 * So this script does not ask what SHOULD pair. It reads the stylesheets and
 * finds what DOES:
 *
 *   1. every rule that declares a foreground (`color`, or `fill`/`stroke` on
 *      an SVG part) AND a resolvable background (`background` / `background-
 *      color`, or `fill` on the shape under it) in the SAME block — a
 *      self-contained pair that needs no guess about ancestors;
 *   2. resolved through every theme x ink the appearance settings can produce;
 *   3. gated at WCAG AA — 4.5:1 for text, 3:1 for large text and for
 *      non-text marks (ticks, glyphs, rules).
 *
 * A translucent fill is composited over BOTH paper rungs and judged on the
 * worse of the two, because a wash sits on cream in a page and on aged in a
 * panel and has to survive whichever it landed on.
 *
 * The pure functions are exported so `tests/control-contrast.test.ts` can run
 * the same sweep across all 30 themes x 34 inks (it can import the TypeScript
 * appearance vocabulary; this file cannot). Run the CLI for the human table:
 *
 *   node scripts/check-control-contrast.mjs
 *   node scripts/check-control-contrast.mjs --all   # print passes too
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { contrastRatio, loadThemes, resolveColor } from './check-contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const AA_TEXT = 4.5;
export const AA_LARGE = 3.0;

/* ----------------------------- stylesheet walk ---------------------------- */

/**
 * Every stylesheet in `src/`, not just `src/styles/`.
 *
 * `src/features/tutorial/taste.css` lives beside its feature, and a sweep that
 * only reads `src/styles/` would have declared the taste questionnaire clean
 * without ever opening it.
 */
export function stylesheets(rootDir = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules') continue;
        walk(full);
      } else if (name.endsWith('.css')) {
        out.push({
          file: relative(rootDir, full).replace(/\\/g, '/'),
          css: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(join(rootDir, 'src'));
  return out;
}

/** Blank comments out but keep the newlines, so reported lines stay honest. */
const blankComments = (css) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/**
 * Flatten a stylesheet to `{ selector, decls, line }`, descending through
 * at-rules (`@media`, `@supports`) so a rule inside one is still swept.
 */
export function collectRules(css, file = '') {
  const clean = blankComments(css);
  const rules = [];
  const lineAt = (index) => {
    let line = 1;
    for (let i = 0; i < index; i++) if (clean[i] === '\n') line += 1;
    return line;
  };

  const scan = (start, end) => {
    let i = start;
    let head = '';
    let headStart = start;
    while (i < end) {
      const ch = clean[i];
      if (ch === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < end && depth > 0) {
          if (clean[j] === '{') depth += 1;
          else if (clean[j] === '}') depth -= 1;
          j += 1;
        }
        const body = clean.slice(i + 1, j - 1);
        const selector = head.trim().replace(/\s+/g, ' ');
        if (selector.startsWith('@')) {
          // at-rule: its body holds more rules (or, for @font-face, none we want)
          if (/^@(media|supports|layer|container)\b/i.test(selector)) {
            scan(i + 1, j - 1);
          }
        } else if (selector.length > 0) {
          rules.push({
            file,
            selector,
            line: lineAt(headStart),
            decls: parseDecls(body),
          });
        }
        i = j;
        head = '';
        headStart = j;
      } else {
        if (head.trim() === '') headStart = i;
        head += ch;
        i += 1;
      }
    }
  };

  scan(0, clean.length);
  return rules;
}

/** Declarations of a block body, last-wins, lowercase property names. */
function parseDecls(body) {
  const out = new Map();
  let depth = 0;
  let buf = '';
  const flush = () => {
    const text = buf.trim();
    buf = '';
    if (text === '') return;
    const colon = text.indexOf(':');
    if (colon <= 0) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    // A nested block (`&:hover { … }`) leaves junk; ignore anything with a brace.
    if (prop.includes('{') || prop.includes('}')) return;
    out.set(prop, text.slice(colon + 1).trim());
  };
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) flush();
    else if (ch === '{' || ch === '}') buf = '';
    else buf += ch;
  }
  flush();
  return out;
}

/* ------------------------------ value resolving --------------------------- */

const NON_COLOR = new Set([
  'transparent', 'none', 'inherit', 'initial', 'unset', 'revert',
  'currentcolor', 'auto',
]);

/**
 * Resolve a DECLARATION VALUE (not a token name) to rgba within a theme.
 *
 * Handles `var(--x)`, `var(--x, fallback)`, hex, rgb()/rgba(), and the handful
 * of named colours the stylesheets use. Returns null for anything that is not
 * one flat colour — a gradient, `transparent`, an image — which is the signal
 * to skip the pair rather than to guess at a ground.
 */
export function resolveValue(theme, raw, seen = new Set()) {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim().replace(/\s*!important$/i, '');
  if (value === '') return null;
  const lower = value.toLowerCase();
  if (NON_COLOR.has(lower)) return null;
  if (/gradient|url\(|image-set/i.test(value)) return null;

  const varMatch = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]+))?\)$/i);
  if (varMatch) {
    const token = varMatch[1].toLowerCase();
    if (!seen.has(token)) {
      seen.add(token);
      const direct = resolveColor(theme, token);
      if (direct) return direct;
      const chained = theme.get(token);
      if (chained !== undefined) {
        const nested = resolveValue(theme, chained, seen);
        if (nested) return nested;
      }
    }
    return varMatch[2] ? resolveValue(theme, varMatch[2], seen) : null;
  }

  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
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

  const fn = value.match(/^rgba?\(([^)]*)\)$/i);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const nums = parts.map((p) => (p.endsWith('%') ? Number(p.slice(0, -1)) * 2.55 : Number(p)));
    if (nums.slice(0, 3).some(Number.isNaN)) return null;
    const alphaRaw = parts[3];
    const alpha =
      alphaRaw === undefined
        ? 1
        : alphaRaw.endsWith('%')
          ? Number(alphaRaw.slice(0, -1)) / 100
          : Number(alphaRaw);
    return { r: nums[0], g: nums[1], b: nums[2], a: Number.isNaN(alpha) ? 1 : alpha };
  }

  const named = { white: '#ffffff', black: '#000000', red: '#ff0000' }[lower];
  if (named) return resolveValue(theme, named, seen);
  return null;
}

/**
 * A `background` shorthand carries a colour only when the whole value IS one.
 * `background: var(--paper-aged)` yes; `background: none`, a gradient or a
 * layered value, no.
 */
function backgroundColor(theme, decls) {
  const explicit = decls.get('background-color');
  if (explicit !== undefined) return resolveValue(theme, explicit);
  const short = decls.get('background');
  if (short === undefined) return null;
  return resolveValue(theme, short);
}

/* --------------------------------- pairs ---------------------------------- */

const px = (value) => {
  if (value === undefined) return null;
  const m = String(value).match(/(-?[\d.]+)px/);
  return m ? Number(m[1]) : null;
};

/**
 * Which SVG paint properties in a rule carry the shape.
 *
 * `stroke` wins when both are declared: the outline is what identifies a drawn
 * mark, and its fill is the interior — an interior that matches the paper is an
 * empty box, not a contrast fault.
 */
function markProps(decls) {
  const stroke = decls.get('stroke');
  if (stroke !== undefined && !/^\s*none\s*$/i.test(stroke)) return ['stroke'];
  return decls.has('fill') ? ['fill'] : [];
}

/** WCAG "large text": >= 24px, or >= 18.66px when bold. */
function isLargeText(decls) {
  const size = px(decls.get('font-size'));
  if (size === null) return false;
  const weight = Number(String(decls.get('font-weight') ?? '400').match(/\d+/)?.[0] ?? 400);
  return size >= 24 || (size >= 18.66 && weight >= 700);
}

/* ------------------------- the state-rule shortfall ----------------------- */

/**
 * Peel ONE trailing simple selector off — `:hover`, `:not(…)`, `[data-x]`,
 * `.is-active`, `::after`. Null once there is nothing left to peel.
 */
function peel(selector) {
  const patterns = [
    /:not\([^)]*\)$/,
    /::[a-z-]+$/i,
    /:[a-z-]+\([^)]*\)$/i,
    /:[a-z-]+$/i,
    /\[[^\]]*\]$/,
    /\.[A-Za-z0-9_-]+$/,
  ];
  for (const re of patterns) {
    if (re.test(selector)) {
      const cut = selector.replace(re, '');
      // Never peel down to nothing, or to a bare combinator.
      if (cut.trim() === '' || /[\s>+~]$/.test(cut)) return null;
      return cut;
    }
  }
  return null;
}

const singles = (selector) => selector.split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Pseudo-elements that are not a box with inherited text in it. The peel-back
 * would otherwise pair a scrollbar thumb's track colour with the sheet's ink.
 */
const NOT_A_TEXT_BOX = /::(-webkit-|-moz-)?(scrollbar|backdrop|resizer)/i;

/**
 * Split `.card.is-active .blurb` into `['.card.is-active', '.blurb']` at the
 * LAST descendant/child combinator. Null when the selector names one element.
 */
function splitAncestor(selector) {
  // Ignore combinators inside :not(…) / :is(…) parentheses.
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && /[\s>]/.test(ch)) cut = i;
  }
  if (cut < 0) return null;
  const ancestor = selector.slice(0, cut).replace(/[>+~]\s*$/, '').trim();
  const self = selector.slice(cut + 1).trim();
  if (ancestor === '' || self === '' || /^[>+~]/.test(self)) return null;
  return [ancestor, self];
}

/**
 * A hover that repaints ONLY the ground is the shape the self-contained rule
 * misses, and it is not a rare shape: `.nbq-btn--primary:hover` swaps the fill
 * and inherits the label colour from `.nbq-btn--primary` two rules above it.
 * So for a rule that sets a background and no colour, peel its selector back
 * one simple selector at a time and take the nearest declared `color` in the
 * SAME stylesheet — the cascade a reader's eye does anyway.
 *
 * Same file only, and the longest surviving base wins: a looser search across
 * the tree starts pairing a rail button's ground with an editor caption's ink.
 */
function inheritedColor(byFile, file, selector) {
  const table = byFile.get(file);
  if (!table) return null;
  for (const single of singles(selector)) {
    let base = peel(single);
    while (base !== null) {
      const found = table.get(base);
      if (found !== undefined) return { value: found.value, from: base };
      base = peel(base);
    }
  }
  return null;
}

/**
 * Every foreground/background pair the stylesheets actually declare.
 *
 * Both halves come from the same rule where they can, and from the peeled base
 * selector where the rule only repaints the ground — so the pair is a fact
 * about the CSS rather than a guess about which ancestor painted what.
 */
export function collectPairs(sheets = stylesheets()) {
  const rulesByFile = new Map();
  for (const { file, css } of sheets) rulesByFile.set(file, collectRules(css, file));

  // selector -> the colour it declares, per file, for the peel-back lookup.
  const colorsByFile = new Map();
  // selector -> the ground it paints, per file, for the descendant lookup.
  const groundsByFile = new Map();
  for (const [file, rules] of rulesByFile) {
    const colors = new Map();
    const grounds = new Map();
    for (const rule of rules) {
      const color = rule.decls.get('color');
      const ground = rule.decls.get('background-color') ?? rule.decls.get('background');
      for (const single of singles(rule.selector)) {
        if (color !== undefined) colors.set(single, { value: color, decls: rule.decls });
        if (ground !== undefined) grounds.set(single, { value: ground, line: rule.line });
      }
    }
    colorsByFile.set(file, colors);
    groundsByFile.set(file, grounds);
  }

  /** The nearest ground an ancestor selector paints, peeling it back as needed. */
  const groundFor = (file, ancestor) => {
    const table = groundsByFile.get(file);
    if (!table) return null;
    let probe = ancestor;
    while (probe !== null) {
      const found = table.get(probe);
      // `background: transparent` on the way up is not an answer, it is a
      // pass — keep peeling until something actually paints.
      if (found !== undefined && !/^\s*(transparent|none)\s*$/i.test(found.value)) {
        return { value: found.value, from: probe };
      }
      probe = peel(probe);
    }
    return null;
  };

  const pairs = [];
  for (const [file, rules] of rulesByFile) {
    for (const rule of rules) {
      const { decls } = rule;
      if (decls.size === 0) continue;
      const color = decls.get('color');
      const hasBg = decls.has('background') || decls.has('background-color');

      /* --- 3. a child painted on an ancestor's ground -------------------- */
      // `.nb-pick-card.is-active .nb-pick-blurb` carries its own ink while the
      // ground comes from the card two rules above it. Nothing in the child's
      // own block says what it is sitting on, so a self-contained sweep calls
      // it clean — and after dark it was gilt-cream text on a gilt face.
      // The SVG marks belong here too, and ONLY here: a `fill` is written on
      // the shape, never on the box that paints the ground under it, so a
      // self-contained sweep of fill+background finds literally nothing. That
      // is what the 3:1 mark gate is for — a tick, a dot, a drawn checkbox.
      //
      // A STROKED shape is gated on its stroke alone. The stroke is what says
      // "this is a checkbox"; the fill is its interior, and an interior close
      // in value to the paper around it is an EMPTY box, which is the whole
      // point of one. Gating both called every unticked box a fault.
      const marks = markProps(decls);
      if ((color !== undefined || marks.length > 0) && !hasBg) {
        for (const single of singles(rule.selector)) {
          const split = splitAncestor(single);
          if (!split) continue;
          const ground = groundFor(file, split[0]);
          if (!ground) continue;
          const at = {
            file,
            line: rule.line,
            selector: single,
            bg: ground.value,
            kind: 'descendant',
          };
          if (color !== undefined) {
            pairs.push({
              ...at,
              prop: `color (ground from ${ground.from})`,
              fg: color,
              gate: isLargeText(decls) ? AA_LARGE : AA_TEXT,
            });
          }
          for (const prop of marks) {
            pairs.push({
              ...at,
              kind: 'mark',
              prop: `${prop} (ground from ${ground.from})`,
              fg: decls.get(prop),
              gate: AA_LARGE,
            });
          }
          break;
        }
      }

      if (!hasBg) continue;
      const bg = decls.get('background-color') ?? decls.get('background');
      // `background: transparent` paints nothing, so the pair is the ancestor's
      // to answer for, not this rule's. Dropped here rather than left to
      // resolve to null per theme, so the pair COUNT stays a count of things
      // that are actually measured.
      if (/^\s*(transparent|none|inherit|initial|unset|currentcolor)\s*$/i.test(bg)) continue;
      const base = { file, line: rule.line, selector: rule.selector, bg };

      /* --- 1. both halves in the same block ------------------------------ */
      if (color !== undefined) {
        pairs.push({
          ...base,
          kind: 'text',
          prop: 'color',
          fg: color,
          gate: isLargeText(decls) ? AA_LARGE : AA_TEXT,
        });
      } else if (!NOT_A_TEXT_BOX.test(rule.selector)) {
        /* --- 2. a state rule that only repaints the ground --------------- */
        const inherited = inheritedColor(colorsByFile, file, rule.selector);
        if (inherited) {
          pairs.push({
            ...base,
            kind: 'inherited',
            prop: `color (from ${inherited.from})`,
            fg: inherited.value,
            gate: AA_TEXT,
          });
        }
      }

      /* --- 4. a mark drawn on its own ground ----------------------------- */
      for (const prop of markProps(decls)) {
        pairs.push({ ...base, kind: 'mark', prop, fg: decls.get(prop), gate: AA_LARGE });
      }
    }
  }
  return pairs;
}

/* --------------------------------- matrix --------------------------------- */

/**
 * The `[data-ink=…]` remaps settings.css writes by hand. The other 31 inks are
 * derived in TypeScript (`features/settings/appearance.ts`); the vitest sweep
 * folds those in, this CLI covers the three the stylesheet owns.
 */
export function stylesheetInkRemaps(rootDir = ROOT) {
  const css = blankComments(readFileSync(join(rootDir, 'src', 'styles', 'settings.css'), 'utf8'));
  const out = new Map([['sepia', new Map()]]);
  for (const rule of collectRules(css)) {
    const m = rule.selector.match(/^:root\[data-ink='([a-z-]+)'\]$/i);
    if (!m) continue;
    const overrides = new Map();
    for (const [k, v] of rule.decls) if (k.startsWith('--')) overrides.set(k, v);
    out.set(m[1], overrides);
  }
  return out;
}

/** Every theme x ink the stylesheets alone can produce, as merged token maps. */
export function themeInkMatrix(themes = loadThemes(), inks = stylesheetInkRemaps()) {
  const matrix = new Map();
  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const [inkName, overrides] of inks) {
      const merged = new Map(tokens);
      for (const [k, v] of overrides) merged.set(k, v);
      matrix.set(`${themeName} / ${inkName}`, merged);
    }
  }
  return matrix;
}

/* --------------------------------- runner --------------------------------- */

const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

/**
 * Judge one pair in one combination.
 *
 * A translucent background is composited over BOTH paper rungs and the WORSE
 * result is kept: a wash sits on cream inside a page and on aged inside a
 * panel, and it has to survive whichever it landed on.
 */
export function measurePair(tokens, pair) {
  const fg = resolveValue(tokens, pair.fg);
  const bgRaw = resolveValue(tokens, pair.bg);
  if (!fg || !bgRaw) return null;
  if (fg.a === 0) return null;

  const grounds = [];
  if (bgRaw.a >= 0.999) grounds.push(bgRaw);
  else {
    for (const rung of ['--paper-cream', '--paper-aged']) {
      const paper = resolveColor(tokens, rung);
      if (paper) grounds.push(over(bgRaw, paper));
    }
    if (grounds.length === 0) return null;
  }

  let worst = null;
  for (const ground of grounds) {
    const ratio = contrastRatio(fg, ground);
    if (worst === null || ratio < worst) worst = ratio;
  }
  return worst;
}

export function checkControls(matrix, pairs = collectPairs()) {
  const rows = [];
  const violations = [];
  for (const [combo, tokens] of matrix) {
    for (const pair of pairs) {
      const ratio = measurePair(tokens, pair);
      if (ratio === null) continue;
      const status = ratio >= pair.gate ? 'PASS' : 'FAIL';
      const row = { combo, ...pair, ratio, status };
      rows.push(row);
      if (status === 'FAIL') violations.push(row);
    }
  }
  return { rows, violations };
}

/**
 * Group violations by the DECLARATION, not by the combination — one broken
 * rule fails in a dozen rooms and a flat list buries the count.
 */
export function groupViolations(violations) {
  const byRule = new Map();
  for (const v of violations) {
    const key = `${v.file}:${v.line} ${v.selector} {${v.prop}}`;
    const found = byRule.get(key);
    if (found) {
      found.combos.push(v.combo);
      found.worst = Math.min(found.worst, v.ratio);
    } else {
      byRule.set(key, {
        key,
        file: v.file,
        line: v.line,
        selector: v.selector,
        prop: v.prop,
        fg: v.fg,
        bg: v.bg,
        gate: v.gate,
        worst: v.ratio,
        combos: [v.combo],
      });
    }
  }
  return [...byRule.values()].sort((a, b) => a.worst - b.worst);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const pairs = collectPairs();
  const matrix = themeInkMatrix();
  const { rows, violations } = checkControls(matrix, pairs);
  console.log(
    `check-control-contrast: ${pairs.length} declared pairs x ${matrix.size} theme/ink combinations`,
  );
  console.log(`gates: text >= ${AA_TEXT}:1 · large text and marks >= ${AA_LARGE}:1`);
  console.log(`measured: ${rows.length} rows`);

  const grouped = groupViolations(violations);
  if (process.argv.includes('--all')) {
    for (const row of [...rows].sort((a, b) => a.ratio - b.ratio).slice(0, 60)) {
      console.log(
        `  ${row.ratio.toFixed(2)}  ${row.status}  ${row.combo}  ${row.file}:${row.line} ${row.selector} {${row.prop}}`,
      );
    }
  }
  console.log('');
  if (grouped.length > 0) {
    console.error(`${grouped.length} rule(s) under gate (${violations.length} rows):`);
    for (const g of grouped) {
      console.error(
        `  ${g.file}:${g.line}  ${g.selector} {${g.prop}: ${g.fg}} on {${g.bg}}\n` +
          `     worst ${g.worst.toFixed(2)}:1 under ${g.gate}:1 — ${g.combos.length} combination(s): ${g.combos.slice(0, 6).join(', ')}${g.combos.length > 6 ? ', …' : ''}`,
      );
    }
    process.exit(1);
  }
  console.log('control contrast clean: every declared pair clears its gate in every room.');
}
