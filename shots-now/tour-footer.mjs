/**
 * shots-now/tour-footer.mjs — do the tour's dots and buttons stay reachable?
 *
 * The card is its own scroller and its longest step (the AI-script one) runs
 * past a screenful. Sticky positioning is easy to write and easy to get wrong —
 * a sticky element inside a scroller with the wrong `bottom`, or under a later
 * sibling, simply scrolls away like everything else.
 *
 * So this scrolls the card to the bottom AND to the top and measures, both
 * times, whether the dots and the actions are inside the card's visible box.
 *
 * Usage: node shots-now/tour-footer.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
// Deliberately SHORT. At a normal window even the longest step overflows by
// only a few pixels, and a run like that never exercises the sticky rule at
// all — it passes whatever the CSS says. MIN_OVERFLOW below rejects that.
const p = await b.newPage({ viewport: { width: 1200, height: 400 } });
await p.goto('http://localhost:1420/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);

const started = await p.evaluate(async () => {
  if (typeof window.__nbTutorial?.getState !== 'function') {
    const mod = await import('/src/features/tutorial/devMount.tsx');
    mod.mountTutorialDev({ start: false });
  }
  return typeof window.__nbTutorial?.getState === 'function';
});
if (!started) {
  console.log('  tour debug surface never appeared');
  await b.close();
  process.exit(1);
}

await p.evaluate(() => window.__nbTutorial.start());
await p.waitForTimeout(800);

// Walk to the longest step — the one the card's own comment calls out.
const total = await p.evaluate(() => window.__nbTutorial.getState().total);
let worst = null;
for (let i = 0; i < total; i++) {
  await p.evaluate((n) => window.__nbTutorial.jumpTo(n), i);
  await p.waitForTimeout(220);
  const m = await p.evaluate(() => {
    const card = document.querySelector('.nbt-card');
    const dots = document.querySelector('.nbt-dots');
    const acts = document.querySelector('.nbt-actions');
    if (!card || !dots || !acts) return null;
    const overflow = card.scrollHeight - card.clientHeight;
    const inside = (el) => {
      const c = card.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
    };
    card.scrollTop = card.scrollHeight;
    const atBottom = { dots: inside(dots), acts: inside(acts) };
    card.scrollTop = 0;
    const atTop = { dots: inside(dots), acts: inside(acts) };
    return { id: window.__nbTutorial.getState().stepId, overflow, atBottom, atTop };
  });
  if (m && (worst === null || m.overflow > worst.overflow)) worst = m;
}

console.log('  longest step:', JSON.stringify(worst, null, 1));

/** Below this the card barely scrolls, so a pass proves nothing. */
const MIN_OVERFLOW = 120;
let ok = false;
if (!worst) {
  console.log('  FAIL — never found the card');
} else if (worst.overflow < MIN_OVERFLOW) {
  console.log(
    `  INCONCLUSIVE — worst overflow ${worst.overflow}px < ${MIN_OVERFLOW}px, ` +
      'the sticky footer was never under load; shrink the viewport',
  );
} else if (worst.atTop.dots && worst.atTop.acts && worst.atBottom.dots && worst.atBottom.acts) {
  ok = true;
  console.log(`  PASS — footer reachable at both ends of a ${worst.overflow}px scroll`);
} else {
  console.log('  FAIL — footer scrolls away');
}
await b.close();
process.exit(ok ? 0 : 1);
