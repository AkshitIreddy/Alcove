/**
 * tests/e2e/probe-notion-depth.mjs — the selection toolbar, sortable tables
 * and backlinks, driven the way a reader drives them.
 *
 * A PROBE, NOT A SPEC, and deliberately named so neither runner collects it:
 * Playwright's `testMatch` wants `*.spec.ts` and Vitest excludes `tests/e2e/**`.
 * It is run by hand against the dev server that is already up, because that is
 * how the three features were checked in the first place and re-checking them
 * should not mean reading someone else's harness:
 *
 *     node tests/e2e/probe-notion-depth.mjs [--url=http://localhost:1420]
 *
 * Everything it asserts is APPLIED state — the mark in the document, the row
 * order in the table's DOM, the tab drawn on the page — never a command that
 * was merely dispatched. Screenshots land in qa/editor3/ and are meant to be
 * LOOKED AT: three of the bugs this probe found (the link field stealing focus
 * from a detached node, the little book mark breaking its own sentence in
 * three, the reserved rail) were visible before they were assertable.
 *
 * TWO THINGS IT DOES THE HARD WAY, BOTH BECAUSE THE EASY WAY LIES:
 *
 *   - The book is PULLED OFF THE SHELF (`__shelfPullOut`, hence `?fx=force`)
 *     rather than opened with the dev view switcher. The switcher leaves
 *     `appState.openBookId` null and BookView falls back to the first shelved
 *     book; the first page-link jump then sets the id for real, the session
 *     resource re-runs, and the spread remounts at index 0. That looks exactly
 *     like a page link that navigates to the wrong page, and it is not one.
 *   - A new page lands on the right leaf or on the left leaf of the next
 *     spread depending on parity, so `blankPage()` looks for the empty leaf
 *     instead of assuming a side.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'qa/editor3';
mkdirSync(OUT, { recursive: true });

const STUB_STORAGE_KEY = 'notebook.stubdb.v1';
const TUTORIAL_KEY = 'appState:tutorialCompleted';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 1,
});

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

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const shot = async (name, locator) => {
  const path = `${OUT}/${name}.png`;
  if (locator) await locator.screenshot({ path });
  else await page.screenshot({ path });
  console.log(`  shot ${path}`);
};

await page.addInitScript(
  ([storageKey, tutorialKey]) => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const blob = raw === null ? {} : JSON.parse(raw);
      const rows = Array.isArray(blob.settings) ? blob.settings : [];
      const row = { key: tutorialKey, value: '1' };
      const at = rows.findIndex((r) => r?.key === tutorialKey);
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      blob.settings = rows;
      window.localStorage.setItem(storageKey, JSON.stringify(blob));
    } catch {
      /* ignore */
    }
  },
  [STUB_STORAGE_KEY, TUTORIAL_KEY],
);

// `?fx=force` for the world bridges, and the book is PULLED OFF THE SHELF
// rather than opened with the dev view switcher. The switcher leaves
// appState.openBookId null (BookView falls back to the first shelved book),
// and the first jump would then set it for real and remount the spread at
// index 0 — a probe artefact that looks exactly like a broken page link.
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => globalThis.__nbTutorial?.stop?.());
await page.waitForFunction(() => globalThis.__shelfVisibleBooks !== undefined, null, {
  timeout: 120000,
});
await page.waitForFunction(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, {
  timeout: 120000,
});
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks();
  globalThis.__shelfPullOut(books[0].id);
});
await page.waitForSelector('.nb-book-view', { timeout: 60000 });
await page.waitForSelector('.nb-prose', { timeout: 60000 });
await page.waitForTimeout(1800);

/**
 * Add a page and hand back the leaf it landed on. A new page alternates
 * between the right leaf and the left leaf of the next spread, so the side is
 * found by looking for the empty one rather than assumed.
 */
