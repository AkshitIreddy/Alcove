/**
 * Settings: the panel opens from the gear button and the theme switcher
 * flips the document's data-theme attribute (settings.css maps it).
 *
 * Wave-2 (group F): the panel now carries controls for every wave-2
 * setting — shelf (wood stain / wallpaper / wheel mode / sort), ambience
 * (soundscape / typing sounds / hourly chime), writing (cursor style /
 * thumbnails strip), and system (backup folder + back-up-now, launch into
 * last book, tray quick capture, perf HUD). Browser runs use the in-memory
 * db stub, so desktop-only rows must show their "desktop app" hints.
 */
import { expect, test, type Page } from 'playwright/test';

async function openSettings(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.nbs-gear-button').click();
  await expect(page.locator('.nbs-sheet')).toBeVisible({ timeout: 15_000 });
}

test('settings panel opens and closes', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nbs-gear-button').click();
  const sheet = page.locator('.nbs-sheet');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText('Settings');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden({ timeout: 15_000 });
});

test('theme switch flips data-theme on the document', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'parchment', {
    timeout: 30_000,
  });

  await page.locator('.nbs-gear-button').click();
  await expect(page.locator('.nbs-sheet')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'night', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'night');

  // And back (also proves the chips reflect + persist reactive state).
  await page.getByRole('button', { name: 'parchment', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'parchment');
});

test('wave-2 shelf & ambience chips reflect selections', async ({ page }) => {
  await openSettings(page);
  const sheet = page.locator('.nbs-sheet');

  // Library & shelf: wood stain, wallpaper, wheel mode, shelf sort.
  const cherry = sheet.getByRole('button', { name: 'cherry', exact: true });
  await cherry.click();
  await expect(cherry).toHaveAttribute('aria-pressed', 'true');

  const stars = sheet.getByRole('button', { name: 'stars', exact: true });
  await stars.click();
  await expect(stars).toHaveAttribute('aria-pressed', 'true');

  const scroll = sheet.getByRole('button', {
    name: 'scrolls floors',
    exact: true,
  });
  await scroll.click();
  await expect(scroll).toHaveAttribute('aria-pressed', 'true');

  const recent = sheet.getByRole('button', { name: 'recent first', exact: true });
  await recent.click();
  await expect(recent).toHaveAttribute('aria-pressed', 'true');

  // Ambience: soundscape chip + typing sounds / hourly chime toggles.
  const rain = sheet.getByRole('button', { name: 'rain', exact: true });
  await rain.click();
  await expect(rain).toHaveAttribute('aria-pressed', 'true');

  for (const name of ['typing sounds', 'hourly chime']) {
    const toggle = sheet.getByRole('switch', { name, exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  }
});

test('writing controls: cursor style chips + thumbnails toggle', async ({
  page,
}) => {
  await openSettings(page);
  const sheet = page.locator('.nbs-sheet');

  const quill = sheet.getByRole('button', { name: 'quill', exact: true });
  await quill.click();
  await expect(quill).toHaveAttribute('aria-pressed', 'true');

  const thumbs = sheet.getByRole('switch', {
    name: 'page thumbnails strip',
    exact: true,
  });
  await expect(thumbs).toHaveAttribute('aria-checked', 'false');
  await thumbs.click();
  await expect(thumbs).toHaveAttribute('aria-checked', 'true');
});

test('system rows: desktop-only hints in the browser + last-book toggle', async ({
  page,
}) => {
  await openSettings(page);
  const sheet = page.locator('.nbs-sheet');

  // Backup folder + back-up-now are desktop-only: disabled with a hint.
  await expect(
    sheet.getByRole('button', { name: 'choose…', exact: true }),
  ).toBeDisabled();
  await expect(
    sheet.getByRole('button', { name: 'back up now', exact: true }),
  ).toBeDisabled();
  await expect(sheet).toContainText('available in the desktop app');

  // Tray quick capture is desktop-only too.
  await expect(
    sheet.getByRole('switch', { name: 'tray quick capture', exact: true }),
  ).toBeDisabled();

  // Launch-into-last-book works everywhere (persistence is db-backed).
  const lastBook = sheet.getByRole('switch', {
    name: 'launch into last book',
    exact: true,
  });
  await expect(lastBook).toHaveAttribute('aria-checked', 'false');
  await lastBook.click();
  await expect(lastBook).toHaveAttribute('aria-checked', 'true');
});

test('perf HUD toggle shows and hides the overlay', async ({ page }) => {
  await openSettings(page);
  const sheet = page.locator('.nbs-sheet');
  const hud = page.locator('.nb-perfhud');
  await expect(hud).toHaveCount(0);

  const toggle = sheet.getByRole('switch', {
    name: 'performance HUD',
    exact: true,
  });
  await toggle.click();
  await expect(hud).toBeVisible({ timeout: 15_000 });
  // The rAF meter must produce a real FPS readout (SwiftShader is slow but
  // never zero for long) — poll until the number appears.
  await expect
    .poll(
      async () => {
        const text = await hud.innerText();
        const m = /(\d+) fps/.exec(text);
        return m !== null ? Number(m[1]) : -1;
      },
      { timeout: 20_000, message: 'perf HUD never reported an FPS number' },
    )
    .toBeGreaterThan(0);
  await expect(hud).toContainText('tex');

  await toggle.click();
  await expect(hud).toHaveCount(0);
});
