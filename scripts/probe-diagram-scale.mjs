/**
 * scripts/probe-diagram-scale.mjs — does a diagram get shorter when the window
 * does?
 *
 * `split.ts` charges a diagram a fixed number of page lines, measured at
 * 1600x1000. Every other cost in that file now moves with the window, and
 * whether this one should depends on a fact about the renderer: `.nb-dg-svg` is
 * `width: 100%; height: auto` over a viewBox, which SAYS a diagram is scaled to
 * its column and is therefore as window-dependent as a picture. That is a
 * reading of a stylesheet, and the difference between right and wrong here is
 * three of the welcome book's leaves being gutted for no reason, so it gets
 * measured.
 *
 * Walks the open book at two window sizes and reports every diagram's drawn
 * height over the leaf's line height. If the ratio between the two windows is
 * the ratio of their columns (0.733), a diagram scales.
 */
import { chromium } from 'playwright';

const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const SIZES = [
  { w: 1600, h: 1000 },
  { w: 1280, h: 800 },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const found = {};
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
  });
  await page.evaluate(async () => {
    await globalThis.__shelfWorld.ready;
  });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) {
    await skip.first().click({ force: true });
    await page.waitForTimeout(700);
  }
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const w = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    app.appState.openBook(w.id);
  });
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForTimeout(3500);

  const readings = [];
  for (let spread = 0; spread < 20; spread += 1) {
    const here = await page.evaluate(() => {
      const prose = document.querySelector('.nb-prose');
      const column = prose === null ? 0 : prose.clientWidth;
      const paper = document.querySelector('.nb-leaf-paper');
      const scale =
        paper === null || paper.clientHeight === 0
          ? 1
          : paper.getBoundingClientRect().height / paper.clientHeight;
      return [...document.querySelectorAll('.nb-diagram')].map((el) => {
        const svg = el.querySelector('.nb-dg-svg');
        const box = svg?.getAttribute('viewBox') ?? '';
        const r = svg?.getBoundingClientRect();
        return {
          kind: el.querySelector('.nb-diagram-kind')?.textContent?.trim() ?? '?',
          viewBox: box,
          drawnW: r === undefined ? 0 : Math.round(r.width / scale),
          drawnH: r === undefined ? 0 : Math.round(r.height / scale),
          column,
        };
      });
    });
    readings.push(...here);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
  }
  await page.close();
  found[`${s.w}x${s.h}`] = readings;
  console.log(`\n  === ${s.w}x${s.h} — prose column ${readings[0]?.column ?? '?'}px`);
  const seen = new Set();
  for (const r of readings) {
    const key = `${r.kind}|${r.viewBox}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  ${r.kind.padEnd(10)} viewBox ${r.viewBox.padEnd(20)} drawn ${String(r.drawnW).padStart(4)}x${String(r.drawnH).padStart(4)}` +
        `  fills column: ${r.drawnW >= r.column - 2 ? 'YES' : 'no '}  lines ${(r.drawnH / 32).toFixed(2)}`,
    );
  }
}

await browser.close();
