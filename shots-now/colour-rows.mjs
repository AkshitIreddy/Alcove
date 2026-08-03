/**
 * shots-now/colour-rows.mjs — the two part-colour rows, driven by clicking.
 *
 * The room axis carries sixty schemes. Both `ColourRow`s in LibraryStudio used
 * to render every one of them as a 26px dot, twice over, in a 376px sheet. They
 * now show a capped head and hand the rest to `DesignPicker`, which is the same
 * bargain every other long axis in the panel strikes.
 *
 * This asserts the bargain HOLDS end to end, and refuses to pass vacuously:
 *   - each row shows a capped head plus one way-through, on one line;
 *   - the way-through's count is the REMAINING count, not the total;
 *   - the sheet it opens offers all sixty, with names and a search;
 *   - a pick from the inline dots repaints the shelf (applied library key);
 *   - a pick from deep inside the sheet repaints it too, AND comes back as a
 *     pressed dot in the collapsed row — the `cappedTo` guarantee, which is the
 *     one thing that would silently read as "it forgot my choice".
 *
 * Every assertion reads the APPLIED state through `__shelfDesign()`, never what
 * the store was merely asked to save.
 *
 * Usage: node shots-now/colour-rows.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'shots-now/colour-rows';

mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (ok, what, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${detail === undefined ? '' : `  — ${detail}`}`);
  if (!ok) fails.push(`${what}${detail === undefined ? '' : ` (${detail})`}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

/**
 * Errors from OUTSIDE this change, listed but not counted against it.
 *
 * The spine path (art/covers.ts → bookStyle → spineFactory) is being edited by
 * somebody else while this runs, and a half-saved module there throws on every
 * floor load. Swallowing all errors would make this probe pass through anything;
 * swallowing a NAMED one and printing it keeps the gate honest about what it is
 * and is not covering.
 */
const FOREIGN = /handForFace|COVER_FONT_COUNT|covers\.ts|bookStyle\.ts|spineFactory\.ts|floorView\.ts/;
const errors = new Map();
const foreign = new Map();
const note = (k) => {
  const bin = FOREIGN.test(k) ? foreign : errors;
  bin.set(k, (bin.get(k) ?? 0) + 1);
};
page.on('pageerror', (e) => note(`${e.message.split('\n')[0]} ${e.stack?.split('\n')[1] ?? ''}`));
page.on('console', (m) => {
  if (m.type() === 'error') note(`console ${m.text().split('\n')[0]}`);
});

/** An evaluate that survives an unrelated async throw landing on the same tick. */
const tryEval = async (fn, arg) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (err) {
      if (attempt >= 3 || !FOREIGN.test(String(err))) throw err;
      await page.waitForTimeout(250);
    }
  }
};

