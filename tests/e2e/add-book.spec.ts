/**
 * Add-book affordances + studio wiring E2E.
 *
 * Boots with ?fx=force so world.ts exposes its QA hooks (`__shelfWorld`,
 * `__libraryPrefs`, `__shelfAddSpot`). Covers the four ways a book comes into
 * being — the rail's "new book", the dashed ghost slot on the plank, the
 * right-click shelf menu, and the first-run invitation's siblings — plus the
 * "add floor" flight and the rail's studio button opening the Library studio.
 *
 * Persistence is asserted across a real page reload: in browser mode the
 * stub SQLite layer persists its tables to localStorage (src/data/db.ts), so
 * a created book and a picked theme survive exactly like they do in Tauri.
 * Everything polls — SwiftShader throttles rAF hard.
 */
import { expect, test, type Page } from 'playwright/test';

const NEW_BOOK_TITLE = 'Untitled';

/** Load the shelf with the QA world hook exposed. */
async function gotoShelfQa(page: Page): Promise<void> {
  await page.goto('/?fx=force');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator('.shelf-a11y button').first()).toBeAttached({
    timeout: 45_000,
  });
  await expect
    .poll(() => page.evaluate(() => '__shelfWorld' in window), {
      timeout: 30_000,
      message: 'QA world hook never appeared',
    })
    .toBe(true);
}

/** Titles currently listed by the offscreen accessibility mirror. */
async function shelfTitles(page: Page): Promise<string[]> {
  return page.locator('.shelf-a11y button').allTextContents();
}

/** Camera state via the QA world hook. */
function camera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const w = (window as unknown as Record<string, unknown>).__shelfWorld as {
      camera: { x: number; y: number; zoom: number };
    };
    return { x: w.camera.x, y: w.camera.y, zoom: w.camera.zoom };
  });
}

/** Map world coordinates to CSS-px screen coordinates via the live camera. */
async function worldToScreenPt(
  page: Page,
  wx: number,
  wy: number,
): Promise<{ x: number; y: number }> {
  const cam = await camera(page);
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

test('rail "new book" lands a named book that persists across reload', async ({
  page,
}) => {
  await gotoShelfQa(page);

  await page.locator('[data-shelf-dock="new-book"]').click();
  const naming = page.locator('[data-testid="shelf-spine-name"]');
  await expect(naming).toBeVisible({ timeout: 15_000 });
  await naming.fill('Window Seat Notes');
  await naming.press('Enter');

  await expect
    .poll(() => shelfTitles(page), {
      timeout: 20_000,
      message: 'the named book never reached the shelf mirror',
    })
    .toContain('Window Seat Notes');

  // The browser stub persists its tables to localStorage: a reload must not
  // lose the book (Tauri gets the same guarantee from the real SQLite file).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(() => shelfTitles(page), {
      timeout: 45_000,
      message: 'the created book did not survive a reload',
    })
    .toContain('Window Seat Notes');
});

test('the dashed ghost slot creates a book where it stands', async ({
  page,
}) => {
  await gotoShelfQa(page);

  const ghost = page.locator('[data-testid="shelf-addslot"]');
  await expect(ghost).toBeVisible({ timeout: 30_000 });
  const before = (await shelfTitles(page)).length;

  await ghost.click();
  const naming = page.locator('[data-testid="shelf-spine-name"]');
  await expect(naming).toBeVisible({ timeout: 15_000 });
  // Keep the default title: Escape dismisses the inline editor and the book
  // stays on the plank under its placeholder name.
  await naming.press('Escape');

  await expect
    .poll(() => shelfTitles(page), {
      timeout: 20_000,
      message: 'the ghost-slot book never appeared',
    })
    .toContain(NEW_BOOK_TITLE);
  expect((await shelfTitles(page)).length).toBe(before + 1);
});

test('right-click on bare plank offers "New book here" for that floor', async ({
  page,
}) => {
  await gotoShelfQa(page);

  // Bare plank on floor 0, well right of the seeded welcome book.
  const pt = await worldToScreenPt(page, 950, 290);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  const menu = page.locator('.shelf-menu--spot');
  await expect(menu).toBeVisible({ timeout: 15_000 });
  await expect(menu).toContainText('floor 1');

  // Keyboard: ArrowDown + Enter activates the highlighted row.
  await page.keyboard.press('ArrowDown'); // -> "Add a floor below"
  await page.keyboard.press('ArrowUp'); // back to "New book here"
  await page.keyboard.press('Enter');
  await expect(menu).not.toBeVisible();
  const naming = page.locator('[data-testid="shelf-spine-name"]');
  await expect(naming).toBeVisible({ timeout: 15_000 });
  await naming.press('Escape');

  await expect
    .poll(() => shelfTitles(page), {
      timeout: 20_000,
      message: 'the spot-menu book never appeared',
    })
    .toContain(NEW_BOOK_TITLE);
});

test('"add floor" flies the camera down to a fresh empty floor', async ({
  page,
}) => {
  await gotoShelfQa(page);
  const before = await camera(page);

  await page.locator('[data-shelf-dock="add-floor"]').click();

  // One floor is FLOOR_H world px; the flight eases in over ~a second.
  await expect
    .poll(
      async () => (await camera(page)).y - before.y,
      { timeout: 20_000, message: 'the camera never flew to the new floor' },
    )
    .toBeGreaterThan(80);
});

test('rail "studio" opens the Library studio; a theme pick re-themes and persists', async ({
  page,
}) => {
  test.slow();
  await gotoShelfQa(page);

  await page.locator('[data-shelf-dock="studio"]').click();
  const studio = page.locator('.nb-library-studio');
  await expect(studio).toBeVisible({ timeout: 15_000 });
  // Theme cards painted from the real case art.
  await expect(page.locator('.nb-theme-card').first()).toBeVisible({
    timeout: 30_000,
  });

  await page.locator('.nb-theme-card', { hasText: 'Coral Reef' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const lib = (window as unknown as Record<string, unknown>)
            .__libraryPrefs as { current(): { theme: string } | null };
          return lib.current()?.theme ?? null;
        }),
      { timeout: 30_000, message: 'the theme pick never reached the store' },
    )
    .toBe('reef');

  // The shelf re-bakes into the picked room.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { libraryKey: string };
          return w.libraryKey;
        }),
      { timeout: 45_000, message: 'the shelf never re-themed' },
    )
    .toContain('reef');

  // And the pref survives a reload (settings table, persisted stub).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 45_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const lib = (window as unknown as Record<string, unknown>)
            .__libraryPrefs as { current(): { theme: string } | null };
          return lib.current()?.theme ?? null;
        }),
      { timeout: 45_000, message: 'the theme pref did not survive a reload' },
    )
    .toBe('reef');
});
