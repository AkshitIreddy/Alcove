/**
 * scripts/probe-shortcuts.mjs — the new shortcuts, pressed for real.
 *
 * `tests/keybindings.test.ts` proves the registry is consistent and that the
 * dispatcher matches. It cannot prove that a key reaches the running app:
 * every command is registered by a VIEW, so a shortcut is only live while the
 * room it belongs to is on screen, and nothing in a unit test mounts a room.
 *
 * So this one only presses keys, and asserts on what the app then SHOWS — the
 * studio sheet, the trash card, the cheat-sheet card, the catalogue panel —
 * never on what was merely registered.
 *
 * TWO RULES this file learned the hard way, both from CLAUDE.md:
 *  - POLL, never sleep. The rail sheets slide in on GSAP, rAF is throttled
 *    under SwiftShader, and a fixed 450ms wait reported a panel that was
 *    opening as shut and a panel that was closing as open — in the same run.
 *  - Assert on REACTIVE state, not on the animation. A rail panel is always
 *    mounted and carries `aria-hidden`, which flips with the signal; its
 *    transform does not.
 *
 * Usage: node scripts/probe-shortcuts.mjs [--url=http://localhost:1420]
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
  await page.waitForTimeout(900); // let the slide finish before the camera
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const press = async (combo) => {
  await page.keyboard.press(combo);
  await page.waitForTimeout(160);
};

/** The rail / studio sheet that is actually OPEN, by its title. */
const openPanel = () =>
  page.evaluate(() => {
    const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    return el === null ? null : (el.querySelector('.nb-rail-panel-title')?.textContent ?? '?');
  });

const cheatUp = () =>
  page.evaluate(() => document.querySelector('[data-testid="cheat-sheet"]') !== null);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('the shelf never handed out its QA bridges');
}
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1000);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice'], 0));
await page.waitForTimeout(1400);
// Somewhere that is definitely not a field and not a control.
await page.mouse.click(1200, 120);
await page.waitForTimeout(200);

console.log('live commands on the shelf:');
console.log('  ' + (await page.evaluate(() => globalThis.__shelfCommands())).join(', '));

/* 1 — the cheat sheet, on the SHELF (it used to be book-only) ------------- */

console.log('\n1. the cheat sheet answers on the shelf');
await press('Shift+Slash'); // the '?' a real keyboard makes
check('? opens the cheat-sheet on the shelf', (await poll(() =>
  document.querySelector('[data-testid="cheat-sheet"]') !== null,
)) !== null);
const card = await page.evaluate(() => ({
  columns: [...document.querySelectorAll('.nb-cheat-heading')].map((h) => h.textContent),
  rows: document.querySelectorAll('.nb-cheat-row').length,
  caps: [...document.querySelectorAll('.nb-cheat-keys')].slice(0, 5).map((k) => k.textContent),
}));
console.log('  card:', JSON.stringify(card));
check(
  'the card is generated from the registry',
  card.rows >= 25 && card.columns.length >= 5,
  `${card.rows} rows in ${card.columns.length} columns`,
);
await shot('shortcuts-01-cheatsheet-shelf');
await press('Escape');
check('Escape closes it', (await poll(() =>
  document.querySelector('[data-testid="cheat-sheet"]') === null,
)) !== null);

console.log('\n1b. and so does the rebindable half');
await press('Control+Slash');
check('Ctrl+/ opens the cheat-sheet', await cheatUp());
await press('Control+Slash');
check('Ctrl+/ closes it again', !(await cheatUp()));

/* 2 — the shelf commands -------------------------------------------------- */

console.log('\n2. the studio, from the keyboard');
await press('Control+Alt+KeyS');
const studio = await poll(
  () =>
    document.querySelector('.nb-rail-panel[aria-hidden="false"] .nb-library-studio') !== null,
);
check('Ctrl+Alt+S opens the library studio', studio !== null, await openPanel());
await shot('shortcuts-02-studio');
await press('Control+Alt+KeyS');
check(
  'Ctrl+Alt+S closes it again',
  (await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') === null)) !==
    null,
);

console.log('\n3. the trash, from the keyboard');
await press('Control+Alt+KeyX');
const trash = await poll(() => document.querySelector('.shelf-trash') !== null);
check('Ctrl+Alt+X opens the trash', trash !== null);
await shot('shortcuts-03-trash');
await press('Control+Alt+KeyX');
check(
  'Ctrl+Alt+X closes it again',
  (await poll(() => document.querySelector('.shelf-trash') === null)) !== null,
);

console.log('\n4. a new book, from the keyboard');
const before = await page.evaluate(() => globalThis.__shelfVisibleBooks().length);
await press('Control+Alt+KeyN');
const after = await poll((n) => {
  const now = globalThis.__shelfVisibleBooks().length;
  return now > n ? now : null;
}, before);
check('Ctrl+Alt+N puts a book on the shelf', after !== null, `${before} → ${after ?? before}`);
await shot('shortcuts-04-new-book');
await press('Escape'); // dismiss the inline title editor it lands in
await page.mouse.click(1200, 120);
await page.waitForTimeout(300);

/* 5 — the shell commands -------------------------------------------------- */

console.log('\n5. search, scoped to page text');
await press('Control+Shift+KeyF');
const qs = await poll(() => {
  const bar = document.querySelector('.nb-qs-bar');
  if (bar === null) return null;
  const tab = [...bar.querySelectorAll('[role="tab"]')].find(
    (t) => t.getAttribute('aria-selected') === 'true',
  );
  return { scope: tab?.textContent?.trim() ?? null, hint: bar.querySelector('input')?.placeholder };
});
console.log('  switcher:', JSON.stringify(qs));
check(
  'Ctrl+Shift+F opens the switcher already in "search text"',
  qs !== null && qs.scope === 'search text',
);
await shot('shortcuts-05-search-text');
await press('Escape');

console.log('\n6. the settings sheet');
await press('Control+Comma');
const sheet = await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});
check('Ctrl+, opens settings', sheet !== null);
const keysList = await page.evaluate(() => ({
  groups: [...document.querySelectorAll('.nbs-keys-group-title')].map((g) => g.textContent),
  rows: document.querySelectorAll('.nbs-keys-item').length,
}));
console.log('  shortcut list:', JSON.stringify(keysList));
check(
  'the list is grouped by room',
  keysList.groups.length >= 4 && keysList.rows >= 18,
  `${keysList.rows} rows in ${keysList.groups.length} groups`,
);
await page.evaluate(() => document.querySelector('.nbs-keys')?.scrollIntoView({ block: 'start' }));
await shot('shortcuts-06-settings-list');
await press('Escape');
await page.waitForTimeout(700);

