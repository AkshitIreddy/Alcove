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
  /** The fact this step is waiting on, or null for a read-only step. */
  fact: string | null;
  /** Has the current step's task been observed? */
  done: boolean;
  /** Ids of every step satisfied this run. */
  finished: string[];
}

declare global {
  interface Window {
    __nbTutorial?: {
      start: () => void;
      stop: () => void;
      next: () => void;
      back: () => void;
      jumpTo: (index: number) => void;
      /** Cancel the pending auto-advance so a step can be inspected. */
      hold: () => void;
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

test('opens on step one with all thirteen beats and a visible card', async ({ page }) => {
  await openTour(page);
  const s = await state(page);
  expect(s.stepIndex).toBe(0);
  expect(s.stepId).toBe('welcome');
  expect(s.total).toBe(13);

  const card = page.locator('.nbt-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.nbt-title')).toHaveText('Welcome to Bellanote');
  // Thirteen inked progress dots, exactly one current.
  await expect(page.locator('.nbt-dot')).toHaveCount(13);
  await expect(page.locator('.nbt-dot.is-current')).toHaveCount(1);
  // Welcome has no target -> anchorless, centred, no spotlight hole.
  expect(s.anchored).toBe(false);
  await expect(page.locator('.nbt-ring')).toHaveCount(0);
  // ...and nothing to do on it, so it must NOT show a checkbox to tick.
  expect(s.fact).toBeNull();
  await expect(page.locator('.nbt-task--none')).toBeVisible();
  await expect(page.locator('.nbt-task-mark')).toHaveCount(0);
});

test('next / back walk the tour and the scrim always covers the viewport', async ({ page }) => {
  await openTour(page);

  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'shelf-moves',
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

  // The scrim must never eat a click: almost every step asks the reader to do
  // something outside whatever box the spotlight happens to be framing.
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.nbt-scrim')!).pointerEvents),
  ).toBe('none');

  await page.locator('.nbt-btn', { hasText: 'back' }).click();
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(0);
  // Back is disabled on the first step — the tour cannot walk off the front.
  await expect(page.locator('.nbt-btn', { hasText: 'back' })).toBeDisabled();
});

test('the highlight is a straight rounded rect, never a wobbled trace', async ({ page }) => {
  await openTour(page);
  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'shelf-moves',
  );
  await settled(page);

  const d = await page.locator('.nbt-ring').last().getAttribute('d');
  expect(d).toBeTruthy();
  // Four arcs, four straight runs, no quadratics anywhere.
  expect(d!.match(/A /g)?.length).toBe(4);
  expect(d).not.toContain('Q ');

  // And the frame sits ON the box, not near it.
  const s = await state(page);
  const [x, y] = d!.match(/^M ([\d.-]+) ([\d.-]+)/)!.slice(1).map(Number);
  expect(y).toBeCloseTo(s.hole!.y, 0);
  expect(x).toBeGreaterThanOrEqual(s.hole!.x);
  expect(x).toBeLessThanOrEqual(s.hole!.x + 20);
});

test('a step goes green only once the tour has SEEN the reader do it', async ({ page }) => {
  await openTour(page);
  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'shelf-moves',
  );
  await settled(page);

  // Nothing done yet: an empty checkbox, an amber card, no tick on the dot.
  let s = await state(page);
  expect(s.fact).toBe('shelf-moved');
  expect(s.done).toBe(false);
  await expect(page.locator('.nbt-task')).toBeVisible();
  await expect(page.locator('.nbt-task.is-done')).toHaveCount(0);
  await expect(page.locator('.nbt-dot.is-done')).toHaveCount(0);

  // Do the thing the step asks for — zoom the shelf.
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, -220);

  await expect
    .poll(async () => (await state(page)).finished.includes('shelf-moves'), {
      timeout: 20_000,
      message: 'the tour never noticed the shelf move',
    })
    .toBe(true);
  await page.evaluate(() => window.__nbTutorial!.hold());

  s = await state(page);
  expect(s.done).toBe(true);
  await expect(page.locator('.nbt-task.is-done')).toBeVisible();
  await expect(page.locator('.nbt-task-tick')).toBeVisible();
  await expect(page.locator('.nbt-dot.is-done')).toHaveCount(1);
  await expect(page.locator('.nbt-layer')).toHaveAttribute('data-tutorial-done', 'true');

  // The tick survives walking away and coming back.
  await page.evaluate(() => window.__nbTutorial!.next());
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(2);
  await page.evaluate(() => window.__nbTutorial!.back());
  await expect.poll(async () => (await state(page)).done, { timeout: 20_000 }).toBe(true);
});

