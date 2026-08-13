import { describe, expect, it, vi } from 'vitest';
import {
  OPEN_AI_AGENT_PANEL_EVENT,
  createSelectionRewriteRequest,
  handoffSelectionRewrite,
  type AiSelectionAnchor,
} from '../src/editor/toolbar/aiRewrite';
import {
  computeNotebookSelectionDigest,
  webCryptoAgentHash,
} from '../src/features/aiAgent';

const anchor = (): AiSelectionAnchor => ({
  bookId: 'book-1',
  pageId: 'page-4',
  from: 18,
  to: 42,
  pageRevision: 'sha256-page-json',
  selectedText: 'a sentence worth keeping',
});

describe('selected-text AI rewrite handoff', () => {
  it('uses one digest contract at capture and apply, and rejects a changed page', async () => {
    const captured = await computeNotebookSelectionDigest({
      pageId: 'page-4',
      from: 18,
      to: 42,
      documentDigest: 'sha256-page-json',
    }, webCryptoAgentHash);
    const unchangedAtApply = await computeNotebookSelectionDigest({
      pageId: 'page-4',
      from: 18,
      to: 42,
      documentDigest: 'sha256-page-json',
    }, webCryptoAgentHash);
    const changedAtApply = await computeNotebookSelectionDigest({
      pageId: 'page-4',
      from: 18,
      to: 42,
      documentDigest: 'sha256-page-json-after-edit',
    }, webCryptoAgentHash);

    expect(unchangedAtApply).toBe(captured);
    expect(changedAtApply).not.toBe(captured);
  });

  it('builds the anchored request without mutating or normalising selected text', () => {
    expect(createSelectionRewriteRequest(anchor(), '  make this more vivid  ')).toEqual({
      bookId: 'book-1',
      pageId: 'page-4',
      from: 18,
      to: 42,
      pageRevision: 'sha256-page-json',
      prompt: 'make this more vivid',
      selectedText: 'a sentence worth keeping',
    });
  });

  it('refuses an empty prompt or stale empty range before invoking the agent', () => {
    expect(() => createSelectionRewriteRequest(anchor(), '   ')).toThrow(
      'tell the agent what to change',
    );
    expect(() =>
      createSelectionRewriteRequest(
        { ...anchor(), from: 24, to: 24, selectedText: '' },
        'rewrite this',
      ),
    ).toThrow('select some text');
  });

  it('publishes one stable custom event name for BookView to open the agent rail', () => {
    expect(OPEN_AI_AGENT_PANEL_EVENT).toBe('alcove:open-ai-agent-panel');
  });

  it('opens the task rail and invokes the controller without an editor mutation seam', async () => {
    const requestSelectionRewrite = vi.fn(async () => ({ status: 'previewing' }));
    const openPanel = vi.fn();

    await handoffSelectionRewrite(
      { requestSelectionRewrite },
      anchor(),
      'make this gentler',
      openPanel,
    );

    expect(openPanel).toHaveBeenCalledWith({
      source: 'selection-toolbar',
      pageId: 'page-4',
      focus: 'active-task',
    });
    expect(requestSelectionRewrite).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-4',
        pageRevision: 'sha256-page-json',
        selectedText: 'a sentence worth keeping',
        prompt: 'make this gentler',
      }),
    );
  });
});