const poll = async (fn, arg, timeout = 60000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await tryEval(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(200);
  }
};

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${OUT}/${name}.png`);
};

const libKey = () => tryEval(() => globalThis.__shelfDesign().libraryKey);

/** The row, measured: how many dots, what the way-through says, does it wrap. */
const readRow = (label) =>
  tryEval((rowLabel) => {
    const row = document.querySelector(`[aria-label="${rowLabel} colours"]`);
    if (row === null) return null;
    const dots = [...row.querySelectorAll('button.nb-chip-swatch')];
    const more = row.querySelector('button.nb-chip-more');
    const box = row.getBoundingClientRect();
    // The row's own HEIGHT, not a set of child tops. `align-items: center`
    // parks the 26px control one pixel below the 28px dots, so counting
    // distinct tops reports a wrap that is not there — which it did, four
    // times, on the first run of this probe.
    const tallest = Math.max(...[...row.children].map((el) => el.getBoundingClientRect().height));
    return {
      dots: dots.length,
      pressed: dots.filter((b) => b.getAttribute('aria-pressed') === 'true').length,
      pressedName: dots.find((b) => b.getAttribute('aria-pressed') === 'true')?.getAttribute('aria-label') ?? null,
      names: dots.map((b) => b.getAttribute('aria-label')),
      moreText: more?.textContent?.trim() ?? null,
      moreLabel: more?.getAttribute('aria-label') ?? null,
      moreTooltip: more?.getAttribute('data-tooltip') ?? null,
      moreTitleAttr: more?.getAttribute('title') ?? null,
      lines: Math.max(1, Math.round(box.height / tallest)),
      height: Math.round(box.height),
      width: Math.round(box.width),
      right: Math.round((more ?? dots[dots.length - 1]).getBoundingClientRect().right - box.left),
      /** What is left of the row after the control. The comment in studio.css
          quotes this number; if it goes negative the row has wrapped. */
      spare: Math.round(box.right - (more ?? dots[dots.length - 1]).getBoundingClientRect().right),
    };
  }, label);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await tryEval(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
// No books seeded on purpose: these two rows paint the CASE and the WALL, and
// the spine path is somebody else's building site this hour (see FOREIGN).
await poll(() => globalThis.__shelfDesign().libraryKey !== '', null, 60000, 'first room bake');

console.log('\n1. open the studio and measure both rows');
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1200);

const shelfRow = await readRow('shelves');
const wallRow = await readRow('wallpaper');
console.log('  shelves:', JSON.stringify(shelfRow));
console.log('  wallpaper:', JSON.stringify(wallRow));

check(shelfRow !== null, 'the shelves colour row is on the sheet');
check(wallRow !== null, 'the wallpaper colour row is on the sheet');

for (const [label, row] of [
  ['shelves', shelfRow],
  ['wallpaper', wallRow],
]) {
  if (row === null) continue;
  check(row.dots > 0 && row.dots <= 12, `${label}: capped head, not sixty dots`, `${row.dots} dots`);
  check(row.moreText !== null, `${label}: a way through to the rest`, row.moreText ?? 'missing');
  const said = Number(/^(\d+)/.exec(row.moreText ?? '')?.[1] ?? NaN);
  check(said === 60 - row.dots, `${label}: the count is what is HIDDEN`, `says ${said}, hidden ${60 - row.dots}`);
  check(row.pressed === 1, `${label}: exactly one dot reads as chosen`, `${row.pressed}`);
  check(row.lines === 1, `${label}: head + control on one line`, `${row.height}px tall`);
  check(row.spare >= 0, `${label}: the control finishes inside the panel`, `${row.spare}px spare of ${row.width}`);
  check(row.moreTitleAttr === null, `${label}: no native title= on the control`);
  check(
    row.moreTooltip !== null && row.moreLabel !== null,
    `${label}: the control is named for the reader and the screen reader`,
  );
}
await shot('01-rows-collapsed');

console.log('\n2. an inline dot repaints the case');
const key0 = await libKey();
// A dot that is NOT the pressed one, so the change cannot be a no-op.
const shelfDots = page.locator('[aria-label="shelves colours"] button.nb-chip-swatch');
let shelfTarget = null;
for (let i = 0; i < (await shelfDots.count()); i += 1) {
  if ((await shelfDots.nth(i).getAttribute('aria-pressed')) !== 'true') {
    shelfTarget = shelfDots.nth(i);
    break;
  }
}
if (shelfTarget === null) throw new Error('every shelf dot was already pressed');
const shelfPickName = await shelfTarget.getAttribute('aria-label');
console.log('  clicking:', JSON.stringify(shelfPickName), ' from:', key0);
await shelfTarget.click();
const key1 = await poll(
  (before) => {
    const k = globalThis.__shelfDesign().libraryKey;
    return k !== before ? k : null;
  },
  key0,
  30000,
  'the inline dot to reach the case',
);
check(true, 'inline dot: the applied room key changed', `${key0} -> ${key1}`);
await page.waitForTimeout(1200);
await shot('02-inline-dot-picked');

console.log('\n3. the way-through opens the sheet with all sixty');
await page.locator('[aria-label="shelves colours"] button.nb-chip-more').click();
await page.waitForSelector('.nb-pick', { timeout: 20000 });
await page.waitForTimeout(900);
const sheet = await tryEval(() => ({
  title: document.querySelector('.nb-pick-title')?.textContent?.trim() ?? null,
  count: document.querySelector('.nb-pick-count')?.textContent?.trim() ?? null,
  cards: document.querySelectorAll('.nb-pick-card').length,
  search: document.querySelector('.nb-pick-search input') !== null,
  back: document.querySelector('.nb-pick-back') !== null,
  named: [...document.querySelectorAll('.nb-pick-name')].slice(0, 3).map((n) => n.textContent),
}));
console.log('  sheet:', JSON.stringify(sheet));
check(sheet.title === 'the colour of the shelves', 'the sheet names the axis it came from', sheet.title);
check(/\b60\b/.test(sheet.count ?? ''), 'the sheet offers all sixty', sheet.count);
check(sheet.search && sheet.back, 'the sheet has a search box and a top-left way out');
check(sheet.named.every((n) => (n ?? '').length > 0), 'the cards are NAMED', sheet.named.join(', '));
await shot('03-shelf-sheet');

console.log('\n4. reach past the cap and pick a colour only the sheet has');
const headNames = new Set((shelfRow?.names ?? []).map((n) => (n ?? '').split(': ')[1]));
await page.locator('.nb-pick .nb-more').click();
await page.waitForTimeout(1200);
const deep = await tryEval((head) => {
  const cards = [...document.querySelectorAll('.nb-pick-card')];
  const i = cards.findIndex((c, idx) => idx > 40 && !head.includes(c.querySelector('.nb-pick-name')?.textContent ?? ''));
  return { total: cards.length, index: i, name: cards[i]?.querySelector('.nb-pick-name')?.textContent ?? null };
}, [...headNames]);
console.log('  expanded to', deep.total, 'cards; picking #' + deep.index, JSON.stringify(deep.name));
check(deep.total === 60, 'every one of the sixty is reachable', `${deep.total} cards mounted`);
check(deep.index > 40, 'picking one the inline row does not show', `#${deep.index}`);
const key2before = await libKey();
await page.locator('.nb-pick-card').nth(deep.index).click();
const key2 = await poll(
  (before) => {
    const k = globalThis.__shelfDesign().libraryKey;
    return k !== before ? k : null;
  },
  key2before,
  30000,
  'the sheet pick to reach the case',
);
check(true, 'sheet pick: the applied room key changed', `${key2before} -> ${key2}`);
await page.waitForTimeout(1000);
await shot('04-shelf-sheet-picked');

