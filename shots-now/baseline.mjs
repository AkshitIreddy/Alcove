/**
 * shots-now/baseline.mjs — where does large text actually sit on its rule?
 *
 * Reported as "the big text sometimes appears a little too high above the
 * bottom line". That is a claim about a few pixels, which is exactly the kind
 * of thing an opinion gets wrong, so this measures it: for each heading level
 * it reads the real font metrics out of the browser and reports where the
 * alphabetic baseline falls inside the line box.
 *
 * A line box centres the text's content area, so a face whose ascent and
 * descent are lopsided — and handwriting faces usually are — sits off-centre
 * even when the CSS is symmetrical. The number that matters is how far the
 * baseline is from the BOTTOM of the line box, because the ruled line is drawn
 * at a fixed rhythm and the letters should sit ON it.
 *
 * Usage: node shots-now/baseline.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);

const rows = await p.evaluate(() => {
  const host = document.createElement('div');
  host.className = 'nb-prose';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:520px';
  document.body.appendChild(host);

  const out = [];
  for (const tag of ['h1', 'h2', 'h3', 'p']) {
    const el = document.createElement(tag);
    el.textContent = 'Make it yours';
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const lineHeight =
      cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);

    // Real metrics for the face that is actually resolved, not an assumption.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const m = ctx.measureText('Hxy');
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;

    // Where the baseline lands inside the line box (CSS half-leading rule).
    const halfLeading = (lineHeight - (ascent + descent)) / 2;
    const baselineFromTop = halfLeading + ascent;
    out.push({
      tag,
      family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
      size: +size.toFixed(1),
      lineHeight: +lineHeight.toFixed(1),
      ascent: +ascent.toFixed(1),
      descent: +descent.toFixed(1),
      baselineFromTop: +baselineFromTop.toFixed(1),
      baselineFromBottom: +(lineHeight - baselineFromTop).toFixed(1),
      // The tell: descent as a share of the gap under the baseline. Near 1
      // means the letters sit on the line; well under 1 means they float.
      sitsOnLine: +(descent / (lineHeight - baselineFromTop)).toFixed(2),
    });
  }
  return out;
});

console.log('  tag  face                 size  lh    asc   desc  base↓top base↓bot  sits-on-line');
for (const r of rows) {
  console.log(
    `  ${r.tag.padEnd(4)} ${r.family.padEnd(20)} ${String(r.size).padStart(4)} ` +
      `${String(r.lineHeight).padStart(5)} ${String(r.ascent).padStart(5)} ${String(r.descent).padStart(5)} ` +
      `${String(r.baselineFromTop).padStart(8)} ${String(r.baselineFromBottom).padStart(8)}  ${r.sitsOnLine}`,
  );
}
console.log('\n  sits-on-line near 1.0 = letters rest on the rule; under ~0.6 = floating high');
await b.close();
