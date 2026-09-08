import {chromium} from 'playwright';
import {readdirSync,mkdirSync} from 'node:fs';
const category=process.argv[2]??'frames';
const files=readdirSync(`assets/book-art/imagegen/${category}`).filter(x=>x.endsWith('.png'));
const b=await chromium.launch({headless:true});const p=await b.newPage({viewport:{width:1400,height:1100},deviceScaleFactor:1});
await p.goto('http://127.0.0.1:1420');
for(let start=0;start<files.length;start+=12){
 await p.evaluate(async({category,files})=>{document.body.innerHTML='';document.body.style.cssText='margin:0;padding:20px;background:#ded5c4;color:#432934;font:15px Georgia;display:grid;grid-template-columns:repeat(4,1fr);gap:14px';
 await Promise.all(files.map(async name=>{const card=document.createElement('section');card.style.cssText='background:#f5efdf;padding:10px;text-align:center';const im=new Image();im.src=`/assets/book-art/imagegen/${category}/${name}`;im.style.cssText='width:300px;height:280px;object-fit:contain';card.append(im);const caption=document.createElement('p');caption.textContent=name.replace('.png','');card.append(caption);document.body.append(card);await im.decode()}));
 },{category,files:files.slice(start,start+12)});
 mkdirSync('shots-now/out/book-remaster',{recursive:true});await p.screenshot({path:`shots-now/out/book-remaster/raster-${category}-${1+start/12}.png`,fullPage:true});
}
await b.close();
