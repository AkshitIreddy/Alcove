/**
 * scripts/probe-footnote-overprint.mjs — is the footnote at the foot of a page
 * printed UNDER whatever block happens to be standing there? (Frame 778 of the
 * first demo recording: the note running beneath a callout card and its wash.)
 *
 * The rail is `position: absolute` at the foot of `.nb-page-editor`, so it can
 * never push anything out of its way; the only thing that keeps prose off it is
 * the padding-bottom the overflow drain re-reads on every pass. So the question
 * is geometric and needs no theory: for every leaf showing a rail, take the
 * rail's top edge and ask which top-level blocks have ink below it.
 *
 * TWO THINGS THIS PROBE HAD TO LEARN, and both of them are why the number it
 * prints can be trusted:
 *
 *  - `.nb-export-sheet` also wears `.nb-leaf-paper` — deliberately, so every
 *    `.nb-spread …` rule reaches the export capture's staging sheet
 *    (src/editor/script/exporters/capture.ts). That sheet holds a whole
 *    UNDRAINED document and lives at left:-12000px. Counted as a leaf it
 *    reports fifty-three blocks and six thousand pixels of overprint on a page
 *    the reader is seeing seven blocks of, which is a picture of nothing.
 *  - A walk that measures no rail at all must not be allowed to say CLEAR. The
 *    footnote page is one page of a thirty-odd page book and a blind arrow walk
 *    reached it on some runs and not others, so the page is navigated to BY
 *    NAME through the quick switcher, and a run that never saw a rail reports
 *    INCONCLUSIVE.
 *
 * Usage: node scripts/probe-footnote-overprint.mjs [outDir] [--size=WxH]
 *                                                  [--turns=N] [--sabotage]
 *
 * `--sabotage` blanks the rail out of the prose's padding-bottom — the reader's
 * whole protection — so the check can be watched going red before it is
 * believed going green.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ??
  fallback;

const outDir = process.argv[2]?.startsWith('--')
  ? 'qa/tmp/footnote-overprint'
  : (process.argv[2] ?? 'qa/tmp/footnote-overprint');
const URL_BASE = arg('url', 'http://localhost:1420');
const TURNS = Number(arg('turns', 6));
// The demo was recorded at 1600x1000 (its frames are that, scaled) and that is
// the window the page budget was calibrated against — but a smaller window is
// the harder case for the same defect, so the size is an argument.
const [VW, VH] = arg('size', '1600x1000').split('x').map(Number);
const SABOTAGE = process.argv.includes('--sabotage');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
});
const page = await browser.newPage({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 1,
});
await page.emulateMedia({ reducedMotion: 'no-preference' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));

if (SABOTAGE) {
  // The one line of editor.css that stands between a note and the block above
  // it. Injected as a later, more specific rule so it wins outright.
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent =
        '.nb-spread .nb-page-editor .ProseMirror.nb-prose' +
        '{padding-bottom:var(--space-32) !important}';
      document.head.appendChild(style);
    });
  });
}

await page.goto(`${URL_BASE}/?fx=force&dev=0`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
  polling: 400,
  timeout: 90_000,
});
await page.evaluate(async () => {
  await globalThis.__shelfWorld.ready;
});
const skip = page.getByText('skip the tour');
if (await skip.count()) {
  await skip.first().click({ force: true });
  await page.waitForTimeout(900);
}

await page.evaluate(() => {
  const books = globalThis.__shelfVisibleBooks?.() ?? [];
  const w = books.find((b) => /welcome/i.test(b.title)) ?? books[0];
  if (w) globalThis.__shelfPullOut(w.id);
});
await page.waitForSelector('.pulled-book', { timeout: 30_000 });
await page.waitForTimeout(1600);
const cover = await page.locator('.pulled-book').first().boundingBox();
if (cover) {
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
}
await page.waitForSelector('.nb-prose', { timeout: 60_000 });
await page.waitForTimeout(4000);

/** Everything worth knowing about the leaves the reader can actually see. */
const readSpread = () =>
  page.evaluate(() => {
    const out = [];
    for (const leaf of document.querySelectorAll('.nb-leaf-paper')) {
      if (leaf.classList.contains('nb-export-sheet')) continue; // staged, offscreen
      const prose = leaf.querySelector('.nb-prose');
      if (prose === null) continue;
      const host = prose.closest('.nb-page-editor');
      const rail = host?.querySelector('.nb-footnote-rail') ?? null;
      const proseRect = prose.getBoundingClientRect();
      const blocks = Array.from(prose.children).map((k) => ({
        tag: k.tagName.toLowerCase(),
        text: (k.textContent ?? '').trim().slice(0, 34),
        bottom: Math.round(k.getBoundingClientRect().bottom - proseRect.top),
      }));
      const railRect =
        rail === null || rail.hidden ? null : rail.getBoundingClientRect();
      const railTop =
        railRect === null ? null : Math.round(railRect.top - proseRect.top);
      out.push({
        side: leaf.getAttribute('data-side') ?? '?',
        title: (prose.querySelector('h1,h2,h3')?.textContent ?? '').trim().slice(0, 40),
        leafH: Math.round(leaf.getBoundingClientRect().height),
        proseH: Math.round(proseRect.height),
        reserved: (host === null
          ? ''
          : getComputedStyle(host).getPropertyValue('--nb-footnote-rail')
        ).trim(),
        padBottom: getComputedStyle(prose).paddingBottom,
        notes: rail === null ? 0 : rail.children.length,
        railTop,
        railH: railRect === null ? 0 : Math.round(railRect.height),
        blocks: blocks.length,
        // The verdict: blocks whose ink reaches below the rail's top edge.
        over:
          railTop === null
            ? []
            : blocks
                .filter((b) => b.bottom > railTop && b.text.length > 0)
                .map((b) => ({ ...b, by: b.bottom - railTop })),
        contentH: blocks.length === 0 ? 0 : blocks[blocks.length - 1].bottom,
      });
    }
    return out;
  });

