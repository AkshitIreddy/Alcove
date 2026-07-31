const { M, S } = globalThis;
const N = 26;
const SCALE = Number(globalThis.__pick || 2);
const specs=[]; let total=0;
for(let i=0;i<N;i++){ const p=S.deriveSpineParams(7700+i*211); specs.push(p); total += Math.ceil(p.w*SCALE)+3; }
const H = Math.ceil(250*SCALE/2);
const c=document.createElement('canvas'); c.width=total+40; c.height=2*(H+34)+10;
const g=c.getContext('2d'); g.fillStyle='#1a1512'; g.fillRect(0,0,c.width,c.height);
g.textBaseline='middle';
let y=0;
for(const on of [false,true]){
  M.setMaterialsEnabled(on);
  g.fillStyle= on?'#ffd9a0':'#9fb6c8'; g.font='700 15px system-ui';
  g.fillText((on?'MATERIAL':'PROCEDURAL')+'  ·  bake scale '+SCALE, 12, y+14);
  let x=20;
  for(let i=0;i<N;i++){
    const p=specs[i];
    S.renderSpine(g,p,x,y+28,H,SCALE,'Peregrine Pickle',{hiRes:SCALE>=2,rowPhase:i/(N-1),depth:0.2+0.2*((i*7)%3)/2});
    x += Math.ceil(p.w*SCALE)+3;
  }
  y += H+34;
}
M.setMaterialsEnabled(true);
return c.toDataURL('image/png');
