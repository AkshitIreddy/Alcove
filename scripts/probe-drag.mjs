/**
 * scripts/probe-drag.mjs — can a block actually be dragged?
 *
 * The reader: *"Step 10 does not allow dragging stuff. In fact dragging does
 * not work even outside the tutorial."* The second sentence is the bug; the
 * step is only where it was noticed.
 *
 * So this asks the app, not the tutorial. It opens a book, finds the drag
 * handle the way a reader does — by putting the pointer over a paragraph — and
 * then drags it, checking after each stage that the thing a reader would be
 * looking for is really there:
 *
 *   1. does hovering a block reveal a handle at all?
 *   2. does pressing it start a drag (ProseMirror sets its own dragging state)?
 *   3. does releasing over another block MOVE the paragraph?
 *
 * Reported per stage rather than as one pass/fail, because "dragging is broken"
 * has three quite different causes and the stage that fails names it.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
};

console.log('1. open a book');
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click();
  await page.waitForTimeout(1000);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(4000);

console.log('\n2. hover a paragraph and look for the handle');
const paras = page.locator('.nb-prose p');
const n = await paras.count();
check('there are paragraphs to drag', n >= 2, `${n} found`);
if (n < 2) {
  await browser.close();
  process.exit(1);
}

const first = paras.nth(0);
const box = await first.boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForTimeout(900);

const handle = page.locator('.nb-drag-handle');
const handleCount = await handle.count();
check('a drag handle exists in the DOM', handleCount > 0, `${handleCount} node(s)`);

const shown = await page.evaluate(() => {
  const el = document.querySelector('.nb-drag-handle');
  if (el === null) return null;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    display: s.display,
    visibility: s.visibility,
    opacity: s.opacity,
    pointerEvents: s.pointerEvents,
    w: Math.round(r.width),
    h: Math.round(r.height),
    x: Math.round(r.x),
    y: Math.round(r.y),
    draggable: el.getAttribute('draggable'),
  };
});
console.log('   handle:', JSON.stringify(shown));
check(
  'the handle is visible where a reader could press it',
  shown !== null && shown.display !== 'none' && shown.visibility !== 'hidden' &&
    Number(shown.opacity) > 0.05 && shown.w > 0 && shown.h > 0,
);
check(
  'and it accepts the pointer',
  shown !== null && shown.pointerEvents !== 'none',
  shown === null ? undefined : `pointer-events: ${shown.pointerEvents}`,
);
await page.screenshot({ path: 'qa/ui/drag-01-handle.png' });

console.log('\n3. drag the first paragraph past the second');
const textBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-prose p')].slice(0, 3).map((p) => p.textContent?.trim() ?? ''),
);
console.log('   before:', JSON.stringify(textBefore.map((t) => t.slice(0, 26))));

/*
 * Playwright's raw mouse API is NOT enough here, and getting that wrong would
 * blame the app for the harness. The handle carries `draggable="true"` and
 * @tiptap/extension-drag-handle listens for NATIVE HTML5 drag events
 * (dragstart/dragover/drop). `mouse.down()` + `mouse.move()` + `mouse.up()`
 * fires pointer and mouse events only — Chromium never synthesises a dragstart
 * from them — so a hand-rolled drag reports "nothing moved" against an app that
 * is working perfectly.
 *
 * `page.dragAndDrop()` turns on Chromium's drag interception and does emit the
 * real sequence. Both are run below: if the native one moves the block and the
 * synthetic one does not, the app is fine and the tutorial's step is what needs
 * looking at.
 */
if (shown !== null && shown.w > 0) {
  const target = await paras.nth(2).boundingBox();

  // A. the synthetic mouse drag — what a hand-rolled probe would do
  await page.mouse.move(shown.x + shown.w / 2, shown.y + shown.h / 2);
  await page.mouse.down();
  await page.waitForTimeout(140);
  const draggingSynthetic = await page.evaluate(
    () => document.querySelector('.ProseMirror')?.classList.contains('dragging') === true,
  );
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(
      shown.x + shown.w / 2,
      shown.y + ((target.y + target.height + 8 - shown.y) * i) / 6,
    );
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterSynthetic = await page.evaluate(() =>
    [...document.querySelectorAll('.nb-prose p')].slice(0, 3).map((p) => p.textContent?.trim() ?? ''),
  );
  console.log(
    `   synthetic mouse drag: dragging=${draggingSynthetic}, moved=${afterSynthetic[0] !== textBefore[0]}`,
  );

  // B. the native HTML5 drag — what a reader's mouse actually produces
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForTimeout(700);
  try {
    await page.dragAndDrop('.nb-drag-handle', '.nb-prose p:nth-of-type(3)', {
      timeout: 15_000,
      force: true,
    });
  } catch (err) {
    console.log(`   dragAndDrop threw: ${String(err).split(/\r?\n/)[0]}`);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'qa/ui/drag-02-mid.png' });
}

const textAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.nb-prose p')].slice(0, 3).map((p) => p.textContent?.trim() ?? ''),
);
console.log('   after: ', JSON.stringify(textAfter.map((t) => t.slice(0, 26))));
check(
  'a native HTML5 drag moves the paragraph',
  textBefore[0] !== textAfter[0] || textBefore[1] !== textAfter[1],
  textBefore[0] === textAfter[0] ? 'the order is unchanged' : undefined,
);
await page.screenshot({ path: 'qa/ui/drag-03-after.png' });

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
