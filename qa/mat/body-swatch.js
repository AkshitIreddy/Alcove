const { M, P } = globalThis;
const slugs = M.MATERIAL_MANIFEST.map(m=>m.slug);
const PIG = ['#5a2c1e','#2f4a34','#1f3350','#7a1f22','#c8a24a','#e8dcc0'];
const CW = 96, CH = 130, PAD = 4, LBL = 18, HDR = 22;
const cols = PIG.length;
const c = document.createElement('canvas');
c.width = 40 + cols*(CW+PAD) + 260;
c.height = HDR + slugs.length*(CH+PAD+LBL);
const g = c.getContext('2d');
g.fillStyle='#14110d'; g.fillRect(0,0,c.width,c.height);
g.font='600 12px system-ui'; g.textBaseline='middle'; g.fillStyle='#f2e8d5';
PIG.forEach((p,i)=>{ g.fillStyle=p; g.fillRect(40+i*(CW+PAD), 4, CW, 12); });
let y = HDR;
for (const slug of slugs) {
  const tile = M.getMaterialTile(slug);
  g.fillStyle='#f2e8d5'; g.font='600 12px system-ui';
  g.fillText(slug + (tile? '' : ' (MISSING)'), 6, y+LBL/2);
  y += LBL;
  PIG.forEach((pig,i)=>{
    const sf = M.sampleMaterial(slug, CW, CH, { tint: pig, tilePx: 110, strength: 0.75, seed: i*97+3 });
    if (sf) { const im = new ImageData(P.surfaceToRGBA8(sf), CW, CH);
      const t = document.createElement('canvas'); t.width=CW; t.height=CH; t.getContext('2d').putImageData(im,0,0);
      g.drawImage(t, 40+i*(CW+PAD), y); }
  });
  // raw tile at right for reference
  const raw = M.sampleMaterial(slug, 240, CH, { tint:'#808080', tilePx: 240, strength: 1, colourMix: 1, contrast: 1 });
  if (raw) { const im = new ImageData(P.surfaceToRGBA8(raw), 240, CH);
    const t = document.createElement('canvas'); t.width=240; t.height=CH; t.getContext('2d').putImageData(im,0,0);
    g.drawImage(t, 40+cols*(CW+PAD)+8, y); }
  y += CH + PAD;
}
return c.toDataURL('image/png');
