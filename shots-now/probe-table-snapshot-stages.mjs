/**
 * Locate the Huffman table's snapshot-width drift precisely: live page,
 * Alcove's inert staging clone, html-to-image's computed-style clone, and PNG.
 * Uses a disposable stub database and the existing :1420 server.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SOURCE = readFileSync(
  'C:/Users/akshi/Downloads/huffman-coding-kitten-shelter-notes.md',
  'utf8',
);
const OUT = 'shots-now/out/table-snapshot-stages';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120_000);
await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('nb-tutorial-done', '1');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof globalThis.__shelfAddBook === 'function');
const made = await page.evaluate(() => globalThis.__shelfAddBook(0));
await page.evaluate(async (id) => {
  const app = await import('/src/state/app.ts');
  app.appState.openBook(id);
}, made.book.id);
await page.waitForSelector('.nb-flip-leaf-left .ProseMirror');
await page.locator('.nb-flip-leaf-left .ProseMirror').click({ force: true });
await page.getByRole('button', { name: /In and out/i }).first().click({ force: true });
await page.locator('[data-share="insert"]').dispatchEvent('click');
await page.locator('.nb-ins-card textarea').fill(SOURCE);
await page.getByRole('button', { name: /^Insert$/i }).click({ force: true });
await page.waitForSelector('.nb-flip-leaf-right table');
await page.waitForFunction(() => globalThis.__flipCache?.facesFor?.('next')?.quiet === true);

const result = await page.evaluate(async () => {
  const raster = await import('/src/flip/rasterCache.ts');
  const geometry = await import('/src/flip/snapshotGeometry.ts');
  const chrome = await import('/src/flip/snapshotChrome.ts');
  const cloneModule = await import('/node_modules/html-to-image/es/clone-node.js');
  const fontsModule = await import('/node_modules/html-to-image/es/embed-webfonts.js');
  const imagesModule = await import('/node_modules/html-to-image/es/embed-images.js');
  const styleModule = await import('/node_modules/html-to-image/es/apply-style.js');
  const utilModule = await import('/node_modules/html-to-image/es/util.js');

  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  if (!(sheet instanceof HTMLElement)) throw new Error('right sheet unavailable');

  const describe = (root, label) => {
    const wrapper = root.querySelector('.tableWrapper');
    const table = root.querySelector('table');
    const prose = root.querySelector('.nb-prose');
    if (!(wrapper instanceof HTMLElement) || !(table instanceof HTMLElement) || !(prose instanceof HTMLElement)) {
      throw new Error(`${label}: table structure unavailable`);
    }
    const rootRect = root.getBoundingClientRect();
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: +(rect.left - rootRect.left).toFixed(3),
        top: +(rect.top - rootRect.top).toFixed(3),
        width: +rect.width.toFixed(3),
        height: +rect.height.toFixed(3),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        cssWidth: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        boxSizing: style.boxSizing,
        display: style.display,
        position: style.position,
      };
    };
    return { label, root: box(root), prose: box(prose), wrapper: box(wrapper), table: box(table) };
  };

  const live = describe(sheet, 'live');
  const sourceRect = sheet.getBoundingClientRect();
  const cssWidth = sheet.clientWidth;
  const cssHeight = sheet.clientHeight;
  const blocks = geometry.measureSnapshotBlockGeometry(sheet);
  const lists = geometry.measureSnapshotListRows(sheet);
  const nodeViews = geometry.measureSnapshotNodeViewGeometry(sheet);
  const inlines = geometry.measureSnapshotInlineBoxes(sheet);
  const inert = sheet.cloneNode(true);
  inert.style.setProperty('width', `${cssWidth}px`, 'important');
  inert.style.setProperty('height', `${cssHeight}px`, 'important');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-12000px;top:0;overflow:hidden;width:${cssWidth}px;height:${cssHeight}px`;
  host.append(inert);
  sheet.closest('.nb-spread').append(host);
  const inertBefore = describe(inert, 'inert-before');
  geometry.freezeSnapshotListRows(inert, lists);
  geometry.freezeSnapshotInlineBoxes(inert, inlines);
  geometry.freezeSnapshotNodeViewGeometry(inert, nodeViews);
  geometry.freezeSnapshotBlockGeometry(inert, blocks);
  inert.classList.add(raster.SNAPSHOTTING_CLASS);
  const restoreChrome = chrome.prepareSnapshotTableChrome(inert);
  const inertFrozen = describe(inert, 'inert-frozen');

  const options = {
    pixelRatio: 1,
    backgroundColor: getComputedStyle(inert).backgroundColor,
    fontEmbedCSS: await raster.pageFontEmbedCSS(inert),
    imagePlaceholder: raster.TRANSPARENT_PX,
    filter: raster.snapshotFilter,
    includeStyleProperties: raster.snapshotStyleProperties(),
  };
  const foreignClone = await cloneModule.cloneNode(inert, options, true);
  const foreignHost = document.createElement('div');
  foreignHost.style.cssText = `position:fixed;left:-11000px;top:0;overflow:hidden;width:${cssWidth}px;height:${cssHeight}px`;
  foreignHost.append(foreignClone);
  const foreignMounted = describe(foreignClone, 'html-to-image-clone-mounted');
  await fontsModule.embedWebFonts(foreignClone, options);
  await imagesModule.embedImages(foreignClone, options);
  styleModule.applyStyle(foreignClone, options);
  const foreignStyled = describe(foreignClone, 'html-to-image-clone-styled');
  const dataUrl = await utilModule.nodeToDataURL(foreignClone, sourceRect.width, sourceRect.height);

  restoreChrome();
  host.remove();
  foreignHost.remove();
  return { live, inertBefore, inertFrozen, foreignMounted, foreignStyled, dataUrl };
});

writeFileSync(`${OUT}/stages.json`, `${JSON.stringify({ ...result, dataUrl: undefined }, null, 2)}\n`);
writeFileSync(`${OUT}/foreign-object.svg`, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
const cachedDataUrl = await page.evaluate(async () => {
  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  const pageId = sheet?.dataset.pageId ?? sheet?.closest('[data-page-id]')?.dataset.pageId;
  return pageId === undefined ? null : globalThis.__flipCache?.bitmapPng?.(pageId) ?? null;
});
if (typeof cachedDataUrl === 'string') {
  writeFileSync(`${OUT}/cached.png`, Buffer.from(cachedDataUrl.split(',')[1], 'base64'));
}
await page.locator('.nb-flip-leaf-right .nb-sheet-paper').screenshot({ path: `${OUT}/live.png` });
console.log(JSON.stringify({
  live: result.live.table,
  inertBefore: result.inertBefore.table,
  inertFrozen: result.inertFrozen.table,
  foreignMounted: result.foreignMounted.table,
  foreignStyled: result.foreignStyled.table,
}, null, 2));
await browser.close();
