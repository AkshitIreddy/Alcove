/**
 * scripts/probe-inout.mjs — the "In and out" sheet, driven the only way that
 * proves a reader can use it: BY CLICKING EVERY ROW.
 *
 * Four rail icons were folded onto this one sheet — insert script, export
 * script, copy AI spec, start from a template — after the reader asked for
 * *"insert, copy AI spec, export things"* to be one setting instead of
 * several. Consolidating is the shape of change that breaks things silently:
 * a flow keeps its module, its unit tests and its shortcut while the row that
 * was supposed to run it calls nothing. So this presses all eight rows and
 * checks what each one actually did — a dialog on screen, a file downloaded,
 * a book opened, text really on the clipboard.
 *
 * The dev bridge (`window.__nbGroupD`) is deleted before anything is clicked,
 * for the reason `probe-groupd.mjs` explains at length: four features once
 * passed their whole e2e suite through it while being unreachable.
 *
 * Usage: node scripts/probe-inout.mjs [--url=http://localhost:1420]
 *                                     [--out=qa/ui] [--dpr=1]
 *
 * `--dpr=3` is how you LOOK at the rail: ten 24px glyphs on 40px buttons say
 * nothing at 1×, and `inout-01b-rail-close.png` is the shot that shows whether
 * the new tray icon reads as "in and out" or as a smudge.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = opt('out', 'qa/ui');
const DPR = Number(opt('dpr', '1')) || 1;
mkdirSync(OUT, { recursive: true });

const MD_PATH = join(tmpdir(), 'nb-probe-inout.md');
writeFileSync(MD_PATH, '# Probe Chapter One\n\nBody.\n', 'utf8');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
/*
 * Clipboard permission, granted up front. Two of the eight rows END at
 * `navigator.clipboard.writeText`, and a headless context that has not been
 * granted it fails the write — so the toast reads "could not reach the
 * clipboard" and the probe cannot tell a denied permission from a row that
 * runs nothing. With the grant, the toast IS the assertion.
 */
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: DPR,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(150);
  }
};
const shot = async (name) => {
  await page.waitForTimeout(650);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${OUT}/${name}.png`);
};
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/* ------------------------------- arrive --------------------------------- */
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('no QA bridges');
}
await page.evaluate(() => {
  delete globalThis.__nbGroupD;
  Object.defineProperty(globalThis, '__nbGroupD', {
    get: () => undefined,
    set: () => undefined,
    configurable: true,
  });
});
check('the dev bridge is gone before anything is clicked', await page.evaluate(() => globalThis.__nbGroupD === undefined));

const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(900);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice'], 0));
// Polled, not slept: at deviceScaleFactor 3 the shelf takes visibly longer to
// paint, and a fixed wait made this probe fail on the machine it was written on.
if ((await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, 60000)) === null) {
  throw new Error('no books on the plank after seeding');
}
await page.waitForTimeout(900);

/* open a book the reader's way */
{
  const spine = await page.evaluate(() => {
    const book = globalThis.__shelfVisibleBooks()[0];
    const rect = globalThis.__shelfSpineRect(book.id);
    return rect === null ? null : { title: book.title, ...rect };
  });
  if (spine === null) throw new Error('no book on the plank');
  const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
  await page.mouse.click(canvas.x + spine.x + spine.width / 2, canvas.y + spine.y + spine.height / 2);
}
await page.locator('[data-testid="pulled-book"][role="button"]').click();
if ((await poll(() => document.querySelector('.nb-rail') !== null, null, 60000)) === null) {
  throw new Error('the book never opened');
}
await page.waitForTimeout(1400);

/* ------------------------------ the rail -------------------------------- */
console.log('\n1. the rail');
const tools = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-rail-button')].map((b) => b.dataset.tool),
);
console.log('  rail tools:', tools.join(', '));
check('ten buttons, not fourteen', tools.length === 10, `${tools.length}`);
for (const gone of ['insert', 'export', 'spec', 'templates']) {
  check(`'${gone}' is no longer its own icon`, !tools.includes(gone));
}
check('the divider still renders', await page.evaluate(() => document.querySelectorAll('.nb-rail-divider').length === 1));
check(
  'the tray button has a tooltip, not a title=',
  await page.evaluate(() => {
    const b = document.querySelector('.nb-rail-button[data-tool="share"]');
    return b !== null && b.hasAttribute('data-tooltip') && !b.hasAttribute('title');
  }),
);
await shot('inout-01-rail');
{
  // The rail alone: ten 24px glyphs on a 40px button are the one thing in this
  // change a full-window shot cannot show you. Run with --dpr=3 to read it.
  const box = await page.locator('.nb-rail').boundingBox();
  await page.screenshot({
    path: `${OUT}/inout-01b-rail-close.png`,
    clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 },
  });
  console.log(`  shot ${OUT}/inout-01b-rail-close.png`);
}

/* ------------------------------ the sheet ------------------------------- */
console.log('\n2. the sheet');
const openSheet = async () => {
  const up = await page.evaluate(
    () =>
      document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null,
  );
  if (!up) {
    await page.locator('.nb-rail-button[data-tool="share"]').click();
    await poll(
      () =>
        document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null,
    );
    await page.waitForTimeout(450);
  }
};
await openSheet();
const title = await page.evaluate(
  () => document.querySelector('.nb-rail-panel[aria-hidden="false"] .nb-rail-panel-title')?.textContent,
);
check('it is called "In and out"', title === 'In and out', title ?? 'nothing');
const groups = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-share-group')].map((g) => ({
    id: g.dataset.shareGroup,
    heading: g.querySelector('.nb-panel-section-title')?.textContent ?? '',
    rows: [...g.querySelectorAll('.nb-share-row')].map((r) => r.dataset.share),
  })),
);
console.log('  groups:', JSON.stringify(groups, null, 2));
check('three labelled groups, in reading order', groups.map((g) => g.id).join(',') === 'in,out,ai');
check('bring in holds the three ways in', groups[0]?.rows.join(',') === 'insert,markdown,templates');
check('take out holds the three ways out', groups[1]?.rows.join(',') === 'pdf,png,parcel');
check('for an AI holds the pair', groups[2]?.rows.join(',') === 'spec,script');
check(
  'the exit is top-left of the sheet',
  await page.evaluate(() => {
    const sheet = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    const close = sheet?.querySelector('.nb-rail-panel-close');
    const head = sheet?.querySelector('.nb-rail-panel-header');
    if (!close || !head) return false;
    const c = close.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return c.left - h.left < h.width / 2 && c.top - h.top < 40;
  }),
);
check(
  'the header stays pinned outside the scroller',
  await page.evaluate(() => {
    const sheet = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    return sheet?.querySelector('.nb-rail-panel-header')?.parentElement === sheet;
  }),
);
check(
  'no row carries a native title=',
  await page.evaluate(() => [...document.querySelectorAll('.nb-share-row')].every((r) => !r.hasAttribute('title'))),
);
const caps = await page.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll('.nb-share-row')].map((r) => [
      r.dataset.share,
      r.querySelector('.nb-share-row-key')?.textContent ?? '',
    ]),
  ),
);
console.log('  key caps:', JSON.stringify(caps));
check(
  'every row but the spec draws its key',
  Object.entries(caps).every(([id, cap]) => (id === 'spec' ? cap === '' : cap.length > 0)),
);
await shot('inout-02-sheet');

/* --------------------------- every row, clicked -------------------------- */
console.log('\n3. bring in — paste a script');
await openSheet();
await page.locator('.nb-share-row[data-share="insert"]').click();
check('the paste box opens', (await poll(() => document.querySelector('.nb-ins-card') !== null)) !== null);
check('and the sheet got out of its way', await page.evaluate(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') === null));
await shot('inout-03-insert');
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-ins-card') === null);

console.log('\n4. bring in — Markdown');
await openSheet();
await page.locator('.nb-share-row[data-share="markdown"]').click();
check('a file picker appears', (await poll(() => document.querySelector('input[data-nb-import]') !== null)) !== null);
await page.locator('input[data-nb-import]').setInputFiles(MD_PATH);
const opened = await poll(
  (want) => (document.querySelector('.nb-book-title-plate')?.textContent === want ? want : null),
  'Probe Chapter One',
  60000,
);
check('and the imported book opens', opened !== null, opened ?? 'never opened');
await shot('inout-04-markdown');

console.log('\n5. bring in — a template');
await openSheet();
await page.locator('.nb-share-row[data-share="templates"]').click();
const cards = await poll(() => {
  const n = document.querySelectorAll('.nb-tpl-card').length;
  return n > 0 ? n : null;
});
check('the gallery opens', cards !== null, `${cards ?? 0} cards`);
check(
  'and inside a book it offers "add pages here"',
  (await page.locator('.nb-tpl-card button', { hasText: 'add pages here' }).count()) > 0,
);
await shot('inout-05-templates');
await page.locator('.nb-tpl-gallery .nb-ins-close').click();
await poll(() => document.querySelector('.nb-tpl-gallery') === null);

console.log('\n6. take out — PDF');
await openSheet();
await page.locator('.nb-share-row[data-share="pdf"]').click();
const pdf = await poll(() => document.querySelectorAll('.nb-pdf-choice').length);
check('the page-or-book chooser opens', pdf === 2, `${pdf ?? 0} choices`);
await shot('inout-06-pdf');
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-pdf-card') === null);

console.log('\n7. take out — a picture');
await openSheet();
const pngDownload = page.waitForEvent('download', { timeout: 120000 });
await page.locator('.nb-share-row[data-share="png"]').click();
const pngFile = await pngDownload.catch(() => null);
check('the row writes a PNG', pngFile !== null && /\.png$/.test(pngFile.suggestedFilename()), pngFile?.suggestedFilename() ?? 'no download');

console.log('\n8. take out — the parcel desk');
await openSheet();
await page.locator('.nb-share-row[data-share="parcel"]').click();
check('the parcel desk opens', (await poll(() => document.querySelector('.nb-tr-sheet, .nb-tr-panel, [class*="nb-tr-"]') !== null)) !== null);
await shot('inout-07-parcel');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

console.log('\n9. for an AI — the format');
await openSheet();
await page.locator('.nb-share-row[data-share="spec"]').click();
const specToast = await poll(() => document.querySelector('.nb-script-toast')?.textContent ?? null);
check('a toast says the spec was copied', specToast !== null && /spec copied/i.test(specToast), specToast ?? 'no toast');
{
  // The whole point of the row: what is ON the clipboard has to be the format,
  // not a page or an empty string.
  const text = await clipboard().catch(() => '');
  check('and the Notebook Script spec really is on the clipboard', text.length > 2000 && /Notebook Script/i.test(text), `${text.length} chars`);
}
await shot('inout-08-spec-toast');
await page.waitForTimeout(2600);

console.log('\n10. for an AI — this page as script');
await openSheet();
await page.locator('.nb-share-row[data-share="script"]').click();
const scriptToast = await poll(() => document.querySelector('.nb-script-toast')?.textContent ?? null);
check('a toast says the page was copied', scriptToast !== null && /script copied/i.test(scriptToast), scriptToast ?? 'no toast');
{
  const text = await clipboard().catch(() => '');
  check('and it is this page, not the spec', text.length > 0 && !/Notebook Script Spec/i.test(text), `${text.slice(0, 60).replace(/\n/g, ' ')}…`);
}
await page.waitForTimeout(2600);

console.log('\n11. the shortcuts still work with the icons gone');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.mouse.click(18, 870);
await page.waitForTimeout(200);
await page.keyboard.press('Control+Alt+KeyI');
check('Ctrl+Alt+I still opens the paste box', (await poll(() => document.querySelector('.nb-ins-card') !== null)) !== null);
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-ins-card') === null);

await page.mouse.click(18, 870);
await page.keyboard.press('Control+Alt+KeyG');
check('Ctrl+Alt+G still opens the gallery', (await poll(() => document.querySelectorAll('.nb-tpl-card').length > 0)) !== null);
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-tpl-gallery') === null);

await page.mouse.click(18, 870);
await page.keyboard.press('Control+Alt+KeyP');
check('Ctrl+Alt+P still opens the PDF chooser', (await poll(() => document.querySelectorAll('.nb-pdf-choice').length === 2)) !== null);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/*
 * 12 — the app's own minimum window (src-tauri/tauri.conf.json). Eight rows
 * plus a footnote do not fit 620px, and the sheet's contract is that the
 * header — the way out — never leaves the screen when the body scrolls.
 */
console.log('\n12. the smallest window this app opens in');
await page.setViewportSize({ width: 960, height: 620 });
await page.waitForTimeout(700);
await openSheet();
await shot('inout-09-small-top');
const scrolled = await page.evaluate(() => {
  const sheet = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
  const body = sheet?.querySelector('.nb-rail-panel-body');
  if (!body) return null;
  body.scrollTop = body.scrollHeight;
  const head = sheet.querySelector('.nb-rail-panel-header').getBoundingClientRect();
  return { overflows: body.scrollHeight > body.clientHeight + 4, headTop: head.top, headBottom: head.bottom };
});
check('the sheet really overflows at 620px', scrolled?.overflows === true, JSON.stringify(scrolled));
check(
  'and the header is still on screen at the bottom of the scroll',
  scrolled !== null && scrolled.headTop >= 0 && scrolled.headBottom < 620,
  JSON.stringify(scrolled),
);
await shot('inout-10-small-scrolled');

console.log('\n13. a dark room');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(500);
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
await page.waitForTimeout(500);
await openSheet();
await shot('inout-11-dark');
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

/* ------------------------------- verdict -------------------------------- */
console.log(`\n== ${fails.length === 0 ? 'ALL GOOD' : `${fails.length} FAILED`} ==`);
for (const f of fails) console.log(`  - ${f}`);
if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
