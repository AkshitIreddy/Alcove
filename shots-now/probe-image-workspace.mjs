/** Silent localhost QA for the fullscreen image workspace and leaf-wide resize. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:1420/?fx=force';
const OUT = 'shots-now/out/image-workspace';
const FIXTURE = 'C:/Users/akshi/Desktop/Code Palace/notebook app/assets/brand/icon-1024.png';
mkdirSync(OUT, { recursive: true });

const source = `---
title: Image workspace QA
paper: grid
---

![Alcove image workspace specimen](){placeholder="upload the square QA image", width=100, align=center, caption="A marked-up study plate"}
`;

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
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
const report = { ok: false, errors };
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
    const made = await api.create(`QA image workspace ${Date.now()}`);
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

  const prose = page.locator('.nb-leaf-paper:not(.nb-export-sheet) .nb-prose[contenteditable="true"]').first();
  await prose.click({ position: { x: 24, y: 24 } });
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const scriptDialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await scriptDialog.locator('textarea').fill(source);
  await scriptDialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await scriptDialog.waitFor({ state: 'detached' });

  const placeholder = page.locator('.nb-image-placeholder').first();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), placeholder.click()]);
  await chooser.setFiles(FIXTURE);
  const image = page.locator('.nb-image-img').first();
  await page.waitForFunction(() => {
    const img = document.querySelector('.nb-image-img');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth === 1024;
  });
  await image.click();
  const handle = page.locator('.nb-image-handle.is-se').first();
  const hb = await handle.boundingBox();
  if (hb === null) throw new Error('resize handle missing');
  await page.mouse.move(hb.x + 5, hb.y + 5);
  await page.mouse.down();
  await page.mouse.move(hb.x + 420, hb.y + 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  report.resize = await image.evaluate((img) => {
    const block = img.closest('.nb-image');
    const leaf = img.closest('.nb-leaf-paper');
    const prose = img.closest('.nb-prose');
    const b = block.getBoundingClientRect();
    const l = leaf.getBoundingClientRect();
    const p = prose.getBoundingClientRect();
    return {
      widthPct: Number.parseFloat(block.style.width),
      centred: Math.abs((b.left + b.width / 2) - (p.left + p.width / 2)) < 40,
      insideLeaf: b.left > l.left + 20 && b.right < l.right - 20,
    };
  });
  await page.locator('.nb-book-view').screenshot({ path: `${OUT}/01-leaf-wide-image.png`, caret: 'hide' });

  await page.getByRole('button', { name: 'View image larger' }).click();
  const viewer = page.getByRole('dialog', { name: /Image viewer/ });
  await viewer.waitFor();
  const stage = viewer.locator('.nb-image-viewer-stage');
  const art = viewer.locator('.nb-image-viewer-art');
  const transform0 = await art.evaluate((node) => node.style.transform);
  await stage.dispatchEvent('wheel', { deltaX: 85, deltaY: -64, deltaMode: 0 });
  const transformPan = await art.evaluate((node) => node.style.transform);
  const zoomBeforePinch = await viewer.locator('.nb-image-viewer-title span').textContent();
  await stage.dispatchEvent('wheel', { deltaX: 0, deltaY: -120, deltaMode: 0, ctrlKey: true });
  const zoomAfterPinch = await viewer.locator('.nb-image-viewer-title span').textContent();
  report.touchpad = { transform0, transformPan, zoomBeforePinch, zoomAfterPinch };

  const sb = await stage.boundingBox();
  if (sb === null) throw new Error('viewer stage missing');
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width + 900, sb.y + sb.height + 700, { steps: 12 });
  await page.mouse.up();
  report.deepPan = await art.evaluate((node) => node.style.transform);
  await viewer.getByRole('button', { name: 'Back to image' }).click();
  report.recentered = await art.evaluate((node) => node.style.transform);

  await viewer.getByRole('button', { name: 'Full screen image workspace' }).click();
  await viewer.getByRole('button', { name: 'Mark up image' }).click();
  await viewer.getByRole('button', { name: 'highlighter brush' }).click();
  await viewer.getByRole('button', { name: 'Moss marker' }).click();
  await viewer.getByRole('button', { name: /Marker size 4/ }).click();
  const ab = await art.boundingBox();
  if (ab === null) throw new Error('image art missing');
  await page.mouse.move(ab.x + ab.width * 0.18, ab.y + ab.height * 0.26);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width * 0.8, ab.y + ab.height * 0.35, { steps: 18 });
  await page.mouse.up();
  await viewer.getByRole('button', { name: 'pen brush' }).click();
  await viewer.getByRole('button', { name: 'Terracotta marker' }).click();
  await viewer.getByRole('button', { name: /Marker size 3/ }).click();
  await page.mouse.move(ab.x + ab.width * 0.35, ab.y + ab.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width * 0.68, ab.y + ab.height * 0.52, { steps: 14 });
  await page.mouse.up();
  const pathsBeforeUndo = await viewer.locator('.nb-image-viewer-annotations path').count();
  await viewer.getByRole('button', { name: 'Undo marker stroke' }).click();
  const pathsAfterUndo = await viewer.locator('.nb-image-viewer-annotations path').count();
  await viewer.getByRole('button', { name: 'Redo marker stroke' }).click();
  const pathsAfterRedo = await viewer.locator('.nb-image-viewer-annotations path').count();
  report.annotations = { pathsBeforeUndo, pathsAfterUndo, pathsAfterRedo };
  report.fullscreen = await viewer.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, className: node.className };
  });
  await page.screenshot({ path: `${OUT}/02-fullscreen-annotation-workspace.png`, caret: 'hide' });

  await viewer.getByRole('button', { name: 'Close image viewer' }).click();
  await image.click();
  report.pageAnnotationPaths = await page.locator('.nb-image-annotations path').count();
  await page.getByRole('button', { name: 'View image larger' }).click();
  const reopened = page.getByRole('dialog', { name: /Image viewer/ });
  await reopened.waitFor();
  report.reopenedAnnotationPaths = await reopened.locator('.nb-image-viewer-annotations path').count();
  await reopened.screenshot({ path: `${OUT}/03-reopened-marks.png`, caret: 'hide' });

  const relevantErrors = errors.filter((message) => !message.includes('features/bookshelf/world.ts'));
  report.relevantErrors = relevantErrors;
  report.ok =
    relevantErrors.length === 0 &&
    report.resize.widthPct > 100 &&
    report.resize.centred &&
    report.resize.insideLeaf &&
    transformPan !== transform0 &&
    zoomBeforePinch !== zoomAfterPinch &&
    /translate3d\([^0]/.test(report.deepPan) &&
    report.recentered.includes('translate3d(0px, 0px') &&
    pathsBeforeUndo === 2 &&
    pathsAfterUndo === 1 &&
    pathsAfterRedo === 2 &&
    report.fullscreen.width === 1500 &&
    report.fullscreen.height === 980 &&
    report.pageAnnotationPaths === 2 &&
    report.reopenedAnnotationPaths === 2;
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
