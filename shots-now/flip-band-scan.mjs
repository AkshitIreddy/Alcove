/**
 * shots-now/flip-band-scan.mjs — settle the reader's "mid-turn, the bottom half
 * of the ruled page shows a shadowy band" by differencing each frozen frame
 * against the SAME spread at rest.
 *
 * ## Why the frames needed a second measure at all
 *
 * flip-band.mjs reports "no shadow band" from the 90th percentile of each of 24
 * horizontal bands. Sorted ascending, the 90th percentile is a value out of the
 * BRIGHTEST tenth, so it does not move until more than 90% of a row is darker
 * than paper:
 *
 *     10% of a row darkened -> reports 242 (clean paper)
 *     25%  ->  242      75%  ->  242      90%  ->  242      95%  ->  207
 *
 * The slab that produced the reader's report was a QUARTER of a leaf wide. So
 * that probe's green result is evidence about full-width washes, and says
 * almost nothing about the thing being looked for.
 *
 * ## Why "is this tile darker than cream" does not work either
 *
 * The first cut of this file asked that, locally, in 24px tiles — and flagged
 * fifteen frames of seventeen, because a page is covered in things that are
 * legitimately darker than paper: a green callout, an amber highlight, a washi
 * strip, dashed diagram boxes, the gutter. Fitting each tile to the only ray
 * this app can darken paper along (`color *= mix(vec3(1), FLAT_SHADOW, a)`,
 * curl.ts) excluded the coloured content but still could not tell a wash from
 * a warm-GREY fill, because at that point they are the same colour. Colour
 * alone cannot answer this.
 *
 * ## What this does instead
 *
 * curl.ts pins one region exactly: "uFoldD is never negative, so the strip
 * between the gutter and the fold always has d <= 0 and is left exactly where
 * the DOM drew it." That strip is also precisely where the removed self-shadow
 * used to land — its header describes a slab "hard at the fold, fading toward
 * the spine", over "the un-deformed strip between the spine and the fold".
 *
 * So the strip is differenced against `rest-<label>.png`, the same spread shot
 * at rest moments earlier. Identical content, identical geometry, so content
 * cancels exactly and what is left is what the TURN added. A wash of any width,
 * any softness, any colour shows up; a green callout shows up as zero.
 *
 * The mask is computed from the uniforms the GPU was actually handed (recorded
 * in report.json by flip-band.mjs), not from guesses:
 *
 *   - leaf-local d for each tile corner, spine-anchored and tilted exactly as
 *     the vertex shader does it, must be < 0 — undeformed;
 *   - and further back than the wrapped sheet's tail, which past a half turn
 *     lies back ON TOP of that strip: tailReach = (leafW − foldD) − π·radius;
 *   - plus a margin, because perspective pushes the lifted silhouette outward.
 *
 * Everything outside the mask (the moving sheet itself, the crease, the ground
 * beyond it) is left grey in the maps and excluded from the verdict — this
 * measure is about the flat page, which is what the report is about.
 *
 * A frame's OTHER leaf is inside the mask and is untouched live DOM in both
 * shots, so it doubles as the alignment control: if the two frames were
 * misaligned or the screenshots straddled a re-layout, it would not read zero.
 *
 * ## Why the verdict is taken on BARE paper only
 *
 * The first version of this file differenced every masked tile and duly
 * reported BAND FOUND on four frames of twelve — up to +66 luminance. None of
 * it was a shadow. Split the same tiles by whether they carry ink at rest:
 *
 *     edge-p15   bare paper 4232 tiles, worst +0.15  |  inked 2068, worst +40.56
 *     prev-p35   bare paper 2672 tiles, worst +0.30  |  inked 2088, worst +66.59
 *
 * Every hit was on a glyph. Mid-turn the leaf's flat strip is no longer live
 * DOM — it is the html-to-image snapshot, drawn through the GL ground pass —
 * and the same sentence rasterized twice does not land on the same subpixels.
 * The heat maps show it plainly: text-shaped runs with BLUE (lighter) tiles
 * mixed into the red, which is a re-rendering, not a wash. It is the design
 * doc's risk #1 (snapshot fidelity), and it is invisible at rest because the
 * swap only ever happens with the page flat.
 *
 * So the verdict is taken on tiles that are bare paper at rest, where there is
 * no glyph noise to hide in — and where a shadow band, which darkens PAPER,
 * necessarily lands. That makes this measure strictly MORE sensitive to the
 * thing the reader reported, not less: the tolerance can sit just above the
 * ±0.3 that survives, instead of being lost under ±66 of text. The inked
 * tiles are still measured and printed, because a wash broad enough to cover
 * a whole leaf would darken them too — they just cannot fail the run alone.
 *
 * Decoding runs in a headless chromium (no PNG decoder in this tree); nothing
 * is fetched from the dev server, so this scans frames captured at any time.
 *
 * Usage: node shots-now/flip-band-scan.mjs [--dir=shots-now/flip-band]
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const DIR = opt('dir', 'shots-now/flip-band');
const OUT = join(DIR, 'scan');
mkdirSync(OUT, { recursive: true });

/** Tile edge, px. Fine enough to catch a narrow band, coarse enough to be quiet. */
const TILE = 12;
/**
 * How far a tile of undeformed BARE paper may darken between rest and
 * mid-turn. A 22%-alpha FLAT_SHADOW over cream costs ~35 luminance levels and
 * the removed self-shadow ran to a quarter of that at its faintest, so 1.5 is
 * far below anything anyone could report seeing — and it is five times the
 * ±0.3 that a clean run actually produces, so it is not a hair trigger either.
 */
