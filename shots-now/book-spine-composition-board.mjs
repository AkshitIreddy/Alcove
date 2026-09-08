/** All eight authored backs at real shelf widths, through production projection. */
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1400,height:750},deviceScaleFactor:2});
  await page.routeWebSocket('**',s=>s.close());
  await page.goto('http://127.0.0.1:1420/?fx=force');
  await page.waitForFunction(()=>globalThis.__shelfWorld!==undefined,null,{timeout:120000});
  await page.evaluate(async()=>{
    const [recipes,styles,spines,covers]=await Promise.all([
      import('/src/art/bookSurprise.ts'),import('/src/art/bookStyle.ts'),
      import('/src/art/spines.ts'),import('/src/art/covers.ts'),
    ]);
    await covers.preloadCoverArtwork();
    document.body.innerHTML='';document.body.style.cssText='margin:0;padding:24px;background:#eee5d5;color:#49363a;font:14px sans-serif';
    const board=document.createElement('main');board.id='spine-board';
    board.style.cssText='display:grid;grid-template-columns:repeat(8,160px);gap:8px';document.body.append(board);
    for(const direction of ['formal','grand','antique','storybook','botanical','cosy','rustic','quiet']){
      const card=document.createElement('section');card.style.cssText='padding:12px;background:#f7f0e4';
      const title=document.createElement('p');title.textContent=direction;card.append(title);
      const c=document.createElement('canvas');c.width=272;c.height=1040;c.style.cssText='width:136px;height:520px';
      const ctx=c.getContext('2d');ctx.scale(2,2);
      for(let row=0;row<2;row++)for(let col=0;col<3;col++){
        const seed=0x984fa+row*7417+col*1223;
        const recipe=recipes.surpriseBookRecipe(direction,seed);
        const resolved=styles.resolveBookStyle(seed,undefined,recipe.style,{binding:recipe.preset});
        if(resolved.spine.spineCharacter!=null)throw new Error(`Rejected sparse spine returned in ${direction}`);
        spines.renderSpine(ctx,{...resolved.spine,binding:recipe.preset,w:[24,32,40][col]},col*45,10+row*260,210,1);
        ctx.fillStyle='#685352';ctx.font='11px sans-serif';ctx.fillText(`${[24,32,40][col]} px`,col*45,238+row*260);
      }
      card.append(c);board.append(card);
    }
  });
  await page.locator('#spine-board').screenshot({path:'shots-now/out/book-spine-compositions.png'});
  console.log('48 production spines rendered at 24, 32 and 40 pixels');
} finally {await browser.close();}
