import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const st = async (tag) => {
  const s = await tourState(page);
  console.log(`  [${tag}] step=${s?.stepId} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)}`);
  return s;
};

console.log('=== phase 7: blocks, right-click menu, the handle drag ===');
await st('blocks');

// Right-click the paragraph I typed.
const para = page.locator('.nb-prose p', { hasText: 'A brand new reader was here.' }).first();
const pb = await para.boundingBox();
console.log('  para box:', JSON.stringify(pb));
await page.mouse.click(pb.x + 40, pb.y + pb.height / 2, { button: 'right' });
await page.waitForTimeout(900);
await shot(page, '40-block-context-menu');
const ctx = await page.evaluate(() => {
  const m = document.querySelector('.nb-ctx-menu');
  return m ? { rect: (() => { const r = m.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), items: [...m.querySelectorAll('button,[role="menuitem"]')].map((e) => e.innerText?.trim().split('\n')[0]).filter(Boolean).slice(0, 20) } : null;
});
console.log('  ctx menu:', JSON.stringify(ctx)?.slice(0, 700));
check(ctx !== null, 'right-click opens the block context menu');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Hover the block to reveal the handle, then drag it up.
await page.mouse.move(pb.x + 100, pb.y + pb.height / 2);
await page.waitForTimeout(700);
await shot(page, '41-handle-visible');
const handle = await page.evaluate(() => {
  const h = document.querySelector('.nb-drag-handle, [data-drag-handle], .nb-block-handle, [class*="handle"]');
  if (!h) return null;
  const r = h.getBoundingClientRect();
  const cs = getComputedStyle(h);
  return { cls: h.className?.toString?.(), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], display: cs.display, opacity: cs.opacity, cursor: cs.cursor };
});
console.log('  handle:', JSON.stringify(handle));
check(handle !== null, 'a drag handle appears in the margin on hover');

if (handle) {
  const hx = handle.rect[0] + handle.rect[2] / 2;
  const hy = handle.rect[1] + handle.rect[3] / 2;
  // Drag it up onto the bullet list
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.waitForTimeout(120);
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(hx + 60, hy - i * 26);
    await page.waitForTimeout(35);
  }
  await shot(page, '42-mid-drag');
  const cursorMid = await page.evaluate(() => {
    const el = document.elementFromPoint(400, 430);
    return { tag: el?.tagName, cls: el?.className?.toString?.().slice(0, 60), cursor: el ? getComputedStyle(el).cursor : null, bodyCursor: getComputedStyle(document.body).cursor };
  });
  console.log('  mid-drag cursor:', JSON.stringify(cursorMid));
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await shot(page, '43-after-drag');
}
await st('after block drag');

const moved = await tryPoll(page, () => (window.__nbTutorial?.getState?.().stepId !== 'blocks' ? 1 : 0), 12000, 'walk on');
check(moved === 1, 'the blocks step completes after right-click + handle drag');
await page.waitForTimeout(900);
await st('pages');
await shot(page, '44-pages-step');

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 7 ok');
process.exit(0);
