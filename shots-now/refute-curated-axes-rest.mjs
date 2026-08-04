/**
 * shots-now/refute-curated-axes-rest.mjs — the four rows the first probe never
 * touched, plus the two questions it never asked.
 *
 * `probe-curated-axes.mjs` walks nine of the thirteen newly-bound axes. Four
 * were left unwalked — 'binding-material', 'lettering', 'edge' and
 * 'cover-frame' — and an axis that is only ever read in a diff is exactly the
 * shape of defect this wave was sent to clear: a prop spelled correctly next
 * to a row nobody can right-click. Three of the four also carry a NON-chip
 * child inside the same group ("as bound", "gold tooling"), which is the way a
 * curated row is most likely to hand the menu the wrong entry id.
 *
 * Two things beyond re-walking them, both about APPLIED state rather than the
 * write:
 *
 *   - a RELOAD. The first probe proves the row is one shorter in the session
 *     that removed the chip. It never proves the app reads the row back: the
 *     removal goes to the settings blob, and a panel that filtered on its own
 *     in-memory copy would pass every check there and come back full on the
 *     next launch. So all four removals are made, the page is reloaded cold,
 *     and the rows are counted again before anything is restored.
 *   - the DICE on an axis that is not 'format'. `respectingCuration` re-draws
 *     through `rollPool`, and it is driven by a per-row `idOf` — a row whose
 *     `idOf` reads the wrong field would leave the dice putting a removed
 *     covering straight back on the book.
 *
 * Same rules as the probe it extends: it only ever clicks, and every store
 * assertion goes through `__shelfCuration`, which `world.ts` hands out from the
 * instance the app itself subscribed to.
 *
 * Usage: node shots-now/refute-curated-axes-rest.mjs [--url=http://localhost:1420]
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
const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
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

const chipWords = (label) =>
  page.$$eval(`[aria-label="${label}"] .nb-chip`, (chips) =>
    chips.map((c) => (c.textContent ?? '').replace(/★/g, '').trim()),
  );

/** The menu closes on any scroll, so settle the row before opening it. */
const openMenu = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await locator.click({ button: 'right' });
  await page.waitForSelector('.nb-cur-menu', { timeout: 8000 });
  return ((await page.locator('.nb-cur-menu-name').textContent()) ?? '').trim();
};

/** Right-click the ROW's own corner — a chip's menu would answer for it. */
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

