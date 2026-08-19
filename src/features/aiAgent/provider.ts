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
  /**
   * Ephemeral proof of the visual evidence selected for this exact provider
   * request. This is deliberately not durable task state: a later turn must
   * project its own current evidence instead of inheriting an earlier model's
   * access to pixels by assumption.
   *
   * Provider adapters recompute what their wire format will actually carry
   * and fail before network traffic when the required digests are absent.
   */
  readonly evidence?: ProviderEvidenceReceipt;
}

export type ProviderEvidencePurpose =
  | 'conversation_answer'
  | 'notebook_draft'
  | 'preview_review';

export interface ProviderEvidenceReceipt {
  readonly turnId: string;
  readonly purpose: ProviderEvidencePurpose;
  readonly requiredSourceImageCount: number;
  readonly requiredSourceImageDigests: readonly string[];
  readonly deliveredSourceImageDigests: readonly string[];
  readonly requiredDraftImageDigests: readonly string[];
  readonly deliveredDraftImageDigests: readonly string[];
}

export interface TurnScopedEvidenceProjection {
  readonly messages: readonly ProviderMessage[];
  readonly receipt: ProviderEvidenceReceipt;
}

function sortedUniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ''))].sort();
}

function imageDigests(
  messages: readonly ProviderMessage[],
  purpose: Extract<ProviderContentPart, { type: 'image_ref' }>['purpose'],
): string[] {
  return sortedUniqueStrings(messages.flatMap((message) =>
    message.content.flatMap((part) =>
      part.type === 'image_ref' && part.purpose === purpose
        ? [part.image.digest]
        : [],
    ),
  ));
}

function compactNotebookPlacementReceipt(text: string): string {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return text;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.pages)) return text;
    return JSON.stringify({
      title: record.title ?? null,
      pageCount:
        typeof record.pageCount === 'number' ? record.pageCount : record.pages.length,
      bookRevision: record.bookRevision ?? null,
      capturedAt: record.capturedAt ?? null,
      placementIndexCompacted: true,
      note:
        'The insertion target is already resolved. Historical notebook page titles are not source evidence for this semantic turn.',
    });
  } catch {
    return text;
  }
}

/**
 * Attach current source pixels to the latest reader message in the ephemeral
 * provider projection. The latest user message is the stable semantic turn
 * anchor even when local tool calls (notebook inspection, source coverage,
 * placement) occur after it. Keeping the pixels on that message makes their
 * delivery independent of tool-result ordering without replaying them into
 * durable model history.
 */
export function projectTurnScopedSourceEvidence(input: {
  readonly messages: readonly ProviderMessage[];
  readonly turnId: string;
  readonly purpose: ProviderEvidencePurpose;
  readonly sourceImages: readonly AgentImageRef[];
  readonly requiredSourceImageCount?: number;
  readonly requiredSourceImageDigests?: readonly string[];
  readonly requiredDraftImageDigests?: readonly string[];
}): TurnScopedEvidenceProjection {
  const sourceImages = [...new Map(input.sourceImages.map((image) => [
    `${image.resourceId}:${image.digest}`,
    image,
  ])).values()].sort((left, right) =>
    left.digest.localeCompare(right.digest) ||
    left.resourceId.localeCompare(right.resourceId),
  );
  const latestUserIndex = (() => {
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
      if (input.messages[index]?.role === 'user') return index;
    }
    return -1;
  })();
  const messages = input.messages.map((message, index): ProviderMessage => {
    // The exact source pixels are consolidated onto the current reader turn.
    // Remove their historical tool-result copies so a favourable tool order
    // cannot send the same attachment twice while an intervening tool order
    // sends it zero times. Draft-review pixels stay on their current tool
    // result because Cohere must preserve that call/result continuity.
    if (message.role === 'tool') {
      const withoutSourcePixels = message.content.filter((part) =>
        part.type !== 'image_ref' || part.purpose !== 'source_analysis');
      const content = message.toolName === 'inspect_notebook'
        ? withoutSourcePixels.map((part): ProviderContentPart =>
            part.type === 'text'
              ? { ...part, text: compactNotebookPlacementReceipt(part.text) }
              : part)
        : withoutSourcePixels;
      return content.length === message.content.length &&
          content.every((part, partIndex) => part === message.content[partIndex])
        ? message
        : { ...message, content };
    }
    if (index !== latestUserIndex || sourceImages.length === 0) return message;
    const existingSourceDigests = new Set(message.content.flatMap((part) =>
      part.type === 'image_ref' && part.purpose === 'source_analysis'
        ? [part.image.digest]
        : [],
    ));
    return {
      ...message,
      content: [
        ...message.content,
        ...sourceImages
          .filter((image) => !existingSourceDigests.has(image.digest))
          .map((image): ProviderContentPart => ({
            type: 'image_ref',
            image,
            purpose: 'source_analysis',
          })),
      ],
    };
  });
  const deliveredSourceImageDigests = imageDigests(messages, 'source_analysis');
  const requiredDraftImageDigests = sortedUniqueStrings(
    input.requiredDraftImageDigests ?? [],
  );
  const availableDraftImageDigests = new Set(
    imageDigests(messages, 'draft_visual_review'),
  );
  // A later conversation may retain historical preview refs in its forensic
  // transcript, but those pixels are intentionally not current evidence. Only
  // draft images explicitly required for this review transaction are declared
  // as delivered; the Cohere adapter independently checks their wire position.
  const deliveredDraftImageDigests = requiredDraftImageDigests.filter((digest) =>
    availableDraftImageDigests.has(digest));
  return {
    messages,
    receipt: {
      turnId: input.turnId,
      purpose: input.purpose,
      requiredSourceImageCount:
        input.requiredSourceImageCount ?? sourceImages.length,
      requiredSourceImageDigests: sortedUniqueStrings(
        input.requiredSourceImageDigests ?? sourceImages.map((image) => image.digest),
      ),
      deliveredSourceImageDigests,
      requiredDraftImageDigests,
      deliveredDraftImageDigests,
    },
  };
}

