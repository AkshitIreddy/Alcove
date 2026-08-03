/**
 * scripts/probe-movebook.mjs — "Move to another case…" driven the way a reader
 * drives it, in two rooms that could not look less alike.
 *
 * A seam probe, not a specimen board. `moveBookToBookcase` has unit coverage
 * (tests/bookcases.test.ts) and that coverage says nothing about whether the
 * verb can be REACHED, so every step here is a real pointer event on the real
 * canvas: right-click the spine, open the case list, click the other case's
 * row. Nothing is asserted about what was saved — only about what the running
 * world is holding afterwards.
 *
 * The claim the whole thing exists for is the second one:
 *
 *  1. the book leaves the case it was standing in and stands in the other one;
 *  2. **it still looks like itself.** The fixture puts an UNDRESSED book (no
 *     `cover_meta.style` at all) in an ebonised room, so its pigment is coming
 *     straight from that room's ramp — and ships a TWIN in the marigold room
 *     with the identical spine seed and no style either. The twin is the
 *     control: it shows what the mover would have turned into if the move had
 *     let the new room repaint it. Same seed, two rooms, and after the move the
 *     traveller must still match what it was, not what its twin is.
 *
 * Usage: node scripts/probe-movebook.mjs [--url=http://localhost:1420]
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

async function until(label, fn, timeout = 30000) {
  const stop = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > stop) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

/* -------------------------------- fixture --------------------------------- */
/*
 * Two rooms chosen to be as far apart as the palette goes: 'ebonised' (near
 * black timber, dark cloths) and 'marigold' (a bright). A guard that only ever
 * moved a book between two brown rooms could pass while doing nothing.
 */
const CASE_A = { id: 'case-default', name: 'Study', theme: 'ebonised' };
const CASE_B = { id: 'case-marigold', name: 'Sun Room', theme: 'marigold' };
const TRAVELLER = { id: 'bk-traveller', title: 'The Traveller', seed: 918273 };
/** Same seed, no style, native to the OTHER room — the control. */
const TWIN = { id: 'bk-twin', title: 'The Twin', seed: TRAVELLER.seed };

