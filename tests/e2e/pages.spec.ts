/**
 * Page mechanics: fixed page capacity (the paper never grows a scrollbar,
 * overflow ink flows to a following page), turning a page by its corner,
 * "+ page".
 */
import { expect, test } from 'playwright/test';
import { openBlankPage, openBookView } from './helpers';

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

  // The earlier ink was not destroyed by the overflow: go back to the page it
  // was typed on and look for it.
  //
  // The route back is the table of contents, and it is chosen because it works
  // from where this test actually is — the caret is in the paper, and Ctrl+Alt+T
  // is one of the shortcuts that survives that. This used to press ArrowLeft in
  // a twelve-round loop, which had ALREADY stopped turning pages the moment the
  // test typed into the prose: the loop passed because the ink was found without
  // a single flip ever happening. A gate nobody had watched fail. Arrows do not
  // turn pages at all now, so it is replaced rather than repaired.
  //
  // Every seeded page has a heading, so the FIRST headingless "page N" row is
  // the blank page openBlankPage appended and this test typed onto — no page
  // number to go stale when the welcome book is re-cut.
  await page.keyboard.press('Control+Alt+t');
  const typedPage = page.locator('.nb-toc-row.is-page-row').first();
  await expect(typedPage).toBeVisible({ timeout: 30_000 });
  await typedPage.click();
  await expect(
    page.locator('.nb-prose', { hasText: 'line 1 of the overflow' }).first(),
    'typed ink vanished after the overflow',
  ).toBeVisible({ timeout: 30_000 });
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

/*
 * This was 'arrow keys turn the page', and the one true thing it said is worth
 * keeping: its comment read "Focus is outside any editor after load", which is
 * the only place in the repo that got the binding's real scope right. The
 * arrows turned a page in exactly that state and in no other — the reader met
 * the working version on opening a book and the dead version the moment they
 * touched the paper. Removed on the owner's ruling; a page is turned by its
 * corner curl or its outer edge, both of which FlipSurface owns as pointer
 * gestures over real coordinates (`.nb-page-curl` is `aria-hidden` and
 * `pointer-events: none` — it is the drawing, not the hit region).
 *
 * The test is INVERTED rather than deleted, because a removal that nothing
 * watches is a removal that comes back. It presses the arrows in the exact
 * state they used to work in, which is what makes it a gate and not a
 * tautology: with the caret outside the paper, → moved the book one spread.
 * If anyone reinstates the binding, this goes red on the first press.
 *
 * Watched failing, which is the only reason it is worth anything: run against
 * the app with `arrowFlipAction` already deleted, this still went 0 -> 1 on the
 * first ArrowRight. There was a SECOND arrow binding nobody had listed — a
 * window keydown listener inside `src/flip/FlipSurface.tsx` calling
 * `controller.flipNext()` directly, quite separate from BookView's. So this
 * test has already caught the exact defect it exists to catch.
 *
 * WHICH MEANS IT IS RED UNTIL THAT LISTENER GOES, and the red is a finding
 * rather than a flake: measured 0 -> 1 on every run of `--repeat-each=2
 * --retries=0`, never intermittently. (A single earlier run reported "flaky"
 * only because Playwright retries this suite for environment reasons and the
 * shared dev server was mid-HMR; the two clean runs after it both failed on
 * the same assertion.) `src/flip/FlipSurface.tsx` belongs to another lane in
 * flight — do not fix it from here, and do not quiet this test to match.
 */
test('arrow keys do not turn the page', async ({ page }) => {
  await openBookView(page);
  const stage = page.locator('.nb-spread-stage');
  await expect(stage).toHaveAttribute('data-spread-index', '0');

  // The state the old binding lived in — the caret is not in the paper, so an
  // arrow has nothing else to do. Asserted rather than assumed: if a later
  // change parks the caret in the page on open, the presses below would be
  // caret moves and this test would be proving nothing.
  //
  // The question is "outside any editor", NOT "on <body>". `openBookView` gets
  // here by clicking the dev view switcher, so focus is left on that BUTTON —
  // measured. Both bindings guarded on editability, never on body, so that is
  // what gets asserted.
  expect(
    await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof Element)) return true;
      return el.closest('.nb-prose, [contenteditable="true"], input, textarea') === null;
    }),
    'the caret is meant to be outside the paper after a book opens',
  ).toBe(true);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // Long enough that a flip, had one started, would be over and settled —
  // the animation is ~1s and SwiftShader throttles rAF, so this is generous
  // on purpose. Asserting immediately would pass on a turn still in flight.
  await page.waitForTimeout(3_000);
  await expect(stage).toHaveAttribute('data-spread-index', '0');

  // ← from the first spread cannot go anywhere anyway, so it is checked from
  // a spread the book can actually leave: one page in, by the route a reader
  // now has (the contents list), and then the arrows again.
  // Every row prints its page as "p.N", and the welcome book seeds five, so
  // p.3 is the second spread whatever the book is re-cut to say.
  await page.keyboard.press('Control+Alt+t');
  const thirdPage = page.locator('.nb-toc-row', { hasText: 'p.3' }).first();
  await expect(thirdPage).toBeVisible({ timeout: 30_000 });
  await thirdPage.click();
  await expect(stage).toHaveAttribute('data-spread-index', '1', {
    timeout: 30_000,
  });

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3_000);
  await expect(stage).toHaveAttribute('data-spread-index', '1');
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
