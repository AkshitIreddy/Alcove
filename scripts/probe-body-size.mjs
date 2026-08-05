/**
 * scripts/probe-body-size.mjs — does "body size" reach the PAGE?
 *
 * Settings → Appearance → "body size", hint *reading type on every page*, a
 * slider from 15 to 21. It moved `--text-body`, which sizes the shell — the
 * search sheet, the transfer panel, the tour — while `.nb-prose` carried a
 * hardcoded `font-size: 20px`. So the one surface the row's own hint names was
 * the one surface the slider could not reach, and nothing said so: the number
 * beside the slider changed, the sheet's own type changed underneath it, and a
 * reader looking at the page they had just resized saw it exactly as it was.
 *
 * That is a seam a unit test cannot see. `apply.ts` writing a custom property
 * is provable in node; a stylesheet three files away preferring a literal over
 * that property is not. So this probe never asserts on what was written — it
 * drives the REAL settings slider by clicking and typing into it, and then
 * reads the resolved `getComputedStyle` off the live prose surface.
 *
 * Four numbers at three sizes, because the type size is not the only thing that
 * has to move:
 *
 *   font       the computed font-size of `.nb-prose` — the fix itself
 *   pitch      the resolved line pitch, read twice: off the prose's leading and
 *              off a box given the ruling's own pitch. A leaf is RULED PAPER.
 *              Shrink the type and leave the rules where they are and the
 *              writing floats off the lines it is printed on — and, worse for
 *              the reason the row exists, the page holds exactly as many lines
 *              as before, so making the type smaller fits not one extra word.
 *   pages      how many leaves the book has grown
 *   blocks     how many top-level blocks stand on the first leaf, how many of
 *              them FIT inside its capacity, and how many single lines a leaf
 *              written full actually holds
 *
 * plus two measurements that are the point rather than the evidence:
 *
 *   drift      how far the top of each paragraph lands from a multiple of the
 *              pitch, in layout px. This is "the words sit on the rules",
 *              measured. A grid the type has walked off shows up here as a
 *              number that grows with every block down the page.
 *   floor      the smallest handwritten type anywhere on the leaf. CLAUDE.md's
 *              one absolute typographic rule is that a handwriting face is
 *              never drawn below 13px, and a size slider is exactly the kind of
 *              change that breaks it somewhere nobody looked.
 *
 * The first leaf is put on RULED paper before anything is read (the Welcome
 * book opens on blank), and section 5 grows the type under a page that is
 * already full, because a fold that does not move turns a legibility setting
 * into silent clipping. The tail of this file records what that measured.
 *
 * Everything is driven by CLICKING. No store is imported: a probe's own
 * `import('/src/data/…')` can resolve to a SECOND copy of a module on a dev
 * server that has served HMR updates, and writes to that copy reach nothing.
 *
 * Against the ALREADY RUNNING dev server on :1420 (never starts one).
 * ?fx=force + state polling, because SwiftShader throttles rAF.
 *
 * Usage: node scripts/probe-body-size.mjs
 *        PROBE_URL=http://localhost:1420 node scripts/probe-body-size.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const OUT_DIR = fileURLToPath(new URL('../qa/body-size/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

/** The slider's own bounds, and the shipped position between them. */
const SIZES = [18, 15, 21];
/** The handwriting floor. Not negotiable — see CLAUDE.md. */
const HAND_FLOOR = 13;
/** Faces that are unreadable below the floor, as computed font-family reads. */
const HANDS = ['caveat', 'patrick hand', 'kalam', 'architects daughter'];

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// A fresh profile auto-starts the guided tour, whose overlay eats the pointer
// stream this probe depends on. Pre-marked as completed in storage AND stopped
// on arrival, the same belt-and-braces as probe-rulings: the storage write is
// what stops it appearing, the stop() is what saves the run when it does.
await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const blob = raw === null ? {} : JSON.parse(raw);
      const rows = Array.isArray(blob.settings) ? blob.settings : [];
      const at = rows.findIndex((r) => r?.key === tutorialKey);
      const row = { key: tutorialKey, value: '1' };
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      blob.settings = rows;
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {
      // Storage refused; the stop() below is the backstop.
    }
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

