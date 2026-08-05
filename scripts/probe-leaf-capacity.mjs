/**
 * scripts/probe-leaf-capacity.mjs — how many lines a leaf really holds, at the
 * window sizes readers actually get.
 *
 * `PAGE_LINE_BUDGET` (features/templates/split.ts) is 23.5, and its derivation
 * says so out loud: "A leaf holds 25.66 lines, measured: 821px of capacity over
 * 32px lines, **at a 1600x1000 window**".
 *
 * But `src-tauri/tauri.conf.json` opens the app at **1280x800** and lets it go
 * down to **960x620**. Nobody gets 1600x1000 unless they make it. So the
 * Welcome book is split for a leaf larger than the one it lands on, every page
 * arrives over capacity, and the drain pushes the excess onward — which is the
 * reader's report that *"stuff in the bottom of the page moves to the next
 * page"*, and why merely opening the book lengthens it.
 *
 * This measures the capacity the app itself computes (`BookView.measureCapacity`
 * — clientHeight less padding, times the visual scale) at each window size, and
 * turns it into the line budget that would hold there.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const SIZES = [
  { w: 1600, h: 1000, note: 'what the budget was derived at' },
  { w: 1280, h: 800, note: 'the app.s DEFAULT window (tauri.conf.json)' },
  { w: 1360, h: 850, note: 'the demo recording' },
  { w: 1100, h: 720, note: 'a small laptop' },
  { w: 960, h: 620, note: 'the app.s MINIMUM window' },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

console.log('\n  window        capacity   line h   lines   budget that would fit');
console.log('  ------------  --------   ------   -----   ---------------------');
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(700); }
  await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const w = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    app.appState.openBook(w.id);
  });
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForTimeout(4000);

  const m = await page.evaluate(() => {
    const paper = document.querySelector('.nb-leaf-paper');
    if (paper === null) return null;
    const cs = getComputedStyle(paper);
    const laidOut =
      paper.clientHeight -
      (Number.parseFloat(cs.paddingTop) || 0) -
      (Number.parseFloat(cs.paddingBottom) || 0);
    const rect = paper.getBoundingClientRect();
    const scale = paper.clientHeight > 0 ? rect.height / paper.clientHeight : 1;
    // The line box the rule grid is built on.
    const prose = document.querySelector('.nb-prose');
    const line = prose === null ? 32 : Number.parseFloat(getComputedStyle(prose).lineHeight) || 32;
    return { capacity: Math.round(laidOut * scale), line };
  });
  await page.close();
  if (m === null) { console.log(`  ${s.w}x${s.h}  — no leaf`); continue; }
  const lines = m.capacity / m.line;
  // The budget is the capacity less the estimator's own error, which split.ts
  // measured at 1.9 lines of under-statement in the worst case.
  const budget = lines - 2.2;
  console.log(
    `  ${String(s.w + 'x' + s.h).padEnd(12)}  ${String(m.capacity).padStart(6)}px  ` +
      `${String(m.line).padStart(5)}px  ${lines.toFixed(2).padStart(6)}  ${budget.toFixed(1).padStart(10)}   ${s.note}`,
  );
}
console.log(
  '\n  These readings are now the SOURCE of PAGE_LINE_BUDGET rather than a check' +
    '\n  on it: split.ts derives the budget from the window (leafCapacityPx,' +
    '\n  lineBudgetFor) and tests/split-calibration.test.ts pins the law against the' +
    '\n  table above. Re-run this after anything that changes the height of a leaf,' +
    '\n  and move the table in that test to match.',
);
await browser.close();
