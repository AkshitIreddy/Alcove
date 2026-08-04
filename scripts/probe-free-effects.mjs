/**
 * scripts/probe-free-effects.mjs — "put ANY effect anywhere on the page".
 *
 * The reader: *"give user the option to drag and place stickers or any effects,
 * like i mean click on it and put it anywhere on the page, not caring about
 * where lines are"*. Stickers answered that; the effects did not — tape, washi,
 * frames and paper were block ATTRIBUTES and nothing else, so a strip of tape
 * could only ever lie across whichever paragraph the caret happened to be in.
 *
 * A specimen board would prove the trim DRAWS. This proves the app can REACH
 * it, driven the way a reader drives it: open the catalogue from the rail, pick
 * "anywhere on the page" on the tape & trim shelf, click a tape, close the
 * sheet, click a bare patch of page — then check the APPLIED state, reload the
 * whole browser, and check it is still exactly there.
 *
 * Every assertion is on what is on the page, never on what was saved:
 *
 *   1. the mode chips exist on the trim shelf at all (the gap: they were on the
 *      sticker shelf and nowhere else);
 *   2. a placed mark is a `.nb-free-mark` inside the leaf's `.nb-free-layer`,
 *      carrying the axis's own `data-<key>` — so it is painted by the same
 *      declarations in effects.css that paint a block;
 *   3. it lands where the pointer was, not where the lines are — the click
 *      point is chosen BELOW every block on the page and off the rule grid, and
 *      the mark's own box is measured against it;
 *   4. no block in the document gained the attribute (the old behaviour);
 *   5. it drags, and the new position sticks;
 *   6. after a full reload it is at the same x/y/w/h on the same page;
 *   7. a lift is NOT placeable and still dresses the block, which is the other
 *      half of the classification in effects/placeableEffects.ts.
 *
 * Usage: node scripts/probe-free-effects.mjs [--url=http://localhost:1420]
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
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: `qa/ui/${name}.png`, animations: 'disabled', caret: 'hide' });
  console.log(`  shot qa/ui/${name}.png`);
};

/** Open the shelf, dismiss the tour, and open the first book — as a click does. */
const openBook = async (fresh) => {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  }
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
  // Through the world's own bridge, not a probe-side import of the app store:
  // on a dev server that has served HMR updates a second copy of a module is a
  // real possibility, and a click on a spine is what this is standing in for.
  let title = null;
  // Retried, because a pulled book opens on a SECOND press and the first one
  // can land while the pull tween is still running — which is how this timed
  // out on the reload leg while passing on the first.
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

/**
 * A point on the left leaf where there is no line of text and no printed rule.
 *
 * Below every block in the document (so nothing is written there), and offset
 * off the rule grid by half a band, because "not caring about where lines are"
 * is the whole claim and landing on a rule by luck would not test it.
 */
const bareSpot = async () =>
  page.evaluate(() => {
    const leaf = document.querySelector('.nb-leaf-paper[data-side="left"]');
    const layer = leaf.querySelector('.nb-free-layer');
    const box = layer.getBoundingClientRect();
    let lowest = box.top;
    for (const block of leaf.querySelectorAll('.nb-prose > *')) {
      lowest = Math.max(lowest, block.getBoundingClientRect().bottom);
    }
    const band =
      Number.parseFloat(getComputedStyle(leaf).getPropertyValue('--page-line-height')) || 32;
    // Two bands clear of the last written line, then half a band off the grid.
    const y = Math.min(lowest + band * 2 + band / 2, box.bottom - band * 2);
    const x = box.left + box.width * 0.62;
    return {
      x,
      y,
      box: { left: box.left, top: box.top, width: box.width, height: box.height },
      lowestBlockBottom: lowest,
      band,
      // What the reader would hit there if nothing were placed: the paper or
      // the prose background, never a word.
      elementThere: document.elementFromPoint(x, y)?.className ?? '(none)',
      textThere: document.elementFromPoint(x, y)?.textContent?.trim().slice(0, 24) ?? '',
    };
  });

