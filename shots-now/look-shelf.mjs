/**
 * shots-now/look-shelf.mjs — the REAL shelf, populated, at the resting zoom,
 * with the wall behind it. A specimen board says a module draws well in
 * isolation; this says what the reader is actually handed.
 *
 * Everything goes through the world's own bridges (`__shelfSeedBooks`,
 * `__shelfSaveDesign`, `__shelfSaveBinding`) — never a probe-side
 * `import('/src/data/…')`, which can land on a second copy of the store on a
 * dev server that has served HMR updates. See CLAUDE.md "Seam QA".
 *
 * Usage: node shots-now/look-shelf.mjs --url=http://[::1]:1420
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL_BASE = opt('url', 'http://[::1]:1420');
const OUT = 'shots-now/roster';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(globalThis.__shelfWorld), null, { polling: 400, timeout: 180000 });
await page.waitForTimeout(2500);

/* Get the tour out of the way — it covers the whole case. */
const skip = page.getByText('skip the tour', { exact: false }).first();
if (await skip.count()) await skip.click({ timeout: 5000 }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(800);

/* A full case, floors 0..3, so a reader's-eye view of the bindings exists. */
const TITLES = [
  'Ashmole', 'Bestiary', 'Chapter House', 'Dovecote', 'Ephemera', 'Fenland',
  'Glasshouse', 'Hornbeam', 'Inkwell', 'Juniper', 'Kelp', 'Lanternry',
  'Marginalia', 'Nightjar', 'Orrery', 'Pomander', 'Quarto', 'Rookery',
];
for (const floor of [0, 1, 2, 3]) {
  await page.evaluate(
    async ([t, f]) => {
      await globalThis.__shelfSeedBooks(t.map((x) => `${x} ${f}`), f);
    },
    [TITLES, floor],
  );
}
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/shelf-full.png` });
console.log('shelf-full — books:', (await page.evaluate(() => globalThis.__shelfVisibleBooks().length)));

/* The wall, with REAL preset ids read out of the module in the page. */
const walls = await page.evaluate(async () => {
  const wp = await import('/src/art/wallpaperDesign.ts');
  const all = wp.WALLPAPER_PRESETS.map((p) => p.id);
  return {
    count: all.length,
    picks: ['plain-parchment', wp.DEFAULT_WALLPAPER_ID, all[20], all[45], all[80], all[110]].filter(Boolean),
  };
});
console.log('wallpapers:', walls.count, 'picking', walls.picks.join(', '));
for (const id of walls.picks) {
  await page.evaluate((w) => globalThis.__shelfSaveDesign({ wallpaper: w }), id);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/shelf-wall-${id}.png` });
  const applied = await page.evaluate(() => globalThis.__shelfDesign());
  console.log('  wall', id, '→ applied', applied.design.wallpaper, 'key', String(applied.wallpaperKey).slice(0, 60));
}

/* Carpentry, at shelf pitch, in the app. */
await page.evaluate((w) => globalThis.__shelfSaveDesign({ wallpaper: w }), 'plain-parchment');
const cases = await page.evaluate(async () => {
  const sd = await import('/src/art/shelfDesign.ts');
  return { builds: sd.BUILD_IDS.length, patterns: sd.PATTERN_IDS.length };
});
console.log('carpentry:', JSON.stringify(cases));
for (const [build, pattern] of [
  ['plank', 'none'],
  ['plank', 'greekKey'],
  ['plank', 'rope'],
  ['plank', 'gadroon'],
  ['orangery', 'eggDart'],
  ['bookbinder', 'guilloche'],
]) {
  await page.evaluate(([b, p]) => globalThis.__shelfSaveDesign({ build: b, pattern: p }), [build, pattern]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/shelf-case-${build}-${pattern}.png` });
  const applied = await page.evaluate(() => globalThis.__shelfDesign());
  console.log('  case', build, pattern, '→', applied.design.build, applied.design.pattern, '|', applied.shelf);
}

await browser.close();
