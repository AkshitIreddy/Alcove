/** Open a book by clicking its spine; audit the back control, bookmarks, tooltips. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };

// click the spine through the a11y mirror
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.waitForTimeout(3000);
await shot('20-after-spine-click');
const midState = await p.evaluate(() => ({
  hand: !!document.querySelector('[data-testid="pulled-book-hand"]'),
  readIt: [...document.querySelectorAll('button')].filter((x) => /read it|put it back/i.test(x.textContent)).map((x) => x.textContent.trim()),
  bookView: !!document.querySelector('.nb-book-view'),
  leaf: !!document.querySelector('.nb-leaf-paper'),
}));
console.log('after single click:', JSON.stringify(midState));

if (!midState.bookView) {
  // second step?
  const read = p.getByRole('button', { name: /read it/i });
  if ((await read.count()) > 0) { await read.click(); await p.waitForTimeout(3000); }
}
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(3000);
await shot('21-book-open');

// enumerate every back/close/leave/exit control
const controls = await p.evaluate(() => {
  const want = /back|close|leave|exit|dismiss|shelf|done/i;
  return [...document.querySelectorAll('button,[role=button]')].map((e) => {
    const r = e.getBoundingClientRect();
    const label = (e.getAttribute('aria-label') || e.textContent || '').trim();
    return { label: label.slice(0, 60), cls: e.className.toString().slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && r.height > 0 };
  }).filter((e) => e.vis && want.test(e.label));
});
console.log('BACK-ish controls in book view:');
for (const c of controls) console.log('  ', JSON.stringify(c));
fs.writeFileSync(`${OUT}/21-controls.json`, JSON.stringify(controls, null, 2));

// back-button fade behaviour
const fade = await p.evaluate(() => {
  const btn = document.querySelector('.nb-back-button');
  if (!btn) return 'missing';
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  return { cls: btn.className, opacity: cs.opacity, transform: cs.transform, x: Math.round(r.x), y: Math.round(r.y), away: btn.classList.contains('is-away') };
});
console.log('back button:', JSON.stringify(fade));
await p.waitForTimeout(6000);
const fade2 = await p.evaluate(() => {
  const btn = document.querySelector('.nb-back-button');
  const cs = getComputedStyle(btn);
  return { cls: btn.className, opacity: cs.opacity, away: btn.classList.contains('is-away') };
});
console.log('back button after 6s idle:', JSON.stringify(fade2));
await shot('22-book-idle');
await b.close();
