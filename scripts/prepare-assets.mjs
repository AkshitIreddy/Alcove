/**
 * scripts/prepare-assets.mjs — ship-ready material tiles.
 *
 * The generator (`scripts/gen-assets.mjs`) writes 1024² PNGs into
 * `assets/generated/materials/`. Those are the masters: ~1.8 MB each, 17 MB
 * for the set, which is far too much to put in an installer for textures that
 * are never sampled above a few hundred pixels. This script bakes the shipping
 * copies:
 *
 *   assets/generated/materials/<slug>.png   1024² master, repo only
 *        ↓  downscale + WebP
 *   public/materials/<slug>.webp            512², ~40-90 KB, ships
 *   public/materials/manifest.json          slug → category, size, stats
 *
 * There is no image library in this project's dependency tree (no sharp, no
 * jimp, no node-canvas), and adding one is not on the table. Playwright is
 * already a devDependency, so the resize and the WebP encode both happen in a
 * headless Chromium canvas — the same encoder the app itself would use, which
 * also means the output is exactly what the browser can decode fastest.
 *
 * The manifest carries per-tile statistics (mean luminance, luminance spread,
 * mean saturation) computed from the downscaled pixels. `src/art/materials.ts`
 * uses them to normalise a tile to a *detail field* before tinting, and the
 * unit tests assert on them, so they are checked in rather than recomputed at
 * runtime.
 *
 * Usage:
 *   node scripts/prepare-assets.mjs
 *   node scripts/prepare-assets.mjs --size 512 --quality 0.82 --force
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets', 'generated', 'materials');
const OUT_DIR = join(ROOT, 'public', 'materials');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const SIZE = Math.max(64, Number(opt('size', 512)));
const QUALITY = Math.min(1, Math.max(0.4, Number(opt('quality', 0.82))));
const FORCE = args.includes('--force');

/**
 * Which family each generated tile belongs to. The art code asks for a
 * *category* ("give me a leather") and the loader picks a member by seed, so
 * adding a new generated tile is a one-line change here.
 *
 * `role` is a hint the loader uses to decide how much of the tile's own colour
 * to keep: `grain` tiles (leather, cloth, paper) are used as pure detail and
 * take the book's pigment completely; `figure` tiles (wood, marbled) keep some
 * of their own hue because the figure IS the colour story.
 */
const CATEGORY = {
  'leather-cracked': { category: 'leather', role: 'grain' },
  'leather-morocco': { category: 'leather', role: 'grain' },
  'cloth-ribbed': { category: 'cloth', role: 'grain' },
  'cloth-linen': { category: 'cloth', role: 'grain' },
  vellum: { category: 'paper', role: 'grain' },
  'paper-laid': { category: 'paper', role: 'grain' },
  'paper-marbled': { category: 'marble', role: 'figure' },
  'wood-oak': { category: 'wood', role: 'figure' },
  'wood-walnut': { category: 'wood', role: 'figure' },
  'wood-painted': { category: 'wood', role: 'figure' },
};

if (!existsSync(SRC_DIR)) {
  console.error(`no masters at ${SRC_DIR} — run scripts/gen-assets.mjs first`);
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

const masters = readdirSync(SRC_DIR)
  .filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f))
  .sort();

