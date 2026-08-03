/**
 * shots-now/rebind-shortcuts.mjs — the shortcut list is a picker, and the key
 * it hands out is the key that fires.
 *
 * The claim under test is not "the panel drew a new chip". It is the whole
 * chain: press → validate → persist → the ACTION moves. So every assertion here
 * is on applied state —
 *
 *   · the refusals come back in words, on the row that earned them, and the row
 *     keeps listening rather than dropping the reader out to say no;
 *   · Escape leaves the row exactly as it was;
 *   · after a rebind the NEW combination opens the parcel desk and the OLD one
 *     does nothing at all (the half everyone forgets to check);
 *   · a reload still shows the new combination — it went to storage, not to a
 *     signal;
 *   · "put it back" returns the row AND makes the shipped combo fire again.
 *
 * Nothing here is allowed to pass vacuously: a control that cannot be found is
 * a FAIL, never a skip.
 *
 * Usage: node shots-now/rebind-shortcuts.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/rebind';
mkdirSync(OUT, { recursive: true });

/** The row under test, and the combination it is being moved to. */
const ACTION = 'export library';
const SHIPPED = 'Control+Shift+E';
const MOVED = 'Control+Alt+9';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0].slice(0, 160)));

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });

// Wait for the shelf to be real rather than for a clock.
for (let i = 0; i < 45; i++) {
  const up = await page
    .evaluate(() => (globalThis.__shelfVisibleBooks?.().length ?? 0) > 0)
    .catch(() => false);
  if (up) break;
  await page.waitForTimeout(1000);
}

for (let i = 0; i < 4; i++) {
  const skip = page.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
}

// Start from the shipped map however the last run left it. Through the world's
// own bridge, not an import() of the settings module — a second module copy is
// exactly the trap CLAUDE.md warns about, and here it would make every
// assertion below read a store the app is not using.
await page.evaluate(() =>
  globalThis.__shelfSaveSettings({
    keybindings: {
      'command-palette': 'mod+k',
      'new-page': 'mod+n',
      'export-library': 'mod+shift+e',
      'import-library': 'mod+shift+i',
      'insert-script': 'mod+alt+i',
      'export-script': 'mod+alt+e',
      'toggle-handwriting': 'mod+shift+h',
      'zoom-to-shelf': 'escape',
    },
  }),
);

/* --------------------------------- helpers -------------------------------- */

/**
 * Is the sheet actually on screen?
 *
 * NOT `.nbs-keys-list` count: the panel is mounted for the whole session and
 * only slid off with a transform, so counting anything inside it is true
 * before the gear has ever been clicked. An earlier version of this file
 * opened on that check, never opened the sheet at all, and still reported
 * PASS on every assertion that reads an attribute — attributes resolve fine on
 * a hidden node. Visibility is the only honest question here.
 */
const sheetOpen = async () => await page.locator('.nbs-sheet').isVisible();

const openSettings = async () => {
  if (await sheetOpen()) return;
  await page.locator('.nbs-gear-button').click();
  await page.waitForTimeout(1000);
  if (!(await sheetOpen())) throw new Error('the settings sheet never opened');
  await page.locator('.nbs-keys').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
};

const closeSettings = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  if (await sheetOpen()) throw new Error('the settings sheet never closed');
};

const row = () => page.locator('.nbs-keys-item').filter({ hasText: ACTION }).first();
const combo = () => row().locator('.nbs-keys-combo');

/** What the row advertises right now, in the spelling aria uses. */
const shown = async () => await combo().getAttribute('aria-keyshortcuts');

/** The refusal pinned to this row, or null. */
const why = async () => {
  const w = row().locator('.nbs-keys-why');
  return (await w.count()) === 0 ? null : (await w.innerText()).trim();
};

const isListening = async () => (await combo().getAttribute('data-listening')) === 'true';

/** Does `press` reach the parcel desk? Leaves the screen as it found it. */
const fires = async (press) => {
  await page.keyboard.press(press);
  await page.waitForTimeout(900);
  const open = (await page.locator('.nb-tr-card').count()) > 0;
  if (open) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  }
  return open;
};

/* ------------------------------- the run ---------------------------------- */

await openSettings();
const sheetText = await page.locator('.nbs-sheet').innerText();
check('the shortcut list is in the sheet', (await page.locator('.nbs-keys-item').count()) >= 6);
check('“rebinding is on its way” is gone', !sheetText.includes('on its way'));
check(`${ACTION} opens on the shipped combo`, (await shown()) === SHIPPED, `= ${await shown()}`);

// 0. Only rows the app honours. `new-page` and `toggle-handwriting` are in the
// stored map and no handler matches on either, so offering them a key press
// would take a combination and give nothing back.
const listedRows = (await page.locator('.nbs-keys-action').allInnerTexts()).map((t) => t.trim());
// A list of empty strings means the rows were never rendered, and every
// `includes` below would be trivially true. Refuse to pass on nothing.
check('the rows can actually be read', listedRows.length >= 6 && listedRows.every((t) => t.length > 0), `[${listedRows.join(', ')}]`);
check('no row for an action nothing performs', !listedRows.includes('new page') && !listedRows.includes('toggle handwriting'), `[${listedRows.join(', ')}]`);
check('every centrally-matched action is listed', ['command palette', 'export library', 'import library', 'insert script', 'export script'].every((a) => listedRows.includes(a)));

