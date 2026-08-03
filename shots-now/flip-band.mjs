/**
 * shots-now/flip-band.mjs — freeze the page turn mid-curl and look at the
 * bottom half of the ruled page.
 *
 * Reader report: "mid-turn, the bottom half of the ruled page shows a shadowy
 * band." The lighting model that used to cause exactly that was removed and a
 * depth buffer added (see the header of src/flip/curl.ts), so this probe
 * exists to settle whether anything shadowy is still there.
 *
 * HOW IT FREEZES — it does not tween at all. A pointer drag IS the flip's p
 * (math.ts dragToP: p = (W − xLeafLocal) / 2W), so pressing the edge hotspot
 * and holding the pointer at a computed x parks the curl at an exact p with no
 * animation running. p > 0.5 means dragging PAST the gutter, which is the
 * regime the reported artefact lives in (the sheet's tail lies back flat on
 * top of the strip it already covered).
 *
 * HOW IT READS THE APPLIED STATE — src/flip has no `?fx=force` bridge, and
 * inventing one would mean shipping product code to serve a probe. Instead the
 * WebGL2 prototype is patched in an init script BEFORE any app code runs:
 * getUniformLocation records name→location, the uniform setters record values,
 * and drawElements snapshots them per draw call. So every number reported here
 * is the number the GPU was actually handed — not what the CPU meant to send.
 * texImage2D is likewise tapped so the three page snapshots can be dumped as
 * PNGs; without that there is no way to tell "the revealed page is showing
 * through the moving sheet" from "the moving sheet is showing the right page".
 *
 * Usage: node shots-now/flip-band.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'shots-now/flip-band';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(120_000);
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160));
});

/* ------------------------------------------------ GL tap (before app code) */

await page.addInitScript(() => {
  const CURL_UNIFORMS = new Set([
    'uFoldD',
    'uTilt',
    'uRadius',
    'uLift',
    'uShadowStart',
    'uDir',
    'uCamDist',
    'uLeafSize',
    'uLeafOrigin',
    'uCanvasSize',
    'uPaperMix',
    'uPaperMean',
    'uPaperScale',
  ]);
  const proto = WebGL2RenderingContext.prototype;
  const names = new WeakMap();
  const live = {};
  const draws = [];
  const textures = [];
  let capture = false;

  const origLoc = proto.getUniformLocation;
  proto.getUniformLocation = function (program, name) {
    const loc = origLoc.call(this, program, name);
    if (loc && CURL_UNIFORMS.has(name)) names.set(loc, name);
    return loc;
  };
  for (const fn of ['uniform1f', 'uniform2f']) {
    const orig = proto[fn];
    proto[fn] = function (loc, ...rest) {
      const name = loc ? names.get(loc) : undefined;
      if (name) live[name] = rest.length === 1 ? rest[0] : [...rest];
      return orig.call(this, loc, ...rest);
    };
  }
  const origDraw = proto.drawElements;
  proto.drawElements = function (mode, count, type, offset) {
    // Only the flip's own two draws touch these uniforms; anything else on the
    // page (the Pixi shelf) never sets them, so `live` stays the curl's.
    if (capture && live['uFoldD'] !== undefined) {
      draws.push({ count, uniforms: { ...live } });
    }
    return origDraw.call(this, mode, count, type, offset);
  };
  const origTex = proto.texImage2D;
  proto.texImage2D = function (...a) {
    const source = a[a.length - 1];
    if (
      capture &&
      (source instanceof ImageBitmap || source instanceof HTMLCanvasElement) &&
      source.width > 64
    ) {
      try {
        const scale = Math.min(1, 360 / source.width);
        const c = document.createElement('canvas');
        c.width = Math.round(source.width * scale);
        c.height = Math.round(source.height * scale);
        c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
        textures.push({
          w: source.width,
          h: source.height,
          png: c.toDataURL('image/png'),
        });
      } catch {
        textures.push({ w: source.width, h: source.height, png: null });
      }
    }
    return origTex.apply(this, a);
  };

  globalThis.__glTap = {
    start() {
      capture = true;
      draws.length = 0;
      textures.length = 0;
    },
    stop() {
      capture = false;
    },
    draws: () => draws.slice(),
    textures: () => textures.map((t) => ({ w: t.w, h: t.h })),
    texturePngs: () => textures.map((t) => t.png),
  };
});

/* --------------------------------------------------------------- open a book */

/**
 * Load the shelf and open the seeded book, whole thing retried.
 *
 * The dev server is shared with other agents editing this tree, so an HMR
 * reload can land at any point and destroy the execution context; without the
 * retry a run dies on whichever evaluate happened to be in flight.
 */
