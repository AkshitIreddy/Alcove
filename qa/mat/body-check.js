const { M, P } = globalThis;
const lines = [];
const tint = '#6a4a30';
const tl = (()=>{const c=P.parseColour(tint); return 0.2126*c.r+0.7152*c.g+0.0722*c.b;})();
lines.push('tint luminance = '+tl.toFixed(4));
for (const e of M.MATERIAL_MANIFEST) {
  const sf = M.sampleMaterial(e.slug, 68, 460, { tint, scale: 2, seed: 12345 });
  const st = P.valueStats(sf);
  lines.push(`${e.slug.padEnd(17)} mean=${st.mean.toFixed(4)} spread=${st.spread.toFixed(3)} d=${(st.mean-tl>=0?'+':'')+(st.mean-tl).toFixed(4)}`);
}
// and with balance 0
lines.push('--- balance:0 ---');
for (const e of M.MATERIAL_MANIFEST) {
  const sf = M.sampleMaterial(e.slug, 68, 460, { tint, scale: 2, seed: 12345, balance: 0 });
  const st = P.valueStats(sf);
  lines.push(`${e.slug.padEnd(17)} mean=${st.mean.toFixed(4)} d=${(st.mean-tl>=0?'+':'')+(st.mean-tl).toFixed(4)}`);
}
const c=document.createElement('canvas'); c.width=520; c.height=16+lines.length*18;
const g=c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
g.fillStyle='#dfe'; g.font='13px monospace'; g.textBaseline='middle';
lines.forEach((l,i)=>g.fillText(l,8,14+i*18));
return c.toDataURL('image/png');
