/**
 * scripts/probe-catalogue.mjs — the catalogue, driven as a reader drives it.
 *
 * Opens a book, opens the catalogue from the rail, browses a shelf, searches,
 * inserts one of the new pieces of stationery and applies a lettering trim —
 * screenshotting the page each time, because "the attribute is set" is not the
 * same claim as "it looks like an index card".
 *
 * Usage: node scripts/probe-catalogue.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(120000);

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png`, animations: 'disabled', caret: 'hide' });
  console.log(`  shot qa/ui/${name}.png`);
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });

const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  console.log('  dismissed the tour');
}
await page.waitForTimeout(1200);

console.log('\n1. open a book and put the caret on a paragraph');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForSelector('.nb-prose p', { timeout: 60000 });
await page.waitForTimeout(1200);
// Land the caret at the end of the page so an insert has room. Done through
// the editor rather than by clicking a coordinate: once the page has a stamp
// and an envelope on it, "somewhere in the middle" is not reliably clickable.
const caretToEnd = async () => {
  await page.evaluate(async () => {
    const { activeEditor } = await import('/src/editor/insert/activeEditor.ts');
    const ed = activeEditor();
    if (!ed) return;
    // A FRESH top-level paragraph each time: `wrapIn` wraps the block the
    // caret is in, so landing inside the piece just inserted would nest the
    // next one inside it rather than beside it.
    ed.commands.insertContentAt(ed.state.doc.content.size, { type: 'paragraph' });
    ed.commands.focus('end');
  });
  await page.waitForTimeout(250);
};
await caretToEnd();

console.log('\n2. open the catalogue from the rail');
console.log(
  '  rail label:',
  await page.locator('.nb-rail-button[data-tool="catalogue"]').getAttribute('aria-label'),
);
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
await page.waitForSelector('.nb-catalogue', { timeout: 30000 });
await page.waitForTimeout(900);
const shelves = await page.locator('.nb-cat-shelf .nb-panel-section-title').allTextContents();
console.log('  shelves:', shelves.map((s) => s.split('\n')[0].trim()).join(' | '));
console.log('  entries:', await page.locator('.nb-cat-item').count());
await shot('catalogue-01-open');

console.log('\n3. browse one shelf');
await page.getByRole('button', { name: 'lettering', exact: true }).click();
await page.waitForTimeout(600);
console.log('  lettering entries:', await page.locator('.nb-cat-item').count());
await shot('catalogue-02-lettering');

console.log('\n4. search');
await page.getByRole('button', { name: 'everything', exact: true }).click();
await page.locator('.nb-cat-search-input').fill('tape');
await page.waitForTimeout(600);
console.log(
  '  hits:',
  (await page.locator('.nb-cat-label').allTextContents()).join(', '),
);
await shot('catalogue-03-search');
await page.locator('.nb-cat-search-input').fill('');
await page.waitForTimeout(400);

console.log('\n5. insert the new stationery');
for (const name of ['Index card', 'Envelope', 'Stamp', 'Tag', 'Margin note']) {
  await caretToEnd();
  const tile = page
    .locator('.nb-cat-item')
    .filter({ has: page.locator('.nb-cat-label', { hasText: new RegExp(`^${name}$`) }) });
  if ((await tile.count()) === 0) {
    console.log(`  !! no tile for ${name}`);
    continue;
  }
  await tile.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await tile.first().click();
  await page.waitForTimeout(700);
  await page.keyboard.type(`a ${name.toLowerCase()}`);
  await page.waitForTimeout(300);
}
// Counted from the SAVED pages, not from the DOM: only the open spread is
// mounted, so a piece that paginated onto an earlier page would otherwise
// report as "never inserted".
const present = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const pages = await import('/src/data/pages.ts');
  const bookId = app.appState.openBookId();
  const wanted = ['index-card', 'envelope', 'stamp', 'tag', 'marginalia'];
  const counts = Object.fromEntries(wanted.map((t) => [t, 0]));
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return;
    if (typeof node.type === 'string' && node.type in counts) counts[node.type] += 1;
    for (const child of node.content ?? []) walk(child);
  };
  for (const p of await pages.listPages(bookId)) walk(p.doc);
  return wanted.map((t) => ({ type: t, n: counts[t] }));
});
console.log('  in the document:', JSON.stringify(present));
await page.waitForTimeout(600);
await shot('catalogue-04-stationery');
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/ui/catalogue-04b-page.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/ui/catalogue-04b-page.png');

console.log('\n6. a lettering trim on the block under the caret');
await page.locator('.nb-cat-search-input').fill('marker pen');
await page.waitForTimeout(500);
await page.locator('.nb-cat-item').first().click();
await page.waitForTimeout(600);
console.log(
  '  data-font blocks:',
  await page.evaluate(() => document.querySelectorAll('.nb-prose [data-font]').length),
);
await page.locator('.nb-cat-search-input').fill('');
await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
await page.waitForTimeout(700);
await shot('catalogue-05-trim');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
