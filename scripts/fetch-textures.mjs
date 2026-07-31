/**
 * scripts/fetch-textures.mjs — build the CC0 material library.
 *
 * Downloads a curated set of seamless PBR textures from Poly Haven and
 * ambientCG (both CC0 / public domain, no attribution required, commercial
 * use fine), then processes them into small tileable assets the art pipeline
 * can sample:
 *
 *   assets/textures/<slug>/albedo.webp   colour, tinted at runtime
 *   assets/textures/<slug>/normal.webp   feeds the deferred lighting G-buffer
 *   assets/textures/<slug>/rough.webp    modulates specular/sheen
 *   assets/textures/manifest.json        slug -> {category, maps, source, size}
 *
 * Why this exists: procedurally-noised "wood" reads as computer-generated no
 * matter how many octaves you stack. A real photographed grain, tinted to the
 * theme and lit by a real normal map, reads as material. We paint the FORMS
 * with brushes and let photography carry the SURFACE.
 *
 * Usage:  node scripts/fetch-textures.mjs [--size 512] [--only wood-oak]
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'textures');

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SIZE = Number(argOf('--size', 512));
const ONLY = argOf('--only', null);

/**
 * The curated library. Each entry names a real CC0 asset; `category` is what
 * the art code asks for, so several textures can compete for one role and the
 * art layer picks per-seed.
 */
const LIBRARY = [
  // ---- wood: case, planks, rails -----------------------------------------
  { slug: 'wood-planks-oak', source: 'polyhaven', id: 'wood_planks', category: 'wood' },
  { slug: 'wood-fine-dark', source: 'polyhaven', id: 'dark_wood', category: 'wood' },
  { slug: 'wood-painted', source: 'polyhaven', id: 'black_painted_planks', category: 'wood-painted' },
  { slug: 'wood-worn', source: 'polyhaven', id: 'weathered_planks', category: 'wood-worn' },
  { slug: 'bark-willow', source: 'polyhaven', id: 'bark_willow', category: 'bark' },

  // ---- book bindings ------------------------------------------------------
  { slug: 'leather-worn', source: 'ambientcg', id: 'Leather011', category: 'leather' },
  { slug: 'leather-fine', source: 'ambientcg', id: 'Leather026', category: 'leather' },
  { slug: 'fabric-linen', source: 'ambientcg', id: 'Fabric004', category: 'cloth' },
  { slug: 'fabric-weave', source: 'ambientcg', id: 'Fabric062', category: 'cloth' },
  { slug: 'fabric-velvet', source: 'ambientcg', id: 'Fabric030', category: 'cloth-soft' },

  // ---- paper: pages, labels, wallpaper ------------------------------------
  { slug: 'paper-plain', source: 'ambientcg', id: 'Paper003', category: 'paper' },
  { slug: 'paper-rough', source: 'ambientcg', id: 'Paper001', category: 'paper' },
  { slug: 'cardboard', source: 'ambientcg', id: 'Cardboard004', category: 'paper-board' },

  // ---- accents: marbled boards, metal fittings, plaster -------------------
  { slug: 'marble-white', source: 'polyhaven', id: 'marble_01', category: 'marble' },
  { slug: 'metal-brass', source: 'ambientcg', id: 'Metal032', category: 'metal' },
  { slug: 'plaster-wall', source: 'ambientcg', id: 'Plaster001', category: 'plaster' },

  // ---- nature -------------------------------------------------------------
  { slug: 'moss-ground', source: 'polyhaven', id: 'forest_ground_04', category: 'moss' },
  { slug: 'leaves-forest', source: 'polyhaven', id: 'forest_leaves_02', category: 'foliage' },
];

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

const getJson = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'notebook-app-asset-pipeline' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const getBuffer = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': 'notebook-app-asset-pipeline' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

