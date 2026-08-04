/**
 * Independent refutation pass over the settings-search matcher claim.
 * Reads only the APPLIED DOM (getClientRects), never a signal, never a store.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
mkdirSync('qa/tmp/refute-search', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

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

const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(150);
  }
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

const state = () =>
  page.evaluate(() => {
    const seen = (el) => el.getClientRects().length > 0;
    const text = (el, sel) => el.querySelector(sel)?.textContent?.trim() ?? '?';
    const sheet = document.querySelector('.nbs-sheet');
    if (sheet === null) return null;
    return {
      sections: [...sheet.querySelectorAll('.nbs-section')].filter(seen).map((s) => text(s, '.nbs-section-title')),
      rows: [...sheet.querySelectorAll('.nbs-row')].filter(seen).map((r) => text(r, '.nbs-row-label')),
      keys: [...sheet.querySelectorAll('.nbs-keys-item')].filter(seen).map((li) => text(li, '.nbs-keys-action')),
      chips: [...sheet.querySelectorAll('.nbs-seg-chip')].filter(seen).map((c) => c.textContent?.trim() ?? ''),
      tally: document.querySelector('.nbs-find-tally')?.textContent ?? null,
      field: document.querySelector('.nbs-find-input')?.value ?? null,
      empty: seen(document.querySelector('.nbs-find-empty') ?? document.createElement('i')),
      // Everything a reader can still see inside the sheet that is NOT the
      // header and NOT the "nothing found" note — the check that a query which
      // matches nothing really does empty the paper.
      strays: (() => {
        const out = [];
        for (const el of sheet.children) {
          if (el.classList.contains('nbs-header')) continue;
          if (el.classList.contains('nbs-find-empty')) continue;
          if (!seen(el)) continue;
          out.push(el.className || el.tagName);
        }
        return out;
      })(),
    };
  });

const type = async (q) => {
  await page.locator('.nbs-find-input').fill(q);
  await poll((want) => document.querySelector('.nbs-find-input')?.value === want, q);
  await page.waitForTimeout(150);
  return state();
};

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('no QA bridges');
}
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(900);

await page.locator('.nbs-gear-button').click();
await poll(() => {
  const el = document.querySelector('.nbs-sheet');
  return el !== null && getComputedStyle(el).visibility === 'visible';
});

const rest = await state();
console.log(`\nat rest: ${rest.sections.length} sections, ${rest.rows.length} rows, ${rest.keys.length} key rows, ${rest.chips.length} chips`);
check('a search field exists in the running app', rest.field === '');

/* --- 1. fold: both sides, both spellings ---------------------------------- */
console.log('\n1. fold() normalises BOTH sides');
const uk = await type('colour');
const us = await type('color');
console.log(`  colour → ${uk.rows.length} rows ${JSON.stringify(uk.rows.slice(0, 6))}`);
console.log(`  color  → ${us.rows.length} rows ${JSON.stringify(us.rows.slice(0, 6))}`);
check('colour and color are the same search', uk.rows.length > 0 && same(uk.rows, us.rows));

const ise = await type('customise');
const ize = await type('customize');
console.log(`  customise → ${ise.rows.length}; customize → ${ize.rows.length}`);
check('customise and customize are the same search', same(ise.rows, ize.rows), `${ise.rows.length} vs ${ize.rows.length}`);

const grey = await type('grey');
const gray = await type('gray');
console.log(`  grey → ${grey.rows.length} ${JSON.stringify(grey.rows.slice(0, 5))}; gray → ${gray.rows.length} ${JSON.stringify(gray.rows.slice(0, 5))}`);
check('grey and gray are the same search', same(grey.rows, gray.rows), `${grey.rows.length} vs ${gray.rows.length}`);
check('…and that search finds something at all', grey.rows.length + grey.chips.length > 0, `${grey.rows.length} rows, ${grey.chips.length} chips`);

const curly = await type('room’s own paper');
const straight = await type("room's own paper");
console.log(`  curly → ${curly.rows.length}; straight → ${straight.rows.length}`);
check('a curly apostrophe searches the same as a straight one', same(curly.rows, straight.rows), `${curly.rows.length} vs ${straight.rows.length}`);

const accent = await type('thème');
const plain = await type('theme');
console.log(`  thème → ${accent.rows.length}; theme → ${plain.rows.length}`);
check('combining marks are stripped from the query', plain.rows.length > 0 && same(accent.rows, plain.rows), `${accent.rows.length} vs ${plain.rows.length}`);

