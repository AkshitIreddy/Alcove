/**
 * scripts/probe-panel-keys.mjs — who owns the arrow keys while a panel is out.
 *
 * `ShelfWorld` binds arrows / Home / Enter on `document` (world.ts, "Keyboard
 * shelf nav"). While a panel is up those keys belong to the panel, and the
 * shelf stands down by reading `data-nb-panel="open"` off <html>. The flag was
 * written in exactly one place — `claimPanelPush`, called by exactly one
 * component, `RailPanel` — so every panel that is NOT a RailPanel drove the
 * shelf behind it while claiming, in a code comment, to be covered.
 *
 * This probe asks the applied side rather than the source: it puts the shelf's
 * keyboard selection somewhere known, opens a panel, presses ArrowDown, and
 * reads `__shelfWorld.keyboardSelection` back. If the selection moved, the
 * shelf ate a key that was meant for the panel.
 *
 * The reading comes off `__shelfWorld` — the world's own live instance, handed
 * out by world.ts under `?fx=force` — never off a store this probe imported:
 * a probe's own `import('/src/…')` can resolve to a second copy of the module
 * on a dev server that has served HMR updates.
 *
 * Usage: node scripts/probe-panel-keys.mjs [--url=http://localhost:1420]
 *        node scripts/probe-panel-keys.mjs --shots   (writes qa/ui/panelkeys-*)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const SHOTS = args.includes('--shots');

if (SHOTS) mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const errors = new Map();
page.on('pageerror', (e) => {
  const k = e.message.split('\n')[0];
  errors.set(k, (errors.get(k) ?? 0) + 1);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const k = `console ${m.text().split('\n')[0]}`;
    errors.set(k, (errors.get(k) ?? 0) + 1);
  }
});

const poll = async (fn, timeout = 90000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${label}`);
    await page.waitForTimeout(250);
  }
};

/* ---- boot ---------------------------------------------------------------- */

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfWorld !== undefined, 120000, 'the world bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y list');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
await page.evaluate(() =>
  globalThis.__shelfSeedBooks(['Cell Biology', 'Kanji Practice', 'Watercolor Basics'], 0),
);
await page.waitForTimeout(1500);

/* ---- the reading ---------------------------------------------------------- */

/** Everything the shelf's own keyboard can move, in one object. */
const shelfState = () =>
  page.evaluate(() => ({
    sel: JSON.stringify(globalThis.__shelfWorld.keyboardSelection),
    floor: globalThis.__shelfWorld.centerFloor,
    flag: document.documentElement.dataset.nbPanel ?? null,
  }));

/**
 * Park the selection on floor 0 with nothing open, so every surface below
 * starts from the same place and ArrowDown has somewhere to go.
 */
async function parkSelection() {
  await page.keyboard.press('Home');
  await page.waitForTimeout(250);
}

const results = [];

/**
 * @param {string} name    what the reader would call this surface
 * @param {() => Promise<void>} open
 * @param {string} selector  proof it is really on screen
 * @param {() => Promise<void>} close
 * @param {boolean} expectLeak  what the probe found BEFORE the fix
 */
async function surface(name, open, selector, close) {
  process.stdout.write(`\n${name}\n`);
  await parkSelection();
  await open();
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
  } catch {
    // A surface the probe could not reach is a finding, not a crash — the
    // remaining panels still have to be measured in the same run.
    console.log(`  UNREACHABLE — ${selector} never appeared`);
    results.push({ name, leaked: false, stuck: false, unreachable: true, flag: null });
    return;
  }
  await page.waitForTimeout(700);
  const before = await shelfState();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  const after = await shelfState();
  const leaked = before.sel !== after.sel || before.floor !== after.floor;
  console.log(`  flag on <html>: ${before.flag ?? '(none)'}`);
  console.log(`  selection      ${before.sel} -> ${after.sel}`);
  console.log(`  centre floor   ${before.floor.toFixed(2)} -> ${after.floor.toFixed(2)}`);
  console.log(`  ${leaked ? 'LEAKS — the shelf moved underneath' : 'held — the panel kept its keys'}`);
  if (SHOTS) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `qa/ui/panelkeys-${slug}.png` });
  }

  // The other half, and the one a claim-only fix gets wrong: a guard that
  // never lets go is a shelf whose arrows are dead for the rest of the session.
  await close();
  await page.waitForTimeout(900);
  const shut = await shelfState();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(350);
  const back = await shelfState();
  const returned = shut.sel !== back.sel;
  console.log(`  after closing  flag ${shut.flag ?? '(none)'}, ${shut.sel} -> ${back.sel}`);
  console.log(`  ${returned ? 'and the world has its keys back' : 'STUCK — the shelf never got the arrows back'}`);

  results.push({ name, leaked, stuck: !returned, flag: before.flag });
}

