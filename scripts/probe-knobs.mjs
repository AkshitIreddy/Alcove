/**
 * scripts/probe-knobs.mjs — which Book Studio knobs actually move a pixel?
 *
 * Renders the real spine and the real cover through the real entry points
 * (`resolveBookStyle` → `renderSpine` / `renderCoverInto`) once per knob value
 * and hashes the result. A knob whose every value hashes the same is a dead
 * control: it is on the sheet, the reader turns it, and nothing happens.
 *
 * Runs in the dev server's own module graph, so there is no second copy of the
 * art to drift from the one that ships.
 *
 * Usage: node scripts/probe-knobs.mjs [--url=http://localhost:1420] [--preset=limp-vellum]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const PRESET = opt('preset', '');

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });

const report = await page.evaluate(async (preset) => {
  const bs = await import('/src/art/bookStyle.ts');
  const spines = await import('/src/art/spines.ts');
  const covers = await import('/src/art/covers.ts');

  const SEED = 0x51ed0001;

  const hash = (canvas) => {
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
  };

  const spineHash = (style) => {
    const r = bs.resolveBookStyle(SEED, null, style);
    const c = document.createElement('canvas');
    c.width = 90;
    c.height = 300;
    const ctx = c.getContext('2d');
    const params = preset ? { ...r.spine, binding: preset } : r.spine;
    spines.renderSpine(ctx, params, 20, 6, 288, 288 / r.style.height, 'Cell Biology', {
      hiRes: true,
    });
    return hash(c);
  };

  const coverHash = (style) => {
    const r = bs.resolveBookStyle(SEED, null, style);
    const c = document.createElement('canvas');
    c.width = 214;
    c.height = 292;
    covers.renderCoverInto(c.getContext('2d'), 214, 292, r.cover, 'Cell Biology');
    return hash(c);
  };

  const KNOBS = {
    material: ['leather', 'cloth', 'paper', 'vellum', 'linen', 'silk', 'marbled'],
    pigment: [0, 1, 2, 3, 4, 10, 12, 16, 19],
    hueJitter: [-12, 0, 12],
    raisedBands: [0, 1, 3, 5],
    bandGilt: [false, true],
    headTail: [false, true],
    headTailStyle: [0, 1, 2],
    ornament: [-1, 0, 3, 7, 11],
    titlePlate: ['none', 'label', 'panel', 'ribbon'],
    titleFont: [0, 1, 2],
    wear: [0, 0.5, 1],
    edge: ['plain', 'gilt', 'sprinkled', 'marbled'],
    height: [140, 200, 260, 296],
    thickness: [14, 30, 52],
    gilt: [false, true],
    charm: ['none', 'ribbon', 'tassel', 'bookplate'],
    charmColor: [0, 3, 6],
    coverFrame: [0, 1, 2, 3],
    coverMedallion: [0, 2, 5, 7],
    cornerProtectors: [false, true],
    insetPlate: [false, true],
  };

  // A knob can only be seen in the right company: `bandGilt` on a book with no
  // cords, or `charmColor` on a book with no charm, is invisible because there
  // is nothing for it to colour — not because it is dead.
  const CONTEXT = {
    bandGilt: { raisedBands: 3 },
    headTailStyle: { headTail: true },
    charmColor: { charm: 'ribbon' },
    titleFont: { titlePlate: 'label' },
  };

  const base = bs.bookStyleToOverrides(bs.resolveBookStyle(SEED, null, null).style);
  const out = {};
  for (const [key, values] of Object.entries(KNOBS)) {
    const sHashes = new Set();
    const cHashes = new Set();
    for (const v of values) {
      const style = { ...base, ...(CONTEXT[key] ?? {}), [key]: v };
      sHashes.add(spineHash(style));
      cHashes.add(coverHash(style));
    }
    out[key] = { spine: sHashes.size, cover: cHashes.size, of: values.length };
  }
  return { preset: preset || '(seed choice)', out };
}, PRESET);

console.log(`\nbinding: ${report.preset}`);
console.log('knob                 spine   cover   (distinct renders / values tried)');
for (const [key, v] of Object.entries(report.out)) {
  const dead = v.spine === 1 && v.cover === 1 ? '   <<< DEAD' : '';
  console.log(
    `  ${key.padEnd(20)} ${String(v.spine).padStart(2)}/${v.of}   ${String(v.cover).padStart(2)}/${v.of}${dead}`,
  );
}

await browser.close();
