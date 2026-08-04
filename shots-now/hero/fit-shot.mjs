/**
 * shots-now/hero/fit-shot.mjs — the whole case, crest to plinth.
 *
 * The first-run screen opens at 80% and cuts the case off below floor four, so
 * every board so far has judged a bookcase by its top half. The crest is the
 * one edge a build really changes AND `world.ts` mirrors the same bitmap into
 * the plinth — so a build with a flat crest also has a flat foot, and that is
 * half a decision nothing has looked at.
 *
 * Usage: node shots-now/hero/fit-shot.mjs '<json array of looks>' <outdir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const LOOKS = JSON.parse(process.argv[2]);
const OUT = process.argv[3] ?? 'shots-now/hero/fit';
mkdirSync(OUT, { recursive: true });

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

for (const look of LOOKS) {
  const want = await page.evaluate(async (l) => {
    const m = await import('/src/art/wallpaperDesign.ts');
    const s = m.wallpaperSpec(l.paper);
    await globalThis.__libraryPrefs.save({ theme: l.theme, shelf: null, wall: null });
    await globalThis.__shelfSaveDesign({ build: l.build, pattern: l.pattern, wallpaper: s });
    return [s.pattern, s.scale, s.depth, s.ink, s.tone ?? 'auto', s.edge ?? 'crisp'].join('.');
  }, look);
  const ok = await poll(
    (w) => {
      const d = globalThis.__shelfDesign?.();
      return d && d.shelf === w.shelf && d.wallpaperKey.includes(w.key) ? 1 : null;
    },
    { shelf: `${look.build}.${look.pattern}`, key: want },
    30000,
  );
  if (!ok) {
    console.log(`  SKIP ${look.id}`);
    continue;
  }
  /* "fit" fits the WIDTH — it lands at ~101% and shows less of the case than
   * the opening 80% does. Plain wheel is the zoom gesture, so wheel out until
   * the plinth is on screen. */
  await page.mouse.move(750, 500);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/${look.id}.png`, caret: 'hide', timeout: 60000 });
  console.log(`  ${look.id}`);
}

await browser.close();
