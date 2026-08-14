/**
 * Real-panel regression for a source-free conversation whose optional Cohere
 * tool envelope is rejected once. The production graph must make one bounded
 * plain-prose recovery request and publish the answer exactly once.
 *
 *   node shots-now/probe-agent-conversation.mjs
 *   node shots-now/probe-agent-conversation.mjs --sabotage
 *
 * Sabotage rejects the recovery request too. The task must pause once with one
 * recovery card and no duplicate failure activity in the transcript.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv.find((value) => value.startsWith('--url='))?.slice(6)
  ?? 'http://127.0.0.1:1420';
const sabotage = process.argv.includes('--sabotage');
const out = resolve('qa/agent-conversation', sabotage ? 'sabotage' : 'normal');
const viewports = [
  { width: 1500, height: 940 },
  { width: 1360, height: 850 },
  { width: 1200, height: 800 },
];

const tidy = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
const occurrences = (text, needle) =>
  text.toLocaleLowerCase('en-US').split(needle.toLocaleLowerCase('en-US')).length - 1;

function target() {
  const query = new URLSearchParams({
    fx: 'force',
    qa: 'agent-loop',
    dev: '0',
    scenario: 'conversation-envelope-recovery',
  });
  if (sabotage) query.set('sabotage', 'double-invalid');
  return `${base.replace(/\/$/, '')}/?${query}`;
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
    return {
      revision: await computeNotebookRevision(pages),
      pageIds: pages.map((page) => page.id),
    };
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
  mode: sabotage ? 'double-invalid-sabotage' : 'single-invalid-recovery',
  runs: [],
};

try {
  for (const viewport of viewports) {
    const size = `${viewport.width}x${viewport.height}`;
    const runOut = resolve(out, `${sabotage ? 'sabotage-' : ''}${size}`);
    await mkdir(runOut, { recursive: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const run = {
      viewport,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      httpErrors: [],
      assertions: {},
      status: 'running',
    };
    report.runs.push(run);
    page.on('console', (message) => {
      if (message.type() === 'error') run.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => run.pageErrors.push(error.message));
    page.on('requestfailed', (request) => run.failedRequests.push(request.url()));
    page.on('response', (response) => {
      if (response.status() >= 400) run.httpErrors.push({ url: response.url(), status: response.status() });
    });

    try {
      await page.goto(target(), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);
      const skipTour = page.getByText('skip the tour', { exact: false }).first();
      if (await skipTour.count()) await skipTour.click({ force: true }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await openWelcome(page);
      await page.waitForSelector('.nb-prose');
      await page.waitForFunction(() => globalThis.__aiAgentLoopQa !== undefined);
      await page.evaluate(() => document.fonts.ready);
      run.before = await stableNotebookSnapshot(page);
      await page.evaluate(() => globalThis.__aiAgentLoopQa.open());
      await page.waitForFunction(() =>
        document.querySelector('.nb-rail-panel.is-ai-agent')?.getAttribute('aria-hidden') === 'false');

      const panel = page.locator('.nb-ai-agent');
      const composer = page.locator('textarea[aria-label="What should the agent do?"]');
      const send = page.locator('button[aria-label="Send to AI agent"]');
      await composer.fill('hi');
      await send.click();
      await page.waitForFunction(() => {
        const state = globalThis.__aiAgentLoopQa?.state();
        return state?.lifecycle === 'completed' &&
          state.providerRequestCount === 0 &&
          state.conversation.some((message) =>
            message.role === 'assistant' && message.text.startsWith('Hi!'));
      });

      await composer.fill('explain cookies');
      await send.click();
      await page.waitForFunction((expectFailure) => {
        const state = globalThis.__aiAgentLoopQa?.state();
        if (state?.providerRequestCount !== 2) return false;
        return expectFailure
          ? state.lifecycle === 'failed'
          : state.lifecycle === 'completed' && state.errorCode === null;
      }, sabotage);
      await page.evaluate(async () => {
        for (let frame = 0; frame < 4; frame += 1) {
          await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
        }
      });

      run.state = await page.evaluate(() => globalThis.__aiAgentLoopQa.state());
      run.after = await stableNotebookSnapshot(page);
      run.ui = await page.evaluate(() => {
        const panel = document.querySelector('.nb-ai-agent');
        const text = panel?.textContent ?? '';
        const rect = panel?.getBoundingClientRect() ?? null;
        return {
          panelText: text.replace(/\s+/g, ' ').trim(),
          errorCards: document.querySelectorAll('.nb-ai-error-card').length,
          pauseActivities: [...document.querySelectorAll('.nb-ai-activity')].filter((item) =>
            /agent task paused/i.test(item.textContent ?? '')).length,
          staleBars: document.querySelectorAll(
            '.nb-ai-agent-progress, .nb-ai-working-whisper, .nb-ai-mini-progress',
          ).length,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          panelInside: rect !== null && rect.left >= -1 && rect.top >= -1 &&
            rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1,
        };
      });
      const assistantCookieReplies = run.state.conversation.filter((message) =>
        message.role === 'assistant' && /Cookies are small pieces of data/u.test(message.text));
      const userCookieRequests = run.state.conversation.filter((message) =>
        message.role === 'user' && message.text === 'explain cookies');
      const notebookUnchanged = run.before.revision === run.after.revision &&
        JSON.stringify(run.before.pageIds) === JSON.stringify(run.after.pageIds);
      const common = {
        exactTwoProviderAttempts: run.state.providerCalls === 2 && run.state.providerRequestCount === 2,
        firstEnvelopeThenPlainRecovery: JSON.stringify(run.state.attemptedTools) === JSON.stringify([
          'conversation_tool_envelope',
          'plain_conversation',
        ]),
        noProviderRetryLayer: run.state.providerRetries === 0,
        oneExactUserRequest: userCookieRequests.length === 1,
        noDuplicatePauseActivity: run.state.visiblePauseActivities === 0 && run.ui.pauseActivities === 0,
        noStaleBars: run.ui.staleBars === 0,
        panelInsideViewport: run.ui.panelInside && !run.ui.horizontalOverflow,
        notebookUnchanged,
        noRuntimeSurfaceErrors:
          run.consoleErrors.length === 0 && run.pageErrors.length === 0 &&
          run.failedRequests.length === 0 && run.httpErrors.length === 0,
      };
      run.assertions = sabotage
        ? {
            ...common,
            bothBoundariesRejected: JSON.stringify(run.state.invalidResponseTools) === JSON.stringify([
              'conversation_tool_envelope',
              'plain_conversation',
            ]),
            oneCleanPauseCard:
              run.state.lifecycle === 'failed' && run.state.errorCode === 'provider_invalid_response' &&
              run.ui.errorCards === 1 && run.state.visibleErrorTitle === 'The AI reply could not be used',
            oneVisiblePauseHeadline: occurrences(run.ui.panelText, 'Agent task paused') === 1,
            noCookieAnswerAfterDoubleFailure: assistantCookieReplies.length === 0,
          }
        : {
            ...common,
            firstEnvelopeRejectedOnce: JSON.stringify(run.state.invalidResponseTools) === JSON.stringify([
              'conversation_tool_envelope',
            ]),
            recoveredWithoutPause:
              run.state.lifecycle === 'completed' && run.state.errorCode === null && run.ui.errorCards === 0,
            oneExactCookieAnswer: assistantCookieReplies.length === 1,
            noVisiblePauseText: !/agent task paused|reply could not be used/i.test(run.ui.panelText),
          };
      run.failures = Object.entries(run.assertions)
        .filter(([, passed]) => passed !== true)
        .map(([name]) => name);
      run.status = run.failures.length === 0 ? 'passed' : 'failed';
      run.panelText = tidy(run.ui.panelText);
      run.screenshots = {
        panel: resolve(runOut, 'panel.png'),
        viewport: resolve(runOut, 'viewport.png'),
      };
      await panel.screenshot({ path: run.screenshots.panel, animations: 'disabled', caret: 'hide' });
      await page.screenshot({ path: run.screenshots.viewport, animations: 'disabled', caret: 'hide' });
    } catch (error) {
      run.status = 'failed';
      run.failure = error instanceof Error ? error.stack ?? error.message : String(error);
      await page.screenshot({ path: resolve(runOut, 'failure.png'), caret: 'hide' }).catch(() => {});
    } finally {
      await context.close();
    }
    console.log(`agent conversation: ${run.status.toUpperCase()} · ${size}` +
      (run.failures?.length ? ` · ${run.failures.join(', ')}` : ''));
  }
} finally {
  await browser.close();
}

report.ok = report.runs.every((run) => run.status === 'passed');
const reportPath = resolve(out, sabotage ? 'report-sabotage.json' : 'report.json');
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
if (sabotage) {
  console.log(report.ok
    ? 'GATE ALIVE · double-invalid conversation paused once without duplicate transcript failures'
    : 'GATE INERT · double-invalid conversation duplicated or escaped its recovery state');
} else if (report.ok) {
  console.log('agent conversation: PASS · hi local, explain cookies recovered once at all viewports');
}
process.exitCode = report.ok ? 0 : 1;
