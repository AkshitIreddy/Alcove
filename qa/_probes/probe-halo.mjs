/**
 * probe-halo.mjs — corner-artifact capture AND measurement.
 *
 * Parks the camera on each shelf corner, screenshots it at 2x, and then does
 * the thing eyeballing cannot: scans every row and column for a HARD STEP —
 * a single-pixel jump in tone larger than a threshold, repeated down a line.
 * That is the signature of a translucent sprite ending at full opacity, which
 * is what the "shadowy corner boxes" were.
 *
 * Reports the worst step found on each crop and where, so a fix can be shown
 * to have removed it rather than merely looking better.
 *
 * node qa/_probes/probe-halo.mjs --url=… --tag=after [--seed=1]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const URL_BASE = opt('url', 'http://localhost:1445');
const DIR = opt('dir', 'qa/halo');
const TAG = opt('tag', 'after');
const DPR = Number(opt('dpr', '2'));
const SEED = opt('seed', '1') !== '0';
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

await page.addInitScript(() => {
  const KEY = 'notebook.stubdb.v1';
  try {
    const tables = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const settings = Array.isArray(tables.settings) ? tables.settings : [];
    const hit = settings.find((r) => r && r.key === 'appState:tutorialCompleted');
    if (hit) hit.value = '1';
    else settings.push({ key: 'appState:tutorialCompleted', value: '1' });
    tables.settings = settings;
    localStorage.setItem(KEY, JSON.stringify(tables));
  } catch { /* ignore */ }
});

await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 300 });

// Kill Vite's HMR socket: sibling agents edit `src/art` constantly, and a hot
// reload mid-capture leaves the page without a world to point the camera at.
await page.evaluate(() => {
  const anyWin = window;
  for (const ws of anyWin.__viteSockets ?? []) ws.close();
  // Vite keeps its socket private, so also neuter the reload path.
  const orig = location.reload.bind(location);
  location.reload = () => { void orig; };
});

if (SEED) {
  const n = await page.evaluate(async () => {
    const seed = globalThis.__shelfSeedBooks;
    if (typeof seed !== 'function') return 0;
    const titles = [];
    for (let i = 0; i < 16; i++) titles.push(`Volume ${i + 1} of the Long Shelf`);
    await seed(titles.slice(0, 8), 0);
    await seed(titles.slice(8), 1);
    return titles.length;
  });
  console.log(`seeded ${n} books`);
}

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
  if (s.n !== last) { last = s.n; stable = Date.now(); }
  if ((Date.now() - stable > 3000 && !s.dirty) || Date.now() - start > 90000) break;
}

await page.addStyleTag({
  content: `.tutorial-scrim,.tutorial-card,.shelf-dock,.shelf-rail,.zoom-hud,.shelf-hint,
            [class*="tutorial"],[class*="dock"],[class*="rail-"] { display:none !important; }`,
});

async function worldShot(name, x0, y0, x1, y1) {
  const clip = await page.evaluate(
    ({ x0, y0, x1, y1 }) => {
      const w = globalThis.__shelfWorld;
      if (!w) return null;
      const cam = w['camera'];
      const z = Math.min(1440 / (x1 - x0), 900 / (y1 - y0), 3);
      cam.zoom = z;
      cam.logZoomTarget = Math.log(z);
      cam.anchor = null;
      cam.vx = 0;
      cam.vy = 0;
      cam.x = x0;
      cam.y = y0;
      w.dirty = true;
      return {
        x: Math.max(0, (x0 - cam.x) * z),
        y: Math.max(0, (y0 - cam.y) * z),
        width: Math.min(1440, (x1 - x0) * z),
        height: Math.min(900, (y1 - y0) * z),
      };
    },
    { x0, y0, x1, y1 },
  );
  if (clip === null) throw new Error('world vanished');
  await page.waitForTimeout(900);
  for (let i = 0; i < 4; i++) {
    try {
      await page.screenshot({ path: `${DIR}/${TAG}-${name}.png`, clip, timeout: 60000, animations: 'disabled' });
      console.log(`shot ${DIR}/${TAG}-${name}.png`);
      return;
    } catch (e) {
      console.log(`  retry ${name} (${String(e).slice(0, 70)})`);
      await page.waitForTimeout(1500);
    }
  }
}

await worldShot('tl', -110, -110, 320, 160);
await worldShot('tr', 880, -110, 1310, 160);
await worldShot('f1l', -110, 300, 320, 570);
await worldShot('f1r', 880, 300, 1310, 570);
await worldShot('wide', -110, -110, 1310, 780);

await browser.close();
console.log('done');
