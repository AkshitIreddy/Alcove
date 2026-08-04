/**
 * shots-now/_refute-curated-chips.mjs — the second opinion on `CuratedChips`.
 *
 * `probe-curated-axes.mjs` walks five of the nine chip rows the book studio
 * gained, plus the page-style cards, the catalogue and the sound sets. This one
 * attacks the three things a passing run of that probe still says nothing
 * about:
 *
 *   1. the FOUR rows it never opens — Binding material, Title lettering, Edge
 *      treatment, Cover frame. Nine call sites of one component is nine chances
 *      to pass the wrong axis or the wrong `activeId`, and a row whose
 *      `activeId` matches no entry looks perfectly healthy from outside: every
 *      chip draws, nothing is pressed, and the menu's "you are using this one"
 *      guard silently never fires. So the shape of all nine is measured, and
 *      the four are then driven end to end — including which axis the store
 *      filed the removal under, because a copy-pasted `axis=` prop is the one
 *      mistake this component makes cheap.
 *   2. `nb-cur-gone`. The dashed chip is claimed as part of the component and
 *      is the one state no removal can reach on its own, because the menu
 *      refuses to remove the entry in use. It needs a removal and then a return
 *      to it — here, "as bound" handing the covering back to the binding's own
 *      material after that material has been taken off the list.
 *   3. the reload. A curation held in a module-scope object would pass every
 *      check in the other file and be gone the next time the app opened, and
 *      nothing in the DOM tells the two apart.
 *
 * Same rules as its sibling: it only ever CLICKS, and every read of the store
 * goes through `__shelfCuration`, the read-only bridge `world.ts` hands out
 * from the instance the app itself subscribed to.
 *
 * Usage: node shots-now/_refute-curated-chips.mjs [--url=http://localhost:1420]
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

/** The words on one row's chips, with the star plate stripped off. */
const chipWords = (label) =>
  page.$$eval(`[aria-label="${label}"] .nb-chip`, (chips) =>
    chips.map((c) => (c.textContent ?? '').replace(/★/g, '').trim()),
  );

/** Scroll, settle, right-click: the menu closes on any scroll of the panel. */
const openMenu = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locator.click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  return ((await page.locator('.nb-cur-menu-name').textContent()) ?? '').trim();
};

/** The row's OWN menu, aimed at its bottom-left corner — never at a chip. */
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

