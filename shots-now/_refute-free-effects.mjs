/**
 * shots-now/_refute-free-effects.mjs — the audit's own second opinion on
 * "any effect, anywhere on the page".
 *
 * `scripts/probe-free-effects.mjs` proves ONE value of each of the five
 * placeable axes reaches the page. The claim being checked here is bigger than
 * that — *five axes, 205 values* — and the failure this repo keeps shipping is
 * exactly the gap between the two: a vocabulary that is authored and counted,
 * and a reader who can only get at the first entry of it.
 *
 * So this asks three questions the first probe does not:
 *
 *   1. Are all 205 of them actually ON the shelf, in free mode, as tiles a
 *      reader can press? (Counted per axis off the tiles' own `data-entry`.)
 *   2. Does a value nobody hand-picked reach the page and PAINT? Every value
 *      placed here is chosen off the middle and the end of each axis's own
 *      list, never the first — a list whose first entry works and whose
 *      fortieth does not is the shape of every gap in this tree.
 *   3. Does the ink survive the trip? A mark carrying `data-frame=…` that
 *      paints no background, no border, no shadow and no pseudo-element is an
 *      invisible box on the page — the same silent nothing the classification
 *      in `placeableEffects.ts` exists to prevent. Measured on the real mark in
 *      the real leaf, on the element AND both pseudo-elements, for all 205.
 *
 * Every measurement is on the APPLIED page: the marks are placed by clicking
 * tiles and clicking paper, and the ink is read off `getComputedStyle` in the
 * leaf's own `.nb-free-layer`. Nothing here imports an app store.
 *
 * Usage: node shots-now/_refute-free-effects.mjs [--url=http://localhost:1420]
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

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120000);

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open the shelf, dismiss the tour, open the first book — through world.ts's bridges.
 *
 * `fresh` clears the browser store first. It is the FIRST leg only: in the dev
 * server the library lives in localStorage, so clearing it on the reload leg
 * wipes the pages and every mark "vanishes" for a reason that has nothing to do
 * with the feature under test. (This probe's own first wrong answer.)
 */
const openBook = async (fresh) => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  for (let i = 0; i < 4; i += 1) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await wait(700);
  }
  let title = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await page.locator('.nb-rail').count()) > 0) break;
    title =
      (await page.evaluate(() => {
        const books = globalThis.__shelfVisibleBooks?.() ?? [];
        const first = books[0];
        if (first === undefined) return null;
        globalThis.__shelfPullOut?.(first.id);
        return first.title;
      })) ?? title;
    await wait(2200);
    await page.keyboard.press('Enter').catch(() => {});
    await wait(2500);
    if ((await page.locator('.nb-rail').count()) > 0) break;
    await page
      .locator('.nb-pulled-book, .nb-book-cover')
      .first()
      .click({ force: true, timeout: 4000 })
      .catch(() => {});
    await wait(2500);
  }
  await page.waitForSelector('.nb-rail', { timeout: 60000 });
  await page.waitForSelector('.nb-prose p', { timeout: 60000 });
  await wait(1800);
  return title;
};

const catalogueOpen = async () =>
  (await page.locator('.nb-catalogue').count()) > 0 &&
  (await page.locator('.nb-cat-search-input').first().isVisible());

const openCatalogue = async () => {
  if (await catalogueOpen()) return;
  await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
  await page.waitForSelector('.nb-cat-search-input', { state: 'visible', timeout: 30000 });
  await wait(600);
};

const closeCatalogue = async () => {
  if (!(await catalogueOpen())) return;
  await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
  await page.waitForSelector('.nb-cat-search-input', { state: 'hidden', timeout: 30000 });
  await wait(600);
};

/**
 * Is anything at all drawn here?
 *
 * The element and BOTH pseudo-elements, because that is how effects.css draws:
 * a tape strip is a `::before`, a frame's corner is an `::after`, and a scrap
 * is a background on the box itself. A value that answers no on all three is a
 * box the reader placed and cannot see.
 */
