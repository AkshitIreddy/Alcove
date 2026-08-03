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

/** Where did the close land relative to its own card? */
const place = (cardSel, closeSel) =>
  p.evaluate(
    ([cs, xs]) => {
      const card = document.querySelector(cs);
      const close = document.querySelector(xs);
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

// 2/3/4 need a book open — pull one, then reach the dialogs from the rail.
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.waitForTimeout(3500);

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

for (const [name, open, card, shot] of openers) {
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
  await p.waitForTimeout(400);
}

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? `\n  all ${results.length} dialogs opened and their exits measured top-left`
    : `\n  ${failed.length} of ${results.length} FAILED: ${failed.map((f) => f.name).join(', ')}`,
);
process.exit(failed.length === 0 ? 0 : 1);
