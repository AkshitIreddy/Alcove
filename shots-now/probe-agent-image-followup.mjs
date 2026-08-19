/**
 * Production-panel regression for an image-led notebook draft followed by an
 * ordinary grounded question while the reviewed preview is still unapplied.
 *
 * This is the exact reader sequence that regressed in v0.7.5:
 *   1. drag the supplied kitten/box-packing infographic;
 *   2. ask for a Week 6 image page plus a small amount of related writing;
 *   3. leave the reviewed preview unapplied;
 *   4. ask "can you see images, tell me what do you see in this picture".
 *
 * Cohere is intercepted only at its HTTP boundary. The real attachment store,
 * production Agent runtime, graph, source read, native renderer, transcript,
 * preview interrupt and notebook persistence all run unchanged. The mock will
 * answer the follow-up even if Alcove forgot to resend the pixels, but the
 * probe independently inspects the request body and fails that case.
 *
 *   node shots-now/probe-agent-image-followup.mjs
 *   node shots-now/probe-agent-image-followup.mjs --sabotage
 *   node shots-now/probe-agent-image-followup.mjs --drop-image-sabotage
 *   node shots-now/probe-agent-image-followup.mjs --fresh-read
 *   ALCOVE_QA_COHERE_KEY=<disposable key> node shots-now/probe-agent-image-followup.mjs --live
 *
 * Sabotage clones the exact follow-up bubble after the run. The normal gate
 * must reject that duplicate and print GATE ALIVE.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const dropImageSabotage = process.argv.includes('--drop-image-sabotage');
const anySabotage = sabotage || dropImageSabotage;
const directFinish = process.argv.includes('--direct-finish');
const forceFreshRead = process.argv.includes('--fresh-read');
const live = process.argv.includes('--live');
const out = resolve(
  'qa/agent-image-followup',
  sabotage
    ? 'sabotage'
    : dropImageSabotage
      ? 'drop-image-sabotage'
    : live
      ? 'live'
    : forceFreshRead
      ? 'fresh-read'
      : directFinish ? 'direct-finish' : 'normal',
);
const imagePath = 'C:/Users/akshi/Downloads/ChatGPT Image Aug 14, 2026, 03_43_26 AM.png';
const imageName = 'ChatGPT Image Aug 14, 2026, 03_43_26 AM.png';
const initialRequest =
  'hi can you add this for week 6, the picture has mostly all the details, but maybe you add some fun looking things with info on the same on the next pages but not too much';
const followUp = 'can you see images, tell me what do you see in this picture';
const revisionFeedback =
  'Keep the same two pages, but make the box-fit comparison even shorter.';
const groundedAnswer = [
  'Yes — I can see a kitten-themed infographic titled “Box Packing Problem Explained with Kittens!”',
  'It treats each kitten as a box with length, breadth and height, then compares whether one box fits inside another.',
  'It contrasts keeping the dimensions in their original order with allowing rotation by sorting each box’s dimensions.',
  'It also gives a longest nesting chain, W → Z → U → X, with a length of 4 kittens.',
].join(' ');
const fakeKey = 'qa_trial_key_never_sent_to_cohere';
const liveKey = live ? process.env.ALCOVE_QA_COHERE_KEY?.trim() : undefined;
if (live && !liveKey) {
  throw new Error(
    'Live Agent QA requires ALCOVE_QA_COHERE_KEY in this process. It is never written to screenshots, reports or storage.',
  );
}
const NOTEBOOK_WORKFLOW_TOOLS = new Set([
  'create_draft',
  'inspect_notebook',
  'inspect_page',
  'inspect_page_range',
  'inspect_selection',
  'propose_insertion',
  'submit_notebook_script',
  'validate_notebook_script',
  'render_draft_preview',
  'get_draft_preview_manifest',
  'read_draft_preview_pages',
  'record_visual_review',
  'prepare_image_generation_prompts',
  'propose_notebook_patch',
  'submit_notebook_patch',
]);
const SOURCE_WORKFLOW_TOOLS = new Set([
  'list_source_manifest',
  'plan_source_retrieval',
  'read_source_range',
  'read_full_source',
  'search_source_index',
  'rerank_source_hits',
  'inspect_source_coverage',
]);

const clean = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sse(frames) {
  return frames.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
  ).join('');
}

function toolResponse(index, name, args) {
  return sse([
    ['message-start', { id: `qa-followup-message-${index}` }],
    ['tool-call-start', {
      delta: {
        message: {
          tool_calls: {
            id: `qa-followup-call-${index}`,
            function: { name, arguments: JSON.stringify(args) },
          },
        },
      },
    }],
    ['tool-call-end', {}],
    ['message-end', {
      delta: {
        finish_reason: 'TOOL_CALL',
        usage: { tokens: { input_tokens: 190, output_tokens: 48 } },
      },
    }],
  ]);
}

function proseResponse(index, text) {
  return sse([
    ['message-start', { id: `qa-followup-prose-${index}` }],
    ['content-delta', { delta: { message: { content: { text } } } }],
    ['message-end', {
      delta: {
        finish_reason: 'COMPLETE',
        usage: { tokens: { input_tokens: 180, output_tokens: 85 } },
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
        // Reader/model prose is not a structured receipt.
      }
    }
    return found;
  }
  if (value === null || typeof value !== 'object') return found;
  found.push(value);
  for (const child of Object.values(value)) expandedObjects(child, found);
  return found;
}

function sourceReceipt(body) {
  for (const candidate of expandedObjects(body.messages).reverse()) {
    const visual = Array.isArray(candidate.visualRefs) ? candidate.visualRefs[0] : undefined;
    const unit = Array.isArray(candidate.units) ? candidate.units[0] : undefined;
    if (
      typeof candidate.sourceId === 'string' &&
      typeof visual?.portableAssetPath === 'string' &&
      typeof unit?.unitId === 'string'
    ) {
      return {
        sourceId: candidate.sourceId,
        unitId: unit.unitId,
        assetPath: visual.portableAssetPath,
      };
    }
  }
  return null;
}

function manifestSourceId(body) {
  for (const candidate of expandedObjects(body.messages).reverse()) {
    if (!Array.isArray(candidate.sources)) continue;
    const source = candidate.sources.find((item) =>
      item !== null && typeof item === 'object' &&
      item.kind !== 'notebook_script_spec' && typeof item.id === 'string');
    if (source !== undefined) return source.id;
  }
  return null;
}

function evidenceIds(body) {
  const reads = new Map();
  const manifests = new Map();
  const coverages = new Map();
  for (const candidate of expandedObjects(body.messages)) {
    if (typeof candidate.sourceId === 'string' && Array.isArray(candidate.units)) {
      const unitIds = candidate.units
        .map((unit) => unit?.unitId)
        .filter((unitId) => typeof unitId === 'string');
      if (unitIds.length > 0) reads.set(
        `${candidate.sourceId}:${unitIds.join(',')}`,
        { sourceId: candidate.sourceId, unitIds },
      );
    }
    if (Array.isArray(candidate.sources)) {
      for (const manifestSource of candidate.sources) {
        if (
          manifestSource === null || typeof manifestSource !== 'object' ||
          typeof manifestSource.id !== 'string' || !Array.isArray(manifestSource.units)
        ) continue;
        const unitIds = manifestSource.units
          .map((unit) => unit?.unitId)
          .filter((unitId) => typeof unitId === 'string');
        manifests.set(
          `${manifestSource.id}:${unitIds.join(',')}`,
          { sourceId: manifestSource.id, unitIds },
        );
      }
    }
    if (Array.isArray(candidate.readUnitIds)) {
      const readUnitIds = candidate.readUnitIds
        .filter((unitId) => typeof unitId === 'string');
      const citedUnitIds = Array.isArray(candidate.citedUnitIds)
        ? candidate.citedUnitIds.filter((unitId) => typeof unitId === 'string')
        : [];
      coverages.set(
        `${readUnitIds.join(',')}:${citedUnitIds.join(',')}`,
        { readUnitIds, citedUnitIds },
      );
    }
  }
  return {
    reads: [...reads.values()],
    manifests: [...manifests.values()],
    coverages: [...coverages.values()],
  };
}

function responseArgumentSummary(name, args) {
  if (name === 'read_full_source') return { sourceId: args.sourceId };
  if (name === 'finish_conversation') return {
    citedUnitIds: args.citedUnitIds,
    answerCharacters: args.answer?.length ?? 0,
  };
  if (name === 'submit_notebook_script') return {
    citedUnitIds: args.citedUnitIds,
    reason: args.reason,
    scriptCharacters: args.script?.length ?? 0,
  };
  if (name === 'record_visual_review') return {
    generationId: args.generationId,
    pageIds: args.reviews?.map((review) => review.pageId) ?? [],
  };
  return {};
}

function previewReceipt(body) {
  for (const candidate of expandedObjects(body.messages).reverse()) {
    if (typeof candidate.generationId !== 'string' || !Array.isArray(candidate.pages)) continue;
    const pageIds = candidate.pages
      .map((page) => page?.pageId)
      .filter((pageId) => typeof pageId === 'string');
    if (pageIds.length > 0) return { generationId: candidate.generationId, pageIds };
  }
  return null;
}

function bodyHasImage(body) {
  return (body.messages ?? []).some((message) =>
    Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
}

async function saveEmbeddedProviderImages(body, prefix) {
  const saved = [];
  for (const message of body.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part?.type !== 'image_url') continue;
      const url = part.image_url?.url ?? part.imageUrl?.url;
      const match = typeof url === 'string'
        ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/u.exec(url)
        : null;
      if (match === null) continue;
      const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].slice('image/'.length);
      const path = resolve(out, `${prefix}-${saved.length + 1}.${extension}`);
      await writeFile(path, Buffer.from(match[2], 'base64'));
      saved.push(path);
    }
  }
  return saved;
}

function bodyText(body) {
  return JSON.stringify(body.messages ?? []).toLocaleLowerCase('en-US');
}

function draftScript(assetPath) {
  return [
    '---',
    'title: Week 6 — Box Packing',
    'paper: grid',
    'wash: amber',
    '---',
    '',
    '# Week 6 — Box Packing with Kittens {sticker=box}',
    '',
    '::: callout {variant=tip, color=sky}',
    '**Fit test:** compare length, breadth and height. Every dimension of the smaller box must be less than or equal to the matching dimension of the larger box.',
    ':::',
    '',
    `![Kitten box-packing infographic](){asset="${assetPath}", width=58, align=center, style=polaroid, caption="Length, breadth and height decide whether one box can fit inside another."}`,
    '',
    '::page',
    '',
    '## What rotation changes',
    '',
    '- **Without rotation:** keep the three dimensions in their original order.',
    '- **With rotation:** sort each box’s dimensions, then compare them component by component.',
    '',
    '::: callout {variant=note, color=lemon}',
    '**Longest chain in the picture:** W → Z → U → X, so the longest nesting sequence has **4 kittens**.',
    ':::',
    ...Array.from({ length: 4 }, (_, index) => [
      '',
      '::page',
      '',
      `## Expanded box-packing case ${index + 1}`,
      '',
      '| Box | Length | Breadth | Height |',
      '| --- | ---: | ---: | ---: |',
      `| Kitten ${index + 1} | ${index + 1} | ${index + 2} | ${index + 3} |`,
      '',
      'This extra detail is related but intentionally beyond the reader’s requested brief write-up.',
    ].join('\n')),
  ].join('\n');
}

function revisedDraftScript(assetPath) {
  return draftScript(assetPath).replace(
    '**Fit test:** compare length, breadth and height. Every dimension of the smaller box must be less than or equal to the matching dimension of the larger box.',
    '**Fit test:** each of length, breadth and height must be no larger than its matching box dimension.',
  );
}

async function openNotebook(page) {
  const book = await page.evaluate(() => {
    const books = globalThis.__shelfVisibleBooks?.() ?? [];
    const book = books.find((candidate) => /welcome/i.test(candidate.title)) ?? books[0];
    if (book === undefined) throw new Error('No notebook is available for the Agent probe.');
    return { id: book.id, title: book.title };
  });
  // Reach the rendered app through the shelf UI. Importing appState from a
  // hot-reloaded dev page can resolve a second store that the visible Solid
  // tree never observes.
  await page.locator('.shelf-a11y button').first().dispatchEvent('click');
  await page.getByRole('button', { name: `Open ${book.title}`, exact: true }).click();
  await page.waitForTimeout(900);
  const readButton = page.getByRole('button', { name: /^read it$/i });
  if (await readButton.count()) await readButton.click();
  return book;
}

async function notebookSnapshot(page, bookId) {
  return page.evaluate(async (id) => {
    const { listPages } = await import('/src/data/pages.ts');
    const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
    const pages = await listPages(id);
    return {
      revision: await computeNotebookRevision(pages),
      pageIds: pages.map((page) => page.id),
    };
  }, bookId);
}

async function stableNotebookSnapshot(page, bookId) {
  let previous = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await notebookSnapshot(page, bookId);
    if (
      previous !== null && current.revision === previous.revision &&
      JSON.stringify(current.pageIds) === JSON.stringify(previous.pageIds)
    ) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error('Notebook did not reach a stable revision.');
}

async function copiedDiagnostic(page) {
  await page.getByRole('button', { name: 'Copy AI task log' }).click();
  return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
}

function timelineTools(log) {
  return (log.timeline ?? []).filter((item) => item.kind === 'tool');
}

function timelineMessages(log, role, exactText) {
  return (log.timeline ?? []).filter((item) =>
    item.kind === 'message' && item.role === role && clean(item.text) === exactText);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const imageBytes = await readFile(imagePath);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 940 } });
await context.grantPermissions(
  ['clipboard-read', 'clipboard-write'],
  { origin: new URL(base).origin },
);
const page = await context.newPage();
page.setDefaultTimeout(live ? 240_000 : 120_000);

const report = {
  probeVersion: 1,
  generatedAt: new Date().toISOString(),
  target: `${base.replace(/\/$/, '')}/?fx=force&qa=agent-production&dev=0`,
  sabotage,
  dropImageSabotage,
  directFinish,
  forceFreshRead,
  live,
  image: { name: imageName, sha256: digest(imageBytes), bytes: imageBytes.length },
  providerRequests: [],
  providerResponses: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  httpErrors: [],
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
page.on('response', (response) => {
  if (response.status() >= 400) report.httpErrors.push({
    url: response.url(),
    status: response.status(),
  });
});

let requestIndex = 0;
let source = null;
let authoredScript = '';
let initialAuthoredScript = '';
let followupReadCompleted = false;

if (live) {
  page.on('request', (request) => {
    if (request.url() !== 'https://api.cohere.com/v2/chat') return;
    requestIndex += 1;
    try {
      const body = request.postDataJSON();
      const tools = (body.tools ?? []).map((tool) => tool.function?.name)
        .filter((name) => typeof name === 'string');
      const hasImage = bodyHasImage(body);
      const requestText = bodyText(body);
      const isRevision = requestText.includes(revisionFeedback.toLocaleLowerCase('en-US'));
      const isFollowUp = !isRevision &&
        requestText.includes(followUp.toLocaleLowerCase('en-US'));
      report.providerRequests.push({
        index: requestIndex,
        phase: isRevision ? 'revision' : isFollowUp ? 'followup' : 'initial',
        tools,
        strictTools: body.strict_tools ?? null,
        hasImage,
        wireHadSourceImageContext: hasImage && requestText.includes('attached source image'),
        hasSourceImageContext:
          hasImage && requestText.includes('attached source image') &&
          !(dropImageSabotage && isFollowUp),
        hasDraftPreviewContext: hasImage && requestText.includes('rendered alcove draft page'),
        isFollowUp,
        ...(isFollowUp ? { evidenceIds: evidenceIds(body) } : {}),
      });
    } catch (error) {
      report.providerRequests.push({
        index: requestIndex,
        phase: 'unparsed',
        parseError: error instanceof Error ? error.message : String(error),
      });
    }
  });
} else {
  await page.route('https://api.cohere.com/v1/check-api-key', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"valid":true}' }));
  await page.route('https://api.cohere.com/v2/chat', async (route) => {
  requestIndex += 1;
  const body = JSON.parse(route.request().postData() ?? '{}');
  const tools = (body.tools ?? []).map((tool) => tool.function?.name)
    .filter((name) => typeof name === 'string');
  const hasImage = bodyHasImage(body);
  const requestText = bodyText(body);
  const isRevision = requestText.includes(revisionFeedback.toLocaleLowerCase('en-US'));
  const isFollowUp = !isRevision &&
    requestText.includes(followUp.toLocaleLowerCase('en-US'));
  const phase = isRevision ? 'revision' : isFollowUp ? 'followup' : 'initial';
  const requestRecord = {
    index: requestIndex,
    phase,
    tools,
    strictTools: body.strict_tools ?? null,
    hasImage,
    wireHadSourceImageContext: hasImage && requestText.includes('attached source image'),
    hasSourceImageContext:
      hasImage && requestText.includes('attached source image') &&
      !(dropImageSabotage && isFollowUp),
    hasDraftPreviewContext: hasImage && requestText.includes('rendered alcove draft page'),
    isFollowUp,
    ...(isFollowUp ? { evidenceIds: evidenceIds(body) } : {}),
  };
  if (tools.includes('record_visual_review')) {
    requestRecord.embeddedImageFiles = await saveEmbeddedProviderImages(
      body,
      `provider-${phase}-${requestIndex}`,
    );
  }
  report.providerRequests.push(requestRecord);

  const fulfillTool = async (name, args) => {
    report.providerResponses.push({
      index: requestIndex,
      name,
      arguments: responseArgumentSummary(name, args),
    });
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: toolResponse(requestIndex, name, args),
    });
  };

  if (isRevision) {
    if (tools.length === 0 && hasImage) {
      const observed = source ?? sourceReceipt(body);
      if (observed === null) {
        await route.fulfill({ status: 400, body: 'raw revision source receipt was absent' });
        return;
      }
      authoredScript = revisedDraftScript(observed.assetPath);
      report.providerResponses.push({
        index: requestIndex,
        name: 'raw_revision_notebook_script',
        arguments: { scriptCharacters: authoredScript.length },
      });
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: proseResponse(requestIndex, authoredScript),
      });
      return;
    }
    if (tools.includes('submit_notebook_script')) {
      const observed = source ?? sourceReceipt(body);
      if (observed === null) {
        await route.fulfill({ status: 400, body: 'revision source receipt was absent' });
        return;
      }
      authoredScript = revisedDraftScript(observed.assetPath);
      await fulfillTool('submit_notebook_script', {
        reason: 'repair',
        citedUnitIds: [observed.unitId],
        script: authoredScript,
      });
      return;
    }
    if (tools.includes('record_visual_review')) {
      const preview = previewReceipt(body);
      if (preview === null) {
        await route.fulfill({ status: 400, body: 'revised native preview receipt was absent' });
        return;
      }
      await fulfillTool('record_visual_review', {
        generationId: preview.generationId,
        reviews: preview.pageIds.map((pageId) => ({ pageId, findings: [] })),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: `QA did not expect this revision tool surface: ${tools.join(', ')}` }),
    });
    return;
  }

  if (isFollowUp) {
    const observed = source ?? sourceReceipt(body);
    // Diagnostic-only alternate path: prove one relevant direct re-read can
    // recover without embeddings/RAG. The definitive normal gate must skip
    // this branch and finish from the retained read + re-projected pixels.
    if (!followupReadCompleted && tools.includes('read_full_source')) {
      const sourceId = observed?.sourceId ?? manifestSourceId(body);
      if (sourceId === null || sourceId === undefined) {
        await route.fulfill({ status: 400, body: 'follow-up source id was not available' });
        return;
      }
      followupReadCompleted = true;
      await fulfillTool('read_full_source', { sourceId });
      return;
    }
    if (tools.includes('finish_conversation')) {
      await fulfillTool('finish_conversation', {
        answer: groundedAnswer,
        citedUnitIds: observed?.unitId === undefined ? [] : [observed.unitId],
      });
      return;
    }
    if (tools.length === 0) {
      report.providerResponses.push({ index: requestIndex, name: 'plain_conversation' });
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: proseResponse(requestIndex, groundedAnswer),
      });
      return;
    }
    report.providerResponses.push({ index: requestIndex, name: 'preview_hijack_rejected' });
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'QA detected that the image question inherited notebook-preview tools.' }),
    });
    return;
  }

  if (tools.length === 0 && hasImage) {
    source = sourceReceipt(body);
    if (source === null) {
      await route.fulfill({ status: 400, body: 'raw draft source pixels/receipt were absent' });
      return;
    }
    authoredScript = draftScript(source.assetPath);
    initialAuthoredScript = authoredScript;
    report.providerResponses.push({
      index: requestIndex,
      name: 'raw_notebook_script',
      arguments: { scriptCharacters: authoredScript.length },
    });
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: proseResponse(requestIndex, authoredScript),
    });
    return;
  }

  if (tools.includes('submit_notebook_script')) {
    source = sourceReceipt(body);
    if (source === null) {
      await route.fulfill({ status: 400, body: 'initial source pixels/receipt were absent' });
      return;
    }
    authoredScript = draftScript(source.assetPath);
    initialAuthoredScript = authoredScript;
    await fulfillTool('submit_notebook_script', {
      reason: 'initial',
      citedUnitIds: [source.unitId],
      script: authoredScript,
    });
    return;
  }

  if (tools.includes('record_visual_review')) {
    const preview = previewReceipt(body);
    if (preview === null) {
      await route.fulfill({ status: 400, body: 'native preview receipt was absent' });
      return;
    }
    await fulfillTool('record_visual_review', {
      generationId: preview.generationId,
      reviews: preview.pageIds.map((pageId) => ({ pageId, findings: [] })),
    });
    return;
  }

  await route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ message: `QA did not expect this initial tool surface: ${tools.join(', ')}` }),
  });
  });
}

try {
  await page.goto(report.target, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
  const skipTour = page.getByText('skip the tour', { exact: false }).first();
  if (await skipTour.isVisible().catch(() => false)) {
    await skipTour.click({ force: true });
  }
  await page.keyboard.press('Escape').catch(() => {});
  report.book = await openNotebook(page);
  await page.waitForSelector('.nb-prose');
  await page.evaluate(() => window.dispatchEvent(new Event('alcove:open-ai-agent-panel')));
  await page.waitForSelector('.nb-rail-panel.is-ai-agent[aria-hidden="false"]');

  const setup = page.locator('.nb-ai-key-sheet');
  if (await setup.isVisible().catch(() => false)) {
    await setup.getByText('Trial / evaluation', { exact: true }).click();
    await setup.locator('.nb-ai-key-field input').fill(liveKey ?? fakeKey);
    await setup.locator('input[type="checkbox"]').check({ force: true });
    await setup.getByRole('button', { name: /Test key & connect/i }).click();
    await setup.waitFor({ state: 'hidden' });
  }

  const composerWrap = page.locator('.nb-ai-composer-wrap');
  const transfer = await page.evaluateHandle(({ base64, name }) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], name, { type: 'image/png' }));
    return data;
  }, { base64: imageBytes.toString('base64'), name: imageName });
  await composerWrap.dispatchEvent('dragenter', { dataTransfer: transfer });
  await page.locator('.nb-ai-file-drop-hint').waitFor({ state: 'visible' });
  await composerWrap.dispatchEvent('drop', { dataTransfer: transfer });
  const attachment = page.locator('.nb-ai-attachment[data-status="ready"]');
  await attachment.waitFor({ state: 'visible' });
  report.attachment = {
    text: clean(await attachment.innerText()),
    imageLoaded: await attachment.locator('img').evaluate((image) =>
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
  };
  await page.locator('.nb-ai-agent').screenshot({
    path: resolve(out, '01-attached.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  report.before = await stableNotebookSnapshot(page, report.book.id);
  const composer = page.locator('textarea[aria-label="What should the agent do?"]');
  const send = page.locator('button[aria-label="Send to AI agent"]');
  await composer.fill(initialRequest);
  await send.click();
  const firstOutcome = await Promise.race([
    page.locator('.nb-ai-final-preview').waitFor({ state: 'visible' }).then(() => 'preview'),
    page.locator('.nb-ai-error-card').waitFor({ state: 'visible' }).then(() => 'error'),
  ]);
  if (firstOutcome !== 'preview') {
    throw new Error(`Initial image task failed: ${clean(await page.locator('.nb-ai-error-card').innerText())}`);
  }
  const previewCard = page.locator('.nb-ai-final-preview');
  await previewCard.locator('.nb-ai-approve-action').waitFor({ state: 'visible' });
  const previewBeforeBytes = await previewCard.screenshot({
    path: resolve(out, '02-preview-before-followup.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  report.previewBefore = {
    text: clean(await previewCard.innerText()),
    sha256: digest(previewBeforeBytes),
    id: await previewCard.getAttribute('data-preview-id'),
    imageCount: await previewCard.locator('img').count(),
    imageSources: await previewCard.locator('img').evaluateAll((images) =>
      images.map((image) => image.src)),
  };

  await previewCard.locator('.nb-ai-preview-stage').click({ force: true });
  const fullPreview = page.locator('.nb-ai-full-preview');
  await fullPreview.waitFor({ state: 'visible' });
  const pageImages = fullPreview.locator('.nb-ai-full-preview-canvas img');
  report.previewBefore.fullPreviewImages = await pageImages.evaluateAll((images) => ({
    count: images.length,
    loaded: images.length > 0 && images.every((image) =>
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
  }));
  await fullPreview.screenshot({
    path: resolve(out, '03-preview-page-1.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  const next = fullPreview.getByRole('button', { name: /^Next/ });
  let capturedPages = 1;
  while (capturedPages < 8 && await next.isEnabled()) {
    await next.click();
    capturedPages += 1;
    await fullPreview.getByText(new RegExp(`page ${capturedPages} of \\d+`, 'i'))
      .waitFor({ state: 'visible' });
    await fullPreview.screenshot({
      path: resolve(out, `03-preview-page-${capturedPages}.png`),
      animations: 'disabled',
      caret: 'hide',
    });
  }
  report.previewBefore.capturedPages = capturedPages;
  await fullPreview.locator('.nb-ai-modal-close').click();
  await fullPreview.waitFor({ state: 'hidden' });

  report.beforeFollowupLog = await copiedDiagnostic(page);
  const firstToolIds = new Set(timelineTools(report.beforeFollowupLog).map((item) => item.id));
  const agentMessageCountBeforeFollowup = await page.locator(
    '.nb-ai-message[data-role="agent"] .nb-ai-message-copy',
  ).count();

  await composer.fill(followUp);
  await send.click();
  const followupOutcome = await Promise.race([
    page.waitForFunction(({ exactAnswer, previousCount, liveMode }) => {
      const messages = [...document.querySelectorAll(
        '.nb-ai-message[data-role="agent"] .nb-ai-message-copy',
      )].map((node) => node.textContent?.replace(/\s+/g, ' ').trim());
      return liveMode ? messages.length === previousCount + 1 : messages.includes(exactAnswer);
    }, {
      exactAnswer: groundedAnswer,
      previousCount: agentMessageCountBeforeFollowup,
      liveMode: live,
    }).then(() => 'answer'),
    page.locator('.nb-ai-error-card').waitFor({ state: 'visible' }).then(() => 'error'),
  ]);
  if (followupOutcome === 'error') {
    throw new Error(`Follow-up image question failed: ${clean(await page.locator('.nb-ai-error-card').innerText())}`);
  }
  await page.waitForFunction(() =>
    document.querySelectorAll('.nb-ai-agent-progress, .nb-ai-working-whisper').length === 0);

  if (sabotage) {
    await page.evaluate((exactFollowUp) => {
      const original = [...document.querySelectorAll(
        '.nb-ai-message[data-role="reader"]',
      )].find((node) => node.querySelector('.nb-ai-message-copy')
        ?.textContent?.replace(/\s+/g, ' ').trim() === exactFollowUp);
      if (!(original instanceof HTMLElement)) throw new Error('Could not find follow-up bubble to sabotage.');
      const clone = original.cloneNode(true);
      clone.dataset.qaSabotage = 'duplicate-followup';
      original.after(clone);
    }, followUp);
  }

  const followupReaderBubble = page.locator(
    '.nb-ai-message[data-role="reader"]',
  ).filter({ hasText: followUp }).last();
  await followupReaderBubble.scrollIntoViewIfNeeded();
  report.followupMessageVisibility = await page.evaluate((exactFollowUp) => {
    const cleanText = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const viewport = document.querySelector('.nb-ai-agent')?.getBoundingClientRect();
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || viewport === undefined) return false;
      const rect = node.getBoundingClientRect();
      const visibleHeight = Math.min(rect.bottom, viewport.bottom) -
        Math.max(rect.top, viewport.top);
      return visibleHeight >= Math.min(32, rect.height);
    };
    const readers = [...document.querySelectorAll('.nb-ai-message[data-role="reader"]')]
      .filter((node) => cleanText(
        node.querySelector('.nb-ai-message-copy')?.textContent,
      ) === exactFollowUp);
    const agents = [...document.querySelectorAll('.nb-ai-message[data-role="agent"]')];
    return {
      readerVisible: visible(readers.at(-1)),
      agentVisible: visible(agents.at(-1)),
    };
  }, followUp);
  await page.locator('.nb-ai-agent').screenshot({
    path: resolve(out, '04a-followup-question-and-answer.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  report.followupComposerPlaceholder = await composer.getAttribute('placeholder');
  await previewCard.scrollIntoViewIfNeeded();
  await previewCard.screenshot({
    path: resolve(out, '04b-preview-restored.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  report.after = await stableNotebookSnapshot(page, report.book.id);
  report.afterFollowupLog = await copiedDiagnostic(page);
  const afterTools = timelineTools(report.afterFollowupLog);
  const newTools = afterTools.filter((item) => !firstToolIds.has(item.id));
  await previewCard.locator('.nb-ai-preview-thumb').first().click();
  const previewAfterBytes = await previewCard.screenshot({
    path: resolve(out, '04-preview-after-followup.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await page.locator('.nb-ai-agent').screenshot({
    path: resolve(out, '05-final-panel.png'),
    animations: 'disabled',
    caret: 'hide',
  });
  await page.screenshot({
    path: resolve(out, '06-final-viewport.png'),
    animations: 'disabled',
    caret: 'hide',
  });

  report.previewAfter = {
    count: await page.locator('.nb-ai-final-preview').count(),
    text: clean(await previewCard.innerText()),
    sha256: digest(previewAfterBytes),
    id: await previewCard.getAttribute('data-preview-id'),
    imageSources: await previewCard.locator('img').evaluateAll((images) =>
      images.map((image) => image.src)),
    insertEnabled: await previewCard.locator('.nb-ai-approve-action').isEnabled(),
  };
  report.followup = await page.evaluate(({
    exactInitial,
    exactFollowUp,
    exactAnswer,
    previousAgentCount,
  }) => {
    const tidy = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const reader = [...document.querySelectorAll(
      '.nb-ai-message[data-role="reader"] .nb-ai-message-copy',
    )].map((node) => tidy(node.textContent));
    const agent = [...document.querySelectorAll(
      '.nb-ai-message[data-role="agent"] .nb-ai-message-copy',
    )].map((node) => tidy(node.textContent));
    return {
      reader,
      agent,
      exactInitialCount: reader.filter((text) => text === exactInitial).length,
      exactFollowUpCount: reader.filter((text) => text === exactFollowUp).length,
      exactAnswerCount: agent.filter((text) => text === exactAnswer).length,
      newAgentMessages: agent.slice(previousAgentCount),
      errorCards: document.querySelectorAll('.nb-ai-error-card').length,
      staleProgress: document.querySelectorAll(
        '.nb-ai-agent-progress, .nb-ai-working-whisper, .nb-ai-mini-progress',
      ).length,
      toolErrors: document.querySelectorAll('.nb-ai-tool-card[data-status="error"]').length,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, {
    exactInitial: initialRequest,
    exactFollowUp: followUp,
    exactAnswer: groundedAnswer,
    previousAgentCount: agentMessageCountBeforeFollowup,
  });
  report.followup.newTools = newTools.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    summary: item.summary,
  }));

  // The ordinary composer has now proved it is a side-conversation lane. The
  // explicit card action must still arm one real authoring turn, otherwise the
  // fix would make reviewed previews impossible to revise.
  const sidePreviewId = report.previewAfter.id ??
    report.afterFollowupLog.runtime?.proposalPreviewId;
  const sideToolIds = new Set(afterTools.map((item) => item.id));
  if (!live && !anySabotage) {
    await previewCard.getByRole('button', { name: 'Ask for changes' }).click();
    report.revisionComposerPrefill = await composer.inputValue();
    await composer.fill(revisionFeedback);
    await send.click();
    const revisionOutcome = await Promise.race([
      page.waitForFunction((previousId) => {
        const card = document.querySelector('.nb-ai-final-preview');
        const insert = card?.querySelector('.nb-ai-approve-action');
        return card instanceof HTMLElement &&
          card.dataset.previewId !== undefined &&
          card.dataset.previewId !== previousId &&
          insert instanceof HTMLButtonElement && !insert.disabled;
      }, sidePreviewId).then(() => 'preview'),
      page.locator('.nb-ai-error-card').waitFor({ state: 'visible' }).then(() => 'error'),
    ]);
    if (revisionOutcome === 'error') {
      throw new Error(`Explicit preview revision failed: ${clean(await page.locator('.nb-ai-error-card').innerText())}`);
    }
    report.afterRevision = await stableNotebookSnapshot(page, report.book.id);
    report.afterRevisionLog = await copiedDiagnostic(page);
    const revisionTools = timelineTools(report.afterRevisionLog)
      .filter((item) => !sideToolIds.has(item.id));
    const revisionPreviewBytes = await previewCard.screenshot({
      path: resolve(out, '07-explicit-revision-preview.png'),
      animations: 'disabled',
      caret: 'hide',
    });
    report.revision = {
      previewId: await previewCard.getAttribute('data-preview-id'),
      previewSha256: digest(revisionPreviewBytes),
      previewCount: await page.locator('.nb-ai-final-preview').count(),
      insertEnabled: await previewCard.locator('.nb-ai-approve-action').isEnabled(),
      exactFeedbackCountInLog:
        timelineMessages(report.afterRevisionLog, 'reader', revisionFeedback).length,
      tools: revisionTools.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        summary: item.summary,
      })),
    };
  } else {
    report.afterRevision = report.after;
    report.afterRevisionLog = report.afterFollowupLog;
    report.revision = { skipped: live ? 'live-mode' : 'focused-sabotage', tools: [] };
  }

  const initialProviderRequests = report.providerRequests.filter((item) => item.phase === 'initial');
  const followupProviderRequests = report.providerRequests.filter((item) => item.phase === 'followup');
  const revisionProviderRequests = report.providerRequests.filter((item) => item.phase === 'revision');
  const notebookUnchanged =
    report.before.revision === report.after.revision &&
    report.before.revision === report.afterRevision.revision &&
    JSON.stringify(report.before.pageIds) === JSON.stringify(report.after.pageIds) &&
    JSON.stringify(report.before.pageIds) === JSON.stringify(report.afterRevision.pageIds);
  const authoredPageBreaks = initialAuthoredScript.match(/^::page\s*$/gmu)?.length ?? 0;
  const beforePreviewId = report.previewBefore.id ??
    report.beforeFollowupLog.interrupt?.previewId ??
    report.beforeFollowupLog.runtime?.proposalPreviewId;
  const afterPreviewId = report.previewAfter.id ??
    report.afterFollowupLog.interrupt?.previewId ??
    report.afterFollowupLog.runtime?.proposalPreviewId;
  const beforePatchId = report.beforeFollowupLog.runtime?.proposalPatchId;
  const afterPatchId = report.afterFollowupLog.runtime?.proposalPatchId;
  const beforeGenerationId = report.beforeFollowupLog.runtime?.proposalGenerationId;
  const afterGenerationId = report.afterFollowupLog.runtime?.proposalGenerationId;
  const liveAnswer = report.followup.newAgentMessages?.[0] ?? '';
  const liveGroundingSignals = [
    /box packing/iu,
    /kitten/iu,
    /length[\s\S]{0,24}breadth[\s\S]{0,24}height/iu,
    /rotat/iu,
    /W[\s→-]+Z[\s→-]+U[\s→-]+X/iu,
    /longest (?:nesting )?chain/iu,
    /(?:length|chain)[\s\S]{0,20}\b4\b/iu,
  ].filter((pattern) => pattern.test(liveAnswer)).length;
  const followupSourceTools = newTools.filter((item) =>
    SOURCE_WORKFLOW_TOOLS.has(item.name));
  report.assertions = {
    exactSuppliedImageAttached:
      report.attachment.imageLoaded && report.attachment.text.includes(imageName),
    initialPixelsReachedAuthoringProvider:
      initialProviderRequests.some((item) =>
        item.hasSourceImageContext && !item.hasDraftPreviewContext &&
        (item.tools.length === 0 || item.tools.includes('submit_notebook_script'))),
    initialDraftIsImageLedAndRelated:
      live
        ? report.previewBefore.capturedPages >= 1 &&
          report.previewBefore.capturedPages <= 2 &&
          /ChatGPT Image Aug 14, 2026/iu.test(report.previewBefore.text) &&
          !/huffman|previous week|week 5/iu.test(report.previewBefore.text)
        : /asset="ai\/attachments\//u.test(initialAuthoredScript) &&
          /length, breadth and height/iu.test(initialAuthoredScript) &&
          /without rotation/iu.test(initialAuthoredScript) &&
          /with rotation/iu.test(initialAuthoredScript) &&
          /W → Z → U → X/u.test(initialAuthoredScript) &&
          !/huffman|previous week|week 5/iu.test(initialAuthoredScript),
    conciseTwoPageDraft: live
      // “maybe add” makes the brief notes page optional. One faithful image
      // page is preferable to inventing filler; if notes exist, the product
      // compactor and visual gate require one coherent second page at most.
      ? report.previewBefore.capturedPages >= 1 && report.previewBefore.capturedPages <= 2
      : authoredPageBreaks >= 2 && report.previewBefore.capturedPages === 2,
    nativePreviewPixelsLoaded:
      report.previewBefore.fullPreviewImages.count > 0 &&
      report.previewBefore.fullPreviewImages.loaded,
    exactInitialRequestOnceInLog:
      timelineMessages(report.afterFollowupLog, 'reader', initialRequest).length === 1,
    exactFollowUpOnceInUi: report.followup.exactFollowUpCount === 1,
    exactFollowUpOnceInLog:
      timelineMessages(report.afterFollowupLog, 'reader', followUp).length === 1,
    oneGroundedConversationalAnswer:
      live
        ? report.followup.newAgentMessages.length === 1 &&
          liveGroundingSignals >= 3 &&
          !/(?:cannot|can['’]?t|unable to) (?:see|view|access)/iu.test(liveAnswer)
        : report.followup.exactAnswerCount === 1 &&
          /kitten-themed infographic/iu.test(groundedAnswer) &&
          /length, breadth and height/iu.test(groundedAnswer) &&
          /W → Z → U → X/u.test(groundedAnswer),
    followUpQuestionAndAnswerVisible:
      report.followupMessageVisibility.readerVisible &&
      report.followupMessageVisibility.agentVisible,
    pendingPreviewComposerExplainsLanes:
      /ask a question/iu.test(report.followupComposerPlaceholder ?? '') &&
      /ask for changes/iu.test(report.followupComposerPlaceholder ?? ''),
    followUpPixelsReachedProvider:
      followupProviderRequests.length > 0 &&
      followupProviderRequests.some((item) => item.hasSourceImageContext),
    boundedSemanticProviderWork:
      initialProviderRequests.length === 2 &&
      followupProviderRequests.length === 1,
    noFollowUpNotebookWorkflow:
      newTools.every((item) => !NOTEBOOK_WORKFLOW_TOOLS.has(item.name)),
    noFollowUpSourceWorkflow:
      followupSourceTools.length === 1 &&
      followupSourceTools[0]?.name === 'read_full_source' &&
      followupSourceTools[0]?.status === 'done',
    followUpToolsSucceeded: newTools.every((item) => item.status === 'done'),
    originalPreviewStillPresent:
      report.previewAfter.count === 1 && report.previewAfter.insertEnabled &&
      beforePreviewId !== undefined && beforePreviewId === afterPreviewId &&
      beforePatchId !== undefined && beforePatchId === afterPatchId &&
      beforeGenerationId !== undefined && beforeGenerationId === afterGenerationId &&
      report.afterFollowupLog.runtime?.proposalStatus === 'waiting_for_approval',
    originalPreviewUnchanged:
      report.previewBefore.text === report.previewAfter.text &&
      JSON.stringify(report.previewBefore.imageSources) ===
        JSON.stringify(report.previewAfter.imageSources),
    explicitAskForChangesAuthors:
      live || anySabotage || /please change/i.test(report.revisionComposerPrefill) &&
      revisionProviderRequests.some((item) =>
        item.hasSourceImageContext &&
        (item.tools.length === 0 || item.tools.includes('submit_notebook_script'))) &&
      report.revision.tools.some((item) => item.name === 'submit_notebook_script') &&
      report.revision.tools.some((item) => item.name === 'render_draft_preview') &&
      report.revision.tools.some((item) => item.name === 'submit_notebook_patch') &&
      report.revision.tools.every((item) => item.status === 'done'),
    explicitRevisionAppearsOnce:
      live || anySabotage || report.revision.exactFeedbackCountInLog === 1,
    revisedPreviewReplacesOldPreview:
      live || anySabotage || sidePreviewId !== undefined && report.revision.previewId !== sidePreviewId &&
      report.revision.previewCount === 1 && report.revision.insertEnabled,
    noBookMutationBeforeInsert: notebookUnchanged,
    noFailureOrStaleUi:
      report.followup.errorCards === 0 && report.followup.staleProgress === 0,
    recoveredProtocolNoiseBounded:
      report.followup.toolErrors === 0 &&
      (report.afterFollowupLog.runtime?.recentToolFailures?.length ?? 0) === 0 &&
      report.afterFollowupLog.runtime?.lifecycle === 'completed',
    noHorizontalOverflow: !report.followup.horizontalOverflow,
    noRuntimeSurfaceErrors:
      report.consoleErrors.length === 0 && report.pageErrors.length === 0 &&
      report.failedRequests.every((failure) =>
        live && failure.url === 'https://api.cohere.com/v2/chat') &&
      report.httpErrors.length === 0,
    fakeCredentialExcluded:
      live
        ? !JSON.stringify(report.afterRevisionLog).includes(liveKey)
        : !JSON.stringify(report.afterRevisionLog).includes(fakeKey),
  };

  report.failures = Object.entries(report.assertions)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  const expectedSabotageFailure = sabotage
    ? 'exactFollowUpOnceInUi'
    : dropImageSabotage ? 'followUpPixelsReachedProvider' : undefined;
  const sabotageCaught = anySabotage && expectedSabotageFailure !== undefined &&
    report.failures.length === 1 && report.failures[0] === expectedSabotageFailure;
  report.ok = anySabotage ? sabotageCaught : report.failures.length === 0;
  report.status = anySabotage
    ? sabotageCaught ? 'sabotage-caught' : 'sabotage-invalid'
    : report.ok ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.ok = false;
  report.failure = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    report.failureLog = await copiedDiagnostic(page);
  } catch {
    // The lifecycle failure and screenshot remain authoritative.
  }
  await page.screenshot({ path: resolve(out, 'failure.png'), caret: 'hide' }).catch(() => {});
} finally {
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  await browser.close();
}

console.log(JSON.stringify({
  status: report.status,
  failures: report.failures ?? [],
  failure: report.failure,
  report: resolve(out, 'report.json'),
}, null, 2));
if (anySabotage) {
  console.log(report.status === 'sabotage-caught'
    ? dropImageSabotage
      ? 'GATE ALIVE · missing follow-up source pixels were rejected'
      : 'GATE ALIVE · the exact duplicated image question was rejected'
    : 'GATE INERT · the injected follow-up defect escaped the regression gate');
} else if (report.ok) {
  console.log('agent image follow-up: PASS · one grounded answer, original preview intact, book unchanged');
}
process.exitCode = report.ok ? 0 : 1;
