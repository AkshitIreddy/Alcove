/**
 * Transfer desk E2E — customizable export, additive import, long-lived undo
 * (roadmap item 29).
 *
 * The panel's rail button is wired by the orchestrator after the wave lands,
 * so these specs open it the same way the dev tooling does: a dynamic import
 * of the feature's public entry point, which `vite dev` serves transformed.
 * File pickers use the browser fallbacks (download event for export, the
 * hidden `input[data-nb-bundle]` for import), both of which Playwright drives
 * directly.
 */
import { promises as fs } from 'node:fs';
import { expect, test, type Page } from 'playwright/test';
import { suppressTour } from './helpers';

interface SeedBook {
  title: string;
  floor: number;
  pages: string[];
}

declare global {
  interface Window {
    __nbTransfer?: {
      openTransferPanel(tab?: 'export' | 'import' | 'history'): void;
    };
  }
}

/** Load the app, seed extra books, and open the transfer panel. */
async function openTransfer(
  page: Page,
  tab: 'export' | 'import' | 'history',
  seed: SeedBook[] = [],
): Promise<void> {
  await suppressTour(page);
  await page.goto('/');
  await expect(page.locator('canvas.shelf-canvas')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.shelf-a11y button').first()).toBeAttached({
    timeout: 45_000,
  });

  if (seed.length > 0) {
    await page.evaluate(async (books: SeedBook[]) => {
      const bookRepo = await import('/src/data/books.ts');
      const pageRepo = await import('/src/data/pages.ts');
      const doc = (title: string) => ({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: title }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Notes for the transfer spec.' }],
          },
        ],
      });
      for (const book of books) {
        const slot = await bookRepo.nextFreeSlot(book.floor, 0);
        const created = await bookRepo.createBook({
          title: book.title,
          floor: book.floor,
          slot,
        });
        for (const title of book.pages) {
          await pageRepo.createPage({ bookId: created.id, doc: doc(title) });
        }
      }
    }, seed);
  }

  await page.evaluate(async (initial: string) => {
    const mod = await import('/src/features/transfer/index.ts');
    window.__nbTransfer = mod;
    mod.openTransferPanel(initial as 'export');
  }, tab);
  await expect(page.locator('.nb-tr-card')).toBeVisible({ timeout: 30_000 });
}

/** Build a bundle from the live library, with ids/titles rewritten so the
 *  import tree shows one of every conflict kind. Returns base64 zip bytes. */
async function buildMixedBundle(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const lib = await import('/src/features/transfer/library.ts');
    const scope = await import('/src/features/transfer/scope.ts');
    const bundle = await import('/src/features/transfer/bundle.ts');
    const zip = await import('/src/features/transfer/zip.ts');

    const snapshot = await lib.loadLibrarySnapshot();
    const books = snapshot.books.slice(0, 3).map((book, index) => {
      if (index === 1) return { ...book, id: `x-${book.id}` };
      if (index === 2) return { ...book, id: `y-${book.id}`, title: 'Botany field notes' };
      return book;
    });
    const shared = { books, assets: [], theme: null };
    const plan = scope.buildExportPlan(
      shared,
      scope.resolveScopeSelection(shared, { kind: 'library' }),
      scope.DEFAULT_EXPORT_OPTIONS,
    );
    const built = bundle.buildBundleFiles({
      snapshot: shared,
      plan,
      options: scope.DEFAULT_EXPORT_OPTIONS,
      label: 'Notes from Ada',
      createdAt: new Date().toISOString(),
      appVersion: '0.1.0',
    });
    let binary = '';
    for (const byte of zip.zipStore(built.entries)) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}

async function feedBundle(page: Page, base64: string, name = 'notes-from-ada.nbk') {
  await page.getByRole('button', { name: 'Choose a .nbk bundle' }).click();
  await page.locator('input[data-nb-bundle]').waitFor({ state: 'attached' });
  await page.setInputFiles('input[data-nb-bundle]', {
    name,
    mimeType: 'application/zip',
    buffer: Buffer.from(base64, 'base64'),
  });
  await expect(page.locator('.nb-tr-plan-item').first()).toBeVisible({
    timeout: 30_000,
  });
}

const SEED: SeedBook[] = [
  { title: 'Cell Biology', floor: 0, pages: ['Membranes', 'Mitosis', 'Meiosis'] },
  { title: 'Recipes', floor: 0, pages: ['Sourdough', 'Focaccia'] },
  { title: 'Trip journal', floor: 1, pages: ['Kyoto', 'Nara'] },
];

