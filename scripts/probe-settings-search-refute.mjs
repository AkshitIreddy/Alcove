/**
 * scripts/probe-settings-search-refute.mjs — an adversarial second opinion on
 * the settings search box.
 *
 * The box's own probe proves it filters. This one goes after the parts of the
 * claim that a passing filter test would not notice:
 *
 *  - how far down the paper actually goes, and whether the field is still
 *    HIT-TESTABLE there rather than merely painted (a sticky header under a
 *    later stacking context looks fine in a screenshot and eats every click);
 *  - whether a reader can type at the far end and get an answer;
 *  - whether every chapter of the sheet is findable, not just the four the
 *    first probe happened to name;
 *  - whether a narrowed shortcut list leaves its group headings behind;
 *  - whether the box survives a short window, where the header has less room.
 *
 * Usage: node scripts/probe-settings-search-refute.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

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

const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(150);
  }
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const visibleRows = () =>
  page.evaluate(() => {
    const seen = (el) => el.getClientRects().length > 0;
    const sheet = document.querySelector('.nbs-sheet');
    return {
      rows: [...sheet.querySelectorAll('.nbs-row')]
        .filter(seen)
        .map((r) => r.querySelector('.nbs-row-label')?.textContent?.trim() ?? '?'),
      sections: [...sheet.querySelectorAll('.nbs-section')]
        .filter(seen)
        .map((s) => s.querySelector('.nbs-section-title')?.textContent?.trim() ?? '?'),
      keys: [...sheet.querySelectorAll('.nbs-keys-item')].filter(seen).length,
      keyGroups: [...sheet.querySelectorAll('.nbs-keys-group')]
        .filter(seen)
        .map((p) => p.querySelector('.nbs-keys-group-title')?.textContent?.trim() ?? '?'),
      field: document.querySelector('.nbs-find-input')?.value ?? null,
    };
  });

const type = async (q) => {
  await page.locator('.nbs-find-input').fill(q);
  await poll((want) => document.querySelector('.nbs-find-input')?.value === want, q);
  await page.waitForTimeout(150);
  return visibleRows();
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('the shelf never handed out its QA bridges');
}
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(900);

await page.locator('.nbs-gear-button').click();
await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});

/* 1 — how long is the paper, really --------------------------------------- */

console.log('\n1. the length of the sheet, and whether the field survives it');
const paper = await page.evaluate(() => {
  const sheet = document.querySelector('.nbs-sheet');
  return { scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight };
});
console.log('  sheet:', JSON.stringify(paper));
check('the sheet really is thousands of pixels long', paper.scrollHeight > 3000, `${paper.scrollHeight}px`);

await page.evaluate(() => {
  const sheet = document.querySelector('.nbs-sheet');
  sheet.scrollTop = sheet.scrollHeight;
});
await page.waitForTimeout(400);

// Painted is not the same as reachable. Ask the document what is actually on
// top of the middle of the field: a sticky header that a later stacking
// context has covered still screenshots perfectly.
const atTheEnd = await page.evaluate(() => {
  const sheet = document.querySelector('.nbs-sheet');
  const input = document.querySelector('.nbs-find-input');
  const r = input.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    scrolled: Math.round(sheet.scrollTop),
    fromEnd: Math.round(sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop),
    top: Math.round(r.top),
    hit: hit === null ? null : hit.className || hit.tagName,
    hitsTheField: hit !== null && (hit === input || input.contains(hit) || hit.closest('.nbs-find-box') !== null),
  };
});
console.log('  at the far end:', JSON.stringify(atTheEnd));
check('the sheet was scrolled to its actual end', atTheEnd.fromEnd <= 2, `${atTheEnd.fromEnd}px left`);
check('the field is on screen there', atTheEnd.top > 0 && atTheEnd.top < 200, `top ${atTheEnd.top}`);
check('and a click at that point lands on the field, not on paper over it', atTheEnd.hitsTheField, String(atTheEnd.hit));

