/**
 * scripts/probe-settings-search.mjs — the settings search box, driven for real.
 *
 * A unit test can prove the matcher folds "colour" onto "color". It cannot
 * prove that a word typed into the field reaches a row, that a hit folded away
 * inside a collapsed picker gets revealed, or that Escape clears before it
 * closes — all three of those are the SHEET, not the function, and this repo
 * has shipped authored-but-unreachable code often enough to insist on the
 * difference.
 *
 * So this one only types, and asserts on what the sheet then SHOWS. Every
 * reading is `getClientRects()` against the live DOM — the applied state —
 * never the query signal, and never a module this probe imported itself (see
 * the note in CLAUDE.md: a probe's own `import()` can resolve to a second copy
 * on a dev server that has served HMR updates).
 *
 * Usage: node scripts/probe-settings-search.mjs [--url=http://localhost:1420]
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
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const poll = async (fn, arg = null, timeout = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(150);
  }
};

const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

/** One element, close up — the drawing is 440px wide inside a 1440px window. */
const shotOf = async (selector, name) => {
  await page.waitForTimeout(300);
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return;
  await el.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/**
 * What the sheet is actually showing. `getClientRects()` and not a class or an
 * attribute: the question is whether a reader can see the row, and a filtered
 * row is `display: none` through a rule in settings.css that this probe should
 * be able to catch somebody deleting.
 */
const sheetState = () =>
  page.evaluate(() => {
    const seen = (el) => el.getClientRects().length > 0;
    const text = (el, sel) => el.querySelector(sel)?.textContent?.trim() ?? '?';
    const sheet = document.querySelector('.nbs-sheet');
    if (sheet === null) return null;
    return {
      sections: [...sheet.querySelectorAll('.nbs-section')]
        .filter(seen)
        .map((s) => text(s, '.nbs-section-title')),
      rows: [...sheet.querySelectorAll('.nbs-row')]
        .filter(seen)
        .map((r) => text(r, '.nbs-row-label')),
      keys: [...sheet.querySelectorAll('.nbs-keys-item')]
        .filter(seen)
        .map((li) => text(li, '.nbs-keys-action')),
      chips: [...sheet.querySelectorAll('.nbs-seg-chip')]
        .filter(seen)
        .map((c) => c.textContent?.trim() ?? ''),
      empty: seen(document.querySelector('.nbs-find-empty') ?? document.createElement('i')),
      tally: document.querySelector('.nbs-find-tally')?.textContent ?? null,
      field: document.querySelector('.nbs-find-input')?.value ?? null,
    };
  });

const type = async (q) => {
  await page.locator('.nbs-find-input').fill(q);
  // The rows are hidden by a Solid memo, so one frame is enough — but rAF is
  // throttled under SwiftShader, so poll for the field instead of sleeping.
  await poll((want) => document.querySelector('.nbs-find-input')?.value === want, q);
  await page.waitForTimeout(120);
  return sheetState();
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

/* 1 — the box is there, drawn, and the sheet is whole behind it ------------ */

console.log('\n1. the gear opens a sheet with a search box on it');
await page.locator('.nbs-gear-button').click();
const sheetUp = await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});
check('the settings sheet opens', sheetUp !== null);

const box = await page.evaluate(() => {
  const input = document.querySelector('.nbs-find-input');
  if (input === null) return null;
  const field = input.closest('.nbs-find-box');
  const cs = getComputedStyle(field);
  return {
    placeholder: input.placeholder,
    label: input.previousElementSibling?.textContent ?? null,
    glass: field.querySelector('svg.nbs-find-icon') !== null,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
    radius: cs.borderTopLeftRadius,
    inHeader: input.closest('.nbs-header') !== null,
    sticky: getComputedStyle(document.querySelector('.nbs-header')).position,
  };
});
console.log('  field:', JSON.stringify(box));
check('there is a search field in the sheet', box !== null);
check(
  'it is drawn — hand glass, one ink outline, corners that bow',
  box !== null && box.glass && box.border.endsWith('solid') && box.radius !== '0px',
  box === null ? '' : `${box.border}, radius ${box.radius}`,
);
check('it rides in the sticky header, not at the top of 3200px of paper', box !== null && box.inHeader && box.sticky === 'sticky');

