/**
 * Guided tutorial (src/features/tutorial) — end-to-end behaviour.
 *
 * These specs drive the tour through `window.__nbTutorial`, the debug surface
 * the overlay installs on mount, and poll for state rather than sleeping:
 * headless Chromium runs on SwiftShader, where requestAnimationFrame (and so
 * every GSAP tween) is heavily throttled.
 *
 * The overlay may not be mounted by the app shell yet — App.tsx is owned
 * elsewhere — so `openTour()` falls back to the feature's own dev mount over
 * the Vite dev server. Once App.tsx renders <TutorialOverlay /> the fallback
 * simply never fires (mountTutorialDev is a no-op when one already exists).
 */
import { expect, test, type Page } from 'playwright/test';

interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourState {
  running: boolean;
  stepIndex: number;
  stepId: string;
  total: number;
  anchored: boolean;
  anchor: TourRect | null;
  hole: TourRect | null;
  card: TourRect;
  side: string;
  arrow: boolean;
}

declare global {
  interface Window {
    __nbTutorial?: {
      start: () => void;
      stop: () => void;
      next: () => void;
      back: () => void;
      jumpTo: (index: number) => void;
      isCompleted: () => Promise<boolean>;
      reset: () => Promise<void>;
      replay: () => Promise<void>;
      getState: () => TourState;
    };
  }
}

const state = (page: Page): Promise<TourState> =>
  page.evaluate(() => window.__nbTutorial!.getState());

/** Load the app, make sure the tour overlay exists, and open it. */
async function openTour(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.shelf-root') !== null), {
      timeout: 60_000,
      message: 'shelf never mounted',
    })
    .toBe(true);

  const mounted = await page.evaluate(
    () => typeof window.__nbTutorial?.getState === 'function',
  );
  if (!mounted) {
    await page.evaluate(async () => {
      const mod = (await import('/src/features/tutorial/devMount.tsx')) as {
        mountTutorialDev: (o?: { start?: boolean }) => () => void;
      };
      mod.mountTutorialDev({ start: false });
    });
  }
  await expect
    .poll(() => page.evaluate(() => typeof window.__nbTutorial?.getState), {
      timeout: 45_000,
      message: 'window.__nbTutorial never appeared',
    })
    .toBe('function');

  await page.evaluate(() => window.__nbTutorial!.start());
  await expect.poll(async () => (await state(page)).running, { timeout: 20_000 }).toBe(true);
}

/**
 * Wait a few animation frames — the overlay resolves targets in a rAF loop,
 * which SwiftShader throttles hard, so "anchor is null" right after a jump
 * means "not resolved yet", not "no target".
 */
async function frames(page: Page, count = 4): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = (): void => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

/** Wait until the GSAP spotlight tween has landed on the current anchor. */
async function settled(page: Page): Promise<void> {
  await frames(page);
  await expect
    .poll(
      async () => {
        const s = await state(page);
        if (s.anchor === null) return s.hole === null;
        if (s.hole === null) return false;
        return (
          Math.abs(s.hole.x - s.anchor.x) < 2 && Math.abs(s.hole.width - s.anchor.width) < 2
        );
      },
      { timeout: 40_000, message: 'spotlight never settled on the anchor' },
    )
    .toBe(true);
}

test('opens on step one with all eleven beats and a visible card', async ({ page }) => {
  await openTour(page);
  const s = await state(page);
  expect(s.stepIndex).toBe(0);
  expect(s.stepId).toBe('welcome');
  expect(s.total).toBe(11);

  const card = page.locator('.nbt-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.nbt-title')).toHaveText('Welcome to your library');
  // Eleven inked progress dots, exactly one current.
  await expect(page.locator('.nbt-dot')).toHaveCount(11);
  await expect(page.locator('.nbt-dot.is-current')).toHaveCount(1);
  // Welcome has no target -> anchorless, centred, no spotlight hole.
  expect(s.anchored).toBe(false);
  await expect(page.locator('.nbt-ring')).toHaveCount(0);
});

