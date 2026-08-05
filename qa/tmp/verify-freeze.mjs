/** Is the frame-1198 raster mechanism still live after the fix? */
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

// Is `height` really one of the properties an authored rule declares?
const authoredHeight = await p.evaluate(() => {
  let hit = false;
  const visit = (rules) => { for (const r of rules) { if (r.style) { for (const n of r.style) if (n === 'height') hit = true; } if (r.cssRules) visit(r.cssRules); } };
  for (const s of document.styleSheets) { try { visit(s.cssRules); } catch {} }
  return hit;
});

const out = await p.evaluate(() => {
  const c = [...document.querySelectorAll('[data-type="postcard"]')].find(e => { const r=e.getBoundingClientRect(); return r.width>8 && r.top>0 && r.top<innerHeight; });
  if (!c) return { err: 'none visible' };
  const parent = c.parentElement;
  const before = { h: c.offsetHeight, sh: c.scrollHeight, ch: c.clientHeight };
  // what html-to-image does: copy the computed USED height (and width) onto the clone
  c.style.height = `${parseFloat(getComputedStyle(c).height)}px`;
  c.style.width = `${parseFloat(getComputedStyle(c).width)}px`;
  const res = [];
  for (const d of [0, -4, -10, -24, -40]) {
    parent.style.width = `${parent.getBoundingClientRect().width + (d === 0 ? 0 : 0)}px`;
    parent.style.width = '';
    if (d !== 0) parent.style.width = `${Math.round(parent.getBoundingClientRect().width + d)}px`;
    c.offsetHeight;
    res.push({ parentDelta: d, frozenH: c.offsetHeight, needsH: c.scrollHeight, spillPx: c.scrollHeight - c.clientHeight });
  }
  parent.style.width = ''; c.style.height = ''; c.style.width = '';
  return { before, res };
});
console.log('authored `height` in a stylesheet rule (so it is in the snapshot list):', authoredHeight);
console.log(JSON.stringify(out, null, 1));
await b.close();
