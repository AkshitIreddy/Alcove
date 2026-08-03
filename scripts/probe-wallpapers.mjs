/**
 * scripts/probe-wallpapers.mjs — every paper in the book, at WALL size.
 *
 * A picker card is 148x102, and a paper that looks charming at 148px can still
 * be the busiest thing in the room once it covers a viewport. This board lays
 * each preset down at the pitch `world.ts` actually shows it at (tileScale =
 * max(zoom, 0.35)) over a patch big enough to judge, which is the only picture
 * that answers "would I want to look past this all day".
 *
 * The tile goes down through ONE integer-sized render + `createPattern`, never
 * by repeated `renderWallpaperTile` calls at an offset — the obligation
 * `drawWallpaperCard` documents, and the reason the first specimen board of
 * this module had a pale cross through every card.
 *
 * The sheet is composed into a single canvas and returned as a data URL rather
 * than screenshotted through a locator: the dev server can reload underneath a
 * long board and a half-written page is worse than no page.
 *
 * Usage: node scripts/probe-wallpapers.mjs --dir=qa/ui [--only=family]
 *        [--tier=front|book|back] [--cols=3 --rows=3 --zoom=0.6 --cw=372
 *        --ch=248] [--specs=<json>]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const DIR = opt('dir', 'qa/ui');
const COLS = Number(opt('cols', '3'));
const ROWS = Number(opt('rows', '3'));
const ZOOM = Number(opt('zoom', '0.6'));
const ONLY = opt('only', '');
const TIER = opt('tier', '');
const TAG = opt('tag', 'wall');
const SPECS = opt('specs', '');
const CELL_W = Number(opt('cw', '372'));
const CELL_H = Number(opt('ch', '248'));

mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text());
});

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

const result = await page.evaluate(
  async ({ cols, rows, zoom, only, tier, cellW, cellH, specs }) => {
    const W = await import('/src/art/wallpaperDesign.ts');

    const list =
      specs.length > 0
        ? JSON.parse(specs).map((s, i) => ({
            id: s.id ?? `x${i}`,
            name: s.name ?? s.id ?? `x${i}`,
            family: 'custom',
            spec: s.spec ?? s,
          }))
        : W.WALLPAPER_PRESETS.filter(
            (p) =>
              (only.length === 0 || p.family === only) &&
              (tier.length === 0 || p.tier === tier),
          );

    const tileFor = (spec) => {
      const size = Math.max(8, Math.round(W.wallpaperTilePx(spec)));
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      W.renderWallpaperTile(c.getContext('2d'), size, spec);
      return c;
    };

    const CAP = 32;
    const GAP = 8;
    const sheets = [];
    const per = cols * rows;
    for (let i = 0; i < list.length; i += per) {
      const slice = list.slice(i, i + per);
      const nRows = Math.ceil(slice.length / cols);
      const c = document.createElement('canvas');
      c.width = cols * cellW + (cols + 1) * GAP;
      c.height = nRows * (cellH + CAP) + GAP;
      const g = c.getContext('2d');
      g.fillStyle = '#241a13';
      g.fillRect(0, 0, c.width, c.height);
      slice.forEach((p, k) => {
        const cx = GAP + (k % cols) * (cellW + GAP);
        const cy = GAP + Math.floor(k / cols) * (cellH + CAP);
        g.save();
        g.beginPath();
        g.rect(cx, cy, cellW, cellH);
        g.clip();
        const pat = g.createPattern(tileFor(p.spec), 'repeat');
        pat.setTransform({ a: zoom, b: 0, c: 0, d: zoom, e: cx, f: cy });
        g.fillStyle = pat;
        g.fillRect(cx, cy, cellW, cellH);
        g.restore();
        g.fillStyle = '#f2e8d8';
        g.font = '600 13px "Nunito Sans", system-ui, sans-serif';
        g.fillText(`${p.name}  [${p.tier ?? '-'}]`, cx + 1, cy + cellH + 14);
        g.fillStyle = '#b7a48c';
        g.font = '11px ui-monospace, monospace';
        const s = p.spec;
        g.fillText(
          `${p.id} · ${s.pattern}/${s.scale}/${s.depth}/${s.ink}/${s.tone ?? 'auto'}/${s.edge ?? 'crisp'}`,
          cx + 1,
          cy + cellH + 27,
        );
      });
      sheets.push(c.toDataURL('image/png'));
    }
    return { sheets, ids: list.map((p) => `${p.family}\t${p.id}\t${p.name}`) };
  },
  { cols: COLS, rows: ROWS, zoom: ZOOM, only: ONLY, tier: TIER, cellW: CELL_W, cellH: CELL_H, specs: SPECS },
);

console.log(result.ids.join('\n'));
result.sheets.forEach((data, i) => {
  const path = `${DIR}/${TAG}-${i + 1}.png`;
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`shot ${path}`);
});

await browser.close();