let railsSeen = 0;
const findings = [];

const inspect = async (label) => {
  const spread = await readSpread();
  console.log('');
  console.log(
    `  ${label}  ` +
      (spread.length === 0
        ? '(no leaf on the spread)'
        : spread
            .map((l) => `${l.side}:"${l.title}"${l.notes > 0 ? ` [${l.notes}n]` : ''}`)
            .join('  |  ')),
  );
  for (const leaf of spread) {
    if (leaf.notes === 0) continue;
    railsSeen += 1;
    console.log(
      `    ${leaf.side}: leaf ${leaf.leafH}px, prose ${leaf.proseH}px, ` +
        `content ${leaf.contentH}px, ${leaf.blocks} blocks`,
    );
    console.log(
      `    ${leaf.side}: rail ${leaf.notes} note(s) ${leaf.railH}px tall, top at ` +
        `${leaf.railTop}px; reserved ${leaf.reserved || '0px'}, ` +
        `padding-bottom ${leaf.padBottom}`,
    );
    const slug = `${label.replace(/\W+/g, '-')}-${leaf.side}`;
    if (leaf.over.length > 0) {
      findings.push({ label, ...leaf });
      for (const b of leaf.over) {
        console.log(
          `    OVERPRINT <${b.tag}> "${b.text}" reaches ${b.by}px past the rail's top`,
        );
      }
    } else {
      console.log(`    ${leaf.side}: clear — no ink in the rail band`);
    }
    await page
      .locator('.nb-book-view')
      .screenshot({
        path: `${outDir}/${leaf.over.length > 0 ? 'OVERPRINT' : 'clear'}-${slug}.png`,
        timeout: 20_000,
      })
      .catch(() => {});
  }
};

// The frame-778 page, reached BY NAME: a callout card, an index card and three
// notes at the foot of one leaf, which is the whole scene of the defect.
/*
 * Turned to, rather than jumped to. The quick switcher would be one keystroke,
 * but its index is built at idle and headless Chromium on SwiftShader gets
 * three or four idle ticks a second — so on the smaller window the bar came up
 * saying "nothing here" and an Enter into that opened page one, which is a leaf
 * with no notes on it and reads as clean. Arrow keys need no index.
 */
// The target is the RAIL, not a page title. `buildWelcomePageDocs` writes a
// different Welcome book for a small window than for a large one — the footnote
// page is headed "Notes at the foot of the page" in one and "Footnotes" in the
// other — and a walk hunting the wrong title runs off the end of the book and
// then reports that it found nothing wrong.
const railSide = () =>
  page.evaluate(() => {
    for (const leaf of document.querySelectorAll(
      '.nb-leaf-paper:not(.nb-export-sheet)',
    )) {
      const rail = leaf.querySelector('.nb-footnote-rail');
      if (rail !== null && !rail.hidden && rail.children.length > 0) {
        return leaf.getAttribute('data-side') ?? '?';
      }
    }
    return null;
  });
