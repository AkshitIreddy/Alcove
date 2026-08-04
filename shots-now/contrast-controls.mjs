/**
 * shots-now/contrast-controls.mjs — LOOK at the controls the contrast sweep
 * just repainted, in the rooms it says they were unreadable in.
 *
 * `tests/control-contrast.test.ts` measures. This board is the other half:
 * a number can say 5.24:1 and the button can still look wrong, and the one
 * that started all of this — the tour's primary "next" — is the first control
 * a new reader ever presses.
 *
 * Drives the running dev server (npm run dev, :1420):
 *   node shots-now/contrast-controls.mjs
 *
 * Writes shots-now/contrast/<surface>-<theme>-<ink>.png.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'contrast');
const URL = 'http://localhost:1420/?fx=force';

/* The four rooms, and the ink that measured worst in each of them. */
const ROOMS = [
  ['parchment', 'sepia'],
  ['parchment', 'ink-blue'],
  ['botanical', 'ink-blue'],
  ['night', 'sepia'],
  ['night', 'ink-blue'],
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Dress the room exactly the way `features/settings/apply.ts` does — the
 * `data-theme` room, the `data-ink` remap, then the inline custom properties.
 *
 * `appearance.ts` is pure, so importing it over the dev server is safe (the
 * second-module-copy trap in CLAUDE.md is about STATE, and this module has
 * none); everything it returns is written straight onto <html>, which is the
 * one element the whole app reads its palette from.
 */
async function setRoom(page, theme, ink) {
  await page.evaluate(
    async ([themeId, inkId]) => {
      const a = await import('/src/features/settings/appearance.ts');
      const root = document.documentElement;
      root.setAttribute('data-theme', a.themeBase(themeId));
      root.setAttribute('data-ink', inkId);
      root.setAttribute('data-appearance', themeId);
      for (const [k, v] of Object.entries(a.appearanceTokens(themeId, inkId, null))) {
        root.style.setProperty(k, v);
      }
    },
    [theme, ink],
  );
  await wait(120);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('  console:', m.text().slice(0, 160));
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // The tour, mounted straight in — the greeting step is the card with the
  // length chooser AND the primary button on it.
  await page.evaluate(async () => {
    const mod = await import('/src/features/tutorial/devMount.tsx');
    mod.mountTutorialDev({ start: true });
    window.__nbTutorial?.hold?.();
  });
  await page.waitForSelector('.nbt-card', { timeout: 10000 });
  await page.waitForTimeout(400);

  for (const [theme, ink] of ROOMS) {
    await setRoom(page, theme, ink);
    await page.waitForTimeout(200);
    const card = page.locator('.nbt-card').first();
    await card.screenshot({ path: join(OUT, `tour-greeting-${theme}-${ink}.png`) });
    console.log(`tour-greeting-${theme}-${ink}.png`);
  }

  // The same card once a task has landed: the moss "done" button and the
  // ticked task box, both repainted.
  await page.evaluate(() => {
    document.querySelector('.nbt-btn--primary')?.classList.add('is-done');
    document.querySelector('.nbt-task')?.classList.add('is-done');
    document.querySelector('.nbt-choice-btn')?.classList.add('is-picked');
  });
  for (const [theme, ink] of ROOMS) {
    await setRoom(page, theme, ink);
    await page.waitForTimeout(200);
    const card = page.locator('.nbt-card').first();
    await card.screenshot({ path: join(OUT, `tour-done-${theme}-${ink}.png`) });
    console.log(`tour-done-${theme}-${ink}.png`);
  }

  // The studio's chosen card: a gilt face carrying a name, a blurb and a tick,
  // all three of which were repainted. Driven by clicking, so the shot is of
  // the surface a reader actually reaches.
  await page.evaluate(() => window.__nbTutorial?.stop?.());
  await page.waitForTimeout(300);
  const skip = page.getByRole('button', { name: /skip|not now|later/i });
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  await page.getByRole('button', { name: /studio/i }).first().click();
  await page.waitForSelector('.nb-library-studio', { timeout: 20000 });
  await page.waitForTimeout(900);
  // The strip shows the shortlist; the full-axis SHEET is where .nb-pick-card
  // lives, and the "N more" tile is the only way in.
  const more = page.locator('button.nb-strip-more').first();
  if (await more.count()) {
    await more.scrollIntoViewIfNeeded();
    await more.click();
    await page.waitForTimeout(900);
  }
  const chosen = page.locator('.nb-pick-card.is-active').first();
  if (await chosen.count()) {
    for (const [theme, ink] of ROOMS) {
      await setRoom(page, theme, ink);
      await page.waitForTimeout(250);
      await chosen.screenshot({ path: join(OUT, `pick-card-${theme}-${ink}.png`) });
      console.log(`pick-card-${theme}-${ink}.png`);
    }
  } else {
    console.log('  (no active pick card on screen — studio shot skipped)');
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
