/**
 * qa/tmp/_refute-tour-arrow.mjs — REFUTATION probe for claim 1b.
 *
 * The claim: "The arrow that would have been scrawled across the sheet stands
 * down: engine.crossesPanelLane, with 2px of tolerance so the commonest arrow
 * of all (card beside the sheet, pointing at it) is not deleted by an exact
 * comparison." Its stated proof is scripts/probe-tour-card.mjs, which never
 * once reads `arrow` out of getState() — so the behavioural half is untested.
 *
 * Everything here is read off the APPLIED state: `window.__nbTutorial
 * .getState().arrow` is `arrow().stroke !== ''`, the same memo the <Show>
 * renders from, and the DOM count of `.nbt-arrow` is the paint itself.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const OUT = 'qa/tmp/refute-arrow';
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: VP });
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
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const state = () => page.evaluate(() => globalThis.__nbTutorial.getState());
const domArrows = () =>
  page.evaluate(() => document.querySelectorAll('.nbt-arrow').length);
const sheetBox = () =>
  page.evaluate(() => {
    const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, label: el.getAttribute('aria-label') };
  });
const jump = async (id) => {
  const idx = await page.evaluate((s) => globalThis.__nbTutorial.getState().stepIds.indexOf(s), id);
  if (idx < 0) throw new Error(`no step '${id}'`);
  await page.evaluate((i) => globalThis.__nbTutorial.jumpTo(i), idx);
  await page.waitForTimeout(420);
};

/* --- the same geometry the overlay uses, so I can say what the arrow WOULD
       have been without the guard ------------------------------------------ */
