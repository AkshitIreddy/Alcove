/** Polaroid + long wrapping caption, forced on a live node, screenshotted. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'qa/tmp/vfy-polaroid2';
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

for (let i = 0; i < 20; i++) {
  const has = await p.$$eval('.nb-image', (els) =>
    els.some((e) => (e.querySelector('textarea')?.value ?? '') === 'On the good chair'),
  );
  if (has) break;
  await p.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1500);
}

const apply = (text) =>
  p.evaluate((t) => {
    const el = [...document.querySelectorAll('.nb-image')].find((e) => {
      const ta = e.querySelector('textarea');
      if (ta === null || !/chair|asleep/i.test(ta.value)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 8 && r.height > 8 && r.top > 0 && r.left > 0 && r.top < window.innerHeight - 60;
    });
    if (!el) return { err: 'not found' };
    el.setAttribute('data-frame', 'polaroid');
    el.setAttribute('data-captioned', '');
    const ta = el.querySelector('textarea');
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const fig = el.querySelector('.nb-image-figure');
    const box = el.querySelector('.nb-image-captionbox');
    const photo = el.querySelector('img');
    const cs = getComputedStyle(box);
    const r = el.getBoundingClientRect();
    return {
      pos: cs.position,
      taH: ta.offsetHeight,
      hiddenH: ta.scrollHeight - ta.clientHeight,
      overlapsPhoto: box.getBoundingClientRect().top < photo.getBoundingClientRect().bottom - 0.5,
      spillsFigure: box.getBoundingClientRect().bottom > fig.getBoundingClientRect().bottom + 0.5,
      figPadBottom: getComputedStyle(fig).paddingBottom,
      clip: { x: r.x - 20, y: r.y - 20, width: r.width + 40, height: r.height + 60 },
    };
  }, text);

for (const [name, text] of [
  ['short', 'On the good chair'],
  ['long', 'A grey kitten asleep on the good chair, as she is every afternoon'],
]) {
  const g = await apply(text);
  console.log(name, JSON.stringify(g));
  await p.waitForTimeout(400);
  if (g.clip) await p.screenshot({ path: `${OUT}/${name}.png`, clip: g.clip });
}
await b.close();
