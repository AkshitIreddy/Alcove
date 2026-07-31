/**
 * probe-seams.mjs — attribute the rectangular seams on the wall to a layer.
 *
 * Parks the camera, reports where it ACTUALLY landed (the clamps move it), then
 * screenshots the same crop once per layer with that layer hidden. Whichever
 * removal makes a seam vanish owns it.
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
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 300 });
await page.waitForTimeout(15000);

const cam = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const c = w['camera'];
  c.zoom = 2.2; c.logZoomTarget = Math.log(2.2); c.anchor = null; c.vx = 0; c.vy = 0;
  c.x = -140; c.y = -150;
  w.dirty = true;
  return null;
});
void cam;
await page.waitForTimeout(1200);
const state = await page.evaluate(() => {
  const c = globalThis.__shelfWorld['camera'];
  return { x: c.x, y: c.y, zoom: c.zoom };
});
console.log('camera after clamps:', state);
console.log('screen->world: wx = camx + sx/zoom, wy = camy + sy/zoom');

const CLIP = { x: 0, y: 0, width: 1000, height: 760 };
const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/seam-${name}.png`, clip: CLIP });
  console.log(`shot ${DIR}/seam-${name}.png`);
};
await shot('all');

const layers = ['backdrop', 'wallpaper', 'wallFx', 'lightFx', 'halo'];
for (const layer of layers) {
  const n = await page.evaluate((which) => {
    const w = globalThis.__shelfWorld;
    let hidden = 0;
    const hide = (o) => { if (o) { o.__wasVisible = o.visible; o.visible = false; hidden++; } };
    if (which === 'backdrop') hide(w['backdrop']);
    else if (which === 'wallpaper') hide(w['wallpaper']);
    else if (which === 'wallFx') hide(w['wallFx']);
    else if (which === 'lightFx') hide(w['lightFx']);
    else if (which === 'halo') {
      for (const c of w['world'].children) {
        if (c.texture !== undefined && (c.children?.length ?? 0) === 0 && c.width > 1000 && c.y < 0) hide(c);
      }
      for (const [, fv] of w['floors'] ?? []) { hide(fv['shadeL']); hide(fv['shadeR']); }
    }
    w.dirty = true;
    return hidden;
  }, layer);
  console.log(`hid ${n} for ${layer}`);
  await shot(`no-${layer}`);
  await page.evaluate((which) => {
    const w = globalThis.__shelfWorld;
    const show = (o) => { if (o && o.__wasVisible !== undefined) { o.visible = o.__wasVisible; delete o.__wasVisible; } };
    if (which === 'backdrop') show(w['backdrop']);
    else if (which === 'wallpaper') show(w['wallpaper']);
    else if (which === 'wallFx') show(w['wallFx']);
    else if (which === 'lightFx') show(w['lightFx']);
    else if (which === 'halo') {
      for (const c of w['world'].children) show(c);
      for (const [, fv] of w['floors'] ?? []) { show(fv['shadeL']); show(fv['shadeR']); }
    }
    w.dirty = true;
  }, layer);
}
await browser.close();
console.log('done');