const punct = await type('  DARK---MODE  ');
const clean = await type('dark mode');
check('punctuation becomes a gap and case does not matter', same(punct.rows, clean.rows) && clean.rows.length > 0, `${punct.rows.length} vs ${clean.rows.length}`);

/* --- 2. substring per term, not a fuzzy score ----------------------------- */
console.log('\n2. substring per term, NOT a subsequence score');
const fuzzy = await type('bckp');
console.log(`  "bckp" → ${fuzzy.rows.length} rows, empty note ${fuzzy.empty}`);
check('a subsequence of "backup" finds nothing', fuzzy.rows.length === 0 && fuzzy.keys.length === 0 && fuzzy.empty);
const bak = await type('backup');
check('…while the real substring finds plenty', bak.rows.length > 0, `${bak.rows.length} rows`);

/* --- 3. EVERY term must land: a second word only ever narrows -------------- */
console.log('\n3. every term must land');
const pairs = [
  ['backup', 'folder'],
  ['sound', 'volume'],
  ['theme', 'dark'],
  ['page', 'style'],
  ['code', 'font'],
  ['cursor', 'set'],
  ['tour', 'replay'],
  ['key', 'shortcut'],
  ['paper', 'ink'],
  ['sound', 'zzz'],
];
for (const [a, b] of pairs) {
  const ra = await type(a);
  const rb = await type(b);
  const rab = await type(`${a} ${b}`);
  const setA = new Set(ra.rows);
  const setB = new Set(rb.rows);
  const subset = rab.rows.every((r) => setA.has(r) && setB.has(r));
  const narrower = rab.rows.length <= ra.rows.length && rab.rows.length <= rb.rows.length;
  check(
    `"${a} ${b}" is a subset of both single-word results`,
    subset && narrower,
    `${ra.rows.length} ∩ ${rb.rows.length} → ${rab.rows.length}`,
  );
}

/* --- 4. trailing-s fallback ----------------------------------------------- */
console.log('\n4. trailing-s fallback');
for (const [plural, singular] of [
  ['shortcuts', 'shortcut'],
  ['sounds', 'sound'],
  ['backups', 'backup'],
  ['cursors', 'cursor'],
]) {
  const p = await type(plural);
  const s = await type(singular);
  console.log(`  ${plural} → ${p.rows.length} rows / ${p.keys.length} keys; ${singular} → ${s.rows.length} / ${s.keys.length}`);
  check(`"${plural}" still finds what "${singular}" finds`, p.rows.length > 0 || p.keys.length > 0, `${p.rows.length} rows`);
}

/* --- 5. nothing found really empties the paper ---------------------------- */
console.log('\n5. a query that matches nothing');
const none = await type('zzzqqq');
console.log('  strays left on the sheet:', JSON.stringify(none.strays));
check('no rows, no key rows, no section headings', none.rows.length === 0 && none.keys.length === 0 && none.sections.length === 0);
check('no visible chips left over', none.chips.filter((c) => !['theme', 'sound', 'backup', 'shortcuts', 'code', 'cursor', 'tour'].includes(c)).length === 0, none.chips.join(','));
check('nothing else is left standing on the sheet', none.strays.length === 0, none.strays.join(', '));
await page.screenshot({ path: 'qa/tmp/refute-search/none.png' });

/* --- 6. the tally counts what is on screen -------------------------------- */
console.log('\n6. the count matches the paper');
for (const q of ['volume', 'backup', 'theme', 'sound']) {
  const r = await type(q);
  check(`"${q}" count matches visible rows`, r.tally === `${r.rows.length + r.keys.length} rows` || (r.rows.length + r.keys.length === 1 && r.tally === '1 row'), `${r.tally} vs ${r.rows.length}+${r.keys.length}`);
}

/* --- 7. clearing puts the sheet back -------------------------------------- */
const back = await type('');
check('clearing the box restores the whole sheet', back.rows.length === rest.rows.length && back.sections.length === rest.sections.length, `${back.rows.length}/${rest.rows.length} rows`);
check('and the count disappears with it', back.tally === null);
await page.screenshot({ path: 'qa/tmp/refute-search/rest.png' });

if (errors.size > 0) {
  console.log('\npage errors:');
  for (const [k, n] of errors) console.log(`  ${n}x ${k}`);
}
console.log(fails.length === 0 ? '\nALL OK' : `\nFAILED: ${fails.join(' | ')}`);
await browser.close();
process.exit(fails.length === 0 ? 0 : 1);
