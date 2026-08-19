import { describe, expect, it, vi } from 'vitest';
import type { AiGatewayChatRequest } from '../src/data/aiGateway';

const gateway = vi.hoisted(() => ({
  requests: [] as AiGatewayChatRequest[],
  serializedImageBytes: [] as number[][],
  scriptedEvents: [] as unknown[],
}));

vi.mock('../src/data/aiGateway', () => ({
  bytesToDataUri: (bytes: readonly number[], mime: string) => {
    gateway.serializedImageBytes.push([...bytes]);
    return `data:${mime};base64,AQID`;
  },
  cancelAiGatewayRun: vi.fn(async () => true),
  readAiAttachment: vi.fn(async (id: string) => ({
    metadata: {
      id,
      kind: 'png',
      mimeType: 'image/png',
      sizeBytes: 3,
      sha256: id,
    },
    bytes: [1, 2, 3],
  })),
  streamAiGatewayChat: vi.fn(
    async (
      request: AiGatewayChatRequest,
      onEvent: (event: unknown) => void,
    ) => {
      gateway.requests.push(request);
      const scripted = gateway.scriptedEvents.splice(0);
      for (const event of scripted) onEvent(event);
      if (!scripted.some((event) =>
        event !== null &&
        typeof event === 'object' &&
        (event as { eventType?: unknown }).eventType === 'message-end'
      )) {
        onEvent({
          type: 'providerEvent',
          runId: request.runId,
          sequence: 1,
          eventType: 'message-end',
          data: { delta: { finish_reason: 'COMPLETE', usage: { tokens: {} } } },
        });
      }
      onEvent({ type: 'completed', runId: request.runId });
    },
  ),
}));

import {
  CohereTauriAgentProvider,
  prepareBoundedProviderImage,
} from '../src/features/aiAgent/cohereProvider';
import {
  AgentProviderError,
  isRetryableProviderError,
  projectTurnScopedSourceEvidence,
} from '../src/features/aiAgent/provider';
import type { ProviderMessage } from '../src/features/aiAgent/provider';

