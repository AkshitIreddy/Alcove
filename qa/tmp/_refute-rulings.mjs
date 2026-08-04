/**
 * Refutation pass: the claimant's probe presses 10 of 27. Press ALL 27 and
 * read back the computed background-image off the live prose surface, so a
 * ruling whose selector never matched cannot hide in the 17 it skipped.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
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
    } catch {}
  },
  ['notebook.stubdb.v1', 'appState:tutorialCompleted'],
);

await page.goto('http://localhost:1420/?fx=force&dev=1', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);
await page.locator('.nb-prose').first().click({ timeout: 30000 });
await page.waitForTimeout(400);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 60000 });
await page.waitForTimeout(700);
await page.locator('.nb-pagestyle-more').click();
await page.waitForTimeout(600);

const names = await page.$$eval('.nb-pagestyle-card .nb-pagestyle-label', (n) =>
  n.map((x) => x.textContent?.trim() ?? ''),
);
console.log(`\nall ${names.length} offered`);

const painted = async (wanted) =>
  page.evaluate((label) => {
    const card = [...document.querySelectorAll('.nb-pagestyle-card')].find(
      (c) => c.querySelector('.nb-pagestyle-label')?.textContent?.trim() === label,
    );
    const thumb = card?.querySelector('.nb-pagestyle-thumb');
    const id = thumb?.getAttribute('data-style') ?? '';
    const pageEl = [...document.querySelectorAll('.nb-page')].find(
      (p) => p.getAttribute('data-style') === id,
    );
    const prose = pageEl?.querySelector('.nb-page-editor .ProseMirror');
    const read = (el) => (el ? getComputedStyle(el) : null);
    const cs = read(prose);
    const ts = read(thumb);
    return {
      id,
      onPage: pageEl !== undefined,
      pageCss: cs ? cs.backgroundImage : 'MISSING',
      pageSize: cs ? cs.backgroundSize : '',
      pageRepeat: cs ? cs.backgroundRepeat : '',
      thumbCss: ts ? ts.backgroundImage : 'MISSING',
    };
  }, wanted);

console.log('\nevery one of the 27, pressed:');
const seen = new Map();
for (const label of names) {
  const card = page
    .locator('.nb-pagestyle-card')
    .filter({ has: page.locator('.nb-pagestyle-label', { hasText: label }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForTimeout(260);
  const got = await painted(label);
  const blank = got.id === 'blank';
  const inked = blank ? got.pageCss === 'none' : got.pageCss !== 'none' && got.pageCss !== 'MISSING';
  check(got.onPage && inked, `${label} (${got.id})`, blank ? 'none, as designed' : got.pageCss === 'none' ? 'PAINTS NOTHING' : `${(got.pageCss.match(/(repeating-)?(linear|radial)-gradient/g) ?? []).length} layer(s)`);
  if (!blank) {
    const twin = [...seen.entries()].find(([, v]) => v === got.pageCss);
    check(twin === undefined, `  ${label} is its own pattern`, twin ? `IDENTICAL to ${twin[0]}` : '');
    // a layered pattern must carry a matching size/repeat list, or the extra
    // layers tile at the wrong scale and the ruling is a smear
    const layers = (got.pageCss.match(/(repeating-)?(linear|radial)-gradient/g) ?? []).length;
    const sizes = got.pageSize.split(',').length;
    const reps = got.pageRepeat.split(',').length;
    check(
      sizes === 1 || sizes === layers,
      `  ${label} size list matches its layers`,
      `${layers} layers / ${sizes} sizes`,
    );
    check(
      reps === 1 || reps === layers,
      `  ${label} repeat list matches its layers`,
      `${layers} layers / ${reps} repeats`,
    );
    seen.set(label, got.pageCss);
  }
  check(got.thumbCss !== 'MISSING' && (blank || got.thumbCss !== 'none'), `  ${label} thumbnail is painted too`);
}

/* Does a chosen ruling SURVIVE — reopen the book and it should still be there. */
console.log('\npersistence: the ruling outlives the panel');
await page
  .locator('.nb-pagestyle-card')
  .filter({ has: page.locator('.nb-pagestyle-label', { hasText: 'Music staves' }) })
  .first()
  .click();
await page.waitForTimeout(600);
await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
await page.waitForTimeout(400);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);
const after = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-page')].map((p) => p.getAttribute('data-style')),
);
check(after.includes('staves'), 'the staves page came back ruled as staves', after.join(','));

await page.screenshot({ path: `${OUT}after-reload.png` });
console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
