/** Live two-page proof that Ctrl+Z reverses both authored text and its reflow. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'qa/pagination-undo';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);
const report = { ok: false };
const paragraph = (text) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('appState:tutorialCompleted', '1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  await page.evaluate(async () => globalThis.__shelfWorld.ready);
  report.fixture = await page.evaluate(async ({ source, target }) => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-pagination-undo-${Date.now()}`;
    await books.createBook({ id, title: 'Pagination undo QA', floor: 0, slot: 46 });
    const left = await pages.createPage({
      bookId: id,
      ord: 0,
      doc: { type: 'doc', attrs: { pageStyle: 'ruled', lineHeightPx: 32 }, content: source },
    });
    const right = await pages.createPage({
      bookId: id,
      ord: 1,
      doc: { type: 'doc', attrs: { pageStyle: 'ruled', lineHeightPx: 32 }, content: target },
    });
    app.appState.openBook(id);
    return { bookId: id, leftId: left.id, rightId: right.id };
  }, {
    source: Array.from({ length: 20 }, (_, index) => paragraph(`Source line ${index + 1}`)),
    target: [paragraph('Original next-page block')],
  });
  await page.locator('.nb-flip-leaf-left .nb-prose').waitFor();
  const skipTour = page.getByText('skip the tour', { exact: true });
  if (await skipTour.isVisible().catch(() => false)) {
    await skipTour.click();
  }
  await page.waitForTimeout(500);
  report.before = await page.evaluate(async ({ bookId }) => {
    const pages = await import('/src/data/pages.ts');
    return pages.listPages(bookId);
  }, report.fixture);

  await page.evaluate(async ({ leftId }) => {
    const instances = await import('/src/editor/instances.ts');
    const editor = instances.getPageEditor(leftId);
    if (!editor) throw new Error('source editor missing');
    editor.commands.focus('start');
    const inserted = editor.commands.insertContentAt(0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'One newly added line' }],
    });
    if (!inserted) throw new Error('authored insertion rejected');
  }, report.fixture);
  await page.waitForFunction(async ({ bookId, leftId }) => {
    const pages = await import('/src/data/pages.ts');
    const all = await pages.listPages(bookId);
    const left = all.find((item) => item.id === leftId);
    const serialized = JSON.stringify(all.map((item) => item.doc));
    return serialized.includes('One newly added line') &&
      !JSON.stringify(left?.doc).includes('Source line 20') &&
      serialized.includes('Source line 20');
  }, report.fixture);
  report.afterEdit = await page.evaluate(async ({ bookId }) => {
    const pages = await import('/src/data/pages.ts');
    return pages.listPages(bookId);
  }, report.fixture);
  await page.keyboard.press('Control+z');
  await page.waitForFunction(async ({ bookId, before }) => {
    const pages = await import('/src/data/pages.ts');
    const current = await pages.listPages(bookId);
    return JSON.stringify(current.map((item) => item.doc)) ===
      JSON.stringify(before.map((item) => item.doc));
  }, { bookId: report.fixture.bookId, before: report.before });
  report.afterUndo = await page.evaluate(async ({ bookId }) => {
    const pages = await import('/src/data/pages.ts');
    return pages.listPages(bookId);
  }, report.fixture);
  report.exactRestore =
    JSON.stringify(report.afterUndo.map((item) => item.doc)) ===
    JSON.stringify(report.before.map((item) => item.doc));
  report.pageCountStable = report.afterUndo.length === report.before.length;
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction(async ({ bookId, leftId }) => {
    const pages = await import('/src/data/pages.ts');
    const all = await pages.listPages(bookId);
    const left = all.find((item) => item.id === leftId);
    return JSON.stringify(all.map((item) => item.doc)).includes('One newly added line') &&
      !JSON.stringify(left?.doc).includes('Source line 20');
  }, report.fixture);
  report.redoReflowed = true;
  await page.keyboard.press('Control+z');
  await page.waitForFunction(async ({ bookId, before }) => {
    const pages = await import('/src/data/pages.ts');
    const current = await pages.listPages(bookId);
    return JSON.stringify(current.map((item) => item.doc)) ===
      JSON.stringify(before.map((item) => item.doc));
  }, { bookId: report.fixture.bookId, before: report.before });
  report.secondUndoExact = true;
  await page.screenshot({ path: `${out}/after-undo.png`, caret: 'hide' });
  report.ok = report.exactRestore && report.pageCountStable &&
    report.redoReflowed && report.secondUndoExact;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
