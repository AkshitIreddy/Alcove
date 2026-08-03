/**
 * shots-now/welcome-binding.mjs — photograph candidate welcome-book bindings.
 *
 * A pigment NAME is not the cloth it paints (see the note above WELCOME_BINDING
 * in src/data/seed.ts), so every candidate is applied to the real welcome book
 * through the world's own bridge and photographed: once on the shelf at spine
 * scale, once held in front of the case so the cover is visible.
 *
 * Usage: node shots-now/welcome-binding.mjs --tag=p --set='[[{...style}, "label"], …]'
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const TAG = opt('tag', 'p');
const HELD = opt('held', '0') === '1';

const BASE = {
  material: 'leather',
  hueJitter: 0,
  raisedBands: 4,
  bandGilt: true,
  headTail: true,
  headTailStyle: 2,
  ornament: 9,
  titlePlate: 'gilt',
  titleFont: 0,
  wear: 0.1,
  edge: 'gilt',
  format: 'quarto',
};

const CANDIDATES = JSON.parse(
  opt('set', JSON.stringify([
    [{ pigment: 4 }, 'plum-current'],
    [{ pigment: 12 }, 'oxblood'],
    [{ pigment: 20 }, 'burgundy'],
    [{ pigment: 13 }, 'navy'],
    [{ pigment: 14 }, 'forest'],
    [{ pigment: 24 }, 'aubergine'],
    [{ pigment: 42 }, 'chestnut'],
    [{ pigment: 18 }, 'teal'],
  ])),
);

mkdirSync('shots-now/defaults', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
const errors = new Set();
page.on('pageerror', (e) => errors.add(String(e.message).split('\n')[0].slice(0, 200)));

const poll = async (fn, timeout = 120000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfVisibleBooks !== undefined, 120000, 'world bridges');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y mirror');
for (let i = 0; i < 10; i += 1) {
  const skip = page.getByText('skip the tour');
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
}
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1200);

const bookId = await poll(
  () => {
    const list = globalThis.__shelfVisibleBooks?.() ?? [];
    const hit = list.find((b) => b.title.startsWith('Welcome'));
    return hit ? hit.id : null;
  },
  60000,
  'the welcome book',
);
console.log('  welcome book:', bookId);

if (!HELD) {
  for (let z = 0; z < 3; z += 1) await page.evaluate(() => globalThis.__shelfWorld.zoomIn());
  await page.waitForTimeout(1200);
}

const rects = [];
let i = 0;
for (const [patch, label] of CANDIDATES) {
  i += 1;
  for (let tries = 0; ; tries += 1) {
    const ok = await page
      .evaluate(async (a) => {
        if (globalThis.__shelfSetBookStyle === undefined) return false;
        await globalThis.__shelfSetBookStyle(a.id, a.style);
        return true;
      }, { id: bookId, style: { ...BASE, ...patch } })
      .catch(() => false);
    if (ok) break;
    if (tries > 200) throw new Error('style bridge never appeared');
    await page.waitForTimeout(500);
  }
  // The spine is re-baked off-thread and rAF is throttled under SwiftShader:
  // a short wait photographs the PREVIOUS candidate. Observed off-by-one.
  await page.waitForTimeout(9000);
  if (HELD) {
    await page.evaluate((id) => globalThis.__shelfPullOut(id), bookId);
    await page
      .locator('[data-testid="pulled-book-hand"]')
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
  }
  const rect = await page
    .evaluate((id) => (globalThis.__shelfSpineRect ? globalThis.__shelfSpineRect(id) : null), bookId)
    .catch(() => null);
  const name = `shots-now/defaults/${TAG}-${String(i).padStart(2, '0')}-${label}.png`;
  await page.screenshot({ path: name, timeout: 180000, animations: 'disabled', caret: 'hide' });
  rects.push({ name, label, rect });
  console.log(`  ${name} rect=${JSON.stringify(rect)}`);
  if (HELD) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1500);
  }
}

writeFileSync(`shots-now/defaults/${TAG}-rects.json`, JSON.stringify(rects, null, 2));
if (errors.size) console.log('errors:\n  ' + [...errors].join('\n  '));
await browser.close();
