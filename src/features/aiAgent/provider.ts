import type {
  AgentImageRef,
  AgentJsonValue,
  AgentModelTurn,
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

export class AgentProviderError extends Error {
  readonly status?: number;
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
    readonly retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = 'AgentProviderError';
    this.code = input.code;
    this.status = input.status;
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

export function isRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof AgentProviderError)) return false;
  if (error.code === 'timeout' || error.code === 'rate_limit') return true;
  return error.code === 'unavailable' || error.status === 408 ||
    error.status === 429 || (error.status !== undefined && error.status >= 500);
}
