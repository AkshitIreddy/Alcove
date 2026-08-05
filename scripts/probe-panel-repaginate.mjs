/**
 * scripts/probe-panel-repaginate.mjs — does opening a rail panel rewrite the
 * reader's book?
 *
 * The temporal review of the demo, frame 862: the card *"What a card is for"*
 * sits under "The stationery drawer" at the foot of the right page while the
 * "Customize this book" sheet is open, and at frame 863 it is GONE, leaving
 * bare ruled lines. It never comes back — frame 854 (panel closed) and frame
 * 912 (panel closed again) are the same layout minus that card, and the card
 * turns up as the first block of the NEXT page at frame 947.
 *
 * That is the pagination drain, and the drain is not cosmetic: it REMOVES
 * trailing blocks from one page's document and hands them to the next, and
 * nothing pulls them back. `styles/spread.css` and `views/spread.ts` both
 * promise in as many words that a sheet may never do this — the room a panel
 * leaves is answered with a TRANSFORM precisely so the leaf's layout box, and
 * therefore what fits on it, is untouched.
 *
 * `probe-panel-foot.mjs` already asks whether a block goes INVISIBLE during
 * the slide. This asks the other question, the permanent one: is the block
 * still in the document when the sheet has gone? Same defect in the demo,
 * opposite half of it.
 *
 * WHAT IT MEASURES. The right leaf is first packed to the pagination
 * contract's own boundary (typed lines until a carry fires, so the last block
 * sits against the foot exactly as the demo's card did — the Welcome pages
 * stop well short of it and a page with room to spare cannot demonstrate
 * losing its foot). Then, every animation frame across the panel opening and
 * closing again, it recomputes BOTH SIDES of the drain's own comparison
 * straight off the DOM:
 *
 *     capacity  = (paper.clientHeight − padding) × visualScale(paper)
 *     lastBottom + padBottom×visualScale(prose)  >  capacity   ⇒  peel
 *
 * so a run that loses a block also says which of the two numbers moved and by
 * how much. The verdict is the block count and text length of the leaf before
 * the sheet opened against after it closed: a page that lost ink to a colour
 * picker.
 *
 *   node scripts/probe-panel-repaginate.mjs [--url=…] [--panel=Customize]
 *                                           [--fill=14] [--out=qa/panel-drain]
 *                                           [--sabotage]
 *
 * `--sabotage` shrinks the capacity for real, mid-slide, by growing the prose
 * root's padding-bottom from the probe (nothing in src/ touched). A gate you
 * have not watched fail is not a gate; this one prints GATE ALIVE / GATE INERT
 * from whether that made a block leave the page.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = arg('url', 'http://localhost:1420');
const PANEL = arg('panel', 'Customize this book');
const SPREADS = arg("spreads", "1,2,3,4,5,6").split(",").map(Number);
const OUT = arg('out', 'qa/panel-drain');
const SABOTAGE = process.argv.includes('--sabotage');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
// The panel does not slide at all under reduced motion, and the slide is the
// whole window this exists to measure.
await page.emulateMedia({ reducedMotion: 'no-preference' });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
/* The dev server is shared with other agents; a hot reload mid-run restarts
   the book and would quietly describe two different builds. */
let booted = false;
const reloads = [];
page.on('framenavigated', (f) => {
  if (booted && f === page.mainFrame()) reloads.push(new Date().toISOString());
});

/* -------------------------------- boot ------------------------------------ */
await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, { polling: 400 });
await page.evaluate(async () => { await globalThis.__shelfWorld.ready; });
const skip = page.getByText('skip the tour');
if (await skip.count()) { await skip.first().click({ force: true }); await page.waitForTimeout(900); }
await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(5000);
booted = true;

/* ------------------- both sides of the drain's comparison ------------------ */
/**
 * Exactly what `BookView.measureCapacity` and `PageEditor.extractOverflow`
 * compute, off the same elements, so a frame that peels can be shown the
 * numbers that made it peel. Nothing here is a re-derivation of the intent —
 * it is the same arithmetic, transcribed.
 */
