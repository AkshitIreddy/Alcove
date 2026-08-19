/**
 * shots-now/panel-header.mjs — does a rail panel's way out stay put?
 *
 * Reader's report: "the back button scrolls away. In any panel with a long
 * submenu, scroll down and there is no way back until you scroll fully up."
 *
 * Three pinned strips are in play and each carries a way out of somewhere, so
 * each is measured:
 *
 *   - the SHEET header, `.nb-rail-panel-header` → `.nb-rail-panel-close` (×),
 *     a flex sibling of the scroller;
 *   - the SUBMENU header, `.nb-sheet-head` → `.nb-pick-back` (back), which
 *     lives INSIDE the scroller and is pinned with `position: sticky`;
 *   - the studio's TAB row, `.nb-studio-tabs`, the only way between "this book"
 *     and "this library" — 4.5k pixels of book knobs used to bury it.
 *
 * Geometry alone is not enough. A sticky strip with no background stays inside
 * the box and still fails the reader, because the cards scroll THROUGH it and
 * the click lands on a card. So every check is two questions:
 *
 *   1. is the control's box still inside the panel's visible box?
 *   2. does a click at the control's centre actually hit the control?
 *
 * Both are asked at the top of the scroll and again at the very bottom, and a
 * panel that does not actually overflow by MIN_OVERFLOW is reported
 * INCONCLUSIVE rather than passed — a header that was never under load proves
 * nothing at all.
 *
 * Usage: node shots-now/panel-header.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

/** Below this the body barely scrolls, so a pass proves nothing. */
const MIN_OVERFLOW = 200;

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
// Deliberately SHORT. At 900px tall some panels clear a screenful by a handful
// of pixels and never exercise the rule; 620 puts every one of them well over.
const page = await browser.newPage({
  viewport: { width: 1280, height: 620 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

/**
 * Poll, and survive a reload while polling. A shared dev server reloads the
 * page whenever anyone saves, which destroys the execution context mid-call;
 * that is a reason to look again, not a reason to fail the run.
 */
const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await page.evaluate(fn);
      if (v) return v;
    } catch (err) {
      if (!/context was destroyed|Target closed/i.test(String(err))) throw err;
    }
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`    shot qa/ui/${name}.png`);
};

/**
 * Measure one exit control against the sheet it leaves, at both ends of the
 * scroll. Runs entirely in the page so the two scroll positions are sampled on
 * the same frame as the boxes they produced.
 */
const measure = (exitSel) =>
  page.evaluate((sel) => {
    const panel = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    if (!panel) return { error: 'no open rail panel' };
    const body = panel.querySelector('.nb-rail-panel-body');
    if (!body) return { error: 'no panel body' };
    const exit = Array.from(panel.querySelectorAll(sel)).find((candidate) => {
      if (!(candidate instanceof HTMLElement)) return false;
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none';
    });
    if (!exit) return { error: `no exit matching ${sel}` };

    const overflow = body.scrollHeight - body.clientHeight;
    const sample = () => {
      const p = panel.getBoundingClientRect();
      const r = exit.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        inside: r.height > 0 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1,
        clickable: hit !== null && (hit === exit || exit.contains(hit)),
        top: Math.round(r.top),
        panelTop: Math.round(p.top),
        panelBottom: Math.round(p.bottom),
      };
    };

    body.scrollTop = 0;
    const atTop = sample();
    body.scrollTop = body.scrollHeight;
    const atBottom = sample();
    return { overflow, atTop, atBottom, scrollTop: body.scrollTop };
  }, exitSel);

const results = [];
const check = async (label, exitSel, shotName) => {
  const m = await measure(exitSel);
  if (m.error) {
    console.log(`    FAIL — ${m.error}`);
    results.push({ label, verdict: 'FAIL', why: m.error });
    return;
  }
  console.log(`    overflow ${m.overflow}px`);
  console.log(`    at top:    ${JSON.stringify(m.atTop)}`);
  console.log(`    at bottom: ${JSON.stringify(m.atBottom)}`);
  if (shotName) await shot(shotName);
  const good = (s) => s.inside && s.clickable;
  if (m.overflow < MIN_OVERFLOW) {
    console.log(
      `    INCONCLUSIVE — ${m.overflow}px < ${MIN_OVERFLOW}px of overflow, ` +
        'the header was never under load',
    );
    results.push({ label, verdict: 'INCONCLUSIVE', why: `overflow ${m.overflow}px` });
  } else if (good(m.atTop) && good(m.atBottom)) {
    console.log(`    PASS — the way out is reachable at both ends of a ${m.overflow}px scroll`);
    results.push({ label, verdict: 'PASS' });
  } else {
    const why = !m.atBottom.inside
      ? 'the exit scrolled out of the panel box'
      : !m.atBottom.clickable
        ? 'the exit is inside the box but content is on top of it'
        : 'the exit is unreachable at the top of the scroll';
    console.log(`    FAIL — ${why}`);
    results.push({ label, verdict: 'FAIL', why });
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
// Poll for the bridge rather than assuming it: `__shelfDesign` and this one are
// handed out at different points in the world's boot, and on a dev server that
// has just served an HMR update the gap is wide enough to lose the race.
await poll(() => typeof globalThis.__shelfSeedBooks === 'function', 60000, 'seed bridge');
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice', 'Watercolor Basics'], 0),
);
await page.waitForTimeout(1600);

/* 1 — the shelf studio: the longest panel in the app --------------------- */

/**
 * Open the shelf's studio, and notice if it is not there. A save by anyone
 * sharing this dev server reloads the page and takes the open sheet with it,
 * so "is it still up?" has to be asked rather than assumed.
 */
const openStudio = async () => {
  if (await page.locator('.nb-library-studio').isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /studio/i }).first().click();
  await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
  await page.waitForTimeout(1400);
};

