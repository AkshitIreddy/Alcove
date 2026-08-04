/**
 * qa/tmp/_refute-welcome-migration.mjs — does a library that is still holding
 * the v5 tour actually GET the v6 one, in the running app?
 *
 * The claim under test is "appended v5 verbatim to LEGACY_WELCOME_PAGE_SOURCES,
 * bumped SEED_VERSION to 6, the refresh machinery needed no change". The unit
 * test builds that library in a node stub; this builds it in the BROWSER the
 * reader uses — the dev DB persists to localStorage (`notebook.stubdb.v1`), so
 * a v5 install can be planted byte for byte and the app reloaded onto it.
 *
 * The fixture is written through the page's own module (there is no other copy
 * of the v5 text to build it from); every ASSERTION is read off the reloaded
 * app — the leaves it draws and the headings on them, not what was stored.
 *
 * Usage: node qa/tmp/_refute-welcome-migration.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/refute-welcome-mig';
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  page error:', e.message));

const STUB = 'notebook.stubdb.v1';

// ---- 1. let the app seed a library normally, so the blob has a bookcase ----
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await p.waitForFunction(
  (key) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return false;
    const db = JSON.parse(raw);
    return Array.isArray(db.pages) && db.pages.length > 0;
  },
  STUB,
  { timeout: 60_000 },
);

const fresh = await p.evaluate((key) => {
  const db = JSON.parse(localStorage.getItem(key));
  return { books: db.books.length, pages: db.pages.length, settings: db.settings };
}, STUB);
console.log('  fresh install  :', JSON.stringify(fresh));

// ---- 2. rewrite that library into the one a v5 install is holding ----------
const planted = await p.evaluate(async (key) => {
  const seed = await import('/src/data/seed.ts');
  const v5 = seed.LEGACY_WELCOME_PAGE_SOURCES.slice(5);
  const db = JSON.parse(localStorage.getItem(key));
  const welcome = db.books.find((row) => row.title === seed.WELCOME_BOOK_TITLE);
  if (welcome === undefined) return { error: 'no welcome book to downgrade' };

  const now = new Date().toISOString();
  db.pages = db.pages.filter((row) => row.book_id !== welcome.id);
  v5.forEach((source, i) => {
    db.pages.push({
      id: `v5-page-${i}`,
      book_id: welcome.id,
      ord: i,
      doc_json: JSON.stringify(seed.docFromSeededSource(source)),
      script_source: source,
      // Set, on purpose: opening a page saves it, so a real v5 library that
      // has been READ carries this — and the decision must not consult it.
      source_dirty: 1,
      updated_at: now,
    });
  });
  db.settings = (db.settings ?? []).filter((row) => row.key !== 'seedVersion');
  db.settings.push({ key: 'seedVersion', value: '5' });
  localStorage.setItem(key, JSON.stringify(db));
  return { bookId: welcome.id, pages: v5.length, firstHeading: v5[0].split('\n').find((l) => l.startsWith('# ')) };
}, STUB);
console.log('  planted v5     :', JSON.stringify(planted));
if (planted.error) {
  await b.close();
  process.exit(1);
}

// ---- 3. reload onto it and let seedIfEmpty migrate ------------------------
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

// The first-run tour's scrim eats the keypress that opens a book.
for (let i = 0; i < 30; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else {
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await p.waitForTimeout(800);
}

for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await p
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
}
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
await p.waitForTimeout(3000);

const view = p.locator('.nb-book-view');
if ((await view.count()) === 0) {
  console.log('  book view never opened');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

// ---- 4. assert on what is DRAWN --------------------------------------------
const headings = [];
for (let spread = 0; spread < 18; spread += 1) {
  await p.waitForTimeout(1200);
  const read = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.nb-leaf-paper')).map((paper) => ({
      side: paper.getAttribute('data-side') ?? '?',
      heading: (paper.querySelector('.nb-prose h1')?.textContent ?? '').trim().slice(0, 46),
      code: paper.querySelectorAll('.nb-prose pre').length,
      blank: paper.querySelector('.nb-leaf-blank') !== null,
    })),
  );
  if (spread < 2) {
    await view
      .screenshot({ path: `${outDir}/after-spread-${spread + 1}.png`, animations: 'disabled', timeout: 20_000 })
      .catch(async () => p.screenshot({ path: `${outDir}/after-spread-${spread + 1}.png` }));
  }
  for (const leaf of read) headings.push(leaf);
  console.log(`  spread ${spread + 1}: ${read.map((l) => (l.blank ? '—' : `"${l.heading}"`)).join('  ')}`);
  if (read.every((l) => l.blank)) break;
  await p.keyboard.press('ArrowRight');
}

const written = headings.filter((l) => !l.blank && l.heading !== '');
const stored = await p.evaluate((key) => {
  const db = JSON.parse(localStorage.getItem(key));
  const version = (db.settings ?? []).find((r) => r.key === 'seedVersion')?.value;
  return { pages: db.pages.length, version };
}, STUB);

console.log('');
console.log('  leaves drawn with a heading :', written.length);
console.log('  distinct headings           :', new Set(written.map((l) => l.heading)).size);
console.log('  leaves drawing a code fence :', written.filter((l) => l.code > 0).length);
console.log('  stored after migration      :', JSON.stringify(stored));
writeFileSync(`${outDir}/result.json`, JSON.stringify({ fresh, planted, written, stored }, null, 2));

await b.close();
