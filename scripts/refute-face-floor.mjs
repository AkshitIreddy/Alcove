/**
 * scripts/refute-face-floor.mjs — an ADVERSARIAL probe of the illegibility
 * guard claimed for `.nb-prose .nb-face` in src/styles/editor.css.
 *
 * The claim under test: a face mark never draws below `max(13, spec.floorPx)`
 * and never SHRINKS the context it lands in, because the one rule in
 * editor.css sets `font-size: max(var(--nb-face-floor, 0px), 1em)`.
 *
 * This probe does not construct the span itself where it can avoid it: it
 * types, selects, and presses the toolbar chip the way a reader would, then
 * measures getComputedStyle on the APPLIED span. The synthetic cases at the
 * end exist only to reach contexts a reader can build but a probe cannot type
 * quickly (a 15px aside, an 11px one, a heading).
 *
 * Usage: node scripts/refute-face-floor.mjs
 */
import { chromium } from 'playwright';

const URL_BASE = 'http://localhost:1420';
let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));

async function boot() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (/tour|tutorial|onboard/i.test(key)) localStorage.removeItem(key);
    }
  });
}

async function openBook(bookId) {
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, bookId);
  await page.waitForSelector('.nb-prose', { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const now = document.querySelectorAll('.nb-prose').length;
      const was = globalThis.__proseSettle ?? -1;
      globalThis.__proseSettle = now;
      return now > 0 && now === was;
    },
    null,
    { polling: 700, timeout: 60000 },
  );
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

const UP = '.nb-seltool-portal.is-up';

console.log('\n=== refute-face-floor ===\n');
await boot();

const bookId = await page.evaluate(async () => {
  const books = await import('/src/data/books.ts');
  const book = await books.createBook({ title: 'Floor refutation', floor: 4, slot: 1 });
  return book.id;
});
console.log(`[book] ${bookId}`);
await openBook(bookId);

/* ---------------------------------------------------------------- 0. the rule
   Is the rule in the LIVE cascade at all, and is it the exact one claimed? */
const rule = await page.evaluate(() => {
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (r.selectorText === '.nb-prose .nb-face') {
        hits.push({
          family: r.style.getPropertyValue('font-family'),
          size: r.style.getPropertyValue('font-size'),
          href: sheet.href ?? '(inline)',
        });
      }
    }
  }
  return hits;
});
console.log('   rule:', JSON.stringify(rule));
check(rule.length === 1, 'exactly one `.nb-prose .nb-face` rule is live', `${rule.length}`);
check(/max\(/.test(rule[0]?.size ?? ''), 'and it clamps the size', rule[0]?.size ?? '');

/* -------------------------------------------------- 1. a real run, by clicking */
console.log('\n1. a run set by pressing the chip');
const proseBox = await page.locator('.nb-prose').first().boundingBox();
await page.mouse.click(proseBox.x + 80, proseBox.y + 18);
await page.waitForTimeout(300);
await page.keyboard.type('The quick brown fox jumps over the lazy dog.', { delay: 8 });
await page.waitForTimeout(500);

async function selectRun(from, len) {
  await page.keyboard.press('Home');
  for (let i = 0; i < from; i += 1) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < len; i += 1) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(500);
}

