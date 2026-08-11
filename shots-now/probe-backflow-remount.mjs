/**
 * Reproduce the cross-spread form of “Move to previous page”. The source is
 * the LEFT leaf of spread 1 and the destination is the RIGHT leaf of spread 0,
 * so the action unmounts the source immediately. Turning forward again must
 * not reconstruct the removed block from BookView's page mirror.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:1420/?fx=force';
const OUT = 'shots-now/out/backflow-remount';
const SENTINEL = 'This block must exist on only one page.';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120_000);
const report = { ok: false, sentinel: SENTINEL };
let originalCaseId = null;
let fixtureCaseId = null;

const spreadIndex = () =>
  page.evaluate(() =>
    Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1),
  );
const editor = (side) =>
  page.locator(
    `.nb-sheet-paper:not(.snapshotting)[data-side="${side}"] .ProseMirror[contenteditable="true"]`,
  );

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA backflow remount ${Date.now()}`);
    await api.switch(made.id);
    const added = await globalThis.__shelfAddBook(0);
    return { original, made: made.id, bookId: added.book.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForFunction((id) => globalThis.__shelfSpineRect(id) !== null, fixture.bookId);
  await page.evaluate((id) => globalThis.__shelfPullOut(id), fixture.bookId);
  await page.locator('.pulled-book.is-held').waitFor({ state: 'visible' });
  await page.locator('.pulled-book.is-held').click();
  await page.locator('.nb-book-view').waitFor({ state: 'visible' });

  // Give the prior right leaf content and insert a new page after it. That new
  // page becomes the left leaf of the following spread.
  const priorRight = editor('right');
  await priorRight.click();
  await page.keyboard.type('Destination page.');
  await priorRight.locator(':scope > *').first().click({ button: 'right' });
  await page.getByText('Add page after', { exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') === '1',
  );

  const sourceLeft = editor('left');
  await sourceLeft.click();
  await page.keyboard.type(SENTINEL);
  await sourceLeft.locator(':scope > *').first().click({ button: 'right' });
  await page.getByText('Move to previous page', { exact: true }).click();
  await page.getByText('block moved to the previous page', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') === '0',
  );
  await page.waitForTimeout(550);

  report.destinationText = await editor('right').innerText();
  await page.screenshot({ path: `${OUT}/01-destination-after-move.png` });

  // Remount the old source leaf. This is the step the original same-spread
  // smoke test never exercised.
  const nextLeaf = page.locator('.nb-flip-leaf-right');
  const nextBox = await nextLeaf.boundingBox();
  if (nextBox === null) throw new Error('next-page leaf has no turn surface');
  await page.mouse.click(
    nextBox.x + nextBox.width - 12,
    nextBox.y + nextBox.height * 0.5,
  );
  await page.waitForFunction(
    () => document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') === '1',
  );
  await page.waitForTimeout(550);
  report.sourceTextAfterRemount = await editor('left').innerText();
  report.spread = await spreadIndex();
  await page.screenshot({ path: `${OUT}/02-source-after-remount.png` });

  report.ok =
    report.destinationText.includes(SENTINEL) &&
    !report.sourceTextAfterRemount.includes(SENTINEL);
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