const t0 = Date.now();
console.log('== probe-body-size ==');
await page.goto(`${URL_BASE}/?fx=force&dev=1`, {
  waitUntil: 'domcontentloaded',
  timeout: 180000,
});
await page.evaluate(() => window.__nbTutorial?.stop?.());

/* --------------------------- open the welcome book ------------------------
 * A brand-new profile seeds exactly one book, and it is the Welcome one. The
 * dev switcher rather than a spine: pulling a book out of the shelf lands on
 * the CLOSED cover and the gesture that opens it is a GSAP flight on a rAF
 * clock SwiftShader throttles. This probe is about the paper, and the type
 * still has to travel settings -> <html> -> stylesheet -> prose either way.
 */
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
const opened = await page
  .waitForSelector('.nb-prose', { timeout: 180000 })
  .then(() => true)
  .catch(() => false);
check(opened, 'a book opened onto a page');
await page.waitForTimeout(3500);

const bookTitle = await page
  .locator('.nb-leaf-paper .nb-prose h1')
  .first()
  .textContent()
  .catch(() => '');
console.log(`  the book opens on: "${(bookTitle ?? '').trim()}"`);

/*
 * Put the first leaf on RULED paper before anything is measured.
 *
 * The Welcome book's opening page ships blank, and blank paper cannot show
 * whether the writing sits on its lines — which is half of what a type-size
 * change has to get right. So the probe chooses the house ruling through the
 * page-style panel, by clicking, exactly as a reader would: the pitch it prints
 * at is the same derived property the prose's leading reads, and a screenshot
 * of blank paper would have proved neither of them.
 *
 * Done BEFORE the thumbnails strip and before the first reading: the panel is a
 * sheet that pushes the spread, and a push is a re-measure.
 */
await page.locator('.nb-leaf-paper[data-side="left"] .nb-prose').first().click();
await page.waitForTimeout(400);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);
await page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'Ruled lines' }) })
  .first()
  .click();
await page.waitForTimeout(600);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForTimeout(1200);
const ruled = await page.evaluate(
  () =>
    document
      .querySelector('.nb-leaf-paper[data-side="left"] .nb-page')
      ?.getAttribute('data-style') ?? '',
);
check(ruled === 'ruled', 'the first leaf is on ruled paper', `data-style=${ruled}`);

/*
 * The thumbnails strip, turned on ONCE and left on.
 *
 * It is how the page count is read (one `.nb-thumb` per leaf), and it is
 * switched on before the first measurement rather than toggled around each one
 * on purpose: the strip takes height off the spread, which resizes the leaf,
 * which re-measures the page capacity and can drain a full page onto the next.
 * Toggling it between readings would have put a capacity change inside the
 * experiment and then credited it to the type size.
 */
await page.locator('button[data-tool="thumbs"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-thumb-strip', { timeout: 60000 });
await page.waitForTimeout(2500);

/* ------------------------------- the reading ------------------------------ */

/**
 * Everything the first leaf can be asked about, in ONE evaluate.
 *
 * Block bottoms come off `getBoundingClientRect` — DRAWN px, which a scaled
 * spread scales — while `--page-line-height` and the leaf's own client box are
 * LAYOUT px. The two are divided back into agreement here rather than left to
 * be compared later, which is the mistake BookView's `measureCapacity` carries
 * a paragraph about.
 */
