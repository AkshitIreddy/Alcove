/**
 * Refutation pass on the tour-card claim.
 *
 * Everything here is measured from the LIVE DOM (getBoundingClientRect on the
 * card element itself and on the open sheet), never from __nbTutorial's own
 * rect — the point is to check the number the overlay reports is the number
 * the browser painted.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const OUT = process.argv[2] ?? 'C:/Users/akshi/AppData/Local/Temp/claude/C--Users-akshi-Desktop-Code-Palace-notebook-app/e96538df-054a-460d-b394-29360e69c638/scratchpad/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/** Real painted boxes, plus the stacking order that made this a bug. */
const measure = () =>
  ({
    card: (() => {
      const el = document.querySelector('.nbt-card');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        z: getComputedStyle(document.querySelector('.nbt-layer')).zIndex,
      };
    })(),
    sheet: (() => {
      const el = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        z: getComputedStyle(el).zIndex,
        label: el.getAttribute('aria-label'),
      };
    })(),
    edgeVar: document.documentElement.style.getPropertyValue('--nb-panel-edge'),
    state: globalThis.__nbTutorial?.getState() ?? null,
  });

const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
};

async function run(vp, tag) {
  console.log(`\n=== viewport ${vp.width}x${vp.height} ===`);
  const context = await browser.newContext({ viewport: vp });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

  const poll = async (fn, timeout = 30000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn);
      if (v) return v;
      if (Date.now() - t0 > timeout) return null;
      await page.waitForTimeout(100);
    }
  };

  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if ((await poll(() => globalThis.__shelfCommands !== undefined, 120000)) === null) {
    throw new Error('no QA bridges');
  }
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
  await page.waitForTimeout(700);
  await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology'], 0));
  if ((await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, 60000)) === null) {
    throw new Error('no books after seeding');
  }
  await page.waitForTimeout(700);

  let pulled = false;
  for (let attempt = 0; attempt < 5 && !pulled; attempt += 1) {
    const spine = await page.evaluate(() => {
      const b = globalThis.__shelfVisibleBooks()[0];
      return b === undefined ? null : globalThis.__shelfSpineRect(b.id);
    });
    const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
    await page.mouse.click(canvas.x + spine.x + spine.width / 2, canvas.y + spine.y + spine.height / 2);
    pulled = (await poll(
      () => document.querySelector('[data-testid="pulled-book"][role="button"]') !== null, 6000,
    )) !== null;
  }
  if (!pulled) throw new Error('book never came out');
  await page.locator('[data-testid="pulled-book"][role="button"]').click();
  if ((await poll(() => document.querySelector('.nb-rail') !== null, 60000)) === null) {
    throw new Error('book never opened');
  }
  await page.waitForTimeout(1200);

  await page.evaluate(() => globalThis.__nbTutorial.start());
  await poll(() => globalThis.__nbTutorial?.getState().running === true);
  await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
  await page.waitForTimeout(400);

  const jump = async (id) => {
    const i = await page.evaluate((s) => globalThis.__nbTutorial.getState().stepIds.indexOf(s), id);
    if (i < 0) throw new Error(`no step ${id}`);
    await page.evaluate((n) => globalThis.__nbTutorial.jumpTo(n), i);
    await page.waitForTimeout(450);
  };

  /* --- step 18, the reported one --- */
  await jump('ai-script');
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const before = await page.evaluate(measure);
  check('no sheet yet, so nothing to clear', before.sheet === null);

  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"][aria-label="In and out"]') !== null);

  // MID-TWEEN: the sheet takes ~half a second to arrive. A card that stepped
  // aside once, to where the sheet was going, would be sitting on it here.
  await page.waitForTimeout(160);
  const mid = await page.evaluate(measure);
  if (mid.sheet !== null && mid.card !== null) {
    check(
      'mid-flight: the card is already clear of where the sheet has got to',
      overlap(mid.card, mid.sheet) === 0,
      `card ${Math.round(mid.card.x)}, sheet right ${Math.round(mid.sheet.x + mid.sheet.width)}, overlap ${overlap(mid.card, mid.sheet)}px²`,
    );
  }

  await page.waitForTimeout(900);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const m = await page.evaluate(measure);
  check('the sheet is open', m.sheet?.label === 'In and out', m.sheet?.label ?? 'none');
  check(
    'the tour layer really does paint over the rail sheet (the premise)',
    Number(m.card.z) > Number(m.sheet.z),
    `card layer z ${m.card.z} vs sheet z ${m.sheet.z}`,
  );
  check(
    'PAINTED card does not touch the PAINTED sheet',
    overlap(m.card, m.sheet) === 0,
    `card ${Math.round(m.card.x)}..${Math.round(m.card.x + m.card.width)}, sheet ${Math.round(m.sheet.x)}..${Math.round(m.sheet.x + m.sheet.width)}, overlap ${overlap(m.card, m.sheet)}px²`,
  );
  check(
    'the reported rect is the painted rect (not a state that lies)',
    Math.abs(m.state.card.x - m.card.x) < 1.5 && Math.abs(m.state.card.y - m.card.y) < 1.5,
    `state ${Math.round(m.state.card.x)},${Math.round(m.state.card.y)} vs painted ${Math.round(m.card.x)},${Math.round(m.card.y)}`,
  );
  check(
    'the whole card is inside the window',
    m.card.x >= 0 && m.card.x + m.card.width <= vp.width + 1 && m.card.y >= 0,
    `${Math.round(m.card.x)}..${Math.round(m.card.x + m.card.width)} of ${vp.width}`,
  );
  await page.screenshot({ path: `${OUT}/${tag}-01-step18.png` });
  console.log(`  shot ${OUT}/${tag}-01-step18.png`);

  /* --- does it come BACK when the sheet leaves? --- */
  await page.locator('.nb-rail-panel[aria-hidden="false"] .nb-panel-close, .nb-rail-panel[aria-hidden="false"] button[aria-label*="lose" i]').first().click().catch(() => {});
  await page.waitForTimeout(1000);
  const closed = await page.evaluate(measure);
  check(
    'and it comes back to the tour placement when the sheet goes',
    closed.sheet === null && Math.abs(closed.card.x - before.card.x) < 2,
    `sheet ${closed.sheet === null ? 'gone' : 'still up'}, card ${Math.round(before.card.x)} → ${Math.round(closed.card.x)}`,
  );

  /* --- an UNANCHORED card (the centerCard branch) with a sheet open --- */
  await jump('welcome');
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const w0 = await page.evaluate(measure);
  check('the welcome card is unanchored (centre branch)', w0.state.anchored === false, `anchored ${w0.state.anchored}`);
  await page.locator('.nb-rail-button[data-tool="share"]').click();
  await poll(() => document.querySelector('.nb-rail-panel[aria-hidden="false"]') !== null);
  await page.waitForTimeout(1000);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  const w1 = await page.evaluate(measure);
  check(
    'the centre-placed card clears the sheet too',
    w1.sheet !== null && overlap(w1.card, w1.sheet) === 0,
    `card ${Math.round(w1.card.x)}, sheet right ${Math.round((w1.sheet?.x ?? 0) + (w1.sheet?.width ?? 0))}, overlap ${w1.sheet ? overlap(w1.card, w1.sheet) : 'n/a'}px²`,
  );
  await page.screenshot({ path: `${OUT}/${tag}-02-unanchored.png` });
  console.log(`  shot ${OUT}/${tag}-02-unanchored.png`);

  /* --- every sheet the book rail has, on the step that teaches it --- */
  console.log('  every rail sheet, one at a time:');
  const tools = await page.evaluate(() =>
    [...document.querySelectorAll('.nb-rail-button[data-tool]')].map((b) => b.getAttribute('data-tool')),
  );
  for (const tool of tools) {
    await page.locator(`.nb-rail-button[data-tool="${tool}"]`).click().catch(() => {});
    await page.waitForTimeout(850);
    await page.evaluate(() => globalThis.__nbTutorial.hold());
    const s = await page.evaluate(measure);
    if (s.sheet === null || s.card === null) continue;
    check(
      `    ${tool}: card clear of "${s.sheet.label}"`,
      overlap(s.card, s.sheet) === 0 && s.card.x + s.card.width <= vp.width + 1,
      `card ${Math.round(s.card.x)}..${Math.round(s.card.x + s.card.width)}, sheet right ${Math.round(s.sheet.x + s.sheet.width)}, overlap ${overlap(s.card, s.sheet)}px²`,
    );
  }

  if (errors.length) console.log(`  page errors: ${[...new Set(errors)].join(' | ')}`);
  await context.close();
}

await run({ width: 1440, height: 900 }, 'w1440');
await run({ width: 960, height: 620 }, 'w960');

console.log(`\n${fails.length === 0 ? 'NOTHING REFUTED' : `${fails.length} REFUTATIONS`}`);
for (const f of fails) console.log(`  - ${f}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
