/**
 * Live regression for editor boundaries that unit tests cannot settle:
 * selection-preserving right click, atom-node menus, backward page flow,
 * non-persistent resize, and spacer-line placeholder silence.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'qa/editor-boundaries';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 940 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const report = { ok: false };

async function geometrySnapshot(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.nb-spread-fit-frame');
    // Snapshot staging deliberately clones a paper far offscreen. The product
    // invariant concerns the two live leaves the reader can see/edit.
    const papers = Array.from(document.querySelectorAll('.nb-flip-leaf > .nb-sheet-paper'));
    if (!(frame instanceof HTMLElement) || papers.length === 0) {
      throw new Error('canonical frame or paper missing');
    }
    const frameRect = frame.getBoundingClientRect();
    const blocks = papers.flatMap((paper) =>
      Array.from(paper.querySelectorAll('.nb-prose > *'))
    ).map((block) => {
      const range = document.createRange();
      range.selectNodeContents(block);
      return {
        type: block.getAttribute('data-type') || block.tagName,
        text: (block.textContent ?? '').trim(),
        left: block.offsetLeft,
        top: block.offsetTop,
        width: block.offsetWidth,
        height: block.offsetHeight,
        lineRects: range.getClientRects().length,
      };
    });
    const pageIds = papers.map((paper) => paper.dataset.pageId ?? '');
    return {
      dpr: devicePixelRatio,
      frameLayout: { width: frame.offsetWidth, height: frame.offsetHeight },
      frameDrawn: { width: frameRect.width, height: frameRect.height },
      papers: papers.map((paper) => ({
        width: paper.clientWidth,
        height: paper.clientHeight,
        proseWidth: paper.querySelector('.nb-prose')?.clientWidth ?? 0,
        proseHeight: paper.querySelector('.nb-prose')?.clientHeight ?? 0,
      })),
      blocks,
      pageIds,
      duplicatePageIds: pageIds.filter((id, index) => id && pageIds.indexOf(id) !== index),
    };
  });
}

const stableGeometry = (snapshot) => JSON.stringify({
  frameLayout: snapshot.frameLayout,
  papers: snapshot.papers,
  blocks: snapshot.blocks,
  pageIds: snapshot.pageIds,
  duplicatePageIds: snapshot.duplicatePageIds,
});

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  report.fixture = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-editor-boundaries-${Date.now()}`;
    const book = await books.createBook({ id, title: 'QA editor boundaries', floor: 0, slot: 49, spineSeed: 99172 });
    const prose = Array.from({ length: 6 }, (_, index) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Baseline paragraph ${index + 1} keeps resize pagination honest without changing its words.` }],
    }));
    await pages.createPage({ bookId: book.id, ord: 0, doc: { type: 'doc', content: prose } });
    await pages.createPage({
      bookId: book.id,
      ord: 1,
      doc: {
        type: 'doc',
        content: [
          { type: 'math', attrs: { latex: 'a\\mathrel+b' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'First selected block.' }] },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second selected block.' }] },
          { type: 'codeBlock', attrs: { language: 'typescript' }, content: [{ type: 'text', text: 'const kitten = true;' }] },
        ],
      },
    });
    app.appState.openBook(book.id);
    return { bookId: book.id };
  });
  await page.waitForSelector('.nb-flip-leaf-right .nb-prose [data-type="math"]');
  await page.waitForTimeout(1800);

  const math = page.locator('.nb-flip-leaf-right .nb-prose [data-type="math"]');
  report.mathText = (await math.innerText()).trim();
  await math.click({ button: 'right', position: { x: 8, y: 8 } });
  await page.waitForSelector('.nb-ctx-menu');
  report.mathMenu = await page.locator('.nb-ctx-menu').isVisible();
  await page.screenshot({ path: `${OUT}/01-math-context.png`, caret: 'hide' });
  await page.keyboard.press('Escape');

  report.specialNodeMenus = [];
  const hosts = page.locator('.nb-flip-leaf-right .nb-prose .nb-node-view[data-node-view-root]');
  for (let index = 0; index < await hosts.count(); index += 1) {
    const host = hosts.nth(index);
    const kind = await host.getAttribute('data-node-view-root');
    await host.click({ button: 'right', position: { x: 6, y: 6 } });
    const visible = await page.locator('.nb-ctx-menu').isVisible().catch(() => false);
    report.specialNodeMenus.push({ kind, visible });
    await page.keyboard.press('Escape');
  }

  report.spacerHint = await page.evaluate(() => {
    const paragraphs = Array.from(document.querySelectorAll('.nb-flip-leaf-right .nb-prose p'));
    const empty = paragraphs.find((candidate) => (candidate.textContent ?? '').trim() === '');
    return empty ? getComputedStyle(empty, '::before').content : 'missing';
  });

  const second = page.locator('.nb-flip-leaf-right .nb-prose p').filter({ hasText: 'Second selected block.' });
  const secondBox = await second.boundingBox();
  if (secondBox === null) throw new Error('second selection paragraph missing');
  report.selection = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('.nb-flip-leaf-right .nb-prose p'));
    const first = ps.find((p) => p.textContent?.includes('First selected block.'));
    const second = ps.find((p) => p.textContent?.includes('Second selected block.'));
    if (!first?.firstChild || !second?.firstChild) throw new Error('selection endpoints missing');
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, second.firstChild.textContent?.length ?? 0);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  await page.mouse.click(secondBox.x + 12, secondBox.y + 10, { button: 'right' });
  await page.waitForSelector('.nb-ctx-menu');
  report.selectionAfterMenu = await page.evaluate(() => getSelection()?.toString() ?? '');
  report.selectionMenu = await page.locator('.nb-ctx-menu').isVisible();
  await page.screenshot({ path: `${OUT}/02-multiblock-context.png`, caret: 'hide' });
  await page.getByRole('menuitem', { name: 'Copy content', exact: true }).click();
  report.selectionClipboard = await page.evaluate(() => navigator.clipboard.readText());

  // Recreate the same cross-block range and prove Delete consumes the range,
  // rather than the one paragraph under the right-click pointer.
  await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('.nb-flip-leaf-right .nb-prose p'));
    const first = ps.find((p) => p.textContent?.includes('First selected block.'));
    const second = ps.find((p) => p.textContent?.includes('Second selected block.'));
    if (!first?.firstChild || !second?.firstChild) throw new Error('selection endpoints missing');
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, second.firstChild.textContent?.length ?? 0);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.mouse.click(secondBox.x + 12, secondBox.y + 10, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete selection / block', exact: true }).click();
  report.selectionDeleted = await page.evaluate(() => {
    const text = document.querySelector('.nb-flip-leaf-right .nb-prose')?.textContent ?? '';
    return !text.includes('First selected block.') && !text.includes('Second selected block.');
  });
  await page.waitForTimeout(1100);

  report.beforeResize = await page.evaluate(async (bookId) => {
    const pages = await import('/src/data/pages.ts');
    return JSON.stringify((await pages.listPages(bookId)).map(({ ord, doc }) => ({ ord, doc })));
  }, report.fixture.bookId);
  report.geometry = { baseline: await geometrySnapshot(page), cycles: [] };
  for (let cycle = 0; cycle < 4; cycle += 1) {
    await page.setViewportSize({ width: 960, height: 620 });
    await page.waitForTimeout(500);
    const small = await geometrySnapshot(page);
    if (cycle === 0) {
      await math.click({ button: 'right', position: { x: 8, y: 8 } });
      const menu = await page.locator('.nb-ctx-menu').boundingBox();
      report.smallMenuFits = menu !== null && menu.x >= 0 && menu.y >= 0 &&
        menu.x + menu.width <= 960 && menu.y + menu.height <= 620;
      await page.screenshot({ path: `${OUT}/04-small-context.png`, caret: 'hide' });
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.waitForTimeout(500);
    const restored = await geometrySnapshot(page);
    report.geometry.cycles.push({ small, restored });
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 940,
    screenWidth: 1500,
    screenHeight: 940,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.waitForTimeout(700);
  report.geometry.dpr2 = await geometrySnapshot(page);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.waitForTimeout(700);
  report.geometry.afterDpr = await geometrySnapshot(page);
  const canonical = stableGeometry(report.geometry.baseline);
  report.geometryStable = report.geometry.cycles.every(({ small, restored }) =>
    stableGeometry(small) === canonical && stableGeometry(restored) === canonical
  ) && stableGeometry(report.geometry.dpr2) === canonical &&
    stableGeometry(report.geometry.afterDpr) === canonical;
  report.wholeBookScales = report.geometry.cycles.every(({ small }) =>
    small.frameDrawn.width < report.geometry.baseline.frameDrawn.width &&
    small.frameDrawn.height < report.geometry.baseline.frameDrawn.height
  );
  report.afterResize = await page.evaluate(async (bookId) => {
    const pages = await import('/src/data/pages.ts');
    return JSON.stringify((await pages.listPages(bookId)).map(({ ord, doc }) => ({ ord, doc })));
  }, report.fixture.bookId);
  report.resizeStable = report.beforeResize === report.afterResize;

  await math.click();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1000);
  report.afterBackspace = await page.evaluate(async (bookId) => {
    const pages = await import('/src/data/pages.ts');
    return (await pages.listPages(bookId)).map(({ ord, doc }) => ({ ord, nodes: doc.content ?? [] }));
  }, report.fixture.bookId);
  const movedMath = report.afterBackspace[0]?.nodes.find((node) => node.type === 'math');
  report.mathMovedBack = movedMath?.attrs?.latex === 'a\\mathrel+b' &&
    report.afterBackspace[1]?.nodes[0]?.type !== 'math';
  await page.screenshot({ path: `${OUT}/03-math-moved-back.png`, caret: 'hide' });

  report.ok =
    report.mathText.includes('+') &&
    !report.mathText.includes('mathrel') &&
    report.mathMenu &&
    report.specialNodeMenus.every((entry) => entry.visible) &&
    (report.spacerHint === 'none' || report.spacerHint === 'normal') &&
    report.selectionMenu &&
    report.selectionAfterMenu.includes('First selected block.') &&
    report.selectionAfterMenu.includes('Second selected block.') &&
    report.selectionClipboard.includes('First selected block.') &&
    report.selectionClipboard.includes('Second selected block.') &&
    report.selectionDeleted &&
    report.smallMenuFits &&
    report.resizeStable &&
    report.geometryStable &&
    report.wholeBookScales &&
    report.mathMovedBack;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  if (report.fixture?.bookId) {
    await page.evaluate(async (bookId) => {
      const app = await import('/src/state/app.ts');
      const books = await import('/src/data/books.ts');
      app.appState.closeBook();
      await books.deleteBook(bookId);
    }, report.fixture.bookId).catch(() => {});
  }
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
