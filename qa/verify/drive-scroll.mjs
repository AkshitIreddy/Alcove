import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto('http://localhost:1420?fx=force',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(9000);
for(let i=0;i<4;i++){const s=p.locator('text=skip the tour').first(); if((await s.count())===0)break; await s.click({force:true,timeout:4000}).catch(()=>{}); await p.waitForTimeout(700);}
// settings, deep scroll
await p.locator('.nb-settings-fab, [aria-label*="ettings"]').first().click({force:true}).catch(()=>{});
await p.waitForTimeout(2500);
await p.evaluate(()=>{const el=document.querySelector('.nbs-sheet'); if(el) el.scrollTop = el.scrollHeight;});
await p.waitForTimeout(1200);
console.log('SETTINGS deep:', JSON.stringify(await p.evaluate(()=>{
  const sheet=document.querySelector('.nbs-sheet'); const c=document.querySelector('.nbs-close');
  const r=c.getBoundingClientRect();
  const hit=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
  return { scrollTop: sheet.scrollTop, scrollH: sheet.scrollHeight, closeY: Math.round(r.y), closeX: Math.round(r.x), reachable: c.contains(hit)||hit===c };
})));
await p.screenshot({path:'qa/verify/98-settings-deep.png',timeout:60000});
await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
// book > catalogue, deep scroll
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({state:'visible',timeout:40000}).catch(()=>{});
await p.waitForTimeout(2500);
await p.locator('.nb-rail-button[data-tool="catalogue"]').click({force:true});
await p.waitForTimeout(2500);
await p.evaluate(()=>{const el=document.querySelector('.nb-rail-panel[aria-hidden="false"] .nb-rail-panel-body'); if(el) el.scrollTop=el.scrollHeight;});
await p.waitForTimeout(1200);
console.log('CATALOGUE deep:', JSON.stringify(await p.evaluate(()=>{
  const body=document.querySelector('.nb-rail-panel[aria-hidden="false"] .nb-rail-panel-body');
  const c=document.querySelector('.nb-rail-panel[aria-hidden="false"] .nb-rail-panel-close');
  const r=c.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
  return { scrollTop: body.scrollTop, scrollH: body.scrollHeight, closeY: Math.round(r.y), closeX: Math.round(r.x), reachable: c.contains(hit)||hit===c };
})));
await p.screenshot({path:'qa/verify/99-catalogue-deep.png',timeout:60000});
await b.close();