console.log('\n5. back: the collapsed row remembers the choice');
await page.locator('.nb-pick-back').click();
await page.waitForSelector('.nb-library-studio [aria-label="shelves colours"]', { timeout: 20000 });
await page.waitForTimeout(800);
const afterBack = await readRow('shelves');
console.log('  shelves now:', JSON.stringify(afterBack));
check(afterBack?.pressed === 1, 'one dot still reads as chosen', `${afterBack?.pressed}`);
check(
  (afterBack?.pressedName ?? '').toLowerCase().includes((deep.name ?? '###').toLowerCase()),
  'and it is the one picked from the sheet',
  `${afterBack?.pressedName} vs ${deep.name}`,
);
check(afterBack?.lines === 1, 'the row is still one line after the swap-in', `${afterBack?.lines}`);
await shot('05-back-choice-kept');

console.log('\n6. the wall row does the same, on its own axis');
await page.locator('[aria-label="wallpaper colours"] button.nb-chip-more').scrollIntoViewIfNeeded();
await page.locator('[aria-label="wallpaper colours"] button.nb-chip-more').click();
await page.waitForSelector('.nb-pick', { timeout: 20000 });
await page.waitForTimeout(900);
const wallSheetTitle = await page.locator('.nb-pick-title').textContent();
check((wallSheetTitle ?? '').trim() === 'the colour of the wall', 'the wall sheet names the wall', wallSheetTitle);
const key3before = await libKey();
await page.locator('.nb-pick .nb-more').click();
await page.waitForTimeout(1000);
const deepWall = await tryEval(() => {
  const cards = [...document.querySelectorAll('.nb-pick-card')];
  return { total: cards.length, name: cards[47]?.querySelector('.nb-pick-name')?.textContent ?? null };
});
console.log('  picking wall card #47:', JSON.stringify(deepWall.name), 'of', deepWall.total);
await page.locator('.nb-pick-card').nth(47).click();
const key3 = await poll(
  (before) => {
    const k = globalThis.__shelfDesign().libraryKey;
    return k !== before ? k : null;
  },
  key3before,
  30000,
  'the wall colour to reach the wall',
);
check(true, 'wall sheet pick: the applied room key changed', `${key3before} -> ${key3}`);
await shot('06-wall-sheet-picked');
await page.locator('.nb-pick-back').click();
await page.waitForSelector('.nb-library-studio [aria-label="wallpaper colours"]', { timeout: 20000 });
await page.waitForTimeout(900);
const wallBack = await readRow('wallpaper');
console.log('  wallpaper now:', JSON.stringify(wallBack));
check(wallBack?.pressed === 1, 'the wall row keeps its choice too', `${wallBack?.pressedName}`);
check(wallBack?.lines === 1, 'wall row still one line', `${wallBack?.lines}`);
await shot('07-wall-back');

