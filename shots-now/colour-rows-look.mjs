/**
 * shots-now/colour-rows-look.mjs — look at the two part-colour rows up close.
 *
 * The gate lives in colour-rows.mjs; this is the eye. It scrolls each row into
 * view, measures every cell's real geometry (no rounding, so a 1px baseline
 * nudge cannot be mistaken for a wrap), and crops a shot of the row and of the
 * section around it.
 *
 * Usage: node shots-now/colour-rows-look.mjs [--url=http://localhost:1420]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://localhost:1420');
const OUT = 'shots-now/colour-rows';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', () => {});

const tryEval = async (fn, arg) => {
  for (let i = 0; ; i += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (i >= 3) throw e;
      await page.waitForTimeout(250);
    }
  }
};
const poll = async (fn, timeout = 90000, label = 'x') => {
  const t0 = Date.now();
  for (;;) {
    const v = await tryEval(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out: ${label}`);
    await page.waitForTimeout(200);
  }
};

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await tryEval(() => localStorage.clear());
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, 120000, 'bridge');
await poll(() => document.querySelector('.shelf-a11y button') !== null, 120000, 'a11y');
const skip = page.getByText('skip the tour');
if (await skip.count()) await skip.first().click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /studio/i }).first().click();
await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
await page.waitForTimeout(1500);

for (const [label, file] of [
  ['shelves', 'row-shelves'],
  ['wallpaper', 'row-wallpaper'],
]) {
  const row = page.locator(`[aria-label="${label} colours"]`);
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const geo = await tryEval((l) => {
    const r = document.querySelector(`[aria-label="${l} colours"]`);
    const box = r.getBoundingClientRect();
    return {
      row: { h: box.height, w: box.width },
      cells: [...r.children].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          what: el.className.includes('more') ? 'more' : 'dot',
          top: +(b.top - box.top).toFixed(2),
          left: +(b.left - box.left).toFixed(2),
          w: +b.width.toFixed(2),
          h: +b.height.toFixed(2),
          font: getComputedStyle(el).fontSize,
          family: getComputedStyle(el).fontFamily.split(',')[0],
          swatch: el.style.getPropertyValue('--nb-swatch') || '-',
          name: (el.getAttribute('aria-label') ?? '').split(': ')[1] ?? '-',
        };
      }),
    };
  }, label);
  console.log(`\n${label}: row ${geo.row.w.toFixed(1)}x${geo.row.h.toFixed(1)}`);
  for (const c of geo.cells) {
    console.log(
      `  ${c.what.padEnd(4)} top=${String(c.top).padStart(6)} left=${String(c.left).padStart(6)} ${c.w}x${c.h}  ${c.font} ${c.family}  ${c.swatch.padEnd(9)} ${c.name}`,
    );
  }
  const tops = [...new Set(geo.cells.map((c) => c.top))];
  console.log(`  distinct tops: ${tops.join(', ')}  → ${geo.row.h <= 30 ? 'ONE line' : 'WRAPPED'}`);
  // Two dots that paint the same hex are two dots that say the same thing.
  const swatches = geo.cells.filter((c) => c.what === 'dot').map((c) => c.swatch);
  const dupes = swatches.filter((s, i) => swatches.indexOf(s) !== i);
  console.log(`  distinct swatches: ${new Set(swatches).size}/${swatches.length}${dupes.length > 0 ? `  DUPES: ${[...new Set(dupes)].join(', ')}` : ''}`);

  // The row alone, and the section it sits in, so the control can be judged
  // against its neighbours rather than in isolation.
  await row.screenshot({ path: `${OUT}/${file}.png` });
  const section = page.locator(`[aria-label="${label} colours"]`).locator('xpath=ancestor::section[1]');
  await section.screenshot({ path: `${OUT}/${file}-section.png` });
  console.log(`  shot ${OUT}/${file}.png + -section.png`);
}

await browser.close();
