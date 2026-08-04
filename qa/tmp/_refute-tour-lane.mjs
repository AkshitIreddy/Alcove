/**
 * qa/tmp/_refute-tour-lane.mjs — adversarial pass over the tour-card claim.
 *
 * The claim under test: "checked every step, not only 18 … the probe walks all
 * 20 steps and asserts no card overlaps an open sheet".
 *
 * What the shipped probe's walk does NOT do is OPEN anything, so its sheet half
 * can only ever be vacuous for the steps it does not drive by hand. This one
 * opens the surface each step actually asks for and measures the card against
 * it — every number out of __nbTutorial.getState() vs a live getBoundingClientRect.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const OUT = 'qa/tmp/refute-lane';
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });
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
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const state = () => page.evaluate(() => globalThis.__nbTutorial.getState());
const boxOf = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    if (r.width < 4 || r.height < 4) return null;
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      label: el.getAttribute('aria-label') ?? el.className,
    };
  }, sel);
const sheetBox = () => boxOf('.nb-rail-panel[aria-hidden="false"]');
const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
};
const jump = async (id) => {
  const idx = await page.evaluate(
    (s) => globalThis.__nbTutorial.getState().stepIds.indexOf(s),
    id,
  );
  if (idx < 0) throw new Error(`no step '${id}'`);
  await page.evaluate((i) => globalThis.__nbTutorial.jumpTo(i), idx);
  await page.waitForTimeout(420);
};
const restart = async () => {
  await page.evaluate(() => globalThis.__nbTutorial.start());
  await page.waitForTimeout(300);
  await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
  await page.waitForTimeout(300);
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
await restart();

/* ===== A. every step that ASKS for a rail sheet, with the sheet open ====== */
console.log('\nA. the sheet the step asks for, actually open');
const SHEET_STEPS = [
  ['page-style', '.nb-rail-button[data-tool="page-style"]'],
  ['catalogue', '.nb-rail-button[data-tool="catalogue"]'],
  ['finding-in-book', '.nb-rail-button[data-tool="toc"]'],
  ['customize-open', '.nb-rail-button[data-tool="customize"]'],
  ['customize-do', '.nb-rail-button[data-tool="customize"]'],
  ['ai-script', '.nb-rail-button[data-tool="share"]'],
];
for (const [id, opener] of SHEET_STEPS) {
  await restart();
  await jump(id);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await page.locator(opener).click();
  const up = await poll(
    () => document.querySelector('.nb-rail-panel[aria-hidden="false"]') !== null,
    null,
    8000,
  );
  if (up === null) {
    check(`${id}: the sheet opened`, false, 'never opened');
    continue;
  }
  await page.waitForTimeout(900);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  // ONE evaluate, so the card and the sheet come from the same instant. Read in
  // two round trips they can straddle a stalled rAF frame — the tour's loop is
  // what publishes the card, and under SwiftShader it can lag the DOM by half a
  // second, which reads as an overlap that never existed on any real frame.
  const pair = await page.evaluate(() => {
    const st = globalThis.__nbTutorial.getState();
    const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
    const r = el?.getBoundingClientRect();
    return {
      card: st.card,
      lane: st.lane,
      sheet:
        el === null || r === undefined
          ? null
          : { x: r.x, y: r.y, width: r.width, height: r.height, label: el.getAttribute('aria-label') },
    };
  });
  const st = { card: pair.card, lane: pair.lane };
  const sheet = pair.sheet;
  const on = sheet === null ? -1 : overlap(st.card, sheet);
  const offScreen =
    st.card.x < -1 ||
    st.card.y < -1 ||
    st.card.x + st.card.width > VP.width + 1 ||
    (st.card.height <= VP.height && st.card.y + st.card.height > VP.height + 1);
  check(
    `${id}: card clear of the ${sheet?.label ?? '?'} sheet`,
    on === 0 && !offScreen && st.card.x >= st.lane + LANE_GAP - 1,
    `card ${Math.round(st.card.x)}..${Math.round(st.card.x + st.card.width)}, sheet ${Math.round(
      sheet?.x ?? -1,
    )}..${Math.round((sheet?.x ?? 0) + (sheet?.width ?? 0))}, lane ${st.lane}, overlap ${on}px², ${
      offScreen ? 'OFF SCREEN' : 'on screen'
    }`,
  );
  await page.screenshot({ path: `${OUT}/A-${id}.png` });
}

