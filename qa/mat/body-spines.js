const { M, P, S } = globalThis;
const MATS = ['leather','leather','leather','cloth','cloth','cloth','paper','vellum','linen','silk','marbled','marbled'];
const BOARD = [0,1,2,0,1,2,0,0,0,0,0,2];
const N = MATS.length;
const SCALE = 2;
const H = 250, GAP = 10, LBL = 30, TITLE = 26;
// build params
const specs = [];
for (let i=0;i<N;i++){
  const p = S.deriveSpineParams(1000 + i*37);
  p.material = MATS[i]; p.boardStyle = BOARD[i];
  p.w = 30 + (i%3)*8;
  p.texture = 0;
  specs.push(p);
}
const colW = Math.ceil(Math.max(...specs.map(p=>p.w))*SCALE) + GAP;
const W = 60 + N*colW;
const c = document.createElement('canvas');
c.width = W; c.height = TITLE + 2*(LBL + H + 12);
const g = c.getContext('2d');
g.fillStyle='#171310'; g.fillRect(0,0,c.width,c.height);
g.textBaseline='middle'; g.font='600 12px system-ui';
let y = TITLE;
for (const on of [false, true]) {
  M.setMaterialsEnabled(on);
  g.fillStyle = on ? '#ffd9a0' : '#9fb6c8'; g.font='700 15px system-ui';
  g.fillText(on ? 'MATERIAL BASE (generated tiles)' : 'PROCEDURAL (brush only)', 8, y - 8);
  g.font='600 11px system-ui';
  for (let i=0;i<N;i++){
    const p = specs[i];
    const w = Math.ceil(p.w*SCALE);
    g.fillStyle='#c9bda8';
    g.save(); g.translate(60 + i*colW, y + LBL - 4); g.fillText(MATS[i]+'·'+BOARD[i], 0, 0); g.restore();
    S.renderSpine(g, p, 60 + i*colW, y + LBL, H, SCALE, 'Peregrine Pickle', { hiRes: true, rowPhase: i/(N-1), depth: 0.25 });
  }
  y += LBL + H + 12;
}
M.setMaterialsEnabled(true);
return c.toDataURL('image/png');
