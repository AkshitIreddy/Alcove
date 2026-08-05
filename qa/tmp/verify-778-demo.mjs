import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const outDir = process.argv[2] ?? 'qa/tmp/verify778-demo';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = []; page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
const boot = async () => {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400, timeout: 120000 });
  await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
};
await page.goto('http://localhost:1420/?fx=force&dev=0', { waitUntil: 'domcontentloaded' });
await boot();
await page.evaluate(() => { const bs = globalThis.__shelfVisibleBooks?.() ?? []; const b = bs.find(x=>/welcome/i.test(x.title)) ?? bs[0]; if (b) globalThis.__shelfPullOut(b.id); });
await page.waitForSelector('.pulled-book', { timeout: 60000 }); await page.waitForTimeout(1400);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width/2, cover.y + cover.height/2);
await page.waitForSelector('.nb-book-view', { timeout: 60000 }); await page.waitForTimeout(3000);
await page.evaluate(() => {
  globalThis.__col = [];
  const tick = () => {
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      const lr = leaf.getBoundingClientRect(); const cs = getComputedStyle(leaf);
      if (!(lr.width>100 && lr.height>100 && lr.right>0 && lr.left<innerWidth && lr.bottom>0 && lr.top<innerHeight && cs.visibility!=='hidden' && Number(cs.opacity)>0.5)) continue;
      const rail = Array.from(leaf.querySelectorAll('.nb-footnote-rail')).find(r=>r.getBoundingClientRect().height>1);
      const prose = leaf.querySelector('.nb-prose'); if (!rail||!prose) continue;
      const rr = rail.getBoundingClientRect();
      let over = 0;
      for (const kid of prose.children) {
        const t=(kid.textContent??'').trim(); if(!t) continue;
        const kr = kid.getBoundingClientRect();
        const ov = Math.min(rr.bottom,kr.bottom)-Math.max(rr.top,kr.top);
        const ovx = Math.min(rr.right,kr.right)-Math.max(rr.left,kr.left);
        if (ov>2&&ovx>2) globalThis.__col.push({t:Math.round(performance.now()),block:kid.getAttribute('data-type')??kid.tagName.toLowerCase(),text:t.slice(0,30),ov:Math.round(ov)});
      }
      // also: content running past the leaf's own paper
      const last = prose.lastElementChild;
      if (last) { const spill = Math.round(last.getBoundingClientRect().bottom - leaf.getBoundingClientRect().bottom); if (spill > 4) over = spill; }
      if (over) globalThis.__col.push({t:Math.round(performance.now()),block:'SPILL',text:(prose.textContent??'').slice(0,30),ov:over});
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const PANELS = [['Page style','.nb-pagestyle'],['Catalogue','.nb-catalogue'],['Table of contents','.nb-toc'],['Customize this book','.nb-book-studio'],['In and out','.nb-share']];
let seen = 0;
const shotIfNew = async (tag) => { const n = await page.evaluate(()=>globalThis.__col.length); if (n>seen){ seen=n; await page.screenshot({path:`${outDir}/${tag}.png`}); } };
const turn = async (i) => {
  await page.evaluate(()=>{const e=document.activeElement; if(e instanceof HTMLElement) e.blur();});
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  for (let k=0;k<22;k+=1){ await page.waitForTimeout(90); await shotIfNew(`turn${i}-${k}`); }
  await page.waitForTimeout(1500);
};
await turn(0);
let i = 1;
for (const [name, sel] of PANELS) {
  await page.click(`.nb-rail button[aria-label^="${name}"]`).catch(()=>{});
  await page.waitForSelector(sel, { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  const close = await page.$(`[aria-label^="Close ${name}"]`); if (close) await close.click().catch(()=>{});
  await page.waitForTimeout(900);
  await turn(i); i += 1;
}
await turn(i);
const all = await page.evaluate(()=>globalThis.__col);
writeFileSync(`${outDir}/collisions.json`, JSON.stringify(all,null,1));
console.log('ON-SCREEN EVENTS:', all.length);
console.log(JSON.stringify(all.slice(0,20),null,1));
console.log('errors:', errors);
await browser.close();
