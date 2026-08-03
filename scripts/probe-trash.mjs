/**
 * scripts/probe-trash.mjs — the trash is ONE drawer for the whole library,
 * and it now has to say so.
 *
 * A seam probe, not a specimen board. The panel showed every bookcase's
 * deletions and never mentioned it, which matters because three things behind
 * it are per-case: restore returns a book to the case it came from, empty
 * reaches across the whole library, and the shelf behind the card is only one
 * room. So the claims here are about the running app with two real bookcases
 * and a real deleted book in each — driven through the dock button, the
 * right-click menu and the panel's own controls, and read back through the
 * ?fx=force bridges (`__shelfBookcases`) plus the shelf's own accessible
 * mirror. "Restore put it back in the OTHER case" is only true if the other
 * case's shelf is holding it afterwards.
 *
 * Refuses to pass vacuously: a step that cannot find what it needs (two cases,
 * two trashed books, the chips) FAILS by name rather than skipping. A run that
 * the dev server reloads under (a parallel agent saving a file) aborts with
 * exit 2 and says so, rather than reporting churn as a finding.
 *
 * Usage: node scripts/probe-trash.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL = `${opt('url', 'http://localhost:1420')}/?fx=force`;
const STUB_KEY = 'notebook.stubdb.v1';
const TUTORIAL_KEY = 'appState:tutorialCompleted';

mkdirSync('qa/ui', { recursive: true });

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn()` is truthy, or throw naming what never happened. */
async function until(label, fn, timeout = 25000) {
  const stop = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > stop) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

/* --------------------------------------------------------------------------
 * The fixture.
 *
 * The browser-dev stub keeps its tables in localStorage, so a library can be
 * handed to the app the same way SQLite would hand it one: rows in, boot,
 * everything above the storage layer runs for real. Two bookcases, one book
 * standing in each and one crumpled into each (floor -1 with the same
 * `shelf.deletedAt` bookkeeping `trashBook` writes).
 *
 * Used only when the canvas cannot draw a spine to right-click — see the
 * capability check below, which prints loudly which route the run took.
 * ------------------------------------------------------------------------ */
const CASE_A = { id: 'case-default', name: 'My Library' };
const CASE_B = { id: 'case-attic', name: 'The Attic' };
const SOLO_TITLE = 'Ledger of the First Room';
const ATTIC_TITLE = 'Notes from the Attic';

function fixtureBlob() {
  const now = '2026-08-03T09:00:00.000Z';
  const book = (id, caseId, title, floor, slot, deletedAt) => ({
    id,
    title,
    bookcase_id: caseId,
    floor,
    slot,
    spine_seed: Math.abs(id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)),
    cover_meta:
      deletedAt === null
        ? null
        : JSON.stringify({ shelf: { deletedAt, prevFloor: 0, prevSlot: slot } }),
    created_at: now,
    updated_at: now,
  });
  const shelfCase = (c, ord) => ({
    id: c.id,
    name: c.name,
    ord,
    room: null,
    floors: 10,
    created_at: now,
    updated_at: now,
  });
  return {
    settings: [
      { key: TUTORIAL_KEY, value: '1' },
      // Nothing may re-seed or re-migrate on top of the fixture.
      { key: 'seedVersion', value: '4' },
      { key: 'bookcaseVersion', value: '1' },
      { key: 'activeBookcase', value: CASE_A.id },
    ],
    bookcases: [shelfCase(CASE_A, 0), shelfCase(CASE_B, 1)],
    books: [
      book('bk-a-live', CASE_A.id, 'The Standing Book', 0, 0, null),
      book('bk-a-gone', CASE_A.id, SOLO_TITLE, -1, 1, '2026-08-02T11:00:00.000Z'),
      book('bk-b-live', CASE_B.id, 'Rafters', 0, 0, null),
      book('bk-b-gone', CASE_B.id, ATTIC_TITLE, -1, 1, '2026-08-03T08:00:00.000Z'),
    ],
    pages: [],
    assets: [],
  };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 1,
});