/* 7 — inside a book -------------------------------------------------------- */

console.log('\n7. open a book and drive its rail from the keyboard');
// The dev view switcher, exactly as tests/e2e/helpers.openBookView does it.
// Pulling a book off the plank with the pointer is the reader's route and is
// what pull-out.spec.ts covers; this probe is about the KEYS once a book is
// open, so it takes the short way in.
await page.getByRole('button', { name: 'book', exact: true }).click();
if ((await poll(() => document.querySelector('.nb-rail') !== null, null, 60000)) === null) {
  throw new Error('the book never opened');
}
await page.waitForTimeout(1200);
// The desk, not a page: the caret must not be in the prose, or every one of
// these is testing the editor's keymap instead of the app's.
await page.mouse.click(18, 880);
await page.waitForTimeout(250);
console.log('  live commands in the book:');
console.log('    ' + (await page.evaluate(() => globalThis.__shelfCommands?.() ?? [])).join(', '));

for (const [combo, title] of [
  ['Control+Alt+KeyA', /catalogue/i],
  ['Control+Alt+KeyT', /contents/i],
  ['Control+Alt+KeyL', /page style/i],
  ['Control+Alt+KeyD', /customize/i],
]) {
  await press(combo);
  const opened = await poll((want) => {
    const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    if (el === null) return null;
    const t = el.querySelector('.nb-rail-panel-title')?.textContent ?? '';
    return new RegExp(want, 'i').test(t) ? t : null;
  }, title.source);
  check(`${combo} opens ${title}`, opened !== null, opened ?? (await openPanel()) ?? 'nothing');
  if (combo === 'Control+Alt+KeyA') await shot('shortcuts-07-catalogue');
  await press(combo);
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') === null);
}

console.log('\n8. the ribbon and the focus mode');
// The rail's ribbon icon carries `aria-pressed`, and that IS the applied
// state — but its label is the rail's own copy and moves. Find the button by
// the icon's tool row rather than by a sentence somebody may reword.
const ribbonPressed = () =>
  page.evaluate(() => {
    const btn = [...document.querySelectorAll('.nb-rail-button')].find((b) =>
      /ribbon/i.test(b.getAttribute('aria-label') ?? ''),
    );
    return btn?.getAttribute('aria-pressed') ?? null;
  });
const wasMarked = await ribbonPressed();
await press('Control+Alt+KeyB');
const nowMarked = await poll((was) => {
  const btn = [...document.querySelectorAll('.nb-rail-button')].find((b) =>
    /ribbon/i.test(b.getAttribute('aria-label') ?? ''),
  );
  const v = btn?.getAttribute('aria-pressed') ?? null;
  return v !== was ? v : null;
}, wasMarked);
check('Ctrl+Alt+B tucks a ribbon into the page', nowMarked !== null, `${wasMarked} → ${nowMarked}`);
await shot('shortcuts-08-ribbon');

await press('F9');
const focusOn = await poll(() => {
  const exit = document.querySelector('.nb-focus-exit');
  return exit !== null && getComputedStyle(exit).opacity !== '0' ? 'on' : null;
});
check('F9 still enters focus mode, now through the map', focusOn !== null);
await shot('shortcuts-09-focus');
await press('Escape');
await page.waitForTimeout(400);

console.log('\n9. the cheat sheet inside a book');
await page.mouse.click(18, 880);
await press('Shift+Slash');
check('? opens it in the book too', (await poll(() =>
  document.querySelector('[data-testid="cheat-sheet"]') !== null,
)) !== null);
await shot('shortcuts-10-cheatsheet-book');
await press('Escape');

/* ------------------------------------------------------------------------ */

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(', ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
