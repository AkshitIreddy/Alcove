/** Render the reported weekday timeline with the real Solid diagram component. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const out = 'shots-now/out/timeline-colors';
mkdirSync(out, { recursive: true });

const source = [
  '```timeline',
  'Monday: Do the Assignments of Last week | color=blush',
  'Tuesday: work stuff i guess',
  'Wednesday: work stuff i guess | color=amber',
  'Thursday: data structures lectures and practice quiz | color=forest',
  'Friday: computer systems lectures and practice quiz | color=coral',
  '```',
].join('\n');

const browser = await chromium.launch({
  headless: true,
  args: ['--mute-audio', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1120, height: 900 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

const check = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => Promise.all([
    import('/src/styles/editor.css'),
    import('/src/styles/effects.css'),
    import('/src/styles/diagrams.css'),
  ]));
  await page.waitForFunction(() => document.fonts.status === 'loaded');

  await page.evaluate(async ({ script, breakColors }) => {
    const [{ createComponent }, { render }, { TimelineDiagram }, { parse }] = await Promise.all([
      import('/@id/solid-js'),
      import('/@id/solid-js/web'),
      import('/src/diagrams/render/TimelineDiagram.tsx'),
      import('/src/script/index.ts'),
    ]);
    const parsed = parse(script);
    const timeline = parsed.blocks.find((block) => block.kind === 'diagram' && block.lang === 'timeline');
    if (!timeline) throw new Error('timeline fixture did not parse');

    const style = document.createElement('style');
    style.textContent = `
      body { overflow: auto !important; background: #eadbc5 !important; }
      body > :not(#qa-timeline-board) { display: none !important; }
      #qa-timeline-board { width: 760px; margin: 28px auto; padding: 30px 38px; box-sizing: border-box; background: var(--paper-cream); border: 2px solid var(--ink-line); border-radius: 14px 11px 15px 12px; color: var(--ink-sepia); }
      #qa-timeline-board h1 { margin: 0 0 8px; font: 700 30px/1.1 var(--font-heading); }
      #qa-timeline-board p { margin: 0 0 20px; font: 13px/1.4 var(--font-ui); color: var(--ink-sepia-soft); }
      #qa-timeline-mount { width: 100%; }
      #qa-timeline-mount .nb-dg-svg { max-width: 100% !important; }
    `;
    document.head.appendChild(style);

    const board = document.createElement('main');
    board.id = 'qa-timeline-board';
    board.className = 'nb-prose';
    board.innerHTML = '<h1>Week plan timeline</h1><p>The exact five entries reported, rendered by Alcove’s real timeline component.</p><div id="qa-timeline-mount"></div>';
    document.body.appendChild(board);
    render(
      () => createComponent(TimelineDiagram, { entries: timeline.entries }),
      board.querySelector('#qa-timeline-mount'),
    );

    if (breakColors) {
      const sabotageStyle = document.createElement('style');
      sabotageStyle.textContent = '.nb-dg-tl-entry .nb-dg-fill { fill: var(--paper-cream) !important; }';
      document.head.appendChild(sabotageStyle);
    }
  }, { script: source, breakColors: sabotage });

  await page.waitForSelector('.nb-dg-tl-entry');
  const entries = await page.locator('.nb-dg-tl-entry').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.querySelector('.nb-dg-tl-label')?.textContent ?? '',
      color: node.getAttribute('data-color'),
      wash: node.getAttribute('data-wash'),
      fill: getComputedStyle(node.querySelector('.nb-dg-fill')).fill,
    })),
  );
  const paperFill = await page.evaluate(() => {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.style.fill = 'var(--paper-cream)';
    document.querySelector('.nb-dg-svg').appendChild(probe);
    const fill = getComputedStyle(probe).fill;
    probe.remove();
    return fill;
  });
  const expected = ['blush', 'sky', 'amber', 'forest', 'coral'];
  const colorsMatch = entries.map((entry) => entry.color).join('|') === expected.join('|');
  const everyCardPainted = entries.every((entry) => entry.fill !== paperFill);
  const distinctFills = new Set(entries.map((entry) => entry.fill)).size;

  await page.locator('#qa-timeline-board').screenshot({
    path: `${out}/weekday-timeline.png`,
    caret: 'hide',
  });
  const report = {
    ok: colorsMatch && everyCardPainted && distinctFills >= 4 && pageErrors.length === 0,
    sabotage,
    expected,
    paperFill,
    distinctFills,
    entries,
    pageErrors,
    screenshot: `${out}/weekday-timeline.png`,
  };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  if (sabotage) {
    check(!report.ok, 'GATE INERT: a paper-only timeline passed the color check');
    console.log('GATE ALIVE: paper-only timeline was rejected');
  } else {
    check(report.ok, 'weekday timeline did not render all five visible colors');
  }
} finally {
  await browser.close();
}
