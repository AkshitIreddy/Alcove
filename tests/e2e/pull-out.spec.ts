/**
 * Taking a book off the shelf, and putting it back.
 *
 * Pulling used to run straight on into the book view. It does not any more:
 * the book comes to rest HELD in front of the case with two verbs under it
 * ("read it" / "put it back"), and reading is a second, deliberate act. These
 * tests were written against the old one-gesture behaviour and are updated
 * rather than deleted — the thing they guard (a real pull gesture reaches a
 * real open book, and going back re-shelves it) is still worth guarding; only
 * the number of steps between the two ends changed.
 *
 * The spine position is located optically (see helpers.ts).
 */
import { expect, test, type Page } from 'playwright/test';
import { WELCOME_TITLE, gotoShelf, waitForSpine } from './helpers';

/** The held card, and the verb that opens the book. */
async function readTheHeldBook(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="pulled-book-hand"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'put it back' })).toBeVisible();
  await page.getByRole('button', { name: 'read it' }).click();
}

test('dragging a book off the shelf holds it, and "read it" opens it', async ({
  page,
}) => {
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

  // The flight ENDS held — it does not carry on into the pages.
  await readTheHeldBook(page);
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1').first(),
  ).toBeVisible({ timeout: 30_000 });
});

test('"put it back" shelves a held book without opening it', async ({ page }) => {
  await gotoShelf(page);
  await waitForSpine(page);

  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');
  await expect(page.locator('[data-testid="pulled-book-hand"]')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'put it back' }).click();

  // Back on the plank, and the shelf left exactly as it was found: no held
  // card, no scrim, and the spine painted on the canvas again.
  await expect(page.locator('[data-testid="pulled-book-hand"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator('.pulled-book-scrim')).toHaveCount(0);
  await expect(page.locator('.nb-book-view')).toHaveCount(0);
  await waitForSpine(page);
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
  await readTheHeldBook(page);
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
