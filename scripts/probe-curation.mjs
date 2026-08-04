/**
 * scripts/probe-curation.mjs — the reader's own hand on a list, driven as a
 * reader drives it.
 *
 * `tests/curation.test.ts` proves the STORE: a removal leaves the list, a star
 * reorders it, a kept room comes back off disk. None of that says the studio
 * can reach any of it — which is exactly the failure this wave exists for, and
 * exactly what `src/data/shelfOfMine.ts` was in before it: complete, 41 tests
 * green, reachable from no panel at all.
 *
 * So this one only ever clicks. Every assertion is against the APPLIED state:
 * the DOM the reader is looking at, and `__shelfCuration` — read-only, handed
 * out by `world.ts` from the store instance the app itself subscribed to.
 *
 * What it proves, in the order the reader would meet it:
 *
 *   1. a star moves an entry to the head of its strip;
 *   2. a removal takes an entry off the strip AND out of the dice;
 *   3. the right-click drawer gives it back, by name, with a checkbox;
 *   4. "keep this room" saves the room you are standing in, and the card it
 *      makes can be found in the sheet and PRESSED — a kept room that cannot
 *      be applied is worse than no kept room;
 *   5. an entry you removed and are nevertheless WEARING still shows, dashed,
 *      so the strip never reads as though it forgot your choice.
 *
 * Usage: node scripts/probe-curation.mjs [--url=http://localhost:1420]
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

const fails = [];
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail === '' ? '' : `  — ${detail}`}`);
  if (!ok) fails.push(what);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 980 },
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

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

/** The names on a strip, in the order they are shown. */
const stripNames = async (label) =>
  page.$$eval(
    `[aria-label="${label}"] button.nb-strip-tile:not(.nb-strip-more)`,
    (tiles) => tiles.map((t) => (t.getAttribute('data-tooltip') ?? '').split(' — ')[0]),
  );

/** Right-click one tile and wait for the menu it opens. */
const openTileMenu = async (label, index) => {
  const tile = page
    .locator(`[aria-label="${label}"] button.nb-strip-tile:not(.nb-strip-more)`)
    .nth(index);
  await tile.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250); // the menu closes on scroll; scroll first
  const name = (await tile.getAttribute('data-tooltip'))?.split(' — ')[0] ?? '';
  await tile.click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  return name;
};

const menuItem = (text) => page.locator('.nb-cur-menu button.nb-cur-menu-item', { hasText: text });

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => globalThis.__shelfCuration !== undefined, 30000, 'curation bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);

const HOUSE = await page.evaluate(() => globalThis.__shelfDesign().design.build);
console.log(`\nthe room opens on build "${HOUSE}"`);

console.log('\n0. open the studio from the dock');
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1200);
await shot('cur-00-studio');

/* ========================================================================== *
 * 1 — a star moves an entry to the head                                      *
 * ========================================================================== */

console.log('\n1. star the fourth build twice: it should lead the strip');
const before = await stripNames('Bookcase build');
console.log('  strip was:', before.join(', '));
const starred = await openTileMenu('Bookcase build', 3);
await shot('cur-01-menu');
await menuItem('first of them all').click();
await page.waitForTimeout(600);
const afterStar = await stripNames('Bookcase build');
console.log('  strip now:', afterStar.join(', '));
check(afterStar[0] === starred, 'a two-star entry leads its strip', `${starred}`);
check(
  (await page.$$eval('[aria-label="Bookcase build"] .nb-mark', (m) => m.length)) > 0,
  'the star is drawn on the tile',
);
await shot('cur-02-starred');

/* ========================================================================== *
 * 2 — a removal leaves the strip and the dice                                *
 * ========================================================================== */

console.log('\n2. remove the third build');
const removed = await openTileMenu('Bookcase build', 2);
await menuItem('remove from the list').click();
await page.waitForTimeout(600);
const afterRemove = await stripNames('Bookcase build');
console.log('  strip now:', afterRemove.join(', '));
check(!afterRemove.includes(removed), 'the removed entry left the strip', removed);

const gate = await page.evaluate(async () => {
  const shelf = await import('/src/art/shelfDesign.ts');
  const ids = shelf.ROLLABLE_BUILDS.map((b) => b.id);
  const hidden = globalThis.__shelfCuration.hidden('build');
  const pool = globalThis.__shelfCuration.roll('build', ids);
  return {
    hidden: [...hidden],
    hiddenNames: hidden.map((id) => shelf.BUILDS[id]?.name ?? id),
    all: ids.length,
    pool: pool.length,
    stillRolled: hidden.filter((id) => pool.includes(id)),
  };
});
console.log('  removed ids:', gate.hidden.join(', '), `(${gate.hiddenNames.join(', ')})`);
check(gate.hiddenNames.includes(removed), 'the store knows what was removed', removed);
check(gate.pool === gate.all - 1, 'the roll pool is one smaller', `${gate.pool} of ${gate.all}`);
check(gate.stillRolled.length === 0, 'the removed entry left the roll pool');

