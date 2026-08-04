import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const poll = async (fn, arg=null, t=20000) => { const t0=Date.now(); for(;;){ const v=await p.evaluate(fn,arg); if(v) return v; if(Date.now()-t0>t) return null; await p.waitForTimeout(150);} };
await p.goto('http://localhost:1420/?fx=force', { waitUntil:'domcontentloaded', timeout:120000 });
await poll(() => document.querySelector('.nbs-gear-button') !== null, null, 120000);
const s = p.getByText('skip the tour'); if (await s.count()) await s.first().click();
await p.waitForTimeout(800);
await p.locator('.nbs-gear-button').click();
await poll(() => { const el = document.querySelector('.nbs-sheet'); return el !== null && getComputedStyle(el).visibility === 'visible'; });
await p.waitForTimeout(600);
for (const name of ['Night Porter', 'Pressed Flowers', 'Almost Nothing']) {
  const shut = await p.evaluate((n) => [...document.querySelectorAll('.nbs-seg-chip')].some(c => c.textContent.trim() === n && c.getClientRects().length > 0), name);
  await p.locator('.nbs-find-input').fill(name);
  await poll((w) => document.querySelector('.nbs-find-input')?.value === w, name);
  await p.waitForTimeout(250);
  const after = await p.evaluate((n) => ({
    chip: [...document.querySelectorAll('.nbs-seg-chip')].some(c => c.textContent.trim() === n && c.getClientRects().length > 0),
    rows: [...document.querySelectorAll('.nbs-row')].filter(r=>r.getClientRects().length>0).map(r=>r.querySelector('.nbs-row-label')?.textContent?.trim()),
  }), name);
  console.log(`"${name}": visible at rest=${shut} -> after search chip=${after.chip} rows=${JSON.stringify(after.rows)} ${(!shut && after.chip) ? 'OK the fold opened' : (shut ? 'n/a already shown' : 'FAIL unreachable')}`);
}
await p.locator('.nbs-find-input').fill('');
await b.close();