async function blankPage() {
  await page.getByRole('button', { name: 'Add a page' }).click();
  for (let i = 0; i < 100; i += 1) {
    for (const side of ['right', 'left']) {
      const prose = page.locator(`.nb-leaf-paper[data-side="${side}"] .nb-prose`);
      if (!(await prose.isVisible().catch(() => false))) continue;
      const t = (await prose.innerText().catch(() => 'x')).trim();
      if (t.length < 2) {
        await page.waitForTimeout(400);
        return prose;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('no blank leaf appeared after adding a page');
}

// ===========================================================================
// 1 — SELECTION TOOLBAR
// ===========================================================================
console.log('\n1. selection toolbar');

let prose = await blankPage();
await prose.click();
await page.keyboard.type('Photosynthesis turns light into sugar');
await page.waitForTimeout(300);

// Select the last word with the keyboard (deterministic — a dblclick on a
// paragraph's centre lands in the empty run after the text).
const selectLastWord = async (n = 5) => {
  await page.keyboard.press('Control+End');
  await page.keyboard.down('Shift');
  for (let i = 0; i < n; i += 1) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
};
await selectLastWord();

const toolbar = page.locator('.nb-seltool-portal.is-up .nb-seltool');
await toolbar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
check('toolbar appears on a text selection', await toolbar.isVisible().catch(() => false));
await shot('01-toolbar-up');
const tbBox = await toolbar.boundingBox();
if (tbBox) {
  await page.screenshot({
    path: `${OUT}/01b-toolbar-close.png`,
    clip: {
      x: Math.max(0, tbBox.x - 40),
      y: Math.max(0, tbBox.y - 30),
      width: Math.min(1500, tbBox.width + 80),
      height: Math.min(950, tbBox.height + 60),
    },
  });
  console.log(`  shot ${OUT}/01b-toolbar-close.png`);
}

const btnCount = await toolbar.locator('.nb-seltool-btn').count();
check('six mark buttons', btnCount === 6, `found ${btnCount}`);

// Bold it.
await toolbar.locator('[data-action="bold"]').click();
await page.waitForTimeout(500);
const strongText = await prose.locator('strong').first().innerText().catch(() => '');
check('bold reaches the document', strongText.length > 0, `<strong>${strongText}</strong>`);
const boldLit = await toolbar
  .locator('[data-action="bold"]')
  .evaluate((el) => el.classList.contains('is-on'))
  .catch(() => false);
check('the bold button lights up for the marked selection', boldLit);

// Highlight tray.
await toolbar.locator('[data-action="highlight"]').click();
await page.waitForTimeout(500);
const trayUp = await toolbar.locator('.nb-seltool-tray').isVisible().catch(() => false);
check('highlight tray opens', trayUp);
await shot('02-toolbar-washes');
await toolbar.locator('.nb-seltool-wash[data-wash="moss"]').click();
await page.waitForTimeout(500);
const markCount = await prose.locator('mark').count();
check('a wash reaches the document', markCount > 0, `${markCount} <mark>`);
// The colour that was PRESSED is the colour that was painted — a wash button
// wired to the wrong pigment is invisible until someone holds two side by side.
const painted = await prose
  .locator('mark')
  .first()
  .evaluate((el) => ({
    color: el.getAttribute('data-color'),
    fill: getComputedStyle(el).backgroundColor,
    token: getComputedStyle(document.documentElement)
      .getPropertyValue('--wash-moss')
      .trim(),
  }))
  .catch(() => null);
console.log('  painted:', JSON.stringify(painted));
check('the wash pressed is the wash painted', painted?.color === 'moss', String(painted?.color));
await shot('03-highlighted');

// Link tray.
await selectLastWord();
await toolbar.locator('[data-action="link"]').click();
await page.waitForTimeout(600);
const fieldUp = await toolbar.locator('.nb-seltool-field').isVisible().catch(() => false);
check('link tray opens with a field', fieldUp);
await shot('04-toolbar-link');
if (fieldUp) {
  await toolbar.locator('.nb-seltool-field').fill('not a link at all!!');
  await toolbar.locator('.nb-seltool-apply').click();
  await page.waitForTimeout(400);
  const bad = await toolbar.locator('.nb-seltool-note').isVisible().catch(() => false);
  check('a nonsense address is refused, in words', bad);
  await shot('05-toolbar-link-refused');

  await toolbar.locator('.nb-seltool-field').fill('alcove.app/notes');
  await toolbar.locator('.nb-seltool-apply').click();
  await page.waitForTimeout(600);
  const href = await prose.locator('a[href]').first().getAttribute('href').catch(() => null);
  check('a bare host becomes an https link', href === 'https://alcove.app/notes', String(href));
}

// It must go away when the selection collapses.
await prose.locator('p').first().click();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(700);
const upAfter = await page.locator('.nb-seltool-portal.is-up').count();
check('the card leaves when the selection collapses', upAfter === 0, `${upAfter} up`);

// It must NOT appear inside a code block (five of six marks would be a lie).
const codePage = await blankPage();
await codePage.click();
await page.keyboard.type('```');
await page.waitForTimeout(400);
await page.keyboard.type('const x = 1');
await page.waitForTimeout(400);
const codeUp = await codePage.locator('pre').count();
await page.keyboard.press('Shift+Home');
await page.waitForTimeout(900);
const inCode = await page.locator('.nb-seltool-portal.is-up').count();
check(
  'no toolbar inside a code block',
  codeUp > 0 && inCode === 0,
  `${codeUp} <pre>, ${inCode} up`,
);
await shot('06-codeblock-no-toolbar');

// ===========================================================================
// 2 — SORTABLE TABLES
// ===========================================================================
console.log('\n2. sortable tables');

prose = await blankPage();
await prose.click();
await page.keyboard.type('/');
await page.waitForSelector('.nb-slash-menu', { timeout: 20000 });
await page.keyboard.type('table');
await page.waitForTimeout(700);
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
const tableUp = await prose.locator('table').first().isVisible().catch(() => false);
check('a table is inserted', tableUp);

// Fill: header then rows. Tab walks the cells, and Tab out of the last cell
// grows a new row — which is how the third body row arrives.
const cells = [
  'Fruit', 'Count', 'Note',
  'pear', '12', 'a',
  'apple', '3', 'b',
  'quince', '110', 'c',
];
await prose.locator('table th').first().click();
for (let i = 0; i < cells.length; i += 1) {
  await page.keyboard.type(cells[i]);
  if (i < cells.length - 1) await page.keyboard.press('Tab');
  await page.waitForTimeout(90);
}
await page.waitForTimeout(700);
const readRows = async () =>
  prose.locator('table').first().evaluate((t) =>
    [...t.querySelectorAll('tr')].slice(1).map((r) =>
      [...r.querySelectorAll('td,th')].map((c) => c.textContent.trim()).join('|'),
    ),
  );
const written = await readRows();
check('three body rows written', written.length === 3, written.join(' / '));
await shot('07-table-written');

const chips = prose.locator('table .nb-th-sort');
const chipCount = await chips.count();
check('a sort chip on every header cell', chipCount === 3, `${chipCount} chips`);
const chipBox = await chips.first().boundingBox();
if (chipBox) {
  await page.screenshot({
    path: `${OUT}/08-table-chips.png`,
    clip: {
      x: Math.max(0, chipBox.x - 200),
      y: Math.max(0, chipBox.y - 30),
      width: 460,
      height: 200,
    },
  });
  console.log(`  shot ${OUT}/08-table-chips.png`);
}

// Ascending by Fruit.
await chips.nth(0).click();
await page.waitForTimeout(700);
const asc = await readRows();
check(
  'first click sorts A→Z',
  asc.join(',') === 'apple|3|b,pear|12|a,quince|110|c',
  asc.join(' / '),
);
await shot('09-table-asc');

// Descending.
await chips.nth(0).click();
await page.waitForTimeout(700);
const desc = await readRows();
check(
  'second click sorts Z→A',
  desc.join(',') === 'quince|110|c,pear|12|a,apple|3|b',
  desc.join(' / '),
);

// Home.
await chips.nth(0).click();
await page.waitForTimeout(700);
const home = await readRows();
check(
  'third click returns to the written order',
  home.join(',') === written.join(','),
  home.join(' / '),
);

// Numbers sort as numbers, not as strings.
await chips.nth(1).click();
await page.waitForTimeout(700);
const nums = await readRows();
check(
  'a number column sorts numerically (3, 12, 110)',
  nums.join(',') === 'apple|3|b,pear|12|a,quince|110|c',
  nums.join(' / '),
);
await shot('10-table-numeric');

// Undo takes a sort back — the whole reason it goes through a transaction.
await prose.click();
await page.keyboard.press('Control+z');
await page.waitForTimeout(800);
const undone = await readRows();
check('undo takes the sort back', undone.join(',') !== nums.join(','), undone.join(' / '));

// ===========================================================================
// 3 — BACKLINKS
// ===========================================================================
console.log('\n3. backlinks');

// Target page, with a heading it can be named by.
const target = await blankPage();
await target.click();
await page.keyboard.type('# Quince Marmalade');
await page.keyboard.press('Enter');
await page.keyboard.type('two kilos, halved.');
await page.waitForTimeout(1600); // let the 400ms save debounce land

// Source page, linking to it.
const source = await blankPage();
await source.click();
await page.keyboard.type('see ');
await page.keyboard.type('[[');
await page.waitForTimeout(1200);
const picker = page.locator('.nb-pagepick');
const pickerUp = await picker.isVisible().catch(() => false);
check('[[ opens the page picker', pickerUp);
await shot('11-page-picker');
if (pickerUp) {
  // The card opens under a mouse that has not moved. The top row must still be
  // the one Enter would take (menu/hoverIntent.ts).
  const litIndex = await picker
    .locator('.nb-pagepick-item.is-selected')
    .first()
    .getAttribute('data-index')
    .catch(() => null);
  check('a resting mouse does not steal the highlight', litIndex === '0', String(litIndex));

  // …and a real move still moves it.
  const second = picker.locator('.nb-pagepick-item').nth(1);
  const box = await second.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.waitForTimeout(300);
    const hovered = await picker
      .locator('.nb-pagepick-item.is-selected')
      .first()
      .getAttribute('data-index')
      .catch(() => null);
    check('hovering a row still selects it', hovered === '1', String(hovered));
  }

  await page.keyboard.type('Quince');
  await page.waitForTimeout(1200);
  await shot('12-page-picker-filtered');
  const rows = await picker.locator('.nb-pagepick-item').count();
  check('the picker finds the target by name', rows > 0, `${rows} rows`);
  // Click the row by its NAME rather than pressing Enter on whatever index the
  // hover check above left lit — the query has refiltered the list since.
  await picker
    .locator('.nb-pagepick-item', { hasText: 'Quince Marmalade' })
    .first()
    .click();
  await page.waitForTimeout(900);
  const chip = source.locator('.nb-pagelink');
  const chipText = await chip.first().innerText().catch(() => '');
  check('a page chip lands in the sentence', chipText.includes('Quince'), chipText);
  await page.keyboard.type('for the numbers.');
  await page.waitForTimeout(1800);
  await shot('13-pagelink-chip');
  const chipBox2 = await chip.first().boundingBox();
  if (chipBox2) {
    await page.screenshot({
      path: `${OUT}/13b-pagelink-close.png`,
      clip: {
        x: Math.max(0, chipBox2.x - 60),
        y: Math.max(0, chipBox2.y - 40),
        width: 520,
        height: 130,
      },
    });
    console.log(`  shot ${OUT}/13b-pagelink-close.png`);
  }
}

// How the chip actually sits in the sentence (a block element here would
// break the line, which is the failure this close-up is for).
const chipShape = await page
  .locator('.nb-pagelink')
  .first()
  .evaluate((el) => {
    const wrap = el.closest('[data-node-view-wrapper]') ?? el;
    const outer = wrap.parentElement;
    return {
      html: (outer?.outerHTML ?? '').slice(0, 400),
      display: getComputedStyle(el).display,
      wrapDisplay: getComputedStyle(wrap).display,
      outerTag: outer?.tagName,
      outerDisplay: outer ? getComputedStyle(outer).display : '',
    };
  })
  .catch(() => null);
console.log('  chip shape:', JSON.stringify(chipShape, null, 1));

const tab = page.locator('.nb-backlink-tab');
const waitForTab = async (ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    if ((await tab.count()) > 0) return true;
    if (Date.now() - t0 > ms) return false;
    await page.waitForTimeout(400);
  }
};
check('the target page grows a backlinks tab', await waitForTab(), 'before the jump');
await shot('13c-tab-on-target');

// Following the chip is the reader's gesture, and it is also how the tab is
// reached from the page that made the link.
await page.locator('.nb-pagelink').first().click();
await page.waitForTimeout(2500);
await shot('13d-after-jump');
console.log(
  '  leaves after jump:',
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll('.nb-leaf-paper')].map((leaf) => ({
        side: leaf.dataset.side,
        shown: leaf.getBoundingClientRect().width > 0,
        head: (leaf.querySelector('.nb-prose')?.innerText ?? '').slice(0, 40),
      })),
    ),
  ),
);
const jumped = await waitForTab();
check('the tab survives a jump to the page it belongs to', jumped, `${await tab.count()} tabs`);
const tabCount = await tab.count();
if (tabCount > 0) {
  const words = await tab.first().innerText();
  check('the tab counts in words', /link/i.test(words), words.replace(/\n/g, ' '));
  await shot('14-backlink-tab');
  const tb = await tab.first().boundingBox();
  if (tb) {
    await page.screenshot({
      path: `${OUT}/14b-backlink-tab-close.png`,
      clip: {
        x: Math.max(0, tb.x - 80),
        y: Math.max(0, tb.y - 40),
        width: 520,
        height: 140,
      },
    });
    console.log(`  shot ${OUT}/14b-backlink-tab-close.png`);
  }
  await tab.first().click();
  await page.waitForTimeout(800);
  const card = page.locator('.nb-backlink-card');
  check('the tab opens a card of sources', await card.isVisible().catch(() => false));
  await shot('15-backlink-card');
  const cb = await card.boundingBox().catch(() => null);
  if (cb) {
    await page.screenshot({
      path: `${OUT}/15b-backlink-card-close.png`,
      clip: {
        x: Math.max(0, cb.x - 40),
        y: Math.max(0, cb.y - 20),
        width: Math.min(700, cb.width + 80),
        height: Math.min(400, cb.height + 90),
      },
    });
    console.log(`  shot ${OUT}/15b-backlink-card-close.png`);
  }
}

