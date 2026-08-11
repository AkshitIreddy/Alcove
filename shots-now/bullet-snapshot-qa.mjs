/** Compare live unordered-list markers with the exact bitmap used by a turn. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'shots-now/out/bullet-snapshot';
mkdirSync(out, { recursive: true });
const source = `# Marker fidelity\n\nThe dots below must not jump when the page starts turning.\n\n- Common sounds get short codes\n- Rare sounds get longer codes\n- Every decoded message stays exact\n- The tree remains prefix-free\n\n::page\n\n# Next page\n\nThe turn has a real destination.`;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.setDefaultTimeout(120_000);
await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('nb-tutorial-done', '1'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof globalThis.__shelfAddBook === 'function');
await page.evaluate(async () => globalThis.__shelfWorld?.ready);
const bookId = await page.evaluate(async () => (await globalThis.__shelfAddBook(0))?.book?.id ?? null);
await page.evaluate(async (id) => { const app = await import('/src/state/app.ts'); app.appState.openBook(id); }, bookId);
await page.waitForSelector('.nb-flip-leaf-right .ProseMirror');
for (let attempt = 0; attempt < 3; attempt += 1) {
  const skip = page.getByText('skip the tour', { exact: true }).first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true }).catch(() => {});
}
await page.locator('.nb-flip-leaf-right .ProseMirror').click({ force: true });
await page.locator('.nb-rail-button[data-tool="share"]').click();
await page.getByText('Paste a script in', { exact: true }).click();
const dialog = page.getByRole('dialog', { name: 'Insert script', exact: true });
await dialog.locator('textarea').fill(source);
await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
await page.waitForSelector('.nb-flip-leaf-right ul');
await page.waitForFunction(() => globalThis.__flipCache?.facesFor?.('next')?.quiet === true);

const sheet = page.locator('.nb-flip-leaf-right .nb-sheet-paper');
const live = await sheet.screenshot();
writeFileSync(`${out}/live.png`, live);
const pageId = await sheet.getAttribute('data-page-id')
  ?? await sheet.locator('xpath=..').getAttribute('data-page-id');
const snapshotDataUrl = await page.evaluate((id) => globalThis.__flipCache?.bitmapPng?.(id) ?? null, pageId);
if (typeof snapshotDataUrl !== 'string') throw new Error(`no cached bitmap for ${pageId}`);
writeFileSync(`${out}/snapshot.png`, Buffer.from(snapshotDataUrl.split(',')[1], 'base64'));

const metrics = await page.evaluate(async ({ liveUrl, snapshotUrl }) => {
  const sheet = document.querySelector('.nb-flip-leaf-right .nb-sheet-paper');
  const list = sheet?.querySelector('ul');
  const row = list?.querySelector('li');
  if (!(sheet instanceof HTMLElement) || !(list instanceof HTMLElement) || !(row instanceof HTMLElement)) throw new Error('list geometry missing');
  const sr = sheet.getBoundingClientRect();
  const lr = list.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const markerColor = getComputedStyle(row, '::before').backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const decode = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
  const [liveImage, snapshotImage] = await Promise.all([decode(liveUrl), decode(snapshotUrl)]);
  const width = Math.round(sr.width); const height = Math.round(sr.height);
  const data = (image) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, width, height); return ctx.getImageData(0, 0, width, height).data; };
  const box = { x0: Math.floor(rr.left - sr.left - 34), x1: Math.ceil(rr.left - sr.left + 2), y0: Math.floor(lr.top - sr.top), y1: Math.ceil(lr.bottom - sr.top) };
  const locate = (pixels) => { const points = []; for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) { const i = (y * width + x) * 4; const d = Math.hypot(pixels[i] - markerColor[0], pixels[i + 1] - markerColor[1], pixels[i + 2] - markerColor[2]); if (d < 55) points.push([x, y]); } if (points.length === 0) return null; return { count: points.length, left: Math.min(...points.map(p => p[0])), right: Math.max(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), bottom: Math.max(...points.map(p => p[1])), meanX: points.reduce((s,p)=>s+p[0],0)/points.length }; };
  return { markerColor, box, live: locate(data(liveImage)), snapshot: locate(data(snapshotImage)) };
}, { liveUrl: `data:image/png;base64,${live.toString('base64')}`, snapshotUrl: snapshotDataUrl });

writeFileSync(`${out}/report.json`, `${JSON.stringify(metrics, null, 2)}\n`);
await page.locator('.nb-flip-surface').screenshot({ path: `${out}/rest.png` });
const leaf = await page.locator('.nb-flip-leaf-right').boundingBox();
if (leaf === null) throw new Error('right leaf has no turn box');
const grip = { x: leaf.x + leaf.width - 12, y: leaf.y + leaf.height * 0.82 };
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(leaf.x + leaf.width - 42, grip.y, { steps: 8 });
await page.waitForTimeout(250);
await page.locator('.nb-flip-surface').screenshot({ path: `${out}/turn-start.png` });
await page.mouse.move(leaf.x + leaf.width * 0.62, grip.y, { steps: 12 });
await page.waitForTimeout(250);
await page.locator('.nb-flip-surface').screenshot({ path: `${out}/turn-mid.png` });
await page.mouse.move(grip.x, grip.y, { steps: 12 });
await page.mouse.up();
console.log(JSON.stringify(metrics, null, 2));
await browser.close();