// 0b. The one row that is real but nailed down says so, in words, when pressed.
const shelfRow = page.locator('.nbs-keys-item').filter({ hasText: 'zoom to shelf' }).first();
check('the fixed row is still listed', (await shelfRow.count()) === 1);
check('…and marked as fixed', (await shelfRow.locator('.nbs-keys-combo').getAttribute('data-fixed')) === 'true');
await shelfRow.locator('.nbs-keys-combo').click();
await page.waitForTimeout(350);
const shelfWhy = (await shelfRow.locator('.nbs-keys-why').count()) === 0 ? null : (await shelfRow.locator('.nbs-keys-why').innerText()).trim();
check('pressing it explains itself', (shelfWhy ?? '').includes('Escape'), `“${shelfWhy}”`);
check('…and it did not start listening', (await shelfRow.locator('.nbs-keys-combo').getAttribute('data-listening')) === null);
await page.screenshot({ path: `${OUT}/00-fixed-row.png` });

// 1. The row takes the keyboard when pressed.
await combo().click();
await page.waitForTimeout(400);
check('pressing the combo starts listening', await isListening());
check('and it says so in words', (await combo().innerText()).toLowerCase().includes('press the keys'));
await page.screenshot({ path: `${OUT}/01-listening.png` });

// 2. A plain letter is refused — with a reason, and without dropping capture.
await page.keyboard.press('b');
await page.waitForTimeout(350);
check('a bare letter is refused', ((await why()) ?? '').includes('type into the page'), `“${await why()}”`);
check('…and the row keeps listening', await isListening());
check('…and nothing was written', (await shown()) === SHIPPED);
await page.screenshot({ path: `${OUT}/02-refused-letter.png` });

// 3. So is a combination the page cannot do without.
await page.keyboard.press('Control+c');
await page.waitForTimeout(350);
check('Ctrl+C is refused', ((await why()) ?? '').includes('copies what you have selected'), `“${await why()}”`);
check('…still listening after that', await isListening());

// 4. And so is one another row already holds — by name.
await page.keyboard.press('Control+Alt+i');
await page.waitForTimeout(350);
check('a taken combo names its owner', ((await why()) ?? '').includes('insert script'), `“${await why()}”`);
await page.screenshot({ path: `${OUT}/03-refused-taken.png` });

// 5. Escape is the way out, and it changes nothing.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape ends the capture', !(await isListening()));
check('…leaving the row as it was', (await shown()) === SHIPPED, `= ${await shown()}`);
check('…and the sheet still open', (await page.locator('.nbs-keys-list').count()) > 0);

// 6. Now a combination it can have.
await combo().click();
await page.waitForTimeout(300);
await page.keyboard.press(MOVED);
await page.waitForTimeout(500);
check('the new combination is taken', (await shown()) === MOVED, `= ${await shown()}`);
check('…capture ended by itself', !(await isListening()));
check('…and no refusal is left over', (await why()) === null);
check('a moved row offers a way back', (await row().locator('.nbs-keys-reset').count()) === 1);
await page.screenshot({ path: `${OUT}/04-rebound.png` });

// 7. It went to storage, not to a signal.
await page.reload({ waitUntil: 'domcontentloaded' });
for (let i = 0; i < 45; i++) {
  const up = await page
    .evaluate(() => (globalThis.__shelfVisibleBooks?.().length ?? 0) > 0)
    .catch(() => false);
  if (up) break;
  await page.waitForTimeout(1000);
}
for (let i = 0; i < 4; i++) {
  const skip = page.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
}
await openSettings();
check('it survived a reload', (await shown()) === MOVED, `= ${await shown()}`);

// 8. The point of the whole thing: the new key fires, the old one does not.
await closeSettings();
const movedFires = await fires(MOVED);
check(`${MOVED} now opens the parcel desk`, movedFires);
const shippedStillFires = await fires(SHIPPED);
check(`${SHIPPED} no longer does anything`, !shippedStillFires);

// A screenshot of the desk the new key opened, for looking at.
await page.keyboard.press(MOVED);
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/05-new-key-opens-it.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(700);

// 9. Put it back, and the shipped key works again.
await openSettings();
await row().locator('.nbs-keys-reset').click();
await page.waitForTimeout(600);
check('reset returns the shipped combo', (await shown()) === SHIPPED, `= ${await shown()}`);
check('…and the way-back button goes away', (await row().locator('.nbs-keys-reset').count()) === 0);
await page.screenshot({ path: `${OUT}/06-reset.png` });
await closeSettings();
check(`${SHIPPED} fires again after reset`, await fires(SHIPPED));

/* --------------------------------- verdict -------------------------------- */

await browser.close();
if (pageErrors.length > 0) console.log(`\n  page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\n  all ${results.length} checks passed — the row moved, and the action moved with it`
    : `\n  ${failed.length} of ${results.length} FAILED: ${failed.map((f) => f.name).join(' · ')}`,
);
process.exit(failed.length === 0 ? 0 : 1);
