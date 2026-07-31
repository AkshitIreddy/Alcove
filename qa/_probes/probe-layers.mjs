/**
 * probe-layers.mjs — layer isolation for the corner-box artifact.
 * Parks the camera on the floor-1 left corner and screenshots with each
 * candidate layer hidden in turn, so the culprit is obvious by subtraction.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const h = args.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const DIR = opt('dir', 'qa/layers');
mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  const KEY = 'notebook.stubdb.v1';
  try {
    const raw = localStorage.getItem(KEY);
    const tables = raw ? JSON.parse(raw) : {};
    const settings = Array.isArray(tables.settings) ? tables.settings : [];
    const hit = settings.find((r) => r && r.key === 'appState:tutorialCompleted');
    if (hit) hit.value = '1';
    else settings.push({ key: 'appState:tutorialCompleted', value: '1' });
    tables.settings = settings;
    localStorage.setItem(KEY, JSON.stringify(tables));
  } catch {
    /* ignore */
  }
});

await page.goto(`${URL_BASE}/?fx=force&bakeprof=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
await page.evaluate(() => {
  void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; });
});
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 }).catch(() => {});

let last = -1, stable = Date.now();
const start = Date.now();
for (;;) {
  await page.waitForTimeout(700);
  const s = await page.evaluate(() => ({
    n: (globalThis.__bakeProfile ?? []).length,
    dirty: globalThis.__shelfWorld?.dirty === true,
  }));
  if (s.n !== last) { last = s.n; stable = Date.now(); }
  if ((Date.now() - stable > 2500 && !s.dirty) || Date.now() - start > 90000) break;
}

// Dump the floor-1 display list so we know what is actually there.
const tree = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const fv = w['floors']?.get?.(1) ?? [...(w['floors']?.values?.() ?? [])][1];
  if (!fv) return 'no floor view';
  const walk = (c, d) =>
    c.children
      .map((ch, i) => {
        const b = ch.getBounds();
        return `${'  '.repeat(d)}[${i}] ${ch.constructor.name} label=${ch.label ?? ''} ` +
          `pos=(${ch.x.toFixed(0)},${ch.y.toFixed(0)}) size=(${ch.width?.toFixed(0)}x${ch.height?.toFixed(0)}) ` +
          `alpha=${ch.alpha.toFixed(2)} blend=${ch.blendMode} bounds=(${b.x.toFixed(0)},${b.y.toFixed(0)},${b.width.toFixed(0)}x${b.height.toFixed(0)})` +
          (ch.children?.length ? `\n${walk(ch, d + 1)}` : '');
      })
      .join('\n');
  return walk(fv.content, 0);
});
console.log('=== floor 1 content display list ===');
console.log(tree);

async function park() {
  await page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const cam = w['camera'];
    const z = Math.min(1440 / 420, 900 / 262, 2.5);
    cam.zoom = z; cam.logZoomTarget = Math.log(z); cam.anchor = null;
    cam.vx = 0; cam.vy = 0; cam.x = -60; cam.y = 300;
    w.dirty = true;
  });
  await page.waitForTimeout(700);
}

async function shot(name) {
  await park();
  const clip = await page.evaluate(() => {
    const cam = globalThis.__shelfWorld['camera'];
    return {
      x: Math.max(0, (-60 - cam.x) * cam.zoom),
      y: Math.max(0, (300 - cam.y) * cam.zoom),
      width: Math.min(1440, 420 * cam.zoom),
      height: Math.min(900, 262 * cam.zoom),
    };
  });
  for (let i = 0; i < 3; i++) {
    try {
      await page.screenshot({ path: `${DIR}/${name}.png`, clip, timeout: 45000 });
      console.log(`shot ${DIR}/${name}.png`);
      return;
    } catch { await page.waitForTimeout(1000); }
  }
}

const FIELDS = ['shadow', 'backWood', 'backBase', 'shadeL', 'shadeR', 'shelfDetail', 'plankWood', 'propsLayer', 'floraLayer'];

await shot('all');

for (const f of FIELDS) {
  const ok = await page.evaluate((field) => {
    const w = globalThis.__shelfWorld;
    let hidden = 0;
    for (const fv of (w['floors']?.values?.() ?? [])) {
      const s = fv[field];
      if (s && typeof s.visible === 'boolean') { s.visible = false; hidden++; }
    }
    w.dirty = true;
    return hidden;
  }, f);
  if (ok === 0) { console.log(`(skip ${f}: not present)`); continue; }
  await shot(`no-${f}`);
  await page.evaluate((field) => {
    const w = globalThis.__shelfWorld;
    for (const fv of (w['floors']?.values?.() ?? [])) {
      const s = fv[field];
      if (s && typeof s.visible === 'boolean') s.visible = true;
    }
    w.dirty = true;
  }, f);
}

await browser.close();
console.log('done');
