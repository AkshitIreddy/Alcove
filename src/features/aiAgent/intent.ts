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

export function latestReaderText(state: AgentState): string {
  return [...state.conversation]
    .reverse()
    .find((message) => message.role === 'user')?.text ?? state.taskBrief.goal;
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
  const fallbackUserIndex = turnAnchorId === undefined
    ? 0
    : latestUserIndex;
  const firstCurrentTurnIndex = anchorIndex >= 0 ? anchorIndex : fallbackUserIndex;
  for (
    let index = state.conversation.length - 1;
    index >= firstCurrentTurnIndex;
    index -= 1
  ) {
    const message = state.conversation[index];
    if (message?.role !== 'user') continue;
    const intent = mutationIntent(message.text);
    if (intent === 'request') return true;
    if (intent === 'revoke') return false;
  }
  return turnAnchorId === undefined && mutationIntent(state.taskBrief.goal) === 'request';
}
