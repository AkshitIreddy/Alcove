/**
 * scripts/probe-spine-board.mjs — a specimen board for the studio's own axes.
 *
 * One row per knob, one column per value, every book drawn through the real
 * `renderSpine`. The point is to LOOK at cords, endbands, coverings and wear
 * rather than to trust a hash that says they changed.
 *
 * Usage: node scripts/probe-spine-board.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

await page.evaluate(async () => {
  const bs = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');

  const SEED = 0x51ed0001;
  const ROWS = [
    ['endbands', 'headTailStyle', [0, 1, 2], { headTail: true }],
    ['wear', 'wear', [0, 0.25, 0.5, 0.75, 1], { raisedBands: 2, gilt: true, bandGilt: true, headTail: true }],
    ['format', 'height', [150, 190, 225, 260, 295], {}],
  ];

  const root = document.createElement('div');
  root.id = 'board';
  root.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#e9e2d0;overflow:auto;' +
    'font:12px "Nunito Sans",sans-serif;color:#4f3120;padding:14px;';
  document.body.append(root);

  const base = { ...bs.bookStyleToOverrides(bs.resolveBookStyle(SEED, null, null).style), thickness: 44 };

  for (const [label, key, values, extra] of ROWS) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-end;gap:10px;margin-bottom:8px;';
    const name = document.createElement('div');
    name.textContent = label;
    name.style.cssText = 'width:96px;flex:0 0 96px;font-weight:700;';
    row.append(name);
    for (const v of values) {
      const cell = document.createElement('div');
      cell.style.cssText = 'text-align:center;';
      const c = document.createElement('canvas');
      c.width = 132;
      c.height = 300;
      const ctx = c.getContext('2d');
      const style = { ...base, ...extra, [key]: v };
      const r = bs.resolveBookStyle(SEED, null, style);
      const scale = 288 / r.style.height;
      ctx.save();
      ctx.translate((132 - r.spine.w * scale) / 2, 296 - r.style.height * scale);
      spines.renderSpine(ctx, r.spine, 0, 0, r.style.height * scale, scale, 'Cell Biology', {
        hiRes: true,
      });
      ctx.restore();
      const cap = document.createElement('div');
      cap.textContent = String(v);
      cell.append(c, cap);
      row.append(cell);
    }
    root.append(row);
  }
});

await page.waitForTimeout(900);
await page.locator('#board').screenshot({ path: 'qa/ui/spine-board.png' });
console.log('shot qa/ui/spine-board.png');
await browser.close();
