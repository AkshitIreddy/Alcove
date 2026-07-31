// @vitest-environment node
/**
 * tests/styles.test.ts — the two stylesheet rules the app states everywhere
 * and keeps losing, gated mechanically over every file in src/styles/.
 *
 * Both exist because they are the drift that keeps coming back. Parallel work
 * on the editor, the rail and the effects layer each re-introduced a soft
 * shadow or a sub-13px handwriting size at some point, and each time it took a
 * hand audit of the whole tree to find it again. A grep is cheaper than an
 * audit, so:
 *
 *   1. THE FLAT RULE (CLAUDE.md, assets/brand/icon.svg). Depth is a darker
 *      flat face beside a lighter one. No blur anywhere: no `filter: blur()`,
 *      no `backdrop-filter`, and no box-shadow with a non-zero blur radius.
 *      Offset plates (`0 3px 0 …`) and rings (`0 0 0 2px …`) are the whole
 *      shadow vocabulary.
 *
 *   2. THE HANDWRITING FLOOR (CLAUDE.md). Caveat / Patrick Hand / Kalam /
 *      Architects Daughter are unreadable small; nothing below 13px may be set
 *      in one of them. Below that, Nunito Sans (--font-ui) is the only face.
 *
 * Both checks are deliberately syntactic and rule-block-scoped, so a failure
 * points at one declaration rather than at "somewhere in the stylesheets".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = join(import.meta.dirname, '..', 'src', 'styles');

function stylesheets(): Array<{ file: string; css: string }> {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((file) => ({ file, css: readFileSync(join(STYLES_DIR, file), 'utf8') }));
}

/** Strip comments so a rule quoted in prose cannot fail the suite. */
function stripComments(css: string): string {
  // Keep newlines so reported line numbers stay honest.
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

interface Decl {
  file: string;
  line: number;
  prop: string;
  value: string;
  /** The selector text the declaration sits under, for a readable failure. */
  selector: string;
}

/**
 * Every declaration in the tree, tagged with the selector it belongs to.
 *
 * A hand-rolled scanner rather than a CSS parser dependency: this only has to
 * split on `{`, `}` and `;`, and the alternative is a package whose whole job
 * is to be more correct about `@supports` than these files ever get.
 */
function declarations(): Decl[] {
  const out: Decl[] = [];
  for (const { file, css } of stylesheets()) {
    const clean = stripComments(css);
    let selector = '';
    let buffer = '';
    let line = 1;
    let bufferLine = 1;
    const flush = (): void => {
      const text = buffer.trim();
      buffer = '';
      const colon = text.indexOf(':');
      if (colon <= 0) return;
      out.push({
        file,
        line: bufferLine,
        prop: text.slice(0, colon).trim().toLowerCase(),
        value: text.slice(colon + 1).trim(),
        selector,
      });
    };
    for (const char of clean) {
      if (char === '\n') line += 1;
      if (buffer.trim() === '') bufferLine = line;
      if (char === '{') {
        selector = buffer.trim().replace(/\s+/g, ' ');
        buffer = '';
      } else if (char === '}' || char === ';') {
        flush();
      } else {
        buffer += char;
      }
    }
  }
  return out;
}

const where = (d: Decl): string =>
  `${d.file}:${d.line} ${d.selector} { ${d.prop}: ${d.value} }`;

/* --------------------------------------------------------------------------
   1. The flat rule
   ------------------------------------------------------------------------ */

/** Length tokens in a single (comma-free) shadow, in order. */
function shadowLengths(shadow: string): string[] {
  return shadow.match(/-?\d*\.?\d+(?:px|rem|em)\b/g) ?? [];
}

/** Split a box-shadow value on top-level commas (colour functions nest them). */
function splitShadows(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== '');
}

/** The blur radius is the THIRD length: x, y, blur, spread. */
function hasBlurRadius(shadow: string): boolean {
  const lengths = shadowLengths(shadow);
  if (lengths.length < 3) return false;
  return Number.parseFloat(lengths[2]!) !== 0;
}

