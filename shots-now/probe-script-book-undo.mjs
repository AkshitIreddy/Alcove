/** One Ctrl+Z must undo an explicit multi-page Notebook Script insertion. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/out/script-book-undo';
mkdirSync(OUT, { recursive: true });
const source = `# UNDO CHAPTER ONE

The first imported leaf.

::page

# UNDO CHAPTER TWO

The second imported leaf.

::page

# UNDO CHAPTER THREE

The third imported leaf.
`;
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120_000);
const report = { ok: false };
let originalCaseId = null;
let fixtureCaseId = null;

const storedPages = (bookId) =>
  page.evaluate(async (id) => {
    const data = await import('/src/data/pages.ts');
    return (await data.listPages(id)).map((page) => ({
      id: page.id,
      text: JSON.stringify(page.doc),
      source: page.scriptSource,
    }));
  }, bookId);

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA script undo ${Date.now()}`);
    await api.switch(made.id);
    const added = await globalThis.__shelfAddBook(0);
    return { original, made: made.id, bookId: added.book.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForTimeout(1_500);
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, fixture.bookId);
  await page.waitForSelector('.nb-book-view .nb-prose[contenteditable="true"]');

  report.before = await storedPages(fixture.bookId);
  const left = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet)[data-side="left"] .nb-prose[contenteditable="true"]',
  );
  await left.click({ position: { x: 24, y: 24 } });
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await dialog.locator('textarea').fill(source);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('script inserted across 3 pages', { exact: true }).waitFor();
  report.afterInsert = await storedPages(fixture.bookId);
  await page.locator('.nb-book-view').screenshot({
    path: `${OUT}/01-after-multi-page-insert.png`,
    caret: 'hide',
  });

  await page.keyboard.press('Control+z');
  await page.getByText('script insertion undone', { exact: true }).waitFor();
  await page.waitForTimeout(700);
  report.afterUndo = await storedPages(fixture.bookId);
  await page.locator('.nb-book-view').screenshot({
    path: `${OUT}/02-after-one-ctrl-z.png`,
    caret: 'hide',
  });

  const hasSentinel = (rows) => rows.some((row) => row.text.includes('UNDO CHAPTER'));
  report.ok =
    report.afterInsert.length >= report.before.length &&
    hasSentinel(report.afterInsert) &&
    report.afterUndo.length === report.before.length &&
    !hasSentinel(report.afterUndo) &&
    report.afterUndo.every((row) => row.source === null);
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (originalCaseId !== null) {
    await page.evaluate((id) => globalThis.__shelfBookcases?.switch(id), originalCaseId).catch(() => {});
  }
  if (fixtureCaseId !== null) {
    await page.evaluate((id) => globalThis.__shelfBookcases?.remove(id, true), fixtureCaseId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
