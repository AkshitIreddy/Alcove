/**
 * shots-now/defaults-sweep.mjs — photograph candidate OPENING rooms.
 *
 * "Elegant" is not a property you can reason your way to from a hex, so the
 * shortlist for the default room / carpentry gets driven through the real app
 * and looked at. Applies each candidate through the world's own bridges
 * (`__libraryPrefs.save`, `__shelfSaveDesign`) — never a probe-side import,
 * which can resolve to a second copy of the store on an HMR'd dev server.
 *
 * Usage: node shots-now/defaults-sweep.mjs [--books=1] [--zoom=0]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const EXTRA_BOOKS = Number(opt('books', '0'));
const ZOOM = Number(opt('zoom', '0'));
const TAG = opt('tag', 'cand');

/** [theme, build, pattern] */
const CANDIDATES = JSON.parse(
  opt(
    'set',
    JSON.stringify([
      ['verdigris', 'plank', 'none'],
      ['verdigris', 'scriptorium', 'fluted'],
      ['verdigris', 'bookbinder', 'reeded'],
      ['walnut', 'scriptorium', 'fluted'],
      ['walnut', 'bookbinder', 'stringing'],
      ['cardroom', 'cloister', 'fluted'],
      ['lapis', 'colonnade', 'fluted'],
      ['apothecary', 'orangery', 'beaded'],
      ['forest', 'arch', 'crossband'],
      ['mahogany', 'bookbinder', 'dentil'],
      ['topaz', 'scriptorium', 'guilloche'],
      ['teak', 'barrister', 'crossband'],
    ]),
  ),
);

mkdirSync('shots-now/defaults', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errors = new Set();
page.on('pageerror', (e) => errors.add(String(e.message).split('\n')[0].slice(0, 200)));

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'design bridge');
await poll(() => globalThis.__libraryPrefs !== undefined, 120000, 'library prefs bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y mirror');
for (let i = 0; i < 10; i += 1) {
  const skip = page.getByText('skip the tour');
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
}
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1500);

if (EXTRA_BOOKS > 0) {
  await page.evaluate(async (n) => {
    const titles = [
      'Cell Biology', 'Kanji Practice', 'Watercolor Basics', 'Tea Tasting Journal',
      'Linear Algebra', 'SQL Spellbook', 'Birdwatching Field Notes',
    ].slice(0, n);
    await globalThis.__shelfSeedBooks(titles, 0);
  }, EXTRA_BOOKS);
  await page.waitForTimeout(1800);
}

for (let z = 0; z < ZOOM; z += 1) await page.evaluate(() => globalThis.__shelfWorld.zoomIn());
await page.waitForTimeout(800);

let i = 0;
for (const [theme, build, pattern] of CANDIDATES) {
  i += 1;
  for (let tries = 0; ; tries += 1) {
    const ok = await page
      .evaluate(async (c) => {
        if (globalThis.__libraryPrefs === undefined || globalThis.__shelfSaveDesign === undefined) {
          return false;
        }
        await globalThis.__libraryPrefs.save({ theme: c.theme, shelf: null, wall: null });
        await globalThis.__shelfSaveDesign({ build: c.build, pattern: c.pattern });
        return true;
      }, { theme, build, pattern })
      .catch(() => false);
    if (ok) break;
    if (tries > 120) throw new Error('world bridges never appeared');
    await page.waitForTimeout(500);
  }
  await poll(
    () => {
      const d = globalThis.__shelfDesign();
      return d.shelf;
    },
    30000,
    'design bridge read',
  );
  // Wait for the APPLIED carpentry, not the saved one.
  const want = `${build}.${pattern}`;
  const t0 = Date.now();
  for (;;) {
    const got = await page.evaluate(() => globalThis.__shelfDesign().shelf);
    if (got === want) break;
    if (Date.now() - t0 > 45000) throw new Error(`case never became ${want} (is ${got})`);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2200);
  const name = `shots-now/defaults/${TAG}-${String(i).padStart(2, '0')}-${theme}-${build}-${pattern}.png`;
  await page.screenshot({ path: name, animations: 'disabled', caret: 'hide', timeout: 120000 });
  console.log(`  ${name}`);
}

if (errors.size) console.log('errors:\n  ' + [...errors].join('\n  '));
await browser.close();
