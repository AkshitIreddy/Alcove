/** Every new drawing in the real cover/spine renderers, plus repeatable seeds. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = 'shots-now/out/book-expansion'; mkdirSync(out, {recursive:true});
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
 const page = await browser.newPage({viewport:{width:1380,height:1000}});
 await page.routeWebSocket('**', s => s.close());
 await page.goto('http://127.0.0.1:1420/?fx=force');
 await page.waitForFunction(()=>globalThis.__shelfWorld!==undefined,null,{timeout:120000});
 const sheets = await page.evaluate(async()=>{
  const [c,s,sp,t] = await Promise.all([import('/src/art/covers.ts'),import('/src/art/bookStyle.ts'),import('/src/art/spines.ts'),import('/src/art/bookTitleArtwork.ts')]);
  await c.preloadCoverArtwork();
  await Promise.all(['600 26px "Caveat Variable"','400 18px "Patrick Hand"','400 18px "Kalam"','500 16px "Nunito Sans"'].map(f=>document.fonts.load(f)));
  document.body.innerHTML=''; document.body.style.cssText='margin:0;padding:20px;background:#e8dfcf;color:#432934;font:13px "Nunito Sans"';
  const categories = [
   ['emblems',sp.ACTIVE_ORNAMENTS.filter(a=>a.index>=86).map(a=>({label:a.label,patch:{ornament:a.index,ornamentOn:true,coverMedallion:a.index}}))],
   ['frames',c.ACTIVE_COVER_FRAMES.filter(a=>a.index>=56).map(a=>({label:a.label,patch:{coverFrame:a.index,ornament:-1,coverMedallion:-1}}))],
   ['titles',sp.ACTIVE_TITLE_PLATES.slice(26).map(id=>({label:t.REMASTERED_TITLE_LABELS[id],patch:{titlePlate:id,ornament:-1,coverMedallion:-1}}))],
  ];
  const ids=[]; const colours=['#34677b','#963d57','#486b49','#8b5139','#434f89','#79619c','#a35b35','#43676c'];
  for(const [category,items] of categories) for(let start=0;start<items.length;start+=8){
   const sheet=document.createElement('main');sheet.id=`${category}-${start/8+1}`;ids.push(sheet.id);
   sheet.style.cssText='display:grid;grid-template-columns:repeat(4,320px);gap:12px;padding:12px;background:#e8dfcf'; document.body.append(sheet);
   for(let i=start;i<Math.min(start+8,items.length);i++){
    const item=items[i], card=document.createElement('section');card.style.cssText='background:#faf4e8;padding:12px';
    const title=document.createElement('p');title.textContent=`${i+1}. ${item.label}`;title.style.cssText='height:32px;margin:0';card.append(title);
    const style=s.resolveBookStyle(317,undefined,{height:280,thickness:28,titleFont:0,titlePlate:'direct-gilt-title',coverFrame:0,raisedBands:2,spineBaseHex:colours[Math.floor(i/4)%8],coverBaseHex:colours[Math.floor(i/4)%8],toolingHex:'#ecd296',emblemHex:'#ecd296',...item.patch},{binding:'gilt-quarto'});
    const row=document.createElement('div');row.style.cssText='display:flex;gap:15px;align-items:flex-end;justify-content:center';
    const spine=document.createElement('canvas');spine.width=30;spine.height=285;
    sp.renderSpine(spine.getContext('2d'),{...style.spine,binding:'gilt-quarto',ornamentPinned:true},0,0,280,1);
    const cover=c.renderCover(205,285,style.cover,category==='titles'?'A Quiet Ledger of Small Histories':'Small Histories');
    row.append(spine,cover);card.append(row);sheet.append(card);
   }
  }
  return ids;
 });
 for(const id of sheets) await page.locator(`#${id}`).screenshot({path:`${out}/${id}.png`});
 writeFileSync(`${out}/sheets.json`,JSON.stringify(sheets));console.log(sheets.join(', '));
} finally {await browser.close();}
