/**
 * scripts/probe-welcome-windows.mjs — the seeded book, opened at the windows a
 * reader really gets, counting the leaves and photographing the first spreads.
 *
 * The question the budget exists to answer, asked of the running app rather
 * than of the estimator: **when the welcome book is opened, does it stay the
 * length it was written at?** A leaf never scrolls, so a page authored over
 * capacity has its tail pushed onto the next leaf, and every page after it
 * carries somebody else's — the book comes back longer than it was made and
 * every spread after the first is wrong.
 *
 * So: open it, walk to the end, and count. 32 leaves means nothing drained. It
 * also shoots the first four spreads at each size, because "does it fit" and
 * "does it look full" are different questions and only one of them can be
 * counted.
 *
 * Usage: node scripts/probe-welcome-windows.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/welcome-windows';
mkdirSync(outDir, { recursive: true });

const SIZES = [
  { w: 1600, h: 1000, tag: 'roomy' },
  { w: 1280, h: 800, tag: 'default' },
  { w: 960, h: 620, tag: 'minimum' },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto('http://localhost:1420/?fx=force&dev=0', {
    waitUntil: 'domcontentloaded',
  });
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
  await page.waitForTimeout(5000);

  /* Turn to the end. Every spread is given time to settle, because the drain
     runs when a page is MOUNTED — a spread flicked past too fast is a page
     that never had the chance to push its tail forward, which would make this
     probe agree with a book that does not. */
  const titles = [];
  let blank = 0;
  for (let spread = 0; spread < 30; spread += 1) {
    await page.waitForTimeout(700);
    const here = await page.evaluate(() =>
      [...document.querySelectorAll('.nb-leaf-paper')].map((leaf) => {
        const h = leaf.querySelector('h1, h2, h3');
        const prose = leaf.querySelector('.nb-prose');
        const blocks = prose === null ? 0 : prose.children.length;
        return { title: h?.textContent?.trim() ?? '', blocks };
      }),
    );
    for (const leaf of here) titles.push(leaf);
    if (spread < 4) {
      await page.screenshot({ path: `${outDir}/${s.tag}-spread-${spread + 1}.png` });
    }
    const empty = here.filter((l) => l.blocks === 0).length;
    if (empty > 0 && here.length > 0) blank += 1;
    if (blank > 1) break;
    await page.keyboard.press('ArrowRight');
  }
  await page.close();

  const named = titles.filter((t) => t.title !== '');
  const unique = [...new Set(named.map((t) => t.title))];
  const inked = titles.filter((t) => t.blocks > 0);
  console.log(
    `\n  ${s.w}x${s.h} (${s.tag}): ${inked.length} leaves reached, ` +
      `${unique.length} distinct headings`,
  );
  const headless = inked.filter((t) => t.title === '').length;
  console.log(
    `    leaves with no heading of their own (a drained tail): ${headless}`,
  );
}
await browser.close();
