/**
 * shots-now/book-page.mjs — open the seeded book and photograph a real spread.
 *
 * Typography claims get settled here rather than in a synthetic host: the page
 * has a rule grid with its own origin, page padding, and a first-line offset,
 * and a bare div with the same class reproduces none of that. A measurement rig
 * that does not match the page it is measuring is how you end up "fixing"
 * something that was already right.
 *
 * Usage: node shots-now/book-page.mjs [out.png]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/book-page.png';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

// Pull the seeded book off the shelf through the a11y mirror — no pixel hunting
// — then take the second, deliberate step that opens it.
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
// Wait for the HELD state rather than a fixed pause. The pull is a GSAP flight
// with an overshoot that settles, and under SwiftShader rAF is throttled to
// ~10fps, so a timeout tuned on a real GPU photographs a book in mid-air.
await p
  .locator('[data-testid="pulled-book-hand"]')
  .waitFor({ state: 'visible', timeout: 40_000 })
  .catch(() => {});
const read = p.getByRole('button', { name: 'read it' });
if ((await read.count()) > 0) {
  await read.click();
  await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40_000 }).catch(() => {});
  await p.waitForTimeout(2500);
}

const view = p.locator('.nb-book-view');
if ((await view.count()) === 0) {
  console.log('  book view never opened — is the dev server seeded?');
  await p.screenshot({ path: out });
} else {
  await view.screenshot({ path: out });
}
console.log('  ->', out);
await b.close();
