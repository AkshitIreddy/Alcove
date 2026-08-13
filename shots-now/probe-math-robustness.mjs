/**
 * Live math seam regression.
 *
 * Pure tests own the parser. This probe owns what only the mounted reader can
 * prove: exact source in a node view, right-click routing, fit invariance under
 * an outer viewport scale, and Backspace carrying the same atom/attrs into the
 * previous page. It creates and deletes its own book.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa/math-robustness';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);

const exactSource = String.raw`\mathop{kittenScore}\limits_{x_1}^{n+1} = \operatorname{argmax}_{k} \frac{p_k}{\sum_{j=1}^{n}p_j}`;
const wideSource = `${exactSource} ${Array.from({ length: 20 }, (_, index) => `+ q_{${index}}`).join(' ')}`;
const malformedSource = String.raw`\left\lceil \frac{a}{\sqrt[3{x}} + \unknown<script>`;
const report = { ok: false, exactSource, wideSource, malformedSource };

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  report.fixture = await page.evaluate(async ({ wideSource, malformedSource }) => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-math-robustness-${Date.now()}`;
    const book = await books.createBook({
      id,
      title: 'QA math robustness',
      floor: 0,
      slot: 49,
      spineSeed: 0x51a7,
    });
    await pages.createPage({
      bookId: book.id,
      ord: 0,
      doc: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Previous page keeps room for the exact equation.' }],
        }],
      },
    });
    await pages.createPage({
      bookId: book.id,
      ord: 1,
      doc: {
        type: 'doc',
        attrs: { pageStyle: 'ruled', lineHeightPx: 32 },
        content: [
          { type: 'math', attrs: { latex: wideSource } },
          { type: 'math', attrs: { latex: malformedSource } },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'The page remains editable after malformed maths.' }],
          },
        ],
      },
    });
    app.appState.openBook(book.id);
    return { bookId: book.id };
  }, { wideSource, malformedSource });

  const formulas = page.locator('.nb-flip-leaf-right .nb-prose [data-type="math"]');
  await formulas.first().waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const rendered = document.querySelector(
      '.nb-flip-leaf-right .nb-prose [data-type="math"] .nb-math-render',
    );
    return rendered instanceof HTMLElement && rendered.dataset.fitScale !== undefined;
  });

  const readMounted = () => page.evaluate(() => {
    const math = document.querySelector(
      '.nb-flip-leaf-right .nb-prose [data-type="math"]',
    );
    const rendered = math?.querySelector('.nb-math-render');
    const prose = math?.closest('.nb-prose');
    if (!(math instanceof HTMLElement) || !(rendered instanceof HTMLElement) || !(prose instanceof HTMLElement)) {
      throw new Error('mounted math seam missing');
    }
    return {
      source: math.dataset.latex,
      fitScale: rendered.dataset.fitScale ?? null,
      mathClientWidth: math.clientWidth,
      proseClientWidth: prose.clientWidth,
      unknownCount: math.querySelectorAll('.nb-m-unknown').length,
      wrapped: rendered.classList.contains('is-wrapped'),
      contentFits: rendered.scrollWidth <= rendered.clientWidth + 1,
      scriptTextLeaked: (math.innerHTML ?? '').includes('<script>'),
    };
  });

  report.large = await readMounted();
  await formulas.first().click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('.nb-ctx-menu').waitFor({ state: 'visible' });
  report.contextMenu = await page.locator('.nb-ctx-menu').isVisible();
  await page.screenshot({ path: `${OUT}/01-context-and-wide-fit.png`, caret: 'hide' });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 960, height: 620 });
  await page.waitForTimeout(500);
  report.small = await readMounted();
  await page.screenshot({ path: `${OUT}/02-small-window.png`, caret: 'hide' });
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.waitForTimeout(500);
  report.restored = await readMounted();

  await formulas.first().click();
  const sourceField = formulas.first().locator('.nb-math-source');
  await sourceField.waitFor({ state: 'visible' });
  report.editingSource = await sourceField.textContent();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');

  await page.waitForFunction(async ({ bookId, wideSource }) => {
    const pages = await import('/src/data/pages.ts');
    const rows = await pages.listPages(bookId);
    const first = rows[0]?.doc.content ?? [];
    const second = rows[1]?.doc.content ?? [];
    return first.some((node) => node.type === 'math' && node.attrs?.latex === wideSource) &&
      !second.some((node) => node.type === 'math' && node.attrs?.latex === wideSource);
  }, { bookId: report.fixture.bookId, wideSource });

  report.persisted = await page.evaluate(async (bookId) => {
    const pages = await import('/src/data/pages.ts');
    return (await pages.listPages(bookId)).slice(0, 2).map(({ ord, doc }) => ({
      ord,
      maths: (doc.content ?? [])
        .filter((node) => node.type === 'math')
        .map((node) => node.attrs?.latex),
    }));
  }, report.fixture.bookId);
  await page.screenshot({ path: `${OUT}/03-exact-source-moved.png`, caret: 'hide' });

  const fitInvariant = [report.large, report.small, report.restored].every((state) =>
    state.source === wideSource &&
    state.fitScale === report.large.fitScale &&
    state.mathClientWidth === report.large.mathClientWidth &&
    state.proseClientWidth === report.large.proseClientWidth
  );
  report.fitInvariant = fitInvariant;
  report.sourceMovedExactly =
    report.editingSource === wideSource &&
    report.persisted[0]?.maths.includes(wideSource) === true &&
    report.persisted[1]?.maths.includes(wideSource) !== true &&
    report.persisted[1]?.maths.includes(malformedSource) === true;
  report.ok =
    report.contextMenu === true &&
    report.large.fitScale !== null &&
    report.large.scriptTextLeaked === false &&
    report.large.wrapped === true &&
    report.large.contentFits === true &&
    report.small.contentFits === true &&
    report.restored.contentFits === true &&
    fitInvariant &&
    report.sourceMovedExactly;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (report.fixture?.bookId) {
    await page.evaluate(async (bookId) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      app.appState.closeBook();
      await books.deleteBook(bookId);
    }, report.fixture.bookId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