// …and it takes a real click and real keystrokes from there.
await page.locator('.nbs-find-input').click();
await page.keyboard.type('cursor', { delay: 20 });
await page.waitForTimeout(250);
const fromTheEnd = await visibleRows();
console.log('  after typing at the far end:', JSON.stringify(fromTheEnd.rows));
check('typing from the far end reaches the field', fromTheEnd.field === 'cursor');
check('and narrows the sheet', fromTheEnd.rows.length > 0 && fromTheEnd.rows.length < 20, `${fromTheEnd.rows.length} rows`);
await page.screenshot({ path: 'qa/ui/refute-search-01-typed-from-the-end.png' });
console.log('  shot qa/ui/refute-search-01-typed-from-the-end.png');

/* 2 — every chapter is findable ------------------------------------------- */

console.log('\n2. every chapter of the sheet answers to a word');
await type('');
const chapters = await page.evaluate(() =>
  [...document.querySelectorAll('.nbs-sheet .nbs-section-title')].map((h) => h.textContent.trim()),
);
console.log('  chapters:', JSON.stringify(chapters));
for (const title of chapters) {
  const hit = await type(title.toLowerCase());
  check(`"${title.toLowerCase()}" finds its chapter`, hit.sections.includes(title), hit.sections.join(', ') || 'nothing');
}

/* 3 — a narrowed shortcut list leaves no orphan headings ------------------ */

console.log('\n3. the shortcut list narrows headings and all');
const whole = await type('');
console.log(`  at rest: ${whole.keys} shortcut rows under ${whole.keyGroups.length} headings`);
const cat = await type('catalogue');
console.log('  narrowed:', cat.keys, 'rows under', JSON.stringify(cat.keyGroups));
check('one shortcut row is left', cat.keys === 1, String(cat.keys));
check('and exactly one heading with it', cat.keyGroups.length === 1, cat.keyGroups.join(', '));
const nothing = await type('zzzqqq');
check('a dead search leaves no shortcut heading behind', nothing.keyGroups.length === 0, nothing.keyGroups.join(', '));

/* 4 — words a reader would actually reach for ----------------------------- */

console.log('\n4. words the first probe did not try');
// A picker under a live query is drawn as its SHELVES, so the row on screen
// is "the plain inks" and not "ink" — the row label to look for is the shelf's.
for (const [word, want] of [
  ['color', 'the plain inks'],
  ['colour', 'the plain inks'],
  ['SOUND', 'master volume'],
  ['spellcheck', 'spellcheck'],
  ['  autosave  ', 'autosave every'],
  ['font', 'body size'],
]) {
  const hit = await type(word);
  check(`"${word.trim()}" finds "${want}"`, hit.rows.includes(want), hit.rows.slice(0, 6).join(', ') || 'nothing');
}
// The two spellings have to land on the same paper, or `fold`'s colour→color
// rule is decorative.
const enGb = await type('colour');
const enUs = await type('color');
check(
  'colour and color find the same rows',
  JSON.stringify(enGb.rows) === JSON.stringify(enUs.rows),
  `${enGb.rows.length} vs ${enUs.rows.length}`,
);

/* 5 — a short window, where the header has least room --------------------- */

console.log('\n5. a short window');
await type('');
await page.setViewportSize({ width: 1024, height: 620 });
await page.waitForTimeout(500);
const short = await page.evaluate(() => {
  const input = document.querySelector('.nbs-find-input');
  const r = input.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    top: Math.round(r.top),
    onScreen: r.top >= 0 && r.bottom <= innerHeight && r.width > 60,
    hits: hit !== null && (hit === input || hit.closest('.nbs-find-box') !== null),
  };
});
console.log('  field in a 1024x620 window:', JSON.stringify(short));
check('the field is still whole and clickable in a short window', short.onScreen && short.hits);
await page.evaluate(() => {
  const sheet = document.querySelector('.nbs-sheet');
  sheet.scrollTop = sheet.scrollHeight;
});
await page.waitForTimeout(300);
const shortEnd = await page.evaluate(() => {
  const r = document.querySelector('.nbs-find-input').getBoundingClientRect();
  return { top: Math.round(r.top), onScreen: r.top >= 0 && r.bottom <= innerHeight };
});
console.log('  …and at the end of the sheet:', JSON.stringify(shortEnd));
check('still there at the far end of a short window', shortEnd.onScreen);
await page.screenshot({ path: 'qa/ui/refute-search-02-short-window-end.png' });
console.log('  shot qa/ui/refute-search-02-short-window-end.png');

/* ------------------------------------------------------------------------ */

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
