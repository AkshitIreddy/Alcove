/** Render and measure H1-H4 in page flow and padded special elements. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const hit = process.argv.find((arg) => arg.startsWith('--url='));
const base = hit?.slice('--url='.length) || 'http://127.0.0.1:1420';
const out = 'shots-now/out/heading-layout';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

const check = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  // Effect surfaces are lazy with the editor; load their shipped stylesheet
  // before constructing an isolated specimen board.
  await page.evaluate(() => Promise.all([
    import('/src/styles/editor.css'),
    import('/src/styles/effects.css'),
  ]));
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      body { overflow: auto !important; background: #f4ead9 !important; }
      body > :not(#qa-heading-board) { display: none !important; }
      #qa-heading-board { width: 1440px; margin: 20px auto; color: var(--ink-sepia); }
      #qa-heading-board * { box-sizing: border-box; }
      .qa-title { margin: 0 0 10px; font: 700 27px/1.1 var(--font-heading); }
      .qa-note { margin: 0 0 14px; font: 13px/1.35 var(--font-ui); color: var(--ink-sepia-soft); }
      .qa-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: start; }
      .qa-page-sample.nb-prose { min-height: 168px; padding: 14px 18px; background: var(--paper-cream); border: 1.5px solid var(--paper-edge); border-radius: var(--radius-hand); --page-line-height: 32px; --page-text-scale: 1; --nb-rule-lead: 0px; }
      .qa-page-sample p { margin: 0; line-height: 32px; }
      .qa-page-sample .qa-cell-label { font: 700 11px/1.2 var(--font-ui); color: var(--ink-sepia-soft); text-transform: uppercase; letter-spacing: .05em; }
      .qa-container-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: start; }
      .qa-container-cell.nb-prose { padding: 0; --page-line-height: 32px; --page-text-scale: 1; --nb-rule-lead: 0px; }
      .qa-container-cell > .qa-cell-label { display: block; margin-bottom: 4px; font: 700 11px/1.2 var(--font-ui); color: var(--ink-sepia-soft); text-transform: uppercase; }
      .qa-container-cell [data-qa-container] { min-height: 105px; }
      .qa-container-cell [data-qa-container] p { margin: 0; line-height: 24px; }
      .qa-container-cell .nb-callout { margin: 0; }
      .qa-container-cell .nb-callout-body { min-width: 0; }
      .qa-section { margin-top: 22px; }
    `;
    document.head.appendChild(style);

    const board = document.createElement('main');
    board.id = 'qa-heading-board';
    board.innerHTML = `
      <h1 class="qa-title">Heading layout — real Alcove styles</h1>
      <p class="qa-note">H1–H4 first on a page and after body copy, then inside padded special elements.</p>
      <section>
        <h2 class="qa-title">Ordinary page flow</h2>
        <div class="qa-grid">
          ${[1, 2, 3, 4].map((level) => `<div class="qa-page-sample nb-prose" data-flow="start" data-level="${level}"><span class="qa-cell-label">H${level} · page start</span><h${level}>Page-start heading</h${level}><p>Following body line stays clear.</p></div>`).join('')}
          ${[1, 2, 3, 4].map((level) => `<div class="qa-page-sample nb-prose" data-flow="mid" data-level="${level}"><span class="qa-cell-label">H${level} · mid-page</span><p class="qa-before">Body line before heading.</p><h${level}>Mid-page heading</h${level}><p>Following body line stays clear.</p></div>`).join('')}
        </div>
      </section>
      <section class="qa-section">
        <h2 class="qa-title">Card (scoped correction)</h2>
        <div class="qa-container-grid">
          ${[1, 2, 3, 4].map((level) => `<div class="qa-container-cell nb-prose"><span class="qa-cell-label">Card · H${level}</span><div data-type="card" data-qa-container="card"><h${level}>Card heading</h${level}><p>Inside the card border.</p></div></div>`).join('')}
        </div>
      </section>
      ${[
        ['sticky-note', 'Sticky note'],
        ['quote-card', 'Quote card'],
        ['index-card', 'Index card'],
        ['callout', 'Callout'],
      ].map(([type, label]) => `<section class="qa-section"><h2 class="qa-title">${label}</h2><div class="qa-container-grid">${[1, 2, 3, 4].map((level) => {
        const inner = `<h${level}>${label} heading</h${level}><p>Inside the padded border.</p>`;
        return `<div class="qa-container-cell nb-prose"><span class="qa-cell-label">${label} · H${level}</span>${type === 'callout' ? `<div class="nb-callout" data-tint="amber" data-qa-container="callout"><span class="nb-callout-icon">✦</span><div class="nb-callout-body">${inner}</div></div>` : `<div data-type="${type}" data-qa-container="${type}">${inner}</div>`}</div>`;
      }).join('')}</div></section>`).join('')}
    `;
    document.body.appendChild(board);
  });

  const measurements = await page.evaluate(() => {
    const round = (value) => Math.round(value * 10) / 10;
    const flow = [...document.querySelectorAll('[data-flow]')].map((cell) => {
      const heading = cell.querySelector('h1,h2,h3,h4');
      const before = cell.querySelector('.qa-before');
      const after = heading?.nextElementSibling;
      const c = cell.getBoundingClientRect();
      const h = heading.getBoundingClientRect();
      const b = before?.getBoundingClientRect();
      const a = after?.getBoundingClientRect();
      return {
        flow: cell.getAttribute('data-flow'),
        level: Number(cell.getAttribute('data-level')),
        topGap: round(h.top - c.top),
        beforeGap: b ? round(h.top - b.bottom) : null,
        afterGap: a ? round(a.top - h.bottom) : null,
        overlapTop: h.top < c.top - 0.5,
        overlapsBefore: b ? h.top < b.bottom - 0.5 : false,
        overlapsAfter: a ? a.top < h.bottom - 0.5 : false,
      };
    });
    const containers = [...document.querySelectorAll('[data-qa-container]')].map((container) => {
      const heading = container.querySelector('h1,h2,h3,h4');
      const next = heading?.nextElementSibling;
      const c = container.getBoundingClientRect();
      const h = heading.getBoundingClientRect();
      const n = next?.getBoundingClientRect();
      const style = getComputedStyle(container);
      return {
        type: container.getAttribute('data-qa-container'),
        level: Number(heading.tagName.slice(1)),
        topGap: round(h.top - c.top),
        expectedPaddingTop: round(parseFloat(style.paddingTop) || 0),
        afterGap: n ? round(n.top - h.bottom) : null,
        overlapTop: h.top < c.top - 0.5,
        overlapsNext: n ? n.top < h.bottom - 0.5 : false,
      };
    });
    return { flow, containers };
  });

  const card = measurements.containers.filter((item) => item.type === 'card');
  check(card.length === 4 && card.every((item) => !item.overlapTop && !item.overlapsNext),
    'card-scoped heading correction did not keep all H1-H4 inside the card');
  check(card.every((item) => item.topGap >= item.expectedPaddingTop - 2 && item.topGap < 55),
    'card heading top whitespace does not match its padding');

  await page.screenshot({ path: `${out}/heading-layout-board.png`, fullPage: true, caret: 'hide' });
  const issues = [
    ...measurements.flow.filter((item) =>
      item.overlapTop || item.overlapsBefore ||
      (item.afterGap ?? 0) < -18 || item.topGap > 90 || (item.beforeGap ?? 0) > 45),
    ...measurements.containers.filter((item) =>
      item.overlapTop || (item.afterGap ?? 0) < -18 ||
      item.topGap < -0.5 || item.topGap > 70),
  ];
  const report = { ok: issues.length === 0, measurements, issues, pageErrors };
  writeFileSync(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: report.ok,
    flowSamples: measurements.flow.length,
    containerSamples: measurements.containers.length,
    card: card.map(({ level, topGap, expectedPaddingTop, afterGap }) => ({ level, topGap, expectedPaddingTop, afterGap })),
    issues,
    screenshot: `${out}/heading-layout-board.png`,
    pageErrors,
  }, null, 2));
} finally {
  await browser.close();
}
