/**
 * Library themes + Book Studio E2E (docs/design/library-themes.md §5).
 *
 * Boots with ?fx=force so world.ts exposes its QA hooks (`__shelfWorld`,
 * `__libraryPrefs`, `__shelfSeedBooks`, `__shelfSetBookStyle`,
 * `__shelfBookMeta`). The shelf is a WebGL canvas with no DOM per book, so
 * shelf assertions are optical: screenshot, decode in-page, compare.
 * Everything polls — SwiftShader throttles rAF hard, so a fixed wait proves
 * nothing; `__shelfWorld.libraryKey` reports the room whose art is actually up.
 */
import { expect, test, type Page } from 'playwright/test';
import { screenDiffRatio } from './helpers';

interface LibraryBridge {
  save(patch: Record<string, unknown>): Promise<unknown>;
  current(): Record<string, unknown> | null;
}

function bridge(page: Page) {
  return {
    setPrefs: (patch: Record<string, unknown>) =>
      page.evaluate(async (p) => {
        const lib = (window as unknown as Record<string, unknown>)
          .__libraryPrefs as LibraryBridge;
        await lib.save(p);
      }, patch),
    prefs: () =>
      page.evaluate(() => {
        const lib = (window as unknown as Record<string, unknown>)
          .__libraryPrefs as LibraryBridge;
        return lib.current();
      }),
    seed: (titles: readonly string[]) =>
      page.evaluate(async (t) => {
        const fn = (window as unknown as Record<string, unknown>)
          .__shelfSeedBooks as (titles: readonly string[], floor: number) => Promise<void>;
        await fn(t, 0);
      }, titles),
    books: () =>
      page.evaluate(() => {
        const fn = (window as unknown as Record<string, unknown>)
          .__shelfVisibleBooks as () => Array<{ id: string; title: string }>;
        return fn();
      }),
    setStyle: (bookId: string, style: Record<string, unknown>) =>
      page.evaluate(
        async ([id, s]) => {
          const fn = (window as unknown as Record<string, unknown>)
            .__shelfSetBookStyle as (
            id: string,
            s: Record<string, unknown> | null,
          ) => Promise<void>;
          await fn(id as string, s as Record<string, unknown>);
        },
        [bookId, style] as const,
      ),
    meta: (bookId: string) =>
      page.evaluate((id) => {
        const fn = (window as unknown as Record<string, unknown>)
          .__shelfBookMeta as (id: string) => Record<string, unknown> | null;
        return fn(id);
      }, bookId),
    libraryKey: () =>
      page.evaluate(() => {
        const w = (window as unknown as Record<string, unknown>).__shelfWorld as {
          libraryKey: string;
        };
        return w.libraryKey;
      }),
  };
}

async function gotoShelfQa(page: Page): Promise<void> {
  await page.goto('/?fx=force');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => '__libraryPrefs' in window), {
      timeout: 45_000,
      message: 'library QA bridge never appeared',
    })
    .toBe(true);
}

/** Wait until the world reports the requested room's art is actually up. */
async function waitForRoom(page: Page, themeId: string): Promise<void> {
  await expect
    .poll(() => bridge(page).libraryKey(), {
      timeout: 45_000,
      message: `room ${themeId} never landed`,
    })
    .toContain(themeId);
  // The crossfade snapshot dissolves over ~0.42s after the key flips.
  await page.waitForTimeout(1200);
}

/** Open the book view through the dev view switcher (deterministic). */
async function openBook(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'book', exact: true }).click();
  await expect(page.locator('.nb-rail')).toBeVisible({ timeout: 45_000 });
}

test.describe('library themes on the real shelf', () => {
  test('each of the four rooms really recolours the case', async ({ page }) => {
    test.slow();
    await gotoShelfQa(page);
    const lib = bridge(page);
    await lib.seed(['Field Notes', 'The Long Hall', 'Marginalia', 'Ink & Ash']);
    await waitForRoom(page, 'athenaeum');

    const ids = ['athenaeum', 'blossom', 'reef', 'apothecary'] as const;
    const shots: Record<string, Buffer> = {};
    for (const id of ids) {
      await lib.setPrefs({ theme: id });
      await waitForRoom(page, id);
      shots[id] = await page.screenshot({ type: 'png' });
    }

    // A theme is a colour scheme now, and the whole point of this pass is that
    // it reaches the screen: same shapes, different paint, everywhere.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = shots[ids[i] as string] as Buffer;
        const b = shots[ids[j] as string] as Buffer;
        const ratio = await screenDiffRatio(page, a, b);
        expect(ratio, `${ids[i]} vs ${ids[j]}`).toBeGreaterThan(0.2);
      }
    }
  });

  test('the retired wall controls are ignored, not resurrected', async ({ page }) => {
    await gotoShelfQa(page);
    const lib = bridge(page);
    await waitForRoom(page, 'athenaeum');

    // wallpaperPattern / colourway / backdrop / wallDepth were four pickers for
    // a wall that is one flat fill. A blob still carrying them must load as a
    // plain room pick and leave nothing behind.
    await lib.setPrefs({
      theme: 'reef',
      wallpaperPattern: 'constellation',
      colourway: 'midnight',
      backdrop: 'boarded',
      wallDepth: 0.9,
    });
    await waitForRoom(page, 'reef');
    expect(await lib.prefs()).toEqual({ theme: 'reef' });
    expect(await lib.libraryKey()).not.toContain('constellation');
  });
});

/*
 * A 'flora density' suite lived here, sliding the conservatory from overgrown
 * to clean and back and diffing the screen at each step. Nothing grows on the
 * case any more — the flora pipeline went with the painting stack and the
 * slider went with it — so there is nothing left to slide.
 */