async function openBook() {
  await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, { polling: 400 });

  for (let i = 0; i < 4; i++) {
    const skip = page.locator('text=skip the tour').first();
    if ((await skip.count()) === 0) break;
    await skip.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
  }

  // Pull the seeded book through the a11y mirror (no pixel hunting), then read it.
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('.nb-flip-surface').count()) > 0) break;
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    await page
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .catch(() => {});
    const read = page.getByRole('button', { name: 'read it' });
    if ((await read.count()) > 0) await read.click().catch(() => {});
    await page
      .locator('.nb-flip-surface')
      .waitFor({ state: 'visible', timeout: 25_000 })
      .catch(() => {});
  }
  await page.waitForSelector('.nb-flip-surface', { timeout: 30_000 });
  await page.waitForSelector('.nb-prose p', { timeout: 30_000 });
}

let opened = false;
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  try {
    await openBook();
    opened = true;
  } catch (error) {
    console.log(`  open attempt ${attempt + 1} failed: ${String(error).split('\n')[0]}`);
    await page.waitForTimeout(2000);
  }
}
if (!opened) throw new Error('could not open the seeded book');

// Stay on the OPENING spread and flip forward from there. The seeded book has
// five pages, so a flip out of the second spread has nextRight = null and the
// revealed page is plain cream — i.e. the ruled page the reader is describing
// is not on screen at all, and the probe would be looking at nothing. The
// texture count printed below is the guard: three uploads = three real faces.
await page.waitForTimeout(6000);

/**
 * One shot of the spread, surviving a dev-server reload.
 *
 * The dev server is shared with other agents editing this tree, so a save can
 * full-reload the page at any moment — which closes the book and leaves every
 * locator waiting on a spread that no longer exists. Without this the run dies
 * on whichever screenshot happened to be in flight, having thrown away the
 * frames it already had.
 */
async function surfaceShot(recover = true) {
  try {
    return await page.locator('.nb-flip-surface').screenshot({ timeout: 25_000 });
  } catch (error) {
    if (!recover) throw error;
    console.log('    lost the spread (dev-server reload?) — reopening');
    await openBook();
    await page.waitForTimeout(5000);
    return await page.locator('.nb-flip-surface').screenshot({ timeout: 25_000 });
  }
}

/* ------------------------------------------------------- geometry + freezing */

const geom = await page.evaluate(() => {
  const box = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  return {
    surface: box('.nb-flip-surface'),
    right: box('.nb-flip-leaf-right'),
    left: box('.nb-flip-leaf-left'),
    paper: box('.nb-flip-leaf-right .nb-sheet-paper'),
  };
});
console.log('  surface', JSON.stringify(geom.surface));
console.log('  leaf(right)', JSON.stringify(geom.right));
console.log('  paper(right)', JSON.stringify(geom.paper));

const settleFrames = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      }),
  );

/**
 * PAPER-TONE CONSTANCY — the actual test.
 *
 * The shot is decoded back inside the page (a WebGL canvas with
 * preserveDrawingBuffer:false cannot be read any other way), split into 24
 * horizontal bands, and each band's PAPER tone is taken as the 90th percentile
 * of its luminance. Ink and rules sit far below that percentile, so the number
 * is the paper itself. Unshaded paper gives the identical value in every band.
 *
 * WHAT THIS CAN AND CANNOT SEE — read before trusting a green result.
 *
 * It sees a wash that covers essentially the WHOLE width of a row, and
 * nothing narrower. An earlier version of this comment claimed a
 * quarter-page-wide slab "cannot hide from this", reasoning that 25% is well
 * past the 10% a 90th percentile tolerates. That is backwards: sorted
 * ascending, the 90th percentile is a value out of the BRIGHTEST tenth, so it
 * does not move until more than 90% of the row is darker than paper —
 *
 *     10% of a row darkened -> reports 242 (clean paper)
 *     25%  ->  242      75%  ->  242      90%  ->  242      95%  ->  207
 *
 * — and the slab that produced the reader's report was a quarter of a leaf.
 * So this number is a full-width-wash check plus a live control, and the
 * LOCAL check is `shots-now/flip-band-scan.mjs`, which differences each frame
 * against the `rest-*.png` shot taken beside it.
 *
 * `control` is a narrow column through the contact shadow: it MUST come back
 * darker than the paper, otherwise the measurement has gone blind and a clean
 * result would mean nothing.
 */
