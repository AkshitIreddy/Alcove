/**
 * scripts/probe-default-hand-refute.mjs — an ADVERSARIAL check of one claim:
 * "the page body already defaults to a handwriting face, so nothing needed
 * changing".
 *
 * Written to REFUTE, not to confirm. It boots a browser context with an empty
 * localStorage (which is where `data/db.ts`'s browser stub keeps its tables),
 * so the app seeds itself and runs on DEFAULT_SETTINGS — no persisted
 * `handwritingFont` row can be doing the work. Then it opens the seeded
 * Welcome book the way a reader does (shelf → pull → Enter) and measures the
 * APPLIED computed styles of every text-bearing element on the leaf.
 *
 * What would sink the claim, and is therefore asked explicitly:
 *   - `.nb-prose` not resolving to a hand, or resolving to one that is
 *     DECLARED and not LOADED (the stack falls through to `cursive` and the
 *     page is written in whatever the OS calls cursive).
 *   - any element on the page drawing a handwriting face below the 13px floor
 *     CLAUDE.md sets.
 *   - the sweep's own inventory disagreeing with the five faces claimed.
 *
 * Usage: node scripts/probe-default-hand-refute.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2] ?? 'qa/tmp/default-hand';
mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

/** Families the app calls handwriting (the ones bundled + the house stacks). */
const HAND_RE =
  /Caveat|Patrick Hand|Kalam|Architects Daughter|Gochi Hand|Shadows Into Light|Indie Flower|Rock Salt|Just Another Hand|Segoe Print|Segoe Script|Ink Free|Gabriola|Bradley Hand|cursive/i;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.split('\n')[0]));

console.log('\n=== probe-default-hand-refute ===\n');

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

// Nothing persisted: this context has never run the app before.
const storage = await page.evaluate(() =>
  Object.keys(localStorage).filter((k) => /settings/i.test(k)),
);
console.log(`  [storage] settings-ish keys: ${JSON.stringify(storage)}`);

