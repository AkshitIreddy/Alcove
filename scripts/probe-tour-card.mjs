/**
 * scripts/probe-tour-card.mjs — the guided tour's card, driven in the app.
 *
 * Three reports, all about the card rather than about the script on it:
 *
 *  1. "Step 18 doesn't move the UI tutorial window when the user opens the In
 *     and Out window." Measured here before the fix: sheet at 68..408
 *     (`--nb-panel-edge: 408px`), card at x=134, tour layer z 400 over the
 *     rail's 300 — so the card was not hidden BY the sheet, it was lying on it,
 *     covering every row the step had just described.
 *  2. "We should let the user be able to move the step windows by clicking and
 *     dragging."
 *  3. "We should tell the user that the steps move on their own."
 *
 * Everything below is asserted on the APPLIED state — the card's own rect out
 * of `window.__nbTutorial.getState()`, which is what the overlay is actually
 * rendering, against the sheet's `getBoundingClientRect()`. Nothing is read
 * back out of a store, and every gesture is a real mouse press: the drag is
 * mouse.down / move / up on the card, not a call into a signal.
 *
 * Usage: node scripts/probe-tour-card.mjs [--url=http://localhost:1420]
 *                                         [--out=qa/ui]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = opt('out', 'qa/ui');
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

/** The reading beat a step that teaches a panel buys itself (steps.ts). */
const PANEL_DWELL_MS = 5000;
/** The hand's width every consumer of --nb-panel-edge clears it by (engine.ts). */
const LANE_GAP = 14;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: VP,
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(100);
  }
};
const shot = async (name) => {
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${OUT}/${name}.png`);
};
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const state = () => page.evaluate(() => globalThis.__nbTutorial.getState());
/** The open rail sheet's box, or null. */
const sheetBox = () =>
  page.evaluate(() => {
    const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, label: el.getAttribute('aria-label') };
  });
const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
};
const jump = async (id) => {
  const idx = await page.evaluate((s) => globalThis.__nbTutorial.getState().stepIds.indexOf(s), id);
  if (idx < 0) throw new Error(`no step '${id}' in this tour`);
  await page.evaluate((i) => globalThis.__nbTutorial.jumpTo(i), idx);
  await page.waitForTimeout(420);
};
/**
 * Back to the top of a fresh run, then straight to `id`.
 *
 * A step the reader has already satisfied stays satisfied for the whole run —
 * which is deliberate (walk back through the tour and your ticks are still
 * there) and means it never counts itself down a second time. Anything that
 * wants to watch the beat has to watch a step that has not been done yet.
 */
const restartAt = async (id) => {
  await page.evaluate(() => globalThis.__nbTutorial.start());
  await page.waitForTimeout(350);
  await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
  await page.waitForTimeout(350);
  await jump(id);
};

/* ------------------------------- arrive ---------------------------------- */
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('no QA bridges');
}
{
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
}
await page.waitForTimeout(700);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice'], 0));
if ((await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, 60000)) === null) {
  throw new Error('no books on the plank after seeding');
}
await page.waitForTimeout(700);

/* open a book the reader's way, so the rail and its sheets are real */
{
  // Pressed until it takes: the shelf is a camera over a canvas, and a click
  // that lands while it is still settling hits the plank beside the spine.
  let pulled = false;
  for (let attempt = 0; attempt < 4 && !pulled; attempt += 1) {
    const spine = await page.evaluate(() => {
      const book = globalThis.__shelfVisibleBooks()[0];
      return book === undefined ? null : globalThis.__shelfSpineRect(book.id);
    });
    if (spine === null) throw new Error('no book on the plank');
    const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
    await page.mouse.click(
      canvas.x + spine.x + spine.width / 2,
      canvas.y + spine.y + spine.height / 2,
    );
    pulled =
      (await poll(
        () => document.querySelector('[data-testid="pulled-book"][role="button"]') !== null,
        null,
        6000,
      )) !== null;
  }
  if (!pulled) throw new Error('the book never came out of the case');
}
await page.locator('[data-testid="pulled-book"][role="button"]').click();
if ((await poll(() => document.querySelector('.nb-rail') !== null, null, 60000)) === null) {
  throw new Error('the book never opened');
}
await page.waitForTimeout(1200);

await page.evaluate(() => globalThis.__nbTutorial.start());
await poll(() => globalThis.__nbTutorial?.getState().running === true);
await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
await page.waitForTimeout(400);

/* ============ 1. the card gets out of the sheet's lane ==================== */
console.log('\n1. the sheet arrives — does the card step aside?');
console.log('   (customize: the card is anchored to a RAIL BUTTON, and the sheet lands on it)');
await jump('customize-open');
await page.evaluate(() => globalThis.__nbTutorial.hold());
{
  const before = await state();
  check('with nothing open the lane is zero', before.lane === 0, `lane ${before.lane}`);

  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') !== null);
  // The sheet arrives over a tweened half-second; let it land.
  await page.waitForTimeout(900);

  const st = await state();
  const sheet = await sheetBox();
  check('the customize sheet is open', sheet !== null, sheet?.label ?? 'nothing');
  check(
    'the tour read the sheet edge panelPush publishes',
    Math.abs(st.lane - (sheet.x + sheet.width)) <= 1,
    `lane ${st.lane} vs sheet right ${Math.round(sheet.x + sheet.width)}`,
  );
  check(
    'the card is right of the sheet, by the hand the back arrow uses',
    st.card.x >= st.lane + LANE_GAP - 1,
    `card.x ${Math.round(st.card.x)} vs lane ${st.lane} + ${LANE_GAP}`,
  );
  check('nothing of the card is on the sheet', overlap(st.card, sheet) === 0, `${overlap(st.card, sheet)}px²`);
  check(
    'and the card is still fully on screen',
    st.card.x >= 0 && st.card.x + st.card.width <= VP.width + 1,
    `${Math.round(st.card.x)}..${Math.round(st.card.x + st.card.width)}`,
  );
  // Frozen before the picture is taken. A screenshot of this app costs seconds
  // on SwiftShader and the step is on a five-second clock — every assertion
  // above is read from the live state, but the PICTURE has to be of the moment
  // they were read, not of whatever the tour had moved on to by the time the
  // encoder finished.
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await shot('tour-01-card-beside-customize');
}

/* ============ 2. step 18 — In and out ==================================== */
console.log('\n2. step 18: "Have an assistant write a page"');
await jump('ai-script');
{
  const st0 = await state();
  check('this is step 18 of 21', st0.stepIndex === 17 && st0.total === 21, `${st0.stepIndex + 1} of ${st0.total}`);
  check('the customize sheet was put away on the way in', (await sheetBox()) === null);

  const t0 = Date.now();
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await poll(
    () => document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null,
  );
  await page.waitForTimeout(900);

  const st = await state();
  const sheet = await sheetBox();
  check('the "In and out" sheet is open', sheet?.label === 'In and out', sheet?.label ?? 'nothing');
  check('the step went green', st.done === true);
  check(
    'the card stands clear of the sheet',
    st.card.x >= st.lane + LANE_GAP - 1 && overlap(st.card, sheet) === 0,
    `card.x ${Math.round(st.card.x)}, lane ${st.lane}, overlap ${overlap(st.card, sheet)}px²`,
  );
  check(
    'and the spotlight is ON the sheet, not on the icon that opened it',
    st.anchor !== null && overlap(st.anchor, sheet) > sheet.width * sheet.height * 0.9,
    `${overlap(st.anchor ?? { x: 0, y: 0, width: 0, height: 0 }, sheet)}px² of ${Math.round(sheet.width * sheet.height)}`,
  );
  check(
    'and the card is counting down while all that is true',
    st.advance !== null && st.advance.remaining > 0.05,
    st.advance === null ? 'no countdown' : `${st.advance.remaining.toFixed(2)} of ${st.advance.total}ms left`,
  );
  await shot('tour-02-card-beside-inout');
  console.log(`  (${Date.now() - t0}ms from the press to the shot)`);
}

/* ============ 3. the countdown, caught mid-flight ======================== */
/*
 * Its own pass, and a CLIPPED shot. A full-window screenshot of a WebGL shelf
 * costs seconds on SwiftShader — longer than the beat it is trying to
 * photograph — so the whole-window picture above is taken first and the close-up
 * of the card gets a fresh beat to itself.
 */
console.log('\n3. the beat before it walks on');
await restartAt('ai-script');
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await page.waitForTimeout(700);
  const st = await state();
  check(
    'the card is counting down, and says so',
    st.advance !== null,
    st.advance === null ? 'no countdown' : `${st.advance.total}ms`,
  );
  check(
    "the ring runs the step's own reading beat, not a second number",
    st.advance?.total === PANEL_DWELL_MS,
    `${st.advance?.total}ms vs the dwell's ${PANEL_DWELL_MS}ms`,
  );
  check(
    'and it is mid-flight rather than full or empty',
    st.advance !== null && st.advance.remaining > 0.05 && st.advance.remaining < 0.95,
    `${st.advance?.remaining.toFixed(3)} left`,
  );
  const say = await page.evaluate(() => document.querySelector('.nbt-advance-say')?.textContent ?? '');
  check('the sentence names what is about to happen', /by itself/.test(say), say);
  const dash = await page.evaluate(() => {
    const el = document.querySelector('.nbt-advance-sweep');
    return el === null
      ? null
      : {
          array: Number(el.getAttribute('stroke-dasharray')),
          offset: Number(el.getAttribute('stroke-dashoffset')),
        };
  });
  check(
    'the drawn arc agrees with the fraction left',
    dash !== null &&
      dash.offset > 0 &&
      dash.offset < dash.array &&
      Math.abs(dash.offset / dash.array - (1 - st.advance.remaining)) < 0.08,
    dash === null
      ? 'no ring'
      : `${(dash.offset / dash.array).toFixed(2)} drawn away, ${(1 - st.advance.remaining).toFixed(2)} elapsed`,
  );
  await page.screenshot({
    path: `${OUT}/tour-03-countdown-midflight.png`,
    clip: { x: st.card.x, y: st.card.y, width: st.card.width, height: Math.min(st.card.height, 880) },
  });
  console.log(`  shot ${OUT}/tour-03-countdown-midflight.png`);
  const after = await state();
  check(
    'and the shot was taken inside the beat, not after it',
    after.advance !== null && after.stepId === 'ai-script',
    after.advance === null ? 'the beat was over' : `${after.advance.remaining.toFixed(2)} still left`,
  );
}

