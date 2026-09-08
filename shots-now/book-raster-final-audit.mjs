import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const appUrl = 'http://127.0.0.1:1420';
const outputRoot = 'shots-now/out';
const screenshotPath = `${outputRoot}/book-raster-audit-titles-13-26.png`;
const earlyScreenshotPath = `${outputRoot}/book-raster-audit-titles-01-12.png`;
const reportPath = `${outputRoot}/book-raster-audit-report.json`;

mkdirSync(outputRoot, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(`page: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.setContent(`<!doctype html>
    <html><head><style>
      @font-face { font-family: PatrickHand; src: url('${appUrl}/node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2'); }
      * { box-sizing: border-box; }
      body { margin: 0; color: #432934; background: #d8c8aa; font-family: PatrickHand, sans-serif; }
      header { padding: 24px 30px 20px; background: #f2e6ce; border-bottom: 3px solid #432934; }
      h1 { margin: 0; font-size: 32px; font-weight: 400; letter-spacing: .02em; }
      header p { margin: 4px 0 0; font-size: 17px; color: #6f5559; }
      main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding: 18px; }
      article { padding: 12px; background: #f7eedb; border: 2px solid #432934; border-radius: 9px 7px 10px 8px; }
      canvas { display: block; width: 100%; height: 180px; }
      h2 { margin: 8px 2px 0; font-size: 20px; line-height: 1.05; font-weight: 400; }
      small { display: block; margin: 3px 2px 0; color: #775e62; font: 11px/1.2 Nunito Sans, sans-serif; letter-spacing: .07em; text-transform: uppercase; }
    </style></head><body>
      <header><h1>Alcove · generated title furniture · catalogue 13–26</h1><p>The shipped PNG runtime, recoloured into the same three semantic inks on dark and light bindings</p></header>
      <main id="board"></main>
    </body></html>`);

  const report = await page.evaluate(async ({ appUrl }) => {
    const raster = await import('/src/art/bookRasterArtwork.ts');
    const titles = await import('/src/art/bookTitleArtwork.ts');
    const idsByCategory = Object.fromEntries(['emblems', 'frames', 'titles'].map(category => [
      category,
      raster.bookRasterArtworkIds(category),
    ]));
    const expected = { emblems: 29, frames: 18, titles: 25 };
    for (const category of Object.keys(expected)) {
      if (idsByCategory[category].length !== expected[category]) {
        throw new Error(`incomplete generated manifest: ${category}=${idsByCategory[category].length}, expected ${expected[category]}`);
      }
    }

    raster.clearBookRasterArtworkCache();
    const coldStart = performance.now();
    await raster.preloadBookRasterArtwork();
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    await raster.preloadBookRasterArtwork();
    const warmMs = performance.now() - warmStart;

    const selectedStyles = titles.REMASTERED_TITLE_IDS.slice(12, 26);
    const selectedIds = selectedStyles.map(style => `titles/${style}`);
    const dark = {
      background: '#3b2835',
      border: '#432934',
      palette: { ground: '#6f3d50', ink: '#f2e6ce', tooling: '#d6b266' },
    };
    const light = {
      background: '#ead9b6',
      border: '#432934',
      palette: { ground: '#e4cfa6', ink: '#432934', tooling: '#a87932' },
    };

    const hashPixels = pixels => {
      let hash = 2166136261;
      for (const value of pixels) {
        hash ^= value;
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    const renderHash = (id, scheme) => {
      const canvas = new OffscreenCanvas(320, 140);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = scheme.background;
      ctx.fillRect(0, 0, 320, 140);
      ctx.strokeStyle = scheme.border;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, 316, 136);
      const painted = raster.paintBookRasterArtwork(ctx, id, scheme.palette, 20, 20, 280, 100, { fit: 'stretch' });
      if (!painted) throw new Error(`main painter declined preloaded ${id}`);
      return hashPixels(ctx.getImageData(0, 0, 320, 140).data);
    };

    const mainHashes = Object.fromEntries(selectedIds.map(id => [id, {
      dark: renderHash(id, dark),
      light: renderHash(id, light),
    }]));
    const renderEmblemHash = id => {
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#3b2835';
      ctx.fillRect(0, 0, 256, 256);
      if (!raster.paintBookRasterArtwork(ctx, id, '#d6b266', 24, 24, 208, 208, { fit: 'contain' })) {
        throw new Error(`main emblem painter declined preloaded ${id}`);
      }
      return hashPixels(ctx.getImageData(0, 0, 256, 256).data);
    };
    const mainEmblemHashes = Object.fromEntries(idsByCategory.emblems.map(id => [id, renderEmblemHash(id)]));

    const workerSource = `
      self.onmessage = async event => {
        try {
          const raster = await import('${appUrl}/src/art/bookRasterArtwork.ts');
          const { ids, emblemIds, dark, light } = event.data;
          await raster.preloadBookRasterArtwork([...ids, ...emblemIds]);
          const hashPixels = pixels => {
            let hash = 2166136261;
            for (const value of pixels) {
              hash ^= value;
              hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(16).padStart(8, '0');
          };
          const render = (id, scheme) => {
            const canvas = new OffscreenCanvas(320, 140);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = scheme.background;
            ctx.fillRect(0, 0, 320, 140);
            ctx.strokeStyle = scheme.border;
            ctx.lineWidth = 3;
            ctx.strokeRect(2, 2, 316, 136);
            if (!raster.paintBookRasterArtwork(ctx, id, scheme.palette, 20, 20, 280, 100, { fit: 'stretch' })) {
              throw new Error('worker painter declined preloaded ' + id);
            }
            return hashPixels(ctx.getImageData(0, 0, 320, 140).data);
          };
          const renderEmblem = id => {
            const canvas = new OffscreenCanvas(256, 256);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#3b2835';
            ctx.fillRect(0, 0, 256, 256);
            if (!raster.paintBookRasterArtwork(ctx, id, '#d6b266', 24, 24, 208, 208, { fit: 'contain' })) {
              throw new Error('worker emblem painter declined preloaded ' + id);
            }
            return hashPixels(ctx.getImageData(0, 0, 256, 256).data);
          };
          self.postMessage({
            hashes: Object.fromEntries(ids.map(id => [id, { dark: render(id, dark), light: render(id, light) }])),
            emblemHashes: Object.fromEntries(emblemIds.map(id => [id, renderEmblem(id)])),
            status: raster.bookRasterArtworkStatus(),
          });
        } catch (error) {
          self.postMessage({ error: error instanceof Error ? error.message : String(error) });
        }
      };
    `;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const workerResult = await new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, { type: 'module' });
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('worker parity audit timed out'));
      }, 30000);
      worker.onmessage = event => {
        clearTimeout(timeout);
        worker.terminate();
        event.data.error ? reject(new Error(event.data.error)) : resolve(event.data);
      };
      worker.onerror = event => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({ ids: selectedIds, emblemIds: idsByCategory.emblems, dark, light });
    });
    URL.revokeObjectURL(workerUrl);

    const parityMismatches = [];
    for (const id of selectedIds) {
      for (const variant of ['dark', 'light']) {
        if (mainHashes[id][variant] !== workerResult.hashes[id][variant]) {
          parityMismatches.push({ id, variant, main: mainHashes[id][variant], worker: workerResult.hashes[id][variant] });
        }
      }
    }
    const emblemParityMismatches = idsByCategory.emblems
      .filter(id => mainEmblemHashes[id] !== workerResult.emblemHashes[id])
      .map(id => ({ id, main: mainEmblemHashes[id], worker: workerResult.emblemHashes[id] }));

    const pixelAudit = (id, colours) => {
      const prepared = raster.getBookRasterArtwork(id, colours);
      if (!prepared) throw new Error(`missing prepared pixels for ${id}`);
      const canvas = new OffscreenCanvas(prepared.width, prepared.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(prepared.source, 0, 0);
      const data = ctx.getImageData(0, 0, prepared.width, prepared.height).data;
      let alphaEdgePixels = 0;
      const alphaAt = (x, y) => data[(y * prepared.width + x) * 4 + 3];
      for (let x = 0; x < prepared.width; x++) {
        if (alphaAt(x, 0)) alphaEdgePixels++;
        if (prepared.height > 1 && alphaAt(x, prepared.height - 1)) alphaEdgePixels++;
      }
      for (let y = 1; y < prepared.height - 1; y++) {
        if (alphaAt(0, y)) alphaEdgePixels++;
        if (prepared.width > 1 && alphaAt(prepared.width - 1, y)) alphaEdgePixels++;
      }
      let centreMaxAlpha = 0;
      const centreX = Math.floor(prepared.width / 2);
      const centreY = Math.floor(prepared.height / 2);
      for (let y = Math.max(0, centreY - 4); y <= Math.min(prepared.height - 1, centreY + 4); y++) {
        for (let x = Math.max(0, centreX - 4); x <= Math.min(prepared.width - 1, centreX + 4); x++) {
          centreMaxAlpha = Math.max(centreMaxAlpha, alphaAt(x, y));
        }
      }
      let unexpectedOpaqueRgb = 0;
      const allowed = new Set((typeof colours === 'string' ? [colours] : Object.values(colours))
        .map(value => value.toLowerCase().slice(1, 7)));
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const rgb = [data[i], data[i + 1], data[i + 2]].map(value => value.toString(16).padStart(2, '0')).join('');
        if (!allowed.has(rgb)) unexpectedOpaqueRgb++;
      }
      return {
        size: [prepared.width, prepared.height],
        bounds: prepared.bounds,
        margins: [
          prepared.bounds.x,
          prepared.bounds.y,
          prepared.width - prepared.bounds.x - prepared.bounds.width,
          prepared.height - prepared.bounds.y - prepared.bounds.height,
        ],
        alphaEdgePixels,
        centreMaxAlpha,
        unexpectedOpaqueRgb,
      };
    };

    const titlePixels = Object.fromEntries(selectedIds.map(id => [id, pixelAudit(id, light.palette)]));
    const framePixels = Object.fromEntries(idsByCategory.frames.map(id => [id, pixelAudit(id, '#432934')]));
    const emblemPixels = Object.fromEntries(idsByCategory.emblems.map(id => [id, pixelAudit(id, '#d6b266')]));

    const board = document.querySelector('#board');
    for (let index = 0; index < selectedStyles.length; index++) {
      const style = selectedStyles[index];
      const id = `titles/${style}`;
      const article = document.createElement('article');
      const canvas = document.createElement('canvas');
      canvas.width = 740;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      const variants = [dark, light];
      for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
        const scheme = variants[variantIndex];
        const x = variantIndex * 370;
        ctx.fillStyle = scheme.background;
        ctx.beginPath();
        ctx.roundRect(x + 4, 4, 362, 172, [8, 6, 9, 7]);
        ctx.fill();
        ctx.strokeStyle = scheme.border;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = variantIndex === 0 ? '#f2e6ce' : '#432934';
        ctx.font = '14px PatrickHand';
        ctx.fillText(variantIndex === 0 ? 'DARK BINDING' : 'LIGHT BINDING', x + 18, 26);
        // Preserve the production title-box proportion on a 0.68:1 cover.
        // The vertical cloth inlay must remain a tall strip instead of being
        // misleadingly stretched into a horizontal band for the specimen.
        const layout = titles.REMASTERED_TITLE_LAYOUTS[style];
        const aspect = (layout.coverBox.width * 0.68) / layout.coverBox.height;
        const targetWidth = Math.min(334, 124 * aspect);
        const targetHeight = targetWidth / aspect;
        const targetX = x + 185 - targetWidth / 2;
        const targetY = 38 + (124 - targetHeight) / 2;
        if (!raster.paintBookRasterArtwork(ctx, id, scheme.palette, targetX, targetY, targetWidth, targetHeight, { fit: 'stretch' })) {
          throw new Error(`board painter declined ${id}`);
        }
      }
      const heading = document.createElement('h2');
      heading.textContent = `${String(index + 13).padStart(2, '0')} · ${titles.REMASTERED_TITLE_LABELS[style]}`;
      const meta = document.createElement('small');
      meta.textContent = style;
      article.append(canvas, heading, meta);
      board.append(article);
    }

    return {
      manifest: Object.fromEntries(Object.entries(idsByCategory).map(([category, ids]) => [category, ids.length])),
      selectedIds,
      timing: { coldMs, warmMs },
      mainStatus: raster.bookRasterArtworkStatus(),
      workerStatus: workerResult.status,
      parityMismatches,
      emblemParityMismatches,
      titlePixels,
      framePixels,
      emblemPixels,
    };
  }, { appUrl });

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.evaluate(async () => {
    const raster = await import('/src/art/bookRasterArtwork.ts');
    const titles = await import('/src/art/bookTitleArtwork.ts');
    const dark = { background: '#3b2835', palette: { ground: '#6f3d50', ink: '#f2e6ce', tooling: '#d6b266' } };
    const light = { background: '#ead9b6', palette: { ground: '#e4cfa6', ink: '#432934', tooling: '#a87932' } };
    const styles = titles.REMASTERED_TITLE_IDS.slice(0, 12);
    document.querySelector('h1').textContent = 'Alcove · generated title furniture · catalogue 01–12';
    document.querySelector('header p').textContent = 'The production title compositor on dark and light bindings, at each authored title-box proportion';
    const board = document.querySelector('#board');
    board.innerHTML = '';
    for (let index = 0; index < styles.length; index++) {
      const style = styles[index];
      const article = document.createElement('article');
      const canvas = document.createElement('canvas');
      canvas.width = 740;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      for (const [variantIndex, scheme] of [dark, light].entries()) {
        const x = variantIndex * 370;
        ctx.fillStyle = scheme.background;
        ctx.beginPath();
        ctx.roundRect(x + 4, 4, 362, 172, [8, 6, 9, 7]);
        ctx.fill();
        ctx.strokeStyle = '#432934';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = variantIndex === 0 ? '#f2e6ce' : '#432934';
        ctx.font = '14px PatrickHand';
        ctx.fillText(variantIndex === 0 ? 'DARK BINDING' : 'LIGHT BINDING', x + 18, 26);
        if (style === 'none') {
          ctx.globalAlpha = 0.65;
          ctx.fillText('NO TITLE FURNITURE', x + 112, 102);
          ctx.globalAlpha = 1;
        } else {
          const layout = titles.REMASTERED_TITLE_LAYOUTS[style];
          const aspect = (layout.coverBox.width * 0.68) / layout.coverBox.height;
          const targetWidth = Math.min(334, 124 * aspect);
          const targetHeight = targetWidth / aspect;
          const targetX = x + 185 - targetWidth / 2;
          const targetY = 38 + (124 - targetHeight) / 2;
          if (!titles.paintRemasteredTitle(ctx, targetX, targetY, targetWidth, targetHeight, style, scheme.palette)) {
            throw new Error(`production title compositor declined ${style}`);
          }
        }
      }
      const heading = document.createElement('h2');
      heading.textContent = `${String(index + 1).padStart(2, '0')} · ${titles.REMASTERED_TITLE_LABELS[style]}`;
      const meta = document.createElement('small');
      meta.textContent = style;
      article.append(canvas, heading, meta);
      board.append(article);
    }
  });
  await page.screenshot({ path: earlyScreenshotPath, fullPage: true });
  report.runtimeErrors = runtimeErrors;
  report.screenshots = { early: earlyScreenshotPath, late: screenshotPath };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ screenshotPath, reportPath, ...report }, null, 2)}\n`);
} finally {
  await browser.close();
}
