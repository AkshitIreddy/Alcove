/**
 * shots-now/dialog-exits.mjs — every dialog now shows a way out, top-left.
 *
 * Opens each dialog in the running app and measures where its close control
 * actually landed: inside the card, in the card's LEFT half, and in its TOP
 * half. Measuring beats eyeballing here because "top-left" is the whole claim
 * — a button that renders but sits centre-right passes any screenshot glance.
 *
 * Screenshots are written alongside so the styling can be judged by looking.
 *
 * Usage: node shots-now/dialog-exits.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/out';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);

for (let i = 0; i < 4; i++) {
  const skip = p.locator('text=skip the tour').first();
  if ((await skip.count()) === 0) break;
  await skip.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(600);
}

/**
 * Where did the close land relative to its own card?
 *
 * The close is looked up INSIDE the card, not across the document. Both matter:
 * every one of these cards names its exit `.nb-ins-close`, so a document-wide
 * query returns whichever dialog happens to be first in the body — and when a
 * previous dialog is still up, that measures the wrong button against this
 * card and reports the confusing `inside: false` rather than "something else
 * is still open".
 */
const place = (cardSel, closeSel) =>
  p.evaluate(
    ([cs, xs]) => {
      const card = document.querySelector(cs);
      const close = card?.querySelector(xs) ?? null;
      if (!card || !close) return { found: false, card: !!card, close: !!close };
      const c = card.getBoundingClientRect();
      const x = close.getBoundingClientRect();
      const cx = x.left + x.width / 2;
      const cy = x.top + x.height / 2;
      return {
        found: true,
        visible: x.width > 0 && x.height > 0,
        inside: cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom,
        leftHalf: cx < c.left + c.width / 2,
        topHalf: cy < c.top + c.height / 2,
      };
    },
    [cardSel, closeSel],
  );

const results = [];
const check = async (name, cardSel, closeSel, shot) => {
  const r = await place(cardSel, closeSel);
  const ok = r.found && r.visible && r.inside && r.leftHalf && r.topHalf;
  results.push({ name, ok, ...r });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(r)}`);
  if (shot) await p.screenshot({ path: `${OUT}/${shot}` });
};

// 1. Quick switcher — Ctrl+K from the shelf.
await p.keyboard.press('Control+k');
await p.waitForTimeout(700);
await check('quick switcher', '.nb-qs-bar', '.nb-qs-close', 'exit-quickswitch.png');
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// 2/3/4 need a book OPEN, and opening one is two moves, not one: the a11y row
// pulls the book off the shelf and hands it over (PulledBookOverlay), and a
// second press on the held cover is what opens it. Doing only the first move
// left the book hovering in front of the case, which cost this file twice —
// BookView never mounted, so `insert-script` had no registered command for
// Ctrl+Alt+I to reach; and the held card owns Escape ("and so does Escape",
// PulledBookOverlay), so it swallowed the press meant to dismiss the templates
// gallery, leaving that card up to be measured against the next one.
const opened = await (async () => {
  await p.locator('.shelf-a11y button').first().dispatchEvent('click');
  const held = p.locator('[data-testid="pulled-book"]');
  if (!(await held.waitFor({ state: 'attached', timeout: 9000 }).then(() => true, () => false))) {
    return 'the book never came off the shelf';
  }
  await p.waitForTimeout(1600); // let the flight land before pressing the cover
  await held.click({ force: true }).catch(() => {});
  if (!(await p.locator('.nb-book-view').waitFor({ state: 'attached', timeout: 12000 }).then(() => true, () => false))) {
    return 'the held book never opened into the spread';
  }
  await p.waitForTimeout(2000);
  return true;
})();

// Not a skip, and not a silent carry-on. Three of the four checks below are
// meaningless without a book, so say which move failed rather than emitting
// three identical "never opened" lines that blame the dialogs.
if (opened !== true) {
  console.log(`  FAIL  could not open a book: ${opened}`);
  console.log('\n  aborted — the three in-book dialogs were never reachable');
  await p.screenshot({ path: `${OUT}/exit-open-failed.png` });
  await b.close();
  process.exit(1);
}

// The two group-D sheets have a dev bridge; the script sheet is opened by the
// keybinding its own settings sheet advertises. Both beat hunting for label
// text, which is how an earlier run of this file "passed" while never opening
// three of the four dialogs.
const openers = [
  [
    'templates gallery',
    () => p.evaluate(() => window.__nbGroupD.openTemplatesGallery()),
    '.nb-tpl-gallery',
    'exit-templates.png',
  ],
  [
    'export pdf',
    () => p.evaluate(() => window.__nbGroupD.openExportPdfDialog()),
    '.nb-pdf-card',
    'exit-pdf.png',
  ],
  [
    'insert script',
    async () => {
      await p.keyboard.press('Control+Alt+i');
    },
    '.nb-ins-card',
    'exit-script.png',
  ],
];

/** How many aged-paper cards are up right now? All three share `.nb-ins-card`. */
const cardCount = () => p.locator('.nb-ins-card').count();

for (const [name, open, card, shot] of openers) {
  // A card left over from the previous round is not a harmless stray: the
  // insert sheet is identified by the bare `.nb-ins-card` the other two also
  // carry, so a stale gallery would quietly stand in for it and this file
  // would report on the wrong dialog. Name it instead of measuring it.
  const stale = await cardCount();
  if (stale !== 0) {
    results.push({ name, ok: false, stale });
    console.log(`  FAIL  ${name} — ${stale} dialog(s) still up from the previous check`);
    continue;
  }

  await open().catch((e) => console.log(`    (opener threw: ${e.message.split('\n')[0]})`));
  await p.waitForTimeout(1100);
  if ((await p.locator(card).count()) === 0) {
    // NOT a skip. An unreachable dialog is an unverified claim, and this file
    // exists to say whether the claim holds.
    results.push({ name, ok: false, unreached: true });
    console.log(`  FAIL  ${name} — never opened, so its exit is unverified`);
    continue;
  }
  await check(name, card, '.nb-ins-close', shot);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
}

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\n  all ${results.length} dialogs opened and their exits measured top-left`
    : `\n  ${failed.length} of ${results.length} FAILED: ${failed.map((f) => f.name).join(', ')}`,
);
process.exit(failed.length === 0 ? 0 : 1);
