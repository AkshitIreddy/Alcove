/**
 * Exact regression journey for the owner's Huffman Notebook Script + image.
 *
 * Runs only against the existing :1420 dev server and a disposable Chromium
 * profile. It creates a real fresh book through the shelf UI, focuses the
 * left leaf, inserts through the real In and out dialog, fills the real image
 * placeholder, then records every settled spread and the stored page/block
 * identities. Nothing touches the owner's Tauri database.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sourcePath = process.argv.find((value) => value.startsWith('--source='))?.slice(9)
  ?? 'C:/Users/akshi/Downloads/huffman-coding-kitten-shelter-notes.md';
const imagePath = process.argv.find((value) => value.startsWith('--image='))?.slice(8)
  ?? 'C:/Users/akshi/Downloads/19c70801-e7a3-45a5-98f6-045554c09fa4.png';
const skipImage = process.argv.includes('--skip-image');
const out = process.argv.find((value) => value.startsWith('--out='))?.slice(6)
  ?? 'shots-now/out/huffman-real-data';
mkdirSync(out, { recursive: true });
const source = readFileSync(sourcePath, 'utf8');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

const report = {
  ok: false,
  base,
  sourcePath,
  imagePath,
  leftPageIdBeforeInsert: null,
  rightPageIdBeforeInsert: null,
  insertion: null,
  spreadIndexAfterInsert: null,
  beforeImage: null,
  afterImage: null,
  reloadImage: null,
  spreads: [],
  pageErrors,
  screenshots: [],
};

const sha = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);
const normalizeDoc = (value) => {
  const strip = (node) => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== 'object') return node;
    const out = {};
    for (const [key, item] of Object.entries(node)) {
      if (key === 'id' || key === 'blockId' || key === 'updated_at') continue;
      if (key === 'attrs' && item && typeof item === 'object') {
        out[key] = strip(
          Object.fromEntries(
            Object.entries(item).filter(([attr]) => attr !== 'id' && attr !== 'blockId'),
          ),
        );
      } else out[key] = strip(item);
    }
    return out;
  };
  return strip(value);
};
const textOf = (node) => {
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (node === null || typeof node !== 'object') return '';
  const own = typeof node.text === 'string' ? node.text : '';
  return `${own} ${textOf(node.content ?? [])}`.replace(/\s+/g, ' ').trim();
};
const storedBook = async (bookId) => page.evaluate((id) => {
  const raw = localStorage.getItem('notebook.stubdb.v1');
  if (raw === null) return { pages: [], tables: [] };
  const tables = JSON.parse(raw);
  const rows = Array.isArray(tables.pages) ? tables.pages : [];
  return {
    tables: Object.keys(tables),
    pages: rows
      .filter((row) => (row.book_id ?? row.bookId) === id)
      .sort((a, b) => Number(a.ord ?? 0) - Number(b.ord ?? 0))
      .map((row) => {
        let doc = row.doc_json ?? row.doc;
        if (typeof doc === 'string') {
          try { doc = JSON.parse(doc); } catch { /* preserve malformed value */ }
        }
        return {
          id: row.id,
          ord: row.ord,
          scriptSource: row.script_source ?? row.scriptSource ?? null,
          protectedStart: row.protected_start ?? row.protectedStart ?? null,
          doc,
        };
      }),
  };
}, bookId);
const summarizeStored = async (bookId) => {
  const stored = await storedBook(bookId);
  const pages = stored.pages.map((row) => {
    const normalized = normalizeDoc(row.doc);
    const text = textOf(row.doc);
    const blocks = Array.isArray(row.doc?.content)
      ? row.doc.content.map((block) => {
          const blockText = textOf(block);
          const canonical = JSON.stringify(normalizeDoc(block));
          return {
            type: block?.type ?? null,
            text: blockText,
            hash: sha(canonical),
            // Structural blocks such as horizontal rules intentionally repeat.
            // Only compare substantive textual blocks when looking for the old
            // pagination bug that copied content onto two different pages.
            meaningful: blockText.trim().length >= 20,
          };
        })
      : [];
    return {
      id: row.id,
      ord: row.ord,
      protectedStart: row.protectedStart,
      hasScriptSource: typeof row.scriptSource === 'string' && row.scriptSource.length > 0,
      docHash: sha(JSON.stringify(normalized)),
      textHash: sha(text),
      text,
      blocks,
    };
  });
  const blockOwners = new Map();
  for (const storedPage of pages) {
    for (const block of storedPage.blocks) {
      if (!block.meaningful) continue;
      const owners = blockOwners.get(block.hash) ?? [];
      owners.push({ pageId: storedPage.id, ord: storedPage.ord, type: block.type, text: block.text });
      blockOwners.set(block.hash, owners);
    }
  }
  const duplicateBlocks = [...blockOwners.entries()]
    .filter(([, owners]) => new Set(owners.map((owner) => owner.pageId)).size > 1)
    .map(([hash, owners]) => ({ hash, owners }));
  const duplicatePages = pages.flatMap((candidate, index) =>
    pages.slice(index + 1)
      .filter((other) => other.docHash === candidate.docHash || other.textHash === candidate.textHash)
      .map((other) => ({ left: candidate.ord, right: other.ord, doc: other.docHash === candidate.docHash, text: other.textHash === candidate.textHash })),
  );
  return { tables: stored.tables, pages, duplicateBlocks, duplicatePages };
};
const waitStablePages = async (bookId, quietMs = 1_200, capMs = 45_000) => {
  const started = Date.now();
  let last = '';
  let quietAt = Date.now();
  while (Date.now() - started < capMs) {
    const summary = await summarizeStored(bookId);
    const signature = JSON.stringify(summary.pages.map((row) => [row.id, row.docHash]));
    if (signature !== last) {
      last = signature;
      quietAt = Date.now();
    } else if (Date.now() - quietAt >= quietMs) return summary;
    await page.waitForTimeout(120);
  }
  throw new Error(`page documents did not settle within ${capMs}ms`);
};
const screenshot = async (name) => {
  const path = `${out}/${name}.png`;
  await page.locator('.nb-book-view').screenshot({ path, caret: 'hide', timeout: 180_000 });
  report.screenshots.push(path);
};
const waitForTurnSettle = async () => {
  await page.waitForFunction(() => !document.querySelector('.nb-flip-canvas.is-flipping'), null, { polling: 50 });
  await page.waitForTimeout(350);
};
const tapTurn = async (direction) => {
  const before = await page.evaluate(() => Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1));
  const leaf = page.locator(direction === 'next' ? '.nb-flip-leaf-right' : '.nb-flip-leaf-left');
  const box = await leaf.boundingBox();
  if (box === null) throw new Error(`${direction} leaf has no turn box`);
  await page.mouse.click(
    direction === 'next' ? box.x + box.width - 12 : box.x + 12,
    box.y + box.height * 0.5,
  );
  await page.waitForFunction(
    (previous) => Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1) !== previous,
    before,
    { polling: 50 },
  );
  await waitForTurnSettle();
};
const currentSpread = async () => page.evaluate(() => {
  const stage = document.querySelector('.nb-spread-stage');
  const side = (name) => {
    const leaf = document.querySelector(
      `.nb-leaf-paper[data-side="${name}"]:not(.nb-export-sheet)`,
    );
    const prose = leaf?.querySelector('.nb-prose');
    return {
      pageId: leaf?.getAttribute('data-page-id') ?? null,
      text: prose?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      headings: [...(prose?.querySelectorAll('h1,h2,h3') ?? [])].map((node) => node.textContent?.trim() ?? ''),
      table: prose?.querySelector('table')?.getBoundingClientRect().toJSON() ?? null,
      tableWrappers: [...(prose?.querySelectorAll('.tableWrapper') ?? [])].map((wrapper) => {
        const style = getComputedStyle(wrapper);
        return {
          overflowX: style.overflowX,
          clientWidth: wrapper.clientWidth,
          scrollWidth: wrapper.scrollWidth,
          scrollbarPx: wrapper.offsetHeight - wrapper.clientHeight,
        };
      }),
      lists: [...(prose?.querySelectorAll('ul,ol') ?? [])].map((node) => node.getBoundingClientRect().toJSON()),
    };
  };
  return {
    index: Number(stage?.getAttribute('data-spread-index') ?? -1),
    left: side('left'),
    right: side('right'),
  };
});

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('nb-tutorial-done', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 250 });
  await page.evaluate(async () => globalThis.__shelfWorld.ready);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const skip = page.getByText('skip the tour', { exact: false });
    if ((await skip.count()) === 0) break;
    await skip.first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }

  // Create the same fresh book without sampling the shelf pull animation; the
  // journey under test begins in the reader, and avoiding a still-running GSAP
  // flight keeps page errors from an unrelated teardown out of this gate.
  const bookId = await page.evaluate(async () => {
    const made = await globalThis.__shelfAddBook?.(0);
    return made?.book?.id ?? null;
  });
  if (bookId === null) throw new Error('new book id was not reachable');
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, bookId);
  await page.waitForSelector('.nb-book-view .nb-prose', { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.nb-leaf-paper[data-page-id]').length >= 2, null, { polling: 100 });

  const before = await currentSpread();
  report.leftPageIdBeforeInsert = before.left.pageId;
  report.rightPageIdBeforeInsert = before.right.pageId;
  const leftProse = page.locator(
    '.nb-leaf-paper[data-side="left"]:not(.nb-export-sheet) .nb-prose[contenteditable="true"]',
  );
  await leftProse.click({ position: { x: 28, y: 28 } });
  const focusedSide = await page.evaluate(() => document.activeElement?.closest('.nb-leaf-paper')?.getAttribute('data-side') ?? null);
  if (focusedSide !== 'left') throw new Error(`left leaf did not own focus (${focusedSide})`);

  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.getByText('Paste a script in', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('textarea').fill(source);
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const inserted = await waitStablePages(bookId);
  report.insertion = {
    focusedSide,
    pageCount: inserted.pages.length,
    sourceOwnerOrd: inserted.pages.find((row) => row.hasScriptSource)?.ord ?? null,
    sourceOwnerId: inserted.pages.find((row) => row.hasScriptSource)?.id ?? null,
    leftFirstText: inserted.pages.find((row) => row.id === before.left.pageId)?.text.slice(0, 180) ?? null,
    rightFirstText: inserted.pages.find((row) => row.id === before.right.pageId)?.text.slice(0, 180) ?? null,
  };
  report.spreadIndexAfterInsert = (await currentSpread()).index;
  await screenshot('01-after-script');
  report.beforeImage = inserted;

  if (skipImage) {
    report.afterImage = inserted;
  } else {
    // The image is in the first source section. If pagination moved it out of
    // the current spread, visit spreads until the real placeholder is mounted.
    let placeholder = page.locator('.nb-image-placeholder');
    let turns = 0;
    while ((await placeholder.count()) === 0 && turns < inserted.pages.length + 2) {
      const previous = (await currentSpread()).index;
      await tapTurn('next');
      const current = (await currentSpread()).index;
      if (current === previous) break;
      turns += 1;
      placeholder = page.locator('.nb-image-placeholder');
    }
    if ((await placeholder.count()) === 0) throw new Error('image placeholder was not reachable');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      placeholder.first().click(),
    ]);
    await chooser.setFiles(imagePath);
    await page.waitForFunction(() => {
      const image = document.querySelector('.nb-image img');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    }, null, { polling: 100, timeout: 60_000 });
    await waitStablePages(bookId, 1_600);
    await screenshot('02-after-image');
    report.afterImage = await summarizeStored(bookId);
  }

  // Browser development used to keep only a realm-local object URL. Reload
  // the actual app, reopen the same stored book, and prove the image bytes can
  // be resolved again from the durable dev-media store.
  if (!skipImage) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 250 });
    await page.evaluate(async () => globalThis.__shelfWorld.ready);
    await page.evaluate(async (id) => {
      const app = await import('/src/state/app.ts');
      app.appState.openBook(id);
    }, bookId);
    await page.waitForSelector('.nb-book-view .nb-prose', { timeout: 60_000 });
    let restoredImage = page.locator('.nb-image img');
    let reloadTurns = 0;
    while ((await restoredImage.count()) === 0 && reloadTurns < report.afterImage.pages.length + 2) {
      await tapTurn('next');
      reloadTurns += 1;
      restoredImage = page.locator('.nb-image img');
    }
    await page.waitForFunction(() => {
      const image = document.querySelector('.nb-image img');
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    }, null, { polling: 100, timeout: 60_000 });
    report.reloadImage = await restoredImage.first().evaluate((image) => ({
      src: image.getAttribute('src'),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      missingPlaceholder: image.getAttribute('src')?.startsWith('data:image/svg+xml') ?? false,
      assetRelPath: image.closest('[data-node-view-root]')?.getAttribute('data-asset-rel-path') ?? null,
    }));
    await screenshot('03-after-reload');

    await restoredImage.first().dblclick();
    const viewer = page.getByRole('dialog', { name: /Image viewer/ });
    await viewer.waitFor({ state: 'visible' });
    for (let index = 0; index < 4; index += 1) {
      await viewer.getByRole('button', { name: 'Zoom in' }).click();
    }
    const viewerStage = viewer.locator('.nb-image-viewer-stage');
    const viewerImage = viewer.locator('.nb-image-viewer-image');
    const panBefore = await viewerImage.evaluate((image) => image.style.transform);
    const stageBox = await viewerStage.boundingBox();
    if (stageBox === null) throw new Error('image viewer stage has no box');
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      stageBox.x + stageBox.width / 2 + 120,
      stageBox.y + stageBox.height / 2 + 75,
      { steps: 8 },
    );
    await page.mouse.up();
    const panAfter = await viewerImage.evaluate((image) => image.style.transform);
    report.viewer = { panBefore, panAfter, moved: panBefore !== panAfter };
    await viewer.screenshot({ path: `${out}/04-image-viewer-200-dragged.png`, caret: 'hide' });
    report.screenshots.push(`${out}/04-image-viewer-200-dragged.png`);
    await viewer.getByRole('button', { name: 'Close image viewer' }).click();
  }

  // Walk to the front, then record every settled spread once. This also
  // exercises all mounted/offscreen snapshot identities after the image grew.
  while ((await currentSpread()).index > 0) {
    await tapTurn('previous');
  }
  for (let index = 0; index < 64; index += 1) {
    const settled = await waitStablePages(bookId, 900);
    // Offscreen settlement may insert a spill page immediately before a
    // protected section. Re-read the current spread after that ordered list
    // has landed instead of capturing stale slots from before the insertion.
    const liveIndex = await page.evaluate(() => Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1));
    const expectedLeft = settled.pages[liveIndex * 2]?.id ?? null;
    const expectedRight = settled.pages[liveIndex * 2 + 1]?.id ?? null;
    await page.waitForFunction(
      ({ left, right }) => {
        const id = (side) => document.querySelector(`.nb-leaf-paper[data-side="${side}"]:not(.nb-export-sheet)`)?.getAttribute('data-page-id') ?? null;
        return id('left') === left && id('right') === right;
      },
      { left: expectedLeft, right: expectedRight },
      { polling: 50 },
    );
    const spread = await currentSpread();
    const lastContentSlot = settled.pages.reduce(
      (last, storedPage, slot) => storedPage.blocks.length > 0 ? slot : last,
      0,
    );
    const maxSpread = Math.max(0, Math.floor(lastContentSlot / 2));
    if (spread.index > maxSpread) break;
    report.spreads.push(spread);
    await screenshot(`spread-${String(index).padStart(2, '0')}`);
    if (spread.index >= maxSpread) {
      report.afterImage = settled;
      break;
    }
    await tapTurn('next');
  }

  await page.locator('.nb-rail-button[data-tool="toc"]').click();
  const toc = page.locator('[data-testid="toc-panel"]');
  await toc.waitFor({ state: 'visible' });
  report.tocRows = await toc.locator('.nb-toc-row').evaluateAll((rows) =>
    rows.map((row) => ({
      text: row.querySelector('.nb-toc-text')?.textContent?.trim() ?? '',
      page: row.querySelector('.nb-toc-page')?.textContent?.trim() ?? '',
      pageRow: row.classList.contains('is-page-row'),
    })),
  );
  await page.getByRole('dialog', { name: 'Table of contents' }).screenshot({
    path: `${out}/05-table-of-contents.png`,
    caret: 'hide',
  });
  report.screenshots.push(`${out}/05-table-of-contents.png`);

  const insertedOnLeft = report.insertion.sourceOwnerId === report.leftPageIdBeforeInsert;
  const imageKeptAllBlocks = report.afterImage.duplicateBlocks.length === 0;
  report.ok =
    insertedOnLeft &&
    report.spreadIndexAfterInsert === 0 &&
    imageKeptAllBlocks &&
    (skipImage || (
      report.reloadImage?.naturalWidth > 0 &&
      report.reloadImage?.missingPlaceholder === false &&
      report.viewer?.moved === true
    )) &&
    pageErrors.length === 0;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify({
  ok: report.ok,
  insertion: report.insertion,
  spreadIndexAfterInsert: report.spreadIndexAfterInsert,
  viewer: report.viewer ?? null,
  beforePages: report.beforeImage?.pages.length ?? null,
  afterPages: report.afterImage?.pages.length ?? null,
  duplicatePages: report.afterImage?.duplicatePages.length ?? null,
  duplicateBlocks: report.afterImage?.duplicateBlocks.length ?? null,
  reloadImage: report.reloadImage,
  pageErrors: report.pageErrors.length,
  error: report.error ?? null,
  report: `${out}/report.json`,
}, null, 2));
process.exit(report.ok ? 0 : 1);
