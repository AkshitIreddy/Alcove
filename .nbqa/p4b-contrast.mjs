import { attach, OUT } from './lib.mjs';
const { page } = await attach();

const info = await page.evaluate(() => {
  const out = [];
  for (const sel of ['.nbt-btn--primary', '.nbt-btn', '.nbt-skip', '.nbt-card']) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      out.push({ sel, cls: el.className, text: el.innerText?.trim().slice(0, 20), color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, opacity: cs.opacity });
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));

const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
for (const i of info) {
  const c = parse(i.color), b = parse(i.bg);
  if (c.length >= 3 && b.length >= 3 && (b[3] === undefined || b[3] > 0.5)) {
    const l1 = lum(c[0], c[1], c[2]), l2 = lum(b[0], b[1], b[2]);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    console.log(`  "${i.text}" ${i.color} on ${i.bg} => contrast ${ratio.toFixed(2)}:1`);
  }
}
process.exit(0);
