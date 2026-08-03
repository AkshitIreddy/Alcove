/**
 * shots-now/charm-seam.mjs — does a charm colourway actually REACH the shelf?
 *
 * The specimen board proves the twenty-four draw well; this proves the app can
 * get to them. It seeds a row of books, pins a different charm colourway on
 * each through the `?fx=force` bridge (never through its own import of
 * `data/*`, which on an HMR'd dev server can resolve to a second copy of the
 * module the shelf never reads), and photographs the row after the spines have
 * re-baked.
 *
 * Then it pulls one book out and photographs the board, because the charm is
 * drawn twice — once on the spine and once on the cover — out of two different
 * modules, and those two used to disagree.
 *
 * Usage: node shots-now/charm-seam.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => '__shelfVisibleBooks' in window, null, { timeout: 60_000 });
await p.waitForTimeout(4000);

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}

const report = await p.evaluate(async () => {
  const g = window;
  // Runs are repeatable: start from an empty case rather than stacking another
  // fourteen books onto the last run's.
  await g.__shelfEmptyLibrary?.();
  await new Promise((r) => setTimeout(r, 1200));
  const charmsMod = await import('/src/art/charms.ts');
  await g.__shelfSeedBooks?.(
    charmsMod.CHARM_COLOR_LABELS.slice(0, 14).map((l) => `${l} ribbon`),
    0,
  );
  await new Promise((r) => setTimeout(r, 1500));
  const books = g.__shelfVisibleBooks();
  const charms = await import('/src/art/charms.ts');
  const n = charms.CHARM_COLORS.length;
  const picked = [];
  for (let i = 0; i < Math.min(books.length, 14); i++) {
    // Spread across the table so old indices and new ones stand side by side.
    const slot = Math.round((i * (n - 1)) / Math.max(1, Math.min(books.length, 14) - 1));
    await g.__shelfSetBookStyle(books[i].id, {
      charm: 'ribbon',
      charmColor: slot,
      gilt: true,
    });
    picked.push({ id: books[i].id, slot, hex: charms.CHARM_COLORS[slot], label: charms.CHARM_COLOR_LABELS[slot] });
  }
  return { picked, tableSize: n };
});

console.log(`  table is ${report.tableSize} colourways; pinned ${report.picked.length} books`);
for (const r of report.picked) console.log(`    ${r.slot}\t${r.label}\t${r.hex}`);

await p.waitForTimeout(9000);
await p.screenshot({ path: 'shots-now/charm-shelf.png' });

// --- and the same colourway on the pulled-out board ------------------------
// Take it off the shelf by clicking its spine where the shelf says the spine
// IS — not by calling pullOut() directly — so the probe fails if the book
// stops being reachable rather than only if the art stops being drawn.
const last = report.picked[Math.floor(report.picked.length / 2)];
const rect = await p.evaluate((id) => window.__shelfSpineRect(id), last.id);
console.log('  spine rect:', JSON.stringify(rect));
if (rect === null) {
  console.log(`  FAIL: the shelf has no spine rect for ${last.label}`);
} else {
  await p.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const hand = p.locator('[data-testid="pulled-book"]');
  await hand.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await p.waitForTimeout(5000);
  if ((await hand.count()) === 0) {
    console.log('  FAIL: the book never reached the hand');
    await p.screenshot({ path: 'shots-now/charm-pulled.png' });
  } else {
    await hand.screenshot({ path: 'shots-now/charm-pulled.png' });
    console.log(`  pulled ${last.label} (${last.hex}) -> shots-now/charm-pulled.png`);
  }
}
await b.close();