function fixtureBlob() {
  const now = '2026-08-03T09:00:00.000Z';
  const book = (id, caseId, title, floor, slot, seed) => ({
    id,
    title,
    bookcase_id: caseId,
    floor,
    slot,
    spine_seed: seed,
    // Undressed on purpose: nothing pinned, so the ROOM is choosing the colour.
    cover_meta: null,
    created_at: now,
    updated_at: now,
  });
  const shelfCase = (c, ord) => ({
    id: c.id,
    name: c.name,
    ord,
    room: JSON.stringify({ theme: c.theme, shelf: null, wall: null }),
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
      book(TRAVELLER.id, CASE_A.id, TRAVELLER.title, 0, 1, TRAVELLER.seed),
      book('bk-a-1', CASE_A.id, 'Ledger of Small Repairs', 0, 0, 4411),
      book('bk-a-2', CASE_A.id, 'Winter Almanac', 0, 2, 7752),
      book('bk-a-3', CASE_A.id, 'Field Notes', 0, 3, 31007),
      book(TWIN.id, CASE_B.id, TWIN.title, 0, 0, TWIN.seed),
      book('bk-b-1', CASE_B.id, 'Orchard Diary', 0, 1, 5150),
      book('bk-b-2', CASE_B.id, 'Letters Home', 0, 2, 26414),
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

let churn = 0;
let expectingNav = true;
page.on('framenavigated', (frame) => {
  if (frame !== page.mainFrame()) return;
  if (expectingNav) expectingNav = false;
  else churn += 1;
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
process.on('uncaughtException', (err) => {
  console.log(
    churn > 0
      ? `\nRUN ABORTED — the dev server reloaded the page ${churn}× mid-run.\n  ${err.message}`
      : `\nRUN FAILED: ${err.stack}`,
  );
  browser.close().finally(() => process.exit(churn > 0 ? 2 : 1));
});

const shot = async (name) => {
  await sleep(1000);
  await page.screenshot({ path: `qa/ui/${name}.png`, animations: 'disabled' });
  console.log(`        → qa/ui/${name}.png`);
};

/** The zoom pill's own reading, as a number ("140%" → 140). */
const zoomPct = async () => {
  const text = await page.locator('.shelf-zoom-pill__pct').first().textContent();
  return Number((text ?? '').replace(/[^\d]/g, '')) || 0;
};

/**
 * Zoom in ON A SPINE until the pill SAYS the target.
 *
 * Two things it does that clicking the pill's + does not. It reads the pill
 * instead of counting clicks, because the crops have to be taken at the same
 * magnification or the comparison they exist for is not one. And it zooms with
 * the WHEEL over the spine itself: the pill magnifies about the middle of the
 * window, which walks the book off the edge by 200% and leaves a crop of the
 * plank underneath it. Wheel zoom is anchored at the cursor (input.ts), so the
 * spine stays where it is however far in this goes.
 */
const zoomToSpine = async (bookId, target) => {
  for (let i = 0; i < 60 && (await zoomPct()) < target; i += 1) {
    const rect = await page.evaluate((id) => window.__shelfSpineRect(id), bookId);
    if (rect === null) break;
    const cx = Math.min(1380, Math.max(20, rect.x + rect.width / 2));
    const top = Math.max(0, rect.y);
    const bottom = Math.min(900, rect.y + rect.height);
    const cy = Math.min(880, Math.max(20, (top + bottom) / 2));
    await page.mouse.move(cx, cy);
    // Small notches: the crops are only comparable if both land on the same
    // reading, and a coarse step overshoots one room by 40 points.
    await page.mouse.wheel(0, -60);
    await sleep(200);
  }
  await sleep(900);
  return zoomPct();
};
const zoomFit = async () => {
  await page.locator('.shelf-zoom-pill__fit').click();
  await sleep(1100);
};

/**
 * Wait until the camera is actually taking input.
 *
 * The shelf flies in when a room opens, and a zoom asked for while that tween
 * is still running is simply retargeted away — the first attempt at this took
 * its "before" crop at 80% and its "after" crop at 187% and offered the pair as
 * a comparison. So: nudge, watch the pill, and only start once the nudge stuck.
 */
const cameraAwake = async () => {
  for (let i = 0; i < 12; i += 1) {
    const was = await zoomPct();
    await page.locator('[aria-label="Zoom in"]').click();
    await sleep(800);
    if ((await zoomPct()) !== was) {
      await zoomFit();
      return true;
    }
  }
  return false;
};

/**
 * A tight crop of one spine, taken CLOSE UP, so the two rooms can be compared
 * as pigment rather than as two 35px slivers. At shelf zoom the whole question
 * ("is this still the same book?") is decided by about a dozen pixels.
 */
const SPINE_ZOOM = 180;
const shotSpine = async (bookId, name) => {
  await cameraAwake();
  const pct = await zoomToSpine(bookId, SPINE_ZOOM);
  check(
    pct >= SPINE_ZOOM,
    `${name} was taken close up (${pct}%, wanted ${SPINE_ZOOM}%+)`,
  );
  const rect = await page.evaluate((id) => window.__shelfSpineRect(id), bookId);
  if (rect === null) {
    await zoomFit();
    return false;
  }
  /*
   * The INTERSECTION of the padded spine with the window, not the padded spine
   * clamped to it. Close up a spine is taller than the viewport, so its rect
   * starts above zero — offsetting the origin without shrinking the box walked
   * the crop off the bottom of the book and photographed the shelf below it.
   */
  /*
   * Park the pointer off the case first. Zooming leaves it sitting on the
   * spine, and a HOVERED spine is lifted and outlined — photograph one room
   * hovered and the other not and the pair differs for a reason that has
   * nothing to do with the move.
   */
  await page.mouse.move(6, 6);
  await sleep(800);
  const pad = 34;
  const left = Math.max(0, rect.x - pad);
  const top = Math.max(0, rect.y - pad);
  const right = Math.min(1400, rect.x + rect.width + pad);
  const bottom = Math.min(900, rect.y + rect.height + pad);
  const clip = {
    x: left,
    y: top,
    width: Math.max(24, right - left),
    height: Math.max(24, bottom - top),
  };
  await page.screenshot({ path: `qa/ui/${name}.png`, clip, animations: 'disabled' });
  console.log(`        → qa/ui/${name}.png (at ${pct}%)`);
  await zoomFit();
  return true;
};

const onShelf = async () =>
  (await page.locator('.shelf-a11y button').allTextContents()).map((t) => t.trim());
const visible = () => page.evaluate(() => window.__shelfVisibleBooks());
const styleOf = (id) => page.evaluate((b) => window.__shelfBookStyle(b), id);
const activeCase = () => page.evaluate(() => window.__shelfBookcases.active());

/* --------------------------------- boot ---------------------------------- */

/*
 * ONCE, not on every navigation. An init script runs again on reload, and a
 * fixture that re-writes itself there would quietly restore the library the
 * move had just changed — the run would then "prove" the move did not persist
 * when what actually happened is that the probe undid it.
 */
await page.addInitScript(
  ([stub, payload, marker]) => {
    try {
      if (window.localStorage.getItem(marker) === null) {
        window.localStorage.setItem(stub, payload);
        window.localStorage.setItem(marker, '1');
      }
    } catch {
      /* denied storage — the skip-the-tour clicker below covers it */
    }
  },
  [STUB_KEY, JSON.stringify(fixtureBlob()), 'probe.movebook.seeded'],
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
await until('the shelf listed its books', async () => (await onShelf()).length > 0);
await until(
  'a spine sprite reached the canvas',
  async () => (await visible()).length > 0,
  20000,
);
await sleep(1500);

console.log('\n1 — the dark room, with the traveller standing in it');
const home = await activeCase();
check(home.id === CASE_A.id, `standing in "${CASE_A.name}" (${home.name})`);
// Polled, not read once: the shelf's mirror fills in as floors mount, and
// asking a beat too early once reported a book missing that was on its way.
const listedAtHome = await until(
  'the traveller appeared in the shelf’s own list',
  async () => (await onShelf()).includes(TRAVELLER.title) || null,
  20000,
).then(() => true, () => false);
check(listedAtHome, `"${TRAVELLER.title}" is on the ${CASE_A.name} shelf`);
await shot('movebook-01-dark-room');
await shotSpine(TRAVELLER.id, 'movebook-02-spine-before');

const before = await styleOf(TRAVELLER.id);
console.log('        style here:', JSON.stringify(before));

/* --------------------- 2. the card, and its case list --------------------- */

console.log('\n2 — right-click the spine and open the case list');
let opened = false;
for (let attempt = 0; attempt < 5 && !opened; attempt += 1) {
  await sleep(600);
  const rect = await until('its spine had a rectangle', () =>
    page.evaluate((id) => window.__shelfSpineRect(id), TRAVELLER.id),
  );
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, {
    button: 'right',
  });
  opened = await page
    .waitForSelector('.shelf-menu', { timeout: 5000 })
    .then(() => true, () => false);
}
check(opened, 'the right-click card opened over the spine');
await shot('movebook-03-card');

const moveRow = page.locator('[data-shelf-action="move-to"]');
// Waited for rather than counted on the spot: a parallel agent saving a file
// makes Vite remount the card mid-run, and "the row is not there yet" is not
// the same finding as "the menu does not offer it".
await moveRow.waitFor({ timeout: 6000 }).catch(() => {});
check((await moveRow.count()) === 1, 'the card offers “Move to another case…”');
await moveRow.click();
await page.waitForSelector('[data-shelf-case]', { timeout: 8000 });

const rows = await page.locator('[data-shelf-case]').evaluateAll((els) =>
  els.map((e) => ({
    id: e.getAttribute('data-shelf-case'),
    label: e.textContent?.trim() ?? '',
  })),
);
console.log('        rows:', JSON.stringify(rows));
check(
  rows.some((r) => r.id === CASE_B.id && r.label.includes(CASE_B.name)),
  `the list names the other case ("${CASE_B.name}")`,
);
check(
  !rows.some((r) => r.id === CASE_A.id),
  'the case the book already stands in is NOT offered',
);
check(
  rows.some((r) => r.id === 'nb:back'),
  'there is a way back to the book’s own verbs (top-left)',
);
check(
  (await page.locator('.shelf-menu__hint').first().textContent())?.includes(
    'keeps the colours',
  ) === true,
  'the card promises the book keeps its colours',
);
await shot('movebook-04-case-list');

/* ------------------------------ 3. the move ------------------------------- */

console.log('\n3 — click the other case');
await page.locator(`[data-shelf-case="${CASE_B.id}"]`).click();
await until(
  'the traveller left the dark room',
  async () => !(await onShelf()).includes(TRAVELLER.title),
);
check(true, `"${TRAVELLER.title}" is gone from ${CASE_A.name}`);
await sleep(1200);
await shot('movebook-05-dark-room-after');

/* ---------------------- 4. it arrived, and it is itself ------------------- */

console.log('\n4 — stand in the bright room');
await page.evaluate((id) => window.__shelfBookcases.switch(id), CASE_B.id);
await until('the world opened the other case', async () => (await activeCase()).id === CASE_B.id);
await until(
  'the traveller is standing in the bright room',
  async () => (await onShelf()).includes(TRAVELLER.title),
);
await until(
  'its spine reached the canvas over there',
  async () => (await visible()).some((b) => b.id === TRAVELLER.id),
  25000,
);
await sleep(2000);
await shot('movebook-06-bright-room');
await shotSpine(TRAVELLER.id, 'movebook-07-spine-after');
await shotSpine(TWIN.id, 'movebook-08-twin-native');

const after = await styleOf(TRAVELLER.id);
const twin = await styleOf(TWIN.id);
console.log('        style there:', JSON.stringify(after));
console.log('        twin (same seed, native):', JSON.stringify(twin));

const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
const drifted = keys.filter(
  (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]),
);
check(
  drifted.length === 0,
  drifted.length === 0
    ? 'every field of its resolved face survived the move'
    : `the move repainted: ${drifted.join(', ')}`,
);
/*
 * The colour of an undressed book is `pigment` — an index into the HOUSE cloth
 * list — not `clothHex`, which stays null until a reader mixes one in the
 * studio. Comparing the hex would compare null with null and pass however badly
 * the book had been repainted.
 */
check(
  before?.pigment === after?.pigment,
  `cloth stayed pigment ${before?.pigment} (now ${after?.pigment})`,
);

/*
 * The control. If the twin — same seed, same room, nothing pinned — comes out
 * the same colour as the traveller, then this room happens to paint that seed
 * the way the old one did and the run proved nothing about the guard.
 */
check(
  twin?.pigment !== after?.pigment,
  `the room really does repaint an undressed book (the twin, same seed, is pigment ${twin?.pigment})`,
);

/* --------------------------- 5. and it stays put -------------------------- */

console.log('\n5 — reload: the move is on disk, not just on screen');
expectingNav = true;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas.shelf-canvas', { timeout: 45000 });
await until('the QA world hook came back', () =>
  page.evaluate(() => '__shelfWorld' in window && '__shelfBookcases' in window),
);
await until('the reloaded shelf listed its books', async () => (await onShelf()).length > 0);
/*
 * Which case a reload OPENS is a separate persisted choice ('activeBookcase'),
 * so it is asked rather than assumed — the claim under test is where the BOOK
 * is, and it has to hold from either room.
 */
const reopened = await activeCase();
console.log(`        the app reopened in "${reopened.name}"`);
if (reopened.id !== CASE_A.id) {
  await page.evaluate((id) => window.__shelfBookcases.switch(id), CASE_A.id);
  await until('stood back in the dark room', async () => (await activeCase()).id === CASE_A.id);
}
await sleep(1200);
check(
  !(await onShelf()).includes(TRAVELLER.title),
  `after a reload "${TRAVELLER.title}" is no longer in ${CASE_A.name}`,
);
await page.evaluate((id) => window.__shelfBookcases.switch(id), CASE_B.id);
await until('stood in the bright room again', async () => (await activeCase()).id === CASE_B.id);
check(
  (await until(
    'the reloaded bright room listed its books',
    async () => (await onShelf()).length > 0 || null,
  )) && (await onShelf()).includes(TRAVELLER.title),
  `…and it is standing in ${CASE_B.name}`,
);
await until(
  'its spine came back',
  async () => (await visible()).some((b) => b.id === TRAVELLER.id),
  25000,
);
await sleep(1500);
const reloaded = await styleOf(TRAVELLER.id);
check(
  reloaded?.pigment === before?.pigment,
  `and still wearing pigment ${before?.pigment} (now ${reloaded?.pigment})`,
);
await shot('movebook-09-after-reload');

/* ---------------------- 6. a library with too many cases ------------------ */
/*
 * The house rule for a long list: show about twenty and offer the rest behind
 * one row. A reader with two dozen bookcases is rare and a card that runs off
 * the bottom of the window is not a card.
 */

console.log('\n6 — twenty-five bookcases, and the list still fits on the card');
const CAP = 20;
await page.evaluate(async (n) => {
  for (let i = 0; i < n; i += 1) await window.__shelfBookcases.create(`Case ${i + 3}`);
}, 25);
await until(
  'the collection grew',
  async () => (await page.evaluate(() => window.__shelfBookcases.list().list.length)) >= 27,
);
await sleep(1500);

const openCaseList = async () => {
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt += 1) {
    await sleep(600);
    const rect = await page.evaluate((id) => window.__shelfSpineRect(id), TRAVELLER.id);
    if (rect === null) continue;
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, {
      button: 'right',
    });
    opened = await page
      .waitForSelector('.shelf-menu', { timeout: 5000 })
      .then(() => true, () => false);
  }
  if (!opened) throw new Error('the right-click menu never opened for the cap check');
  await page.locator('[data-shelf-action="move-to"]').click();
  await page.waitForSelector('[data-shelf-case]', { timeout: 8000 });
};
await openCaseList();

const caseRows = () =>
  page.locator('[data-shelf-case]').evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute('data-shelf-case'), label: e.textContent?.trim() ?? '' })),
  );
const capped = await caseRows();
const named = capped.filter((r) => !r.id.startsWith('nb:'));
check(named.length === CAP, `only ${CAP} cases are listed at once (saw ${named.length})`);
const more = capped.find((r) => r.id === 'nb:more');
check(more !== undefined, `and the rest are behind one row (“${more?.label ?? '—'}”)`);
await shot('movebook-10-capped-list');

await page.locator('[data-shelf-case="nb:more"]').click();
await sleep(600);
const expanded = (await caseRows()).filter((r) => !r.id.startsWith('nb:'));
check(
  expanded.length === 26,
  `taking that row shows every other case (${expanded.length} of 26)`,
);
await shot('movebook-11-expanded-list');
await page.keyboard.press('Escape');

/* --------------------------------- verdict -------------------------------- */

console.log('\n--- page errors ---');
console.log(pageErrors.length === 0 ? 'none' : [...new Set(pageErrors)].join('\n'));
if (churn > 0) console.log(`(the dev server reloaded the page ${churn}× mid-run)`);
console.log(
  fails.length === 0
    ? '\nALL CLEAR — the book moved, and it moved as itself.'
    : `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}`,
);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
