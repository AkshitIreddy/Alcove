/**
 * shots-now/tooltips.mjs — drive the app's own tooltip and photograph it.
 *
 * A specimen board would prove the bubble draws; this proves the app can
 * REACH it. Every assertion reads the applied DOM (the live `.nb-tip` layer on
 * <body>), never what a call site merely wrote.
 *
 * Covered here: every converted shelf call site, both sides, the key cap, the
 * flip, the keyboard path and the click-does-not-label rule. NOT covered here,
 * because proving it means renaming and crumpling a real book: the
 * `data-tooltip-clipped` rule on the shelf-menu heading and the trash row —
 * verified by hand against a long title (bubble) and the seeded one (none),
 * with the library restored afterwards. Both are on shots-now/tooltips-board.png.
 *
 * Usage: node shots-now/tooltips.mjs
 */
import { chromium } from 'playwright';

const OUT = 'shots-now/tip';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 2,
});
p.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text().slice(0, 200));
});
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
p.on('load', () => console.log('[load] the page (re)loaded'));

await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.locator('[data-testid="shelf-dock"]').first().waitFor({ timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));

/** The dock, the pill and the layer are all still there. */
const alive = () =>
  p.evaluate(() => ({
    host: document.querySelector('.nb-tip-host') !== null,
    dock: document.querySelector('[data-testid="shelf-dock"]') !== null,
    tour: document.body.innerText.includes('skip the tour'),
  }));

// The tour is modal and lands over the case. Escape leaves it (the card says
// so), which is one keystroke rather than a click that has to find a target.
for (let i = 0; i < 12; i++) {
  const state = await alive();
  if (!state.tour) break;
  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 900));
}
await new Promise((r) => setTimeout(r, 1500));
console.log('after tour:', JSON.stringify(await alive()));

const layer = await p.evaluate(() => document.querySelector('.nb-tip-host') !== null);
console.log('tooltip layer installed:', layer);

/** Read the live bubble: text, side, box, and whether it is actually up. */
const readTip = () =>
  p.evaluate(() => {
    const tip = document.querySelector('.nb-tip');
    if (tip === null) return null;
    const card = tip.querySelector('.nb-tip__card');
    const cs = getComputedStyle(card);
    const r = card.getBoundingClientRect();
    return {
      text: tip.querySelector('.nb-tip__label')?.textContent ?? '',
      key: tip.querySelector('.nb-tip__key')?.textContent ?? null,
      side: tip.getAttribute('data-side'),
      up: tip.classList.contains('is-up'),
      opacity: cs.opacity,
      font: cs.fontFamily,
      size: cs.fontSize,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor,
      shadow: cs.boxShadow,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      hidden: tip.getAttribute('aria-hidden'),
    };
  });

async function shot(name, selector, waitMs = 700) {
  const el = p.locator(selector).first();
  // The dev server is shared with other agents; an HMR reload mid-run must
  // not read as "the tooltip is unreachable".
  try {
    await el.waitFor({ timeout: 30000 });
  } catch {
    console.log(`${name}: MISSING ${selector}`);
    return;
  }
  await el.hover({ force: true });
  await new Promise((r) => setTimeout(r, waitMs));
  const tip = await readTip();
  console.log(`${name}:`, JSON.stringify(tip));
  await p.screenshot({
    path: `${OUT}-${name}.png`,
    timeout: 120000,
    animations: 'disabled',
    caret: 'hide',
  });
  // Park the pointer somewhere blank so the next hover is a fresh open.
  await p.mouse.move(760, 40);
  await new Promise((r) => setTimeout(r, 250));
}

/* --- the shelf dock (left rail): bubbles open to the right --------------- */
await shot('dock-newbook', 'button[data-shelf-dock="new-book"]');
await shot('dock-studio', 'button[data-shelf-dock="studio"]');
await shot('dock-trash', 'button[data-shelf-dock="trash"]');

/* --- the zoom pill (bottom edge): bubbles flip UP, and carry a key cap --- */
await shot('zoom-out', '.shelf-zoom-pill__btn');
await shot('zoom-pct', '.shelf-zoom-pill__pct');
await shot('zoom-fit', '.shelf-zoom-pill__fit');

/* --- the ghost slot, mid-case ------------------------------------------- */
await shot('addslot', '[data-testid="shelf-addslot"]');

/* --- keyboard: a tooltip nobody can reach by tab does not exist ---------- */
await p.mouse.move(760, 40);
await new Promise((r) => setTimeout(r, 500));
// A CLICK-focused control must NOT label itself: the press already answered
// the question, and a bubble under the cursor after every click is noise.
await p.locator('button[data-shelf-dock="add-floor"]').first().click({ force: true });
await new Promise((r) => setTimeout(r, 700));
console.log('after a click (want null):', JSON.stringify(await readTip()));

await p.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 700));
console.log('keyboard tab (want a bubble):', JSON.stringify(await readTip()));
await p.screenshot({
  path: `${OUT}-keyboard.png`,
  timeout: 120000,
  animations: 'disabled',
  caret: 'hide',
});

/* --- the trash card's clipped names -------------------------------------- */
await p.locator('button[data-shelf-dock="trash"]').first().click({ force: true });
await new Promise((r) => setTimeout(r, 900));
await shot('trash-name', '.shelf-trash__name', 700);

await b.close();
console.log('done');