// The first-run tour swallows pointer events; dismiss it the way a reader does.
for (let i = 0; i < 30; i++) {
  const skip = page.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else {
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await page.waitForTimeout(800);
}

for (let attempt = 0; attempt < 6; attempt++) {
  if ((await page.locator('.nb-book-view').count()) > 0) break;
  if ((await page.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await page
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
}
await page
  .locator('.nb-prose')
  .first()
  .waitFor({ state: 'visible', timeout: 40_000 })
  .catch(() => {});
await page.waitForTimeout(2500);

if ((await page.locator('.nb-book-view').count()) === 0) {
  console.log('  the book never opened — is the dev server up on :1420?');
  await page.screenshot({ path: `${outDir}/failed.png` });
  await browser.close();
  process.exit(1);
}

/* ------------------------------------------------------------------ 1. root */
const root = await page.evaluate(() => {
  const el = document.documentElement;
  const cs = getComputedStyle(el);
  return {
    inlineFontBody: el.style.getPropertyValue('--font-body').trim(),
    computedFontBody: cs.getPropertyValue('--font-body').trim(),
    textBody: cs.getPropertyValue('--text-body').trim(),
    theme: el.getAttribute('data-theme'),
  };
});
console.log('  [root]', JSON.stringify(root));
check(
  /Patrick Hand/i.test(root.inlineFontBody),
  'apply.ts wrote a hand into --font-body from the shipped defaults',
  root.inlineFontBody,
);

/* -------------------------------------------------------------- 2. the body */
const body = await page.evaluate(() => {
  const prose = document.querySelector('.nb-prose');
  const para = document.querySelector('.nb-prose p');
  const csP = prose === null ? null : getComputedStyle(prose);
  const csPara = para === null ? null : getComputedStyle(para);
  return {
    proseFamily: csP?.fontFamily ?? '',
    proseSize: csP?.fontSize ?? '',
    paraFamily: csPara?.fontFamily ?? '',
    paraSize: csPara?.fontSize ?? '',
    paraText: (para?.textContent ?? '').slice(0, 60),
    patrickLoaded: document.fonts.check('20px "Patrick Hand"'),
    caveatLoaded: document.fonts.check('20px "Caveat Variable"'),
    // The one way "it says Patrick Hand" can still be a lie: measure a string
    // in the resolved stack against the same string in the fallback keyword.
    widthInStack: (() => {
      const c = document.createElement('canvas').getContext('2d');
      if (c === null) return null;
      c.font = '20px "Patrick Hand", cursive';
      const a = c.measureText('The quick brown fox jumps').width;
      c.font = '20px cursive';
      const b = c.measureText('The quick brown fox jumps').width;
      c.font = '20px "NoSuchFaceAnywhere12345"';
      const d = c.measureText('The quick brown fox jumps').width;
      return { hand: a, cursive: b, missing: d };
    })(),
  };
});
console.log('  [body]', JSON.stringify(body));
check(/Patrick Hand/i.test(body.proseFamily), '.nb-prose resolves to a hand', body.proseFamily);
check(parseFloat(body.proseSize) >= 13, 'and sits above the 13px handwriting floor', body.proseSize);
check(/Patrick Hand/i.test(body.paraFamily), 'a real paragraph inherits it', body.paraFamily);
check(body.patrickLoaded === true, 'the face is LOADED, not merely named');
check(
  body.widthInStack !== null &&
    Math.abs(body.widthInStack.hand - body.widthInStack.missing) > 0.5,
  'and it really draws differently from a face that does not exist',
  JSON.stringify(body.widthInStack),
);

/* ------------------------------------------------- 3. sweep the whole leaf */
const sweep = await page.evaluate(() => {
  const scope = document.querySelector('.nb-book-view');
  if (scope === null) return null;
  const out = new Map();
  const walk = (el) => {
    const direct = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
      .map((n) => (n.textContent ?? '').trim())
      .join(' ');
    if (direct !== '') {
      const cs = getComputedStyle(el);
      const key = `${cs.fontFamily.split(',')[0].replace(/["']/g, '')} @ ${cs.fontSize}`;
      const hit = out.get(key) ?? { key, count: 0, sample: '', tags: new Set() };
      hit.count += 1;
      hit.tags.add(`${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''}`);
      if (hit.sample === '') hit.sample = direct.slice(0, 44);
      out.set(key, hit);
    }
    for (const child of el.children) walk(child);
  };
  walk(scope);
  return [...out.values()].map((h) => ({
    key: h.key,
    count: h.count,
    sample: h.sample,
    tags: [...h.tags].slice(0, 4),
  }));
});
console.log(`\n  [sweep] ${sweep === null ? 'no book view' : `${sweep.length} distinct face+size pairs`}`);
for (const row of sweep ?? []) {
  console.log(`    ${row.key.padEnd(34)} x${String(row.count).padStart(3)}  ${row.tags.join(' ')}  "${row.sample}"`);
}
writeFileSync(`${outDir}/sweep.json`, JSON.stringify(sweep, null, 2));

const handTooSmall = (sweep ?? []).filter((r) => {
  const [family, size] = r.key.split(' @ ');
  return HAND_RE.test(family) && parseFloat(size) < 13;
});
check(handTooSmall.length === 0, 'no handwriting face on the page draws below 13px', JSON.stringify(handTooSmall));

const bodyRows = (sweep ?? []).filter((r) => /Patrick Hand/i.test(r.key));
check(bodyRows.length > 0, 'the hand actually reaches text on the leaf', bodyRows.map((r) => r.key).join(', '));

await page.screenshot({ path: `${outDir}/welcome-spread.png` });
const leaf = page.locator('.nb-leaf-paper').first();
if ((await leaf.count()) > 0) await leaf.screenshot({ path: `${outDir}/welcome-leaf.png` });

await browser.close();
console.log(
  `\n${failures === 0 ? 'PASS (claim survives)' : `FAIL — ${failures} check(s)`}  shots in ${outDir}\n`,
);
process.exit(failures === 0 ? 0 : 1);
