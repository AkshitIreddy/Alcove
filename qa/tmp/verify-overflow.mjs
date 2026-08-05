/** Walk the welcome book and report any leaf whose content overflows it. */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (;;) { if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break; await p.waitForTimeout(150); }
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});
await p.waitForTimeout(1200);
await p.evaluate(() => { const bs = globalThis.__shelfVisibleBooks?.() ?? []; const w = bs.find(x=>/welcome/i.test(x.title)) ?? bs[0]; globalThis.__shelfPullOut(w.id); });
await p.waitForSelector('.pulled-book', { timeout: 30000 }); await p.waitForTimeout(2500);
for (let a=0;a<6;a++){ if (await p.$('.nb-prose')) break;
  const bx = await p.$eval('.pulled-book', e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}).catch(()=>null);
  if (bx){ await p.mouse.move(bx.x,bx.y); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); }
  await p.waitForTimeout(1500); }
await p.waitForSelector('.nb-prose', { timeout: 30000 }); await p.waitForTimeout(2000);

const bad = [];
for (let i=0;i<22;i++){
  const rows = await p.evaluate(() => [...document.querySelectorAll('.nb-prose')].map((e,ix) => ({
    ix, sh: e.scrollHeight, ch: e.clientHeight, over: e.scrollHeight - e.clientHeight,
    ov: getComputedStyle(e).overflowY,
    txt: (e.textContent ?? '').replace(/\s+/g,' ').slice(0,40),
  })));
  const over = rows.filter(r => r.over > 2);
  if (over.length) bad.push({ spread: i, over });
  console.log(i, JSON.stringify(rows.map(r=>`${r.over}px/${r.ov}`)));
  await p.evaluate(()=>{const el=document.activeElement; if(el instanceof HTMLElement) el.blur();});
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1400);
}
console.log('OVERFLOWING LEAVES:', JSON.stringify(bad, null, 1));
await b.close();