const INK_AUDIT = `(el) => {
  /*
   * "Is this colour invisible", and NOT by parsing rgba().
   *
   * Nearly every value in effects.css is a color-mix(), which Chrome computes
   * to color(srgb …) or oklab(…) — an rgba() regex reads all of them as
   * transparent and reports fifty painted values as blank. Only the two
   * spellings of nothing are nothing.
   */
  const opaque = (c) => {
    const v = (c || '').replace(/\\s/g, '');
    return v !== '' && v !== 'transparent' && v !== 'rgba(0,0,0,0)';
  };
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const layers = [];
  for (const pseudo of [null, '::before', '::after']) {
    const cs = getComputedStyle(el, pseudo ?? undefined);
    if (pseudo !== null && (cs.content === 'none' || cs.display === 'none')) continue;
    const w = Number.parseFloat(cs.width) || 0;
    const h = Number.parseFloat(cs.height) || 0;
    const border = sides.some(
      (s) =>
        (Number.parseFloat(cs['border' + s + 'Width']) || 0) > 0 &&
        cs['border' + s + 'Style'] !== 'none' &&
        opaque(cs['border' + s + 'Color']),
    );
    const painted =
      cs.backgroundImage !== 'none' ||
      opaque(cs.backgroundColor) ||
      cs.boxShadow !== 'none' ||
      border ||
      ((Number.parseFloat(cs.outlineWidth) || 0) > 0 && cs.outlineStyle !== 'none');
    // A border can paint on a zero-height box; a background cannot.
    const big = border ? w > 0.5 || h > 0.5 : w > 0.5 && h > 0.5;
    if (painted && big) layers.push((pseudo ?? 'self') + ' ' + w.toFixed(0) + 'x' + h.toFixed(0));
  }
  const svg = el.querySelector('svg');
  if (svg && svg.querySelectorAll('path, circle, line, polyline').length > 0) {
    const r = svg.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) layers.push('svg ' + r.width.toFixed(0) + 'x' + r.height.toFixed(0));
  }
  return layers;
}`;

/** Every free mark on the spread, with what its ink actually paints. */
const marksOnPage = async () =>
  page.evaluate(
    (auditSrc) => {
      const audit = eval(auditSrc);
      return [...document.querySelectorAll('.nb-free-layer .nb-free-mark')].map((el) => {
        const ink = el.querySelector('.nb-free-mark-ink');
        return {
          fx: el.getAttribute('data-fx'),
          value: el.getAttribute('data-fx-value'),
          left: el.style.left,
          top: el.style.top,
          inLayer: el.closest('.nb-free-layer') !== null,
          inProse: el.closest('.nb-prose') !== null,
          paints: ink ? audit(ink) : [],
        };
      });
    },
    INK_AUDIT,
  );

/** Arm a tile by its data-entry id, through the search box, as a reader would. */
const armTile = async (entryId, query) => {
  await openCatalogue();
  await page.locator('.nb-cat-search-input').fill(query);
  await wait(600);
  const tile = page.locator(`.nb-cat-item[data-entry="${entryId}"]`);
  if ((await tile.count()) === 0) return false;
  await tile.first().scrollIntoViewIfNeeded();
  await tile.first().click();
  await wait(400);
  return (await tile.first().getAttribute('aria-pressed')) === 'true';
};

