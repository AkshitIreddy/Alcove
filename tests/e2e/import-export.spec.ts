/**
 * Group D E2E — import/export & templates (roadmap 23-27).
 *
 * The rail buttons are wired by the orchestrator after the wave lands, so
 * these specs drive the flows through the dev hooks group D installs on
 * `window.__nbGroupD` (src/features/templates/groupD.ts, dev builds only —
 * exactly what `vite dev` serves here). File pickers use the browser
 * fallbacks (hidden inputs / download events), which Playwright can drive.
 */
import { promises as fs } from 'node:fs';
import { expect, test, type Page } from 'playwright/test';
import { openBlankPage, openBookView } from './helpers';

interface GroupDHooks {
  openTemplatesGallery(): void;
  importMarkdownBooks(): Promise<Array<{ id: string; title: string }>>;
  exportActivePagePng(): Promise<boolean>;
  exportOpenBookPdf(): Promise<boolean>;
  registerUserSticker(name: string, src: string): string;
  insertSticker(id: string): boolean;
  listUserStickers(): Array<{ id: string; name: string; src: string }>;
}

declare global {
  interface Window {
    __nbGroupD: GroupDHooks;
  }
}

async function waitForHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__nbGroupD !== undefined, undefined, {
    timeout: 30_000,
  });
}

/* ----------------------------------------------------------------------------
   26 — templates gallery
   -------------------------------------------------------------------------- */

test('templates gallery shows five cards and creates a Cornell book', async ({
  page,
}) => {
  await openBookView(page);
  await waitForHooks(page);

  await page.evaluate(() => window.__nbGroupD.openTemplatesGallery());
  const gallery = page.locator('.nb-tpl-gallery');
  await expect(gallery).toBeVisible({ timeout: 15_000 });
  await expect(gallery.locator('.nb-tpl-card')).toHaveCount(5);
  // Every card renders a live parsed preview, a name and actions.
  await expect(
    gallery.locator('.nb-tpl-card[data-template="cornell"] .nb-tpl-name'),
  ).toHaveText('Cornell notes');
  await expect(
    gallery.locator('.nb-tpl-preview .nb-ins-preview-doc').first(),
  ).toBeAttached();

  await page.screenshot({
    path: test.info().outputPath('templates-gallery.png'),
  });

  await gallery
    .locator('.nb-tpl-card[data-template="cornell"]')
    .getByRole('button', { name: 'new book' })
    .click();
  await expect(gallery).toBeHidden({ timeout: 30_000 });

  // The new book opens (session reload) with the template's real content.
  await expect(page.locator('.nb-book-title-plate')).toHaveText(
    'Cornell notes',
    { timeout: 30_000 },
  );
  await expect(page.locator('.nb-book-view')).toContainText('Cue', {
    timeout: 30_000,
  });
});

/* ----------------------------------------------------------------------------
   25 — import markdown → new book, one page per H1
   -------------------------------------------------------------------------- */

const IMPORT_MD = `# Field Notes

First chapter body with **bold** markdown.

- one
- two

# Second Chapter

More text under the second H1.

# Third Chapter

Closing section.
`;

test('markdown import creates a shelved book split on H1s and opens it', async ({
  page,
}) => {
  const mdPath = test.info().outputPath('import-sample.md');
  await fs.writeFile(mdPath, IMPORT_MD, 'utf8');

  await page.goto('/');
  await waitForHooks(page);

  // Kick the flow (pending until the hidden input receives files).
  const booksPromise = page.evaluate(() =>
    window.__nbGroupD
      .importMarkdownBooks()
      .then((books) => books.map((b) => ({ id: b.id, title: b.title }))),
  );
  const input = page.locator('input[data-nb-import]');
  await expect(input).toBeAttached({ timeout: 15_000 });
  await input.setInputFiles(mdPath);

  const books = await booksPromise;
  expect(books).toHaveLength(1);
  expect(books[0].title).toBe('Field Notes');

  // The imported book opens on its first page.
  await expect(page.locator('.nb-book-title-plate')).toHaveText('Field Notes', {
    timeout: 30_000,
  });
  await expect(
    page.locator('.nb-leaf-paper[data-side="left"] .nb-prose h1'),
  ).toContainText('Field Notes', { timeout: 30_000 });
  // One page per H1 → the second chapter sits on the right leaf of spread 0.
  await expect(
    page.locator('.nb-leaf-paper[data-side="right"] .nb-prose h1'),
  ).toContainText('Second Chapter', { timeout: 30_000 });
});

/* ----------------------------------------------------------------------------
   24 — export the focused page as PNG (browser path: download event)
   -------------------------------------------------------------------------- */

test('export page as PNG downloads a real PNG at 2x', async ({ page }) => {
  await openBookView(page);
  await waitForHooks(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  const okPromise = page.evaluate(() =>
    window.__nbGroupD.exportActivePagePng(),
  );
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-page\.png$/);

  const filePath = test.info().outputPath('exported-page.png');
  await download.saveAs(filePath);
  const bytes = await fs.readFile(filePath);
  // PNG magic + a plausibly-sized 2x capture.
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.length).toBeGreaterThan(20_000);
  expect(await okPromise).toBe(true);
});

/* ----------------------------------------------------------------------------
   23 — export the whole book as a PDF (browser path: TS assembler)
   -------------------------------------------------------------------------- */

test('export book as PDF downloads a well-formed multi-page PDF', async ({
  page,
}) => {
  test.setTimeout(180_000); // offscreen-renders every page on SwiftShader
  await openBookView(page);
  await waitForHooks(page);

  const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
  const okPromise = page.evaluate(() => window.__nbGroupD.exportOpenBookPdf());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const filePath = test.info().outputPath('exported-book.pdf');
  await download.saveAs(filePath);
  const bytes = await fs.readFile(filePath);
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.4\n')).toBe(true);
  expect(text.endsWith('%%EOF\n')).toBe(true);
  // The seeded welcome book has 5 pages → 5 PDF pages, each a JPEG XObject.
  expect(text).toContain('/Count 5');
  expect(text).toContain('/Filter /DCTDecode');
  expect(await okPromise).toBe(true);
});

/* ----------------------------------------------------------------------------
   27 — custom stickers: registry → sticker node renders the imported image
   -------------------------------------------------------------------------- */

/** 1×1 amber PNG. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4v5ThPwAG7wKklwQ/bwAAAABJRU5ErkJggg==';

test('custom sticker registers and renders inline on the page', async ({
  page,
}) => {
  const prose = await openBlankPage(page);
  await prose.click();
  await waitForHooks(page);

  const outcome = await page.evaluate((src) => {
    const id = window.__nbGroupD.registerUserSticker('E2E Bunny.png', src);
    const inserted = window.__nbGroupD.insertSticker(id);
    return {
      id,
      inserted,
      listed: window.__nbGroupD.listUserStickers().some((s) => s.id === id),
    };
  }, TINY_PNG);

  expect(outcome.id).toBe('user:e2e-bunny');
  expect(outcome.inserted).toBe(true);
  expect(outcome.listed).toBe(true);

  const sticker = prose.locator('.nb-sticker img.nb-sticker-art-user');
  await expect(sticker).toBeVisible({ timeout: 30_000 });
  await expect(sticker).toHaveAttribute('src', TINY_PNG);
  await page.screenshot({
    path: test.info().outputPath('custom-sticker-page.png'),
  });
});