const readLeaf = (side = 'left') =>
  page.evaluate(
    ([floor, hands, which]) => {
      const paper = document.querySelector(`.nb-leaf-paper[data-side="${which}"]`);
      const pageEl = paper?.querySelector('.nb-page');
      const prose = paper?.querySelector('.nb-prose');
      if (!paper || !pageEl || !prose) return { missing: true };

      const cs = getComputedStyle(prose);
      const rect = prose.getBoundingClientRect();
      // How much bigger the glass is than the layout. 1 whenever nothing is
      // scaling, which is most of the time.
      const drawn = rect.height / (prose.clientHeight || rect.height || 1);
      const scale = Number.isFinite(drawn) && drawn > 0 ? drawn : 1;
      const padBottom = (Number.parseFloat(cs.paddingBottom) || 0) * scale;
      const padTop = (Number.parseFloat(cs.paddingTop) || 0) * scale;

      /*
       * The capacity, in BookView's own terms — the leaf's laid-out box less
       * its padding, multiplied by however much the leaf is being drawn at, and
       * then less the prose's surviving bottom padding, which is what
       * `extractOverflow` compares block bottoms against.
       *
       * Not the prose root's own height, which is what a first draft of this
       * probe used: the spread STRETCHES the root to fill the leaf, so it is
       * always taller than the room a page really has, and a page sitting
       * exactly at its fold measured 56% full against it. A fill reading that
       * does not agree with the contract it is describing is worse than no
       * fill reading, because it looks like an answer.
       */
      const leafCs = getComputedStyle(paper);
      const leafBox =
        paper.clientHeight -
        (Number.parseFloat(leafCs.paddingTop) || 0) -
        (Number.parseFloat(leafCs.paddingBottom) || 0);
      const leafScale =
        paper.getBoundingClientRect().height / (paper.clientHeight || 1);
      const capacity =
        leafBox * (Number.isFinite(leafScale) && leafScale > 0 ? leafScale : 1) -
        padBottom;

      /*
       * The two pitches, and they are read two different ways ON PURPOSE.
       *
       * A custom property is not a length until something uses it as one:
       * `getPropertyValue('--page-line-height')` inside the editor comes back
       * as the literal string `calc(32px * 1)`, which parses to NaN and reads
       * as "no grid at all". So:
       *
       *   words — the resolved `line-height` of the prose. This is what the
       *           writing actually advances by, in px, after every calc().
       *   rules — measured, by giving a throwaway box the ruling's own pitch
       *           and asking the layout engine how tall it came out. This is
       *           the number the twenty-seven patterns in rulings.css are
       *           drawn at.
       *
       * They have to be the same number. Two pitches is the failure this whole
       * change is about: the paper printed on one grid and the words written on
       * another, which is what "the writing floats off its lines" looks like
       * from the inside.
       */
      const measure = document.createElement('div');
      measure.style.cssText =
        'position:absolute;left:-9999px;top:0;width:1px;visibility:hidden;' +
        'height:var(--page-rule-pitch);';
      pageEl.appendChild(measure);
      const rules = measure.getBoundingClientRect().height / scale;
      measure.remove();
      const pitch = Number.parseFloat(cs.lineHeight);
      const stored = Number.parseFloat(
        getComputedStyle(pageEl).getPropertyValue('--page-line-height'),
      );

      const kids = [...prose.children];
      const inked = (el) =>
        (el.textContent ?? '').trim() !== '' ||
        el.querySelector('img, svg, canvas, hr, table') !== null;

      // Where the rules are printed from: `background-origin: content-box`, so
      // the grid starts at the top of the content box and every rule lands at a
      // multiple of the pitch below it.
      const contentTop = rect.top + padTop;
      let drift = 0;
      let driftAt = '';
      for (const el of kids) {
        if (el.tagName !== 'P' || !inked(el)) continue;
        const offset = (el.getBoundingClientRect().top - contentTop) / scale;
        const off = ((offset % rules) + rules) % rules;
        const away = Math.min(off, rules - off);
        if (away > drift) {
          drift = away;
          driftAt = (el.textContent ?? '').trim().slice(0, 24);
        }
      }

      let last = 0;
      let fits = 0;
      for (const el of kids) {
        const bottom = el.getBoundingClientRect().bottom - rect.top;
        if (inked(el)) last = bottom;
        if (bottom <= capacity) fits += 1;
      }

      // The floor, over every element on the leaf that actually draws text of
      // its own — not just the prose, because a resize reaches the whole leaf.
      let smallest = { px: Infinity, face: '', text: '' };
      for (const el of paper.querySelectorAll('*')) {
        const own = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '',
        );
        if (!own) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.display === 'none') continue;
        const family = s.fontFamily.toLowerCase();
        if (!hands.some((h) => family.includes(h))) continue;
        const px = Number.parseFloat(s.fontSize);
        if (px < smallest.px) {
          smallest = {
            px,
            face: s.fontFamily.split(',')[0].replace(/"/g, ''),
            text: (el.textContent ?? '').trim().slice(0, 28),
          };
        }
      }

      return {
        missing: false,
        font: Number.parseFloat(cs.fontSize),
        family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
        pitch,
        rules,
        stored,
        leading: pitch / Number.parseFloat(cs.fontSize),
        // The leaf's own laid-out box. It is what BookView quotes the page
        // capacity from, and it is recorded because the interesting question
        // about the fold is whether the type size moved it or whether
        // something else did — see the note this probe prints at the end.
        leafBox: Math.round(leafBox),
        pages: document.querySelectorAll('.nb-thumb').length,
        blocks: kids.length,
        inked: kids.filter(inked).length,
        fits,
        // How many writing lines the leaf holds at this pitch — the geometric
        // half of "does more fit", and the half that cannot be perturbed by
        // where a caret happened to be.
        lines: Math.floor(capacity / (pitch * scale)),
        fill: capacity > 0 ? last / capacity : 0,
        overflowing: capacity > 0 && last > capacity,
        drift,
        driftAt,
        floor: smallest.px === Infinity ? null : smallest,
        underFloor: smallest.px !== Infinity && smallest.px < floor,
      };
    },
    [HAND_FLOOR, HANDS, side],
  );

