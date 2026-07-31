/**
 * shots-now/icon.mjs — render the brand mark and look at it.
 *
 * Shot at three sizes in one frame, because an icon that reads at 1024 and
 * turns to mush at 32 is not an icon. The taskbar sees the small one.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('assets/brand/bellanote.svg', 'utf8');
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 980, height: 620 }, deviceScaleFactor: 2 });
await p.setContent(`
  <body style="margin:0;background:#e9e2d0;display:flex;align-items:center;gap:48px;padding:40px">
    <div style="width:420px;height:420px">${svg}</div>
    <div style="width:128px;height:128px">${svg}</div>
    <div style="width:48px;height:48px">${svg}</div>
    <div style="width:32px;height:32px">${svg}</div>
  </body>
`);
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: 'shots-now/icon.png' });
console.log('done -> shots-now/icon.png');
await b.close();