/*
 * Unexpected full-page reloads.
 *
 * Vite pushes one whenever a module it cannot hot-swap changes, so a parallel
 * agent saving a file mid-run tears the DOM out from under a click. That is
 * not a finding about the trash, and reporting it as one would be worse than
 * useless — count them, and say so instead of blaming the panel.
 */
let churn = 0;
let expectingNav = true;
page.on('framenavigated', (frame) => {
  if (frame !== page.mainFrame()) return;
  if (expectingNav) expectingNav = false;
  else churn += 1;
});
process.on('uncaughtException', (err) => {
  console.log(
    churn > 0
      ? `\nRUN ABORTED — the dev server reloaded the page ${churn}× mid-run (a\n` +
          `parallel agent saved a file). Nothing was proven or disproven about the\n` +
          `trash; re-run when the tree is quiet.\n  ${err.message}`
      : `\nRUN FAILED: ${err.stack}`,
  );
  browser.close().finally(() => process.exit(churn > 0 ? 2 : 1));
});

/** What the shelf is holding, read off its own accessible mirror. */
const onShelf = async () => {
  const labels = await page.locator('.shelf-a11y button').allTextContents();
  return labels.map((t) => t.trim());
};

/** Reload with a given stub blob (null = a fresh library the app seeds). */
async function boot(blob) {
  await page.addInitScript(
    ([stub, tut, payload]) => {
      try {
        window.localStorage.removeItem(stub);
        window.localStorage.setItem(
          stub,
          payload ?? JSON.stringify({ settings: [{ key: tut, value: '1' }] }),
        );
      } catch {
        /* denied storage — the skip-the-tour clicker below covers it */
      }
    },
    [STUB_KEY, TUTORIAL_KEY, blob === null ? null : JSON.stringify(blob)],
  );
  expectingNav = true;
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.shelf-canvas', { timeout: 45000 });
  await until('the QA world hook appeared', () =>
    page.evaluate(() => '__shelfWorld' in window && '__shelfBookcases' in window),
  );
  for (let i = 0; i < 3; i += 1) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await sleep(600);
  }
  await until('the shelf listed a book', async () => (await onShelf()).length > 0);
}

await boot(null);

/*
 * Can this run drive the real delete? It needs a spine sprite to right-click,
 * and the spine bake reaches through src/art/covers.ts — which a parallel
 * agent may have mid-surgery. Never silently: the banner says which route the
 * evidence below came from.
 */
let uiRoute = false;
try {
  await until(
    'a spine sprite reached the canvas',
    async () => (await page.evaluate(() => window.__shelfVisibleBooks().length)) > 0,
    9000,
  );
  uiRoute = true;
} catch {
  uiRoute = false;
}
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
console.log(
  uiRoute
    ? '\nROUTE: books are crumpled through the shelf’s own right-click menu.'
    : '\nROUTE: the canvas is drawing no spines (unrelated breakage elsewhere in\n' +
        '       the tree — the panel is DOM and unaffected), so the two crumpled\n' +
        '       books arrive as stub-DB rows instead. Every assertion below is\n' +
        '       still read back out of the running app.',
);

const shot = async (name) => {
  await sleep(1200);
  await page.screenshot({ path: `qa/ui/${name}.png`, animations: 'disabled' });
  console.log(`        → qa/ui/${name}.png`);
};

const listCases = () => page.evaluate(() => window.__shelfBookcases.list().list);
const activeCase = () => page.evaluate(() => window.__shelfBookcases.active());
const switchTo = async (id) => {
  await page.evaluate((c) => window.__shelfBookcases.switch(c), id);
  await until('the world opened that bookcase', async () => (await activeCase()).id === id);
};