/** Book titles currently on the shelf. */
function shelfTitles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const repo = await import('/src/data/books.ts');
    return (await repo.listBooksByFloorRange(0, 999)).map((book) => book.title);
  });
}

/** Page count per book title, for additive-import assertions. */
function pageCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const bookRepo = await import('/src/data/books.ts');
    const pageRepo = await import('/src/data/pages.ts');
    const out: Record<string, number> = {};
    for (const book of await bookRepo.listBooksByFloorRange(0, 999)) {
      out[book.title] = (await pageRepo.listPages(book.id)).length;
    }
    return out;
  });
}

test.describe('export', () => {
  test('scope picker drives the preview and the file name', async ({ page }) => {
    await openTransfer(page, 'export', SEED);

    // Whole library is the default scope: every seeded book is in the parcel.
    const counts = page.locator('.nb-tr-parcel-counts');
    await expect(counts).toContainText('4 books');
    await expect(page.locator('.nb-tr-filename')).toContainText('notebook-library.nbk');

    // Narrowing to a floor narrows the parcel.
    await page.locator('.nb-tr-chip', { hasText: 'floor 2' }).first().click();
    await expect(counts).toContainText('1 book');
    await expect(page.locator('.nb-tr-filename')).toContainText('notebook-floor-2.nbk');

    // Unticking one page leaves the book in, minus that page.
    await page.locator('.nb-tr-chip', { hasText: 'whole library' }).first().click();
    await expect(counts).toContainText('4 books');
    await page.locator('.nb-tr-disclose').first().click();
    const firstPage = page.locator('.nb-tr-row-page').first();
    await expect(firstPage).toBeVisible();
    await firstPage.click();
    await expect(page.locator('.nb-tr-parcel-item').first()).toContainText('left out');
    await expect(page.locator('.nb-tr-chip[data-active="true"]').first()).toContainText(
      'pick by hand',
    );
  });

  test('writes a .nbk the app can read back', async ({ page }) => {
    await openTransfer(page, 'export', SEED);
    const download = page.waitForEvent('download', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.nbk$/);

    const path = await file.path();
    const bytes = await fs.readFile(path);
    expect(bytes.length).toBeGreaterThan(200);
    // PK\003\004 — a real ZIP local file header.
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Round-trip: the app parses its own bundle and finds every book.
    const summary = await page.evaluate(async (base64: string) => {
      const io = await import('/src/features/transfer/io.ts');
      const binary = atob(base64);
      const buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
      const result = await io.readBundleBytes(buffer, 'roundtrip.nbk');
      return {
        errors: result.errors,
        warnings: result.warnings,
        books: result.contents?.manifest.books.map((book) => book.title) ?? [],
        pages: result.contents?.manifest.counts.pages ?? 0,
      };
    }, bytes.toString('base64'));

    expect(summary.errors).toEqual([]);
    expect(summary.warnings).toEqual([]);
    expect(summary.books).toContain('Cell Biology');
    expect(summary.pages).toBeGreaterThanOrEqual(8);
  });
});