/* ---- the honesty test, with nothing else on the wire --------------------- */
/*
 * Timed on its own pass: a full-window screenshot of a WebGL shelf costs the
 * best part of a second on SwiftShader, and measuring the beat across one
 * measures the screenshot.
 */
console.log('\n3b. the ring is the timer, measured');
await restartAt('ai-script');
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  const armed = await poll(() => globalThis.__nbTutorial.getState().advance, null, 12000);
  const t1 = Date.now();
  check('the beat is armed', armed !== null && armed.total === PANEL_DWELL_MS, `${armed?.total}ms`);
  const gone = await poll(() => globalThis.__nbTutorial.getState().stepId !== 'ai-script', null, 15000);
  const elapsed = Date.now() - t1;
  // Against what the RING said was left when this pass started, not against the
  // whole beat — the press and the first poll cost a few hundred milliseconds,
  // and the ring had already spent them. That is the comparison that proves the
  // two are one number.
  const promised = armed.total * armed.remaining;
  check(
    'the tour walks on exactly when the ring says it will',
    gone !== null && Math.abs(elapsed - promised) < 450,
    `walked on after ${elapsed}ms, ring promised ${Math.round(promised)}ms`,
  );
  check('which is long enough to read the sheet — it was 1.5s before', elapsed > 3500, `${elapsed}ms`);
}

