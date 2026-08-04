/**
 * shots-now/_refute-armed-slot.mjs — the half `scripts/probe-free-effects.mjs`
 * never drives: the STICKER end of the generalisation, and the one failure the
 * discriminated union exists to stop.
 *
 * `freePlacement.ts` was widened from stickers to marks — `splitFreeStickers`
 * became `splitFreeMarks`, and the two armed signals became one `ArmedMark`
 * slot. The trim probe proves tape, washi, frames, paper and doodles place; it
 * arms nothing but trim, so three sentences of that claim go untested:
 *
 *   1. arming a strip of tape PUTS DOWN a half-armed sticker, so one click
 *      lands exactly one thing (two signals is how you get two);
 *   2. a free sticker still places — the file that was generalised did not lose
 *      the customer it was written for;
 *   3. the carry rescues BOTH kinds, the sticker (which must say
 *      `placement: 'free'`) and the page mark (free by construction), so
 *      `isFreeMarkJson` is right about both halves rather than one.
 *
 * Every assertion is on the APPLIED DOM of the running app, after a real click
 * on a real control, and the last one after a full browser reload. The book is
 * opened through world.ts's own `__shelfVisibleBooks` / `__shelfPullOut`
 * bridges rather than a probe-side import of the store: on a dev server that
 * has served HMR updates an `import('/src/data/…')` can resolve to a second
 * copy of the module, and writes to that copy never reach the shelf.
 *
 * Usage: node shots-now/_refute-armed-slot.mjs [--url=http://localhost:1420]
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
  let title = null;
  // Retried: a pulled book opens on a SECOND press, and the first one can land
  // while the pull tween is still running.
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

/** The sheet stays in the DOM when it closes, so "open" is a visibility question. */
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

/** Everything in the free layer, both kinds, plus anything that fell inline. */
const freeLayer = async () =>
  page.evaluate(() => ({
    marks: [...document.querySelectorAll('.nb-free-layer .nb-free-mark')].map((el) => ({
      fx: el.getAttribute('data-fx'),
      value: el.getAttribute('data-fx-value'),
      left: el.style.left,
      top: el.style.top,
    })),
    stickers: [...document.querySelectorAll('.nb-free-layer .nb-free-sticker')].map((el) => ({
      id: el.getAttribute('data-sticker'),
      left: el.style.left,
      top: el.style.top,
      inLayer: el.closest('.nb-free-layer') !== null,
      inProse: el.closest('.nb-prose') !== null,
    })),
    // A sticker that landed in the SENTENCE instead — the old behaviour, and
    // what "the armed sticker rode along on somebody else's click" looks like.
    //
    // `[data-placement="inline"]`, not every `[data-sticker]` in the prose: a
    // FREE sticker also leaves a zero-width anchor in the text (that is the
    // whole design — it costs pagination nothing), so counting the loose
    // attribute counted the free one too and read as a sticker in the sentence.
    // This probe's own first wrong answer.
    inlineStickers: document.querySelectorAll(
      '.nb-prose [data-sticker][data-placement="inline"]',
    ).length,
    freeAnchors: document.querySelectorAll('.nb-prose [data-sticker][data-placement="free"]')
      .length,
  }));

/** A patch of the left leaf, as a fraction of the layer the marks resolve against. */
const spotAt = async (fracX, fracY) =>
  page.evaluate(
    ({ fx, fy }) => {
      const box = document
        .querySelector('.nb-leaf-paper[data-side="left"] .nb-free-layer')
        .getBoundingClientRect();
      return { x: box.left + box.width * fx, y: box.top + box.height * fy };
    },
    { fx: fracX, fy: fracY },
  );

const hintText = async () =>
  (await page.locator('.nb-place-hint-text').count()) === 0
    ? null
    : ((await page.locator('.nb-place-hint-text').first().textContent()) ?? '')
        .replace(/\s+/g, ' ')
        .trim();

/* ========================================================================== *
 *                                  the run                                   *
 * ========================================================================== */

console.log('\n1. open a book');
console.log('  opened:', await openBook(true));

console.log('\n2. arm a STICKER "anywhere on the page" — the customer the file was written for');
await openCatalogue();
await page.getByRole('button', { name: 'stickers', exact: true }).click();
await wait(800);
const stickerShelf = '.nb-cat-shelf[data-shelf="stickers"]';
check(
  'the sticker shelf still offers the mode',
  (await page.locator(`${stickerShelf} .nb-cat-mode .nb-chip[data-mode="free"]`).count()) === 1,
);
await page.locator(`${stickerShelf} .nb-cat-mode .nb-chip[data-mode="free"]`).click();
await wait(400);
await page.locator('.nb-cat-search-input').fill('bee');
await wait(600);
await page.locator('.nb-cat-item[data-entry="sticker-bee"]').first().click();
await wait(500);
check(
  'the bee is the armed one',
  (await page.locator('.nb-cat-item[data-entry="sticker-bee"]').getAttribute('aria-pressed')) ===
    'true',
);
console.log('  hint:', await hintText());

