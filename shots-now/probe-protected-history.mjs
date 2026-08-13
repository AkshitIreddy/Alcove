/** Whole-book recovery round-trip plus the real Settings/history surfaces. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa/protected-history';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);
const report = { ok: false };

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('alcove:open-settings')));
  const search = page.locator('.nbs-find input, input[placeholder*="setting" i]').first();
  await search.waitFor({ state: 'visible' });
  await search.fill('protected history');
  const historyRow = page.getByText('protected history', { exact: true }).first();
  await historyRow.waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT}/01-settings-default-on.png`, caret: 'hide' });
  const toggle = page.getByRole('switch', { name: 'protected page and book history' });
  await toggle.click();
  await page.getByText('Stop creating recovery points?').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT}/02-settings-warning.png`, caret: 'hide' });
  await page.getByRole('button', { name: 'keep protection' }).click();
  await page.locator('.nbs-close').click().catch(() => page.keyboard.press('Escape'));
  await page.waitForFunction(() => {
    const scrim = document.querySelector('.nbs-scrim');
    return scrim === null || getComputedStyle(scrim).pointerEvents === 'none' || Number(getComputedStyle(scrim).opacity) < 0.01;
  });

  report.roundTrip = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const history = await import('/src/editor/history/bookHistory.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-protected-history-${Date.now()}`;
    await books.createBook({ id, title: 'QA protected history', floor: 0, slot: 48, spineSeed: 1042 });
    const first = await pages.createPage({ bookId: id, ord: 0, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The first recovery leaf.' }] }] } });
    const second = await pages.createPage({ bookId: id, ord: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The second recovery leaf.' }] }] } });
    history.recordBookCheckpoint(id, [first, second], { force: true, now: Date.now() - 120_000 });
    const before = (await history.listBookCheckpoints(id))[0];
    await pages.deletePage(second.id);
    await pages.savePageDoc(first.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Damaged current state.' }] }] });
    const restored = await history.restoreBookCheckpoint(id, before);
    app.appState.openBook(id);
    return {
      bookId: id,
      pageIds: restored.map((item) => item.id),
      text: JSON.stringify(restored.map((item) => item.doc)),
      checkpointCount: (await history.listBookCheckpoints(id)).length,
    };
  });
  await page.waitForSelector('.nb-rail');
  await page.getByRole('button', { name: 'Page history' }).click();
  await page.getByRole('tab', { name: 'whole book' }).click();
  await page.locator('.nb-history-preview', { hasText: 'whole-book recovery point' }).first().waitFor({ state: 'visible' });
  await page.screenshot({ path: `${OUT}/03-whole-book-history.png`, caret: 'hide' });
  report.ok =
    report.roundTrip.pageIds.length === 2 &&
    report.roundTrip.text.includes('first recovery leaf') &&
    report.roundTrip.text.includes('second recovery leaf') &&
    report.roundTrip.checkpointCount >= 1;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (report.roundTrip?.bookId) {
    await page.evaluate(async (bookId) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      app.appState.closeBook();
      await books.deleteBook(bookId);
    }, report.roundTrip.bookId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