const rectCenter = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const edgePointToward = (rect, toward) => {
  const c = rectCenter(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const sx = dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
};
const ends = (st) => {
  const from = edgePointToward(st.card, rectCenter(st.anchor));
  const to = edgePointToward(st.anchor, rectCenter(st.card));
  return { from, to, dist: Math.hypot(to.x - from.x, to.y - from.y) };
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
  throw new Error('no books after seeding');
}
await page.waitForTimeout(700);
{
  let pulled = false;
  for (let attempt = 0; attempt < 4 && !pulled; attempt += 1) {
    const spine = await page.evaluate(() => {
      const book = globalThis.__shelfVisibleBooks()[0];
      return book === undefined ? null : globalThis.__shelfSpineRect(book.id);
    });
    if (spine === null) throw new Error('no book on the plank');
    const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
    await page.mouse.click(canvas.x + spine.x + spine.width / 2, canvas.y + spine.y + spine.height / 2);
    pulled =
      (await poll(
        () => document.querySelector('[data-testid="pulled-book"][role="button"]') !== null,
        null,
        6000,
      )) !== null;
  }
  if (!pulled) throw new Error('the book never came out');
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

/* === A. the rail-button step: the arrow must stand down when the sheet lands = */
console.log('\nA. customize-open — anchor is a RAIL BUTTON, the sheet lands over the run');
await jump('customize-open');
await page.evaluate(() => globalThis.__nbTutorial.hold());
await page.waitForTimeout(300);
{
  const before = await state();
  const e0 = ends(before);
  check('nothing open: lane is zero', before.lane === 0, `lane ${before.lane}`);
  check(
    'and with nothing open the tour DOES draw its arrow',
    before.arrow === true && (await domArrows()) === 2,
    `arrow ${before.arrow}, ${await domArrows()} paths, run ${Math.round(e0.dist)}px`,
  );
  await page.screenshot({ path: `${OUT}/a1-arrow-before-sheet.png` });

  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') !== null);
  await page.waitForTimeout(1100);
  await page.evaluate(() => globalThis.__nbTutorial.hold());

  const st = await state();
  const sheet = await sheetBox();
  const e1 = ends(st);
  check('the sheet is open', sheet !== null, sheet?.label ?? 'nothing');
  check('the anchor is still the rail button, INSIDE the lane', st.anchor.x + st.anchor.width < st.lane - 2,
    `anchor ${Math.round(st.anchor.x)}..${Math.round(st.anchor.x + st.anchor.width)} vs lane ${st.lane}`);
  check('the card has stepped out of the lane', st.card.x > st.lane, `card.x ${Math.round(st.card.x)}`);
  check(
    'without the guard this run WOULD have been drawn (long enough, and across the sheet)',
    e1.dist >= 46 && e1.to.x < st.lane - 2 && e1.from.x >= st.lane - 2,
    `run ${Math.round(e1.dist)}px, ${Math.round(e1.from.x)} → ${Math.round(e1.to.x)}, lane ${st.lane}`,
  );
  check('APPLIED: the tour draws no arrow', st.arrow === false, `arrow ${st.arrow}`);
  check('APPLIED: and no .nbt-arrow path is in the DOM', (await domArrows()) === 0, `${await domArrows()} paths`);
  await page.screenshot({ path: `${OUT}/a2-no-arrow-over-sheet.png` });
}

/* === B. the sheet-anchored step: is the "commonest arrow" actually kept? ==== */
console.log('\nB. ai-script — the anchor IS the sheet; the claim says this arrow survives');
await jump('ai-script');
await page.waitForTimeout(300);
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await poll(
    () => document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null,
  );
  await page.waitForTimeout(1100);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const st = await state();
  const sheet = await sheetBox();
  const e = ends(st);
  console.log(
    `     lane ${st.lane}; sheet ${Math.round(sheet.x)}..${Math.round(sheet.x + sheet.width)}; ` +
      `anchor ${Math.round(st.anchor.x)}..${Math.round(st.anchor.x + st.anchor.width)}; ` +
      `card.x ${Math.round(st.card.x)}; run ${Math.round(e.dist)}px; ` +
      `ends ${Math.round(e.from.x)} → ${Math.round(e.to.x)}`,
  );
  check(
    'the far end of this arrow is NOT within the 2px the tolerance covers',
    !(e.to.x < st.lane && e.to.x >= st.lane - 2),
    `to.x ${e.to.x.toFixed(2)}, lane ${st.lane}`,
  );
  check(
    'crossesPanelLane is FALSE here either way (so the tolerance is not what saves it)',
    !(e.to.x < st.lane - 2) === !(e.to.x < st.lane),
    `to.x ${e.to.x.toFixed(2)} vs lane ${st.lane} and ${st.lane - 2}`,
  );
  console.log(
    `     APPLIED arrow: ${st.arrow} (${await domArrows()} paths) — ` +
      `run ${Math.round(e.dist)}px against the 46px floor`,
  );
  await page.screenshot({ path: `${OUT}/b1-inout.png` });
}

/* === C. the shelf rail, the widest lane there is ========================== */
console.log('\nC. shelf-studio — the sheet hinged on the window edge');
{
  await page.locator('.nb-back-button').click();
  if ((await poll(() => document.querySelector('.shelf-dock') !== null, null, 30000)) === null) {
    throw new Error('never got back to the shelf');
  }
  await page.waitForTimeout(900);
  await page.evaluate(() => globalThis.__nbTutorial.start());
  await page.waitForTimeout(350);
  await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
  await page.waitForTimeout(350);
  await jump('shelf-studio');
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await page.waitForTimeout(300);
  const before = await state();
  console.log(`     before: lane ${before.lane}, arrow ${before.arrow}`);
  await page.locator('.shelf-dock__btn[data-shelf-dock="studio"]').click();
  await poll(() => document.querySelector('.nb-rail-panel.is-shelf[aria-hidden="false"]') !== null);
  await page.waitForTimeout(1200);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const st = await state();
  const sheet = await sheetBox();
  const e = st.anchor === null ? null : ends(st);
  console.log(
    `     after: lane ${st.lane}; sheet ${Math.round(sheet.x)}..${Math.round(sheet.x + sheet.width)}; ` +
      `anchor ${st.anchor === null ? 'none' : `${Math.round(st.anchor.x)}..${Math.round(st.anchor.x + st.anchor.width)}`}; ` +
      `card.x ${Math.round(st.card.x)}; arrow ${st.arrow}` +
      (e === null ? '' : `; run ${Math.round(e.dist)}px, ends ${Math.round(e.from.x)} → ${Math.round(e.to.x)}`),
  );
  const crosses =
    st.lane > 0 && e !== null && (e.from.x < st.lane - 2) !== (e.to.x < st.lane - 2);
  check(
    'a run that crosses the studio lane is not painted',
    !crosses || st.arrow === false,
    `crosses ${crosses}, arrow ${st.arrow}`,
  );
  await page.screenshot({ path: `${OUT}/c1-studio.png` });
}

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [m, n] of errors) console.log(`  ${n}x ${m}`);
}
console.log(`\n${fails.length === 0 ? 'ALL GOOD' : `${fails.length} FAILED`}`);
for (const f of fails) console.log(`  - ${f}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
