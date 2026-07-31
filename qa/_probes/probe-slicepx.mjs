/**
 * probe-slicepx.mjs — numeric proof for the under-plank shadow.
 *
 * Renders floor 1's case (books/flora/props/plaque hidden) to a render target
 * at 1:1 world px and reads the luma profile along a row 2 px under the plank
 * edge. A correct strip is flat except for a ~28 px pool at each end; the
 * nine-slice bug smeared that pool across ~140 px.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:1420/?fx=force&bakeprof=1', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
await page.evaluate(() => { void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; }); });
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 }).catch(() => {});
await page.waitForTimeout(8000);

const out = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const app = w['app'];
  const renderer = app.renderer;
  const floors = [...(w['floors']?.values?.() ?? [])];
  const fv = floors.find((f) => f.index === 1) ?? floors[0];
  if (!fv) return { error: 'no floor' };

  // Hide everything except the case + the shadow rig.
  const hidden = [];
  for (const key of ['booksLayer', 'floraBack', 'floraRail', 'propsLayer', 'hoverLayer', 'plaque', 'hint']) {
    const n = fv[key];
    if (n && n.visible) { n.visible = false; hidden.push(n); }
  }
  const content = fv.content;
  const prevPos = { x: content.x, y: content.y };
  const prevScale = content.scale.x;
  content.position.set(0, 0);
  content.scale.set(1);

  const bounds = content.getLocalBounds();
  const ox = Math.round(-bounds.x); // world x 0 → canvas x
  const oy = Math.round(-bounds.y);

  const rig = [fv.shadow, fv.shadowCapL, fv.shadowCapR].filter(Boolean);
  const scan = (yOff) => {
    const canvas = renderer.extract.canvas({ target: content, resolution: 1 });
    const g = canvas.getContext('2d');
    const id = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const row = [];
    const y = oy + yOff;
    for (let x = 0; x < 1200; x++) {
      const i = (y * canvas.width + (ox + x)) * 4;
      row.push(0.299 * id[i] + 0.587 * id[i + 1] + 0.114 * id[i + 2]);
    }
    return { row, size: `${canvas.width}x${canvas.height}` };
  };

  // Rig alone over transparency: read its ALPHA, which is unaffected by the
  // back panel's own left→right brightness ramp.
  const others = [];
  for (const ch of content.children) {
    if (!rig.includes(ch) && ch.visible) { ch.visible = false; others.push(ch); }
  }
  const alphaCanvas = renderer.extract.canvas({ target: content, resolution: 1 });
  const ag = alphaCanvas.getContext('2d');
  const aid = ag.getImageData(0, 0, alphaCanvas.width, alphaCanvas.height).data;
  const aBounds = content.getLocalBounds();
  const aox = Math.round(-aBounds.x);
  const aoy = Math.round(-aBounds.y);
  const alphaRow = [];
  for (let x = 0; x < 1200; x++) {
    alphaRow.push(aid[((aoy + 2) * alphaCanvas.width + (aox + x)) * 4 + 3]);
  }
  for (const ch of others) ch.visible = true;

  const withRig = scan(2);
  for (const s of rig) s.visible = false;
  const withoutRig = scan(2);
  for (const s of rig) s.visible = true;

  content.position.set(prevPos.x, prevPos.y);
  content.scale.set(prevScale);
  for (const n of hidden) n.visible = true;
  w.dirty = true;

  const row = withRig.row.map((v, i) => withoutRig.row[i] - v);
  return { size: withRig.size, ox, oy, row, alphaRow, rig: rig.length };
});

if (out.error) { console.log('ERROR', out.error); }
else {
  const r = out.row;
  // Plateau = the flat middle value.
  const a = out.alphaRow;
  console.log('rig-only ALPHA along y = zoneTop+2, every 4px, x = 0..120:');
  console.log(a.slice(0, 121).filter((_, i) => i % 4 === 0).join(','));
  console.log('… x = 1080..1199:');
  console.log(a.slice(1079).filter((_, i) => i % 4 === 0).join(','));
  const plateauA = [...a.slice(400, 800)].sort((x, y) => x - y)[200];
  let la = 0;
  while (la < 600 && Math.abs(a[la] - plateauA) > 1) la++;
  let ra = 1199;
  while (ra > 600 && Math.abs(a[ra] - plateauA) > 1) ra--;
  console.log(`ALPHA plateau = ${plateauA}; left pool width = ${la}px; right pool width = ${1199 - ra}px`);
  console.log(`ALPHA max deviation in the plateau = ${Math.max(...a.slice(la + 4, ra - 4).map((v) => Math.abs(v - plateauA)))}`);

  const mid = [...r.slice(400, 800)].sort((a2, b2) => a2 - b2)[200];
  const dev = (v) => Math.abs(v - mid);
  let left = 0;
  while (left < 600 && dev(r[left]) > 1.2) left++;
  let right = 1199;
  while (right > 600 && dev(r[right]) > 1.2) right--;
  const maxMidDev = Math.max(...r.slice(left + 5, right - 5).map(dev));
  console.log(`canvas ${out.size} origin(${out.ox},${out.oy}) rigSprites=${out.rig}`);
  console.log('shadow-only darkening (luma drop) along y = zoneTop+2, every 10px, x = 0..300:');
  console.log(r.slice(0, 301).filter((_, i) => i % 10 === 0).map((v) => v.toFixed(1)).join(','));
  console.log('… and the last 300px:');
  console.log(r.slice(899).filter((_, i) => i % 10 === 0).map((v) => v.toFixed(1)).join(','));
  console.log(`\nplateau darkening = ${mid.toFixed(1)} luma`);
  console.log(`left pool ends at x=${left}px; right pool starts ${1199 - right}px from the right edge`);
  console.log(`max deviation inside the plateau = ${maxMidDev.toFixed(1)}`);
}
await browser.close();