/**
 * Read until two readings agree.
 *
 * A leaf is not its final shape the moment anything changes: the overflow drain
 * MOVES blocks between pages and node views lay themselves out a frame late, so
 * a page measured in between reports a fill it will not have a second later.
 * Same loop, and same reason, as probe-welcome.
 */
const readSettled = async (side = 'left') => {
  let last = await readLeaf(side);
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(700);
    const next = await readLeaf(side);
    if (
      !next.missing &&
      !last.missing &&
      next.font === last.font &&
      next.blocks === last.blocks &&
      Math.abs(next.fill - last.fill) < 0.005
    ) {
      return next;
    }
    last = next;
  }
  return last;
};

/* --------------------------- drive the real slider ------------------------ */

const setBodySize = async (px) => {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.waitForSelector('.nbs-sheet[role="dialog"]', { timeout: 60000 });
  await page.waitForTimeout(700);
  const slider = page.locator('.nbs-slider[aria-label="body font size"]').first();
  await slider.scrollIntoViewIfNeeded();
  await slider.fill(String(px));
  await slider.dispatchEvent('input');
  await page.waitForTimeout(500);
  // What the row itself says it is now, read back off the sheet — the reader's
  // side of the same question the page is about to be asked.
  const shown = (
    (await page
      .locator('.nbs-row', { hasText: /^body size/ })
      .locator('.nbs-slider-value')
      .first()
      .textContent()
      .catch(() => '')) ?? ''
  ).trim();
  await page.locator('.nbs-close').first().click();
  // `hidden`, not `detached`: the sheet stays in the tree and fades — its
  // layer is always mounted so the reader can be given it back without a
  // remount, which is exactly what a `detached` wait sat through for a minute.
  await page.waitForSelector('.nbs-sheet[role="dialog"]', {
    state: 'hidden',
    timeout: 60000,
  });
  await page.waitForTimeout(900);
  return shown;
};

