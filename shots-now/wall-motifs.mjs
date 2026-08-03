/**
 * shots-now/wall-motifs.mjs — every MOTIF, at the pitch the wall actually shows.
 *
 * One cell per pattern (50 of them), each drawn with the best-tier preset in the
 * book that uses that pattern, so the picture is the authored intent rather than
 * a spec I invented. The tile goes down through ONE integer render +
 * createPattern (never repeated renderWallpaperTile calls at an offset), which
 * is the contract `drawWallpaperCard` documents.
 *
 * Usage: node shots-now/wall-motifs.mjs --tag=before [--only=damask,trellis]
 *        [--zoom=0.6] [--cols=5]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const DIR = opt('dir', 'shots-now/out');
const TAG = opt('tag', 'motifs');
const COLS = Number(opt('cols', '5'));
const ROWS = Number(opt('rows', '5'));
const ZOOM = Number(opt('zoom', '0.6'));
const ONLY = opt('only', '');
const CELL_W = Number(opt('cw', '300'));
const CELL_H = Number(opt('ch', '210'));

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
  async ({ cols, rows, zoom, only, cellW, cellH }) => {
    const W = await import('/src/art/wallpaperDesign.ts');
    const wanted = only.length > 0 ? new Set(only.split(',')) : null;

    // Best-tier preset per pattern: the authored intent for that motif.
    const rank = { front: 0, book: 1, back: 2 };
    const best = new Map();
    for (const p of W.WALLPAPER_PRESETS) {
      const cur = best.get(p.spec.pattern);
      if (!cur || rank[p.tier] < rank[cur.tier]) best.set(p.spec.pattern, p);
    }
    const list = W.WALLPAPER_PATTERNS.filter((pat) => !wanted || wanted.has(pat)).map((pat) => {
      const p = best.get(pat);
      return {
        pattern: pat,
        family: W.wallpaperFamily(pat),
        name: p ? p.name : pat,
        id: p ? p.id : '-',
        tier: p ? p.tier : '-',
        spec: p ? p.spec : { pattern: pat, scale: 'medium', depth: 'low', ink: 'timber' },
      };
    });

    const tileFor = (spec) => {
      const size = Math.max(8, Math.round(W.wallpaperTilePx(spec)));
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      W.renderWallpaperTile(c.getContext('2d'), size, spec);
      return c;
    };

    const CAP = 30;
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
        g.font = '600 14px "Nunito Sans", system-ui, sans-serif';
        g.fillText(`${p.pattern}`, cx + 1, cy + cellH + 15);
        g.fillStyle = '#b7a48c';
        g.font = '10px ui-monospace, monospace';
        const s = p.spec;
        g.fillText(
          `${p.family} · ${s.scale}/${s.depth}/${s.ink}/${s.tone ?? 'auto'}/${s.edge ?? 'crisp'}`,
          cx + 1,
          cy + cellH + 27,
        );
      });
      sheets.push(c.toDataURL('image/png'));
    }
    return { sheets, ids: list.map((p) => `${p.family}\t${p.pattern}\t${p.id}`) };
  },
  { cols: COLS, rows: ROWS, zoom: ZOOM, only: ONLY, cellW: CELL_W, cellH: CELL_H },
);

console.log(result.ids.join('\n'));
result.sheets.forEach((data, i) => {
  const path = `${DIR}/${TAG}-${i + 1}.png`;
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
  console.log(`shot ${path}`);
});

await browser.close();
