/**
 * shots-now/flip-paper-tone.mjs — "when turning the page the colour of page
 * changes before going back to original colour."
 *
 * WHAT IS MEASURED
 *
 * The page's PAPER TONE, as an RGB triple, in three states of the same spread:
 *
 *   rest    the live DOM, before anything is grabbed
 *   p=0.20  the fold is still out near the outer edge, so nearly the whole
 *           leaf is the UNDEFORMED strip — pinned by curl.ts exactly where the
 *           DOM drew it, and painted from the page's raster snapshot
 *   p=0.85  the sheet has wrapped past the gutter, so most of the leaf rect is
 *           the GROUND pass showing the revealed page's snapshot
 *
 * Paper tone is the MODAL colour of the leaf rect (quantized to 4 levels per
 * channel, then the exact mean of the winning bucket). A page is mostly paper,
 * so the mode is the paper and glyphs/rules/callouts cannot move it — which is
 * what makes this readable without hand-picking a "blank" rectangle that the
 * seeded book might not have.
 *
 * WHY IT RUNS PER THEME
 *
 * `settings.css` remaps `--paper-cream` for pastel, botanical and night (night
 * is #2b211a — a dark brown). Three places in src/flip hardcode the parchment
 * default #f7f1e3 instead of reading the token, so this probe would be blind if
 * it only ever looked at the default theme.
 *
 * Two passes per theme, because there are two independent ways to be wrong:
 *
 *   stale   theme applied, nothing else — does an existing snapshot survive a
 *           theme change? (a cached bitmap is only invalidated by a DOM
 *           mutation inside the leaf, and a theme writes on <html>)
 *   fresh   every page snapshot explicitly re-taken after the theme applied —
 *           is the CAPTURE itself the right colour?
 *
 * The LEFT leaf is read as the control while the fold is still on the right of
 * the gutter (p=0.20): there it is untouched live DOM and must report the
 * theme's paper, so a drift means the measurement is not isolated. It is NOT a
 * control at p=0.85 — by then the wrapped sheet lies back across it and what
 * the sample finds is the sheet's BACKSIDE face, which curl.ts deliberately
 * tints 12% desaturated and 4% lighter. Its reading is printed there anyway,
 * because that tint is exactly 3 levels on cream and seeing 3 is how you know
 * this measure resolves the thing it claims to resolve.
 *
 * Usage: node shots-now/flip-paper-tone.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const ONLY = opt('theme', null);
const OUT = 'shots-now/flip-paper-tone';
mkdirSync(OUT, { recursive: true });

/** How far a channel may move between rest and mid-turn before it is a shift. */
const TONE_TOLERANCE = 3;

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

/* --------------------------------------------------------------- open a book */

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

  // Two clicks: the a11y button PULLS the book out (it stops in front of the
  // case), then the held cover itself is what opens it. The older "read it"
  // plate is tried second so this runs against either build.
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await page.locator('.nb-flip-surface').count()) > 0) break;
    await page.locator('.shelf-a11y button').first().dispatchEvent('click').catch(() => {});
    const held = page.locator('[data-testid="pulled-book"]');
    await held.waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {});
    if ((await held.count()) > 0) await held.click({ timeout: 8000 }).catch(() => {});
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
await page.waitForTimeout(6000);

/* ------------------------------------------------------------------ helpers */

/**
 * Two painted frames. The dev server is shared with other agents editing this
 * tree, so an HMR reload can destroy the execution context between any two
 * calls; a lost context is reported rather than thrown so the caller can
 * reopen the book instead of the run dying on whichever evaluate was in
 * flight.
 */
const settleFrames = async () => {
  try {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        }),
    );
    return true;
  } catch (error) {
    if (/context was destroyed|Target closed|Execution context/i.test(String(error))) return false;
    throw error;
  }
};

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

const geometry = () =>
  page.evaluate(() => {
    const surface = document.querySelector('.nb-flip-surface').getBoundingClientRect();
    const box = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { x: r.x - surface.x, y: r.y - surface.y, w: r.width, h: r.height };
    };
    return {
      surface: { x: surface.x, y: surface.y, w: surface.width, h: surface.height },
      right: box('.nb-flip-leaf-right'),
      left: box('.nb-flip-leaf-left'),
    };
  });

/**
 * Modal colour of a rect, as the exact mean of the winning 4-level bucket.
 * Decoded inside the page because this tree has no PNG decoder.
 */
async function tones(pngBuffer, rects) {
  const b64 = pngBuffer.toString('base64');
  return page.evaluate(
    async ([data, boxes]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const { data: px, width, height } = g.getImageData(0, 0, c.width, c.height);

      const out = {};
      for (const [name, box] of Object.entries(boxes)) {
        // Inset so the leaf's own edge hairlines and the gutter never vote.
        const x0 = Math.max(0, Math.round(box.x + box.w * 0.12));
        const x1 = Math.min(width, Math.round(box.x + box.w * 0.88));
        const y0 = Math.max(0, Math.round(box.y + box.h * 0.08));
        const y1 = Math.min(height, Math.round(box.y + box.h * 0.92));
        const buckets = new Map();
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            const key =
              ((px[i] >> 2) << 12) | ((px[i + 1] >> 2) << 6) | (px[i + 2] >> 2);
            let bucket = buckets.get(key);
            if (bucket === undefined) {
              bucket = { n: 0, r: 0, g: 0, b: 0 };
              buckets.set(key, bucket);
            }
            bucket.n++;
            bucket.r += px[i];
            bucket.g += px[i + 1];
            bucket.b += px[i + 2];
          }
        }
        let best = null;
        for (const bucket of buckets.values()) {
          if (best === null || bucket.n > best.n) best = bucket;
        }
        const total = (x1 - x0) * (y1 - y0);
        out[name] =
          best === null
            ? null
            : {
                rgb: [
                  Math.round(best.r / best.n),
                  Math.round(best.g / best.n),
                  Math.round(best.b / best.n),
                ],
                share: +(best.n / total).toFixed(3),
              };
      }
      return out;
    },
    [b64, rects],
  );
}

