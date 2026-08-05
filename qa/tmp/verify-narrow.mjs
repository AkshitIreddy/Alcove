/** What the new 50%+16px reserve does to a NARROW postcard. */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2 });
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
for (let i=0;i<20;i++){ if (await p.$$eval('[data-type="postcard"]', e=>e.length>0)) break;
  await p.evaluate(()=>{const el=document.activeElement; if(el instanceof HTMLElement) el.blur();});
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1400); }

const out = await p.evaluate(() => {
  const c = [...document.querySelectorAll('[data-type="postcard"]')].find(e => { const r=e.getBoundingClientRect(); return r.width>8 && r.top>0 && r.top<innerHeight; });
  if (!c) return { err: 'none visible' };
  const res = [];
  const parent = c.parentElement;
  for (const w of [420, 300, 220, 160, 120, 90]) {
    parent.style.width = `${w}px`;
    c.offsetHeight;
    const cs = getComputedStyle(c);
    const content = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    res.push({ parentW: w, cardW: c.offsetWidth, contentW: Math.round(content*10)/10, h: c.offsetHeight, overflowY: c.scrollHeight - c.clientHeight, overflowX: c.scrollWidth - c.clientWidth });
  }
  parent.style.width = '';
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
