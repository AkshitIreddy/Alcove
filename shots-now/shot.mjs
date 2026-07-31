/**
 * shots-now/shot.mjs — minimal capture.
 *
 * The older capture scripts reload the page after writing localStorage, and
 * every one of them started timing out in page.screenshot() after the flat
 * swap even though the app loads clean and settles to 1fps. This drops the
 * reload and screenshots the canvas element rather than the whole page, which
 * is also what we actually want to look at.
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots-now/shelf-flat.png';
const books = Number(process.argv[3] ?? 0);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 9000));

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
}

for (let i = 0; i < books; i++) {
  const btn = p.locator('button[aria-label="New book"]').first();
  if ((await btn.count()) === 0) break;
  await btn.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 650));
  await p.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 450));
}
await new Promise((r) => setTimeout(r, 3500));

await p.screenshot({ path: out, timeout: 120000, animations: 'disabled', caret: 'hide' });
console.log(`done -> ${out}`);
await b.close();