const hex = (rgb) =>
  rgb === null ? '—' : `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const delta = (a, b) =>
  a === null || b === null ? 999 : Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

/**
 * Park the curl at an exact p by pressing the right leaf's edge hotspot and
 * holding the pointer where math.ts's dragToP puts that p. No tween runs, so
 * the frame is genuinely frozen rather than caught.
 */
async function freeze(geom, p) {
  const leaf = geom.right;
  const abs = (v) => ({ x: geom.surface.x + v.x, y: geom.surface.y + v.y });
  const origin = abs(leaf);
  const y = origin.y + leaf.h * 0.5;
  const startX = origin.x + leaf.w - 12;
  const targetX = origin.x + leaf.w * (1 - 2 * p);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await settleFrames();
  await page.mouse.move(targetX, y, { steps: 10 });
  await settleFrames();
  await settleFrames();
  return async () => {
    await page.mouse.move(startX, y, { steps: 8 });
    await settleFrames();
    await page.mouse.up();
    await page.waitForTimeout(1400);
  };
}

/* -------------------------------------------------------------------- sweep */

const THEMES = ONLY ? [ONLY] : ['parchment', 'pastel', 'botanical', 'night'];
const report = [];
const failures = [];

/** True when a rejection is the shared dev server reloading under us. */
const isReload = (error) =>
  /context was destroyed|Target closed|Execution context|Node is detached/i.test(String(error));

for (const theme of THEMES) {
  let token = '';
  for (const pass of ['stale', 'fresh']) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        token = await measurePass(theme, pass);
        break;
      } catch (error) {
        if (!isReload(error) || attempt === 2) throw error;
        console.log(`    ${theme}/${pass}: dev-server reload — reopening and retrying`);
        await openBook();
        await page.waitForTimeout(5000);
      }
    }
  }
}

/** One theme+pass: apply, measure at rest and frozen, record. Returns the token. */
async function measurePass(theme, pass) {
  await page.evaluate((t) => globalThis.__shelfSaveSettings({ theme: t }), theme);
  await page.waitForTimeout(1500);

  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--paper-cream').trim(),
  );

  {
    if (pass === 'fresh') {
      // Re-take every snapshot under the theme that is now applied. Touching
      // the live leaf is what the cache listens to, so this goes through the
      // app's own MutationObserver rather than reaching into the cache.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.nb-sheet-paper')) {
          el.setAttribute('data-tone-probe', String(Date.now()));
        }
      });
      await page.waitForTimeout(4000);
    }

    const geom = await geometry();
    const rects = { right: geom.right, left: geom.left };

    const restShot = await surfaceShot();
    writeFileSync(`${OUT}/${theme}-${pass}-rest.png`, restShot);
    const rest = await tones(restShot, rects);

    const frames = { rest };
    for (const p of [0.2, 0.85]) {
      const release = await freeze(geom, p);
      const shot = await surfaceShot();
      writeFileSync(`${OUT}/${theme}-${pass}-p${Math.round(p * 100)}.png`, shot);
      frames[`p${Math.round(p * 100)}`] = await tones(shot, rects);
      await release();
    }

    const restRight = rest.right?.rgb ?? null;
    const restLeft = rest.left?.rgb ?? null;
    for (const [label, frame] of Object.entries(frames)) {
      if (label === 'rest') continue;
      const dRight = delta(restRight, frame.right?.rgb ?? null);
      const dLeft = delta(restLeft, frame.left?.rgb ?? null);
      // Past the gutter the left leaf is under the wrapped sheet — see the
      // header. Only p20 keeps it as live DOM, so only p20 controls.
      const isControl = label === 'p20';
      const ok = dRight <= TONE_TOLERANCE;
      const controlOk = !isControl || dLeft <= TONE_TOLERANCE;
      if (!ok) {
        failures.push(
          `${theme}/${pass}/${label}: turning leaf paper ${hex(restRight)} → ` +
            `${hex(frame.right?.rgb ?? null)} (max channel ${dRight})`,
        );
      }
      if (!controlOk) {
        failures.push(
          `${theme}/${pass}/${label}: the LEFT leaf (live DOM, untouched) also moved ` +
            `${hex(restLeft)} → ${hex(frame.left?.rgb ?? null)} — the measurement is not isolated`,
        );
      }
      console.log(
        `  ${ok && controlOk ? 'ok  ' : 'FAIL'} ${theme.padEnd(10)} ${pass.padEnd(5)} ${label.padEnd(4)}` +
          `  token=${token}  rest=${hex(restRight)} turn=${hex(frame.right?.rgb ?? null)}` +
          ` Δ=${dRight}  |  left ${hex(restLeft)}→${hex(frame.left?.rgb ?? null)} Δ=${dLeft}` +
          `${isControl ? ' (control)' : ' (under the sheet)'}`,
      );
    }

    report.push({ theme, pass, token, frames });
  }
  return token;
}

await page.evaluate(() => globalThis.__shelfSaveSettings({ theme: 'parchment' }));
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.log('\n  PAPER TONE CHANGES MID-TURN:');
  for (const f of failures) console.log(`    - ${f}`);
} else {
  console.log(
    '\n  paper tone is constant: the turning leaf reports the same modal colour' +
      ' frozen mid-curl as it does at rest, in every theme, with a stale cache' +
      ' and with a freshly taken one.',
  );
}
await browser.close();
process.exit(failures.length > 0 ? 1 : 0);
