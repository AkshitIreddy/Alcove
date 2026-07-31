const { M, P } = globalThis;
const slugs = ['leather-morocco','leather-cracked','cloth-ribbed','cloth-linen','paper-laid','vellum','paper-marbled'];
const TP = [220,140,90,60,40,26];
const ST = [0.55,0.8,1.1];
const W=34,H=210,PAD=6,LBL=16;
const cellW = TP.length*(W+PAD);
const c=document.createElement('canvas');
c.width = 150 + ST.length*(cellW+24);
c.height = 24 + slugs.length*(H+PAD+LBL);
const g=c.getContext('2d'); g.fillStyle='#14110d'; g.fillRect(0,0,c.width,c.height);
g.textBaseline='middle';
ST.forEach((s,si)=>{ g.fillStyle='#ffd9a0'; g.font='600 13px system-ui';
  g.fillText('strength '+s+'   tilePx '+TP.join(' / '), 150+si*(cellW+24), 12); });
let y=24;
for (const slug of slugs){
  g.fillStyle='#f2e8d5'; g.font='600 13px system-ui'; g.fillText(slug, 6, y+H/2);
  ST.forEach((st,si)=>{
    TP.forEach((tp,ti)=>{
      const sf = M.sampleMaterial(slug, W, H, { tint:'#4a2b1c', tilePx: tp, strength: st, seed: ti*31+si });
      if(!sf) return;
      const im=new ImageData(P.surfaceToRGBA8(sf),W,H);
      const t=document.createElement('canvas'); t.width=W;t.height=H;t.getContext('2d').putImageData(im,0,0);
      g.drawImage(t, 150+si*(cellW+24)+ti*(W+PAD), y);
    });
  });
  y += H+PAD+LBL;
}
return c.toDataURL('image/png');
