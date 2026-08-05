/** Does the postcard still spill during/after the page-flip raster? */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'qa/tmp/vfy-flip';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (;;) {
  if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  await p.waitForTimeout(150);
}
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});
await p.waitForTimeout(1200);
await p.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((x) => /welcome/i.test(x.title)) ?? books[0];
  globalThis.__shelfPullOut(w.id);
});
await p.waitForSelector('.pulled-book', { timeout: 30000 });
await p.waitForTimeout(2500);
for (let a = 0; a < 6; a++) {
  if (await p.$('.nb-prose')) break;
  const box = await p
    .$eval('.pulled-book', (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })
    .catch(() => null);
  if (box) {
    await p.mouse.move(box.x, box.y);
    await p.mouse.down();
    await p.waitForTimeout(80);
    await p.mouse.up();
  }
  await p.waitForTimeout(1500);
}
await p.waitForSelector('.nb-prose', { timeout: 30000 });
await p.waitForTimeout(2500);

const hasCard = () => p.$$eval('[data-type="postcard"]', (e) => e.length > 0);

// walk forward until the NEXT turn lands on the postcard spread
let landed = false;
for (let i = 0; i < 20 && !landed; i++) {
  await p.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await p.keyboard.press('ArrowRight');
  // burst-capture the whole flip + landing
  const shots = [];
  for (let k = 0; k < 22; k++) {
    shots.push(await p.screenshot({ type: 'jpeg', quality: 92 }));
    await p.waitForTimeout(110);
  }
  await p.waitForTimeout(700);
  if (await hasCard()) {
    landed = true;
    const { writeFileSync } = await import('node:fs');
    shots.forEach((s, k) => writeFileSync(`${OUT}/f${String(k).padStart(2, '0')}.jpg`, s));
    await p.screenshot({ path: `${OUT}/settled.png` });
    console.log(`captured ${shots.length} frames across the turn onto the postcard spread (turn ${i})`);
  }
}
if (!landed) console.log('never landed on the postcard spread');
await b.close();
