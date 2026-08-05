/** Polaroid + wrapping caption, driven by clicking, at the demo window size. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'qa/tmp/vfy-polaroid';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2 });
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
await p.waitForTimeout(2000);

// turn to the kitten row
for (let i = 0; i < 20; i++) {
  const n = await p.$$eval('.nb-image-row-track .nb-image, .nb-image', (e) => e.length);
  const hasRow = await p.$$eval('.nb-image', (els) =>
    els.some((e) => (e.querySelector('textarea')?.value ?? '') === 'On the good chair'),
  );
  if (hasRow) break;
  await p.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1500);
  void n;
}

// click the middle kitten to select it
const target = await p.evaluateHandle(() =>
  [...document.querySelectorAll('.nb-image')].find(
    (e) => (e.querySelector('textarea')?.value ?? '') === 'On the good chair',
  ),
);
const img = await target.asElement();
if (!img) throw new Error('no captioned kitten found');
const r = await img.evaluate((e) => {
  const b = e.querySelector('img').getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await p.mouse.click(r.x, r.y);
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/1-selected.png` });

// toggle polaroid frame
const btn = await img.$('button[aria-label="Toggle polaroid frame"]');
if (!btn) {
  console.log('NO FRAME BUTTON — controls not shown');
} else {
  await btn.click();
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${OUT}/2-polaroid.png` });
}

const geo = await img.evaluate((e) => {
  const fig = e.querySelector('.nb-image-figure');
  const box = e.querySelector('.nb-image-captionbox');
  const ta = e.querySelector('textarea');
  const photo = e.querySelector('img');
  const cs = getComputedStyle(box);
  return {
    frame: e.getAttribute('data-frame'),
    captioned: e.hasAttribute('data-captioned'),
    boxPosition: cs.position,
    captionTop: box.getBoundingClientRect().top,
    photoBottom: photo.getBoundingClientRect().bottom,
    figBottom: fig.getBoundingClientRect().bottom,
    captionBottom: box.getBoundingClientRect().bottom,
    taH: ta.offsetHeight,
    taValue: ta.value,
    overlapsPhoto: box.getBoundingClientRect().top < photo.getBoundingClientRect().bottom,
    spillsFigure: box.getBoundingClientRect().bottom > fig.getBoundingClientRect().bottom,
  };
});
console.log('POLAROID GEOMETRY:', JSON.stringify(geo, null, 1));

// now type a much longer caption and see it grow
await p.mouse.click(r.x, r.y);
await p.waitForTimeout(300);
const ta = await img.$('textarea');
await ta.click({ clickCount: 3 });
await p.keyboard.press('Control+a');
await p.keyboard.type('A grey kitten asleep on the good chair, as she is every afternoon');
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/3-long-caption.png` });
const geo2 = await img.evaluate((e) => {
  const fig = e.querySelector('.nb-image-figure');
  const box = e.querySelector('.nb-image-captionbox');
  const ta = e.querySelector('textarea');
  const photo = e.querySelector('img');
  return {
    taH: ta.offsetHeight,
    hiddenH: ta.scrollHeight - ta.clientHeight,
    overlapsPhoto: box.getBoundingClientRect().top < photo.getBoundingClientRect().bottom - 0.5,
    spillsFigure: box.getBoundingClientRect().bottom > fig.getBoundingClientRect().bottom + 0.5,
  };
});
console.log('LONG CAPTION:', JSON.stringify(geo2, null, 1));
await b.close();
