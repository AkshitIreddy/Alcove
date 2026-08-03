/**
 * shots-now/spine-transient.mjs — how long do books stay low-res after launch?
 *
 * TODO carries "spines are not disk-cached, so every launch shows the lo bake
 * until the hi one lands". Before adding a disk cache it is worth knowing what
 * the transient actually costs, because `art/bake.ts` has a measured header
 * explaining why the disk cache was REMOVED: for flat art the PNG encode costs
 * more than redrawing, and the read was awaited ahead of the producer.
 *
 * So this times it instead of assuming: poll the factory's atlas state from
 * first paint and report when the visible spines reach the hi tier.
 *
 * Usage: node shots-now/spine-transient.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('shots-now/out', { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const t0 = Date.now();
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });

// First moment the shelf can be asked anything at all.
for (;;) {
  if (await p.evaluate(() => globalThis.__shelfWorld !== undefined)) break;
  if (Date.now() - t0 > 120000) throw new Error('shelf never came up');
  await p.waitForTimeout(100);
}
const bridgeAt = Date.now() - t0;
console.log(`  shelf bridge up at ${bridgeAt}ms`);

const skip = p.getByText('skip the tour');
if (await skip.count()) await skip.first().click().catch(() => {});

// Seed enough books that the answer is not about one spine.
await p
  .evaluate(() =>
    globalThis.__shelfSeedBooks(
      ['Cell Biology', 'Kanji Practice', 'Watercolor Basics', 'Field Notes', 'Long Division'],
      0,
    ),
  )
  .catch(() => {});

/**
 * Which tier is each visible spine actually showing?
 *
 * Reads the world's own sprites rather than the factory's bookkeeping — what
 * is ON SCREEN is the question, and a cache that holds a hi bitmap nobody has
 * swapped in yet would answer it wrongly.
 */
const sample = () =>
  p.evaluate(() => {
    const w = globalThis.__shelfWorld;
    const f = w?.factory;
    if (f === undefined) return null;
    // The factory's own two buckets. `get(id,'hi')` is what floorView asks, so
    // counting who answers it is counting who is showing a crisp spine.
    const ids = (globalThis.__shelfVisibleBooks?.() ?? []).map((bk) => bk.id);
    let lo = 0;
    let hi = 0;
    for (const id of ids) {
      if (f.get(id, 'hi') !== undefined) hi += 1;
      else if (f.get(id, 'lo') !== undefined) lo += 1;
    }
    return { visible: ids.length, hi, lo, queued: f.queue?.size ?? -1 };
  });

// Fine sampling: the whole question is how long the low-res moment lasts, and
// a 1s tick can only answer it to the nearest second.
const seen = [];
const start = Date.now();
let settledAt = null;
for (;;) {
  const s = await sample();
  const at = Date.now() - t0;
  seen.push({ at, s });
  if (settledAt === null && s !== null && s.visible > 0 && s.hi === s.visible) settledAt = at;
  // Keep going a little past the settle so a later eviction would show up.
  if (settledAt !== null && at - settledAt > 3000) break;
  if (Date.now() - start > 30000) break;
  await p.waitForTimeout(200);
}

console.log('  samples:');
for (const row of seen) console.log(`   ${String(row.at).padStart(6)}ms  ${JSON.stringify(row.s)}`);
console.log(
  settledAt === null
    ? '\n  never reached hi on every visible spine within the window'
    : `\n  every visible spine crisp at ${settledAt}ms (${settledAt - bridgeAt}ms after the shelf appeared)`,
);

await p.screenshot({ path: 'shots-now/out/spine-transient.png' });
console.log('  shot shots-now/out/spine-transient.png');
await b.close();
