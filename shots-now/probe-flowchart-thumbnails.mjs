/** Silent localhost QA for flowchart page continuations and real thumbnails. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:1420/?fx=force';
const OUT = 'shots-now/out/flowchart-thumbnails';
mkdirSync(OUT, { recursive: true });

const graphLines = ['```flowchart'];
for (let index = 1; index <= 18; index += 1) {
  graphLines.push(
    index === 1
      ? 'Start -> Step 1: begin'
      : `Step ${index - 1} -> Step ${index}: continue`,
  );
}
graphLines.push('Step 18 -> Finish: complete', '```');
const source = [
  '---',
  'title: Flowchart continuation QA',
  'paper: grid',
  '---',
  '',
  '# One complete process across fixed pages',
  '',
  ...graphLines,
].join('\n');

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

const fragments = () =>
  page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-diagram .nb-dg-svg[data-diagram-slice-start]',
  ).evaluateAll((nodes) =>
    nodes.map((node) => ({
      pageId: node.closest('.nb-leaf-paper')?.getAttribute('data-page-id') ?? null,
      start: Number(node.getAttribute('data-diagram-slice-start')),
      end: Number(node.getAttribute('data-diagram-slice-end')),
      full: Number(node.getAttribute('data-diagram-intrinsic-height')),
      label: node.closest('.nb-diagram')?.querySelector('.nb-diagram-kind')?.textContent ?? '',
    })),
  );

const persistedFragments = (bookId) =>
  page.evaluate(async (id) => {
    const pages = await import('/src/data/pages.ts').then((module) => module.listPages(id));
    return pages.flatMap((entry) =>
      (entry.doc.content ?? [])
        .filter((node) => node.type === 'diagram' && typeof node.attrs?.continuationId === 'string')
        .map((node) => ({
          pageId: entry.id,
          start: Number(node.attrs?.continuationStart),
          end: Number(node.attrs?.continuationEnd),
        })),
    );
  }, bookId);

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA flowchart thumbnails ${Date.now()}`);
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
  await dialog.waitFor({ state: 'detached' });

  await page.waitForFunction(
    () => document.querySelectorAll('.nb-leaf-paper:not(.nb-export-sheet) .nb-dg-svg.is-continuation').length >= 2,
  );
  report.fragmentsBeforeMove = await fragments();
  report.persistedBeforeMove = await persistedFragments(fixture.bookId);
  await page.screenshot({ path: `${OUT}/01-flowchart-pages.png`, caret: 'hide' });

  const tail = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-diagram',
  ).last();
  await tail.click({ button: 'right' });
  const move = page.getByText('Move to previous page', { exact: true });
  await move.waitFor({ state: 'visible' });
  await move.click();
  await page.getByText('block moved to the previous page', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('.nb-leaf-paper:not(.nb-export-sheet) .nb-dg-svg.is-continuation').length >= 2,
  );
  report.fragmentsAfterMove = await fragments();
  report.persistedAfterMove = await persistedFragments(fixture.bookId);
  report.moveRejected =
    (await page.getByText(/cannot fit|could not move/i).count()) > 0;

  await page.evaluate(() => globalThis.__shelfSaveSettings({ thumbnailsStrip: true }));
  const strip = page.locator('.nb-thumb-strip');
  await strip.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelectorAll('.nb-thumb-paper[data-thumbnail-state="ready"]').length >= 2,
  );
  report.thumbnails = await strip.locator('canvas').evaluateAll((canvases) =>
    canvases.slice(0, 4).map((canvas) => {
      const context = canvas.getContext('2d');
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      let transitions = 0;
      if (pixels !== undefined) {
        for (let index = 0; index < pixels.length; index += 16) {
          hash ^= pixels[index] ?? 0;
          hash = Math.imul(hash, 16777619);
          if ((pixels[index] ?? 0) !== (pixels[index + 16] ?? 0)) transitions += 1;
        }
      }
      return {
        pageId: canvas.closest('.nb-thumb-paper')?.getAttribute('data-page-id') ?? null,
        state: canvas.closest('.nb-thumb-paper')?.getAttribute('data-thumbnail-state') ?? null,
        hash: hash >>> 0,
        transitions,
      };
    }),
  );
  await page.screenshot({ path: `${OUT}/02-real-page-thumbnails.png`, caret: 'hide' });

  const relevantErrors = pageErrors.filter(
    (message) =>
      !message.includes('features/bookshelf/world.ts') ||
      !message.includes("Cannot read properties of null (reading 'set')"),
  );
  report.relevantErrors = relevantErrors;
  const ranges = [...report.persistedBeforeMove].sort((left, right) => left.start - right.start);
  const contiguous = ranges.length >= 2 && ranges.every((fragment, index) =>
    index === 0
      ? fragment.start === 0
      : Math.abs(fragment.start - ranges[index - 1].end) < 0.01,
  );
  const visibleFull = report.fragmentsBeforeMove[0]?.full;
  const complete = ranges.at(-1)?.end === visibleFull;
  const thumbnailHashes = new Set(report.thumbnails.map((thumbnail) => thumbnail.hash));
  const readyThumbnails = report.thumbnails.filter(
    (thumbnail) => thumbnail.state === 'ready',
  );
  report.ok =
    relevantErrors.length === 0 &&
    contiguous &&
    complete &&
    report.fragmentsBeforeMove.length >= 2 &&
    report.fragmentsAfterMove.length >= 2 &&
    !report.moveRejected &&
    readyThumbnails.length >= 2 &&
    thumbnailHashes.size >= 2 &&
    readyThumbnails.every((thumbnail) => thumbnail.transitions > 20);
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  await page.evaluate(() => globalThis.__shelfSaveSettings?.({ thumbnailsStrip: false })).catch(() => {});
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
