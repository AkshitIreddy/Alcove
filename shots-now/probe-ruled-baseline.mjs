/**
 * Live regression gate for ordinary typed prose sitting on the printed rule.
 *
 * Usage:
 *   node shots-now/probe-ruled-baseline.mjs
 *   node shots-now/probe-ruled-baseline.mjs --sabotage
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const sabotage = process.argv.includes('--sabotage');
const afterHeading = process.argv.includes('--after-heading');
const headingLevelArg = process.argv.find((arg) => arg.startsWith('--heading-level='));
const headingLevel = headingLevelArg === undefined
  ? 1
  : Number.parseInt(headingLevelArg.slice('--heading-level='.length), 10);
const scaleArg = process.argv.find((arg) => arg.startsWith('--scale='));
const requestedScale = scaleArg === undefined
  ? 1
  : Number.parseFloat(scaleArg.slice('--scale='.length));
const out = sabotage
  ? 'qa/ruled-baseline/sabotage.png'
  : afterHeading
    ? 'qa/ruled-baseline/after-heading.png'
    : 'qa/ruled-baseline/current.png';
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
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) {
    throw new Error(`invalid --scale value: ${scaleArg}`);
  }
  if (![1, 2].includes(headingLevel)) {
    throw new Error(`invalid --heading-level value: ${headingLevelArg}`);
  }
  await page.evaluate((scale) => {
    document.documentElement.style.setProperty('--page-text-scale', String(scale));
    document.documentElement.style.setProperty('--page-text-size', `${20 * scale}px`);
  }, requestedScale);
  const skip = page.getByText('skip the tour', { exact: false }).first();
  if (await skip.count()) await skip.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const bookId = await page.evaluate(async ({ includeHeading, headingLevel }) => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const id = `qa-ruled-baseline-${Date.now()}`;
    await books.createBook({
      id,
      title: 'Ruled Baseline Check',
      floor: 0,
      slot: 48,
      spineSeed: 20260901,
    });
    await pages.createPage({
      bookId: id,
      ord: 0,
      doc: {
        type: 'doc',
        attrs: { pageStyle: 'ruled', lineHeightPx: 32, ruleGapPx: 0 },
        content: [
          ...(includeHeading
            ? [{
                type: 'heading',
                attrs: { level: headingLevel },
                content: [{ type: 'text', text: 'Heading before prose' }],
              }]
            : []),
          { type: 'paragraph' },
        ],
      },
    });
    await globalThis.__shelfWorld.refreshData();
    globalThis.__shelfPullOut(id);
    return id;
  }, { includeHeading: afterHeading, headingLevel });
  qaBookId = bookId;

  await page.getByRole('button', { name: 'Open Ruled Baseline Check' }).click();
  const prose = page.locator('.nb-flip-leaf-left .nb-prose').first();
  await prose.waitFor({ state: 'visible' });
  await prose.locator('p').last().click({ position: { x: 110, y: 12 } });
  await page.keyboard.type('Writing should rest on this line');
  await page.waitForFunction(() =>
    document.querySelector('.nb-flip-leaf-left .nb-prose p')?.textContent?.includes('Writing should rest'),
  );

  if (sabotage) {
    await page.addStyleTag({
      content: '.nb-prose p { transform: translateY(-7px) !important; }',
    });
  }

  const measurements = await prose.evaluate((root, args) => {
    const paragraph = root.querySelector('p');
    const pageElement = root.closest('.nb-page');
    if (!(paragraph instanceof HTMLElement) || !(pageElement instanceof HTMLElement)) {
      throw new Error('ruled paragraph or page missing');
    }

    const proseRect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const pitch = Number.parseFloat(style.lineHeight);
    const scale = proseRect.height > 0 ? root.offsetHeight / proseRect.height : 1;
    const targets = [
      ...(args.includeHeading
        ? [{ kind: `h${args.headingLevel}`, node: root.querySelector(`h${args.headingLevel}`) }]
        : []),
      { kind: 'paragraph', node: paragraph },
    ];
    return targets.map(({ kind, node }) => {
      if (!(node instanceof HTMLElement)) throw new Error(`${kind} missing`);
      const marker = document.createElement('span');
      marker.setAttribute('data-qa-baseline-marker', '');
      marker.style.cssText = [
        'display:inline-block',
        'width:1px',
        'height:0',
        'padding:0',
        'margin:0',
        'border:0',
        'vertical-align:baseline',
      ].join(';');
      node.insertBefore(
        marker,
        node.querySelector('.ProseMirror-separator, .ProseMirror-trailingBreak'),
      );
      const markerRect = marker.getBoundingClientRect();
      const layoutBaseline = (markerRect.top - proseRect.top) * scale;
      const nearestRule = Math.round(layoutBaseline / pitch) * pitch - 1;
      const baselineToRule = layoutBaseline - nearestRule;
      marker.remove();
      return {
        kind,
        bookId: args.activeBookId,
        pitch,
        scale,
        layoutBaseline,
        nearestRule,
        baselineToRule,
        fontSize: getComputedStyle(node).fontSize,
        requestedScale: args.requestedScale,
        ruleGap: getComputedStyle(pageElement).getPropertyValue('--page-rule-gap').trim(),
        text: node.textContent,
      };
    });
  }, {
    activeBookId: bookId,
    requestedScale,
    includeHeading: afterHeading,
    headingLevel,
  });

  await prose.screenshot({ path: out, caret: 'hide' });
  console.log(JSON.stringify({ out, measurements }, null, 2));

  const tolerance = 1.25;
  const misaligned = measurements.find(({ baselineToRule }) => Math.abs(baselineToRule) > tolerance);
  if (misaligned !== undefined) {
    throw new Error(
      `RULED BASELINE FAIL: ${misaligned.kind} baseline is ${misaligned.baselineToRule.toFixed(2)}px from the printed rule`,
    );
  }
  console.log('RULED BASELINE PASS');
} finally {
  if (qaBookId !== null) {
    await page.evaluate(async (id) => {
      const books = await import('/src/data/books.ts');
      await books.deleteBook(id);
    }, qaBookId).catch(() => {});
  }
  await browser.close();
}
