import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage();await page.goto('http://127.0.0.1:1420/?fx=force');
const inventory=await page.evaluate(async()=>{
 const [s,c,b]=await Promise.all([import('/src/art/spines.ts'),import('/src/art/covers.ts'),import('/src/art/bookDesign.ts')]);
 return {titles:s.ACTIVE_TITLE_PLATES.map(id=>({id,label:s.TITLE_PLATE_LABELS[id]})),frames:c.ACTIVE_COVER_FRAMES,emblems:s.ACTIVE_ORNAMENTS,lettering:c.ACTIVE_COVER_HANDS,edges:s.ACTIVE_EDGE_OPTIONS,endbands:s.ACTIVE_HEAD_TAIL_OPTIONS,formats:s.SPINE_FORMAT_IDS.map(id=>({id,label:s.SPINE_FORMATS[id].label})),materials:b.ROLLABLE_MATERIALS.map(id=>({id,label:b.MATERIALS[id].name??b.MATERIALS[id].label})),shapes:b.ROLLABLE_SHAPES,decorations:b.ROLLABLE_DECORATIONS,bindings:b.BOOK_PRESETS.map(p=>({id:p.id,label:p.label,shape:p.shape,material:p.material,decorations:p.decorations})),coverings:c.COVER_TEXTURE_LABELS};
});
mkdirSync('shots-now/out/book-remaster',{recursive:true});writeFileSync('shots-now/out/book-remaster/catalogue-current.json',JSON.stringify(inventory,null,2));console.log(Object.fromEntries(Object.entries(inventory).map(([k,v])=>[k,v.length])));await browser.close();
