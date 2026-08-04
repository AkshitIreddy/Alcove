/**
 * qa/tmp/_refute-rulings-all.mjs — independent refutation of the "27 rulings"
 * claim. Presses ALL twenty-seven cards (the claimed probe presses eight),
 * reads the COMPUTED background of the live prose surface each time, and also
 * checks the paint arrives without the panel ever being opened, and survives a
 * reload.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const OUT = fileURLToPath(new URL('./refute-rulings/', import.meta.url));
mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails += 1;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

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
      /* stop() below is the backstop */
    }
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

const t0 = Date.now();
console.log('== refute-rulings ==');
await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);

console.log('\n0. the paint arrives WITHOUT the page-style panel being opened');
const atRest = await page.evaluate(() => {
  const el = document.querySelector('.nb-page[data-style] .nb-page-editor .ProseMirror');
  return el === null
    ? { style: 'MISSING', bg: 'MISSING' }
    : {
        style: el.closest('.nb-page').getAttribute('data-style'),
        bg: getComputedStyle(el).backgroundImage,
      };
});
check(atRest.bg !== 'MISSING' && atRest.bg !== 'none', 'the default page is ruled before any panel opens', `${atRest.style}: ${atRest.bg.slice(0, 60)}…`);

await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.waitForTimeout(400);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);
await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);

const labels = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
check(labels.length === 27, 'all 27 cards on offer', `${labels.length}`);

console.log('\n1. press every one of them and read the PAPER back');
const seen = new Map();
const readback = () =>
  page.evaluate(() => {
    const pageEl = document.querySelector('.nb-page[data-style]');
    const id = pageEl?.getAttribute('data-style') ?? '';
    const prose = pageEl?.querySelector('.nb-page-editor .ProseMirror');
    const thumb = document.querySelector(`.nb-pagestyle-thumb[data-style='${id}']`);
    const shape = (css) => (css.match(/(repeating-)?(linear|radial)-gradient/g) ?? []).join('+');
    const bg = prose ? getComputedStyle(prose).backgroundImage : 'MISSING';
    const tbg = thumb ? getComputedStyle(thumb).backgroundImage : 'MISSING';
    return { id, bg, tbg, shape: shape(bg), tshape: shape(tbg) };
  });

for (const label of labels) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(260);
  const got = await readback();
  const blank = label === 'Blank paper';
  const painted = blank ? got.bg === 'none' : got.bg !== 'none' && got.bg !== 'MISSING';
  const twin = [...seen.entries()].find(([, v]) => v === got.bg);
  const thumbOk = blank ? got.tbg === 'none' : got.tshape === got.shape && got.tshape !== '';
  const ok = painted && twin === undefined && thumbOk;
  check(
    ok,
    `${label} (${got.id})`,
    !painted
      ? `paints ${got.bg}`
      : twin
        ? `identical to ${twin[0]}`
        : !thumbOk
          ? `thumb ${got.tshape} vs page ${got.shape}`
          : got.shape || 'blank',
  );
  seen.set(label, got.bg);
}

console.log('\n2. does a ruling survive a reload?');
await page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'Music staves' }) })
  .first()
  .click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}staves-before-reload.png` });
await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);
const after = await readback();
check(after.id === 'staves', 'the page is still staved after a reload', `data-style=${after.id}`);
check(after.bg !== 'none' && after.bg !== 'MISSING', 'and still painted', after.bg.slice(0, 50));
await page.screenshot({ path: `${OUT}staves-after-reload.png` });

console.log('\n3. pictures of a few, to look at');
await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}panel-shortlist.png`, clip: { x: 0, y: 60, width: 460, height: 820 } });
await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}panel-expanded.png`, clip: { x: 0, y: 60, width: 460, height: 820 } });
for (const label of ['Graph paper', 'Cornell notes', 'Storyboard', 'Guitar tab', 'Log paper', 'Hex dots']) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(400);
  const id = (await readback()).id;
  await page.screenshot({ path: `${OUT}page-${id}.png` });
}

console.log(`\n${fails === 0 ? 'ALL GOOD' : `${fails} FAILED`} — ${Date.now() - t0}ms`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
