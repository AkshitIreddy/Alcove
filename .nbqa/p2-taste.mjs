import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

console.log('=== phase 2: the full rundown, the four questions ===');
await page.locator('.nbt-choice-btn', { hasText: 'the full rundown' }).click();
await page.waitForTimeout(600);

const reached = await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId === 'taste' ? 1 : 0), 20000, 'taste step');
check(reached === 1, "the tour walks to the 'taste' step");
await shot(page, '10-taste-step-reached');

const opened = await page.waitForSelector('.nbq-sheet', { state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
check(opened, 'the questionnaire puts itself on screen');
await page.waitForTimeout(700);
await shot(page, '11-taste-q1');

const readQ = () => page.evaluate(() => {
  const layer = document.querySelector('.nbq-layer');
  if (!layer) return null;
  return {
    step: layer.getAttribute('data-taste-step'),
    stage: layer.getAttribute('data-taste-stage'),
    title: document.querySelector('.nbq-sheet .nbq-title')?.textContent ?? '',
    options: [...document.querySelectorAll('.nbq-options .nbq-option')].map((o) => o.innerText.replace(/\n+/g, ' | ').slice(0, 60)),
  };
});

const q1 = await readQ();
console.log('  q1:', JSON.stringify(q1, null, 1));

const pick = async (n) => { await page.locator('.nbq-options .nbq-option').nth(n).click(); };

await pick(1);
await poll(page, () => (document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'pitch' ? 1 : 0), 15000, 'q2');
await page.waitForTimeout(500); await shot(page, '12-taste-q2');
console.log('  q2:', JSON.stringify(await readQ(), null, 1));

await pick(2);
await poll(page, () => (document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'paper' ? 1 : 0), 15000, 'q3');
await page.waitForTimeout(500); await shot(page, '13-taste-q3');
console.log('  q3:', JSON.stringify(await readQ(), null, 1));

await pick(3);
await poll(page, () => (document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === 'sound' ? 1 : 0), 15000, 'q4');
await page.waitForTimeout(500); await shot(page, '14-taste-q4');
console.log('  q4:', JSON.stringify(await readQ(), null, 1));

await pick(2);
await page.waitForTimeout(400);
await page.locator('.nbq-btn--primary').click();
await poll(page, () => (document.querySelector('.nbq-layer')?.getAttribute('data-taste-stage') === 'summary' ? 1 : 0), 15000, 'summary');
await page.waitForTimeout(800);
await shot(page, '15-taste-summary');
const summary = await page.evaluate(() => ({
  title: document.querySelector('.nbq-final .nbq-title')?.textContent ?? '',
  text: document.querySelector('.nbq-sheet')?.innerText ?? '',
}));
console.log('  summary:', JSON.stringify(summary, null, 1));

const before = await page.evaluate(() => ({ key: window.__shelfDesign?.().libraryKey ?? null }));
await page.locator('.nbq-btn--primary').click();
await poll(page, () => (document.querySelector('.nbq-sheet') === null ? 1 : 0), 20000, 'panel closes');
await page.waitForFunction((k) => (window.__shelfDesign?.().libraryKey ?? null) !== k, before.key, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1800);
await shot(page, '16-dressed-library');

const st = await tourState(page);
console.log('  tour after dressing:', JSON.stringify({ stepId: st?.stepId, done: st?.done, finished: st?.finished }));
check(st?.finished?.includes('taste') === true, 'the taste task went green');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 2 ok');
process.exit(0);
