/**
 * shots-now/mix.mjs — does a mixed room actually reach the shelf?
 *
 * Picks a different room for the shelves, the books and the wallpaper, then
 * shoots. Paired with sample.py this answers the question by measurement:
 * the timber must come from one room, the cloths from another and the wall
 * from a third, all at once.
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
for (let i = 0; i < 6; i++) {
  const btn = p.locator('button[aria-label="New book"]').first();
  if ((await btn.count()) === 0) break;
  await btn.click({ force: true, timeout: 4000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
  await p.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
}

await p.locator('button[aria-label="Library studio"]').first()
  .click({ force: true, timeout: 5000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1600));
await p.screenshot({ path: 'shots-now/mix-before.png', timeout: 120000, animations: 'disabled' });

// One room per part: shelves from Coral Reef, books from Amber Apothecary,
// wallpaper from Blossom Grove.
const pick = async (part, room) => {
  const btn = p.locator(`button[aria-label="${part}: ${room}"]`).first();
  if ((await btn.count()) === 0) {
    console.log(`  MISSING control: ${part}: ${room}`);
    return;
  }
  await btn.click({ force: true, timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1600));
};
await pick('shelves', 'Coral Reef');
await pick('wallpaper', 'Blossom Grove');

await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: 'shots-now/mix-after.png', timeout: 120000, animations: 'disabled' });
console.log('done -> shots-now/mix-before.png, mix-after.png');
await b.close();