/** Poly Haven: /files/<id> gives a map -> resolution -> format -> {url}. */
async function polyhavenUrls(id) {
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const pick = (mapNames) => {
    for (const name of mapNames) {
      const entry = files[name];
      if (!entry) continue;
      const res = entry['1k'] ?? entry['2k'] ?? Object.values(entry)[0];
      const file = res?.jpg ?? res?.png ?? Object.values(res ?? {})[0];
      if (file?.url) return file.url;
    }
    return null;
  };
  return {
    albedo: pick(['Diffuse', 'diff', 'albedo', 'Color']),
    normal: pick(['nor_gl', 'nor_dx', 'Normal']),
    rough: pick(['Rough', 'rough', 'Roughness']),
  };
}

/** ambientCG: predictable download URLs per asset id. */
function ambientcgUrls(id) {
  const base = `https://ambientcg.com/get?file=${id}_1K-JPG`;
  // ambientCG ships a single zip per asset; the per-map PNG endpoints are the
  // reliable way to grab individual maps without unzipping.
  const map = (suffix) => `https://ambientcg.com/get?file=${id}_1K-JPG_${suffix}.jpg`;
  return {
    albedo: map('Color'),
    normal: map('NormalGL'),
    rough: map('Roughness'),
    _zip: base,
  };
}

/** Tileable downscale → webp. Normal maps stay lossless-ish to avoid banding. */
async function processMap(buffer, outPath, kind) {
  const img = sharp(buffer).resize(SIZE, SIZE, { fit: 'fill' });
  if (kind === 'normal') {
    await img.webp({ quality: 92, effort: 5 }).toFile(outPath);
  } else if (kind === 'rough') {
    // Roughness is a single channel; store as greyscale to save bytes.
    await img.greyscale().webp({ quality: 80, effort: 5 }).toFile(outPath);
  } else {
    await img.webp({ quality: 84, effort: 5 }).toFile(outPath);
  }
}

async function fetchOne(entry) {
  const dir = join(OUT, entry.slug);
  await mkdir(dir, { recursive: true });

  const urls =
    entry.source === 'polyhaven'
      ? await polyhavenUrls(entry.id)
      : ambientcgUrls(entry.id);

  const maps = {};
  for (const kind of ['albedo', 'normal', 'rough']) {
    const url = urls[kind];
    if (!url) continue;
    const outPath = join(dir, `${kind}.webp`);
    if (await exists(outPath)) {
      maps[kind] = `${entry.slug}/${kind}.webp`;
      continue;
    }
    try {
      const buf = await getBuffer(url);
      await processMap(buf, outPath, kind);
      maps[kind] = `${entry.slug}/${kind}.webp`;
      process.stdout.write(`  ${entry.slug}/${kind} ok\n`);
    } catch (err) {
      process.stdout.write(`  ${entry.slug}/${kind} MISSING (${err.message})\n`);
    }
  }
  return { ...entry, maps };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const targets = ONLY ? LIBRARY.filter((e) => e.slug === ONLY) : LIBRARY;
  const results = [];
  for (const entry of targets) {
    process.stdout.write(`${entry.slug} (${entry.source}:${entry.id})\n`);
    try {
      results.push(await fetchOne(entry));
    } catch (err) {
      process.stdout.write(`  FAILED: ${err.message}\n`);
    }
  }

  // Merge into any existing manifest so partial runs accumulate.
  const manifestPath = join(OUT, 'manifest.json');
  let previous = {};
  if (await exists(manifestPath)) {
    previous = JSON.parse(await readFile(manifestPath, 'utf8')).textures ?? {};
  }
  const textures = { ...previous };
  for (const r of results) {
    if (Object.keys(r.maps).length > 0) {
      textures[r.slug] = { category: r.category, source: r.source, id: r.id, maps: r.maps, size: SIZE };
    }
  }

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        note: 'CC0 / public domain textures from Poly Haven and ambientCG. No attribution required; commercial use permitted.',
        generatedBy: 'scripts/fetch-textures.mjs',
        size: SIZE,
        textures,
      },
      null,
      2,
    ),
    'utf8',
  );

  const ok = Object.keys(textures).length;
  process.stdout.write(`\nmanifest: ${ok} textures at ${SIZE}px -> assets/textures/manifest.json\n`);
}

await main();