test('next / back walk the tour and the scrim always covers the viewport', async ({ page }) => {
  await openTour(page);

  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'endless-shelf',
  );
  await settled(page);

  // Spotlight punched out of a full-viewport scrim.
  const scrim = page.locator('.nbt-scrim');
  await expect(scrim).toHaveAttribute('fill-rule', 'evenodd');
  const box = await scrim.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await expect(page.locator('.nbt-ring')).toHaveCount(2); // halo + ink

  await page.locator('.nbt-btn', { hasText: 'back' }).click();
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(0);
  // Back is disabled on the first step — the tour cannot walk off the front.
  await expect(page.locator('.nbt-btn', { hasText: 'back' })).toBeDisabled();
});

test('the spotlight actually lands on the left rail in the book view', async ({ page }) => {
  await openTour(page);
  await page.evaluate(() => window.__nbTutorial!.stop());

  // Open the seeded Welcome book through the shelf's accessible book list.
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.shelf-a11y button').length), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (document.querySelector('.shelf-a11y button') as HTMLButtonElement).click();
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.nb-rail') !== null), {
      timeout: 60_000,
    })
    .toBe(true);

  await page.evaluate(() => window.__nbTutorial!.start());
  await page.evaluate(() => window.__nbTutorial!.jumpTo(3));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'left-rail',
  );
  await expect
    .poll(async () => (await state(page)).anchored, {
      timeout: 30_000,
      message: 'the rail was never resolved as a spotlight target',
    })
    .toBe(true);
  await settled(page);

  const s = await state(page);
  expect(s.anchored).toBe(true);
  const rail = await page.locator('.nb-rail').boundingBox();
  // The hole is the rail's box plus the step's padding — never somewhere else.
  expect(Math.abs(s.anchor!.x - rail!.x)).toBeLessThan(20);
  expect(Math.abs(s.anchor!.y - rail!.y)).toBeLessThan(20);
  expect(Math.abs(s.anchor!.height - rail!.height)).toBeLessThan(40);
  // ...and the card sits beside it, never on top of it.
  const overlapX =
    Math.min(s.card.x + s.card.width, s.anchor!.x + s.anchor!.width) -
    Math.max(s.card.x, s.anchor!.x);
  expect(overlapX).toBeLessThanOrEqual(0);
  expect(s.arrow).toBe(true); // a pencil arrow bridges the gap
});

test('a step whose target is missing degrades to a centred card, never a dead end', async ({
  page,
}) => {
  await openTour(page);
  // Step 3 (left rail) has no target on the shelf.
  await page.evaluate(() => window.__nbTutorial!.jumpTo(3));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'left-rail',
  );
  await frames(page, 8); // give the tracker every chance to find a target
  const s = await state(page);
  expect(s.anchored).toBe(false);
  expect(s.hole).toBeNull();
  await expect(page.locator('.nbt-card')).toBeVisible();
  await expect(page.locator('.nbt-card.nbt-card--wide')).toBeVisible();
  // The copy still teaches, and the tour still advances.
  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(4);
});

test('keyboard drives the whole tour: arrows, Enter, Escape', async ({ page }) => {
  await openTour(page);

  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(2);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(1);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).running, { timeout: 20_000 }).toBe(false);
  await expect(page.locator('.nbt-card')).toHaveCount(0);
});

test('finishing persists completion, and reset makes it offer itself again', async ({ page }) => {
  await openTour(page);
  await page.evaluate(() => window.__nbTutorial!.jumpTo(10));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'youre-set',
  );
  await page.locator('.nbt-btn--primary').click(); // "I'm ready"
  await expect.poll(async () => (await state(page)).running, { timeout: 20_000 }).toBe(false);

  const completedAfterFinish = await page.evaluate(() => window.__nbTutorial!.isCompleted());
  expect(completedAfterFinish).toBe(true);

  // resetTutorial() clears the marker so first-run auto-start fires again.
  const completedAfterReset = await page.evaluate(async () => {
    await window.__nbTutorial!.reset();
    return window.__nbTutorial!.isCompleted();
  });
  expect(completedAfterReset).toBe(false);

  // ...and replay reopens it at step one.
  await page.evaluate(() => window.__nbTutorial!.replay());
  await expect.poll(async () => (await state(page)).running, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(0);
});

test('clicking a progress dot jumps straight to that step', async ({ page }) => {
  await openTour(page);
  await page.locator('.nbt-dot').nth(9).click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'quick-switcher',
  );
  await expect(page.locator('.nbt-dot').nth(9)).toHaveClass(/is-current/);
});
