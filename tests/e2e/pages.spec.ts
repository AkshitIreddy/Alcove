/**
 * Page mechanics: fixed page capacity (the paper never grows a scrollbar,
 * overflow ink flows to a following page), arrow-key page turns, "+ page".
 */
import { expect, test } from 'playwright/test';
import { WELCOME_HEADING, openBlankPage, openBookView } from './helpers';

test('typing past capacity never grows a scrollbar', async ({ page }) => {
  const prose = await openBlankPage(page);
  await prose.click();

  // Enough paragraphs to bust the page capacity (~20 ruled lines).
  for (let i = 1; i <= 24; i += 1) {
    await page.keyboard.type(`line ${i} of the overflow torture test`);
    await page.keyboard.press('Enter');
  }

  // The paper never scrolls: no layer of either leaf is scrollable — fixed
  // page capacity is the contract (ink flows onward, paper does not grow).
  const scrolls = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('.nb-leaf-paper')];
    return leaves
      .flatMap((leaf) => [leaf, ...leaf.querySelectorAll('*')])
      .filter((el) => {
        const style = getComputedStyle(el);
        const scrollable =
          style.overflowY === 'auto' || style.overflowY === 'scroll';
        return scrollable && el.scrollHeight > el.clientHeight + 4;
      })
      .map((el) => el.className);
  });
  expect(scrolls).toEqual([]);

  // The earlier ink was not destroyed by the overflow: flip back until the
  // first typed line is on screen again. Flips are paced generously — during
  // the animation the leaves render as canvas snapshots, so DOM text checks
  // mid-flip would miss the page and over-flip past it.
  let found = false;
  for (let flip = 0; flip < 12 && !found; flip += 1) {
    found =
      (await page
        .locator('.nb-prose', { hasText: 'line 1 of the overflow' })
        .count()) > 0;
    if (found) break;
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(2_500);
  }
  expect(found, 'typed ink vanished after the overflow').toBe(true);
});

// Wave-2 fix (group B): the overflow drain now reports the caret's offset
// inside the carried blocks; BookView jumps the spread synchronously (no
// animated flip — that blur was how keystrokes got lost) and re-focuses the
// carried block's editor at the same offset (src/editor/instances registry).
test('caret carries across the page break while typing', async ({
  page,
}) => {
  const prose = await openBlankPage(page);
  await prose.click();
  for (let i = 1; i <= 30; i += 1) {
    await page.keyboard.type(`line ${i} of the overflow torture test`);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('overflow-marker-end');
  // The marker must land on a page (the one now under the carried caret).
  await expect(
    page.locator('.nb-prose', { hasText: 'overflow-marker-end' }).first(),
  ).toBeVisible({ timeout: 30_000 });
});

test('arrow keys turn the page', async ({ page }) => {
  await openBookView(page);

  // Focus is outside any editor after load; → flips to the next spread
  // (seeded pages 3-4: "Make it yours" / "Diagrams").
  await page.keyboard.press('ArrowRight');
  await expect(
    page.locator('.nb-prose h1', { hasText: 'Make it yours' }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.nb-prose h1', { hasText: 'Diagrams' }),
  ).toBeVisible({ timeout: 30_000 });

  // ← flips back to the welcome spread.
  await page.keyboard.press('ArrowLeft');
  await expect(
    page.locator('.nb-prose h1', { hasText: WELCOME_HEADING }),
  ).toBeVisible({ timeout: 30_000 });
});

test('+ page appends a page at the end of the book', async ({ page }) => {
  await openBookView(page);

  // 5 seeded pages → the new page becomes slot 6 and the view lands on the
  // last spread: seeded page 5 ("Your AI can write pages") on the left, the
  // fresh blank page on the right.
  await page.getByRole('button', { name: 'Add a page' }).click();
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1', {
      hasText: 'Your AI can write pages',
    }),
  ).toBeVisible({ timeout: 30_000 });

  const rightProse = page.locator('.nb-leaf-paper[data-side="right"] .nb-prose');
  await expect(rightProse).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await rightProse.innerText()).trim().length, {
      timeout: 30_000,
    })
    .toBeLessThan(2);
});