describe('Cohere AI agent provider', () => {
  it('disables extended reasoning only for a sole deterministic routing tool', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-routing',
      runId: 'run-routing',
      threadId: 'thread-routing',
      systemPrompt: 'system',
      tools: [{
        name: 'validate_notebook_script',
        description: 'Validate the current draft.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'read',
      }],
      messages: [],
      toolChoice: 'required',
      maxOutputTokens: 16_384,
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    expect(gateway.requests[0]).toMatchObject({
      maxTokens: 2_048,
      thinking: { type: 'disabled' },
    });
  });

  it('keeps the full reasoning budget for draft composition', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-composition',
      runId: 'run-composition',
      threadId: 'thread-composition',
      systemPrompt: 'system',
      tools: [{
        name: 'submit_notebook_script',
        description: 'Submit a composed Notebook Script draft.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        effect: 'draft',
      }],
      messages: [],
      toolChoice: 'required',
      maxOutputTokens: 16_384,
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    expect(gateway.requests[0]).toMatchObject({
      maxTokens: 16_384,
      thinking: { type: 'enabled', tokenBudget: 8_000 },
    });
  });

  it('keeps ordinary conversation optional while validating any returned tool call strictly', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-conversation',
      runId: 'run-conversation',
      threadId: 'thread-conversation',
      systemPrompt: 'Answer the reader clearly.',
      tools: [{
        name: 'finish_conversation',
        description: 'Finish the conversational answer.',
        inputSchema: {
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
          additionalProperties: false,
        },
        effect: 'propose',
      }],
      messages: [],
      toolChoice: 'auto',
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    expect(gateway.requests[0]?.toolChoice).toBeUndefined();
    expect(gateway.requests[0]?.strictTools).toBe(true);
  });

  it('omits Cohere tool_choice on notebook turns and keeps strict schema validation', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-notebook-tool',
      runId: 'run-notebook-tool',
      threadId: 'thread-notebook-tool',
      systemPrompt: 'Add the requested material to the notebook.',
      tools: [{
        name: 'submit_notebook_script',
        description: 'Submit the composed Notebook Script.',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', minLength: 1 },
            citedUnitIds: {
              type: 'array',
              items: { type: 'string' },
              default: [],
            },
          },
          required: ['script'],
          additionalProperties: false,
        },
        effect: 'draft',
      }],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    // The graph still requires a notebook capability and rejects prose-only
    // turns locally. The wire shape deliberately omits tool_choice because the
    // live Command A+ trial/production endpoint rejects that field for this
    // catalogue even though the generic V2 reference advertises it.
    expect(gateway.requests[0]?.toolChoice).toBeUndefined();
    expect(gateway.requests[0]?.strictTools).toBe(true);
  });

  it('keeps source-routing catalogues out of Cohere strict schema mode', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-source-intake',
      runId: 'run-source-intake',
      threadId: 'thread-source-intake',
      systemPrompt: 'Read the attached image before drafting the requested notebook page.',
      tools: [
        {
          name: 'read_full_source',
          description: 'Read the selected source.',
          inputSchema: {
            type: 'object',
            properties: { sourceId: { type: 'string' } },
            required: ['sourceId'],
            additionalProperties: false,
          },
          effect: 'read',
        },
        {
          name: 'search_source_index',
          description: 'Search the selected source.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              sourceIds: {
                type: ['array', 'null'],
                items: { type: 'string' },
              },
            },
            required: ['query', 'sourceIds'],
            additionalProperties: false,
          },
          effect: 'read',
        },
      ],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    expect(gateway.requests[0]?.toolChoice).toBeUndefined();
    expect(gateway.requests[0]?.strictTools).toBeUndefined();
  });

  it('accepts two complete sequential tool calls and preserves their identities', async () => {
    gateway.scriptedEvents.push(
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 1,
        eventType: 'tool-call-start',
        data: { delta: { message: { tool_calls: { id: 'call-a', function: { name: 'inspect_notebook', arguments: '{' } } } } },
      },
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 2,
        eventType: 'tool-call-delta',
        data: { delta: { message: { tool_calls: { function: { arguments: '"request":"current"}' } } } } },
      },
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 3,
        eventType: 'tool-call-end', data: {},
      },
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 4,
        eventType: 'tool-call-start',
        data: { delta: { message: { tool_calls: { id: 'call-b', function: { name: 'inspect_page', arguments: '{"pageId":"page-1"}' } } } } },
      },
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 5,
        eventType: 'tool-call-end', data: {},
      },
      {
        type: 'providerEvent', runId: 'provider-tools', sequence: 6,
        eventType: 'message-end',
        data: { delta: { finish_reason: 'TOOL_CALL', usage: { tokens: {} } } },
      },
    );
    const provider = new CohereTauriAgentProvider(() => true);
    const events = [];
    for await (const event of provider.streamTurn({
      requestId: 'provider-tools',
      runId: 'run-tools',
      threadId: 'thread-tools',
      systemPrompt: 'system',
      tools: [],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal })) events.push(event);

    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      {
        type: 'tool_call',
        id: 'call-a',
        name: 'inspect_notebook',
        arguments: { request: 'current' },
      },
      {
        type: 'tool_call',
        id: 'call-b',
        name: 'inspect_page',
        arguments: { pageId: 'page-1' },
      },
    ]);
    expect(events).toContainEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('accepts a complete streamed tool call when Command A+ labels the finish COMPLETE', async () => {
    gateway.scriptedEvents.push(
      {
        type: 'providerEvent', runId: 'provider-live-complete', sequence: 1,
        eventType: 'tool-call-start',
        data: {
          delta: {
            message: {
              tool_calls: {
                id: 'live-call',
                function: { name: 'submit_notebook_script', arguments: '{"request":"current"}' },
              },
            },
          },
        },
      },
      {
        type: 'providerEvent', runId: 'provider-live-complete', sequence: 2,
        eventType: 'tool-call-end', data: {},
      },
      {
        type: 'providerEvent', runId: 'provider-live-complete', sequence: 3,
        eventType: 'message-end',
        data: { delta: { finish_reason: 'COMPLETE', usage: { tokens: {} } } },
      },
    );
    const provider = new CohereTauriAgentProvider(() => true);
    const events = [];
    for await (const event of provider.streamTurn({
      requestId: 'provider-live-complete',
      runId: 'run-live-complete',
      threadId: 'thread-live-complete',
      systemPrompt: 'system',
      tools: [],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal })) events.push(event);

    expect(events).toContainEqual({
      type: 'tool_call',
      id: 'live-call',
      name: 'submit_notebook_script',
      arguments: { request: 'current' },
    });
    expect(events).toContainEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('still rejects a TOOL_CALL finish with no streamed tool call body', async () => {
    gateway.scriptedEvents.push({
      type: 'providerEvent', runId: 'provider-missing-call', sequence: 1,
      eventType: 'message-end',
      data: { delta: { finish_reason: 'TOOL_CALL', usage: { tokens: {} } } },
    });
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-missing-call',
      runId: 'run-missing-call',
      threadId: 'thread-missing-call',
      systemPrompt: 'system',
      tools: [],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal });

    await expect(async () => {
      for await (const _event of stream) {
        // The finish label cannot manufacture a missing call body.
      }
    }).rejects.toMatchObject({
      code: 'invalid_response',
      message: 'Cohere finish reason does not match its streamed tool calls',
    });
  });

  it.each([
    [
      'an invalid start',
      [{
        type: 'providerEvent', runId: 'provider-malformed', sequence: 1,
        eventType: 'tool-call-start', data: { delta: { message: { tool_calls: {} } } },
      }],
    ],
    [
      'a truncated call',
      [{
        type: 'providerEvent', runId: 'provider-malformed', sequence: 1,
        eventType: 'tool-call-start',
        data: { delta: { message: { tool_calls: { id: 'unfinished', function: { name: 'inspect_page', arguments: '{' } } } } },
      }],
    ],
    [
      'an orphan argument delta',
      [{
        type: 'providerEvent', runId: 'provider-malformed', sequence: 1,
        eventType: 'tool-call-delta',
        data: { delta: { message: { tool_calls: { function: { arguments: '{}' } } } } },
      }],
    ],
  ])('fails closed on %s instead of executing a partial tool batch', async (_case, events) => {
    gateway.scriptedEvents.push(...events);
    const provider = new CohereTauriAgentProvider(() => true);
    const stream = provider.streamTurn({
      requestId: 'provider-malformed',
      runId: 'run-malformed',
      threadId: 'thread-malformed',
      systemPrompt: 'system',
      tools: [],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal });
    await expect(async () => {
      for await (const _event of stream) {
        // A malformed stream may have yielded earlier public deltas, but it
        // must never finish successfully or authorize a partial call batch.
      }
    }).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('preserves streamed tool plans in the next assistant history message', async () => {
    gateway.requests.length = 0;
    gateway.scriptedEvents.push({
      type: 'providerEvent',
      runId: 'provider-plan',
      sequence: 1,
      eventType: 'tool-plan-delta',
      data: { delta: { message: { tool_plan: 'Inspect the current notebook.' } } },
    });
    const provider = new CohereTauriAgentProvider(() => true);
    const events = [];
    for await (const event of provider.streamTurn({
      requestId: 'provider-plan',
      runId: 'run-plan',
      threadId: 'thread-plan',
      systemPrompt: 'system',
      tools: [],
      messages: [],
      toolChoice: 'required',
    }, { signal: new AbortController().signal })) events.push(event);
    expect(events).toContainEqual({
      type: 'tool_plan_delta',
      text: 'Inspect the current notebook.',
    });
  });
  it('re-encodes a bounded pixel-only derivative and keeps original bytes out of it', async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close })));
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(readonly width: number, readonly height: number) {}
      getContext() { return { drawImage }; }
      async convertToBlob() {
        return new Blob([new Uint8Array([42, 24])], { type: 'image/webp' });
      }
    });
    try {
      const derivative = await prepareBoundedProviderImage({
        type: 'image_ref',
        image: {
          resourceId: 'local-original',
          mimeType: 'image/jpeg',
          digest: 'digest-original',
          width: 8_000,
          height: 4_000,
        },
        purpose: 'source_analysis',
      }, new AbortController().signal, async () => ({
        metadata: {
          id: 'local-original',
          kind: 'jpeg',
          mimeType: 'image/jpeg',
          sizeBytes: 6,
          sha256: 'digest-original',
        },
        // Includes a recognizable pretend metadata prefix. It must not be
        // copied by the canvas encoder.
        bytes: [69, 88, 73, 70, 1, 2],
      }));
      expect(derivative).toMatchObject({
        bytes: [42, 24],
        mimeType: 'image/webp',
        width: 1_600,
        height: 800,
      });
      expect(drawImage).toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed before gateway traffic when the configured privacy path is not acknowledged', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => false);
    const stream = provider.streamTurn(
      {
        requestId: 'provider-private',
        runId: 'run-private',
        threadId: 'thread-private',
        systemPrompt: 'system',
        tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'private notes' }] }],
      },
      { signal: new AbortController().signal },
    );
    await expect(async () => {
      for await (const _event of stream) {
        // must never yield
      }
    }).rejects.toThrow(/privacy notice/i);
    expect(gateway.requests).toHaveLength(0);
  });

  it.each([
    ['permissionDenied', false, 403, 'auth', false],
    ['invalidRequest', false, 400, 'invalid_response', false],
    ['providerUnavailable', true, 503, 'unavailable', true],
  ] as const)(
    'preserves gateway retry authority for %s errors',
    async (gatewayCode, gatewayRetryable, status, expectedCode, expectedRetryable) => {
      gateway.scriptedEvents.push({
        type: 'error',
        runId: `provider-error-${gatewayCode}`,
        error: {
          code: gatewayCode,
          message: `scripted ${gatewayCode}`,
          retryable: gatewayRetryable,
          status,
        },
      });
      const provider = new CohereTauriAgentProvider(() => true);
      let caught: unknown;
      try {
        for await (const _event of provider.streamTurn({
          requestId: `provider-error-${gatewayCode}`,
          runId: `run-error-${gatewayCode}`,
          threadId: `thread-error-${gatewayCode}`,
          systemPrompt: 'system',
          tools: [{
            name: 'finish_conversation',
            description: 'Finish the conversation.',
            inputSchema: {
              type: 'object',
              properties: { request: { type: 'string' } },
              required: ['request'],
              additionalProperties: false,
            },
            effect: 'interrupt',
          }],
          messages: [],
          toolChoice: 'required',
        }, { signal: new AbortController().signal })) {
          // drain queued protocol events before the gateway error is raised
        }
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(AgentProviderError);
      expect(caught).toMatchObject({
        code: expectedCode,
        retryable: gatewayRetryable,
        status,
      });
      expect(isRetryableProviderError(caught)).toBe(expectedRetryable);
    },
  );

  it('keeps parallel tool results contiguous and sends their rendered images to the next model turn', async () => {
    gateway.requests.length = 0;
    gateway.serializedImageBytes.length = 0;
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        // A canvas-produced derivative is injected here so the protocol test
        // can run in Node. The boundary must serialize these bytes, never the
        // original [1, 2, 3] returned by readAiAttachment above.
        prepareImage: async (part) => ({
          bytes: part.purpose === 'source_analysis' ? [9, 8, 7] : [6, 5, 4],
          mimeType: 'image/webp',
          width: Math.min(part.image.width, 1_000),
          height: Math.min(part.image.height, 1_000),
        }),
      },
    );
    const stream = provider.streamTurn(
      {
        requestId: 'provider-1',
        runId: 'run-1',
        threadId: 'thread-1',
        systemPrompt: 'system',
        tools: [{
          name: 'record_visual_review',
          description: 'Record the visual findings for the exposed preview pages.',
          inputSchema: {
            type: 'object',
            properties: { request: { type: 'string' } },
            required: ['request'],
            additionalProperties: false,
          },
          effect: 'read',
        }],
        toolChoice: 'required',
        messages: [
          {
            role: 'assistant',
            content: [],
            toolCalls: [
              { id: 'call-a', name: 'read_source_range', arguments: {} },
              { id: 'call-b', name: 'read_draft_preview_pages', arguments: {} },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call-a',
            content: [
              { type: 'text', text: '{"source":"a"}' },
              {
                type: 'image_ref',
                image: {
                  resourceId: 'source-image',
                  mimeType: 'image/png',
                  digest: 'source-image',
                  width: 600,
                  height: 800,
                },
                purpose: 'source_analysis',
              },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call-b',
            content: [
              { type: 'text', text: '{"preview":"b"}' },
              {
                type: 'image_ref',
                image: {
                  resourceId: 'draft-image',
                  mimeType: 'image/png',
                  digest: 'draft-image',
                  width: 1200,
                  height: 1700,
                },
                purpose: 'draft_visual_review',
                pageNumber: 1,
              },
            ],
          },
        ],
      },
      { signal: new AbortController().signal },
    );
    for await (const _event of stream) {
      // drain the provider turn
    }

    const sent = gateway.requests[0]?.messages ?? [];
    // Call selection and schema validation remain local graph invariants. The
    // multimodal envelope stays out of Cohere strict schema mode: the live
    // endpoint accepts the image/tool combination only without that optional
    // compatibility flag.
    expect(gateway.requests[0]?.strictTools).toBeUndefined();
    expect(gateway.requests[0]?.toolChoice).toBeUndefined();
    expect(gateway.requests[0]?.citationMode).toBeUndefined();
    expect(gateway.requests[0]?.safetyMode).toBeUndefined();
    expect(sent.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'tool',
      'tool',
      'user',
    ]);
    const visualTurn = sent[4];
    expect(visualTurn?.role).toBe('user');
    if (visualTurn?.role !== 'user' || typeof visualTurn.content === 'string') {
      throw new Error('expected a multimodal user turn');
    }
    expect(
      visualTurn.content.filter((part) => part.type === 'image_url'),
    ).toHaveLength(2);
    expect(gateway.serializedImageBytes).toEqual([[9, 8, 7], [6, 5, 4]]);
    expect(gateway.serializedImageBytes).not.toContainEqual([1, 2, 3]);
  });

  it.each([
    ['source then notebook', true],
    ['notebook then source', false],
  ] as const)(
    'delivers current source pixels exactly once when local tools run %s',
    async (_label, sourceFirst) => {
      gateway.requests.length = 0;
      gateway.serializedImageBytes.length = 0;
      const preparedDigests: string[] = [];
      const provider = new CohereTauriAgentProvider(
        () => true,
        {
          prepareImage: async (part) => {
            preparedDigests.push(part.image.digest);
            return {
              bytes: [4, 5, 6],
              mimeType: 'image/webp',
              width: 800,
              height: 1_200,
            };
          },
        },
      );
      const sourceImage = {
        resourceId: 'week-6-picture',
        mimeType: 'image/png' as const,
        digest: 'week-6-picture-digest',
        width: 1_024,
        height: 1_536,
      };
      const reader: ProviderMessage = {
        role: 'user',
        content: [{ type: 'text', text: 'Add this picture for Week 6 with brief notes.' }],
      };
      const sourceAssistant: ProviderMessage = {
        role: 'assistant',
        content: [],
        toolCalls: [{
          id: 'read-source',
          name: 'read_full_source',
          arguments: { sourceId: 'picture-source' },
        }],
      };
      const sourceTool: ProviderMessage = {
        role: 'tool',
        toolCallId: 'read-source',
        toolName: 'read_full_source',
        content: [
          { type: 'text', text: '{"sourceId":"picture-source"}' },
          { type: 'image_ref', image: sourceImage, purpose: 'source_analysis' },
        ],
      };
      const notebookAssistant: ProviderMessage = {
        role: 'assistant',
        content: [],
        toolCalls: [{ id: 'inspect-book', name: 'inspect_notebook', arguments: {} }],
      };
      const notebookTool: ProviderMessage = {
        role: 'tool',
        toolCallId: 'inspect-book',
        toolName: 'inspect_notebook',
        content: [{ type: 'text', text: '{"pages":[{"title":"Earlier week"}]}' }],
      };
      const ordered = sourceFirst
        ? [reader, sourceAssistant, sourceTool, notebookAssistant, notebookTool]
        : [reader, notebookAssistant, notebookTool, sourceAssistant, sourceTool];
      const projected = projectTurnScopedSourceEvidence({
        messages: ordered,
        turnId: 'reader-week-6',
        purpose: 'notebook_draft',
        sourceImages: [sourceImage],
        requiredSourceImageCount: 1,
      });
      const stream = provider.streamTurn({
        requestId: `order-${sourceFirst ? 'source-first' : 'notebook-first'}`,
        runId: 'run-order-independent',
        threadId: 'thread-order-independent',
        systemPrompt: 'Draft only from the current source picture.',
        messages: projected.messages,
        evidence: projected.receipt,
        tools: [],
        toolChoice: 'auto',
      }, { signal: new AbortController().signal });
      for await (const _event of stream) {
        // drain the request
      }

      const sent = gateway.requests[0]?.messages ?? [];
      const images = sent.flatMap((message) =>
        message.role === 'user' && Array.isArray(message.content)
          ? message.content.filter((part) => part.type === 'image_url')
          : [],
      );
      expect(images).toHaveLength(1);
      expect(gateway.serializedImageBytes).toEqual([[4, 5, 6]]);
      expect(preparedDigests).toEqual(['week-6-picture-digest']);
      expect(projected.messages.flatMap((message) =>
        message.role === 'tool'
          ? message.content.filter((part) => part.type === 'image_ref')
          : [],
      )).toEqual([]);
      const projectedText = JSON.stringify(projected.messages);
      expect(projectedText).not.toContain('Earlier week');
      expect(projectedText).toContain('placementIndexCompacted');
    },
  );

  it('re-exposes a durable source image on a later image question', async () => {
    gateway.requests.length = 0;
    gateway.serializedImageBytes.length = 0;
    const preparedDigests: string[] = [];
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        prepareImage: async (part) => {
          preparedDigests.push(part.image.digest);
          return {
            bytes: [7, 7, 7],
            mimeType: 'image/webp',
            width: 900,
            height: 1_200,
          };
        },
      },
    );
    const sourceImage = {
      resourceId: 'durable-picture',
      mimeType: 'image/png' as const,
      digest: 'durable-picture-digest',
      width: 900,
      height: 1_200,
    };
    const projected = projectTurnScopedSourceEvidence({
      messages: [
        {
          role: 'assistant',
          content: [],
          toolCalls: [{ id: 'old-read', name: 'read_full_source', arguments: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'old-read',
          toolName: 'read_full_source',
          content: [
            { type: 'text', text: '{"sourceId":"picture"}' },
            { type: 'image_ref', image: sourceImage, purpose: 'source_analysis' },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'The earlier notebook preview is ready.' }],
          toolCalls: [{ id: 'old-preview', name: 'read_draft_preview_pages', arguments: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'old-preview',
          toolName: 'read_draft_preview_pages',
          content: [
            { type: 'text', text: '{"pageIds":["old-page"]}' },
            {
              type: 'image_ref',
              image: {
                resourceId: 'old-preview-page',
                mimeType: 'image/png',
                digest: 'old-preview-page-digest',
                width: 900,
                height: 1_200,
              },
              purpose: 'draft_visual_review',
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Can you see images? What is in this picture?' }],
        },
      ],
      turnId: 'later-image-question',
      purpose: 'conversation_answer',
      sourceImages: [sourceImage],
      requiredSourceImageCount: 1,
    });
    const stream = provider.streamTurn({
      requestId: 'later-image-question',
      runId: 'run-later-image-question',
      threadId: 'thread-later-image-question',
      systemPrompt: 'Answer the current image question.',
      messages: projected.messages,
      evidence: projected.receipt,
      tools: [],
      toolChoice: 'auto',
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the request
    }

    const sent = gateway.requests[0]?.messages ?? [];
    const latestUser = [...sent].reverse().find((message) => message.role === 'user');
    expect(latestUser?.role).toBe('user');
    expect(latestUser?.role === 'user' && Array.isArray(latestUser.content)
      ? latestUser.content.filter((part) => part.type === 'image_url')
      : []).toHaveLength(1);
    expect(gateway.serializedImageBytes).toEqual([[7, 7, 7]]);
    expect(preparedDigests).toEqual(['durable-picture-digest']);
    expect(projected.receipt.deliveredDraftImageDigests).toEqual([]);
  });

  it('sends the original source image beside current draft renders for grounded review', async () => {
    gateway.requests.length = 0;
    gateway.serializedImageBytes.length = 0;
    const preparedDigests: string[] = [];
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        prepareImage: async (part) => {
          preparedDigests.push(part.image.digest);
          return {
            bytes: part.purpose === 'source_analysis' ? [1, 4, 1] : [2, 5, 2],
            mimeType: 'image/webp',
            width: 1_000,
            height: 1_400,
          };
        },
      },
    );
    const sourceImage = {
      resourceId: 'grounding-source',
      mimeType: 'image/png' as const,
      digest: 'grounding-source-digest',
      width: 1_000,
      height: 1_400,
    };
    const draftImage = {
      resourceId: 'draft-page-one',
      mimeType: 'image/png' as const,
      digest: 'draft-page-one-digest',
      width: 1_000,
      height: 1_400,
    };
    const projected = projectTurnScopedSourceEvidence({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Add this image with brief notes.' }] },
        {
          role: 'assistant',
          content: [],
          toolCalls: [{ id: 'preview-read', name: 'read_draft_preview_pages', arguments: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'preview-read',
          toolName: 'read_draft_preview_pages',
          content: [
            { type: 'text', text: '{"pageIds":["page-1"]}' },
            {
              type: 'image_ref',
              image: draftImage,
              purpose: 'draft_visual_review',
              pageId: 'page-1',
              pageNumber: 1,
            },
          ],
        },
      ],
      turnId: 'grounded-review',
      purpose: 'preview_review',
      sourceImages: [sourceImage],
      requiredSourceImageCount: 1,
      requiredDraftImageDigests: [draftImage.digest],
    });
    const stream = provider.streamTurn({
      requestId: 'grounded-review',
      runId: 'run-grounded-review',
      threadId: 'thread-grounded-review',
      systemPrompt: 'Compare source pixels with the rendered draft.',
      messages: projected.messages,
      evidence: projected.receipt,
      tools: [],
      toolChoice: 'auto',
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the request
    }

    const sent = gateway.requests[0]?.messages ?? [];
    const imageTurns = sent.filter((message) =>
      message.role === 'user' && Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url'));
    expect(imageTurns).toHaveLength(2);
    expect(gateway.serializedImageBytes).toEqual([[1, 4, 1], [2, 5, 2]]);
    expect(preparedDigests).toEqual([
      'grounding-source-digest',
      'draft-page-one-digest',
    ]);
  });

  it('fails before gateway traffic when a required evidence receipt has no pixels', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(() => true);
    const drain = async (): Promise<void> => {
      const stream = provider.streamTurn({
        requestId: 'missing-current-evidence',
        runId: 'run-missing-current-evidence',
        threadId: 'thread-missing-current-evidence',
        systemPrompt: 'Do not guess from notebook titles.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Explain this picture.' }] }],
        evidence: {
          turnId: 'reader-missing-evidence',
          purpose: 'conversation_answer',
          requiredSourceImageCount: 1,
          requiredSourceImageDigests: ['missing-picture-digest'],
          deliveredSourceImageDigests: [],
          requiredDraftImageDigests: [],
          deliveredDraftImageDigests: [],
        },
        tools: [],
        toolChoice: 'auto',
      }, { signal: new AbortController().signal });
      for await (const _event of stream) {
        // drain until the preflight failure
      }
    };

    await expect(drain()).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
    expect(gateway.requests).toHaveLength(0);
  });

  it('fails before gateway traffic when declared evidence does not match serialized pixels', async () => {
    gateway.requests.length = 0;
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        prepareImage: async () => {
          throw new Error('mismatched evidence must fail before image preparation');
        },
      },
    );
    const drain = async (): Promise<void> => {
      const stream = provider.streamTurn({
        requestId: 'mismatched-current-evidence',
        runId: 'run-mismatched-current-evidence',
        threadId: 'thread-mismatched-current-evidence',
        systemPrompt: 'Use only exact current pixels.',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Explain this picture.' },
            {
              type: 'image_ref',
              image: {
                resourceId: 'wrong-picture',
                mimeType: 'image/png',
                digest: 'wrong-picture-digest',
                width: 800,
                height: 1_000,
              },
              purpose: 'source_analysis',
            },
          ],
        }],
        evidence: {
          turnId: 'reader-mismatched-evidence',
          purpose: 'conversation_answer',
          requiredSourceImageCount: 1,
          requiredSourceImageDigests: ['expected-picture-digest'],
          // This deliberately makes the provider-neutral receipt internally
          // self-consistent. Cohere must still recompute the actual wire image
          // and reject the mismatch independently.
          deliveredSourceImageDigests: ['expected-picture-digest'],
          requiredDraftImageDigests: [],
          deliveredDraftImageDigests: [],
        },
        tools: [],
        toolChoice: 'auto',
      }, { signal: new AbortController().signal });
      for await (const _event of stream) {
        // drain until the transport-side preflight failure
      }
    };

    await expect(drain()).rejects.toMatchObject({
      code: 'invalid_response',
      retryable: false,
    });
    expect(gateway.requests).toHaveLength(0);
  });

  it('does not replay historical tool-result pixels after a later model turn', async () => {
    gateway.requests.length = 0;
    gateway.serializedImageBytes.length = 0;
    const preparedResourceIds: string[] = [];
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        prepareImage: async (part) => {
          preparedResourceIds.push(part.image.resourceId);
          return {
            bytes: part.image.resourceId === 'current-render' ? [8, 8, 8] : [1, 1, 1],
            mimeType: 'image/webp',
            width: 600,
            height: 800,
          };
        },
      },
    );
    const stream = provider.streamTurn({
      requestId: 'provider-no-image-replay',
      runId: 'run-no-image-replay',
      threadId: 'thread-no-image-replay',
      systemPrompt: 'system',
      tools: [],
      toolChoice: 'required',
      messages: [
        {
          role: 'assistant',
          content: [],
          toolCalls: [{ id: 'call-old', name: 'read_draft_preview_pages', arguments: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'call-old',
          toolName: 'read_draft_preview_pages',
          content: [
            { type: 'text', text: '{"generation":"old"}' },
            {
              type: 'image_ref',
              image: {
                resourceId: 'historical-render',
                mimeType: 'image/png',
                digest: 'historical-render-digest',
                width: 600,
                height: 800,
              },
              purpose: 'draft_visual_review',
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'I inspected that older render.' }],
          toolCalls: [{ id: 'call-current', name: 'read_draft_preview_pages', arguments: {} }],
        },
        {
          role: 'tool',
          toolCallId: 'call-current',
          toolName: 'read_draft_preview_pages',
          content: [
            { type: 'text', text: '{"generation":"current"}' },
            {
              type: 'image_ref',
              image: {
                resourceId: 'current-render',
                mimeType: 'image/png',
                digest: 'current-render-digest',
                width: 600,
                height: 800,
              },
              purpose: 'draft_visual_review',
            },
          ],
        },
      ],
    }, { signal: new AbortController().signal });
    for await (const _event of stream) {
      // drain the provider turn
    }

    expect(preparedResourceIds).toEqual(['current-render']);
    expect(gateway.serializedImageBytes).toEqual([[8, 8, 8]]);
    expect(gateway.serializedImageBytes).not.toContainEqual([1, 1, 1]);
    const sent = gateway.requests[0]?.messages ?? [];
    const imageParts = sent.flatMap((message) =>
      message.role === 'user' && Array.isArray(message.content)
        ? message.content.filter((part) => part.type === 'image_url')
        : [],
    );
    expect(imageParts).toHaveLength(1);
  });

  it('rejects an oversized derivative instead of falling back to original image bytes', async () => {
    gateway.requests.length = 0;
    gateway.serializedImageBytes.length = 0;
    const provider = new CohereTauriAgentProvider(
      () => true,
      {
        prepareImage: async () => ({
          bytes: [7],
          mimeType: 'image/webp',
          width: 9_000,
          height: 9_000,
        }),
      },
    );
    const stream = provider.streamTurn({
      requestId: 'provider-image-boundary',
      runId: 'run-image-boundary',
      threadId: 'thread-image-boundary',
      systemPrompt: 'system',
      tools: [],
      toolChoice: 'auto',
      messages: [{
        role: 'user',
        content: [{
          type: 'image_ref',
          image: {
            resourceId: 'source-image',
            mimeType: 'image/png',
            digest: 'source-image',
            width: 9_000,
            height: 9_000,
          },
          purpose: 'source_analysis',
        }],
      }],
    }, { signal: new AbortController().signal });
    await expect(async () => {
      for await (const _event of stream) {
        // must never reach the gateway
      }
    }).rejects.toThrow(/transport boundary/i);
    expect(gateway.requests).toHaveLength(0);
    expect(gateway.serializedImageBytes).toHaveLength(0);
  });
});
