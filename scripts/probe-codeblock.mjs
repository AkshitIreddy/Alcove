/**
 * scripts/probe-codeblock.mjs — the code block, on a real page.
 *
 * A unit test proves the arithmetic and a specimen board proves a module draws
 * well in isolation; neither says whether the app can REACH any of it. This
 * one only drives: open a book, type a fence, paste a function, press Tab,
 * change the language on the block, and change the look in settings — then
 * assert on the APPLIED state (computed styles, the DOM the reader is looking
 * at) rather than on what was merely saved.
 *
 * Usage: node scripts/probe-codeblock.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'qa/ui';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
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
const shot = async (name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${OUT}/${name}.png`);
};
/**
 * Click a control inside the settings sheet.
 *
 * The sheet is a tall scrolling panel and half of these rows start below the
 * fold, so the element is scrolled into its own scroller first. The click is
 * dispatched on the element rather than at a point: a chip that has just
 * moved under a GSAP tween is a real source of flake, and this probe is asking
 * "does this control do what it says", not "can Playwright hit a moving
 * target".
 */
const tap = async (locator) => {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);
  await locator.evaluate((el) => el.click());
  await page.waitForTimeout(400);
};

const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

/* ------------------------------- arrive --------------------------------- */
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
if ((await poll(() => globalThis.__shelfCommands !== undefined, null, 120000)) === null) {
  throw new Error('no QA bridges');
}
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(900);
const TITLE = `Code Notes ${Date.now()}`;
await page.evaluate((t) => globalThis.__shelfSeedBooks([t], 0), TITLE);
if ((await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, 60000)) === null) {
  throw new Error('no books on the plank after seeding');
}
await page.waitForTimeout(800);
{
  // The book seeded THIS run, by title: the browser build persists its
  // library, so `books[0]` is last run's page with last run's code still in
  // it — which is exactly how a probe comes to assert on its own history.
  const spine = await page.evaluate((t) => {
    const book = globalThis.__shelfVisibleBooks().find((b) => b.title === t);
    if (book === undefined) return null;
    const rect = globalThis.__shelfSpineRect(book.id);
    return rect === null ? null : { ...rect };
  }, TITLE);
  if (spine === null) throw new Error('the freshly seeded book is not on the plank');
  const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
  await page.mouse.click(canvas.x + spine.x + spine.width / 2, canvas.y + spine.y + spine.height / 2);
}
await page.locator('[data-testid="pulled-book"][role="button"]').click();
if ((await poll(() => document.querySelector('.nb-rail') !== null, null, 60000)) === null) {
  throw new Error('the book never opened');
}
await page.waitForTimeout(1200);

/* --------------------- 1. a fence, typed, becomes a block ---------------- */
console.log('\n1. typing a fence');
const prose = page.locator('.nb-prose').first();
await prose.click();
await page.keyboard.type('```python ');
await page.waitForTimeout(400);
check(
  'a ```python fence made a code block',
  (await page.locator('.nb-prose .nb-code').count()) > 0,
  `${await page.locator('.nb-prose .nb-code').count()} block(s)`,
);
check(
  'the tab says which language',
  (await page.locator('.nb-prose .nb-code-lang-word').first().innerText()).trim() === 'python',
  await page.locator('.nb-prose .nb-code-lang-word').first().innerText(),
);

/* --------------------------- 2. indentation ------------------------------ */
console.log('\n2. indentation');
await page.keyboard.type('def totals(items):');
await page.keyboard.press('Enter');
await page.keyboard.type('total = 0');
await page.keyboard.press('Enter');
await page.keyboard.type('return total');
await page.waitForTimeout(300);
const codeText = () =>
  page.evaluate(() => document.querySelector('.nb-prose .nb-code-body')?.textContent ?? '');
const typed = await codeText();
check(
  'Enter after a python colon indented four spaces',
  typed.includes('\n    total = 0'),
  JSON.stringify(typed),
);
check('the next line kept that indentation', typed.includes('\n    return total'));

// Tab and Shift-Tab over a SELECTION, where they are inverses.
//
// Deliberately not `Home` + Tab: `Home` does not move the caret in this
// build, so that version of the test was quietly measuring a Tab at the end
// of the line and calling the asymmetry a failure. Shift+ArrowLeft is a
// reader's keystroke too, and it lands somewhere this probe can name.
for (let i = 0; i < 12; i += 1) {
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(30);
}
// Assert the selection before assuming it: a run of Shift+ArrowLeft fired
// with no gap between the presses does not always land, and a probe that
// skips this measures an empty-selection Tab and blames the feature.
check(
  'twelve Shift+ArrowLeft presses selected twelve characters',
  await page.evaluate(() => {
    const sel = window.getSelection();
    return sel !== null && !sel.isCollapsed && sel.toString().length === 12;
  }),
  await page.evaluate(() => JSON.stringify(window.getSelection()?.toString() ?? null)),
);
await page.keyboard.press('Tab');
await page.waitForTimeout(250);
const afterTab = await codeText();
check(
  'Tab indented the line the selection sits on',
  afterTab.length === typed.length + 4,
  `${typed.length} -> ${afterTab.length}`,
);
check(
  'and the caret is still in the page',
  await page.evaluate(() => document.activeElement?.closest('.nb-prose') !== null),
);
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(250);
check('Shift-Tab put it back', (await codeText()) === typed, JSON.stringify((await codeText()).slice(-20)));

