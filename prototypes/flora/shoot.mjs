/**
 * prototypes/painted/shoot.mjs — the "look at it" half of the harness.
 *
 *   node prototypes/painted/shoot.mjs [sceneName ...]
 *
 * Bundles main.ts with esbuild (≈30ms), opens the static page in headless
 * Chromium via file://, runs each requested scene, and writes
 * prototypes/painted/out/<scene>.png. No dev server, no app, no Tauri.
 *
 * With no arguments it renders every registered scene.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');

/* ------------------------------- 1. bundle -------------------------------- */

await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  // IIFE, not ESM: the page is opened over file://, where module scripts are
  // blocked by CORS but classic scripts load fine. Zero-server harness.
  format: 'iife',
  target: 'es2022',
  outfile: join(here, 'bundle.js'),
  // The generated foliage cut-outs are inlined as data URIs. The harness runs
  // over file://, where fetching a sibling .webp taints the canvas and
  // toDataURL then throws — a data URI is same-origin and does not.
  loader: { '.webp': 'dataurl' },
  logLevel: 'warning',
});

/* -------------------------------- 2. render ------------------------------- */

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(pathToFileURL(join(here, 'index.html')).href);
await page.waitForFunction(() => Boolean(window.__harness), null, { timeout: 15000 });

page.setDefaultTimeout(180000);
const all = await page.evaluate(() => window.__harness.list());
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;

for (const name of wanted) {
  if (!all.includes(name)) {
    console.log(`! unknown scene "${name}" (have: ${all.join(', ')})`);
    continue;
  }
  const t0 = Date.now();
  const dataUrl = await page.evaluate((n) => window.__harness.render(n), name);
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`✓ ${name}  ${Date.now() - t0}ms  →  ${file}`);
}

await browser.close();