console.log('\n3. arm a TAPE without placing the bee — one slot, so the bee has to go down');
await page.locator('.nb-cat-search-input').fill('gaffer');
await wait(600);
await page.locator('.nb-cat-item[data-entry="fx-tape-gaffer"]').first().click();
await wait(500);
const hintAfter = await hintText();
console.log('  hint:', hintAfter);
check('the hint names the tape', (hintAfter ?? '').includes('tape · gaffer'));
check('and there is only ONE hint at all', (await page.locator('.nb-place-hint').count()) === 1);
await page.locator('.nb-cat-search-input').fill('bee');
await wait(600);
check(
  'the bee is no longer lit — arming the tape put it down',
  (await page.locator('.nb-cat-item[data-entry="sticker-bee"]').getAttribute('aria-pressed')) !==
    'true',
);

console.log('\n4. one click on the page lands ONE thing');
await page.locator('.nb-cat-search-input').fill('');
await closeCatalogue();
const before = await freeLayer();
const spot = await spotAt(0.55, 0.78);
await page.mouse.click(spot.x, spot.y);
await wait(1200);
let now = await freeLayer();
console.log('  free layer:', JSON.stringify(now));
check('exactly one mark landed', now.marks.length === before.marks.length + 1);
check('it is the tape', now.marks.at(-1)?.fx === 'tape');
check(
  'and NO sticker landed with it — the half-armed bee did not ride along',
  now.stickers.length === before.stickers.length,
);
check(
  'nor did one drop into the sentence',
  now.inlineStickers === before.inlineStickers,
  `${String(before.inlineStickers)} -> ${String(now.inlineStickers)}`,
);

console.log('\n5. and a free STICKER still places, out of the same one slot');
await openCatalogue();
await page.locator('.nb-cat-search-input').fill('star');
await wait(600);
await page.locator('.nb-cat-item[data-entry="sticker-star"]').first().click();
await wait(400);
await page.locator('.nb-cat-search-input').fill('');
await closeCatalogue();
const spot2 = await spotAt(0.25, 0.86);
await page.mouse.click(spot2.x, spot2.y);
await wait(1200);
now = await freeLayer();
console.log('  free layer:', JSON.stringify(now));
check('a free sticker is in the leaf layer', now.stickers.length === before.stickers.length + 1);
check(
  'in the layer, not in the prose',
  now.stickers.length > 0 && now.stickers.every((s) => s.inLayer && !s.inProse),
);
check(
  'and the tape is still there beside it',
  now.marks.some((m) => m.fx === 'tape'),
);
await page.screenshot({
  path: 'qa/tmp/refute-armed-01-placed.png',
  animations: 'disabled',
  caret: 'hide',
});
console.log('  shot qa/tmp/refute-armed-01-placed.png');

/**
 * What has to survive: the free LAYER.
 *
 * Deliberately not the inline count as well. An inline sticker is part of a
 * sentence and travels with it, so the flood below carries some of the seeded
 * ones onto a later page — which is the contract working, not breaking. The
 * free layer is the half that must not move.
 */
const freeOnly = (state) => JSON.stringify({ marks: state.marks, stickers: state.stickers });
const wanted = freeOnly(await freeLayer());

console.log('\n6. flood the page so the writing carries — splitFreeMarks must keep BOTH kinds');
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
await wait(2500);
const head = await page.evaluate(
  () =>
    document
      .querySelector('.nb-leaf-paper[data-side="left"] .nb-prose')
      ?.textContent?.trim()
      .slice(0, 24) ?? '',
);
check('the writing really did carry onto another leaf', !head.startsWith('Welcome to Alcove'), head);

console.log('\n7. reload the whole browser and look again');
await wait(2500);
console.log('  reopened:', await openBook(false));
const reloaded = await freeLayer();
const round = freeOnly(reloaded);
console.log('  before:', wanted);
console.log('  after: ', round);
check('both kinds came back, on the same page, at the same place', round === wanted);
check(
  'the free sticker is still anchored in the text it costs nothing',
  reloaded.freeAnchors === reloaded.stickers.length,
  `${String(reloaded.freeAnchors)} anchors for ${String(reloaded.stickers.length)} stickers`,
);
console.log(
  `  inline stickers on the spread: ${String(reloaded.inlineStickers)} ` +
    '(they belong to sentences and travel with them — not part of the claim)',
);
await page
  .locator('.nb-leaf-paper[data-side="left"]')
  .first()
  .screenshot({
    path: 'qa/tmp/refute-armed-02-after-reload.png',
    animations: 'disabled',
    caret: 'hide',
  });
console.log('  shot qa/tmp/refute-armed-02-after-reload.png');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
