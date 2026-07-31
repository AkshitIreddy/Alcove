/**
 * qa/mat/probe.mjs — run a snippet inside the material lab page and save the
 * canvas it returns.  node qa/mat/probe.mjs <script.mjs-body-file> <out.png>
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [bodyFile, outPath] = process.argv.slice(2);
const body = readFileSync(bodyFile, 'utf8');
mkdirSync('qa/mat', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto('http://127.0.0.1:1497/qa/mat/lab.html', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => globalThis.__labReady === true, null, { timeout: 120000 });
const n = await page.evaluate(() => globalThis.M.materialCount());
console.log('materials resident:', n);

const url = await page.evaluate(new Function(`return (async () => { ${body} })()`));
writeFileSync(outPath, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log('wrote', outPath);
