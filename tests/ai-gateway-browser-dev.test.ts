import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiGatewayStreamEvent } from '../src/data/aiGateway';

const sseResponse = (frames: readonly [string, Record<string, unknown>][]): Response => {
  const body = frames.map(([event, data]) =>
    `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
  ).join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

describe('AI gateway localhost development transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {});
  });

  it('streams Cohere events using only the in-memory development key', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {});
      return sseResponse([
        ['message-start', { id: 'message-1' }],
        ['content-delta', { delta: { message: { content: { text: 'Hello' } } } }],
        ['message-end', { delta: { finish_reason: 'COMPLETE', usage: { tokens: {} } } }],
      ]);
    }));
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    const gateway = await import('../src/data/aiGateway');
    const events: AiGatewayStreamEvent[] = [];
    await gateway.streamAiGatewayChat({
      runId: 'browser-chat-1',
      model: 'command-a-plus-05-2026',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{
        name: 'finish_conversation',
        description: 'Finish after writing the reader-facing answer.',
        parameters: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
          additionalProperties: false,
        },
      }],
      strictTools: true,
    }, (event) => events.push(event));

    const headers = requests[0]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer trial_key_that_is_long_enough');
    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      stream: true,
      model: 'command-a-plus-05-2026',
      messages: [{ role: 'user', content: 'Hello' }],
      strict_tools: true,
    });
    expect(JSON.parse(String(requests[0]?.body))).not.toHaveProperty('tool_choice');
    expect(events.map((event) => event.type)).toEqual([
      'providerEvent', 'providerEvent', 'providerEvent', 'completed',
    ]);
  });

  it('ignores self-identifying provider extensions and accepts a missing SSE event header', async () => {
    const body = [
      'event: ping',
      'data: {}',
      '',
      'event: transport-metadata',
      'data: {"type":"transport-metadata","region":"test"}',
      '',
      'data: {"type":"message-start","id":"message-extension"}',
      '',
      'event: message-end',
      'data: {"type":"message-end","delta":{"finish_reason":"COMPLETE","usage":{"tokens":{}}}}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })));
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    const gateway = await import('../src/data/aiGateway');
    const events: AiGatewayStreamEvent[] = [];
    await gateway.streamAiGatewayChat({
      runId: 'browser-chat-extension',
      model: 'command-a-plus-05-2026',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [],
    }, (event) => events.push(event));

    expect(events).toMatchObject([
      { type: 'providerEvent', eventType: 'message-start' },
      { type: 'providerEvent', eventType: 'message-end' },
      { type: 'completed' },
    ]);
  });

  it('keeps localhost image attachments content-addressed and byte-private', async () => {
    const gateway = await import('../src/data/aiGateway');
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d,
    ]);

    const first = await gateway.saveAiAttachment(png);
    const second = await gateway.saveAiAttachment(png);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: expect.stringMatching(/^att_[0-9a-f]{64}$/),
      kind: 'png',
      mimeType: 'image/png',
      sizeBytes: png.length,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await gateway.readAiAttachment(first.id)).toEqual({
      metadata: first,
      bytes: [...png],
    });
    const { resolveAssetSrc } = await import('../src/editor/media/resolver');
    expect(await resolveAssetSrc(`ai/attachments/${first.id}`)).toMatch(/^blob:/);
    expect(await gateway.deleteAiAttachment(first.id)).toBe(true);
    await expect(gateway.readAiAttachment(first.id)).rejects.toThrow(/no longer available/i);
    await expect(gateway.saveAiAttachment(new Uint8Array())).rejects.toThrow(/between 1 byte and 32 MB/i);
  });

  it('translates embed fields to Cohere snake case without leaking the run id', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'embed-1', embeddings: { float: [[1]] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    const { embedAiTexts } = await import('../src/data/aiGateway');
    await embedAiTexts({
      runId: 'browser-embed-1',
      texts: ['kitten'],
      inputType: 'search_query',
    });

    expect(body).toMatchObject({
      model: 'embed-v4.0',
      input_type: 'search_query',
      embedding_types: ['float'],
      output_dimension: 512,
    });
    expect(body).not.toHaveProperty('runId');
    expect(body).not.toHaveProperty('inputType');
  });
});
