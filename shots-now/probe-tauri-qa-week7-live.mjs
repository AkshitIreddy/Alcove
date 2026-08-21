/**
 * One-shot native QA reproduction for the four-image Week 7 Cohere task.
 *
 * Preconditions:
 * - `npm run tauri:qa` is running on CDP 9222.
 * - The QA shell is hidden, taskbar-free and uses an isolated library root.
 * - The saved credential remains Rust/keyring-owned; this probe reads status
 *   only and never receives the key.
 *
 * The probe deliberately stops at the reviewed preview and never clicks Insert.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const out = resolve('qa/tauri-week7-live-raw-authoring');
const images = [
  'C:/Users/akshi/Pictures/Saved Pictures/ChatGPT Image Aug 21, 2026, 11_20_50 AM (1).png',
  'C:/Users/akshi/Pictures/Saved Pictures/ChatGPT Image Aug 21, 2026, 11_20_51 AM (2).png',
  'C:/Users/akshi/Pictures/Saved Pictures/ChatGPT Image Aug 21, 2026, 11_20_52 AM (3).png',
  'C:/Users/akshi/Pictures/Saved Pictures/ChatGPT Image Aug 21, 2026, 11_20_52 AM (4).png',
];
const prompt = 'hi this is week7 material, similar to week add to my book with explanations, so image on one page and then some write explaaining it on the next';

await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
if (context === undefined) throw new Error('The native QA WebView context is absent.');
await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: 'http://localhost:1420',
});
const page = context.pages().find((candidate) => candidate.url().includes('qa-silent=1'));
if (page === undefined) throw new Error('The native QA page is absent.');
page.setDefaultTimeout(10 * 60_000);

const report = {
  generatedAt: new Date().toISOString(),
  prompt,
  images: images.map((path) => path.split('/').at(-1)),
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  inserted: false,
  status: 'running',
};
page.on('console', (message) => {
  if (message.type() === 'error') report.consoleErrors.push(message.text());
});
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('requestfailed', (request) => report.failedRequests.push({
  url: request.url(),
  error: request.failure()?.errorText ?? 'unknown',
}));

async function stableNotebookSnapshot(bookId) {
  let previous = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await page.evaluate(async (id) => {
      const { listPages } = await import('/src/data/pages.ts');
      const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
      const pages = await listPages(id);
      return {
        revision: await computeNotebookRevision(pages),
        pageIds: pages.map((item) => item.id),
      };
    }, bookId);
    if (previous !== null && current.revision === previous.revision &&
      JSON.stringify(current.pageIds) === JSON.stringify(previous.pageIds)) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error('The isolated QA notebook did not stabilize.');
}

const progressTimer = setInterval(async () => {
  const note = await page.locator('.nb-ai-agent-status').innerText().catch(() => 'waiting for Agent UI');
  process.stdout.write(`Week 7 live progress: ${note.replace(/\s+/g, ' ').trim()}\n`);
}, 20_000);

try {
  // The secure key is global OS state, but privacy/setup preferences belong to
  // the isolated QA DB. Record the trial acknowledgement there only.
  await page.evaluate(async () => {
    const { save } = await import('/src/data/settings.ts');
    const { getDb } = await import('/src/data/db.ts');
    await save({
      aiAgentSetupSeen: true,
      aiAgentKeyKind: 'trial',
      aiAgentTrialPrivacyAcknowledged: true,
    });
    const db = await getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      ['appState:tutorialCompleted', '1'],
    );
  });
  await page.goto(
    'http://localhost:1420/?qa-silent=1&fx=force&qa=agent-production&dev=0',
    { waitUntil: 'domcontentloaded' },
  );

  await page.waitForFunction(() => globalThis.__nbTutorial !== undefined);
  await page.evaluate(() => {
    if (globalThis.__nbTutorial?.getState().running) globalThis.__nbTutorial.stop();
  });
  await page.waitForFunction(() => globalThis.__nbTutorial?.getState().running === false);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForFunction(() =>
    typeof globalThis.__shelfVisibleBooks === 'function' &&
    typeof globalThis.__shelfPullOut === 'function' &&
    globalThis.__shelfVisibleBooks().length > 0);
  report.book = await page.evaluate(() => {
    const books = globalThis.__shelfVisibleBooks();
    const book = books.find((candidate) => /welcome/i.test(candidate.title)) ?? books[0];
    if (book === undefined) throw new Error('The isolated QA library has no notebook.');
    globalThis.__shelfPullOut(book.id);
    return book;
  });
  const held = page.locator('[data-testid="pulled-book"][role="button"]');
  await held.waitFor({ state: 'visible' });
  await held.click({ force: true });
  await page.waitForSelector('.nb-prose');

  report.boundaries = await page.evaluate(async () => {
    const credentials = await import('/src/data/aiCredentials.ts');
    const sound = await import('/src/sound/engine.ts');
    return {
      library: await globalThis.__TAURI_INTERNALS__.invoke('library_info'),
      credential: await credentials.aiCredentialStatus(),
      qaAudioForcedSilent: sound.qaAudioForcedSilent(),
      sound: sound.getEngineState(),
      soundResources: performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/sounds/')),
    };
  });

  await page.evaluate(() => window.dispatchEvent(new Event('alcove:open-ai-agent-panel')));
  await page.waitForSelector('.nb-rail-panel.is-ai-agent[aria-hidden="false"]');
  const attachButton = page.getByRole('button', { name: 'Attach a source' });
  await attachButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Attach a source"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  });

  const fileInput = page.locator('input.nb-ai-file-input[type="file"]');
  await fileInput.setInputFiles(images);
  await page.waitForFunction(() =>
    document.querySelectorAll('.nb-ai-attachment[data-status="ready"]').length === 4);
  report.attachments = await page.locator('.nb-ai-attachment').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ready: node.getAttribute('data-status') === 'ready',
      hasPreview: node.querySelector('img') !== null,
    })));
  await page.locator('.nb-ai-agent').screenshot({
    path: resolve(out, '01-four-images-ready.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  report.before = await stableNotebookSnapshot(report.book.id);
  await page.locator('textarea[aria-label="What should the agent do?"]').fill(prompt);
  await page.locator('button[aria-label="Send to AI agent"]').click();
  process.stdout.write('Week 7 live: exact prompt sent to Cohere; waiting for reviewed preview.\n');

  const outcome = await Promise.race([
    page.locator('.nb-ai-final-preview').waitFor({ state: 'visible' }).then(() => 'preview'),
    page.locator('.nb-ai-error-card').waitFor({ state: 'visible' }).then(() => 'error'),
  ]);
  if (outcome === 'error') {
    throw new Error(`Agent stopped before preview: ${await page.locator('.nb-ai-error-card').innerText()}`);
  }

  const insert = page.locator('.nb-ai-final-preview .nb-ai-approve-action');
  await insert.waitFor({ state: 'visible' });
  report.insertVisible = true;
  report.insertEnabled = await insert.isEnabled();
  await page.locator('.nb-ai-agent').screenshot({
    path: resolve(out, '02-reviewed-preview-card.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  await page.locator('.nb-ai-preview-stage').click({ force: true });
  const fullPreview = page.locator('.nb-ai-full-preview');
  await fullPreview.waitFor({ state: 'visible' });
  const next = fullPreview.getByRole('button', { name: /^Next/ });
  report.previewPages = [];
  for (let index = 1; index <= 30; index += 1) {
    const image = fullPreview.locator('.nb-ai-full-preview-canvas img');
    await image.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const img = document.querySelector('.nb-ai-full-preview-canvas img');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });
    const imageState = await image.evaluate((img) => ({
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      alt: img.alt,
    }));
    const path = resolve(out, `preview-page-${String(index).padStart(2, '0')}.png`);
    await image.screenshot({ path, animations: 'disabled', caret: 'hide' });
    report.previewPages.push({ index, file: path, ...imageState });
    if (!await next.isEnabled()) break;
    await next.click();
    await fullPreview.getByText(new RegExp(`page ${index + 1} of \\d+`, 'i'))
      .waitFor({ state: 'visible' });
  }
  await fullPreview.screenshot({
    path: resolve(out, '03-full-preview-last-page.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await fullPreview.locator('.nb-ai-modal-close').click();
  await fullPreview.waitFor({ state: 'hidden' });

  report.after = await stableNotebookSnapshot(report.book.id);
  report.notebookUnchanged = report.before.revision === report.after.revision &&
    JSON.stringify(report.before.pageIds) === JSON.stringify(report.after.pageIds);
  await page.getByRole('button', { name: 'Copy AI task log' }).click();
  report.diagnostic = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  report.inserted = false;
  report.status = 'passed';
  process.stdout.write(`Week 7 live: reviewed preview ready with ${report.previewPages.length} pages; Insert not clicked.\n`);
} catch (error) {
  report.status = 'failed';
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  const copy = page.getByRole('button', { name: 'Copy AI task log' });
  if (await copy.isVisible().catch(() => false)) {
    await copy.click().catch(() => undefined);
    report.diagnostic = await page.evaluate(() => navigator.clipboard.readText())
      .then((text) => JSON.parse(text))
      .catch(() => undefined);
  }
  await page.screenshot({
    path: resolve(out, 'failure.png'),
    animations: 'disabled',
    caret: 'hide',
  }).catch(() => undefined);
} finally {
  clearInterval(progressTimer);
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

if (report.status !== 'passed') {
  console.error(report.failure ?? 'Week 7 native live probe failed.');
  process.exitCode = 1;
}