/* --------- 3. Escape hands Tab back, so a keyboard reader can leave ------ */
console.log('\n3. the escape hatch');
await page.keyboard.press('ArrowRight'); // collapse the selection first
// Watch what the editor DOES with the Tab rather than where focus ends up:
// in a headless window the element after the page is browser chrome, so
// `activeElement` is not a reliable witness. `defaultPrevented` is — it is
// literally the question "did the editor take this key away from you".
await page.evaluate(() => {
  globalThis.__tabPrevented = null;
  // NOT `{ once: true }`: the Escape that arms the release is a keydown too,
  // and a one-shot listener spends itself on that one and never sees the Tab.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') globalThis.__tabPrevented = e.defaultPrevented;
  });
});
await page.keyboard.press('Escape');
await page.keyboard.press('Tab');
await page.waitForTimeout(250);
const escaped = await codeText();
check('Escape then Tab did NOT indent', escaped === typed, JSON.stringify(escaped.slice(-12)));
check(
  'and the editor handed the key back to the browser',
  (await page.evaluate(() => globalThis.__tabPrevented)) === false,
  `defaultPrevented=${await page.evaluate(() => globalThis.__tabPrevented)}`,
);
// …and once the reader is back in the block, Tab indents again: the release
// is one press, not a mode. (Clicking back in is the point — the released Tab
// moved focus out, which is the whole thing it exists to allow.)
await page.locator('.nb-prose .nb-code-body').first().click();
await page.keyboard.press('Tab');
await page.waitForTimeout(250);
check(
  'the release lasted exactly one press',
  (await codeText()).length === typed.length + 4,
  `${typed.length} -> ${(await codeText()).length}`,
);
await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(250);
check(
  'the block says how to leave, in its own footer',
  (await page.locator('.nb-prose .nb-code-hint').first().innerText()).includes('Esc'),
);

/* ---------------------- 4. line numbers are really drawn ----------------- */
console.log('\n4. line numbers');
const numbers = await page.evaluate(() =>
  // `dataset.line`, not `textContent`: the digits are generated content, and
  // that is deliberate — see the widget factory in nodes/codeBlock.tsx.
  [...document.querySelectorAll('.nb-prose .nb-code-num')].map((n) => n.dataset.line),
);
check('one number per logical line', numbers.join(',') === '1,2,3', numbers.join(','));
const hang = await page.evaluate(() => {
  const num = document.querySelector('.nb-prose .nb-code-num');
  const body = document.querySelector('.nb-prose .nb-code-body');
  if (!num || !body) return null;
  // The geometry lives on the ::before that draws the digits, not on the span
  // — the span wraps a real character of the reader's code.
  const n = getComputedStyle(num, '::before');
  const b = getComputedStyle(body);
  return { margin: n.marginLeft, width: n.width, padding: b.paddingLeft };
});
check(
  'the number hangs in the padding rather than pushing the code across',
  hang !== null && parseFloat(hang.margin) === -parseFloat(hang.width),
  JSON.stringify(hang),
);

/* ----------------------- 5. highlighting is applied ---------------------- */
console.log('\n5. colours');
const tokens = await page.evaluate(() => {
  const el = document.querySelector('.nb-prose .nb-code-body .hljs-keyword');
  const plate = document.querySelector('.nb-prose .nb-code');
  return el === null || plate === null
    ? null
    : {
        keyword: getComputedStyle(el).color,
        ink: getComputedStyle(document.querySelector('.nb-prose .nb-code-body')).color,
        plate: getComputedStyle(plate).backgroundColor,
      };
});
check('a keyword is painted', tokens !== null, JSON.stringify(tokens));
check(
  'and it is not the same colour as the surrounding code',
  tokens !== null && tokens.keyword !== tokens.ink,
  JSON.stringify(tokens),
);
await shot('code-01-typed');

/* ------------------- 6. the language picker on the block ----------------- */
console.log('\n6. the language picker');
/*
 * The language picker is no longer a native <select>, so `selectOption` cannot
 * drive it — it is an in-app listbox (`.nb-langpick`) opened from a trigger
 * button, which is the whole point of the change: a system dropdown dropped
 * into a hand-drawn notebook, running the full height of the window.
 *
 * `pickLanguage` clicks it the way a reader does. Left as a helper rather than
 * inlined twice because the next rename should cost one edit, not two.
 */
const pickLanguage = async (id) => {
  await page.locator('.nb-prose .nb-code-lang').first().click();
  await page.waitForSelector('.nb-langpick [role="option"]', { timeout: 10_000 });
  await page.locator(`.nb-langpick [role="option"][data-lang="${id}"]`).first().click();
  await page.waitForTimeout(350);
};