test('finishing a step walks the tour on by itself', async ({ page }) => {
  await openTour(page);
  await page.evaluate(() => window.__nbTutorial!.jumpTo(1));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'shelf-moves',
  );
  await settled(page);

  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, -220);

  // No button pressed — completion alone carries the reader forward.
  await expect
    .poll(async () => (await state(page)).stepId, {
      timeout: 30_000,
      message: 'a satisfied step never advanced on its own',
    })
    .toBe('open-a-book');
});

test('the spotlight actually lands on the left rail in the book view', async ({ page }) => {
  await openTour(page);
  await page.evaluate(() => window.__nbTutorial!.stop());

  // Open the seeded Welcome book through the shelf's accessible book list.
  // Taking a book off the shelf is not the same as reading it: the flight
  // ends with the book HELD in front of the case, and "read it" is the second
  // half of the gesture (see PulledBookOverlay).
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('.shelf-a11y button').length), {
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (document.querySelector('.shelf-a11y button') as HTMLButtonElement).click();
  });
  await page.locator('[data-testid="pulled-book-read"]').click({ timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.nb-rail') !== null), {
      timeout: 60_000,
    })
    .toBe(true);

  await page.evaluate(() => window.__nbTutorial!.start());
  await page.evaluate(() => window.__nbTutorial!.jumpTo(3));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'the-rail',
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
  // Step 3 (the rail) has no target on the shelf.
  await page.evaluate(() => window.__nbTutorial!.jumpTo(3));
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'the-rail',
  );
  await frames(page, 8); // give the tracker every chance to find a target
  const s = await state(page);
  expect(s.anchored).toBe(false);
  expect(s.hole).toBeNull();
  await expect(page.locator('.nbt-card')).toBeVisible();
  await expect(page.locator('.nbt-card.nbt-card--wide')).toBeVisible();
  // ...and it says where the reader needs to be, rather than pointing at air.
  await expect(page.locator('.nbt-scene')).toContainText('open a book');
  // The copy still teaches, and the tour still advances.
  await page.locator('.nbt-btn--primary').click();
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(4);
});

/*
 * The tour used to take Space, the arrows, Backspace and PageUp/Down as
 * navigation — every one of them a key its own steps ask the reader to use.
 * Only the buttons, Enter and Escape may move it now.
 */
test('the tour never steals a key one of its steps is teaching', async ({ page }) => {
  await openTour(page);

  for (const key of [
    'Space',
    'ArrowRight',
    'ArrowDown',
    'PageDown',
    'ArrowLeft',
    'ArrowUp',
    'Backspace',
    'PageUp',
  ]) {
    await page.evaluate(() => (document.querySelector('.nbt-card') as HTMLElement).focus());
    await page.keyboard.press(key);
    await frames(page, 3);
    expect((await state(page)).stepIndex, `${key} moved the tour`).toBe(0);
  }

  await page.evaluate(() => (document.querySelector('.nbt-card') as HTMLElement).focus());
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await state(page)).stepIndex, { timeout: 20_000 }).toBe(1);

  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state(page)).running, { timeout: 20_000 }).toBe(false);
  await expect(page.locator('.nbt-card')).toHaveCount(0);
});

test('finishing persists completion, and reset makes it offer itself again', async ({ page }) => {
  await openTour(page);
  await page.evaluate(() => window.__nbTutorial!.jumpTo(12));
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
  await page.locator('.nbt-dot').nth(10).click();
  await expect.poll(async () => (await state(page)).stepId, { timeout: 20_000 }).toBe(
    'quick-switch',
  );
  await expect(page.locator('.nbt-dot').nth(10)).toHaveClass(/is-current/);
});
