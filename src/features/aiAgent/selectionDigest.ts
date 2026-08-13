import type { AgentHashAdapter } from './adapters';

/**
 * One selection-anchor identity shared by capture, task handoff and apply.
 * The exact page-document digest binds text, marks and block ids; the range
 * binds the intended slice without maintaining two subtly different hashes.
 */
export function computeNotebookSelectionDigest(
  input: {
    readonly pageId: string;
    readonly from: number;
    readonly to: number;
    readonly documentDigest: string;
  },
  hash: AgentHashAdapter,
): Promise<string> {
  return hash.digestJson({
    pageId: input.pageId,
    from: input.from,
    to: input.to,
    documentDigest: input.documentDigest,
  });
}
