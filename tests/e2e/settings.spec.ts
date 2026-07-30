/**
 * Settings: the panel opens from the gear button and the theme switcher
 * flips the document's data-theme attribute (settings.css maps it).
 */
import { expect, test } from 'playwright/test';

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
