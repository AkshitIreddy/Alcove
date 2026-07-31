import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
let firstPaint = null, blocked = 0, maxLag = 0;
for (let i = 1; i <= 90; i++) {
  const t = Date.now();
  try {
    const r = await p.evaluate(() => {
      const c = document.querySelector('canvas');
      return { painted: !!c && c.width > 100 };
    }, { timeout: 3000 });
    const lag = Date.now() - t;
    if (lag > maxLag) maxLag = lag;
    if (lag > 200) blocked++;
    if (r.painted && firstPaint === null) firstPaint = Date.now() - t0;
  } catch { blocked++; maxLag = Math.max(maxLag, 3000); }
  await new Promise(r => setTimeout(r, 500));
  if (firstPaint && i > 30) break;
}
console.log('first canvas paint ms:', firstPaint);
console.log('max main-thread lag ms:', maxLag, '| samples blocked >200ms:', blocked);
const fps = await p.evaluate(() => new Promise(res => {
  let n = 0; const s = performance.now();
  const tick = () => { n++; performance.now() - s < 3000 ? requestAnimationFrame(tick) : res(+(n/((performance.now()-s)/1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));
console.log('idle fps:', fps);
const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null);
console.log('heap MB:', mem);
await b.close();
