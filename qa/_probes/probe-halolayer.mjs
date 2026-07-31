/**
 * probe-halolayer.mjs — is the case halo actually on the stage, and what does
 * it contribute? Dumps the world container's children with bounds, then
 * screenshots the same crop with the halo sprites hidden and shown so the
 * difference is attributable.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const URL_BASE = opt('url', 'http://localhost:1445');
const DIR = opt('dir', 'qa/halo');
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
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
await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 300 });
await page.waitForTimeout(14000);

const tree = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const describe = (c, depth) => ({
    depth,
    type: c.constructor?.name,
    label: c.label ?? '',
    visible: c.visible,
    alpha: c.alpha,
    x: Math.round(c.x),
    y: Math.round(c.y),
    w: Math.round(c.width ?? 0),
    h: Math.round(c.height ?? 0),
    tex: c.texture?.source?.label ?? '',
    frame: c.texture?.frame ? `${c.texture.frame.width}x${c.texture.frame.height}` : '',
  });
  const out = [];
  const walk = (c, depth) => {
    out.push(describe(c, depth));
    if (depth < 1) for (const k of c.children ?? []) walk(k, depth + 1);
  };
  for (const child of w['world'].children) walk(child, 0);
  return { stage: w['app'].stage.children.map((c) => describe(c, -1)), world: out };
});
console.log('stage:');
for (const c of tree.stage) console.log('  ', JSON.stringify(c));
console.log('world children:');
for (const c of tree.world.slice(0, 24)) console.log('  '.repeat(c.depth + 1), JSON.stringify(c));

await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  w.zoomFit?.();
  const cam = w['camera'];
  cam.zoom = 3; cam.logZoomTarget = Math.log(3); cam.anchor = null; cam.vx = 0; cam.vy = 0;
  cam.x = -110; cam.y = -120;
  w.dirty = true;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${DIR}/layer-on.png`, clip: { x: 0, y: 0, width: 900, height: 700 } });

const hidden = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  let n = 0;
  // The halo top sits directly on `world`; the edge slices live on each floor.
  for (const c of w['world'].children) {
    if (c.texture !== undefined && c.children?.length === 0 && c.width > 1000 && c.y < 0) {
      c.visible = false;
      n++;
    }
  }
  for (const [, fv] of w['floors'] ?? []) {
    for (const key of ['shadeL', 'shadeR']) {
      const s = fv[key];
      if (s) { s.visible = false; n++; }
    }
  }
  w.dirty = true;
  return n;
});
console.log('hid', hidden, 'halo sprites');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${DIR}/layer-off.png`, clip: { x: 0, y: 0, width: 900, height: 700 } });
await browser.close();
console.log('done');
