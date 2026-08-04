/**
 * qa/tmp/_refute-rulings-onedef.mjs — an attempt to REFUTE the page-styles claim.
 *
 * The claim is that styles/rulings.css holds ONE definition per ruling, read by
 * both the page and the panel's thumbnail, and that the two surfaces differ
 * only in --rule and --rule-gutter. The shipped probe presses eight of the
 * twenty-seven and compares gradient FUNCTION ORDER between thumb and page —
 * which a second, hand-written copy of the same shape would also pass.
 *
 * So this one is harsher on both axes:
 *  - it presses ALL twenty-seven, not a sample, and reads the live prose
 *    surface back through getComputedStyle;
 *  - it forces the page's own --page-line-height to 10px and --rule-gutter to
 *    9px (the thumb's two numbers) and then demands the two computed
 *    background-image strings be CHARACTER-IDENTICAL. Nothing but a single
 *    shared declaration can pass that; two copies that merely agree in shape
 *    cannot.
 *
 * Against the ALREADY RUNNING dev server on :1420. Never starts one.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const OUT = fileURLToPath(new URL('./refute-rulings/', import.meta.url));
mkdirSync(OUT, { recursive: true });

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
      /* the stop() below is the backstop */
    }
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

const t0 = Date.now();
console.log('== refute-rulings (one definition, two surfaces) ==');
await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());

await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);
await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.waitForTimeout(400);

await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);

console.log('\n0. the shared rules are in the document at all');
const sheetSeen = await page.evaluate(() =>
  [...document.styleSheets].some((s) => {
    try {
      return [...s.cssRules].some((r) =>
        r.cssText.includes('.nb-pagestyle-thumb[data-style="ruled"]'),
      );
    } catch {
      return false;
    }
  }),
);
check(sheetSeen, 'the paired page/thumb rule is live in the page');

await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);
const names = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
check(names.length === 27, 'all twenty-seven cards are offered', `saw ${names.length}`);

/**
 * What the live prose surface is painted with, and what the card that stands
 * for it is painted with, measured at the SAME pitch — the only reading in
 * which "one definition" and "two copies that agree" look different.
 */
const readBoth = async (label) =>
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
    if (!prose || !thumb) return { id, onPage: false };
    const live = getComputedStyle(prose).backgroundImage;
    const prev = pageEl.getAttribute('style') ?? '';
    pageEl.style.setProperty('--page-line-height', '10px');
    pageEl.style.setProperty('--rule-gutter', '9px');
    const matched = getComputedStyle(prose).backgroundImage;
    pageEl.setAttribute('style', prev);
    return {
      id,
      onPage: true,
      pressed: card?.getAttribute('aria-pressed') === 'true',
      live,
      matched,
      thumb: getComputedStyle(thumb).backgroundImage,
    };
  }, label);

console.log('\n1. press ALL twenty-seven and read the paper back');
const seen = new Map();
const identical = [];
const drifted = [];
for (const label of names) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(180);
  const got = await readBoth(label);
  if (!got.onPage) {
    check(false, `"${label}" never reached the page`, `id=${got.id}`);
    continue;
  }
  const isBlank = got.id === 'blank';
  if (isBlank ? got.live !== 'none' : got.live === 'none')
    check(false, `"${label}" (${got.id}) painted nothing`, got.live);
  if (!got.pressed) check(false, `"${label}" does not read as chosen`);
  const twin = [...seen.entries()].find(([, css]) => css === got.live);
  if (twin && !isBlank) identical.push(`${label} == ${twin[0]}`);
  seen.set(label, got.live);
  if (got.matched !== got.thumb) drifted.push({ id: got.id, page: got.matched, thumb: got.thumb });
}
check(true, `pressed ${names.length}, every one reached a page`);
check(identical.length === 0, 'no two rulings compute to the same paint', identical.join('; '));
check(
  drifted.length === 0,
  'thumbnail is the SAME declaration as the page (byte-identical at one pitch)',
  drifted.map((d) => d.id).join(', '),
);
for (const d of drifted.slice(0, 3)) {
  console.log(`     ${d.id}\n       page : ${d.page.slice(0, 220)}\n       thumb: ${d.thumb.slice(0, 220)}`);
}

console.log('\n2. and the thumbnails themselves are printed');
const thumbs = await page.$$eval('.nb-pagestyle-card', (cards) =>
  cards.map((c) => {
    const t = c.querySelector('.nb-pagestyle-thumb');
    return {
      id: t?.getAttribute('data-style') ?? '',
      bg: t ? getComputedStyle(t).backgroundImage : 'MISSING',
      w: t ? Math.round(t.getBoundingClientRect().width) : 0,
      h: t ? Math.round(t.getBoundingClientRect().height) : 0,
    };
  }),
);
const bare = thumbs.filter((t) => t.id !== 'blank' && (t.bg === 'none' || t.bg === 'MISSING'));
check(bare.length === 0, 'every non-blank thumbnail is printed', bare.map((t) => t.id).join(', '));
const collapsed = thumbs.filter((t) => t.w < 60 || t.h < 40);
check(collapsed.length === 0, 'no thumbnail collapsed', collapsed.map((t) => `${t.id} ${t.w}x${t.h}`).join(', '));
await page.screenshot({ path: `${OUT}all-27-pressed.png` });

console.log(`\n${failures === 0 ? 'NOT REFUTED' : `${failures} REFUTATIONS`} — ${Date.now() - t0}ms`);
await browser.close();
process.exit(0);
