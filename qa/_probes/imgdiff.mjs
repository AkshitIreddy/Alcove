/**
 * imgdiff.mjs — amplified difference of two PNGs, plus a bounding box of the
 * changed region. Uses a headless chromium canvas (no native image deps).
 *
 * node qa/_probes/imgdiff.mjs a.png b.png out.png [gain]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const [aPath, bPath, outPath, gainArg] = process.argv.slice(2);
const gain = Number(gainArg ?? 12);
const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ a, b, gain }) => {
    const load = (src) =>
      new Promise((r, j) => {
        const i = new Image();
        i.onload = () => r(i);
        i.onerror = j;
        i.src = src;
      });
    const ia = await load(a);
    const ib = await load(b);
    const w = Math.min(ia.width, ib.width);
    const h = Math.min(ia.height, ib.height);
    const mk = (img) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, w, h).data;
    };
    const da = mk(ia);
    const db = mk(ib);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const od = octx.createImageData(w, h);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, changed = 0, maxd = 0;
    for (let i = 0; i < w * h; i++) {
      const d =
        Math.abs(da[i * 4] - db[i * 4]) +
        Math.abs(da[i * 4 + 1] - db[i * 4 + 1]) +
        Math.abs(da[i * 4 + 2] - db[i * 4 + 2]);
      maxd = Math.max(maxd, d);
      const v = Math.min(255, d * gain);
      od.data[i * 4] = v;
      od.data[i * 4 + 1] = v;
      od.data[i * 4 + 2] = v;
      od.data[i * 4 + 3] = 255;
      if (d > 3) {
        changed++;
        const x = i % w;
        const y = (i / w) | 0;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    octx.putImageData(od, 0, 0);
    return { png: out.toDataURL('image/png'), w, h, x0, y0, x1, y1, changed, maxd };
  },
  { a: b64(aPath), b: b64(bPath), gain },
);
writeFileSync(outPath, Buffer.from(res.png.split(',')[1], 'base64'));
console.log(
  `size=${res.w}x${res.h} changedPx=${res.changed} maxChannelSum=${res.maxd} ` +
    `bbox=(${res.x0},${res.y0})-(${res.x1},${res.y1}) => ${res.x1 - res.x0 + 1}x${res.y1 - res.y0 + 1}`,
);
await browser.close();
