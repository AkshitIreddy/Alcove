/** Typed WebView boundary for Cohere and managed AI attachments. */
import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri } from './db';
import { browserDevAiCredential } from './aiCredentials';

export interface AiGatewayError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly status?: number;
}

export type AiGatewayStreamEvent =
  | {
      readonly type: 'providerEvent';
      readonly runId: string;
      readonly sequence: number;
      readonly eventType:
        | 'message-start'
        | 'content-start'
        | 'content-delta'
        | 'content-end'
        | 'tool-plan-delta'
        | 'tool-call-start'
        | 'tool-call-delta'
        | 'tool-call-end'
        | 'citation-start'
        | 'citation-end'
        | 'message-end'
        | 'debug';
      readonly data: Record<string, unknown>;
    }
  | { readonly type: 'completed'; readonly runId: string }
  | { readonly type: 'cancelled'; readonly runId: string }
  | { readonly type: 'error'; readonly runId: string; readonly error: AiGatewayError };

export interface AiGatewayToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

export type AiGatewayMessage =
  | { readonly role: 'system'; readonly content: string }
  | {
      readonly role: 'user';
      readonly content:
        | string
        | readonly (
            | { readonly type: 'text'; readonly text: string }
            | {
                readonly type: 'image_url';
                readonly imageUrl: {
                  readonly url: string;
                  readonly detail?: 'low' | 'high' | 'auto';
                };
              }
          )[];
    }
  | {
      readonly role: 'assistant';
      readonly content?: string;
      readonly toolPlan?: string;
      readonly toolCalls?: readonly AiGatewayToolCall[];
    }
  | {
      readonly role: 'tool';
      readonly toolCallId: string;
      readonly content: string;
    };

export interface AiGatewayChatRequest {
  readonly runId: string;
  readonly model: 'command-a-plus-05-2026';
  readonly messages: readonly AiGatewayMessage[];
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly seed?: number;
  readonly toolChoice?: 'REQUIRED' | 'NONE';
  readonly thinking?: {
    readonly type: 'enabled' | 'disabled';
    readonly tokenBudget?: number;
  };
  readonly strictTools?: boolean;
  readonly citationMode?: 'enabled' | 'disabled' | 'fast' | 'accurate';
  readonly safetyMode?: 'CONTEXTUAL' | 'STRICT';
}

export async function streamAiGatewayChat(
  request: AiGatewayChatRequest,
  onEvent: (event: AiGatewayStreamEvent) => void,
): Promise<void> {
  if (import.meta.env.DEV && !isTauri()) {
    await streamBrowserDevChat(request, onEvent);
    return;
  }
  const channel = new Channel<AiGatewayStreamEvent>();
  channel.onmessage = onEvent;
  await invoke<void>('ai_chat_stream', { request, onEvent: channel });
}

