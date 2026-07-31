/**
 * scripts/probe-fx-board.mjs — a specimen board for the catalogue's CSS.
 *
 * Every new trim and every new piece of stationery, laid out at full size in
 * the app's own page colours and painted by the app's own `effects.css` (via
 * the `.nb-fx-specimen` scope the catalogue tiles use). Driving them one at a
 * time through the editor works but fights pagination; this is for LOOKING at
 * whether a stamp reads as a stamp.
 *
 * Usage: node scripts/probe-fx-board.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const URL_BASE = opt('url', 'http://localhost:1420');

mkdirSync('qa/ui', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1220, height: 1000 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('body', { timeout: 60000 });
await page.waitForTimeout(2500);

await page.evaluate(async () => {
  const { SQUIGGLE_DATA_URI } = await import('/src/editor/effects/blockEffects.ts');
  const v = await import('/src/script/vocab.ts');

  const root = document.createElement('div');
  root.id = 'fxboard';
  root.className = 'nb-fx-specimen';
  root.style.cssText =
    'position:fixed;inset:0;z-index:99999;overflow:auto;background:var(--paper-cream);' +
    'padding:26px 30px;column-count:3;column-gap:34px;font-family:var(--font-body);' +
    'font-size:17px;color:var(--ink-sepia);';
  document.body.append(root);

  const caption = (text) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'font-family:var(--font-ui);font-size:11px;letter-spacing:.06em;' +
      'text-transform:uppercase;color:var(--ink-line-soft);margin:16px 0 4px;' +
      'break-inside:avoid;';
    root.append(el);
  };

  const block = (attr, value, text) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:0 0 22px;break-inside:avoid;';
    const el = document.createElement('div');
    el.setAttribute(`data-${attr}`, String(value));
    if (attr === 'rotate') el.style.setProperty('--nb-rotate', `${value}deg`);
    if (attr === 'underline' && value === 'squiggle') {
      el.style.setProperty('--nb-squiggle', `url("${SQUIGGLE_DATA_URI}")`);
    }
    el.textContent = text;
    wrap.append(el);
    root.append(wrap);
  };

  const piece = (type, text, colour) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:0 0 26px;break-inside:avoid;';
    const el = document.createElement('div');
    el.setAttribute('data-type', type);
    if (colour) el.setAttribute('data-color', colour);
    const p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = text;
    el.append(p);
    wrap.append(el);
    root.append(wrap);
  };

  caption('paper & cards');
  piece('index-card', 'Mitochondria — the powerhouse, and why that phrase stuck.');
  piece('envelope', 'A letter from 1962, kept because of the stamp.', 'amber');
  piece('stamp', 'Second class', 'terracotta');
  piece('tag', 'Week three', 'moss');
  piece('marginalia', 'and the footnote nobody reads');

  caption('tape & trim');
  for (const value of v.TAPE_VALUES) block('tape', value, `tape — ${value}`);
  for (const value of v.WASHI_VALUES) block('washi', value, `washi — ${value}`);
  for (const value of v.SHADOW_VALUES) block('shadow', value, `shadow — ${value}`);
  for (const value of v.FRAME_VALUES) block('frame', value, `frame — ${value}`);
  for (const value of v.BLOCK_PAPER_VALUES) block('paper', value, `paper — ${value}`);
  for (const value of v.UNDERLINE_VALUES) block('underline', value, `underline — ${value}`);
  block('rotate', -2, 'rotate — tilted left');

  caption('lettering');
  for (const value of v.FONT_VALUES) block('font', value, `${value} — the quick brown fox`);
  for (const value of v.BLOCK_INK_VALUES) block('ink', value, `ink — ${value}`);
  for (const value of v.SIZE_VALUES) block('size', value, `size — ${value}`);
  for (const value of v.ALIGN_VALUES) block('align', value, `align — ${value}`);
});

await page.waitForTimeout(1200);
await page.locator('#fxboard').screenshot({ path: 'qa/ui/fx-board.png', animations: 'disabled' });
console.log('shot qa/ui/fx-board.png');
await browser.close();
