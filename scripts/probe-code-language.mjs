/**
 * scripts/probe-code-language.mjs — the code block's language picker, driven.
 *
 * The reader's report was two faults in one sentence: *"I noticed for code
 * blocks the dropdown isn't in our app UI, and it also goes all the way down
 * to the bottom."* Both are properties of a running window, and neither is
 * visible from the source: a native <select> renders its list in the
 * COMPOSITOR, outside the DOM, so a unit test cannot see it and a screenshot
 * of the closed control looks fine.
 *
 * So this drives. It inserts a code block, opens the picker with a click and
 * again with the keyboard, and then asserts on things only the real window
 * knows — that the list is an element in this document rather than a platform
 * popup, that its measured height is capped well inside the viewport, that it
 * scrolls inside itself, that arrow keys move the active option and Escape
 * hands focus back to the tab, and that picking a language off the MIDDLE of
 * the list re-highlights the block behind it.
 *
 * Usage: node scripts/probe-code-language.mjs [--url=http://localhost:1420]
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
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  shot ${OUT}/${name}.png`);
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

// The book seeded THIS run, by title: the browser build persists its library,
// so `books[0]` is last run's page with last run's code still in it.
const TITLE = `Language Picker ${Date.now()}`;
await page.evaluate((t) => globalThis.__shelfSeedBooks([t], 0), TITLE);
if ((await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, 60000)) === null) {
  throw new Error('no books on the plank after seeding');
}
await page.waitForTimeout(800);
{
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
// Poll for the editor rather than sleeping at it: the rail is on screen a
// beat before the leaf's ProseMirror is, and rAF is throttled under
// SwiftShader, so a fixed wait here is the classic headless flake.
if ((await poll(() => document.querySelector('.nb-prose') !== null, null, 60000)) === null) {
  throw new Error('the page editor never mounted');
}
await page.waitForTimeout(1200);

/* --------------------------- 1. a block to pick on ----------------------- */
console.log('\n1. a code block on a real page');
const prose = page.locator('.nb-prose').first();
await prose.click();
await page.keyboard.type('```python ');
if (
  (await poll(() => document.querySelector('.nb-prose .nb-code-body') !== null, null, 20000)) ===
  null
) {
  throw new Error('the fence never became a code block');
}
check(
  'a ```python fence made a code block',
  (await page.locator('.nb-prose .nb-code').count()) > 0,
);
// Click INTO the body before typing. Typing straight after the input rule
// fired dropped the whole function on one run in three: the Solid node view
// mounts a frame later and the keystrokes went to the old, replaced DOM.
await page.waitForTimeout(500);
await page.locator('.nb-prose .nb-code-body').first().click();
await page.waitForTimeout(250);
await page.keyboard.type('def totals(items):');
await page.keyboard.press('Enter');
await page.keyboard.type('return sum(items)');
await page.waitForTimeout(500);
const codeText = () =>
  page.evaluate(() => document.querySelector('.nb-prose .nb-code-body')?.textContent ?? '');
check(
  'and the code went into it',
  (await codeText()).includes('def totals'),
  JSON.stringify(await codeText()),
);

/* ------------------- 2. the trigger is the app's, not the OS' ------------- */
console.log('\n2. the control on the tab');
check(
  'there is no native <select> left anywhere in the page',
  (await page.locator('.nb-prose select').count()) === 0,
  `${await page.locator('.nb-prose select').count()} select(s)`,
);
const trigger = page.locator('.nb-prose .nb-code-lang').first();
check('the tab carries a real button', (await trigger.evaluate((el) => el.tagName)) === 'BUTTON');
check(
  'and it says what it is set to, out loud',
  (await trigger.getAttribute('aria-label')) === 'code language — python',
  `${await trigger.getAttribute('aria-label')}`,
);
check(
  'it declares a listbox and says it is shut',
  (await trigger.getAttribute('aria-haspopup')) === 'listbox' &&
    (await trigger.getAttribute('aria-expanded')) === 'false',
);