await pickLanguage('rust');
check(
  'picking rust changed the word on the tab',
  (await page.locator('.nb-prose .nb-code-lang-word').first().innerText()).trim() === 'rust',
);
check(
  'and the block records it',
  (await page.locator('.nb-prose .nb-code').first().getAttribute('data-language')) === 'rust',
);
await pickLanguage('python');

/* --------------------- 7. pasting a fenced snippet ----------------------- */
console.log('\n7. pasting');
await page.evaluate(() => {
  const prose = document.querySelector('.nb-prose');
  prose.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(prose.lastElementChild ?? prose);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const pasted = await page.evaluate(() => {
  const target = document.querySelector('.nb-prose');
  const dt = new DataTransfer();
  dt.setData('text/plain', '```sql\nSELECT id, name FROM books WHERE shelf = 3;\n```');
  target.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
  );
  return true;
});
await page.waitForTimeout(500);
const blocks = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-prose .nb-code')].map((b) => b.dataset.language),
);
check('a pasted markdown fence became a second code block', blocks.length >= 2, blocks.join(','));
check('with the language it declared', blocks.includes('sql'), blocks.join(','));
check(
  'and the backticks are not in the page',
  !(await page.evaluate(() => document.querySelector('.nb-prose').textContent.includes('```'))),
);
await shot('code-02-pasted');

/* ------------------------ 8. the look, from settings --------------------- */
console.log('\n8. the look is the reader’s');
const before = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.nb-prose .nb-code')).backgroundColor,
);
await page.keyboard.press('Escape');
// The reader's way in, and the only one: the gear at the corner of the app.
// The sheet is ALWAYS in the DOM (`visibility: hidden` at rest, revealed by
// GSAP), so finding `.nbs-sheet` proves nothing — the probe has to open it and
// then check it is actually visible, or it is clicking controls nobody can
// see.
await page.locator('.nbs-gear-button').click();
await page.waitForTimeout(1100);
check(
  'the settings sheet is open and visible',
  await page.evaluate(() => {
    const sheet = document.querySelector('.nbs-sheet');
    if (sheet === null) return false;
    const style = getComputedStyle(sheet);
    const rect = sheet.getBoundingClientRect();
    return style.visibility === 'visible' && rect.right > 0 && rect.left < window.innerWidth;
  }),
);
const section = page.locator(".nbs-section[data-accent='lemon']");
check('there is a Code blocks section in settings', (await section.count()) > 0);
if (await section.count()) {
  await section.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  check(
    'it shows a live specimen',
    (await section.locator('.nbs-code-preview').count()) > 0,
  );
  check(
    'and a key to the seven colours',
    (await section.locator('.nbs-code-legend-item').count()) === 7,
    `${await section.locator('.nbs-code-legend-item').count()}`,
  );
  await shot('code-03-settings');

  // Pick a dark plate, and check the PAGE changed, not just the panel.
  // Attribute locators, not `getByRole`: the sheet sits under an aria-hidden
  // ancestor while it is open, so nothing inside it is in the accessibility
  // tree for Playwright to find by role.
  const lamplight = section.locator('[aria-label="lamplight code look"]');
  if (await lamplight.count()) {
    await tap(lamplight.first());
    await page.waitForTimeout(600);
    const after = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.nb-prose .nb-code')).backgroundColor,
    );
    check('choosing a dark plate repainted the real block', after !== before, `${before} -> ${after}`);
    await shot('code-04-lamplight-settings');
  }

  // Frames, faces, numbers — each one has to reach the page.
  const rule = section.locator('[aria-label="code block drawn as a margin rule"]');
  if (await rule.count()) {
    await tap(rule.first());
    await page.waitForTimeout(400);
    check(
      'the margin-rule frame reached <html>',
      (await page.evaluate(() => document.documentElement.dataset.codeFrame)) === 'rule',
    );
  }
  const numbersToggle = section.locator('[role="switch"][aria-label="code line numbers"]');
  if (await numbersToggle.count()) {
    await tap(numbersToggle);
    await page.waitForTimeout(400);
    check(
      'turning line numbers off reached <html>',
      (await page.evaluate(() => document.documentElement.dataset.codeNumbers)) === 'off',
    );
  }
  await shot('code-05-frames');

  // Put it back to the shipped look and photograph the page itself.
  const marginalia = section.locator('[aria-label="marginalia code look"]');
  if (await marginalia.count()) await tap(marginalia.first());
  const plate = section.locator('[aria-label="code block drawn as a filing tab"]');
  if (await plate.count()) await tap(plate.first());
  if (await numbersToggle.count()) await tap(numbersToggle);
  await page.waitForTimeout(500);
}
const close = page.locator('.nbs-close').first();
if (await close.count()) await tap(close);
await page.waitForTimeout(900);
await shot('code-06-page');

/* -------------------------------- report -------------------------------- */
console.log('\nerrors on the page:');
if (errors.size === 0) console.log('  none');
for (const [k, n] of errors) console.log(`  x${n} ${k}`);

console.log(`\n${fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fails.join(', ')}`}`);
await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
