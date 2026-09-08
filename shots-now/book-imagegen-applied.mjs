import {chromium} from 'playwright';
const b=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1480,height:750},deviceScaleFactor:1.5});
await p.routeWebSocket('**', ws => ws.close());
await p.goto('http://127.0.0.1:1420/?fx=force',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{
 const r=await import('/src/art/bookRasterArtwork.ts');await r.preloadBookRasterArtwork();
 const c=await import('/src/art/covers.ts');const s=await import('/src/art/bookStyle.ts'); const sp=await import('/src/art/spines.ts');
 await Promise.all(['600 26px "Caveat Variable"','400 18px "Patrick Hand"','500 16px "Nunito Sans"'].map(font=>document.fonts.load(font)));await document.fonts.ready;document.body.innerHTML='';document.body.style.cssText='margin:0;padding:24px;background:#ede5d5;color:#432934;font:16px "Nunito Sans"';
 const grid=document.createElement('main');grid.id='applied';grid.style.cssText='display:flex;gap:22px';document.body.append(grid);
 const recipes=[
  {title:'Field Notes',binding:'laurel-calf',base:'#465537',accent:'#35402e',frame:6,emblem:1,plate:'direct-gilt-title'},
  {title:'Small Histories',binding:'half-calf',base:'#704725',accent:'#603131',frame:50,emblem:-1,plate:'direct-gilt-title'},
  {title:'The Grand Atlas',binding:'three-quarter-crown',base:'#343e57',accent:'#492f45',frame:48,emblem:20,plate:'direct-gilt-title'},
  {title:'Quiet Days',binding:'library-fillet-cloth',base:'#7a8172',accent:'#586657',frame:0,emblem:-1,plate:'direct-ink-title'},
 ];
 for(const [i,q] of recipes.entries()){
  const card=document.createElement('section');card.style.cssText='width:338px';const label=document.createElement('p');label.textContent=q.title;card.append(label);
  const resolved=s.resolveBookStyle(831+i,undefined,{coverBaseHex:q.base,coverAccentHex:q.accent,spineBaseHex:q.base,spineAccentHex:q.accent,toolingHex:'#d3b46d',emblemHex:'#d3b46d',coverFrame:q.frame,titlePlate:q.plate,ornament:q.emblem},{binding:q.binding});
  const bookH=265/c.COVER_ASPECT;
  const cv=document.createElement('canvas');cv.width=660;cv.height=Math.ceil((bookH+40)*2);cv.style.cssText=`width:330px;height:${bookH+40}px`;const ctx=cv.getContext('2d');ctx.scale(2,2);
  const params={...resolved.cover,frame:q.frame,medallion:q.emblem,titlePlate:q.plate};
  sp.renderSpine(ctx,{...resolved.spine,binding:q.binding},0,15,bookH,bookH/resolved.style.height,{hiRes:true});
  ctx.save();ctx.translate(65,15);c.renderCoverInto(ctx,265,bookH,params,q.title);ctx.restore();card.append(cv);grid.append(card);
 }
});
await p.locator('#applied').screenshot({path:'shots-now/out/book-remaster/imagegen-applied.png'});await b.close();