const DIFF_TOLERANCE = 1.5;
/**
 * How flat a tile must be at rest to count as bare paper: no pixel more than
 * this far off the tile's own brightest. A ruled line, a glyph, a callout
 * fill or a washi strip all blow straight past it; paper plus its own PNG
 * rounding does not.
 */
const BARE_PAPER_RANGE = 6;
/**
 * Slack on the mask edge, px: perspective pushes the lifted sheet's silhouette
 * outward from the canvas centre (curl.ts silhouetteOffset measures ~12px
 * mid-flip), and the sheet's own edge is antialiased.
 */
const MASK_MARGIN = 28;

const reportPath = join(DIR, 'report.json');
if (!existsSync(reportPath)) {
  throw new Error(`${reportPath} not found — run shots-now/flip-band.mjs first`);
}
const uniformsByLabel = new Map(
  JSON.parse(readFileSync(reportPath, 'utf8'))
    .filter((e) => e.uniforms && e.uniforms.uFoldD !== undefined)
    .map((e) => [e.label, e.uniforms]),
);

const frames = readdirSync(DIR)
  .filter(
    (f) =>
      f.endsWith('.png') &&
      !f.startsWith('boost-') &&
      !f.startsWith('rest-') &&
      !f.startsWith('_tex'),
  )
  .sort();
