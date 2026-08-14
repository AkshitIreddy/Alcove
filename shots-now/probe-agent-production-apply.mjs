/**
 * Real-click regression for Agent preview application in a populated book.
 *
 * Normal mode uses `?fx=force&qa=agent-apply`: a provider-free native receipt
 * is prepared, the real panel Insert button is clicked, and BookView's real
 * application/rollback journal must settle once without a Refresh conflict.
 *
 * `--sabotage` deliberately chooses the old all-book demo settling sweep. A
 * 48-page Welcome book makes that path slow and creates unreviewed spill
 * leaves; the same assertions must reject it and print `GATE ALIVE`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const out = resolve('qa/agent-production-apply');
await mkdir(out, { recursive: true });
const suffix = sabotage ? '-sabotage' : '';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

const bookSnapshot = () => page.evaluate(async () => {
  const { appState } = await import('/src/state/app.ts');
  const { listPages } = await import('/src/data/pages.ts');
  const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
  const bookId = appState.openBookId();
  const rows = bookId === null ? [] : await listPages(bookId);
  return {
    bookId,
    revision: await computeNotebookRevision(rows),
    pageIds: rows.map((row) => row.id),
    pages: rows.map((row) => ({
      id: row.id,
      ord: row.ord,
      source: row.scriptSource,
      contentCount: row.doc.content?.length ?? 0,
    })),
  };
});

const uiSnapshot = () => page.evaluate(async ({ sabotage }) => {
  const { appState } = await import('/src/state/app.ts');
  const { listPages } = await import('/src/data/pages.ts');
  const bookId = appState.openBookId();
  const rows = bookId === null ? [] : await listPages(bookId);
  const qa = sabotage
    ? globalThis.__aiAgentDemo?.state()
    : globalThis.__aiAgentApplyQa?.state();
  return {
    at: performance.now(),
    status: sabotage ? qa?.stage ?? null : qa?.status ?? null,
    expectedPageCount: sabotage ? qa?.renderedPages ?? null : qa?.expectedPageCount ?? null,
    approvalCalls: sabotage ? null : qa?.approvalCalls ?? null,
    applyDurationMs: sabotage ? null : qa?.applyDurationMs ?? null,
    error: sabotage ? null : qa?.error ?? null,
    pageCount: rows.length,
    pageIds: rows.map((row) => row.id),
    settling: document.querySelector('.nb-insertion-settling') !== null,
    refreshButtons: [...document.querySelectorAll('button')]
      .filter((button) => /refresh the preview safely/i.test(button.textContent ?? '')).length,
    panelText: document.querySelector('.nb-ai-panel')?.textContent
      ?.replace(/\s+/g, ' ').trim().slice(-420) ?? null,
  };
}, { sabotage });

let report = {
  mode: sabotage ? 'all-book-sweep-sabotage' : 'production-apply',
  target: '',
  before: null,
  after: null,
  observations: [],
  assertions: {},
  consoleErrors,
  pageErrors,
};

try {
  const query = sabotage ? 'fx=force&dev=0' : 'fx=force&qa=agent-apply&dev=0';
  report.target = `${base}/?${query}`;
  await page.goto(report.target, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click({ force: true });
  await page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    const { listBooksByFloorRange } = await import('/src/data/books.ts');
    const books = await listBooksByFloorRange(0, 20);
    const welcome = books.find((book) => /welcome/i.test(book.title)) ?? books[0];
    if (welcome === undefined) throw new Error('No notebook is available for the apply probe.');
    appState.openBook(welcome.id);
  });
  await page.waitForSelector('.nb-prose');
  await page.evaluate(() => document.fonts.ready);
  if (sabotage) {
    await page.waitForFunction(() => typeof globalThis.__aiAgentDemo?.advance === 'function');
    await page.evaluate(async () => {
      await globalThis.__aiAgentDemo.reset('study-notes');
      globalThis.__aiAgentDemo.open();
      await globalThis.__aiAgentDemo.advance('ready');
    });
    await page.waitForFunction(() => globalThis.__aiAgentDemo?.state().stage === 'ready');
  } else {
    await page.waitForFunction(() => typeof globalThis.__aiAgentApplyQa?.prepare === 'function');
    await page.evaluate(async () => {
      await globalThis.__aiAgentApplyQa.prepare();
      globalThis.__aiAgentApplyQa.open();
    });
    await page.waitForFunction(() => globalThis.__aiAgentApplyQa?.state().status === 'ready');
  }
  report.before = await bookSnapshot();
  if (report.before.pageIds.length < 48) {
    throw new Error(`The populated-book gate requires at least 48 pages; found ${report.before.pageIds.length}.`);
  }
  await page.screenshot({ path: resolve(out, `ready${suffix}.png`), fullPage: true });

  const startedAt = Date.now();
  await page.locator('.nb-ai-approve-action').click();
  let lastKey = '';
  let applyingCaptured = false;
  for (;;) {
    const current = await uiSnapshot();
    const key = JSON.stringify([
      current.status,
      current.pageCount,
      current.settling,
      current.refreshButtons,
      current.error,
      current.panelText,
    ]);
    if (key !== lastKey) {
      report.observations.push({ elapsedMs: Date.now() - startedAt, ...current });
      lastKey = key;
    }
    if (!applyingCaptured && (current.status === 'applying' || current.settling)) {
      applyingCaptured = true;
      await page.screenshot({ path: resolve(out, `applying${suffix}.png`), fullPage: true });
    }
    const finished = sabotage
      ? current.status === 'inserted' || (current.status === 'ready' && Date.now() - startedAt > 1_000)
      : current.status === 'applied' || current.status === 'failed';
    if (finished) break;
    if (Date.now() - startedAt > 60_000) break;
    await page.waitForTimeout(100);
  }
  report.after = await bookSnapshot();
  const finalUi = await uiSnapshot();
  const elapsedMs = Date.now() - startedAt;
  await page.screenshot({ path: resolve(out, `finished${suffix}.png`), fullPage: true });
  const beforeIds = new Set(report.before.pageIds);
  const addedIds = report.after.pageIds.filter((id) => !beforeIds.has(id));
  const expected = finalUi.expectedPageCount ?? 0;
  const sawRefresh = report.observations.some((item) => item.refreshButtons > 0);
  const maxSettlingObservation = Math.max(
    0,
    ...report.observations.filter((item) => item.settling).map((item) => item.elapsedMs),
  );
  const cleanupReported = await page.evaluate(async ({ sabotage }) => {
    if (sabotage) {
      await globalThis.__aiAgentDemo.reset('study-notes');
      return true;
    }
    return globalThis.__aiAgentApplyQa.cleanup();
  }, { sabotage });
  await page.waitForFunction(
    async (expectedCount) => {
      const { appState } = await import('/src/state/app.ts');
      const { listPages } = await import('/src/data/pages.ts');
      const bookId = appState.openBookId();
      return bookId !== null && (await listPages(bookId)).length === expectedCount;
    },
    report.before.pageIds.length,
  );
  report.restored = await bookSnapshot();
  await page.screenshot({ path: resolve(out, `restored${suffix}.png`), fullPage: true });
  const cleanupRestored =
    cleanupReported === true &&
    report.restored.revision === report.before.revision &&
    JSON.stringify(report.restored.pageIds) === JSON.stringify(report.before.pageIds);
  report.assertions = {
    populatedBook: report.before.pageIds.length >= 48,
    clickedOnce: sabotage || finalUi.approvalCalls === 1,
    appliedExactlyOnce: sabotage || finalUi.status === 'applied',
    noRefreshConflict: !sawRefresh && finalUi.error == null,
    exactPageDelta: report.after.pageIds.length - report.before.pageIds.length === expected,
    exactNewPageCount: addedIds.length === expected,
    boundedApplyLatency: elapsedMs < 10_000 && maxSettlingObservation < 9_000,
    noPageErrors: pageErrors.length === 0,
    noConsoleErrors: consoleErrors.length === 0,
    cleanupRestored,
  };
  report.metrics = {
    elapsedMs,
    maxSettlingObservation,
    beforePageCount: report.before.pageIds.length,
    afterPageCount: report.after.pageIds.length,
    addedIds,
    expectedPageCount: expected,
    finalStatus: finalUi.status,
    finalError: finalUi.error,
    sawRefresh,
    cleanupReported,
    restoredRevision: report.restored.revision,
    beforeRevision: report.before.revision,
  };
  const passes = Object.values(report.assertions).every(Boolean);
  if (sabotage) {
    const caughtLegacySweep =
      report.assertions.populatedBook &&
      report.assertions.cleanupRestored &&
      (!report.assertions.boundedApplyLatency || !report.assertions.exactPageDelta || !report.assertions.exactNewPageCount);
    report.status = caughtLegacySweep ? 'sabotage-caught' : 'sabotage-inert';
    if (!caughtLegacySweep) throw new Error('GATE INERT: the all-book settling sweep escaped the apply assertions.');
  } else {
    report.status = passes ? 'passed' : 'failed';
    if (!passes) throw new Error(`Production Agent apply gate failed: ${JSON.stringify(report.assertions)}`);
  }
} catch (error) {
  report.status ??= 'failed';
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(out, `report${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context.tracing.stop({ path: resolve(out, `trace${suffix}.zip`) }).catch(() => undefined);
  await browser.close();
}

if (sabotage) {
  const caught = report.status === 'sabotage-caught';
  console.log(caught ? 'GATE ALIVE · legacy all-book settle was rejected' : 'GATE INERT');
  process.exitCode = caught ? 0 : 1;
} else if (report.status === 'passed') {
  console.log(
    `agent production apply: PASS · ${report.metrics.beforePageCount} pages · ` +
    `${Math.round(report.metrics.elapsedMs)} ms · no Refresh loop`,
  );
} else {
  console.error(report.failure ?? 'agent production apply gate failed');
}