/* ---------------------- 3. open it, and LOOK at the card ----------------- */
console.log('\n3. the card');
await trigger.click();
await page.waitForTimeout(450);
const card = page.locator('.nb-langpick');
check('a card opened, in this document', (await card.count()) === 1);
check('the trigger now says it is open', (await trigger.getAttribute('aria-expanded')) === 'true');
check(
  'it is a real listbox with real options',
  (await page.locator('.nb-langpick [role="listbox"]').count()) === 1 &&
    (await page.locator('.nb-langpick [role="option"]').count()) > 60,
  `${await page.locator('.nb-langpick [role="option"]').count()} options`,
);
check(
  'the shelves are announced as groups, not as loose text',
  (await page.locator('.nb-langpick [role="group"]').count()) >= 4,
  `${await page.locator('.nb-langpick [role="group"]').count()} groups`,
);
check(
  'the search field has focus, so typing filters instead of editing the code',
  await page.evaluate(() => document.activeElement?.classList.contains('nb-langpick-search')),
);

// THE SECOND FAULT. Measure it, rather than trusting the stylesheet: the box
// has to fit the window with room to spare, and the list has to be scrollable
// inside it (scrollHeight > clientHeight) — a card that fits only because the
// list was truncated would pass a height check and fail the reader.
const box = await page.evaluate(() => {
  const el = document.querySelector('.nb-langpick');
  const list = document.querySelector('.nb-langpick-list');
  if (el === null || list === null) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    bottom: r.bottom,
    height: r.height,
    viewport: window.innerHeight,
    listClient: list.clientHeight,
    listScroll: list.scrollHeight,
  };
});
check('the card was measurable', box !== null, JSON.stringify(box));
check(
  'it does NOT run to the bottom of the window',
  box !== null && box.bottom <= box.viewport - 8,
  `bottom ${Math.round(box?.bottom)} of ${box?.viewport}`,
);
check(
  'it is capped well inside the window',
  box !== null && box.height <= 440 && box.height < box.viewport * 0.6,
  `${Math.round(box?.height)}px tall in a ${box?.viewport}px window`,
);
check(
  'and the list scrolls INSIDE it rather than being cut short',
  box !== null && box.listScroll > box.listClient + 100,
  `${box?.listScroll} of content in ${box?.listClient}px`,
);
check(
  'the card is drawn on the app’s own paper',
  await page.evaluate(() => {
    const el = document.querySelector('.nb-langpick');
    const paper = getComputedStyle(document.documentElement)
      .getPropertyValue('--paper-aged')
      .trim();
    // Compare as rendered colours: the token is a hex, the computed style rgb.
    const probe = document.createElement('span');
    probe.style.color = paper;
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el).backgroundColor === want;
  }),
);
check(
  'the reader’s current language is ticked',
  (await page.locator('.nb-langpick-item.is-current').getAttribute('data-lang')) === 'python',
  `${await page.locator('.nb-langpick-item.is-current').getAttribute('data-lang')}`,
);
await shot('langpick-01-open');

/* ------------------------- 4. the keyboard works ------------------------- */
console.log('\n4. the keyboard');
const activeRow = () =>
  page.evaluate(() => {
    const field = document.querySelector('.nb-langpick-search');
    const id = field?.getAttribute('aria-activedescendant');
    const row = id === null || id === undefined ? null : document.getElementById(id);
    return row === null ? null : { lang: row.dataset.lang, selected: row.getAttribute('aria-selected') };
  });
