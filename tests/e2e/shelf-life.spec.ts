/**
 * Wave-2 Group A — shelf & library life E2E.
 *
 * Boots with ?fx=force so the world exposes itself as window.__shelfWorld
 * (QA hook in world.ts) — canvas-world state (camera, selection, env) is
 * probed through it, while all UI interactions go through the real DOM/canvas
 * input paths. Every assertion polls (SwiftShader throttles rAF).
 */
import { expect, test, type Page } from 'playwright/test';
import { WELCOME_TITLE, screenDiffRatio, waitForSpine } from './helpers';

/**
 * Write settings through the world's own settings-module instance.
 *
 * Deliberately NOT `import('/src/data/settings.ts')`: on a dev server that
 * has served HMR updates, Vite rewrites the app graph's import URLs with a
 * ?t= cache-buster, so a fresh dynamic import hands back a SECOND copy of the
 * module and writes to it never reach the shelf. `__shelfSaveSettings` is the
 * real store's `save`, captured by world.ts behind the ?fx= QA hook.
 */
async function saveSettings(
  page: Page,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (p) => {
    const save = (window as unknown as Record<string, unknown>)
      .__shelfSaveSettings as (patch: Record<string, unknown>) => Promise<unknown>;
    await save(p);
  }, patch);
}

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
    .poll(
      () => page.evaluate(() => '__shelfWorld' in window),
      { timeout: 30_000, message: 'QA world hook never appeared' },
    )
    .toBe(true);
}

/** Map world coordinates to CSS-px screen coordinates via the live camera. */
async function worldToScreenPt(
  page: Page,
  wx: number,
  wy: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([x, y]) => {
      const world = (window as unknown as Record<string, unknown>)
        .__shelfWorld as {
        camera: { x: number; y: number; zoom: number };
      };
      const cam = world.camera;
      return { x: (x - cam.x) * cam.zoom, y: (y - cam.y) * cam.zoom };
    },
    [wx, wy] as [number, number],
  );
}

/** Right-click the welcome book's spine and wait for the shelf menu. */
async function openBookMenu(page: Page): Promise<void> {
  const spine = await waitForSpine(page);
  await page.mouse.click(spine.cx, spine.cy, { button: 'right' });
  await expect(page.locator('.shelf-menu')).toBeVisible({ timeout: 15_000 });
}

test('right-click menu opens and renames the book', async ({ page }) => {
  await gotoShelfQa(page);
  await openBookMenu(page);

  // The menu mirrors the editor context-menu structure.
  await expect(page.locator('[data-shelf-action="open"]')).toBeVisible();
  await expect(page.locator('[data-shelf-action="delete"]')).toBeVisible();

  await page.locator('[data-shelf-action="rename"]').click();
  const input = page.locator('.shelf-menu__input');
  await expect(input).toBeVisible();
  await input.fill('My Field Notes ✎');
  await input.press('Enter');

  await expect
    .poll(
      async () => page.locator('.shelf-a11y button').allTextContents(),
      { timeout: 20_000, message: 'rename never reached the a11y mirror' },
    )
    .toContain('My Field Notes ✎');
});

test('pin toggles the favorite star state', async ({ page }) => {
  await gotoShelfQa(page);
  await openBookMenu(page);
  await expect(page.locator('[data-shelf-action="pin"]')).toContainText(
    'Pin as favorite',
  );
  await page.locator('[data-shelf-action="pin"]').click();

  // Re-open: the row flips to Unpin (round-tripped through cover_meta.shelf),
  // and the pinned spine grew a star charm child sprite on the canvas.
  await expect
    .poll(
      async () => {
        await openBookMenu(page);
        const label = await page.locator('[data-shelf-action="pin"]').innerText();
        await page.keyboard.press('Escape');
        return label;
      },
      { timeout: 20_000, message: 'pin state never flipped' },
    )
    .toContain('Unpin favorite');
  const hasCharm = await page.evaluate(() => {
    const world = (window as unknown as Record<string, unknown>)
      .__shelfWorld as {
      floors: Map<number, { visuals: Array<{ charm: unknown }> }>;
    };
    for (const fv of world.floors.values()) {
      for (const v of fv.visuals) if (v.charm !== null) return true;
    }
    return false;
  });
  expect(hasCharm, 'pinned book has no star charm sprite').toBe(true);
});

test('duplicate creates a copy with pages', async ({ page }) => {
  await gotoShelfQa(page);
  await openBookMenu(page);
  await page.locator('[data-shelf-action="duplicate"]').click();
  await expect
    .poll(
      async () => page.locator('.shelf-a11y button').allTextContents(),
      { timeout: 20_000, message: 'duplicate never appeared on the shelf' },
    )
    .toContain(`${WELCOME_TITLE} copy`);
});

