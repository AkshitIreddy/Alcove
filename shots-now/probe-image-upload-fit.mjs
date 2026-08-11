/** Real-reader proof that a newly uploaded image fits its page display only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:1420';
const imagePath =
  'C:/Users/akshi/Desktop/Code Palace/notebook app/assets/brand/icon-1024.png';
const out = 'shots-now/out/image-upload-fit';
mkdirSync(out, { recursive: true });

const source = `---
title: Image safety proof
paper: grid
---

# A picture with company

This introduction and the picture belong together on one composed page.

## Full-resolution source, compact page copy

![The Alcove mark](){placeholder="upload the full-resolution Alcove mark", width=100, caption="The original remains available in the large viewer"}

### This content must stay here

- The first nearby idea remains below the picture.
- The second nearby idea must not be pushed onto a spill page.
- Manual resizing remains available afterwards.
`;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
const report = {
  ok: false,
  errors,
  ignoredWorldTeardownErrors: 0,
  before: null,
  after: null,
  viewer: null,
};

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  await page.evaluate(async () => globalThis.__shelfWorld.ready);
  const bookId = await page.evaluate(async () => {
    const made = await globalThis.__shelfAddBook?.(0);
    return made?.book?.id ?? null;
  });
  if (bookId === null) throw new Error('fresh book was not created');
  // Let the shelf's add-book placement tween finish before replacing the
  // world with the reader; this probe is about media, not world teardown.
  await page.waitForTimeout(1_800);
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, bookId);
  await page.waitForSelector('.nb-book-view .nb-prose');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const skip = page.getByText('skip the tour', { exact: false });
    if ((await skip.count()) === 0) break;
    await skip.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
  const left = page.locator(
    '.nb-leaf-paper[data-side="left"]:not(.nb-export-sheet) .nb-prose[contenteditable="true"]',
  );
  await left.click({ position: { x: 28, y: 28 } });
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await dialog.locator('textarea').fill(source);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const placeholder = page.locator('.nb-image-placeholder');
  await placeholder.waitFor();
  report.before = await placeholder.evaluate((node) => {
    const leaf = node.closest('.nb-leaf-paper');
    return {
      pageId: leaf?.getAttribute('data-page-id') ?? null,
      markerOnSamePage: leaf?.textContent?.includes('This content must stay here') ?? false,
      width: node.closest('.nb-image')?.getBoundingClientRect().width ?? 0,
    };
  });
  await page.locator('.nb-book-view').screenshot({
    path: `${out}/01-placeholder.png`,
    caret: 'hide',
  });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    placeholder.click(),
  ]);
  await chooser.setFiles(imagePath);
  const image = page.locator('.nb-image-img').first();
  await page.waitForFunction(() => {
    const img = document.querySelector('.nb-image-img');
    const wrapper = img?.closest('.nb-image');
    return (
      img instanceof HTMLImageElement &&
      img.complete &&
      img.naturalWidth > 0 &&
      wrapper instanceof HTMLElement &&
      Number.parseFloat(wrapper.style.width) < 100
    );
  });
  await page.waitForTimeout(700);
  report.after = await image.evaluate((img) => {
    const wrapper = img.closest('.nb-image');
    const leaf = img.closest('.nb-leaf-paper');
    const rect = img.getBoundingClientRect();
    return {
      pageId: leaf?.getAttribute('data-page-id') ?? null,
      markerOnSamePage: leaf?.textContent?.includes('This content must stay here') ?? false,
      displayWidthPct:
        wrapper instanceof HTMLElement ? Number.parseFloat(wrapper.style.width) : null,
      displayWidthPx: rect.width,
      displayHeightPx: rect.height,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      src: img.getAttribute('src'),
    };
  });
  await page.locator('.nb-book-view').screenshot({
    path: `${out}/02-fitted-page.png`,
    caret: 'hide',
  });

  await image.dblclick();
  const viewer = page.getByRole('dialog', { name: /Image viewer/ });
  await viewer.waitFor();
  report.viewer = await viewer.locator('.nb-image-viewer-image').evaluate((img) => ({
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    src: img.getAttribute('src'),
  }));
  await viewer.screenshot({ path: `${out}/03-full-resolution-viewer.png`, caret: 'hide' });

  const mediaErrors = errors.filter(
    (message) =>
      !message.includes('features/bookshelf/world.ts') ||
      !message.includes("Cannot read properties of null (reading 'set')"),
  );
  report.ignoredWorldTeardownErrors = errors.length - mediaErrors.length;
  report.ok =
    mediaErrors.length === 0 &&
    report.before.pageId === report.after.pageId &&
    report.after.markerOnSamePage === true &&
    report.after.displayWidthPct < 100 &&
    report.after.naturalWidth === 1024 &&
    report.viewer.naturalWidth === report.after.naturalWidth &&
    report.viewer.src === report.after.src;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify({ ...report, report: `${out}/report.json` }, null, 2));
process.exit(report.ok ? 0 : 1);
