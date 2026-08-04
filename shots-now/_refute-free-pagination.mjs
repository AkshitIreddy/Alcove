/**
 * shots-now/_refute-free-pagination.mjs — an adversarial re-run of the ONE
 * claim in scripts/probe-free-effects.mjs step 7c/8 that a reader could not
 * check for themselves: *a free mark belongs to the PAGE, and a page break
 * may never take it anywhere.*
 *
 * The original probe compares a SORTED LIST of every mark on the open spread
 * against the same list taken before the flood. Three things that list cannot
 * see, and this file exists to see them:
 *
 *  1. **Which leaf.** `tape@55%/72%` reads identically whether it is on page 1
 *     or page 2, so a mark that swapped leaves would pass unnoticed.
 *  2. **Whether mechanism 2 ever fired.** The contract names two mechanisms —
 *     the unreachable anchor, and `splitFreeMarks` rescuing the ones a PREPEND
 *     pushed into the tail. If the flood never actually pushed page 2's own
 *     first block off page 2, the second mechanism is untested and the whole
 *     proof rests on the first. So this asserts page 2's ORIGINAL head text has
 *     left page 2 while page 2's mark has not: that is the rescue, or nothing.
 *  3. **Duplication.** `anchorFreeMarks` re-inserts nodes that `splitFreeMarks`
 *     removed. Insert without removing and every carry copies the mark onto the
 *     page again; the spread-1 list would still match. So this walks every
 *     spread in the flooded book and counts.
 *
 * Applied state only: every number is read off the DOM the app is painting,
 * and the book is opened through world.ts's own `__shelfVisibleBooks` /
 * `__shelfPullOut` bridges rather than a probe-side import of the store.
 *
 * Usage: node shots-now/_refute-free-pagination.mjs [--url=http://localhost:1420]
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
const shot = async (name) => {
  await page.screenshot({ path: `qa/tmp/${name}.png`, animations: 'disabled', caret: 'hide' });
  console.log(`  shot qa/tmp/${name}.png`);
};

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

/** Every free mark on the open spread, tagged with the LEAF it is standing on. */
const spreadMarks = async () =>
  page.evaluate(() => {
    const out = [];
    for (const side of ['left', 'right']) {
      const leaf = document.querySelector(`.nb-leaf-paper[data-side="${side}"]`);
      if (!leaf) continue;
      for (const el of leaf.querySelectorAll('.nb-free-layer .nb-free-mark')) {
        out.push({
          side,
          fx: el.getAttribute('data-fx'),
          value: el.getAttribute('data-fx-value'),
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          height: el.style.height,
          inLayer: el.closest('.nb-free-layer') !== null,
          inProse: el.closest('.nb-prose') !== null,
        });
      }
    }
    return out;
  });

const key = (m) => `${m.side}:${m.fx}/${m.value}@${m.left}/${m.top}/${m.width}/${m.height}`;

const heads = async () =>
  page.evaluate(() => {
    const read = (side) => {
      const leaf = document.querySelector(`.nb-leaf-paper[data-side="${side}"]`);
      const prose = leaf?.querySelector('.nb-prose');
      return {
        head: prose?.textContent?.trim().slice(0, 40) ?? '(blank)',
        blocks: prose ? prose.children.length : 0,
      };
    };
    return { left: read('left'), right: read('right') };
  });

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
 * Put the trim shelf into "anywhere on the page" mode.
 *
 * Not optional and not decoration: `freeMode` starts FALSE, so a tape tile
 * clicked before this chip goes on as `data-tape` on the block under the caret
 * and no free mark is ever born. This probe's first run placed two marks
 * instead of three for exactly that reason — the doodle tile silently flipped
 * the shelf into free mode on its way past and rescued the third.
 */
const useFreeMode = async () => {
  await openCatalogue();
  await page.getByRole('button', { name: 'tape & trim', exact: true }).click();
  await wait(800);
  const chip = page.locator('.nb-cat-shelf[data-shelf="trim"] .nb-cat-mode .nb-chip[data-mode="free"]');
  if ((await chip.getAttribute('aria-pressed')) !== 'true') {
    await chip.click();
    await wait(500);
  }
  check('the trim shelf is in "anywhere on the page" mode', (await chip.getAttribute('aria-pressed')) === 'true');
};

/** Arm a trim tile the way a reader does: search the sheet, click the tile. */
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

/** Put a mark down on a given leaf at a fraction of that leaf's own box. */
const place = async (entry, query, side, fx, fy) => {
  check(`armed ${entry}`, await armTile(entry, query));
  await closeCatalogue();
  const at = await page.evaluate(
    ([s, x, y]) => {
      const box = document
        .querySelector(`.nb-leaf-paper[data-side="${s}"] .nb-free-layer`)
        .getBoundingClientRect();
      return { x: box.left + box.width * x, y: box.top + box.height * y };
    },
    [side, fx, fy],
  );
  await page.mouse.click(at.x, at.y);
  await wait(1100);
};

/** Turn spreads with the arrow key, which is how a reader turns them. */
const turn = async (direction) => {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.locator('.nb-rail').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press(direction === 'next' ? 'ArrowRight' : 'ArrowLeft');
  await wait(1500);
};

/* ========================================================================== *
 *                                  the run                                   *
 * ========================================================================== */

