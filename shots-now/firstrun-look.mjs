/**
 * shots-now/firstrun-look.mjs — what a brand-new reader actually sees.
 *
 * Clears everything, reloads, skips the tour, and photographs the shelf at the
 * zoom the app opens on. This is the picture the "default room looks weird"
 * report is about, so it is taken the way the reader meets it rather than as a
 * specimen board.
 *
 * Usage: node shots-now/firstrun-look.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => {
  localStorage.clear();
  try {
    indexedDB.deleteDatabase('alcove');
  } catch {
    /* best effort */
  }
});
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });

// Wait for the shelf to be up AND for its art to have settled, not just for
// the bridge to exist — a shot taken at first paint shows placeholder tints.
const t0 = Date.now();
for (;;) {
  const ready = await p.evaluate(() => {
    const d = globalThis.__shelfDesign?.();
    return d !== undefined && d.libraryKey !== '' && d.bakes > 0;
  });
  if (ready || Date.now() - t0 > 90000) break;
  await p.waitForTimeout(400);
}

// The tour covers the shelf; take one shot with it and one without.
await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots-now/out/firstrun-with-tour.png' });

for (let i = 0; i < 6; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(600);
}
await p.keyboard.press('Escape').catch(() => {});
await p.waitForTimeout(3000);

console.log('  applied:', JSON.stringify(await p.evaluate(() => globalThis.__shelfDesign())));
await p.screenshot({ path: 'shots-now/out/firstrun-shelf.png' });
console.log('  wrote shots-now/out/firstrun-shelf.png');

// And zoomed in, so the carpentry and the welcome book can be judged.
await p.mouse.move(750, 400);
for (let i = 0; i < 5; i++) {
  await p.mouse.wheel(0, -240);
  await p.waitForTimeout(350);
}
await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots-now/out/firstrun-closer.png' });
console.log('  wrote shots-now/out/firstrun-closer.png');

await b.close();
