/** Focused rendered check for inline emoji and sticker optical placement. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'qa/inline-art';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);
const report = { ok: false };
try {
  await page.goto('http://127.0.0.1:1420/?fx=force', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('appState:tutorialCompleted', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  await page.evaluate(async () => globalThis.__shelfWorld.ready);
  report.fixture = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const app = await import('/src/state/app.ts');
    const id = `qa-inline-art-${Date.now()}`;
    await books.createBook({ id, title: 'Inline art QA', floor: 0, slot: 47 });
    await pages.createPage({
      bookId: id,
      ord: 0,
      doc: {
        type: 'doc',
        attrs: { pageStyle: 'ruled', lineHeightPx: 32 },
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [
              { type: 'text', text: 'Dress the room' },
              { type: 'sticker', attrs: { stickerId: 'flower' } },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Sticker spacing belongs to the drawing.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Happy faces 😀 😀 😀 stay clear of this rule.' }],
          },
        ],
      },
    });
    await pages.createPage({ bookId: id, ord: 1 });
    app.appState.openBook(id);
    return { bookId: id };
  });
  await page.locator('.nb-rail').waitFor();
  const skipTour = page.getByText('skip the tour', { exact: true });
  if (await skipTour.isVisible().catch(() => false)) {
    await skipTour.click();
    await page.waitForTimeout(250);
  }
  const prose = page.locator('.nb-prose').filter({ hasText: 'Dress the room' }).first();
  await prose.locator(".nb-node-view[data-node-view-root='sticker']").waitFor();
  await prose.screenshot({ path: `${out}/inline-art.png`, caret: 'hide' });
  report.geometry = await prose.evaluate((root) => {
    const sticker = root.querySelector(".nb-node-view[data-node-view-root='sticker']");
    const emoji = root.querySelector('.nb-inline-emoji');
    if (!(sticker instanceof HTMLElement) || !(emoji instanceof HTMLElement)) {
      throw new Error('inline art wrappers missing');
    }
    const stickerStyle = getComputedStyle(sticker);
    const emojiStyle = getComputedStyle(emoji);
    return {
      sticker: {
        rect: sticker.getBoundingClientRect().toJSON(),
        marginStart: stickerStyle.marginInlineStart,
        verticalAlign: stickerStyle.verticalAlign,
      },
      emoji: {
        rect: emoji.getBoundingClientRect().toJSON(),
        marginStart: emojiStyle.marginInlineStart,
        verticalAlign: emojiStyle.verticalAlign,
      },
    };
  });
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