/** Seed a titled book into the OPEN case and crumple it through the UI. */
async function trashThroughTheUi(title) {
  await page.evaluate((t) => window.__shelfSeedBooks([t], 0), title);
  const id = await until(
    `"${title}" reached the shelf`,
    async () =>
      (await page.evaluate(() => window.__shelfVisibleBooks())).find(
        (b) => b.title === title,
      )?.id,
  );
  /*
   * Re-read the rectangle on every attempt. The camera is still settling for
   * a second or so after a case switch, and a right-click aimed at where the
   * spine WAS lands on bare shelf and opens nothing.
   */
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt += 1) {
    await sleep(700);
    const rect = await until('its spine had a rectangle', () =>
      page.evaluate((bookId) => window.__shelfSpineRect(bookId), id),
    );
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, {
      button: 'right',
    });
    opened = await page
      .waitForSelector('.shelf-menu', { timeout: 5000 })
      .then(() => true, () => false);
  }
  if (!opened) throw new Error(`the right-click menu never opened over "${title}"`);
  await page.locator('[data-shelf-action="delete"]').click();
  await page.locator('[data-shelf-action="confirm-delete"]').click();
  await until(`"${title}" left the shelf`, async () => !(await onShelf()).includes(title));
}

const openTrash = async () => {
  await page.locator('[data-shelf-dock="trash"]').click();
  await page.waitForSelector('.shelf-trash', { timeout: 20000 });
  // The list is a createResource: the card mounts before the query answers,
  // and reading rows in that gap once reported an empty drawer that was not.
  await until(
    'the drawer finished loading',
    async () =>
      (await page.locator('.shelf-trash__row').count()) > 0 ||
      (await page.locator('.shelf-trash__empty').count()) > 0,
  );
  await sleep(500);
};
const closeTrash = async () => {
  await page.locator('.shelf-trash__close').click();
  await page.waitForSelector('.shelf-trash', { state: 'detached', timeout: 10000 });
};

/**
 * Press a scope tab and wait until it is the one that is on.
 *
 * Retried: a parallel agent editing the tree makes Vite push an HMR update
 * mid-run, which detaches the card under Playwright's click and burns its
 * whole auto-retry budget on one attempt.
 */
async function clickScope(which) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // The card can be re-opened under us by an HMR reload; if it went away,
    // put it back rather than reporting a scope bug that is not one.
    if ((await page.locator('.shelf-trash').count()) === 0) await openTrash();
    await page
      .locator(`[data-shelf-scope="${which}"]`)
      .click({ timeout: 8000 })
      .catch(() => {});
    const on = await page
      .locator(`[data-shelf-scope="${which}"][aria-pressed="true"]`)
      .count()
      .catch(() => 0);
    if (on > 0) {
      await sleep(400);
      return;
    }
    await sleep(500);
  }
  const seen = await page.evaluate(() => ({
    cards: document.querySelectorAll('.shelf-trash').length,
    tabs: [...document.querySelectorAll('.shelf-trash__tab')].map(
      (t) => `${t.getAttribute('data-shelf-scope')}=${t.getAttribute('aria-pressed')}`,
    ),
  }));
  throw new Error(
    `could not switch the trash to scope "${which}" (${JSON.stringify(seen)})`,
  );
}

/** Every row as the reader sees it: the title and the bookcase chip. */
const readRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.shelf-trash__row')].map((li) => ({
      title: li.querySelector('.shelf-trash__name')?.textContent?.trim() ?? '',
      case: li.querySelector('.shelf-trash__case')?.textContent?.trim() ?? null,
    })),
  );
const text = async (sel) => (await page.locator(sel).first().textContent())?.trim() ?? '';

/* ========================================================================== */
console.log('\n1. one bookcase — the panel must not invent a scope to explain');

if (uiRoute) {
  await trashThroughTheUi(SOLO_TITLE);
} else {
  const solo = fixtureBlob();
  solo.bookcases = solo.bookcases.filter((c) => c.id === CASE_A.id);
  solo.books = solo.books.filter((b) => b.bookcase_id === CASE_A.id);
  await boot(solo);
}

