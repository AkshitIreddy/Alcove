import type { AgentState } from './types';

/**
 * Reader language is the authority for conversation versus notebook work.
 * A UI-provided placement is only a convenient default if notebook work is
 * requested; its presence must never turn an ordinary question into a write.
 */
const NOTEBOOK_MUTATION_REQUEST = new RegExp(
  String.raw`\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b[\s\S]{0,64}\b(?:notebook|book|page|pages|notes?|study\s+guide|summary|cheat\s*sheet|selection|highlighted|pasted|document|pdf|file|material|content)\b|\b(?:notebook|book|page|pages|notes?|selection|highlighted)\b[\s\S]{0,64}\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b`,
  'iu',
);

const NOTEBOOK_MUTATION_NEGATION = new RegExp(
  String.raw`\b(?:keep|leave|answer|explain|say|tell)\b[\s\S]{0,32}\b(?:here|in (?:the|our|this) (?:chat|conversation))\b|\b(?:chat|conversation)(?:\s+only)?\b|\b(?:do\s+not|don['’]?t|dont|never)\b[\s\S]{0,24}\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b[\s\S]{0,48}\b(?:notebook|book|page|pages|notes?|study\s+guide|summary|cheat\s*sheet|selection|highlighted|content)\b|\bwithout\b[\s\S]{0,16}\b(?:adding|appending|inserting|creating|making|building|writing|drafting|formatting|polishing|organ(?:i[sz]ing)|laying\s*out|turning|converting|rewriting|replacing|editing|changing|updating|revising|designing|putting|moving|deleting|removing)\b[\s\S]{0,40}\b(?:notebook|book|page|pages|notes?|selection|highlighted|content)\b`,
  'iu',
);

const EXPLICIT_SOURCE_REFERENCE = new RegExp(
  String.raw`\b(?:attach(?:ed|ment)?|upload(?:ed)?|pdf|document|file|source|material|pasted(?:\s+text)?|selected|selection|highlighted|image|picture|photo|spreadsheet|excel|csv|code\s+file|these\s+notes?|this\s+text|that\s+text|current\s+page|page\s+\d+)\b|\b(?:according\s+to|from)\s+(?:the|this|that|my)\b|\bwhat\s+does\s+(?:it|this|that|the\s+(?:file|document|pdf|page|source))\s+say\b`,
  'iu',
);

const SOURCE_OPERATION_WITH_IMPLICIT_OBJECT = new RegExp(
  String.raw`^(?:please\s+)?(?:summari[sz]e|analyse|analyze|explain|review|read|extract|transcribe|cite|quote|search|find|compare|convert|format|organise|organize)(?:\s+(?:it|this|that|these|those|the\s+(?:attachment|file|document|pdf|source|material)))?[.!?\s]*$|\b(?:summari[sz]e|analyse|analyze|explain|review|read|extract|transcribe|cite|quote|search|find|compare)\b[\s\S]{0,36}\b(?:it|this|that|these|those|above|attachment|file|document|pdf|source|material)\b|\b(?:what|who|when|where|why|how)\b[\s\S]{0,20}\b(?:this|that|it|these|those)\b`,
  'iu',
);

const GROUNDED_FOLLOW_UP = new RegExp(
  String.raw`\b(?:tell\s+me\s+more|continue|go\s+deeper|expand\s+on|what\s+about|the\s+(?:first|second|third|next|previous)\s+(?:example|point|page|part)|that\s+(?:example|point|section)|those\s+(?:examples|points))\b`,
  'iu',
);

const COMPLETE_SOURCE_REQUEST = new RegExp(
  String.raw`\b(?:without\s+(?:losing|omitting|skipping|dropping|leaving\s+out)|preserve|retain|include|read|cover|capture|keep)\b[\s\S]{0,32}\b(?:all|every|everything|verbatim|lossless|exhaustive|full[- ]coverage)\b|\b(?:do\s+not|don['’]?t|never)\b[\s\S]{0,32}\b(?:lose|omit|skip|drop|exclude|discard|leave\s+out)\b`,
  'iu',
);

export function latestReaderText(state: AgentState): string {
  return [...state.conversation]
    .reverse()
    .find((message) => message.role === 'user')?.text ?? state.taskBrief.goal;
}

function currentReaderMessages(state: AgentState): readonly string[] {
  const turnAnchorId = state.budgetWindow?.readerMessageId;
  const anchorIndex = turnAnchorId === undefined
    ? 0
    : state.conversation.findIndex((message) => message.id === turnAnchorId);
  let latestUserIndex = 0;
  for (let index = state.conversation.length - 1; index >= 0; index -= 1) {
    if (state.conversation[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  const firstCurrentTurnIndex = anchorIndex >= 0
    ? anchorIndex
    : turnAnchorId === undefined ? 0 : latestUserIndex;
  return state.conversation
    .slice(firstCurrentTurnIndex)
    .filter((message) => message.role === 'user')
    .map((message) => message.text);
}

function mutationIntent(text: string): 'request' | 'revoke' | 'unspecified' {
  if (NOTEBOOK_MUTATION_NEGATION.test(text)) return 'revoke';
  if (NOTEBOOK_MUTATION_REQUEST.test(text)) return 'request';
  return 'unspecified';
}

export function readerRequestsNotebookMutation(state: AgentState): boolean {
  // A task is a durable conversation, but intent belongs to the current
  // reader-authored turn. The turn anchor survives an ask_user interrupt, so
  // replies such as “yes” or “use your judgement” carry the initiating
  // notebook request forward. A normal settled follow-up opens a new budget
  // window and must not inherit an old write request forever.
  const messages = currentReaderMessages(state);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const intent = mutationIntent(messages[index]!);
    if (intent === 'request') return true;
    if (intent === 'revoke') return false;
  }
  return state.budgetWindow?.readerMessageId === undefined &&
    mutationIntent(state.taskBrief.goal) === 'request';
}

/**
 * A durable attachment is available evidence, not a mandate to retrieve it on
 * every later turn. This conservative reader-intent boundary is shared by tool
 * advertisement and final policy so ordinary chat cannot be forced through
 * RAG merely because an old file remains attached.
 */
export function readerRequiresSourceEvidence(state: AgentState): boolean {
  const readerSources = state.sourceManifest?.sources.some(
    (source) => source.kind !== 'notebook_script_spec' && source.units.length > 0,
  ) === true;
  if (!readerSources) return false;
  // Preserve All is a reader-owned UI contract, not wording the model may
  // ignore. Scope it to notebook work so a later unrelated chat question does
  // not revive an old attachment index merely because the task retains its
  // audit receipt.
  if (
    state.taskBrief.preserveAllSourceInformation &&
    readerRequestsNotebookMutation(state)
  ) return true;
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  if (
    EXPLICIT_SOURCE_REFERENCE.test(text) ||
    SOURCE_OPERATION_WITH_IMPLICIT_OBJECT.test(text) ||
    COMPLETE_SOURCE_REQUEST.test(text)
  ) {
    return true;
  }
  const priorGroundedAnswer = state.conversation.some(
    (message) => message.role === 'assistant' && (message.citations?.length ?? 0) > 0,
  );
  return priorGroundedAnswer && (
    GROUNDED_FOLLOW_UP.test(text) ||
    (readerRequestsNotebookMutation(state) && /\b(?:this|that|it|these|those|above)\b/iu.test(text))
  );
}

export function readerRequiresCompleteSourceCoverage(state: AgentState): boolean {
  if (!readerRequiresSourceEvidence(state)) return false;
  if (state.taskBrief.preserveAllSourceInformation) return true;
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  return COMPLETE_SOURCE_REQUEST.test(text);
}