console.log('\n7. an inline wall dot still repaints');
const key4before = await libKey();
const wallDots = page.locator('[aria-label="wallpaper colours"] button.nb-chip-swatch');
let wallTarget = null;
for (let i = 0; i < (await wallDots.count()); i += 1) {
  if ((await wallDots.nth(i).getAttribute('aria-pressed')) !== 'true') {
    wallTarget = wallDots.nth(i);
    break;
  }
}
if (wallTarget === null) throw new Error('every wall dot was already pressed');
await wallTarget.click();
const key4 = await poll(
  (before) => {
    const k = globalThis.__shelfDesign().libraryKey;
    return k !== before ? k : null;
  },
  key4before,
  30000,
  'the inline wall dot to reach the wall',
);
check(true, 'inline wall dot: the applied room key changed', `${key4before} -> ${key4}`);
await page.waitForTimeout(1200);
await shot('08-wall-inline-picked');

console.log('\n8. a narrow window');
// 900px: the panel is still its full 376 (`min(376px, 84vw)`), so the row must
// still hold one line — this is the width the studio.css budget is quoted at.
await page.setViewportSize({ width: 900, height: 620 });
await page.waitForTimeout(1000);
const narrow = await readRow('shelves');
const overflow = await tryEval(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log('  at 900px:', JSON.stringify(narrow), 'doc:', JSON.stringify(overflow));
check(
  overflow.scrollWidth <= overflow.clientWidth,
  'no horizontal overflow at 900px',
  `${overflow.scrollWidth} / ${overflow.clientWidth}`,
);
check(narrow?.lines === 1, 'still one line at 900px', `${narrow?.height}px, ${narrow?.spare}px spare`);
await shot('09-narrow');

// 420px: now the panel really is smaller (84vw), the row is allowed to wrap —
// what it must NOT do is push the panel sideways.
console.log('\n9. narrow enough that the panel itself shrinks');
await page.setViewportSize({ width: 420, height: 620 });
await page.waitForTimeout(1000);
const tiny = await readRow('shelves');
const tinyOverflow = await tryEval(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
console.log('  at 420px:', JSON.stringify(tiny), 'doc:', JSON.stringify(tinyOverflow));
check(
  tinyOverflow.scrollWidth <= tinyOverflow.clientWidth,
  'no horizontal overflow at 420px either',
  `${tinyOverflow.scrollWidth} / ${tinyOverflow.clientWidth}`,
);
check(tiny?.spare >= 0, 'wrapped rather than spilled', `${tiny?.spare}px spare, ${tiny?.lines} line(s)`);
check(tiny?.dots === narrow?.dots, 'the head does not shed colours when it wraps', `${tiny?.dots}`);
await shot('10-very-narrow');

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

console.log('\n=== errors from elsewhere in the tree (NOT gated here) ===');
if (foreign.size === 0) console.log('none');
else for (const [k, n] of foreign) console.log(`  x${n}  ${k}`);

console.log('\n=== result ===');
if (fails.length === 0) console.log('all checks passed');
else for (const f of fails) console.log(`  FAILED: ${f}`);

await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