async function measure(pngBuffer, control) {
  const b64 = pngBuffer.toString('base64');
  return page.evaluate(
    async ([data, ctrl]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const { data: px, width, height } = g.getImageData(0, 0, c.width, c.height);
      const lum = (i) => 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const percentile = (vals, q) => {
        vals.sort((a, b) => a - b);
        return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
      };

      const BANDS = 24;
      const step = Math.floor(height / BANDS);
      const bands = [];
      for (let b = 0; b < BANDS; b++) {
        const vals = [];
        for (let y = b * step; y < Math.min((b + 1) * step, height); y++) {
          for (let x = 0; x < width; x += 2) vals.push(lum((y * width + x) * 4));
        }
        bands.push(+percentile(vals, 0.9).toFixed(2));
      }

      // Control: walk the crease itself. A corner grip tilts the fold, so the
      // contact band is a SLANTED line — a fixed column crosses it for only
      // part of the height and comes back reading plain paper, which would look
      // like a blind measurement rather than a tilted one.
      const ctrlVals = [];
      if (ctrl) {
        const cosT = Math.cos(ctrl.tilt);
        const sinT = Math.sin(ctrl.tilt);
        for (let ly = 0; ly < ctrl.leafH; ly++) {
          // Solve d(lx, ly) = shadowStart + half the band, in leaf-local space.
          const lx = (ctrl.foldD + ctrl.shadowStart + 9 - (ly - ctrl.leafH / 2) * sinT) / cosT;
          const cx = Math.round(
            ctrl.side === 'right' ? ctrl.originX + lx : ctrl.originX + ctrl.leafW - lx,
          );
          const y = Math.round(ctrl.originY + ly);
          if (y < 0 || y >= height) continue;
          for (let x = cx - 4; x <= cx + 4; x++) {
            if (x < 0 || x >= width) continue;
            ctrlVals.push(lum((y * width + x) * 4));
          }
        }
      }

      const paper = percentile([...bands], 0.5);
      return {
        width,
        height,
        paper: +paper.toFixed(2),
        bands,
        worstBand: +Math.max(...bands.map((v) => paper - v)).toFixed(2),
        worstBandIndex: bands.indexOf(Math.min(...bands)),
        control: ctrlVals.length ? +percentile(ctrlVals, 0.9).toFixed(2) : null,
      };
    },
    [b64, control],
  );
}

/**
 * A "paper microscope" copy of a frame, written beside it as `boost-<label>`.
 *
 * The claim here is visual, and cream paper under a 22%-alpha warm shadow is a
 * difference the eye skates over in a thumbnail. So the luminance window that
 * paper actually lives in — [190, 244] — is stretched across the full range in
 * greyscale: paper goes white, ink goes black, and anything in between (a
 * wash, a slab, a gradient, one mesh row leaking) becomes a loud grey.
 *
 * Canvas `filter: contrast()` is deliberately NOT used: it pivots on mid-grey,
 * so at any strength that makes a wash visible it has already clipped paper AND
 * the contact shadow to the same white — a view that cannot show the thing it
 * was made to show. The contact shadow reads as an obvious dark strip here,
 * which is how you can tell these frames are being rendered sensitively.
 */
async function boosted(pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  const url = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const frame = g.getImageData(0, 0, c.width, c.height);
    const px = frame.data;
    const LO = 190;
    const HI = 244;
    for (let i = 0; i < px.length; i += 4) {
      const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const s = Math.max(0, Math.min(255, ((v - LO) / (HI - LO)) * 255));
      px[i] = s;
      px[i + 1] = s;
      px[i + 2] = s;
      px[i + 3] = 255;
    }
    g.putImageData(frame, 0, 0);
    return c.toDataURL('image/png');
  }, b64);
  return Buffer.from(url.replace(/^data:image\/png;base64,/, ''), 'base64');
}

/** How far a band's paper may sit below the page's paper before it is a band. */
const BAND_TOLERANCE = 1.5;
/** How much darker the contact-shadow column must read for the probe to count. */
const CONTROL_MIN_DROP = 6;

const report = [];
const failures = [];
let dumpedTextures = false;

/**
 * One frozen frame.
 *
 * `side` picks the leaf: 'right' drags a 'next' flip (uDir +1), 'left' a
 * 'prev' one (uDir −1). Both are worth shooting — the fragment shader mirrors
 * per direction and per face, and a mirror that is wrong on one side only
 * would look like paper shaded from the wrong edge.
 */
