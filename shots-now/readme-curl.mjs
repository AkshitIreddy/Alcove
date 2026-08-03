/**
 * shots-now/readme-curl.mjs — catch the page-curl mid-turn.
 *
 * The flip is the one feature a still photograph of the spread cannot show, so
 * this fires the turn and shoots on a short timer WITHOUT `animations:
 * 'disabled'` — that option freezes CSS/Web animations at their end state,
 * which is precisely the frame we do not want. Several offsets are captured
 * because rAF is throttled under SwiftShader and the good frame moves around.
 *
 * Usage: node shots-now/readme-curl.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'shots-now/curl';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(() => {
  globalThis.__worldReady = false;
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click({ force: true });
await page.waitForTimeout(1200);

await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  app.appState.openBook((list.find((b) => /welcome/i.test(b.title)) ?? list[0]).id);
});
await page.waitForSelector('.nb-prose p', { timeout: 60000 });
await page.waitForTimeout(3500);

for (const delay of [40, 90, 140, 200, 260, 340]) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(delay);
  await page.screenshot({ path: `${OUT}/curl-${delay}.png`, caret: 'hide' });
  console.log(`  ${OUT}/curl-${delay}.png`);
  await page.waitForTimeout(1600);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1600);
}

await browser.close();