const placeAt = async (fx, fy) => {
  const box = await page.evaluate(() => {
    const r = document
      .querySelector('.nb-leaf-paper[data-side="left"] .nb-free-layer')
      .getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.mouse.click(box.left + box.width * fx, box.top + box.height * fy);
  await wait(800);
};

/* ========================================================================== *
 *                                  the run                                   *
 * ========================================================================== */

console.log('\n1. open a book');
console.log('  opened:', await openBook(true));

console.log('\n2. how many of the 205 are on the shelf, in free mode');
await openCatalogue();
await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
await wait(800);
const trimShelf = '.nb-cat-shelf[data-shelf="trim"]';
await page.locator(`${trimShelf} .nb-cat-mode .nb-chip[data-mode="free"]`).click();
await wait(400);

// Each run opens capped at twenty with its own reveal control (`Capped` in
// DesignStrip.tsx). Counting the tiles without pressing those says twenty, and
// "only the first twenty of each fifty are reachable" would be a real gap — so
// press them, and count what a reader who did the same would see.
// `aria-expanded="false"`, not "every control": an opened one stays in the grid
// as "show fewer", so clicking blindly would shut the run it just opened.
for (let pass = 0; pass < 20; pass += 1) {
  const shut = page.locator(`${trimShelf} .nb-cat-more[aria-expanded="false"]`);
  if ((await shut.count()) === 0) break;
  await shut.first().scrollIntoViewIfNeeded();
  await shut.first().click();
  await wait(250);
}
console.log(
  '  runs still capped:',
  await page.locator(`${trimShelf} .nb-cat-more[aria-expanded="false"]`).count(),
);

const tilesByAxis = await page.evaluate(() => {
  const out = {};
  for (const el of document.querySelectorAll(
    '.nb-cat-shelf[data-shelf="trim"] .nb-cat-item[data-entry^="fx-"]',
  )) {
    const id = el.getAttribute('data-entry') ?? '';
    const axis = id.split('-')[1];
    (out[axis] ??= []).push(id.slice(`fx-${axis}-`.length));
  }
  return out;
});
for (const [axis, values] of Object.entries(tilesByAxis)) {
  console.log(`  ${axis}: ${values.length}`);
}
const placeableCount = ['tape', 'washi', 'frame', 'paper', 'doodle'].reduce(
  (n, k) => n + (tilesByAxis[k]?.length ?? 0),
  0,
);
check('all 205 placeable values are tiles a reader can press', placeableCount === 205, `counted ${placeableCount}`);
check('and the block-only axes are on the same shelf, unpromoted', (tilesByAxis.shadow?.length ?? 0) === 50 && (tilesByAxis.underline?.length ?? 0) === 50);

console.log('\n3. place values nobody hand-picked — the middle and the end of each list');
// Never index 0: a list whose first entry works and whose fortieth does not is
// the exact shape of the gap this audit keeps finding.
const picks = [];
for (const axis of ['tape', 'washi', 'frame', 'paper']) {
  const values = tilesByAxis[axis] ?? [];
  for (const index of [Math.floor(values.length / 2), values.length - 1]) {
    if (values[index] !== undefined) picks.push([axis, values[index]]);
  }
}
for (const kind of tilesByAxis.doodle ?? []) picks.push(['doodle', kind]);
// The three the attribute sweep in step 4 says draw nothing in a mark, placed
// the long way round as well — by pressing the tile and clicking the paper —
// because "the sweep was unfaithful" is the first thing anyone would say.
for (const value of ['ladder', 'seam', 'bookcloth']) {
  if ((tilesByAxis.tape ?? []).includes(value)) picks.push(['tape', value]);
}

let slot = 0;
const spread = [
  [0.22, 0.16], [0.5, 0.16], [0.78, 0.16],
  [0.22, 0.34], [0.5, 0.34], [0.78, 0.34],
  [0.22, 0.52], [0.5, 0.52], [0.78, 0.52],
  [0.22, 0.7], [0.5, 0.7], [0.78, 0.7],
  [0.22, 0.88], [0.5, 0.88], [0.78, 0.88],
  [0.35, 0.25],
];
for (const [axis, value] of picks) {
  const armed = await armTile(`fx-${axis}-${value}`, value);
  check(`armed ${axis}/${value} from the shelf`, armed);
  await closeCatalogue();
  const at = spread[slot % spread.length];
  slot += 1;
  await placeAt(at[0], at[1]);
}

const placed = await marksOnPage();
console.log('  placed:', placed.map((m) => `${m.fx}/${m.value}[${m.paints.join('+') || 'NOTHING'}]`).join('\n           '));
check('every pick landed on the page', placed.length === picks.length, `${placed.length} of ${picks.length}`);
const blank = placed.filter((m) => m.paints.length === 0);
check(
  'every placed mark actually paints something in the leaf',
  blank.length === 0,
  blank.map((m) => `${m.fx}/${m.value}`).join(', '),
);
check('all of them are in the free layer, none in the prose', placed.every((m) => m.inLayer && !m.inProse));

await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/tmp/refute-freefx-01-leaf.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/tmp/refute-freefx-01-leaf.png');

console.log('\n4. the other 196: every value of every trim axis, in a real mark in the real leaf');
// The mark is the one the reader placed; only the value on it changes, so the
// selector context effects.css sees — `.nb-free-layer .nb-fx-specimen
// [data-tape]` — is exactly the one a placed value gets.
const sweep = await page.evaluate(
  ({ auditSrc, values }) => {
    const audit = eval(auditSrc);
    const out = {};
    for (const [axis, list] of Object.entries(values)) {
      const mark = document.querySelector(`.nb-free-layer .nb-free-mark[data-fx="${axis}"]`);
      if (mark === null) {
        out[axis] = { missing: true, blank: list };
        continue;
      }
      const ink = mark.querySelector('.nb-free-mark-ink');
      const original = ink.getAttribute(`data-${axis}`);
      const blank = [];
      for (const value of list) {
        ink.setAttribute(`data-${axis}`, value);
        if (audit(ink).length === 0) blank.push(value);
      }
      ink.setAttribute(`data-${axis}`, original);
      out[axis] = { missing: false, blank };
    }
    return out;
  },
  {
    auditSrc: INK_AUDIT,
    values: {
      tape: tilesByAxis.tape,
      washi: tilesByAxis.washi,
      frame: tilesByAxis.frame,
      paper: tilesByAxis.paper,
    },
  },
);
for (const [axis, result] of Object.entries(sweep)) {
  check(
    `all 50 ${axis} values paint when free-placed`,
    !result.missing && result.blank.length === 0,
    result.missing ? 'no placed mark of this axis to test on' : result.blank.join(', '),
  );
}

console.log('\n4b. anything the style audit called blank, checked again in PIXELS');
// A computed-style audit can be wrong in either direction, so nothing is called
// invisible on its word alone: the mark's own patch of leaf is photographed with
// the value on and with the ink hidden, and identical PNG bytes — same encoder,
// same static page — mean the value drew nothing there.
const suspects = [
  ...blank.map((m) => [m.fx, m.value]),
  ...Object.entries(sweep).flatMap(([axis, r]) => (r.blank ?? []).map((value) => [axis, value])),
].filter(([axis]) => axis !== 'doodle');
if (suspects.length === 0) console.log('  nothing to re-check');
for (const [axis, value] of suspects) {
  const mark = page.locator(`.nb-free-layer .nb-free-mark[data-fx="${axis}"]`).first();
  await page.evaluate(
    ({ axis: a, value: v }) => {
      const ink = document
        .querySelector(`.nb-free-layer .nb-free-mark[data-fx="${a}"]`)
        .querySelector('.nb-free-mark-ink');
      ink.setAttribute(`data-${a}`, v);
      ink.style.visibility = '';
    },
    { axis, value },
  );
  await wait(150);
  const box = await mark.boundingBox();
  const clip = {
    x: Math.max(0, box.x - 14),
    y: Math.max(0, box.y - 14),
    width: box.width + 28,
    height: box.height + 28,
  };
  const on = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.evaluate((a) => {
    document
      .querySelector(`.nb-free-layer .nb-free-mark[data-fx="${a}"]`)
      .querySelector('.nb-free-mark-ink').style.visibility = 'hidden';
  }, axis);
  await wait(150);
  const off = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.evaluate((a) => {
    document
      .querySelector(`.nb-free-layer .nb-free-mark[data-fx="${a}"]`)
      .querySelector('.nb-free-mark-ink').style.visibility = '';
  }, axis);
  check(
    `${axis}/${value} draws pixels on the leaf`,
    Buffer.compare(on, off) !== 0,
    'identical to the same patch of paper with the ink hidden',
  );
}

console.log('\n4c. …and is it the FREE placement that lost them, or the value itself?');
// The discriminator that decides whose defect it is. The same value goes onto a
// real paragraph — the block form that has always worked — and is audited the
// same way. Paints on the block but not on the page = free placement dropped
// it. Paints on neither = the value was already broken in effects.css and this
// has nothing to do with placement.
for (const [axis, value] of suspects) {
  const verdict = await page.evaluate(
    ({ axis: a, value: v, auditSrc }) => {
      const audit = eval(auditSrc);
      const block = document.querySelector('.nb-prose p');
      if (block === null) return 'no block to test on';
      const had = block.getAttribute(`data-${a}`);
      block.setAttribute(`data-${a}`, v);
      const layers = audit(block);
      if (had === null) block.removeAttribute(`data-${a}`);
      else block.setAttribute(`data-${a}`, had);
      return layers.join('+') || 'NOTHING';
    },
    { axis, value, auditSrc: INK_AUDIT },
  );
  console.log(`  ${axis}/${value} on a paragraph: ${verdict}`);
}

console.log('\n5. and the same is still true after the browser is reloaded');
await wait(2500);
await openBook(false);
const after = await marksOnPage();
console.log('  after reload:', after.map((m) => `${m.fx}/${m.value}`).join(', '));
check('every mark came back', after.length === placed.length, `${after.length} of ${placed.length}`);
check(
  'and still paints',
  after.length > 0 && after.every((m) => m.paints.length > 0),
  after.filter((m) => m.paints.length === 0).map((m) => `${m.fx}/${m.value}`).join(', '),
);
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/tmp/refute-freefx-02-after-reload.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/tmp/refute-freefx-02-after-reload.png');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
