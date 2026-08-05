/**
 * Independent verification of the frame-1198 defect.
 * Opens the REAL welcome book at the demo's own window size and turns to the
 * spread that carries the postcard + kitten row. Measures and shoots.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'verify-out';
const W = Number(process.env.W ?? 1360);
const H = Number(process.env.H ?? 850);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
p.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200));
});

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
  const welcome = books.find((x) => /welcome/i.test(x.title)) ?? books[0];
  globalThis.__shelfPullOut(welcome.id);
});
await p.waitForSelector('.pulled-book', { timeout: 30000 });
await p.waitForTimeout(2500);
for (let a = 0; a < 6; a++) {
  if (await p.$('.nb-prose')) break;
  const box = await p.$eval('.pulled-book', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }).catch(() => null);
  if (box) {
    await p.mouse.move(box.x, box.y);
    await p.waitForTimeout(150);
    await p.mouse.down();
    await p.waitForTimeout(80);
    await p.mouse.up();
  }
  await p.waitForTimeout(1500);
}
await p.waitForSelector('.nb-prose', { timeout: 30000 });
await p.waitForTimeout(2500);

const measure = () =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-type="postcard"]')].map((c) => {
      const cs = getComputedStyle(c);
      const kids = [...c.children].filter((k) => !/::/.test(k.tagName));
      // last text-bearing descendant paragraph
      const paras = [...c.querySelectorAll('p, div')].filter(
        (e) => (e.textContent ?? '').trim().length > 0,
      );
      const last = paras[paras.length - 1];
      const cRect = c.getBoundingClientRect();
      const lRect = last ? last.getBoundingClientRect() : null;
      return {
        text: (c.textContent ?? '').replace(/\s+/g, ' ').slice(0, 90),
        offsetH: c.offsetHeight,
        scrollH: c.scrollHeight,
        clientH: c.clientHeight,
        overflowY: c.scrollHeight - c.clientHeight,
        clientW: c.clientWidth,
        paddingRight: cs.paddingRight,
        // how far the content box runs past the divider printed at 50%
        pastRule:
          Math.round(
            (c.clientWidth +
              parseFloat(cs.paddingLeft) -
              (c.offsetWidth * 0.5)) * 10,
          ) / 10,
        lastBottomGapPx: lRect && cRect ? Math.round((cRect.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) - lRect.bottom) * 10) / 10 : null,
      };
    });

    const caps = [...document.querySelectorAll('.nb-image-caption')].map((el) => {
      const cs = getComputedStyle(el);
      const cv = document.createElement('canvas').getContext('2d');
      cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const val = el.value ?? el.textContent ?? '';
      return {
        tag: el.tagName,
        value: val,
        textW: Math.round(cv.measureText(val).width * 10) / 10,
        boxW: el.clientWidth,
        offsetH: el.offsetHeight,
        scrollH: el.scrollHeight,
        hiddenH: el.scrollHeight - el.clientHeight,
        oneLineOverflowPx:
          Math.round((cv.measureText(val).width - el.clientWidth) * 10) / 10,
      };
    });
    const types = [...document.querySelectorAll('[data-type]')].map((e) => e.getAttribute('data-type'));
    return { cards, caps, types: [...new Set(types)] };
  });

let found = null;
for (let i = 0; i < 20; i++) {
  const m = await measure();
  console.log(`turn ${i} types:`, JSON.stringify(m.types));
  await p.screenshot({ path: `${OUT}/turn-${String(i).padStart(2, '0')}.png` });
  if (m.cards.length > 0 || m.caps.length > 0) {
    console.log(`page turn ${i}:`, JSON.stringify({ cards: m.cards, caps: m.caps }, null, 1));
    if (m.cards.length > 0 && m.caps.length > 0) found = m;
  }
  await p.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1600);
}

console.log('\nFOUND SPREAD:', JSON.stringify(found, null, 1));
await b.close();
