import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canPresentFinalPreview,
  previewLayoutView,
} from '../src/views/rail/aiAgentPreviewGate';
import {
  asksForCompleteSourcePreservation,
  asksToRelaxCompleteSourcePreservation,
} from '../src/views/rail/aiAgentControllerAdapter';
import type { AiAgentDraftPreviewView } from '../src/views/rail/AiAgentPanel';

const ROOT = resolve(import.meta.dirname, '..');

const finalPreview = (): AiAgentDraftPreviewView => ({
  id: 'preview-1',
  version: 2,
  title: 'A reviewed draft',
  summary: 'Two pages ready for the reader.',
  pages: [
    {
      id: 'page-1',
      pageNumber: 1,
      renderUrl: 'asset://preview/page-1',
      width: 620,
      height: 720,
    },
  ],
  affectedPageCount: 1,
  parser: { status: 'passed', label: 'Parser passed' },
  layout: { status: 'passed', label: 'Layout fits' },
  review: {
    status: 'passed',
    round: 2,
    summary: 'Every native render was inspected.',
    findings: [],
  },
  citations: [],
  imageGenerationPrompts: [],
  placements: [{ id: 'end', label: 'At the end of the book' }],
  placementId: 'end',
  isolated: true,
});

describe('AI agent final-preview gate', () => {
  it('allows the one final decision only after native visual review passes', () => {
    expect(canPresentFinalPreview(finalPreview())).toBe(true);
  });

  it('keeps intermediate renders with the agent instead of asking the reader to QA them', () => {
    const preview = finalPreview();
    expect(
      canPresentFinalPreview({
        ...preview,
        review: { ...preview.review, status: 'inspecting' },
      }),
    ).toBe(false);
  });

  it('never exposes approval for a failed parser/layout contract or an empty render', () => {
    const preview = finalPreview();
    expect(
      canPresentFinalPreview({
        ...preview,
        parser: { status: 'failed', label: 'Parser failed' },
      }),
    ).toBe(false);
    expect(canPresentFinalPreview({ ...preview, pages: [] })).toBe(false);
  });

  it('keeps resolved continuation leaves visible and fails only residual overflow', () => {
    expect(
      previewLayoutView([
        { paginationSpill: true, residualOverflow: false },
        { paginationSpill: false, residualOverflow: false },
      ]),
    ).toEqual({ status: 'passed', label: 'Pagination flowed safely' });

    expect(
      previewLayoutView([
        { paginationSpill: true, residualOverflow: true },
      ]),
    ).toEqual({ status: 'failed', label: 'Unresolved page overflow' });
  });
});

describe('AI agent first-use visibility', () => {
  it('opens key setup only when the real AI rail is visible, never while its mounted panel is hidden', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');
    const book = readFileSync(resolve(ROOT, 'src/views/BookView.tsx'), 'utf8');

    expect(panel).toContain('readonly panelOpen?: boolean');
    expect(panel).toContain("props.panelOpen === true && !props.tourPreview && state().connection.firstUse === true");
    expect(panel).toContain('props.tourPreview || props.panelOpen !== true');
    expect(panel).toContain('props.panelOpen === true && !props.tourPreview && setupOpen()');
    expect(book).toContain("panelOpen={activePanel() === 'ai-agent'}");
  });
});

