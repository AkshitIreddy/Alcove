/**
 * scripts/probe-groupd.mjs — the four flows that had no button, driven the
 * only way that proves they have one now: BY CLICKING.
 *
 * `tests/e2e/import-export.spec.ts` has covered all four since the day they
 * were written, and every one of them was unreachable the whole time — the
 * spec drives `window.__nbGroupD`, the dev bridge group D put up "before the
 * rail buttons are wired". The buttons were never wired. A green spec said
 * nothing about whether a reader could get there.
 *
 * So the FIRST thing this file does is DELETE THE BRIDGE. Everything after
 * that is pointer input against the real chrome: the shelf's dock, the shelf's
 * right-click card, the book rail's two new icons, the "Take it out" sheet and
 * the settings sheet's "Library files" section. If any of it still works, it
 * works because a control exists.
 *
 * The keyboard half is proved the same way (the combinations, not the
 * registry) — `tests/plugged-in.test.ts` part three holds the registry.
 *
 * Usage: node scripts/probe-groupd.mjs [--url=http://localhost:1420]
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

mkdirSync('qa/ui', { recursive: true });

const MD_PATH = join(tmpdir(), 'nb-probe-groupd.md');
writeFileSync(
  MD_PATH,
  '# Probe Chapter One\n\nBody of the first chapter.\n\n# Probe Chapter Two\n\nAnd the second.\n',
  'utf8',
);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
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
  await page.waitForTimeout(700);
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/** The bridge must stay gone for the whole run — see the docblock. */
const bridgeGone = () => page.evaluate(() => globalThis.__nbGroupD === undefined);

const galleryUp = () =>
  page.evaluate(() => document.querySelectorAll('.nb-tpl-card').length);

const closeGallery = async () => {
  await page.locator('.nb-tpl-gallery .nb-ins-close').click();
  await poll(() => document.querySelector('.nb-tpl-gallery') === null);
};

/* ------------------------------- arrive --------------------------------- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('the shelf never handed out its QA bridges');
}
// THE point of this probe. Everything below has to work without it.
await page.evaluate(() => {
  delete globalThis.__nbGroupD;
  Object.defineProperty(globalThis, '__nbGroupD', {
    get: () => undefined,
    set: () => undefined,
    configurable: true,
  });
});
check('the dev bridge is gone before anything is clicked', await bridgeGone());

const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1000);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice'], 0));
await page.waitForTimeout(1400);

/* 1 — the templates gallery, from the shelf dock -------------------------- */

console.log('\n1. the shelf dock opens the templates gallery');
await page.locator('[data-shelf-dock="templates"]').click();
const cards = await poll(() => {
  const n = document.querySelectorAll('.nb-tpl-card').length;
  return n > 0 ? n : null;
});
check('the dock button opens the gallery', cards !== null, `${cards ?? 0} cards`);
check('all five templates are on it', cards === 5, `${cards ?? 0}`);
await shot('groupd-01-templates-from-dock');
await closeGallery();

/* 2 — and the bare-plank right-click card --------------------------------- */

console.log('\n2. right-clicking bare plank offers it too');
// Well right of the books seeded on floor 0, but still on the case.
await page.mouse.click(980, 300, { button: 'right' });
const spot = await poll(
  () => document.querySelector('[data-shelf-spot="from-template"]') !== null,
);
check('the spot menu carries "From a template…"', spot !== null);
if (spot !== null) {
  await shot('groupd-02-spot-menu');
  await page.locator('[data-shelf-spot="from-template"]').click();
  check(
    'and it opens the gallery',
    (await poll(() => document.querySelectorAll('.nb-tpl-card').length > 0)) !== null,
  );
  await closeGallery();
} else {
  await page.keyboard.press('Escape');
}

/* 3 — the keyboard, on the shelf ------------------------------------------ */

console.log('\n3. Ctrl+Alt+G, on the shelf');
await page.mouse.click(1300, 120);
await page.waitForTimeout(200);
await page.keyboard.press('Control+Alt+KeyG');
check(
  'the shortcut opens the gallery from the shelf',
  (await poll(() => document.querySelectorAll('.nb-tpl-card').length > 0)) !== null,
);
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-tpl-gallery') === null);

/* 4 — into a book, and the rail's two new icons --------------------------- */

/*
 * Opened the READER's way — off the plank and out of the hand — rather than
 * with the dev view switcher. The switcher only flips `viewState`, so
 * `appState.openBookId` stays null and the gallery's second verb ("add pages
 * here", which needs to know WHICH book) never appears. That difference is
 * exactly the sort of thing a probe exists to notice.
 */