let side = null;
for (let turn = 0; turn < 60 && side === null; turn += 1) {
  side = await railSide();
  if (side !== null) break;
  await page.keyboard.press('ArrowRight');
  // Generous, and it has to be: a turn onto a spread that is still settling
  // (the picture pages, at the smaller window) swallows the next key, and a
  // walk that loses two turns to that never arrives at all.
  await page.waitForTimeout(1500);
}
if (side === null) console.log('  never turned onto a page carrying notes');
await inspect('the footnote page');

/*
 * THE PAGE AS AUTHORED IS NOT THE TEST, and running it as one was the first
 * thing this probe got wrong.
 *
 * Seed page 25 stands 652px tall in an 821px prose whose rail begins at 712px.
 * It has sixty pixels of air under it, so it reads clean whether the rail is
 * reserved or not — sabotaging the reservation outright left the verdict green.
 * A page with room to spare cannot tell you anything about a mechanism that
 * only matters when there is none.
 *
 * So the page is FILLED first. Typing at the foot of it drives the drain, and
 * the drain leaves the leaf standing at exactly the height it believes the
 * paper to be — which is the number the reservation changes and the only
 * condition under which a note can be printed over.
 */
const fill = async () => {
  // The LAST BLOCK, not the empty paper under it. The rail is absolutely
  // positioned over that empty band, so a click aimed near the foot of the
  // prose lands in a note instead of in the prose — and Enter inside a note
  // means "done", which threw the spread back to page one.
  const last = page
    .locator(`.nb-leaf-paper[data-side="${side ?? 'left'}"] .nb-prose > *`)
    .last();
  const box = await last.boundingBox().catch(() => null);
  if (box === null) return;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(`Filling the leaf, line ${i + 1}.`, { delay: 4 });
  }
  await page.waitForTimeout(2500);
  // Typing at the foot of a full page carries the caret onward, and the spread
  // follows the caret — so the leaf that was just filled is now behind us.
  // The caret has to be let go of first or ArrowLeft only walks it backwards
  // through the text it just typed.
  for (let back = 0; back < 8; back += 1) {
    if ((await railSide()) !== null) break;
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
    });
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1400);
  }
  side = (await railSide()) ?? side;
};
await fill();
await inspect('the footnote page, filled');

/*
 * AND THEN THE NOTE GROWS, which is the other end of the same contract.
 *
 * Filling the page proves the drain respects a rail that was already there.
 * This proves the opposite order: a page that is already full to its fold, and
 * a note typed long enough to wrap the rail onto a second and third line under
 * it. The rail is absolutely positioned, so it does not push — it grows UPWARD
 * into the last line of prose unless the taller reservation reaches the drain
 * and the drain runs again on the back of it. Nothing schedules that pass
 * except the transaction the note's own text lands in.
 */
const growNote = async () => {
  const note = page
    .locator(`.nb-leaf-paper[data-side="${side ?? 'left'}"] .nb-footnote-note`)
    .last();
  const box = await note.boundingBox().catch(() => null);
  if (box === null) return;
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.type(
    ' and then a great deal more of it, written out at the foot of the page ' +
      'until the rail has to take a second line and then a third one, which is ' +
      'room the prose above it was standing in a moment ago.',
    { delay: 3 },
  );
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await page.waitForTimeout(1200);
};
await growNote();
await inspect('the footnote page, note grown');

// …and then a short sweep onward, because a note that fits when it is landed on
// may not fit on the leaf a page turn hands it to.
for (let turn = 1; turn <= TURNS; turn += 1) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  await inspect(`turn +${turn}`);
}

console.log('');
if (railsSeen === 0) {
  console.log('  verdict: INCONCLUSIVE — the walk never reached a page with notes');
} else if (findings.length === 0) {
  console.log(
    `  verdict: CLEAR — ${railsSeen} rail(s) measured, every one with the foot to itself`,
  );
} else {
  console.log(
    `  verdict: OVERPRINT on ${findings.length} of ${railsSeen} rail(s) measured`,
  );
}
console.log(`  pictures: ${outDir}/`);
console.log('  errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
process.exit(findings.length === 0 && railsSeen > 0 ? 0 : 1);
