/**
 * shots-now/probe-curated-axes.mjs — the sixteen lists that declared a curation
 * and offered none of it, driven as a reader drives them.
 *
 * `src/data/shelfOfMine.ts` named thirty-three axes. Seventeen were bound to a
 * picker; sixteen were words and nothing else. The store would have recorded a
 * removal against 'ornament' or 'sticker' quite happily, persisted it to
 * SQLite, and handed it back on the next launch — to a panel that never asked.
 * Nothing in the tree could tell that apart from a list that had opted out,
 * which is the whole reason this file exists and why every assertion below is
 * against APPLIED state rather than against a store write.
 *
 * The rules, so a failure here says which one broke:
 *
 *   - it only ever CLICKS. Nothing is removed or starred through a bridge; the
 *     point is whether the right-click menu can reach the mechanism at all.
 *   - it reads back through `__shelfCuration`, handed out by `world.ts` from
 *     the store instance the app itself subscribed to. A probe's own
 *     `import('/src/data/shelfOfMine')` can land on a SECOND copy of the module
 *     on a dev server that has served HMR updates, and that copy knows nothing
 *     about what the panel just did.
 *   - and it checks the DOM the reader is looking at either side of every
 *     removal, because "the store says hidden" is exactly the half that was
 *     already working.
 *
 * Usage: node shots-now/probe-curated-axes.mjs [--url=http://localhost:1420]
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
  await page.screenshot({ path: `qa/ui/${name}.png` });
  console.log(`  shot qa/ui/${name}.png`);
};

const menuItem = (text) =>
  page.locator('.nb-cur-menu button.nb-cur-menu-item', { hasText: text });

/**
 * The words printed on one chip row, in the order they are shown.
 *
 * The star plate is a span INSIDE the button, so a starred chip's
 * `textContent` reads "★★heart" — which is the correct markup and the wrong
 * string to compare a name against. Stripped here rather than in the app: the
 * plate belongs in the button so the whole chip is one hit target.
 */
const chipWords = (label, sel = '.nb-chip') =>
  page.$$eval(
    `[aria-label="${label}"] ${sel}`,
    (chips) => chips.map((c) => (c.textContent ?? '').replace(/★/g, '').trim()),
  );

/**
 * Right-click one entry and wait for its menu.
 *
 * Scrolls first and then pauses: the menu closes on any scroll (a rail panel
 * scrolls constantly), so opening it before the row has settled opens a menu
 * that vanishes on the next frame.
 */
const openMenu = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locator.click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  return ((await page.locator('.nb-cur-menu-name').textContent()) ?? '').trim();
};

/**
 * Right-click the LIST itself and open the drawer of what was removed from it.
 *
 * Aimed at the row's bottom-left corner rather than at its centre, which is
 * what Playwright's own `click` would use. The centre of a chip row is a CHIP,
 * and a chip's menu offers the same drawer — so a probe that hit it would pass
 * while the row's own handler was never wired at all.
 *
 * Same scroll-then-settle guard as above: the menu closes on any scroll, and a
 * rail panel scrolls under every one of these clicks.
 */
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

/* ========================================================================== *
 * boot                                                                       *
 * ========================================================================== */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
await page.waitForFunction(() => globalThis.__shelfCuration !== undefined, null, { polling: 400 });

// The tutorial scrim eats every later click — get rid of it FIRST.
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  console.log('  dismissed the tour');
}
await page.waitForTimeout(1200);

console.log('\n0. open a book and its studio');
const opened = await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const first = list[0];
  if (!first) return null;
  app.appState.openBook(first.id);
  return { id: first.id, title: first.title };
});
console.log('  opened:', JSON.stringify(opened));
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(1200);
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
await page.waitForTimeout(1000);
await shot('axes-00-studio');

/* ========================================================================== *
 * 1 — four newly wired chip rows: remove, prove it left, put it back         *
 * ========================================================================== */

/**
 * The rows this run walks end to end — five of the nine the book studio gained,
 * chosen to span the shapes: a fifty-one grid, a fifty row, two short ones, and
 * the one whose value is a HEIGHT rather than a name.
 *
 * Each removal is aimed at a chip the book is not already wearing. The menu
 * refuses to remove the one in use, on purpose ("you are using this one"), and
 * a probe that clicked a disabled item would be reporting a menu that silently
 * did nothing.
 */
const ROWS = [
  { axis: 'ornament', label: 'Ornament stamp' },
  { axis: 'title-plate', label: 'Title plate' },
  { axis: 'charm', label: 'Charm' },
  { axis: 'cover-medallion', label: 'Cover medallion' },
  { axis: 'format', label: 'Book format' },
];

