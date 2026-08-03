/**
 * shots-now/first-run.mjs — what a brand-new reader actually sees.
 *
 * Clears localStorage and photographs the shelf with NO bridge overrides, so
 * the picture is produced by the real defaults (theme, carpentry, wallpaper,
 * welcome binding) rather than by anything the harness set.
 *
 * Usage: node shots-now/first-run.mjs [out.png] [--tour=1] [--zoom=N]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'shots-now/defaults/first-run.png';
const keepTour = args.includes('--tour=1');
const zoom = Number((args.find((a) => a.startsWith('--zoom=')) ?? '--zoom=0').split('=')[1]);
const next = Number((args.find((a) => a.startsWith('--next=')) ?? '--next=0').split('=')[1]);

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errors = new Set();
p.on('pageerror', (e) => errors.add(String(e.message).split('\n')[0].slice(0, 160)));

await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.evaluate(() => localStorage.clear());
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForTimeout(12000);

if (!keepTour) {
  for (let i = 0; i < 10; i += 1) {
    const skip = p.getByText('skip the tour');
    if ((await skip.count()) === 0) break;
    await skip.first().click({ force: true }).catch(() => {});
    await p.waitForTimeout(700);
  }
  await p.keyboard.press('Escape').catch(() => {});
}
for (let n = 0; n < next; n += 1) {
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1400);
}
for (let z = 0; z < zoom; z += 1) {
  await p.evaluate(() => globalThis.__shelfWorld?.zoomIn()).catch(() => {});
}
await p.waitForTimeout(6000);

const applied = await p.evaluate(() => globalThis.__shelfDesign?.() ?? null).catch(() => null);
console.log('  applied:', JSON.stringify(applied)?.slice(0, 260));
await p.screenshot({ path: out, timeout: 180000, animations: 'disabled', caret: 'hide' });
console.log('  ->', out);
if (errors.size) console.log('  pageerrors:\n   ' + [...errors].join('\n   '));
await b.close();
