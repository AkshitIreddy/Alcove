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
      tools: [],
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
    expect(events.map((event) => event.type)).toEqual([
      'providerEvent', 'providerEvent', 'providerEvent', 'completed',
    ]);
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