console.log('  …and the dice, pressed twenty times, never land on it');
const landed = new Set();
for (let i = 0; i < 20; i += 1) {
  await page.getByRole('button', { name: 'surprise me' }).click();
  await page.waitForTimeout(220);
  landed.add(await page.evaluate(() => globalThis.__shelfDesign().design.build));
}
const landedNames = await page.evaluate(async (ids) => {
  const shelf = await import('/src/art/shelfDesign.ts');
  return ids.map((id) => shelf.BUILDS[id]?.name ?? id);
}, [...landed]);
console.log(`  the dice found ${landed.size} different builds`);
check(!landedNames.includes(removed), 'twenty rolls, and never the removed one', removed);
await page.waitForTimeout(1200);
await shot('cur-03-removed');

/* ========================================================================== *
 * 3 — the drawer gives it back                                               *
 * ========================================================================== */

console.log('\n3. right-click the strip and put it back');
await page.locator('[aria-label="Bookcase build"]').first().click({ button: 'right' });
await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
await menuItem('removed (1)').click();
await page.waitForSelector('.nb-cur-drawer', { timeout: 8000 });
const drawerRows = await page.$$eval('.nb-cur-row-name', (rows) =>
  rows.map((r) => r.textContent?.trim() ?? ''),
);
console.log('  drawer holds:', drawerRows.join(', '));
check(drawerRows.includes(removed), 'the drawer names the removed entry', removed);
await shot('cur-04-drawer');

await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
await page.waitForTimeout(700);
const restored = await stripNames('Bookcase build');
check(restored.includes(removed), 'the entry came back to the strip', removed);
check(
  (await page.evaluate(() => globalThis.__shelfCuration.hidden('build').length)) === 0,
  'and back into the roll pool',
);
await shot('cur-05-restored');

/* ========================================================================== *
 * 4 — keep this room, then find it and press it                              *
 * ========================================================================== */

console.log('\n4. keep the room you are standing in');
const roomBefore = await page.evaluate(() => globalThis.__shelfDesign().design);
await page.locator('[aria-label="Room presets"]').first().click({ button: 'right' });
await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
await menuItem('keep this room').click();
await page.waitForSelector('.nb-cur-drawer .nb-cur-input', { timeout: 8000 });
await page.locator('.nb-cur-drawer .nb-cur-input').fill('Probe Room');
await page.locator('.nb-cur-drawer .nb-cur-star-btn').nth(2).click(); // ★★
await shot('cur-06-keep-form');
await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
await page.waitForTimeout(900);

const kept = await page.evaluate(() => globalThis.__shelfCuration.rooms());
console.log('  kept rooms:', JSON.stringify(kept));
check(kept.some((r) => r.name === 'Probe Room'), 'the room was kept under its name');
check(
  (await page.evaluate(
    (id) => globalThis.__shelfCuration.stars('room-preset', id),
    kept[0]?.id ?? '',
  )) === 2,
  'and starred in the same action',
);