const first = await activeRow();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const moved = await activeRow();
check(
  'ArrowDown moves the active option',
  first !== null && moved !== null && first.lang !== moved.lang,
  `${first?.lang} -> ${moved?.lang}`,
);
check('and aria-activedescendant points at it', moved?.selected === 'true');
await page.keyboard.press('End');
await page.waitForTimeout(200);
const atEnd = await activeRow();
check('End jumps to the last one', atEnd !== null && atEnd.lang !== moved?.lang, `${atEnd?.lang}`);
check(
  'and the list scrolled to keep it in view',
  await page.evaluate(() => {
    const list = document.querySelector('.nb-langpick-list');
    return list !== null && list.scrollTop > 100;
  }),
  `scrollTop=${await page.evaluate(() => document.querySelector('.nb-langpick-list')?.scrollTop)}`,
);

// The search field: 77 names is why it is here at all.
await page.keyboard.type('kotlin');
await page.waitForTimeout(300);
check(
  'typing narrows the list to what was asked for',
  (await page.locator('.nb-langpick-item').count()) === 1,
  `${await page.locator('.nb-langpick-item').count()} rows`,
);
await shot('langpick-02-search');
for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
await page.waitForTimeout(300);

// Escape closes it AND puts the reader back on the tab they came from.
await page.keyboard.press('Escape');
await page.waitForTimeout(350);
check('Escape closed the card', (await page.locator('.nb-langpick').count()) === 0);
// Polled, not sampled once: the browser settles focus a frame after the card
// is removed from under it, and rAF is throttled to a crawl under SwiftShader.
check(
  'and handed focus back to the tab',
  (await poll(
    () => document.activeElement?.classList.contains('nb-code-lang') === true,
    null,
    4000,
  )) !== null,
  await page.evaluate(() => document.activeElement?.className ?? '(none)'),
);
check(
  'the block is still python — Escape chose nothing',
  (await page.locator('.nb-prose .nb-code').first().getAttribute('data-language')) === 'python',
);

// ...and the keyboard can open it again without a mouse ever being involved.
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(400);
check(
  'ArrowDown on the tab opens the card',
  (await page.locator('.nb-langpick').count()) === 1,
);

// Tab walks out of the card and onto the next control rather than being
// swallowed — the same rule the block's own Tab escape hatch exists for.
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('Tab closed the card too', (await page.locator('.nb-langpick').count()) === 0);
check(
  'and let focus move ON rather than holding it',
  await page.evaluate(() => !(document.activeElement?.classList.contains('nb-langpick-search') ?? false)),
  await page.evaluate(() => document.activeElement?.className ?? '(none)'),
);
await trigger.click();
await page.waitForTimeout(450);

// Pointing anywhere else puts it away. A popover that only closes on its own
// terms is the other half of "this is not our UI" — the reader has to be able
// to walk away from it.
{
  const leaf = await page.locator('.nb-prose').first().boundingBox();
  await page.mouse.click(leaf.x + leaf.width * 0.5, leaf.y + leaf.height * 0.9);
  await page.waitForTimeout(400);
  check(
    'clicking the page put the card away',
    (await page.locator('.nb-langpick').count()) === 0,
  );
  check(
    'and the tab admits it is shut again',
    (await trigger.getAttribute('aria-expanded')) === 'false',
  );
}
await trigger.click();
await page.waitForTimeout(450);

