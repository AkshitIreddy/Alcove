/**
 * scripts/gen-icons.mjs — render every shipped icon from the one SVG.
 *
 * `assets/brand/bellanote.svg` is the only source of truth for the mark. Tauri
 * wants a dozen sizes plus an .ico and an .icns, and hand-maintaining those is
 * how a brand ends up with three slightly different icons in one installer.
 *
 * Rendered through headless Chromium rather than a rasteriser library, for the
 * same reason the app's specimen boards are: it is the renderer the icon was
 * designed against, so what ships is what was looked at.
 *
 * Usage: node scripts/gen-icons.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = readFileSync(join(ROOT, 'assets/brand/bellanote.svg'), 'utf8');
const ICONS = join(ROOT, 'src-tauri/icons');

/**
 * Tauri's expected set. The Square*Logo files are the Windows Store tiles; the
 * plain sizes are the Linux/dev ones. Names must match exactly — the bundler
 * looks them up by filename.
 */
const TARGETS = [
  ['32x32.png', 32],
  ['64x64.png', 64],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
  ['Square30x30Logo.png', 30],
  ['Square44x44Logo.png', 44],
  ['Square71x71Logo.png', 71],
  ['Square89x89Logo.png', 89],
  ['Square107x107Logo.png', 107],
  ['Square142x142Logo.png', 142],
  ['Square150x150Logo.png', 150],
  ['Square284x284Logo.png', 284],
  ['Square310x310Logo.png', 310],
  ['StoreLogo.png', 50],
];

mkdirSync(ICONS, { recursive: true });
mkdirSync(join(ROOT, 'assets/brand'), { recursive: true });

const browser = await chromium.launch({ headless: true });

for (const [name, size] of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  // Transparent background: an app icon must not ship its own backdrop, or it
  // sits in a beige square on every dark taskbar.
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px">${SVG}</body>`,
  );
  await page.screenshot({
    path: join(ICONS, name),
    omitBackground: true,
  });
  await page.close();
  process.stdout.write(`  ${name} (${size}px)\n`);
}

// The 1024 master, for stores and the README.
const master = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await master.setContent(`<body style="margin:0;width:1024px;height:1024px">${SVG}</body>`);
await master.screenshot({
  path: join(ROOT, 'assets/brand/bellanote-1024.png'),
  omitBackground: true,
});
await master.close();
process.stdout.write('  bellanote-1024.png\n');

await browser.close();

/*
 * .ico and .icns are NOT generated here.
 *
 * Both are container formats holding several sizes, and writing them correctly
 * needs a real encoder — a PNG renamed to .ico works on some Windows surfaces
 * and silently fails on others, which is worse than not shipping one. Run
 * `npx @tauri-apps/cli icon assets/brand/bellanote-1024.png` to regenerate
 * those two from the master this script just wrote.
 */
process.stdout.write(
  '\ndone. For icon.ico / icon.icns run:\n' +
  '  npx @tauri-apps/cli icon assets/brand/bellanote-1024.png\n',
);
