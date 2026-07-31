/**
 * qa/shot.mjs — capture the live shelf (case + wall + flora) from the dev server.
 *   node qa/shot.mjs <outPrefix> [--books] [--theme=blossom]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const prefix = args.find((a) => !a.startsWith('--')) ?? 'qa/live';
const WANT_BOOKS = args.includes('--books');
const themeArg = args.find((a) => a.startsWith('--theme='));
const THEME = themeArg ? themeArg.split('=')[1] : '';

const TITLES = [
  'The Anatomy of Melancholy', 'Peregrine Pickle', 'A Glossary of Heraldry', 'Common Prayer',
  'The Compleat Angler', 'Religio Medici', 'Hydriotaphia', 'The Faerie Queene', 'Arcadia', 'Euphues',
  'The Anatomy of Abuses', 'Utopia', 'The Praise of Folly', 'Novum Organum', 'Leviathan',
  'Paradise Lost', 'Areopagitica', 'The Pilgrim Progress', 'Grace Abounding', 'The Temple',
  'Devotions', 'Pseudo-Martyr', 'Sermons', 'The Country Wife', 'The Way of the World',
  'The Rover', 'Oroonoko', 'The Spectator', 'The Tatler', 'Robinson Crusoe', 'Moll Flanders',
  'Gullivers Travels', 'Tom Jones', 'Clarissa', 'Tristram Shandy', 'Rasselas', 'Evelina',
  'The Mysteries of Udolpho', 'Frankenstein', 'Northanger Abbey', 'Emma', 'Waverley', 'Ivanhoe',
  'The Sketch Book', 'The Last of the Mohicans', 'Typee', 'Moby-Dick', 'Walden', 'Leaves of Grass',
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 400)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/.test(t)) console.log('[err]', t.slice(0, 400));
});

const t0 = Date.now();
await page.goto(`http://localhost:1420/?fx=force&bakeprof=1${THEME ? `&theme=${THEME}` : ''}`, {
  waitUntil: 'domcontentloaded',
  timeout: 180000,
});
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 500 });
await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 500 });
console.log(`world ready after ${Date.now() - t0}ms`);

// Dismiss the first-run tour, which otherwise covers the whole case.
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}
try {
  const skip = page.getByText('skip the tour', { exact: false });
  if (await skip.count()) await skip.first().click({ timeout: 2000 });
} catch { /* already gone */ }
await page.waitForTimeout(400);

if (WANT_BOOKS) {
  const created = await page.evaluate(async (titles) => {
    const w = globalThis.__shelfWorld;
    const store = w['store'];
    const existing = typeof store.totalBooks === 'function' ? store.totalBooks() : 0;
    if (existing >= 40) return 0;
    const books = await import('/src/data/books.ts');
    const per = Math.ceil(titles.length / 4);
    for (let i = 0; i < titles.length; i++) {
      await books.createBook({
        title: titles[i],
        floor: Math.floor(i / per),
        slot: i % per,
        spineSeed: (0x9e3779b1 * (i + 1)) >>> 0,
      });
    }
    await store.refreshAll();
    return titles.length;
  }, TITLES);
  if (created > 0) console.log(`seeded ${created} books`);
}

/* bake drain */
let lastCount = -1;
let stableSince = Date.now();
const drainStart = Date.now();
for (;;) {
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => {
    const samples = Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile : [];
    const w = globalThis.__shelfWorld;
    return { n: samples.length, dirty: w ? w.dirty === true : false };
  });
  if (state.n !== lastCount) { lastCount = state.n; stableSince = Date.now(); }
  if ((Date.now() - stableSince > 3000 && !state.dirty) || Date.now() - drainStart > 120000) break;
}
console.log(`bakes settled after ${Date.now() - drainStart}ms (${lastCount} samples)`);
await page.waitForTimeout(1500);

await page.screenshot({ path: `${prefix}-full.png` });
await page.screenshot({ path: `${prefix}-case.png`, clip: { x: 300, y: 30, width: 720, height: 460 } });
await page.screenshot({ path: `${prefix}-wall.png`, clip: { x: 0, y: 300, width: 460, height: 400 } });
await browser.close();
console.log('wrote', prefix);
