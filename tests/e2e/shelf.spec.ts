/**
 * Shelf world: boot, book visibility, wheel zoom, zoom pill, drag-pan
 * momentum. The world renders to a WebGL canvas, so scale/position asserts
 * are optical (amber-spine tracking — see helpers.ts).
 */
import { expect, test } from 'playwright/test';
import {
  WELCOME_TITLE,
  gotoShelf,
  screenDiffRatio,
  spineRegion,
  waitForSpine,
} from './helpers';

test('shelf loads with the welcome book visible', async ({ page }) => {
  await gotoShelf(page);

  // Exactly the seeded welcome book — the 24 old demo books are gone.
  const labels = await page.locator('.shelf-a11y button').allTextContents();
  expect(labels).toContain(WELCOME_TITLE);
  expect(labels).toHaveLength(1);

  // And its amber spine is actually painted on the canvas.
  const spine = await waitForSpine(page);
  expect(spine.height).toBeGreaterThan(40);
});

test('wheel zoom changes the world scale', async ({ page }) => {
  await gotoShelf(page);
  const before = await waitForSpine(page);
  const pct = page.locator('.shelf-zoom-pill__pct');
  const initialPct = Number.parseInt(await pct.innerText(), 10);

  // Plain wheel (no modifier) must zoom — scroll down to zoom out.
  await page.mouse.move(720, 450);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(120);
  }
  await expect
    .poll(async () => Number.parseInt(await pct.innerText(), 10), {
      timeout: 20_000,
      message: 'zoom readout never dropped after wheel-down',
    })
    .toBeLessThan(initialPct);
  // The painted world really shrank (not just the readout).
  await expect
    .poll(
      async () => (await spineRegion(page))?.height ?? 0,
      { timeout: 20_000, message: 'spine never shrank after zooming out' },
    )
    .toBeLessThan(before.height * 0.85);

  // Scroll up zooms back in.
  const shrunkPct = Number.parseInt(await pct.innerText(), 10);
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(120);
  }
  await expect
    .poll(async () => Number.parseInt(await pct.innerText(), 10), {
      timeout: 20_000,
      message: 'zoom readout never rose after wheel-up',
    })
    .toBeGreaterThan(shrunkPct);
});

test('zoom pill zooms the shelf', async ({ page }) => {
  await gotoShelf(page);
  const before = await waitForSpine(page);

  const pill = page.locator('.shelf-zoom-pill');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const pct = pill.locator('.shelf-zoom-pill__pct');
  const initialPct = Number.parseInt(await pct.innerText(), 10);
  expect(initialPct).toBeGreaterThan(0);

  // Zoom out twice: the readout drops and the painted world really shrinks.
  const zoomOut = pill.getByRole('button', { name: 'Zoom out' });
  await zoomOut.click();
  await zoomOut.click();
  await expect
    .poll(async () => Number.parseInt(await pct.innerText(), 10), {
      timeout: 20_000,
      message: 'zoom percentage readout never dropped',
    })
    .toBeLessThan(initialPct);
  await expect
    .poll(
      async () => (await spineRegion(page))?.height ?? 0,
      { timeout: 20_000, message: 'zoom pill did not zoom the world out' },
    )
    .toBeLessThan(before.height * 0.95);

  // Reset restores 100%.
  await pill.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await expect
    .poll(async () => Number.parseInt(await pct.innerText(), 10), {
      timeout: 20_000,
      message: 'reset never returned to 100%',
    })
    .toBe(100);
});

test('drag-pan scrolls the shelf and coasts with momentum', async ({ page }) => {
  await gotoShelf(page);
  const before = await waitForSpine(page);

  // Slow drag on an empty stretch of shelf: the world pans with the pointer
  // (the welcome book's spine bottom edge rises on screen).
  await page.mouse.move(400, 760);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(400, 760 - i * 10);
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  await expect
    .poll(
      async () => (await spineRegion(page))?.maxY ?? -1,
      { timeout: 20_000, message: 'drag never panned the shelf' },
    )
    .toBeLessThan(before.maxY - 30);

  // Fling: a fast flick, then release. Momentum keeps the world moving after
  // the pointer is up (frames keep changing), and it eventually comes to rest.
  await page.mouse.move(400, 700);
  await page.mouse.down();
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(400, 700 - i * 30);
  }
  await page.mouse.up();

  const justReleased = await page.screenshot({ type: 'png' });
  await page.waitForTimeout(500);
  const later = await page.screenshot({ type: 'png' });
  const coasting = await screenDiffRatio(page, justReleased, later);
  expect(coasting, 'no coasting after the pointer was released').toBeGreaterThan(
    0.01,
  );

  // ...and friction eventually stops it (the frame settles).
  await expect
    .poll(
      async () => {
        const s1 = await page.screenshot({ type: 'png' });
        await page.waitForTimeout(400);
        const s2 = await page.screenshot({ type: 'png' });
        return screenDiffRatio(page, s1, s2);
      },
      { timeout: 25_000, message: 'the fling never came to rest' },
    )
    .toBeLessThan(0.003);
});
