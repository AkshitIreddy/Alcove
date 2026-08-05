/**
 * scripts/probe-footnote-fit.mjs — does a page the splitter built for a leaf
 * still fit that leaf once its footnotes are standing at the foot of it?
 *
 * The proof for the fix in `features/templates/split.ts`. The estimator there
 * costs every block on a page and cuts when the total passes
 * `PAGE_LINE_BUDGET`; it did not know that a page carrying a footnote is
 * shorter than one that is not, because the rail
 * (`src/editor/nodes/footnote.ts`) takes its height out of the prose's
 * padding-bottom at read time. So a page filled to the budget with a note on
 * it arrived over-full, and the overflow drain evicted the last block the
 * first time a reader looked at the page — the block standing on the note in
 * frame 778 of the demo.
 *
 * The measurement is the only one that settles it: how many blocks the
 * SPLITTER put on page one, against how many the app is still holding there
 * once everything has settled. Equal means the page was built to fit. One
 * fewer means the drain had to move a block the reader was already looking at.
 *
 * AT 1600x1000, deliberately — that is the window `PAGE_LINE_BUDGET` was
 * calibrated against (see the header of split.ts). At a smaller one every page
 * in every book is over-budget and the footnote's contribution is lost in it.
 *
 * Usage: node scripts/probe-footnote-fit.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/footnote-fit';
const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ??
  'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

/*
 * A page filled to the budget with the plainest thing there is, so that the
 * only interesting quantity on it is the notes. One line a paragraph means the
 * estimator cannot be wrong about the blocks — a paragraph costs the lines it
 * wraps to, and these wrap to one — and the page therefore stands or falls on
 * the rail alone.
 *
 * FOUR notes, not one. `PAGE_LINE_BUDGET` sits 2.16 lines under what a leaf
 * really holds, on purpose, to absorb the estimator's own error — and a
 * one-note rail is 1.28 lines, so on a page of blocks the estimator is exact
 * about, that margin swallows it and the page fits anyway. Four notes is 3.44
 * lines, which is more margin than there is; that is where an uncharged rail
 * stops being free, and it is the same failure as one note on any page the
 * estimator is a line pessimistic about.
 */
const NOTES = '[^ the first note ][^ the second ][^ the third ][^ the fourth ]';
const lines = (n, noted) =>
  Array.from({ length: n }, (_, i) =>
    i === 0 && noted ? `Line ${i}${NOTES}.` : `Line ${i}.`,
  ).join('\n\n');

const BOOKS = [
  ['notes on the page', `# Fit with notes\n\n${lines(40, true)}`],
  ['no notes at all', `# Fit with no notes\n\n${lines(40, false)}`],
];

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const boot = async () => {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
    timeout: 90_000,
  });
  await page.evaluate(async () => {
    await globalThis.__shelfWorld.ready;
  });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) {
    await skip.first().click({ force: true });
    await page.waitForTimeout(900);
  }
};

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await boot();

const made = [];
for (const [label, source] of BOOKS) {
  const res = await page.evaluate(
    async ([src, name]) => {
      const mod = await import('/src/features/templates/createFromScript.ts');
      const out = await mod.createBookFromScript(src, name);
      return {
        id: out.book.id,
        // What the SPLITTER decided, before any leaf was ever laid out.
        built: out.pages.map((p) => (p.doc?.content ?? []).length),
      };
    },
    [source, `Fit — ${label}`],
  );
  made.push({ label, ...res });
}

let verdict = 'OK';
for (const book of made) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  await page.evaluate((id) => globalThis.__shelfPullOut(id), book.id);
  await page.waitForSelector('.pulled-book', { timeout: 30_000 });
  await page.waitForTimeout(1400);
  const cover = await page.locator('.pulled-book').first().boundingBox();
  if (cover) {
    await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
  }
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  // Long enough for the mount drain, the fonts pass and any carry to settle.
  await page.waitForTimeout(7000);

  const held = await page.evaluate(() => {
    const leaf = document.querySelector('.nb-leaf-paper[data-side="left"]');
    const prose = leaf?.querySelector('.nb-prose');
    if (!prose) return null;
    const host = prose.closest('.nb-page-editor');
    const rail = host.querySelector('.nb-footnote-rail');
    // The trailing empty paragraph StarterKit keeps at the foot of a page is
    // bookkeeping, not a block the splitter put there.
    const inked = Array.from(prose.children).filter(
      (k) => (k.textContent ?? '').trim().length > 0,
    );
    const railRect = rail === null || rail.hidden ? null : rail.getBoundingClientRect();
    const last = inked[inked.length - 1];
    return {
      blocks: inked.length,
      last: (last?.textContent ?? '').trim().slice(0, 26),
      reserved: getComputedStyle(host).getPropertyValue('--nb-footnote-rail').trim(),
      padBottom: getComputedStyle(prose).paddingBottom,
      // Positive means ink is standing in the rail's band.
      overRail:
        railRect === null || last === undefined
          ? 0
          : Math.round(last.getBoundingClientRect().bottom - railRect.top),
    };
  });

  const built = book.built[0];
  const moved = held === null ? '?' : built - held.blocks;
  if (moved !== 0) verdict = 'MOVED';
  console.log('');
  console.log(`  === ${book.label} ===`);
  console.log(`  the splitter built page 1 with   ${built} block(s)`);
  console.log(`  the app settled on               ${held?.blocks} block(s)`);
  console.log(
    `  rail ${held?.reserved || '0px'}, prose padding ${held?.padBottom}, ` +
      `last block ${held?.overRail ?? 0}px past the rail's top`,
  );
  console.log(
    moved === 0
      ? '  -> the page was built to fit; nothing moved under the reader'
      : `  -> ${moved} block(s) were evicted at read time`,
  );
  await page
    .locator('.nb-book-view')
    .screenshot({
      path: `${outDir}/${book.label.replace(/\W+/g, '-')}.png`,
      timeout: 20_000,
    })
    .catch(() => {});
}

console.log('');
console.log(`  verdict: ${verdict}`);
console.log(`  pictures: ${outDir}/`);
console.log('  errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
