/**
 * Production Agent regression for a dragged PNG used in a notebook page.
 * Cohere is intercepted at the network boundary; the real panel, managed
 * attachment store, ingestion, graph, provider adapter, native renderer and
 * preview UI all run unchanged.
 *
 *   node shots-now/probe-agent-image-drag.mjs
 *   node shots-now/probe-agent-image-drag.mjs --sabotage
 *   ALCOVE_QA_COHERE_KEY=<disposable key> node shots-now/probe-agent-image-drag.mjs --live --vague --real-image
 *   ALCOVE_QA_COHERE_KEY=<disposable key> node shots-now/probe-agent-image-drag.mjs --live --expanded-week6 --real-image
 *
 * Live mode intercepts nothing. The key exists only in this process/headless
 * page and is never written to screenshots, reports, diagnostics or storage.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const protocolRecovery = process.argv.includes('--protocol-recovery');
const renderRecovery = process.argv.includes('--render-recovery');
const draftProseRecovery = process.argv.includes('--draft-prose-recovery');
const liveCompleteFinish = process.argv.includes('--live-complete-finish');
const live = process.argv.includes('--live');
const assetPreservation = process.argv.includes('--asset-preservation');
const emptyReviewRecovery = process.argv.includes('--empty-review-recovery');
const vagueRequest = process.argv.includes('--vague');
const realImage = process.argv.includes('--real-image');
const expandedWeek6Request = process.argv.includes('--expanded-week6');
if ([sabotage, protocolRecovery, renderRecovery, draftProseRecovery, assetPreservation, emptyReviewRecovery].filter(Boolean).length > 1) {
  throw new Error('Choose sabotage, protocol recovery, render recovery or draft prose recovery, not more than one.');
}
const requestedSize = process.argv.find((value) => value.startsWith('--size='))?.slice(7);
const allSizes = process.argv.includes('--all-sizes');
const out = resolve(
  'qa/agent-image-drag',
  live
    ? expandedWeek6Request ? 'live-expanded-week6' : 'live'
    : emptyReviewRecovery
      ? 'empty-review-recovery'
    : assetPreservation
      ? 'asset-preservation'
    : liveCompleteFinish
    ? 'live-complete-finish'
    : sabotage
    ? 'sabotage'
    : protocolRecovery
      ? 'protocol-recovery'
      : renderRecovery
        ? 'render-recovery'
        : draftProseRecovery
          ? 'draft-prose-recovery'
        : expandedWeek6Request
          ? 'expanded-week6'
        : vagueRequest || realImage
          ? 'vague-real-image'
          : 'normal',
);
const supportedViewports = [
  { width: 1500, height: 940 },
  { width: 1360, height: 850 },
  { width: 1200, height: 800 },
];
const allViewports = sabotage || protocolRecovery || renderRecovery || draftProseRecovery || assetPreservation || emptyReviewRecovery || vagueRequest || realImage
  ? [{ width: 1360, height: 850 }]
  : [{ width: 1500, height: 940 }, { width: 1200, height: 800 }];
const viewports = requestedSize === undefined
  ? allSizes ? supportedViewports : allViewports
  : supportedViewports.filter(({ width, height }) => `${width}x${height}` === requestedSize);
if (viewports.length === 0) throw new Error(`Unsupported probe size: ${requestedSize}`);
const fakeKey = 'qa_trial_key_never_sent_to_cohere';
const realImageName = 'ChatGPT Image Aug 14, 2026, 03_43_26 AM.png';
const liveKey = live ? process.env.ALCOVE_QA_COHERE_KEY?.trim() : undefined;
if (live && !liveKey) {
  throw new Error(
    'Live Agent QA requires ALCOVE_QA_COHERE_KEY in this process. The key is used only in the headless page and is never written to the report.',
  );
}
const realImageBytes = realImage
  ? await readFile(
      `C:/Users/akshi/Downloads/${realImageName}`,
    )
  : undefined;

function sse(frames) {
  return frames.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
  ).join('');
}

function toolResponse(callNumber, name, args) {
  return sse([
    ['message-start', { id: `qa-image-message-${callNumber}` }],
    ['tool-call-start', {
      delta: {
        message: {
          tool_calls: {
            id: `qa-image-call-${callNumber}`,
            function: { name, arguments: JSON.stringify(args) },
          },
        },
      },
    }],
    ['tool-call-end', {}],
    ['message-end', {
      delta: {
        finish_reason: liveCompleteFinish ? 'COMPLETE' : 'TOOL_CALL',
        usage: { tokens: { input_tokens: 160, output_tokens: 30 } },
      },
    }],
  ]);
}

function proseResponse(callNumber, text) {
  return sse([
    ['message-start', { id: `qa-image-prose-${callNumber}` }],
    ['content-delta', { delta: { message: { content: { text } } } }],
    ['message-end', {
      delta: {
        finish_reason: 'COMPLETE',
        usage: { tokens: { input_tokens: 180, output_tokens: 90 } },
      },
    }],
  ]);
}

function expandedObjects(value, found = []) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        expandedObjects(JSON.parse(trimmed), found);
      } catch {
        // Ordinary prose is intentionally ignored.
      }
    }
    return found;
  }
  if (value === null || typeof value !== 'object') return found;
  found.push(value);
  for (const child of Object.values(value)) expandedObjects(child, found);
  return found;
}

function retrievalSourceId(body) {
  for (const candidate of expandedObjects(body.messages)) {
    if (Array.isArray(candidate.sourceIds) && typeof candidate.sourceIds[0] === 'string') {
      return candidate.sourceIds[0];
    }
  }
  throw new Error('The retrieval plan did not expose its source id.');
}

function sourceReceipt(body) {
  for (const candidate of expandedObjects(body.messages).reverse()) {
    const visual = Array.isArray(candidate.visualRefs) ? candidate.visualRefs[0] : undefined;
    const unit = Array.isArray(candidate.units) ? candidate.units[0] : undefined;
    if (typeof visual?.portableAssetPath === 'string' && typeof unit?.unitId === 'string') {
      return {
        assetPath: visual.portableAssetPath,
        unitId: unit.unitId,
        width: visual.image?.width,
        height: visual.image?.height,
      };
    }
  }
  throw new Error('The image read did not retain a portable asset receipt.');
}

function previewReceipt(body) {
  for (const candidate of expandedObjects(body.messages).reverse()) {
    if (typeof candidate.generationId !== 'string' || !Array.isArray(candidate.pages)) continue;
    const pageIds = candidate.pages.map((page) => page?.pageId)
      .filter((pageId) => typeof pageId === 'string');
    if (pageIds.length > 0) return { generationId: candidate.generationId, pageIds };
  }
  throw new Error('The native preview receipt is absent.');
}

function nativeRenderRepairRequested(body) {
  return expandedObjects(body.messages).some((candidate) =>
    candidate.errorCode === 'native_render_failed');
}

function requiredAssetRepairRequested(body) {
  return expandedObjects(body.messages).some((candidate) =>
    candidate.errorCode === 'required_source_asset_missing');
}

function emptyReviewAlreadyRecorded(body) {
  return expandedObjects(body.messages).some((candidate) =>
    typeof candidate.summary === 'string' &&
    candidate.summary.includes('only the Alcove draft receipt note'));
}

function argumentsFor(name, body) {
  switch (name) {
    case 'plan_source_retrieval':
      return { request: 'plan' };
    case 'read_full_source':
      return { sourceId: retrievalSourceId(body) };
    case 'inspect_notebook':
    case 'inspect_source_coverage':
    case 'validate_notebook_script':
    case 'render_draft_preview':
    case 'propose_notebook_patch':
    case 'submit_notebook_patch':
      return { request: 'current' };
    case 'submit_notebook_script': {
      const source = sourceReceipt(body);
      const repairingRender = nativeRenderRepairRequested(body);
      const repairingMissingAsset = requiredAssetRepairRequested(body);
      const repairingEmptyReview = emptyReviewAlreadyRecorded(body);
      if (assetPreservation && !repairingMissingAsset) {
        return {
          reason: 'initial',
          citedUnitIds: [source.unitId],
          script:
            '# Alcove draft receipt\n\nThe attached picture was reviewed. This receipt will be inserted later.',
        };
      }
      const pageWidth = Number(source.height) > Number(source.width) ? 48 : 88;
      const title = 'Box packing';
      const caption = 'Week 6 · box packing problem';
      const note = 'Use the diagram above as the compact Week 6 reference for the box packing problem.';
      return {
        reason: repairingRender || repairingEmptyReview ? 'repair' : 'initial',
        citedUnitIds: [source.unitId],
        script: [
          '---',
          'title: Week 6 — Box Packing',
          'paper: grid',
          'wash: sky',
          '---',
          '',
          `# ${title} {sticker=box}`,
          '',
          `![${title} diagram](){asset="${source.assetPath}", width=${pageWidth}, align=center, style=polaroid, caption="${caption}"}`,
          ...(expandedWeek6Request
            ? [
                '',
                '::page',
                '',
                '# Box packing — short notes',
                '',
                '- Choose boxes without exceeding the available capacity.',
                '- Compare combinations to find the best total value.',
                '- The kitten diagram keeps the constraints and choices visible.',
              ]
            : [
                '',
                '::: callout {variant=tip, color=sky}',
                `**Quick note:** ${note}`,
                ':::',
              ]),
          ...(repairingRender || repairingEmptyReview
            ? ['', 'The repaired layout keeps the image and note in one compact page section.']
            : []),
        ].join('\n'),
      };
    }
    case 'read_draft_preview_pages': {
      const receipt = previewReceipt(body);
      return { generationId: receipt.generationId, pageIds: receipt.pageIds };
    }
    case 'record_visual_review': {
      const receipt = previewReceipt(body);
      return {
        generationId: receipt.generationId,
        reviews: receipt.pageIds.map((pageId) => ({
          pageId,
          findings:
            emptyReviewRecovery && !emptyReviewAlreadyRecorded(body)
              ? [{
                  severity: 'info',
                  category: 'other',
                  summary: 'Page contains only the Alcove draft receipt note with no content',
                }]
              : [],
        })),
      };
    }
    default:
      throw new Error(`Unexpected Agent image phase: ${name}`);
  }
}

function bodyHasImage(body) {
  return (body.messages ?? []).some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
}

async function openWelcome(page) {
  await page.waitForFunction(() =>
    typeof globalThis.__shelfVisibleBooks === 'function' &&
    typeof globalThis.__shelfPullOut === 'function');
  const book = await page.evaluate(() => {
    const books = globalThis.__shelfVisibleBooks();
    const book = books.find((candidate) => /welcome/i.test(candidate.title)) ?? books[0];
    if (book === undefined) throw new Error('No notebook is available.');
    globalThis.__shelfPullOut(book.id);
    return book;
  });
  const held = page.locator('[data-testid="pulled-book"][role="button"]');
  await held.waitFor({ state: 'visible' });
  await held.click({ force: true });
  return book;
}

async function notebookSnapshot(page, bookId) {
  return page.evaluate(async (id) => {
    const { listPages } = await import('/src/data/pages.ts');
    const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
    const pages = await listPages(id);
    return { revision: await computeNotebookRevision(pages), pageIds: pages.map((page) => page.id) };
  }, bookId);
}

async function stableNotebookSnapshot(page, bookId) {
  let previous = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await notebookSnapshot(page, bookId);
    if (previous !== null && current.revision === previous.revision &&
      JSON.stringify(current.pageIds) === JSON.stringify(previous.pageIds)) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error('Notebook did not stabilize.');
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const report = {
  generatedAt: new Date().toISOString(),
  sabotage,
  protocolRecovery,
  renderRecovery,
  draftProseRecovery,
  liveCompleteFinish,
  live,
  assetPreservation,
  emptyReviewRecovery,
  vagueRequest,
  realImage,
  runs: [],
};

try {
  for (const viewport of viewports) {
    const size = `${viewport.width}x${viewport.height}`;
    const runOut = resolve(out, size);
    await mkdir(runOut, { recursive: true });
    const context = await browser.newContext({ viewport });
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: new URL(base).origin },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(live ? 240_000 : 90_000);
    const run = {
      viewport,
      chatBodies: [],
      selectedTools: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      status: 'running',
      protocolInvalidInjected: false,
      draftProtocolInvalidInjected: false,
      draftProseFallbackUsed: false,
      assetAutoInserted: false,
    };
    report.runs.push(run);
    page.on('console', (message) => {
      if (message.type() === 'error') run.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => run.pageErrors.push(error.message));
    page.on('requestfailed', (request) => run.failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? 'unknown',
    }));
    page.on('response', (response) => {
      if (response.status() < 400) return;
      run.httpErrors.push({
        status: response.status(),
        url: response.url().slice(0, 1_000),
      });
    });

    if (!live) {
      await page.route('https://api.cohere.com/v1/check-api-key', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"valid":true}' }));
      await page.route('https://api.cohere.com/v2/chat', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const tools = (body.tools ?? []).map((tool) => tool.function?.name);
      const hasSourceTools = tools.some((name) => [
        'list_source_manifest', 'plan_source_retrieval', 'read_source_range',
        'read_full_source', 'search_source_index', 'rerank_source_hits',
        'inspect_source_coverage',
      ].includes(name));
      const hasImage = bodyHasImage(body);
      run.chatBodies.push({
        tools,
        strictTools: body.strict_tools ?? null,
        hasImage,
        hasSourceTools,
        correctivePrompt: (body.messages ?? []).some((message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('previous source-routing response could not be parsed')),
        draftProsePrompt: (body.messages ?? []).some((message) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('previous draft tool envelope could not be parsed')),
      });
      if (expandedObjects(body.messages).some((candidate) =>
        Array.isArray(candidate.managedSourceAssetsInserted) &&
        candidate.managedSourceAssetsInserted.length > 0
      )) run.assetAutoInserted = true;
      if (sabotage && run.selectedTools.length === 0) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"message":"deliberate source-envelope rejection"}',
        });
        return;
      }
      if (
        draftProseRecovery &&
        run.draftProtocolInvalidInjected &&
        !run.draftProseFallbackUsed &&
        tools.length === 0
      ) {
        const draft = argumentsFor('submit_notebook_script', body);
        run.draftProseFallbackUsed = true;
        // The local supervisor will convert this raw model-authored script to
        // the missing submit_notebook_script call. Count it in the expected
        // executed sequence even though Cohere did not produce the envelope.
        run.selectedTools.push('submit_notebook_script');
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: proseResponse(run.chatBodies.length, draft.script),
        });
        return;
      }
      if (
        draftProseRecovery &&
        !run.draftProtocolInvalidInjected &&
        tools.includes('submit_notebook_script')
      ) {
        run.draftProtocolInvalidInjected = true;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sse([['message-start', { id: 'qa-deliberately-incomplete-draft-turn' }]]),
        });
        return;
      }
      if (
        protocolRecovery && !run.protocolInvalidInjected &&
        run.selectedTools.length === 1
      ) {
        run.protocolInvalidInjected = true;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: sse([['message-start', { id: 'qa-deliberately-incomplete-source-turn' }]]),
        });
        return;
      }
      if ((hasSourceTools || hasImage) && body.strict_tools !== undefined) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"message":"strict_tools is incompatible with this source/image envelope"}',
        });
        return;
      }
      const priority = [
        ...(run.selectedTools.length === 0 ? ['inspect_notebook'] : []),
        ...(!run.selectedTools.includes('plan_source_retrieval') &&
          !run.selectedTools.includes('read_full_source')
          ? ['inspect_source_coverage', 'plan_source_retrieval']
          : []),
        'read_full_source',
        'submit_notebook_script',
        'validate_notebook_script',
        'render_draft_preview',
        'read_draft_preview_pages',
        'record_visual_review',
        'propose_notebook_patch',
        'submit_notebook_patch',
      ];
      const name = priority.find((candidate) => tools.includes(candidate));
      if (name === undefined) throw new Error(`No expected tool was offered: ${tools.join(', ')}`);
      run.selectedTools.push(name);
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: toolResponse(run.selectedTools.length, name, argumentsFor(name, body)),
      });
      });
    }

    try {
      await page.goto(
        `${base.replace(/\/$/, '')}/?fx=force&qa=agent-production&dev=0${renderRecovery ? '&qa-render-failure=once' : ''}`,
        { waitUntil: 'domcontentloaded' },
      );
      const skipTour = page.getByText('skip the tour', { exact: false }).first();
      await skipTour.waitFor({ state: 'visible' });
      await skipTour.click({ force: true });
      await page.keyboard.press('Escape').catch(() => {});
      run.book = await openWelcome(page);
      await page.waitForSelector('.nb-prose');
      await page.evaluate(() => window.dispatchEvent(new Event('alcove:open-ai-agent-panel')));
      await page.waitForSelector('.nb-rail-panel.is-ai-agent[aria-hidden="false"]');
      const setup = page.locator('.nb-ai-key-sheet');
      await setup.waitFor({ state: 'visible' });
      await setup.getByText('Trial / evaluation', { exact: true }).click();
      await setup.locator('.nb-ai-key-field input').fill(liveKey ?? fakeKey);
      await setup.locator('input[type="checkbox"]').check({ force: true });
      await setup.getByRole('button', { name: /Test key & connect/i }).click();
      await setup.waitFor({ state: 'hidden' });

      const composer = page.locator('.nb-ai-composer-wrap');
      const transfer = await page.evaluateHandle(async (realFile) => {
        if (realFile !== null) {
          const binary = atob(realFile.base64);
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], realFile.name, { type: 'image/png' }));
          return transfer;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 720;
        canvas.height = 420;
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Canvas unavailable.');
        ctx.fillStyle = '#f8f0dc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#473a2b';
        ctx.lineWidth = 7;
        ctx.strokeRect(18, 18, 684, 384);
        ctx.fillStyle = '#d88474';
        ctx.fillRect(78, 130, 150, 150);
        ctx.fillStyle = '#8eb6a0';
        ctx.fillRect(285, 96, 170, 184);
        ctx.fillStyle = '#83a9d6';
        ctx.fillRect(512, 158, 118, 122);
        ctx.fillStyle = '#473a2b';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText('WEEK 6 · BOX PACKING', 132, 70);
        const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, 'image/png'));
        if (blob === null) throw new Error('Could not encode QA PNG.');
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'week-6-box-packing.png', { type: 'image/png' }));
        return transfer;
      }, realImageBytes === undefined
        ? null
        : {
            base64: realImageBytes.toString('base64'),
            name: realImageName,
          });
      await composer.dispatchEvent('dragenter', { dataTransfer: transfer });
      await page.locator('.nb-ai-file-drop-hint').waitFor({ state: 'visible' });
      run.dropHint = await page.locator('.nb-ai-file-drop-hint').innerText();
      await page.locator('.nb-ai-agent').screenshot({
        path: resolve(runOut, 'drop-ready.png'), animations: 'disabled', caret: 'hide',
      });
      await composer.dispatchEvent('drop', { dataTransfer: transfer });
      const attachment = page.locator('.nb-ai-attachment[data-status="ready"]');
      await attachment.waitFor({ state: 'visible' });
      run.attachment = {
        text: await attachment.innerText(),
        hasPreview: await attachment.locator('img').count() === 1,
      };
      await page.locator('.nb-ai-agent').screenshot({
        path: resolve(runOut, 'attached.png'), animations: 'disabled', caret: 'hide',
      });
      await page.locator('button[aria-label="Open a larger writing sheet"]').click();
      const expanded = page.locator('.nb-ai-expanded-composer');
      await expanded.waitFor({ state: 'visible' });
      await expanded.dispatchEvent('dragenter', { dataTransfer: transfer });
      const expandedHint = expanded.locator('.nb-ai-file-drop-hint');
      await expandedHint.waitFor({ state: 'visible' });
      run.expandedDropHint = await expandedHint.innerText();
      await expanded.screenshot({
        path: resolve(runOut, 'expanded-drop-ready.png'), animations: 'disabled', caret: 'hide',
      });
      await expanded.dispatchEvent('dragleave', { dataTransfer: transfer });
      await expanded.locator('.nb-ai-modal-close').click();
      await expanded.waitFor({ state: 'hidden' });

      run.before = await stableNotebookSnapshot(page, run.book.id);
      await page.locator('textarea[aria-label="What should the agent do?"]').fill(
        expandedWeek6Request
          ? 'hi can you add this image for week 6, its box problem something, also make sure to add some write up about it in other pages, but not much write up is needed, also you can put the picture in one page and let it take up space fully, at the beginning of week 6'
          : vagueRequest
          ? 'add to my book'
          : 'add this picture for week 6, for box packing problem, no need for too much writeup, just a little',
      );
      await page.locator('button[aria-label="Send to AI agent"]').click();
      if (sabotage) {
        await page.locator('.nb-ai-error-card').waitFor({ state: 'visible' });
      } else {
        const outcome = await Promise.race([
          page.locator('.nb-ai-final-preview').waitFor({ state: 'visible' }).then(() => 'preview'),
          page.locator('.nb-ai-error-card').waitFor({ state: 'visible' }).then(() => 'error'),
        ]);
        if (outcome === 'error') {
          throw new Error(
            `Agent stopped before preview: ${await page.locator('.nb-ai-error-card').innerText()}`,
          );
        }
        await page.locator('.nb-ai-final-preview .nb-ai-approve-action').waitFor({ state: 'visible' });
        await page.locator('.nb-ai-preview-stage').click({ force: true });
        const fullPreview = page.locator('.nb-ai-full-preview');
        await fullPreview.waitFor({ state: 'visible' });
        run.fullPreview = await fullPreview.locator('img').evaluateAll((images) => ({
          count: images.length,
          loaded: images.length > 0 && images.every((image) =>
            image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
        }));
        await fullPreview.screenshot({
          path: resolve(runOut, 'full-preview.png'), animations: 'disabled', caret: 'hide',
        });
        const nextPreviewPage = fullPreview.getByRole('button', { name: /^Next/ });
        let capturedPage = 1;
        while (capturedPage < 20 && await nextPreviewPage.isEnabled()) {
          await nextPreviewPage.click();
          capturedPage += 1;
          await fullPreview.getByText(
            new RegExp(`page ${capturedPage} of \\d+`, 'i'),
          ).waitFor({ state: 'visible' });
          await fullPreview.screenshot({
            path: resolve(runOut, `full-preview-page-${capturedPage}.png`),
            animations: 'disabled',
            caret: 'hide',
          });
        }
        run.fullPreview.capturedPages = capturedPage;
        await fullPreview.locator('.nb-ai-modal-close').click();
        await fullPreview.waitFor({ state: 'hidden' });
      }
      run.after = await stableNotebookSnapshot(page, run.book.id);
      run.ui = await page.evaluate(() => ({
        text: document.querySelector('.nb-ai-agent')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        errorCards: document.querySelectorAll('.nb-ai-error-card').length,
        previewCards: document.querySelectorAll('.nb-ai-final-preview').length,
        insertEnabled: !document.querySelector('.nb-ai-final-preview .nb-ai-approve-action')?.hasAttribute('disabled'),
        dropHints: document.querySelectorAll('.nb-ai-file-drop-hint').length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      }));
      await page.getByRole('button', { name: 'Copy AI task log' }).click();
      run.copiedDiagnostic = JSON.parse(
        await page.evaluate(() => navigator.clipboard.readText()),
      );
      run.executedTools = (run.copiedDiagnostic.timeline ?? [])
        .filter((item) => item.kind === 'tool')
        .map((item) => item.name);
      if (live) {
        run.selectedTools = [...run.executedTools];
      }
      await page.locator('.nb-ai-agent').screenshot({
        path: resolve(runOut, 'final-panel.png'), animations: 'disabled', caret: 'hide',
      });
      await page.screenshot({
        path: resolve(runOut, 'final-viewport.png'), animations: 'disabled', caret: 'hide',
      });

      const expectedOrder = [
        'inspect_notebook', 'read_full_source',
        'submit_notebook_script', 'validate_notebook_script',
        'render_draft_preview', 'read_draft_preview_pages',
        'record_visual_review', 'propose_notebook_patch', 'submit_notebook_patch',
      ];
      const expectedProviderOrder = emptyReviewRecovery
        ? ['submit_notebook_script', 'record_visual_review', 'submit_notebook_script', 'record_visual_review']
        : renderRecovery
          ? ['submit_notebook_script', 'submit_notebook_script', 'record_visual_review']
          : ['submit_notebook_script', 'record_visual_review'];
      if (renderRecovery) {
        expectedOrder.splice(5, 0,
          'submit_notebook_script',
          'validate_notebook_script',
          'render_draft_preview',
        );
      }
      if (emptyReviewRecovery) {
        expectedOrder.splice(7, 0,
          'submit_notebook_script',
          'validate_notebook_script',
          'render_draft_preview',
          'read_draft_preview_pages',
          'record_visual_review',
        );
      }
      const common = {
        fileDropAffordance: /drop to attach/i.test(run.dropHint),
        expandedFileDropAffordance: /drop to attach/i.test(run.expandedDropHint),
        draggedPngReady:
          (realImage
            ? /ChatGPT Image Aug 14, 2026/i.test(run.attachment.text)
            : /week-6-box-packing\.png/i.test(run.attachment.text)) &&
          run.attachment.hasPreview,
        incompatibleEnvelopesAreNotStrict: live || run.chatBodies
          .filter((body) => body.hasSourceTools || body.hasImage)
          .every((body) => body.strictTools === null),
        noBookMutationBeforeApproval: run.before.revision === run.after.revision &&
          JSON.stringify(run.before.pageIds) === JSON.stringify(run.after.pageIds),
        cleanBrowser: run.pageErrors.length === 0 && run.failedRequests.every((failure) =>
          live && failure.url === 'https://api.cohere.com/v2/chat') &&
          run.httpErrors.length === 0,
        noOverflow: !run.ui.horizontalOverflow,
        dropHintSettled: run.ui.dropHints === 0,
      };
      run.assertions = sabotage
        ? {
            ...common,
            deliberateProviderFailureVisible:
              run.ui.errorCards === 1 && run.ui.previewCards === 0 &&
              /provider returned an unusable response/i.test(run.ui.text),
            noToolExecuted: run.selectedTools.length === 0,
          }
        : {
            ...common,
            sourcePixelsReachedProvider: live
              ? run.selectedTools.includes('read_full_source')
              : run.chatBodies.some((body) => body.hasImage),
            liveCompleteFinishAccepted:
              !liveCompleteFinish || expectedOrder.every((name) =>
                run.executedTools.includes(name)),
            newlyAttachedPictureSuppressesRedundantQuestion:
              !vagueRequest || live
                ? !(run.copiedDiagnostic?.timeline ?? []).some((item) =>
                    item.kind === 'message' && item.role === 'agent' &&
                    /what (?:would you like|should i|do you want).*add/iu.test(item.text ?? ''))
                :
              run.chatBodies[0]?.tools.includes('ask_user') === false &&
              !run.selectedTools.includes('ask_user'),
            unreadSourceNeverClaimsCoverageComplete:
              live ||
              run.chatBodies[1]?.tools.includes('inspect_source_coverage') === false &&
              run.chatBodies[1]?.tools.includes('submit_notebook_script') === false &&
              !run.selectedTools.includes('inspect_source_coverage'),
            correctiveProtocolRecovered: !protocolRecovery ||
              run.protocolInvalidInjected === true &&
              run.chatBodies.length === expectedOrder.length + 1 &&
              run.chatBodies.some((body) => body.correctivePrompt === true),
            draftProseSupervisorRecovered: !draftProseRecovery ||
              run.draftProtocolInvalidInjected === true &&
              run.draftProseFallbackUsed === true &&
              run.chatBodies.some((body) =>
                body.tools.length === 0 && body.draftProsePrompt === true),
            nativeRenderFailureRepaired: !renderRecovery ||
              run.executedTools.filter((name) => name === 'render_draft_preview').length === 2 &&
              run.selectedTools.filter((name) => name === 'submit_notebook_script').length === 2,
            requiredAttachedAssetPreserved: !assetPreservation ||
              run.selectedTools.filter((name) => name === 'submit_notebook_script').length === 1 &&
              run.assetAutoInserted === true,
            emptyReceiptFindingForcedRepair: !emptyReviewRecovery ||
              run.selectedTools.filter((name) => name === 'record_visual_review').length === 2 &&
              run.selectedTools.filter((name) => name === 'submit_notebook_script').length === 2,
            diagnosticRetainsExactRenderFailure: !renderRecovery ||
              run.copiedDiagnostic?.runtime?.recentToolFailures?.some((failure) =>
                failure.tool === 'render_draft_preview' &&
                failure.errorCode === 'native_render_failed' &&
                /QA native renderer rejected the first draft/i.test(failure.error) &&
                failure.availableTools?.includes('submit_notebook_script')) === true,
            diagnosticStillExcludesCredential: !renderRecovery ||
              !JSON.stringify(run.copiedDiagnostic).includes(fakeKey),
            liveCredentialExcluded: !live ||
              !JSON.stringify(run.copiedDiagnostic).includes(liveKey),
            exactSourceAuthoringOrder: live
              ? [
                  'inspect_notebook',
                  'read_full_source',
                  'submit_notebook_script',
                  'validate_notebook_script',
                  'render_draft_preview',
                  'read_draft_preview_pages',
                  'record_visual_review',
                  'propose_notebook_patch',
                  'submit_notebook_patch',
                ].every((name) => run.selectedTools.includes(name))
              : JSON.stringify(run.selectedTools) === JSON.stringify(expectedProviderOrder),
            completeLocalWorkflowOrder: expectedOrder.every((name) =>
              run.executedTools.includes(name)),
            reviewedPreviewReady: run.ui.previewCards === 1 && run.ui.insertEnabled,
            nativePreviewPixelsLoaded: run.fullPreview?.count >= 1 && run.fullPreview?.loaded === true,
            noFailureUi: run.ui.errorCards === 0,
            noConsoleErrors: run.consoleErrors.length === 0,
          };
      run.failures = Object.entries(run.assertions)
        .filter(([, passed]) => passed !== true)
        .map(([name]) => name);
      run.status = run.failures.length === 0 ? 'passed' : 'failed';
    } catch (error) {
      run.status = 'failed';
      run.failure = error instanceof Error ? error.stack ?? error.message : String(error);
      try {
        const copy = page.getByRole('button', { name: 'Copy AI task log' });
        if (await copy.isVisible()) {
          await copy.click();
          run.copiedDiagnostic = JSON.parse(
            await page.evaluate(() => navigator.clipboard.readText()),
          );
        }
      } catch {
        // The primary lifecycle failure remains authoritative.
      }
      await page.screenshot({ path: resolve(runOut, 'failure.png'), caret: 'hide' }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(`agent image drag: ${run.status.toUpperCase()} · ${size}` +
      (run.failures?.length ? ` · ${run.failures.join(', ')}` : ''));
  }
} finally {
  await browser.close();
}

report.ok = report.runs.every((run) => run.status === 'passed');
await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
else if (live) console.log('agent image drag: LIVE PASS · real Cohere reached the reviewed native preview');
else if (assetPreservation) console.log('GATE ALIVE · receipt-only model draft received the exact attached image locally');
else if (emptyReviewRecovery) console.log('GATE ALIVE · info-level receipt-only finding was upgraded to blocking and repaired');
else if (sabotage) console.log('GATE ALIVE · rejected source envelope produced one visible failure');
else if (protocolRecovery) console.log('GATE ALIVE · malformed source stream received one counted correction and recovered');
else if (renderRecovery) console.log('GATE ALIVE · native render failure produced a changed draft repair and recovered');
else if (draftProseRecovery) console.log('GATE ALIVE · malformed draft tool stream recovered through model-authored raw script');
else if (liveCompleteFinish) console.log('GATE ALIVE · COMPLETE finish labels preserved every valid streamed tool call');
else if (vagueRequest) console.log('agent image drag: PASS · attached picture grounded the vague request without a question');
else console.log('agent image drag: PASS · dragged PNG reached a reviewed native preview');
