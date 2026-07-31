const { M, S } = globalThis;
const W = await import('/src/art/wood.ts');
const T = await import('/src/art/themes.ts');
const lines=[];
function bench(label, fn, n){ fn(); const t0=performance.now(); for(let i=0;i<n;i++) fn(i); return (performance.now()-t0)/n; }
for (const on of [false,true]) {
  M.setMaterialsEnabled(on);
  const tag = on?'material':'procedural';
  const specs=[]; for(let i=0;i<12;i++) specs.push(S.deriveSpineParams(5500+i*97));
  const lo = bench('lo', (i=0)=>{ const p=specs[i%12]; const cv=document.createElement('canvas'); cv.width=Math.ceil(p.w); cv.height=232;
    S.renderSpine(cv.getContext('2d'),p,0,0,232,1,'Peregrine Pickle',{hiRes:false}); }, 24);
  const hi = bench('hi', (i=0)=>{ const p=specs[i%12]; const cv=document.createElement('canvas'); cv.width=Math.ceil(p.w*2); cv.height=464;
    S.renderSpine(cv.getContext('2d'),p,0,0,464,2,'Peregrine Pickle',{hiRes:true}); }, 24);
  const wood = bench('wood', ()=>{ const cv=document.createElement('canvas'); cv.width=1600; cv.height=40;
    W.paintWood(cv.getContext('2d'), T.getTheme('athenaeum').wood, 1600, 40, {seed:7, direction:'horizontal'}); }, 6);
  lines.push(`${tag.padEnd(11)} spine-lo ${lo.toFixed(2)}ms   spine-hi ${hi.toFixed(2)}ms   plank1600 ${wood.toFixed(1)}ms`);
}
M.setMaterialsEnabled(true);
const c=document.createElement('canvas'); c.width=680; c.height=20+lines.length*22;
const g=c.getContext('2d'); g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
g.fillStyle='#9fe6a0'; g.font='14px monospace'; g.textBaseline='middle';
lines.forEach((l,i)=>g.fillText(l,8,16+i*22));
return c.toDataURL('image/png');
