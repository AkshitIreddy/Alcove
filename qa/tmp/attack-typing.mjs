/**
 * attack-typing.mjs — adversarial typing probe.
 *
 * Modes:
 *   end   — turn to the LAST spread, type past the foot of the last page
 *           (forces carryOverflow's `await appendPage()` branch), gap 0.
 *   fast  — type at the foot of page 1 with zero gap, many lines (cascade).
 *   paste — dispatch a real paste of a huge multi-paragraph block.
 *   undo  — type past a page break, then Ctrl+Z / Ctrl+Shift+Z across it.
 *
 * Every mode ends the same way: read the STORED rows out of the stub DB blob
 * (the thing a reload would find), then actually RELOAD and re-open the book
 * and read the text back off the screen. Anything typed, seen on screen, and
 * absent from both is a lost keystroke.
 */
import { chromium } from 'playwright';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const URL_BASE = arg('url', 'http://localhost:1420');
const MODE = arg('mode', 'fast');
const LINES = Number(arg('lines', 40));
const GAP = Number(arg('gap', 0));
const RUN = Date.now().toString(36).slice(-4).toUpperCase();
const marker = (i) => `ZQ${RUN}L${String(i).padStart(3, '0')}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const openBook = async () => {
  await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
  await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
  const skip = page.getByText('skip the tour');
  if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
  const id = await page.evaluate(() => {
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
    if (w) globalThis.__shelfPullOut(w.id);
    return w ? w.id : null;
  });
  if (!id) throw new Error('no book on the shelf');
  await page.waitForSelector('.pulled-book', { timeout: 30_000 });
  await page.waitForTimeout(1600);
  const cover = await page.locator('.pulled-book').first().boundingBox();
  if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await page.waitForSelector('.nb-prose', { timeout: 60_000 });
  await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
  await page.waitForTimeout(5000);
  return id;
};

const bookId = await openBook();

const readStored = async () =>
  page.evaluate((id) => {
    try {
      const blob = JSON.parse(localStorage.getItem('notebook.stubdb.v1') ?? '{}');
      return (blob.pages ?? [])
        .filter((r) => r.book_id === id)
        .sort((a, b) => a.ord - b.ord)
        .map((r) => String(r.doc_json ?? ''));
    } catch { return []; }
  }, bookId);

const spreadNow = () =>
  page.evaluate(() => Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1));

const placeCaretEndOf = async (side) => {
  const anchor = await page.evaluate((s) => {
    const prose = document.querySelector(`.nb-spread .nb-sheet-paper[data-side="${s}"] .nb-prose`);
    const last = prose?.lastElementChild;
    if (!last) return null;
    const r = last.getBoundingClientRect();
    return { x: r.left + Math.min(r.width - 4, 40), y: r.top + r.height / 2 };
  }, side);
  if (!anchor) return false;
  await page.mouse.click(anchor.x, anchor.y);
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(300);
  return true;
};

// ---------------------------------------------------------------- navigation
if (MODE === 'end') {
  // Turn to the last spread with real ArrowRight presses.
  let guard = 0;
  for (;;) {
    const pagesNow = (await readStored()).length;
    const cur = await spreadNow();
    const lastSpread = Math.ceil(pagesNow / 2) - 1;
    if (cur >= lastSpread || guard++ > 40) break;
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1400);
  }
  console.log(`  navigated to spread ${await spreadNow()} of ${(await readStored()).length} pages`);
}

const before = await readStored();
console.log(`mode=${MODE} lines=${LINES} gap=${GAP} — book has ${before.length} pages\n`);

// Which leaf to type into: last spread's right leaf may be bare, so prefer a
// leaf that actually holds text.
let side = 'left';
if (MODE === 'end') {
  const rightHas = await page.evaluate(() => {
    const p = document.querySelector('.nb-spread .nb-sheet-paper[data-side="right"] .nb-prose');
    return !!p && (p.innerText ?? '').trim().length > 0;
  });
  side = rightHas ? 'right' : 'left';
}
if (!(await placeCaretEndOf(side))) {
  console.error('FAIL: no text on the chosen leaf to place a caret in');
  await browser.close();
  process.exit(1);
}
console.log(`  caret placed at the end of the ${side} leaf`);

const landed = [];
const carries = [];
let vanishedAt = null;
let spread = await spreadNow();

const typeLines = async (from, to) => {
  for (let i = from; i <= to; i += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(marker(i));
    if (GAP) await page.waitForTimeout(GAP);
    const now = await page.evaluate(
      (m) => ({
        seen: (document.querySelector('.nb-spread-stage')?.innerText ?? '').includes(m),
        spread: Number(document.querySelector('.nb-spread-stage')?.getAttribute('data-spread-index') ?? -1),
      }),
      marker(i),
    );
    if (now.seen) landed.push(i);
    if (spread >= 0 && now.spread !== spread) carries.push(`${marker(i)}: spread ${spread} -> ${now.spread}`);
    if (now.spread < 0) vanishedAt = vanishedAt ?? marker(i);
    spread = now.spread;
  }
};

if (MODE === 'paste') {
  // A real paste event carrying LINES paragraphs, straight into ProseMirror.
  const text = Array.from({ length: LINES }, (_, i) => marker(i + 1)).join('\n\n');
  await page.keyboard.press('Enter');
  await page.evaluate((t) => {
    const el = document.activeElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await page.waitForTimeout(2500);
  const seen = await page.evaluate(() => document.querySelector('.nb-spread-stage')?.innerText ?? '');
  for (let i = 1; i <= LINES; i += 1) if (seen.includes(marker(i))) landed.push(i);
  const s2 = await spreadNow();
  if (s2 !== spread) carries.push(`paste: spread ${spread} -> ${s2}`);
} else if (MODE === 'undo') {
  await typeLines(1, LINES);
  await page.waitForTimeout(1500);
  const beforeUndo = await page.evaluate(() => document.querySelector('.nb-spread-stage')?.innerText ?? '');
  console.log(`  before undo, on screen: ${[...Array(LINES)].filter((_, i) => beforeUndo.includes(marker(i + 1))).length} of ${LINES}`);
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Control+z'); await page.waitForTimeout(120); }
  await page.waitForTimeout(1500);
  const afterUndo = await page.evaluate(() => document.querySelector('.nb-spread-stage')?.innerText ?? '');
  console.log(`  after 12x undo, on screen: ${[...Array(LINES)].filter((_, i) => afterUndo.includes(marker(i + 1))).length} of ${LINES}`);
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(120); }
  await page.waitForTimeout(2000);
  const afterRedo = await page.evaluate(() => document.querySelector('.nb-spread-stage')?.innerText ?? '');
  for (let i = 1; i <= LINES; i += 1) if (afterRedo.includes(marker(i))) landed.push(i);
  console.log(`  after 12x redo, on screen: ${landed.length} of ${LINES}`);
} else {
  await typeLines(1, LINES);
}

if (vanishedAt) console.log(`  the book view VANISHED while typing, at ${vanishedAt}`);
console.log(`  typed and visible on screen: ${landed.length} of ${LINES}`);
console.log(`  spread changes during typing: ${carries.length}`);
for (const c of carries) console.log(`     ${c}`);

const missingOf = (docs) => {
  const all = docs.join('\n');
  const miss = [];
  for (let i = 1; i <= LINES; i += 1) if (!all.includes(marker(i))) miss.push(marker(i));
  return miss;
};

await page.waitForTimeout(9000);
const idle = await readStored();
const mIdle = missingOf(idle);
console.log(`\n  after 9s idle : ${LINES - mIdle.length} of ${LINES} stored (${idle.length} pages)`);
if (mIdle.length) console.log(`     missing: ${mIdle.join(' ')}`);

try { await page.locator('.nb-back-button').first().click({ force: true, timeout: 8000 }); }
catch { console.log('  (no back button — the book view is already gone)'); }
await page.waitForTimeout(3500);
const closed = await readStored();
const mClosed = missingOf(closed);
console.log(`  after close   : ${LINES - mClosed.length} of ${LINES} stored (${closed.length} pages)`);
if (mClosed.length) console.log(`     missing: ${mClosed.join(' ')}`);

// The reload test: what the app itself shows after a restart.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const reloaded = await readStored();
const mReload = missingOf(reloaded);
console.log(`  after reload  : ${LINES - mReload.length} of ${LINES} stored (${reloaded.length} pages)`);
if (mReload.length) console.log(`     missing: ${mReload.join(' ')}`);

// Duplication, while we are here: markers stored on more than one page.
const dup = [];
for (let i = 1; i <= LINES; i += 1) {
  const n = reloaded.filter((d) => d.includes(marker(i))).length;
  if (n > 1) dup.push(`${marker(i)} x${n}`);
}
console.log(`  markers on more than one page: ${dup.length}${dup.length ? ' — ' + dup.slice(0, 10).join(' ') : ''}`);

console.log('\n--- verdict ---');
console.log(`  typed              : ${LINES}`);
console.log(`  reached the screen : ${landed.length}`);
console.log(`  reached storage    : ${LINES - mReload.length}`);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
const lostTyped = landed.filter((i) => mReload.includes(marker(i)));
console.log(`  ON SCREEN BUT NOT STORED: ${lostTyped.length}${lostTyped.length ? ' — ' + lostTyped.map(marker).join(' ') : ''}`);
await browser.close();
process.exit(mReload.length > 0 || vanishedAt !== null ? 1 : 0);
