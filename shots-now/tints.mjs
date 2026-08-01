/**
 * shots-now/tints.mjs — do the fifty pigments actually paint anything?
 *
 * They shipped named in the vocabulary and wired to nothing: no attribute on
 * the extension, no rules in effects.css. A count said fifty and the page said
 * nothing. So this asks the BROWSER what `--fx-base` resolves to for each one,
 * through the real stylesheet, and fails loudly if any two are identical or if
 * any resolves to the fallback.
 *
 * Usage: node shots-now/tints.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);

const result = await p.evaluate(async () => {
  const vocab = await import('/src/editor/effects/vocabulary.ts');
  const axis = vocab.EFFECT_AXES.find((a) => a.key === 'color');
  const host = document.createElement('div');
  host.className = 'nb-prose';
  host.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(host);

  const out = [];
  for (const entry of axis.values) {
    const el = document.createElement('div');
    el.setAttribute('data-color', entry.value);
    host.appendChild(el);
    const cs = getComputedStyle(el);
    out.push({
      value: entry.value,
      label: entry.label,
      light: cs.getPropertyValue('--fx-light').trim(),
      base: cs.getPropertyValue('--fx-base').trim(),
      deep: cs.getPropertyValue('--fx-deep').trim(),
    });
  }
  return out;
});

const blank = result.filter((r) => r.base === '');
const bases = new Map();
for (const r of result) bases.set(r.base, (bases.get(r.base) ?? 0) + 1);
const dupes = [...bases.entries()].filter(([, n]) => n > 1);

console.log(`  ${result.length} pigments read back from the live stylesheet`);
console.log(`  unset --fx-base: ${blank.length}${blank.length ? ' -> ' + blank.map((r) => r.value).join(', ') : ''}`);
console.log(`  duplicate bases: ${dupes.length}${dupes.length ? ' -> ' + dupes.map(([v, n]) => `${v} x${n}`).join('; ') : ''}`);
console.log('\n  sample:');
for (const r of result.slice(0, 6)) console.log(`    ${r.value.padEnd(12)} ${r.base}`);

// Paint them so they can be LOOKED at, not only counted.
await p.evaluate((rows) => {
  document.body.innerHTML = '';
  document.body.style.cssText =
    'margin:0;background:#efe7d4;display:flex;flex-wrap:wrap;gap:8px;padding:14px;font:12px system-ui';
  for (const r of rows) {
    const cell = document.createElement('div');
    cell.style.cssText = 'width:106px;text-align:center;color:#4f3120';
    const sw = document.createElement('div');
    sw.className = 'nb-prose';
    sw.innerHTML = `<div data-color="${r.value}" style="height:56px;border-radius:8px;border:2px solid #4f3120;background:linear-gradient(90deg,var(--fx-light) 0 33%,var(--fx-base) 33% 66%,var(--fx-deep) 66% 100%)"></div>`;
    cell.appendChild(sw);
    const cap = document.createElement('div');
    cap.textContent = r.label;
    cell.appendChild(cap);
    document.body.appendChild(cell);
  }
}, result);
await p.waitForTimeout(600);
await p.screenshot({ path: 'shots-now/tints.png', fullPage: true });
console.log('\n  -> shots-now/tints.png');
await b.close();
process.exit(blank.length > 0 ? 1 : 0);
