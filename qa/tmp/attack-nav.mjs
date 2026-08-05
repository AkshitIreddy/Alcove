/**
 * attack-nav.mjs — NAVIGATION AND FOCUS attack on the pagination publish fix.
 *
 * Six hostile navigation shapes, each measured for: spread jump (delta != 1),
 * blank leaf on screen, document.activeElement, page count, stored page count.
 *
 * Fresh browser context each run => fresh localStorage => freshly seeded book.
 */
import { chromium } from 'playwright';

const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://localhost:1420';
const LABEL = process.argv.find((a) => a.startsWith('--label='))?.slice(8) ?? 'run';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

const problems = [];
const note = (s) => { problems.push(s); console.log(`   !! ${s}`); };

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }

/** Everything worth knowing about where the reader is standing. */
const state = async () =>
  page.evaluate(() => {
    const stage = document.querySelector('.nb-spread-stage');
    const el = document.activeElement;
    const cls = el instanceof Element ? (el.getAttribute('class') ?? '') : '';
    const leaves = [...document.querySelectorAll('.nb-leaf-paper')].map((p) => {
      const ed = p.querySelector('.nb-prose');
      const bare = p.querySelector('.nb-leaf-blank') !== null;
      const text = ed ? (ed.textContent ?? '').trim() : '';
      return {
        side: p.getAttribute('data-side'),
        bare,
        hasEditor: ed !== null,
        chars: text.length,
      };
    });
    return {
      index: stage ? Number(stage.getAttribute('data-spread-index')) : -1,
      inBook: document.querySelector('.nb-book-view') !== null,
      tag: el ? el.tagName.toLowerCase() : 'null',
      cls: cls.slice(0, 48),
      inProse: el instanceof Element && el.closest('.ProseMirror') !== null,
      leaves,
    };
  });

const fmtLeaves = (leaves) =>
  leaves
    .map((l) => `${l.side}:${l.bare ? 'BARE' : l.hasEditor ? `page(${l.chars}c)` : 'none'}`)
    .join(' ');

const show = (tag, s) =>
  console.log(
    `   ${tag} spread=${s.index} focus=<${s.tag}> ${s.cls || '(no class)'}` +
      `${s.inProse ? ' [IN-PROSE]' : ''}  ${fmtLeaves(s.leaves)}`,
  );

/** Pages as stored — the DOM is not the database. */
const stored = async () =>
  page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pagesMod = await import('/src/data/pages.ts');
    const list = await books.listBooksByFloorRange(0, 20);
    const welcome = list.find((b) => /welcome/i.test(b.title)) ?? list[0];
    const pgs = await pagesMod.listPages(welcome.id);
    const textOf = (n) => {
      if (n === null || typeof n !== 'object') return '';
      if (typeof n.text === 'string') return n.text;
      return (n.content ?? []).map(textOf).join('');
    };
    const blocks = pgs.map((pg) => (pg.doc?.content ?? []).map((b) => textOf(b).trim()).filter((t) => t.length > 8));
    const where = new Map();
    blocks.forEach((bs, i) => {
      for (const t of new Set(bs)) {
        if (!where.has(t)) where.set(t, []);
        where.get(t).push(i);
      }
    });
    const across = [...where.entries()].filter(([, ps]) => ps.length > 1);
    let within = 0;
    for (const bs of blocks) { const seen = new Set(); for (const t of bs) { if (seen.has(t)) within += 1; seen.add(t); } }
    return {
      count: pgs.length,
      blocks: blocks.reduce((n, b) => n + b.length, 0),
      across: across.length,
      acrossSample: across.slice(0, 3).map(([t, ps]) => `${ps.join(',')}: "${t.slice(0, 50)}"`),
      within,
    };
  });

console.log(`\n########## ${LABEL} ##########`);
const before = await stored();
console.log(`stored before opening: ${before.count} pages, ${before.blocks} blocks, dup-across=${before.across}, dup-within=${before.within}`);

// ---------------------------------------------------------------- open ------
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  const books = await import('/src/data/books.ts');
  const list = await books.listBooksByFloorRange(0, 20);
  const welcome = list.find((x) => /welcome/i.test(x.title)) ?? list[0];
  app.appState.openBook(welcome.id);
});
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForSelector('.nb-spread-stage', { timeout: 60_000 });
await page.waitForTimeout(6000);

