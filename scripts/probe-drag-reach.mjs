/**
 * scripts/probe-drag-reach.mjs — can the pointer actually GET to the handle?
 *
 * `probe-drag.mjs` proved a block can be dragged once you are holding the
 * handle. It does not prove a reader can ever take hold of it, and those are
 * different claims — which is the gap the earlier "dragging works headless"
 * conclusion fell into.
 *
 * The hypothesis worth testing: the handle is drawn in the LEFT GUTTER, outside
 * the block's own box, and `@tiptap/extension-drag-handle` hides it when the
 * pointer leaves the node it belongs to. If the gutter is not part of the
 * block's hover region, then the journey from the text to the handle crosses
 * dead ground — the handle disappears halfway and the reader arrives at
 * nothing. That would be intermittent (it depends on the path the mouse takes
 * and how fast), it would look exactly like "dragging does not work", and it
 * would be invisible to any probe that teleports the pointer straight onto the
 * handle, which is what every probe here has done so far.
 *
 * So this walks the pointer across in steps, the way a hand does, and asks at
 * every step whether the handle is still there.
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
  await page.waitForTimeout(900);
}
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await page.waitForTimeout(4500);

const handleState = () =>
  page.evaluate(() => {
    const el = document.querySelector('.nb-drag-handle');
    if (el === null) return { present: false };
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      present: true,
      visible:
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity) > 0.05 &&
        r.width > 0,
      opacity: Number(s.opacity),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });

console.log('\n2. where is the handle relative to the block it belongs to?');
const para = page.locator('.nb-prose p').nth(1);
const box = await para.boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForTimeout(900);
const h = await handleState();
console.log('   block :', JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }));
console.log('   handle:', JSON.stringify(h));
check('the handle appears when the block is hovered', h.present && h.visible);

const gap = Math.round(box.x - (h.x + h.w));
console.log(`   the handle sits ${gap}px to the LEFT of the block's own box`);
check(
  'and it is OUTSIDE the block — so the pointer must cross to reach it',
  h.x + h.w <= box.x + 1,
  `handle right edge ${h.x + h.w}, block left edge ${Math.round(box.x)}`,
);

console.log('\n3. walk the pointer from the text to the handle, a hand’s width at a time');
const from = { x: box.x + 40, y: box.y + box.height * 0.5 };
const to = { x: h.x + h.w / 2, y: h.y + h.h / 2 };
const STEPS = 14;
const trail = [];
for (let i = 0; i <= STEPS; i += 1) {
  const t = i / STEPS;
  await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  await page.waitForTimeout(45);
  const s = await handleState();
  trail.push({ x: Math.round(from.x + (to.x - from.x) * t), ok: s.present && s.visible });
}
console.log(
  '   ' +
    trail
      .map((p) => `${p.x}${p.ok ? '' : '✗'}`)
      .join(' → '),
);
const lost = trail.filter((p) => !p.ok);
check(
  'the handle stays put the whole way across',
  lost.length === 0,
  lost.length > 0 ? `it vanished at x=${lost.map((p) => p.x).join(', ')}` : undefined,
);

console.log('\n4. and is it still there once the pointer is ON it?');
const onIt = await handleState();
console.log('   ', JSON.stringify(onIt));
check('the handle survives being hovered itself', onIt.present && onIt.visible);
await page.screenshot({ path: 'qa/ui/drag-reach.png' });

console.log('\n5. the diagonal a real hand takes, not a straight line');
// A reader aims for the handle from wherever they were reading — usually from
// further right and a line or two down, so the path leaves the block early.
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 1.6);
await page.waitForTimeout(600);
const before = await handleState();
for (let i = 1; i <= 12; i += 1) {
  const t = i / 12;
  await page.mouse.move(
    box.x + box.width * 0.8 + (to.x - (box.x + box.width * 0.8)) * t,
    box.y + box.height * 1.6 + (to.y - (box.y + box.height * 1.6)) * t,
  );
  await page.waitForTimeout(45);
}
const after = await handleState();
console.log('   before the sweep:', JSON.stringify(before));
console.log('   after the sweep: ', JSON.stringify(after));
check(
  'a diagonal approach still finds a handle to grab',
  after.present && after.visible,
);

console.log('\nerrors:', errors.length ? errors.slice(0, 3) : 'none');
console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
