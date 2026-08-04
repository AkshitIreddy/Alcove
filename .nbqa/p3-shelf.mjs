import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const st = async (tag) => {
  const s = await tourState(page);
  console.log(`  [${tag}] step=${s?.stepId} idx=${s?.stepIndex} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)} anchored=${s?.anchored} hole=${JSON.stringify(s?.hole)}`);
  return s;
};

console.log('=== phase 3: the shelf steps ===');
await st('start');

/* --- step: shelf-moves — drag the shelf --- */
await page.mouse.move(600, 500);
await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(600 - i * 8, 500 - i * 4); await page.waitForTimeout(16); }
await page.mouse.up();
await page.waitForTimeout(1200);
await shot(page, '20-after-shelf-drag');
await st('after drag');

const moved = await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId !== 'shelf-moves' ? 1 : 0), 12000, 'walk on');
check(moved === 1, 'dragging the shelf finishes the shelf-moves step and walks on');
await page.waitForTimeout(900);
await shot(page, '21-shelf-dock-step');
await st('shelf-dock');

/* --- step: shelf-dock — hover a tool --- */
const dockBtn = page.locator('.shelf-dock__btn').first();
await dockBtn.hover();
await page.waitForTimeout(1400);
await shot(page, '22-dock-hovered');
const movedB = await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId !== 'shelf-dock' ? 1 : 0), 12000, 'walk on');
check(movedB === 1, 'hovering a shelf tool finishes shelf-dock');
await page.waitForTimeout(900);
await st('shelf-studio');
await shot(page, '23-shelf-studio-step');

/* --- step: shelf-studio — open the studio --- */
await page.locator('.shelf-dock__btn[data-shelf-dock="studio"]').click();
await page.waitForTimeout(1600);
await shot(page, '24-studio-open');
await st('studio open');
const movedC = await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId !== 'shelf-studio' ? 1 : 0), 12000, 'walk on');
check(movedC === 1, 'opening the studio finishes shelf-studio');
await page.waitForTimeout(1200);
const s2 = await st('open-a-book');
check(s2?.openSurfaces?.length === 0, `entering open-a-book closes the studio (open=${JSON.stringify(s2?.openSurfaces)})`);
await shot(page, '25-open-a-book-step');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 3 ok');
process.exit(0);