console.log('\n--- A. opened ---');
let s = await state();
show('open  ', s);
if (s.index !== 0) note(`A: opened at spread ${s.index}, not 0`);
if (s.leaves.some((l) => l.bare)) note(`A: bare leaf on the opening spread — ${fmtLeaves(s.leaves)}`);
if (s.inProse) note('A: focus is inside a ProseMirror on open');

// -------------------------------------------------------- B. fast turns ----
console.log('\n--- B. FAST turns: 12x ArrowRight at 120ms, faster than the flip ---');
let prev = s.index;
const bDeltas = [];
for (let i = 1; i <= 12; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const now = await state();
  const d = now.index - prev;
  bDeltas.push(d);
  if (d > 1) note(`B: press ${i} JUMPED ${prev} -> ${now.index} (delta ${d})`);
  if (d < 0) note(`B: press ${i} went BACKWARDS ${prev} -> ${now.index}`);
  if (now.inProse) note(`B: press ${i} focus captured by ${now.cls}`);
  prev = now.index;
}
await page.waitForTimeout(6000);
s = await state();
show('settle', s);
if (s.leaves.some((l) => l.bare)) note(`B: bare leaf after fast turns — ${fmtLeaves(s.leaves)}`);
if (s.leaves.some((l) => l.hasEditor && l.chars === 0)) note(`B: EMPTY editor leaf after fast turns — ${fmtLeaves(s.leaves)}`);
if (s.inProse) note(`B: focus ended inside a ProseMirror (${s.cls}) — arrows are dead`);
console.log(`   deltas: [${bDeltas.join(',')}]  net ${bDeltas.reduce((a, b) => a + b, 0)} over 12 presses`);
const afterB = await stored();
console.log(`   stored: ${afterB.count} pages, ${afterB.blocks} blocks, dup-across=${afterB.across}, dup-within=${afterB.within}`);
if (afterB.across > before.across) note(`B: duplication across pages ${before.across} -> ${afterB.across}: ${afterB.acrossSample.join(' | ')}`);

// ------------------------------------------------------- C. end of book ----
console.log('\n--- C. turn to the END and keep pressing ---');
let last = s.index;
let stuckFor = 0;
for (let i = 0; i < 40 && stuckFor < 4; i += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1400);
  const now = await state();
  if (now.index === last) stuckFor += 1; else stuckFor = 0;
  if (now.index - last > 1) note(`C: press ${i} JUMPED ${last} -> ${now.index}`);
  last = now.index;
}
await page.waitForTimeout(4000);
s = await state();
show('end   ', s);
if (s.inProse) note(`C: focus captured at the end of the book (${s.cls})`);
const endStored = await stored();
console.log(`   stored at end: ${endStored.count} pages, ${endStored.blocks} blocks, dup-across=${endStored.across}, dup-within=${endStored.within}`);
if (endStored.across > before.across) note(`C: duplication across pages ${before.across} -> ${endStored.across}: ${endStored.acrossSample.join(' | ')}`);
// The right leaf of the last spread being bare is documented as intended.
// A BARE LEFT leaf is not.
if (s.leaves.some((l) => l.side === 'left' && l.bare)) note(`C: LEFT leaf is bare at the end — ${fmtLeaves(s.leaves)}`);

// keyboard still alive?
const beforeBack = s.index;
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(2000);
s = await state();
if (s.index >= beforeBack) note(`C: ArrowLeft did not go back (${beforeBack} -> ${s.index}) — keyboard lost`);
show('back  ', s);

