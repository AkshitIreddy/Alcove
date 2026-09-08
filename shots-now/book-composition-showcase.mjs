/** Actual generated editions, sampled through the production resolver/painters. */
import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1.5});
  await page.routeWebSocket('**',ws=>ws.close());
  await page.goto('http://127.0.0.1:1420/?fx=force');
  await page.waitForFunction(()=>globalThis.__shelfWorld!==undefined,null,{timeout:120000});
  const samples=await page.evaluate(async()=>{
    const [surprise,styles,covers,spines]=await Promise.all([
      import('/src/art/bookSurprise.ts'),import('/src/art/bookStyle.ts'),
      import('/src/art/covers.ts'),import('/src/art/spines.ts'),
    ]);
    await covers.preloadCoverArtwork();
    await Promise.all(['600 26px "Caveat Variable"','400 20px "Patrick Hand"','500 14px "Nunito Sans"'].map(f=>document.fonts.load(f)));
    document.body.innerHTML='';
    document.body.style.cssText='margin:0;padding:28px;background:#eee5d5;color:#432934;font:14px "Nunito Sans"';
    const board=document.createElement('main');board.id='edition-showcase';
    board.style.cssText='display:grid;grid-template-columns:repeat(4,320px);gap:20px;padding:14px;background:#eee5d5';
    document.body.append(board);
    const specs=[
      ['botanical','Field Notes','botanical-study','Illustration leads'],
      ['antique','Small Histories','archive-label','An archival label'],
      ['grand','The Grand Atlas','grand-frame','One ornamental structure'],
      ['quiet','Quiet Days','quiet-title','Type and open space'],
      ['storybook','The Lantern Atlas','storybook-device','A bold story device'],
      ['formal','Collected Letters','formal-title','Measured rules and lettering'],
      ['cosy','Everyday Things','archive-label','A personal cloth journal'],
      ['rustic','Travelling Notes','split-title','Construction leads'],
    ];
    const report=[];
    for(const [direction,title,,note] of specs){
      const seed=0x682fa;
      const recipe=surprise.surpriseBookRecipe(direction,seed);
      const resolved=styles.resolveBookStyle(seed,undefined,recipe.style,{binding:recipe.preset});
      if(resolved.cover.composition!=null)throw new Error(`Rejected sparse layout returned for ${direction}`);
      const card=document.createElement('section');card.style.cssText='padding:16px 14px;background:#f7f0e4;';
      const label=document.createElement('div');label.textContent=direction[0].toUpperCase()+direction.slice(1);
      label.style.cssText='font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 16px';card.append(label);
      const canvas=document.createElement('canvas');canvas.width=584;canvas.height=608;canvas.style.cssText='width:292px;height:304px';
      const ctx=canvas.getContext('2d');ctx.scale(2,2);
      const height=280,scale=height/resolved.style.height;
      spines.renderSpine(ctx,{...resolved.spine,binding:recipe.preset},5,6,height,scale,{hiRes:true});
      ctx.save();ctx.translate(75,6);covers.renderCoverInto(ctx,height*covers.COVER_ASPECT,height,resolved.cover,title);ctx.restore();
      card.append(canvas);
      const caption=document.createElement('p');caption.textContent=recipe.preset;caption.style.cssText='margin:10px 0 0;font-size:13px;color:#756252';card.append(caption);board.append(card);
      report.push({direction,title,seed,preset:recipe.preset,composition:resolved.cover.composition,style:recipe.style});
    }
    return report;
  });
  await page.locator('#edition-showcase').screenshot({path:'shots-now/out/book-composition-showcase.png'});
  writeFileSync('shots-now/out/book-composition-showcase.json',JSON.stringify(samples,null,2));
  console.log(`${samples.length} authored compositions rendered`);
} finally {await browser.close();}
