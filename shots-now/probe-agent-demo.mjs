/**
 * Responsive contract for the frozen native-Agent documentation fixture.
 *
 * The disposable renderer deliberately uses the live book leaf: a 1360×850
 * demo window has less paper than the 1500×940 README window. This probe opens
 * the real panel at both sizes, requires exactly three pages at each, saves all
 * six native page renders under ignored QA, then resets the force-only bridge
 * and proves its render URLs/state were released. It also opens the full-size
 * reviewed-page sheet and requires a decoded native render, so the demo cannot
 * regress to a blank review transition. It never calls a provider or applies a
 * draft to the notebook.
 *
 *   npm run dev
 *   node shots-now/probe-agent-demo.mjs --url=http://127.0.0.1:1420
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const QA_DIR = resolve(ROOT, 'qa/demo');
mkdirSync(QA_DIR, { recursive: true });

const arg = process.argv.find((value) => value.startsWith('--url='));
const base = arg?.slice('--url='.length) || 'http://127.0.0.1:1420';
const target = `${base}/?fx=force&dev=0`;
const sizes = [
  { label: 'demo-1360x850', width: 1360, height: 850 },
  { label: 'readme-1500x940', width: 1500, height: 940 },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
    });
    page.setDefaultTimeout(60_000);
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
      const skip = page.getByText('skip the tour');
      if (await skip.count()) await skip.first().click({ force: true });
      await page.evaluate(async () => {
        const app = await import('/src/state/app.ts');
        const books = await import('/src/data/books.ts');
        const list = await books.listBooksByFloorRange(0, 20);
        const welcome = list.find((book) => /welcome/i.test(book.title)) ?? list[0];
        if (!welcome) throw new Error('No book is available for the Agent fixture probe.');
        app.appState.openBook(welcome.id);
      });
      await page.waitForSelector('.nb-prose');
      await page.waitForFunction(() => typeof globalThis.__aiAgentDemo?.reset === 'function');
      await page.evaluate(() => document.fonts.ready);
      // Match the filmed insertion context exactly: the Agent opens on the
      // right leaf of spread 14 and places the reviewed pages after it.
      await page.locator('.nb-rail button[aria-label^="Thumbnails strip"]').click();
      await page.waitForSelector('.nb-thumb-strip', { state: 'visible' });
      await page.locator('.nb-thumb[aria-label^="Jump to Local video"]').click();
      await page.waitForFunction(() =>
        document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index') === '14'
      );
      await page.locator('.nb-rail button[aria-label^="Thumbnails strip"]').click();
      await page.waitForSelector('.nb-thumb-strip', { state: 'detached' });
      const focusedVisiblePage = await page.evaluate(() => {
        const editor = document.querySelector(
          '.nb-leaf-paper[data-side="right"] .ProseMirror',
        );
        if (!(editor instanceof HTMLElement)) return false;
        editor.focus({ preventScroll: true });
        return true;
      });
      if (!focusedVisiblePage) throw new Error(`${size.label}: could not focus the visible insertion page.`);
      await page.evaluate(async () => {
        await globalThis.__aiAgentDemo.reset('study-notes');
        globalThis.__aiAgentDemo.open();
      });
      await page.waitForFunction(() =>
        document.querySelector('.nb-rail-panel.is-ai-agent')?.getAttribute('aria-hidden') === 'false'
      );
      await page.waitForTimeout(700);
      if (await page.locator('.nb-ai-attachment').count() !== 0) {
        throw new Error(`${size.label}: the frozen demo opened with a source attached before the reader sent anything.`);
      }
      await page.locator('textarea[aria-label="What should the agent do?"]').fill(
        'Can you explain Huffman coding with kittens?',
      );
      await page.locator('button[aria-label="Send to AI agent"]').click();
      await page.waitForFunction(() => globalThis.__aiAgentDemo?.state().stage === 'intake');
      await page.evaluate(() => globalThis.__aiAgentDemo.advance('answer'));
      await page.waitForFunction(() =>
        document.querySelector('.nb-ai-agent')?.getAttribute('data-stage') === 'complete'
      );
      const firstReply = await page.evaluate(() => {
        const transcript = document.querySelector('.nb-ai-agent-scroll');
        const reply = [...document.querySelectorAll('.nb-ai-message[data-role="agent"]')].at(-1);
        if (!(transcript instanceof HTMLElement) || !(reply instanceof HTMLElement)) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const replyRect = reply.getBoundingClientRect();
        return {
          contained: replyRect.left >= transcriptRect.left - 1 && replyRect.right <= transcriptRect.right + 1,
          citations: reply.querySelectorAll('.nb-ai-citations').length,
          attachments: document.querySelectorAll('.nb-ai-attachment').length,
        };
      });
      if (!firstReply?.contained || firstReply.citations !== 0 || firstReply.attachments !== 0) {
        throw new Error(`${size.label}: first conversational reply leaked outside its box or cited a source that was not attached (${JSON.stringify(firstReply)}).`);
      }
      await page.locator('.nb-ai-agent').screenshot({
        path: resolve(QA_DIR, `agent-${size.label}-first-answer.png`),
      });
      await page.locator('textarea[aria-label="What should the agent do?"]').fill(
        'Make this into three visual study-note pages and use this kitten infographic.',
      );
      await page.locator('button[aria-label="Send to AI agent"]').click();
      await page.waitForFunction(() =>
        globalThis.__aiAgentDemo?.state().stage === 'intake' &&
          document.querySelectorAll('.nb-ai-attachment').length === 1
      );
      await page.evaluate(() => globalThis.__aiAgentDemo.advance('ready'));
      await page.waitForSelector('.nb-ai-final-preview', { state: 'visible' });
      const evidence = await page.evaluate(async () => {
        const state = globalThis.__aiAgentDemo.state();
        const badge = [...document.querySelectorAll('.nb-ai-check-badge')]
          .map((node) => node.textContent?.trim())
          .find((text) => text?.includes('affected'));
        const paper = [...document.querySelectorAll('.nb-sheet-paper:not(.nb-export-sheet)')]
          .filter((node) => node instanceof HTMLElement)
          .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
        const renders = [];
        for (const image of document.querySelectorAll('.nb-ai-preview-thumb img')) {
          if (!(image instanceof HTMLImageElement) || image.src === '') continue;
          const response = await fetch(image.src);
          if (!response.ok) throw new Error(`Could not read ${image.alt || 'Agent page render'}.`);
          renders.push(Array.from(new Uint8Array(await response.arrayBuffer())));
        }
        return {
          state,
          badge,
          paper: paper instanceof HTMLElement
            ? {
                width: Number.parseFloat(getComputedStyle(paper).width),
                height: Number.parseFloat(getComputedStyle(paper).height),
              }
            : null,
          renders,
        };
      });
      if (evidence.state.renderedPages !== 3 || evidence.renders.length !== 3) {
        throw new Error(`${size.label}: expected 3 native pages, got ${JSON.stringify(evidence.state)}`);
      }
      if (evidence.badge !== '3 affected pages') {
        throw new Error(`${size.label}: final UI badge is ${JSON.stringify(evidence.badge)}`);
      }
      await page.locator('.nb-ai-preview-stage').click();
      await page.waitForFunction(() => {
        const dialog = document.querySelector('.nb-ai-full-preview');
        const image = dialog?.querySelector('.nb-ai-full-preview-canvas > img');
        return dialog instanceof HTMLElement &&
          image instanceof HTMLImageElement && image.complete &&
          image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      const fullPreview = await page.locator('.nb-ai-full-preview').boundingBox();
      if (fullPreview === null || fullPreview.width < 700 || fullPreview.height < 500) {
        throw new Error(`${size.label}: full reviewed-page sheet is blank or collapsed.`);
      }
      const previewMetrics = await page.evaluate(() => {
        const canvas = document.querySelector('.nb-ai-full-preview-canvas');
        const image = canvas?.querySelector('img');
        const scrollbar = document.querySelector('.nb-ai-transcript-scrollbar');
        const transcript = document.querySelector('.nb-ai-agent-scroll');
        if (!(canvas instanceof HTMLElement) || !(image instanceof HTMLImageElement)) return null;
        const canvasRect = canvas.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        return {
          fit: canvas.classList.contains('is-fit'),
          imageContained:
            imageRect.left >= canvasRect.left - 1 && imageRect.right <= canvasRect.right + 1 &&
            imageRect.top >= canvasRect.top - 1 && imageRect.bottom <= canvasRect.bottom + 1,
          transcriptScrollbarVisible:
            scrollbar instanceof HTMLElement && !scrollbar.hidden && scrollbar.getBoundingClientRect().height > 100,
          transcriptExtent: transcript instanceof HTMLElement
            ? { clientHeight: transcript.clientHeight, scrollHeight: transcript.scrollHeight }
            : null,
          scrollbar: scrollbar instanceof HTMLElement
            ? { hidden: scrollbar.hidden, height: scrollbar.getBoundingClientRect().height }
            : null,
        };
      });
      if (!previewMetrics?.fit || !previewMetrics.imageContained) {
        throw new Error(`${size.label}: full preview did not open fit-to-page (${JSON.stringify(previewMetrics)}).`);
      }
      if (!previewMetrics.transcriptScrollbarVisible) {
        throw new Error(`${size.label}: Agent transcript scrollbar is missing (${JSON.stringify(previewMetrics)}).`);
      }
      await page.locator('.nb-ai-full-preview').screenshot({
        path: resolve(QA_DIR, `agent-${size.label}-full-preview.png`),
      });
      await page.locator('[aria-label="Next reviewed page"]').click();
      await page.waitForFunction(() =>
        document.querySelector('.nb-ai-full-preview-nav')?.textContent?.includes('page 2 of 3') === true
      );
      await page.locator('.nb-ai-full-preview .nb-ai-modal-close').click();
      await page.waitForSelector('.nb-ai-full-preview', { state: 'detached' });
      if (size.label === 'demo-1360x850') {
        await page.locator('.nb-ai-approve-action').click();
        await page.waitForFunction(() => {
          const state = globalThis.__aiAgentDemo?.state();
          return state?.stage === 'inserted' && state.insertedPages === 3;
        });
        const close = page.locator('[aria-label^="Close AI agent"]');
        await close.click();
        await page.waitForFunction(() =>
          document.querySelector('.nb-rail-panel.is-ai-agent')?.getAttribute('aria-hidden') === 'true'
        );
        const firstInsertedSpread = await page.evaluate(() => ({
          spread: document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index'),
          headings: [...document.querySelectorAll('.nb-leaf-paper h1')]
            .map((node) => node.textContent?.trim()),
        }));
        if (
          firstInsertedSpread.spread !== '15' ||
          !firstInsertedSpread.headings.includes('Huffman Coding with Kittens') ||
          !firstInsertedSpread.headings.includes('Build the Kitten Tree')
        ) {
          throw new Error(`${size.label}: first inserted spread landed on ${JSON.stringify(firstInsertedSpread)}`);
        }
        await page.locator('.nb-rail button[aria-label^="Thumbnails strip"]').click();
        await page.waitForSelector('.nb-thumb-strip', { state: 'visible' });
        const lookInside = page.locator('.nb-thumb[aria-label^="Jump to Read, Check, Decode"]');
        if (await lookInside.count() !== 1) {
          const labels = await page.locator('.nb-thumb').evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('aria-label')),
          );
          throw new Error(`${size.label}: inserted page thumbnail is missing (${labels.join(' | ')})`);
        }
        await lookInside.click();
        await page.waitForTimeout(800);
        const landed = await page.evaluate(() => ({
          spread: document.querySelector('[data-spread-index]')?.getAttribute('data-spread-index'),
          headings: [...document.querySelectorAll('.nb-leaf-paper h1')]
            .map((node) => node.textContent?.trim()),
        }));
        if (landed.spread !== '16' || !landed.headings.includes('Read, Check, Decode')) {
          throw new Error(`${size.label}: page 3 jump landed on ${JSON.stringify(landed)}`);
        }
      }
      evidence.renders.forEach((bytes, index) => {
        writeFileSync(
          resolve(QA_DIR, `agent-${size.label}-page-${index + 1}.png`),
          Buffer.from(bytes),
        );
      });
      await page.evaluate(() => globalThis.__aiAgentDemo.reset('study-notes'));
      const reset = await page.evaluate(() => globalThis.__aiAgentDemo.state());
      if (reset.renderedPages !== 0 || reset.stage !== 'idle' || reset.panelOpen) {
        throw new Error(`${size.label}: reset leaked fixture state ${JSON.stringify(reset)}`);
      }
      console.log(`${size.label}: PASS · 3 pages · leaf ${evidence.paper?.width}×${evidence.paper?.height}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
