/**
 * shots-now/readme-hero.mjs — render readme-hero.html to docs/readme/img/hero.png.
 *
 * A file:// load rather than the dev server, because the banner deliberately
 * pulls the app's own bundled font files straight out of node_modules and the
 * shipped mark out of assets/brand — neither is served by Vite at a stable URL.
 * Captured at 2× and left at 2×: the README shows it at page width, so a 1× PNG
 * would be visibly soft on any recent display.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

mkdirSync('docs/readme/img', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1040, height: 420 },
  deviceScaleFactor: 2,
});
await page.goto(pathToFileURL(resolve('shots-now/readme-hero.html')).href, {
  waitUntil: 'networkidle',
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/readme/img/hero.png' });
console.log('done -> docs/readme/img/hero.png');
await browser.close();
