/**
 * scripts/probe-rulings.mjs — do the twenty-seven rulings reach the PAPER?
 *
 * The page-style panel offered four rulings for the whole life of this app, and
 * growing that list is the easy half. The half this repo has shipped broken
 * eight times is the seam: an id can be added to `PAGE_STYLES`, named in
 * `editor/rulings.ts`, drawn as a card, pressed, written into the document
 * attribute — and paint nothing, because no rule in `styles/rulings.css` ever
 * matched it. Nothing warns. The card presses. The paper does not change.
 *
 * So this probe never asserts on what was SAVED. For every ruling it presses,
 * it reads back the computed `background-image` of the live prose surface and
 * demands that it (a) is not `none`, and (b) is not the same stack the previous
 * ruling produced. Two rulings that compute to identical pixels are two cards
 * with one behaviour, which is the same defect wearing a different hat.
 *
 * It also checks the panel's own thumbnail against the page it stands for —
 * same gradient functions in the same order — because that thumbnail is the
 * only thing the panel exists to tell you, and it used to be a second,
 * hand-written copy of the pattern in a different stylesheet.
 *
 * Everything is driven by CLICKING. No store is imported: a probe's own
 * `import('/src/data/…')` can resolve to a second copy of a module on a dev
 * server that has served HMR updates, and writes to that copy reach nothing.
 *
 * Against the ALREADY RUNNING dev server on :1420 (never starts one).
 * ?fx=force + state polling, because SwiftShader throttles rAF.
 *
 * Usage: node scripts/probe-rulings.mjs
 *        PROBE_URL=http://localhost:1420 node scripts/probe-rulings.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const OUT_DIR = fileURLToPath(new URL('../qa/rulings/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

/** Six signature rulings head the panel; the rest sit behind the control. */
const SHORTLIST = 6;
const TOTAL = 27;

/**
 * What to press, and deliberately not the head of the list: every one of these
 * is behind the "more" control, which is exactly where an unreachable ruling
 * would hide. One per family, plus the two that are hardest to draw.
 */
const PICKS = [
  'Narrow rule',
  'Isometric',
  'Handwriting guide',
  'Cornell notes',
  'Hex dots',
  'Music staves',
  'Log paper',
  'Storyboard',
];

/** These get a picture, because a number does not show whether it looks right. */
const SHOOT = new Set(['Isometric', 'Handwriting guide', 'Cornell notes', 'Music staves']);

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// A fresh profile auto-starts the guided tour, whose overlay eats the pointer
// stream this probe depends on. Pre-marked as completed in storage AND stopped
// on arrival, same belt-and-braces as probe-spread-fit: the storage write is
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
console.log('== probe-rulings ==');
await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());

/* ------------------------------ open a book ------------------------------
 * The dev switcher, not a click on a spine: pulling a book out of the shelf
 * lands on the CLOSED cover, and the extra gesture that opens it is a GSAP
 * animation on a rAF clock SwiftShader throttles. This probe is about the
 * paper, so it takes the shortest honest route to a mounted page — the rulings
 * still have to travel document attribute -> stylesheet exactly as they would.
 */
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
const bookOpen = await page
  .waitForSelector('.nb-prose', { timeout: 180000 })
  .then(() => true)
  .catch(() => false);
check(bookOpen, 'a book opened onto a page');
await page.waitForTimeout(2500);

// Focus a page so "the page you last touched" is a page this probe can read.
await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.waitForTimeout(400);

/* ---------------------------- open the panel ----------------------------- */

await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);

console.log('\n1. the shortlist, and the way through to the rest');
const shortlist = await page.locator('.nb-pagestyle-card').count();
check(shortlist === SHORTLIST, `${SHORTLIST} cards before the control`, `saw ${shortlist}`);
const moreCount = Number(
  (await page.locator('.nb-pagestyle-more .nb-more-count').textContent().catch(() => '0')) ?? 0,
);
check(
  moreCount === TOTAL - SHORTLIST,
  'the control offers the REMAINING count, not the total',
  `"${moreCount} more"`,
);
await page.screenshot({ path: `${OUT_DIR}rulings-01-shortlist.png`, clip: { x: 0, y: 60, width: 460, height: 800 } });

