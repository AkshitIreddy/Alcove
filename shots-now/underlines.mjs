/**
 * shots-now/underlines.mjs — the fifty marks are fifty marks.
 *
 * The underline axis shipped with one rule (`position: relative`) for a
 * pseudo-element nobody wrote, so all fifty did nothing. They are drawn with
 * text-decoration and text-emphasis now — properties that are easy to write
 * and easy to get silently wrong, since an unsupported value simply computes
 * to the initial one and the mark quietly disappears.
 *
 * So: measure the resolved decoration/emphasis per value, count distinct
 * signatures, and check none has fallen back to "no mark at all". Then draw a
 * board, because whether fifty marks READ as fifty is a question for the eye.
 *
 * Usage: node shots-now/underlines.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 1100 } });
await p.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);

const rows = await p.evaluate(async () => {
  const vocab = await import('/src/editor/effects/vocabulary.ts');
  const host = document.createElement('div');
  host.className = 'nb-fx-specimen';
  host.style.cssText = 'position:fixed;left:0;top:0;width:700px;visibility:hidden;';
  document.body.appendChild(host);
  const out = [];
  for (const value of vocab.UNDERLINE_ALL) {
    const el = document.createElement('p');
    el.setAttribute('data-underline', value);
    el.textContent = 'marked up';
    host.appendChild(el);
    const cs = getComputedStyle(el);
    out.push({
      value,
      line: cs.textDecorationLine,
      style: cs.textDecorationStyle,
      thickness: cs.textDecorationThickness,
      offset: cs.textUnderlineOffset,
      color: cs.textDecorationColor,
      skip: cs.textDecorationSkipInk,
      emphasis: cs.textEmphasisStyle,
      emphasisColor: cs.textEmphasisColor,
      emphasisPos: cs.textEmphasisPosition,
    });
    el.remove();
  }
  host.remove();
  return out;
});

const sig = (r) =>
  [r.line, r.style, r.thickness, r.offset, r.color, r.skip, r.emphasis, r.emphasisColor].join('|');

let failed = 0;

const distinct = new Set(rows.map(sig)).size;
console.log(`  ${distinct === rows.length ? 'PASS' : 'FAIL'}  ${distinct} distinct of ${rows.length}`);
if (distinct !== rows.length) {
  failed += 1;
  const seen = new Map();
  for (const r of rows) seen.set(sig(r), [...(seen.get(sig(r)) ?? []), r.value]);
  for (const [, group] of seen) if (group.length > 1) console.log(`        same: ${group.join(', ')}`);
}

// A value that computed to no decoration AND no emphasis is drawing nothing —
// which is the exact state this whole axis was in.
const blank = rows.filter(
  (r) => (r.line === 'none' || r.line === '') && (r.emphasis === 'none' || r.emphasis === ''),
);
console.log(
  blank.length === 0
    ? '  PASS  every value draws something'
    : `  FAIL  draws nothing: ${blank.map((r) => r.value).join(', ')}`,
);
if (blank.length > 0) failed += 1;

await p.evaluate(async () => {
  const vocab = await import('/src/editor/effects/vocabulary.ts');
  document.body.innerHTML = '';
  document.body.style.cssText = 'background:var(--paper-cream);padding:26px;margin:0;';
  const board = document.createElement('div');
  board.className = 'nb-fx-specimen';
  board.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:16px 22px;';
  for (const value of vocab.UNDERLINE_ALL) {
    const cell = document.createElement('div');
    const tag = document.createElement('div');
    tag.textContent = value;
    tag.style.cssText = 'font:10px system-ui;opacity:.55;margin-bottom:2px;';
    const demo = document.createElement('p');
    demo.setAttribute('data-underline', value);
    demo.style.cssText = 'margin:0;font-family:var(--font-body);font-size:19px;';
    demo.textContent = 'marked up';
    cell.append(tag, demo);
    board.appendChild(cell);
  }
  document.body.appendChild(board);
});
await p.waitForTimeout(900);
await p.screenshot({ path: 'shots-now/out/underlines.png', fullPage: true });
console.log('  shot shots-now/out/underlines.png');

await b.close();
process.exit(failed === 0 ? 0 : 1);
