import { attach, watchErrors, dumpErrors, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const st = async (tag) => {
  const s = await tourState(page);
  console.log(`  [${tag}] step=${s?.stepId} idx=${s?.stepIndex} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)}`);
  return s;
};
const waitStep = (id, t = 20000) => tryPoll(page, `window.__nbTutorial?.getState?.().stepId === ${JSON.stringify(id)} ? 1 : 0`, t, id);

console.log('=== phase 12: finish the tour ===');
await st('now');

await page.locator('.nb-rail-button[data-tool="toc"]').click();
await waitStep('customize-open');
await page.waitForTimeout(600); await st('customize-open');

await page.locator('.nb-rail-button[data-tool="customize"]').click();
await waitStep('customize-do');
await page.waitForTimeout(1200); await st('customize-do');
await shot(page, '60-customize-panel');
const panelInfo = await page.evaluate(() => {
  const p = document.querySelector('.nb-rail-panel[aria-hidden="false"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { label: p.getAttribute('aria-label'), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: p.innerText.slice(0, 300) };
});
console.log('  customize panel:', JSON.stringify(panelInfo)?.slice(0, 500));

// pick a binding option inside the panel
const opt = page.locator('.nb-rail-panel[aria-hidden="false"] button').nth(4);
const label = await opt.getAttribute('aria-label').catch(() => null);
console.log('  clicking option:', label);
await opt.click().catch((e) => console.log('  click failed', e.message));
await page.waitForTimeout(1800);
await shot(page, '61-after-restyle');
await st('after restyle');

await waitStep('rail-actions');
await page.waitForTimeout(700); await st('rail-actions');
await page.locator('.nb-rail-button[data-tool="thumbs"]').click().catch(async () => {
  const btns = await page.evaluate(() => [...document.querySelectorAll('.nb-rail-button')].map((b) => b.getAttribute('data-tool')));
  console.log('  rail tools:', JSON.stringify(btns));
});
await page.waitForTimeout(1500);
await shot(page, '62-thumbs');
await waitStep('ai-script');
await page.waitForTimeout(700); await st('ai-script');
await page.locator('.nb-rail-button[data-tool="spec"]').click();
await page.waitForTimeout(1500);
await shot(page, '63-spec-copied');
await waitStep('quick-switch');
await page.waitForTimeout(700); const sq = await st('quick-switch');
check((sq?.openSurfaces ?? []).length === 0, `entering quick-switch left nothing stale open (${JSON.stringify(sq?.openSurfaces)})`);

await page.keyboard.press('Control+k');
await page.waitForTimeout(1500);
await shot(page, '64-quick-switcher');
const qs = await page.evaluate(() => {
  const b = document.querySelector('.nb-qs-bar');
  return b ? { rect: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), text: b.innerText.slice(0, 200) } : null;
});
console.log('  quick switcher:', JSON.stringify(qs));
check(qs !== null, 'Ctrl+K opens the quick switcher');

await waitStep('settings');
await page.waitForTimeout(700); const ss = await st('settings');
check((ss?.openSurfaces ?? []).length === 0, `entering settings closed the quick switcher (${JSON.stringify(ss?.openSurfaces)})`);
await page.locator('.nbs-gear-button').click();
await page.waitForTimeout(1800);
await shot(page, '65-settings');
await waitStep('youre-set');
await page.waitForTimeout(1200); await st('youre-set');
await shot(page, '66-youre-set');
const last = await page.evaluate(() => document.querySelector('.nbt-card')?.innerText ?? null);
console.log('  final card:', JSON.stringify(last)?.slice(0, 700));

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 12 ok');
process.exit(0);
