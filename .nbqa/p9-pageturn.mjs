import { attach, watchErrors, dumpErrors, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const pageNo = () => page.evaluate(() => ({
  label: document.querySelector('.nb-page-number, .nb-spread-folio, [class*="folio"]')?.textContent ?? null,
  idx: window.__nbBookView?.pageIndex?.() ?? null,
  activeEl: document.activeElement?.className?.toString?.().slice(0, 60) ?? document.activeElement?.tagName,
  curl: (() => { const c = document.querySelector('.nb-page-curl'); if (!c) return null; const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
  spreadText: document.querySelector('.nb-spread')?.innerText?.slice(0, 60).replace(/\n/g, ' '),
}));

console.log('=== phase 9: turning the page ===');
console.log('  before:', JSON.stringify(await pageNo()));

// 1. arrow key with the caret in the editor (what a reader has after step 9)
await page.mouse.click(450, 700);
await page.waitForTimeout(300);
console.log('  focus after clicking a line:', JSON.stringify((await pageNo()).activeEl));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(1500);
const afterCaret = await pageNo();
console.log('  after ArrowRight with caret in editor:', JSON.stringify(afterCaret));
check(afterCaret.spreadText !== (await pageNo()).spreadText || false, 'placeholder');
fails.pop();

// 2. blur the editor, then arrow
await page.evaluate(() => document.activeElement?.blur?.());
await page.mouse.click(760, 60); // the gutter between pages, above the spread
await page.waitForTimeout(300);
console.log('  focus after clicking chrome:', JSON.stringify((await pageNo()).activeEl));
const before2 = (await pageNo()).spreadText;
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2000);
const after2 = await pageNo();
console.log('  after ArrowRight with editor blurred:', JSON.stringify(after2));
check(after2.spreadText !== before2, 'ArrowRight turns the page when the editor does not have focus');
await shot(page, '55-arrow-turn-attempt');

// 3. drag the corner curl
console.log('  curl rect:', JSON.stringify(after2.curl));
if (after2.curl) {
  const [x, y, w, h] = after2.curl;
  const sx = x + w - 8, sy = y + h - 8;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(sx - i * 40, sy - i * 12); await page.waitForTimeout(28); }
  await shot(page, '56-mid-curl');
  await page.mouse.up();
  await page.waitForTimeout(2200);
  await shot(page, '57-after-curl');
  const after3 = await pageNo();
  console.log('  after corner drag:', JSON.stringify(after3));
  check(after3.spreadText !== after2.spreadText, 'dragging the page corner turns the page');
}

const s = await tourState(page);
console.log('  tour:', s?.stepId, 'done=', s?.done);

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 9 ok');
process.exit(0);
