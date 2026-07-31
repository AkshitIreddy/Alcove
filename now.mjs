import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots-now', { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('[err]', e.message.slice(0,140)));
await p.goto('http://localhost:1420?fx=force&dev=0', { waitUntil: 'networkidle' });
// poll until the shelf canvas has painted rather than fixed-waiting
for (let i=0;i<40;i++) {
  const ok = await p.evaluate(() => { const c=document.querySelector('canvas'); return !!c && c.width>100; }).catch(()=>false);
  if (ok) break;
  await new Promise(r=>setTimeout(r,1000));
}
await new Promise(r=>setTimeout(r,6000));
await p.screenshot({ path: 'shots-now/shelf.png' });
console.log('shelf captured');
await b.close();