if (frames.length === 0) throw new Error(`no frames in ${DIR}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

/**
 * Difference one frozen frame against its at-rest twin over the undeformed
 * strip. `mask` is null for the tween frames, whose fold was never recorded;
 * those get a map and no verdict.
 */
async function diff(frameB64, restB64, mask, bareRange) {
  return page.evaluate(
    async ([a, b, m, tile, bareRange]) => {
      const load = async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const A = await load(a);
      const B = await load(b);
      if (A.width !== B.width || A.height !== B.height) {
        return { error: `size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}` };
      }
      const { width, height } = A;
      const median = (v) => {
        if (v.length === 0) return null;
        v.sort((x, y) => x - y);
        const i = v.length >> 1;
        return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
      };
      const lum = (px, i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

      /** Leaf-local signed distance from the fold line, exactly as CURL_VERT_SRC. */
      const foldDistance = (cx, cy) => {
        const localY = cy - m.leafY;
        const localX = m.dir > 0 ? cx - m.leafX : m.leafX + m.leafW - cx;
        return (
          localX * Math.cos(m.tilt) + (localY - m.leafH / 2) * Math.sin(m.tilt) - m.foldD
        );
      };

      const cols = Math.floor(width / tile);
      const rows = Math.floor(height / tile);
      const cells = [];
      /** Worst darkening on tiles that are bare paper at rest — the verdict. */
      let worst = { delta: 0, x: -1, y: -1 };
      /** Same on tiles carrying ink — reported, never fatal. See the header. */
      let worstInk = { delta: 0, x: -1, y: -1 };
      let masked = 0;
      let bareTiles = 0;
      let sumAbs = 0;

      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let cx = 0; cx < cols; cx++) {
          const x0 = cx * tile;
          const y0 = r * tile;
          let safe = m !== null;
          if (safe) {
            // Every corner must clear the fold AND the wrapped tail.
            const limit = -(m.tailReach + m.margin);
            for (const [px, py] of [
              [x0, y0],
              [x0 + tile, y0],
              [x0, y0 + tile],
              [x0 + tile, y0 + tile],
            ]) {
              if (foldDistance(px, py) >= limit) {
                safe = false;
                break;
              }
            }
          }
          if (!safe) {
            row.push(null);
            continue;
          }
          const va = [];
          const vb = [];
          // The tile's own contrast AT REST decides whether it is bare paper.
          // Taken from the rest shot, not the frame: the frame is the thing
          // under suspicion, and a wash laid over paper would raise its range
          // and quietly excuse the very tile it landed on.
          let minRest = 255;
          let maxRest = 0;
          for (let y = y0; y < y0 + tile; y++) {
            for (let x = x0; x < x0 + tile; x++) {
              const i = (y * width + x) * 4;
              va.push(lum(A.data, i));
              const rest = lum(B.data, i);
              vb.push(rest);
              if (rest < minRest) minRest = rest;
              if (rest > maxRest) maxRest = rest;
            }
          }
          // Positive = the turn made this tile DARKER than it is at rest.
          const delta = median(vb) - median(va);
          row.push(+delta.toFixed(2));
          masked++;
          if (maxRest - minRest <= bareRange) {
            bareTiles++;
            sumAbs += Math.abs(delta);
            if (delta > worst.delta) worst = { delta: +delta.toFixed(2), x: x0, y: y0 };
          } else if (delta > worstInk.delta) {
            worstInk = { delta: +delta.toFixed(2), x: x0, y: y0 };
          }
        }
        cells.push(row);
      }

      // Map: white where nothing changed, red where the turn darkened, blue
      // where it lightened, grey where the tile is not flat undeformed paper.
      const hm = document.createElement('canvas');
      hm.width = cols * tile;
      hm.height = rows * tile;
      const hg = hm.getContext('2d');
      for (let r = 0; r < rows; r++) {
        for (let cx = 0; cx < cols; cx++) {
          const d = cells[r][cx];
          if (d === null) hg.fillStyle = '#c9c9c9';
          else {
            const t = Math.max(0, Math.min(1, Math.abs(d) / 12));
            const off = Math.round(255 * (1 - t));
            hg.fillStyle = d > 0 ? `rgb(255,${off},${off})` : `rgb(${off},${off},255)`;
          }
          hg.fillRect(cx * tile, r * tile, tile, tile);
        }
      }

      return {
        width,
        height,
        maskedTiles: masked,
        bareTiles,
        totalTiles: rows * cols,
        worstDarkening: worst,
        worstInkDarkening: worstInk,
        meanAbsDelta: bareTiles === 0 ? null : +(sumAbs / bareTiles).toFixed(3),
        heat: hm.toDataURL('image/png'),
      };
    },
    [frameB64, restB64, mask, TILE, bareRange],
  );
}

const failures = [];
const notes = [];
const report = [];

for (const file of frames) {
  const label = file.replace(/\.png$/, '');
  const restPath = join(DIR, `rest-${file}`);
  if (!existsSync(restPath)) {
    notes.push(`${file}: no rest-${file} beside it — rerun shots-now/flip-band.mjs`);
    continue;
  }
  const u = uniformsByLabel.get(label);
  const mask =
    u === undefined
      ? null
      : {
          dir: u.uDir,
          leafX: u.uLeafOrigin[0],
          leafY: u.uLeafOrigin[1],
          leafW: u.uLeafSize[0],
          leafH: u.uLeafSize[1],
          foldD: u.uFoldD,
          tilt: u.uTilt,
          // Past a half turn the sheet lies back over the strip it already
          // covered; everything within tailReach of the fold is under paper,
          // not flat.
          tailReach: Math.max(0, u.uLeafSize[0] - u.uFoldD - Math.PI * u.uRadius),
          margin: MASK_MARGIN,
        };

  const d = await diff(
    readFileSync(join(DIR, file)).toString('base64'),
    readFileSync(restPath).toString('base64'),
    mask,
    BARE_PAPER_RANGE,
  );
  if (d.error) {
    failures.push(`${file}: ${d.error}`);
    continue;
  }
  writeFileSync(
    join(OUT, `diff-${file}`),
    Buffer.from(d.heat.replace(/^data:image\/png;base64,/, ''), 'base64'),
  );

  if (mask === null) {
    notes.push(`${file}: no fold recorded (tween frame) — map written, no verdict`);
    report.push({ file, ...d, heat: undefined, verdict: 'no-mask' });
    console.log(`  --   ${file.padEnd(16)} no fold recorded; map only`);
    continue;
  }
  const ok = d.worstDarkening.delta <= DIFF_TOLERANCE;
  if (!ok) {
    failures.push(
      `${file}: bare undeformed paper at (${d.worstDarkening.x},${d.worstDarkening.y}) is` +
        ` ${d.worstDarkening.delta} luminance darker mid-turn than at rest`,
    );
  }
  report.push({ file, ...d, heat: undefined, verdict: ok ? 'clean' : 'band' });
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${file.padEnd(16)}` +
      ` bare=${String(d.bareTiles).padStart(5)}/${String(d.maskedTiles).padStart(5)} flat` +
      `  worstOnPaper=+${d.worstDarkening.delta}` +
      ` @(${d.worstDarkening.x},${d.worstDarkening.y})` +
      `  meanAbs=${d.meanAbsDelta}` +
      `  |  worstOnInk=+${d.worstInkDarkening.delta} (snapshot re-render, not fatal)`,
  );
}

writeFileSync(join(OUT, 'diff.json'), JSON.stringify(report, null, 2));
console.log(`\n  ${report.length} frames differenced, maps in ${OUT}/`);
for (const n of notes) console.log(`  note: ${n}`);
if (failures.length > 0) {
  console.log('\n  BAND FOUND:');
  for (const f of failures) console.log(`    - ${f}`);
} else {
  console.log(
    '\n  no band: across every frozen frame, no tile of flat undeformed BARE' +
      ` paper darkens by more than ${DIFF_TOLERANCE} luminance between the` +
      ' spread at rest and the same spread mid-turn — measured against the' +
      ' frame itself, so page content cancels and a wash of any width would' +
      ' still show. worstOnInk above is the html-to-image snapshot rendering' +
      ' the same glyphs onto different subpixels; it runs both ways (the heat' +
      ' maps carry blue as well as red) and is not a shadow.',
  );
}

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
