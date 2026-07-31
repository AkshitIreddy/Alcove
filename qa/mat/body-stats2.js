const { M, S } = globalThis;
const MATS=['leather','leather','cloth','cloth','linen','paper','vellum','marbled','silk'];
const BOARD=[1,2,1,0,0,0,0,0,0];
const out=[];
for (let i=0;i<MATS.length;i++){
  const rows=[];
  for (const on of [false,true]) {
    M.setMaterialsEnabled(on);
    let mean=0,spread=0,dark=0,light=0,opaque=0,n=0;
    for (let k=0;k<6;k++){
      const p=S.deriveSpineParams(4000+k*911+i*7);
      p.material=MATS[i]; p.boardStyle=BOARD[i]; p.w=34;
      const W=Math.ceil(34*2), H=230;
      const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
      const g=cv.getContext('2d');
      S.renderSpine(g,p,0,0,H,2,'Title',{hiRes:false,rowPhase:0.5,depth:0.3});
      const im=g.getImageData(0,0,W,H).data;
      // central core only: alpha is 1 there in both variants
      let s1=0,s2=0,dm=0,lm=0,cnt=0,op=0,tot=0;
      for(let y=Math.floor(H*0.12);y<H*0.88;y++)for(let x=Math.floor(W*0.28);x<W*0.72;x++){
        const o=(y*W+x)*4; tot++;
        if(im[o+3]>250) op++;
        if(im[o+3]<250) continue;
        const l=(0.2126*im[o]+0.7152*im[o+1]+0.0722*im[o+2])/255;
        s1+=l; s2+=l*l; if(l<0.22)dm++; if(l>0.78)lm++; cnt++;
      }
      const m=s1/Math.max(1,cnt);
      mean+=m; spread+=Math.sqrt(Math.max(0,s2/Math.max(1,cnt)-m*m)); dark+=dm/Math.max(1,cnt); light+=lm/Math.max(1,cnt); opaque+=op/tot; n++;
    }
    rows.push({mean:mean/n,spread:spread/n,dark:dark/n,light:light/n,opaque:opaque/n});
  }
  out.push({m:MATS[i]+'-'+BOARD[i],proc:rows[0],mat:rows[1]});
}
M.setMaterialsEnabled(true);
const c=document.createElement('canvas'); c.width=880; c.height=30+out.length*22;
const g=c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
g.fillStyle='#eee'; g.font='13px monospace'; g.textBaseline='middle';
g.fillText('CORE ONLY (alpha=1)  mean p→m      spread p→m     dark p→m      opaque p→m', 8, 14);
out.forEach((r,i)=>{
  const f=(a,b)=>`${a.toFixed(3)}→${b.toFixed(3)}`;
  const d=r.mat.mean-r.proc.mean;
  g.fillStyle=Math.abs(d)>0.035?'#ff9a7a':'#9fe6a0';
  g.fillText(`${r.m.padEnd(12)} ${f(r.proc.mean,r.mat.mean)}  ${f(r.proc.spread,r.mat.spread)}  ${f(r.proc.dark,r.mat.dark)}  ${f(r.proc.opaque,r.mat.opaque)}`,8,36+i*22);
});
return c.toDataURL('image/png');
