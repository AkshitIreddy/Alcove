/**
 * contactsheet.mjs — stack labelled crops into one image for side-by-side
 * comparison. node contactsheet.mjs out.png "Label|a.png" "Label|b.png" ...
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const [outPath, ...specs] = process.argv.slice(2);
const items = specs.map((s) => {
  const i = s.indexOf('|');
  return { label: s.slice(0, i), src: `data:image/png;base64,${readFileSync(s.slice(i + 1)).toString('base64')}` };
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const png = await page.evaluate(async (items) => {
  const load = (src) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
  const imgs = await Promise.all(items.map((it) => load(it.src)));
  const W = 1400;
  const LABEL = 34;
  const rows = imgs.map((im) => ({ im, h: Math.round((im.height * W) / im.width) }));
  const H = rows.reduce((n, r) => n + r.h + LABEL, 0);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#14110d'; g.fillRect(0, 0, W, H);
  let y = 0;
  rows.forEach((r, i) => {
    g.fillStyle = '#f2e8d5';
    g.font = '600 20px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(items[i].label, 12, y + LABEL / 2);
    y += LABEL;
    g.drawImage(r.im, 0, y, W, r.h);
    y += r.h;
  });
  return c.toDataURL('image/png');
}, items);
writeFileSync(outPath, Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log('wrote', outPath);
