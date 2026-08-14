/**
 * Provider-free browser regression for Alcove's REAL AgentRuntime, graph and
 * panel orchestration.
 *
 * The exact `?fx=force&qa=agent-loop` bridge uses the production notebook
 * reader and native draft renderer with a deterministic local provider. It
 * never calls Cohere and its approval callback cannot apply pages.
 *
 *   node shots-now/probe-agent-runtime.mjs
 *   node shots-now/probe-agent-runtime.mjs --scenario=preserve-all
 *   node shots-now/probe-agent-runtime.mjs --sabotage
 *
 * Sabotage asks the bridge to issue one forbidden early Script submission in
 * preserve-all mode. The phase gate must reject that call, recover through the
 * complete source read, and still reach the exact native final preview. A
 * valid witness prints GATE ALIVE; accepting the early draft prints GATE INERT.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const scenarioArg = process.argv.find((value) => value.startsWith('--scenario='))
  ?.slice('--scenario='.length);
const viewportArg = process.argv.find((value) => value.startsWith('--viewport='))
  ?.slice('--viewport='.length);
const out = resolve('qa/agent-runtime');

const VIEWPORTS = [
  { width: 1500, height: 940 },
  { width: 1360, height: 850 },
  { width: 1200, height: 800 },
];
const selectedViewports = viewportArg === undefined
  ? VIEWPORTS
  : VIEWPORTS.filter(({ width, height }) => `${width}x${height}` === viewportArg);
if (selectedViewports.length === 0) {
  throw new Error(`Unknown viewport ${viewportArg}. Expected ${VIEWPORTS.map(
    ({ width, height }) => `${width}x${height}`,
  ).join(', ')}.`);
}

const SCENARIOS = {
  'healthy-targetless': {
    goal: 'Create clear notebook pages explaining the water cycle.',
    providerCalls: 9,
    toolCalls: 9,
    repairPasses: 0,
    order: [
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ],
    kind: 'preview',
    sourceReadUnitIds: [],
  },
  'healthy-production-default': {
    goal: 'Create clear notebook pages explaining the water cycle.',
    providerCalls: 8,
    toolCalls: 8,
    repairPasses: 0,
    order: [
      'inspect_notebook',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ],
    kind: 'preview',
    sourceReadUnitIds: [],
  },
  'invalid-repeat': {
    goal: 'Create a short notebook explanation about how cats use their whiskers.',
    providerCalls: 7,
    toolCalls: 5,
    repairPasses: 0,
    order: [
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'submit_notebook_script',
      'submit_notebook_script',
      'submit_notebook_script',
    ],
    errors: [false, false, false, false, true, true, true],
    kind: 'error',
    sourceReadUnitIds: [],
  },
  'preserve-all': {
    goal: 'Use every fact from the attached rainfall text to create clear notebook pages.',
    providerCalls: 10,
    toolCalls: 10,
    repairPasses: 0,
    order: [
      'read_full_source',
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ],
    kind: 'preview',
    sourceReadUnitIds: ['qa-source-u1', 'qa-source-u2'],
  },
};

if (scenarioArg !== undefined && !(scenarioArg in SCENARIOS)) {
  throw new Error(`Unknown scenario ${scenarioArg}. Expected one of ${Object.keys(SCENARIOS).join(', ')}.`);
}
if (sabotage && scenarioArg !== undefined && scenarioArg !== 'preserve-all') {
  throw new Error('--sabotage is the preserve-all early-draft witness; do not combine it with another scenario.');
}

const selectedScenarioNames = sabotage
  ? ['preserve-all']
  : scenarioArg === undefined
    ? Object.keys(SCENARIOS)
    : [scenarioArg];

const clean = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
const sameArray = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);
const sorted = (values) => [...values].sort();
const isCohereRequest = (url) =>
  /(?:^|\.)cohere\.(?:ai|com)(?:[:/]|$)|\/cohere(?:\/|\?|$)/i.test(url);

function targetFor(scenario) {
  const query = new URLSearchParams({
    fx: 'force',
    qa: 'agent-loop',
    dev: '0',
    scenario,
  });
  if (sabotage) query.set('sabotage', 'early-draft');
  return `${base.replace(/\/$/, '')}/?${query}`;
}

async function notebookSnapshot(page) {
  return page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    const { listPages } = await import('/src/data/pages.ts');
    const { computeNotebookRevision } = await import('/src/features/aiAgent/productionNotebook.ts');
    const bookId = appState.openBookId();
    if (bookId === null) throw new Error('The Agent runtime probe has no open notebook.');
    const pages = await listPages(bookId);
    return {
      bookId,
      revision: await computeNotebookRevision(pages),
      pageIds: pages.map((page) => page.id),
    };
  });
}

async function stableNotebookSnapshot(page, timeoutMs = 8_000) {
  const startedAt = Date.now();
  let previous = null;
  let matchingSamples = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const current = await notebookSnapshot(page);
    const matchesPrevious = previous !== null &&
      current.revision === previous.revision &&
      sameArray(current.pageIds, previous.pageIds);
    matchingSamples = matchesPrevious ? matchingSamples + 1 : 0;
    if (matchingSamples >= 2) {
      return { ...current, stableAfterMs: Date.now() - startedAt };
    }
    previous = current;
    await page.waitForTimeout(120);
  }
  throw new Error('Notebook revision did not stabilize before the read-only Agent probe.');
}

async function openWelcome(page) {
  return page.evaluate(async () => {
    const { appState } = await import('/src/state/app.ts');
    const { listBooksByFloorRange } = await import('/src/data/books.ts');
    const books = await listBooksByFloorRange(0, 20);
    const book = books.find((candidate) => /welcome/i.test(candidate.title)) ?? books[0];
    if (book === undefined) throw new Error('No notebook is available for the Agent runtime probe.');
    appState.openBook(book.id);
    return { id: book.id, title: book.title };
  });
}

async function settleAnimations(page) {
  // Sample multiple frames after the durable state settles. This is not a
  // fixed readiness sleep: it proves the current-progress UI stays absent.
  return page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 10; index += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      samples.push({
        headerProgress: document.querySelectorAll('.nb-ai-agent-progress').length,
        workingWhispers: document.querySelectorAll('.nb-ai-working-whisper').length,
        miniProgress: document.querySelectorAll('.nb-ai-mini-progress').length,
      });
    }
    return samples;
  });
}

async function uiEvidence(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const tidy = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const panel = document.querySelector('.nb-ai-agent');
    const panelScroll = document.querySelector('.nb-ai-agent-scroll');
    const panelBox = panel?.getBoundingClientRect() ?? null;
    const images = [...document.querySelectorAll('.nb-ai-final-preview img')]
      .filter((image) => image instanceof HTMLImageElement)
      .map((image) => ({
        src: image.currentSrc || image.src,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        box: (() => {
          const rect = image.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        })(),
      }));
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth > width || document.body.scrollWidth > width,
      panelBox: panelBox === null ? null : {
        left: panelBox.left,
        top: panelBox.top,
        right: panelBox.right,
        bottom: panelBox.bottom,
        width: panelBox.width,
        height: panelBox.height,
      },
      panelFullyInsideViewport: panelBox !== null &&
        panelBox.left >= -1 && panelBox.top >= -1 &&
        panelBox.right <= width + 1 && panelBox.bottom <= height + 1,
      panelHorizontalOverflow: panelScroll instanceof HTMLElement
        ? panelScroll.scrollWidth > panelScroll.clientWidth + 1
        : null,
      finalPreviewCards: document.querySelectorAll('.nb-ai-final-preview').length,
      finalPreviewImages: images,
      distinctPreviewImageSources: [...new Set(images.map((image) => image.src).filter(Boolean))].length,
      headerProgress: document.querySelectorAll('.nb-ai-agent-progress').length,
      workingWhispers: document.querySelectorAll('.nb-ai-working-whisper').length,
      miniProgress: document.querySelectorAll('.nb-ai-mini-progress').length,
      legacyQuestionCards: document.querySelectorAll('.nb-ai-question-card').length,
      legacyQuestionOptions: document.querySelectorAll('.nb-ai-question-options').length,
      conflictCards: document.querySelectorAll('.nb-ai-conflict-card').length,
      refreshPreviewButtons: [...document.querySelectorAll('button')].filter((button) =>
        /refresh the preview safely/i.test(button.textContent ?? '')).length,
      selectedPlacementLabel: tidy(
        document.querySelector('.nb-ai-placement-button strong')?.textContent,
      ),
      insertButtonDisabled: (() => {
        const button = document.querySelector('.nb-ai-approve-action');
        return button instanceof HTMLButtonElement ? button.disabled : null;
      })(),
      placementConflictText: /this placement is no longer available|refresh the preview safely/i
        .test(tidy(panel?.textContent)),
      statusText: tidy(document.querySelector('.nb-ai-agent-status')?.textContent),
      panelTail: tidy(panel?.textContent).slice(-700),
    };
  }, viewport);
}

async function fullPreviewEvidence(page, viewport) {
  return page.evaluate(({ width, height }) => {
    const tidy = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const dialog = document.querySelector('.nb-ai-full-preview');
    const image = document.querySelector('.nb-ai-full-preview-canvas > img');
    const dialogBox = dialog?.getBoundingClientRect() ?? null;
    return {
      dialogCount: document.querySelectorAll('.nb-ai-full-preview').length,
      dialogBox: dialogBox === null ? null : {
        left: dialogBox.left,
        top: dialogBox.top,
        right: dialogBox.right,
        bottom: dialogBox.bottom,
        width: dialogBox.width,
        height: dialogBox.height,
      },
      dialogFullyInsideViewport: dialogBox !== null &&
        dialogBox.left >= -1 && dialogBox.top >= -1 &&
        dialogBox.right <= width + 1 && dialogBox.bottom <= height + 1,
      imageLoaded: image instanceof HTMLImageElement &&
        image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      imageNaturalSize: image instanceof HTMLImageElement
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null,
      pageCounter: tidy(document.querySelector('.nb-ai-full-preview-nav > span')?.textContent),
    };
  }, viewport);
}

function scenarioAssertions(run, config) {
  const state = run.state;
  const selected = state?.selectedTools ?? [];
  const advertised = state?.advertisedTools ?? [];
  const executed = state?.executedTools ?? [];
  const executedNames = executed.map((tool) => tool.name);
  const executedErrors = executed.map((tool) => tool.isError === true);
  const chosenToolsAdvertised = selected.every((tool, index) =>
    advertised[index]?.includes(tool) === true);
  const noStaleBars = run.animationSamples.every((sample) =>
    sample.headerProgress === 0 && sample.workingWhispers === 0 && sample.miniProgress === 0);
  const notebookUnchanged = run.before?.revision === run.after?.revision &&
    sameArray(run.before?.pageIds ?? [], run.after?.pageIds ?? []);
  const expectedSourceReads = sameArray(
    sorted(state?.draftSourceReadUnitIds ?? []),
    sorted(config.sourceReadUnitIds),
  );
  const common = {
    bridgeAvailable: state !== null && state !== undefined,
    expectedProvider: state?.providerId === 'alcove-agent-loop-qa',
    exactProviderCallCount: state?.providerCalls === config.providerCalls,
    exactToolCallCount: state?.toolCalls === config.toolCalls,
    exactRepairPasses: state?.repairPasses === config.repairPasses,
    exactSelectedToolOrder: sameArray(selected, config.order),
    exactExecutedToolOrder: sameArray(executedNames, config.order),
    advertisedTurnCountMatches: advertised.length === selected.length,
    everyChosenToolAdvertised: chosenToolsAdvertised,
    noRetrieval: state?.retrievalCalls === 0,
    noBridgeError: state?.bridgeError === null,
    noCohereRequests: run.cohereRequests.length === 0,
    noConsoleErrors: run.consoleErrors.length === 0,
    noPageErrors: run.pageErrors.length === 0,
    noFailedRequests: run.failedRequests.length === 0,
    noHttpErrors: run.httpErrors.length === 0,
    noHorizontalOverflow:
      run.ui.horizontalOverflow === false && run.ui.panelHorizontalOverflow === false,
    panelInsideViewport: run.ui.panelFullyInsideViewport === true,
    noStaleProgressBars: noStaleBars,
    noLegacyQuestionForms:
      run.ui.legacyQuestionCards === 0 && run.ui.legacyQuestionOptions === 0,
    notebookRevisionAndPageIdsUnchanged: notebookUnchanged,
    exactDraftSourceReadReceipt: expectedSourceReads,
    normalRunHasNoSabotageReceipt: state?.sabotageEarlyDraft !== true,
  };

  if (config.kind === 'error') {
    return {
      ...common,
      exactExecutedErrorPattern: sameArray(executedErrors, config.errors),
      watchdogFailedSafely:
        state?.lifecycle === 'failed' &&
        state?.interruptKind === null &&
        state?.errorCode === 'agent_stalled',
      noPreviewForInvalidDraft:
        state?.previewPageCount === 0 && run.ui.finalPreviewCards === 0,
    };
  }

  const allNativeImagesLoaded = run.ui.finalPreviewImages.length > 0 &&
    run.ui.finalPreviewImages.every((image) =>
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && image.src !== '');
  return {
    ...common,
    allExecutedToolsSucceeded: executedErrors.every((isError) => !isError),
    settledAtImmutablePreview:
      state?.lifecycle === 'waiting_for_preview_decision' &&
      state?.phase === 'waiting_for_preview_decision' &&
      state?.interruptKind === 'final_preview' &&
      state?.errorCode === null,
    previewPageCountPositive: (state?.previewPageCount ?? 0) > 0,
    nativePanelPreviewPopulated:
      allNativeImagesLoaded &&
      run.ui.distinctPreviewImageSources >= (state?.previewPageCount ?? Number.POSITIVE_INFINITY),
    fullPreviewOpened:
      run.fullPreview?.dialogCount === 1 &&
      run.fullPreview?.dialogFullyInsideViewport === true &&
      run.fullPreview?.imageLoaded === true,
    fullPreviewRemainedOpenThroughCapture:
      run.fullPreviewAfterCapture?.dialogCount === 1 &&
      run.fullPreviewAfterCapture?.dialogFullyInsideViewport === true &&
      run.fullPreviewAfterCapture?.imageLoaded === true,
    noPlacementConflict:
      run.ui.conflictCards === 0 &&
      run.ui.refreshPreviewButtons === 0 &&
      run.ui.placementConflictText === false,
    selectedPlacementIsConcrete:
      run.ui.selectedPlacementLabel !== '' &&
      !/^choose a location$/i.test(run.ui.selectedPlacementLabel),
    insertActionEnabled: run.ui.insertButtonDisabled === false,
    preserveAllCoverageComplete:
      run.scenario !== 'preserve-all' || state?.sourceCoverageComplete === true,
  };
}

function sabotageAssertions(run, config) {
  const state = run.state;
  const selected = state?.selectedTools ?? [];
  const advertised = state?.advertisedTools ?? [];
  const executed = state?.executedTools ?? [];
  const expectedSelected = ['submit_notebook_script', ...config.order];
  const advertisedWitnesses = selected.map((tool, index) => advertised[index]?.includes(tool) === true);
  const unadvertisedIndices = advertisedWitnesses
    .map((wasAdvertised, index) => wasAdvertised ? -1 : index)
    .filter((index) => index >= 0);
  const after = { ...run, state: {
    ...state,
    selectedTools: selected.slice(1),
    advertisedTools: advertised.slice(1),
    executedTools: executed.slice(1),
    providerCalls: (state?.providerCalls ?? 0) - 1,
    toolCalls: (state?.toolCalls ?? 0) - 1,
    sabotageEarlyDraft: false,
  } };
  const recovered = scenarioAssertions(after, config);
  return {
    ...Object.fromEntries(
      Object.entries(recovered).map(([name, passed]) => [`recovered_${name}`, passed]),
    ),
    exactSabotageSelectedOrder: sameArray(selected, expectedSelected),
    exactOneUnadvertisedWitness:
      sameArray(unadvertisedIndices, [0]) && selected[0] === 'submit_notebook_script',
    earlyDraftExecutionRejected:
      executed[0]?.name === 'submit_notebook_script' && executed[0]?.isError === true,
    sabotageReceiptRecorded: state?.sabotageEarlyDraft === true,
    exactSabotageProviderCalls: state?.providerCalls === config.providerCalls + 1,
    exactSabotageToolCalls: state?.toolCalls === config.toolCalls + 1,
  };
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});

const report = {
  probeVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: sabotage ? 'preserve-all-early-draft-sabotage' : 'runtime-matrix',
  base,
  runs: [],
};
const reportStartedAt = Date.now();

try {
  for (const scenario of selectedScenarioNames) {
    const config = SCENARIOS[scenario];
    for (const viewport of selectedViewports) {
      const size = `${viewport.width}x${viewport.height}`;
      const runName = `${scenario}${sabotage ? '-sabotage' : ''}-${size}`;
      const runOut = resolve(out, runName);
      await rm(runOut, { recursive: true, force: true });
      await mkdir(runOut, { recursive: true });
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const runStartedAt = Date.now();
      page.setDefaultTimeout(120_000);
      const run = {
        scenario,
        viewport,
        target: targetFor(scenario),
        output: runOut,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        httpErrors: [],
        cohereRequests: [],
        state: null,
        before: null,
        after: null,
        ui: null,
        animationSamples: [],
        fullPreview: null,
        fullPreviewAfterCapture: null,
        screenshots: {},
        assertions: {},
        status: 'running',
        startedAt: new Date(runStartedAt).toISOString(),
        finishedAt: null,
        durationMs: null,
      };
      report.runs.push(run);

      page.on('console', (message) => {
        if (message.type() === 'error') run.consoleErrors.push(message.text());
      });
      page.on('pageerror', (error) => run.pageErrors.push(error.message));
      page.on('request', (request) => {
        if (isCohereRequest(request.url())) run.cohereRequests.push(request.url());
      });
      page.on('requestfailed', (request) => run.failedRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
      }));
      page.on('response', (response) => {
        if (response.status() >= 400) run.httpErrors.push({
          url: response.url(),
          status: response.status(),
        });
      });

      try {
        await page.goto(run.target, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
        const skipTour = page.getByText('skip the tour', { exact: false }).first();
        if (await skipTour.count()) await skipTour.click({ force: true }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});

        run.book = await openWelcome(page);
        await page.waitForSelector('.nb-prose');
        await page.waitForFunction(() => globalThis.__aiAgentLoopQa !== undefined, null, {
          timeout: 60_000,
        });
        await page.evaluate(() => document.fonts.ready);
        // Let editor hydration/blank-stock normalization settle before the
        // read-only witness. Open the panel only after this poll so a long
        // stabilization pass cannot be mistaken for a disappearing sheet.
        run.before = await stableNotebookSnapshot(page);
        await page.evaluate(() => globalThis.__aiAgentLoopQa.open());
        await page.waitForFunction(() =>
          document.querySelector('.nb-rail-panel.is-ai-agent')?.getAttribute('aria-hidden') === 'false');

        const panel = page.locator('.nb-ai-agent');
        const composer = page.locator('textarea[aria-label="What should the agent do?"]');
        const send = page.locator('button[aria-label="Send to AI agent"]');
        await panel.waitFor({ state: 'visible' });
        await composer.waitFor({ state: 'visible', timeout: 20_000 });
        await send.waitFor({ state: 'visible', timeout: 20_000 });
        const afterOpen = await notebookSnapshot(page);
        if (
          afterOpen.revision !== run.before.revision ||
          !sameArray(afterOpen.pageIds, run.before.pageIds)
        ) {
          run.before = await stableNotebookSnapshot(page);
        }

        await composer.fill(config.goal);
        await send.click();
        await page.waitForFunction(({ expectedScenario, expectedKind }) => {
          const state = globalThis.__aiAgentLoopQa?.state();
          if (state === undefined || state.scenario !== expectedScenario) return false;
          if (state.bridgeError !== null) return true;
          if (state.lifecycle === 'failed') return true;
          return expectedKind === 'error'
            ? state.lifecycle === 'failed' && state.errorCode !== null
            : state.lifecycle === 'waiting_for_preview_decision' &&
              state.interruptKind === 'final_preview';
        }, { expectedScenario: scenario, expectedKind: config.kind }, { timeout: 120_000 });

        run.state = await page.evaluate(() => globalThis.__aiAgentLoopQa.state());
        const unexpectedlyFailed = config.kind === 'preview' && run.state.lifecycle === 'failed';
        if (!unexpectedlyFailed) {
          await page.waitForFunction((expectedKind) => {
            if (expectedKind === 'error') return document.querySelector('.nb-ai-error-card') !== null;
            const state = globalThis.__aiAgentLoopQa?.state();
            const images = [...document.querySelectorAll('.nb-ai-final-preview img')]
              .filter((image) => image instanceof HTMLImageElement);
            return document.querySelector('.nb-ai-final-preview') !== null &&
              (state?.previewPageCount ?? 0) > 0 &&
              images.length > 0 && images.every((image) =>
                image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
          }, config.kind, { timeout: 120_000 });
        }

        run.animationSamples = await settleAnimations(page);
        run.ui = await uiEvidence(page, viewport);
        run.screenshots.panel = resolve(runOut, 'final-panel.png');
        run.screenshots.viewport = resolve(runOut, 'final-viewport.png');
        await panel.screenshot({
          path: run.screenshots.panel,
          animations: 'disabled',
          caret: 'hide',
        });
        await page.screenshot({
          path: run.screenshots.viewport,
          animations: 'disabled',
          caret: 'hide',
        });

        if (config.kind === 'preview' && !unexpectedlyFailed) {
          await page.locator('button[aria-label="Open the full page preview"]').click();
          const dialog = page.locator('.nb-ai-full-preview');
          await dialog.waitFor({ state: 'visible' });
          await page.waitForFunction(() => {
            const image = document.querySelector('.nb-ai-full-preview-canvas > img');
            return image instanceof HTMLImageElement &&
              image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
          });
          run.fullPreview = await fullPreviewEvidence(page, viewport);
          run.screenshots.fullPreview = resolve(runOut, 'full-preview.png');
          run.screenshots.fullPreviewViewport = resolve(runOut, 'full-preview-viewport.png');
          await dialog.screenshot({
            path: run.screenshots.fullPreview,
            animations: 'disabled',
            caret: 'hide',
          });
          await page.screenshot({
            path: run.screenshots.fullPreviewViewport,
            animations: 'disabled',
            caret: 'hide',
          });
          // The dialog must survive the complete capture sequence. A Vite HMR
          // remount once landed between the element crop and viewport image,
          // leaving a visually wrong PNG while the earlier readiness check
          // still made the run look green.
          run.fullPreviewAfterCapture = await fullPreviewEvidence(page, viewport);
        }

        run.after = await stableNotebookSnapshot(page);
        run.assertions = sabotage
          ? sabotageAssertions(run, config)
          : scenarioAssertions(run, config);
        const failures = Object.entries(run.assertions)
          .filter(([, passed]) => passed !== true)
          .map(([name]) => name);
        run.status = failures.length === 0 ? 'passed' : 'failed';
        run.failures = failures;
      } catch (error) {
        run.status = 'failed';
        run.failure = error instanceof Error ? error.stack ?? error.message : String(error);
        run.state = await page.evaluate(() => globalThis.__aiAgentLoopQa?.state() ?? null)
          .catch(() => null);
        run.after = await stableNotebookSnapshot(page).catch(() => null);
        run.screenshots.failure = resolve(runOut, 'failure.png');
        await page.screenshot({ path: run.screenshots.failure, caret: 'hide' }).catch(() => undefined);
      } finally {
        await context.close();
        run.finishedAt = new Date().toISOString();
        run.durationMs = Date.now() - runStartedAt;
      }
      console.log(
        `agent runtime probe: ${run.status.toUpperCase()} · ${scenario}@${size}` +
        (run.failures?.length ? ` · ${run.failures.join(', ')}` : ''),
      );
    }
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.durationMs = Date.now() - reportStartedAt;
report.ok = report.runs.every((run) => run.status === 'passed');
const reportPath = resolve(out, sabotage ? 'report-sabotage.json' : 'report.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (sabotage) {
  console.log(report.ok
    ? 'GATE ALIVE · forbidden early preserve-all draft rejected; complete source path recovered'
    : 'GATE INERT · forbidden early preserve-all draft escaped or recovery failed');
} else if (report.ok) {
  const summary = report.runs.map((run) =>
    `${run.scenario}@${run.viewport.width}x${run.viewport.height} ` +
    `${run.state.providerCalls}/${run.state.toolCalls}`).join(' · ');
  console.log(`agent runtime: PASS · ${summary}`);
} else {
  for (const run of report.runs.filter((candidate) => candidate.status !== 'passed')) {
    console.error(`${run.scenario}@${run.viewport.width}x${run.viewport.height}: ` +
      `${run.failures?.join(', ') || run.failure || 'unknown failure'}`);
  }
}

process.exitCode = report.ok ? 0 : 1;