for (const [n, row] of ROWS.entries()) {
  console.log(`\n1.${n + 1} ${row.label} — remove one, and put it back`);

  const before = await chipWords(row.label);
  check(before.length > 0, `${row.label}: the row is on screen`, `${before.length} chips`);

  // Something the book is not wearing: the menu will not remove the one in use.
  const idle = await page.evaluate(
    (label) =>
      [...document.querySelectorAll(`[aria-label="${label}"] .nb-chip`)].findIndex(
        (c) => c.getAttribute('aria-pressed') !== 'true',
      ),
    row.label,
  );
  const chip = page.locator(`[aria-label="${row.label}"] .nb-chip`).nth(idle);
  const word = ((await chip.textContent()) ?? '').replace(/★/g, '').trim();

  const named = await openMenu(chip);
  check(
    named.toLowerCase() === word.toLowerCase(),
    `${row.label}: right-click opens the menu, naming the chip`,
    `menu said “${named}”, chip says “${word}”`,
  );
  if (n === 0) await shot('axes-01-chip-menu');

  await menuItem('remove from the list').click();
  await page.waitForTimeout(500);

  const after = await chipWords(row.label);
  check(!after.includes(word), `${row.label}: the removed chip left the row`, word);
  const hidden = await page.evaluate((axis) => [...globalThis.__shelfCuration.hidden(axis)], row.axis);
  check(hidden.length === 1, `${row.label}: the store recorded exactly one removal`, hidden.join(','));
  check(
    after.length === before.length - 1,
    `${row.label}: the row is one shorter`,
    `${before.length} → ${after.length}`,
  );

  // …and back again, through the drawer the reader reaches by right-clicking
  // the row itself rather than one of its chips.
  await openDrawer(`[aria-label="${row.label}"]`);
  const drawer = await page.$$eval('.nb-cur-row-name', (rows) =>
    rows.map((r) => r.textContent?.trim() ?? ''),
  );
  check(
    drawer.some((name) => name.toLowerCase() === word.toLowerCase()),
    `${row.label}: the drawer names it, so it can be asked for back`,
    drawer.join(', '),
  );
  if (n === 0) await shot('axes-02-drawer');

  await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
  await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
  await page.waitForTimeout(600);
  const restored = await chipWords(row.label);
  check(restored.includes(word), `${row.label}: it came back to the row`, word);
  check(
    (await page.evaluate((axis) => globalThis.__shelfCuration.hidden(axis).length, row.axis)) === 0,
    `${row.label}: and back out of the drawer`,
  );
}

/* ========================================================================== *
 * 2 — a star leads the row                                                    *
 * ========================================================================== */

