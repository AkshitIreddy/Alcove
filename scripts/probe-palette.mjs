/**
 * scripts/probe-palette.mjs — visual QA driver for the chrome palette.
 *
 * Walks the key UI surfaces in EACH of the four UI themes (parchment,
 * pastel, botanical, night) and screenshots them, so a palette change is
 * judged on pixels, not vibes:
 *
 *   shelf      — dock, zoom pill, gear over the world (shot from the shelf)
 *   rail       — book icon rail with a live tooltip (hover)
 *   studio     — customize panel (chips, swatches, reroll)
 *   pagestyle  — page-style panel (pressed card state)
 *   qs         — quick switcher with a query + selected row
 *   ctx        — block context menu
 *   toast      — script toast (success or error tone, whichever the stub gives)
 *   insert     — Insert Script dialog
 *   settings   — settings sheet (per-section pigment rows)
 *
 * Flow: boot on the shelf, shoot every theme's shelf variant, open the book
 * ONCE, then flip data-theme per theme for the book-view surfaces (the
 * attribute drives all theme CSS — no fragile re-open per theme). Every
 * surface is guarded, so one failure logs and moves on.
 *
 * Output: qa/palette/<prefix>-<theme>-<surface>.png, prefix = PROBE_PREFIX
 * (default "before"; run with PROBE_PREFIX=after after a palette change).
 *
 * Against the ALREADY RUNNING dev server on :1420 (never starts one).
 * ?fx=force + state polling because SwiftShader throttles rAF.
 *
 * Usage: node scripts/probe-palette.mjs
 *        PROBE_PREFIX=after node scripts/probe-palette.mjs
 *        PROBE_THEMES=night,parchment PROBE_SURFACES=qs,ctx node scripts/probe-palette.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PREFIX = process.env.PROBE_PREFIX ?? 'before';
const THEMES = (process.env.PROBE_THEMES ?? 'parchment,pastel,botanical,night').split(',');
const SURFACES = (
  process.env.PROBE_SURFACES ?? 'shelf,rail,studio,pagestyle,qs,ctx,toast,insert,settings'
).split(',');
const OUT_DIR = fileURLToPath(new URL('../qa/palette/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
const out = (theme, name) => `${OUT_DIR}${PREFIX}-${theme}-${name}.png`;

const URL_BASE = process.env.PROBE_URL ?? 'http://localhost:1420';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

// Suppress the first-run guided tour (same trick as probe-uibugs): a fresh
// profile auto-starts the tour overlay and eats the pointer stream.
await page.route('**/src/features/tutorial/state.ts*', async (route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({ response: res, body: `${body}\n;readCompleted = async () => true;\n` });
});

const shot = async (theme, name, clip) => {
  try {
    await page.screenshot({ path: out(theme, name), ...(clip ? { clip } : {}), timeout: 90000 });
    console.log(`[shot] ${PREFIX}-${theme}-${name}.png`);
  } catch (e) {
    console.log(`[warn] screenshot ${theme}/${name} failed: ${String(e).slice(0, 140)}`);
  }
};

console.log(`== probe-palette: themes=${THEMES.join(',')} surfaces=${SURFACES.join(',')} prefix=${PREFIX} ==`);
const t0 = Date.now();
await page.goto(`${URL_BASE}/?fx=force`, { waitUntil: 'domcontentloaded', timeout: 180000 });

