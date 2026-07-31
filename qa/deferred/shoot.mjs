/**
 * Render the deferred-lighting contact sheets headlessly and write PNGs.
 * Usage: node qa/deferred/shoot.mjs [sheetName ...]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });

const which = process.argv.slice(2);
const sheets = which.length > 0 ? which : ['sheetDebug', 'sheetRigs', 'sheetAngles', 'sheetElevation', 'sheetQuality'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const root = join(here, 'dist');
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = readFileSync(p);
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nope');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.error('PAGE ERROR:', m.text());
});
page.on('pageerror', (e) => console.error('PAGE EXCEPTION:', e.message));

await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => window.HREADY === true, { timeout: 30000 });

for (const name of sheets) {
  const t0 = Date.now();
  let dataUrl;
  try {
    dataUrl = await page.evaluate(
      ([fn, arg]) => (arg === undefined ? window.H[fn]() : window.H[fn](arg)),
      name.includes(':') ? name.split(':') : [name, undefined],
    );
  } catch (e) {
    console.error(`${name}: FAILED — ${e.message.split('\n').slice(0, 40).join('\n')}`);
    continue;
  }
  if (typeof dataUrl === 'string' && !dataUrl.startsWith('data:')) {
    console.log(`${name}:
${dataUrl}`);
    continue;
  }
  const file = join(out, `${name.replace(':', '-')}.png`);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`${name} -> ${file}  (${Date.now() - t0}ms)`);
}

await browser.close();
server.close();
