/**
 * prototypes/books/shoot.mjs — render scenes to PNG, headless, no dev server.
 *
 *   node prototypes/books/shoot.mjs [sceneName ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');

await esbuild.build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: join(here, 'bundle.js'),
  logLevel: 'warning',
});

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page:${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack));

await page.goto(pathToFileURL(join(here, 'index.html')).href);
await page.waitForFunction(() => Boolean(window.__harness), null, { timeout: 20000 });

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
  console.log(`ok ${name}  ${Date.now() - t0}ms  ->  ${file}`);
}

await browser.close();
