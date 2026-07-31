/** Which layer draws the repeating plank sprigs? Toggle candidates and shoot. */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 300000, polling: 400 });
await page.evaluate(() => { void globalThis.__shelfWorld.ready.then(() => { globalThis.__worldReady = true; }); });
await page.waitForFunction(() => globalThis.__worldReady === true, null, { timeout: 300000, polling: 400 });
for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
await page.waitForTimeout(9000);

const dump = await page.evaluate(() => {
  const w = globalThis.__shelfWorld;
  const fv = [...w['floors'].values()][0];
  const names = [];
  const walk = (c, d) => {
    names.push(`${'  '.repeat(d)}${c.constructor.name} ${c.label ?? ''} vis=${c.visible} y=${Math.round(c.y)} h=${Math.round(c.height)} kids=${c.children?.length ?? 0}`);
    if (d < 3) for (const k of c.children ?? []) walk(k, d + 1);
  };
  walk(fv.root, 0);
  return names.join('\n');
});
console.log(dump);

const shot = (n) => page.screenshot({ path: `qa/_probes/lay-${n}.png`, timeout: 120000, clip: { x: 300, y: 260, width: 700, height: 90 } });
await shot('all');

for (const layer of ['floraRail', 'floraBack', 'propsLayer', 'plankWood', 'shelfDetail']) {
  await page.evaluate((L) => {
    for (const fv of globalThis.__shelfWorld['floors'].values()) {
      const o = fv[L];
      if (o) o.visible = false;
    }
    globalThis.__shelfWorld.dirty = true;
  }, layer);
  await page.waitForTimeout(700);
  await shot(`no-${layer}`);
  await page.evaluate((L) => {
    for (const fv of globalThis.__shelfWorld['floors'].values()) {
      const o = fv[L];
      if (o) o.visible = true;
    }
    globalThis.__shelfWorld.dirty = true;
  }, layer);
  await page.waitForTimeout(400);
  console.log('shot no-' + layer);
}
await browser.close();
