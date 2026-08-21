/**
 * Post-turn image handoff regression.
 *
 * The destination owns two image pages. After their curl snapshots are warm,
 * live-image decode is deliberately stretched beyond the retired 96ms cap.
 * The gate passes only if the complete raster scene remains the visible owner
 * until both destination images finish decoding.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out/flip-image-handoff';
mkdirSync(out, { recursive: true });
const svg = readFileSync('shots-now/fixtures/tall-image-qa.svg');
const imageSrc = `data:image/svg+xml;base64,${svg.toString('base64')}`;

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

try {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  });
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof globalThis.__shelfWorld !== 'undefined');
  const bookId = await page.evaluate(async ({ src }) => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const id = `qa-flip-image-${Date.now()}`;
    await books.createBook({ id, title: 'QA image handoff', floor: 0, slot: 48, spineSeed: 4421 });
    const paragraph = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const image = (caption) => ({
      type: 'image',
      attrs: {
        src,
        alt: caption,
        caption,
        widthPct: 92,
        align: 'center',
        frame: 'plain',
      },
    });
    await pages.createPage({ bookId: id, ord: 0, doc: { type: 'doc', content: [paragraph('Current left page')] } });
    await pages.createPage({ bookId: id, ord: 1, doc: { type: 'doc', content: [paragraph('Turn this right page')] } });
    await pages.createPage({ bookId: id, ord: 2, doc: { type: 'doc', content: [paragraph('Destination left image'), image('Destination left')] } });
    await pages.createPage({ bookId: id, ord: 3, doc: { type: 'doc', content: [paragraph('Destination right image'), image('Destination right')] } });
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
    return id;
  }, { src: imageSrc });
  await page.waitForSelector('.nb-flip-leaf-right .ProseMirror');
  const skipTour = page.getByText('skip the tour', { exact: true });
  if (await skipTour.count()) {
    await skipTour.first().click();
    await skipTour.first().waitFor({ state: 'hidden' });
  }
  await page.waitForFunction(() => globalThis.__flipCache?.facesFor?.('next')?.quiet === true);

  await page.evaluate(() => {
    const originalDecode = HTMLImageElement.prototype.decode;
    globalThis.__qaImageHandoff = { active: 0, starts: [], ends: [] };
    HTMLImageElement.prototype.decode = function qaDelayedDecode() {
      const image = this;
      if (!image.getAttribute('alt')?.startsWith('Destination ')) {
        return originalDecode.call(image);
      }
      const trace = globalThis.__qaImageHandoff;
      trace.active += 1;
      trace.starts.push(performance.now());
      return new Promise((resolve) => {
        setTimeout(() => {
          void originalDecode.call(image).catch(() => undefined).then(() => {
            trace.active -= 1;
            trace.ends.push(performance.now());
            resolve();
          });
        }, 280);
      });
    };
  });

  const before = await page.locator('.nb-spread-stage').getAttribute('data-spread-index');
  await page.locator('.nb-flip-hotspot-next').click({ force: true });
  await page.waitForFunction(() => globalThis.__qaImageHandoff?.active > 0);
  // Well beyond the old 96ms ceiling, but before the delayed live decode.
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({
    activeDecodes: globalThis.__qaImageHandoff?.active ?? 0,
    rasterScene: document.querySelector('.nb-flip-surface')?.classList.contains('is-flip-scene') ?? false,
    canvasVisible: document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping') ?? false,
    spread: document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? null,
  }));
  await page.locator('.nb-flip-surface').screenshot({ path: `${out}/01-raster-held-during-decode.png` });
  if (!held.rasterScene || !held.canvasVisible || held.activeDecodes < 1 || held.spread === before) {
    throw new Error(`raster-to-DOM handoff released before destination decode: ${JSON.stringify(held)}`);
  }

  await page.waitForFunction(() =>
    (globalThis.__qaImageHandoff?.starts.length ?? 0) >= 1 &&
    globalThis.__qaImageHandoff?.active === 0 &&
    globalThis.__qaImageHandoff?.ends.length === globalThis.__qaImageHandoff?.starts.length &&
    !document.querySelector('.nb-flip-canvas')?.classList.contains('is-flipping'));
  const landed = await page.evaluate(() => ({
    trace: globalThis.__qaImageHandoff,
    spread: document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? null,
    imageCount: document.querySelectorAll('.nb-flip-surface img[alt^="Destination "]').length,
    imagesReady: [...document.querySelectorAll('.nb-flip-surface img[alt^="Destination "]')]
      .every((image) => image.complete && image.naturalWidth > 0),
  }));
  await page.locator('.nb-flip-surface').screenshot({ path: `${out}/02-live-images-landed.png` });
  if (landed.spread === before || landed.imageCount < 1 || !landed.imagesReady) {
    throw new Error(`destination live images were not complete at release: ${JSON.stringify(landed)}`);
  }
  const report = { ok: true, bookId, before, held, landed, pageErrors };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
