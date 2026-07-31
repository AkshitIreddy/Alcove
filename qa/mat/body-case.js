const { M } = globalThis;
const CA = await import('/src/art/caseArt.ts');
const T = await import('/src/art/themes.ts');
const ids = JSON.parse(globalThis.__pick || '["athenaeum","cottage"]');
const W=520,H=300;
const c=document.createElement('canvas'); c.width=20+2*(W+16); c.height=24+ids.length*(H+30);
const g=c.getContext('2d'); g.fillStyle='#171310'; g.fillRect(0,0,c.width,c.height); g.textBaseline='middle';
let y=14;
for (const id of ids){
  const theme = T.getTheme(id);
  g.fillStyle='#f2e8d5'; g.font='700 13px system-ui'; g.fillText(id+' · '+theme.backdrop, 12, y+6);
  g.fillStyle='#9fb6c8'; g.font='600 11px system-ui'; g.fillText('procedural', 90, y+6);
  g.fillStyle='#ffd9a0'; g.fillText('material', 190, y+6);
  for (const [i,on] of [[0,false],[1,true]]){
    M.setMaterialsEnabled(on);
    g.save(); g.translate(20+i*(W+16), y+18);
    g.beginPath(); g.rect(0,0,W,H); g.clip();
    CA.renderBackdrop(g, theme, theme.backdrop, W, H, { seed: 991, floorH: 150 });
    g.restore();
  }
  y += H+30;
}
M.setMaterialsEnabled(true);
return c.toDataURL('image/png');
