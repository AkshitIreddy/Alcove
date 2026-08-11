/**
 * Real UI smoke test for the two compact context-menu additions in this wave:
 * exact book duplication choices and page insertion/backward block flow.
 * Uses a disposable bookcase and deletes it at the end.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'shots-now/out/page-book-actions';
const URL = 'http://127.0.0.1:1420/?fx=force';
const IMAGE = 'C:/Users/akshi/Desktop/Code Palace/notebook app/assets/brand/alcove-art.png';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

let originalCaseId = null;
let fixtureCaseId = null;
const report = { ok: false };

async function openShelfMenu(bookId) {
  const canvas = page.locator('canvas.shelf-canvas');
  const box = await canvas.boundingBox();
  const rect = await page.evaluate((id) => globalThis.__shelfSpineRect(id), bookId);
  if (!box || !rect) throw new Error('book spine is not visible');
  await page.mouse.click(
    box.x + rect.x + rect.width / 2,
    box.y + rect.y + rect.height / 2,
    { button: 'right' },
  );
  await page.locator('.shelf-menu').waitFor({ state: 'visible' });
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA page and duplicate ${Date.now()}`);
    await api.switch(made.id);
    const added = await globalThis.__shelfAddBook(0);
    return { original, made: made.id, book: added.book };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  const sourceId = fixture.book.id;
  await page.waitForFunction((id) => globalThis.__shelfSpineRect(id) !== null, sourceId);
  await page.evaluate(async (id) => {
    await globalThis.__shelfSaveBinding(id, 'royal-calf');
    await globalThis.__shelfSetBookStyle(id, {
      pigment: 29,
      ornament: 20,
      coverMedallion: 20,
      coverFrame: 48,
      gilt: true,
    });
    await globalThis.__shelfWhenSpinesReady(true);
  }, sourceId);
  report.setupPageErrors = [...pageErrors];
  pageErrors.length = 0;

  await openShelfMenu(sourceId);
  await page.locator('[data-shelf-action="duplicate"]').click();
  await page.getByText('Duplicate book', { exact: true }).waitFor();
  report.duplicateChoices = await page.locator('.shelf-menu__item').allTextContents();
  await page.screenshot({ path: `${OUT}/01-duplicate-choices.png` });
  await page.locator('[data-shelf-action="duplicate-cover"]').click();
  await page.waitForFunction(() => globalThis.__shelfVisibleBooks().length === 2);
  await page.evaluate(() => globalThis.__shelfWhenSpinesReady(true));

  const duplicate = await page.evaluate((id) => {
    const books = globalThis.__shelfVisibleBooks();
    const copy = books.find((book) => book.id !== id);
    return {
      id: copy.id,
      sourceBinding: globalThis.__shelfBinding(id),
      copyBinding: globalThis.__shelfBinding(copy.id),
      sourceStyle: globalThis.__shelfBookStyle(id),
      copyStyle: globalThis.__shelfBookStyle(copy.id),
      sourceMeta: globalThis.__shelfBookMeta(id),
      copyMeta: globalThis.__shelfBookMeta(copy.id),
    };
  }, sourceId);
  report.duplicate = duplicate;

  await page.evaluate((id) => globalThis.__shelfPullOut(id), sourceId);
  await page.locator('.pulled-book.is-held').waitFor({ state: 'visible' });
  await page.locator('.pulled-book.is-held').click();
  await page.locator('.nb-book-view').waitFor({ state: 'visible' });
  const firstBlock = page
    .locator('.nb-sheet-paper[data-side="left"] .ProseMirror > *')
    .first();
  await firstBlock.click({ button: 'right' });
  await page.getByText('Add page before', { exact: true }).waitFor();
  report.pageMenu = await page.locator('.nb-ctx-item').allTextContents();
  await page.screenshot({ path: `${OUT}/02-page-insert-menu.png` });
  await page.getByText('Add page after', { exact: true }).click();
  await page.getByText('page added after', { exact: true }).waitFor();

  const rightEditor = page.locator(
    '.nb-sheet-paper:not(.snapshotting)[data-side="right"] .ProseMirror',
  );
  await rightEditor.click();
  await page.keyboard.type('Pulled backward into the available space.');
  const movedBlock = rightEditor.locator(':scope > *').first();
  await movedBlock.click({ button: 'right' });
  await page.getByText('Move to previous page', { exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/03-backward-flow-menu.png` });
  await page.getByText('Move to previous page', { exact: true }).click();
  await page.getByText('block moved to the previous page', { exact: true }).waitFor();
  await page.waitForTimeout(500);

  report.leftText = await page
    .locator(
      '.nb-sheet-paper:not(.snapshotting)[data-side="left"] .ProseMirror',
    )
    .innerText();
  report.rightText = await rightEditor.innerText();
  await page.screenshot({ path: `${OUT}/04-block-pulled-back.png` });

  // The drag handle used to stop at the gutter because each page is a
  // separate ProseMirror EditorView. Exercise the real HTML5 handle across
  // those two editors as well as the explicit menu action above.
  await rightEditor.click();
  await page.keyboard.type('Dragged across the gutter.');
  const draggedBlock = rightEditor.locator(':scope > *').first();
  await draggedBlock.hover();
  const rightPageId = await page
    .locator('.nb-sheet-paper:not(.snapshotting)[data-side="right"]')
    .getAttribute('data-page-id');
  const handle = page.locator(
    `.nb-drag-handle-layer[data-page="${rightPageId}"] .nb-drag-handle`,
  );
  await handle.waitFor({ state: 'visible' });
  const leftEditor = page.locator(
    '.nb-sheet-paper:not(.snapshotting)[data-side="left"] .ProseMirror',
  );
  const leftBox = await leftEditor.boundingBox();
  if (leftBox === null) throw new Error('left editor has no drop box');
  await handle.dragTo(leftEditor, {
    targetPosition: { x: leftBox.width / 2, y: 110 },
  });
  await page.waitForTimeout(500);
  report.leftTextAfterDrag = await leftEditor.innerText();
  report.rightTextAfterDrag = await rightEditor.innerText();
  await page.screenshot({ path: `${OUT}/05-cross-page-drag.png` });

  // Repeat the same real drag with a persistent image node: this is the block
  // type that exposed the cross-EditorView limitation for the owner.
  await rightEditor.locator(':scope > *').first().click({ button: 'right' });
  await page.getByText('Insert', { exact: true }).hover();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText('Picture from file…', { exact: true }).click(),
  ]);
  await chooser.setFiles(IMAGE);
  await page.getByText('picture added', { exact: true }).waitFor();
  const imageBlock = rightEditor
    .locator(':scope > *')
    .filter({ has: page.locator('img') })
    .first();
  await imageBlock.hover();
  await handle.waitFor({ state: 'visible' });
  await handle.dragTo(leftEditor, {
    targetPosition: { x: leftBox.width / 2, y: 210 },
  });
  await page.waitForTimeout(800);
  report.leftImages = await leftEditor.locator('img').count();
  report.rightImages = await rightEditor.locator('img').count();
  report.movedImage = await leftEditor.locator('img').first().evaluate((image) => ({
    src: image.getAttribute('src'),
    alt: image.getAttribute('alt'),
  }));
  await page.screenshot({ path: `${OUT}/06-cross-page-image-drag.png` });
  report.actionPageErrors = [...pageErrors];
  report.relevantActionPageErrors = report.actionPageErrors.filter(
    (stack) =>
      !stack.includes("world.ts") ||
      !stack.includes("Cannot read properties of null (reading 'set')"),
  ).filter(
    (stack) =>
      !stack.includes('sound/engine.ts') ||
      !stack.includes("Cannot read properties of undefined (reading 'category')"),
  );

  const stripShelf = (value) => {
    if (!value || typeof value !== 'object') return value;
    const clone = structuredClone(value);
    if (clone.shelf) delete clone.shelf;
    return clone;
  };
  report.ok =
    report.relevantActionPageErrors.length === 0 &&
    report.duplicateChoices.some((text) => text.includes('Cover only')) &&
    report.duplicateChoices.some((text) => text.includes('Full book')) &&
    duplicate.sourceBinding === duplicate.copyBinding &&
    JSON.stringify(duplicate.sourceStyle) === JSON.stringify(duplicate.copyStyle) &&
    JSON.stringify(stripShelf(duplicate.sourceMeta)) ===
      JSON.stringify(stripShelf(duplicate.copyMeta)) &&
    report.pageMenu.some((text) => text.includes('Add page before')) &&
    report.pageMenu.some((text) => text.includes('Add page after')) &&
    report.leftText.includes('Pulled backward into the available space.') &&
    !report.rightText.includes('Pulled backward into the available space.') &&
    report.leftTextAfterDrag.includes('Dragged across the gutter.') &&
    !report.rightTextAfterDrag.includes('Dragged across the gutter.') &&
    report.leftImages === 1 &&
    report.rightImages === 0 &&
    typeof report.movedImage?.src === 'string';
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  pageErrors.length = 0;
  if (originalCaseId !== null) {
    await page
      .evaluate((id) => globalThis.__shelfBookcases?.switch(id), originalCaseId)
      .catch(() => {});
  }
  if (fixtureCaseId !== null) {
    await page
      .evaluate((id) => globalThis.__shelfBookcases?.remove(id, true), fixtureCaseId)
      .catch(() => {});
  }
  report.cleanupPageErrors = [...pageErrors];
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
