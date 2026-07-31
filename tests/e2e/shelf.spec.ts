/**
 * Shelf world: boot, book visibility, wheel zoom, zoom pill, drag-pan
 * momentum. The world renders to a WebGL canvas, so scale/position asserts
 * are optical (amber-spine tracking — see helpers.ts).
 */
import { expect, test, type Page } from 'playwright/test';
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

/* ========================================================================== *
 *              the window stays alive while the art lands                    *
 * ========================================================================== */

/**
 * The regression this guards.
 *
 * The painted pipeline paid for its look in CPU: a single spine measured 6.0s
 * on a software renderer, and with the whole stack on the main thread a cold
 * shelf produced **20 blocks over 100ms, 18.0s of frozen window and a 2.8s
 * single stall** — the app was unusable while it drew itself. Moving the
 * painting into `artOffload`'s worker pool took the same boot to 3 blocks and
 * 3.1s (`qa/_probes/probe-responsive.mjs`, 42 books). Most of that stack is
 * gone now and the case draws flat, but the tripwire stays: the spines still
 * bake, and a main-thread bake is still the way this regresses.
 *
 * The probe measures lag the only way a user experiences it: schedule a
 * zero-delay callback, and see how much LATER than that it actually ran.
 * Anything the main thread is doing shows up as the difference.
 *
 * Thresholds are deliberately loose. This runs on SwiftShader, on whatever
 * machine CI happens to be, against a Vite dev server that is also compiling
 * modules — it is a tripwire for "the freeze came back", not a benchmark.
 */
test('the shelf never freezes the window while it paints itself', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __lag?: number[][]; __t0?: number };
    w.__t0 = performance.now();
    w.__lag = [];
    const tick = (): void => {
      const t = performance.now();
      setTimeout(() => {
        w.__lag?.push([
          Math.round(t - (w.__t0 ?? 0)),
          Math.round(Math.max(0, performance.now() - t)),
        ]);
        tick();
      }, 0);
    };
    tick();
  });

  await gotoShelf(page);
  // Long enough for the case and every spine to land.
  await page.waitForTimeout(20_000);

  const lag = await page.evaluate(
    () => (window as unknown as { __lag?: number[][] }).__lag ?? [],
  );
  expect(lag.length, 'the lag sampler never ran').toBeGreaterThan(50);

  const worst = Math.max(...lag.map(([, d]) => d as number));
  const blocks = lag.filter(([, d]) => (d as number) > 400);
  const frozenMs = blocks.reduce((n, [, d]) => n + (d as number), 0);
  const detail = `worst=${worst}ms blocks>400ms=${blocks.length} frozen=${frozenMs}ms`;

  // No single stall anywhere near the 15.5s one that started this.
  expect(worst, `a single stall dominated the boot (${detail})`).toBeLessThan(6_000);
  // …and the boot as a whole is not a slideshow. Measured after the fix: 3
  // blocks / 3.1s; before: 20 blocks / 18.0s.
  expect(blocks.length, `too many long stalls (${detail})`).toBeLessThan(10);
  expect(frozenMs, `too much of the boot was frozen (${detail})`).toBeLessThan(12_000);

  // And once the storm is over the window is genuinely responsive: the last
  // five seconds of samples must contain nothing a user would feel.
  const t0 = Math.max(...lag.map(([t]) => t as number)) - 5_000;
  const tail = lag.filter(([t]) => (t as number) >= t0);
  const tailWorst = Math.max(0, ...tail.map(([, d]) => d as number));
  expect(tailWorst, 'the window was still hitching after the art landed').toBeLessThan(400);
});

/**
 * Boot the shelf with the QA hooks on.
 *
 * `?fx=force` is what publishes `globalThis.__shelfWorld`, and going through
 * the world is the only way to reach the LIVE singletons — a dynamic
 * `import()` of the same module URL from the test gets its own fresh instance
 * of the pool (with zero workers), which is a very convincing way to fail.
 */
async function gotoShelfQa(page: Page): Promise<void> {
  await page.goto('/?fx=force');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({ timeout: 45_000 });
  await page.waitForFunction(
    () => (globalThis as Record<string, unknown>)['__shelfWorld'] !== undefined,
    null,
    { timeout: 60_000, polling: 300 },
  );
}

test('the art worker pool is alive and taking the painting off the main thread', async ({
  page,
}) => {
  await gotoShelfQa(page);
  await page.waitForTimeout(15_000);

  const stats = await page.evaluate(() => {
    const world = (globalThis as Record<string, unknown>)['__shelfWorld'] as
      | Record<string, Record<string, { available?: boolean; stats?: () => unknown }>>
      | undefined;
    const pool = world?.['factory']?.['offload'];
    if (pool === undefined) return null;
    return { available: pool.available === true, ...(pool.stats?.() as object) } as {
      available: boolean;
      jobs: number;
      ms: number;
      workers: number;
    };
  });

  // If this fails, every painted spine is being drawn on the main thread and
  // the freeze is back — the app still WORKS, which is why the unit tests stay
  // green, so this is the only place that would notice.
  expect(stats, 'the spine factory has no art offload pool').not.toBeNull();
  expect(stats?.available, 'the art worker pool never started').toBe(true);
  expect(stats?.workers ?? 0, 'no painting threads were spawned').toBeGreaterThan(0);
  expect(stats?.jobs ?? 0, 'nothing was painted off the main thread').toBeGreaterThan(0);
});

