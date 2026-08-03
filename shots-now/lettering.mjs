/**
 * shots-now/lettering.mjs — the lettering shelf actually letters.
 *
 * The whole shelf (50 hands, 50 inks, 12 sizes, 10 rangings) shipped with no
 * CSS, so every choice was inert and every specimen rendered the same "Aa".
 * The fix is generated (scripts/gen-lettering.mjs), and generated CSS is
 * exactly the kind that can be complete and still not APPLY — wrong scope,
 * lost to specificity, or clamped flat by the shared size rule.
 *
 * So this measures the rendered result, per value, inside the real
 * `.nb-fx-specimen` scope the catalogue tiles use:
 *
 *   hands    distinct (family, weight, style, case, tracking, set size)
 *   inks     distinct resolved colour
 *   sizes    distinct px, strictly increasing, none under the 13px floor
 *   ranging  distinct (alignment, indent, wrap)
 *
 * A count of distinct signatures is the point. "It has a rule" is what the
 * previous state of this shelf would also have said if anyone had only
 * counted rules.
 *
 * Usage: node shots-now/lettering.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);

const measured = await p.evaluate(async () => {
  const vocab = await import('/src/editor/effects/vocabulary.ts');
  const axes = {
    font: vocab.FONT_ALL,
    ink: vocab.INK_ALL,
    size: vocab.SIZE_ALL,
    align: vocab.ALIGN_ALL,
  };

  // A real page-shaped fragment: `.nb-fx-specimen` is the second scope every
  // rule in effects.css answers to, so this is painted by the shipping CSS
  // rather than by anything the probe sets up.
  const host = document.createElement('div');
  host.className = 'nb-fx-specimen';
  host.style.cssText = 'position:fixed;left:0;top:0;width:900px;visibility:hidden;';
  document.body.appendChild(host);

  const out = {};
  for (const [key, values] of Object.entries(axes)) {
    out[key] = [];
    for (const value of values) {
      const el = document.createElement('p');
      el.setAttribute(`data-${key}`, value);
      el.textContent = 'Handwriting sample Aa';
      host.appendChild(el);
      const cs = getComputedStyle(el);
      out[key].push({
        value,
        family: cs.fontFamily,
        weight: cs.fontWeight,
        style: cs.fontStyle,
        transform: cs.textTransform,
        spacing: cs.letterSpacing,
        size: parseFloat(cs.fontSize),
        color: cs.color,
        align: cs.textAlign,
        indent: cs.textIndent,
        wrap: cs.textWrap || cs.textWrapStyle || '',
        // `narrow` ranges left like several others and differs only in measure,
        // so the signature has to carry it or the two read as one.
        measure: cs.maxWidth,
        padLeft: cs.paddingLeft,
        marginLeft: cs.marginLeft,
        width: el.getBoundingClientRect().width,
      });
      el.remove();
    }
  }
  host.remove();
  return out;
});

const sig = {
  font: (r) => `${r.family}|${r.weight}|${r.style}|${r.transform}|${r.spacing}|${r.size}`,
  ink: (r) => r.color,
  size: (r) => String(r.size),
  align: (r) => `${r.align}|${r.indent}|${r.wrap}|${r.measure}|${r.padLeft}|${r.marginLeft}`,
};

let failed = 0;
for (const key of ['font', 'ink', 'size', 'align']) {
  const rows = measured[key];
  const distinct = new Set(rows.map(sig[key])).size;
  const ok = distinct === rows.length;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${key}: ${distinct} distinct of ${rows.length}`);
  if (!ok) {
    // Name the collisions — "some are the same" is not actionable.
    const seen = new Map();
    for (const r of rows) {
      const s = sig[key](r);
      seen.set(s, [...(seen.get(s) ?? []), r.value]);
    }
    for (const [, group] of seen) {
      if (group.length > 1) console.log(`        same: ${group.join(', ')}`);
    }
  }
}

/* The two typographic floors from CLAUDE.md, checked rather than assumed. */
const sizes = measured.size;
const tooSmall = sizes.filter((r) => r.size < 13);
console.log(
  tooSmall.length === 0
    ? `  PASS  no size under the 13px handwriting floor (smallest ${Math.min(...sizes.map((r) => r.size))}px)`
    : `  FAIL  under 13px: ${tooSmall.map((r) => `${r.value} ${r.size}px`).join(', ')}`,
);
if (tooSmall.length > 0) failed += 1;

const ordered = sizes.every((r, i) => i === 0 || r.size > sizes[i - 1].size);
console.log(
  ordered
    ? '  PASS  sizes strictly increase in picker order'
    : '  FAIL  sizes are not in increasing order',
);
if (!ordered) failed += 1;

/* A board to LOOK at — the shelf is a visual thing and counts are not enough. */
await p.evaluate(async () => {
  const vocab = await import('/src/editor/effects/vocabulary.ts');
  document.body.innerHTML = '';
  document.body.style.cssText =
    'background:var(--paper-cream);padding:24px;margin:0;overflow:auto;';
  const board = document.createElement('div');
  board.className = 'nb-fx-specimen';
  board.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:10px 18px;';
  for (const value of vocab.FONT_ALL) {
    const cell = document.createElement('div');
    const tag = document.createElement('div');
    tag.textContent = value;
    tag.style.cssText = 'font:10px system-ui;opacity:.55;';
    const demo = document.createElement('p');
    demo.setAttribute('data-font', value);
    demo.style.margin = '0 0 6px';
    demo.textContent = 'Handwriting Aa';
    cell.append(tag, demo);
    board.appendChild(cell);
  }
  document.body.appendChild(board);
});
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots-now/out/lettering-hands.png', fullPage: true });
console.log('  shot shots-now/out/lettering-hands.png');

await b.close();
console.log(failed === 0 ? '\n  the lettering shelf letters' : `\n  ${failed} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