async function frozenFrame(label, p, gripYFrac, side = 'right') {
  const leaf = side === 'right' ? geom.right : geom.left;
  const y = leaf.y + leaf.h * gripYFrac;
  // Leaf-local x runs from the SPINE outward, so which end is the outer edge —
  // and therefore which way the drag runs — flips with the side. Inverting
  // dragToP gives the pointer x for a wanted p; p > 0.5 puts it PAST the
  // gutter, on the other leaf, which is allowed and is the point.
  const startX = side === 'right' ? leaf.x + leaf.w - 12 : leaf.x + 12;
  const clientXForP = (q) =>
    side === 'right' ? leaf.x + leaf.w * (1 - 2 * q) : leaf.x + leaf.w * 2 * q;

  // math.ts is the authority on where the fold belongs; asking it (rather than
  // copying the formula in here) makes this both a retry condition and a check
  // that the shader is fed exactly what the pure math says. It is a pure
  // function, so the "second module copy" trap that bites store writes on an
  // HMR'd dev server does not apply.
  const expectedFoldD = await page.evaluate(
    async ([q, w, h]) => {
      const math = await import('/src/flip/math.ts');
      return math.foldOffset(q, w, h, 0);
    },
    [p, leaf.w, leaf.h],
  );

  // The SAME spread, at rest, before anything is dragged — the content
  // reference flip-band-scan.mjs differences against. curl.ts pins the strip
  // between the gutter and the fold exactly where the DOM drew it, so over
  // that strip the two frames must agree pixel for pixel; any darkening there
  // is the reported artefact and cannot be page content, because the content
  // is identical in both shots. Taken here rather than once at the top: the
  // probe turns pages as it goes, so "the spread at rest" is not one image.
  writeFileSync(`${OUT}/rest-${label}.png`, await surfaceShot());

  // Drag, then confirm the curl actually MOVED there before believing the
  // frame. A pointerdown that lands while a previous landing is still in
  // flight is ignored, and the shot would then be of a page at p≈0 wearing
  // this frame's label — a green result for a frame that never happened.
  let last = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => globalThis.__glTap.start());
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await settleFrames();
    await page.mouse.move(clientXForP(p), y, { steps: 10 });
    await settleFrames();
    await settleFrames();

    const draws = await page.evaluate(() => globalThis.__glTap.draws());
    last = draws.slice(-2); // ground quad (6 indices) then curl mesh
    const applied = last.length ? last[last.length - 1].uniforms['uFoldD'] : NaN;
    // A tilted grip shifts the fold by (H/2)·|sin tilt|; allow for it.
    const slack = gripYFrac === 0.5 ? 3 : leaf.h * 0.5 * Math.sin(0.28) + 3;
    if (Number.isFinite(applied) && Math.abs(applied - expectedFoldD) <= slack) break;
    console.log(
      `    retry ${label}: foldD ${applied} vs math.ts ${expectedFoldD.toFixed(1)}`,
    );
    await page.mouse.move(startX, y, { steps: 6 });
    await settleFrames();
    await page.mouse.up();
    await page.waitForTimeout(2200);
  }

  if (!dumpedTextures) {
    const pngs = await page.evaluate(() => globalThis.__glTap.texturePngs());
    const sizes = await page.evaluate(() => globalThis.__glTap.textures());
    pngs.forEach((png, i) => {
      if (!png) return;
      writeFileSync(
        `${OUT}/_tex${i}.png`,
        Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'),
      );
    });
    console.log('  textures uploaded at flip start:', JSON.stringify(sizes));
    dumpedTextures = true;
  }
  await page.evaluate(() => globalThis.__glTap.stop());

  const shot = await surfaceShot();
  writeFileSync(`${OUT}/${label}.png`, shot);
  writeFileSync(`${OUT}/boost-${label}.png`, await boosted(shot));

  // The control walks the contact shadow, placed from the APPLIED uniforms
  // rather than guessed: leaf-local foldD + shadowStart along the fold's own
  // tilt, mapped through the leaf's origin and the direction's mirror.
  const u = last.length ? last[last.length - 1].uniforms : {};
  const [originX, originY] = u['uLeafOrigin'] ?? [0, 0];
  const [leafW, leafH] = u['uLeafSize'] ?? [1, 1];
  const stats = await measure(shot, {
    foldD: u['uFoldD'] ?? 0,
    shadowStart: u['uShadowStart'] ?? 0,
    tilt: u['uTilt'] ?? 0,
    originX,
    originY,
    leafW,
    leafH,
    side,
  });

  const controlDrop = stats.control === null ? 0 : stats.paper - stats.control;
  const bandOk = stats.worstBand <= BAND_TOLERANCE;
  const controlOk = controlDrop >= CONTROL_MIN_DROP;
  if (!bandOk) {
    failures.push(
      `${label}: band ${stats.worstBandIndex} of 24 sits ${stats.worstBand} below the page's paper`,
    );
  }
  if (!controlOk) {
    failures.push(
      `${label}: control column only ${controlDrop.toFixed(1)} darker — measurement is blind, result means nothing`,
    );
  }

  report.push({
    label,
    requestedP: p,
    gripYFrac,
    side,
    draws: last.map((d) => d.count),
    uniforms: u,
    stats,
    bandOk,
    controlOk,
  });
  console.log(
    `  ${bandOk && controlOk ? 'ok  ' : 'FAIL'} ${label}  p=${p}` +
      `  foldD=${(u['uFoldD'] ?? NaN).toFixed?.(1)}` +
      ` r=${(u['uRadius'] ?? NaN).toFixed?.(1)} tilt=${(u['uTilt'] ?? NaN).toFixed?.(3)}` +
      ` lift=${(u['uLift'] ?? NaN).toFixed?.(2)} shadowStart=${(u['uShadowStart'] ?? NaN).toFixed?.(1)}` +
      ` leafOrigin=${JSON.stringify(u['uLeafOrigin'])} paperMix=${u['uPaperMix']}` +
      `  |  paper=${stats.paper} worstBand=-${stats.worstBand}` +
      ` control=${stats.control} (−${controlDrop.toFixed(1)})`,
  );

  await page.mouse.move(startX, y, { steps: 8 });
  await settleFrames();
  await page.mouse.up();
  await page.waitForTimeout(1600);
}