export async function cancelAiGatewayRun(runId: string): Promise<boolean> {
  if (import.meta.env.DEV && !isTauri()) {
    const controller = browserDevRuns.get(runId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }
  const result = await invoke<{ runId: string; cancelled: boolean }>('ai_cancel_run', {
    runId,
  });
  return result.cancelled;
}

const browserDevRuns = new Map<string, AbortController>();

const COHERE_PROVIDER_EVENT_TYPES = new Set<
  Extract<AiGatewayStreamEvent, { type: 'providerEvent' }>['eventType']
>([
  'message-start', 'content-start', 'content-delta', 'content-end',
  'tool-plan-delta', 'tool-call-start', 'tool-call-delta', 'tool-call-end',
  'citation-start', 'citation-end', 'message-end', 'debug',
]);
const COHERE_AUXILIARY_EVENT_TYPES = new Set(['ping', 'heartbeat', 'keepalive']);

function safeProviderEventLabel(value: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : 'unlabelled';
}

/**
 * Known semantic frames remain exact and fail closed on header/payload drift.
 * A bounded unknown frame is ignored only when its own payload identifies the
 * same extension type (or when it is a conventional heartbeat), so it cannot
 * masquerade as content, a tool call, usage, or message completion.
 */
function cohereProviderEventType(
  eventName: string,
  data: Record<string, unknown>,
): Extract<AiGatewayStreamEvent, { type: 'providerEvent' }>['eventType'] | null {
  const payloadType = typeof data.type === 'string' ? data.type : undefined;
  if (eventName !== '' && payloadType !== undefined && payloadType !== eventName) {
    throw new Error('Cohere stream event type did not match its payload');
  }
  const effectiveType = eventName || payloadType || '';
  if (COHERE_PROVIDER_EVENT_TYPES.has(
    effectiveType as Extract<AiGatewayStreamEvent, { type: 'providerEvent' }>['eventType'],
  )) {
    if (payloadType !== effectiveType) {
      throw new Error('Cohere stream event type did not match its payload');
    }
    return effectiveType as Extract<AiGatewayStreamEvent, { type: 'providerEvent' }>['eventType'];
  }
  if (
    COHERE_AUXILIARY_EVENT_TYPES.has(effectiveType) &&
    (payloadType === undefined || payloadType === effectiveType)
  ) return null;
  if (
    effectiveType !== '' && payloadType === effectiveType &&
    /^[A-Za-z0-9_-]{1,64}$/.test(effectiveType)
  ) return null;
  throw new Error(
    `Cohere sent an unsupported stream event (${safeProviderEventLabel(effectiveType)})`,
  );
}

function browserDevKey(): string {
  const key = browserDevAiCredential();
  if (key === null) throw new Error('Connect a Cohere key for this localhost session');
  return key;
}

function gatewayError(status: number, message: string): AiGatewayError {
  return {
    code: status === 401 || status === 498 ? 'authentication'
      : status === 403 ? 'permissionDenied'
        : status === 429 ? 'rateLimited'
          : status >= 500 ? 'providerUnavailable'
            : 'invalidRequest',
    message,
    retryable: status === 429 || status >= 500,
    status,
  };
}

function compactDefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  );
}

function providerChatBody(request: AiGatewayChatRequest): Record<string, unknown> {
  return {
    stream: true,
    model: request.model,
    messages: request.messages.map((message) => {
      if (message.role === 'user') {
        return {
          role: 'user',
          content: typeof message.content === 'string'
            ? message.content
            : message.content.map((block) => block.type === 'text'
              ? block
              : {
                  type: 'image_url',
                  image_url: block.imageUrl,
                }),
        };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: message.content,
        };
      }
      if (message.role !== 'assistant') return message;
      const { toolPlan, toolCalls, ...rest } = message;
      return {
        ...rest,
        ...(toolPlan === undefined ? {} : { tool_plan: toolPlan }),
        ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
      };
    }),
    ...(request.tools.length === 0 ? {} : {
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.parameters,
        },
      })),
    }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(request.thinking === undefined ? {} : {
      thinking: {
        type: request.thinking.type,
        ...(request.thinking.tokenBudget === undefined
          ? {}
          : { token_budget: request.thinking.tokenBudget }),
      },
    }),
    ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
    ...(request.strictTools === undefined ? {} : { strict_tools: request.strictTools }),
    ...(request.safetyMode === undefined ? {} : { safety_mode: request.safetyMode }),
  };
}

