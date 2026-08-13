/**
 * Stable bridge between the body-level selection toolbar and the in-book AI
 * agent.  The toolbar owns the ephemeral prompt; the agent owns every draft,
 * review and approval after that prompt is handed over.
 */
import type { SelectionRewriteRequest } from '../../features/aiAgent/runtime';

export const OPEN_AI_AGENT_PANEL_EVENT = 'alcove:open-ai-agent-panel';

export interface OpenAiAgentPanelDetail {
  readonly source: 'selection-toolbar';
  readonly pageId: string;
  /** The rail should foreground the task transcript rather than its empty composer. */
  readonly focus: 'active-task';
}

export interface AiSelectionAnchor {
  readonly bookId: string;
  readonly pageId: string;
  readonly from: number;
  readonly to: number;
  readonly pageRevision: string;
  readonly selectedText: string;
  readonly obfuscatePrivateText?: boolean;
}

export interface SelectionRewriteController {
  requestSelectionRewrite(request: SelectionRewriteRequest): Promise<unknown>;
}

export type OpenAiAgentPanel = (detail: OpenAiAgentPanelDetail) => void;

/**
 * Make the exact immutable request the runtime accepts.  Keeping this pure is
 * useful beyond tests: the editor plugin captures a selection once, then may
 * safely move focus into the prompt without changing what the agent will edit.
 */
export function createSelectionRewriteRequest(
  anchor: AiSelectionAnchor,
  prompt: string,
): SelectionRewriteRequest {
  const instruction = prompt.trim();
  if (instruction === '') throw new Error('tell the agent what to change');
  if (anchor.bookId === '' || anchor.pageId === '') {
    throw new Error('the selected text is not attached to an open book page');
  }
  if (anchor.to <= anchor.from || anchor.selectedText === '') {
    throw new Error('select some text before asking the agent');
  }
  if (anchor.pageRevision === '') {
    throw new Error('the selected page has no stable revision');
  }
  return {
    bookId: anchor.bookId,
    pageId: anchor.pageId,
    from: anchor.from,
    to: anchor.to,
    pageRevision: anchor.pageRevision,
    prompt: instruction,
    selectedText: anchor.selectedText,
    obfuscatePrivateText: anchor.obfuscatePrivateText,
  };
}

/** Open the book rail without coupling this body portal to BookView's signals. */
export function openAiAgentPanel(detail: OpenAiAgentPanelDetail): void {
  window.dispatchEvent(
    new CustomEvent<OpenAiAgentPanelDetail>(OPEN_AI_AGENT_PANEL_EVENT, {
      detail,
    }),
  );
}

/**
 * One-way ownership transfer: open the task rail, then start the anchored
 * request. There is intentionally no editor command or replacement callback
 * in this seam; only the proposal approval path may eventually mutate prose.
 */
export function handoffSelectionRewrite(
  controller: SelectionRewriteController,
  anchor: AiSelectionAnchor,
  prompt: string,
  openPanel: OpenAiAgentPanel = openAiAgentPanel,
): Promise<unknown> {
  const request = createSelectionRewriteRequest(anchor, prompt);
  openPanel({
    source: 'selection-toolbar',
    pageId: anchor.pageId,
    focus: 'active-task',
  });
  return controller.requestSelectionRewrite(request);
}