/* ===== B. the two surfaces that are NOT rail sheets ====================== */
console.log('\nB. the surfaces the shipped probe never looks at');
{
  await restart();
  await jump('quick-switch');
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await page.keyboard.press('Control+k');
  const bar = await poll(() => document.querySelector('.nb-qs-bar') !== null, null, 8000);
  await page.waitForTimeout(700);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const st = await state();
  const box = bar === null ? null : await boxOf('.nb-qs-bar');
  check(
    'quick-switch: card clear of the Ctrl+K bar',
    box !== null && overlap(st.card, box) === 0,
    box === null ? 'no bar' : `overlap ${overlap(st.card, box)}px², card ${Math.round(st.card.x)},${Math.round(st.card.y)}`,
  );
  await page.screenshot({ path: `${OUT}/B-quick-switch.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
{
  await restart();
  await jump('settings');
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  await page.locator('.nbs-gear-button').click();
  const sheet = await poll(() => document.querySelector('.nbs-sheet') !== null, null, 8000);
  await page.waitForTimeout(900);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const st = await state();
  const box = sheet === null ? null : await boxOf('.nbs-sheet');
  check(
    'settings: card clear of the settings sheet',
    box !== null && overlap(st.card, box) === 0,
    box === null
      ? 'no sheet'
      : `overlap ${overlap(st.card, box)}px², card ${Math.round(st.card.x)}..${Math.round(
          st.card.x + st.card.width,
        )}, sheet ${Math.round(box.x)}..${Math.round(box.x + box.width)}`,
  );
  await page.screenshot({ path: `${OUT}/B-settings.png` });
  await page.locator('.nbs-close').click().catch(() => {});
  await page.waitForTimeout(500);
}

/* ===== C. is the shipped walk's sheet assertion vacuous? ================= */
console.log('\nC. during the shipped probe walk, was any sheet ever open?');
{
  await restart();
  const ids = (await state()).stepIds.filter((id) => id !== 'taste');
  const withSheet = [];
  for (const id of ids) {
    await jump(id);
    await page.evaluate(() => globalThis.__nbTutorial.hold());
    await page.waitForTimeout(120);
    const sheet = await sheetBox();
    if (sheet !== null) withSheet.push(`${id}(${sheet.label})`);
  }
  console.log(
    `  steps with a sheet actually open during the walk: ${
      withSheet.length === 0 ? 'NONE — the overlap half of that check is vacuous' : withSheet.join(', ')
    }`,
  );
}

/* ===== D. why did "with the sheet still open" fail? ====================== */
console.log('\nD. the held step, watched second by second');
{
  await restart();
  await jump('ai-script');
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  if ((await poll(() => globalThis.__nbTutorial.getState().advance !== null, null, 10000)) === null) {
    throw new Error('the countdown never armed');
  }
  await page.locator('.nbt-advance-hold').click();
  const t0 = Date.now();
  const trace = [];
  for (let i = 0; i < 24; i += 1) {
    const snap = await page.evaluate(() => ({
      step: globalThis.__nbTutorial.getState().stepId,
      surfaces: globalThis.__nbTutorial.getState().openSurfaces,
      sheet:
        document.querySelector('.nb-rail-panel[aria-hidden="false"]')?.getAttribute('aria-label') ??
        null,
      lane: globalThis.__nbTutorial.getState().lane,
    }));
    trace.push(`${Date.now() - t0}ms ${snap.step} sheet=${snap.sheet} lane=${snap.lane} surfaces=[${snap.surfaces}]`);
    await page.waitForTimeout(300);
  }
  for (const line of trace) console.log(`  ${line}`);
}

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [msg, n] of errors) console.log(`  ${n}x ${msg}`);
}
console.log(`\n${fails.length === 0 ? 'ALL GOOD' : `${fails.length} FAILED`}`);
for (const f of fails) console.log(`  - ${f}`);
await browser.close();
process.exit(0);
