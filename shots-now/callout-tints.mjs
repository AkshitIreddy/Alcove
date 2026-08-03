/**
 * shots-now/callout-tints.mjs — drive the REAL callout tint picker.
 *
 * A specimen board proves the pigment shelf draws well; it says nothing about
 * whether a reader can reach it. This opens the seeded book, inserts a callout,
 * opens its picker by clicking, and then:
 *
 *   1. photographs the picker at rest (twenty chips + "4 more");
 *   2. clicks "4 more" and photographs the neutrals appearing;
 *   3. types a hex nobody put in a table, presses Use, and asserts on the
 *      APPLIED wash — the three `--co-*` custom properties actually on the
 *      element — not on what was merely stored;
 *   4. asserts a hex the app cannot read leaves the callout alone.
 *
 * Usage: node shots-now/callout-tints.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
p.on('console', (m) => {
  if (m.type() === 'error') console.log('  console error:', m.text().slice(0, 200));
});
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p
  .locator('[data-testid="pulled-book-hand"]')
  .waitFor({ state: 'visible', timeout: 40_000 })
  .catch(() => {});
const read = p.getByRole('button', { name: /read it/i });
if ((await read.count()) > 0) await read.click().catch(() => {});
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 });
await p.waitForTimeout(2000);

// Type a callout into the page the way a reader would: click into the prose,
// then use the slash menu's own command.
const prose = p.locator('.nb-prose').first();
await prose.click({ position: { x: 200, y: 60 } });
await p.keyboard.press('Control+End');
await p.keyboard.press('Enter');
await p.keyboard.type('/callout');
await p.waitForTimeout(900);
await p.keyboard.press('Enter');
await p.waitForTimeout(900);
await p.keyboard.type('A colour nobody put in a table.');
await p.waitForTimeout(600);

const callout = p.locator('.nb-callout').first();
if ((await callout.count()) === 0) {
  console.log('  FAIL: no callout was inserted');
  await p.screenshot({ path: 'shots-now/callout-none.png' });
  await b.close();
  process.exit(1);
}

const applied = async () =>
  callout.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      tint: el.getAttribute('data-tint'),
      hex: el.getAttribute('data-tint-hex'),
      light: s.getPropertyValue('--co-light').trim(),
      base: s.getPropertyValue('--co-base').trim(),
      deep: s.getPropertyValue('--co-deep').trim(),
    };
  });

console.log('  at rest:', JSON.stringify(await applied()));

await callout.locator('.nb-callout-tint').click();
await p.waitForTimeout(500);
const panel = p.locator('[aria-label="Callout wash colour"]');
await panel.waitFor({ state: 'visible', timeout: 10_000 });
console.log('  chips shown before "more":', await panel.locator('button[title]').count());
await panel.screenshot({ path: 'shots-now/callout-picker-folded.png' });

const more = panel.getByText(/^\d+ more$/);
if ((await more.count()) > 0) {
  console.log('  fold link reads:', await more.first().innerText());
  await more.first().click();
  await p.waitForTimeout(400);
  console.log('  chips shown after "more":', await panel.locator('button[title]').count());
}
await panel.screenshot({ path: 'shots-now/callout-picker-open.png' });

// --- a colour nobody put in a table ---------------------------------------
const field = panel.getByLabel('Colour as a hex code');
await field.fill('#3f7a5c');
await panel.getByRole('button', { name: 'Use this colour' }).click();
await p.waitForTimeout(600);
const custom = await applied();
console.log('  after typing #3f7a5c:', JSON.stringify(custom));
// The APPLIED wash, not what was merely stored: `--co-base` is the property
// editor.css actually paints the callout out of.
if (custom.tint !== 'custom' || custom.hex !== '#3f7a5c' || custom.base !== '#3f7a5c') {
  console.log("  FAIL: the reader's colour did not reach the block");
} else {
  console.log('  OK: the wash the block is painted with IS the typed colour');
}

await callout.screenshot({ path: 'shots-now/callout-custom.png' });

// --- and it survives the picker being reopened -----------------------------
await callout.locator('.nb-callout-tint').click();
await p.waitForTimeout(500);
const panel2 = p.locator('[aria-label="Callout wash colour"]');
const ownChips = await panel2.locator('button[aria-label^="Custom colour"]').count();
console.log('  remembered custom chips:', ownChips);

// --- junk in the field must not overwrite what is on the page --------------
await panel2.getByLabel('Colour as a hex code').fill('rebeccapurple');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const afterJunk = await applied();
console.log('  after typing junk:', JSON.stringify(afterJunk));
if (afterJunk.base !== '#3f7a5c') console.log("  FAIL: junk overwrote the reader's colour");
else console.log('  OK: a colour the app cannot read left the block alone');
await panel2.screenshot({ path: 'shots-now/callout-picker-reopened.png' });

await p.locator('.nb-book-view').screenshot({ path: 'shots-now/callout-spread.png' });
console.log('  done');
await b.close();
