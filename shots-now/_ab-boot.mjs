/**
 * _ab-boot.mjs — the same boot, measured A then B then A then B, on ONE server.
 *
 * Scratch tool. `perf-boot.mjs` measures one tree; this swaps the tree between
 * runs so both variants meet the same warm Vite transform cache, the same
 * browser cold start and the same background load on the machine. Measuring
 * "before" at the start of a session and "after" at the end charges the
 * difference in Vite's own cache to whichever variant went second — on this
 * dev server that is worth ~250ms, which is bigger than most of the wins
 * being measured.
 *
 * IT WRITES REAL FILES INTO src/. It snapshots whatever was there first and
 * restores it on any exit, including a crash or a Ctrl-C, so the tree it
 * leaves is the one you were editing — but do not run it over uncommitted work
 * you have not saved somewhere. Interleaved, first pair dropped (browser cold
 * start), median reported.
 *
 * Prefer a runtime flag when one is possible: `?railpanels=eager` in
 * views/rail/RailPanel.tsx measures its own before-and-after from a SINGLE
 * tree, which is strictly better than swapping files. This exists for the
 * cases a flag cannot reach — a static import versus a dynamic one is decided
 * at build time, so there is nothing to switch at runtime.
 *
 * Usage: node shots-now/_ab-boot.mjs <dirA> <dirB> [runs] [url]
 *   dirA/dirB hold files named by their repo path with '/' replaced by '_'.
 */
import { chromium } from 'playwright';
import { readdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [DIR_A, DIR_B] = process.argv.slice(2, 4);
const RUNS = Number(process.argv[4] || 5);
const URL_ = process.argv[5] || 'http://localhost:1420/?fx=force';

const names = readdirSync(DIR_A);
/** 'src_features_system_index.ts' -> 'src/features/system/index.ts'. */
const pathOf = (n) => n.replace(/_/g, '/');
const apply = (dir) => {
  for (const n of names) copyFileSync(join(dir, n), pathOf(n));
};

/**
 * Whatever was in the working tree when this started, put back on ANY exit.
 *
 * Without it a crash between the two `apply()` calls leaves the tree holding
 * one variant's files with no sign of it — which is a silent way to lose work
 * or to commit the wrong half. The tree it restores is the one the author was
 * actually editing, not either measured variant.
 */
const original = new Map(names.map((n) => [pathOf(n), readFileSync(pathOf(n))]));
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  for (const [p, buf] of original) writeFileSync(p, buf);
};
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restore();
    process.exit(1);
  });
}
process.on('uncaughtException', (e) => {
  restore();
  console.error(e);
  process.exit(1);
});

const probe = () => {
  const boot = { canvas: null, world: null, books: null, mods: null };
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
          const res = performance.getEntriesByType('resource');
          boot.mods = res.filter((e) => /\/src\//.test(e.name)).length;
          boot.kb = Math.round(
            res.reduce((n, e) => n + (e.decodedBodySize || e.transferSize || 0), 0) / 1024,
          );
        }
      } catch {
        /* still assembling */
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

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

async function once() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(probe);
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => window.__boot && window.__boot.books !== null, null, { timeout: 40000 })
    .catch(() => {});
  const r = await page.evaluate(() => ({
    evalEnd: (performance.getEntriesByType('navigation')[0] || {}).domContentLoadedEventEnd ?? null,
    ...window.__boot,
  }));
  await ctx.close();
  return r;
}

const A = [];
const B = [];
for (let i = 0; i <= RUNS; i++) {
  apply(DIR_A);
  const a = await once();
  apply(DIR_B);
  const b = await once();
  if (i > 0) {
    A.push(a);
    B.push(b);
  }
  process.stdout.write('.');
}
console.log('');

const KEYS = ['evalEnd', 'canvas', 'books', 'mods', 'kb'];
console.log(`\n            ${'A'.padStart(9)} ${'B'.padStart(9)}   delta`);
for (const k of KEYS) {
  const a = median(A.map((r) => r[k]));
  const b = median(B.map((r) => r[k]));
  if (a === null || b === null) continue;
  const unit = k === 'mods' ? '' : k === 'kb' ? 'kB' : 'ms';
  console.log(
    `  ${k.padEnd(8)} ${(a.toFixed(0) + unit).padStart(9)} ${(b.toFixed(0) + unit).padStart(9)}   ${(b - a >= 0 ? '+' : '') + (b - a).toFixed(0)}${unit}`,
  );
}
console.log('\n  A raw:', A.map((r) => r.books?.toFixed(0)).join(' '));
console.log('  B raw:', B.map((r) => r.books?.toFixed(0)).join(' '));

await browser.close();
