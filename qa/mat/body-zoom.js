const { M, S } = globalThis;
const ALL = [
  ['leather',1,'morocco'],['leather',2,'craquelure'],['cloth',1,'ribbed'],['cloth',0,'buckram'],
  ['linen',0,'linen'],['paper',0,'paper'],['vellum',0,'vellum'],['marbled',0,'marbled'],
];
const PICK = JSON.parse(globalThis.__pick || '[0,1,2,3]');
const CASES = PICK.map(i=>ALL[i]);
const SCALE = 5, H = 380;
const specs = CASES.map(([m,b],i)=>{ const p=S.deriveSpineParams(2200+PICK[i]*53); p.material=m; p.boardStyle=b; p.w=52;
  p.ornamentOn=false; p.titlePlate='none'; p.charm='none'; p.raisedBands=0; p.twoTone=false; p.gilt=false; return p; });
const CW = Math.ceil(52*SCALE);
const colW = CW*2 + 16;
const c=document.createElement('canvas');
c.width = 20 + CASES.length*(colW+26); c.height = 40 + H;
const g=c.getContext('2d'); g.fillStyle='#171310'; g.fillRect(0,0,c.width,c.height);
g.textBaseline='middle';
CASES.forEach(([m,b,label],i)=>{
  const x = 20 + i*(colW+26);
  g.fillStyle='#f2e8d5'; g.font='700 16px system-ui'; g.fillText(label, x, 13);
  g.fillStyle='#9fb6c8'; g.font='600 13px system-ui'; g.fillText('procedural', x, 31);
  g.fillStyle='#ffd9a0'; g.fillText('material', x+CW+16, 31);
  M.setMaterialsEnabled(false);
  S.renderSpine(g, specs[i], x, 40, H, SCALE, '', { hiRes: false, rowPhase: 0.6, depth: 0.2 });
  M.setMaterialsEnabled(true);
  S.renderSpine(g, specs[i], x+CW+16, 40, H, SCALE, '', { hiRes: false, rowPhase: 0.6, depth: 0.2 });
});
return c.toDataURL('image/png');
