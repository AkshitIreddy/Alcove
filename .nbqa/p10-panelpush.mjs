import { attach, watchErrors, dumpErrors, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const geom = () => page.evaluate(() => {
  const g = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) }; };
  return {
    vw: window.innerWidth,
    spread: g('.nb-spread'),
    stage: g('.nb-spread-stage'),
    rightPage: (() => { const ps = document.querySelectorAll('.nb-sheet-paper'); const e = ps[ps.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) }; })(),
    curl: g('.nb-page-curl'),
    panel: g('.nb-rail-panel[aria-hidden="false"]'),
  };
});

console.log('=== phase 10: does an open rail panel push the page off screen? ===');
console.log('  closed:', JSON.stringify(await geom()));

await page.locator('.nb-rail-button[data-tool="page-style"]').click();
await page.waitForTimeout(1600);
const open = await geom();
console.log('  page-style open:', JSON.stringify(open));
await shot(page, '58-page-style-open-geom');
check(open.rightPage && open.rightPage.right <= open.vw + 1, `the right page stays inside the window with a panel open (right=${open.rightPage?.right} vw=${open.vw})`);
check(open.curl && open.curl.right <= open.vw + 1, `the page-curl corner stays reachable with a panel open (right=${open.curl?.right} vw=${open.vw})`);

const s = await tourState(page);
console.log('  tour:', s?.stepId, 'done=', s?.done, 'open=', JSON.stringify(s?.openSurfaces));

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 10 ok');
process.exit(0);
