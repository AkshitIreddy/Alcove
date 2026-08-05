/**
 * Is the footnote/card collision ever ON SCREEN, the way frame 778 caught it?
 * An in-page rAF sampler watches every leaf that is inside the viewport.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/verify778-visible';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const boot = async () => {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400, timeout: 120_000 });
  await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
};

await page.goto('http://localhost:1420/?fx=force&dev=0', { waitUntil: 'domcontentloaded' });
await boot();
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const b = books.find((x) => /welcome/i.test(x.title)) ?? books[0];
  if (b) globalThis.__shelfPullOut(b.id);
});
await page.waitForSelector('.pulled-book', { timeout: 60_000 });
await page.waitForTimeout(1400);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-book-view', { timeout: 60_000 });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  globalThis.__collisions = [];
  const tick = () => {
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const lr = leaf.getBoundingClientRect();
      const onScreen =
        lr.width > 100 && lr.height > 100 &&
        lr.right > 0 && lr.left < innerWidth && lr.bottom > 0 && lr.top < innerHeight &&
        getComputedStyle(leaf).visibility !== 'hidden' &&
        Number(getComputedStyle(leaf).opacity) > 0.5;
      if (!onScreen) continue;
      const rail = Array.from(leaf.querySelectorAll('.nb-footnote-rail'))
        .find((r) => r.getBoundingClientRect().height > 1);
      const prose = leaf.querySelector('.nb-prose');
      if (!rail || !prose) continue;
      const rr = rail.getBoundingClientRect();
      for (const kid of prose.children) {
        const txt = (kid.textContent ?? '').trim();
        if (txt === '') continue;
        const kr = kid.getBoundingClientRect();
        const ov = Math.min(rr.bottom, kr.bottom) - Math.max(rr.top, kr.top);
        const ovx = Math.min(rr.right, kr.right) - Math.max(rr.left, kr.left);
        if (ov > 2 && ovx > 2) {
          globalThis.__collisions.push({
            t: Math.round(performance.now()),
            block: kid.getAttribute('data-type') ?? kid.tagName.toLowerCase(),
            text: txt.slice(0, 34).replace(/\s+/g, ' '),
            overlapPx: Math.round(ov),
            leafRect: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.width), Math.round(lr.height)],
            blocks: prose.children.length,
          });
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

let seen = 0;
for (let turn = 1; turn <= 8; turn += 1) {
  await page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(90);
    const n = await page.evaluate(() => globalThis.__collisions.length);
    if (n > seen) {
      seen = n;
      await page.screenshot({ path: `${outDir}/onscreen-turn${turn}-${i}.png` });
    }
  }
  await page.waitForTimeout(1200);
}

const all = await page.evaluate(() => globalThis.__collisions);
writeFileSync(`${outDir}/collisions.json`, JSON.stringify(all, null, 1));
console.log('ON-SCREEN COLLISION SAMPLES:', all.length);
console.log(JSON.stringify(all.slice(0, 25), null, 1));
console.log('errors:', errors);
await browser.close();