describe('the flat rule holds across src/styles', () => {
  const decls = declarations();

  it('has no blur() or backdrop-filter anywhere', () => {
    const offenders = decls
      .filter(
        (d) =>
          (d.prop === 'filter' && /\bblur\s*\(/.test(d.value)) ||
          d.prop.endsWith('backdrop-filter'),
      )
      .map(where);
    expect(offenders).toEqual([]);
  });

  it('has no box-shadow with a non-zero blur radius', () => {
    const offenders = decls
      .filter((d) => d.prop === 'box-shadow' || d.prop === 'text-shadow')
      // var()-only values resolve to tokens, which this same rule gates below.
      .filter((d) => splitShadows(d.value).some(hasBlurRadius))
      .map(where);
    expect(offenders).toEqual([]);
  });

  // The tokens are where ~80 call sites get their shadow from, so they are the
  // single highest-leverage place for a blur to sneak back in.
  it('defines every --shadow-* token as an offset plate or a ring', () => {
    const offenders = decls
      .filter((d) => d.prop.startsWith('--shadow'))
      .filter((d) => splitShadows(d.value).some(hasBlurRadius))
      .map(where);
    expect(offenders).toEqual([]);
  });

  it('has no mix-blend-mode / additive compositing', () => {
    const offenders = decls
      .filter((d) => d.prop === 'mix-blend-mode' || d.prop === 'background-blend-mode')
      .map(where);
    expect(offenders).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
   2. The handwriting floor
   ------------------------------------------------------------------------ */

/** Families that are unreadable small, by token name and by literal family. */
const HANDWRITING = [
  '--font-heading',
  '--font-body',
  '--font-accent',
  '--font-label',
  'caveat',
  'patrick hand',
  'kalam',
  'architects daughter',
];

/** px sizes that tokens resolve to, so a `var()` size can still be judged. */
const SIZE_TOKENS: Record<string, number> = {
  '--text-h1': 44,
  '--text-h2': 34,
  '--text-h3': 26,
  '--text-h4': 21,
  '--text-body': 17,
  '--text-sm': 15,
  '--text-label': 14,
  '--text-chip': 13,
  '--text-ui': 12,
  '--text-ui-xs': 11,
};

function sizeInPx(value: string): number | null {
  const token = value.match(/var\(\s*(--text-[a-z0-9-]+)/i);
  if (token !== null) return SIZE_TOKENS[token[1]!.toLowerCase()] ?? null;
  const px = value.match(/^(-?\d*\.?\d+)px$/);
  return px === null ? null : Number.parseFloat(px[1]!);
}

function isHandwriting(value: string): boolean {
  const lower = value.toLowerCase();
  return HANDWRITING.some((family) => lower.includes(family));
}

describe('the handwriting font floor holds across src/styles', () => {
  it('never sets a handwriting face below 13px in the same rule', () => {
    const decls = declarations();
    // Group by (file, selector): a font-family and a font-size that apply to
    // the same element are what makes a violation, not either one alone.
    const blocks = new Map<string, Decl[]>();
    for (const d of decls) {
      const key = `${d.file}|${d.selector}`;
      blocks.set(key, [...(blocks.get(key) ?? []), d]);
    }

    const offenders: string[] = [];
    for (const block of blocks.values()) {
      const family = block.find((d) => d.prop === 'font-family');
      const size = block.find((d) => d.prop === 'font-size');
      if (family === undefined || size === undefined) continue;
      if (!isHandwriting(family.value)) continue;
      const px = sizeInPx(size.value);
      if (px !== null && px < 13) offenders.push(where(size));
    }
    expect(offenders).toEqual([]);
  });

  // Caveat is the loudest of the four and carries its own, higher floor.
  it('never sets Caveat below 20px', () => {
    const decls = declarations();
    const blocks = new Map<string, Decl[]>();
    for (const d of decls) {
      const key = `${d.file}|${d.selector}`;
      blocks.set(key, [...(blocks.get(key) ?? []), d]);
    }

    const offenders: string[] = [];
    for (const block of blocks.values()) {
      const family = block.find((d) => d.prop === 'font-family');
      const size = block.find((d) => d.prop === 'font-size');
      if (family === undefined || size === undefined) continue;
      const lower = family.value.toLowerCase();
      if (!lower.includes('caveat') && !lower.includes('--font-heading')) continue;
      const px = sizeInPx(size.value);
      if (px !== null && px < 20) offenders.push(where(size));
    }
    expect(offenders).toEqual([]);
  });
});