test('crumple to trash, drawer restore brings the book back', async ({
  page,
}) => {
  await gotoShelfQa(page);
  await openBookMenu(page);

  // Hand-drawn confirm card guards the delete.
  await page.locator('[data-shelf-action="delete"]').click();
  await expect(page.locator('.shelf-menu')).toContainText('Crumple this book?');
  await page.locator('[data-shelf-action="confirm-delete"]').click();

  // Book leaves the shelf (soft-delete to floor -1).
  await expect
    .poll(
      async () => page.locator('.shelf-a11y button').count(),
      { timeout: 20_000, message: 'book never left the shelf' },
    )
    .toBe(0);

  // Open the trash drawer under the last floor (canvas click).
  await expect
    .poll(
      async () => {
        const world = await page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { store: { maxFloor: number } };
          return w.store.maxFloor;
        });
        const pt = await worldToScreenPt(page, 600, (world + 1) * 320 + 30);
        await page.mouse.click(pt.x, pt.y);
        return page.locator('.shelf-trash').count();
      },
      { timeout: 25_000, message: 'trash drawer never opened' },
    )
    .toBeGreaterThan(0);

  await expect(page.locator('.shelf-trash')).toContainText(WELCOME_TITLE);

  // Restore puts it back on the shelf.
  await page.locator('.shelf-trash button', { hasText: 'Restore' }).click();
  await expect
    .poll(
      async () => page.locator('.shelf-a11y button').allTextContents(),
      { timeout: 20_000, message: 'restore never returned the book' },
    )
    .toContain(WELCOME_TITLE);
});

test('empty trash permanently deletes after a two-step confirm', async ({
  page,
}) => {
  await gotoShelfQa(page);
  await openBookMenu(page);
  await page.locator('[data-shelf-action="delete"]').click();
  await page.locator('[data-shelf-action="confirm-delete"]').click();
  await expect
    .poll(async () => page.locator('.shelf-a11y button').count(), {
      timeout: 20_000,
    })
    .toBe(0);

  await expect
    .poll(
      async () => {
        const maxFloor = await page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { store: { maxFloor: number } };
          return w.store.maxFloor;
        });
        const pt = await worldToScreenPt(page, 600, (maxFloor + 1) * 320 + 30);
        await page.mouse.click(pt.x, pt.y);
        return page.locator('.shelf-trash').count();
      },
      { timeout: 25_000, message: 'trash drawer never opened' },
    )
    .toBeGreaterThan(0);

  // Two-step confirm, then the drawer reads empty.
  await page.locator('[data-shelf-action="empty-trash"]').click();
  await expect(page.locator('[data-shelf-action="empty-trash"]')).toContainText(
    'Really',
  );
  await page.locator('[data-shelf-action="empty-trash"]').click();
  await expect(page.locator('.shelf-trash')).toContainText('nothing but dust', {
    timeout: 20_000,
  });
});

test('floor plaque renames via double-click', async ({ page }) => {
  await gotoShelfQa(page);
  await waitForSpine(page);

  // Double-click the floor-0 plaque (plank center, world 600×301).
  const pt = await worldToScreenPt(page, 600, 301);
  await page.mouse.dblclick(pt.x, pt.y);
  const editor = page.locator('.shelf-plate-edit');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.fill('Sciences & Sorcery');
  await editor.press('Enter');
  await expect(editor).not.toBeVisible();

  // Re-open: the stored name round-trips into the editor.
  await expect
    .poll(
      async () => {
        const again = await worldToScreenPt(page, 600, 301);
        await page.mouse.dblclick(again.x, again.y);
        const visible = await page.locator('.shelf-plate-edit').count();
        if (visible === 0) return '';
        return page.locator('.shelf-plate-edit').inputValue();
      },
      { timeout: 20_000, message: 'plaque name did not persist' },
    )
    .toBe('Sciences & Sorcery');
  await page.keyboard.press('Escape');
});

test('keyboard shelf nav: arrows select, Enter opens', async ({ page }) => {
  await gotoShelfQa(page);
  await waitForSpine(page);

  await page.keyboard.press('ArrowRight');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { keyboardSelection: unknown };
          return w.keyboardSelection !== null;
        }),
      { timeout: 15_000, message: 'arrow key never selected a book' },
    )
    .toBe(true);

  await page.keyboard.press('Home');
  const sel = await page.evaluate(() => {
    const w = (window as unknown as Record<string, unknown>).__shelfWorld as {
      keyboardSelection: { floor: number; index: number } | null;
    };
    return w.keyboardSelection;
  });
  expect(sel?.floor).toBe(0);

  await page.keyboard.press('Enter');
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });
});