const whole = await sheetState();
console.log(`  at rest: ${whole.sections.length} sections, ${whole.rows.length} rows, ${whole.keys.length} shortcut rows`);
check('nothing is filtered at rest', whole.sections.length >= 8 && whole.rows.length > 40 && whole.keys.length > 15);
check('no count is shown while nothing is filtered', whole.tally === null);
await shot('settings-search-01-at-rest');
await shotOf('.nbs-header', 'settings-search-01b-the-box');

// …and it is still there at the bottom of 3200px of paper, which is the whole
// argument for putting it in the header rather than on the first screen.
await page.evaluate(() => {
  const sheet = document.querySelector('.nbs-sheet');
  sheet.scrollTop = sheet.scrollHeight;
});
await page.waitForTimeout(300);
const stillThere = await page.evaluate(() => {
  const input = document.querySelector('.nbs-find-input');
  const box = input.getBoundingClientRect();
  return { top: Math.round(box.top), scrolled: Math.round(document.querySelector('.nbs-sheet').scrollTop) };
});
console.log('  after scrolling to the end:', JSON.stringify(stillThere));
check('the box is still on screen at the far end of the sheet', stillThere.scrolled > 1000 && stillThere.top > 0 && stillThere.top < 200);
await shot('settings-search-01c-still-there-at-the-end');
await page.evaluate(() => { document.querySelector('.nbs-sheet').scrollTop = 0; });

/* 2 — a word narrows the sheet -------------------------------------------- */

console.log('\n2. "volume" narrows it to the sliders');
const vol = await type('volume');
console.log('  rows:', JSON.stringify(vol.rows));
console.log('  sections:', JSON.stringify(vol.sections));
check('every volume slider is on screen', ['master volume', 'little clicks & pops', 'page sounds', 'bookshelf sounds', 'ambient bed'].every((r) => vol.rows.includes(r)), `${vol.rows.length} rows`);
check('the chapters that answer nothing are gone', vol.sections.length <= 2, vol.sections.join(', '));
check(
  'the count says how many are left',
  vol.tally === `${vol.rows.length + vol.keys.length} rows`,
  `"${vol.tally}" vs ${vol.rows.length + vol.keys.length}`,
);
check(
  'and no bubble is covering the field it is on',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nbs-find [data-tooltip]')].length === 0,
  ),
);
await shot('settings-search-02-volume');

console.log('\n2b. and it finds rows by words nobody wrote on them');
const fps = await type('fps');
console.log('  rows:', JSON.stringify(fps.rows));
check('"fps" finds the performance HUD', fps.rows.includes('performance HUD'), fps.rows.join(', '));
// Nothing in this sheet says "dark mode" — the theme shelves are called
// "warm papers", "after dark" and so on, and the rooms in them are called
// "night" and "midnight". The words the picker is SEARCHED by are what has
// to carry it.
const dark = await type('dark mode');
console.log('  rows:', JSON.stringify(dark.rows), 'chips:', JSON.stringify(dark.chips.slice(0, 8)));
check('"dark mode" finds the theme shelves', dark.rows.includes('after dark'), dark.rows.join(', '));
check('with the dark rooms themselves on screen', dark.chips.includes('night'), dark.chips.slice(0, 8).join(', '));
check('and nothing that is not a theme', dark.sections.length === 1 && dark.sections[0] === 'Appearance', dark.sections.join(', '));
await shot('settings-search-03-dark-mode');

/* 3 — a hit inside a collapsed picker ------------------------------------- */

