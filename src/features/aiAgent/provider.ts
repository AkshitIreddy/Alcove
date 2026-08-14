import type {
  AgentImageRef,
  AgentJsonValue,
  AgentModelToolCall,
  AgentModelTurn,
  NotebookDraft,
  SourceManifest,
  SourceAnchor,
} from './types';

/** Provider-facing JSON Schema. Tool arguments are still parsed locally. */
export interface AgentToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, AgentJsonValue>>;
  readonly effect: 'read' | 'draft' | 'interrupt' | 'propose';
}

export type ProviderContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_ref';
      readonly image: AgentImageRef;
      readonly purpose: 'source_analysis' | 'draft_visual_review';
      readonly pageId?: string;
      readonly pageNumber?: number;
    }
  | {
      readonly type: 'source_excerpt';
      readonly text: string;
      readonly anchor: SourceAnchor;
      readonly digest: string;
    };

export interface ProviderMessage {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: readonly ProviderContentPart[];
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly toolPlan?: string;
  /** Required on assistant turns so the following tool result has continuity. */
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: AgentJsonValue;
  }[];
}

export interface AgentProviderCapabilities {
  readonly providerId: string;
  readonly modelId: string;
  readonly toolUse: boolean;
  readonly streaming: boolean;
  readonly imageInput: boolean;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsParallelToolCalls: boolean;
}

export interface AgentProviderTurnRequest {
  readonly requestId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly systemPrompt: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools: readonly AgentToolDescriptor[];
  readonly toolChoice: 'auto' | 'required';
  readonly maxOutputTokens?: number;
}

/**
 * The provider boundary intentionally has no reasoning/thinking event. Only
 * user-facing prose, complete typed tool calls, citations and accounting cross
 * the IPC seam.
 */
