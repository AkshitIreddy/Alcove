import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

console.log('=== phase 4: click a spine — forward, or straight open? ===');
const s0 = await tourState(page);
console.log('  at step', s0?.stepId);

// Where is the book on screen? Ask the world.
const spot = await page.evaluate(() => {
  const b = (window.__shelfVisibleBooks?.() ?? [])[0];
  const r = window.__shelfBookRect?.(b?.id);
  return { book: b ? { id: b.id, title: b.title } : null, rect: r ?? null };
});
console.log('  book/rect bridge:', JSON.stringify(spot));

// Fall back to the visible spine in the canvas: click where the shot shows it.
const target = spot.rect ?? { x: 700, y: 120, width: 30, height: 150 };
const cx = Math.round(target.x + target.width / 2);
const cy = Math.round(target.y + target.height / 2);
console.log('  clicking', cx, cy);

await page.mouse.click(cx, cy);

// Sample fast for 4 seconds: what appears?
for (const t of [150, 350, 600, 900, 1400, 2200, 3200, 4200]) {
  await page.waitForTimeout(t === 150 ? 150 : 0);
  await page.waitForTimeout(t === 150 ? 0 : 250);
  const snap = await page.evaluate(() => ({
    view: window.__nbAppView?.() ?? null,
    pulled: document.querySelectorAll('.pulled-book').length,
    cover: document.querySelectorAll('.nb-book-cover').length,
    bookView: document.querySelectorAll('.nb-book-view').length,
    spread: document.querySelectorAll('.nb-spread').length,
    backBtn: [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.innerText.trim()).filter((x) => /back|shelf/i.test(x)).slice(0, 5),
    step: window.__nbTutorial?.getState?.().stepId,
  }));
  console.log(`  t~${t}ms`, JSON.stringify(snap));
}
await shot(page, '30-after-spine-click');

const view = await page.evaluate(() => ({
  bookView: document.querySelectorAll('.nb-book-view').length,
  spread: document.querySelectorAll('.nb-spread').length,
  prose: document.querySelectorAll('.nb-prose').length,
  rail: document.querySelectorAll('.nb-rail').length,
}));
console.log('  final:', JSON.stringify(view));
check(view.spread === 0, 'a single click brings the book FORWARD without opening it (reader report 2026-08-04)');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 4 ok');
process.exit(0);
