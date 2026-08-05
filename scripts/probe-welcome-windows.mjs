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
import { mkdirSync, writeFileSync } from 'node:fs';

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
  const bookId = await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const w = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    app.appState.openBook(w.id);
    return w.id;
  });
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForTimeout(5000);

  /**
   * Every page's top-level block count, straight out of the store.
   *
   * This is the measurement that settles it, and the DOM is not: the flip
   * surface keeps three or four leaves mounted at once and a read taken while
   * one is turning catches it half-built, so "a leaf whose first block is not
   * its heading" reported tails at a window where nothing was over capacity.
   * The drain, when it fires, MOVES BLOCKS BETWEEN STORED PAGES. So: take the
   * shape of the book before the walk and after it, and see whether it moved.
   */
  const shape = async () =>
    page.evaluate(async (id) => {
      const pages = await import('/src/data/pages.ts');
      const list = await pages.listPages(id);
      return list.map((pg) => (pg.doc?.content ?? []).length);
    }, bookId);
  const shapeBefore = await shape();
  const countPages = async () =>
    page.evaluate(async (id) => {
      const pages = await import('/src/data/pages.ts');
      return (await pages.listPages(id)).length;
    }, bookId);
  const before = await countPages();

  /* Turn to the last spread the book already has, and no further.
     NOT "until a blank leaf appears": turning right off the end APPENDS a page
     (BookView.turn), so a loop that stops when it sees blank paper has already
     made some, and the first version of this probe reported four leaves of
     drain at a window where every page covers 60% of its leaf. The book's own
     length is the bound. */
  const spreads = Math.ceil(before / 2);
  const leaves = [];
  for (let spread = 0; spread < spreads; spread += 1) {
    await page.waitForTimeout(650);
    if (spread < 4) {
      await page.screenshot({ path: `${outDir}/${s.tag}-spread-${spread + 1}.png` });
    }
    leaves.push(
      ...(await page.evaluate(() =>
        [...document.querySelectorAll('.nb-leaf-paper')].map((leaf) => {
          const prose = leaf.querySelector('.nb-prose');
          const first = prose?.firstElementChild;
          const title =
            first === undefined || first === null
              ? ''
              : /^H[1-3]$/.test(first.tagName)
                ? (first.textContent ?? '').trim()
                : '(a tail)';
          /* What the leaf actually SPENDS, in its own line height: the same
             quantity `probe-page-cost.mjs` sums at 1600x1000, measured here at
             whatever window this run is using. Laid-out pixels, because a leaf
             carries a 3D transform and only laid-out px are in the same units
             as the line height they divide by. */
          let spend = 0;
          if (prose !== null && prose !== undefined) {
            const kids = [...prose.children];
            const line =
              Number.parseFloat(getComputedStyle(prose).lineHeight) || 32;
            for (let i = 0; i < kids.length; i += 1) {
              const k = kids[i];
              const next = kids[i + 1];
              spend +=
                next === undefined
                  ? k.offsetHeight
                  : next.offsetTop - k.offsetTop;
            }
            spend = Math.round((spend / line) * 100) / 100;
          }
          return { title, spend };
        }),
      )),
    );
    if (spread === spreads - 1) break;
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(2500);
  const after = await countPages();
  const shapeAfter = await shape();
  await page.close();

  /* A page that LOST blocks is a page that was drained; a page that gained
     exactly one is the editor putting its trailing empty paragraph on a leaf
     the reader has now looked at, which every page does at every window and
     which is not this probe's business. */
  const drained = [];
  for (let i = 0; i < Math.max(shapeBefore.length, shapeAfter.length); i += 1) {
    const was = shapeBefore[i] ?? 0;
    const now = shapeAfter[i] ?? 0;
    if (now < was || now > was + 1) {
      drained.push(`${i + 1}: ${was} -> ${now}`);
    }
  }

  /* The measurement that matters. A drained page does not announce itself in
     the page COUNT — the contract prepends the tail to the NEXT page, which
     already exists, so the book only grows once the cascade reaches the end.
     What it does do immediately is put a leaf on the desk that does not begin
     with its own heading. Every authored page here opens with one. */
  const tails = leaves.filter((t) => t.title === '(a tail)').length;
  console.log(
    `
  ${s.w}x${s.h} (${s.tag}): ${before} leaves on opening, ${after} after ` +
      `walking all ${spreads} spreads`,
  );
  const inked = leaves.filter((t) => t.title !== '');
  console.log(
    `    pages the drain rearranged: ` +
      `${drained.length === 0 ? 'NONE' : `${drained.length} — ${drained.join(', ')}`}`,
  );
  console.log(
    `    (leaves seen mid-turn without their own heading: ${tails} of ${inked.length})`,
  );
  const worst = new Map();
  for (const leaf of inked) {
    if (leaf.title === '(a tail)') continue;
    worst.set(leaf.title, Math.max(worst.get(leaf.title) ?? 0, leaf.spend));
  }
  const capacity = (s.h - 179) / 32;
  writeFileSync(
    `${outDir}/${s.tag}-spend.json`,
    JSON.stringify([...worst.entries()], null, 2),
  );
  const ranked = [...worst.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`    leaf holds ${capacity.toFixed(2)} lines; the five dearest pages:`);
  for (const [title, spend] of ranked.slice(0, 5)) {
    console.log(
      `      ${spend.toFixed(2).padStart(6)}  ${spend > capacity ? 'OVER  ' : '      '}${title}`,
    );
  }
}
await browser.close();
