/**
 * scripts/probe-spine-settle.mjs — do spines keep arriving after a studio
 * preset has visibly settled?
 *
 * The demo's temporal review caught decorated bindings swapping mid-hold at
 * f0206 and f0322. This probe stocks a shelf, applies one room preset, then
 * either waits on `__shelfWhenSpinesReady` (clean) or walks straight into a
 * hold (sabotage). It counts books whose baked spine identity changes during
 * the quiet window.
 *
 * Usage: node scripts/probe-spine-settle.mjs [--url=http://localhost:1420]
 *                                      [--sabotage]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const SABOTAGE = args.includes('--sabotage');
const HOLD_MS = 2500;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

for (;;) {
  if (await page.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  await page.waitForTimeout(50);
}

await page.evaluate(() => {
  const skip = [...document.querySelectorAll('button, a')].find((el) =>
    /skip the tour/i.test(el.textContent ?? ''),
  );
  skip?.click();
});

await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
  await globalThis.__shelfSeedBooks(
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'],
    0,
  );
  await globalThis.__shelfWhenSpinesReady(true);
});

await page.click('[aria-label="Library studio"]');
await page.waitForSelector('[aria-label="Room presets"] .nb-strip-tile');

const signature = () =>
  page.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    return books.map((bk) => {
      const book = w.store.findBook(bk.id);
      const lo = w.factory.get(bk.id, 'lo');
      const hi = w.factory.get(bk.id, 'hi');
      const pick = book === null ? null : w.factory.pick(book, w.tier);
      return {
        id: bk.id,
        lo: lo?.uid ?? null,
        hi: hi?.uid ?? null,
        pick: pick?.uid ?? null,
      };
    });
  });

await page.click('[aria-label="Room presets"] .nb-strip-tile:nth-of-type(2)');

if (!SABOTAGE) {
  await page.evaluate(() => globalThis.__shelfWhenSpinesReady(true));
}

const baseline = await signature();
const changes = [];
const t0 = Date.now();
while (Date.now() - t0 < HOLD_MS) {
  const now = await signature();
  for (let i = 0; i < baseline.length; i++) {
    const before = baseline[i];
    const after = now[i];
    if (
      after.pick !== before.pick
      || after.lo !== before.lo
      || after.hi !== before.hi
    ) {
      changes.push({ at: Date.now() - t0, id: after.id, before, after });
      baseline[i] = after;
    }
  }
  await page.waitForTimeout(50);
}

const gateAlive = SABOTAGE ? changes.length > 0 : changes.length === 0;
console.log(`mode=${SABOTAGE ? 'sabotage' : 'clean'} mid_hold_spine_changes=${changes.length}`);
if (changes.length > 0) {
  console.log(`first_change_at_ms=${changes[0].at} book=${changes[0].id}`);
}
console.log(SABOTAGE ? (gateAlive ? 'GATE ALIVE' : 'GATE INERT') : (gateAlive ? 'PASS' : 'FAIL'));

await browser.close();
process.exit(gateAlive ? 0 : 1);