function missingEvidenceDigests(
  required: readonly string[],
  delivered: readonly string[],
): readonly string[] {
  const deliveredSet = new Set(delivered);
  return [...new Set(required)].filter((digest) => !deliveredSet.has(digest));
}

/** Provider-neutral half of the evidence transaction. */
export function assertProviderEvidenceReceipt(
  request: Pick<AgentProviderTurnRequest, 'evidence'>,
): void {
  const receipt = request.evidence;
  if (receipt === undefined) return;
  if (
    !Number.isInteger(receipt.requiredSourceImageCount) ||
    receipt.requiredSourceImageCount < 0 ||
    receipt.deliveredSourceImageDigests.length < receipt.requiredSourceImageCount ||
    missingEvidenceDigests(
      receipt.requiredSourceImageDigests,
      receipt.deliveredSourceImageDigests,
    ).length > 0 ||
    missingEvidenceDigests(
      receipt.requiredDraftImageDigests,
      receipt.deliveredDraftImageDigests,
    ).length > 0
  ) {
    throw new AgentProviderError({
      code: 'invalid_response',
      message:
        'Alcove stopped the AI turn because the current required visual evidence was not attached to its provider request.',
      retryable: false,
    });
  }
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

/**
 * Conversation tools are an execution/audit boundary, not the semantic shape
 * of the next chat turn. Once their result exists, project the validated answer
 * or question as an ordinary assistant message and omit the paired receipt.
 * This lets references such as “add that to my book” resolve against the same
 * visible transcript the reader sees instead of asking the model to recover an
 * answer from a nested historical tool argument.
 *
 * The durable model history is untouched. Only this ephemeral provider view is
 * normalized, and only an exact one-call assistant/result pair is eligible.
 */
function normalizeSettledConversationTools(
  messages: readonly ProviderMessage[],
): readonly ProviderMessage[] {
  const resultByCallId = new Map<string, ProviderMessage>();
  for (const message of messages) {
    if (
      message.role === 'tool' && message.toolCallId !== undefined &&
      message.isError !== true
    ) resultByCallId.set(message.toolCallId, message);
  }
  const normalized = new Map<string, {
    readonly assistantText: string;
    readonly readerReply?: string;
  }>();
  for (const message of messages) {
    if (message.role !== 'assistant' || message.toolCalls?.length !== 1) continue;
    const call = message.toolCalls[0]!;
    const result = resultByCallId.get(call.id);
    if (result === undefined) continue;
    const args = recordValue(call.arguments);
    if (call.name === 'finish_conversation') {
      const answer = stringField(args, 'answer')?.trim();
      if (answer) normalized.set(call.id, { assistantText: answer });
      continue;
    }
    if (call.name === 'ask_user') {
      const question = stringField(args, 'question')?.trim();
      const resultValue = recordValue(parsedToolResult(result) ?? null);
      const readerReply = stringField(resultValue, 'response')?.trim();
      // Do not erase the tool pair until the reader actually answered it.
      if (question && readerReply) {
        normalized.set(call.id, { assistantText: question, readerReply });
      }
    }
  }
  const projected: ProviderMessage[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls?.length === 1) {
      const replacement = normalized.get(message.toolCalls[0]!.id);
      if (replacement !== undefined) {
        projected.push({
          role: 'assistant',
          content: [{ type: 'text', text: replacement.assistantText }],
        });
        continue;
      }
    }
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      const replacement = normalized.get(message.toolCallId);
      if (replacement !== undefined) {
        if (replacement.readerReply !== undefined) {
          projected.push({
            role: 'user',
            content: [{ type: 'text', text: replacement.readerReply }],
          });
        }
        continue;
      }
    }
    projected.push(message);
  }
  return projected;
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
 * projection converts settled conversation tools into ordinary assistant
 * messages, keeps every source/notebook read result and remaining tool id/name
 * pair, and retains exactly one complete authoritative current script. Older
 * draft payloads become small paired receipts.
 */
export function modelHistoryToProviderProjection(
  history: readonly AgentModelTurn[],
  currentDraft?: CurrentDraftAuthority,
  sourceManifest?: SourceManifest,
): ProviderHistoryProjection {
  const original = modelHistoryToProviderMessages(history);
  const originalCharacters = JSON.stringify(original).length;
  const conversationallyNormalized = normalizeSettledConversationTools(original);
  // Old checkpoints may contain provider-visible reads of the former
  // Notebook Script specification source. Redact those paired results before
  // any fail-open draft decision: local authoring authority is never reader
  // evidence and must not re-enter Cohere through historical continuity.
  const canonicalRedaction = redactLegacyCanonicalSourceResults(
    conversationallyNormalized,
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
