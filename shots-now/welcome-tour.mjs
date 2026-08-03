/**
 * shots-now/welcome-tour.mjs — photograph every spread of the seeded welcome
 * book, and report whether the pages stayed where they were written.
 *
 * The second half is the point. Leaves are fixed height and overflow FLOWS to
 * the next page (PageEditor peels, BookView prepends), so a page authored past
 * its capacity does not clip — it quietly rearranges the tour the first time
 * anybody opens it, and the only way to see that is to open it and count. If
 * the book comes back with more pages than `WELCOME_PAGE_SOURCES` has entries,
 * something overflowed.
 *
 * Usage: node shots-now/welcome-tour.mjs [outDir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] ?? 'shots-now/welcome';
mkdirSync(outDir, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', (e) => console.log('  page error:', e.message));
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

// The tour auto-starts, and it does not always arrive before the shelf does —
// so this POLLS for the skip link rather than trying once and moving on. Its
// scrim swallows pointer events, and its own Enter handler eats the keypress
// that opens a book, so nothing below works until it is gone.
for (let i = 0; i < 30; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) {
    if (i > 2) break;
  } else {
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  }
  await p.waitForTimeout(800);
}

// Pull, then open. Both are retried: the pull is a GSAP flight that can be
// interrupted by whatever else the app is doing on first run, and the open is
// a SECOND, separate gesture (PulledBookOverlay) — Enter on the resting book,
// which is the one path that does not depend on where the flight parked it.
for (let attempt = 0; attempt < 6; attempt++) {
  if ((await p.locator('.nb-book-view').count()) > 0) break;
  if ((await p.locator('[data-testid="pulled-book-hand"]').count()) === 0) {
    await p.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await p
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(2500);
}
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
await p.waitForTimeout(2500);

const view = p.locator('.nb-book-view');
if ((await view.count()) === 0) {
  console.log('  book view never opened — is the dev server up?');
  await p.screenshot({ path: `${outDir}/failed.png` });
  await b.close();
  process.exit(1);
}

const pageCount = async () =>
  p.evaluate(() => {
    const el = document.querySelector('[data-page-count]');
    return el ? Number(el.getAttribute('data-page-count')) : null;
  });

const SPREADS = Number(process.env.SPREADS ?? 8);
for (let spread = 0; spread < SPREADS; spread++) {
  // The overflow drain runs after mount and MOVES blocks between pages, so a
  // short wait photographs a page mid-rearrange. Long enough to settle, then
  // the leaf word counts are logged: a leaf that reads 0 is the tell.
  await p.waitForTimeout(3000);
  const shot = `${outDir}/spread-${String(spread + 1).padStart(2, '0')}.png`;
  // `animations: 'disabled'` because the leaf has a resting shimmer that never
  // settles, and Playwright will wait for stability until it times out.
  await view
    .screenshot({ path: shot, animations: 'disabled', timeout: 20_000 })
    .catch(async () => {
      await p.screenshot({ path: shot });
    });
  const words = await p.locator('.nb-leaf-paper').evaluateAll((els) =>
    els.map((el) => (el.textContent ?? '').trim().split(/\s+/).filter(Boolean).length),
  );
  console.log(`  spread ${spread + 1}: words ${JSON.stringify(words)} -> ${shot}`);
  await p.keyboard.press('ArrowRight');
}

console.log('  page rows in the book:', await pageCount());
await b.close();