const pct = (p) => String(Math.round(p * 100)).padStart(2, '0');

for (const p of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
  await frozenFrame(`edge-p${pct(p)}`, p, 0.5);
}
for (const p of [0.45, 0.6, 0.8]) {
  await frozenFrame(`corner-p${pct(p)}`, p, 0.93);
}

// Forward one spread so a 'prev' flip has all three faces, then drag the LEFT
// leaf back: uDir = −1 exercises the other half of every mirror in the shader.
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(4000);
for (const p of [0.35, 0.6, 0.85]) {
  await frozenFrame(`prev-p${pct(p)}`, p, 0.5, 'left');
}

/**
 * The reader turns pages with a key, not a drag, so shoot the real tween too.
 * `animations: 'disabled'` is deliberately NOT used — it freezes CSS animations
 * at their END state, which is the one frame we do not want — and several
 * offsets are taken because rAF is throttled under SwiftShader, so the good
 * frame moves around. No control column here: the tween may already have landed
 * by the time the shot comes back, so these frames are checked for banding only.
 */
await page.waitForTimeout(2500);
for (const delay of [60, 120, 180, 240, 300]) {
  writeFileSync(
    `${OUT}/rest-tween-${delay}.png`,
    await surfaceShot(),
  );
  await page.evaluate(() => globalThis.__glTap.start());
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(delay);
  const shot = await surfaceShot();
  writeFileSync(`${OUT}/tween-${delay}.png`, shot);
  writeFileSync(`${OUT}/boost-tween-${delay}.png`, await boosted(shot));
  const draws = await page.evaluate(() => globalThis.__glTap.draws());
  await page.evaluate(() => globalThis.__glTap.stop());
  const mid = draws.filter((d) => d.uniforms['uLift'] > 0.05);
  const stats = await measure(shot, null);
  const ok = stats.worstBand <= BAND_TOLERANCE;
  if (!ok) {
    failures.push(
      `tween-${delay}: band ${stats.worstBandIndex} of 24 sits ${stats.worstBand} below the page's paper`,
    );
  }
  report.push({ label: `tween-${delay}`, midFlipDraws: mid.length, stats, bandOk: ok });
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} tween-${delay}  mid-flip draws=${mid.length}` +
      `  paper=${stats.paper} worstBand=-${stats.worstBand}`,
  );
  await page.waitForTimeout(2200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n  wrote ${report.length} frames to ${OUT}/`);
if (failures.length > 0) {
  console.log('\n  SHADOW BAND FOUND:');
  for (const f of failures) console.log(`    - ${f}`);
} else {
  console.log(
    '\n  no shadow band: paper tone is constant across all 24 horizontal bands' +
      ' of every frame, while the contact-shadow control column reads darker in' +
      ' every frozen frame (so the measurement is not blind).',
  );
}

await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
