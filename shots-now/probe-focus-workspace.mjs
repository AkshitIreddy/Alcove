/** Silent, headless localhost QA for Focus camera and temporary page writing. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420/?fx=force&qa-silent=1';
const OUT = 'shots-now/out/focus-workspace';
mkdirSync(OUT, { recursive: true });

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
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const report = { ok: false, errors };
let originalCaseId = null;
let fixtureCaseId = null;

async function drawStroke(from, to) {
  const canvas = page.locator('.nb-focus-writing-canvas').first();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('focus writing canvas missing');
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width * to.x,
    box.y + box.height * to.y,
    { steps: 16 },
  );
  await page.mouse.up();
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('nb-tutorial-done', '1');
    localStorage.setItem('appState:tutorialCompleted', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfBookcases !== undefined);
  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA focus workspace ${Date.now()}`);
    await api.switch(made.id);
    return { original, made: made.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForTimeout(1_500);
  fixture.bookId = await page.evaluate(async () => {
    const added = await globalThis.__shelfAddBook(0);
    return added.book.id;
  });
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, fixture.bookId);
  await page.waitForSelector('.nb-book-view .nb-prose[contenteditable="true"]');
  const skipTour = page.getByText('skip the tour', { exact: false }).first();
  if (await skipTour.isVisible().catch(() => false)) {
    await skipTour.click({ force: true });
    await page.locator('.nb-tutorial-overlay').waitFor({ state: 'detached' }).catch(() => {});
  }

  await page.locator('.nb-rail-button[data-tool="focus"]').click();
  const view = page.locator('.nb-book-view');
  await view.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /one page/i }).click();
  const visibleLeaf = page.locator('.nb-flip-leaf-left .nb-leaf-paper');
  const centered = await visibleLeaf.evaluate((leaf) => {
    const box = leaf.getBoundingClientRect();
    return {
      pageCenter: box.left + box.width / 2,
      viewportCenter: innerWidth / 2,
      errorPx: Math.abs(box.left + box.width / 2 - innerWidth / 2),
    };
  });
  report.centered = centered;

  const stage = page.locator('.nb-spread-stage');
  const beforePan = await view.evaluate((node) => getComputedStyle(node).getPropertyValue('--nb-focus-pan-x'));
  await view.dispatchEvent('wheel', { deltaX: 260, deltaY: -180, deltaMode: 0 });
  const afterPlainPan = await view.evaluate((node) => ({
    x: getComputedStyle(node).getPropertyValue('--nb-focus-pan-x'),
    y: getComputedStyle(node).getPropertyValue('--nb-focus-pan-y'),
    zoom: getComputedStyle(node).getPropertyValue('--nb-focus-zoom'),
  }));
  await view.dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, ctrlKey: true });
  const afterCtrlZoom = await view.evaluate((node) => ({
    x: getComputedStyle(node).getPropertyValue('--nb-focus-pan-x'),
    y: getComputedStyle(node).getPropertyValue('--nb-focus-pan-y'),
    zoom: getComputedStyle(node).getPropertyValue('--nb-focus-zoom'),
  }));
  for (let index = 0; index < 10; index += 1) {
    await view.dispatchEvent('wheel', { deltaX: 430, deltaY: 310, deltaMode: 0 });
  }
  const deepPan = await view.evaluate((node) => ({
    x: Number.parseFloat(getComputedStyle(node).getPropertyValue('--nb-focus-pan-x')),
    y: Number.parseFloat(getComputedStyle(node).getPropertyValue('--nb-focus-pan-y')),
  }));
  await page.getByRole('button', { name: /Centre the page and reset zoom/i }).click();
  report.camera = { beforePan, afterPlainPan, afterCtrlZoom, deepPan };

  await page.getByRole('button', { name: 'Write with the mouse' }).click();
  await page.getByRole('button', { name: 'highlighter', exact: true }).click();
  await page.getByRole('button', { name: 'Moss', exact: true }).click();
  await page.getByRole('button', { name: '12 pixel pen' }).click();
  await drawStroke({ x: 0.18, y: 0.28 }, { x: 0.76, y: 0.34 });
  const unsavedPaths = await page.locator('.nb-focus-writing-preview path').count();
  const savedBefore = await page.locator('.nb-page-writing path').count();
  await page.getByRole('button', { name: /Leave focus mode/ }).click();
  const exitBlocked = await view.getAttribute('data-focus-mode');
  await page.getByRole('button', { name: 'Discard unsaved', exact: true }).click();
  const discardedPaths = await page.locator('.nb-focus-writing-preview path').count();
  report.discard = { unsavedPaths, savedBefore, exitBlocked, discardedPaths };

  await page.getByRole('button', { name: 'pen', exact: true }).click();
  await page.getByRole('button', { name: 'Terracotta', exact: true }).click();
  await page.getByRole('button', { name: '7 pixel pen' }).click();
  await drawStroke({ x: 0.2, y: 0.48 }, { x: 0.72, y: 0.6 });
  const beforeUndo = await page.locator('.nb-focus-writing-preview path').count();
  await page.getByRole('button', { name: '↶ Undo', exact: true }).click();
  const afterUndo = await page.locator('.nb-focus-writing-preview path').count();
  await page.getByRole('button', { name: '↷ Redo', exact: true }).click();
  const afterRedo = await page.locator('.nb-focus-writing-preview path').count();
  await page.getByRole('button', { name: 'Save writings to page', exact: true }).click();
  await page.getByText('saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Move around the page' }).click();
  const savedPaths = await page.locator('.nb-page-writing path').count();
  const storedAfterSave = await page.evaluate(async () => {
    const id = document.querySelector('.nb-leaf-paper[data-page-id]')?.getAttribute('data-page-id');
    if (!id) return null;
    const pages = await import('/src/data/pages.ts');
    return (await pages.getPage(id))?.doc.attrs?.mouseWritings ?? null;
  });
  report.history = { beforeUndo, afterUndo, afterRedo, savedPaths, storedAfterSave };
  await page.screenshot({ path: `${OUT}/01-centered-saved-page.png`, caret: 'hide' });

  await page.getByRole('button', { name: 'Write with the mouse' }).click();
  await page.screenshot({ path: `${OUT}/02-writing-tools.png`, caret: 'hide' });
  await page.getByRole('button', { name: /Leave focus mode/ }).click();
  await page.evaluate(async (bookId) => {
    const app = await import('/src/state/app.ts');
    app.appState.closeBook();
    app.appState.clearOpenBook();
    await new Promise((resolve) => setTimeout(resolve, 500));
    app.appState.openBook(bookId);
  }, fixture.bookId);
  await page.waitForSelector('.nb-book-view .nb-page-writing path');
  const reopenedPaths = await page.locator('.nb-page-writing path').count();
  report.reopen = { reopenedPaths };

  await page.waitForTimeout(1_200);
  await page.locator('.nb-rail-button[data-tool="focus"]').click();
  await page.locator('.nb-focus-rail').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /one page/i }).click();
  const reopenedWrite = page.locator('button[aria-label="Write with the mouse"]');
  await reopenedWrite.waitFor({ state: 'visible' });
  await reopenedWrite.click();
  await page.getByRole('button', { name: 'Clear page writing', exact: true }).click();
  const confirmVisible = await page.getByRole('button', { name: 'Press again to clear', exact: true }).count();
  await page.getByRole('button', { name: 'Press again to clear', exact: true }).click();
  await page.getByRole('button', { name: 'Move around the page' }).click();
  const clearedPaths = await page.locator('.nb-page-writing path').count();
  const storedAfterClear = await page.evaluate(async () => {
    const id = document.querySelector('.nb-leaf-paper[data-page-id]')?.getAttribute('data-page-id');
    if (!id) return 'missing-page';
    const pages = await import('/src/data/pages.ts');
    return (await pages.getPage(id))?.doc.attrs?.mouseWritings ?? null;
  });
  report.clear = { confirmVisible, clearedPaths, storedAfterClear };

  report.relevantErrors = errors;
  report.ok =
    centered.errorPx < 3 &&
    beforePan.trim() === '0px' &&
    afterPlainPan.x.trim() !== '0px' &&
    afterPlainPan.y.trim() !== '0px' &&
    afterPlainPan.zoom.trim() === '1' &&
    afterCtrlZoom.zoom.trim() !== '1' &&
    Math.abs(deepPan.x) > 3000 && Math.abs(deepPan.y) > 2500 &&
    unsavedPaths === 1 && savedBefore === 0 && exitBlocked === 'true' && discardedPaths === 0 &&
    beforeUndo === 1 && afterUndo === 0 && afterRedo === 1 && savedPaths === 1 &&
    typeof storedAfterSave === 'string' && storedAfterSave.includes('"version":1') &&
    reopenedPaths === 1 && confirmVisible === 1 && clearedPaths === 0 && storedAfterClear === null &&
    errors.length === 0;
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
