/**
 * shots-now/_refute-free-marks.mjs — the three sentences of the page-mark claim
 * that `scripts/probe-free-effects.mjs` does NOT test.
 *
 * That probe proves a mark can be armed from the catalogue, lands under the
 * pointer, survives a page break and a reload. It never changes the size of the
 * window and never enters focus mode, so the load-bearing half of
 *
 *   "x/y/w/h are all PERCENTAGES of the leaf, never pixels, so a reflow, a
 *    window resize and the focus-mode zoom all leave a mark where and as big as
 *    it was put"
 *
 * is two-thirds unproven by it: percentages in the STYLE attribute would still
 * read as percentages after a resize even if the leaf's own box had stopped
 * being the thing they resolve against. So this measures the mark's rendered
 * centre and rendered box as a FRACTION of the leaf's rendered box — the number
 * a reader actually sees — across a 1500×950 → 1080×760 resize and across F9.
 *
 * It also checks the `seed` sentence: a doodle's linework is wobbled per seed
 * and the seed is fixed at placement, so dragging one must not redraw it. A
 * seed read off x/y would re-roll the whole sketch mid-drag, and nothing in the
 * DOM assertions of the other probe would notice.
 *
 * Usage: node shots-now/_refute-free-marks.mjs [--url=http://localhost:1420]
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

/** Open the shelf, dismiss the tour, open the first book — world.ts's bridges. */
const openBook = async () => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    polling: 400,
  });
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await page.locator('.nb-rail').count()) > 0) break;
    await page.evaluate(() => {
      const books = globalThis.__shelfVisibleBooks?.() ?? [];
      if (books[0]) globalThis.__shelfPullOut?.(books[0].id);
    });
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
};

const catalogueOpen = async () =>
  (await page.locator('.nb-catalogue').count()) > 0 &&
  (await page.locator('.nb-cat-search-input').first().isVisible());

const openCatalogue = async () => {
  if (await catalogueOpen()) return;
  await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
  await page.waitForSelector('.nb-cat-search-input', { state: 'visible', timeout: 30000 });
  await wait(700);
};

const closeCatalogue = async () => {
  if (!(await catalogueOpen())) return;
  await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
  await page.waitForSelector('.nb-cat-search-input', { state: 'hidden', timeout: 30000 });
  await wait(700);
};

/**
 * Turn the trim shelf's second chip on.
 *
 * Not optional and not a nicety: without it `runEffect` takes the OTHER branch
 * and a tape tile dresses the block under the caret, so the click on the page
 * that follows places nothing. Leaving this out is how the first run of this
 * file "found" only one of three marks — the doodle, which is the one axis that
 * arms itself because it has no block form at all.
 */
const enterFreeMode = async () => {
  await openCatalogue();
  await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
  await wait(800);
  const chip = page.locator('.nb-cat-shelf[data-shelf="trim"] .nb-chip[data-mode="free"]');
  if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  await wait(500);
  return (await chip.getAttribute('aria-pressed')) === 'true';
};

const armTile = async (entryId, query) => {
  await openCatalogue();
  await page.locator('.nb-cat-search-input').fill(query);
  await wait(600);
  const tile = page.locator(`.nb-cat-item[data-entry="${entryId}"]`);
  if ((await tile.count()) === 0) return false;
  await tile.first().scrollIntoViewIfNeeded();
  await tile.first().click();
  await wait(500);
  return true;
};

/**
 * Every mark, in FRACTIONS of the leaf it is on.
 *
 * Rendered rects on both sides, so a scale anywhere up the tree (the spread's
 * `--nb-spread-fit`, focus mode's own zoom) cancels out. Percent strings would
 * not: they are the input, and the whole question is whether the input still
 * resolves against the leaf.
 */
const fractions = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-free-layer .nb-free-mark')].map((el) => {
      const r = el.getBoundingClientRect();
      const layer = el.closest('.nb-free-layer').getBoundingClientRect();
      const doodle = el.querySelector('.nb-free-mark-doodle svg');
      const ink = el.querySelector('.nb-free-mark-ink');
      // What effects.css PAINTS, as a share of the leaf. A `stamp` axis draws
      // its strip at a natural PIXEL size and scales it by an attribute ratio,
      // so this is the number that would drift if the leaf's layout box — not
      // just its rendered box — changed with the window.
      const strip = ink
        ? (() => {
            const before = getComputedStyle(ink, '::before');
            const m = new DOMMatrix(getComputedStyle(ink).transform);
            const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
            return ((Number.parseFloat(before.width) || 0) * m.a * scale) / layer.width;
          })()
        : null;
      return {
        fx: el.getAttribute('data-fx'),
        value: el.getAttribute('data-fx-value'),
        cx: (r.left + r.width / 2 - layer.left) / layer.width,
        cy: (r.top + r.height / 2 - layer.top) / layer.height,
        fw: r.width / layer.width,
        fh: r.height / layer.height,
        strip,
        layoutW: el.closest('.nb-leaf-paper').offsetWidth,
        style: `${el.style.left}/${el.style.top}/${el.style.width}/${el.style.height}`,
        // The doodle's actual linework, so a re-rolled seed is visible.
        ink: doodle ? doodle.innerHTML.length + ':' + doodle.innerHTML.slice(0, 120) : null,
        layerW: Math.round(layer.width),
        layerH: Math.round(layer.height),
      };
    }),
  );

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sameFrame = (before, after, tol, what) => {
  if (before.length !== after.length) {
    check(`${what}: the same marks are still there`, false, `${before.length} -> ${after.length}`);
    return;
  }
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after.find((m) => m.fx === a.fx && m.value === a.value) ?? after[i];
    check(
      `${what}: ${a.fx}/${a.value} is in the same place, the same size`,
      near(a.cx, b.cx, tol) && near(a.cy, b.cy, tol) && near(a.fw, b.fw, tol) && near(a.fh, b.fh, tol),
      `centre ${a.cx.toFixed(3)},${a.cy.toFixed(3)} -> ${b.cx.toFixed(3)},${b.cy.toFixed(3)} · ` +
        `box ${a.fw.toFixed(3)}×${a.fh.toFixed(3)} -> ${b.fw.toFixed(3)}×${b.fh.toFixed(3)}`,
    );
    if (a.strip !== null && b.strip !== null) {
      check(
        `${what}: ${a.fx}/${a.value} — the INK is the same share of the page too`,
        near(a.strip, b.strip, tol),
        `${a.strip.toFixed(3)} -> ${b.strip.toFixed(3)} of the leaf`,
      );
    }
  }
};

