/**
 * scripts/refute-block-heights.mjs — an adversarial check on the two
 * METHOD claims probe-block-heights.mjs rests on, driven against the app
 * running on :1420.
 *
 * The probe's numbers only mean what they say if:
 *
 *   1. a leaf really carries a transform, so `getBoundingClientRect()` and
 *      `offsetHeight` are in different units and only the laid-out one is
 *      comparable with a CSS line height;
 *   2. the divisor really is the leaf's own `--page-line-height`, not some
 *      unrelated computed line-height that happens to be 32px;
 *   3. the leaf's capacity (`clientHeight` less padding) is the number the
 *        probe printed — 821px on an 893px leaf at 1600x1000.
 *
 * It reads a real book opened from the shelf. No writes, no source reading.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 500,
  timeout: 90_000,
});
await p.waitForTimeout(4000);
for (let i = 0; i < 20; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(600);
}

// Open whatever book the shelf offers first.
for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await p
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
}
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 });
await p.waitForTimeout(2000);

const found = await p.evaluate(() => {
  const out = [];
  for (const paper of document.querySelectorAll('.nb-leaf-paper')) {
    const prose = paper.querySelector('.nb-prose');
    if (prose === null) continue;
    const ps = getComputedStyle(paper);
    const rs = getComputedStyle(prose);
    const rect = paper.getBoundingClientRect();
    // Walk up looking for the transform the probe's comment blames.
    const chain = [];
    for (let el = paper; el !== null && el !== document.body; el = el.parentElement) {
      const t = getComputedStyle(el).transform;
      if (t !== 'none') chain.push(`${el.className.split(' ')[0]}: ${t}`);
    }
    out.push({
      side: paper.getAttribute('data-side'),
      offsetHeight: paper.offsetHeight,
      clientHeight: paper.clientHeight,
      rectHeight: Number(rect.height.toFixed(2)),
      padTop: Number.parseFloat(ps.paddingTop) || 0,
      padBottom: Number.parseFloat(ps.paddingBottom) || 0,
      capacity:
        paper.clientHeight -
        (Number.parseFloat(ps.paddingTop) || 0) -
        (Number.parseFloat(ps.paddingBottom) || 0),
      proseLineHeight: rs.lineHeight,
      cssVar: getComputedStyle(prose).getPropertyValue('--page-line-height').trim(),
      varOnPaper: ps.getPropertyValue('--page-line-height').trim(),
      transforms: chain,
    });
  }
  return out;
});

console.log(JSON.stringify(found, null, 2));
for (const leaf of found) {
  const scaled = Math.abs(leaf.rectHeight - leaf.offsetHeight) > 0.5;
  console.log(
    `  leaf ${leaf.side}: offsetHeight ${leaf.offsetHeight}px vs rect ${leaf.rectHeight}px ` +
      `-> ${scaled ? 'DIFFERENT (transform is real)' : 'IDENTICAL (no transform)'}`,
  );
  console.log(
    `    capacity ${leaf.capacity}px, .nb-prose line-height ${leaf.proseLineHeight}, ` +
      `--page-line-height "${leaf.cssVar || leaf.varOnPaper}"`,
  );
}
await p.screenshot({ path: 'qa/tmp/refute-block-heights.png' });
await b.close();
