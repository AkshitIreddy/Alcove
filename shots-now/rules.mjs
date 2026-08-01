/**
 * shots-now/rules.mjs — do headings sit ON the ruled line?
 *
 * The claim is about a few pixels between a letter and a printed rule, so it is
 * settled by measuring where the baseline lands relative to the rule grid, not
 * by looking at a screenshot and having an opinion.
 *
 * The page draws its rules as a repeating background at --page-line-height, so
 * a rule sits at every multiple of that from the text top. For each heading we
 * take the element's own box, work out its alphabetic baseline from the
 * resolved font metrics, and report the gap to the nearest rule. Body text is
 * the reference: whatever gap Patrick Hand keeps is what "sitting on the line"
 * looks like in this app, and every heading should keep the same one.
 *
 * Usage: node shots-now/rules.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);

const rows = await p.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'nb-prose';
  host.style.cssText = 'position:fixed;left:0;top:0;width:520px;visibility:hidden';
  document.body.appendChild(host);

  const band = parseFloat(getComputedStyle(host).getPropertyValue('--page-line-height')) || 32;
  const out = [];
  const top = host.getBoundingClientRect().top;

  for (const tag of ['p', 'h1', 'h2', 'h3', 'h4']) {
    const el = document.createElement(tag);
    el.textContent = 'Make it yours';
    host.appendChild(el);

    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);
    const padTop = parseFloat(cs.paddingTop) || 0;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const m = ctx.measureText('Hxy');
    const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;

    const box = el.getBoundingClientRect();
    // Baseline of the FIRST line, in page coordinates.
    const baseline = box.top - top + padTop + (lh - asc - desc) / 2 + asc;
    const gap = baseline - Math.round(baseline / band) * band;
    out.push({ tag, size: +size.toFixed(0), gap: +gap.toFixed(1) });
  }
  return { band, out };
});

console.log(`  rule grid: ${rows.band}px\n`);
const ref = rows.out.find((r) => r.tag === 'p');
for (const r of rows.out) {
  const drift = +(r.gap - ref.gap).toFixed(1);
  const verdict = r.tag === 'p' ? '(reference)' : Math.abs(drift) <= 2 ? 'on the line' : `FLOATS ${drift}px`;
  console.log(`  ${r.tag.padEnd(3)} ${String(r.size).padStart(3)}px   baseline-to-rule ${String(r.gap).padStart(6)}   ${verdict}`);
}
await b.close();
