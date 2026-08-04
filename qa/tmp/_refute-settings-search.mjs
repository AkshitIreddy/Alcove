/**
 * qa/tmp/_refute-settings-search.mjs — an adversarial second opinion on the
 * settings search box. Not the author's probe: it types the words the CLAIM
 * names ("typeface", "gutter", "fps", "dark mode"), the words only a
 * VOLUME_WORDS table could answer, a keyboard combo drawn beside a row, and
 * both spellings of colour — and it reads the applied DOM, never the signal.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
mkdirSync('qa/tmp/shots', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = new Map();
page.on('pageerror', (e) => errors.set(e.message.split('\n')[0], (errors.get(e.message.split('\n')[0]) ?? 0) + 1));
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

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const state = () =>
  page.evaluate(() => {
    const seen = (el) => el.getClientRects().length > 0;
    const text = (el, sel) => el.querySelector(sel)?.textContent?.trim() ?? '?';
    const sheet = document.querySelector('.nbs-sheet');
    if (sheet === null) return null;
    return {
      sections: [...sheet.querySelectorAll('.nbs-section')].filter(seen).map((s) => text(s, '.nbs-section-title')),
      rows: [...sheet.querySelectorAll('.nbs-row')].filter(seen).map((r) => text(r, '.nbs-row-label')),
      keys: [...sheet.querySelectorAll('.nbs-keys-item')].filter(seen).map((li) => text(li, '.nbs-keys-action')),
      chips: [...sheet.querySelectorAll('.nbs-seg-chip')].filter(seen).map((c) => c.textContent?.trim() ?? ''),
      tally: document.querySelector('.nbs-find-tally')?.textContent ?? null,
      field: document.querySelector('.nbs-find-input')?.value ?? null,
      boxSeen: (document.querySelector('.nbs-find-input')?.getClientRects().length ?? 0) > 0,
    };
  });

const type = async (q) => {
  await page.locator('.nbs-find-input').fill(q);
  await poll((want) => document.querySelector('.nbs-find-input')?.value === want, q);
  await page.waitForTimeout(150);
  return state();
};

/* Reader's own path: no ?fx=force, a cleared profile, the gear clicked. */
await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => document.querySelector('.nbs-gear-button') !== null, null, 120000);
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(900);

console.log('\n0. the box exists on the PLAIN url (no ?fx=force)');
await page.locator('.nbs-gear-button').click();
await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});
const rest = await state();
check('a reader who never passes ?fx=force still gets a search box', rest.boxSeen);
check('and the sheet is whole', rest.rows.length > 40, `${rest.rows.length} rows`);

console.log('\n1. the words the claim names, one at a time');
const cases = [
  ['typeface', (s) => s.rows.some((r) => r === 'hand') || s.chips.length > 0, 'the hand'],
  ['gutter', (s) => s.rows.some((r) => /line number/i.test(r)), 'line numbers'],
  ['fps', (s) => s.rows.includes('performance HUD'), 'performance HUD'],
  ['dark mode', (s) => s.sections.length === 1 && s.sections[0] === 'Appearance', 'themes only'],
];
for (const [q, ok, what] of cases) {
  const s = await type(q);
  check(`"${q}" reaches ${what}`, ok(s), `${s.rows.length} rows: ${s.rows.slice(0, 6).join(', ')}`);
}

console.log('\n2. the VOLUME_WORDS table — words written nowhere on the sliders');
for (const [q, want] of [
  ['buttons', 'little clicks & pops'],
  ['paper turning', 'page sounds'],
  ['wood', 'bookshelf sounds'],
  ['soundscape', 'ambient bed'],
  ['master', 'master volume'],
]) {
  const s = await type(q);
  check(`"${q}" -> ${want}`, s.rows.includes(want), s.rows.join(', ') || '(nothing)');
}

console.log('\n3. the combo drawn beside a row is searchable');
const combo = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nbs-row')].find(
    (r) => r.querySelector('.nbs-row-label')?.textContent?.trim() === 'a parcel of books',
  );
  return row === undefined ? null : [...(row.querySelectorAll('.nbs-kbd') ?? [])].map((k) => k.textContent).join('+');
});
console.log('  the export row draws:', JSON.stringify(combo));
if (combo) {
  const part = combo.split('+')[0];
  const s = await type(part);
  check(`typing the modifier "${part}" finds rows that draw it`, s.rows.length > 0, s.rows.join(', '));
}

