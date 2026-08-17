/**
 * Production-provider browser regression for the exact reader path:
 *   hi -> explain cake -> add to book
 *
 * Unlike the Agent-loop QA bridge, this mounts BookView's real controller,
 * CohereTauriAgentProvider and browser gateway. Playwright intercepts only the
 * external Cohere endpoints, supplies Cohere-shaped SSE, and rejects the exact
 * incompatible field (`tool_choice`) caught by the live provider smoke. It
 * also requires the strict schema flag that the same live trial/production
 * smoke accepted. No credential or book mutation leaves the browser, and the
 * final Insert action is not clicked.
 *
 *   node shots-now/probe-agent-cohere-authoring.mjs
 *   node shots-now/probe-agent-cohere-authoring.mjs --sabotage
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const out = resolve('qa/agent-cohere-authoring', sabotage ? 'sabotage' : 'normal');
const viewports = [
  { width: 1500, height: 940 },
  { width: 1200, height: 800 },
];
const fakeKey = 'qa_trial_key_never_sent_to_cohere';

function sse(frames) {
  return frames.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
  ).join('');
}

function proseResponse(text) {
  return sse([
    ['message-start', { id: 'qa-conversation-message' }],
    ['content-delta', { delta: { message: { content: { text } } } }],
    ['message-end', {
      delta: {
        finish_reason: 'COMPLETE',
        usage: { tokens: { input_tokens: 120, output_tokens: 32 } },
      },
    }],
  ]);
}

function toolResponse(callNumber, name, args) {
  return sse([
    ['message-start', { id: `qa-tool-message-${callNumber}` }],
    ['tool-call-start', {
      delta: {
        message: {
          tool_calls: {
            id: `qa-call-${callNumber}`,
            function: { name, arguments: JSON.stringify(args) },
          },
        },
      },
    }],
    ['tool-call-end', {}],
    ['message-end', {
      delta: {
        finish_reason: 'TOOL_CALL',
        usage: { tokens: { input_tokens: 140, output_tokens: 28 } },
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
        // Ordinary prose is not JSON and is intentionally ignored.
      }
    }
    return found;
  }
  if (value === null || typeof value !== 'object') return found;
  found.push(value);
  for (const child of Object.values(value)) expandedObjects(child, found);
  return found;
}

function previewReceipt(body) {
  const objects = expandedObjects(body.messages);
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const candidate = objects[index];
    if (
      typeof candidate.generationId === 'string' &&
      Array.isArray(candidate.pages) &&
      candidate.pages.length > 0
    ) {
      const pageIds = candidate.pages
        .map((page) => page?.pageId)
        .filter((pageId) => typeof pageId === 'string');
      if (pageIds.length > 0) return { generationId: candidate.generationId, pageIds };
    }
  }
  throw new Error('The production provider request did not retain its preview receipt.');
}

function firstNotebookPageId(body) {
  for (const candidate of expandedObjects(body.messages)) {
    if (!Array.isArray(candidate.pages)) continue;
    const pageId = candidate.pages.find((page) => typeof page?.id === 'string')?.id;
    if (typeof pageId === 'string') return pageId;
  }
  throw new Error('The production provider request did not retain a notebook page id.');
}

function argumentsFor(name, body) {
  switch (name) {
    case 'inspect_notebook':
    case 'validate_notebook_script':
    case 'render_draft_preview':
    case 'propose_notebook_patch':
    case 'submit_notebook_patch':
      return { request: 'current' };
    case 'propose_insertion':
      return { target: { kind: 'after_page', pageId: firstNotebookPageId(body) } };
    case 'submit_notebook_script':
      return {
        reason: 'initial',
        citedUnitIds: [],
        script: [
          '---',
          'title: A Slice of Cake',
          'paper: grid',
          'wash: lemon',
          '---',
          '',
          '# Cake {sticker=star}',
          '',
          'Cake is a baked dessert made from flour, sugar, eggs, fat, and a leavening agent.',
          '',
          '::: callout {variant=info, color=amber}',
          '**Why it rises:** baking powder or baking soda creates tiny gas bubbles that expand in the oven.',
          ':::',
          '',
          '## The basic balance',
          '',
          '| Part | What it does |',
          '| --- | --- |',
          '| Flour and eggs | Build structure |',
          '| Sugar | Sweetens and tenderises |',
          '| Butter or oil | Adds richness and moisture |',
          '| Leavening | Gives the crumb lift |',
          '',
          '> Cake turns a small set of ingredients into something celebratory.',
        ].join('\n'),
      };
    case 'read_draft_preview_pages': {
      const receipt = previewReceipt(body);
      return { generationId: receipt.generationId, pageIds: receipt.pageIds };
    }
    case 'record_visual_review': {
      const receipt = previewReceipt(body);
      return {
        generationId: receipt.generationId,
        reviews: receipt.pageIds.map((pageId) => ({ pageId, findings: [] })),
      };
    }
    default:
      throw new Error(`Unexpected production tool phase: ${name}`);
  }
}

async function openWelcome(page) {
  await page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    const { listBooksByFloorRange } = await import('/src/data/books.ts');
    const books = await listBooksByFloorRange(0, 20);
    const book = books.find((candidate) => /welcome/i.test(candidate.title)) ?? books[0];
    if (book === undefined) throw new Error('No notebook is available.');
    appState.openBook(book.id);
  });
}

async function notebookSnapshot(page) {
  return page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    const { listPages } = await import('/src/data/pages.ts');
    const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
    const bookId = appState.openBookId();
    if (bookId === null) throw new Error('No open notebook.');
    const pages = await listPages(bookId);
    return { revision: await computeNotebookRevision(pages), pageIds: pages.map((page) => page.id) };
  });
}

async function stableNotebookSnapshot(page) {
  let previous = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await notebookSnapshot(page);
    if (
      previous !== null &&
      current.revision === previous.revision &&
      JSON.stringify(current.pageIds) === JSON.stringify(previous.pageIds)
    ) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error('Notebook did not stabilize before the production-gateway assertion.');
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const report = { generatedAt: new Date().toISOString(), sabotage, runs: [] };

try {
  for (const viewport of viewports) {
    const size = `${viewport.width}x${viewport.height}`;
    const runOut = resolve(out, size);
    await mkdir(runOut, { recursive: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    const run = {
      viewport,
      chatBodies: [],
      selectedTools: [],
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      status: 'running',
    };
    report.runs.push(run);
    page.on('console', (message) => {
      if (message.type() === 'error') run.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => run.pageErrors.push(error.message));
    page.on('requestfailed', (request) => run.failedRequests.push(request.url()));

    await page.route('https://api.cohere.com/v1/check-api-key', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"valid":true}' }));
    await page.route('https://api.cohere.com/v2/chat', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const sanitized = {
        toolChoice: body.tool_choice ?? null,
        strictTools: body.strict_tools ?? null,
        tools: (body.tools ?? []).map((tool) => tool.function?.name),
      };
      run.chatBodies.push(sanitized);
      if (body.tool_choice !== undefined || body.strict_tools !== true) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"message":"tool_choice is not accepted for this Command A+ request"}',
        });
        return;
      }
      const offered = sanitized.tools;
      const conversationOnly = offered.includes('finish_conversation') &&
        offered.includes('ask_user') && !offered.includes('inspect_notebook');
      if (conversationOnly) {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: proseResponse('Cake is a baked dessert made from flour, sugar, eggs, fat, and a leavening agent. It can be simple or elaborately decorated.'),
        });
        return;
      }
      if (sabotage && run.selectedTools.length === 0) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: '{"message":"deliberate provider rejection"}',
        });
        return;
      }
      const priority = [
        'inspect_notebook',
        'propose_insertion',
        'submit_notebook_script',
        'validate_notebook_script',
        'render_draft_preview',
        'read_draft_preview_pages',
        'record_visual_review',
        'propose_notebook_patch',
        'submit_notebook_patch',
      ];
      const name = priority.find((candidate) => offered.includes(candidate));
      if (name === undefined) throw new Error(`No expected tool was offered: ${offered.join(', ')}`);
      run.selectedTools.push(name);
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: toolResponse(run.selectedTools.length, name, argumentsFor(name, body)),
      });
    });

    try {
      await page.goto(`${base.replace(/\/$/, '')}/?dev=0`, { waitUntil: 'domcontentloaded' });
      const skipTour = page.getByText('skip the tour', { exact: false }).first();
      await skipTour.waitFor({ state: 'visible' });
      await skipTour.click({ force: true });
      await page.keyboard.press('Escape').catch(() => {});
      await openWelcome(page);
      await page.waitForSelector('.nb-prose');
      await page.evaluate(async (key) => {
        const credentials = await import('/src/data/aiCredentials.ts');
        const settings = await import('/src/data/settings.ts');
        await credentials.saveAiCredential(key, 'session');
        await settings.save({
          aiAgentSetupSeen: true,
          aiAgentKeyKind: 'trial',
          aiAgentTrialPrivacyAcknowledged: true,
        });
        const { OPEN_AI_AGENT_PANEL_EVENT } = await import('/src/editor/toolbar/aiRewrite.ts');
        window.dispatchEvent(new Event(OPEN_AI_AGENT_PANEL_EVENT));
      }, fakeKey);
      await page.waitForSelector('.nb-rail-panel.is-ai-agent[aria-hidden="false"]');
      const composer = page.locator('textarea[aria-label="What should the agent do?"]');
      const send = page.locator('button[aria-label="Send to AI agent"]');

      await composer.fill('hi');
      await send.click();
      await page.getByText('Hi! What would you like to explore, explain, or add to this notebook?', { exact: true }).waitFor();
      await composer.fill('explain cake');
      await send.click();
      await page.getByText(/Cake is a baked dessert made from flour/u, { exact: false }).waitFor();
      // Initial PageEditor mounts may canonicalize old stored JSON. Take the
      // mutation baseline only after the two conversation turns settle so the
      // assertion measures add-to-book, not unrelated editor hydration.
      run.before = await stableNotebookSnapshot(page);
      await composer.fill('add to book');
      await send.click();
      if (sabotage) {
        await page.locator('.nb-ai-error-card').waitFor({ state: 'visible' });
      } else {
        await page.locator('.nb-ai-final-preview').waitFor({ state: 'visible' });
        await page.locator('.nb-ai-final-preview .nb-ai-approve-action').waitFor({ state: 'visible' });
      }
      await page.evaluate(async () => {
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
        }
      });

      run.after = await stableNotebookSnapshot(page);
      run.ui = await page.evaluate(() => {
        const panel = document.querySelector('.nb-ai-agent');
        const rect = panel?.getBoundingClientRect();
        return {
          text: panel?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          errorCards: document.querySelectorAll('.nb-ai-error-card').length,
          previewCards: document.querySelectorAll('.nb-ai-final-preview').length,
          insertEnabled: !document.querySelector('.nb-ai-final-preview .nb-ai-approve-action')?.hasAttribute('disabled'),
          staleBars: document.querySelectorAll('.nb-ai-mini-progress').length,
          insideViewport: rect !== undefined && rect.left >= -1 && rect.top >= -1 &&
            rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const mutationBodies = run.chatBodies.slice(1);
      const expectedOrder = [
        'inspect_notebook',
        'submit_notebook_script',
        'validate_notebook_script',
        'render_draft_preview',
        'read_draft_preview_pages',
        'record_visual_review',
        'propose_notebook_patch',
        'submit_notebook_patch',
      ];
      const commonAssertions = {
        noRejectedToolChoiceField: run.chatBodies.every((body) => body.toolChoice === null),
        strictSchemaOnEveryToolEnvelope: run.chatBodies.every((body) => body.strictTools === true),
        noStaleBars: run.ui.staleBars === 0,
        panelContained: run.ui.insideViewport && !run.ui.horizontalOverflow,
        notebookUnchangedBeforeApproval:
          run.before.revision === run.after.revision &&
          JSON.stringify(run.before.pageIds) === JSON.stringify(run.after.pageIds),
        noPageOrRequestFailures: run.pageErrors.length === 0 && run.failedRequests.length === 0,
      };
      run.assertions = sabotage
        ? {
            ...commonAssertions,
            rejectedFirstMutationRequest: mutationBodies.length === 1 && run.selectedTools.length === 0,
            expectedHttp400ConsoleWitness:
              run.consoleErrors.length === 1 && /status of 400/u.test(run.consoleErrors[0]),
            oneVisibleProviderFailure:
              run.ui.errorCards === 1 && run.ui.previewCards === 0 &&
              /AI reply could not be used|provider returned an unusable response/i.test(run.ui.text),
          }
        : {
            ...commonAssertions,
            exactMutationRequestCount: mutationBodies.length === expectedOrder.length,
            exactProductionToolOrder: JSON.stringify(run.selectedTools) === JSON.stringify(expectedOrder),
            previewReadyToInsert: run.ui.previewCards === 1 && run.ui.insertEnabled,
            noFailureUi: run.ui.errorCards === 0 && !/provider returned an unusable response/i.test(run.ui.text),
            noConsoleErrors: run.consoleErrors.length === 0,
          };
      run.failures = Object.entries(run.assertions)
        .filter(([, passed]) => passed !== true)
        .map(([name]) => name);
      run.status = run.failures.length === 0 ? 'passed' : 'failed';
      await page.locator('.nb-ai-agent').screenshot({ path: resolve(runOut, 'panel.png'), animations: 'disabled', caret: 'hide' });
      await page.screenshot({ path: resolve(runOut, 'viewport.png'), animations: 'disabled', caret: 'hide' });
    } catch (error) {
      run.status = 'failed';
      run.failure = error instanceof Error ? error.stack ?? error.message : String(error);
      await page.screenshot({ path: resolve(runOut, 'failure.png'), caret: 'hide' }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(`agent Cohere authoring: ${run.status.toUpperCase()} · ${size}` +
      (run.failures?.length ? ` · ${run.failures.join(', ')}` : ''));
  }
} finally {
  await browser.close();
}

report.ok = report.runs.every((run) => run.status === 'passed');
await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
else if (sabotage) console.log('GATE ALIVE · rejected first mutation request produced one visible provider failure');
else console.log('agent Cohere authoring: PASS · production provider/gateway reached reviewed preview at both sizes');