console.log('\n4. take a book off the shelf and read it');
{
  // The spine is painted on the Pixi canvas, so it has no DOM box to aim at.
  // `__shelfSpineRect` publishes CANVAS-LOCAL coordinates (world.ts), which is
  // why the canvas's own origin is added back here.
  const spine = await page.evaluate(() => {
    const book = globalThis.__shelfVisibleBooks()[0];
    const rect = globalThis.__shelfSpineRect(book.id);
    return rect === null ? null : { title: book.title, ...rect };
  });
  if (spine === null) throw new Error('no book on the plank to take out');
  const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
  console.log(`  clicking the spine of "${spine.title}"`);
  await page.mouse.click(
    canvas.x + spine.x + spine.width / 2,
    canvas.y + spine.y + spine.height / 2,
  );
}
if ((await poll(() => document.querySelector('[data-testid="pulled-book"]') !== null, null, 30000)) === null) {
  throw new Error('the book never came off the plank');
}
await page.waitForTimeout(1200);
await page.locator('[data-testid="pulled-book"][role="button"]').click();
if ((await poll(() => document.querySelector('.nb-rail') !== null, null, 60000)) === null) {
  throw new Error('the book never opened');
}
await page.waitForTimeout(1400);
console.log(
  '  rail tools:',
  (
    await page.evaluate(() =>
      [...document.querySelectorAll('.nb-rail-button')].map((b) => b.dataset.tool),
    )
  ).join(', '),
);

console.log('\n4a. the rail template icon');
await page.locator('.nb-rail-button[data-tool="templates"]').click();
check(
  'the rail opens the gallery',
  (await poll(() => document.querySelectorAll('.nb-tpl-card').length > 0)) !== null,
);
check(
  'and inside a book it also offers "add pages here"',
  (await page.locator('.nb-tpl-card button', { hasText: 'add pages here' }).count()) > 0,
);
await shot('groupd-03-templates-in-book');
await closeGallery();

/* 5 — "Take it out": the sheet, and the PDF chooser ----------------------- */

console.log('\n5. the "Take it out" sheet');
await page.locator('.nb-rail-button[data-tool="share"]').click();
const sheet = await poll(() => {
  const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
  return el === null ? null : (el.querySelector('.nb-rail-panel-title')?.textContent ?? '?');
});
check('the rail opens it', sheet === 'Take it out', sheet ?? 'nothing opened');
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-share-row')].map((r) => r.dataset.share),
);
console.log('  rows:', rows.join(', '));
check(
  'it holds both exports and the import',
  ['pdf', 'png', 'script', 'markdown', 'parcel'].every((id) => rows.includes(id)),
  rows.join(', '),
);
check(
  'every row carries a key cap, not a bare label',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nb-share-row')].every(
      (r) => (r.querySelector('.nb-share-row-key')?.textContent ?? '').length > 0,
    ),
  ),
);
await shot('groupd-04-share-sheet');

console.log('\n5a. the PDF chooser');
await page.locator('.nb-share-row[data-share="pdf"]').click();
const pdf = await poll(() => document.querySelectorAll('.nb-pdf-choice').length);
check('it opens the page-or-book chooser', pdf === 2, `${pdf ?? 0} choices`);
await shot('groupd-05-pdf-chooser');
const pdfDownload = page.waitForEvent('download', { timeout: 120000 });
await page.locator('.nb-pdf-choice[data-scope="page"]').click();
const pdfFile = await pdfDownload.catch(() => null);
check(
  'and "this page" really writes a PDF',
  pdfFile !== null && /\.pdf$/.test(pdfFile.suggestedFilename()),
  pdfFile?.suggestedFilename() ?? 'no download',
);

/* 6 — the page as a picture ----------------------------------------------- */

console.log('\n6. the page as a picture');
await page.locator('.nb-rail-button[data-tool="share"]').click();
await poll(() => document.querySelector('.nb-share-row[data-share="png"]') !== null);
const pngDownload = page.waitForEvent('download', { timeout: 120000 });
await page.locator('.nb-share-row[data-share="png"]').click();
const pngFile = await pngDownload.catch(() => null);
check(
  'the row writes a PNG',
  pngFile !== null && /\.png$/.test(pngFile.suggestedFilename()),
  pngFile?.suggestedFilename() ?? 'no download',
);

/* 7 — Markdown in, from the same sheet ------------------------------------ */

console.log('\n7. Markdown in, from the same sheet');
await page.locator('.nb-share-row[data-share="markdown"]').click();
const input = await poll(
  () => document.querySelector('input[data-nb-import]') !== null,
);
check('the row opens a file picker', input !== null);
if (input !== null) {
  await page.locator('input[data-nb-import]').setInputFiles(MD_PATH);
  // Polled for the EXPECTED title, not for "a title": the plate already reads
  // the book we came in on, and `poll` returns the first truthy answer.
  const opened = await poll(
    (want) =>
      document.querySelector('.nb-book-title-plate')?.textContent === want
        ? want
        : null,
    'Probe Chapter One',
    60000,
  );
  check(
    'the file becomes a book, and the book opens',
    opened !== null,
    opened ??
      (await page.evaluate(
        () => document.querySelector('.nb-book-title-plate')?.textContent ?? 'nothing',
      )),
  );
  await shot('groupd-06-imported-markdown');
}

