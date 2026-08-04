import { attach, watchErrors, dumpErrors, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

console.log('=== phase 11: how long does a panel the tour asked for stay open? ===');

const probe = () => page.evaluate(() => {
  const p = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
  const s = window.__nbTutorial?.getState?.();
  return { panel: p ? (p.getAttribute('aria-label') ?? 'panel') : null, step: s?.stepId, done: s?.done, open: s?.openSurfaces };
});

const s0 = await tourState(page);
console.log('  starting at step', s0?.stepId);

// The tour is on 'catalogue'. Do what it asks.
const t0 = Date.now();
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
const trace = [];
for (let i = 0; i < 60; i++) {
  const r = await probe();
  trace.push({ ms: Date.now() - t0, ...r });
  await page.waitForTimeout(100);
}
let openedAt = null, closedAt = null;
for (const t of trace) {
  if (openedAt === null && t.panel !== null) openedAt = t.ms;
  if (openedAt !== null && closedAt === null && t.panel === null) closedAt = t.ms;
}
console.log('  panel opened at ~', openedAt, 'ms; closed at ~', closedAt, 'ms');
console.log('  step changed at:', trace.find((t) => t.step !== s0?.stepId)?.ms ?? 'never', '->', trace.find((t) => t.step !== s0?.stepId)?.step);
console.log('  trace:', trace.filter((_, i) => i % 3 === 0).map((t) => `${t.ms}:${t.panel ? 'OPEN' : '----'}/${t.step}`).join(' '));
check(closedAt === null || closedAt - openedAt > 6000, `the Catalogue the tour asked for stays open longer than 6s (it lasted ${closedAt === null ? '>6000' : closedAt - openedAt}ms)`);
await shot(page, '59-after-catalogue-step');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 11 ok');
process.exit(0);