console.log('\n1. the slider, at both ends and where it ships');
const seen = new Map();
for (const px of SIZES) {
  const shown = await setBodySize(px);
  const leaf = await readSettled();
  if (leaf.missing) {
    check(false, `${px}px — the leaf could not be read`);
    continue;
  }
  seen.set(px, leaf);
  console.log(
    `\n  slider ${px}px (row says "${shown}")\n` +
      `    font    ${leaf.font}px ${leaf.family}\n` +
      `    pitch   ${leaf.pitch}px words / ${leaf.rules.toFixed(2)}px rules` +
      `   (stored on the page: ${leaf.stored}px, leading ${leaf.leading.toFixed(3)})\n` +
      `    pages   ${leaf.pages}\n` +
      `    blocks  ${leaf.blocks} on the first leaf (${leaf.inked} inked),` +
      ` ${leaf.fits} of them inside capacity, fill ${(leaf.fill * 100).toFixed(0)}%` +
      `${leaf.overflowing ? ' — OVERFLOWING' : ''}\n` +
      `    lines   the leaf holds ${leaf.lines} writing lines at this pitch` +
      ` (its box is ${leaf.leafBox}px either way)\n` +
      `    drift   ${leaf.drift.toFixed(2)}px off the rule grid` +
      (leaf.driftAt ? ` (worst: "${leaf.driftAt}")` : '') +
      `\n    floor   ${leaf.floor === null ? 'no handwritten text found' : `${leaf.floor.px}px ${leaf.floor.face} — "${leaf.floor.text}"`}`,
  );

  if (px !== 18) {
    const shot = `body-size-${px}px.png`;
    await page
      .locator('.nb-leaf-paper[data-side="left"]')
      .screenshot({ path: `${OUT_DIR}${shot}`, animations: 'disabled' })
      .catch(async () => {
        await page.screenshot({ path: `${OUT_DIR}${shot}` });
      });
    console.log(`    [shot] qa/body-size/${shot}`);
  }
}

/* -------------------------------- the asks -------------------------------- */

const small = seen.get(15);
const rest = seen.get(18);
const big = seen.get(21);

console.log('\n2. the slider moves the page');
check(
  small !== undefined && big !== undefined && small.font !== big.font,
  'the reading type actually changed',
  small && big ? `${small.font}px at 15 vs ${big.font}px at 21` : 'missing a reading',
);
check(
  rest !== undefined && rest.font === 20,
  'and the shipped position still draws the 20px page this app has always drawn',
  rest ? `${rest.font}px` : 'missing',
);

console.log('\n3. the rules came with it');
check(
  small !== undefined && big !== undefined && small.pitch < big.pitch,
  'the rule grid closes up as the type shrinks',
  small && big ? `${small.pitch}px vs ${big.pitch}px` : 'missing a reading',
);
check(
  [...seen.values()].every((l) => Math.abs(l.pitch - l.rules) < 0.5),
  'the paper is printed on the same grid the words are written on',
  [...seen.entries()]
    .map(([px, l]) => `${px}:${l.pitch}/${l.rules.toFixed(2)}`)
    .join(' '),
);
check(
  [...seen.values()].every(
    (l) => Math.abs(l.leading - (rest?.leading ?? l.leading)) < 0.01,
  ),
  'the leading is the same ratio at every size',
  [...seen.entries()].map(([px, l]) => `${px}:${l.leading.toFixed(3)}`).join(' '),
);
check(
  [...seen.values()].every((l) => l.drift < 1),
  'and the words still land on the rules, not between them',
  [...seen.entries()].map(([px, l]) => `${px}:${l.drift.toFixed(2)}px`).join(' '),
);

/* ------------------------- and now actually fill it ------------------------
 *
 * Counting the blocks already standing on the first leaf cannot answer "does
 * more fit": the SUPPLY is fixed. The Welcome page has four blocks on it, they
 * fit at 21px, and they still fit at 15px with a third of the leaf spare —
 * nothing in the pagination contract pulls a carried block BACK, so shrinking
 * the type never brings the next page's opening line home. The reading that
 * does move is the fill: 92% of the leaf at 21px against 56% at 15px.
 *
 * So the page is FILLED, at each size, by typing into it until the drain starts
 * carrying lines onward — which is the reader's own experience of the setting,
 * and the only measurement of "how much fits" that is not a proxy. Safe to do:
 * the dev server keeps its library in localStorage, and this is a throwaway
 * browser profile that dies with the probe.
 *
 * ON A PAGE MADE FOR IT, not on the Welcome page, and both of those words were
 * bought the hard way:
 *
 *  - the Welcome page ends in a BULLET LIST, and every Enter inside a list makes
 *    another list ITEM. Twenty-four lines of writing later the leaf still held
 *    one top-level node, and the probe reported "2 blocks" for a page anybody
 *    could see was full. A block is not a line.
 *  - the drain carries the CARET with the text it peels
 *    (`accumulateCarriedCaret`), so a reader typing past the fold is moved onto
 *    the next page and goes on writing there. The leaf that ends at capacity is
 *    the one the typing started on; the one after it is wherever the reader got
 *    to. Both have to be the same leaf for the count to mean anything, which a
 *    page nobody has written on yet guarantees.
 */