/* ========================================================================== *
 *                                  the run                                   *
 * ========================================================================== */

console.log('\n1. open a book and put three marks on the left leaf');
await openBook();
check('the trim shelf went into "anywhere on the page"', await enterFreeMode());
const layerBox = await page.evaluate(() => {
  const b = document
    .querySelector('.nb-leaf-paper[data-side="left"] .nb-free-layer')
    .getBoundingClientRect();
  return { left: b.left, top: b.top, width: b.width, height: b.height };
});
for (const [entry, query, atX, atY] of [
  ['fx-tape-gaffer', 'gaffer', 0.45, 0.82],
  ['fx-paper-torn', 'torn paper', 0.66, 0.62],
  ['fx-doodle-spiral', 'spiral', 0.28, 0.72],
]) {
  check(`armed ${entry}`, await armTile(entry, query));
  await closeCatalogue();
  await page.mouse.click(layerBox.left + layerBox.width * atX, layerBox.top + layerBox.height * atY);
  await wait(900);
}
const placed = await fractions();
console.log('  placed:', placed.map((m) => `${m.fx}/${m.value} ${m.style}`).join(' | '));
check('three marks landed', placed.length === 3);
console.log(
  `  leaf is ${placed[0]?.layerW}×${placed[0]?.layerH} rendered px, ` +
    `${placed[0]?.layoutW} layout px`,
);

console.log('\n2. resize the window — the claim says percentages of the LEAF, not pixels');
await page.setViewportSize({ width: 1080, height: 760 });
await wait(2200);
const resized = await fractions();
console.log(`  leaf is now ${resized[0]?.layerW}×${resized[0]?.layerH} rendered px, ${resized[0]?.layoutW} layout px`);
check(
  'the leaf really did change size (otherwise this proves nothing)',
  Math.abs((resized[0]?.layerW ?? 0) - (placed[0]?.layerW ?? 0)) > 20 ||
    Math.abs((resized[0]?.layerH ?? 0) - (placed[0]?.layerH ?? 0)) > 20,
  `${placed[0]?.layerW}×${placed[0]?.layerH} -> ${resized[0]?.layerW}×${resized[0]?.layerH}`,
);
sameFrame(placed, resized, 0.01, 'after a resize');
await page.screenshot({ path: 'qa/tmp/refute-freemark-01-resized.png', animations: 'disabled' });

console.log('\n3. focus mode (F9) — the other zoom the claim names');
await page.keyboard.press('F9');
await wait(2000);
check(
  'focus mode is on',
  (await page.locator('.nb-book-view.is-focus-mode').count()) === 1,
);
const focused = await fractions();
console.log(`  leaf is now ${focused[0]?.layerW}×${focused[0]?.layerH} rendered px, ${focused[0]?.layoutW} layout px`);
sameFrame(resized, focused, 0.01, 'in focus mode');
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/tmp/refute-freemark-02-focus-leaf.png', animations: 'disabled', caret: 'hide' });
await page.keyboard.press('F9');
await wait(1600);

console.log('\n4. drag the doodle — its seed is fixed at placement, so the sketch must not re-roll');
const doodleBefore = (await fractions()).find((m) => m.fx === 'doodle');
const box = await page.locator('.nb-free-mark[data-fx="doodle"]').first().boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (const step of [30, 60, 90]) {
  await page.mouse.move(box.x + box.width / 2 + step, box.y + box.height / 2 - step / 2);
  await wait(120);
}
const midDrag = (await fractions()).find((m) => m.fx === 'doodle');
await page.mouse.up();
await wait(900);
const doodleAfter = (await fractions()).find((m) => m.fx === 'doodle');
check('the drag moved the doodle', !near(doodleBefore.cx, doodleAfter.cx, 0.01));
check(
  'the linework is the same during the drag',
  midDrag.ink === doodleBefore.ink,
  `${doodleBefore.ink?.slice(0, 40)} vs ${midDrag.ink?.slice(0, 40)}`,
);
check('and after it', doodleAfter.ink === doodleBefore.ink);

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
