/** Silent localhost QA for the Notebook Script insertion loading mask. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:1420/?fx=force';
const OUT = 'shots-now/out/insert-loading';
mkdirSync(OUT, { recursive: true });

const paragraphs = Array.from(
  { length: 72 },
  (_, index) =>
    `## Section ${index + 1}: a deliberately long wrapped heading for page layout\n\n` +
    `Insertion paragraph ${index + 1} keeps the pagination path busy while the reader sees a stable loading card.`,
).join('\n\n');
const source = `---\ntitle: Insertion loading QA\npaper: ruled\n---\n\n# A large notebook arrives without a white flash\n\n${paragraphs}\n\nLAST INSERTION MARKER`;

const browser = await chromium.launch({
  headless: true,
  args: [
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
const report = { ok: false, pageErrors };
let originalCaseId = null;
let fixtureCaseId = null;

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA insertion loading ${Date.now()}`);
    await api.switch(made.id);
    const added = await globalThis.__shelfAddBook(0);
    return { original, made: made.id, bookId: added.book.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForTimeout(1_000);
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, fixture.bookId);
  await page.waitForSelector('.nb-book-view .nb-prose[contenteditable="true"]');

  const prose = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-prose[contenteditable="true"]',
  ).first();
  await prose.click({ position: { x: 24, y: 24 } });
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await dialog.locator('textarea').fill(source);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();

  const progress = page.locator('.nb-ins-progress');
  await progress.waitFor({ state: 'visible' });
  report.mask = await page.locator('.nb-ins-overlay.is-inserting').evaluate((overlay) => {
    const card = overlay.querySelector('.nb-ins-card');
    const progressNode = overlay.querySelector('.nb-ins-progress');
    const content = overlay.querySelector('.nb-ins-content');
    const rect = overlay.getBoundingClientRect();
    return {
      rect: rect.toJSON(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overlayBackground: getComputedStyle(overlay).backgroundColor,
      progressBackground:
        progressNode instanceof HTMLElement
          ? getComputedStyle(progressNode).backgroundColor
          : '',
      cardBusy: card?.getAttribute('aria-busy'),
      contentInert: content?.hasAttribute('inert') ?? false,
      topmostAtRail:
        document.elementFromPoint(24, window.innerHeight / 2)?.closest(
          '.nb-ins-overlay.is-inserting',
        ) === overlay,
      phase: progressNode?.getAttribute('data-phase') ?? null,
      statusText: progressNode?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });
  await page.screenshot({ path: `${OUT}/01-insertion-mask.png`, caret: 'hide' });

  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('.nb-book-view')?.textContent?.includes('LAST INSERTION MARKER'),
  );
  report.completed = true;
  await page.screenshot({ path: `${OUT}/02-inserted-book.png`, caret: 'hide' });

  const relevantErrors = pageErrors.filter(
    (message) =>
      !message.includes('features/bookshelf/world.ts') ||
      !message.includes("Cannot read properties of null (reading 'set')"),
  );
  report.relevantErrors = relevantErrors;
  const mask = report.mask;
  report.ok =
    relevantErrors.length === 0 &&
    report.completed &&
    mask.cardBusy === 'true' &&
    mask.contentInert &&
    mask.topmostAtRail &&
    mask.rect.x === 0 &&
    mask.rect.y === 0 &&
    mask.rect.width === mask.viewport.width &&
    mask.rect.height === mask.viewport.height &&
    mask.overlayBackground !== 'rgba(0, 0, 0, 0)' &&
    mask.progressBackground !== 'rgba(0, 0, 0, 0)' &&
    mask.statusText.includes('Notebook Script');
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