describe('AI agent conversational transcript', () => {
  it('infers ordinary questions as conversation and requires explicit notebook-changing intent', () => {
    const prompts = readFileSync(resolve(ROOT, 'src/features/aiAgent/prompts.ts'), 'utf8');
    const demo = readFileSync(resolve(ROOT, 'src/views/rail/aiAgentDemoBridge.ts'), 'utf8');

    expect(prompts).toContain('You own the semantic outcome for the current reader turn');
    expect(prompts).toContain('intentHint produced locally; it is not authority');
    expect(prompts).toContain('call set_task_mode once with a concise reason');
    expect(prompts).toContain('Ordinary questions and requests to explain, teach, compare, brainstorm or answer are conversational by default');
    expect(prompts).toContain('Clear requests to add, insert, make notes or pages');
    expect(demo).toContain("'Can you explain Huffman coding with kittens?'");
    expect(demo).not.toContain('Keep it here in our conversation');
  });

  it('renders provider prose as safe semantic Markdown without raw HTML', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');
    const styles = readFileSync(resolve(ROOT, 'src/styles/ai-agent.css'), 'utf8');

    expect(panel).toContain('<MessageMarkdown text={item.text} />');
    expect(panel).toContain('<Show when={!settledConversationOnly()}>');
    expect(panel).toContain('<ul>');
    expect(panel).toContain('<ol>');
    expect(panel).toContain('<blockquote>');
    expect(panel).toContain('<pre data-language={block.language}><code>{block.text}</code></pre>');
    expect(panel).toContain('<table>');
    expect(styles).toMatch(/\.nb-ai-message-copy\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/\.nb-ai-message-copy ul,[^}]*list-style-position:\s*outside;/s);
    expect(styles).toMatch(/\.nb-ai-message-copy pre\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(styles).toMatch(/\.nb-ai-message\s*\{[^}]*min-width:\s*0;/s);
    expect(styles).toMatch(/\.nb-ai-citations\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
    expect(styles).toMatch(/\.nb-ai-citations button\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
  });

  it('sends on Enter, keeps Shift+Enter for a newline and exposes a task-log copy button', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).toContain("event.key !== 'Enter' || event.shiftKey || event.isComposing");
    expect(panel).toContain('onKeyDown={props.onSendFromKeyboard}');
    expect(panel).toContain('Enter sends · Shift ↵ line');
    expect(panel).toContain('aria-label="Copy AI task log"');
    expect(panel).toContain('data-tooltip="copy task log"');
    expect(panel).toContain('copyDiagnosticLog');
  });

  it('does not invent a reader message when the preview viewer is opened', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).not.toContain('Opened the full-page review.');
    expect(panel).not.toContain('localDecisions');
  });

  it('keeps the verbose context-scope disclosure out of the conversation panel', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).not.toContain('The context chip is a starting scope.');
    expect(panel).not.toContain('other books stay local.');
    expect(panel).not.toContain('nb-ai-privacy-line');
    expect(panel).not.toContain('privacy & connection');
  });

  it('remembers the pre-update bottom position before following newly appended work', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).toContain('let transcriptWasNearEnd = true');
    expect(panel).toContain('const rememberTranscriptPosition = (): void =>');
    expect(panel).toContain('onScroll={rememberTranscriptPosition}');
    expect(panel).toContain('if (!transcriptWasNearEnd) return');
    expect(panel).toContain("behavior: 'auto'");
    expect(panel).not.toContain("behavior: 'smooth'");
    expect(panel).not.toContain('const nearEnd = viewport.scrollHeight - viewport.scrollTop');
  });

  it('uses the app scrollbar for the live transcript and gives full preview fit plus page navigation', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');
    const styles = readFileSync(resolve(ROOT, 'src/styles/ai-agent.css'), 'utf8');

    expect(panel).toContain('label="AI agent conversation position"');
    expect(panel).toContain("createSignal<'fit' | number>('fit')");
    expect(panel).toContain('aria-label="Previous reviewed page"');
    expect(panel).toContain('aria-label="Next reviewed page"');
    expect(panel).toContain("event.key === 'ArrowLeft' || event.key === 'ArrowRight'");
    expect(styles).toContain('.nb-ai-full-preview-canvas.is-fit > img');
    expect(styles).toContain('.nb-ai-full-preview-nav');
  });

  it('captures reviewed pages on the live book stock and uses a quiet preview mat', () => {
    const capture = readFileSync(resolve(ROOT, 'src/editor/script/exporters/capture.ts'), 'utf8');
    const mount = readFileSync(resolve(ROOT, 'src/features/aiAgent/draftSandboxMount.tsx'), 'utf8');
    const sandbox = readFileSync(resolve(ROOT, 'src/features/aiAgent/draftSandbox.ts'), 'utf8');
    const styles = readFileSync(resolve(ROOT, 'src/styles/ai-agent.css'), 'utf8');

    // File exports retain house parchment, but the approval image is evidence
    // about this open book and therefore supplies the mounted leaf's resolved
    // stock explicitly. The renderer identity prevents stale cream previews
    // from hydrating after this capture contract changes.
    expect(capture).toContain('readonly backgroundColor?: string');
    expect(capture).toContain('backgroundColor: options.backgroundColor ?? PAPER_CREAM');
    expect(mount).toContain('backgroundColor: getComputedStyle(sheet).backgroundColor');
    expect(sandbox).toContain("DRAFT_SANDBOX_RENDERER_VERSION = 'alcove-page-editor-v4'");

    expect(styles).toMatch(/\.nb-ai-preview-stage\s*\{[^}]*background:\s*var\(--nb-ai-preview-mat\)/s);
    expect(styles).toMatch(/\.nb-ai-full-preview-body\s*\{[^}]*background:\s*var\(--nb-ai-preview-mat-deep\)/s);
    expect(styles).toMatch(/\.nb-ai-full-preview-canvas\s*\{[^}]*background:\s*var\(--nb-ai-preview-mat-deep\)/s);
    expect(styles).not.toMatch(/\.nb-ai-full-preview-body\s*\{[^}]*background:\s*var\(--recess\)/s);
  });

  it('shows friendly latency copy only when no concrete live action is already visible', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');
    const adapter = readFileSync(resolve(ROOT, 'src/views/rail/aiAgentControllerAdapter.ts'), 'utf8');
    const styles = readFileSync(resolve(ROOT, 'src/styles/ai-agent.css'), 'utf8');

    expect(panel).toContain('readonly workingNote?: string');
    expect(panel).toContain('isVisibleLiveWork(tail) ? undefined : note');
    expect(panel).toContain('<AgentWorkingWhisper note={note} />');
    expect(adapter).toContain('const WORKING_NOTES');
    expect(adapter).toContain("'Sketching a gentle plan…'");
    expect(adapter).toContain("'Arranging the stepping stones…'");
    expect(adapter).toContain("'Imagining the pages…'");
    expect(adapter).toContain('friendlyWorkingNote(');
    expect(styles).toContain('.nb-ai-working-whisper');
    expect(styles).toContain('@keyframes nb-ai-thinking-dot');
  });
});