test('wood stain and wallpaper live-apply from settings', async ({ page }) => {
  await gotoShelfQa(page);
  await waitForSpine(page);
  const before = await page.screenshot({ type: 'png' });

  // 'cherry' + 'stars' both differ from the shipped defaults (walnut/damask),
  // so this is a real repaint rather than a no-op write.
  await saveSettings(page, {
    shelfWoodStain: 'cherry',
    wallpaperPattern: 'stars',
  });

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as {
            envTex: { currentStain: string; currentPattern: string };
          };
          return `${w.envTex.currentStain}|${w.envTex.currentPattern}`;
        }),
      { timeout: 20_000, message: 'stain/wallpaper setting never applied' },
    )
    .toBe('cherry|stars');

  // The repaint really happened (cherry reddens every wood pixel).
  await expect
    .poll(
      async () => {
        const after = await page.screenshot({ type: 'png' });
        return screenDiffRatio(page, before, after);
      },
      { timeout: 25_000, message: 'restain never repainted the case' },
    )
    .toBeGreaterThan(0.02);
});

test('shelf sort setting reaches the floor store', async ({ page }) => {
  await gotoShelfQa(page);
  await waitForSpine(page);
  await saveSettings(page, { shelfSort: 'favorites' });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { store: { sort: string } };
          return w.store.sort;
        }),
      { timeout: 20_000, message: 'shelfSort never reached the store' },
    )
    .toBe('favorites');
});

test('wheel mode setting reaches the input layer', async ({ page }) => {
  await gotoShelfQa(page);
  await waitForSpine(page);
  await saveSettings(page, { wheelMode: 'scroll' });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { input: { wheelMode: string } };
          return w.input.wheelMode;
        }),
      { timeout: 20_000, message: 'wheelMode never reached the input layer' },
    )
    .toBe('scroll');
});

test('opening a book leaves a ribbon and re-derives its thickness', async ({
  page,
}) => {
  await gotoShelfQa(page);
  await openBookMenu(page);
  await page.locator('[data-shelf-action="open"]').click();
  await expect(page.locator('.nb-book-view')).toBeVisible({ timeout: 30_000 });

  // Back to the shelf: the book is now "recent" (ribbon) and its page count
  // has been re-counted into cover_meta.shelf (auto spine thickness).
  await page.locator('.nb-back-button').click();
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as {
            floors: Map<
              number,
              {
                visuals: Array<{
                  ribbon: unknown;
                  book: { coverMeta: { shelf?: { pageCount?: number } } | null };
                }>;
              }
            >;
          };
          for (const fv of w.floors.values()) {
            for (const v of fv.visuals) {
              if (v.ribbon !== null) {
                return (v.book.coverMeta?.shelf?.pageCount ?? -1) >= 1;
              }
            }
          }
          return null;
        }),
      { timeout: 30_000, message: 'continue-reading ribbon never appeared' },
    )
    .toBe(true);
});

test('move mode reshelves a book to another slot', async ({ page }) => {
  await gotoShelfQa(page);
  await openBookMenu(page);

  const slotBefore = await page.evaluate(() => {
    const w = (window as unknown as Record<string, unknown>).__shelfWorld as {
      floors: Map<number, { visuals: Array<{ book: { slot: number } }> }>;
    };
    for (const fv of w.floors.values()) {
      for (const v of fv.visuals) return v.book.slot;
    }
    return -1;
  });

  await page.locator('[data-shelf-action="move"]').click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as { moveActive: boolean };
          return w.moveActive;
        }),
      { timeout: 15_000, message: 'move mode never engaged' },
    )
    .toBe(true);

  // Drop it on a slot far to the right of where it started (world x 950).
  const drop = await worldToScreenPt(page, 950, 250);
  await page.mouse.move(drop.x, drop.y);
  await page.mouse.click(drop.x, drop.y);

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = (window as unknown as Record<string, unknown>)
            .__shelfWorld as {
            moveActive: boolean;
            floors: Map<number, { visuals: Array<{ book: { slot: number } }> }>;
          };
          if (w.moveActive) return null;
          for (const fv of w.floors.values()) {
            for (const v of fv.visuals) return v.book.slot;
          }
          return null;
        }),
      { timeout: 25_000, message: 'move never committed a new slot' },
    )
    .not.toBe(slotBefore);
});