const fillFreshPage = async (lines, tag) => {
  await page.locator('button[data-tool="add-page"]').first().dispatchEvent('click');
  await page.waitForTimeout(2500);
  // Which leaf the new page landed on is a parity question (slots fill left,
  // then right), so it is asked rather than assumed: the empty one is the one.
  const side = await page.evaluate(() => {
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const text = (leaf.querySelector('.nb-prose')?.textContent ?? '').trim();
      if (text === '') return leaf.getAttribute('data-side');
    }
    return null;
  });
  if (side === null) return { missing: true, side: null };
  const prose = page.locator(`.nb-leaf-paper[data-side="${side}"] .nb-prose`).first();
  await prose.click({ timeout: 60000 });
  for (let i = 0; i < lines; i += 1) {
    await page.keyboard.type('filling the page');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(1200);
  const leaf = await readSettled(side);
  await page
    .locator('.nb-spread')
    .screenshot({ path: `${OUT_DIR}fill-${tag}.png`, animations: 'disabled' })
    .catch(() => {});
  return { ...leaf, side };
};

console.log('\n4. more fits at the small end than at the large one');
check(
  small !== undefined && big !== undefined && small.lines > big.lines,
  'the leaf holds more writing lines at 15px than at 21px',
  small && big ? `${small.lines} lines vs ${big.lines}` : 'missing a reading',
);
const filled = new Map();
const report = (px, leaf) => {
  filled.set(px, leaf);
  console.log(
    `  ${px}px: a fresh page written full holds ${leaf.inked} lines of writing,` +
      ` fill ${(leaf.fill * 100).toFixed(0)}%${leaf.overflowing ? ' (over)' : ''},` +
      ` ${leaf.pages} pages in the book`,
  );
};

await setBodySize(15);
report(15, await fillFreshPage(30, '15px'));

/*
 * And now the question the fold has to answer: a page filled to its LAST LINE
 * at 15px, and then the type made bigger without another keystroke.
 *
 * Leaves never scroll. If the fold does not move with the type, the lines that
 * no longer fit are not carried onward — they are CLIPPED, and the reader who
 * just made the writing more legible watches the end of the page disappear.
 * Read here rather than reasoned about, because the answer decides whether the
 * pagination half of this is finished or still owed.
 */
console.log('\n5. and the fold moves when the type does');
const grown = filled.get(15);
await setBodySize(21);
const afterGrowing =
  grown?.side === undefined || grown.side === null
    ? { missing: true }
    : await readSettled(grown.side);
await page
  .locator('.nb-spread')
  .screenshot({ path: `${OUT_DIR}grown-15-to-21.png`, animations: 'disabled' })
  .catch(() => {});
console.log(
  `  the page that held ${grown?.inked} lines at 15px now holds` +
    ` ${afterGrowing.inked} at 21px, fill ${(afterGrowing.fill * 100).toFixed(0)}%` +
    `  [shot] qa/body-size/grown-15-to-21.png`,
);
check(
  !afterGrowing.missing && !afterGrowing.overflowing,
  'a page that was full at 15px is not left hanging off the paper at 21px',
  afterGrowing.overflowing
    ? 'it overflows — the drain has not re-run (see the note at the end)'
    : 'it re-drained on its own',
);

report(21, await fillFreshPage(30, '21px'));
check(
  filled.get(15) !== undefined &&
    filled.get(21) !== undefined &&
    filled.get(15).inked > filled.get(21).inked,
  'more blocks fit on a leaf written full at 15px than at 21px',
  `${filled.get(15)?.inked} vs ${filled.get(21)?.inked}`,
);

console.log('\n6. the handwriting floor');
for (const [px, leaf] of seen) {
  check(
    !leaf.underFloor,
    `nothing handwritten below ${HAND_FLOOR}px at slider ${px}px`,
    leaf.floor === null ? 'no handwritten text' : `smallest ${leaf.floor.px}px (${leaf.floor.face})`,
  );
}

