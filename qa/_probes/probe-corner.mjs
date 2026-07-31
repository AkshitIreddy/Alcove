/**
 * probe-corner.mjs — reproduce the "shadowy transparent corner boxes".
 * Dismisses the tutorial, zooms to fit, then screenshots world-space crops of
 * each shelf corner at 2x DPR.
 *
 * node probe-corner.mjs --dir=qa/corner --tag=before [--dpr=2]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1431');
const DIR = opt('dir', 'qa/corner');
const TAG = opt('tag', 'before');
const DPR = Number(opt('dpr', '2'));
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: DPR,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

// Kill the tutorial before boot (settings row in the browser stub DB).
await page.addInitScript(() => {
  const KEY = 'notebook.stubdb.v1';
  try {
    const raw = localStorage.getItem(KEY);
    const tables = raw ? JSON.parse(raw) : {};
    const settings = Array.isArray(tables.settings) ? tables.settings : [];
    const put = (k, v) => {
      const hit = settings.find((r) => r && r.key === k);
      if (hit) hit.value = v;
      else settings.push({ key: k, value: v });
    };
    put('appState:tutorialCompleted', '1');
    tables.settings = settings;
    localStorage.setItem(KEY, JSON.stringify(tables));
  } catch {
    /* ignore */
  }
});

await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, {
  waitUntil: 'domcontentloaded',
  timeout: 180000,
});
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  timeout: 300000,
  polling: 400,
});
await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => {
    globalThis.__worldReady = true;
  });
});
await page
  .waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 })
  .catch(() => console.log('[warn] ready never resolved'));

// Seed a realistic shelf so the artifact shows against books, not empty wall.
const SEED_TITLES = [
  'The Anatomy of Melancholy', 'Peregrine Pickle', 'A Glossary of Heraldry', 'Common Prayer',
  'The Compleat Angler', 'Religio Medici', 'Hydriotaphia', 'The Faerie Queene', 'Arcadia',
  'Euphues', 'Utopia', 'The Praise of Folly', 'Novum Organum', 'Leviathan', 'Paradise Lost',
  'Areopagitica', "The Pilgrim's Progress", 'Grace Abounding', 'The Temple', 'Devotions',
  'Sermons', 'The Country Wife', 'The Way of the World', 'The Rover', 'Oroonoko',
  'The Spectator', 'Robinson Crusoe', 'Moll Flanders', "Gulliver's Travels", 'Tom Jones',
  'Clarissa', 'Tristram Shandy', 'Rasselas', 'Evelina', 'Frankenstein', 'Emma',
  'Waverley', 'Ivanhoe', 'Moby-Dick', 'Walden', 'Leaves of Grass', 'Jane Eyre',
];
const seeded = await page.evaluate(async (titles) => {
  const w = globalThis.__shelfWorld;
  const store = w['store'];
  const existing = typeof store.totalBooks === 'function' ? store.totalBooks() : 0;
  if (existing >= 30) return 0;
  const books = await import('/src/data/books.ts');
  const per = Math.ceil(titles.length / 3);
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
}, SEED_TITLES);
if (seeded > 0) console.log(`seeded ${seeded} books`);

// Drain the bake storm.
let last = -1;
let stable = Date.now();
const start = Date.now();
for (;;) {
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => ({
    n: (globalThis.__bakeProfile ?? []).length,
    dirty: globalThis.__shelfWorld?.dirty === true,
  }));
  if (s.n !== last) {
    last = s.n;
    stable = Date.now();
  }
  if ((Date.now() - stable > 2500 && !s.dirty) || Date.now() - start > 120000) break;
}

// Hide DOM chrome (rails, tutorial, hud) so only the Pixi canvas shows.
await page.addStyleTag({
  content: `.tutorial-scrim,.tutorial-card,.shelf-dock,.shelf-rail,.zoom-hud,.shelf-hint,
            [class*="tutorial"],[class*="dock"],[class*="rail-"] { display:none !important; }`,
});

async function shot(name, clip) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.screenshot({ path: `${DIR}/${TAG}-${name}.png`, clip, timeout: 45000 });
      console.log(`shot ${DIR}/${TAG}-${name}.png`);
      return;
    } catch {
      await page.waitForTimeout(1200);
    }
  }
}

// zoom-fit overview
await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomFit();
  w.dirty = true;
});
await page.waitForTimeout(1400);
await shot('full');

// Now park the camera on specific world rects and screenshot the whole viewport.
// world rect -> camera: set x,y to rect origin and zoom so rect fills viewport.
async function worldShot(name, x0, y0, x1, y1) {
  const clip = await page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const w = globalThis.__shelfWorld;
      const cam = w['camera'];
      const z = Math.min(1440 / (x1 - x0), 900 / (y1 - y0), 2.5);
      cam.zoom = z;
      cam.logZoomTarget = Math.log(z);
      cam.anchor = null;
      cam.vx = 0;
      cam.vy = 0;
      cam.x = x0;
      cam.y = y0;
      w.dirty = true;
      return null;
    },
    { x0, y0, x1, y1 },
  );
  void clip;
  await page.waitForTimeout(900);
  const c = await page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const cam = globalThis.__shelfWorld['camera'];
      return {
        x: Math.max(0, (x0 - cam.x) * cam.zoom),
        y: Math.max(0, (y0 - cam.y) * cam.zoom),
        width: Math.min(1440, (x1 - x0) * cam.zoom),
        height: Math.min(900, (y1 - y0) * cam.zoom),
      };
    },
    { x0, y0, x1, y1 },
  );
  await shot(name, c);
}

// top-left corner of the case (crown + rail + floor 0 zone top)
await worldShot('tl', -90, -80, 330, 182);
// top-right
await worldShot('tr', 870, -80, 1290, 182);
// floor-1 left corner (under-plank shadow meets rail)
await worldShot('f1l', -60, 300, 360, 562);
// floor-1 right corner
await worldShot('f1r', 840, 300, 1260, 562);
// wide band across the whole shelf at a zone top (where the 9-slice lives)
await worldShot('band', -60, 300, 1260, 560);

await browser.close();
console.log('done');