const boot = async ({ clear }) => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (clear) {
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
  await page.waitForSelector('.nb-rail', { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await page.waitForSelector('.nb-book-studio', { timeout: 30000 });
  await page.waitForTimeout(1000);
  return opened;
};

/* ========================================================================== *
 * 1 — the four unwalked rows                                                 *
 * ========================================================================== */

await boot({ clear: true });
console.log('\n0. open a book and its studio');
console.log('  opened:', JSON.stringify(await openStudio()));

const ROWS = [
  { axis: 'binding-material', label: 'Binding material' },
  { axis: 'lettering', label: 'Title lettering' },
  { axis: 'edge', label: 'Edge treatment' },
  { axis: 'cover-frame', label: 'Cover frame' },
];

/** What each row looked like before anything was taken off it. */
const widths = new Map();
const removed = new Map();

for (const [n, row] of ROWS.entries()) {
  console.log(`\n1.${n + 1} ${row.label} — is it a list a reader can prune?`);

  const before = await chipWords(row.label);
  widths.set(row.axis, before.length);
  check(before.length > 0, `${row.label}: the row is on screen`, `${before.length} chips`);

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
    `${row.label}: right-click names the chip under the cursor`,
    `menu said “${named}”, chip says “${word}”`,
  );

  await menuItem('remove from the list').click();
  await page.waitForTimeout(500);

  const after = await chipWords(row.label);
  check(!after.includes(word), `${row.label}: the removed chip left the row`, word);
  check(
    after.length === before.length - 1,
    `${row.label}: the row is one shorter`,
    `${before.length} → ${after.length}`,
  );
  const hidden = await page.evaluate(
    (axis) => [...globalThis.__shelfCuration.hidden(axis)],
    row.axis,
  );
  check(hidden.length === 1, `${row.label}: filed under '${row.axis}'`, hidden.join(','));
  removed.set(row.axis, { word, id: hidden[0] ?? '' });
}
await shot('refute-axes-01-four-rows');

/* ========================================================================== *
 * 2 — the dice, on an axis that is not 'format'                              *
 * ========================================================================== */

console.log('\n2. re-roll the covering twenty times with one removed');
const goneCovering = removed.get('binding-material');
const landed = new Set();
for (let i = 0; i < 20; i += 1) {
  await page.getByRole('button', { name: 'Reroll covering' }).click();
  await page.waitForTimeout(150);
  const on = await page.evaluate(
    () =>
      [...document.querySelectorAll('[aria-label="Binding material"] .nb-chip')]
        .filter((c) => c.getAttribute('aria-pressed') === 'true')
        .map((c) => (c.textContent ?? '').replace(/★/g, '').trim())[0] ?? '',
  );
  if (on !== '') landed.add(on);
}
console.log(`  twenty rolls landed on: ${[...landed].join(', ')}`);
check(landed.size > 1, 'the dice actually moved', `${landed.size} distinct coverings`);
check(
  !landed.has(goneCovering.word),
  'twenty rolls, and never the removed covering',
  goneCovering.word,
);

/* ========================================================================== *
 * 3 — a cold reload: does the panel READ the row back?                       *
 * ========================================================================== */

console.log('\n3. reload cold — the four removals must survive into a new session');
await boot({ clear: false });
await openStudio();

for (const row of ROWS) {
  const gone = removed.get(row.axis);
  const now = await chipWords(row.label);
  check(
    !now.includes(gone.word),
    `${row.label}: still gone after a reload`,
    `${gone.word} — ${now.length} chips`,
  );
  check(
    now.length === widths.get(row.axis) - 1,
    `${row.label}: and the row is still one shorter`,
    `${widths.get(row.axis)} → ${now.length}`,
  );
  const hidden = await page.evaluate(
    (axis) => [...globalThis.__shelfCuration.hidden(axis)],
    row.axis,
  );
  check(
    hidden.includes(gone.id),
    `${row.label}: the store read it back off disk`,
    hidden.join(','),
  );
}
await shot('refute-axes-02-after-reload');

/* ========================================================================== *
 * 4 — and the drawer gives all four back                                     *
 * ========================================================================== */

console.log('\n4. the restore drawer, row by row');
for (const row of ROWS) {
  const gone = removed.get(row.axis);
  await openDrawer(`[aria-label="${row.label}"]`);
  const names = await page.$$eval('.nb-cur-row-name', (rows) =>
    rows.map((r) => r.textContent?.trim() ?? ''),
  );
  check(
    names.some((name) => name.toLowerCase() === gone.word.toLowerCase()),
    `${row.label}: the drawer names it`,
    names.join(', '),
  );
  await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
  await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
  await page.waitForTimeout(600);
  const back = await chipWords(row.label);
  check(back.includes(gone.word), `${row.label}: it came back to the row`, gone.word);
  check(
    (await page.evaluate((axis) => globalThis.__shelfCuration.hidden(axis).length, row.axis)) === 0,
    `${row.label}: and back out of the drawer`,
  );
}
await shot('refute-axes-03-restored');

/* ========================================================================== *
 * 5 — the three words that were REMOVED rather than wired                    *
 * ========================================================================== */

console.log("\n5. 'tooling', 'wear' and 'icon-colour' are no longer axes at all");
const stillNamed = await page.evaluate(async () => {
  const mod = await import('/src/data/shelfOfMine.ts');
  return ['tooling', 'wear', 'icon-colour'].filter((a) => mod.isCurationAxis(a));
});
check(
  stillNamed.length === 0,
  'no axis is named that no picker keeps',
  stillNamed.join(',') || 'none left',
);

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${fails.length === 0 ? 'ALL CHECKS PASSED' : `${fails.length} FAILED`} ===`);
for (const f of fails) console.log(`  x ${f}`);

await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