/* --------------------- the other ruling families follow -------------------- */

/*
 * All twenty-seven patterns are written in `var(--rule)` and that is one line
 * to change, but the horizontal rules are the only family where a wrong pitch
 * is obvious. The lattices and the dot fields take the pitch on BOTH axes and
 * halve or double it (`Grid squares` is "even squares, half a line apart"), so
 * they are the ones where an arithmetic slip would survive a glance at a ruled
 * page. Two of them are switched to and photographed at both ends of the range.
 */
console.log('\n7. the grids and the dots move with it too');
const pickRuling = async (label) => {
  await page.locator('.nb-leaf-paper[data-side="left"] .nb-prose').first().click();
  await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
  await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(600);
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) });
  if ((await card.count()) === 0) {
    await page.locator('.nb-pagestyle-more').click();
    await page.waitForTimeout(500);
  }
  await card.first().scrollIntoViewIfNeeded();
  await card.first().click();
  await page.waitForTimeout(500);
  await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
  await page.waitForTimeout(1000);
};
/** The pattern as the browser resolved it — sizes and positions, not tokens. */
const painted = () =>
  page.evaluate(() => {
    const prose = document.querySelector(
      '.nb-leaf-paper[data-side="left"] .nb-page-editor .ProseMirror',
    );
    if (prose === null) return null;
    const cs = getComputedStyle(prose);
    return `${cs.backgroundSize} | ${cs.backgroundImage.slice(0, 160)}`;
  });

for (const [label, slug] of [
  ['Grid squares', 'grid'],
  ['Dot grid', 'dotted'],
]) {
  await pickRuling(label);
  const shots = {};
  for (const px of [15, 21]) {
    await setBodySize(px);
    shots[px] = await painted();
    await page
      .locator('.nb-leaf-paper[data-side="left"]')
      .screenshot({
        path: `${OUT_DIR}${slug}-${px}px.png`,
        animations: 'disabled',
      })
      .catch(() => {});
  }
  check(
    shots[15] !== null && shots[21] !== null && shots[15] !== shots[21],
    `"${label}" is re-drawn at the new pitch`,
    `qa/body-size/${slug}-15px.png vs ${slug}-21px.png`,
  );
}

/* ------------------------- leave the sheet as found ----------------------- */

await setBodySize(18);
console.log('\n  (slider put back to the shipped 18px)');

/*
 * WHAT SECTION 5 ACTUALLY PROVES, and what it does not.
 *
 * The fold does move: a page written to its last line at 15px comes back as
 * sixteen lines at 21px with the remainder carried onward, reproducibly. But
 * nothing in the pagination contract DEPENDS on the reading type. The capacity
 * is the leaf's own box, in drawn pixels, and the type size does not touch it —
 * `remeasureCapacityWhenSettled` would hand `setPageCapacity` the identical
 * number and a signal set to what it already holds notifies nobody.
 *
 * What re-runs the drain is a two-pixel accident, and the probe prints the
 * evidence next to the line count: the leaf's box measures 638px at 15px and
 * 635px at 21px, because `--text-body` still sizes the chrome the spread is
 * laid out beside. That moves the capacity by a hair, the hair notifies, and
 * PageEditor's initial-overflow effect — which reads `capacityPx()` inside
 * `extractOverflow` and is therefore subscribed to it — drains the page.
 *
 * It works, and it is not what anybody would write down. If the shell ever
 * stops reading `--text-body` (which is exactly the separation this change was
 * made to allow), the fold stops moving and the failure is silent clipping.
 * The one line that makes it declared belongs in the initial-overflow effect in
 * src/editor/PageEditor.tsx, which already imports `settings`:
 *
 *     void settings.bodyFontSize;   // the reading type is a page metric
 *
 * left out of this change deliberately — that file was out of scope.
 */
console.log(
  '\n  note: the fold moves because the leaf\'s box moves by ~3px with the' +
    ' chrome type,\n        not because pagination depends on the reading' +
    ' size. See the tail of this file.',
);

console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} FAILED`} — ${Date.now() - t0}ms`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
