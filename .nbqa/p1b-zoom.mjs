import { attach, OUT } from './lib.mjs';
const { page } = await attach();

await page.screenshot({ path: `${OUT}/04z-bottom-right.png`, clip: { x: 1180, y: 780, width: 260, height: 120 } });
await page.screenshot({ path: `${OUT}/05z-top-shelf.png`, clip: { x: 600, y: 40, width: 400, height: 180 } });
await page.screenshot({ path: `${OUT}/06z-bottom-bar.png`, clip: { x: 560, y: 790, width: 400, height: 110 } });

// what IS that bottom-right control?
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.right > 1300 && r.top > 830 && r.top < 900;
  });
  return els.slice(0, 14).map((e) => ({
    cls: e.className?.toString?.().slice(0, 70),
    tag: e.tagName,
    text: e.innerText?.slice(0, 40),
    rect: (() => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    overflowX: getComputedStyle(e).overflowX,
  }));
});
console.log(JSON.stringify(info, null, 1));

// Is anything overflowing the viewport horizontally?
const over = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log('doc', JSON.stringify(over));
process.exit(0);
