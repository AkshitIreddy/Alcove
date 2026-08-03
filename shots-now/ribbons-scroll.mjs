import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 9000));
for (let i = 0; i < 4; i++) { const s = p.locator('text=skip the tour').first(); if (!(await s.count())) break; await s.click({force:true,timeout:4000}).catch(()=>{}); await new Promise(r=>setTimeout(r,800)); }
await p.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { timeout: 60000 });
await p.evaluate(() => { const bs = globalThis.__shelfVisibleBooks?.() ?? []; if (bs[0]) globalThis.__shelfPullOut?.(bs[0].id); });
await new Promise(r => setTimeout(r, 2500));
await p.keyboard.press('Enter').catch(()=>{});
await new Promise(r => setTimeout(r, 4000));
await p.locator('button[data-tool="bookmark"]').first().click({force:true}).catch(()=>{});
await new Promise(r => setTimeout(r, 700));
await p.locator('button[data-tool="ribbon-style"]').first().click({force:true});
await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => {
  const drawer = document.querySelector('.nb-ribbon-drawer');
  const body = drawer?.closest('.nb-rail-panel-body');
  if (body) body.scrollTop = body.scrollHeight;
  return body ? body.scrollHeight : -1;
});
await new Promise(r => setTimeout(r, 900));
await p.screenshot({ path: 'shots-now/ribbon-6-axes.png', animations: 'disabled', timeout: 120000 });
console.log('scrolled shot done');
await b.close();
