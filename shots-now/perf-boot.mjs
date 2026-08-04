/**
 * perf-boot.mjs — where the first second goes.
 *
 * `perf.mjs` next door polls every 500ms, so the smallest change it can see is
 * half a second. That is fine for "did the shelf ever appear" and useless for
 * optimisation: a 150ms saving reads as zero. This one installs its probe
 * BEFORE any page script (addInitScript) and samples on rAF, so the numbers
 * are frame-accurate, and it runs N cold contexts and reports the median so a
 * single unlucky GC does not become a conclusion.
 *
 * Markers, in the order the boot actually reaches them:
 *
 *   evalEnd    domContentLoadedEventEnd — the module graph has finished
 *              parsing and evaluating. THIS is the number bundle size moves;
 *              nothing else in the boot cares how big the JS was.
 *   canvas     first frame where a <canvas> exists with a real backing size
 *              (Pixi has an initialised renderer).
 *   world      window.__shelfWorld handed out — the world constructed.
 *   books      __shelfVisibleBooks() non-empty — art baked, spines on shelves.
 *              The honest "the reader can see their library" moment.
 *
 * Usage:  node shots-now/perf-boot.mjs [url] [runs]
 * Default url is the production preview (vite preview), NOT the dev server —
 * measuring boot on an unbundled dev server measures Vite, not the app.
 */
import { chromium } from 'playwright';

const URL_ = process.argv[2] || 'http://localhost:4173/?fx=force';
const RUNS = Number(process.argv[3] || 5);

/**
 * `--gpu` runs headed, on the machine's real GPU.
 *
 * Read this before trusting a number from the default mode. Headless Chromium
 * has no GPU, so it rasterizes WebGL on the CPU with SwiftShader — the shelf's
 * own render loop then competes with the boot for the main thread, and
 * everything after the first canvas frame stretches and goes bimodal (the same
 * build measured 1.1s and 3.2s to the same marker on consecutive runs). That
 * mode is honest about `evalEnd`, which is pure JS parse and does not touch a
 * renderer, and misleading about everything downstream of it. `--gpu` is the
 * one to quote for "how long until the reader sees their library".
 */
const GPU = process.argv.includes('--gpu');

