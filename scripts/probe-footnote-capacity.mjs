/**
 * scripts/probe-footnote-capacity.mjs — is the footnote what makes the page
 * not fit?
 *
 * The last of the three candidates for frame 778. The first two are settled
 * and both came back clean:
 *
 *   probe-footnote-stacking.mjs  the rail paints ABOVE the card, measured with
 *                                elementsFromPoint. Not a stacking problem.
 *   probe-footnote-reserve.mjs   140 drain reads across a walk of the book, and
 *                                not one of them read a padding-bottom that was
 *                                missing its page's rail. Not a reserved-space
 *                                problem.
 *
 * Which leaves capacity — and capacity is not decided at read time only. A page
 * is BUILT by the estimator in features/templates/split.ts, which costs every
 * block on it and cuts when the total passes `PAGE_LINE_BUDGET`. That estimator
 * knows nothing about the strip of notes a footnote stands its page in. If a
 * page is built to fill the leaf and then a rail takes forty-one pixels out of
 * the bottom of it, the last block on the page has nowhere to be, and the drain
 * evicts it the first time a reader looks at the page — which is the block
 * standing on the note in frame 778.
 *
 * So: the same page, twice, through the real authored path — once with its
 * footnote and once with the marker written out as ordinary words of the same
 * length. If the page holds together without the note and sheds a block with
 * it, the rail is the whole difference and the estimator is where it is not
 * being counted.
 *
 * Usage: node scripts/probe-footnote-capacity.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/footnote-capacity';
const URL_BASE =
  process.argv.find((a) => a.startsWith('--url='))?.slice(6) ??
  'http://localhost:1420';
mkdirSync(outDir, { recursive: true });

// Page 6 of the welcome book, verbatim from src/data/seed.ts — the leaf in
// frame 778 — and the same page with the note written as plain words so the
// paragraph wraps to the same number of lines and only the RAIL differs.
const WITH_NOTE = `# Every mark there is {sticker=pin}

**Bold**, *italic*, \`code\`, ~~struck out~~, ==highlighted=={color=lemon}, ==or washed another colour=={color=sky}, and [a link out](https://example.com).

A note can hang off a word[^ like this one ], and a highlight can wear any of the seven washes.

::: card {title="The seven washes"}
==amber=={color=amber} ==terracotta=={color=terracotta} ==moss=={color=moss} ==lemon=={color=lemon} ==sky=={color=sky} ==blush=={color=blush} ==graphite=={color=graphite}
:::

::: callout {variant=tip}
Select any run of words and the little toolbar that appears carries all of it.
:::

::: index-card {title="Two spellings of everything"}
\`**bold**\` or \`__bold__\`, \`*italic*\` or \`_italic_\`. The parser takes whichever one you reach for first.
:::
`;
const WITHOUT_NOTE = WITH_NOTE.replace('[^ like this one ]', '');

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
// The size the demo was recorded at. It matters more than anything else here:
// the seeded pages were calibrated against a 1600x1000 window, and a leaf at
// 850 holds about four lines fewer.
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

const made = [];
for (const [label, source] of [
  ['with a footnote', WITH_NOTE],
  ['without one', WITHOUT_NOTE],
]) {
  const res = await page.evaluate(
    async ([src, name]) => {
      const mod = await import('/src/features/templates/createFromScript.ts');
      const out = await mod.createBookFromScript(src, name);
      return { id: out.book.id, title: out.book.title, pages: out.pages.length };
    },
    [source, `Fit ${label}`],
  );
  made.push({ label, ...res });
  console.log(
    `  "${label}": the splitter made ${res.pages} page(s) — book "${res.title}"`,
  );
}

for (const book of made) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await boot();
  await page.evaluate((id) => {
    globalThis.__shelfPullOut(id);
  }, book.id);
  await page.waitForSelector('.pulled-book', { timeout: 30_000 });
  await page.waitForTimeout(1400);
  const cover = await page.locator('.pulled-book').first().boundingBox();
  if (cover) {
    await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
  }
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  // Long enough for the drain, the fonts pass and any carry to have settled.
  await page.waitForTimeout(6000);

  const read = await page.evaluate(() => {
    const out = [];
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const prose = leaf.querySelector('.nb-prose');
      if (prose === null) continue;
      const host = prose.closest('.nb-page-editor');
      const rail = host.querySelector('.nb-footnote-rail');
      out.push({
        side: leaf.getAttribute('data-side'),
        blocks: Array.from(prose.children)
          .filter((k) => (k.textContent ?? '').trim().length > 0)
          .map((k) => (k.textContent ?? '').trim().slice(0, 24)),
        reserved: getComputedStyle(host)
          .getPropertyValue('--nb-footnote-rail')
          .trim(),
        padBottom: getComputedStyle(prose).paddingBottom,
        railShown: rail !== null && !rail.hidden,
      });
    }
    return out;
  });
  console.log('');
  console.log(`  === ${book.label} ===`);
  for (const leaf of read) {
    console.log(
      `  ${leaf.side} leaf: ${leaf.blocks.length} block(s), rail ${
        leaf.railShown ? leaf.reserved : 'none'
      }, padding ${leaf.padBottom}`,
    );
    for (const b of leaf.blocks) console.log(`      ${b}`);
  }
  await page
    .locator('.nb-book-view')
    .screenshot({
      path: `${outDir}/${book.label.replace(/\W+/g, '-')}.png`,
      timeout: 20_000,
    })
    .catch(() => {});
}

/*
 * And what the rail actually costs, so the estimator's constants are read off
 * the app rather than guessed: the reservation for one, two and three notes,
 * and how many characters of a note fit on one of its lines.
 */
