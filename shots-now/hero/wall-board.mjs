/**
 * shots-now/hero/wall-board.mjs — papers hung behind the REAL case.
 *
 * `room-firstrun-sweep.mjs --set=…` was the obvious tool and it lies about this
 * axis: its `wear()` polls `__shelfDesign()` for the shelf and the theme and
 * says nothing about the wallpaper, so a paper that arrives one bake late is
 * photographed as the paper before it. Half a twelve-paper run came back
 * mislabelled, which for a "which wall" decision is worse than no run.
 *
 * So this one polls the APPLIED `wallpaperKey` for the exact six-part spec
 * string before it takes the picture, and crops the wall band beside the case
 * rather than the whole screen — the decision is about the paper, and a
 * postage-stamp of it is what the picker already gets wrong.
 *
 * Usage: node shots-now/hero/wall-board.mjs id,id,id  out.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [idsArg, outArg] = process.argv.slice(2);
const IDS = String(idsArg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = outArg ?? 'shots-now/hero/wall-band';
mkdirSync(OUT, { recursive: true });

const CASE = { theme: 'walnut', build: 'scriptorium', pattern: 'guilloche' };

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });

const poll = async (fn, arg, timeout, label) => {
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
await poll(() => globalThis.__shelfDesign !== undefined, null, 120000, 'design bridge');
await poll(() => globalThis.__libraryPrefs !== undefined, null, 120000, 'prefs bridge');
for (let i = 0; i < 10; i += 1) {
  const skip = page.getByText('skip the tour');
  if ((await skip.count()) === 0) break;
  await skip.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
}
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1000);

for (const id of IDS) {
  /* The spec string the world bakes into its key, read from the art file so a
   * paper whose defaults change cannot silently start matching the wrong key. */
  const want = await page.evaluate(async (paperId) => {
    const m = await import('/src/art/wallpaperDesign.ts');
    const s = m.wallpaperSpec(paperId);
    return [s.pattern, s.scale, s.depth, s.ink, s.tone ?? 'auto', s.edge ?? 'crisp'].join('.');
  }, id);

  let got = null;
  for (let attempt = 0; attempt < 5 && !got; attempt += 1) {
    await page
      .evaluate(async (l) => {
        const m = await import('/src/art/wallpaperDesign.ts');
        await globalThis.__libraryPrefs.save({ theme: l.theme, shelf: null, wall: null });
        await globalThis.__shelfSaveDesign({
          build: l.build,
          pattern: l.pattern,
          wallpaper: m.wallpaperSpec(l.id),
        });
      }, { ...CASE, id })
      .catch(() => {});
    got = await poll(
      (w) => {
        const d = globalThis.__shelfDesign?.();
        if (!d) return null;
        return d.shelf === w.shelf && d.wallpaperKey.includes(w.key) ? d.wallpaperKey : null;
      },
      { shelf: `${CASE.build}.${CASE.pattern}`, key: want },
      10000,
      id,
    );
  }
  if (!got) {
    console.log(`  SKIP ${id} — never reached the wall (wanted ${want})`);
    continue;
  }
  await page.waitForTimeout(900);
  /* No `animations: 'disabled'` here. Playwright implements it by forcing every
   * CSS animation to its end state and then waiting for the page to settle, and
   * on the shelf — which never stops asking for frames — that wait runs out
   * instead of returning. The band being photographed is baked art, so there is
   * nothing in it for the flag to have steadied anyway. */
  await page.screenshot({
    path: `${OUT}/${id}.png`,
    caret: 'hide',
    timeout: 60000,
    clip: { x: 1246, y: 40, width: 254, height: 620 },
  });
  console.log(`  ${id}  ${got}`);
}

await browser.close();
