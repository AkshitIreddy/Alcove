/**
 * probe-amber.mjs — does the e2e suite's amber-spine detector still find the
 * welcome book, with and without the deferred lighting pass?
 *
 * The optical helpers in tests/e2e/helpers.ts lock onto rgb(~208,153,57).
 * If lighting shifted the spine out of that band every camera assertion in
 * the suite fails for a reason that has nothing to do with the camera.
 */
import { chromium } from 'playwright';

const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const URL_BASE = opt('url', 'http://localhost:1445');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function check(query, label) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto(`${URL_BASE}/${query}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('canvas.shelf-canvas', { timeout: 60000 });
  await page.waitForTimeout(18000);
  const shot = await page.screenshot({ type: 'png' });
  const r = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let count = 0;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 170 && b < 120 && r - b > 85 && g - b > 40) count++;
      // Also track the most amber-ish pixel so we can see how far off it is.
      const score = r - b + (g - b);
      if (r > 120 && score > bestScore) { bestScore = score; best = [r, g, b]; }
    }
    return { count, best, width, height };
  }, shot.toString('base64'));
  console.log(`${label.padEnd(24)} amber pixels=${r.count}  warmest=${JSON.stringify(r.best)}`);
  await page.close();
  return r.count;
}

const lit = await check('', 'lighting ON');
const unlit = await check('?scenelight=0', 'lighting OFF');
console.log(lit >= 30 && unlit >= 30 ? 'both detectable' : 'DETECTOR MISSES');
await browser.close();