/** Every free mark on the open spread, as the DOM has it. */
const marksOnPage = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nb-free-layer .nb-free-mark')].map((el) => {
      const r = el.getBoundingClientRect();
      const layer = el.closest('.nb-free-layer').getBoundingClientRect();
      const ink = el.querySelector('.nb-free-mark-ink');
      return {
        fx: el.getAttribute('data-fx'),
        value: el.getAttribute('data-fx-value'),
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height,
        // What effects.css was actually handed — the whole point of not having
        // a second, free-placement copy of any of the 205 values.
        inkAttrs: ink
          ? [...ink.attributes].map((a) => `${a.name}=${a.value}`).filter((s) => s.startsWith('data-'))
          : [],
        inLayer: el.closest('.nb-free-layer') !== null,
        inProse: el.closest('.nb-prose') !== null,
        centreX: r.left + r.width / 2 - layer.left,
        centreY: r.top + r.height / 2 - layer.top,
        // LAYOUT px, not the rect: the whole book carries a `--nb-spread-fit`
        // scale, so a rect is screen pixels while a computed style is not, and
        // comparing the two was this probe's own first wrong answer.
        boxWidth: el.offsetWidth,
        boxHeight: el.offsetHeight,
        // What effects.css actually PAINTS. A strip is a ::before, so there is
        // no rect to ask for — its used size times the ink box's transform
        // matrix is the rendered size, and it is the only way to tell "the mark
        // stretched" from "the hit area stretched and the tape stayed 100px in
        // the middle of it".
        inkStrip: ink
          ? (() => {
              const style = getComputedStyle(ink, '::before');
              const m = new DOMMatrix(getComputedStyle(ink).transform);
              return {
                width: (Number.parseFloat(style.width) || 0) * m.a,
                height: (Number.parseFloat(style.height) || 0) * m.d,
                scale: `${m.a.toFixed(2)}×${m.d.toFixed(2)}`,
              };
            })()
          : null,
      };
    }),
  );

/** Which block-level attributes the document's blocks carry (should stay empty). */
const blockAttrs = async () =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.nb-prose > *')) {
      for (const key of ['tape', 'washi', 'frame', 'paper', 'shadow']) {
        const v = el.getAttribute(`data-${key}`);
        if (v !== null) out.push(`${el.tagName.toLowerCase()}[data-${key}=${v}]`);
      }
    }
    return out;
  });

/**
 * The sheet stays in the DOM when it closes, so "is it open" is a VISIBILITY
 * question. Counting `.nb-catalogue` said yes forever and every fill after the
 * first close timed out against a hidden input.
 */
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

/** Pick a tile by its stable `data-entry` id, finding it through the search box. */
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

/* ========================================================================== *
 *                                  the run                                   *
 * ========================================================================== */

console.log('\n1. open a book');
console.log('  opened:', await openBook(true));

console.log('\n2. the placement chips reach the TRIM shelf, not just the stickers');
await openCatalogue();
await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
await wait(800);
const trimShelf = '.nb-cat-shelf[data-shelf="trim"]';
check(
  'trim shelf offers "anywhere on the page"',
  (await page.locator(`${trimShelf} .nb-cat-mode .nb-chip[data-mode="free"]`).count()) === 1,
);
console.log(
  '  chips:',
  (await page.locator(`${trimShelf} .nb-cat-mode .nb-chip`).allTextContents()).join(' | '),
);
console.log(
  '  runs on the shelf:',
  (await page.locator(`${trimShelf} .nb-cat-run-title`).allTextContents())
    .map((s) => s.split('\n')[0].trim())
    .join(', '),
);
await shot('freefx-01-trim-shelf');

await page.locator(`${trimShelf} .nb-cat-mode .nb-chip[data-mode="free"]`).click();
await wait(500);
check(
  'the mode is on',
  (await page
    .locator(`${trimShelf} .nb-cat-mode .nb-chip[data-mode="free"]`)
    .getAttribute('aria-pressed')) === 'true',
);
console.log(
  '  note:',
  (await page.locator(`${trimShelf} .nb-cat-mode-note`).first().textContent())
    ?.replace(/\s+/g, ' ')
    .trim(),
);
await shot('freefx-02-mode-on');

console.log('\n3. arm a strip of gaffer tape and close the sheet');
check('found the gaffer tape tile', await armTile('fx-tape-gaffer', 'gaffer'));
check(
  'the tile lit up as the armed one',
  (await page
    .locator('.nb-cat-item[data-entry="fx-tape-gaffer"]')
    .getAttribute('aria-pressed')) === 'true',
);
await closeCatalogue();
const hint = await page.locator('.nb-place-hint-text').first().textContent();
console.log('  hint at the foot of the page:', hint?.replace(/\s+/g, ' ').trim());
check('the armed mark survives closing the sheet', (await page.locator('.nb-place-hint').count()) === 1);
check('and it says what it is', (hint ?? '').includes('tape · gaffer'));

console.log('\n4. click a bare patch of page — no line there, no block there');
// The seeded Welcome page arrives already dressed (a washi'd blockquote), so
// "no block was dressed" has to be a DIFFERENCE against what was there before
// the click, never a count of zero.
const dressedBefore = await blockAttrs();
console.log('  blocks already dressed by the template:', dressedBefore.join(', ') || '(none)');
const spot = await bareSpot();
console.log(
  `  clicking at (${spot.x.toFixed(0)}, ${spot.y.toFixed(0)}) — ` +
    `${(spot.y - spot.lowestBlockBottom).toFixed(0)}px below the last block, ` +
    `${(((spot.y - spot.box.top) % spot.band) / spot.band).toFixed(2)} of the way between two rules`,
);
console.log(`  what is there now: <${spot.elementThere}> text=${JSON.stringify(spot.textThere)}`);
check('the spot really is below every block', spot.y > spot.lowestBlockBottom);
await page.mouse.click(spot.x, spot.y);
await wait(1200);