console.log('\n1. library studio — the sheet header (×)');
await openStudio();
await check('library studio · ×', '.nb-rail-panel-close', 'panelhdr-01-studio-bottom');

/* 2 — a submenu: the "more…" sheet that takes the panel over ------------- */

console.log('\n2. a long submenu — the picker head (back)');
await openStudio();
const more = page.locator('.nb-rail-panel button.nb-strip-more').first();
await more.waitFor({ timeout: 20000 });
await more.scrollIntoViewIfNeeded();
await more.click();
await page.locator('.nb-pick:visible').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(900);
// Expand past the 24-card cap so the sheet is as long as a reader can make it.
const showAll = page.locator('.nb-pick:visible .nb-more:visible').first();
if (await showAll.count()) {
  await showAll.scrollIntoViewIfNeeded();
  await showAll.click();
  await page.waitForTimeout(2500);
}
await check('picker · back', '.nb-pick-back', 'panelhdr-02-picker-bottom');
console.log('   and the sheet × on the same scroll:');
await check('picker · ×', '.nb-rail-panel-close', null);

/* 3 — the book view's own rail panels ------------------------------------ */

console.log('\n3. open a book');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
// Through app state, not by clicking a spine: the shelf canvas swallows the
// a11y button's pointer events, and opening the book is not what is under test.
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(2200);

const openTool = async (tool) => {
  const button = page.locator(`.nb-rail-button[data-tool="${tool}"]`);
  if ((await button.count()) === 0) return false;
  await button.click();
  // A toggle: if the press landed while the previous sheet was still leaving,
  // it can close instead of open. Poll for the sheet, and press again once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForSelector('.nb-rail-panel[aria-hidden="false"]', { timeout: 4000 });
      await page.waitForTimeout(1200);
      return true;
    } catch {
      await button.click();
    }
  }
  return false;
};
const closePanel = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
};

for (const [n, tool, label] of [
  ['4', 'catalogue', 'catalogue'],
  ['5', 'customize', 'book studio'],
  ['6', 'toc', 'table of contents'],
]) {
  console.log(`\n${n}. book view — ${label}`);
  if (!(await openTool(tool))) {
    console.log('    skipped — no such rail tool in this build');
    continue;
  }
  await check(`${label} · ×`, '.nb-rail-panel-close', `panelhdr-0${n}-${tool}`);
  // The studio's two tabs are its own way back to the other half.
  if (tool === 'customize') {
    console.log('   and the tab row that switches halves:');
    await check('book studio · tabs', '.nb-studio-tabs', null);
  }
  await closePanel();
}

/* 7 — the book studio's own submenu -------------------------------------- */

console.log('\n7. book view — a binding submenu inside the studio');
if (await openTool('customize')) {
  const bookMore = page.locator('.nb-rail-panel button.nb-strip-more').first();
  if (await bookMore.count()) {
    await bookMore.scrollIntoViewIfNeeded();
    await bookMore.click();
    await page.locator('.nb-pick:visible').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(900);
    const all = page.locator('.nb-pick:visible .nb-more:visible').first();
    if (await all.count()) {
      await all.scrollIntoViewIfNeeded();
      await all.click();
      await page.waitForTimeout(3000);
    }
    await check('book picker · back', '.nb-pick-back', 'panelhdr-07-book-picker');
    await check('book picker · ×', '.nb-rail-panel-close', null);
  } else {
    console.log('    skipped — no "more" cell in the book studio');
  }
  await closePanel();
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('  none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log('\n=== verdicts ===');
for (const r of results) {
  console.log(`  ${r.verdict.padEnd(13)} ${r.label}${r.why ? ` — ${r.why}` : ''}`);
}
const failed = results.filter((r) => r.verdict === 'FAIL');
const weak = results.filter((r) => r.verdict === 'INCONCLUSIVE');
await browser.close();
process.exit(failed.length > 0 || weak.length === results.length ? 1 : 0);
