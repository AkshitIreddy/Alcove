/**
 * Live regression for the open-book camera. The large viewport mirrors the
 * owner's 2559x1599 screenshot at Windows 150% scaling (1706x1066 CSS px).
 * Resizing may only change the outer transform: page ids, stored JSON, paper
 * layout and block wrapping must remain exact.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const sabotage = process.argv.includes('--sabotage');
const OUT = sabotage ? 'qa/book-camera-fit/sabotage' : 'qa/book-camera-fit';
const LARGE = { width: 1706, height: 1066 };
const SMALL = { width: 960, height: 620 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: LARGE, deviceScaleFactor: 1.5 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
const skip = page.getByText('skip the tour', { exact: false }).first();
if (await skip.count()) await skip.click({ force: true }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});

const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const pages = await import('/src/data/pages.ts');
  const app = await import('/src/state/app.ts');
  const id = `qa-camera-fit-${Date.now()}`;
  await books.createBook({
    id,
    title: 'A Book That Uses the Desk',
    floor: 0,
    slot: 48,
    spineSeed: 4422,
  });
  const paragraph = (text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  await pages.createPage({
    bookId: id,
    ord: 0,
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Camera-only fit' }] },
        paragraph('A stable first page checks that resizing never changes its words, wrapping, or pagination.'),
        paragraph('The canonical paper box stays fixed while the complete bound book is drawn larger or smaller.'),
      ],
    },
  });
  await pages.createPage({
    bookId: id,
    ord: 1,
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Facing leaf' }] },
        paragraph('This second page makes duplicate, missing, or displaced page ids visible to the probe.'),
      ],
    },
  });
  app.appState.openBook(id);
  return id;
});

await page.waitForSelector('.nb-book-view .nb-spread-fit-frame');
await page.waitForSelector('.nb-flip-leaf-left .nb-prose');
await page.mouse.move(LARGE.width / 2, LARGE.height / 2);
await page.waitForTimeout(1_200);

if (sabotage) {
  await page.addStyleTag({
    content: `
      .nb-book-view { --nb-spread-fit: 1 !important; }
      .nb-spread-fit-frame::before {
        content: 'A Book That Uses the Desk';
        position: absolute;
        top: -48px;
        left: 50%;
        transform: translateX(-50%);
      }
    `,
  });
}

async function settleFrame() {
  await page.waitForFunction(() => {
    const frame = document.querySelector('.nb-spread-fit-frame');
    return frame instanceof HTMLElement && frame.getBoundingClientRect().width > 200;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function stateSnapshot() {
  return page.evaluate(async (id) => {
    const pages = await import('/src/data/pages.ts');
    const rows = await pages.listPages(id);
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing ${selector}`);
      return element;
    };
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const layout = (element) => ({
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
    const view = required('.nb-book-view');
    const frame = required('.nb-spread-fit-frame');
    const cover = required('.nb-book-cover');
    const papers = Array.from(document.querySelectorAll('.nb-flip-leaf > .nb-sheet-paper'))
      .filter((element) => element instanceof HTMLElement);
    const blocks = papers.flatMap((paper) =>
      Array.from(paper.querySelectorAll('.nb-prose > *')).map((block) => ({
        pageId: paper.dataset.pageId ?? '',
        type: block.getAttribute('data-type') ?? block.tagName,
        text: block.textContent ?? '',
        left: block.offsetLeft,
        top: block.offsetTop,
        width: block.offsetWidth,
        height: block.offsetHeight,
        lineRects: (() => {
          const range = document.createRange();
          range.selectNodeContents(block);
          return range.getClientRects().length;
        })(),
      })),
    );
    const roomStyles = getComputedStyle(view);
    const roomWidth =
      view.clientWidth -
      (Number.parseFloat(roomStyles.paddingLeft) || 0) -
      (Number.parseFloat(roomStyles.paddingRight) || 0);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stored: rows.map((row) => ({ id: row.id, ord: row.ord, doc: row.doc })),
      frame: { layout: layout(frame), drawn: rect(frame) },
      cover: { layout: layout(cover), drawn: rect(cover) },
      papers: papers.map((paper) => ({
        pageId: paper.dataset.pageId ?? '',
        layout: layout(paper),
      })),
      blocks,
      roomWidth,
      roomFill: frame.getBoundingClientRect().width / roomWidth,
      visibleTitlePlateCount: Array.from(document.querySelectorAll('.nb-book-title-plate'))
        .filter((element) => element instanceof HTMLElement && element.getBoundingClientRect().width > 0)
        .length + (getComputedStyle(frame, '::before').content !== 'none' ? 1 : 0),
      accessibleTitle: document.querySelector('.nb-book-title-accessible')?.textContent ?? '',
      fit: roomStyles.getPropertyValue('--nb-spread-fit').trim(),
    };
  }, bookId);
}

await settleFrame();
const largeBefore = await stateSnapshot();
await page.screenshot({ path: `${OUT}/01-large.png`, caret: 'hide' });

await page.setViewportSize(SMALL);
await settleFrame();
const small = await stateSnapshot();
await page.screenshot({ path: `${OUT}/02-small.png`, caret: 'hide' });

await page.setViewportSize(LARGE);
await settleFrame();
const largeAfter = await stateSnapshot();
await page.screenshot({ path: `${OUT}/03-large-return.png`, caret: 'hide' });

const tocButton = page.locator('.nb-rail-button[data-tool="toc"]');
await tocButton.click();
const tocDialog = page.getByRole('dialog', { name: 'Table of contents' });
await tocDialog.waitFor({ state: 'visible' });
await page.waitForFunction(() =>
  (Number.parseFloat(document.documentElement.style.getPropertyValue('--nb-panel-edge')) || 0) > 300
);
await settleFrame();
const panelOpen = await stateSnapshot();
await page.screenshot({ path: `${OUT}/04-panel-open.png`, caret: 'hide' });
await tocButton.click();
await tocDialog.waitFor({ state: 'hidden' });
await page.waitForFunction(() =>
  (Number.parseFloat(document.documentElement.style.getPropertyValue('--nb-panel-edge')) || 0) === 0
);
if (!sabotage) {
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.nb-book-view')).getPropertyValue('--nb-spread-fit').trim() === '1.15'
  );
}
await settleFrame();
const panelClosed = await stateSnapshot();
await page.screenshot({ path: `${OUT}/05-panel-closed.png`, caret: 'hide' });

const stableLayout = (snapshot) => JSON.stringify({
  stored: snapshot.stored,
  frame: snapshot.frame.layout,
  cover: snapshot.cover.layout,
  papers: snapshot.papers,
  blocks: snapshot.blocks,
});
const checks = {
  noVisibleBookTitle: largeBefore.visibleTitlePlateCount === 0,
  accessibleBookTitle: largeBefore.accessibleTitle === 'A Book That Uses the Desk',
  canonicalFrame: largeBefore.frame.layout.width === 1334 && largeBefore.frame.layout.height === 869,
  canonicalCover: largeBefore.cover.layout.width === 1334 && largeBefore.cover.layout.height === 869,
  canonicalPaper: largeBefore.papers.length === 2 && largeBefore.papers.every((paper) =>
    paper.layout.width === 649 && paper.layout.height === 833
  ),
  usesLargeRoom: largeBefore.roomFill >= 0.95 && largeBefore.roomFill <= 1.001,
  smallUsesCameraOnly: stableLayout(small) === stableLayout(largeBefore),
  fullReturnExact: stableLayout(largeAfter) === stableLayout(largeBefore),
  panelUsesCameraOnly: stableLayout(panelOpen) === stableLayout(largeBefore),
  panelCloseExact: stableLayout(panelClosed) === stableLayout(largeBefore),
  noConsoleErrors: consoleErrors.length === 0,
  noPageErrors: pageErrors.length === 0,
};
const report = {
  ok: Object.values(checks).every(Boolean),
  sabotage,
  checks,
  largeBefore,
  small,
  largeAfter,
  panelOpen,
  panelClosed,
  consoleErrors,
  pageErrors,
};
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

await browser.close();

if (sabotage && !report.ok) {
  console.log('book camera fit: GATE ALIVE · cramped camera/title regression rejected');
} else if (!report.ok) {
  console.error(`book camera fit: FAILED\n${JSON.stringify(checks, null, 2)}`);
  process.exitCode = 1;
} else if (sabotage) {
  console.error('book camera fit: GATE INERT');
  process.exitCode = 2;
} else {
  console.log(`book camera fit: PASS · large ${largeBefore.fit} · small ${small.fit}`);
}
