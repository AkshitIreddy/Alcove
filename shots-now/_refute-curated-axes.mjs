/**
 * shots-now/_refute-curated-axes.mjs — the four studio rows the curation probe
 * did not walk, plus the one question it never asked.
 *
 * `probe-curated-axes.mjs` walks five of the nine chip rows the book studio is
 * claimed to have wired: ornament, title-plate, charm, cover-medallion and
 * format. The other four — binding-material, lettering, edge, cover-frame —
 * are asserted only by the fact that they pass the same component the same
 * props, which is exactly the shape of argument this whole wave exists to stop
 * accepting. So this file drives those four, and only those four, end to end.
 *
 * It also asks the question no probe in the pair asks: does a removal SURVIVE
 * A RELOAD and still come back applied? A curation held in a module-scope
 * object and never written down would pass every check in the other file and
 * be gone the next time the reader opened the app.
 *
 * Same rules as the probe it is checking: it only ever clicks, it reads the
 * store back through `__shelfCuration` (handed out by world.ts from the
 * instance the panel itself writes to), and every membership assertion is
 * against the DOM the reader is looking at.
 *
 * Deltas, not absolutes. The other probe asserts `hidden(axis).length === 1`,
 * which only holds against a database nothing has touched; the stub DB lives
 * in localStorage and a re-run inherits whatever the last run left. Every
 * check here is "grew by this id" / "lost this id", so the file is re-runnable.
 *
 * Usage: node shots-now/_refute-curated-axes.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/tmp', { recursive: true });

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
  viewport: { width: 1500, height: 980 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(60000);

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

const shot = async (name) => {
  await page.screenshot({ path: `qa/tmp/${name}.png` });
  console.log(`  shot qa/tmp/${name}.png`);
};

const menuItem = (text) =>
  page.locator('.nb-cur-menu button.nb-cur-menu-item', { hasText: text });

const chipWords = (label) =>
  page.$$eval(`[aria-label="${label}"] .nb-chip`, (chips) =>
    chips.map((c) => (c.textContent ?? '').replace(/★/g, '').trim()),
  );

const hiddenIds = (axis) =>
  page.evaluate((a) => [...globalThis.__shelfCuration.hidden(a)], axis);

const openMenu = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locator.click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  return ((await page.locator('.nb-cur-menu-name').textContent()) ?? '').trim();
};

/** Right-click the ROW, not a chip in it: a chip's menu offers the same drawer. */
const openDrawer = async (rowSelector) => {
  const row = page.locator(rowSelector).first();
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await row.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height - 3);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  await menuItem('removed (').first().click();
  await page.waitForSelector('.nb-cur-drawer', { timeout: 8000 });
};

/* ---------------------------------- boot --------------------------------- */

const boot = async ({ fresh }) => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  await page.waitForFunction(() => globalThis.__shelfCuration !== undefined, null, { polling: 400 });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(1200);
};