if (masters.length === 0) {
  console.error(`no material images in ${SRC_DIR}`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

/**
 * Downscale + encode + measure, all inside the page.
 *
 * Chromium's `drawImage` downscale from 1024 to 512 is a box filter, which is
 * what we want for a tile: a bicubic/Lanczos kernel would ring on the hard
 * craquelure edges in the leather and put a bright halo either side of every
 * crack. Seamlessness survives the box filter exactly (both dimensions halve
 * by an integer factor), which matters because these tiles wrap.
 */
async function bake(dataUrl, size, quality) {
  return page.evaluate(
    async ({ dataUrl, size, quality }) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('decode failed'));
        i.src = dataUrl;
      });
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size, size);

      // Statistics on the shipped pixels, not the master, so what the loader
      // reads at runtime matches what the manifest claims.
      const px = g.getImageData(0, 0, size, size).data;
      let sum = 0;
      let sumSq = 0;
      let satSum = 0;
      let min = 1;
      let max = 0;
      const n = size * size;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i] / 255;
        const gg = px[i + 1] / 255;
        const b = px[i + 2] / 255;
        const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        sum += l;
        sumSq += l * l;
        const hi = Math.max(r, gg, b);
        const lo = Math.min(r, gg, b);
        satSum += hi <= 1e-4 ? 0 : (hi - lo) / hi;
        if (l < min) min = l;
        if (l > max) max = l;
      }
      const mean = sum / n;

      // Seam check: how different is the wrap-around column/row pair from a
      // neighbouring interior pair? A truly tileable image scores near 1.
      const rowDiff = (ya, yb) => {
        let d = 0;
        for (let x = 0; x < size; x++) {
          const a = (ya * size + x) * 4;
          const b = (yb * size + x) * 4;
          d += Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]);
        }
        return d / (size * 3 * 255);
      };
      const colDiff = (xa, xb) => {
        let d = 0;
        for (let y = 0; y < size; y++) {
          const a = (y * size + xa) * 4;
          const b = (y * size + xb) * 4;
          d += Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]);
        }
        return d / (size * 3 * 255);
      };
      const seamV = colDiff(size - 1, 0) / Math.max(1e-4, colDiff(size >> 1, (size >> 1) + 1));
      const seamH = rowDiff(size - 1, 0) / Math.max(1e-4, rowDiff(size >> 1, (size >> 1) + 1));

      const url = c.toDataURL('image/webp', quality);
      return {
        url,
        stats: {
          mean: +mean.toFixed(5),
          spread: +Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(5),
          saturation: +(satSum / n).toFixed(5),
          min: +min.toFixed(4),
          max: +max.toFixed(4),
          seam: +Math.max(seamV, seamH).toFixed(3),
        },
      };
    },
    { dataUrl, size, quality },
  );
}

const entries = [];
let masterBytes = 0;
let shippedBytes = 0;

for (const file of masters) {
  const slug = basename(file).replace(/\.[^.]+$/, '');
  const meta = CATEGORY[slug];
  if (!meta) {
    console.warn(`  skip ${slug} — no category mapping (add it to CATEGORY in this script)`);
    continue;
  }
  const srcPath = join(SRC_DIR, file);
  const outPath = join(OUT_DIR, `${slug}.webp`);
  masterBytes += statSync(srcPath).size;

  if (!FORCE && existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(srcPath).mtimeMs) {
    // Still needs manifest stats, so re-measure from the already-shipped file.
    const { stats } = await bake(
      `data:image/webp;base64,${readFileSync(outPath).toString('base64')}`,
      SIZE,
      QUALITY,
    );
    const bytes = statSync(outPath).size;
    shippedBytes += bytes;
    entries.push({ slug, ...meta, file: `${slug}.webp`, size: SIZE, bytes, ...stats });
    console.log(`  = ${slug.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(4)} KB (cached)`);
    continue;
  }

  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const { url, stats } = await bake(
    `data:${mime};base64,${readFileSync(srcPath).toString('base64')}`,
    SIZE,
    QUALITY,
  );
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(outPath, buf);
  shippedBytes += buf.length;
  entries.push({ slug, ...meta, file: `${slug}.webp`, size: SIZE, bytes: buf.length, ...stats });
  const seamNote = stats.seam > 2.2 ? `  ⚠ seam ${stats.seam.toFixed(1)}×` : '';
  console.log(`  → ${slug.padEnd(16)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB${seamNote}`);
}

await browser.close();

entries.sort((a, b) => (a.category === b.category ? a.slug.localeCompare(b.slug) : a.category.localeCompare(b.category)));
const manifest = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  size: SIZE,
  quality: QUALITY,
  note: 'Baked by scripts/prepare-assets.mjs from assets/generated/materials. Do not hand-edit.',
  materials: entries,
};
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `\n${entries.length} tiles  ${(masterBytes / 1048576).toFixed(1)} MB masters → ` +
    `${(shippedBytes / 1024).toFixed(0)} KB shipped ` +
    `(${(100 - (shippedBytes / masterBytes) * 100).toFixed(1)}% smaller)`,
);
console.log(`manifest: public/materials/manifest.json`);
