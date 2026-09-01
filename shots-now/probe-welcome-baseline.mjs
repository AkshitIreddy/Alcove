/** Live gate for typing after the final feature on Welcome page one. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = 'qa/ruled-baseline/welcome-after-banner.png';
mkdirSync('qa/ruled-baseline', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1706, height: 1066 },
  deviceScaleFactor: 2,
});
page.setDefaultTimeout(60_000);
let qaBookId = null;

try {
  await page.goto('http://127.0.0.1:1420/?fx=force', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const welcome = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const all = await books.listBooksByFloorRange(-10_000, 10_000);
    const book = all.find((row) => row.title.startsWith('Welcome to Alcove'));
    if (book === undefined) throw new Error('Welcome book missing');
    const source = (await pages.listPages(book.id))[0];
    if (source === undefined) throw new Error('Welcome first page missing');
    const probeText = new Set([
      'Typed after the banner',
      'The next line must sit on paper too',
    ]);
    const textOf = (node) =>
      typeof node.text === 'string'
        ? node.text
        : Array.isArray(node.content)
          ? node.content.map(textOf).join('')
          : '';
    const doc = structuredClone(source.doc);
    doc.content = (doc.content ?? []).filter((node) => !probeText.has(textOf(node)));
    const id = `qa-welcome-baseline-${Date.now()}`;
    await books.createBook({
      id,
      title: 'Welcome Baseline Copy',
      floor: 0,
      slot: 49,
      spineSeed: 20260901,
    });
    await pages.createPage({ bookId: id, ord: 0, doc });
    app.appState.openBook(id);
    return { id, title: 'Welcome Baseline Copy' };
  });
  qaBookId = welcome.id;

  const prose = page.locator('.nb-flip-leaf-left .nb-prose').first();
  await prose.waitFor({ state: 'visible' });
  const clickPoint = await prose.evaluate((root) => {
    const last = root.lastElementChild;
    if (!(last instanceof HTMLElement)) throw new Error('Welcome page is empty');
    const box = last.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    return {
      x: rootBox.left + 120,
      y: Math.min(rootBox.bottom - 20, box.bottom + 24),
    };
  });
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.keyboard.type('Typed after the banner');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The next line must sit on paper too');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.nb-flip-leaf-left .nb-prose p'))
      .some((node) => node.textContent?.includes('Typed after the banner')),
  );

  const measurements = await prose.evaluate((root) => {
    const proseRect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const pitch = Number.parseFloat(style.lineHeight);
    const scale = proseRect.height > 0 ? root.offsetHeight / proseRect.height : 1;
    const targets = [
      ...Array.from(root.querySelectorAll('h1')).map((node) => ({ kind: 'heading', node })),
      ...Array.from(root.querySelectorAll(':scope > ul:not([data-type="taskList"]) > li p')).map((node) => ({ kind: 'bullet', node })),
      ...Array.from(root.querySelectorAll('.nb-callout p')).map((node) => ({ kind: 'callout', node })),
      ...Array.from(root.querySelectorAll('[data-type="banner"] p')).map((node) => ({ kind: 'banner', node })),
      ...Array.from(root.querySelectorAll('p'))
        .filter((node) => node.textContent?.includes('Typed after the banner') || node.textContent?.includes('paper too'))
        .map((node) => ({ kind: 'typed', node })),
    ];
    return targets.map(({ kind, node: paragraph }) => {
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:1px;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
        paragraph.insertBefore(
          marker,
          paragraph.querySelector('.ProseMirror-separator, .ProseMirror-trailingBreak'),
        );
        const layoutBaseline = (marker.getBoundingClientRect().top - proseRect.top) * scale;
        const nearestRule = Math.round(layoutBaseline / pitch) * pitch - 1;
        marker.remove();
        return {
          kind,
          text: paragraph.textContent,
          html: paragraph.innerHTML,
          baselineToRule: layoutBaseline - nearestRule,
          top: (paragraph.getBoundingClientRect().top - proseRect.top) * scale,
          fontSize: getComputedStyle(paragraph).fontSize,
          lineHeight: getComputedStyle(paragraph).lineHeight,
          paddingTop: getComputedStyle(paragraph).paddingTop,
          gridSnap: getComputedStyle(paragraph).getPropertyValue('--nb-grid-snap').trim(),
          pitch,
          inlineBoxes: kind === 'heading'
            ? Array.from(paragraph.children).map((child) => ({
                tag: child.tagName,
                className: child.className,
                top: (child.getBoundingClientRect().top - proseRect.top) * scale,
                bottom: (child.getBoundingClientRect().bottom - proseRect.top) * scale,
                width: child.getBoundingClientRect().width * scale,
                height: child.getBoundingClientRect().height * scale,
                display: getComputedStyle(child).display,
                verticalAlign: getComputedStyle(child).verticalAlign,
              }))
            : undefined,
        };
      });
  });

  await page.locator('.nb-flip-leaf-left .nb-sheet-paper').first().screenshot({
    path: out,
    caret: 'hide',
  });
  console.log(JSON.stringify({ out, measurements }, null, 2));
  const ruledWriting = measurements.filter(({ kind }) =>
    kind === 'heading' || kind === 'bullet' || kind === 'typed',
  );
  if (
    ruledWriting.length !== 6 ||
    ruledWriting.some(({ baselineToRule }) => Math.abs(baselineToRule) > 1.25)
  ) {
    throw new Error(`WELCOME BASELINE FAIL: ${JSON.stringify(measurements)}`);
  }
  console.log('WELCOME BASELINE PASS');
} finally {
  if (qaBookId !== null) {
    await page.evaluate(async (id) => {
      const books = await import('/src/data/books.ts');
      await books.deleteBook(id);
    }, qaBookId).catch(() => {});
  }
  await browser.close();
}