export type AgentProviderStreamEvent =
  | { readonly type: 'public_text_delta'; readonly text: string }
  | { readonly type: 'tool_plan_delta'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly arguments: AgentJsonValue;
    }
  | {
      readonly type: 'citation';
      readonly sourceId: string;
      readonly unitId: string;
    }
  | {
      readonly type: 'usage';
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | { readonly type: 'finish'; readonly reason: 'stop' | 'tool_calls' | 'length' };

export interface AgentProviderContext {
  readonly signal: AbortSignal;
}

/**
 * Provider-neutral IPC contract. Implementations call a narrow Rust gateway;
 * they never receive, read or return a credential.
 */
export interface AgentProvider {
  readonly id: string;
  capabilities(signal?: AbortSignal): Promise<AgentProviderCapabilities>;
  streamTurn(
    request: AgentProviderTurnRequest,
    context: AgentProviderContext,
  ): AsyncIterable<AgentProviderStreamEvent>;
}

/**
 * Argument-free workflow transitions whose authority is already determined by
 * Alcove's phase gate. A provider normally emits the matching strict call, but
 * an empty turn cannot make validation/render/proposal progress ambiguous when
 * this is the only advertised capability.
 */
const DETERMINISTIC_ROUTING_TOOLS = new Set([
  'validate_notebook_script',
  'render_draft_preview',
  'propose_notebook_patch',
  'submit_notebook_patch',
]);

export function deterministicRoutingToolName(
  request: Pick<AgentProviderTurnRequest, 'tools'>,
): string | undefined {
  if (request.tools.length !== 1) return undefined;
  const name = request.tools[0]!.name;
  return DETERMINISTIC_ROUTING_TOOLS.has(name) ? name : undefined;
}

export class AgentProviderError extends Error {
  readonly status?: number;
  /** Explicit gateway retry authority; omitted for locally constructed errors. */
  readonly retryable?: boolean;
  readonly code:
    | 'auth'
    | 'rate_limit'
    | 'timeout'
    | 'unavailable'
    | 'invalid_response'
    | 'cancelled';
  readonly retryAfterMs?: number;

  constructor(input: {
    readonly code: AgentProviderError['code'];
    readonly message: string;
    readonly status?: number;
    readonly retryable?: boolean;
    readonly retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = 'AgentProviderError';
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export interface CollectedProviderTurn {
  readonly publicText: string;
  readonly toolPlan: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: AgentJsonValue;
  }[];
  readonly citations: readonly { readonly sourceId: string; readonly unitId: string }[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly finishReason: 'stop' | 'tool_calls' | 'length';
}

export async function collectProviderTurn(
  stream: AsyncIterable<AgentProviderStreamEvent>,
  onPublicTextDelta?: (text: string) => void,
): Promise<CollectedProviderTurn> {
  let publicText = '';
  let toolPlan = '';
  const toolCalls: Array<CollectedProviderTurn['toolCalls'][number]> = [];
  const citations: Array<CollectedProviderTurn['citations'][number]> = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: CollectedProviderTurn['finishReason'] = 'stop';
  for await (const event of stream) {
    switch (event.type) {
      case 'public_text_delta':
        publicText += event.text;
        onPublicTextDelta?.(event.text);
        break;
      case 'tool_plan_delta':
        toolPlan += event.text;
        break;
      case 'tool_call':
        toolCalls.push({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        });
        break;
      case 'citation':
        citations.push({ sourceId: event.sourceId, unitId: event.unitId });
        break;
      case 'usage':
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        break;
      case 'finish':
        finishReason = event.reason;
        break;
    }
  }
  return {
    publicText,
    toolPlan,
    toolCalls,
    citations,
    inputTokens,
    outputTokens,
    finishReason,
  };
}

export function modelHistoryToProviderMessages(
  history: readonly AgentModelTurn[],
): ProviderMessage[] {
  return history.map((turn): ProviderMessage => {
    if (turn.role === 'tool') {
      return {
        role: 'tool',
        toolCallId: turn.toolCallId,
        toolName: turn.toolName,
        isError: turn.isError,
        content: [
          { type: 'text', text: JSON.stringify(turn.content) },
          ...(turn.imageRefs ?? []).map(
            (image): ProviderContentPart => ({
              type: 'image_ref',
              image,
              purpose: turn.imagePurpose ?? 'draft_visual_review',
            }),
          ),
        ],
      };
    }
    if (turn.role === 'assistant') {
      return {
        role: 'assistant',
        content: [{ type: 'text', text: turn.content }],
        toolPlan: turn.toolPlan,
        toolCalls: turn.toolCalls,
      };
    }
    return {
      role: 'user',
      content: [{ type: 'text', text: turn.content }],
    };
  });
}

export interface ProviderHistoryProjection {
  readonly messages: readonly ProviderMessage[];
  readonly compactedSubmitCalls: number;
  readonly compactedToolResults: number;
  readonly redactedCanonicalSourceResults: number;
  /** JSON character count before provider-only history compaction. */
  readonly originalCharacters: number;
  /** JSON character count after provider-only history compaction. */
  readonly projectedCharacters: number;
}

const SOURCE_HISTORY_TOOLS = new Set([
  'list_source_manifest',
  'plan_source_retrieval',
  'read_source_range',
  'read_full_source',
  'search_source_index',
  'rerank_source_hits',
  'inspect_source_coverage',
]);

type CurrentDraftAuthority = Pick<
  NotebookDraft,
  'script' | 'draftHash' | 'version'
>;

const HISTORICAL_DRAFT_RESULT_TOOLS = new Set([
  'validate_notebook_script',
  'render_draft_preview',
  'get_draft_preview_manifest',
  'read_draft_preview_pages',
  'record_visual_review',
  'prepare_image_generation_prompts',
  'propose_notebook_patch',
  'submit_notebook_patch',
]);

function recordValue(value: AgentJsonValue): Readonly<Record<string, AgentJsonValue>> | undefined {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Readonly<Record<string, AgentJsonValue>>
    : undefined;
}

function textPart(message: ProviderMessage): string {
  return message.content
    .filter((part): part is Extract<ProviderContentPart, { type: 'text' }> =>
      part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function parsedToolResult(message: ProviderMessage | undefined): AgentJsonValue | undefined {
  if (message?.role !== 'tool') return undefined;
  try {
    return JSON.parse(textPart(message)) as AgentJsonValue;
  } catch {
    return undefined;
  }
}

/**
 * A small deterministic identity for a provider-history receipt. This is not
 * used as a security digest or as notebook authority; the real durable draft
 * hash remains alongside the one retained complete script.
 */
function historyReceiptDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stringField(
  value: Readonly<Record<string, AgentJsonValue>> | undefined,
  key: string,
): string | undefined {
  const found = value?.[key];
  return typeof found === 'string' ? found : undefined;
}

function submitHistoryArguments(
  argumentsValue: AgentJsonValue,
  result: ProviderMessage | undefined,
  currentDraftHash: string,
): AgentJsonValue {
  const args = recordValue(argumentsValue);
  const script = stringField(args, 'script') ?? '';
  const resultValue = recordValue(parsedToolResult(result) ?? null);
  const draftHash = stringField(resultValue, 'draftHash') ?? historyReceiptDigest(script);
  const citedUnitIds = Array.isArray(args?.citedUnitIds)
    ? args.citedUnitIds.filter((id): id is string => typeof id === 'string')
    : [];
  const reason = stringField(args, 'reason') ?? 'repair';
  const relationship = draftHash === currentDraftHash ? 'unchanged duplicate' : 'superseded';
  return {
    // Keep the historical call schema-shaped for providers that validate
    // earlier calls, but never replay its complete Notebook Script payload.
    script:
      `<!-- Alcove compacted ${relationship} draft receipt: ` +
      `${draftHash}; ${script.length} characters. ` +
      'The complete authoritative current script appears in one later submit_notebook_script call. -->',
    citedUnitIds,
    reason,
  };
}

function retainedDraftArguments(
  argumentsValue: AgentJsonValue,
  currentDraft: CurrentDraftAuthority,
): AgentJsonValue {
  const args = recordValue(argumentsValue);
  return {
    ...(args ?? {}),
    // The durable local draft wins over a presentation fence or any other
    // provider spelling of the successful submission. This makes the one
    // retained payload byte-for-byte authoritative for the next turn.
    script: currentDraft.script,
  };
}

const SUMMARY_SCALAR_KEYS = [
  'error',
  'draftHash',
  'draftVersion',
  'generationId',
  'pageCount',
  'valid',
  'parserValid',
  'layoutValid',
  'stale',
  'complete',
  'passed',
  'mutationPerformed',
  'unchanged',
] as const;

function compactToolResult(
  message: ProviderMessage,
  toolName: string,
): ProviderMessage {
  const originalText = textPart(message);
  const parsed = recordValue(parsedToolResult(message) ?? null);
  const summary: Record<string, AgentJsonValue> = {
    historyCompacted: true,
    toolName,
    originalCharacters: originalText.length,
    receiptDigest: historyReceiptDigest(originalText),
  };
  for (const key of SUMMARY_SCALAR_KEYS) {
    const value = parsed?.[key];
    if (
      typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean' || value === null
    ) {
      summary[key] = typeof value === 'string' && value.length > 320
        ? `${value.slice(0, 317)}...`
        : value;
    }
  }
  const diagnostics = parsed?.diagnostics;
  if (Array.isArray(diagnostics)) summary.diagnosticCount = diagnostics.length;
  const pages = parsed?.pages;
  if (Array.isArray(pages)) summary.pageCount = pages.length;
  return {
    ...message,
    // Image references deliberately remain on the message. CohereProvider's
    // immediate-next-turn rule transports pixels only for the trailing tool
    // group, and that group is never an obsolete pre-current-draft result.
    content: [
      { type: 'text', text: JSON.stringify(summary) },
      ...message.content.filter((part) => part.type === 'image_ref'),
    ],
  };
}

function containsCanonicalAuthority(
  value: AgentJsonValue,
  identifiers: ReadonlySet<string>,
): boolean {
  if (typeof value === 'string') return identifiers.has(value);
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsCanonicalAuthority(item, identifiers));
  }
  const record = value as Readonly<Record<string, AgentJsonValue>>;
  if (record.kind === 'notebook_script_spec') return true;
  return Object.values(record).some((item) =>
    containsCanonicalAuthority(item, identifiers));
}

function redactLegacyCanonicalSourceResults(
  messages: readonly ProviderMessage[],
  sourceManifest?: SourceManifest,
): { readonly messages: readonly ProviderMessage[]; readonly count: number } {
  const callById = new Map<string, AgentModelToolCall>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) callById.set(call.id, call);
  }
  const canonicalSources = sourceManifest?.sources.filter(
    (source) => source.kind === 'notebook_script_spec',
  ) ?? [];
  const identifiers = new Set(canonicalSources.flatMap((source) => [
    source.id,
    ...source.units.map((unit) => unit.id),
  ]));
  const collectHistoricalIdentifiers = (value: AgentJsonValue): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(collectHistoricalIdentifiers);
      return;
    }
    const record = value as Readonly<Record<string, AgentJsonValue>>;
    if (record.kind === 'notebook_script_spec') {
      if (typeof record.id === 'string') identifiers.add(record.id);
      if (Array.isArray(record.units)) {
        for (const unit of record.units) {
          if (
            unit !== null && !Array.isArray(unit) && typeof unit === 'object' &&
            typeof (unit as Readonly<Record<string, AgentJsonValue>>).id === 'string'
          ) {
            identifiers.add(
              (unit as Readonly<Record<string, AgentJsonValue>>).id as string,
            );
          }
        }
      }
    }
    Object.values(record).forEach(collectHistoricalIdentifiers);
  };
  for (const message of messages) {
    if (message.role !== 'tool' || message.toolCallId === undefined) continue;
    const call = callById.get(message.toolCallId);
    if ((call?.name ?? message.toolName) !== 'list_source_manifest') continue;
    const result = parsedToolResult(message);
    if (result !== undefined) collectHistoricalIdentifiers(result);
  }
  if (identifiers.size === 0) return { messages, count: 0 };
  let count = 0;
  return {
    messages: messages.map((message): ProviderMessage => {
      if (message.role !== 'tool' || message.toolCallId === undefined) return message;
      const call = callById.get(message.toolCallId);
      const toolName = call?.name ?? message.toolName;
      if (toolName === undefined || !SOURCE_HISTORY_TOOLS.has(toolName)) return message;
      const result = parsedToolResult(message);
      const contaminated =
        (call !== undefined && containsCanonicalAuthority(call.arguments, identifiers)) ||
        (result !== undefined && containsCanonicalAuthority(result, identifiers));
      if (!contaminated) return message;
      count += 1;
      const originalText = textPart(message);
      return {
        ...message,
        content: [{
          type: 'text',
          text: JSON.stringify({
            historyCompacted: true,
            toolName,
            localAuthoringAuthorityOmitted: true,
            originalCharacters: originalText.length,
            receiptDigest: historyReceiptDigest(originalText),
          }),
        }],
      };
    }),
    count,
  };
}

