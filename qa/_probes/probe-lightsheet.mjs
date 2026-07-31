/**
 * probe-lightsheet.mjs — render the SAME shelf under a list of rig variants
 * (and the pass's debug views) so they can be compared side by side.
 *
 * Variants are edited at the bottom of this file. Each is applied live through
 * the world's SceneLight, so there is no rebuild between shots.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const URL_BASE = opt('url', 'http://localhost:1445');
const DIR = opt('dir', 'qa/lit');
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
await page.addInitScript(() => {
  const KEY = 'notebook.stubdb.v1';
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const s = Array.isArray(t.settings) ? t.settings : [];
    const hit = s.find((r) => r && r.key === 'appState:tutorialCompleted');
    if (hit) hit.value = '1'; else s.push({ key: 'appState:tutorialCompleted', value: '1' });
    t.settings = s;
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch { /* ignore */ }
});
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 300 });

const seeded = await page.evaluate(async () => {
  const seed = globalThis.__shelfSeedBooks;
  if (typeof seed !== 'function') return 0;
  const a = [];
  for (let i = 0; i < 22; i++) a.push(`Volume ${i + 1} of the Long Shelf`);
  await seed(a.slice(0, 11), 0);
  await seed(a.slice(11), 1);
  return a.length;
});
console.log('seeded', seeded);
await page.waitForTimeout(30000);

await page.addStyleTag({
  content: `.tutorial-scrim,.tutorial-card,.shelf-dock,.shelf-rail,.zoom-hud,.shelf-hint,
            [class*="tutorial"],[class*="dock"],[class*="rail-"] { display:none !important; }`,
});

await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const c = w['camera'];
  c.zoom = 0.95; c.logZoomTarget = Math.log(0.95); c.anchor = null; c.vx = 0; c.vy = 0;
  c.x = -30; c.y = -90;
  w.dirty = true;
});
await page.waitForTimeout(1500);

async function shot(name) {
  await page.evaluate(() => { globalThis.__shelfWorld.dirty = true; });
  await page.waitForTimeout(800);
  for (let i = 0; i < 3; i++) {
    try {
      await page.screenshot({ path: `${DIR}/rig-${name}.png`, timeout: 60000 });
      console.log(`shot ${DIR}/rig-${name}.png`);
      return;
    } catch { await page.waitForTimeout(1200); }
  }
}

async function apply(overrides, debug) {
  await page.evaluate(
    ({ overrides, debug }) => {
      const sl = globalThis.__shelfWorld['sceneLight'];
      const filter = sl['filter'];
      const base = sl.__baseRig ?? { ...filter.rig };
      sl.__baseRig = base;
      filter.setRig({ ...base, ...overrides });
      filter.setDebug(debug ?? 'final');
      globalThis.__shelfWorld.dirty = true;
    },
    { overrides, debug },
  );
}

const VARIANTS = JSON.parse(opt('variants', 'null')) ?? [
  ['a-asis', {}, 'final'],
  ['b-normals', {}, 'normals'],
  ['c-height', {}, 'height'],
  ['d-ao', {}, 'ao'],
  ['e-albedo', {}, 'albedo'],
];

for (const [name, overrides, debug] of VARIANTS) {
  await apply(overrides, debug);
  await shot(name);
}

await browser.close();
console.log('done');
