/**
 * shots-now/transfer-bookcases.mjs — a bundle carries the furniture.
 *
 * The seam this drives is store → bundle → store: a two-case library is built
 * in the running app, exported, rewritten so its case ids look like a stranger's
 * (which is what a bundle from another machine IS), and fed back through the
 * import panel. What is asserted is the APPLIED state — the bookcases the
 * shelf's own store hands back afterwards — not what the manifest merely said.
 *
 * It also photographs the two screens that changed: the parcel counts in the
 * export room, and the "what will happen" list in the import room now that it
 * names the furniture it is about to build.
 *
 * Usage: node shots-now/transfer-bookcases.mjs   (dev server on :1420)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (name, ok, detail) => {
  if (!ok) fails.push(`${name} — ${detail}`);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas.shelf-canvas', { timeout: 45_000 });
await page.waitForFunction(() => '__shelfBookcases' in window, { timeout: 45_000 });
for (let i = 0; i < 4; i += 1) {
  const skip = page.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/* ------------------------ build a two-case library ------------------------ */

await page.evaluate(async () => {
  const cases = window.__shelfBookcases;
  // Start from a known shelf so a re-run does not stack fixtures.
  await window.__shelfEmptyLibrary();
  // Floor 3 and floor 1, not both on the ground: where a book stands is part
  // of what the bundle has to carry, and a fixture that puts everything on
  // floor 0 cannot tell a rebuilt room from a flattened one.
  await window.__shelfSeedBooks(['Cell biology', 'Mitosis'], 3);
  const kitchen = await cases.create('Kitchen');
  await cases.switch(kitchen.id);
  await window.__shelfSeedBooks(['Sourdough'], 1);

  /*
   * `__shelfSeedBooks` dresses the shelf; it writes no pages, and a book with
   * no pages is correctly worth nothing to an export ("0 books · 0 pages").
   * Give every book a page so there is something in the parcel.
   */
  const books = await import('/src/data/books.ts');
  const pages = await import('/src/data/pages.ts');
  for (const book of await books.listBooksByFloorRange(0, 9999)) {
    if ((await pages.listPages(book.id)).length > 0) continue;
    await pages.createPage({
      bookId: book.id,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: book.title }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `Notes on ${book.title}.` }],
          },
        ],
      },
    });
  }
});
await page.waitForTimeout(1200);

const before = await page.evaluate(() =>
  window.__shelfBookcases.list().list.map((c) => c.name),
);
check('two cases stand in the library', before.length >= 2, before.join(', '));

/* ------------------------------ the export room --------------------------- */

await page.evaluate(async () => {
  const mod = await import('/src/features/transfer/index.ts');
  window.__nbTransfer = mod;
  mod.openTransferPanel('export');
});
await page.waitForSelector('.nb-tr-card', { timeout: 30_000 });
await page.waitForTimeout(900);

const parcel = (await page.locator('.nb-tr-parcel-counts').first().textContent()) ?? '';
check(
  'the parcel says how many bookcases travel',
  /\bbookcases\b/.test(parcel),
  `counts line reads “${parcel.trim()}”`,
);
await page.screenshot({ path: `${OUT}/transfer-cases-01-export.png` });

/* ---------------- a bundle that looks like it came from elsewhere --------- */

const bundle64 = await page.evaluate(async () => {
  const lib = await import('/src/features/transfer/library.ts');
  const scope = await import('/src/features/transfer/scope.ts');
  const bundle = await import('/src/features/transfer/bundle.ts');
  const zip = await import('/src/features/transfer/zip.ts');

  const snapshot = await lib.loadLibrarySnapshot();
  // Rewrite every id so nothing here can be matched: this is a bundle from a
  // library this machine has never seen, which is the case that has to BUILD.
  const remap = new Map(
    snapshot.bookcases.map((c, i) => [c.id, `elsewhere-case-${i}`]),
  );
  const shared = {
    bookcases: snapshot.bookcases.map((c) => ({
      ...c,
      id: remap.get(c.id),
      name: `${c.name} of Ada`,
    })),
    books: snapshot.books.map((b) => ({
      ...b,
      id: `elsewhere-${b.id}`,
      title: `${b.title} (Ada)`,
      bookcaseId: remap.get(b.bookcaseId ?? '') ?? null,
    })),
    assets: [],
    theme: null,
  };
  const plan = scope.buildExportPlan(
    shared,
    scope.resolveScopeSelection(shared, { kind: 'library' }),
    scope.DEFAULT_EXPORT_OPTIONS,
  );
  const built = bundle.buildBundleFiles({
    snapshot: shared,
    plan,
    options: scope.DEFAULT_EXPORT_OPTIONS,
    label: 'Notes from Ada',
    createdAt: new Date().toISOString(),
    appVersion: '0.1.0',
  });
  let binary = '';
  for (const byte of zip.zipStore(built.entries)) binary += String.fromCharCode(byte);
  return btoa(binary);
});

