/**
 * shots-now/ribbons.mjs — drive the ribbon drawer the way a reader does.
 *
 * A specimen board would prove the vocabulary draws; this proves the app can
 * REACH it: open a book, bookmark two pages so there are ribbons on the cover,
 * open the drawer from the rail, click a preset and an axis, and photograph
 * the cover each time. Everything is asserted on what is on screen, not on
 * what was saved.
 */
import { chromium } from 'playwright';

const shot = async (p, name) => {
  await new Promise((r) => setTimeout(r, 900));
  await p.screenshot({ path: `shots-now/${name}.png`, animations: 'disabled', timeout: 120000 });
  console.log(`  -> shots-now/${name}.png`);
};

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
p.on('console', (m) => {
  if (m.type() === 'error') console.log('  console error:', m.text().slice(0, 200));
});
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 9000));
for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

// Open the seeded book the way a click does.
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 60000 });
const opened = await p.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const first = books[0];
  if (first === undefined) return null;
  globalThis.__shelfPullOut?.(first.id);
  return first.title;
});
console.log('pulled out:', opened);
await new Promise((r) => setTimeout(r, 2500));
// The pulled book opens on a second click / Enter.
await p.keyboard.press('Enter').catch(() => {});
await new Promise((r) => setTimeout(r, 4000));

const railCount = await p.locator('.nb-rail').count();
console.log('rail on screen:', railCount);
if (railCount === 0) {
  await p.locator('.nb-pulled-book, .nb-book-cover').first().click({ force: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
}

// Bookmark two pages so the cover carries ribbons.
for (let i = 0; i < 2; i++) {
  await p.locator('button[data-tool="bookmark"]').first().click({ force: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));
  await p.keyboard.press('ArrowRight').catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
}
await p.keyboard.press('ArrowLeft').catch(() => {});
await new Promise((r) => setTimeout(r, 800));
console.log('ribbons on cover:', await p.locator('.nb-ribbon').count());
await shot(p, 'ribbon-1-default');

await p.locator('button[data-tool="ribbon-style"]').first().click({ force: true });
await new Promise((r) => setTimeout(r, 1200));
console.log('drawer open:', await p.locator('.nb-ribbon-drawer').count());
await shot(p, 'ribbon-2-drawer');

// A preset from another family.
await p.locator('.nb-ribbon-drawer .nb-chip', { hasText: 'festive' }).first().click({ force: true });
await new Promise((r) => setTimeout(r, 700));
await p.locator('.nb-ribbon-drawer .nb-strip-tile', { hasText: 'Gilded' }).first().click({ force: true });
await new Promise((r) => setTimeout(r, 900));
await shot(p, 'ribbon-3-gilded');

// And one axis on top of it: a different cloth.
const swatches = p.locator('.nb-ribbon-drawer .nb-swatch');
console.log('cloth swatches shown:', await swatches.count());
await swatches.nth(3).click({ force: true });
await new Promise((r) => setTimeout(r, 900));
await shot(p, 'ribbon-4-cloth');

// The "N more" control the reader asked for.
const more = p.locator('.nb-ribbon-drawer .nb-more').first();
console.log('more controls:', await p.locator('.nb-ribbon-drawer .nb-more').count());
if ((await more.count()) > 0) {
  console.log('more says:', (await more.textContent())?.trim());
  await more.click({ force: true });
  await new Promise((r) => setTimeout(r, 700));
  console.log('cloth swatches after opening:', await swatches.count());
}
await shot(p, 'ribbon-5-more');

const applied = await p.evaluate(() => {
  const el = document.querySelector('.nb-ribbon');
  if (el === null) return null;
  const cs = getComputedStyle(el);
  return {
    width: cs.width,
    height: cs.height,
    clip: cs.clipPath.slice(0, 60),
    bg: cs.backgroundImage.slice(0, 90),
    shadow: cs.boxShadow,
    styleTag: document.getElementById('nb-ribbon-skin') !== null,
  };
});
console.log('applied to the cover ribbon:', JSON.stringify(applied, null, 1));

await b.close();
