import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const log = [];
const st = async (tag) => {
  const s = await tourState(page);
  const line = `[${tag}] step=${s?.stepId} idx=${s?.stepIndex} done=${s?.done} open=${JSON.stringify(s?.openSurfaces)}`;
  console.log('  ' + line);
  log.push({ tag, step: s?.stepId, open: s?.openSurfaces ?? [] });
  return s;
};
const waitStep = (id, t = 15000) => tryPoll(page, `window.__nbTutorial?.getState?.().stepId === ${JSON.stringify(id)} ? 1 : 0`, t, id);

console.log('=== phase 8: the rest of the tour ===');
await st('pages');

// pages — arrow key
await page.mouse.click(450, 700);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2200);
await shot(page, '45-page-turned');
await waitStep('page-style');
await page.waitForTimeout(1000);
await st('page-style (entered)');
await shot(page, '46-page-style-step');

// page-style — open the panel
await page.locator('.nb-rail-button[data-tool="page-style"]').click();
await page.waitForTimeout(1600);
await shot(page, '47-page-style-open');
await waitStep('catalogue');
await page.waitForTimeout(1100);
const sCat = await st('catalogue (entered)');
check((sCat?.openSurfaces ?? []).length === 0, `entering 'catalogue' closed the Page style panel (open=${JSON.stringify(sCat?.openSurfaces)})`);
await shot(page, '48-catalogue-step');

// catalogue
await page.locator('.nb-rail-button[data-tool="catalogue"]').click();
await page.waitForTimeout(1600);
await shot(page, '49-catalogue-open');
await waitStep('finding-in-book');
await page.waitForTimeout(1100);
const sToc = await st('finding-in-book (entered)');
check((sToc?.openSurfaces ?? []).length === 0, `entering 'finding-in-book' closed the Catalogue (open=${JSON.stringify(sToc?.openSurfaces)})`);
await shot(page, '50-toc-step');

// toc
await page.locator('.nb-rail-button[data-tool="toc"]').click();
await page.waitForTimeout(1600);
await shot(page, '51-toc-open');
await waitStep('customize-open');
await page.waitForTimeout(1100);
const sCo = await st('customize-open (entered)');
check((sCo?.openSurfaces ?? []).length === 0, `entering 'customize-open' closed the Contents panel (open=${JSON.stringify(sCo?.openSurfaces)})`);
await shot(page, '52-customize-open-step');

// customize-open
await page.locator('.nb-rail-button[data-tool="customize"]').click();
await page.waitForTimeout(1800);
await shot(page, '53-customize-open');
await waitStep('customize-do');
await page.waitForTimeout(1100);
const sCd = await st('customize-do (entered)');
check((sCd?.openSurfaces ?? []).includes('rail-panel'), 'the customize panel SURVIVES into customize-do (the step is about it)');
await shot(page, '54-customize-do-step');

console.log('\n--- summary of open surfaces on entering each step ---');
for (const l of log) console.log(`  ${l.step ?? '?'} -> ${JSON.stringify(l.open)}`);

dumpErrors(errors);
console.log(fails.length ? `${fails.length} FAILED` : 'phase 8 ok');
process.exit(0);