/* ============ 4. "stay here" stops the clock ============================= */
console.log('\n4. stopping the clock');
await restartAt('ai-script');
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  if ((await poll(() => globalThis.__nbTutorial.getState().advance !== null)) === null) {
    throw new Error('the countdown never armed');
  }
  await page.locator('.nbt-advance-hold').click();
  await page.waitForTimeout(300);
  const st = await state();
  check('the countdown is cancelled', st.advance === null);
  const say = await page.evaluate(() => document.querySelector('.nbt-advance-say')?.textContent ?? '');
  check('the row stays and says so', /staying on this one/.test(say), say);
  await page.waitForTimeout(PANEL_DWELL_MS + 1200);
  const later = await state();
  check(
    'and the tour is still on this step a beat later',
    later.stepId === 'ai-script',
    later.stepId,
  );
  check('with the sheet still open', (await sheetBox())?.label === 'In and out');
  await shot('tour-04-held');
}

/* ============ 5. picking the card up ===================================== */
console.log('\n5. dragging the card');
{
  const before = await state();
  const from = { x: before.card.x + before.card.width / 2, y: before.card.y + 62 };
  const to = { x: 980, y: 300 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(260);

  const st = await state();
  check('the tour knows the reader is placing the card now', st.moved === true);
  // Where the grab offset says it should have landed, then the same clamp the
  // overlay applies. This card is the tallest in the tour — 872px in a 900px
  // window — so the vertical clamp is doing nearly all the work, and asserting
  // the raw drop position here would be asserting that a card can leave the
  // screen.
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const want = {
    x: clamp(to.x - (from.x - before.card.x), 12, Math.max(12, VP.width - st.card.width - 12)),
    y: clamp(to.y - 62, 12, Math.max(12, VP.height - st.card.height - 12)),
  };
  check(
    'the card followed the pointer, as far as the window allows',
    Math.abs(st.card.x - want.x) < 3 && Math.abs(st.card.y - want.y) < 3,
    `at ${Math.round(st.card.x)},${Math.round(st.card.y)}, wanted ${Math.round(want.x)},${Math.round(want.y)}`,
  );
  check(
    'and it really did move',
    Math.abs(st.card.x - before.card.x) > 100,
    `${Math.round(before.card.x)} → ${Math.round(st.card.x)}`,
  );
  check(
    'the spotlight did not move with it',
    st.hole !== null && Math.abs(st.hole.x - before.hole.x) < 2,
    `${Math.round(st.hole?.x ?? -1)} vs ${Math.round(before.hole.x)}`,
  );
  await shot('tour-05-dragged');

  // ...and the placement does not fight it back. The anchor is re-resolved on
  // every frame, so a card that survives a second of that is not being placed.
  await page.waitForTimeout(1100);
  const still = await state();
  check(
    'the tour does not pull it back out from under the cursor',
    Math.abs(still.card.x - st.card.x) < 1 && Math.abs(still.card.y - st.card.y) < 1,
    `${Math.round(still.card.x)},${Math.round(still.card.y)}`,
  );

  // Thrown at the corner of the world.
  await page.mouse.move(still.card.x + still.card.width / 2, still.card.y + 62);
  await page.mouse.down();
  await page.mouse.move(VP.width + 600, VP.height + 600, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(240);
  const thrown = await state();
  check(
    'a card thrown off the screen stays on it',
    thrown.card.x + thrown.card.width <= VP.width - 11 &&
      thrown.card.y + Math.min(thrown.card.height, VP.height) <= VP.height + thrown.card.height,
    `${Math.round(thrown.card.x)},${Math.round(thrown.card.y)} of ${VP.width}x${VP.height}`,
  );
  check(
    'and every one of its controls is still reachable',
    thrown.card.x >= 0 && thrown.card.y >= 0,
    `${Math.round(thrown.card.x)},${Math.round(thrown.card.y)}`,
  );

  // The card's own undo.
  await page.locator('.nbt-restore').click();
  await page.waitForTimeout(300);
  const back = await state();
  check('"put it back" hands the placement to the tour again', back.moved === false);
  check(
    'and the tour puts it beside the sheet again',
    back.card.x >= back.lane + LANE_GAP - 1,
    `card.x ${Math.round(back.card.x)}, lane ${back.lane}`,
  );

  // A dragged card is dragged for THIS step.
  await page.mouse.move(back.card.x + back.card.width / 2, back.card.y + 62);
  await page.mouse.down();
  await page.mouse.move(900, 500, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('moved again', (await state()).moved === true);
  await page.evaluate(() => globalThis.__nbTutorial.next());
  await page.waitForTimeout(500);
  const next = await state();
  check(
    'the next step gets its placement back',
    next.moved === false && next.stepId !== 'ai-script',
    `${next.stepId}, moved ${next.moved}`,
  );
}

/* ============ 6. every step, not only 18 ================================= */
console.log('\n6. the whole tour: no card in a sheet, no card off screen');
await page.evaluate(() => globalThis.__nbTutorial.start());
await page.waitForTimeout(350);
await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
await page.waitForTimeout(350);
{
  // The taste questionnaire puts ITSELF over the tour on its own step, with its
  // own scrim: there is no card of ours to measure while it is up.
  const ids = (await state()).stepIds.filter((id) => id !== 'taste');
  const bad = [];
  for (const id of ids) {
    await jump(id);
    await page.evaluate(() => globalThis.__nbTutorial.hold());
    await page.waitForTimeout(120);
    const st = await state();
    const sheet = await sheetBox();
    const onSheet = sheet === null ? 0 : overlap(st.card, sheet);
    const off =
      st.card.x < -1 ||
      st.card.y < -1 ||
      st.card.x + st.card.width > VP.width + 1 ||
      (st.card.height <= VP.height && st.card.y + st.card.height > VP.height + 1);
    if (onSheet > 0 || off) {
      bad.push(`${st.stepId}: ${onSheet}px² on a sheet, ${off ? 'off screen' : 'on screen'}`);
    }
  }
  check(`all ${ids.length} steps place their card on screen and off the sheet`, bad.length === 0, bad.join(' · '));
}

/* ============ 7. the other rail, on the shelf ============================ */
/*
 * The studio is the one sheet hinged on the window edge (left: 0), so it is the
 * widest lane there is and the one the settings seal already steps aside for.
 * The rule is the same rule — but "the same rule" is what this repo has been
 * wrong about before, so it gets driven rather than assumed.
 */
console.log('\n7. the shelf rail: the studio sheet');
{
  await page.locator('.nb-back-button').click();
  if ((await poll(() => document.querySelector('.shelf-dock') !== null, null, 30000)) === null) {
    throw new Error('never got back to the shelf');
  }
  await page.waitForTimeout(900);
  await restartAt('shelf-studio');
  await page.locator('.shelf-dock__btn[data-shelf-dock="studio"]').click();
  await poll(() => document.querySelector('.nb-rail-panel.is-shelf[aria-hidden="false"]') !== null);
  await page.waitForTimeout(1000);
  const st = await state();
  const sheet = await sheetBox();
  check('the studio is open', sheet !== null, sheet?.label ?? 'nothing');
  check('it is hinged on the window edge', sheet.x <= 1, `left ${Math.round(sheet.x)}`);
  check(
    'the card stands clear of it',
    st.card.x >= sheet.x + sheet.width && overlap(st.card, sheet) === 0,
    `card.x ${Math.round(st.card.x)}, sheet right ${Math.round(sheet.x + sheet.width)}, overlap ${overlap(st.card, sheet)}px²`,
  );
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await shot('tour-06-card-beside-studio');
}

/* -------------------------------- verdict -------------------------------- */
if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [msg, n] of errors) console.log(`  ${n}x ${msg}`);
}
console.log(`\n${fails.length === 0 ? 'ALL GOOD' : `${fails.length} FAILED`}`);
for (const f of fails) console.log(`  - ${f}`);
await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