console.log('\n3. a hit inside a picker that is folded shut');
// `oxblood` is a shelf-tier ink: it is NOT in the collapsed shortlist, so the
// only way to see it at rest is to press "show all 50". If the search cannot
// open that fold, the reader types the name of an ink they own and is told
// nothing is there.
const shut = await page.evaluate(() =>
  [...document.querySelectorAll('.nbs-seg-chip')].some(
    (c) => c.textContent?.trim() === 'oxblood' && c.getClientRects().length > 0,
  ),
);
check('oxblood is NOT reachable before the search (the fold is shut)', !shut);
const ox = await type('oxblood');
console.log('  rows:', JSON.stringify(ox.rows));
console.log('  chips:', JSON.stringify(ox.chips));
check('the search reveals the shelf holding it', ox.rows.length > 0, ox.rows.join(', '));
check('and the chip itself is on screen', ox.chips.includes('oxblood'));
check('only the shelf that holds it', ox.rows.length <= 2, `${ox.rows.length} rows`);
await shot('settings-search-04-oxblood-in-collapsed-picker');

console.log('\n3b. …and inside the shortcut list, which is not made of rows');
const cat = await type('catalogue');
console.log('  shortcut rows:', JSON.stringify(cat.keys));
check('a shortcut row answers the search', cat.keys.length > 0, cat.keys.join(', '));
check('the rest of the list goes with it', cat.keys.length <= 3, `${cat.keys.length} of many`);
await shot('settings-search-05-shortcut-row');

/* 4 — two words narrow, they do not widen --------------------------------- */

console.log('\n4. a second word narrows');
const one = await type('backup');
const two = await type('backup folder');
console.log(`  "backup" → ${one.rows.length} rows; "backup folder" → ${two.rows.length}`);
check('the second word takes rows away, never adds', two.rows.length < one.rows.length);
check('and leaves the one that was asked for', two.rows.includes('backup folder'), two.rows.join(', '));

console.log('\n4b. a chapter’s own name shows the chapter');
const help = await type('help');
console.log('  sections:', JSON.stringify(help.sections), 'rows:', JSON.stringify(help.rows));
check('"help" opens Help rather than the rows that repeat the word', help.sections.includes('Help') && help.rows.includes('replay the tour'));

/* 5 — a search that finds nothing says so --------------------------------- */

console.log('\n5. a search that finds nothing');
const none = await type('zzzqqq');
console.log('  rows:', none.rows.length, 'sections:', none.sections.length, 'empty note:', none.empty);
check('no rows are left', none.rows.length === 0 && none.keys.length === 0);
check('no empty chapter headings are left behind', none.sections.length === 0);
check('the sheet SAYS it found nothing', none.empty);
const note = await page.evaluate(() => ({
  line: document.querySelector('.nbs-find-empty-line')?.textContent ?? null,
  tries: [...document.querySelectorAll('.nbs-find-tries button')].map((b) => b.textContent),
  out: document.querySelector('.nbs-find-empty .nbs-action-btn')?.textContent ?? null,
}));
console.log('  note:', JSON.stringify(note));
check('it quotes what was typed back', note.line !== null && note.line.includes('zzzqqq'));
check('and offers a way on', note.tries.length > 3 && note.out !== null);
await shot('settings-search-06-nothing-found');
await shotOf('.nbs-find-empty', 'settings-search-06b-nothing-note');

console.log('\n5b. a word from the note gets the reader out of it');
await page.locator('.nbs-find-tries button', { hasText: 'theme' }).click();
await page.waitForTimeout(200);
const rescued = await sheetState();
check('pressing "theme" searches for it', rescued.field === 'theme' && rescued.rows.length > 0, `${rescued.rows.length} rows`);
await shot('settings-search-07-rescued');

/* 6 — the box does not take the keys the sheet binds ---------------------- */

console.log('\n6. Escape clears the query, and only then closes the sheet');
await type('sound');
// From a CHIP, not from the field. Searching and then pressing something is
// the usual order, and an Escape rule that only worked while the caret was
// still in the box would be missing exactly when it had been used.
await page.locator('.nbs-sheet .nbs-seg-chip:visible').first().focus();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const afterFirst = await page.evaluate(() => ({
  field: document.querySelector('.nbs-find-input')?.value ?? null,
  open: getComputedStyle(document.querySelector('.nbs-sheet')).visibility === 'visible',
  rows: [...document.querySelectorAll('.nbs-sheet .nbs-row')].filter((r) => r.getClientRects().length > 0).length,
}));
console.log('  after the first Escape:', JSON.stringify(afterFirst));
check('the first Escape clears the query', afterFirst.field === '');
check('the sheet is still open, and whole again', afterFirst.open && afterFirst.rows > 40);
await page.keyboard.press('Escape');
const closed = await poll(() => getComputedStyle(document.querySelector('.nbs-sheet')).visibility !== 'visible');
check('the second Escape closes the sheet', closed !== null);

