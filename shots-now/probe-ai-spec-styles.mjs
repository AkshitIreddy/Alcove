/** Read-only browser QA for the AI guide creative-direction picker. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:1420';
const out = 'shots-now/out/ai-spec-styles';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 1500, height: 980 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.stack ?? error.message));

const report = { ok: false, errors, screenshots: [] };
try {
  await page.goto(`${base}/?fx=force`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('appState:tutorialCompleted', '1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  await page.evaluate(async () => globalThis.__shelfWorld.ready);
  const bookId = await page.evaluate(async () => {
    const books = await import('/src/data/books.ts');
    const pages = await import('/src/data/pages.ts');
    const book = await books.createBook({ title: 'AI style QA', floor: 0, slot: 99 });
    await pages.createPage({
      bookId: book.id,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'A bright idea 💡 belongs on the same line.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Sparkles ✨, a cat 🐈‍⬛, and a flag 🇮🇳 stay beside the words.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Keycap 1️⃣ and a warm heart 🧡 keep the handwritten rhythm.' }],
          },
        ],
      },
    });
    await pages.createPage({ bookId: book.id });
    return book.id;
  });
  if (bookId === null) throw new Error('could not create QA book');
  await page.evaluate(async (id) => {
    const app = await import('/src/state/app.ts');
    app.appState.openBook(id);
  }, bookId);
  await page.waitForSelector('.nb-rail');
  const skipTour = page.getByText('skip the tour', { exact: false });
  if ((await skipTour.count()) > 0) {
    await skipTour.first().click({ force: true });
    await page.locator('.nbt-layer').waitFor({ state: 'detached' });
  }

  const inlineEmoji = page.locator('.nb-prose .nb-inline-emoji');
  await inlineEmoji.first().waitFor({ state: 'visible' });
  report.emojiDecorationCount = await inlineEmoji.count();
  report.visibleEmoji = await inlineEmoji.evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < innerHeight &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          text: node.textContent,
          top: Number(rect.top.toFixed(2)),
          bottom: Number(rect.bottom.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          fontSize: style.fontSize,
          verticalAlign: style.verticalAlign,
        };
      }),
  );
  await page.screenshot({ path: `${out}/00-emoji-baseline.png`, caret: 'hide' });
  report.screenshots.push(`${out}/00-emoji-baseline.png`);
  const emojiProse = page.locator('.nb-prose').filter({ hasText: 'A bright idea' }).first();
  const emojiBox = await emojiProse.boundingBox();
  if (emojiBox === null) throw new Error('emoji specimen has no visible prose box');
  await page.screenshot({
    path: `${out}/00b-emoji-rule-clearance.png`,
    caret: 'hide',
    clip: {
      x: emojiBox.x,
      y: emojiBox.y,
      width: emojiBox.width,
      height: Math.min(128, emojiBox.height),
    },
  });
  report.screenshots.push(`${out}/00b-emoji-rule-clearance.png`);

  await page.locator('.nb-rail-button[data-tool="share"]').click();
  const picker = page.locator('.nb-ai-style-picker').first();
  await picker.waitFor({ state: 'visible' });
  await page.screenshot({ path: `${out}/01-share-picker.png`, caret: 'hide' });
  report.screenshots.push(`${out}/01-share-picker.png`);
  await picker.locator('.nb-ai-style-title-lockup').screenshot({
    path: `${out}/01b-style-spark-detail.png`,
    caret: 'hide',
    scale: 'css',
  });
  report.screenshots.push(`${out}/01b-style-spark-detail.png`);

  await picker.getByRole('button', { name: 'Create your own' }).click();
  const customDialog = page.getByRole('dialog', { name: 'Create a direction' });
  await customDialog.waitFor({ state: 'visible' });
  await customDialog.getByLabel('Custom direction name').fill('Bright seminar');
  await customDialog.getByLabel('Base creative direction').selectOption('visual-learning');
  await customDialog.getByLabel('Custom creative direction').fill(
    'Feel sunny, clever and inviting. Build confidence through excellent pacing and moments of visual delight, while leaving the exact composition to your own judgment.',
  );
  await customDialog.screenshot({ path: `${out}/02-custom-editor.png`, caret: 'hide' });
  report.screenshots.push(`${out}/02-custom-editor.png`);
  await customDialog.getByRole('button', { name: 'Save direction' }).click();
  await picker.getByRole('button', { name: 'Copy guide' }).click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  report.clipboardHasCustom = clipboard.includes('Feel sunny, clever and inviting.');
  report.clipboardHasGuardrail = clipboard.includes('not a rigid recipe');
  report.selected = await picker.getByLabel('Creative direction preset').inputValue();
  await page.screenshot({ path: `${out}/03-custom-saved.png`, caret: 'hide' });
  report.screenshots.push(`${out}/03-custom-saved.png`);

  await page.getByRole('button', { name: /Paste a script in/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Insert script' });
  await dialog.waitFor({ state: 'visible' });
  report.dialogPickerCount = await dialog.locator('.nb-ai-style-picker').count();
  report.dialogDownloadGuideVisible = await dialog
    .getByRole('button', { name: 'Download the format for your AI' })
    .isVisible();
  report.dialogCopyGuideVisible = await dialog
    .getByRole('button', { name: 'Copy the format for your AI' })
    .isVisible();
  await dialog.screenshot({ path: `${out}/04-insert-dialog-simple.png`, caret: 'hide' });
  report.screenshots.push(`${out}/04-insert-dialog-simple.png`);

  report.ok =
    report.clipboardHasCustom === true &&
    report.clipboardHasGuardrail === true &&
    report.selected?.startsWith('custom-') === true &&
    report.dialogPickerCount === 0 &&
    report.dialogDownloadGuideVisible === true &&
    report.dialogCopyGuideVisible === true &&
    report.visibleEmoji.length === 6 &&
    errors.length === 0;
} catch (error) {
  report.error = error.stack ?? error.message;
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