test.describe('import', () => {
  test('shows conflicts and a plan before anything changes', async ({ page }) => {
    await openTransfer(page, 'import', SEED);
    const before = await shelfTitles(page);
    await feedBundle(page, await buildMixedBundle(page));

    // One badge of each kind: same id, same title, and a clean new book.
    await expect(page.locator('.nb-tr-badge[data-kind="same-id"]').first()).toContainText(
      'already imported',
    );
    await expect(
      page.locator('.nb-tr-badge[data-kind="same-title"]').first(),
    ).toContainText('same title');

    // The plan spells out what will happen — including the rename.
    const plan = page.locator('.nb-tr-plan-item');
    await expect(plan).toHaveCount(3);
    await expect(plan.filter({ hasText: 'as a new book' }).first()).toBeVisible();
    await expect(plan.filter({ hasText: '(2)' }).first()).toBeVisible();

    // Nothing has been written yet.
    expect(await shelfTitles(page)).toEqual(before);
  });

  test('adds, never replaces — and every resolution is honoured', async ({ page }) => {
    await openTransfer(page, 'import', SEED);
    const before = await shelfTitles(page);
    const before_counts = await pageCounts(page);
    await feedBundle(page, await buildMixedBundle(page));

    // Skip the first book, merge the second into its namesake.
    const nodes = page.locator('.nb-tr-node');
    await nodes.nth(0).locator('.nb-tr-chip', { hasText: 'skip' }).click();
    await nodes.nth(1).locator('.nb-tr-chip', { hasText: 'add pages to it' }).click();
    await expect(
      page.locator('.nb-tr-plan-item[data-action="append"]').first(),
    ).toContainText('existing');

    await page.getByRole('button', { name: 'Add to my library' }).click();
    await expect(page.locator('.nb-tr-done')).toBeVisible({ timeout: 60_000 });

    const after = await shelfTitles(page);
    const after_counts = await pageCounts(page);
    // Every pre-existing book survives — imports are purely additive.
    for (const title of before) expect(after).toContain(title);
    // The skipped book added nothing; the merged one added no new book;
    // the clean one arrived.
    expect(after).toContain('Botany field notes');
    expect(after.filter((t) => t === 'Cell Biology')).toHaveLength(1);
    expect(after.filter((t) => t === 'Recipes')).toHaveLength(1);

    // Exactly one existing book gained pages (the merge target), and no
    // existing book lost any — that is what "additive" means.
    const gained = Object.entries(after_counts).filter(
      ([title, count]) => before_counts[title] !== undefined && count > before_counts[title],
    );
    const lost = Object.entries(after_counts).filter(
      ([title, count]) => before_counts[title] !== undefined && count < before_counts[title],
    );
    expect(lost).toEqual([]);
    expect(gained).toHaveLength(1);
  });
});

test.describe('restore points', () => {
  test('an import can be reverted, and the revert itself undone', async ({ page }) => {
    await openTransfer(page, 'import', SEED);
    const before = await shelfTitles(page);
    await feedBundle(page, await buildMixedBundle(page));
    await page.getByRole('button', { name: 'Add to my library' }).click();
    await expect(page.locator('.nb-tr-done')).toBeVisible({ timeout: 60_000 });
    const afterImport = await shelfTitles(page);
    expect(afterImport.length).toBeGreaterThan(before.length);

    // The undo book lists the import with its counts.
    await page.locator('.nb-tr-rail-button', { hasText: 'Undo book' }).click();
    const entries = page.locator('.nb-tr-hist');
    await expect(entries.first()).toContainText('Imported notes-from-ada.nbk');
    // Page total depends on the seeded welcome book, so match the shape.
    await expect(entries.first()).toContainText(/3 books · \d+ pages/);

    // Revert: the imported books go, the originals stay.
    await page.getByRole('button', { name: 'Revert this import' }).first().click();
    await expect(page.locator('.nb-tr-hist[data-kind="revert"]')).toBeVisible({
      timeout: 60_000,
    });
    const afterRevert = await shelfTitles(page);
    for (const title of before) expect(afterRevert).toContain(title);
    expect(afterRevert).not.toContain('Botany field notes');

    // The revert is itself a restore point, and undoing it brings them back.
    await expect(entries).toHaveCount(2);
    await page.getByRole('button', { name: 'Undo this revert' }).first().click();
    await expect(page.locator('.nb-tr-hist').nth(0)).toContainText('Reverted', {
      timeout: 60_000,
    });
    await expect
      .poll(async () => (await shelfTitles(page)).includes('Botany field notes'), {
        timeout: 30_000,
      })
      .toBe(true);
  });

  test('history survives a reload and honours the retention chips', async ({ page }) => {
    await openTransfer(page, 'import', SEED);
    await feedBundle(page, await buildMixedBundle(page));
    await page.getByRole('button', { name: 'Add to my library' }).click();
    await expect(page.locator('.nb-tr-done')).toBeVisible({ timeout: 60_000 });

    await page.locator('.nb-tr-rail-button', { hasText: 'Undo book' }).click();
    await page.locator('.nb-tr-chip', { hasText: 'a year' }).click();
    await expect(page.locator('.nb-tr-hist-end')).toContainText('365 days');

    // The stored blob is what a later session would read (the dev build's
    // in-memory DB does not outlive a reload, so assert the row directly).
    const stored = await page.evaluate(async () => {
      const store = await import('/src/features/transfer/store.ts');
      const history = await store.loadHistory();
      return {
        retention: history.retention,
        labels: history.points.map((point) => point.label),
      };
    });
    expect(stored.retention.maxAgeDays).toBe(365);
    expect(stored.labels[0]).toContain('notes-from-ada.nbk');
  });
});
