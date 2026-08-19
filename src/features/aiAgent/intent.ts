import type { AgentObjectiveMode, AgentState } from './types';

type ModelTurnLike =
  | {
      readonly role: 'tool';
      readonly toolName: string;
      readonly isError?: boolean;
      readonly content?: unknown;
    }
  | {
      readonly role: 'assistant';
      readonly content?: unknown;
    }
  | {
      readonly role: 'user';
      readonly content?: unknown;
      readonly text?: string;
    };

function currentReaderScopeTurns(state: AgentState): readonly ModelTurnLike[] {
  if (
    state.objective?.reason === 'reader_preview_feedback' &&
    state.draft?.sourceManifestDigest !== undefined &&
    state.draft.sourceManifestDigest === state.sourceManifest?.digest
  ) {
    return state.modelHistory as readonly ModelTurnLike[];
  }
  const anchorId = state.budgetWindow?.readerMessageId;
  const anchorIndex = anchorId === undefined
    ? -1
    : state.modelHistory.findIndex(
        (turn) => turn.role === 'user' && turn.id === anchorId,
      );
  if (anchorIndex >= 0) return state.modelHistory.slice(anchorIndex) as readonly ModelTurnLike[];

  let latestUserTurnIndex = -1;
  for (let index = state.modelHistory.length - 1; index >= 0; index -= 1) {
    if (state.modelHistory[index]?.role === 'user') {
      latestUserTurnIndex = index;
      break;
    }
  }
  return state.modelHistory.slice(
    Math.max(latestUserTurnIndex, 0),
  ) as readonly ModelTurnLike[];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function conciseImageReadUnitEvidence(state: AgentState): Set<string> {
  const evidence = new Set<string>();
  for (const turn of currentReaderScopeTurns(state)) {
    if (
      turn.role !== 'tool' ||
      turn.isError === true ||
      (turn.toolName !== 'read_full_source' && turn.toolName !== 'read_source_range')
    ) continue;
    const content = asRecord(turn.content);
    const visualRefs = Array.isArray(content?.visualRefs) ? content.visualRefs : [];
    for (const value of visualRefs) {
      const visual = asRecord(value);
      const anchor = asRecord(visual?.anchor);
      const unitId = anchor?.unitId;
      // Only reader-managed attachment reads carry a portable asset path.
      // PDF page renders and notebook screenshots are visual evidence too,
      // but they are not images the reader authorized Alcove to insert.
      if (
        typeof visual?.portableAssetPath === 'string' &&
        visual.portableAssetPath.trim() !== '' &&
        typeof unitId === 'string' && unitId !== ''
      ) {
        evidence.add(unitId);
      }
    }
  }
  return evidence;
}

function imageUnitCandidates(state: AgentState): Set<string> {
  const imageSources = state.sourceManifest?.sources.filter(
    (source) => source.kind === 'image' && source.units.length > 0,
  ) ?? [];
  const bySourceImageUnits = new Map<string, string>();
  for (const source of imageSources) {
    for (const unit of source.units) {
      bySourceImageUnits.set(unit.id, source.id);
    }
  }
  const readImageUnits = (state.sourceCoverage?.readUnitIds ?? []).filter(
    (unitId) => bySourceImageUnits.has(unitId),
  );
  if (readImageUnits.length > 0) {
    return new Set(readImageUnits);
  }
  if (imageSources.length > 0) {
    return new Set(imageSources.flatMap((source) => source.units.map((unit) => unit.id)));
  }
  // In recovery-heavy flows the manifest can be unavailable while the same
  // reader turn still has a concrete image read result and therefore concrete
  // media authority.
  return conciseImageReadUnitEvidence(state);
}

/**
 * Reader language is the authority for conversation versus notebook work.
 * A UI-provided placement is only a convenient default if notebook work is
 * requested; its presence must never turn an ordinary question into a write.
 */
const NOTEBOOK_MUTATION_REQUEST = new RegExp(
  String.raw`\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b[\s\S]{0,64}\b(?:notebook|book|page|pages|notes?|study\s+guide|summary|cheat\s*sheet|selection|highlighted|pasted|document|pdf|file|material|content)\b|\b(?:notebook|book|page|pages|notes?|selection|highlighted)\b[\s\S]{0,64}\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b|\b(?:add|append|insert|put|place)\b[\s\S]{0,48}\b(?:attached\s+)?(?:image|picture|photo)\b`,
  'iu',
);

const NOTEBOOK_MUTATION_NEGATION = new RegExp(
  String.raw`\b(?:keep|leave|answer|explain|say|tell)\b[\s\S]{0,32}\b(?:here|in (?:the|our|this) (?:chat|conversation))\b|\b(?:chat|conversation)(?:\s+only)?\b|\b(?:do\s+not|don['’]?t|dont|never)\b[\s\S]{0,24}\b(?:add|append|insert|create|make|build|write|draft|format|polish|organ(?:i[sz]e|ized?)|lay\s*out|turn|convert|rewrite|replace|edit|change|update|revise|design|put|move|delete|remove)\b[\s\S]{0,48}\b(?:notebook|book|page|pages|notes?|study\s+guide|summary|cheat\s*sheet|selection|highlighted|content)\b|\bwithout\b[\s\S]{0,16}\b(?:adding|appending|inserting|creating|making|building|writing|drafting|formatting|polishing|organ(?:i[sz]ing)|laying\s*out|turning|converting|rewriting|replacing|editing|changing|updating|revising|designing|putting|moving|deleting|removing)\b[\s\S]{0,40}\b(?:notebook|book|page|pages|notes?|selection|highlighted|content)\b`,
  'iu',
);

const CONVERSATION_REQUEST = new RegExp(
  // Questions often arrive without terminal punctuation (especially on
  // mobile): “can you see images”, “does this look right”, “would that work”.
  // Mutation intent is checked first, so “can you add this to my book” still
  // enters notebook work while question-shaped requests default to chat.
  String.raw`^\s*(?:hi|hello|hey|what|why|how|who|when|where|which|can|could|would|do|does|did|is|are|was|were|will|should|may|explain|define|describe|tell\s+me|compare|brainstorm|answer|summari[sz]e|analy[sz]e|review|read|find|search)\b|\?\s*$`,
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

const VAGUE_NOTEBOOK_COMMAND_WITH_IMPLICIT_ATTACHMENT = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:add|append|insert|put|place)(?:\s+(?:this|that|it))?\s+(?:to|in|into)\s+(?:(?:my|the|this)\s+)?(?:notebook|book|notes?|pages?)\s*[.!]?\s*$`,
  'iu',
);

const DOMINANT_ATTACHED_IMAGE_REQUEST = new RegExp(
  String.raw`\b(?:full[- ]page|whole[- ]page|entire[- ]page|fill\s+(?:the\s+)?(?:whole\s+)?page|take\s+up\s+(?:the\s+)?(?:whole\s+)?(?:page|space)(?:\s+(?:fully|entirely))?|as\s+large\s+as\s+(?:possible|it\s+can\s+be)|large\s+on\s+(?:its|the)\s+own\s+page)\b`,
  'iu',
);

const ATTACHED_IMAGE_CARRIES_DETAILS = new RegExp(
  String.raw`\b(?:image|picture|photo|infographic|diagram)\b[\s\S]{0,56}\b(?:has|contains|includes|shows|carries|covers|holds)\b[\s\S]{0,40}\b(?:details?|information|info|content|facts?)\b|\b(?:most|all|nearly\s+all)\b[\s\S]{0,32}\b(?:details?|information|info|content|facts?)\b[\s\S]{0,32}\b(?:in|on|inside)\b[\s\S]{0,12}\b(?:image|picture|photo|infographic|diagram)\b`,
  'iu',
);

const CONCISE_ATTACHED_IMAGE_WRITEUP = new RegExp(
  String.raw`\b(?:brief|short|concise|minimal|small|little|tiny)\b[\s\S]{0,24}\b(?:write[- ]?up|writing|notes?|info(?:rmation)?|text|explanation|summary|pages?)\b|\b(?:a\s+little|a\s+bit|only\s+a\s+(?:little|bit)|just\s+a\s+(?:little|bit)|a\s+few|one|single|just\s+one|1)\b[\s\S]{0,32}\b(?:page|pages?|write[- ]?up|writing|notes?|info(?:rmation)?|text|explanation|summary)\b|\b(?:not\s+too\s+much|not\s+much|nothing\s+long|keep\s+it\s+(?:brief|short|concise))\b`,
  'iu',
);

const ANOTHER_PAGE_WRITE_UP = new RegExp(
  String.raw`\b(?:another|extra|additional|plus\s+one|one\s+more)\b[\s\S]{0,20}\b(?:page|pages|note|notes|write[- ]?up|writing|text|information|info|summary|explanation)\b`,
  'iu',
);

const EXPANDED_ATTACHED_IMAGE_WRITEUP = new RegExp(
  String.raw`\b(?:detailed|in[- ]depth|comprehensive|thorough|exhaustive|long[- ]form|full\s+study\s+guide|study\s+guide|transcrib(?:e|ing)|extract\s+(?:all|every)|all\s+visible\s+text|many\s+pages|multiple\s+pages)\b`,
  'iu',
);

export function latestReaderText(state: AgentState): string {
  return [...state.conversation]
    .reverse()
    .find((message) => message.role === 'user')?.text ?? state.taskBrief.goal;
}

export function readerUsesImplicitAttachmentDefault(state: AgentState): boolean {
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  return VAGUE_NOTEBOOK_COMMAND_WITH_IMPLICIT_ATTACHMENT.test(text);
}

export function readerRequestsDominantAttachedImage(state: AgentState): boolean {
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  return DOMINANT_ATTACHED_IMAGE_REQUEST.test(text);
}

/**
 * One supplied information-dense image plus explicitly small supporting prose
 * is a bounded two-page editorial request, not permission to expand the
 * surrounding notebook into a chapter. Detailed/transcription wording wins
 * over this convenience rule.
 */
export function readerRequestsConciseAttachedImage(state: AgentState): boolean {
  const conciseImageSourceUnits = imageUnitCandidates(state);

  // Notebook page/selection context may travel beside the attachment for
  // placement and continuity. It does not turn one attached picture into a
  // multi-image authoring request.
  if (conciseImageSourceUnits.size !== 1) return false;
  const currentText = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  if (EXPANDED_ATTACHED_IMAGE_WRITEUP.test(currentText)) return false;
  const inheritedBrief = state.objective?.reason === 'reader_preview_feedback'
    ? state.taskBrief.goal
    : '';
  const text = [inheritedBrief, currentText].filter(Boolean).join('\n');
  const concisePrompt = ATTACHED_IMAGE_CARRIES_DETAILS.test(text) ||
    CONCISE_ATTACHED_IMAGE_WRITEUP.test(text) ||
    ANOTHER_PAGE_WRITE_UP.test(text);
  const inheritedMutation = mutationIntent(inheritedBrief) === 'request';
  return (agentRequestsNotebookMutation(state) ||
    mutationIntent(currentText) === 'request' ||
    inheritedMutation) && concisePrompt;
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

export type AgentIntentHint = 'notebook_change' | 'conversation' | 'undecided';

/** Advisory only: the model may explicitly override it with set_task_mode. */
export function readerIntentHint(state: AgentState): AgentIntentHint {
  const messages = currentReaderMessages(state);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messages[index]!;
    const intent = mutationIntent(text);
    if (intent === 'request') return 'notebook_change';
    if (intent === 'revoke' || CONVERSATION_REQUEST.test(text)) return 'conversation';
  }
  if (state.budgetWindow?.readerMessageId === undefined) {
    const initial = mutationIntent(state.taskBrief.goal);
    if (initial === 'request') return 'notebook_change';
    if (initial === 'revoke' || CONVERSATION_REQUEST.test(state.taskBrief.goal)) {
      return 'conversation';
    }
  }
  return 'undecided';
}

export function currentAgentObjectiveMode(state: AgentState): AgentObjectiveMode {
  const turnId = state.budgetWindow?.readerMessageId;
  if (
    state.objective !== undefined &&
    (turnId === undefined || state.objective.turnId === turnId)
  ) {
    if (state.objective.mode !== 'undecided') return state.objective.mode;
    if (
      state.notebookSnapshot !== undefined || state.draft !== undefined ||
      state.validation !== undefined || state.previewGeneration !== undefined ||
      state.patchProposal !== undefined
    ) return 'notebook_change';
    return 'undecided';
  }
  if (state.objective !== undefined) return 'undecided';
  // Legacy checkpoints with material authoring state are already committed to
  // notebook work even though they predate the objective receipt.
  if (
    state.draft !== undefined || state.validation !== undefined ||
    state.previewGeneration !== undefined || state.patchProposal !== undefined
  ) return 'notebook_change';
  return 'undecided';
}

/** Hard policies consult settled model intent, with the hint only as bootstrap. */
export function agentRequestsNotebookMutation(state: AgentState): boolean {
  const mode = currentAgentObjectiveMode(state);
  if (mode === 'notebook_change') return true;
  if (mode === 'conversation') return false;
  return readerIntentHint(state) === 'notebook_change';
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
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  const textNamesSource =
    EXPLICIT_SOURCE_REFERENCE.test(text) ||
    SOURCE_OPERATION_WITH_IMPLICIT_OBJECT.test(text) ||
    COMPLETE_SOURCE_REQUEST.test(text);
  const currentTurnId = state.budgetWindow?.readerMessageId ?? state.objective?.turnId;
  const legacyManifestCreatedDuringTurn =
    state.sourceIntentTurnId === undefined &&
    state.budgetWindow !== undefined &&
    state.sourceManifest !== undefined &&
    state.sourceManifest.createdAt > state.budgetWindow.startedAt;
  // A newly attached image/file is itself an explicit object for this turn.
  // Requiring the reader to also type “the picture” made “add to my book” ask
  // what to add even though the attachment tray already answered that.
  if (
    (state.sourceIntentTurnId === currentTurnId || legacyManifestCreatedDuringTurn) &&
    (agentRequestsNotebookMutation(state) || textNamesSource)
  ) return true;
  // A visible attachment is the only plausible object of “add to my book”.
  // This bounded fallback works across a greeting/staging turn, but does not
  // revive an old file for a specific later request such as “add osmosis”.
  if (
    agentRequestsNotebookMutation(state) &&
    readerUsesImplicitAttachmentDefault(state)
  ) return true;
  // Preserve All is a reader-owned UI contract, not wording the model may
  // ignore. Scope it to notebook work so a later unrelated chat question does
  // not revive an old attachment index merely because the task retains its
  // audit receipt.
  if (
    state.taskBrief.preserveAllSourceInformation &&
    agentRequestsNotebookMutation(state)
  ) return true;
  if (textNamesSource) return true;
  const priorGroundedAnswer = state.conversation.some(
    (message) => message.role === 'assistant' && (message.citations?.length ?? 0) > 0,
  );
  return priorGroundedAnswer && (
    GROUNDED_FOLLOW_UP.test(text) ||
    (agentRequestsNotebookMutation(state) && /\b(?:this|that|it|these|those|above)\b/iu.test(text))
  );
}

export function readerRequiresCompleteSourceCoverage(state: AgentState): boolean {
  if (!readerRequiresSourceEvidence(state)) return false;
  if (state.taskBrief.preserveAllSourceInformation) return true;
  const text = currentReaderMessages(state).join('\n').trim() || latestReaderText(state);
  return COMPLETE_SOURCE_REQUEST.test(text);
}