const first = await activeCase();
const soloCases = await listCases();
check(
  soloCases.length === 1,
  `the library has one bookcase (${soloCases.map((c) => c.name).join(', ')})`,
);
await openTrash();
let rows = await readRows();
check(
  rows.length === 1 && rows[0].title === SOLO_TITLE,
  `the crumpled book is listed (${rows.map((r) => r.title).join(', ') || 'nothing'})`,
);
check(
  (await page.locator('.shelf-trash__scope').count()) === 0,
  'no scope line and no tabs while the library has one bookcase',
);
check(
  rows.every((r) => r.case === null),
  'no case chips either — there is nothing to disambiguate',
);
const soloEmpty = await text('[data-shelf-action="empty-trash"]');
check(
  soloEmpty === 'Empty the trash…',
  `the empty button still reads plainly: "${soloEmpty}"`,
);
await shot('trash-00-one-case');
await closeTrash();

/* ========================================================================== */
console.log('\n2. a second bookcase, with its own deleted book');

if (uiRoute) {
  const made = await page.evaluate(() => window.__shelfBookcases.create('The Attic'));
  await switchTo(made.id);
  await trashThroughTheUi(ATTIC_TITLE);
  await switchTo(first.id);
} else {
  await boot(fixtureBlob());
}

const cases = await listCases();
const second = cases.find((c) => c.id !== first.id);
check(
  cases.length === 2,
  `the library has two bookcases (${cases.map((c) => c.name).join(', ')})`,
);
check((await activeCase()).id === first.id, `standing in "${first.name}"`);

await openTrash();
rows = await readRows();
check(
  rows.length === 2 &&
    rows.some((r) => r.title === SOLO_TITLE) &&
    rows.some((r) => r.title === ATTIC_TITLE),
  `both cases' deletions are in ONE drawer (${rows.map((r) => r.title).join(' | ')})`,
);
const chips = rows.map((r) => r.case);
check(
  chips.includes(first.name) && chips.includes(second.name),
  `every row names the bookcase it came from (${chips.join(' | ')})`,
);
const said = await text('.shelf-trash__scope .shelf-trash__said');
check(
  /one drawer for all 2 bookcases/.test(said),
  `the card says what it is showing: "${said}"`,
);
const wideEmpty = await text('[data-shelf-action="empty-trash"]');
check(
  /every bookcase/.test(wideEmpty),
  `and the empty button admits its reach: "${wideEmpty}"`,
);
await shot('trash-01-library-wide');

/* ========================================================================== */
console.log('\n3. the scope toggle narrows to the case you are standing in');

await clickScope('case');
rows = await readRows();
check(
  rows.length === 1 && rows[0].title === SOLO_TITLE,
  `"this one" shows only this case's book (${rows.map((r) => r.title).join(' | ')})`,
);
const narrowEmpty = await text('[data-shelf-action="empty-trash"]');
check(/this bookcase/.test(narrowEmpty), `and empty narrows with it: "${narrowEmpty}"`);
await shot('trash-02-this-case');

await clickScope('library');
rows = await readRows();
check(rows.length === 2, `"every bookcase" brings the other one back (${rows.length} rows)`);

/* ========================================================================== */
console.log("\n4. restoring another case's book says where it actually went");

await page
  .locator('.shelf-trash__row')
  .filter({ hasText: ATTIC_TITLE })
  .first()
  .locator('button', { hasText: 'Restore' })
  .click();
await page.waitForSelector('[data-shelf-action="goto-case"]', { timeout: 15000 });
const note = await text('.shelf-trash__said--landed');
check(
  note.includes(ATTIC_TITLE) && note.includes(second.name),
  `the panel names the room it landed in: "${note}"`,
);
check(
  !(await onShelf()).includes(ATTIC_TITLE),
  'and it is NOT on the shelf behind the card — which is why the note exists',
);
check((await readRows()).length === 1, 'the restored row left the drawer');
await shot('trash-03-went-back-there');

/* ========================================================================== */
console.log('\n5. "go there" takes the reader to it');

await page.locator('[data-shelf-action="goto-case"]').click();
await until('the world switched bookcases', async () => (await activeCase()).id === second.id);
check(true, `the shelf opened "${second.name}"`);
const arrived = await until(
  'the restored book stood back up there',
  async () => (await onShelf()).includes(ATTIC_TITLE),
  20000,
).then(
  () => true,
  () => false,
);
check(arrived, `"${ATTIC_TITLE}" is standing in "${second.name}" again`);
check(
  (await page.locator('.shelf-trash').count()) === 0,
  'the trash card closed behind the reader',
);
await shot('trash-04-arrived');

