import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'networkidle' });
await p.evaluate(() => { try { localStorage.setItem('nb-tutorial-done','1'); } catch {} });
await p.reload({ waitUntil: 'networkidle' });
for (let i=0;i<40;i++) {
  const ok = await p.evaluate(() => { const c=document.querySelector('canvas'); return !!c && c.width>100; }).catch(()=>false);
  if (ok) break; await new Promise(r=>setTimeout(r,1000));
}
await new Promise(r=>setTimeout(r,7000));
// dismiss tutorial if still present
await p.keyboard.press('Escape').catch(()=>{});
await new Promise(r=>setTimeout(r,1500));
await p.screenshot({ path: 'shots-now/shelf-clean.png' });
console.log('done');
await b.close();
