import { attach, OUT } from './lib.mjs';
const { page } = await attach();

const seg = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const t = (e.innerText ?? '').trim();
    if (/^shelf$/i.test(t) || /^book$/i.test(t)) {
      const r = e.getBoundingClientRect();
      out.push({ cls: e.className?.toString?.().slice(0, 80), text: t, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], right: Math.round(r.right) });
    }
  }
  return out;
});
console.log('shelf/book chips:', JSON.stringify(seg, null, 1));

const parent = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => (e.innerText ?? '').trim() === 'shelf');
  if (!el) return null;
  const chain = [];
  let p = el;
  for (let i = 0; i < 5 && p; i++) {
    const r = p.getBoundingClientRect();
    chain.push({ cls: p.className?.toString?.().slice(0, 90), tag: p.tagName, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    p = p.parentElement;
  }
  return chain;
});
console.log('chain:', JSON.stringify(parent, null, 1));

await page.screenshot({ path: `${OUT}/07z-shelf-object.png`, clip: { x: 690, y: 70, width: 130, height: 90 } });
process.exit(0);
