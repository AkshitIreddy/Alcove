/** Exact reader-path QA for image hit areas, resize ceiling, and tall viewer. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:1420/?fx=force';
const OUT = 'shots-now/out/image-block-ux';
const FIXTURE = 'C:/Users/akshi/Desktop/Code Palace/notebook app/shots-now/fixtures/tall-image-qa.svg';
mkdirSync(OUT, { recursive: true });

const source = `---
title: Image block QA
paper: grid
---

# A tall plate with nearby notes

This copy stays above the image.

![Tall study plate](){placeholder="upload the tall QA plate", width=34, align=left, caption="A complete tall study plate"}

## Copy that must remain on this page

- This first line must not be displaced by an over-large manual resize.
- This second line proves the page composition remains intact.
`;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
const report = { ok: false, pageErrors, directMenu: false, laneMenu: false };
let originalCaseId = null;
let fixtureCaseId = null;

const visibleProse = page.locator(
  '.nb-leaf-paper:not(.nb-export-sheet) .nb-prose[contenteditable="true"]',
).first();

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const fixture = await page.evaluate(async () => {
    const api = globalThis.__shelfBookcases;
    const original = api.list().activeId;
    const made = await api.create(`QA image block ${Date.now()}`);
    await api.switch(made.id);
    const added = await globalThis.__shelfAddBook(0);
    return { original, made: made.id, bookId: added.book.id };
  });
  originalCaseId = fixture.original;
  fixtureCaseId = fixture.made;
  await page.waitForTimeout(1_500);
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, fixture.bookId);
  await page.waitForSelector('.nb-book-view .nb-prose[contenteditable="true"]');

  await visibleProse.click({ position: { x: 26, y: 26 } });
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await dialog.locator('textarea').fill(source);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });

  const placeholder = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-image-placeholder',
  ).first();
  await placeholder.waitFor();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), placeholder.click()]);
  await chooser.setFiles(FIXTURE);
  const image = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-image-img',
  ).first();
  await page.waitForFunction(() => {
    const img = document.querySelector(
      '.nb-leaf-paper:not(.nb-export-sheet) .nb-image-img',
    );
    return img instanceof HTMLImageElement && img.complete && img.naturalHeight === 1800;
  });
  await page.waitForTimeout(800);

  const imageBox = await image.boundingBox();
  if (imageBox === null) throw new Error('image has no screen rectangle');
  await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2, {
    button: 'right',
  });
  const menu = page.locator('.nb-ctx-menu');
  await menu.waitFor({ state: 'visible', timeout: 15_000 });
  report.directMenu = true;
  await page.keyboard.press('Escape');

  const lane = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-node-view[data-node-view-root="image"]',
  ).first();
  const laneBox = await lane.boundingBox();
  const freshImageBox = await image.boundingBox();
  if (laneBox === null || freshImageBox === null) throw new Error('image lane has no rectangle');
  const blankX = Math.max(freshImageBox.x + freshImageBox.width + 24, laneBox.x + laneBox.width - 18);
  const laneY = freshImageBox.y + Math.min(freshImageBox.height / 2, laneBox.height - 8);
  report.hitGeometry = { image: freshImageBox, lane: laneBox, blankX, laneY };
  if (blankX <= freshImageBox.x + freshImageBox.width + 2) {
    throw new Error('fixture image left no blank lane to test');
  }
  await page.mouse.click(blankX, laneY, { button: 'right' });
  await menu.waitFor({ state: 'visible', timeout: 15_000 });
  report.laneMenu = true;
  report.laneSelectedImage = await page.locator('.nb-image.is-selected').count();
  await page.locator('.nb-book-view').screenshot({
    path: `${OUT}/01-blank-lane-context-menu.png`,
    caret: 'hide',
  });
  await page.keyboard.press('Escape');

  // Select once more and measure the app-drawn glyphs against their buttons.
  await image.click();
  const tools = page.locator('.nb-image-controls .nb-image-tool');
  await tools.first().waitFor({ state: 'visible' });
  report.toolCentres = await tools.evaluateAll((buttons) =>
    buttons.map((button) => {
      const glyph = button.querySelector('.nb-image-tool-glyph');
      const outer = button.getBoundingClientRect();
      const inner = glyph?.getBoundingClientRect();
      return inner
        ? {
            dx: (inner.left + inner.width / 2) - (outer.left + outer.width / 2),
            dy: (inner.top + inner.height / 2) - (outer.top + outer.height / 2),
          }
        : null;
    }),
  );
  await page.locator('.nb-book-view').screenshot({
    path: `${OUT}/02-centred-image-tools.png`,
    caret: 'hide',
  });

  const wrapper = page.locator(
    '.nb-leaf-paper:not(.nb-export-sheet) .nb-image',
  ).first();
  report.resizeBefore = await wrapper.evaluate((node) => ({
    widthPct: Number.parseFloat(node.style.width),
    pageId: node.closest('.nb-leaf-paper')?.getAttribute('data-page-id') ?? null,
    marker: node.closest('.nb-leaf-paper')?.textContent?.includes('Copy that must remain') ?? false,
  }));
  const handle = page.locator('.nb-image-handle.is-se').first();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error('resize handle is not visible');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 650, handleBox.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  report.resizeAfter = await wrapper.evaluate((node) => ({
    widthPct: Number.parseFloat(node.style.width),
    pageId: node.closest('.nb-leaf-paper')?.getAttribute('data-page-id') ?? null,
    marker: node.closest('.nb-leaf-paper')?.textContent?.includes('Copy that must remain') ?? false,
  }));

  await page.getByRole('button', { name: 'View image larger' }).click();
  const viewer = page.getByRole('dialog', { name: /Image viewer/ });
  await viewer.waitFor();
  report.viewer = await viewer.evaluate((dialog) => {
    const stage = dialog.querySelector('.nb-image-viewer-stage');
    const img = dialog.querySelector('.nb-image-viewer-image');
    if (!(stage instanceof HTMLElement) || !(img instanceof HTMLImageElement)) return null;
    const s = stage.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return {
      stage: s.toJSON(),
      image: i.toJSON(),
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      completeInside:
        i.left >= s.left - 1 && i.right <= s.right + 1 && i.top >= s.top - 1 && i.bottom <= s.bottom + 1,
    };
  });
  await viewer.screenshot({ path: `${OUT}/03-tall-image-complete.png`, caret: 'hide' });

  const relevantErrors = pageErrors.filter(
    (message) =>
      !message.includes('features/bookshelf/world.ts') ||
      !message.includes("Cannot read properties of null (reading 'set')"),
  );
  report.relevantErrors = relevantErrors;
  const centresPass = report.toolCentres.every(
    (value) => value !== null && Math.abs(value.dx) <= 1 && Math.abs(value.dy) <= 1,
  );
  report.ok =
    relevantErrors.length === 0 &&
    report.directMenu &&
    report.laneMenu &&
    report.laneSelectedImage === 1 &&
    centresPass &&
    report.resizeBefore.marker &&
    report.resizeAfter.marker &&
    report.resizeBefore.pageId === report.resizeAfter.pageId &&
    report.resizeAfter.widthPct < 90 &&
    report.viewer?.naturalHeight === 1800 &&
    report.viewer.completeInside;
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
