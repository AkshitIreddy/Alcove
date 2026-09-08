/** Complete production binding catalogue; 12 paired specimens per review sheet. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const root='shots-now/out/book-remaster';mkdirSync(root,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1330,height:1200},deviceScaleFactor:1});page.on('pageerror',e=>console.error(e));
await page.routeWebSocket('**', ws=>ws.close());
await page.goto('http://127.0.0.1:1420/?fx=force');
await page.waitForFunction(()=>globalThis.__shelfWorld!==undefined,null,{timeout:120000});
const manifest=await page.evaluate(async()=>{
 const [d,s,c,sp]=await Promise.all([import('/src/art/bookDesign.ts'),import('/src/art/bookStyle.ts'),import('/src/art/covers.ts'),import('/src/art/spines.ts')]);
 await c.preloadCoverArtwork();
 await Promise.all(['600 26px "Caveat Variable"','400 18px "Patrick Hand"','400 18px "Kalam"','400 18px "Architects Daughter"','500 16px "Nunito Sans"'].map(font=>document.fonts.load(font)));await document.fonts.ready;
 document.body.innerHTML='';document.body.style.cssText='margin:0;padding:20px;background:#e8dfcf;color:#432934;font:13px "Nunito Sans"';
 const manifest=[];
 for(let start=0;start<d.BOOK_PRESETS.length;start+=12){
  const sheet=document.createElement('main');sheet.id=`sheet-${start/12}`;sheet.style.cssText='display:grid;grid-template-columns:repeat(4,305px);gap:14px;padding:10px;background:#e8dfcf;margin-bottom:24px';document.body.append(sheet);
  for(let i=start;i<Math.min(start+12,d.BOOK_PRESETS.length);i++){
   const preset=d.BOOK_PRESETS[i];const seed=(0x31550+Math.imul(i+1,7919))>>>0;const resolved=s.resolveBookStyle(seed,undefined,{}, {binding:preset.id});
   const appliedSpine={...resolved.spine,binding:preset.id};if(sp.resolveSpineBinding(appliedSpine).preset!==preset.id)throw new Error(`Wrong applied spine binding: ${preset.id}`);
   const card=document.createElement('section');card.style.cssText='background:#f8f2e7;border:1px solid #bfae98;border-radius:5px;padding:12px';
   const title=document.createElement('p');title.style.cssText='margin:0 0 8px;font-weight:600';title.textContent=`${i+1}. ${preset.label}`;card.append(title);
   const art=document.createElement('div');art.style.cssText='display:flex;align-items:flex-end;justify-content:center;gap:24px;height:270px';
   const scale=Math.min(1,255/resolved.style.height),h=resolved.style.height*scale,w=h*.72;
   const spine=document.createElement('canvas');spine.width=Math.ceil(resolved.style.thickness*scale+4);spine.height=Math.ceil(h);sp.renderSpine(spine.getContext('2d'),appliedSpine,2,0,h,scale,{hiRes:true});spine.style.cssText=`height:${h}px;width:${resolved.style.thickness*scale}px`;const cover=c.renderCover(w,h,resolved.cover,'Field Notes',{dpr:2});cover.style.cssText=`height:${h}px;width:${w}px`;art.append(spine,cover);card.append(art);
   const meta=document.createElement('p');meta.style.cssText='font-size:11px;margin:10px 0 0;min-height:32px';meta.textContent=`${preset.material} · ${preset.decorations.join(', ') || 'plain'}`;card.append(meta);sheet.append(card);manifest.push({number:i+1,id:preset.id,label:preset.label,sheet:start/12,cover:resolved.cover});
  }
 }
 return manifest;
});
for(let i=0;i<Math.ceil(manifest.length/12);i++)await page.locator(`#sheet-${i}`).screenshot({path:`${root}/bindings-${i+1}.png`});
writeFileSync(`${root}/bindings.json`,JSON.stringify(manifest,null,2));console.log(`${manifest.length} bindings, ${Math.ceil(manifest.length/12)} sheets`);await browser.close();
