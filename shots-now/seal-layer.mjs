/**
 * shots-now/seal-layer.mjs — is the settings seal still reachable, and does it
 * dim with the room?
 *
 * Lowering a z-index to stop something floating over a scrim is one edit away
 * from burying it under the shelf entirely, so this checks BOTH ends: the seal
 * must still be the topmost thing at its own coordinates on a resting shelf,
 * and it must be under the scrim once a book is pulled.
 *
 * Asks the browser what is actually on top (elementFromPoint) rather than
 * comparing z-index numbers, because stacking contexts make the numbers a poor
 * guide — a child of a lower context can never rise above a higher one however
 * large its z-index is.
 *
 * Usage: node shots-now/seal-layer.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

const topAtSeal = async () =>
  p.evaluate(() => {
    const seal = document.querySelector('.nbs-gear-button');
    if (!seal) return { found: false };
    const r = seal.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const scrim = document.querySelector('.pulled-book-scrim');
    return {
      found: true,
      topIsSeal: seal.contains(hit) || hit === seal,
      topClass: hit?.className?.toString().slice(0, 40) ?? null,
      scrimOpacity: scrim ? getComputedStyle(scrim).opacity : 'n/a',
    };
  });

console.log('  resting shelf  ', JSON.stringify(await topAtSeal()));

// Pull a book, then look again while the scrim is up.
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.waitForTimeout(1200);
console.log('  book in flight ', JSON.stringify(await topAtSeal()));

await b.close();