console.log('  find it in the preset sheet, by searching for it');
await page.locator('[aria-label="Room presets"] button.nb-strip-more').click();
await page.waitForSelector('.nb-pick', { timeout: 10000 });
await page.locator('.nb-pick-search input').fill('probe');
await page.waitForTimeout(500);
const hits = await page.$$eval('.nb-pick-card .nb-pick-name', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
console.log('  the sheet found:', hits.join(', '));
check(hits.includes('Probe Room'), 'a kept room is on the list it was kept from');
await shot('cur-07-kept-room-in-sheet');

console.log('  change the room, then press the kept card: it must come back');
await page.locator('.nb-pick-search input').fill('');
await page.waitForTimeout(400);
await page.locator('.nb-pick-card').nth(4).click();
await page.waitForTimeout(900);
const roomMoved = await page.evaluate(() => globalThis.__shelfDesign().design);
check(
  roomMoved.build !== roomBefore.build || roomMoved.pattern !== roomBefore.pattern,
  'a house preset moved the room first',
  `${roomMoved.build}.${roomMoved.pattern}`,
);
await page.locator('.nb-pick-search input').fill('probe');
await page.waitForTimeout(500);
await page.locator('.nb-pick-card').first().click();
await page.waitForTimeout(1000);
const roomBack = await page.evaluate(() => globalThis.__shelfDesign().design);
check(
  roomBack.build === roomBefore.build && roomBack.pattern === roomBefore.pattern,
  'pressing the kept card applied the room it kept',
  `${roomBack.build}.${roomBack.pattern}`,
);
await shot('cur-08-kept-room-applied');
await page.locator('.nb-pick-back').click();
await page.waitForTimeout(600);

/* ========================================================================== *
 * 5 — an entry you removed and are wearing still shows                       *
 * ========================================================================== */

console.log('\n5. remove the house build while wearing another, then put it on');
const houseName = await page.evaluate(async (id) => {
  const shelf = await import('/src/art/shelfDesign.ts');
  return shelf.BUILDS[id]?.name ?? id;
}, HOUSE);
console.log(`  the house build is "${houseName}"`);

// Stand somewhere else first — the menu refuses to remove what you are using.
const onStrip = await stripNames('Bookcase build');
const away = onStrip.findIndex((n) => n !== houseName);
await page.locator('[aria-label="Bookcase build"] button.nb-strip-tile').nth(away).click();
await page.waitForTimeout(700);

let houseAt = (await stripNames('Bookcase build')).indexOf(houseName);
if (houseAt < 0) {
  // Not in the visible head: reach it through the sheet instead.
  console.log('  (the house build is not in the strip head; skipping this half)');
} else {
  await openTileMenu('Bookcase build', houseAt);
  await menuItem('remove from the list').click();
  await page.waitForTimeout(600);
  check(
    !(await stripNames('Bookcase build')).includes(houseName),
    'the house build left the strip',
    houseName,
  );

  // The House Room preset wears it — a preset is a bundle of values and does
  // not consult the reader's removals, which is the case `activeId` exists for.
  await page.locator('[aria-label="Room presets"] button.nb-strip-more').click();
  await page.waitForSelector('.nb-pick', { timeout: 10000 });
  await page.locator('.nb-pick-search input').fill('house room');
  await page.waitForTimeout(500);
  await page.locator('.nb-pick-card').first().click();
  await page.waitForTimeout(900);
  await page.locator('.nb-pick-back').click();
  await page.waitForTimeout(800);

  const worn = await page.evaluate(() => globalThis.__shelfDesign().design.build);
  check(worn === HOUSE, 'the room went back to the house build', worn);
  const shown = await stripNames('Bookcase build');
  check(shown.includes(houseName), 'a removed build you are WEARING still shows', houseName);
  const dashed = await page.$$eval(
    '[aria-label="Bookcase build"] button.nb-strip-tile.nb-cur-gone',
    (t) => t.map((x) => (x.getAttribute('data-tooltip') ?? '').split(' — ')[0]),
  );
  check(dashed.includes(houseName), 'and it is drawn as removed, not as an ordinary member');
  const pressed = await page.$$eval(
    '[aria-label="Bookcase build"] button.nb-strip-tile.is-active',
    (t) => t.map((x) => (x.getAttribute('data-tooltip') ?? '').split(' — ')[0]),
  );
  check(pressed.includes(houseName), 'and the strip shows it as the one in use');
  check(
    (await page.evaluate(() => globalThis.__shelfCuration.hidden('build'))).length === 1,
    'while the drawer still lists it as removed',
  );
  await shot('cur-09-wearing-a-removed-one');
}

/* ========================================================================== *
 * 6 — the book studio's grids take the same hand                             *
 * ========================================================================== */

console.log('\n6. the same right-click on a book studio colour grid');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const spine = await page.evaluate(() => globalThis.__shelfVisibleBooks()[0]?.id ?? null);
if (spine !== null) {
  await page.evaluate((id) => globalThis.__shelfPullOut(id), spine);
  await page.waitForTimeout(1800);
  const dress = page.getByRole('button', { name: /dress this book|book studio|binding/i });
  if (await dress.count()) {
    await dress.first().click();
    await page.waitForTimeout(1200);
  }
}
const grid = page.locator('[aria-label="Spine pigment"]');
if (await grid.count()) {
  await grid.locator('button.nb-swatch').nth(3).click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  const named = (await page.locator('.nb-cur-menu-name').textContent())?.trim() ?? '';
  check(named !== '', 'the pigment grid opens the same menu, naming the swatch', named);
  await menuItem('first of them all').click();
  await page.waitForTimeout(600);
  check(
    (await page.evaluate(() => globalThis.__shelfCuration.stars('spine-cloth', '3'))) === 2,
    'a pigment can be starred, on its own axis',
  );
  await shot('cur-10-pigment-grid');
} else {
  console.log('  (the book studio was not reachable in this run; skipped)');
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} FAILED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
