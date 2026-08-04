import { attach, OUT } from './lib.mjs';
const { page } = await attach();

await page.screenshot({ path: `${OUT}/17z-card-buttons.png`, clip: { x: 1080, y: 610, width: 350, height: 110 } });
await page.screenshot({ path: `${OUT}/18z-book-and-slot.png`, clip: { x: 660, y: 70, width: 180, height: 250 } });
await page.screenshot({ path: `${OUT}/19z-case-arches.png`, clip: { x: 260, y: 60, width: 600, height: 260 } });

const design = await page.evaluate(() => {
  const d = window.__shelfDesign?.();
  return { build: d?.design?.build, pattern: d?.design?.pattern, wallpaperKey: d?.wallpaperKey?.slice?.(0, 80), libraryKey: d?.libraryKey?.slice?.(0, 80) };
});
console.log('applied design:', JSON.stringify(design));
const prefs = await page.evaluate(() => window.__libraryPrefs?.current?.() ?? null);
console.log('prefs:', JSON.stringify(prefs)?.slice(0, 400));
console.log('theme attrs:', JSON.stringify(await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, ink: document.documentElement.dataset.ink }))));
process.exit(0);