const RULER = `# What the rail costs

One note[^ one ] on the page.

Two notes[^ two ] on the page[^ and another ].

Three notes[^ three ] on the page[^ and another ][^ and a third ].
`;
const ruler = await page.evaluate(async (src) => {
  const mod = await import('/src/features/templates/createFromScript.ts');
  const out = await mod.createBookFromScript(src, 'Rail ruler');
  return out.book.id;
}, RULER);
await page.reload({ waitUntil: 'domcontentloaded' });
await boot();
await page.evaluate((id) => globalThis.__shelfPullOut(id), ruler);
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1400);
const rulerCover = await page.locator('.pulled-book').first().boundingBox();
if (rulerCover) {
  await page.mouse.click(
    rulerCover.x + rulerCover.width / 2,
    rulerCover.y + rulerCover.height / 2,
  );
}
await page.waitForSelector('.nb-footnote-rail', { timeout: 60_000 });
await page.waitForTimeout(4000);

const rail = await page.evaluate(() => {
  const el = document.querySelector('.nb-leaf-paper .nb-footnote-rail');
  if (el === null) return { error: 'no rail' };
  const host = el.closest('.nb-page-editor');
  const note = el.querySelector('.nb-footnote-note');
  const cs = getComputedStyle(note);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
  const sample = 'the quick brown fox jumps over a lazy dog and then walks home again';
  const per = ctx.measureText(sample).width / sample.length;
  const prose = host.querySelector('.nb-prose');
  return {
    notes: el.children.length,
    reserved: getComputedStyle(host).getPropertyValue('--nb-footnote-rail').trim(),
    railHeight: Math.round(el.getBoundingClientRect().height),
    entryHeight: Math.round(el.children[0].getBoundingClientRect().height),
    noteWidth: Math.round(note.clientWidth),
    charPx: Number(per.toFixed(2)),
    charsPerLine: Math.round(note.clientWidth / per),
    pageLinePx: Number.parseFloat(getComputedStyle(prose).lineHeight),
  };
});
console.log('');
console.log('  === the rail own cost ===');
console.log(`  ${JSON.stringify(rail)}`);

console.log('');
console.log(`  pictures: ${outDir}/`);
console.log('  errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