/* ----------- 5. pick one off the MIDDLE, and watch the block change ------- */
console.log('\n5. a language off the middle of the list');
const before = await page.evaluate(() => {
  const el = document.querySelector('.nb-prose .nb-code-body .hljs-keyword');
  return {
    keyword: el?.textContent ?? null,
    tokens: document.querySelectorAll('.nb-prose .nb-code-body [class^="hljs-"]').length,
  };
});
// Deliberately the middle: the top of a list is where a broken picker still
// works by accident, and `rust` sits several shelves down under a heading.
const middle = page.locator('.nb-langpick-item[data-lang="rust"]');
await middle.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
check('a middle row was reachable by scrolling the card', (await middle.count()) === 1);
await shot('langpick-03-middle');
await middle.click();
await page.waitForTimeout(600);
check('the card closed on the pick', (await page.locator('.nb-langpick').count()) === 0);
check(
  'the word on the tab changed',
  (await page.locator('.nb-prose .nb-code-lang-word').first().innerText()).trim() === 'rust',
  await page.locator('.nb-prose .nb-code-lang-word').first().innerText(),
);
check(
  'the BLOCK records it',
  (await page.locator('.nb-prose .nb-code').first().getAttribute('data-language')) === 'rust',
);
check(
  'focus came back to the tab after the pick',
  await page.evaluate(() => document.activeElement?.classList.contains('nb-code-lang')),
);
const after = await page.evaluate(() => {
  const el = document.querySelector('.nb-prose .nb-code-body .hljs-keyword');
  return {
    keyword: el?.textContent ?? null,
    tokens: document.querySelectorAll('.nb-prose .nb-code-body [class^="hljs-"]').length,
  };
});
check(
  'and the code was re-highlighted as rust — different tokens, not just a label',
  before.keyword !== after.keyword || before.tokens !== after.tokens,
  `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
);
check(
  'a keyword is still painted a colour of its own',
  await page.evaluate(() => {
    const el = document.querySelector('.nb-prose .nb-code-body .hljs-keyword');
    const body = document.querySelector('.nb-prose .nb-code-body');
    return el !== null && getComputedStyle(el).color !== getComputedStyle(body).color;
  }),
);
await shot('langpick-04-rust');

/* -------- 6. a block at the FOOT of the window opens the card upward ------ */
console.log('\n6. near the bottom of the window');
// The fault exactly as a reader meets it: the picker on a block near the FOOT
// of a leaf. Shrinking the window does not reproduce it — the spread scales to
// fit, so a block at the top of the page stays at the top of the window — so
// the block has to be walked down the leaf with real content in front of it.
// Out of the block by CLICKING the empty ruled space under it, which is the
// app's own way out ("clicking empty ruled space starts typing there"). The
// triple-Enter exit is not: auto-indent puts spaces on the new line, the two
// trailing lines are therefore not empty, and the first cut of this section
// spent twenty-six lines of prose typing them INSIDE the code block.
{
  const leaf = await page.locator('.nb-prose').first().boundingBox();
  await page.mouse.click(leaf.x + leaf.width * 0.5, leaf.y + leaf.height * 0.8);
  await page.waitForTimeout(400);
}
check(
  'the caret is out of the code block and on the page',
  await page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    return el !== null && el.closest('.nb-prose') !== null && el.closest('.nb-code') === null;
  }),
);
const caret = () =>
  page.evaluate(() => {
    const sel = window.getSelection();
    if (sel === null || sel.rangeCount === 0) return null;
    return { y: sel.getRangeAt(0).getBoundingClientRect().top, vh: window.innerHeight };
  });
// Adaptive rather than a fixed number of lines: the leaf's height depends on
// the reader's paper and the window, and a hard-coded 14 either stops short or
// spills onto the next page — where the block would be at the TOP again,
// which is exactly how the first cut of this section fooled itself.
for (let i = 0; i < 70; i += 1) {
  const at = await caret();
  if (at !== null && at.y > at.vh * 0.68) break;
  await page.keyboard.type('a line of prose');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
}
await page.keyboard.type('```go ');
await page.waitForTimeout(700);
check(
  'a go block was made down there',
  (await page.locator('.nb-prose .nb-code[data-language="go"]').count()) === 1,
  `${await page.locator('.nb-prose .nb-code').count()} block(s) on the spread`,
);
const lowest = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.nb-prose .nb-code-lang')];
  let best = -1;
  let at = -1;
  tabs.forEach((tab, i) => {
    const y = tab.getBoundingClientRect().top;
    if (y > best) {
      best = y;
      at = i;
    }
  });
  return { at, y: best, viewport: window.innerHeight };
});
// The precondition stated as what it actually has to be, rather than as a
// fraction of the window: a full-height card (420px, plus floating-ui's 12px
// padding and the 8px offset) can no longer fit UNDER this tab. That is the
// only thing that makes the next check mean anything.
check(
  'the tab is now too low for a full card to fit under it',
  lowest.at >= 0 && lowest.viewport - lowest.y < 420 + 20,
  `${Math.round(lowest.viewport - lowest.y)}px left below a tab at y=${Math.round(lowest.y)}`,
);
if (lowest.at >= 0) {
  await page.locator('.nb-prose .nb-code-lang').nth(lowest.at).click();
  await page.waitForTimeout(600);
  const flipped = await page.evaluate((at) => {
    const el = document.querySelector('.nb-langpick');
    const tab = document.querySelectorAll('.nb-prose .nb-code-lang')[at];
    if (el === null || tab === undefined) return null;
    const r = el.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const list = document.querySelector('.nb-langpick-list');
    return {
      top: r.top,
      bottom: r.bottom,
      height: r.height,
      tabTop: t.top,
      viewport: window.innerHeight,
      listClient: list?.clientHeight ?? 0,
      listScroll: list?.scrollHeight ?? 0,
    };
  }, lowest.at);
  check('the card opened', flipped !== null, JSON.stringify(flipped));
  check(
    'it turned over and opened ABOVE the tab',
    flipped !== null && flipped.bottom <= flipped.tabTop + 1,
    `card bottom ${Math.round(flipped?.bottom)} vs tab top ${Math.round(flipped?.tabTop)}`,
  );
  check(
    'still inside the window, top and bottom',
    flipped !== null && flipped.top >= 4 && flipped.bottom <= flipped.viewport - 4,
    JSON.stringify(flipped),
  );
  check(
    'and it is still a scrolling list, not a truncated one',
    flipped !== null && flipped.listScroll > flipped.listClient + 100,
  );
  await shot('langpick-05-low');
  await page.keyboard.press('Escape');
}

