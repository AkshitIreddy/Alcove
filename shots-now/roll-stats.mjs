/**
 * shots-now/roll-stats.mjs — what the dice can actually hand a reader.
 *
 * A tier table is easy to read as a list and hard to read as a *distribution*:
 * `spiral-notebook` is one row out of a hundred and eighty-nine, but it carries
 * weight 5 out of ~470 and there are two of it, so better than one book in
 * fifty comes out as a wire coil. This prints the pools by weight so a demotion
 * can be argued about in the units the reader experiences — how often — rather
 * than in rows.
 *
 * It loads the vocabularies out of the running dev server, so it needs no
 * TypeScript toolchain of its own and always reports the tree as it stands.
 *
 * Usage: node shots-now/roll-stats.mjs [--shapes] [--full]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const URL_BASE =
  args.find((a) => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:1420';
const FULL = args.includes('--full');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`  HTTP ${r.status()} ${r.url()}`);
});
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const stats = await page.evaluate(async () => {
  const d = await import('/src/art/bookDesign.ts');
  const s = await import('/src/art/spines.ts');
  const total = d.ROLLABLE_PRESETS.reduce((n, p) => n + p.weight, 0);
  const by = (key) => {
    const m = new Map();
    for (const p of d.ROLLABLE_PRESETS) {
      const k = typeof key === 'function' ? key(p) : p[key];
      const row = m.get(k) ?? { weight: 0, presets: [] };
      row.weight += p.weight;
      row.presets.push(p.id);
      m.set(k, row);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].weight - a[1].weight)
      .map(([k, v]) => ({
        key: k,
        weight: v.weight,
        pct: Number(((v.weight / total) * 100).toFixed(2)),
        presets: v.presets,
      }));
  };
  return {
    counts: {
      presets: d.BOOK_PRESETS.length,
      rollablePresets: d.ROLLABLE_PRESETS.length,
      shapes: d.SPINE_SHAPES.length,
      rollableShapes: d.ROLLABLE_SHAPES.length,
      materials: d.MATERIAL_LOOKS.length,
      rollableMaterials: d.ROLLABLE_MATERIALS.length,
      decorations: d.DECORATIONS.length,
      rollableDecorations: d.ROLLABLE_DECORATIONS.length,
      plates: s.TITLE_PLATES.length,
      edges: s.EDGE_TREATMENTS.length,
      ornaments: s.ORNAMENT_COUNT,
    },
    totalWeight: total,
    byShape: by('shape'),
    byMaterial: by('material'),
    byDecoration: by((p) => p.decorations.join('+')),
    byTier: by('tier'),
    presets: d.BOOK_PRESETS.map((p) => ({
      id: p.id,
      tier: p.tier,
      group: p.group,
      shape: p.shape,
      weight: p.weight,
    })),
  };
});

console.log('counts:', JSON.stringify(stats.counts));
console.log('roll weight total:', stats.totalWeight);
console.log('\n--- by tier ---');
for (const r of stats.byTier) console.log(`  ${String(r.pct).padStart(6)}%  ${r.key}`);
console.log('\n--- by silhouette (share of the roll) ---');
for (const r of stats.byShape) {
  console.log(`  ${String(r.pct).padStart(6)}%  ${r.key.padEnd(16)} ${r.presets.join(', ')}`);
}
if (FULL) {
  console.log('\n--- by covering ---');
  for (const r of stats.byMaterial) console.log(`  ${String(r.pct).padStart(6)}%  ${r.key}`);
  console.log('\n--- by ornament set ---');
  for (const r of stats.byDecoration) console.log(`  ${String(r.pct).padStart(6)}%  ${r.key}`);
}

await browser.close();