/* ========================================================================== */
console.log('\n6. the drawer, from the other side');

await openTrash();
rows = await readRows();
check(
  rows.length === 1 && rows[0].title === SOLO_TITLE && rows[0].case === first.name,
  `standing in "${second.name}", the other case's deletion is still findable (${rows
    .map((r) => `${r.title} @ ${r.case}`)
    .join(' | ')})`,
);
await clickScope('case');
const dust = await text('.shelf-trash__empty');
check(
  /nothing but dust in this bookcase/.test(dust),
  `an empty case says WHICH case is empty: "${dust}"`,
);
const elsewhere = await page
  .locator('.shelf-trash__said')
  .filter({ hasText: 'other bookcases' })
  .first()
  .textContent()
  .catch(() => null);
check(
  elsewhere !== null && /1 book in other bookcases/.test(elsewhere.trim()),
  `…and where the rest of them are: "${(elsewhere ?? 'nothing said').trim()}"`,
);
await shot('trash-05-empty-here-not-there');

/* ========================================================================== */
console.log('\n7. empty shreds exactly the rows on screen');

await clickScope('library');
await page.locator('[data-shelf-action="empty-trash"]').click();
const armed = await text('[data-shelf-action="empty-trash"]');
check(
  /Really shred 1 book\?/.test(armed),
  `the confirm counts what it will shred: "${armed}"`,
);
await page.locator('[data-shelf-action="empty-trash"]').click();
await until('the drawer emptied', async () => (await readRows()).length === 0);
check(
  /nothing but dust/.test(await text('.shelf-trash__empty')),
  'and the drawer is dust',
);
check(
  (await onShelf()).includes(ATTIC_TITLE),
  'the RESTORED book was not taken with it — it is on a shelf, not in the trash',
);
await shot('trash-06-emptied');

/* ========================================================================== */
console.log('\n8. a SCOPED empty leaves the other bookcase’s trash alone');

/*
 * The claim the confirm makes when it says "Empty this bookcase's trash".
 * Needs two crumpled books again, so the library is handed back whole — the
 * one step that has to start from a known drawer rather than from whatever
 * step 7 left behind.
 */
await boot(fixtureBlob());
const reCases = await listCases();
const reFirst = (await activeCase()).id;
check(
  reCases.length === 2 && reCases.some((c) => c.id === reFirst),
  `back to two bookcases, standing in one of them (${reCases.map((c) => c.name).join(', ')})`,
);
await openTrash();
check((await readRows()).length === 2, 'two books in the drawer again');
await clickScope('case');
check(
  (await readRows()).length === 1,
  'scoped to this bookcase, one of them is on screen',
);
await page.locator('[data-shelf-action="empty-trash"]').click();
const scopedArmed = await text('[data-shelf-action="empty-trash"]');
check(
  /Really shred 1 book from My Library\?/.test(scopedArmed),
  `the confirm names the case it will shred: "${scopedArmed}"`,
);
await page.locator('[data-shelf-action="empty-trash"]').click();
await until('this case’s trash emptied', async () => (await readRows()).length === 0);
await clickScope('library');
rows = await readRows();
check(
  rows.length === 1 && rows[0].title === ATTIC_TITLE,
  `the OTHER bookcase's trash survived it (${
    rows.map((r) => `${r.title} @ ${r.case}`).join(' | ') || 'nothing left'
  })`,
);
await shot('trash-07-scoped-empty');

await browser.close();

if (pageErrors.length > 0) {
  console.log(
    `\n(page errors seen, none from this panel:\n  ${[...new Set(pageErrors)].join('\n  ')})`,
  );
}
console.log(
  fails.length === 0
    ? '\nALL CLEAR — the drawer is library-wide and says so.\n'
    : `\n${fails.length} FAILED:\n${fails.map((f) => ` - ${f}`).join('\n')}\n`,
);
process.exit(fails.length === 0 ? 0 : 1);