console.log('\n6b. the query does not outlive the sheet');
await page.locator('.nbs-gear-button').click();
await poll(() => getComputedStyle(document.querySelector('.nbs-sheet')).visibility === 'visible');
const reopened = await sheetState();
check('reopening starts on whole paper', reopened.field === '' && reopened.rows.length > 40, `${reopened.rows.length} rows`);

console.log('\n6c. typing does not lose letters to the app’s own keys');
await page.locator('.nbs-find-input').click();
await page.keyboard.type('page style', { delay: 25 });
await page.waitForTimeout(200);
const typed = await sheetState();
check('every letter reached the field', typed.field === 'page style', String(typed.field));
check('and it found something', typed.rows.length > 0, typed.rows.join(', '));

console.log('\n6d. Tab never lands on a row the search filtered away');
await page.locator('.nbs-find-input').focus();
let stranded = null;
for (let i = 0; i < 8; i += 1) {
  await page.keyboard.press('Tab');
  const where = await page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { tag: 'body', visible: false, inSheet: false };
    return {
      tag: el.className || el.tagName,
      visible: el.getClientRects().length > 0,
      inSheet: document.querySelector('.nbs-sheet')?.contains(el) ?? false,
    };
  });
  if (!where.visible || !where.inSheet) {
    stranded = where;
    break;
  }
}
check('the focus trap skips hidden rows', stranded === null, stranded === null ? '' : JSON.stringify(stranded));
await shot('settings-search-08-page-style');

/* 7 — the count follows rows that come and go under a live query --------- */

console.log('\n7. a row that appears while the search is on is counted');
const before = await type('backup');
console.log('  rows:', JSON.stringify(before.rows), 'count:', before.tally);
// Turning backups off unmounts the interval row. If the registry did not
// shrink with the DOM the sheet would go on counting a row nobody can see —
// and a chapter could be held open by one that is gone.
await page.locator('.nbs-sheet button[aria-label="backups"]').click();
await page.waitForTimeout(250);
const off = await sheetState();
console.log('  rows:', JSON.stringify(off.rows), 'count:', off.tally);
check('switching backups off takes its interval row away', off.rows.length === before.rows.length - 1, `${before.rows.length} → ${off.rows.length}`);
check('and the count went with it', off.tally === `${off.rows.length} rows`, String(off.tally));
await page.locator('.nbs-sheet button[aria-label="backups"]').click();
await page.waitForTimeout(250);
const on = await sheetState();
check('switching it back on brings the row and the count back', on.rows.length === before.rows.length && on.tally === before.tally, `${on.rows.length} rows, ${on.tally}`);

/* 8 — the same box after dark -------------------------------------------- */

console.log('\n8. the box is drawn in whatever room the reader is in');
await type('dark mode');
await page.locator('.nbs-sheet .nbs-seg-chip', { hasText: /^night$/ }).first().click();
const dark2 = await poll(() => document.documentElement.dataset.theme === 'night');
check('the night room applies', dark2 !== null);
await page.waitForTimeout(400);
await shotOf('.nbs-header', 'settings-search-09-the-box-after-dark');
await type('zzzqqq');
await shotOf('.nbs-find-empty', 'settings-search-10-nothing-after-dark');
await page.locator('.nbs-find-clear').click();
await page.waitForTimeout(200);
await page.locator('.nbs-sheet .nbs-seg-chip', { hasText: /^parchment$/ }).first().click();
await poll(() => document.documentElement.dataset.theme === 'parchment');

/* ------------------------------------------------------------------------ */

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
