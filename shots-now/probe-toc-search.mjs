/**
 * Live regression for the open-book table-of-contents search.
 *
 * Creates and removes its own small book. The pure row tests own matching;
 * this owns the rendered seam: visible search chrome, honest live counts,
 * empty state, Escape clearing before the panel closes, page aliases, and
 * keyboard navigation still reaching the real spread.
 *
 *   node shots-now/probe-toc-search.mjs
 *   node shots-now/probe-toc-search.mjs --sabotage
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'qa/toc-search');
const sabotage = process.argv.includes('--sabotage');
const urlArg = process.argv.find((value) => value.startsWith('--url='));
const base = urlArg?.slice('--url='.length) || 'http://127.0.0.1:1420';
const reportPath = resolve(OUT, sabotage ? 'report-sabotage.json' : 'report.json');
const report = {
  probeVersion: 1,
  generatedAt: new Date().toISOString(),
  sabotage,
  target: `${base}/?fx=force&dev=0`,
  status: 'running',
  screenshots: [],
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

let bookId = null;
const shot = async (name) => {
  const path = resolve(OUT, `${name}.png`);
  await page.getByRole('dialog', { name: 'Table of contents' }).screenshot({
    path,
    animations: 'disabled',
    caret: 'hide',
  });
  report.screenshots.push(path);
};

try {
  await page.goto(report.target, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.evaluate(() => {
    localStorage.setItem('nb-tutorial-done', '1');
  });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  bookId = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-toc-search-${Date.now()}`;
    const book = await books.createBook({
      id,
      title: 'QA table of contents search',
      floor: 0,
      slot: 48,
      spineSeed: 0x70c5,
    });
    const heading = (text, level) => ({
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text }],
    });
    const paragraph = (text = '') => ({
      type: 'paragraph',
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    });
    const docs = [
      [heading('Garden Almanac', 1), paragraph('A small growing guide.')],
      [heading('Résumé of naïve seedlings', 2), paragraph('What survived the first week.')],
      [heading('Watering rhythms', 2), paragraph('Morning and evening patterns.')],
      [paragraph('This leaf continues the watering notes.')],
      [heading('Autumn checklist', 2), paragraph('Jobs for the fifth page.')],
      [paragraph()],
    ];
    for (const [ord, content] of docs.entries()) {
      await pages.createPage({
        bookId: book.id,
        ord,
        doc: { type: 'doc', content },
      });
    }
    app.appState.openBook(book.id);
    return book.id;
  });

  await page.waitForSelector('.nb-book-view .nb-prose');
  const tocButton = page.locator('.nb-rail-button[data-tool="toc"]');
  await tocButton.click();
  const dialog = page.getByRole('dialog', { name: 'Table of contents' });
  await dialog.waitFor({ state: 'visible' });
  const search = dialog.getByRole('searchbox', { name: 'Search this table of contents' });
  const rows = dialog.locator('.nb-toc-row');

  const baseline = {
    rowCount: await rows.count(),
    status: await dialog.locator('.nb-toc-search-meta').innerText(),
    placeholder: await search.getAttribute('placeholder'),
  };
  await shot('01-full-contents');

  await search.fill('RESUME naive');
  await page.waitForFunction(() => document.querySelectorAll('.nb-toc-row').length === 1);
  const accentSearch = {
    rowCount: await rows.count(),
    text: await rows.first().locator('.nb-toc-text').innerText(),
    status: await dialog.locator('.nb-toc-search-meta').innerText(),
  };
  if (sabotage) {
    await page.evaluate(() => {
      const row = document.querySelector('.nb-toc-row');
      if (!(row instanceof HTMLElement)) throw new Error('No TOC row to sabotage.');
      const duplicate = row.cloneNode(true);
      if (duplicate instanceof HTMLElement) duplicate.dataset.probeSabotage = 'duplicate-result';
      row.parentElement?.append(duplicate);
    });
  }
  const renderedAccentRowCount = await rows.count();
  await shot('02-accent-search');
  if (sabotage) {
    await page.locator('[data-probe-sabotage="duplicate-result"]').evaluate((element) => element.remove());
  }

  await search.press('Escape');
  const escape = {
    value: await search.inputValue(),
    dialogVisible: await dialog.isVisible(),
    rowCount: await rows.count(),
  };

  await search.fill('constellation');
  await dialog.locator('.nb-toc-empty').waitFor({ state: 'visible' });
  const empty = {
    rowCount: await rows.count(),
    status: await dialog.locator('.nb-toc-search-meta').innerText(),
    message: await dialog.locator('.nb-toc-empty').innerText(),
  };
  await shot('03-empty-search');
  await dialog.getByRole('button', { name: 'Clear table of contents search' }).click();

  await search.fill('page 5');
  await page.waitForFunction(() => document.querySelectorAll('.nb-toc-row').length === 1);
  const pageAlias = {
    page: await rows.first().locator('.nb-toc-page').innerText(),
    text: await rows.first().locator('.nb-toc-text').innerText(),
  };
  await search.press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('.nb-rail-panel[aria-label="Table of contents"]')?.getAttribute('aria-hidden') === 'true'
  );
  await page.waitForFunction(() =>
    document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') === '2'
  );
  const enterSpread = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');

  await tocButton.click();
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Clear table of contents search' }).click();
  await search.fill('watering');
  await search.press('ArrowDown');
  const focusedText = await page.evaluate(() =>
    document.activeElement?.querySelector('.nb-toc-text')?.textContent?.trim() ?? null
  );
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') === '1'
  );
  const arrowSpread = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');

  const checks = {
    completeRows: baseline.rowCount === 5 && /5 entries in this book/i.test(baseline.status),
    searchAffordance: baseline.placeholder === 'find a section or page…',
    accentInsensitive:
      accentSearch.rowCount === 1 &&
      renderedAccentRowCount === 1 &&
      accentSearch.text === 'Résumé of naïve seedlings' &&
      /1 match in 5/i.test(accentSearch.status),
    escapeClearsBeforeClose:
      escape.value === '' && escape.dialogVisible && escape.rowCount === 5,
    usefulEmptyState:
      empty.rowCount === 0 &&
      /0 matches in 5/i.test(empty.status) &&
      /shorter title or a page number/i.test(empty.message),
    pageAliasNavigates:
      pageAlias.page === 'p.5' && pageAlias.text === 'Autumn checklist' && enterSpread === '2',
    arrowKeyboardNavigates:
      focusedText === 'Watering rhythms' && arrowSpread === '1',
    noPageErrors: pageErrors.length === 0,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const sabotageCaught = sabotage &&
    failures.length === 1 &&
    failures[0] === 'accentInsensitive';

  Object.assign(report, {
    baseline,
    accentSearch,
    renderedAccentRowCount,
    escape,
    empty,
    pageAlias,
    enterSpread,
    focusedText,
    arrowSpread,
    pageErrors,
    checks,
  });

  if (sabotage) {
    report.status = sabotageCaught ? 'sabotage-caught' : 'sabotage-invalid';
    if (!sabotageCaught) {
      throw new Error(failures.length === 0
        ? 'GATE INERT: a duplicate rendered result passed every assertion.'
        : `Sabotage run had unrelated failures: ${failures.join(', ')}.`);
    }
  } else {
    report.ok = failures.length === 0;
    report.status = report.ok ? 'passed' : 'failed';
    if (!report.ok) throw new Error(`TOC search checks failed: ${failures.join(', ')}.`);
  }
} catch (error) {
  report.status = report.status === 'sabotage-invalid' ? report.status : 'failed';
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  if (bookId !== null) {
    await page.evaluate(async (id) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      app.appState.closeBook();
      app.appState.clearOpenBook();
      await books.deleteBook(id);
    }, bookId).catch((error) => {
      report.cleanupError = error instanceof Error ? error.message : String(error);
    });
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (sabotage) console.log(report.status === 'sabotage-caught' ? 'GATE ALIVE' : 'GATE INERT');
process.exitCode = sabotage
  ? report.status === 'sabotage-caught' ? 0 : 1
  : report.ok === true ? 0 : 1;