/* ---- 7. the settings specimen draws the same tab with no button at all --- */
console.log('\n7. the closed control, on its own');
// `SettingsPanel`'s live specimen renders `.nb-code-tab-plate > .nb-code-lang-word`
// with NO button around it. Everything that makes the closed control look like
// a control therefore has to live on the word and its chevron — put it on the
// trigger instead and the settings preview silently loses its dropdown. This
// section is here because that file belongs to somebody else and the CSS
// belongs to this one.
await page.locator('.nbs-gear-button').click();
await page.waitForTimeout(1100);
const section = page.locator(".nbs-section[data-accent='lemon']");
if ((await section.count()) === 0) {
  check('there is a Code blocks section in settings', false);
} else {
  await section.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const spec = await page.evaluate(() => {
    const word = document.querySelector('.nbs-code-preview .nb-code-lang-word');
    if (word === null) return null;
    const r = word.getBoundingClientRect();
    const chevron = getComputedStyle(word, '::after');
    return {
      text: word.textContent,
      w: r.width,
      h: r.height,
      chevron: chevron.borderRightWidth,
      inButton: word.closest('button') !== null,
    };
  });
  check('the specimen still draws the language word', spec !== null, JSON.stringify(spec));
  check(
    'at a real size, with its chevron, and with no button around it',
    spec !== null && spec.w > 20 && spec.h > 8 && parseFloat(spec.chevron) > 0 && !spec.inButton,
    JSON.stringify(spec),
  );
  await shot('langpick-06-settings-specimen');
}
const closeSheet = page.locator('.nbs-close').first();
if (await closeSheet.count()) await closeSheet.evaluate((el) => el.click());
await page.waitForTimeout(700);

/* -------------------------------- report -------------------------------- */
console.log('\nerrors on the page:');
if (errors.size === 0) console.log('  none');
for (const [k, n] of errors) console.log(`  x${n} ${k}`);

console.log(`\n${fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fails.join(', ')}`}`);
await browser.close();
process.exit(fails.length === 0 && errors.size === 0 ? 0 : 1);
