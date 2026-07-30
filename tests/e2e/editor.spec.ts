/**
 * Block editor basics on a fresh blank page: typing, click-below-typing,
 * slash-menu insert, drag-handle reorder, right-click context menu.
 */
import { expect, test } from 'playwright/test';
import { openBlankPage } from './helpers';

test('typing writes into the page', async ({ page }) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await page.keyboard.type('The quick brown fox jumps in ink');
  await expect(prose).toContainText('The quick brown fox jumps in ink');
});

test('clicking below the last line places the caret and typing works', async ({
  page,
}) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await page.keyboard.type('only line');

  // Click far below the single line of ink — on the empty paper.
  const paper = page.locator('.nb-leaf-paper[data-side="right"]');
  const box = await paper.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 80);
  await page.keyboard.type('typed-after-click-below');
  await expect(prose).toContainText('typed-after-click-below');
});

test('slash menu inserts a callout', async ({ page }) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await page.keyboard.type('/');
  await expect(page.locator('.nb-slash-menu')).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.type('callout');
  await expect(
    page.locator('.nb-slash-menu .nb-slash-item').first(),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.nb-slash-menu')).toBeHidden();
  await expect(prose.locator('.nb-callout')).toBeAttached();
});

test('drag handle reorders blocks', async ({ page }) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await page.keyboard.type('first block');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second block');

  const paragraphs = prose.locator('p');
  await expect(paragraphs).toHaveText(['first block', 'second block']);

  // Hover the first block so its drag handle appears, then drag the handle
  // below the second block.
  await paragraphs.first().hover();
  // One drag handle exists per leaf editor — scope to the right leaf.
  const handle = page.locator(
    '.nb-leaf-paper[data-side="right"] .nb-drag-handle',
  );
  await expect(handle).toBeVisible({ timeout: 15_000 });
  const handleBox = await handle.boundingBox();
  const targetBox = await paragraphs.nth(1).boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!handleBox || !targetBox) return;

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  // Cross the second block slowly so the drop cursor tracks the pointer.
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(
      targetBox.x + targetBox.width / 3,
      handleBox.y + ((targetBox.y + targetBox.height - handleBox.y) * i) / 8,
    );
    await page.waitForTimeout(50);
  }
  await page.mouse.up();

  await expect(paragraphs).toHaveText(['second block', 'first block'], {
    timeout: 15_000,
  });
});

test('right-click opens the block context menu', async ({ page }) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await page.keyboard.type('right-click me');
  await prose.locator('p', { hasText: 'right-click me' }).click({
    button: 'right',
  });
  await expect(page.locator('.nb-ctx-menu')).toBeVisible({ timeout: 15_000 });
});
