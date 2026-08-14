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
  String.raw`\b(?:do\s+not|don['’]?t|dont|never)\b[\s\S]{0,24}\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b[\s\S]{0,48}\b(?:notebook|book|page|pages|notes?|study\s+guide|summary|cheat\s*sheet|selection|highlighted|content)\b|\bwithout\b[\s\S]{0,16}\b(?:adding|appending|inserting|creating|making|building|writing|drafting|formatting|polishing|organ(?:i[sz]ing)|laying\s*out|turning|converting|rewriting|replacing|editing|changing|updating|revising|designing|putting|moving|deleting|removing)\b[\s\S]{0,40}\b(?:notebook|book|page|pages|notes?|selection|highlighted|content)\b`,
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
  const current = mutationIntent(latestReaderText(state));
  if (current === 'request') return true;
  if (current === 'revoke') return false;
  // Requirement answers such as “Use sensible defaults” refine an existing
  // task; they do not silently turn “insert this in my book” into chat. The
  // original goal remains authoritative until the reader explicitly revokes
  // notebook work or makes a new positive request.
  return mutationIntent(state.taskBrief.goal) === 'request';
}