async function pickFace(hand) {
  await page.waitForFunction(
    () => document.querySelectorAll('.nb-seltool-portal.is-up').length === 1,
    null,
    { polling: 200, timeout: 20000 },
  );
  await page.click(`${UP} .nb-seltool-btn[data-action="face"]`);
  await page.waitForSelector(`${UP} .nb-seltool-faces`, { timeout: 20000 });
  const chip = `${UP} .nb-seltool-face[data-hand="${hand}"]`;
  if ((await page.locator(chip).count()) === 0) {
    await page.click(`${UP} .nb-seltool-more`);
    await page.waitForSelector(`${UP} .nb-seltool-faceall`, { timeout: 20000 });
  }
  await page.click(chip);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

await selectRun(4, 11);
await pickFace('Caveat');

const real = await page.evaluate(() => {
  const span = document.querySelector('.nb-prose span.nb-face[data-hand="Caveat"]');
  const p = span?.closest('p') ?? null;
  return span === null
    ? null
    : {
        text: span.textContent,
        ctx: getComputedStyle(p).fontSize,
        size: getComputedStyle(span).fontSize,
        family: getComputedStyle(span).fontFamily,
        inline: span.getAttribute('style'),
      };
});
console.log('   real run:', JSON.stringify(real));
check(real !== null, 'the chip put a face on the run');
check(/Caveat/.test(real?.family ?? ''), 'drawing in Caveat', real?.family ?? '');
check(
  parseFloat(real?.size ?? '0') === Math.max(20, parseFloat(real?.ctx ?? '0')),
  'at max(floor 20, the paragraph size)',
  `${real?.size} in a ${real?.ctx} paragraph`,
);
await page.screenshot({ path: 'qa/ui/refute-face-01-run.png' });

/* ------------------------------- 2. every hand, in every awkward real context */
console.log('\n2. every hand × five contexts, measured off the live stylesheet');

const matrix = await page.evaluate(async () => {
  const { HANDS } = await import('/src/features/settings/appearance.ts');
  const { faceFloorPx, faceStyleAttr } = await import('/src/editor/marks/face.ts');
  const host = document.querySelector('.nb-prose');
  const CONTEXTS = [
    ['footnote-ish 15px', '15px'],
    ['fine print 11px', '11px'],
    ['tiny 8px', '8px'],
    ['body 19px', '19px'],
    ['heading 42px', '42px'],
  ];
  const rows = [];
  for (const spec of HANDS) {
    for (const [label, size] of CONTEXTS) {
      const p = document.createElement('p');
      p.style.fontSize = size;
      const span = document.createElement('span');
      span.className = 'nb-face';
      span.setAttribute('data-hand', spec.id);
      span.setAttribute('style', faceStyleAttr(spec.id) ?? '');
      span.textContent = 'handwriting';
      p.appendChild(span);
      host.appendChild(p);
      const drawn = parseFloat(getComputedStyle(span).fontSize);
      const fam = getComputedStyle(span).fontFamily;
      host.removeChild(p);
      rows.push({
        hand: spec.id,
        ctx: label,
        ctxPx: parseFloat(size),
        drawn,
        want: faceFloorPx(spec.id),
        fam: fam.split(',')[0].replace(/"/g, ''),
      });
    }
  }
  return rows;
});

const belowFloor = matrix.filter((r) => r.drawn < r.want);
const belowHouse = matrix.filter((r) => r.drawn < 13);
const shrunk = matrix.filter((r) => r.drawn < r.ctxPx);
const wrongMax = matrix.filter((r) => r.drawn !== Math.max(r.want, r.ctxPx));
console.log(`   rows: ${matrix.length}`);
console.log('   sample:', JSON.stringify(matrix.slice(0, 3)));
check(belowHouse.length === 0, 'no hand in any context draws below 13px', JSON.stringify(belowHouse.slice(0, 3)));
check(belowFloor.length === 0, 'no hand draws below its own declared floor', JSON.stringify(belowFloor.slice(0, 3)));
check(shrunk.length === 0, 'no hand ever SHRINKS its context', JSON.stringify(shrunk.slice(0, 3)));
check(
  wrongMax.length === 0,
  'every cell is exactly max(floor, context)',
  JSON.stringify(wrongMax.slice(0, 3)),
);

const floors = Object.fromEntries(matrix.filter((r) => r.ctxPx === 8).map((r) => [r.hand, r.drawn]));
console.log('   floors:', JSON.stringify(floors));
check(floors.Caveat === 20, 'Caveat is floored at 20', `${floors.Caveat}`);
check(floors.Gabriola === undefined || floors.Gabriola === 20, 'Gabriola at 20 where present', `${floors.Gabriola}`);
check(floors['Shadows Into Light'] === 16, 'the light hand at 16', `${floors['Shadows Into Light']}`);
check(floors['Patrick Hand'] === 13, 'the house hand at the house 13', `${floors['Patrick Hand']}`);

/* ---------------------------------------- 3. the smallest context the app has */
console.log('\n3. a real small context: inline code (0.78em)');
const codeCase = await page.evaluate(() => {
  const host = document.querySelector('.nb-prose');
  const p = document.createElement('p');
  const code = document.createElement('code');
  const span = document.createElement('span');
  span.className = 'nb-face';
  span.setAttribute('data-hand', 'Caveat');
  span.setAttribute('style', '--nb-face: "Caveat Variable", cursive; --nb-face-floor: 20px');
  span.textContent = 'inside a snippet';
  code.appendChild(span);
  p.appendChild(code);
  host.appendChild(p);
  const out = {
    codeSize: getComputedStyle(code).fontSize,
    spanSize: getComputedStyle(span).fontSize,
    spanFamily: getComputedStyle(span).fontFamily.split(',')[0],
  };
  host.removeChild(p);
  return out;
});
console.log('   code:', JSON.stringify(codeCase));
check(
  parseFloat(codeCase.spanSize) >= 20,
  'a face inside inline code still clears its floor',
  `${codeCase.spanSize} in ${codeCase.codeSize} code`,
);
check(
  /Cascadia|mono|Consolas|Courier/i.test(codeCase.spanFamily),
  'and the snippet keeps its monospace',
  codeCase.spanFamily,
);

/* --------------------------------- 4. a face with no style attr changes nothing */
console.log('\n4. a bare .nb-face (unknown hand id) is inert');
const inert = await page.evaluate(() => {
  const host = document.querySelector('.nb-prose');
  const p = document.createElement('p');
  p.style.fontSize = '15px';
  const span = document.createElement('span');
  span.className = 'nb-face';
  span.textContent = 'no hand at all';
  p.appendChild(span);
  host.appendChild(p);
  const out = {
    size: getComputedStyle(span).fontSize,
    family: getComputedStyle(span).fontFamily,
    ctx: getComputedStyle(p).fontFamily,
  };
  host.removeChild(p);
  return out;
});
console.log('   inert:', JSON.stringify(inert));
check(parseFloat(inert.size) === 15, 'it keeps the context size', inert.size);
check(inert.family === inert.ctx, 'and the context face', inert.family);

/* ------------------------------------------- 5. survives a full reload (static) */
console.log('\n5. after a full reload');
await boot();
await openBook(bookId);
const after = await page.evaluate(() => {
  const span = document.querySelector('.nb-prose span.nb-face[data-hand="Caveat"]');
  const p = span?.closest('p') ?? null;
  return span === null
    ? null
    : {
        size: getComputedStyle(span).fontSize,
        ctx: getComputedStyle(p).fontSize,
        family: getComputedStyle(span).fontFamily.split(',')[0],
      };
});
console.log('   after:', JSON.stringify(after));
check(after !== null, 'the run came back');
check(parseFloat(after?.size ?? '0') >= 20, 'still at its floor', `${after?.size}`);
await page.screenshot({ path: 'qa/ui/refute-face-02-reloaded.png' });

await page.evaluate(async (id) => {
  const books = await import('/src/data/books.ts');
  await books.deleteBook(id);
}, bookId);
await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
