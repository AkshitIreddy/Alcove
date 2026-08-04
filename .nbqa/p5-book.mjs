import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const st = async (tag) => {
  const s = await tourState(page);
  console.log(`  [${tag}] step=${s?.stepId} idx=${s?.stepIndex} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)} nudge=${JSON.stringify(s?.nudge)}`);
  return s;
};

console.log('=== phase 5: into the book ===');
await st('before open');

// The cover is forward. Click it to go inside.
await page.locator('.pulled-book').first().click();
await page.waitForTimeout(2500);
await shot(page, '31-book-opened');
await st('after cover click');
const inside = await page.evaluate(() => ({
  spread: document.querySelectorAll('.nb-spread').length,
  prose: document.querySelectorAll('.nb-prose').length,
  rail: document.querySelectorAll('.nb-rail').length,
}));
console.log('  inside:', JSON.stringify(inside));
check(inside.spread > 0, 'clicking the forward cover opens the book');

// step: the-rail — hover an icon
await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId === 'the-rail' ? 1 : 0), 15000, 'the-rail step');
await st('the-rail');
await shot(page, '32-the-rail-step');
await page.locator('.nb-rail-button').first().hover();
await page.waitForTimeout(1500);
await shot(page, '33-rail-hovered');
await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId === 'writing' ? 1 : 0), 15000, 'writing step');
await page.waitForTimeout(900);
await st('writing');
await shot(page, '34-writing-step');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 5 ok');
process.exit(0);