const openStudio = async () => {
  const opened = await page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const first = list[0];
    if (!first) return null;
    app.appState.openBook(first.id);
    return { id: first.id, title: first.title };
  });
  // If that import landed on a second copy of app.ts the rail never appears,
  // so the wait below is the check on it rather than a comment claiming it.
  await page.waitForSelector('.nb-rail', { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
  await page.waitForTimeout(1000);
  return opened;
};

await boot({ fresh: true });
console.log('\n0. open a book and its studio');
console.log('  opened:', JSON.stringify(await openStudio()));

/* ================================================================ *
 * 1 — all nine rows are actually on screen                          *
 * ================================================================ */

console.log('\n1. the nine rows the claim names, counted on screen');
const NINE = [
  ['binding-material', 'Binding material'],
  ['ornament', 'Ornament stamp'],
  ['title-plate', 'Title plate'],
  ['lettering', 'Title lettering'],
  ['edge', 'Edge treatment'],
  ['format', 'Book format'],
  ['charm', 'Charm'],
  ['cover-frame', 'Cover frame'],
  ['cover-medallion', 'Cover medallion'],
];
for (const [, label] of NINE) {
  const n = (await chipWords(label)).length;
  check(n > 0, `“${label}” is a group on screen`, `${n} chips`);
}
await shot('refute-00-studio');

/* ================================================================ *
 * 2 — the FOUR rows probe-curated-axes.mjs never walks              *
 * ================================================================ */

const UNPROBED = [
  { axis: 'binding-material', label: 'Binding material' },
  { axis: 'lettering', label: 'Title lettering' },
  { axis: 'edge', label: 'Edge treatment' },
  { axis: 'cover-frame', label: 'Cover frame' },
];

for (const [n, row] of UNPROBED.entries()) {
  console.log(`\n2.${n + 1} ${row.label} — remove one, prove it left, put it back`);
  const before = await chipWords(row.label);
  const storedBefore = await hiddenIds(row.axis);

  // Something the book is not wearing: the menu refuses to remove the one in use.
  const idle = await page.evaluate(
    (label) =>
      [...document.querySelectorAll(`[aria-label="${label}"] .nb-chip`)].findIndex(
        (c) =>
          c.getAttribute('aria-pressed') !== 'true' &&
          c.getAttribute('role') !== 'switch' &&
          !c.classList.contains('nb-chip-gilt'),
      ),
    row.label,
  );
  check(idle >= 0, `${row.label}: found a chip the book is not wearing`, `index ${idle}`);
  const chip = page.locator(`[aria-label="${row.label}"] .nb-chip`).nth(idle);
  const word = ((await chip.textContent()) ?? '').replace(/★/g, '').trim();

  const named = await openMenu(chip);
  check(
    named.toLowerCase() === word.toLowerCase(),
    `${row.label}: the menu names the chip that was right-clicked`,
    `menu “${named}” vs chip “${word}”`,
  );
  await menuItem('remove from the list').click();
  await page.waitForTimeout(500);

  const after = await chipWords(row.label);
  check(!after.includes(word), `${row.label}: the removed chip left the row`, word);
  check(
    after.length === before.length - 1,
    `${row.label}: the row is exactly one shorter`,
    `${before.length} → ${after.length}`,
  );
  const storedAfter = await hiddenIds(row.axis);
  check(
    storedAfter.length === storedBefore.length + 1,
    `${row.label}: the store grew one removal on its own axis '${row.axis}'`,
    storedAfter.join(','),
  );

  await openDrawer(`[aria-label="${row.label}"]`);
  const drawer = await page.$$eval('.nb-cur-row-name', (rows) =>
    rows.map((r) => r.textContent?.trim() ?? ''),
  );
  check(
    drawer.some((name) => name.toLowerCase() === word.toLowerCase()),
    `${row.label}: the restore drawer names it`,
    drawer.join(', '),
  );
  // Tick the row that names the word, not simply the first box: this file is
  // re-runnable against a database another run may have left entries in, and
  // "the first checkbox" would restore somebody else's removal instead.
  const named2 = page
    .locator('.nb-cur-drawer .nb-cur-row', { hasText: word })
    .locator('input[type="checkbox"]');
  const box = (await named2.count()) > 0
    ? named2.first()
    : page.locator('.nb-cur-drawer input[type="checkbox"]').first();
  await box.check();
  await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
  await page.waitForTimeout(600);
  check((await chipWords(row.label)).includes(word), `${row.label}: it came back`, word);
  check(
    (await hiddenIds(row.axis)).length === storedBefore.length,
    `${row.label}: and the store is back where it started`,
  );
}
await shot('refute-01-four-rows');

/* ================================================================ *
 * 3 — a star on one of the four                                     *
 * ================================================================ */

console.log('\n3. star the last edge treatment twice: it should lead its row');
const edgesBefore = await chipWords('Edge treatment');
const lastEdge = page.locator('[aria-label="Edge treatment"] .nb-chip').nth(edgesBefore.length - 1);
const starred = ((await lastEdge.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(lastEdge);
await menuItem('first of them all').click();
await page.waitForTimeout(600);
check(
  (await chipWords('Edge treatment'))[0] === starred,
  'a two-star edge leads its row',
  `“${starred}” was last of ${edgesBefore.length}`,
);
check(
  (await page.$$eval('[aria-label="Edge treatment"] .nb-mark', (m) => m.length)) > 0,
  'the gilt plate is drawn on the chip',
);
// Put it back so the reload check below is not reading a starred row.
await openMenu(page.locator('[aria-label="Edge treatment"] .nb-chip').first());
await menuItem('no star').click();
await page.waitForTimeout(500);

/* ================================================================ *
 * 4 — the dice on a row the other probe never rolled                *
 * ================================================================ */

console.log('\n4. remove an edge, then roll “wear & edges” thirty times');
const idleEdge = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label="Edge treatment"] .nb-chip')].findIndex(
    (c) => c.getAttribute('aria-pressed') !== 'true',
  ),
);
const edgeChip = page.locator('[aria-label="Edge treatment"] .nb-chip').nth(idleEdge);
const goneEdge = ((await edgeChip.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(edgeChip);
await menuItem('remove from the list').click();
await page.waitForTimeout(500);
console.log(`  removed “${goneEdge}” of ${edgesBefore.length}`);

const landed = new Set();
for (let i = 0; i < 30; i += 1) {
  await page.getByRole('button', { name: 'Reroll wear & edges' }).click();
  await page.waitForTimeout(120);
  const on = await page.evaluate(
    () =>
      [...document.querySelectorAll('[aria-label="Edge treatment"] .nb-chip')]
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => (c.textContent ?? '').replace(/★/g, '').trim())[0] ?? '',
  );
  if (on !== '') landed.add(on);
}
console.log(`  thirty rolls landed on: ${[...landed].join(', ')}`);
check(landed.size > 1, 'the edge dice actually moved', `${landed.size} distinct edges`);
check(!landed.has(goneEdge), 'thirty rolls, and never the removed edge', goneEdge);

/* ================================================================ *
 * 5 — and does any of it survive a reload?                          *
 * ================================================================ */

console.log('\n5. reload (localStorage kept) and look at the row again');
const beforeReload = await hiddenIds('edge');
console.log('  hidden on "edge" before the reload:', beforeReload.join(','));
await boot({ fresh: false });
await openStudio();
const afterReload = await hiddenIds('edge');
check(
  afterReload.length === beforeReload.length,
  'the removal was written down and read back',
  `${beforeReload.join(',')} → ${afterReload.join(',')}`,
);
const edgesNow = await chipWords('Edge treatment');
check(
  !edgesNow.includes(goneEdge),
  'and the row still does not offer it after a reload',
  `${edgesNow.length} chips`,
);
await shot('refute-02-after-reload');

// Put the shelf back the way it was found.
await openDrawer('[aria-label="Edge treatment"]');
await page.locator('.nb-cur-drawer button.nb-cur-btn', { hasText: 'all of them' }).first().click().catch(async () => {
  const boxes = page.locator('.nb-cur-drawer input[type="checkbox"]');
  for (let i = 0; i < (await boxes.count()); i += 1) await boxes.nth(i).check();
});
await page.waitForTimeout(300);
await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
await page.waitForTimeout(600);
check((await hiddenIds('edge')).length === 0, 'tidied up: nothing left removed on edge');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} FAILED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