/**
 * Build the ephemeral provider projection of durable model history.
 *
 * Checkpoints retain the complete forensic transcript. Transport does not:
 * every successful repair used to resend every earlier full Notebook Script,
 * so a five-repair task could pay for the same pages dozens of times. This
 * projection keeps all reader/assistant conversation, every source/notebook
 * read result, every tool id/name pair, and exactly one complete authoritative
 * current script. Older draft payloads become small paired receipts.
 */
export function modelHistoryToProviderProjection(
  history: readonly AgentModelTurn[],
  currentDraft?: CurrentDraftAuthority,
  sourceManifest?: SourceManifest,
): ProviderHistoryProjection {
  const original = modelHistoryToProviderMessages(history);
  const originalCharacters = JSON.stringify(original).length;
  // Old checkpoints may contain provider-visible reads of the former
  // Notebook Script specification source. Redact those paired results before
  // any fail-open draft decision: local authoring authority is never reader
  // evidence and must not re-enter Cohere through historical continuity.
  const canonicalRedaction = redactLegacyCanonicalSourceResults(
    original,
    sourceManifest,
  );
  const providerBase = canonicalRedaction.messages;
  if (currentDraft === undefined) {
    return {
      messages: providerBase,
      compactedSubmitCalls: 0,
      compactedToolResults: 0,
      redactedCanonicalSourceResults: canonicalRedaction.count,
      originalCharacters,
      projectedCharacters: JSON.stringify(providerBase).length,
    };
  }

  const resultByCallId = new Map<string, ProviderMessage>();
  for (const message of providerBase) {
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      resultByCallId.set(message.toolCallId, message);
    }
  }
  const submitCalls: Array<{
    readonly callId: string;
    readonly messageIndex: number;
    readonly callIndex: number;
    readonly resultHash?: string;
  }> = [];
  for (const [messageIndex, message] of providerBase.entries()) {
    if (message.role !== 'assistant') continue;
    for (const [callIndex, call] of (message.toolCalls ?? []).entries()) {
      if (call.name !== 'submit_notebook_script') continue;
      const result = recordValue(parsedToolResult(resultByCallId.get(call.id)) ?? null);
      submitCalls.push({
        callId: call.id,
        messageIndex,
        callIndex,
        resultHash: stringField(result, 'draftHash'),
      });
    }
  }

  // A durable current draft normally has a successful submit receipt. If an
  // imported/corrupt checkpoint does not, fail open to the complete transcript
  // rather than compacting away the only possible authority.
  const authority = [...submitCalls]
    .reverse()
    .find((candidate) => candidate.resultHash === currentDraft.draftHash);
  if (authority === undefined) {
    return {
      messages: providerBase,
      compactedSubmitCalls: 0,
      compactedToolResults: 0,
      redactedCanonicalSourceResults: canonicalRedaction.count,
      originalCharacters,
      projectedCharacters: JSON.stringify(providerBase).length,
    };
  }

  const callNameById = new Map<string, string>();
  for (const message of providerBase) {
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) callNameById.set(call.id, call.name);
  }

  let compactedSubmitCalls = 0;
  let compactedToolResults = 0;
  const messages = providerBase.map((message, messageIndex): ProviderMessage => {
    if (message.role === 'assistant' && message.toolCalls !== undefined) {
      return {
        ...message,
        toolCalls: message.toolCalls.map((call, callIndex) => {
          if (call.name !== 'submit_notebook_script') return call;
          if (
            messageIndex === authority.messageIndex &&
            callIndex === authority.callIndex
          ) {
            return {
              ...call,
              arguments: retainedDraftArguments(call.arguments, currentDraft),
            };
          }
          compactedSubmitCalls += 1;
          return {
            ...call,
            arguments: submitHistoryArguments(
              call.arguments,
              resultByCallId.get(call.id),
              currentDraft.draftHash,
            ),
          };
        }),
      };
    }
    if (message.role !== 'tool' || message.toolCallId === undefined) return message;
    const toolName = callNameById.get(message.toolCallId) ?? message.toolName;
    if (toolName === undefined) return message;
    if (message.toolCallId === authority.callId) return message;
    if (toolName === 'submit_notebook_script') {
      compactedToolResults += 1;
      return compactToolResult(message, toolName);
    }
    if (
      messageIndex < authority.messageIndex &&
      HISTORICAL_DRAFT_RESULT_TOOLS.has(toolName)
    ) {
      compactedToolResults += 1;
      return compactToolResult(message, toolName);
    }
    return message;
  });
  return {
    messages,
    compactedSubmitCalls,
    compactedToolResults,
    redactedCanonicalSourceResults: canonicalRedaction.count,
    originalCharacters,
    projectedCharacters: JSON.stringify(messages).length,
  };
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof AgentProviderError)) return false;
  if (error.retryable !== undefined) return error.retryable;
  if (error.code === 'timeout' || error.code === 'rate_limit') return true;
  return error.code === 'unavailable' || error.status === 408 ||
    error.status === 429 || (error.status !== undefined && error.status >= 500);
}