/** Runs before any app code; leaves its findings on window.__boot. */
const probe = () => {
  const boot = { canvas: null, world: null, books: null };
  window.__boot = boot;
  const tick = () => {
    const now = performance.now();
    if (boot.canvas === null) {
      const c = document.querySelector('canvas');
      if (c && c.width > 100) boot.canvas = now;
    }
    if (boot.world === null && window.__shelfWorld) boot.world = now;
    if (boot.books === null && typeof window.__shelfVisibleBooks === 'function') {
      try {
        if (window.__shelfVisibleBooks().length > 0) {
          boot.books = now;
          // Snapshot the network HERE, not when the harness gets round to
          // asking. App.tsx prefetches the book chunk on the first idle, so a
          // reading taken a second later reports the editor as part of the
          // boot cost when the shelf never waited on a byte of it.
          boot.loaded = performance
            .getEntriesByType('resource')
            .filter((e) => /\.(js|css)(\?|$)/.test(e.name))
            .map((e) => ({
              name: e.name.split('/').pop(),
              kb: Math.round((e.decodedBodySize || e.transferSize || 0) / 1024),
            }));
          // The art the shelf had to paint to get here. `?fx=force` hands the
          // ring buffer out (see art/bake.ts). Both halves matter: `ms` is
          // work, and `at` spread against it is the pump's scheduling latency
          // — the difference between "we drew for 300ms" and "we drew for
          // 300ms spread over two seconds of waiting for idle".
          const samples = window.__bakeProfile;
          if (Array.isArray(samples) && samples.length > 0) {
            const by = {};
            for (const s of samples) {
              by[s.kind] ??= { n: 0, ms: 0 };
              by[s.kind].n += 1;
              by[s.kind].ms += s.ms;
            }
            const first = Math.min(...samples.map((s) => s.at));
            const last = Math.max(...samples.map((s) => s.at));
            boot.bake = { by, span: last - first, n: samples.length };
          }
        }
      } catch {
        /* world still assembling */
      }
    }
    if (boot.books === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x) => (x === null ? '   —  ' : `${x.toFixed(0).padStart(5)}ms`);

const browser = await chromium.launch({
  headless: !GPU,
  args: GPU ? [] : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function once(url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Wait for the last marker (books) or give up after 20s.
  await page
    .waitForFunction(() => window.__boot && window.__boot.books !== null, null, { timeout: 20000 })
    .catch(() => {});
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      evalEnd: nav.domContentLoadedEventEnd ?? null,
      ...window.__boot,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  });
  await ctx.close();
  return r;
}

/**
 * A second URL turns this into an A/B, run ALTERNATELY.
 *
 * Alternately and not one batch after the other: this machine builds, runs
 * tests and serves in the background while measuring, and a batch of A
 * followed by a batch of B charges whatever the machine was doing at the time
 * to whichever variant was unlucky. Interleaving cannot remove the noise but
 * it does stop it landing on one side. The first run of each is dropped — it
 * carries the browser's own cold start (GPU process, shader cache), which is
 * about 800ms and belongs to neither variant.
 */
const AB = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;

const runs = [];
const runsB = [];
for (let i = 0; i < RUNS + 1; i++) {
  const a = await once(URL_);
  if (i > 0) runs.push(a);
  if (AB) {
    const b = await once(AB);
    if (i > 0) runsB.push(b);
  }
}

function report(label, rs) {
  console.log(`\n${label}   (${rs.length} cold runs, median, ${GPU ? 'real GPU, headed' : 'headless SwiftShader'})\n`);
  for (const k of ['evalEnd', 'canvas', 'world', 'books']) {
    console.log(
      `  ${k.padEnd(8)} ${fmt(median(rs.map((r) => r[k])))}   [${rs.map((r) => (r[k] === null ? '—' : r[k].toFixed(0))).join(' ')}]`,
    );
  }
  console.log(`  ${'heap'.padEnd(8)} ${String(median(rs.map((r) => r.heapMB))).padStart(5)}MB`);
}

report(URL_, runs);
if (AB) {
  report(AB, runsB);
  console.log('\n  delta (B - A):');
  for (const k of ['evalEnd', 'canvas', 'world', 'books']) {
    const a = median(runs.map((r) => r[k]));
    const b = median(runsB.map((r) => r[k]));
    if (a === null || b === null) continue;
    console.log(`    ${k.padEnd(8)} ${(b - a >= 0 ? '+' : '') + (b - a).toFixed(0)}ms`);
  }
}

// Where the gap between `canvas` and `books` went.
const bakes = runs.map((r) => r.bake).filter(Boolean);
if (bakes.length) {
  const kinds = [...new Set(bakes.flatMap((b) => Object.keys(b.by)))];
  console.log(`\n  art painted before the shelf was drawn (median of ${bakes.length}):`);
  for (const k of kinds) {
    const n = median(bakes.map((b) => b.by[k]?.n ?? 0));
    const ms = median(bakes.map((b) => b.by[k]?.ms ?? 0));
    console.log(`    ${k.padEnd(6)} ${String(n).padStart(4)} pieces  ${ms.toFixed(0).padStart(5)}ms of drawing`);
  }
  const span = median(bakes.map((b) => b.span));
  const work = median(bakes.map((b) => Object.values(b.by).reduce((n, v) => n + v.ms, 0)));
  console.log(
    `    spread over ${span.toFixed(0)}ms of wall clock — ${(100 * (work / span)).toFixed(0)}% of it drawing, the rest waiting for a turn`,
  );
}

// What the shelf actually waited for, at the frame it was drawn.
const loaded = runs.map((r) => r.loaded).find((l) => l && l.length);
if (loaded) {
  const total = loaded.reduce((n, e) => n + e.kb, 0);
  console.log(`\n  fetched before the shelf was drawn — ${total} kB over ${loaded.length} files:`);
  for (const e of loaded.sort((a, b) => b.kb - a.kb)) {
    console.log(`    ${String(e.kb).padStart(6)} kB  ${e.name}`);
  }
}
console.log('');

await browser.close();