// ------------------------------------------------- D. turn while a panel ----
console.log('\n--- D. turn WHILE a rail panel opens ---');
// back to the front of the book first
for (let i = 0; i < 30 && s.index > 0; i += 1) {
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(700);
  s = await state();
}
await page.waitForTimeout(2500);
show('front ', s);
const railButtons = await page.locator('.nb-rail button, .nb-rail-btn, [class*="rail"] button').all();
console.log(`   rail buttons found: ${railButtons.length}`);
let dPrev = (await state()).index;
for (let i = 0; i < Math.min(4, railButtons.length); i += 1) {
  try { await railButtons[i].click({ force: true, timeout: 3000 }); } catch { continue; }
  await page.waitForTimeout(40);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
  const now = await state();
  const d = now.index - dPrev;
  console.log(`   panel ${i}: spread ${dPrev} -> ${now.index} (delta ${d}) focus <${now.tag}> ${now.cls || '-'}${now.inProse ? ' [IN-PROSE]' : ''}  ${fmtLeaves(now.leaves)}`);
  if (d > 1) note(`D: panel ${i} JUMPED ${dPrev} -> ${now.index}`);
  if (now.leaves.some((l) => l.bare)) note(`D: panel ${i} left a bare leaf — ${fmtLeaves(now.leaves)}`);
  if (now.inProse) note(`D: panel ${i} focus captured (${now.cls})`);
  dPrev = now.index;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ---------------------------------------------- E. close + reopen (switcher)-
console.log('\n--- E. close the book and reopen from the quick switcher ---');
await page.evaluate(async () => {
  const app = await import('/src/state/app.ts');
  app.appState.closeBook();
});
await page.waitForTimeout(2500);
let sh = await state();
console.log(`   after close: inBook=${sh.inBook} focus=<${sh.tag}> ${sh.cls || '-'}`);
await page.keyboard.press('Control+k');
await page.waitForTimeout(1200);
await page.keyboard.type('welcome', { delay: 60 });
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(9000);
s = await state();
show('reopen', s);
if (!s.inBook) note('E: quick switcher did not reopen the book');
if (s.index !== 0) note(`E: reopened at spread ${s.index}, not 0`);
if (s.leaves.some((l) => l.bare)) note(`E: bare leaf after reopen — ${fmtLeaves(s.leaves)}`);
if (s.leaves.some((l) => l.hasEditor && l.chars === 0)) note(`E: EMPTY editor leaf after reopen — ${fmtLeaves(s.leaves)}`);
if (s.inProse) note(`E: focus captured after reopen (${s.cls})`);
const reopenStored = await stored();
console.log(`   stored after reopen: ${reopenStored.count} pages, ${reopenStored.blocks} blocks, dup-across=${reopenStored.across}, dup-within=${reopenStored.within}`);
if (reopenStored.across > before.across) note(`E: duplication across pages ${before.across} -> ${reopenStored.across}: ${reopenStored.acrossSample.join(' | ')}`);

// keyboard alive after reopen?
const rPrev = s.index;
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2600);
s = await state();
if (s.index === rPrev) note(`E: ArrowRight dead after reopen (still spread ${s.index})`);
show('r+turn', s);

// --------------------------------------------------------- F. corner drag ---
console.log('\n--- F. corner drag ---');
const box = await page.locator('.nb-spread-stage').first().boundingBox();
if (box) {
  const fPrev = (await state()).index;
  const sx = box.x + box.width - 24;
  const sy = box.y + box.height - 40;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(sx - (box.width * 0.9 * i) / 12, sy - (i * 4));
    await page.waitForTimeout(35);
  }
  await page.mouse.up();
  await page.waitForTimeout(3500);
  s = await state();
  show('drag  ', s);
  const d = s.index - fPrev;
  if (d > 1) note(`F: corner drag JUMPED ${fPrev} -> ${s.index}`);
  if (d === 0) console.log(`   (drag did not turn: ${fPrev} -> ${s.index})`);
  if (s.leaves.some((l) => l.bare)) note(`F: bare leaf after corner drag — ${fmtLeaves(s.leaves)}`);
  if (s.inProse) note(`F: focus captured after corner drag (${s.cls})`);
  // keyboard alive?
  const kPrev = s.index;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2600);
  s = await state();
  if (s.index === kPrev) note(`F: ArrowRight dead after corner drag (still ${s.index})`);
  show('f+turn', s);
} else {
  console.log('   no stage box');
}

// ------------------------------------------------------------------ done ---
const final = await stored();
console.log(`\nstored FINAL: ${final.count} pages, ${final.blocks} blocks, dup-across=${final.across}, dup-within=${final.within}`);
if (final.across > before.across) console.log(`   sample: ${final.acrossSample.join(' | ')}`);
console.log(`page-count drift: ${before.count} -> ${final.count}`);
console.log('page errors:', errors.length ? errors.slice(0, 5) : 'none');
console.log(`\n=== ${LABEL}: ${problems.length} problem(s) ===`);
for (const p of problems) console.log(`  - ${p}`);
await browser.close();
process.exit(0);