// ===========================================================================
// 4 — THE TAB COSTS THE PAGE ITS ROOM (no scrollbars inside pages)
// ===========================================================================
console.log('\n4. the tab and the overflow drain');

// We are on the target page, which now carries a backlinks tab. Fill it past
// the bottom and the prose must stay unscrolled: the drain peels the trailing
// blocks onto the next page instead.
const tabbed = page.locator('.nb-leaf-paper:has(.nb-backlink-tab) .nb-prose').first();
if (await tabbed.count()) {
  const railBefore = await page
    .locator('.nb-page:has(.nb-backlink-tab)')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--nb-backlink-rail').trim());
  check('the page reserves a strip for the tab', railBefore !== '' && railBefore !== '0px', railBefore);

  await tabbed.click();
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 26; i += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`line ${i} of a page that is running out of paper`);
  }
  await page.waitForTimeout(2500);
  await shot('16-overflowed');

  const geom = await page.evaluate(() => {
    const out = [];
    for (const prose of document.querySelectorAll('.nb-prose')) {
      const tab = prose.closest('.nb-page')?.querySelector('.nb-backlink-tab');
      out.push({
        over: prose.scrollHeight - prose.clientHeight,
        hasTab: tab !== null && tab !== undefined,
        lastBottom: prose.lastElementChild?.getBoundingClientRect().bottom ?? 0,
        tabTop: tab?.getBoundingClientRect().top ?? null,
      });
    }
    return out;
  });
  console.log('  leaf geometry:', JSON.stringify(geom));
  check(
    'no page scrolls its own prose',
    geom.every((g) => g.over <= 2),
    geom.map((g) => g.over).join(', '),
  );
  const withTab = geom.find((g) => g.hasTab);
  check(
    'the last line stops above the tab',
    withTab === undefined || withTab.tabTop === null || withTab.lastBottom <= withTab.tabTop + 2,
    withTab ? `last ${Math.round(withTab.lastBottom)} vs tab ${Math.round(withTab.tabTop)}` : 'no tab',
  );
} else {
  check('a leaf with a backlinks tab is on screen', false, 'none found');
}

// ===========================================================================
console.log('\n--- summary ---');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`  FAIL ${f.label}  ${f.detail}`);
if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