/* ------------------------------ the import room --------------------------- */

await page.locator('.nb-tr-rail-button', { hasText: 'Bring in' }).click();
await page.getByRole('button', { name: 'Choose a .nbk bundle' }).click();
await page.locator('input[data-nb-bundle]').waitFor({ state: 'attached' });
await page.setInputFiles('input[data-nb-bundle]', {
  name: 'notes-from-ada.nbk',
  mimeType: 'application/zip',
  buffer: Buffer.from(bundle64, 'base64'),
});
await page.waitForSelector('.nb-tr-plan-item', { timeout: 30_000 });
await page.waitForTimeout(600);

const lede = (await page.locator('.nb-tr-lede').first().textContent()) ?? '';
check(
  'the bundle header counts the bookcases it brings',
  /2 bookcases/.test(lede),
  `lede reads “${lede.trim()}”`,
);

const planLines = (await page.locator('.nb-tr-plan-item').allTextContents()).map((t) =>
  t.trim(),
);
console.log('plan:\n  ' + planLines.join('\n  '));
check(
  'the plan says which bookcases it will build',
  planLines.filter((line) => line.startsWith('Build the bookcase')).length === 2,
  planLines.join(' | '),
);
await page.screenshot({ path: `${OUT}/transfer-cases-02-import-plan.png` });

/* --------------------------------- apply ---------------------------------- */

await page.getByRole('button', { name: 'Add to my library' }).click();
await page.waitForSelector('.nb-tr-done', { timeout: 60_000 });
await page.screenshot({ path: `${OUT}/transfer-cases-03-done.png` });

// The APPLIED state, read from the shelf's own store rather than the manifest.
const after = await page.evaluate(async () => {
  const cases = window.__shelfBookcases.list().list;
  const books = await import('/src/data/books.ts');
  const out = {};
  for (const c of cases) {
    const inside = await books.listBooksInBookcase(c.id);
    out[c.name] = {
      floors: c.floors,
      books: inside.map((b) => b.title).sort(),
      floorOf: Object.fromEntries(inside.map((b) => [b.title, b.floor])),
    };
  }
  return out;
});
console.log('shelves after import:', JSON.stringify(after, null, 2));

const names = Object.keys(after);
check(
  'both foreign cases were built here',
  names.includes('My Library of Ada') && names.includes('Kitchen of Ada'),
  names.join(', '),
);
check(
  'each imported book stands in the case it came from',
  after['Kitchen of Ada']?.books.join() === 'Sourdough (Ada)' &&
    (after['My Library of Ada']?.books.length ?? 0) === 2,
  JSON.stringify(after),
);
check(
  'a rebuilt case puts its books back on the floors they stood on',
  after['My Library of Ada']?.floorOf['Cell biology (Ada)'] === 3 &&
    after['Kitchen of Ada']?.floorOf['Sourdough (Ada)'] === 1,
  JSON.stringify({
    ada: after['My Library of Ada']?.floorOf,
    kitchen: after['Kitchen of Ada']?.floorOf,
  }),
);
check(
  'no imported book waits on the orphan sweep',
  Object.values(after).every((c) => Array.isArray(c.books)) &&
    !names.some((n) => n !== 'Kitchen of Ada' && after[n].books.includes('Sourdough (Ada)')),
  JSON.stringify(after),
);

/* --------------------------- the shelf that was built --------------------- */

// Closing the panel opens the book it just imported, so the way back to the
// shelf is the book's own exit — otherwise this "shelf" shot is a page spread.
await page.evaluate(() => {
  const rail = document.querySelector('.nb-tr-rail-close');
  if (rail instanceof HTMLElement) rail.click();
});
await page.waitForTimeout(900);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForSelector('canvas.shelf-canvas', { timeout: 20_000 });
await page.evaluate(async () => {
  const built = window.__shelfBookcases.list().list.find(
    (c) => c.name === 'Kitchen of Ada',
  );
  if (built !== undefined) await window.__shelfBookcases.switch(built.id);
});
await page.waitForTimeout(1800);
check(
  'the shelf, not a page spread, is what gets photographed',
  (await page.locator('canvas.shelf-canvas').count()) > 0 &&
    (await page.locator('.nb-book-spread, .nb-page').count()) === 0,
  'a book is still open over the shelf',
);
await page.screenshot({ path: `${OUT}/transfer-cases-04-shelf.png` });

await browser.close();

if (fails.length > 0) {
  console.log(`\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