console.log('\n4. both spellings, and a plural');
for (const [q, want] of [
  ['colour', null],
  ['color', null],
  ['doodles', 'doodles'],
]) {
  const s = await type(q);
  check(`"${q}" finds something`, s.rows.length > 0, `${s.rows.length} rows`);
  if (want) check(`  and specifically ${want}`, s.rows.some((r) => r.includes(want)), s.rows.join(', '));
}
const colourRows = (await type('colour')).rows.join('|');
const colorRows = (await type('color')).rows.join('|');
check('colour and color are the same search', colourRows === colorRows, `${colourRows} vs ${colorRows}`);

console.log('\n5. no chapter heading is left standing over nothing, for any word');
const words = ['theme', 'sound', 'backup', 'shortcuts', 'code', 'cursor', 'tour', 'zzz', 'x', 'e'];
let orphan = null;
for (const w of words) {
  await type(w);
  const bad = await page.evaluate(() => {
    const seen = (el) => el.getClientRects().length > 0;
    return [...document.querySelectorAll('.nbs-section')]
      .filter(seen)
      .filter(
        (s) =>
          [...s.querySelectorAll('.nbs-row')].filter(seen).length === 0 &&
          [...s.querySelectorAll('.nbs-keys-item')].filter(seen).length === 0,
      )
      .map((s) => s.querySelector('.nbs-section-title')?.textContent ?? '?');
  });
  if (bad.length > 0) orphan = { w, bad };
}
check('every visible chapter still has something under it', orphan === null, orphan === null ? '' : JSON.stringify(orphan));

console.log('\n6. a single letter does not blow the sheet up');
const one = await type('e');
check('one letter still narrows rather than throwing', one !== null && one.field === 'e');
console.log(`  "e" -> ${one.rows.length} rows, tally ${one.tally}`);

console.log('\n7. the same box in a small window');
await page.setViewportSize({ width: 1024, height: 700 });
await page.waitForTimeout(400);
const small = await type('volume');
check('the box survives 1024x700', small.boxSeen && small.rows.includes('master volume'), small.rows.join(', '));
const geom = await page.evaluate(() => {
  const i = document.querySelector('.nbs-find-input').getBoundingClientRect();
  const t = document.querySelector('.nbs-find-tally')?.getBoundingClientRect() ?? null;
  return { w: Math.round(i.width), right: Math.round(i.right), win: window.innerWidth, tallyIn: t === null ? null : t.right <= i.right + 2 };
});
console.log('  field geometry:', JSON.stringify(geom));
check('the field is not clipped off the window', geom.right <= geom.win && geom.w > 120);
await page.screenshot({ path: 'qa/tmp/shots/refute-small-window.png' });
await page.setViewportSize({ width: 1440, height: 900 });

console.log('\n8. a row the search revealed can actually be OPERATED');
// A hit that only paints is worth nothing. Pick a pigment out of a shelf the
// fold was hiding and press it, then read the applied setting back off <html>.
await type('oxblood');
const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nb-hand-ink') || document.documentElement.dataset.theme);
const chip = page.locator('.nbs-sheet .nbs-seg-chip', { hasText: /^oxblood$/ }).first();
check('the oxblood chip is on screen', (await chip.count()) > 0 && (await chip.isVisible()));
await chip.click();
await page.waitForTimeout(400);
const applied = await page.evaluate(() => ({
  pressed: [...document.querySelectorAll('.nbs-seg-chip')].filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent?.trim()),
  ink: getComputedStyle(document.documentElement).getPropertyValue('--nb-hand-ink'),
}));
console.log('  after pressing:', JSON.stringify(applied), 'was', JSON.stringify(before));
check('pressing a chip the search revealed actually changes the app', applied.pressed.includes('oxblood'), JSON.stringify(applied.pressed));

console.log('\n9. clearing puts every row back');
await page.locator('.nbs-find-clear').click();
await page.waitForTimeout(300);
const back = await state();
check('the sheet is whole again', back.rows.length === rest.rows.length, `${back.rows.length} vs ${rest.rows.length}`);

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(' | ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
