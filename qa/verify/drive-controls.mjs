/** Enumerate every back / close / leave control across every surface, with coordinates. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); };
const census = async (where) => {
  const rows = await p.evaluate(() => {
    const want = /back|close|leave|exit|dismiss|cancel|done/i;
    const out = [];
    for (const e of document.querySelectorAll('button,[role=button],a[href="#"]')) {
      const r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // must be inside the viewport
      if (r.x + r.width < 0 || r.x > innerWidth || r.y + r.height < 0 || r.y > innerHeight) continue;
      const label = (e.getAttribute('aria-label') || e.textContent || '').trim();
      if (!want.test(label)) continue;
      // owning surface = nearest panel/dialog ancestor
      const host = e.closest('.nb-rail-panel,.nbs-sheet,[role=dialog],.nb-book-view,.nb-shelf,body');
      const hr = host?.getBoundingClientRect() ?? { x: 0, width: innerWidth };
      out.push({ label: label.slice(0, 45), cls: e.className.toString().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), hostX: Math.round(hr.x), hostW: Math.round(hr.width), side: (r.x + r.width / 2 - hr.x) < hr.width / 2 ? 'LEFT' : 'RIGHT', op: cs.opacity });
    }
    return out;
  });
  console.log(`\n--- ${where} ---`);
  for (const r of rows) console.log(`  ${r.side.padEnd(5)} x=${String(r.x).padStart(5)} y=${String(r.y).padStart(4)}  ${r.label}   [${r.cls}]`);
  return rows;
};
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
await census('TOUR (first run)');
await shot('90-tour');
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
await census('SHELF');

await p.locator('button:has-text("studio")').first().click({ force: true });
await p.waitForTimeout(2500);
await census('SHELF > Library studio');

await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
await p.locator('button:has-text("trash")').first().click({ force: true });
await p.waitForTimeout(2000);
await census('SHELF > Trash');
await shot('91-trash');

await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
await p.locator('.nb-settings-fab, [aria-label*="ettings"]').first().click({ force: true }).catch(() => {});
await p.waitForTimeout(2500);
await census('SETTINGS');
await shot('92-settings');
await p.keyboard.press('Escape'); await p.waitForTimeout(1200);

// quick switcher
await p.keyboard.press('Control+KeyK'); await p.waitForTimeout(1500);
await census('QUICK SWITCHER');
await shot('93-quickswitch');
await p.keyboard.press('Escape'); await p.waitForTimeout(1000);

// book
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(2500);
await census('BOOK');
for (const tool of ['customize', 'catalogue', 'toc', 'history', 'ribbon-style']) {
  await p.locator(`.nb-rail-button[data-tool="${tool}"]`).click({ force: true }).catch(() => {});
  await p.waitForTimeout(1800);
  await census(`BOOK > ${tool}`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(800);
}
await p.locator('.nb-rail-button[data-tool="focus"]').click({ force: true });
await p.waitForTimeout(2000);
await census('BOOK > focus mode');
await shot('94-focus');
await b.close();
