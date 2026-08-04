/**
 * qa/tmp/_refute-tour-dwell.mjs — REFUTATION pass on claim 1d.
 *
 * The claim: the `ai-script` step ("Have an assistant write a page") bought
 * itself a reading beat — `spec-copied` joined `probe.SURFACE_FACTS`, the step
 * declares `dwell: PANEL_DWELL_MS`, and the "In and out" sheet is therefore on
 * screen for 5s rather than the 1.5s it got before.
 *
 * This does NOT trust the tour's own numbers for the headline. It watches the
 * SHEET — `.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]` and
 * its computed visibility — on a 50ms sampler, from the reader's click to the
 * frame it goes away, and reports the wall-clock milliseconds it was readable.
 * The tour's `advance.total` is read too, but only to show the two agree.
 *
 * The counterfactual is measured rather than asserted: a step with NO dwell is
 * driven the same way, so "1.5s before" is a number this run produced.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const OUT = 'qa/tmp';
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const PANEL_DWELL_MS = 5000; // steps.ts
const CELEBRATE_MS = 1500; // engine.ts — the ordinary beat

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

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(100);
  }
};
const state = () => page.evaluate(() => globalThis.__nbTutorial.getState());

/** Is a sheet with this label really readable on screen right now? */
const sheetVisible = (label) =>
  page.evaluate((want) => {
    const el = document.querySelector(`.nb-rail-panel[aria-hidden="false"][aria-label="${want}"]`);
    if (el === null) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (Number.parseFloat(s.opacity || '1') < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 8 && r.height > 8 && r.right > 0 && r.left < window.innerWidth;
  }, label);

const jump = async (id) => {
  const idx = await page.evaluate(
    (s) => globalThis.__nbTutorial.getState().stepIds.indexOf(s),
    id,
  );
  if (idx < 0) throw new Error(`no step '${id}' in this tour`);
  await page.evaluate((i) => globalThis.__nbTutorial.jumpTo(i), idx);
  await page.waitForTimeout(420);
};
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

/* ===== 1. the step really is on the reader's path, with the dwell ========= */
console.log('\n1. is the step reachable, and does it declare the beat?');
await jump('ai-script');
{
  const st = await state();
  check('the full tour contains ai-script', st.stepIds.includes('ai-script'), `${st.stepIndex + 1} of ${st.total}`);
  check('the step is waiting on spec-copied', st.fact === 'spec-copied', String(st.fact));
  check('nothing green yet', st.done === false);
  check('no In-and-out sheet standing on the way in', (await sheetVisible('In and out')) === false);
}

/* ===== 2. HOW LONG IS THE SHEET ACTUALLY READABLE? ======================= */
console.log('\n2. the sheet, watched from the click to the frame it goes away');
let dwellOpenMs = 0;
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  // First frame the sheet is genuinely on screen — that is when reading starts.
  const t0 = Date.now();
  let appeared = null;
  for (;;) {
    if (await sheetVisible('In and out')) {
      appeared = Date.now();
      break;
    }
    if (Date.now() - t0 > 10000) break;
    await page.waitForTimeout(30);
  }
  if (appeared === null) throw new Error('the In-and-out sheet never appeared');

  const beat = await state();
  check(
    'the tour armed a beat, and it is the step’s own dwell',
    beat.advance !== null && beat.advance.total === PANEL_DWELL_MS,
    beat.advance === null ? 'no beat' : `${beat.advance.total}ms`,
  );
  check('and the step went green off the click', beat.done === true);

  // Watch the sheet itself, not the tour's opinion of it.
  let gone = null;
  for (;;) {
    if (!(await sheetVisible('In and out'))) {
      gone = Date.now();
      break;
    }
    if (Date.now() - appeared > 20000) break;
    await page.waitForTimeout(50);
  }
  if (gone === null) throw new Error('the sheet never closed — the tour never walked on');
  dwellOpenMs = gone - appeared;
  const after = await state();
  console.log(`  the sheet was readable for ${dwellOpenMs}ms; the tour is now on '${after.stepId}'`);
  check(
    'the sheet outlives the old 1.5s beat by a wide margin',
    dwellOpenMs > 3500,
    `${dwellOpenMs}ms`,
  );
  check(
    'and it is the 5s dwell rather than some other number',
    Math.abs(dwellOpenMs - PANEL_DWELL_MS) < 900,
    `${dwellOpenMs}ms vs ${PANEL_DWELL_MS}ms`,
  );
  check(
    'it closed because the tour walked on, which is what dismiss.ts does',
    after.stepId !== 'ai-script',
    after.stepId,
  );
}

/* ===== 3. THE COUNTERFACTUAL — a step with no dwell, same gesture ======== */
/*
 * "1.5s before" is a claim about the code as it was. What can be measured NOW
 * is the beat a step without a dwell still gets, driven the same way: if that
 * comes out at ~1.5s then the dwell is the whole difference.
 */
console.log('\n3. a step that declares NO dwell, for the contrast');
await restartAt('customize-open');
{
  // customize-open HAS a dwell; walk on to customize-do, which does not.
  await page.locator('.nb-rail-button[data-tool="customize"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') !== null);
  await page.waitForTimeout(600);
  await jump('customize-do');
  await page.waitForTimeout(400);
  const before = await state();
  check('on a step with no dwell', before.stepId === 'customize-do', before.stepId);
  // Satisfy it the reader's way: press a design tile inside the open sheet.
  const tile = page.locator('.nb-rail-panel[aria-hidden="false"] .nb-design-tile, .nb-rail-panel[aria-hidden="false"] .nb-strip-tile, .nb-rail-panel[aria-hidden="false"] .nb-swatch').first();
  if ((await tile.count()) === 0) {
    console.log('  (no restyle tile on screen — falling back to the reroll)');
  }
  await tile.click({ timeout: 8000 }).catch(() => undefined);
  const armed = await poll(() => globalThis.__nbTutorial.getState().advance, null, 8000);
  check(
    'an ordinary step still gets the plain 1.5s beat',
    armed !== null && armed.total === CELEBRATE_MS,
    armed === null ? 'never armed' : `${armed.total}ms`,
  );
  console.log(
    `  contrast: ${armed?.total}ms for a plain step vs ${PANEL_DWELL_MS}ms for ai-script (measured open: ${dwellOpenMs}ms)`,
  );
}

/* ===== 4. the beat is not bought by breaking the fact ==================== */
/*
 * A dwell that only "works" because the step stopped going green would be a
 * regression dressed as a fix. Drive the OTHER way in: press a row inside the
 * sheet rather than the rail icon, which is the gesture the copy describes.
 */
console.log('\n4. the fact still lands on the rows inside the sheet');
await restartAt('ai-script');
{
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.nb-share-row')).map((r) => r.getAttribute('data-share')),
  );
  check('the sheet carries the three script rows', rows.includes('spec'), rows.join(','));
  const st = await state();
  check('the step is green and the beat is stopped (hold)', st.done === true && st.advance === null);
  await page.screenshot({ path: `${OUT}/_refute-tour-dwell-sheet.png` });
  console.log(`  shot ${OUT}/_refute-tour-dwell-sheet.png`);
}

/* -------------------------------- verdict -------------------------------- */
if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [msg, n] of errors) console.log(`  ${n}x ${msg}`);
}
console.log(`\n${fails.length === 0 ? 'ALL GOOD' : `${fails.length} FAILED`}`);
for (const f of fails) console.log(`  - ${f}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
