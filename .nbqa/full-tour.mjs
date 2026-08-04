import { attach, watchErrors, dumpErrors, poll, tryPoll, shot, tourState, check, fails, URL_BASE } from './lib.mjs';

const { page } = await attach();
const errors = watchErrors(page);

const entries = [];
const record = async (tag) => {
  const s = await tourState(page);
  entries.push({ tag, step: s?.stepId, idx: s?.stepIndex, open: [...(s?.openSurfaces ?? [])] });
  return s;
};
const waitStep = (id, t = 25000) =>
  tryPoll(page, `window.__nbTutorial?.getState?.().stepId === ${JSON.stringify(id)} ? 1 : 0`, t, id);

console.log('=== a brand-new reader, the FULL tour, end to end ===');
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await poll(page, () => (window.__shelfDesign !== undefined ? 1 : 0), 60000, 'shelf');
await poll(page, () => ((window.__shelfVisibleBooks?.() ?? []).length > 0 ? 1 : 0), 60000, 'welcome book');
await poll(page, () => (window.__nbTutorial?.getState?.().running === true ? 1 : 0), 30000, 'tour');

await page.locator('.nbt-choice-btn', { hasText: 'the full rundown' }).click();
await waitStep('taste');
await page.waitForSelector('.nbq-sheet', { state: 'visible', timeout: 20000 });
await page.waitForTimeout(500);
// Answer with a LIGHT-interface set this time: room 0, pitch 1 (warm), paper 1, sound 1
for (const [n, next] of [[0, 'pitch'], [1, 'paper'], [1, 'sound']]) {
  await page.locator('.nbq-options .nbq-option').nth(n).click();
  await poll(page, `document.querySelector('.nbq-layer')?.getAttribute('data-taste-step') === ${JSON.stringify(next)} ? 1 : 0`, 15000, next);
}
await page.locator('.nbq-options .nbq-option').nth(1).click();
await page.waitForTimeout(400);
await page.locator('.nbq-btn--primary').click();
await poll(page, () => (document.querySelector('.nbq-layer')?.getAttribute('data-taste-stage') === 'summary' ? 1 : 0), 15000, 'summary');
await page.waitForTimeout(600);
const summary = await page.evaluate(() => document.querySelector('.nbq-sheet')?.innerText.replace(/\n+/g, ' | ').slice(0, 300));
console.log('  summary:', summary);
await page.locator('.nbq-btn--primary').click();
await poll(page, () => (document.querySelector('.nbq-sheet') === null ? 1 : 0), 20000, 'panel closed');
await page.waitForTimeout(2500);
console.log('  interface:', JSON.stringify(await page.evaluate(() => ({ t: document.documentElement.dataset.theme, i: document.documentElement.dataset.ink }))));

const steps = [
  ['shelf-moves', async () => {
    await page.mouse.move(600, 500); await page.mouse.down();
    for (let i = 0; i < 12; i++) { await page.mouse.move(600 - i * 8, 500 - i * 4); await page.waitForTimeout(16); }
    await page.mouse.up();
  }],
  ['shelf-dock', async () => { await page.locator('.shelf-dock__btn').first().hover(); }],
  ['shelf-studio', async () => { await page.locator('.shelf-dock__btn[data-shelf-dock="studio"]').click(); }],
  ['open-a-book', async () => {
    const b = await page.evaluate(() => (window.__shelfVisibleBooks?.() ?? [])[0]?.id);
    await page.locator(`[aria-label^="Take "]`).first().click();
    await page.waitForSelector('.pulled-book.is-held', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('.pulled-book').first().click();
  }],
  ['the-rail', async () => { await page.locator('.nb-rail-button').first().hover(); }],
  ['writing', async () => {
    const box = await page.locator('.nb-prose').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 30);
    await page.waitForTimeout(300);
    await page.keyboard.type('hello from a new reader', { delay: 15 });
  }],
  ['blocks', async () => {
    const box = await page.locator('.nb-prose').first().boundingBox();
    await page.mouse.click(box.x + 60, box.y + box.height - 30, { button: 'right' });
    await page.waitForTimeout(600);
  }],
  ['pages', async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(200);
    const curl = await page.locator('.nb-page-curl').boundingBox();
    if (curl) {
      const sx = curl.x + curl.width - 6, sy = curl.y + curl.height - 6;
      await page.mouse.move(sx, sy); await page.mouse.down();
      for (let i = 1; i <= 14; i++) { await page.mouse.move(sx - i * 40, sy - i * 12); await page.waitForTimeout(28); }
      await page.mouse.up();
    }
  }],
  ['page-style', async () => { await page.locator('.nb-rail-button[data-tool="page-style"]').click(); }],
  ['catalogue', async () => { await page.locator('.nb-rail-button[data-tool="catalogue"]').click(); }],
  ['finding-in-book', async () => { await page.locator('.nb-rail-button[data-tool="toc"]').click(); }],
  ['customize-open', async () => { await page.locator('.nb-rail-button[data-tool="customize"]').click(); }],
  ['customize-do', async () => {
    await page.waitForTimeout(600);
    const btns = page.locator('.nb-rail-panel[aria-hidden="false"] button');
    const n = await btns.count();
    console.log('    customize buttons:', n);
    for (let i = 0; i < Math.min(n, 30); i++) {
      const al = await btns.nth(i).getAttribute('aria-label').catch(() => null);
      if (al && /binding|material|pigment|cloth|shape/i.test(al)) { console.log('    clicking', al); await btns.nth(i).click(); return; }
    }
    await btns.nth(6).click().catch(() => {});
  }],
  ['rail-actions', async () => { await page.locator('.nb-rail-button[data-tool="thumbs"]').click(); }],
  ['ai-script', async () => { await page.locator('.nb-rail-button[data-tool="spec"]').click(); }],
  ['quick-switch', async () => { await page.keyboard.press('Control+k'); }],
  ['settings', async () => {
    await page.waitForTimeout(400);
    await page.locator('.nbs-gear-button').click({ timeout: 12000 });
  }],
  ['youre-set', async () => {}],
];

for (const [id, act] of steps) {
  const ok = await waitStep(id);
  if (ok === null) {
    const s = await tourState(page);
    console.log(` STUCK  expected '${id}', tour is on '${s?.stepId}' (done=${s?.done}) open=${JSON.stringify(s?.openSurfaces)}`);
    await shot(page, `stuck-at-${id}`);
    fails.push(`the tour never reached '${id}' — stuck on '${s?.stepId}'`);
    break;
  }
  await page.waitForTimeout(700);
  const s = await record(id);
  await shot(page, `t-${String(s?.stepIndex).padStart(2, '0')}-${id}`);
  try { await act(); } catch (e) { console.log(`  action for ${id} threw: ${e.message.split('\n')[0]}`); }
  await page.waitForTimeout(900);
}

console.log('\n--- panels open on ENTERING each step ---');
for (const e of entries) {
  const bad = e.open.length > 0 && !['customize-do', 'shelf-studio'].includes(e.step);
  console.log(`  ${bad ? 'STALE ' : '  ok  '} ${String(e.idx).padStart(2)} ${e.step} -> ${JSON.stringify(e.open)}`);
  if (bad) fails.push(`step '${e.step}' opened with a stale panel: ${JSON.stringify(e.open)}`);
}

dumpErrors(errors);
console.log('\n' + (fails.length ? `${fails.length} FAILED` : 'full tour ok'));
for (const f of fails) console.log('  - ' + f);
process.exit(0);