let marks = await marksOnPage();
console.log('  marks in the free layer:', JSON.stringify(marks, null, 1));
check('one mark landed', marks.length === 1);
check('it is a gaffer tape', marks[0]?.fx === 'tape' && marks[0]?.value === 'gaffer');
check('it is in the leaf free layer, not in the prose', marks[0]?.inLayer === true && marks[0]?.inProse === false);
check(
  'effects.css is handed the axis attribute itself',
  (marks[0]?.inkAttrs ?? []).includes('data-tape=gaffer'),
);
const wantX = spot.x - spot.box.left;
const wantY = spot.y - spot.box.top;
check(
  'it landed under the pointer, not on a line',
  Math.abs((marks[0]?.centreX ?? 0) - wantX) < 8 && Math.abs((marks[0]?.centreY ?? 0) - wantY) < 8,
  `wanted (${wantX.toFixed(0)}, ${wantY.toFixed(0)}), got (${(marks[0]?.centreX ?? 0).toFixed(0)}, ${(marks[0]?.centreY ?? 0).toFixed(0)})`,
);
check(
  'the strip and the box the reader can grab are the same object',
  Math.abs((marks[0]?.inkStrip?.width ?? 0) - (marks[0]?.boxWidth ?? 0)) <
    (marks[0]?.boxWidth ?? 1) * 0.15,
  `strip ${(marks[0]?.inkStrip?.width ?? 0).toFixed(0)}px in a ${(marks[0]?.boxWidth ?? 0).toFixed(0)}px box`,
);
const dressed = (await blockAttrs()).filter((s) => !dressedBefore.includes(s));
check('no block was dressed — this is not a block attribute', dressed.length === 0, dressed.join(', '));
await shot('freefx-03-tape-placed');

console.log('\n5. the rest of the placeable axes, elsewhere on the same page');
for (const [entry, query, fx, atX, atY] of [
  ['fx-frame-scallop', 'scallop frame', 'frame', 0.3, 0.55],
  ['fx-doodle-spiral', 'spiral', 'doodle', 0.86, 0.28],
  ['fx-washi-stripe', 'candy stripe', 'washi', 0.5, 0.9],
  ['fx-paper-torn', 'torn paper', 'paper', 0.62, 0.38],
]) {
  check(`found the ${fx} tile`, await armTile(entry, query));
  await closeCatalogue();
  await page.mouse.click(spot.box.left + spot.box.width * atX, spot.box.top + spot.box.height * atY);
  await wait(1000);
}
marks = await marksOnPage();
console.log('  now on the page:', marks.map((m) => `${m.fx}/${m.value} @${m.left},${m.top}`).join(' | '));
check('five marks, five axes', marks.length === 5);
check('the doodle came through as a doodle', marks.some((m) => m.fx === 'doodle' && m.value === 'spiral'));
check('the frame came through as a frame', marks.some((m) => m.fx === 'frame' && m.value === 'scallop'));
check('the washi came through as a washi', marks.some((m) => m.fx === 'washi'));
check('the scrap came through as paper', marks.some((m) => m.fx === 'paper'));
await shot('freefx-04-three-marks');
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/ui/freefx-04b-leaf.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/ui/freefx-04b-leaf.png');

console.log('\n6. a lift is NOT placeable — it still dresses the block');
// Put the caret somewhere first: a trim tile in "on this block" mode acts on
// the block under the selection, and there is no selection after three clicks
// that were placements rather than carets.
await page.locator('.nb-prose p').first().click();
await wait(500);
const liftBefore = await blockAttrs();
check('found a lift tile', await armTile('fx-shadow-lifted', 'lifted'));
check('nothing got armed by it', (await page.locator('.nb-place-hint').count()) === 0);
check(
  'no free mark appeared for it',
  (await marksOnPage()).every((m) => m.fx !== 'shadow'),
);
const afterLift = (await blockAttrs()).filter((s) => !liftBefore.includes(s));
console.log('  new block attributes:', afterLift.join(', ') || '(none)');
check(
  'it went onto the block under the caret instead',
  afterLift.some((s) => s.includes('data-shadow=lifted')),
);
console.log(
  '  and the tile says why:',
  await page.locator('.nb-cat-item[data-entry="fx-shadow-lifted"]').getAttribute('data-tooltip'),
);
await page.locator('.nb-cat-search-input').fill('');
await closeCatalogue();

