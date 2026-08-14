import type { AgentEventListener } from './events';
import type { SourceAttachmentRef } from './adapters';
import {
  AgentRuntime,
  type AgentRuntimeListener,
  type AgentRuntimeSnapshot,
  type SelectionRewriteRequest,
  type StartAgentTaskInput,
} from './runtime';
import type {
  AgentRunResult,
  NotebookInsertionTarget,
  NotebookPatchProposal,
} from './types';

/** Stable Solid-free bridge consumed by the rail panel and selection toolbar. */
export interface AiAgentController {
  getSnapshot(): AgentRuntimeSnapshot;
  subscribe(listener: AgentRuntimeListener): () => void;
  subscribeEvents(listener: AgentEventListener): () => void;
  startTask(input: StartAgentTaskInput): Promise<AgentRunResult>;
  restore(taskId: string): Promise<AgentRuntimeSnapshot>;
  sendUserMessage(
    text: string,
    options?: {
      readonly preserveAllSourceInformation?: boolean;
      readonly obfuscatePrivateText?: boolean;
      readonly insertionTarget?: NotebookInsertionTarget;
      readonly userMessageId?: string;
    },
  ): Promise<AgentRunResult>;
  registerAttachments(
    attachments: readonly SourceAttachmentRef[],
  ): Promise<AgentRuntimeSnapshot>;
  useSensibleDefaults(): Promise<AgentRunResult>;
  answerRequirements?(
    answers: Readonly<Record<string, string>>,
    defaultQuestionIds?: readonly string[],
  ): Promise<AgentRunResult>;
  stop(reason?: string): Promise<void>;
  retry(): Promise<AgentRunResult>;
  /** Leave the current durable task in history and return to a fresh composer. */
  clearActiveTask(): Promise<void>;
  deleteTask(taskId?: string): Promise<void>;
  requestSelectionRewrite(input: SelectionRewriteRequest): Promise<AgentRunResult>;
  approvePreview(previewId: string): Promise<NotebookPatchProposal>;
  /**
   * Rebuild an apply-failed preview against the current notebook without
   * turning the recovery action into a synthetic reader chat turn.
   */
  refreshFailedPreview(): Promise<AgentRunResult>;
  finalizeApprovedPatch(
    patchId: string,
    outcome: { readonly applied: boolean; readonly message?: string },
  ): Promise<AgentRunResult>;
  rejectPreview(previewId: string, feedback?: string): Promise<AgentRunResult>;
  revisePreview(previewId: string, feedback: string): Promise<AgentRunResult>;
  changePlacement(
    previewId: string,
    target: NotebookInsertionTarget,
  ): Promise<AgentRunResult>;
}

export function createAiAgentController(runtime: AgentRuntime): AiAgentController {
  return {
    getSnapshot: () => runtime.getSnapshot(),
    subscribe: (listener) => runtime.subscribe(listener),
    subscribeEvents: (listener) => runtime.subscribeEvents(listener),
    startTask: (input) => runtime.start(input),
    restore: (taskId) => runtime.restore(taskId),
    sendUserMessage: (text, options) => runtime.sendUserMessage(text, options),
    registerAttachments: (attachments) => runtime.registerAttachments(attachments),
    useSensibleDefaults: () => runtime.useSensibleDefaults(),
    answerRequirements: (answers, defaultQuestionIds) =>
      runtime.answerRequirements(answers, defaultQuestionIds),
    stop: (reason) => runtime.stop(reason),
    retry: () => runtime.retry(),
    clearActiveTask: () => runtime.clearActiveTask(),
    deleteTask: (taskId) => runtime.deleteTask(taskId),
    requestSelectionRewrite: (input) => runtime.requestSelectionRewrite(input),
    approvePreview: async (previewId) => {
      const result = await runtime.approvePreview(previewId);
      const proposal = result.state.patchProposal;
      if (
        proposal === undefined ||
        !['approved_pending_apply', 'apply_failed', 'approved'].includes(proposal.status)
      ) {
        throw new Error('approved proposal was not retained');
      }
      return proposal;
    },
    refreshFailedPreview: () => runtime.refreshFailedPreview(),
    finalizeApprovedPatch: (patchId, outcome) =>
      runtime.finalizeApprovedPatch(patchId, outcome),
    rejectPreview: (previewId, feedback) =>
      runtime.rejectPreview(previewId, feedback),
    revisePreview: (previewId, feedback) =>
      runtime.revisePreview(previewId, feedback),
    changePlacement: (previewId, target) =>
      runtime.changePlacement(previewId, target),
  };
}

let installedController: AiAgentController | null = null;
const installationListeners = new Set<(controller: AiAgentController | null) => void>();

/** App composition root installs one controller; feature UI remains injectable. */
export function installAiAgentController(controller: AiAgentController): () => void {
  installedController = controller;
  for (const listener of installationListeners) listener(controller);
  return () => {
    if (installedController !== controller) return;
    installedController = null;
    for (const listener of installationListeners) listener(null);
  };
}

export function getAiAgentController(): AiAgentController | null {
  return installedController;
}

export function subscribeAiAgentController(
  listener: (controller: AiAgentController | null) => void,
): () => void {
  installationListeners.add(listener);
  listener(installedController);
  return () => installationListeners.delete(listener);
}
