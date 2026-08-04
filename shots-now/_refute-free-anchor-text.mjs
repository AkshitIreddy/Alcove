/**
 * shots-now/_refute-free-anchor-text.mjs — does the ANCHOR damage the block it
 * is anchored in?
 *
 * A free mark is an inline atom inserted at the head of the page's first block.
 * `_refute-free-pagination.mjs` saw that block's first forty characters go from
 * "Welcome to Alcove ✎This is your library." to "Welcome to Alcov0 — the quick"
 * across a run — three characters short of the title it started with. Either
 * the title lost them, or the atom occupies text-node space and the reading was
 * an artefact of concatenating two blocks. This asks the block itself.
 *
 * Usage: node shots-now/_refute-free-anchor-text.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const openBook = async (fresh) => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  for (let i = 0; i < 4; i += 1) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await wait(700);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await page.locator('.nb-rail').count()) > 0) break;
    await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      if (books[0]) globalThis.__shelfPullOut?.(books[0].id);
    });
    await wait(2200);
    await page.keyboard.press('Enter').catch(() => {});
    await wait(2500);
    if ((await page.locator('.nb-rail').count()) > 0) break;
    await page.locator('.nb-pulled-book, .nb-book-cover').first().click({ force: true, timeout: 4000 }).catch(() => {});
    await wait(2500);
  }
  await page.waitForSelector('.nb-rail', { timeout: 60000 });
  await page.waitForSelector('.nb-prose p', { timeout: 60000 });
  await wait(1800);
};

/** The first block of the left leaf, exactly as it reads. */
const firstBlock = async () =>
  page.evaluate(() => {
    const el = document.querySelector('.nb-leaf-paper[data-side="left"] .nb-prose')?.firstElementChild;
    return {
      tag: el?.tagName.toLowerCase() ?? '(none)',
      text: el?.textContent ?? '',
      html: (el?.innerHTML ?? '').slice(0, 200),
    };
  });

console.log('\n1. open the book');
await openBook(true);
const before = await firstBlock();
console.log(`  <${before.tag}> ${JSON.stringify(before.text)}`);
console.log(`  html: ${before.html}`);

console.log('\n2. put a mark on page 1 through the catalogue, the way a reader does');
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
await page.waitForSelector('.nb-cat-search-input', { state: 'visible', timeout: 30000 });
await wait(700);
await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
await wait(800);
const chip = page.locator('.nb-cat-shelf[data-shelf="trim"] .nb-cat-mode .nb-chip[data-mode="free"]');
if ((await chip.getAttribute('aria-pressed')) !== 'true') {
  await chip.click();
  await wait(500);
}
await page.locator('.nb-cat-search-input').fill('gaffer');
await wait(600);
await page.locator('.nb-cat-item[data-entry="fx-tape-gaffer"]').first().click();
await wait(500);
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
await page.waitForSelector('.nb-cat-search-input', { state: 'hidden', timeout: 30000 });
await wait(700);
const at = await page.evaluate(() => {
  const box = document.querySelector('.nb-leaf-paper[data-side="left"] .nb-free-layer').getBoundingClientRect();
  return { x: box.left + box.width * 0.62, y: box.top + box.height * 0.8 };
});
await page.mouse.click(at.x, at.y);
await wait(1200);

const after = await firstBlock();
console.log(`  <${after.tag}> ${JSON.stringify(after.text)}`);
console.log(`  html: ${after.html}`);
check('a mark really landed', (await page.locator('.nb-free-layer .nb-free-mark').count()) > 0);
check(
  'the block the mark is anchored in still reads exactly as it did',
  after.text === before.text,
  `${JSON.stringify(before.text)} -> ${JSON.stringify(after.text)}`,
);

console.log('\n3. reload and ask again');
await wait(2500);
await openBook(false);
const round = await firstBlock();
console.log(`  <${round.tag}> ${JSON.stringify(round.text)}`);
check(
  'and still after a reload',
  round.text === before.text,
  `${JSON.stringify(before.text)} -> ${JSON.stringify(round.text)}`,
);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
