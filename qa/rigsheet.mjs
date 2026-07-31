/**
 * qa/rigsheet.mjs — boot the shelf once, then screenshot it under N different
 * light rigs / debug modes by poking `__shelfWorld` from the page.
 *
 *   node qa/rigsheet.mjs <outDir> <variantsFile.json>
 *
 * variantsFile is `[{ name, rig?: Partial<LightRig>, debug?: string }]`.
 * Everything is applied on top of the world's CURRENT rig, so a variant only
 * has to name the knobs it is testing.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [outDir = 'qa/rig', variantsPath = 'qa/variants.json'] = process.argv.slice(2);
const variants = JSON.parse(readFileSync(variantsPath, 'utf8'));

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/.test(t)) console.log('[err]', t.slice(0, 250));
});

await page.goto('http://localhost:1420/?fx=force&bakeprof=1', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
await page.evaluate(() => { void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; }); });
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 });
for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(180); }

await page.evaluate(async (titles) => {
  const w = globalThis.__shelfWorld;
  const store = w['store'];
  if ((typeof store.totalBooks === 'function' ? store.totalBooks() : 0) >= 40) return;
  const books = await import('/src/data/books.ts');
  const per = Math.ceil(titles.length / 4);
  for (let i = 0; i < titles.length; i++) {
    await books.createBook({ title: titles[i], floor: Math.floor(i / per), slot: i % per, spineSeed: (0x9e3779b1 * (i + 1)) >>> 0 });
  }
  await store.refreshAll();
}, TITLES);

/* drain bakes */
let last = -1, stable = Date.now(), t0 = Date.now();
for (;;) {
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({
    n: Array.isArray(globalThis.__bakeProfile) ? globalThis.__bakeProfile.length : 0,
    dirty: globalThis.__shelfWorld?.dirty === true,
  }));
  if (st.n !== last) { last = st.n; stable = Date.now(); }
  if ((Date.now() - stable > 2500 && !st.dirty) || Date.now() - t0 > 150000) break;
}

// Snapshot the rig the world resolved for the current theme; every variant
// patches this, never the previous variant.
await page.evaluate(() => {
  const sl = globalThis.__shelfWorld['sceneLight'];
  globalThis.__baseRig = { ...sl['filter'].rig };
});

for (const v of variants) {
  await page.evaluate((v) => {
    const sl = globalThis.__shelfWorld['sceneLight'];
    sl.setRig({ ...globalThis.__baseRig, ...(v.rig ?? {}) });
    sl['filter'].setDebug(v.debug ?? 'final');
    globalThis.__shelfWorld.dirty = true;
  }, v);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${v.name}.png`, timeout: 120000, clip: { x: 200, y: 0, width: 1060, height: 900 } });
  console.log('shot', v.name);
}

await browser.close();
