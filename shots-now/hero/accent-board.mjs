/**
 * shots-now/hero/accent-board.mjs — the chrome accent, ON the room it has to sit in.
 *
 * The accent is the one axis of the opening screen that is NOT library art: it
 * paints the settings seal, the dock's primary button and every "this one" in
 * the app. A swatch strip cannot decide it, because the question is not whether
 * the colour is handsome — it is whether the seal still reads as a CONTROL when
 * it is lying on a warm cream wall two feet from a walnut case. Terracotta on
 * lapis and terracotta on walnut are two different answers.
 *
 * So: the real app, wearing the new room, and only the accent ramp swapped —
 * derived with `art/palette`'s own arithmetic (`washFaces` / `intoWashBand`),
 * which is exactly what `appearanceTokens` does for the non-shipped rooms. A
 * candidate photographed with hand-mixed rungs would be a candidate nothing
 * could ship.
 *
 * Usage: node shots-now/hero/accent-board.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots-now/hero/accent';
mkdirSync(OUT, { recursive: true });

const ROOM = { theme: 'walnut', build: 'scriptorium', pattern: 'guilloche', paper: 'trellis-gilt' };

/** id → the one authored hex. Everything else about the ramp is derived. */
const CANDIDATES = [
  ['00-terracotta-today', '#c96f4a'],
  ['01-moss-icon', '#7d915c'],
  ['02-mossdark-icon', '#4f6138'],
  ['03-verdigris', '#1f6b60'],
  ['04-seagreen', '#2f8478'],
  ['05-chartroom', '#3a5666'],
  ['06-slate', '#5f7d8c'],
  ['07-honey', '#b8791c'],
  ['08-burnt', '#96421d'],
  ['09-foxglove', '#8a3a5c'],
  ['10-bottle', '#3f6b46'],
  ['11-inkblue', '#2f4a6b'],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });

const poll = async (fn, arg, timeout) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(200);
  }
};

await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto('http://localhost:1420/?fx=force', { waitUntil: 'domcontentloaded', timeout: 120000 });
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000);
await poll(() => globalThis.__libraryPrefs !== undefined, null, 120000);
for (let i = 0; i < 10; i += 1) {
  const skip = page.getByText('skip the tour');
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
}
await page.keyboard.press('Escape').catch(() => {});

const want = await page.evaluate(async (l) => {
  const m = await import('/src/art/wallpaperDesign.ts');
  const s = m.wallpaperSpec(l.paper);
  await globalThis.__libraryPrefs.save({ theme: l.theme, shelf: null, wall: null });
  await globalThis.__shelfSaveDesign({
    build: l.build,
    pattern: l.pattern,
    wallpaper: s,
  });
  return [s.pattern, s.scale, s.depth, s.ink, s.tone ?? 'auto', s.edge ?? 'crisp'].join('.');
}, ROOM);
const got = await poll(
  (w) => {
    const d = globalThis.__shelfDesign?.();
    return d && d.shelf === w.shelf && d.wallpaperKey.includes(w.key) ? d.wallpaperKey : null;
  },
  { shelf: `${ROOM.build}.${ROOM.pattern}`, key: want },
  30000,
);
console.log('room applied:', got);
await page.waitForTimeout(1500);

for (const [id, hex] of CANDIDATES) {
  const ramp = await page.evaluate(async (h) => {
    const p = await import('/src/art/palette.ts');
    const a = await import('/src/features/settings/appearance.ts');
    const base = p.intoWashBand(h);
    const faces = p.washFaces(h);
    /* `inkFor` is module-private, and the accent INK is not what this board is
     * deciding — the seal and the dock plate are. `deep` is the darkest rung the
     * ramp has, so using it here shows the type no LIGHTER than it will ship. */
    const ink = faces.deep;
    const on = a.contrastRatio('#fdf9f0', faces.deep) >= a.contrastRatio('#2b1a10', faces.deep)
      ? '#fdf9f0'
      : '#2b1a10';
    const set = {
      '--accent-light': faces.light,
      '--accent': base,
      '--accent-deep': faces.deep,
      '--accent-ink': ink,
      '--ink-accent': ink,
      '--on-accent': on,
    };
    for (const [k, v] of Object.entries(set)) document.documentElement.style.setProperty(k, v);
    return set;
  }, hex);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${OUT}/${id}.png`,
    caret: 'hide',
    timeout: 60000,
    clip: { x: 0, y: 230, width: 420, height: 720 },
  });
  console.log(`  ${id}  ${hex} → ${ramp['--accent-deep']} / ${ramp['--accent-light']}`);
}

await browser.close();
