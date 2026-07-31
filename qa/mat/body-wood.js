const { M } = globalThis;
const W = await import('/src/art/wood.ts');
const T = await import('/src/art/themes.ts');
const ids = ['athenaeum','cottage','apothecary','sakura'];
const PW = 900, PH = 150;
const c=document.createElement('canvas'); c.width=PW+20; c.height=20+ids.length*3*(PH+22);
const g=c.getContext('2d'); g.fillStyle='#171310'; g.fillRect(0,0,c.width,c.height); g.textBaseline='middle';
let y=10;
for (const id of ids){
  const th = T.getTheme ? T.getTheme(id) : null;
  const wood = th ? th.wood : null;
  if(!wood){ g.fillStyle='#f88'; g.fillText('no theme '+id, 10, y); y+=30; continue; }
  const variants = [['procedural (fibre 0)',0,false],['fibre 1.0',1,false],['fibre 2x strong',1,true]];
  for (const [label, fib, strong] of variants){
    g.fillStyle='#f2e8d5'; g.font='600 12px system-ui'; g.fillText(id+' — '+label, 10, y+9);
    g.save(); g.translate(10, y+20);
    M.setMaterialsEnabled(fib>0);
    W.paintWood(g, wood, PW, PH, { seed: 4242, direction: 'horizontal', pixelScale: 1, fibre: strong?1:fib });
    g.restore();
    y += PH+22;
  }
}
M.setMaterialsEnabled(true);
return c.toDataURL('image/png');