describe('AI agent complete-source intent', () => {
  it.each([
    "I don't want to lose any info from this PDF",
    "She doesn't want the agent to omit a single detail",
    'Use the source without losing anything',
    'Please preserve every piece of information',
    'All the facts and details must survive',
    'Make an exhaustive, full-coverage conversion',
    'Not a single page should be skipped',
    "Don't leave anything out",
    'Include everything from the PDF',
    'Make sure nothing is omitted',
    'Keep every single detail',
    'I need all of it',
  ])('enforces complete retrieval for %j', (request) => {
    expect(asksForCompleteSourcePreservation(request)).toBe(true);
  });

  it.each([
    'Summarise the most important findings',
    'Use the relevant examples from the PDF',
    'Write a short note without unnecessary repetition',
    'The picture has mostly all the details, so keep the notes brief',
  ])('does not turn an ordinary selective request into preserve-all for %j', (request) => {
    expect(asksForCompleteSourcePreservation(request)).toBe(false);
  });

  it.each([
    "I don't need you to preserve everything this time",
    'Only use the relevant details',
    'Use the key parts rather than everything',
  ])('recognizes an explicit request to relax an existing contract: %j', (request) => {
    expect(asksToRelaxCompleteSourcePreservation(request)).toBe(true);
  });

  it('does not interpret an unrelated follow-up as a preservation revocation', () => {
    expect(asksToRelaxCompleteSourcePreservation(
      'can you see images, tell me what you see in this picture',
    )).toBe(false);
  });
});

describe('AI agent stopped recovery', () => {
  it('keeps the stopped tone, dynamic Continue label and follow-up guidance wired in the panel', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).toContain("data-tone={props.error.tone ?? 'paused'}");
    expect(panel).toContain("'stopped · your place is saved'");
    expect(panel).toContain("props.error.actionLabel ?? 'Try again'");
    expect(panel).toContain('or write a follow-up below');
  });
});

describe('AI agent book identity boundary', () => {
  it('remounts the book-scoped runtime when quick switching between open books', () => {
    const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8');
    const keyedBoundary = app.indexOf(
      '<Show when={appState.openBookId()} keyed>',
    );
    const mountedBook = app.indexOf('{(_bookId) => <BookView />}', keyedBoundary);
    const boundaryEnd = app.indexOf('</Show>', mountedBook);

    expect(keyedBoundary).toBeGreaterThan(-1);
    expect(mountedBook).toBeGreaterThan(keyedBoundary);
    expect(boundaryEnd).toBeGreaterThan(mountedBook);
  });
});

describe('AI agent tutorial preview', () => {
  it('opens the real rail panel for the tour without consuming first-use setup', () => {
    const steps = readFileSync(resolve(ROOT, 'src/features/tutorial/steps.ts'), 'utf8');
    const bookView = readFileSync(resolve(ROOT, 'src/views/BookView.tsx'), 'utf8');
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(steps).toContain("id: 'meet-the-agent'");
    expect(steps).toContain('nothing is sent during this preview');
    expect(bookView).toContain("const stepId = 'meet-the-agent'");
    expect(bookView).toContain('tourPreview={aiTutorialPreview()}');
    expect(bookView).toContain('if (here !== stepId)');
    expect(bookView).toContain('setAiTutorialPreview(false)');
    expect(bookView).toContain('} else if (openedByTour && !open) {');
    expect(panel).toContain('!props.tourPreview && setupOpen()');
    expect(panel).toContain('tour preview · offline · nothing sent');
    expect(panel).toContain('Optional setup waits until you open the Agent yourself.');
  });
});

describe('AI agent localhost credential boundary', () => {
  it('discloses the deliberately ephemeral localhost key', () => {
    const panel = readFileSync(resolve(ROOT, 'src/views/rail/AiAgentPanel.tsx'), 'utf8');

    expect(panel).toContain('On localhost, the key stays only in page memory');
    expect(panel).toContain('and is forgotten on reload.');
    expect(panel).toContain('disabled={!canSubmit() || props.connection.status');
    expect(panel).toContain('(state().connection.firstUse === true || import.meta.env.DEV)');
  });
});