/* 8 — the same import from the settings sheet ----------------------------- */

console.log('\n8. and from the settings sheet');
await page.locator('.nbs-gear-button').click();
await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});
const row = page.locator('.nbs-row', { hasText: 'import Markdown' });
await row.scrollIntoViewIfNeeded();
check('"Library files" carries an import Markdown row', (await row.count()) > 0);
await shot('groupd-07-settings-library-files');
await row.getByRole('button', { name: /choose files/i }).click();
check(
  'and it reaches the same picker',
  (await poll(() => document.querySelector('input[data-nb-import]') !== null)) !== null,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

/* 9 — the keyboard, in a book --------------------------------------------- */

console.log('\n9. the shortcuts, in a book');
await page.mouse.click(18, 870);
await page.waitForTimeout(250);
console.log(
  '  live commands:',
  (await page.evaluate(() => globalThis.__shelfCommands?.() ?? [])).join(', '),
);
await page.keyboard.press('Control+Alt+KeyP');
check(
  'Ctrl+Alt+P opens the PDF chooser',
  (await poll(() => document.querySelectorAll('.nb-pdf-choice').length === 2)) !== null,
);
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-pdf-card') === null);

await page.mouse.click(18, 870);
await page.keyboard.press('Control+Alt+KeyG');
check(
  'Ctrl+Alt+G opens the gallery inside a book too',
  (await poll(() => document.querySelectorAll('.nb-tpl-card').length > 0)) !== null,
);
await page.keyboard.press('Escape');
await poll(() => document.querySelector('.nb-tpl-gallery') === null);

await page.mouse.click(18, 870);
const keyPng = page.waitForEvent('download', { timeout: 120000 });
await page.keyboard.press('Control+Shift+Alt+KeyP');
const keyPngFile = await keyPng.catch(() => null);
check(
  'Ctrl+Shift+Alt+P writes the picture',
  keyPngFile !== null && /\.png$/.test(keyPngFile.suggestedFilename()),
  keyPngFile?.suggestedFilename() ?? 'no download',
);

await page.mouse.click(18, 870);
await page.keyboard.press('Control+Shift+Alt+KeyM');
check(
  'Ctrl+Shift+Alt+M opens the Markdown picker',
  (await poll(() => document.querySelector('input[data-nb-import]') !== null)) !== null,
);

/* 10 — the rail still fits a short window -------------------------------- */

console.log('\n10. fourteen icons in a short window');
await page.setViewportSize({ width: 1280, height: 620 });
await page.waitForTimeout(800);
const rail = await page.evaluate(() => {
  const el = document.querySelector('.nb-rail');
  if (el === null) return null;
  const box = el.getBoundingClientRect();
  const first = document.querySelector('.nb-rail-button');
  const last = [...document.querySelectorAll('.nb-rail-button')].at(-1);
  return {
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    scrolls: el.scrollHeight > el.clientHeight + 1,
    firstReachable: first.getBoundingClientRect().height > 0,
    lastReachable: last.getBoundingClientRect().height > 0,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
console.log('  rail:', JSON.stringify(rail));
check(
  'the rail stays inside the window',
  rail !== null && rail.top >= 0 && rail.bottom <= 620,
  `${rail?.top}…${rail?.bottom}`,
);
check('every tool is still reachable', rail?.firstReachable && rail?.lastReachable);
check(
  'and it shrinks rather than scrolling',
  rail?.scrolls === false,
  rail?.scrolls === true ? 'the rail is clipped at this height' : '',
);
check('and the page itself never scrolls sideways', rail?.pageOverflow === false);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await shot('groupd-08-short-window');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(600);

/* 11 — and the reader can find out about them ---------------------------- */

console.log('\n11. the cheat sheet lists all four');
await page.mouse.click(18, 870);
await page.keyboard.press('Shift+Slash');
const card = await poll(() =>
  document.querySelector('[data-testid="cheat-sheet"]') === null
    ? null
    : [...document.querySelectorAll('.nb-cheat-row')].map((r) => ({
        keys: r.querySelector('.nb-cheat-keys')?.textContent ?? '',
        what: r.querySelector('.nb-cheat-what')?.textContent ?? '',
      })),
);
for (const [combo, phrase] of [
  ['Ctrl+Alt+G', /template/i],
  ['Ctrl+Alt+P', /PDF/i],
  ['Ctrl+Shift+Alt+P', /picture/i],
  ['Ctrl+Shift+Alt+M', /Markdown/i],
]) {
  const row = card?.find((r) => r.keys === combo);
  check(
    `the card teaches ${combo}`,
    row !== undefined && phrase.test(row.what),
    row?.what ?? 'not on the card',
  );
}
await shot('groupd-09-cheat-sheet');
await page.keyboard.press('Escape');

/* ------------------------------------------------------------------------ */

check('the dev bridge was never needed', await bridgeGone());

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