await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);
const expanded = await page.locator('.nb-pagestyle-card').count();
check(expanded === TOTAL, `expanding shows all ${TOTAL}`, `saw ${expanded}`);
const names = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
check(new Set(names).size === expanded, 'every card is a different ruling');
console.log(`  offered: ${names.join(', ')}`);
await page.screenshot({ path: `${OUT_DIR}rulings-02-expanded.png`, clip: { x: 0, y: 60, width: 460, height: 800 } });

/* --------------------- press them, and read the PAPER --------------------- */

/**
 * What the live page is actually painted with, plus the same reading off the
 * card that claims to stand for it. Taken from `getComputedStyle`, so a rule
 * that failed to match reports `none` rather than reporting the id it was
 * given.
 */
const painted = async (label) =>
  page.evaluate((wanted) => {
    const card = [...document.querySelectorAll('.nb-pagestyle-card')].find(
      (c) => c.querySelector('.nb-pagestyle-label')?.textContent?.trim() === wanted,
    );
    const thumb = card?.querySelector('.nb-pagestyle-thumb');
    const id = thumb?.getAttribute('data-style') ?? '';
    const pageEl = [...document.querySelectorAll('.nb-page')].find(
      (p) => p.getAttribute('data-style') === id,
    );
    const prose = pageEl?.querySelector('.nb-page-editor .ProseMirror');
    const layers = (el) =>
      el === null || el === undefined
        ? 'MISSING'
        : getComputedStyle(el).backgroundImage;
    // The gradient functions in order — the fingerprint a thumbnail has to
    // share with the page it stands for, once the pitch is allowed to differ.
    const shape = (css) => (css.match(/(repeating-)?(linear|radial)-gradient/g) ?? []).join('+');
    const pageCss = layers(prose);
    const thumbCss = layers(thumb);
    return {
      id,
      pressed: card?.getAttribute('aria-pressed') === 'true',
      onPage: pageEl !== undefined,
      pageCss,
      thumbCss,
      pageShape: shape(pageCss),
      thumbShape: shape(thumbCss),
    };
  }, label);

console.log('\n2. press one off the middle of the list and read back the paper');
const seen = new Map();
for (const label of PICKS) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(500);
  const got = await painted(label);

  check(got.onPage, `"${label}" reached the page`, `data-style=${got.id}`);
  check(got.pressed, `"${label}" reads as chosen`);
  check(
    got.pageCss !== 'none' && got.pageCss !== 'MISSING',
    `"${label}" actually RULES the paper`,
    got.pageCss === 'none' ? 'background-image: none' : `${got.pageShape || 'flat'}`,
  );
  const twin = [...seen.entries()].find(([, css]) => css === got.pageCss);
  check(
    twin === undefined,
    `"${label}" is not a duplicate of another ruling`,
    twin ? `identical to ${twin[0]}` : '',
  );
  check(
    got.thumbShape === got.pageShape && got.thumbShape !== '',
    `the card's thumbnail draws what the page draws`,
    `${got.thumbShape} vs ${got.pageShape}`,
  );
  seen.set(label, got.pageCss);

  if (SHOOT.has(label)) {
    const file = `rulings-page-${got.id}.png`;
    await page.screenshot({ path: `${OUT_DIR}${file}` });
    console.log(`  [shot] ${file}`);
  }
}

/* ----------------------- and the one that draws nothing ------------------- */

console.log('\n3. blank is a CHOICE, not the absence of a rule');
const blankCard = page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'Blank paper' }) })
  .first();
await blankCard.scrollIntoViewIfNeeded();
await blankCard.click();
await page.waitForTimeout(500);
const blank = await painted('Blank paper');
check(blank.onPage, 'blank reached the page');
check(blank.pageCss === 'none', 'and printed nothing on it', blank.pageCss);

/* ------------------- the line-height slider still re-rules ---------------- */

console.log('\n4. the slider re-rules whatever is chosen (one pattern, one pitch)');
const ruledCard = page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'Narrow rule' }) })
  .first();
