/**
 * Real browser QA for Book Studio's per-book Surprise undo stack.
 *
 * Runs only against Vite's localStorage-backed browser database in a fresh,
 * headless Chromium context. It never opens or reads the installed app.
 *
 * Usage: node shots-now/probe-book-surprise-history.mjs [--url=http://127.0.0.1:1420]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out/book-surprise-history';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1500, height: 980 },
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

async function persisted(bookId) {
  return page.evaluate((id) => {
    const raw = localStorage.getItem('notebook.stubdb.v1');
    const tables = raw === null ? {} : JSON.parse(raw);
    const book = (tables.books ?? []).find((row) => row.id === id);
    const meta = book?.cover_meta == null ? null : JSON.parse(book.cover_meta);
    const studioRow = (tables.settings ?? []).find((row) => row.key === 'studioDesigns');
    const designs = studioRow?.value == null
      ? { books: {} }
      : JSON.parse(studioRow.value);
    return {
      style: meta?.style ?? null,
      binding: designs.books?.[id] ?? null,
      history: meta?.studio?.surpriseHistory ?? [],
    };
  }, bookId);
}

async function waitForHistory(bookId, count) {
  await page.waitForFunction(({ id, wanted }) => {
    const raw = localStorage.getItem('notebook.stubdb.v1');
    if (raw === null) return false;
    const tables = JSON.parse(raw);
    const book = (tables.books ?? []).find((row) => row.id === id);
    if (book?.cover_meta == null) return false;
    const meta = JSON.parse(book.cover_meta);
    return (meta?.studio?.surpriseHistory?.length ?? 0) === wanted;
  }, { id: bookId, wanted: count }, { polling: 50 });
}

async function waitForAppearance(bookId, expected) {
  await page.waitForFunction(({ id, style, binding }) => {
    const sort = (value) => {
      if (Array.isArray(value)) return value.map(sort);
      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => [key, sort(entry)]),
        );
      }
      return value;
    };
    const raw = localStorage.getItem('notebook.stubdb.v1');
    if (raw === null) return false;
    const tables = JSON.parse(raw);
    const book = (tables.books ?? []).find((row) => row.id === id);
    const meta = book?.cover_meta == null ? null : JSON.parse(book.cover_meta);
    const row = (tables.settings ?? []).find((entry) => entry.key === 'studioDesigns');
    const designs = row?.value == null ? { books: {} } : JSON.parse(row.value);
    const currentBinding = designs.books?.[id] ?? null;
    return JSON.stringify(sort(meta?.style ?? null)) === JSON.stringify(sort(style)) &&
      currentBinding === binding;
  }, {
    id: bookId,
    style: expected.style,
    binding: expected.binding,
  }, { polling: 50 });
}

async function openBook(book) {
  await page.locator('.shelf-root:not(.is-away)').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof globalThis.__shelfPullOut === 'function');
  await page.waitForFunction((id) =>
    globalThis.__shelfVisibleBooks?.().some((candidate) => candidate.id === id), book.id);
  const cover = page.getByRole('button', { name: `Open ${book.title}`, exact: true });
  // Returning from a book removes the DOM overlay before its cover has quite
  // landed. ShelfWorld deliberately refuses another pull during that flight,
  // so retry the reader's next pull rather than baking in a timing delay.
  for (let attempt = 0; attempt < 30 && !(await cover.isVisible().catch(() => false)); attempt += 1) {
    await page.evaluate((id) => globalThis.__shelfPullOut(id), book.id);
    await page.waitForTimeout(500);
  }
  await cover.waitFor({ state: 'visible' });
  await cover.click();
  await page.locator('.nb-book-view').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Customize this book/ }).click();
  await page.locator('.nb-book-studio').waitFor({ state: 'visible' });
}

async function closeStudio() {
  const dialog = page.getByRole('dialog', { name: 'Customize this book', exact: true });
  await dialog.getByRole('button', { name: 'Close Customize this book', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

async function reopenStudio() {
  await page.getByRole('button', { name: /Customize this book/ }).click();
  await page.getByRole('dialog', { name: 'Customize this book', exact: true })
    .waitFor({ state: 'visible' });
}

async function reloadShelf() {
  // A navigation gives this persistence probe a true component/store remount
  // without waiting on the deliberately animated held-cover return flight.
  // The browser fixture remains the same isolated localStorage database.
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof globalThis.__shelfPullOut === 'function');
  await page.locator('.shelf-root:not(.is-away)').waitFor({ state: 'visible' });
}

async function historyButton() {
  return page.getByRole('button', { name: 'Restore previous generated book look', exact: true });
}

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  const tour = page.getByText('skip the tour');
  if (await tour.count()) await tour.first().click().catch(() => {});

  await page.evaluate(async () => {
    localStorage.clear();
    location.reload();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  const afterReloadTour = page.getByText('skip the tour');
  if (await afterReloadTour.count()) await afterReloadTour.first().click().catch(() => {});
  await page.waitForFunction(() => globalThis.__shelfVisibleBooks?.().length > 0, null, { polling: 400 });

  await page.evaluate(() => globalThis.__shelfSeedBooks(['History Alpha', 'History Beta']));
  const fixtures = await page.evaluate(() => globalThis.__shelfVisibleBooks()
    .filter((book) => book.title.startsWith('History ')));
  const alpha = fixtures.find((book) => book.title === 'History Alpha');
  const beta = fixtures.find((book) => book.title === 'History Beta');
  check(alpha !== undefined && beta !== undefined, 'fixture books were not seeded');

  await openBook(alpha);
  const previous = await historyButton();
  check(await previous.isDisabled(), 'Previous look must be disabled before the first Dress');
  check((await previous.innerText()).includes('dress the book to begin a history'),
    'empty-history explanation is missing');
  await page.screenshot({ path: `${out}/01-alpha-disabled.png`, caret: 'hide' });

  const alphaOriginal = await persisted(alpha.id);
  const dress = page.getByRole('button', { name: /dress this book/i });
  await dress.evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  await page.getByText('3 saved looks for this book', { exact: true }).waitFor();
  await waitForHistory(alpha.id, 3);
  const alphaAfterThree = await persisted(alpha.id);
  check(alphaAfterThree.history.length === 3, 'three rapid Dress clicks did not save three looks');
  check(same(alphaAfterThree.history[0].style, alphaOriginal.style),
    'oldest alpha history entry is not the exact pre-Dress style');
  check(alphaAfterThree.history[0].binding === alphaOriginal.binding,
    'oldest alpha history entry is not the exact pre-Dress binding');
  await page.screenshot({ path: `${out}/02-alpha-three-saved.png`, caret: 'hide' });

  // A close/reopen of the same Studio must retain its count immediately.
  await closeStudio();
  await reopenStudio();
  await page.getByText('3 saved looks for this book', { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/03-alpha-panel-reopened.png`, caret: 'hide' });

  // Each undo restores the exact whole appearance at the top of the stack.
  for (let expectedIndex = 2; expectedIndex >= 0; expectedIndex -= 1) {
    const expected = alphaAfterThree.history[expectedIndex];
    await previous.click();
    await waitForHistory(alpha.id, expectedIndex);
    await waitForAppearance(alpha.id, expected);
    const after = await persisted(alpha.id);
    check(same(after.style, expected.style),
      `Previous look ${3 - expectedIndex} did not restore the exact style`);
    check(after.binding === expected.binding,
      `Previous look ${3 - expectedIndex} did not restore the exact binding`);
  }
  check(await previous.isDisabled(), 'Previous look must disable after the stack is exhausted');
  const alphaRestored = await persisted(alpha.id);
  check(same(alphaRestored.style, alphaOriginal.style) && alphaRestored.binding === alphaOriginal.binding,
    'three Previous presses did not return alpha to its original whole appearance');
  await page.screenshot({ path: `${out}/04-alpha-restored.png`, caret: 'hide' });

  // Beta starts empty: history must never leak from alpha.
  await reloadShelf();
  await openBook(beta);
  const betaPrevious = await historyButton();
  check(await betaPrevious.isDisabled(), 'alpha history leaked into beta');
  await page.screenshot({ path: `${out}/05-beta-isolated.png`, caret: 'hide' });

  // Fourteen rapid generations exercise both event ordering and the cap.
  await page.getByRole('button', { name: /dress this book/i }).evaluate((button) => {
    for (let index = 0; index < 14; index += 1) button.click();
  });
  await page.getByText('12 saved looks for this book', { exact: true }).waitFor();
  await waitForHistory(beta.id, 12);
  const betaCapped = await persisted(beta.id);
  check(betaCapped.history.length === 12, 'beta history was not capped at 12');
  await page.screenshot({ path: `${out}/06-beta-cap-12.png`, caret: 'hide' });

  // Force a component remount through the shelf, proving localStorage hydration.
  await reloadShelf();
  await openBook(beta);
  await page.getByText('12 saved looks for this book', { exact: true }).waitFor();
  await page.screenshot({ path: `${out}/07-beta-remounted.png`, caret: 'hide' });
  await reloadShelf();
  await openBook(alpha);
  check(await (await historyButton()).isDisabled(),
    'beta history leaked into alpha after both books remounted');

  const report = {
    ok: true,
    alpha: {
      rapidDressCount: 3,
      exactRestores: 3,
      returnedToOriginal: true,
      historyAfterRestores: 0,
    },
    beta: {
      isolatedInitially: true,
      requestedGenerations: 14,
      persistedHistory: betaCapped.history.length,
      remountCount: 12,
    },
    screenshots: [
      `${out}/01-alpha-disabled.png`,
      `${out}/02-alpha-three-saved.png`,
      `${out}/03-alpha-panel-reopened.png`,
      `${out}/04-alpha-restored.png`,
      `${out}/05-beta-isolated.png`,
      `${out}/06-beta-cap-12.png`,
      `${out}/07-beta-remounted.png`,
    ],
    pageErrors,
    consoleErrors,
  };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}
