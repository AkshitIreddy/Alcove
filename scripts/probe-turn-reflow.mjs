/**
 * scripts/probe-turn-reflow.mjs — does a page turn move text between pages?
 *
 * The reader, watching the demo: *"weird bug in gif when turning pages
 * basically items at bottom of left page after page turn go to the right in a
 * second"*.
 *
 * If that is the pagination drain running after the page has landed, it is not
 * a cosmetic bug: `extractOverflow` REMOVES trailing blocks from one page's
 * document and hands them to the next, and nothing pulls them back — the
 * comment in PageEditor says so ("nothing pulls a carried block BACK, so
 * closing the sheet did not undo it"). A page turn would be quietly rewriting
 * the book.
 *
 * So this counts the top-level blocks on each leaf every frame across a turn,
 * and reports any count that changes AFTER the flip has finished.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
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
// Through the bridges, so this runs against a build as well as a dev server.
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(5000);

console.log('turning, and watching the block counts settle\n');
let moved = 0;
for (let i = 0; i < 6; i += 1) {
  await page.evaluate(() => {
    globalThis.__r = [];
    globalThis.__go = true;
    const tick = () => {
      if (!globalThis.__go) return;
      const leaves = [...document.querySelectorAll('.nb-flip-leaf')];
      globalThis.__r.push({
        t: Math.round(performance.now()),
        flipping: document.querySelector('canvas.is-flipping') !== null,
        // Top-level block count per leaf — what the drain actually changes.
        counts: leaves.map((l) => l.querySelector('.nb-prose')?.children.length ?? -1),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);
  const trace = await page.evaluate(() => { globalThis.__go = false; return globalThis.__r; });

  // When did the flip stop? Everything after that should be still.
  const lastFlip = trace.reduce((n, f, k) => (f.flipping ? k : n), -1);
  const after = trace.slice(lastFlip + 1).filter((f) => f.counts.some((c) => c >= 0));
  const changes = [];
  for (let k = 1; k < after.length; k += 1) {
    const a = after[k - 1].counts;
    const b = after[k].counts;
    if (a.length === b.length && a.some((v, j) => v !== b[j])) {
      changes.push(`${after[k].t - after[0].t}ms ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  }
  if (changes.length > 0) moved += 1;
  console.log(
    `  ${changes.length === 0 ? 'ok   ' : 'MOVED'} turn ${i + 1}: ` +
      `${trace.length} frames, flip ended at frame ${lastFlip}` +
      (changes.length ? `\n         ${changes.slice(0, 4).join('\n         ')}` : ''),
  );
}

console.log(`\n${moved} of 6 turns moved blocks between pages after landing.`);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
