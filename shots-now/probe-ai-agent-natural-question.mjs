/**
 * Live regression for Alcove Agent's ordinary conversational clarification.
 *
 * The force-only `conversation` fixture stands in for the provider so this
 * probe can exercise the real panel deterministically. It pins the important
 * reader contract: one assistant question remains in the transcript, the
 * reader's exact prose answer appears once, and no retired form UI or prior
 * turn work receipts come back when the answer starts the next turn.
 *
 *   node shots-now/probe-ai-agent-natural-question.mjs
 *   node shots-now/probe-ai-agent-natural-question.mjs --sabotage
 *
 * `--sabotage` injects a retired question card into the live transcript. The
 * probe must reject it and print GATE ALIVE; GATE INERT is a failing exit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'qa/ai-agent-natural-question');
const sabotage = process.argv.includes('--sabotage');
const urlArg = process.argv.find((value) => value.startsWith('--url='));
const base = urlArg?.slice('--url='.length) || 'http://127.0.0.1:1420';
const target = `${base}/?fx=force&dev=0`;
const reportPath = resolve(OUT, sabotage ? 'report-sabotage.json' : 'report.json');
const screenshotPath = resolve(OUT, sabotage ? 'panel-sabotage.png' : 'panel.png');
const request = 'add the explanation above to my book';
const reply = 'yes, keep the examples';

mkdirSync(OUT, { recursive: true });

const report = {
  probeVersion: 1,
  generatedAt: new Date().toISOString(),
  target,
  sabotage,
  status: 'running',
  screenshot: screenshotPath,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.setDefaultTimeout(60_000);

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__shelfWorld !== undefined);

  const skipTour = page.getByText('skip the tour', { exact: false }).first();
  if (await skipTour.count()) await skipTour.click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});

  const welcome = await page.evaluate(() => {
    const list = globalThis.__shelfVisibleBooks?.() ?? [];
    const book = list.find((candidate) => /welcome/i.test(candidate.title)) ?? list[0];
    if (book === undefined) throw new Error('No Welcome book is available for the Agent probe.');
    return { id: book.id, title: book.title };
  });
  report.book = welcome;

  // Use the visible shelf's own bridge/UI rather than importing appState. On
  // a dev server that has served HMR, a page import can resolve a second store
  // instance and "open" a book the rendered app never observes.
  await page.locator('.shelf-a11y button').first().dispatchEvent('click');
  await page.getByRole('button', { name: `Open ${welcome.title}`, exact: true }).click();
  await page.waitForTimeout(900);
  const readButton = page.getByRole('button', { name: /^read it$/i });
  if (await readButton.count()) await readButton.click();
  await page.waitForSelector('.nb-prose');
  await page.waitForFunction(() => typeof globalThis.__aiAgentDemo?.reset === 'function');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await globalThis.__aiAgentDemo.reset('conversation');
    globalThis.__aiAgentDemo.open();
  });
  await page.waitForFunction(() =>
    document.querySelector('.nb-rail-panel.is-ai-agent')?.getAttribute('aria-hidden') === 'false'
  );

  const panel = page.locator('.nb-ai-agent');
  const composer = page.locator('textarea[aria-label="What should the agent do?"]');
  const send = page.locator('button[aria-label="Send to AI agent"]');
  await panel.waitFor({ state: 'visible' });

  await composer.fill(request);
  await send.click();
  await page.waitForFunction(() => globalThis.__aiAgentDemo?.state().stage === 'intake');
  await page.evaluate(() => globalThis.__aiAgentDemo.advance('answer'));
  await page.waitForFunction(() => globalThis.__aiAgentDemo?.state().stage === 'answer');
  await page.waitForFunction(() =>
    document.querySelectorAll('.nb-ai-message[data-role="agent"]').length === 1
  );

  const waiting = await page.evaluate(() => {
    const question = document.querySelector('.nb-ai-message[data-role="agent"] .nb-ai-message-copy');
    const textarea = document.querySelector('textarea[aria-label="What should the agent do?"]');
    return {
      question: question?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      placeholder: textarea instanceof HTMLTextAreaElement ? textarea.placeholder : '',
      disabled: textarea instanceof HTMLTextAreaElement ? textarea.disabled : true,
      agentMessages: document.querySelectorAll('.nb-ai-message[data-role="agent"]').length,
      questionCards: document.querySelectorAll('.nb-ai-question-card').length,
      questionOptions: document.querySelectorAll('.nb-ai-question-options').length,
      attachments: document.querySelectorAll('.nb-ai-attachment').length,
    };
  });

  await composer.fill(reply);
  await send.click();
  await page.waitForFunction((exactReply) => {
    const messages = [...document.querySelectorAll('.nb-ai-message[data-role="reader"] .nb-ai-message-copy')]
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim());
    return messages.filter((text) => text === exactReply).length === 1;
  }, reply);

  if (sabotage) {
    await page.evaluate(() => {
      const transcript = document.querySelector('.nb-ai-transcript');
      if (!(transcript instanceof HTMLElement)) throw new Error('The Agent transcript is missing.');
      const retiredCard = document.createElement('article');
      retiredCard.className = 'nb-ai-question-card';
      retiredCard.dataset.probeSabotage = 'retired-question-form';
      retiredCard.innerHTML = '<h3>Choose an option</h3><div class="nb-ai-question-options"><button class="is-defaults">Use sensible defaults</button></div>';
      transcript.append(retiredCard);
    });
  }

  const evidence = await page.evaluate(({ exactQuestion, exactReply, exactRequest }) => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() ?? '';
    const agentMessages = [...document.querySelectorAll('.nb-ai-message[data-role="agent"] .nb-ai-message-copy')]
      .map((node) => clean(node.textContent));
    const readerMessages = [...document.querySelectorAll('.nb-ai-message[data-role="reader"] .nb-ai-message-copy')]
      .map((node) => clean(node.textContent));
    const defaultButtons = [...document.querySelectorAll('.nb-ai-agent button')]
      .map((node) => clean(node.textContent))
      .filter((text) => /sensible defaults|default for all/i.test(text));
    const transcriptReceipts = document.querySelectorAll([
      '.nb-ai-transcript .nb-ai-activity',
      '.nb-ai-transcript .nb-ai-tool-card',
      '.nb-ai-transcript .nb-ai-plan-card',
      '.nb-ai-transcript .nb-ai-work-summary',
      '.nb-ai-transcript .nb-ai-review-activity',
      '.nb-ai-transcript .nb-ai-mini-progress',
    ].join(', ')).length;
    return {
      headline: clean(document.querySelector('.nb-ai-agent-status strong')?.textContent),
      threadTitle: clean(document.querySelector('.nb-ai-agent-identity strong')?.textContent),
      agentMessages,
      readerMessages,
      persistentQuestionCount: agentMessages.filter((text) => text === exactQuestion).length,
      exactRequestCount: readerMessages.filter((text) => text === exactRequest).length,
      exactReplyCount: readerMessages.filter((text) => text === exactReply).length,
      syntheticReplyCount: readerMessages.filter((text) => /^response\s*:/i.test(text)).length,
      questionCards: document.querySelectorAll('.nb-ai-question-card').length,
      questionOptions: document.querySelectorAll('.nb-ai-question-options').length,
      defaultButtons,
      attachments: document.querySelectorAll('.nb-ai-attachment').length,
      transcriptReceipts,
      currentWorkingWhispers: document.querySelectorAll('.nb-ai-working-whisper').length,
      currentHeaderProgress: document.querySelectorAll('.nb-ai-agent-progress').length,
    };
  }, { exactQuestion: waiting.question, exactReply: reply, exactRequest: request });

  const checks = {
    oneNaturalQuestion:
      waiting.agentMessages === 1 &&
      waiting.question.length >= 12 &&
      waiting.question.endsWith('?'),
    naturalReplyPlaceholder:
      !waiting.disabled && /reply|answer|respond|tell me|say|keep/i.test(waiting.placeholder),
    questionPersistedOnce: evidence.persistentQuestionCount === 1,
    exactRequestOnce: evidence.exactRequestCount === 1,
    exactReplyOnce: evidence.exactReplyCount === 1,
    noSyntheticReply: evidence.syntheticReplyCount === 0,
    noLegacyQuestionUi:
      waiting.questionCards === 0 &&
      waiting.questionOptions === 0 &&
      evidence.questionCards === 0 &&
      evidence.questionOptions === 0 &&
      evidence.defaultButtons.length === 0,
    noAttachment: waiting.attachments === 0 && evidence.attachments === 0,
    noStudyNotesFixtureLeak:
      !/kitten infographic|huffman coding with kittens/i.test(
        `${evidence.headline} ${evidence.threadTitle}`,
      ),
    noResurrectedTranscriptReceipts: evidence.transcriptReceipts === 0,
  };

  report.waiting = waiting;
  report.evidence = evidence;
  report.checks = checks;

  await panel.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide' });

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const sabotageCaught = sabotage &&
    failures.length === 1 &&
    failures[0] === 'noLegacyQuestionUi';

  if (sabotage) {
    report.status = sabotageCaught ? 'sabotage-caught' : 'sabotage-invalid';
    report.ok = false;
    if (!sabotageCaught) {
      throw new Error(
        failures.length === 0
          ? 'GATE INERT: the injected retired question form passed every assertion.'
          : `Sabotage run had unrelated failures: ${failures.join(', ')}.`,
      );
    }
  } else {
    report.ok = failures.length === 0;
    report.status = report.ok ? 'passed' : 'failed';
    if (!report.ok) throw new Error(`Natural-question checks failed: ${failures.join(', ')}.`);
  }
} catch (error) {
  report.status = report.status === 'sabotage-invalid' ? report.status : 'failed';
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
} finally {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
if (sabotage) console.log(report.status === 'sabotage-caught' ? 'GATE ALIVE' : 'GATE INERT');
process.exitCode = sabotage
  ? report.status === 'sabotage-caught' ? 0 : 1
  : report.ok === true ? 0 : 1;