console.log('\n2. star the last ornament twice: it should lead its row');
const stampsBefore = await chipWords('Ornament stamp');
const lastStamp = page.locator('[aria-label="Ornament stamp"] .nb-chip').nth(stampsBefore.length - 1);
const starred = ((await lastStamp.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(lastStamp);
await menuItem('first of them all').click();
await page.waitForTimeout(600);
const stampsAfter = await chipWords('Ornament stamp');
check(stampsAfter[0] === starred, 'a two-star chip leads its row', `“${starred}” was last`);
check(
  (await page.$$eval('[aria-label="Ornament stamp"] .nb-mark', (m) => m.length)) > 0,
  'the gilt plate is drawn on the chip',
);
// The shot has to SHOW the plate, so put the head of the row on screen rather
// than wherever the last right-click left the panel scrolled to.
await page.locator('[aria-label="Ornament stamp"] .nb-chip').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('axes-03-starred');

/* ========================================================================== *
 * 3 — the dice stops rolling what was removed                                 *
 * ========================================================================== */

console.log('\n3. remove a format, then re-roll the format twenty times');
const formats = await chipWords('Book format');
const idleFormat = await page.evaluate(
  () =>
    [...document.querySelectorAll('[aria-label="Book format"] .nb-chip')].findIndex(
      (c) => c.getAttribute('aria-pressed') !== 'true',
    ),
);
const formatChip = page.locator('[aria-label="Book format"] .nb-chip').nth(idleFormat);
const goneFormat = ((await formatChip.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(formatChip);
await menuItem('remove from the list').click();
await page.waitForTimeout(500);
console.log(`  removed “${goneFormat}” of ${formats.join(', ')}`);

const pool = await page.evaluate(
  (ids) => ({
    hidden: [...globalThis.__shelfCuration.hidden('format')],
    pool: [...globalThis.__shelfCuration.roll('format', ids)],
  }),
  ['folio', 'quarto', 'octavo', 'duodecimo', 'pocket'],
);
check(pool.pool.length === 4, 'the roll pool is one smaller', `${pool.pool.length} of 5`);
check(
  !pool.pool.includes(pool.hidden[0]),
  'the removed format left the roll pool',
  pool.hidden.join(','),
);

const landed = new Set();
for (let i = 0; i < 20; i += 1) {
  await page.getByRole('button', { name: 'Reroll format' }).click();
  await page.waitForTimeout(150);
  const on = await page.evaluate(
    () =>
      [...document.querySelectorAll('[aria-label="Book format"] .nb-chip')]
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => (c.textContent ?? '').replace(/★/g, '').trim())[0] ?? '',
  );
  if (on !== '') landed.add(on);
}
console.log(`  twenty rolls landed on: ${[...landed].join(', ')}`);
check(landed.size > 1, 'the dice actually moved', `${landed.size} distinct formats`);
check(!landed.has(goneFormat), 'twenty rolls, and never the removed one', goneFormat);
await shot('axes-04-dice');

/* ========================================================================== *
 * 4 — page style: four cards, same menu                                       *
 * ========================================================================== */

console.log('\n4. the page-style cards take the same right-click');
await page.locator('.nb-rail-button[data-tool="page-style"]').click();
await page.waitForSelector('.nb-pagestyle', { timeout: 30000 });
await page.waitForTimeout(700);
const stylesBefore = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
console.log('  page styles:', stylesBefore.join(', '));
const idleStyle = await page.evaluate(
  () =>
    [...document.querySelectorAll('.nb-pagestyle-card')].findIndex(
      (c) => c.getAttribute('aria-pressed') !== 'true',
    ),
);
const styleCard = page.locator('.nb-pagestyle-card').nth(idleStyle);
const styleWord = (await styleCard.locator('.nb-pagestyle-label').textContent())?.trim() ?? '';
await openMenu(styleCard);
await menuItem('remove from the list').click();
await page.waitForTimeout(500);
const stylesAfter = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
check(!stylesAfter.includes(styleWord), 'the removed ruling left the grid', styleWord);
check(
  (await page.evaluate(() => globalThis.__shelfCuration.hidden('page-style').length)) === 1,
  'and the store knows it, on its own axis',
);
await shot('axes-05-page-style');

await openDrawer('.nb-pagestyle-grid');
await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
await page.waitForTimeout(600);
check(
  (
    await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
      n.map((x) => x.textContent?.trim() ?? ''),
    )
  ).includes(styleWord),
  'and the drawer gave the ruling back',
  styleWord,
);

/*
 * The card's thumbnail, measured rather than eyeballed.
 *
 * The star plate needs a positioned wrapper, and the wrapper put a `<span>`
 * back into an inline formatting context — where `width` and `height` mean
 * nothing. All four rulings silently collapsed to a 2px hairline: the rule was
 * still in the stylesheet, still matching, and still doing nothing. So the
 * size is asserted, not looked at, because looking at it is exactly what
 * missed it the first time.
 */
await page.locator('.nb-pagestyle-card').last().click({ button: 'right' });
await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
await menuItem('first of them all').click();
await page.waitForTimeout(600);
const cards = await page.$$eval('.nb-pagestyle-card', (list) =>
  list.map((card) => {
    const thumb = card.querySelector('.nb-pagestyle-thumb');
    const box = thumb?.getBoundingClientRect();
    return {
      name: card.querySelector('.nb-pagestyle-label')?.textContent?.trim() ?? '',
      w: Math.round(box?.width ?? 0),
      h: Math.round(box?.height ?? 0),
      starred: card.querySelector('.nb-mark') !== null,
    };
  }),
);
check(
  cards.every((c) => c.w === 64 && c.h === 46),
  'every ruling still draws at its full 64x46',
  cards.map((c) => `${c.name} ${c.w}x${c.h}`).join(', '),
);
check(cards[0]?.starred === true, 'and a two-star ruling leads the grid', cards[0]?.name ?? '');
await shot('axes-05b-page-style-starred');

/* ========================================================================== *
 * 5 — the catalogue's two long shelves                                        *
 * ========================================================================== */

console.log('\n5. the catalogue: a sticker and a piece of stationery');
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
await page.waitForSelector('.nb-catalogue', { timeout: 30000 });
await page.waitForTimeout(900);

for (const shelf of [
  { axis: 'sticker', tab: 'stickers' },
  { axis: 'stationery', tab: 'paper & cards' },
]) {
  console.log(`  — ${shelf.tab}`);
  await page.locator('.nb-cat-shelves .nb-chip', { hasText: shelf.tab }).first().click();
  await page.waitForTimeout(600);
  const tiles = () =>
    page.$$eval('.nb-cat-item', (items) =>
      items.map((i) => i.getAttribute('data-entry') ?? ''),
    );
  const before = await tiles();
  check(before.length > 0, `${shelf.tab}: tiles on screen`, `${before.length}`);

  const tile = page.locator('.nb-cat-item').first();
  const id = await tile.getAttribute('data-entry');
  await openMenu(tile);
  await menuItem('remove from the list').click();
  await page.waitForTimeout(600);
  const after = await tiles();
  check(!after.includes(id), `${shelf.tab}: the removed tile left the shelf`, id ?? '');
  const stored = await page.evaluate(
    (axis) => [...globalThis.__shelfCuration.hidden(axis)],
    shelf.axis,
  );
  check(stored.includes(id), `${shelf.tab}: filed under '${shelf.axis}'`, stored.join(','));

  // The other half of the promise: a removal must not be findable by search
  // either, or the reader meets it again at the worst possible moment.
  await page.locator('.nb-cat-search-input').fill(id.replace(/^(sticker|cmd)-/, ''));
  await page.waitForTimeout(600);
  const hits = await tiles();
  check(!hits.includes(id), `${shelf.tab}: and the search does not hand it back`, id ?? '');
  await page.locator('.nb-cat-search-input').fill('');
  await page.waitForTimeout(500);

  await openDrawer('.nb-cat-grid');
  await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
  await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
  await page.waitForTimeout(700);
  check((await tiles()).includes(id), `${shelf.tab}: the drawer gave it back`, id ?? '');

  // And the notation, on the same tiles: a doodle you always reach for goes to
  // the head of its shelf rather than staying wherever the vocabulary put it.
  const last = page.locator('.nb-cat-item').last();
  const lastId = await last.getAttribute('data-entry');
  await openMenu(last);
  await menuItem('first of them all').click();
  await page.waitForTimeout(700);
  check(
    (await tiles())[0] === lastId,
    `${shelf.tab}: a two-star tile leads the shelf`,
    lastId ?? '',
  );
  check(
    (await page.$$eval('.nb-cat-item .nb-mark', (m) => m.length)) > 0,
    `${shelf.tab}: the gilt plate is drawn on the tile`,
  );
  await shot(`axes-06-${shelf.axis}`);
}

/* ========================================================================== *
 * 6 — the sound sets, in a focus-trapped dialog                                *
 * ========================================================================== */

console.log('\n6. a sound set, removed from Settings');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const settings = page.getByRole('button', { name: 'Settings' });
if ((await settings.count()) > 0) {
  await settings.first().click();
  await page.waitForTimeout(1200);
  const row = page.locator('[aria-label="sound set"]').first();
  if ((await row.count()) > 0) {
    const before = await chipWords('sound set', '.nbs-seg-chip');
    console.log('  shortlist:', before.join(', '));
    const idle = await page.evaluate(
      () =>
        [...document.querySelectorAll('[aria-label="sound set"] .nbs-seg-chip')].findIndex(
          (c) => c.getAttribute('aria-pressed') !== 'true',
        ),
    );
    const chip = page.locator('[aria-label="sound set"] .nbs-seg-chip').nth(idle);
    const word = ((await chip.textContent()) ?? '').replace(/★/g, '').trim();
    await openMenu(chip);
    await menuItem('remove from the list').click();
    await page.waitForTimeout(600);
    const after = await chipWords('sound set', '.nbs-seg-chip');
    check(!after.includes(word), 'the removed set left the row', word);
    check(
      (await page.evaluate(() => globalThis.__shelfCuration.hidden('sound-set').length)) === 1,
      "and the store filed it under 'sound-set'",
    );
    // A dialog this long opens on Appearance, so the shot has to be told what
    // it is a shot OF — otherwise it photographs the theme chips and proves
    // nothing about the row three sections down.
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot('axes-07-sound-set');
    await openDrawer('[aria-label="sound set"]');
    await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
    await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
    await page.waitForTimeout(700);
    check(
      (await chipWords('sound set', '.nbs-seg-chip')).includes(word),
      'and the drawer gave the set back',
      word,
    );
  } else {
    console.log('  (the sound-set row was not on screen in this run; skipped)');
  }
} else {
  console.log('  (Settings was not reachable in this run; skipped)');
}

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} FAILED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
