/** Read the real vocabulary counts out of the RUNNING dev server's modules. */
import { chromium } from 'playwright';

const b = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('  [console err]', m.text().slice(0, 200)); });
await p.goto('http://localhost:1420?fx=force', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 6000));

const out = await p.evaluate(async () => {
  const res = {};
  const grab = async (path, fn) => {
    try { res[path] = await fn(await import(path)); } catch (e) { res[path] = 'ERR ' + String(e).slice(0, 160); }
  };
  await grab('/src/art/customColour.ts', (m) => ({
    WASH_SWATCHES: m.WASH_SWATCHES.length,
    PALETTE_PAGE: m.PALETTE_PAGE,
    CUSTOM_COLOUR_LIMIT: m.CUSTOM_COLOUR_LIMIT,
  }));
  await grab('/src/editor/menu/registry.ts', (m) => ({
    INK_COLOR_TOKENS: Object.keys(m.INK_COLOR_TOKENS).length,
    HIGHLIGHT_WASHES: m.HIGHLIGHT_WASHES.length,
  }));
  await grab('/src/views/bookmarks.ts', (m) => ({
    colors: m.RIBBON_COLORS.length,
    cloths: m.RIBBON_CLOTHS.length,
    weights: m.RIBBON_WEIGHTS.length,
    tails: m.RIBBON_TAILS.length,
    materials: m.RIBBON_MATERIALS.length,
    charms: m.RIBBON_CHARMS.length,
    presets: m.RIBBON_PRESETS.length,
    families: m.RIBBON_FAMILIES.length,
  }));
  await grab('/src/art/themes.ts', (m) => ({ themes: m.THEMES ? Object.keys(m.THEMES).length : m.THEME_IDS.length }));
  await grab('/src/art/shelfDesign.ts', (m) => ({
    builds: m.BUILD_IDS.length, patterns: m.PATTERN_IDS.length, presets: m.SHELF_PRESETS.length,
  }));
  await grab('/src/art/wallpaperDesign.ts', (m) => ({
    presets: m.WALLPAPER_PRESETS.length, scales: m.WALLPAPER_SCALES.length,
    depths: m.WALLPAPER_DEPTHS.length, inks: m.WALLPAPER_INKS.length,
  }));
  await grab('/src/art/bookDesign.ts', (m) => ({ presets: m.BOOK_PRESETS.length }));
  await grab('/src/views/rail/designOptions.ts', (m) => ({
    roomPresets: m.ROOM_PRESETS ? m.ROOM_PRESETS.length : '?',
    groups: m.ROOM_PRESET_GROUPS.length,
  }));
  await grab('/src/views/rail/DesignStrip.tsx', (m) => ({ CAP: m.CAP }));
  await grab('/src/sound/soundSets.ts', (m) => ({
    sets: m.SOUND_SETS ? m.SOUND_SETS.length : Object.keys(m).join(','),
  }));
  await grab('/src/art/covers.ts', (m) => ({
    palettes: m.COVER_PALETTES ? m.COVER_PALETTES.length : '?',
    keys: Object.keys(m).filter((k) => /PALETTE|FRAME|MEDALLION|MATERIAL/i.test(k)).join(','),
  }));
  await grab('/src/art/charms.ts', (m) => ({
    keys: Object.keys(m).filter((k) => k === k.toUpperCase()).join(','),
  }));
  return res;
});
console.log(JSON.stringify(out, null, 2));
await b.close();
