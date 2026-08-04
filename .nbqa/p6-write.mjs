import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const st = async (tag) => {
  const s = await tourState(page);
  console.log(`  [${tag}] step=${s?.stepId} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)} hole=${s?.hole ? `${Math.round(s.hole.x)},${Math.round(s.hole.y)} ${Math.round(s.hole.width)}x${Math.round(s.hole.height)}` : null}`);
  return s;
};

console.log('=== phase 6: writing, the slash menu, blocks ===');
await st('writing');

// Click at the end of the left page prose and type.
const prose = page.locator('.nb-prose').first();
const box = await prose.boundingBox();
console.log('  left prose box:', JSON.stringify(box));
await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
await page.waitForTimeout(400);
await page.keyboard.type('A brand new reader was here.', { delay: 18 });
await page.waitForTimeout(1200);
await shot(page, '35-typed');
await st('after typing');

// --- the slash menu ---
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.type('/');
await page.waitForTimeout(1200);
await shot(page, '36-slash-menu');
const slash = await page.evaluate(() => {
  const m = document.querySelector('.nb-slash, .nb-slash-menu, [class*="slash"]');
  return m ? { cls: m.className, items: [...m.querySelectorAll('[role="option"], li, button')].slice(0, 12).map((e) => e.innerText?.trim().split('\n')[0]).filter(Boolean), rect: (() => { const r = m.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() } : null;
});
console.log('  slash menu:', JSON.stringify(slash)?.slice(0, 600));
check(slash !== null, 'typing / opens the block menu');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId === 'blocks' ? 1 : 0), 15000, 'blocks step');
await page.waitForTimeout(900);
const sb = await st('blocks');
await shot(page, '37-blocks-step');

// The reported bug: is the lit hole big enough to drag a block within?
const proseBox = await prose.boundingBox();
console.log('  hole vs .nb-prose:', JSON.stringify(sb?.hole), 'prose:', JSON.stringify(proseBox));
if (sb?.hole && proseBox) {
  const covers = sb.hole.x <= proseBox.x + 2 && sb.hole.y <= proseBox.y + 2 &&
    sb.hole.x + sb.hole.width >= proseBox.x + proseBox.width - 2 &&
    sb.hole.y + sb.hole.height >= proseBox.y + proseBox.height - 2;
  check(covers, 'the blocks step lights the whole writing column (the drop region)');
}

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 6 ok');
process.exit(0);
