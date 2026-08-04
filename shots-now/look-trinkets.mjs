/**
 * shots-now/look-trinkets.mjs — the small drawn things at THEIR OWN size:
 * the 50 page stickers as the editor drops them, and the page ribbons as they
 * hang off the spread. Neither has a home on the roster board, because neither
 * is a customisation AXIS — they are objects a reader places one at a time,
 * and the only honest specimen is one at 1:1 beside the next.
 *
 * Usage: node shots-now/look-trinkets.mjs --url=http://[::1]:1420
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://[::1]:1420');
const OUT = 'shots-now/roster';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => import('/src/editor/nodes/stickers.ts').then(() => true, () => false),
  null,
  { polling: 300 },
);

const report = await page.evaluate(async () => {
  const st = await import('/src/editor/nodes/stickers.ts');
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;font:10px "Nunito Sans",system-ui,sans-serif;';
  const keys = Object.keys(st);

  // Find whatever draws one — the module exports differ between revisions.
  const drawName = keys.find((k) => /^(stickerSvg|stickerMarkup|renderSticker|stickerArt|drawSticker)$/.test(k));
  const draw = drawName ? st[drawName] : null;

  const mk = (bg, label, size) => {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      `background:${bg};padding:12px;width:max-content;color:#3a2416;` +
      'display:grid;grid-template-columns:repeat(10,max-content);gap:10px 8px;';
    for (const id of st.STICKER_IDS) {
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:' + (size + 10) + 'px;';
      const box = document.createElement('div');
      box.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;`;
      if (draw) {
        const out = draw(id, size);
        box.innerHTML = typeof out === 'string' ? out : (out?.outerHTML ?? '');
      }
      const cap = document.createElement('div');
      cap.textContent = id;
      cap.style.cssText = 'margin-top:2px;font-size:9px;';
      cell.append(box, cap);
      wrap.append(cell);
    }
    const head = document.createElement('div');
    head.textContent = label;
    head.style.cssText = 'grid-column:1/-1;font-weight:700;margin-bottom:4px;';
    wrap.prepend(head);
    return wrap;
  };

  const a = mk('#f7f1e3', `50 stickers at 44px (the editor's drop size) — cream`, 44);
  a.id = 'stickers-cream';
  document.body.append(a);
  return { exports: keys, drawName, count: st.STICKER_IDS.length };
});
console.log(JSON.stringify(report));
if (report.drawName) {
  await page.locator('#stickers-cream').screenshot({ path: `${OUT}/stickers-cream.png` });
}
await browser.close();
