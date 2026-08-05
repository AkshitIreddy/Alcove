/**
 * scripts/probe-footnote-stacking.mjs — when the footnote rail and a block
 * DO share pixels, which one is on top?
 *
 * The demo's frame 778 shows them sharing pixels at the foot of the Welcome
 * book's "Every mark there is" leaf, and the note loses: "1 like this one" is
 * printed under the "The seven washes" card, with the card's face and its wash
 * chips over the top of it. Why they were overlapping at all is a pagination
 * question and it fixes itself a few frames later. This asks the other half,
 * which does NOT fix itself: what the paint order between them is. Paint order
 * is a property of the stylesheet — it holds on every frame, and the overlap
 * only has to happen on one.
 *
 * The rail is `position: absolute` and comes after the prose in the DOM, so by
 * CSS 2.1 Appendix E it ought to paint above every non-positioned descendant
 * of the prose. Several things on a page do not settle for that: the backlinks
 * strip takes z-index 5, the page-full hint 4, tape and washi strips 2, the
 * margin doodles 1. The rail asks for nothing, which puts it at the bottom of
 * the pile of things that stand at the foot of a page.
 *
 * IT DRIVES A SPECIMEN BOOK, NOT THE WELCOME BOOK. Walking to the footnote
 * leaf means turning eight spreads while the drain is re-cutting every page it
 * lands on, which took twenty-four arrow presses and arrived somewhere else.
 * A one-page book authored through `createBookFromScript` opens ON the leaf.
 *
 * Usage: node scripts/probe-footnote-stacking.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/footnote-stacking';
const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ??
  'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

// The foot of the demo's leaf, verbatim enough to be the same test: a marker
// in the prose, a card with a title and a row of wash chips, and a taped
// block — tape is the one piece of block furniture that asks for a z-index.
const SPECIMEN = `# Every mark there is

A note can hang off a word[^ like this one ], and a highlight can wear any of the seven washes.

::: card {title="The seven washes"}
==amber=={color=amber} ==terracotta=={color=terracotta} ==moss=={color=moss} ==lemon=={color=lemon} ==sky=={color=sky} ==blush=={color=blush} ==graphite=={color=graphite}
:::

A taped line, which is the other thing that stands at the foot of a page {tape=top}
`;

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1360, height: 850 },
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

const made = await page.evaluate(async (source) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const res = await mod.createBookFromScript(source, 'Footnote specimen');
  return { title: res.book.title, pages: res.pages.length };
}, SPECIMEN);
console.log(`  specimen: "${made.title}" — ${made.pages} page(s)`);

// A reload so the shelf is rebuilt around the new book, then pull it out by
// its own label and open it.
await page.reload({ waitUntil: 'domcontentloaded' });
await boot();
await page.evaluate((title) => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const b = books.find((x) => x.title === title);
  if (b) globalThis.__shelfPullOut(b.id);
}, made.title);
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1400);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) {
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
}
await page.waitForSelector('.nb-footnote-rail', { timeout: 60_000 });
await page.waitForTimeout(3500);

await page
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/at-rest.png`, timeout: 20_000 })
  .catch(() => {});

/*
 * Walk the rail up the page until it stands across the card, which is the
 * geometry of frame 778 without having to catch the frame, and ask the
 * document who is on top where they meet.
 */
const verdict = await page.evaluate(() => {
  const rail = document.querySelector('.nb-leaf-paper .nb-footnote-rail');
  if (rail === null) return { error: 'no rail' };
  const prose = rail.closest('.nb-page-editor')?.querySelector('.nb-prose');
  if (!prose) return { error: 'no prose' };
  const named = (el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    const type = el.getAttribute?.('data-type');
    return (
      el.tagName.toLowerCase() +
      (type ? `[${type}]` : '') +
      (cls ? `.${cls.split(' ').filter(Boolean).slice(0, 2).join('.')}` : '')
    );
  };
  const out = {};
  for (const wanted of ['card', 'tape']) {
    const block =
      wanted === 'card'
        ? Array.from(prose.children).find(
            (k) => k.getAttribute('data-type') === 'card',
          )
        : Array.from(prose.children).find((k) => k.hasAttribute('data-tape'));
    if (!block) {
      out[wanted] = { error: 'block not found' };
      continue;
    }
    const host = rail.parentElement;
    const hostRect = host.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    const railH = rail.getBoundingClientRect().height;
    // `bottom` is measured from the host's foot: put the rail's own top a
    // little below the block's top, so the note's line lands inside it.
    rail.style.bottom = `${Math.round(hostRect.bottom - blockRect.top - railH - 14)}px`;
    const note = rail.querySelector('.nb-footnote-note');
    const noteRect = note.getBoundingClientRect();
    const x = Math.round(noteRect.left + noteRect.width / 2);
    const y = Math.round(noteRect.top + noteRect.height / 2);
    out[wanted] = {
      note: { x, y },
      // Front to back. The note is covered if anything from the prose is
      // listed before the rail.
      stack: document.elementsFromPoint(x, y).slice(0, 6).map(named),
    };
    rail.style.bottom = '';
  }
  return out;
});
console.log(JSON.stringify(verdict, null, 1));

// And a picture of it, held over the card so the pixels can be looked at.
await page.evaluate(() => {
  const rail = document.querySelector('.nb-leaf-paper .nb-footnote-rail');
  const prose = rail.closest('.nb-page-editor').querySelector('.nb-prose');
  const card = Array.from(prose.children).find(
    (k) => k.getAttribute('data-type') === 'card',
  );
  const hostRect = rail.parentElement.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const railH = rail.getBoundingClientRect().height;
  rail.style.bottom = `${Math.round(hostRect.bottom - cardRect.top - railH - 14)}px`;
});
await page.waitForTimeout(400);
await page
  .locator('.nb-book-view')
  .screenshot({ path: `${outDir}/rail-over-card.png`, timeout: 20_000 })
  .catch(() => {});

console.log(`  pictures: ${outDir}/`);
console.log('  errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
