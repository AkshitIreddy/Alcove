import { attach, OUT } from './lib.mjs';
const { page } = await attach();

const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

const themes = await page.evaluate(() => window.__nbAppearance?.themes?.() ?? null);
console.log('themes bridge:', JSON.stringify(themes)?.slice(0, 300));

for (const theme of ['day', 'night', 'dusk', 'sepia']) {
  for (const ink of ['sepia', 'graphite', 'ink-blue']) {
    const got = await page.evaluate(([t, i]) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.dataset.ink = i;
      const el = document.querySelector('.nbt-btn--primary');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    }, [theme, ink]);
    if (!got) { console.log(`${theme}/${ink}: no button`); continue; }
    const r = ratio(parse(got.color), parse(got.bg));
    const flag = r < 4.5 ? (r < 3 ? '  <-- FAIL' : '  <-- low') : '';
    console.log(`  ${theme.padEnd(6)} / ${ink.padEnd(9)} next: ${got.color} on ${got.bg} = ${r.toFixed(2)}:1${flag}`);
  }
}

// restore
await page.evaluate(() => { document.documentElement.dataset.theme = 'night'; document.documentElement.dataset.ink = 'ink-blue'; });
process.exit(0);
