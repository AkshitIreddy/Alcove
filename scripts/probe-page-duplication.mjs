/**
 * scripts/probe-page-duplication.mjs — is the same content on two pages?
 *
 * The reader, watching the demo frame by frame: *"there is some page with a big
 * A in a circle saying 'pressed when soft' something, so there is a bug where it
 * shows the same section copied on the next page as well"*, and separately
 * *"sometimes the headings are at the bottom of the page or go missing after a
 * second when the page turn happens"*.
 *
 * Looking at the frames, one green callout — "Ctrl Alt F grows the case by a
 * floor" — appears TWICE on one page, and a heading sits jammed at the very
 * bottom edge. If the pagination drain is duplicating rather than moving, that
 * is a data bug: `extractOverflow` removes trailing blocks from page N and
 * `carryOverflow` prepends them to page N+1, and the two halves persist by
 * different routes (a debounced save on one side, an awaited `savePageDoc` on
 * the other).
 *
 * So this reads the DOCUMENTS rather than the pixels: every page of the Welcome
 * book, before and after a full pass of turns, looking for the same text on two
 * pages and for a page that carries the same block twice.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

/** Every page of the Welcome book, as plain text per top-level block. */
const readBook = async () =>
  page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pagesMod = await import('/src/data/pages.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    const pages = await pagesMod.listPages(welcome.id);
    const textOf = (node) => {
      if (node === null || typeof node !== 'object') return '';
      if (typeof node.text === 'string') return node.text;
      return (node.content ?? []).map(textOf).join('');
    };
    return pages.map((pg, i) => ({
      i,
      id: pg.id,
      blocks: (pg.doc?.content ?? []).map((b) => textOf(b).trim()).filter((t) => t.length > 8),
    }));
  });

const report = (label, pages) => {
  console.log(`\n=== ${label} — ${pages.length} pages ===`);
  // A block's text appearing on more than one page.
  const where = new Map();
  for (const pg of pages) {
    for (const t of new Set(pg.blocks)) {
      if (!where.has(t)) where.set(t, []);
      where.get(t).push(pg.i);
    }
  }
  const across = [...where.entries()].filter(([, ps]) => ps.length > 1);
  // The same block twice on ONE page.
  const within = [];
  for (const pg of pages) {
    const seen = new Set();
    for (const t of pg.blocks) {
      if (seen.has(t)) within.push({ page: pg.i, text: t });
      seen.add(t);
    }
  }
  console.log(`  ${across.length} block(s) appear on more than one page`);
  for (const [t, ps] of across.slice(0, 6)) console.log(`     pages ${ps.join(', ')}: "${t.slice(0, 66)}"`);
  console.log(`  ${within.length} block(s) appear twice on the SAME page`);
  for (const d of within.slice(0, 6)) console.log(`     page ${d.page}: "${d.text.slice(0, 66)}"`);
  return { across: across.length, within: within.length };
};

const before = await readBook();
const b = report('as stored, before the book is ever opened', before);

// Open it and turn through every page, the way the demo does.
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((x) => /welcome/i.test(x.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(6000);
for (let i = 0; i < 18; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}
await page.waitForTimeout(3000);

const after = await readBook();
const a = report('after opening the book and turning through it', after);

console.log('\n--- what changed by MERELY READING the book ---');
console.log(`  duplicated across pages : ${b.across} -> ${a.across}`);
console.log(`  duplicated within a page: ${b.within} -> ${a.within}`);
console.log(`  page count              : ${before.length} -> ${after.length}`);
console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
