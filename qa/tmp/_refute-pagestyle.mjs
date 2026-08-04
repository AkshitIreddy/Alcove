/**
 * qa/tmp/_refute-pagestyle.mjs — why does the page-style step's card land ON
 * the Page style sheet? Dumps the anchor, the card, the published lane and the
 * sheet's live box, sampled over four seconds.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL_BASE = 'http://localhost:1420';
const OUT = 'qa/tmp/refute-lane';
const VP = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: VP });
const page = await context.newPage();
const poll = async (fn, arg = null, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(100);
  }
};
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfCommands !== undefined, null, 120000);
{
  const skip = page.getByText('skip the tour');
  if (await skip.count()) await skip.first().click();
}
await page.waitForTimeout(700);
await page.evaluate(() => globalThis.__shelfSeedBooks(['Cell Biology'], 0));
await poll(() => (globalThis.__shelfVisibleBooks?.() ?? []).length > 0, null, 60000);
await page.waitForTimeout(700);
{
  let pulled = false;
  for (let attempt = 0; attempt < 4 && !pulled; attempt += 1) {
    const spine = await page.evaluate(() => {
      const book = globalThis.__shelfVisibleBooks()[0];
      return book === undefined ? null : globalThis.__shelfSpineRect(book.id);
    });
    const canvas = await page.locator('canvas.shelf-canvas').boundingBox();
    await page.mouse.click(canvas.x + spine.x + spine.width / 2, canvas.y + spine.y + spine.height / 2);
    pulled =
      (await poll(
        () => document.querySelector('[data-testid="pulled-book"][role="button"]') !== null,
        null,
        6000,
      )) !== null;
  }
}
await page.locator('[data-testid="pulled-book"][role="button"]').click();
await poll(() => document.querySelector('.nb-rail') !== null, null, 60000);
await page.waitForTimeout(1200);

const dump = async (tag) =>
  page.evaluate((t) => {
    const st = globalThis.__nbTutorial.getState();
    const panels = Array.from(document.querySelectorAll('.nb-rail-panel[aria-hidden="false"]')).map(
      (el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.getAttribute('aria-label'),
          box: [Math.round(r.x), Math.round(r.right), Math.round(r.width)],
          cls: el.className,
        };
      },
    );
    const btn = document.querySelector('.nb-rail-button[data-tool="page-style"]');
    const br = btn?.getBoundingClientRect();
    return {
      tag: t,
      step: st.stepId,
      anchor: st.anchor && [Math.round(st.anchor.x), Math.round(st.anchor.x + st.anchor.width)],
      card: [Math.round(st.card.x), Math.round(st.card.x + st.card.width)],
      lane: st.lane,
      inlineEdge: document.documentElement.style.getPropertyValue('--nb-panel-edge'),
      computedEdge: getComputedStyle(document.documentElement).getPropertyValue('--nb-panel-edge'),
      panels,
      button: br ? [Math.round(br.x), Math.round(br.right)] : null,
    };
  }, tag);

for (const run of [1, 2]) {
  await page.evaluate(() => globalThis.__nbTutorial.start());
  await page.waitForTimeout(300);
  await page.evaluate(() => globalThis.__nbTutorial.chooseLength('full'));
  await page.waitForTimeout(300);
  const idx = await page.evaluate(() =>
    globalThis.__nbTutorial.getState().stepIds.indexOf('page-style'),
  );
  await page.evaluate((i) => globalThis.__nbTutorial.jumpTo(i), idx);
  await page.waitForTimeout(500);
  await page.evaluate(() => globalThis.__nbTutorial.hold());
  console.log(`\n--- run ${run}: before the press ---`);
  console.log(JSON.stringify(await dump('before')));
  await page.locator('.nb-rail-button[data-tool="page-style"]').click();
  for (const wait of [150, 350, 500, 1000, 2000, 4000]) {
    await page.waitForTimeout(wait === 150 ? 150 : wait - 0);
    await page.evaluate(() => globalThis.__nbTutorial.hold());
    console.log(JSON.stringify(await dump(`+${wait}`)));
  }
  await page.screenshot({ path: `${OUT}/pagestyle-run${run}.png` });
  // put it away for the next run
  await page.locator('.nb-rail-panel-close').first().click().catch(() => {});
  await page.waitForTimeout(800);
}
await browser.close();