async function streamBrowserDevChat(
  request: AiGatewayChatRequest,
  onEvent: (event: AiGatewayStreamEvent) => void,
): Promise<void> {
  if (browserDevRuns.has(request.runId)) throw new Error('AI run is already active');
  const controller = new AbortController();
  browserDevRuns.set(request.runId, controller);
  let sequence = 0;
  try {
    const response = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${browserDevKey()}`,
        'Content-Type': 'application/json',
        'X-Client-Name': 'Alcove localhost',
      },
      body: JSON.stringify(providerChatBody(request)),
      signal: controller.signal,
    });
    if (!response.ok || response.body === null) {
      let providerDetail = '';
      try {
        const body = await response.text();
        const parsed = JSON.parse(body) as { message?: unknown };
        providerDetail = typeof parsed.message === 'string'
          ? parsed.message.trim().slice(0, 800)
          : body.trim().slice(0, 800);
      } catch {
        // The status remains authoritative when Cohere supplies no JSON body.
      }
      onEvent({
        type: 'error',
        runId: request.runId,
        error: gatewayError(
          response.status,
          `Cohere rejected the request (HTTP ${response.status})${providerDetail ? `: ${providerDetail}` : ''}`,
        ),
      });
      return;
    }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')) {
      onEvent({
        type: 'error',
        runId: request.runId,
        error: { code: 'providerProtocol', message: 'Cohere did not return an event stream', retryable: false },
      });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const emitFrame = (frame: string): void => {
      let eventName = '';
      const data: string[] = [];
      for (const rawLine of frame.split(/\r?\n/)) {
        if (rawLine.startsWith('event:')) eventName = rawLine.slice(6).trim();
        else if (rawLine.startsWith('data:')) data.push(rawLine.slice(5).trimStart());
      }
      if (data.length === 0) return;
      if (eventName === 'error') {
        onEvent({
          type: 'error',
          runId: request.runId,
          error: { code: 'providerUnavailable', message: 'Cohere ended the stream with an error', retryable: true },
        });
        return;
      }
      const payload = data.join('\n').trim();
      // Cohere may append the conventional SSE terminator after its real
      // message-end event. It carries no model content or authority. Ignore
      // only the exact sentinel; completion below still requires message-end.
      if (payload === '[DONE]') return;
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const eventType = cohereProviderEventType(eventName, parsed);
      if (eventType === null) return;
      onEvent({
        type: 'providerEvent',
        runId: request.runId,
        sequence: sequence += 1,
        eventType,
        data: parsed,
      });
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        emitFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + separator.length);
      }
    }
    if (buffer.trim() !== '') emitFrame(buffer);
    onEvent({ type: 'completed', runId: request.runId });
  } catch (error) {
    if (controller.signal.aborted) {
      onEvent({ type: 'cancelled', runId: request.runId });
      return;
    }
    onEvent({
      type: 'error',
      runId: request.runId,
      error: { code: 'network', message: error instanceof Error ? error.message : 'Could not reach Cohere', retryable: true },
    });
  } finally {
    browserDevRuns.delete(request.runId);
  }
}

export interface AiAttachmentMetadata {
  readonly id: string;
  readonly kind: 'pdf' | 'png' | 'jpeg' | 'webp' | 'gif' | 'text' | 'docx' | 'xlsx' | 'pptx';
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface AiAttachmentData {
  readonly metadata: AiAttachmentMetadata;
  readonly bytes: readonly number[];
}

const browserDevAttachments = new Map<string, AiAttachmentData>();
const MAX_BROWSER_DEV_ATTACHMENT_BYTES = 32 * 1024 * 1024;

function browserDevAttachmentKind(bytes: Uint8Array): Pick<AiAttachmentMetadata, 'kind' | 'mimeType'> {
  const matches = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);
  if (matches(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }
  if (matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { kind: 'png', mimeType: 'image/png' };
  }
  if (matches(0xff, 0xd8, 0xff)) return { kind: 'jpeg', mimeType: 'image/jpeg' };
  if (
    matches(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { kind: 'webp', mimeType: 'image/webp' };
  if (
    matches(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
    matches(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
  ) return { kind: 'gif', mimeType: 'image/gif' };
  throw new Error('Localhost source attachments currently support PDF, PNG, JPEG, WebP, or GIF files');
}

async function saveBrowserDevAttachment(
  bytes: Uint8Array,
  namespace: 'attachment' | 'preview',
): Promise<AiAttachmentMetadata> {
  if (bytes.length === 0 || bytes.length > MAX_BROWSER_DEV_ATTACHMENT_BYTES) {
    throw new Error('AI attachments must be between 1 byte and 32 MB');
  }
  const classified = browserDevAttachmentKind(bytes);
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sha256 = [...digestBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const id = `${namespace === 'preview' ? 'preview' : 'att'}_${sha256}`;
  const metadata: AiAttachmentMetadata = {
    id,
    ...classified,
    sizeBytes: bytes.length,
    sha256,
  };
  browserDevAttachments.set(id, {
    metadata,
    bytes: Array.from(bytes),
  });
  return metadata;
}

export function saveAiAttachment(
  bytes: Uint8Array,
  namespace: 'attachment' | 'preview' = 'attachment',
): Promise<AiAttachmentMetadata> {
  if (import.meta.env.DEV && !isTauri()) {
    return saveBrowserDevAttachment(bytes, namespace);
  }
  return invoke<AiAttachmentMetadata>('ai_attachment_save', {
    request: {
      bytes: Array.from(bytes),
      namespace: namespace === 'preview' ? 'preview' : 'att',
    },
  });
}

export async function readAiAttachment(attachmentId: string): Promise<AiAttachmentData> {
  if (import.meta.env.DEV && !isTauri()) {
    const stored = browserDevAttachments.get(attachmentId);
    if (stored === undefined) throw new Error('The localhost AI attachment is no longer available');
    return {
      metadata: { ...stored.metadata },
      bytes: [...stored.bytes],
    };
  }
  return invoke<AiAttachmentData>('ai_attachment_read', { attachmentId });
}

export async function deleteAiAttachment(attachmentId: string): Promise<boolean> {
  if (import.meta.env.DEV && !isTauri()) {
    return browserDevAttachments.delete(attachmentId);
  }
  const result = await invoke<{ id: string; deleted: boolean }>('ai_attachment_delete', {
    attachmentId,
  });
  return result.deleted;
}

export interface AiExtractedPdfPage {
  readonly pageNumber: number;
  readonly text: string;
  readonly textBytes: number;
  readonly truncated: boolean;
  readonly extractionFailed: boolean;
  readonly hasEmbeddedImages: boolean;
  /** Page paints vector/form content that embedded-image extraction cannot expose. */
  readonly hasVectorGraphics?: boolean;
  readonly needsOcr: boolean;
  readonly needsVisualReview: boolean;
  /**
   * Whether Alcove has evidence for the full composed page. Embedded XObjects
   * alone are insufficient; current extraction therefore returns unresolved
   * until a verified full-page raster pipeline exists.
   */
  readonly visualEvidence: 'notNeeded' | 'available' | 'unresolved';
  readonly unresolvedVisualCount: number;
  /** Embedded image evidence, not a claimed rasterization of the whole PDF page. */
  readonly visuals: readonly AiExtractedPdfVisual[];
}

export interface AiExtractedPdfVisual {
  readonly attachmentId: string;
  readonly mimeType: 'image/jpeg';
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export interface AiExtractedPdfSource {
  readonly attachmentId: string;
  readonly sha256: string;
  readonly pageCount: number;
  readonly totalTextBytes: number;
  readonly truncated: boolean;
  readonly pages: readonly AiExtractedPdfPage[];
}

export function extractAiPdfSource(attachmentId: string): Promise<AiExtractedPdfSource> {
  return invoke<AiExtractedPdfSource>('ai_extract_pdf_source', { attachmentId });
}

export interface AiParseImageResponse {
  readonly id: string;
  readonly markdown: string;
  readonly billedPages?: number;
}

function normalizeBrowserParseResponse(value: unknown): AiParseImageResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Cohere returned an invalid Parse response');
  }
  const response = value as {
    id?: unknown;
    pages?: unknown;
    meta?: { billed_units?: { pages?: unknown } };
  };
  if (typeof response.id !== 'string' || response.id.trim() === '' ||
      !Array.isArray(response.pages) || response.pages.length !== 1) {
    throw new Error('Cohere returned an invalid Parse response');
  }
  const page = response.pages[0] as {
    type?: unknown;
    markdown?: { content?: unknown };
  } | undefined;
  const markdown = page?.markdown?.content;
  if (page?.type !== 'markdown' || typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error('Cohere returned an invalid Parse response');
  }
  const billed = response.meta?.billed_units?.pages;
  return {
    id: response.id,
    markdown: markdown.replace(/\r\n?/g, '\n').trim(),
    ...(typeof billed === 'number' && Number.isSafeInteger(billed) && billed >= 0
      ? { billedPages: billed }
      : {}),
  };
}

/** Parse one locally managed page raster without exposing the credential. */
export async function parseAiImage(input: {
  readonly runId: string;
  readonly attachmentId: string;
}, signal?: AbortSignal): Promise<AiParseImageResponse> {
  if (signal?.aborted) throw abortError();
  if (import.meta.env.DEV && !isTauri()) {
    if (browserDevRuns.has(input.runId)) throw new Error('AI run is already active');
    const stored = browserDevAttachments.get(input.attachmentId);
    if (stored === undefined || !['png', 'jpeg', 'webp'].includes(stored.metadata.kind)) {
      throw new Error('Cohere Parse requires a managed PNG, JPEG, or WebP image');
    }
    const controller = new AbortController();
    browserDevRuns.set(input.runId, controller);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch('https://api.cohere.com/v2/parse', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${browserDevKey()}`,
          'Content-Type': 'application/json',
          'X-Client-Name': 'Alcove localhost',
        },
        body: JSON.stringify({
          model: 'parse-v5.0',
          document: {
            type: 'image_url',
            image_url: bytesToDataUri(stored.bytes, stored.metadata.mimeType),
          },
          output_format: 'markdown',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw gatewayError(response.status, `Cohere rejected the request (HTTP ${response.status})`);
      }
      return normalizeBrowserParseResponse(await response.json());
    } finally {
      browserDevRuns.delete(input.runId);
      signal?.removeEventListener('abort', abort);
    }
  }

  const abort = (): void => {
    void cancelAiGatewayRun(input.runId).catch(() => false);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await invoke<AiParseImageResponse>('ai_parse_image', {
      request: input,
    });
    if (signal?.aborted) throw abortError();
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export interface AiExtractedDocumentSource {
  readonly attachmentId: string;
  readonly sha256: string;
  readonly mediaType: string;
  readonly text: string;
  readonly textBytes: number;
  readonly truncated: boolean;
  readonly unitLabels: readonly string[];
  readonly extractionWarnings: readonly string[];
}

export function extractAiDocumentSource(
  attachmentId: string,
): Promise<AiExtractedDocumentSource> {
  return invoke<AiExtractedDocumentSource>('ai_extract_document_source', { attachmentId });
}

export interface AiEmbedResponse {
  readonly id: string;
  readonly embeddings: { readonly float?: readonly (readonly number[])[] };
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

/**
 * Run one non-streaming provider request under the same native cancellation
 * registry as chat. Tauri's `invoke` promise itself is not abortable, so Stop
 * cancels the Rust HTTP future and this wrapper also rejects any response that
 * won a very late race with cancellation.
 */
async function cancellableProviderInvoke<T>(
  command: 'ai_embed' | 'ai_rerank',
  runId: string,
  request: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw abortError();
  if (import.meta.env.DEV && !isTauri()) {
    const controller = new AbortController();
    browserDevRuns.set(runId, controller);
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const endpoint = command === 'ai_embed' ? 'embed' : 'rerank';
      const { runId: _runId, ...body } = request;
      const translated = command === 'ai_embed'
        ? {
            model: body.model,
            inputs: body.inputs,
            input_type: body.inputType,
            embedding_types: body.embeddingTypes,
            output_dimension: body.outputDimension,
            truncate: body.truncate,
          }
        : {
            model: body.model,
            query: body.query,
            documents: body.documents,
            top_n: body.topN,
          };
      const response = await fetch(`https://api.cohere.com/v2/${endpoint}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${browserDevKey()}`,
          'Content-Type': 'application/json',
          'X-Client-Name': 'Alcove localhost',
        },
        body: JSON.stringify(compactDefined(translated)),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw gatewayError(response.status, `Cohere rejected the request (HTTP ${response.status})`);
      }
      return await response.json() as T;
    } finally {
      browserDevRuns.delete(runId);
      signal?.removeEventListener('abort', abort);
    }
  }
  const abort = (): void => {
    void cancelAiGatewayRun(runId).catch(() => false);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await invoke<T>(command, { request });
    if (signal?.aborted) throw abortError();
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export function embedAiTexts(input: {
  readonly runId: string;
  readonly texts: readonly string[];
  readonly inputType: 'search_document' | 'search_query';
}, signal?: AbortSignal): Promise<AiEmbedResponse> {
  return cancellableProviderInvoke<AiEmbedResponse>('ai_embed', input.runId, {
    runId: input.runId,
    model: 'embed-v4.0',
    inputType: input.inputType,
    inputs: input.texts.map((text) => ({ content: [{ type: 'text', text }] })),
    outputDimension: 512,
    embeddingTypes: ['float'],
    truncate: 'END',
  }, signal);
}

export interface AiRerankResponse {
  readonly id?: string;
  readonly results: readonly { readonly index: number; readonly relevanceScore: number }[];
}

export function rerankAiTexts(input: {
  readonly runId: string;
  readonly query: string;
  readonly documents: readonly string[];
  readonly limit: number;
  readonly quality: 'fast' | 'pro';
}, signal?: AbortSignal): Promise<AiRerankResponse> {
  return cancellableProviderInvoke<AiRerankResponse>('ai_rerank', input.runId, {
    runId: input.runId,
    model: input.quality === 'pro' ? 'rerank-v4.0-pro' : 'rerank-v4.0-fast',
    query: input.query,
    documents: input.documents,
    topN: input.limit,
  }, signal);
}

export function bytesToDataUri(bytes: readonly number[], mimeType: string): string {
  const chunk = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
