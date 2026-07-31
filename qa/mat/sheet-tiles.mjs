import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = 'public/materials';
const files = readdirSync(dir).filter(f=>f.endsWith('.webp')).sort();
const items = files.map(f=>({label:f.replace('.webp',''), src:`data:image/webp;base64,${readFileSync(`${dir}/${f}`).toString('base64')}`}));
const b = await chromium.launch({headless:true});
const p = await b.newPage();
const png = await p.evaluate(async (items)=>{
  const load = s=>new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=s;});
  const imgs = await Promise.all(items.map(i=>load(i.src)));
  const CELL=300, COLS=5, LBL=22;
  const c=document.createElement('canvas');
  c.width=CELL*COLS; c.height=(CELL+LBL)*Math.ceil(imgs.length/COLS);
  const g=c.getContext('2d'); g.fillStyle='#14110d'; g.fillRect(0,0,c.width,c.height);
  imgs.forEach((im,i)=>{
    const x=(i%COLS)*CELL, y=Math.floor(i/COLS)*(CELL+LBL);
    g.fillStyle='#f2e8d5'; g.font='600 15px system-ui'; g.textBaseline='middle';
    g.fillText(items[i].label, x+8, y+LBL/2);
    // draw 2x2 tiled so the seam shows
    for(let ty=0;ty<2;ty++)for(let tx=0;tx<2;tx++) g.drawImage(im, x+tx*CELL/2, y+LBL+ty*CELL/2, CELL/2, CELL/2);
  });
  return c.toDataURL('image/png');
}, items);
writeFileSync('qa/mat/tiles.png', Buffer.from(png.split(',')[1],'base64'));
await b.close(); console.log('ok');
