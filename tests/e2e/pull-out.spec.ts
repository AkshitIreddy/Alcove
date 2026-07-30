/**
 * Pulling a book off the shelf opens the book view; going back shelves it
 * again. The spine position is located optically (see helpers.ts).
 */
import { expect, test } from 'playwright/test';
import { WELCOME_TITLE, gotoShelf, waitForSpine } from './helpers';

test('dragging a book off the shelf opens the book view', async ({ page }) => {
  await gotoShelf(page);
  const spine = await waitForSpine(page);

  // Grab the spine and pull it down off the shelf.
  await page.mouse.move(spine.cx, spine.cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(spine.cx + i * 3, spine.cy + i * 20);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();

  // Pull animation + overlay handoff → the focused book view.
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1').first(),
  ).toContainText('Welcome to Notebook', { timeout: 30_000 });
});

test('back to shelf returns the book', async ({ page }) => {
  await gotoShelf(page);
  await waitForSpine(page);

  // Open via the a11y mirror (drag-independent open path). The mirror is
  // rendered offscreen behind the canvas, so dispatch the activation instead
  // of a physical click.
  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: /back to shelf/i }).click();
  // Scope to the world canvas — the pulled-book cover overlay adds its own
  // canvas while the return animation plays.
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 30_000,
  });
  // The return animation lands the book back on its floor; the spine is
  // painted on the canvas again and the a11y mirror lists it.
  await waitForSpine(page);
  await expect(
    page.locator('.shelf-a11y button', { hasText: WELCOME_TITLE }),
  ).toBeAttached({ timeout: 30_000 });
});