await ruledCard.scrollIntoViewIfNeeded();
await ruledCard.click();
await page.waitForTimeout(400);
/** The pitch the page is actually ruled at, off the element itself. */
const pitch = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.nb-page')].find(
      (p) => p.getAttribute('data-style') === 'narrow',
    );
    return el === undefined ? '' : getComputedStyle(el).getPropertyValue('--page-line-height').trim();
  });

const before = (await painted('Narrow rule')).pageCss;
const pitchBefore = await pitch();
const slider = page.locator('.nb-panel-slider').first();
await slider.fill('40');
await slider.dispatchEvent('input');
await page.waitForTimeout(700);
const after = (await painted('Narrow rule')).pageCss;
const pitchAfter = await pitch();
check(pitchAfter === '40px', 'the page is re-ruled at the pitch asked for', `${pitchBefore} -> ${pitchAfter}`);
check(
  before !== after,
  'and the ruling itself was redrawn, not just the leading',
  `${before !== after}`,
);
await page.screenshot({ path: `${OUT_DIR}rulings-03-narrow-40px.png` });

/* --------------- the cap and the reader's hand, in one panel -------------- */

/*
 * The seam this panel grew, and the one worth driving: the list is now BOTH
 * capped and curatable. Take a ruling off a six-card shortlist and something
 * has to slide in from behind the control — a panel that just leaves a gap has
 * quietly shortened a list the reader only pruned.
 */
console.log('\n5. removing one off the shortlist pulls the next one forward');
const labels = async () =>
  page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
    n.map((x) => x.textContent?.trim() ?? ''),
  );
const moreWord = async () =>
  (await page.locator('.nb-pagestyle-more .nb-more-count').textContent().catch(() => '')) ?? '';

// Collapse back to the shortlist — the capped state is the one under test.
await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(500);
const head = await labels();
check(head.length === SHORTLIST, 'back to the shortlist', `${head.length} cards`);

const victim = await page.evaluate(
  () =>
    [...document.querySelectorAll('.nb-pagestyle-card')]
      .find((c) => c.getAttribute('aria-pressed') !== 'true')
      ?.querySelector('.nb-pagestyle-label')?.textContent?.trim() ?? '',
);
await page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: victim }) })
  .first()
  .click({ button: 'right' });
await page.waitForSelector('.nb-cur-menu', { timeout: 20000 });
await page.locator('.nb-cur-menu-item', { hasText: 'remove from the list' }).first().click();
await page.waitForTimeout(700);
const afterRemoval = await labels();
check(!afterRemoval.includes(victim), `"${victim}" left the grid`);
check(
  afterRemoval.length === SHORTLIST,
  'and the shortlist is still full — one came forward',
  `${afterRemoval.length} cards, "${(await moreWord()).trim()} more" behind`,
);

await page.locator('.nb-pagestyle-grid').click({ button: 'right', position: { x: 5, y: 5 } });
await page.waitForSelector('.nb-cur-menu', { timeout: 20000 });
await page.locator('.nb-cur-menu-item', { hasText: 'removed (1)' }).first().click();
await page.waitForSelector('.nb-cur-drawer', { timeout: 20000 });
await page.locator('.nb-cur-drawer input[type="checkbox"]').first().check();
await page.locator('.nb-cur-drawer button.nb-cur-btn.is-primary').click();
await page.waitForTimeout(700);
check((await labels()).includes(victim), `and the drawer gave "${victim}" back`);

/* ------------------ and the pencil follows the theme's ink ---------------- */

/*
 * Every ruling is mixed from `--paper-edge`, which each of the four themes
 * re-inks. A pattern that had reached for a literal colour would keep drawing
 * a warm brown pencil across a night-blue page — which is exactly why the
 * unit test forbids a hex in that stylesheet and why this looks at it.
 */
console.log('\n6. the pencil is re-inked by the theme, not left brown');
await page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'College rule' }) })
  .first()
  .click();
await page.waitForTimeout(400);
const dayInk = (await painted('College rule')).pageCss;
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'night'));
await page.waitForTimeout(700);
const nightInk = (await painted('College rule')).pageCss;
check(dayInk !== nightInk, 'night re-inks the ruling', dayInk === nightInk ? 'identical' : 'changed');
await page.screenshot({ path: `${OUT_DIR}rulings-04-night.png` });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'parchment'));

console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} FAILED`} — ${Date.now() - t0}ms`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
