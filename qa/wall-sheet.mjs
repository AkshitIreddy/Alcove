/**
 * qa/wall-sheet.mjs — specimen board of the wallpaper prints as the app
 * renders them, straight out of the dev server's module graph.
 *   node qa/wall-sheet.mjs [outfile]
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'qa/wall-sheet.png';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 180000 });

const html = await page.evaluate(async () => {
  const wp = await import('/src/art/wallpaper.ts');
  const mat = await import('/src/art/materials.ts');
  const themes = await import('/src/art/themes.ts');
  await mat.whenMaterialsReady();

  // Every theme's own pairing — that is what the app actually shows.
  const rows = [];
  for (const id of themes.THEME_IDS ?? Object.keys(themes.THEMES)) {
    const t = themes.THEMES[id];
    if (!t) continue;
    rows.push({ id, pattern: t.wallpaper.pattern, colourway: t.wallpaper.colourway, tile: t.wallpaper.tile });
  }

  const CELL = 210;
  const out = [];
  for (const r of rows) {
    const size = wp.wallpaperRepeat(r.pattern, r.tile);
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext('2d');
    // Scale so one cell shows roughly one-and-a-bit repeats, like the wall.
    const k = CELL / (size * 1.15);
    g.save();
    g.scale(k, k);
    const n = Math.ceil(CELL / k / size) + 1;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        g.save();
        g.translate(tx * size, ty * size);
        wp.renderWallpaper(g, r.pattern, size, r.colourway, 0x5eed);
        g.restore();
      }
    }
    g.restore();
    out.push({
      label: `${r.id} · ${r.pattern} · ${r.colourway}${wp.wallpaperHasPrint(r.pattern) ? '' : '  (procedural)'}`,
      url: c.toDataURL('image/png'),
    });
  }
  return out;
});

await page.setContent(
  `<body style="margin:0;background:#1a1a1a;font:11px system-ui;color:#eee;display:flex;flex-wrap:wrap;gap:6px;padding:8px">` +
    html
      .map(
        (c) =>
          `<div style="width:210px"><img src="${c.url}" style="width:210px;height:210px;display:block;border-radius:3px"><div style="padding:3px 1px;font-size:10px;opacity:.85">${c.label}</div></div>`,
      )
      .join('') +
    `</body>`,
);
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log('wrote', OUT, `(${html.length} cells)`);
