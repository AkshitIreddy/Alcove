/** Is the rulings paint present before the page-style panel is ever opened? */
import { chromium } from 'playwright';
const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(240000);
await page.addInitScript(([k, t]) => { try { const raw = window.localStorage.getItem(k); const b = raw === null ? {} : JSON.parse(raw); const rows = Array.isArray(b.settings) ? b.settings : []; const at = rows.findIndex((r) => r?.key === t); const row = { key: t, value: '1' }; if (at >= 0) rows[at] = row; else rows.push(row); b.settings = rows; window.localStorage.setItem(k, JSON.stringify(b)); } catch {} }, ['notebook.stubdb.v1', 'appState:tutorialCompleted']);
await page.goto(`${URL_BASE}/?fx=force&dev=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => window.__nbTutorial?.stop?.());
await page.locator('.nb-dev-switcher button', { hasText: 'book' }).click();
await page.waitForSelector('.nb-prose', { timeout: 180000 });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const pages = [...document.querySelectorAll('.nb-page[data-style]')].map((p) => p.getAttribute('data-style'));
  const el = document.querySelector('.nb-page[data-style]');
  const prose = el?.querySelector('.nb-page-editor .ProseMirror');
  const before = prose ? getComputedStyle(prose).backgroundImage : 'MISSING';
  // Flip the attribute in the DOM only — this asks the STYLESHEET, not the store.
  el?.setAttribute('data-style', 'graph');
  const after = prose ? getComputedStyle(prose).backgroundImage : 'MISSING';
  const panelOpen = document.querySelector('.nb-pagestyle') !== null;
  const sheets = [...document.styleSheets].filter((s) => { try { return [...s.cssRules].some((r) => (r.selectorText ?? '').includes("nb-page[data-style='graph']")); } catch { return false; } }).length;
  return { pages, before, after: after.slice(0, 70), panelOpen, sheetsWithGraphRule: sheets };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
