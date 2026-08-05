/** Re-impose the OLD 46% reserve on the live card and measure. */
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
for (;;) { if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break; await p.waitForTimeout(150); }
const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});
await p.waitForTimeout(1200);
await p.evaluate(() => { const bs = globalThis.__shelfVisibleBooks?.() ?? []; const w = bs.find(x=>/welcome/i.test(x.title)) ?? bs[0]; globalThis.__shelfPullOut(w.id); });
await p.waitForSelector('.pulled-book', { timeout: 30000 });
await p.waitForTimeout(2500);
for (let a=0;a<6;a++){ if (await p.$('.nb-prose')) break;
  const bx = await p.$eval('.pulled-book', e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}).catch(()=>null);
  if (bx){ await p.mouse.move(bx.x,bx.y); await p.mouse.down(); await p.waitForTimeout(80); await p.mouse.up(); }
  await p.waitForTimeout(1500); }
await p.waitForSelector('.nb-prose', { timeout: 30000 });
await p.waitForTimeout(2000);
for (let i=0;i<20;i++){ if (await p.$$eval('[data-type="postcard"]', e=>e.length>0)) break;
  await p.evaluate(()=>{const el=document.activeElement; if(el instanceof HTMLElement) el.blur();});
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1500); }

const read = () => p.evaluate(() => {
  const c = [...document.querySelectorAll('[data-type="postcard"]')].find(e => { const r = e.getBoundingClientRect(); return r.width>8 && r.top>0 && r.top < innerHeight; });
  if (!c) return { err: 'no visible card' };
  const cs = getComputedStyle(c);
  const contentW = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const inner = c.querySelector('p') ?? c;
  const lh = parseFloat(getComputedStyle(inner).lineHeight);
  return {
    padRight: cs.paddingRight, offsetH: c.offsetHeight, minH: cs.minHeight,
    overflowY: c.scrollHeight - c.clientHeight,
    contentW: Math.round(contentW*10)/10,
    dividerAt: Math.round(c.offsetWidth*0.5*10)/10,
    messageRightEdge: Math.round((parseFloat(cs.borderLeftWidth)+parseFloat(cs.paddingLeft)+contentW)*10)/10,
    lines: Math.round(inner.getBoundingClientRect().height / (lh||1)),
    innerH: Math.round(inner.getBoundingClientRect().height),
    lh,
  };
});
console.log('NEW (as committed):', JSON.stringify(await read()));
await p.addStyleTag({ content: `:is(.nb-prose, .nb-fx-specimen) [data-type='postcard'] { padding: var(--space-20) 46% var(--space-20) var(--space-20) !important; }` });
await p.waitForTimeout(600);
console.log('OLD (46% restored):', JSON.stringify(await read()));
await p.screenshot({ path: 'qa/tmp/vfy-old-padding.png' });
await b.close();
