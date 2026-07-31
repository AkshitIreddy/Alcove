const { M, P, S } = globalThis;
const out = [];
const MATS = ['leather','leather','cloth','cloth','linen','paper','vellum','marbled','silk'];
const BOARD = [1,2,1,0,0,0,0,0,0];
for (let i=0;i<MATS.length;i++){
  const rows = [];
  for (const on of [false,true]) {
    M.setMaterialsEnabled(on);
    let mean=0,spread=0,dark=0,light=0,n=0;
    for (let k=0;k<6;k++){
      const p = S.deriveSpineParams(4000+k*911+i*7);
      p.material=MATS[i]; p.boardStyle=BOARD[i]; p.w=34;
      const cv=document.createElement('canvas'); cv.width=Math.ceil(34*2); cv.height=230;
      const g=cv.getContext('2d');
      S.renderSpine(g,p,0,0,230,2,'Title',{hiRes:false,rowPhase:0.5,depth:0.3});
      const sfc = P.surfaceFromCanvas(cv);
      const st = P.valueStats(sfc);
      mean+=st.mean; spread+=st.spread; dark+=st.darkMass; light+=st.lightMass; n++;
    }
    rows.push({mean:mean/n, spread:spread/n, dark:dark/n, light:light/n});
  }
  out.push({m:MATS[i]+'-'+BOARD[i], proc:rows[0], mat:rows[1]});
}
M.setMaterialsEnabled(true);
// render as text image
const c=document.createElement('canvas'); c.width=760; c.height=30+out.length*22;
const g=c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
g.fillStyle='#eee'; g.font='13px monospace'; g.textBaseline='middle';
g.fillText('material        mean p→m      spread p→m     dark p→m      light p→m', 8, 14);
out.forEach((r,i)=>{
  const f=(a,b)=>`${a.toFixed(3)}→${b.toFixed(3)}`;
  const d = r.mat.mean - r.proc.mean;
  g.fillStyle = Math.abs(d)>0.035 ? '#ff9a7a' : '#9fe6a0';
  g.fillText(`${r.m.padEnd(14)} ${f(r.proc.mean,r.mat.mean)}  ${f(r.proc.spread,r.mat.spread)}  ${f(r.proc.dark,r.mat.dark)}  ${f(r.proc.light,r.mat.light)}`, 8, 36+i*22);
});
return c.toDataURL('image/png');
