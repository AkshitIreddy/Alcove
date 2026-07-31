/**
 * shots-now/populate.mjs — fill a shelf and photograph it.
 *
 * One seeded Welcome book tells you nothing about a spine library: at 80%
 * zoom it is a ten-pixel sliver. This clicks "new book" enough times to fill
 * a floor, dismisses whatever each click opens, and shoots the shelf so the
 * authored sprites can actually be judged.
 */
import { chromium } from 'playwright';

const COUNT = Number(process.argv[2] ?? 14);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await p.evaluate(() => { try { localStorage.setItem('nb-tutorial-done', '1'); } catch {} });
await p.reload({ waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 6000));
// The guided tour sits over the whole shelf and swallows every click, so
// Playwright's actionability check fails on the dock before it ever tries.
// force:true bypasses that check for the one control that is meant to be hit,
// and the result is verified rather than assumed.
for (let attempt = 0; attempt < 4; attempt++) {
  const card = p.locator('text=skip the tour').first();
  if ((await card.count()) === 0) break;
  await card.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
}
if ((await p.locator('text=skip the tour').count()) > 0) {
  console.log('WARNING: tour still up — the shelf below is obscured');
}

for (let i = 0; i < COUNT; i++) {
  // The dock button, not the ghost-slot one: the ghost follows the camera and
  // goes out of reach as the floor fills.
  const btn = p.locator('button[aria-label="New book"]').first();
  if ((await btn.count()) === 0) {
    console.log(`stopped at ${i}: dock is gone (in a book?)`);
    break;
  }
  // force again: the dock sits under the shelf's own pointer-capture layer,
  // so the actionability check refuses a control the user can plainly click.
  await btn.click({ force: true, timeout: 4000 }).catch((e) => {
    console.log(`click ${i} failed: ${String(e).split('\n')[0]}`);
  });
  await new Promise((r) => setTimeout(r, 700));
  // A new book opens into its pages; get back to the shelf for the next one.
  await p.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
}

await new Promise((r) => setTimeout(r, 4000));
await p.screenshot({ path: 'shots-now/shelf-full.png' });
console.log('done -> shots-now/shelf-full.png');
await b.close();