const openFirstBook = () =>
  page.evaluate(async () => {
    const app = await import('/src/state/app.ts');
    const books = await import('/src/data/books.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const first = list[0];
    if (!first) return null;
    app.appState.openBook(first.id);
    return { id: first.id, title: first.title };
  });

const openStudio = async () => {
  await page.waitForSelector('.nb-rail', { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
  await page.waitForTimeout(900);
};

const bootWorld = async () => {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  await page.waitForFunction(() => globalThis.__shelfCuration !== undefined, null, {
    polling: 400,
  });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(1000);
};

/* ========================================================================== *
 * boot                                                                       *
 * ========================================================================== */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await bootWorld();
console.log('  opened:', JSON.stringify(await openFirstBook()));
await openStudio();

/* ========================================================================== *
 * 1 — every one of the nine rows: the markup, and something pressed          *
 * ========================================================================== */

console.log('\n1. all nine chip rows: the markup the claim promises to keep');

const ROWS = [
  { axis: 'binding-material', label: 'Binding material', grid: false },
  { axis: 'ornament', label: 'Ornament stamp', grid: true },
  { axis: 'title-plate', label: 'Title plate', grid: false },
  { axis: 'lettering', label: 'Title lettering', grid: false },
  { axis: 'edge', label: 'Edge treatment', grid: false },
  { axis: 'format', label: 'Book format', grid: false },
  { axis: 'charm', label: 'Charm', grid: true },
  { axis: 'cover-frame', label: 'Cover frame', grid: false },
  { axis: 'cover-medallion', label: 'Cover medallion', grid: true },
];

for (const row of ROWS) {
  const seen = await page.evaluate((label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (el === null) return null;
    const chips = [...el.querySelectorAll('.nb-chip')];
    return {
      cls: el.className,
      role: el.getAttribute('role'),
      chips: chips.length,
      pressed: chips.filter((c) => c.getAttribute('aria-pressed') === 'true').length,
      names: chips.map((c) => (c.textContent ?? '').replace(/★/g, '').trim()).slice(0, 3),
    };
  }, row.label);
  const want = row.grid ? 'nb-chip-grid' : 'nb-chip-row';
  check(
    seen !== null && seen.role === 'group' && seen.cls.includes(want) && seen.chips > 0,
    `${row.label}: a ${want} group of nb-chip buttons, as before`,
    seen === null ? 'NOT ON SCREEN' : `${seen.cls} · ${seen.chips} chips · ${seen.names.join(', ')}…`,
  );
  // A row whose activeId matches no entry draws perfectly and is a dead list:
  // nothing pressed, and the menu's in-use guard can never fire.
  check(
    seen !== null && seen.pressed === 1,
    `${row.label}: exactly one chip reads as the one in use`,
    seen === null ? '' : `${seen.pressed} pressed`,
  );
}

/* ========================================================================== *
 * 2 — the four rows the sibling probe never opens                            *
 * ========================================================================== */

const UNTOUCHED = ROWS.filter((r) =>
  ['binding-material', 'lettering', 'edge', 'cover-frame'].includes(r.axis),
);
const ALL_AXES = ROWS.map((r) => r.axis);

for (const [n, row] of UNTOUCHED.entries()) {
  console.log(`\n2.${n + 1} ${row.label} — remove one, and put it back`);
  const before = await chipWords(row.label);

  const idle = await page.evaluate(
    (label) =>
      [...document.querySelectorAll(`[aria-label="${label}"] .nb-chip`)].findIndex(
        (c) => c.getAttribute('aria-pressed') === 'false',
      ),
    row.label,
  );
  check(idle >= 0, `${row.label}: has an entry the book is not wearing`, `index ${idle}`);
  const chip = page.locator(`[aria-label="${row.label}"] .nb-chip`).nth(idle);
  const word = ((await chip.textContent()) ?? '').replace(/★/g, '').trim();

  const named = await openMenu(chip);
  check(
    named.toLowerCase() === word.toLowerCase(),
    `${row.label}: the menu opens and names the chip`,
    `menu “${named}” / chip “${word}”`,
  );
  await menuItem('remove from the list').click();
  await page.waitForTimeout(500);

  const after = await chipWords(row.label);
  check(
    !after.includes(word) && after.length === before.length - 1,
    `${row.label}: the chip left the row`,
    `${before.length} → ${after.length}, without “${word}”`,
  );
  // Which axis it landed under, and that no OTHER row's axis moved: a
  // copy-pasted `axis=` prop is the cheap mistake nine call sites invite, and
  // it is invisible from the row itself.
  const filed = await page.evaluate(
    (axes) =>
      Object.fromEntries(
        axes.map((a) => [a, [...globalThis.__shelfCuration.hidden(a)]]),
      ),
    ALL_AXES,
  );
  const elsewhere = Object.entries(filed)
    .filter(([a, ids]) => a !== row.axis && ids.length > 0)
    .map(([a]) => a);
  check(
    filed[row.axis].length === 1 && elsewhere.length === 0,
    `${row.label}: filed under '${row.axis}' and under nothing else`,
    `${row.axis}=[${filed[row.axis].join(',')}]${elsewhere.length ? ` stray: ${elsewhere.join(',')}` : ''}`,
  );

  await openDrawer(`[aria-label="${row.label}"]`);
  const drawer = await page.$$eval('.nb-cur-row-name', (rows) =>
    rows.map((r) => r.textContent?.trim() ?? ''),
  );
  check(
    drawer.some((name) => name.toLowerCase() === word.toLowerCase()),
    `${row.label}: the drawer names it, so it can be asked for back`,
    drawer.join(', '),
  );
  await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
  await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
  await page.waitForTimeout(600);
  check((await chipWords(row.label)).includes(word), `${row.label}: and it came back`, word);
}

/* ========================================================================== *
 * 3 — the dashed chip: removed, and still on the book                        *
 * ========================================================================== */

console.log('\n3. nb-cur-gone: take the binding’s own covering off the list, then go back to it');

const bound = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label="Binding material"] .nb-chip')]
    .filter((c) => c.getAttribute('aria-pressed') === 'true')
    .map((c) => (c.textContent ?? '').replace(/★/g, '').trim()),
);
console.log(`  as bound: ${bound.join(', ')}`);

// Wear something else first: the menu refuses to remove the entry in use, on
// purpose, so the binding's own covering has to stop being the one in use.
const other = await page.evaluate(
  (worn) =>
    [...document.querySelectorAll('[aria-label="Binding material"] .nb-chip')]
      .map((c) => (c.textContent ?? '').replace(/★/g, '').trim())
      .find((name) => name !== worn) ?? '',
  bound[0],
);
await page
  .locator('[aria-label="Binding material"] .nb-chip', { hasText: new RegExp(`^${other}$`) })
  .first()
  .click();
await page.waitForTimeout(600);

const boundChip = page
  .locator('[aria-label="Binding material"] .nb-chip', { hasText: new RegExp(`^${bound[0]}$`) })
  .first();
await openMenu(boundChip);
await menuItem('remove from the list').click();
await page.waitForTimeout(500);
check(
  !(await chipWords('Binding material')).includes(bound[0]),
  'the binding’s own covering left the row',
  bound[0],
);

const asBound = page.locator('[aria-label="Binding material"] .nb-chip-ghost', {
  hasText: 'as bound',
});
check((await asBound.count()) > 0, 'the “as bound” way back is still offered');
await asBound.first().click();
await page.waitForTimeout(700);

const dashed = await page.evaluate(
  (word) =>
    [...document.querySelectorAll('[aria-label="Binding material"] .nb-chip')]
      .filter((c) => (c.textContent ?? '').replace(/★/g, '').trim() === word)
      .map((c) => ({
        gone: c.classList.contains('nb-cur-gone'),
        pressed: c.getAttribute('aria-pressed'),
        border: getComputedStyle(c).borderStyle,
      }))[0] ?? null,
  bound[0],
);
check(
  dashed !== null && dashed.pressed === 'true',
  'a covering the reader removed but is WEARING stays on the row',
  JSON.stringify(dashed),
);
check(
  dashed !== null && dashed.gone === true && String(dashed.border).includes('dashed'),
  'and it is drawn dashed, so it does not read as an ordinary member',
  dashed === null ? '' : String(dashed.border),
);
await boundChip.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('refute-chips-01-dashed');

// Empty the drawer again, so what survives the reload below is one known removal.
await openDrawer('[aria-label="Binding material"]');
await page.locator('.nb-cur-drawer button.nb-cur-btn').nth(1).click();
await page.waitForTimeout(600);
check(
  (await page.evaluate(() => globalThis.__shelfCuration.hidden('binding-material').length)) === 0,
  '“all of them” empties that drawer again',
);

/* ========================================================================== *
 * 4 — and both halves survive a reload                                       *
 * ========================================================================== */

console.log('\n4. remove an edge treatment and star another, then reload the whole app');

const edgesBefore = await chipWords('Edge treatment');
const idleEdge = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label="Edge treatment"] .nb-chip')].findIndex(
    (c) => c.getAttribute('aria-pressed') === 'false',
  ),
);
const edgeChip = page.locator('[aria-label="Edge treatment"] .nb-chip').nth(idleEdge);
const edgeWord = ((await edgeChip.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(edgeChip);
await menuItem('remove from the list').click();
await page.waitForTimeout(600);

// Order is the half a reload loses most quietly: the entry is still there,
// just not where the reader put it.
const lastEdge = page.locator('[aria-label="Edge treatment"] .nb-chip').last();
const starredEdge = ((await lastEdge.textContent()) ?? '').replace(/★/g, '').trim();
await openMenu(lastEdge);
await menuItem('first of them all').click();
await page.waitForTimeout(600);
check(
  (await chipWords('Edge treatment'))[0] === starredEdge,
  'the starred edge leads its row before the reload',
  starredEdge,
);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await bootWorld();
await openFirstBook();
await openStudio();

const edgesAfter = await chipWords('Edge treatment');
check(
  !edgesAfter.includes(edgeWord) && edgesAfter.length === edgesBefore.length - 1,
  'after a reload the removed edge is still off the row',
  `${edgesBefore.length} → ${edgesAfter.length}, without “${edgeWord}”`,
);
check(
  edgesAfter[0] === starredEdge,
  'and the starred one still leads it',
  `${edgesAfter.slice(0, 3).join(', ')}…`,
);
check(
  (await page.evaluate(() => globalThis.__shelfCuration.hidden('edge').length)) === 1,
  'and the store re-read the removal off the database',
);
await shot('refute-chips-02-after-reload');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} FAILED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