console.log('\n7. drag the tape somewhere else');
const before = (await marksOnPage()).find((m) => m.fx === 'tape');
const tape = page.locator('.nb-free-layer .nb-free-mark[data-fx="tape"]').first();
const tapeBox = await tape.boundingBox();
await page.mouse.move(tapeBox.x + tapeBox.width / 2, tapeBox.y + 4);
await page.mouse.down();
await page.mouse.move(tapeBox.x + tapeBox.width / 2 - 120, tapeBox.y + 4 - 90, { steps: 12 });
await page.mouse.up();
await wait(900);
const after = (await marksOnPage()).find((m) => m.fx === 'tape');
console.log(`  ${before.left},${before.top}  ->  ${after.left},${after.top}`);
check('the drag moved it', after.left !== before.left && after.top !== before.top);
await shot('freefx-05-dragged');

console.log('\n7b. pick it up and stretch it by the corner grip');
const tapeNow = await page
  .locator('.nb-free-layer .nb-free-mark[data-fx="tape"]')
  .first()
  .boundingBox();
// A press that does not travel is a pick-up, which is what brings the grip out.
await page.mouse.click(tapeNow.x + tapeNow.width / 2, tapeNow.y + tapeNow.height / 2);
await wait(700);
const grip = page.locator('.nb-free-mark[data-fx="tape"] .nb-free-mark-grip').first();
check('the puck and the grip came out', (await grip.count()) === 1);
const stripBefore = (await marksOnPage()).find((m) => m.fx === 'tape');
const gripBox = await grip.boundingBox();
await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
await page.mouse.down();
await page.mouse.move(
  gripBox.x + gripBox.width / 2 + 110,
  gripBox.y + gripBox.height / 2 + 20,
  { steps: 12 },
);
await page.mouse.up();
await wait(900);
const stripAfter = (await marksOnPage()).find((m) => m.fx === 'tape');
console.log(
  `  box ${stripBefore.width} -> ${stripAfter.width}, ` +
    `strip ${stripBefore.inkStrip.width.toFixed(0)}px -> ${stripAfter.inkStrip.width.toFixed(0)}px`,
);
check('the box grew', stripAfter.boxWidth > stripBefore.boxWidth + 20);
check(
  'and the drawing grew with it, rather than sitting in the middle of a bigger hit area',
  stripAfter.inkStrip.width > stripBefore.inkStrip.width + 20,
);
await shot('freefx-05b-stretched');
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/ui/freefx-05c-stretched-leaf.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/ui/freefx-05c-stretched-leaf.png');

const wanted = (await marksOnPage())
  .map((m) => `${m.fx}/${m.value}@${m.left}/${m.top}/${m.width}/${m.height}`)
  .sort();

console.log('\n7c. flood the page until it overflows — the blocks travel, the marks stay');
// The pagination contract (editor/effects/freePlacement.ts): a free mark
// belongs to the PAGE, not to the paragraph it happens to be anchored in. So
// the drain has to take the words and leave the marks exactly where they are.
const leafHead = async () =>
  page.evaluate(
    () =>
      document
        .querySelector('.nb-leaf-paper[data-side="left"] .nb-prose')
        ?.textContent?.trim()
        .slice(0, 24) ?? '',
  );
console.log('  left leaf starts:', JSON.stringify(await leafHead()));
await page.locator('.nb-prose h1').first().click();
await wait(400);
await page.keyboard.press('Control+End');
for (let i = 0; i < 14; i += 1) {
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(
    `${String(i)} — the quick brown fox jumps over the lazy dog, again and again. `.repeat(4),
  );
  await wait(220);
}
await wait(2000);
const headNow = await leafHead();
console.log('  left leaf starts:', JSON.stringify(headNow));
check(
  'the writing really did carry onto another leaf',
  !headNow.startsWith('Welcome to Alcove'),
  `left leaf now ${JSON.stringify(headNow)}`,
);
await shot('freefx-05d-overflowed');

console.log('\n8. reload the whole browser and look again');
console.log('  what was on the page before all that:', wanted.join(' | '));
// Long enough for the page's own debounced save to land.
await wait(2500);
console.log('  reopened:', await openBook(false));
const round = (await marksOnPage())
  .map((m) => `${m.fx}/${m.value}@${m.left}/${m.top}/${m.width}/${m.height}`)
  .sort();
console.log('  after reload: ', round.join(' | '));
check(
  'every mark came back on its own page, at exactly the place and size it was put — ' +
    'through a page break and a reload',
  JSON.stringify(round) === JSON.stringify(wanted),
);
const stillFree = await marksOnPage();
check(
  'and still in the free layer rather than in the text',
  stillFree.length > 0 && stillFree.every((m) => m.inLayer && !m.inProse),
);
await shot('freefx-06-after-reload');
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({ path: 'qa/ui/freefx-06b-leaf-after-reload.png', animations: 'disabled', caret: 'hide' });
console.log('  shot qa/ui/freefx-06b-leaf-after-reload.png');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) F