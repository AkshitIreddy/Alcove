/**
 * Taking a book off the shelf, and putting it back.
 *
 * Pulling a spine OPENS the book. It briefly did not: the flight came to rest
 * with the book held in front of the case on a little plate with two verbs on
 * it, "read it" and "put it back", and the reader threw that out — *"when i
 * click on a book no need for the menu with read it put it back, remove that
 * and just have back button on top left"*. So these tests guard the shape the
 * gesture has now:
 *
 *   - one gesture in (pull → the pages), with no card and no verbs anywhere;
 *   - one way out (the arrow top-left), which recedes once you are settled and
 *     comes back when you go looking for it;
 *   - and "wrong one" still answered, by Escape, while the book is in the air.
 *
 * The last of those is a ~600ms window on a real GPU, so the key is fired from
 * inside the page by a MutationObserver armed before the pull — a round trip
 * through the driver would be racing the flight, and a flaky test that guards
 * a real behaviour is worse than no test at all.
 *
 * The spine position is located optically (see helpers.ts).
 */
import { expect, test, type Page } from 'playwright/test';
import { WELCOME_TITLE, gotoShelf, waitForSpine } from './helpers';

/** The card that used to sit under a held book. Nothing may render it again. */
const HELD_CARD = '[data-testid="pulled-book-hand"]';

/** Every control this suite insists lives in the top-left corner. */
const CORNER_X = 480;
const CORNER_Y = 220;

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} has no box`).not.toBeNull();
  return box!;
}

/** Opacity as the browser has actually resolved it, mid-transition included. */
function opacityOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el === null ? -1 : Number.parseFloat(getComputedStyle(el).opacity);
  }, selector);
}

/**
 * Arm an in-page Escape for the instant the pulled cover mounts.
 *
 * Capture-phase document listener on the overlay's side, so a plain
 * `KeyboardEvent` dispatched at the document reaches it.
 */
async function escapeTheMomentItLeaves(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fire = (): void => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    };
    const here = (): boolean =>
      document.querySelector('[data-testid="pulled-book"]') !== null;
    if (here()) {
      fire();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!here()) return;
      observer.disconnect();
      fire();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

test('dragging a book off the shelf opens it — no card, no verbs', async ({
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

  // The flight runs straight on into the pages. Nothing is clicked here.
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1').first(),
  ).toBeVisible({ timeout: 30_000 });

  await expect(page.locator(HELD_CARD)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'read it' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'put it back' })).toHaveCount(0);
});

test('clicking a spine opens it too, and never rests on a card', async ({ page }) => {
  await gotoShelf(page);
  await waitForSpine(page);

  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');

  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(HELD_CARD)).toHaveCount(0);
});

test('Escape in mid-flight puts the book back instead of opening it', async ({
  page,
}) => {
  await gotoShelf(page);
  await waitForSpine(page);

  await escapeTheMomentItLeaves(page);
  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');

  // Back on the plank, and the shelf left exactly as it was found: no overlay,
  // no book view, and the spine painted on the canvas again.
  await expect(page.locator('[data-testid="pulled-book"]')).toHaveCount(0, {
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
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });

  // Go looking for the way back the way a reader does — into the corner.
  await page.mouse.move(40, 30);
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

test('the way back recedes once you are settled, and comes back on intent', async ({
  page,
}) => {
  await gotoShelf(page);
  await waitForSpine(page);
  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });

  // `opacityOf` reports -1 for a missing element, and -1 passes a "went
  // quiet" assertion by accident. Pin that it is there first.
  await expect(page.locator('.nb-back-button')).toHaveCount(1);

  // Park the pointer well away from the corner so the linger can expire.
  //
  // The recede is read off the WORDS, not off the button. It used to be read
  // off the button's own opacity ("< 0.5"), and that threshold was quietly the
  // thing being tested: element opacity multiplies the mark as well as the
  // plate, so anything low enough to pass took the arrow with it, and the demo
  // caught the result — `qa/demo/frames/f0869.png` is the only way out of a
  // book at 1.4:1 against the wall. spread.css now spends the recede on the
  // plate and the label and leaves the mark drawn, so what a receded button
  // means is "the words are gone", and that is what this asks.
  await page.mouse.move(900, 600);
  await expect
    .poll(() => opacityOf(page, '.nb-back-label'), {
      timeout: 20_000,
      message: 'the way back never got out of the way',
    })
    .toBeLessThan(0.1);

  // …and the other half of the same rule: getting out of the way is not the
  // same as disappearing. The button itself stays drawn the whole time.
  expect(await opacityOf(page, '.nb-back-button')).toBeGreaterThan(0.9);

  // Going near the corner brings it back, whole.
  await page.mouse.move(40, 30);
  await expect
    .poll(() => opacityOf(page, '.nb-back-label'), {
      timeout: 10_000,
      message: 'the way back never came back',
    })
    .toBeGreaterThan(0.9);

  // It never left the tab ring, receded or not.
  await expect(page.getByRole('button', { name: /back to shelf/i })).toBeVisible();
});

test('every way out sits in the top-left corner', async ({ page }) => {
  await gotoShelf(page);
  await waitForSpine(page);
  await page
    .locator('.shelf-a11y button', { hasText: WELCOME_TITLE })
    .dispatchEvent('click');
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });

  const back = await boxOf(page, '.nb-back-button');
  expect(back.x).toBeLessThan(CORNER_X);
  expect(back.y).toBeLessThan(CORNER_Y);

  // Focus mode carries its own exit, because it hides the rail that toggles
  // it. That one used to sit top-RIGHT, which is the complaint this whole
  // sweep came from. F9 rather than the rail icon: the corner of the view is
  // where the back arrow lives, and clicking to focus would leave the book.
  await page.keyboard.press('F9');
  await expect(page.locator('.nb-book-view.is-focus-mode')).toBeVisible({
    timeout: 10_000,
  });
  const exit = await boxOf(page, '.nb-focus-exit');
  expect(exit.x).toBeLessThan(CORNER_X);
  expect(exit.y).toBeLessThan(CORNER_Y);
});