// Wait for the world, its data-ready promise, and a responsive event loop
// (the startup bake yields now, but the first seconds are still busy).
try {
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined, null, {
    timeout: 300000,
    polling: 500,
  });
  console.log(`[boot] world object after ${Date.now() - t0}ms`);
  await page.evaluate(() => {
    globalThis.__worldReady = false;
    void globalThis.__shelfWorld.ready.then(() => {
      globalThis.__worldReady = true;
    });
  });
  await page.waitForFunction(() => globalThis.__worldReady === true, null, {
    timeout: 300000,
    polling: 500,
  });
  console.log(`[boot] world.ready after ${Date.now() - t0}ms`);
} catch {
  console.log('[warn] world never became ready — continuing anyway');
}
for (let i = 0; i < 120; i += 1) {
  const latency = await page.evaluate(
    () => new Promise((resolve) => {
      const s = performance.now();
      setTimeout(() => resolve(Math.round(performance.now() - s)), 0);
    }),
  );
  if (latency < 60) {
    console.log(`[boot] event loop responsive (${latency}ms) after ${Date.now() - t0}ms`);
    break;
  }
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(2500);

/* ------------------------------ helpers ---------------------------------- */

const setTheme = async (theme) => {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(450); // let the var cascade + a throttled frame land
};

const closeEverywhere = async () => {
  // Esc cascades: menus, the quick switcher and the insert dialog all bail.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // Panels and the settings sheet have real close buttons.
  const panelClose = page.locator('.nb-rail-panel-close').first();
  if (await panelClose.isVisible().catch(() => false)) {
    await panelClose.dispatchEvent('click');
    await page.waitForTimeout(450);
  }
  const sheetClose = page.locator('.nbs-close').first();
  if (await sheetClose.isVisible().catch(() => false)) {
    await sheetClose.dispatchEvent('click');
    await page.waitForTimeout(450);
  }
};

const RAIL_CLIP = { x: 0, y: 100, width: 460, height: 800 };

/* --------------------------- stage: shelf (all themes) -------------------- */

if (SURFACES.includes('shelf')) {
  await page.waitForSelector('.shelf-dock', { timeout: 60000 }).catch(() => {});
  for (const theme of THEMES) {
    try {
      await setTheme(theme);
      await shot(theme, 'shelf');
    } catch (e) {
      console.log(`[warn] ${theme}/shelf failed: ${String(e).slice(0, 140)}`);
    }
  }
}

/* ------------------------------ open the book ----------------------------- */
let bookOpen = false;
for (let attempt = 0; attempt < 2 && !bookOpen; attempt += 1) {
  await page.waitForSelector('.shelf-a11y button', { state: 'attached', timeout: 30000 });
  await page.locator('.shelf-a11y button').first().dispatchEvent('click');
  bookOpen = await page
    .waitForSelector('.nb-prose', { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  if (!bookOpen) console.log(`[book] open attempt ${attempt + 1} missed — retrying`);
}
console.log(`[book] opened=${bookOpen} after ${Date.now() - t0}ms`);
await page.waitForTimeout(3000); // spread settle + first raster idle

/* ------------------------ book-view surfaces, per theme -------------------- */

for (const theme of THEMES) {
  console.log(`\n== theme: ${theme} ==`);
  try {
    await setTheme(theme);
  } catch (e) {
    console.log(`[warn] setTheme ${theme} failed: ${String(e).slice(0, 140)}`);
  }

  if (SURFACES.includes('rail')) {
    try {
      // Hover the stickers tool so the paper-chip tooltip is up.
      await page.waitForSelector('button[data-tool="stickers"]', { state: 'attached', timeout: 30000 });
      await page.locator('button[data-tool="stickers"]').first().hover({ timeout: 30000 });
      await page.waitForTimeout(600);
      await shot(theme, 'rail', RAIL_CLIP);
      await page.mouse.move(720, 450);
    } catch (e) {
      console.log(`[warn] ${theme}/rail failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('studio')) {
    try {
      await page.locator('button[data-tool="customize"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-book-studio', { state: 'attached', timeout: 30000 });
      await page.waitForTimeout(1400); // preview canvases paint
      await shot(theme, 'studio', RAIL_CLIP);
      await closeEverywhere();
    } catch (e) {
      console.log(`[warn] ${theme}/studio failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('pagestyle')) {
    try {
      await page.locator('button[data-tool="page-style"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-pagestyle', { state: 'attached', timeout: 30000 });
      await page.waitForTimeout(900);
      await shot(theme, 'pagestyle', RAIL_CLIP);
      await closeEverywhere();
    } catch (e) {
      console.log(`[warn] ${theme}/pagestyle failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('qs')) {
    try {
      await closeEverywhere();
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.nb-qs-bar', { timeout: 30000 });
      await page.keyboard.type('wel', { delay: 40 });
      await page.waitForTimeout(700);
      await shot(theme, 'qs');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } catch (e) {
      console.log(`[warn] ${theme}/qs failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('ctx')) {
    try {
      const prose = page.locator('.nb-prose').first();
      const box = await prose.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.4, box.y + 120, { button: 'right' });
        await page.waitForSelector('.nb-ctx-menu', { timeout: 15000 });
        await page.waitForTimeout(500);
        await shot(theme, 'ctx');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      } else {
        console.log('[warn] no .nb-prose box — ctx skipped');
      }
    } catch (e) {
      console.log(`[warn] ${theme}/ctx failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('toast')) {
    try {
      await closeEverywhere();
      // Two presses now: "copy AI spec" was a rail icon until four of them
      // were folded onto the "In and out" sheet (views/rail/SharePanel.tsx).
      await page.locator('button[data-tool="share"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-share-row[data-share="spec"]', { timeout: 15000 });
      await page.locator('.nb-share-row[data-share="spec"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-script-toast', { timeout: 15000 });
      await page.waitForTimeout(650);
      const tone = await page.evaluate(
        () => document.querySelector('.nb-script-toast')?.className ?? 'none',
      );
      console.log(`[toast] ${tone}`);
      await shot(theme, 'toast', { x: 760, y: 0, width: 680, height: 240 });
      await page.waitForTimeout(2600); // let it dismiss itself
    } catch (e) {
      console.log(`[warn] ${theme}/toast failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('insert')) {
    try {
      await closeEverywhere();
      // As above — the paste box is a row on the sheet, not a rail icon.
      await page.locator('button[data-tool="share"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-share-row[data-share="insert"]', { timeout: 15000 });
      await page.locator('.nb-share-row[data-share="insert"]').first().dispatchEvent('click');
      await page.waitForSelector('.nb-ins-card', { timeout: 15000 });
      await page.waitForTimeout(700);
      await shot(theme, 'insert');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } catch (e) {
      console.log(`[warn] ${theme}/insert failed: ${String(e).slice(0, 140)}`);
    }
  }

  if (SURFACES.includes('settings')) {
    try {
      await closeEverywhere();
      await page.locator('.nbs-gear-button').first().dispatchEvent('click');
      await page.waitForSelector('.nbs-sheet', { timeout: 30000 });
      await page.waitForTimeout(1600); // GSAP slide-in
      await shot(theme, 'settings');
      await closeEverywhere();
    } catch (e) {
      console.log(`[warn] ${theme}/settings failed: ${String(e).slice(0, 140)}`);
    }
  }
}

console.log(`\n== done in ${Date.now() - t0}ms ==`);
await browser.close();
