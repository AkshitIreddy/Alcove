/**
 * shots-now/diag-deselect.mjs — why will the diagram not deselect?
 *
 * `readme-shots.mjs` step 12 stops with "a diagram will not deselect — its edit
 * chrome is showing". That guard exists so the README never ships a picture of
 * the app mid-edit, and it is firing on a run where it used to pass, so
 * something in the tree changed under it.
 *
 * This replays exactly the same navigation and then, instead of throwing,
 * REPORTS: where the leaf is, what element is actually under the point the
 * capture clicks, what the selection is before and after, and whether the click
 * reached the editor at all. Diagnosis before repair — the wrong fix here is to
 * move the click a few percent until the guard goes quiet, because that would
 * hide a real regression in where a reader's own click lands.
 *
 *   npm run dev
 *   node shots-now/diag-deselect.mjs
 */
import { chromium } from 'playwright';

const URL = 'http://localhost:1420/?fx=force&dev=0';
const wait = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

/** What ProseMirror thinks is selected, named rather than guessed. */
const selection = () =>
  page.evaluate(() => {
    const el = document.querySelector('.ProseMirror');
    const view = el && (el.pmViewDesc?.view ?? globalThis.__pmView);
    const sel = view?.state?.selection;
    return {
      hasEditor: Boolean(el),
      hasView: Boolean(view),
      type: sel ? sel.constructor.name : null,
      from: sel?.from ?? null,
      empty: sel?.empty ?? null,
      selectedDiagrams: document.querySelectorAll('.nb-diagram.is-selected').length,
      editingDiagrams: document.querySelectorAll('.nb-diagram.is-editing').length,
      activeEl: document.activeElement?.className || document.activeElement?.tagName || null,
    };
  });

console.log('1. boot');
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(URL, { waitUntil: 'domcontentloaded' });
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
  await wait(page, 1200);
}

console.log('2. open the Welcome book');
// Opened through the store, exactly as readme-shots.mjs step 6 does it — the
// point of this probe is the deselect, not the pull-out gesture.
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-rail', { timeout: 60_000 });
await page.waitForSelector('.nb-prose p', { timeout: 60_000 });
await wait(page, 9000);

if ((await page.locator('.nb-flip-leaf-right').count()) === 0) {
  console.log('   no book opened — clicking the shelf did not get us in');
  console.log('   errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(1);
}

console.log('3. flip until a diagram is on screen');
let turns = 0;
while (turns < 12 && (await page.locator('.nb-diagram').count()) === 0) {
  const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
  await page.mouse.click(leaf.x + leaf.width - 12, leaf.y + leaf.height * 0.5);
  turns += 1;
  await wait(page, 3000);
}
console.log(`   ${turns} turns, ${await page.locator('.nb-diagram').count()} diagram(s) on screen`);

await page
  .waitForFunction(() => document.querySelectorAll('.nb-diagram-skeleton').length === 0, null, {
    polling: 300,
    timeout: 60_000,
  })
  .catch(() => console.log('   (skeletons never cleared)'));
await wait(page, 2600);

console.log('\n4. state BEFORE the deselect click');
console.log('  ', JSON.stringify(await selection()));

const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
console.log('\n5. the leaf and the point the capture clicks');
console.log('   leaf box:', JSON.stringify(leaf));
const px = leaf.x + leaf.width * 0.45;
const py = leaf.y + leaf.height * 0.95;
console.log(`   click point: ${Math.round(px)}, ${Math.round(py)}  (45% across, 95% down)`);

const under = await page.evaluate(
  ([x, y]) => {
    const stack = document.elementsFromPoint(x, y).slice(0, 6);
    return stack.map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')} [${Math.round(r.width)}x${Math.round(r.height)}]`;
    });
  },
  [px, py],
);
console.log('   element stack at that point, front to back:');
under.forEach((u, i) => console.log(`     ${i}. ${u}`));

console.log('\n6. click it, the way the capture does');
await page.mouse.click(px, py);
await wait(page, 1400);
console.log('   state AFTER:', JSON.stringify(await selection()));

console.log('\n6b. WHICH leaf holds the selected diagram?');
console.log(
  '   ',
  JSON.stringify(
    await page.evaluate(() => {
      const where = (el) => {
        if (el.closest('.nb-flip-leaf-left')) return 'left';
        if (el.closest('.nb-flip-leaf-right')) return 'right';
        return 'neither';
      };
      return {
        all: [...document.querySelectorAll('.nb-diagram')].map(where),
        selected: [...document.querySelectorAll('.nb-diagram.is-selected')].map(where),
        editors: document.querySelectorAll('.ProseMirror').length,
        editorsPerLeaf: {
          left: document.querySelectorAll('.nb-flip-leaf-left .ProseMirror').length,
          right: document.querySelectorAll('.nb-flip-leaf-right .ProseMirror').length,
        },
      };
    }),
  ),
);

console.log('\n7. errors:', errors.length ? errors.slice(0, 5) : 'none');
await page.screenshot({ path: 'shots-now/out/diag-deselect.png' });
console.log('   wrote shots-now/out/diag-deselect.png');
await browser.close();