const READ = `(side) => {
  const paper = document.querySelector(
    '.nb-spread .nb-sheet-paper[data-side="' + side + '"]:not(.nb-export-sheet)'
  );
  if (paper === null) return null;
  const prose = paper.querySelector('.nb-prose');
  if (prose === null) return null;
  const vs = (drawn, layout) =>
    !isFinite(drawn) || !isFinite(layout) || layout <= 0 || drawn <= 0 ? 1 : drawn / layout;

  const ps = getComputedStyle(paper);
  const paperRect = paper.getBoundingClientRect();
  // BookView.measureCapacity — laid-out px, no scale, no drawn measurement.
  const laidOut =
    paper.clientHeight -
    (parseFloat(ps.paddingTop) || 0) -
    (parseFloat(ps.paddingBottom) || 0);
  const paperScale = vs(paperRect.height, paper.clientHeight);
  const capacity = Math.floor(laidOut);

  // PageEditor.extractOverflow — rect distances divided down to laid-out px,
  // padding taken as the computed (laid-out) number it already is.
  const rootRect = prose.getBoundingClientRect();
  const proseScale = vs(rootRect.height, prose.clientHeight);
  const pad = parseFloat(getComputedStyle(prose).paddingBottom) || 0;
  const padBottom = pad;
  const kids = [...prose.children];
  const bottoms = kids.map(
    (c) => (c.getBoundingClientRect().bottom - rootRect.top) / proseScale,
  );
  const last = bottoms.length ? bottoms[bottoms.length - 1] : 0;
  const pageEl = paper.querySelector('.nb-page');
  const pgs = pageEl === null ? null : getComputedStyle(pageEl);
  const editorEl = paper.querySelector('.nb-page-editor');
  const eds = editorEl === null ? null : getComputedStyle(editorEl);
  const r2 = (n) => Math.round(n * 100) / 100;

  return {
    blocks: kids.length,
    chars: (prose.textContent ?? '').trim().length,
    heads: kids.map((c) => (c.textContent ?? '').trim().slice(0, 30)),
    capacity, laidOut,
    paperScale: Math.round(paperScale * 10000) / 10000,
    proseScale: Math.round(proseScale * 10000) / 10000,
    padLayout: pad,
    padBottom: r2(padBottom),
    last: r2(last),
    // The drain's own predicate. True means: peel the tail off this page.
    over: last + padBottom > capacity,
    slack: r2(capacity - last - padBottom),
    // Everything above is already in laid-out px, which is the whole point:
    // this is the number that must not move when a transform scales the book
    // (views/spread.ts), so there is no second unit to convert back into.
    slackLayout: r2(capacity - last - padBottom),
    // The two reservations that can grow AFTER a page has been drained, with
    // no transaction and no capacity change to re-run it.
    footRail: (eds ?? pgs)?.getPropertyValue('--nb-footnote-rail') ?? '',
    backRail: pgs?.getPropertyValue('--nb-backlink-rail') ?? '',
    hasBacklinks: paper.querySelector('.nb-backlinks') !== null,
  };
}`;
const read = (side = 'right') => page.evaluate(`(${READ})('${side}')`);

