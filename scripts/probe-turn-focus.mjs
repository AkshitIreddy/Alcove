/**
 * scripts/probe-turn-focus.mjs — R2: is the keyboard still able to turn a page?
 *
 * A REGRESSION probe, written before the fix it guards.
 *
 * With `qa/wip/BookView.duplication-fix-v1.tsx` applied, reading the Welcome
 * book left the ArrowRight key DEAD after a couple of turns. Corner clicks
 * still worked, which is what makes this worth its own probe rather than a
 * line in the turn-advance one: the flip machinery was fine, the KEY was gone.
 *
 * The cause is a guard, not a bug in the guard. `arrowFlipAction`
 * (views/spread.ts) takes an `isTyping` flag and returns null when it is set,
 * because ArrowRight inside a paragraph must move the caret and not the page.
 * BookView passes `isTypingTarget(document.activeElement)`. So the moment
 * anything puts focus inside a `.ProseMirror`, every arrow key is swallowed —
 * silently, with no visible caret, and the reader concludes the book is stuck.
 *
 * v1 did exactly that: its carry hands blocks to a live editor and the caret
 * chase (`focusPageCaret`) follows the carried cursor into that editor, so
 * merely turning pages ended with the focus captured. Baseline behaviour is
 * that focus stays on BODY through a read and all six turns advance.
 *
 * So: turn six times, and after every turn record where focus actually IS and
 * whether the spread moved. Both are asserted — a fix that keeps the arrows
 * alive by loosening the `isTyping` guard would break typing instead, and
 * would show up here as focus sitting in a ProseMirror while turns still work.
 *
 * Passes on HEAD. Fails with v1 applied. Exits non-zero on failure.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const TURNS = 6;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

const bookId = await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
  return w ? w.id : null;
});
if (!bookId) { console.error('FAIL: no book on the shelf to open'); await browser.close(); process.exit(1); }
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
await page.waitForTimeout(5000);
// The stage carries the spread index; without it there is nothing to measure,
// and a run that reports every turn as a non-advance would be blaming the
// fix for a book that never opened.
if (await page.locator('.nb-spread-stage').count() === 0) {
  console.error('FAIL: the book view is not on screen after opening it');
  await browser.close();
  process.exit(1);
}

/** Where the keyboard's attention is, and which spread is on screen. */
const readFocus = async () =>
  page.evaluate(() => {
    const stage = document.querySelector('.nb-spread-stage');
    const el = document.activeElement;
    const cls = el instanceof Element ? (el.getAttribute('class') ?? '') : '';
    return {
      index: stage ? Number(stage.getAttribute('data-spread-index')) : -1,
      tag: el ? el.tagName.toLowerCase() : 'null',
      cls: cls.slice(0, 60),
      // The exact condition `isTypingTarget` trips on — an editor has the
      // keyboard, so arrowFlipAction will refuse to turn the page.
      inProse: el instanceof Element && el.closest('.ProseMirror') !== null,
    };
  });

const start = await readFocus();
console.log(`opened at spread ${start.index}, focus on <${start.tag}> ${start.cls || '(no class)'}\n`);

let previous = start.index;
const stalled = [];
const captured = [];
for (let i = 1; i <= TURNS; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2600);
  const now = await readFocus();
  const advanced = now.index > previous;
  if (!advanced) stalled.push(`turn ${i}: ArrowRight left the spread at ${now.index}`);
  if (now.inProse) captured.push(`turn ${i}: focus is <${now.tag}> ${now.cls}`);
  console.log(
    `  ${advanced && !now.inProse ? 'ok  ' : 'BAD '} turn ${i}: ` +
      `spread ${previous} -> ${now.index}, focus <${now.tag}> ${now.cls || '(no class)'}` +
      (now.inProse ? '  <-- captured by a ProseMirror' : ''),
  );
  previous = now.index;
}

const end = await readFocus();
console.log('\n--- R2: the arrow key still turns pages, focus is not stolen ---');
console.log(`  ArrowRight presses that did not advance: ${stalled.length}`);
for (const s of stalled) console.log(`     ${s}`);
console.log(`  turns that ended with focus in an editor: ${captured.length}`);
for (const c of captured) console.log(`     ${c}`);
console.log(`  focus after all ${TURNS} turns: <${end.tag}> ${end.cls || '(no class)'}`);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');

const failed = stalled.length > 0 || end.inProse || captured.length > 0;
console.log(failed ? '\nR2 FAIL' : '\nR2 PASS');
await browser.close();
process.exit(failed ? 1 : 0);