test.describe('the Book Studio', () => {
  test('opens as two painted tabs behind the rail brush', async ({ page }) => {
    test.slow();
    await gotoShelfQa(page);
    await openBook(page);

    await page.locator('[data-tool="customize"]').click();
    await expect(page.getByRole('tab', { name: 'this book' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'this library' })).toBeVisible();

    // The book tab paints a real spine and a real cover with the same
    // renderers the shelf uses.
    const spine = page.locator('canvas[aria-label="Spine preview"]');
    await expect(spine).toBeAttached();
    await expect
      .poll(
        () =>
          spine.evaluate((el: HTMLCanvasElement) => {
            const ctx = el.getContext('2d');
            if (ctx === null || el.width === 0) return 0;
            const { data } = ctx.getImageData(0, 0, el.width, el.height);
            let painted = 0;
            for (let i = 3; i < data.length; i += 4 * 37) {
              if ((data[i] as number) > 8) painted += 1;
            }
            return painted;
          }),
        { timeout: 30_000, message: 'the spine preview never painted' },
      )
      .toBeGreaterThan(0);

    // Every studio control group is present.
    for (const label of [
      'Binding material',
      'Spine pigment',
      'Ornament stamp',
      'Title plate',
      'Edge treatment',
      'Book format',
      'Charm',
      'Cover frame',
      'Cover medallion',
    ]) {
      await expect(
        page.getByRole('group', { name: label, exact: true }),
      ).toBeAttached();
    }

    // The library tab paints room cards from the real case art. It was a grid
    // of four; there are sixty rooms now, so it is a strip of five and a way
    // through to the rest, exactly like the carpentry and the papers.
    await page.getByRole('tab', { name: 'this library' }).click();
    const rooms = page.locator('[aria-label="Library theme"]');
    await expect(rooms).toBeVisible();
    await expect(rooms.locator('.nb-strip-art')).toHaveCount(5);
    await expect(rooms.locator('.nb-strip-more')).toBeVisible();
    await expect
      .poll(
        () =>
          rooms
            .locator('.nb-strip-art')
            .first()
            .evaluate((el: HTMLCanvasElement) => el.width),
        { timeout: 30_000, message: 'a theme card never baked' },
      )
      .toBeGreaterThan(100);
    // One control, and a legend for what it changed. The wall-finish and
    // wallpaper rows are gone: they were pickers over a flat fill.
    await expect(page.getByRole('group', { name: 'Wall finish' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Library theme' })).toBeVisible();
    await expect(page.getByRole('img', { name: /palette$/ })).toBeVisible();
  });

  test('picking a theme card redresses the shelf', async ({ page }) => {
    test.slow();
    await gotoShelfQa(page);
    await openBook(page);
    await page.locator('[data-tool="customize"]').click();
    await page.getByRole('tab', { name: 'this library' }).click();
    await expect(page.locator('[aria-label="Library theme"]')).toBeVisible();

    // Reef is one of sixty rooms and not among the five the strip shows, so it
    // is reached the way the reader reaches it: through the sheet, by name.
    await page.locator('[aria-label="Library theme"] .nb-strip-more').click();
    await expect(page.locator('.nb-pick-card').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.nb-pick-search input').fill('coral reef');
    await expect(page.locator('.nb-pick-card')).toHaveCount(1);
    await page.locator('.nb-pick-card').first().click();
    await expect
      .poll(() => bridge(page).prefs().then((p) => p?.theme ?? null), {
        timeout: 30_000,
        message: 'the theme pick never reached the store',
      })
      .toBe('reef');

    await page.locator('.nb-rail-panel-close').first().click();
    await page.getByRole('button', { name: 'shelf', exact: true }).click();
    await expect(page.locator('canvas.shelf-canvas')).toBeVisible({ timeout: 45_000 });
    await waitForRoom(page, 'reef');
  });
});

test.describe('a customized book keeps its identity', () => {
  test('the shelf spine re-bakes and both cover_meta sections agree', async ({
    page,
  }) => {
    test.slow();
    await gotoShelfQa(page);
    const lib = bridge(page);
    await lib.seed(['Cartography']);
    await waitForRoom(page, 'athenaeum');
    await expect
      .poll(() => lib.books().then((b) => b.length), { timeout: 45_000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1500);

    const before = await page.screenshot({ type: 'png' });
    const books = await lib.books();
    const target = books.find((b) => b.title === 'Cartography') ?? books[0];
    expect(target).toBeDefined();

    await lib.setStyle((target as { id: string }).id, {
      material: 'silk',
      pigment: 4,
      raisedBands: 5,
      bandGilt: true,
      gilt: true,
      charm: 'wax-seal',
      edge: 'marbled',
      wear: 0.7,
      height: 286,
      thickness: 56,
      cornerProtectors: true,
    });

    await expect
      .poll(
        async () => screenDiffRatio(page, before, await page.screenshot({ type: 'png' })),
        { timeout: 45_000, message: 'the customized spine never re-baked' },
      )
      .toBeGreaterThan(0.002);

    // The studio writes BOTH sections, so the opened book's cover art (which
    // reads cover_meta.cover) cannot drift from the shelf spine.
    const meta = (await lib.meta((target as { id: string }).id)) as Record<
      string,
      Record<string, unknown>
    > | null;
    expect(meta).not.toBeNull();
    expect(meta?.style?.material).toBe('silk');
    expect(meta?.style?.charm).toBe('wax-seal');
    expect(meta?.cover?.palette).toBe(4);
    expect(meta?.cover?.charm).toBe('wax-seal');
    expect(meta?.cover?.edge).toBe('marbled');
    expect(meta?.cover?.cornerProtectors).toBe(true);
  });
});