const startSampler = () =>
  page.evaluate((src) => {
    const r = eval(src);
    globalThis.__S = [];
    globalThis.__on = true;
    const tick = () => {
      if (!globalThis.__on) return;
      globalThis.__S.push({
        t: Math.round(performance.now()),
        edge: document.documentElement.style.getPropertyValue('--nb-panel-edge'),
        R: r('right'),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, READ);
const stopSampler = () => page.evaluate(() => { globalThis.__on = false; return globalThis.__S; });

/* ------------------------------- the drive -------------------------------- */
const btnFor = (name) => page.locator(`.nb-rail button[aria-label^="${name}"]`).first();
const blur = () =>
  page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });

/*
 * THE HOTSPOT, NEVER A KEY. Arrow keys do not turn pages any more (the
 * owner's ruling, `views/spread.ts`'s header) — and two probes in this folder
 * still press ArrowRight and have therefore been measuring a book that never
 * turned. Turning a page is the outer-edge strip and the corner curl.
 */
const turn = async () => {
  await blur();
  await page.waitForTimeout(200);
  const hot = await page.locator('.nb-flip-hotspot-next').first().boundingBox();
  if (hot === null) throw new Error('no next hotspot — the book is not open');
  await page.mouse.click(hot.x + hot.width / 2, hot.y + hot.height / 2);
  await page.waitForTimeout(2400);
};

/**
 * Watch one leaf settle after it mounts.
 *
 * The reservation at the foot of a page — `--nb-footnote-rail` and
 * `--nb-backlink-rail`, both added to the prose root's padding-bottom by
 * editor.css — is not known when the page is first drained. The backlinks
 * query is asynchronous and the footnote rail measures itself only once it
 * exists. Either one growing after the drain leaves the page silently OVER
 * capacity with nothing scheduled to notice, which is the state a later panel
 * open turns into a missing block.
 */
const watchSettle = async (ms = 2600) => {
  const shots = [];
  const step = 120;
  for (let t = 0; t < ms; t += step) {
    shots.push({ t, R: await read('right') });
    await page.waitForTimeout(step);
  }
  return shots.filter((s) => s.R !== null);
};

const runs = [];
let at = 0;
for (const target of SPREADS) {
  while (at < target) { await turn(); at += 1; }
  await page.waitForTimeout(400);

  const settle = await watchSettle();
  const first = settle[0]?.R ?? null;
  const before = await read('right');
  if (before === null) { console.log(`  spread ${target}: no right leaf`); continue; }

  if ((await btnFor(PANEL).count()) === 0) {
    console.error(`FAIL: no rail button for "${PANEL}"`);
    await browser.close();
    process.exit(1);
  }

  await startSampler();
  await btnFor(PANEL).click({ force: true });
  if (SABOTAGE) {
    /*
     * A PANEL THAT REALLY DOES SHRINK THE LEAF — the exact thing the design
     * forbids and this gate exists to catch. The sheet's own tween is left
     * alone; the leaf's LAYOUT BOX is cut down while it is open and restored
     * when it closes, which is what "answer the room with a narrower leaf
     * instead of a transform" would have looked like.
     *
     * Two weaker sabotages did not bite and are worth recording. Padding
     * -bottom +160px was inside the page's own 195px of slack, so nothing
     * overflowed. +400px overflowed by 173px and STILL lost no block, because
     * the drain does not run on its own: it needs a transaction or a capacity
     * change to notice, and a probe writing an inline style is neither. Only a
     * real layout change reaches `capacityObserver`, and that is precisely why
     * it is the honest sabotage — it fails the way the defect failed.
     */
    await page.evaluate(() => {
      for (const paper of document.querySelectorAll('.nb-spread .nb-sheet-paper')) {
        if (paper instanceof HTMLElement) {
          paper.dataset.sabHeight = String(paper.clientHeight);
          paper.style.height = `${paper.clientHeight - 260}px`;
        }
      }
    });
  }
  await page.waitForTimeout(2000);
  const openFrames = await stopSampler();
  const settledOpen = await read('right');

  await page.waitForTimeout(300);
  await startSampler();
  await page.locator(`[aria-label^="Close ${PANEL}"]`).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(2000);
  const shutFrames = await stopSampler();
  if (SABOTAGE) {
    // The leaf goes back to full height with the sheet, exactly as a
    // layout-narrowing panel would have done — and the block does NOT come
    // back, because the contract only ever peels forward.
    await page.evaluate(() => {
      for (const paper of document.querySelectorAll('.nb-spread .nb-sheet-paper')) {
        if (paper instanceof HTMLElement) paper.style.height = '';
      }
    });
    await page.waitForTimeout(900);
  }
  const after = await read('right');

  runs.push({ spread: target, first, settle, before, settledOpen, after, openFrames, shutFrames });
  const lost = before.blocks - after.blocks;
  console.log(
    `  spread ${target}: ${before.blocks} blocks, slack ${String(before.slack).padStart(7)} ` +
      `(layout ${String(before.slackLayout).padStart(7)}), pad ${before.padLayout}` +
      `  →  open slack ${String(settledOpen?.slackLayout ?? '?').padStart(7)}` +
      `  →  ${lost > 0 ? `LOST ${lost} BLOCK(S)` : 'kept every block'}`,
  );
}

/* -------------------------------- report ---------------------------------- */
console.log('\n=== does the page settle over capacity after it mounts? ===');
for (const r of runs) {
  const pads = [...new Set(r.settle.map((s) => s.R.padLayout))];
  const slacks = r.settle.map((s) => s.R.slackLayout);
  const blocks = [...new Set(r.settle.map((s) => s.R.blocks))];
  console.log(
    `  spread ${r.spread}: pad ${JSON.stringify(pads)} · slack ${slacks[0]} → ` +
      `${slacks[slacks.length - 1]} · blocks ${JSON.stringify(blocks)} · ` +
      `backlinks ${r.before.hasBacklinks} ${r.before.backRail} · foot ${r.before.footRail}`,
  );
}

console.log('\n=== how much does the sheet change what fits? (LAYOUT px) ===');
for (const r of runs) {
  const closed = r.before.slackLayout;
  const open = r.settledOpen?.slackLayout ?? NaN;
  console.log(
    `  spread ${r.spread}: closed ${String(closed).padStart(8)} · open ${String(open).padStart(8)} · ` +
      `Δ ${String(Math.round((open - closed) * 100) / 100).padStart(7)}  ` +
      `(scale ${r.before.paperScale} → ${r.settledOpen?.paperScale})`,
  );
}

writeFileSync(join(OUT, 'runs.json'), JSON.stringify(runs, null, 1));

const losers = runs.filter((r) => r.before.blocks - r.after.blocks > 0);
const drift = runs
  .map((r) => Math.abs((r.settledOpen?.slackLayout ?? r.before.slackLayout) - r.before.slackLayout))
  .reduce((a, b) => Math.max(a, b), 0);

console.log('\n================ VERDICT ================');
for (const r of runs) {
  console.log(
    `  spread ${r.spread}: ${r.before.blocks} blocks / ${r.before.chars} chars before the sheet, ` +
      `${r.settledOpen?.blocks ?? '?'} while open, ${r.after.blocks} / ${r.after.chars} after it closed`,
  );
}
console.log(
  losers.length > 0
    ? `A PANEL REWROTE THE BOOK on ${losers.length} of ${runs.length} spreads: ` +
        losers
          .map((r) => `spread ${r.spread} lost ${JSON.stringify(
            r.before.heads.filter((h) => !r.after.heads.includes(h)),
          )}`)
          .join('; ')
    : `no block left a page: the sheet cost the document nothing on ${runs.length} spreads.`,
);
console.log(
  `worst drift in what fits, opening the sheet: ${Math.round(drift * 100) / 100}px of layout ` +
    `(must be 0 — views/spread.ts: "the leaf's layout box, and therefore what fits, is untouched")`,
);
if (SABOTAGE) {
  // BOTH assertions have to bite, or half the gate is asleep.
  const alive = losers.length > 0 && drift > 1;
  console.log(
    alive
      ? 'GATE ALIVE'
      : `GATE INERT (blocks lost ${losers.length}, drift ${Math.round(drift * 100) / 100}px)`,
  );
}
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
if (reloads.length) console.log(`WARNING: page reloaded ${reloads.length}x mid-run — re-run before trusting this`);
await browser.close();
process.exit(!SABOTAGE && (losers.length > 0 || drift > 0.001) ? 1 : 0);