/* ---- control: with nothing open the shelf MUST answer the arrows ---------- */

console.log('\n=== control: nothing open ===');
await parkSelection();
const c0 = await shelfState();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(350);
const c1 = await shelfState();
const controlMoves = c0.sel !== c1.sel;
console.log(`  selection ${c0.sel} -> ${c1.sel}`);
console.log(`  ${controlMoves ? 'ok — the probe can see the shelf move' : 'BROKEN PROBE — the shelf never moves'}`);

/* ---- every panel a reader can open while standing at the shelf ------------ */

console.log('\n=== panels reachable from the shelf ===');

await surface(
  'Library studio (RailPanel — the one the guard was written for)',
  () => page.locator('[data-shelf-dock="studio"]').click(),
  '.nb-library-studio',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Trash drawer',
  () => page.locator('[data-shelf-dock="trash"]').click(),
  '.shelf-trash',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Templates gallery',
  () => page.locator('[data-shelf-dock="templates"]').click(),
  '.nb-tpl-gallery',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Settings sheet',
  () => page.locator('.nbs-gear-button').click(),
  '.nbs-sheet',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Keyboard cheat sheet',
  () => page.keyboard.press('?'),
  '.nb-cheat-card',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Quick switcher',
  () => page.keyboard.press('Control+k'),
  '.nb-qs-bar',
  () => page.keyboard.press('Escape'),
);

await surface(
  'Shelf context menu',
  async () => {
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  },
  '.shelf-menu',
  () => page.keyboard.press('Escape'),
);

/* ---- the book's side ------------------------------------------------------
 *
 * The item that opened this named the TOC next to the trash. It reads as the
 * same species of hole and is not one, for two independent reasons — and both
 * had to be checked rather than argued, because "it is fine, probably" is how
 * the trash got its comment in the first place:
 *
 *   1. the TOC IS a RailPanel, so it has always claimed;
 *   2. the shelf world is torn down when a book opens, so the listener that
 *      would eat its arrows is not even installed.
 *
 * Below is that, measured.
 */

console.log('\n=== the book view ===');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  app.appState.openBook(list[0].id);
});
await page.waitForSelector('.nb-rail', { timeout: 60000 });
await page.waitForTimeout(2200);

const worldGone = await page.evaluate(
  () => document.querySelector('.shelf-dock') === null,
);
console.log(`  shelf chrome unmounted with the book open: ${worldGone}`);

const tocButton = page.locator('.nb-rail-button[data-tool="toc"]');
let tocFlag = null;
if (await tocButton.count()) {
  await tocButton.click();
  try {
    await page.waitForSelector('.nb-rail-panel[aria-hidden="false"]', { timeout: 8000 });
  } catch {
    await tocButton.click();
    await page.waitForSelector('.nb-rail-panel[aria-hidden="false"]', { timeout: 8000 });
  }
  await page.waitForTimeout(1200);
  tocFlag = await page.evaluate(() => document.documentElement.dataset.nbPanel ?? null);
  console.log(`  table of contents open, flag on <html>: ${tocFlag ?? '(none)'}`);
  if (SHOTS) await page.screenshot({ path: 'qa/ui/panelkeys-toc.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const afterFlag = await page.evaluate(
    () => document.documentElement.dataset.nbPanel ?? null,
  );
  console.log(`  closed again, flag on <html>: ${afterFlag ?? '(none)'}`);
  if (afterFlag !== null) tocFlag = null; // a flag that never clears is a fail
} else {
  console.log('  no TOC tool in this build — skipped');
}

/* ---- verdict -------------------------------------------------------------- */

console.log('\n=== verdict ===');
for (const r of results) {
  const verdict = r.unreachable ? 'n/a  ' : r.leaked ? 'LEAK ' : r.stuck ? 'STUCK' : 'held ';
  console.log(`  ${verdict} ${r.flag === 'open' ? '[flag]' : '[    ]'} ${r.name}`);
}
const leaks = results.filter((r) => r.leaked);
const stuck = results.filter((r) => r.stuck && !r.unreachable);
const seen = results.filter((r) => !r.unreachable);
console.log(`\n  ${leaks.length} of ${seen.length} panels let the shelf keep the arrows`);
console.log(`  ${stuck.length} of ${seen.length} failed to hand them back on close`);
console.log(`  table of contents: ${tocFlag === 'open' ? 'claims and releases' : 'DID NOT CLAIM'}`);

console.log('\n=== page errors ===');
if (errors.size === 0) console.log('none');
else for (const [k, n] of errors) console.log(`  x${n}  ${k}`);

await browser.close();
const clean =
  controlMoves &&
  leaks.length === 0 &&
  stuck.length === 0 &&
  tocFlag === 'open' &&
  errors.size === 0;
process.exit(clean ? 0 : 1);
