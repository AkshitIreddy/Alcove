/** shots-now/specimen.mjs — shoot the flat-art specimen page. */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 920 }, deviceScaleFactor: 1 });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.goto('http://localhost:1420/specimen.html', { waitUntil: 'networkidle' });
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: 'shots-now/specimen.png' });
if (errors.length) console.log('errors:\n  ' + errors.join('\n  '));
else console.log('done -> shots-now/specimen.png');
await b.close();
