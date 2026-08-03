/** Tooltips via real Tab, ribbons panel, native-title census. */
import { chromium } from 'playwright';

const OUT = 'qa/verify';
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
const shot = async (n) => { await p.screenshot({ path: `${OUT}/${n}.png`, timeout: 60000 }); console.log('  shot', n); };
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
for (let i = 0; i < 4; i++) {
  const s = p.locator('text=skip the tour').first();
  if ((await s.count()) === 0) break;
  await s.click({ force: true, timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(700);
}
await p.locator('.shelf-a11y button').first().dispatchEvent('click');
await p.locator('.nb-leaf-paper').first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
await p.waitForTimeout(2500);

// Tab until a rail button has focus, then look for .nb-tip
await p.locator('body').click({ position: { x: 700, y: 940 } }).catch(() => {});
let found = null;
for (let i = 0; i < 30; i++) {
  await p.keyboard.press('Tab');
  await p.waitForTimeout(260);
  const st = await p.evaluate(() => {
    const a = document.activeElement;
    const tip = document.querySelector('.nb-tip');
    return {
      active: (a?.getAttribute('aria-label') || a?.textContent || a?.tagName || '').trim().slice(0, 40),
      activeCls: a?.className?.toString?.().slice(0, 40) ?? '',
      focusVisible: a?.matches?.(':focus-visible') ?? false,
      tip: tip ? { text: tip.textContent.trim().slice(0, 60), cls: tip.className, x: Math.round(tip.getBoundingClientRect().x), y: Math.round(tip.getBoundingClientRect().y), w: Math.round(tip.getBoundingClientRect().width) } : null,
    };
  });
  if (st.tip) { found = { i, ...st }; break; }
  if (i < 3) console.log('  tab', i, JSON.stringify(st));
}
console.log('KEYBOARD TOOLTIP:', JSON.stringify(found));
await shot('33-tip-tab');

// hover a rail button for the pointer path
await p.locator('.nb-rail-button[data-tool="ribbon-style"]').hover({ force: true });
await p.waitForTimeout(1200);
const hoverTip = await p.evaluate(() => {
  const t = document.querySelector('.nb-tip');
  if (!t) return null;
  const cs = getComputedStyle(t.querySelector('.nb-tip__card') ?? t);
  const r = t.getBoundingClientRect();
  return { text: t.textContent.trim().slice(0, 60), bg: cs.backgroundColor, border: cs.border, font: cs.fontFamily.slice(0, 50), radius: cs.borderRadius, x: Math.round(r.x), y: Math.round(r.y) };
});
console.log('HOVER TOOLTIP:', JSON.stringify(hoverTip));
await shot('34-tip-hover');

// native title census in the live DOM
const titles = await p.evaluate(() => {
  const withTitle = [...document.querySelectorAll('[title]')].filter((e) => e.getBoundingClientRect().width > 0);
  return { totalInDom: document.querySelectorAll('[title]').length, visible: withTitle.length, sample: withTitle.slice(0, 12).map((e) => ({ t: e.getAttribute('title').slice(0, 30), cls: e.className.toString().slice(0, 40) })) };
});
console.log('NATIVE TITLES:', JSON.stringify(titles, null, 1));

// ribbons panel
await p.locator('.nb-rail-button[data-tool="ribbon-style"]').click({ force: true });
await p.waitForTimeout(3000);
await shot('35-ribbons');
const rp = await p.evaluate(() => {
  const panel = [...document.querySelectorAll('.nb-rail-panel')].find((e) => e.getAttribute('aria-hidden') === 'false');
  if (!panel) return 'none';
  const r = panel.getBoundingClientRect();
  const close = panel.querySelector('.nb-rail-panel-close');
  return {
    label: panel.getAttribute('aria-label'),
    panel: { x: Math.round(r.x), w: Math.round(r.width) },
    close: close ? { x: Math.round(close.getBoundingClientRect().x) } : null,
    buttons: panel.querySelectorAll('button').length,
    more: [...panel.querySelectorAll('button')].filter((x) => /more/i.test(x.textContent)).map((x) => x.textContent.trim()),
    sections: [...panel.querySelectorAll('h3,.nb-studio-label,.nbs-label,legend')].map((x) => x.textContent.trim().slice(0, 30)),
  };
});
console.log('RIBBON PANEL:', JSON.stringify(rp, null, 1));
await b.close();
