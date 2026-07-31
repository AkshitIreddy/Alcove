/**
 * shots-now/panels.mjs — look at the things the last wave claimed to finish.
 *
 * Agent reports are evidence, not proof. Three claims worth seeing: the studio
 * previews rooms that actually differ, a pulled-out book is flat, and the
 * trash rail button opens the real panel.
 */
import { chromium } from 'playwright';

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

// Make sure there is something on the shelf to pull.
for (let i = 0; i < 3; i++) {
  const btn = p.locator('button[aria-label="New book"]').first();
  if ((await btn.count()) === 0) break;
  await btn.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await p.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
}

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 1800));
  await p.screenshot({ path: `shots-now/${name}.png`, timeout: 120000, animations: 'disabled' });
  console.log(`  ${name}`);
};

// 1. The studio — do the theme cards differ?
await p.locator('button[aria-label="Library studio"]').first()
  .click({ force: true, timeout: 5000 }).catch(() => {});
await shot('panel-studio');

// 2. Pick the second theme and look at the shelf.
const cards = p.locator('.nb-theme-card');
if ((await cards.count()) > 1) {
  await cards.nth(1).click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
}
await shot('panel-theme2');

await p.keyboard.press('Escape').catch(() => {});
await new Promise((r) => setTimeout(r, 900));

// 3. The trash rail button.
await p.locator('button[aria-label="Trash"]').first()
  .click({ force: true, timeout: 5000 }).catch(() => {});
await shot('panel-trash');

await b.close();
console.log('done');
