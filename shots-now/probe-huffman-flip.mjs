/**
 * Exact regression probe for the reader-supplied Huffman Notebook Script.
 *
 * It owns a disposable browser context, creates a fresh book through the
 * shelf's own bridge, inserts the script through the real In and out dialog,
 * then records both persistence identity and the raster bitmap used by a turn.
 * No server or installed-library state is touched.
 *
 * Usage:
 *   node shots-now/probe-huffman-flip.mjs [--source=C:/path/to/note.md]
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL_BASE = 'http://127.0.0.1:1420';
const SOURCE_PATH = process.argv.find((arg) => arg.startsWith('--source='))?.slice(9)
  ?? 'C:/Users/akshi/Downloads/huffman-coding-kitten-shelter-notes.md';
const OUT = 'shots-now/out/huffman-flip';
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120_000);
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[browser]', message.text().slice(0, 240));
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('nb-tutorial-done', '1');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof globalThis.__shelfAddBook === 'function' && globalThis.__shelfWorld !== undefined,
  null,
  { polling: 300 },
);

const made = await page.evaluate(() => globalThis.__shelfAddBook(0));
if (made?.book?.id === undefined) throw new Error('fresh-book bridge returned no book');
const bookId = made.book.id;
await page.evaluate(async (id) => {
  const app = await import('/src/state/app.ts');
  app.appState.openBook(id);
}, bookId);
await page.waitForSelector('.nb-flip-surface .ProseMirror', { timeout: 60_000 });
for (let attempt = 0; attempt < 3; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: true }).first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
}

// Reproduce the reader's action: focus the blank LEFT leaf, then paste via the
// actual dialog. The focused-side assertion keeps this probe useful after the
// insertion-target bug is fixed by the editor owner.
const leftEditor = page.locator('.nb-flip-leaf-left .ProseMirror');
if ((await leftEditor.count()) === 0) throw new Error('fresh spread has no left editor');
await leftEditor.click({ position: { x: 90, y: 90 }, force: true });
await page.getByRole('button', { name: /In and out/i }).first().click({ force: true });
await page.waitForSelector('[data-share="insert"]');
await page.locator('[data-share="insert"]').dispatchEvent('click');
await page.locator('.nb-ins-card textarea').fill(SOURCE);
await page.getByRole('button', { name: /^Insert$/i }).click({ force: true });

const storedPages = () =>
  page.evaluate((id) => {
    const raw = localStorage.getItem('notebook.stubdb.v1');
    const db = raw === null ? {} : JSON.parse(raw);
    return (db.pages ?? [])
      .filter((row) => row.book_id === id)
      .sort((a, b) => a.ord - b.ord)
      .map((row) => {
        const doc = JSON.parse(row.doc_json);
        const text = (node) => {
          if (typeof node?.text === 'string') return node.text;
          return Array.isArray(node?.content) ? node.content.map(text).join(' ') : '';
        };
        const content = doc.content ?? [];
        return {
          id: row.id,
          ord: row.ord,
          updatedAt: row.updated_at,
          blocks: content.length,
          types: content.map((node) => node.type),
          text: text(doc).replace(/\s+/g, ' ').trim(),
          doc: row.doc_json,
        };
      });
  }, bookId);

// Pagination is async and can create pages. Require three identical snapshots
// a second apart, rather than sleeping once and racing an overflow carry.
let pages = [];
let stable = 0;
let signature = '';
for (let attempt = 0; attempt < 45 && stable < 3; attempt += 1) {
  await page.waitForTimeout(1000);
  pages = await storedPages();
  const next = pages.map((entry) => `${entry.id}:${entry.ord}:${entry.doc}`).join('|');
  if (next === signature) stable += 1;
  else {
    signature = next;
    stable = 0;
  }
}
if (stable < 3) throw new Error('pagination did not reach a quiet persisted state');

const normalizedFingerprint = (entry) =>
  entry.doc.replace(/"id":"[^"]+"/g, '"id":"<id>"');
const duplicateGroups = [];
const byDoc = new Map();
for (const entry of pages) {
  const fingerprint = normalizedFingerprint(entry);
  const prior = byDoc.get(fingerprint) ?? [];
  prior.push(entry.ord);
  byDoc.set(fingerprint, prior);
}
for (const ords of byDoc.values()) if (ords.length > 1) duplicateGroups.push(ords);

// Walk every spread by using the public hotspot and record the actual mounted
// page ids/texts plus a screenshot. If a visual leaf repeats while ids/docs do
// not, that is snapshot identity; if the stored docs repeat, it is data-level.
const spreads = [];
const seenStarts = new Set();
const offscreenBitmaps = new Map();

const compareBitmap = async (side, snapshotDataUrl) => {
  const paper = page.locator(`.nb-flip-leaf-${side} .nb-sheet-paper`);
  const livePng = await paper.screenshot();
  return page.evaluate(async ({ side, liveDataUrl, snapshotDataUrl }) => {
    const leaf = document.querySelector(`.nb-flip-leaf-${side}`);
    const sheet = leaf?.querySelector('.nb-sheet-paper');
    if (!(sheet instanceof HTMLElement)) return null;
    const sheetRect = sheet.getBoundingClientRect();
    const lists = Array.from(sheet.querySelectorAll('ul, ol'));
    const zones = [
      { name: 'full', x: 0, y: 0, w: sheetRect.width, h: sheetRect.height },
      ...Array.from(sheet.querySelectorAll('table, ul, ol')).map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          name: `${element.tagName.toLowerCase()}-${index}`,
          x: rect.left - sheetRect.left,
          y: rect.top - sheetRect.top,
          w: rect.width,
          h: rect.height,
        };
      }),
      ...lists.flatMap((list, index) => {
        const row = Array.from(list.children).find((child) => child.tagName === 'LI');
        if (!(row instanceof HTMLElement)) return [];
        const rowRect = row.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        return [{
          name: `marker-gutter-${index}`,
          x: Math.max(0, rowRect.left - sheetRect.left - 30),
          y: listRect.top - sheetRect.top,
          w: 34,
          h: listRect.height,
        }];
      }),
    ];
    const decode = async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return image;
    };
    const [liveImage, snapshotImage] = await Promise.all([
      decode(liveDataUrl),
      decode(snapshotDataUrl),
    ]);
    const width = liveImage.naturalWidth;
    const height = liveImage.naturalHeight;
    const pixels = (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    };
    const live = pixels(liveImage);
    const snapshot = pixels(snapshotImage);
    const score = (zone, dx, dy) => {
      const x0 = Math.max(0, Math.floor(zone.x + 2));
      const y0 = Math.max(0, Math.floor(zone.y + 2));
      const x1 = Math.min(width, Math.ceil(zone.x + zone.w - 2));
      const y1 = Math.min(height, Math.ceil(zone.y + zone.h - 2));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 2) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        for (let x = x0; x < x1; x += 2) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          const li = (y * width + x) * 4;
          const si = (sy * width + sx) * 4;
          const liveLuma = live[li] * 0.21 + live[li + 1] * 0.72 + live[li + 2] * 0.07;
          const snapLuma = snapshot[si] * 0.21 + snapshot[si + 1] * 0.72 + snapshot[si + 2] * 0.07;
          // Paper-only pixels are plentiful enough to hide a displaced glyph.
          if (liveLuma > 238 && snapLuma > 238) continue;
          sum += Math.abs(liveLuma - snapLuma);
          count += 1;
        }
      }
      return count === 0 ? Number.POSITIVE_INFINITY : sum / count;
    };
    return zones.map((zone) => {
      let best = { dx: 0, dy: 0, score: score(zone, 0, 0) };
      const zeroScore = best.score;
      for (let dy = -5; dy <= 5; dy += 1) {
        for (let dx = -5; dx <= 5; dx += 1) {
          const candidate = score(zone, dx, dy);
          if (candidate < best.score) best = { dx, dy, score: candidate };
        }
      }
      return { name: zone.name, zeroScore, ...best };
    });
  }, {
    side,
    liveDataUrl: `data:image/png;base64,${livePng.toString('base64')}`,
    snapshotDataUrl,
  });
};

for (let index = 0; index < Math.ceil(pages.length / 2) + 2; index += 1) {
  await page.waitForFunction(() => {
    const state = globalThis.__flipCache?.facesFor?.('next');
    return state === null || (state.quiet === true && state.fresh === true);
  }, null, { polling: 250 }).catch(() => {});
  const mounted = await page.evaluate(() => {
    const read = (side) => {
      const leaf = document.querySelector(`.nb-flip-leaf-${side}`);
      const paper = leaf?.querySelector('.nb-sheet-paper');
      const prose = leaf?.querySelector('.nb-prose');
      return {
        pageId: paper?.dataset.pageId ?? paper?.closest('[data-page-id]')?.dataset.pageId ?? null,
        text: prose?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    };
    return { left: read('left'), right: read('right'), faces: globalThis.__flipCache?.facesFor?.('next') ?? null };
  });
  const startKey = `${mounted.faces?.stationary ?? '-'}|${mounted.faces?.front ?? '-'}`;
  if (seenStarts.has(startKey)) break;
  seenStarts.add(startKey);
  const bitmapComparisons = {};
  for (const side of ['left', 'right']) {
    const pageId = mounted[side].pageId;
    const mountedSnapshot = pageId === null
      ? null
      : await page.evaluate((id) => globalThis.__flipCache?.bitmapPng?.(id) ?? null, pageId);
    if (typeof mountedSnapshot === 'string') {
      bitmapComparisons[`mounted-${side}`] = await compareBitmap(side, mountedSnapshot);
    }
    const prior = pageId === null ? undefined : offscreenBitmaps.get(pageId);
    if (prior !== undefined) {
      bitmapComparisons[`offscreen-${side}`] = await compareBitmap(side, prior);
    }
  }
  spreads.push({ index, ...mounted, bitmapComparisons });
  await page.locator('.nb-flip-surface').screenshot({ path: `${OUT}/spread-${String(index).padStart(2, '0')}.png` });

  const next = mounted.faces;
  if (next === null || (next.back === null && next.revealed === null)) break;
  for (const id of [next.back, next.revealed]) {
    if (id === null) continue;
    const dataUrl = await page.evaluate((pageId) => globalThis.__flipCache?.bitmapPng?.(pageId) ?? null, id);
    if (typeof dataUrl !== 'string') continue;
    offscreenBitmaps.set(id, dataUrl);
    writeFileSync(
      `${OUT}/offscreen-${String(index).padStart(2, '0')}-${id}.png`,
      Buffer.from(dataUrl.split(',')[1], 'base64'),
    );
  }
  await page.locator('.nb-flip-hotspot-next').click({ force: true });
  await page.waitForTimeout(900);
}

const report = {
  bookId,
  sourceBytes: Buffer.byteLength(SOURCE),
  stable,
  pageCount: pages.length,
  pages: pages.map(({ doc: _doc, ...entry }) => ({ ...entry, text: entry.text.slice(0, 180) })),
  duplicateGroups,
  spreads,
};
writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ pageCount: report.pageCount, duplicateGroups, spreads: spreads.length }, null, 2));
await browser.close();
