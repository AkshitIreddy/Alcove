/**
 * E2E — group C: quick switcher (Ctrl+K) + full-text search (roadmap 20–21).
 *
 * Runs against the browser dev build (in-memory DB, seeded welcome book).
 * SwiftShader throttles rAF, so everything polls; no fixed waits.
 */
import { expect, test, type Page } from 'playwright/test';
import { gotoShelf, openBlankPage } from './helpers';

const INPUT = '.nb-qs-input';
const ROW = '.nb-qs-row';

async function openSwitcher(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 15_000 });
}

test.describe('quick switcher (Ctrl+K)', () => {
  test('opens, fuzzy-finds the welcome book, Enter opens it', async ({
    page,
  }) => {
    await gotoShelf(page);
    await openSwitcher(page);

    await page.locator(INPUT).fill('welc');
    const row = page.locator(ROW).first();
    await expect(row).toContainText('Welcome to Notebook', {
      timeout: 15_000,
    });

    await page.keyboard.press('Enter');
    await expect(page.locator('.nb-book-view')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.nb-prose h1').first()).toContainText(
      'Welcome to Notebook',
      { timeout: 30_000 },
    );
  });

  test('Ctrl+K toggles and Escape closes', async ({ page }) => {
    await gotoShelf(page);
    await openSwitcher(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.nb-qs-bar')).toHaveCount(0);
    await openSwitcher(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.nb-qs-bar')).toHaveCount(0);
  });

  test('lists page headings and jumps to that page with a pulse', async ({
    page,
  }) => {
    await gotoShelf(page);
    await openSwitcher(page);

    // "Diagrams" is the seeded page 4 heading → slot 3 → spread 1.
    await page.locator(INPUT).fill('diagrams');
    const row = page
      .locator(`${ROW}[data-kind="heading"]`, { hasText: 'Diagrams' })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    await expect(page.locator('.nb-book-view')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.nb-spread-stage')).toHaveAttribute(
      'data-spread-index',
      '1',
      { timeout: 30_000 },
    );
    await expect(page.locator('.nb-search-pulse').first()).toBeAttached({
      timeout: 30_000,
    });
  });
});

test.describe("full-text search ('>' mode)", () => {
  test('shows ranked snippets with marked terms; click jumps + pulses', async ({
    page,
  }) => {
    await gotoShelf(page);
    await openSwitcher(page);

    // '>' prefix switches the bar into content mode.
    await page.locator(INPUT).fill('>slash menu');
    const row = page.locator(`${ROW}[data-kind="content"]`).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.locator('mark.nb-qs-hit').first()).toBeVisible();
    await expect(row).toContainText('Welcome to Notebook');

    await row.click();
    await expect(page.locator('.nb-book-view')).toBeVisible({
      timeout: 30_000,
    });
    // "slash menu" lives on page 2 (slot 1) → spread 0, right leaf.
    await expect(page.locator('.nb-spread-stage')).toHaveAttribute(
      'data-spread-index',
      '0',
      { timeout: 30_000 },
    );
    await expect(page.locator('.nb-search-pulse').first()).toBeAttached({
      timeout: 30_000,
    });
  });

  test('the Tab key and the tabs switch modes', async ({ page }) => {
    await gotoShelf(page);
    await openSwitcher(page);
    const input = page.locator(INPUT);

    await input.fill('welcome');
    await page.keyboard.press('Tab');
    // The `>` mode prefix is a typing shortcut, not a token the user has to
    // see or delete: the query survives the mode switch, and the lit tab is
    // the single source of truth for which mode is active.
    // (Design audit finding 20 — docs/design/ui-audit.md.)
    await expect(input).toHaveValue('welcome');
    await expect(
      page.locator('.nb-qs-tab', { hasText: 'search text' }),
    ).toHaveClass(/is-active/);

    await page.locator('.nb-qs-tab', { hasText: 'go to' }).click();
    await expect(input).toHaveValue('welcome');
  });

  test('newly typed text becomes searchable after autosave', async ({
    page,
  }) => {
    const prose = await openBlankPage(page);
    await prose.click();
    await page.keyboard.type('the xylograph hums quietly', { delay: 15 });

    // Poll the live search index (same Vite module graph as the app) until
    // the debounced save + index hook have landed — no fixed waits.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const mod = (await import('/src/data/search.ts')) as {
              loadIndex(): Promise<Array<{ text: string }>>;
            };
            const rows = await mod.loadIndex();
            return rows.some((row) => row.text.includes('xylograph'));
          }),
        { timeout: 30_000, message: 'typed text never reached the index' },
      )
      .toBe(true);

    await openSwitcher(page);
    await page.locator(INPUT).fill('>xylograph');
    await expect(
      page.locator(`${ROW}[data-kind="content"]`).first(),
    ).toContainText('xylograph', { timeout: 30_000 });
  });
});