console.log('\n1. open the book and see what page 1 and page 2 start with');
console.log('  opened:', await openBook(true));
const before = await heads();
console.log('  page 1 head:', JSON.stringify(before.left.head), `(${before.left.blocks} blocks)`);
console.log('  page 2 head:', JSON.stringify(before.right.head), `(${before.right.blocks} blocks)`);
check('page 2 has content of its own to lose', before.right.blocks > 0 && before.right.head !== '(blank)');

console.log('\n2. put two marks on page 1 and one on page 2');
await useFreeMode();
await place('fx-tape-gaffer', 'gaffer', 'left', 0.62, 0.8);
await place('fx-doodle-star', 'star', 'left', 0.28, 0.45);
await place('fx-tape-wax', 'a wax seal', 'right', 0.55, 0.72);
const placed = (await spreadMarks()).map(key).sort();
console.log('  placed:', placed.join(' | '));
check('three marks, on the leaves they were clicked on', placed.length === 3);
check(
  'two on page 1, one on page 2',
  placed.filter((k) => k.startsWith('left:')).length === 2 &&
    placed.filter((k) => k.startsWith('right:')).length === 1,
);
await shot('refute-freepag-01-placed');

console.log('\n3. flood page 1 so the carry cascades through page 2');
// Click the END of the LAST block, not the middle of the title. Clicking the
// h1 and trusting Control+End put the caret inside "Alcove", and the first
// Enter of the flood split the title in half — which left this probe asserting
// "page 1 still starts where it did" against a head that read "Welcome to
// Alcov". The mark stayed put either way, but a proof nobody can read is not
// one.
const tail = await page.evaluate(() => {
  const blocks = document.querySelectorAll('.nb-leaf-paper[data-side="left"] .nb-prose > *');
  const last = blocks[blocks.length - 1].getBoundingClientRect();
  return { x: last.right - 6, y: last.bottom - 8 };
});
await page.mouse.click(tail.x, tail.y);
await wait(400);
await page.keyboard.press('Control+End');
for (let i = 0; i < 18; i += 1) {
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(
    `${String(i)} — the quick brown fox jumps over the lazy dog, again and again. `.repeat(4),
  );
  await wait(200);
}
await wait(2500);
await shot('refute-freepag-02-flooded');

console.log('\n4. come back to spread 1 and look');
for (let i = 0; i < 8; i += 1) {
  const h = await heads();
  if (h.left.head.startsWith('Welcome to Alcove')) break;
  await turn('prev');
}
const afterFlood = await heads();
console.log('  page 1 head:', JSON.stringify(afterFlood.left.head));
console.log('  page 2 head:', JSON.stringify(afterFlood.right.head));
check(
  'page 1 still starts with the very block the marks are anchored in',
  afterFlood.left.head.startsWith('Welcome to Alcove'),
  `was ${JSON.stringify(before.left.head)}, now ${JSON.stringify(afterFlood.left.head)}`,
);
// THE point of this file. If page 2 still starts with its own old first block
// then no PREPEND ever pushed that anchor into the tail, `splitFreeMarks` never
// had anything to rescue, and mechanism 2 is unproven whatever the marks say.
check(
  'page 2 was prepended into and its ORIGINAL first block has left the page — ' +
    'so the mark on it could only survive by being rescued',
  !afterFlood.right.head.startsWith(before.right.head.slice(0, 12)),
  `was ${JSON.stringify(before.right.head)}, now ${JSON.stringify(afterFlood.right.head)}`,
);
const survived = (await spreadMarks()).map(key).sort();
console.log('  marks now:  ', survived.join(' | '));
check(
  'every mark is on the same leaf, at the same place and size, after the carry',
  JSON.stringify(survived) === JSON.stringify(placed),
);
check(
  'and still in the free layer rather than in the text',
  (await spreadMarks()).every((m) => m.inLayer && !m.inProse),
);
await shot('refute-freepag-03-back-on-spread-1');

console.log('\n5. walk the whole flooded book — nothing was copied onto a later page');
let seen = survived.length;
const trail = [`spread1=${survived.length}`];
for (let i = 0; i < 7; i += 1) {
  await turn('next');
  const here = await spreadMarks();
  const h = await heads();
  trail.push(`spread${i + 2}=${here.length}`);
  seen += here.length;
  if (h.left.head === '(blank)' && h.right.head === '(blank)') break;
}
console.log('  marks per spread:', trail.join(' '));
check(
  'three marks in the book, not three plus a copy per page break',
  seen === 3,
  `counted ${String(seen)}`,
);

console.log('\n6. reload the whole browser and look again');
await wait(2500);
console.log('  reopened:', await openBook(false));
const round = (await spreadMarks()).map(key).sort();
console.log('  after reload:', round.join(' | '));
check(
  'same leaf, same x/y/w/h, through a page break AND a reload',
  JSON.stringify(round) === JSON.stringify(placed),
);
const reloadHeads = await heads();
console.log('  page 1 head:', JSON.stringify(reloadHeads.left.head));
console.log('  page 2 head:', JSON.stringify(reloadHeads.right.head));
check(
  'the rescued mark is on a page whose own first block is one the CARRY put there',
  !reloadHeads.right.head.startsWith(before.right.head.slice(0, 12)),
);
await shot('refute-freepag-04-after-reload');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
