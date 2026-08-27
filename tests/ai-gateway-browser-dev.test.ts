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

  it('keeps localhost PDFs managed and sends only page images to Cohere Parse', async () => {
    let requestUrl = '';
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requestUrl = url;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: 'parse-browser-1',
        pages: [{
          type: 'markdown',
          index: 0,
          markdown: { content: '# Parsed page\r\n\r\n| A | B |' },
        }],
        meta: { billed_units: { pages: 1 } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    const gateway = await import('../src/data/aiGateway');
    const pdf = await gateway.saveAiAttachment(new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
    ]));
    const jpeg = await gateway.saveAiAttachment(new Uint8Array([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9,
    ]));

    expect(pdf).toMatchObject({ kind: 'pdf', mimeType: 'application/pdf' });
    await expect(gateway.parseAiImage({
      runId: 'browser-parse-pdf-rejected',
      attachmentId: pdf.id,
    })).rejects.toThrow(/managed PNG, JPEG, or WebP/i);
    await expect(gateway.parseAiImage({
      runId: 'browser-parse-image-1',
      attachmentId: jpeg.id,
    })).resolves.toEqual({
      id: 'parse-browser-1',
      markdown: '# Parsed page\n\n| A | B |',
      billedPages: 1,
    });

    expect(requestUrl).toBe('https://api.cohere.com/v2/parse');
    expect(requestBody).toMatchObject({
      model: 'parse-v5.0',
      document: {
        type: 'image_url',
        image_url: expect.stringMatching(/^data:image\/jpeg;base64,/),
      },
      output_format: 'markdown',
    });
    expect(JSON.stringify(requestBody)).not.toContain(jpeg.id);
  });

  it('rejects malformed or oversized Parse responses with native-validator parity', async () => {
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    const gateway = await import('../src/data/aiGateway');
    const jpeg = await gateway.saveAiAttachment(new Uint8Array([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9,
    ]));
    const valid = (): Record<string, any> => ({
      id: 'parse-browser-valid',
      pages: [{
        type: 'markdown',
        index: 0,
        markdown: {
          content: '# Parsed page',
          images: [{
            id: 'image-1',
            description: 'A compact table',
            category: 'table',
            bounding_box: {
              top_left_x: 1,
              top_left_y: 2,
              bottom_right_x: 100,
              bottom_right_y: 200,
            },
            bounding_box_normalized: {
              top_left_x: 0.1,
              top_left_y: 0.2,
              bottom_right_x: 0.8,
              bottom_right_y: 0.9,
            },
          }],
        },
      }],
      meta: { billed_units: { pages: 1 } },
    });
    const invalid: Record<string, any>[] = [];
    const badId = valid();
    badId.id = 'parse id with spaces';
    invalid.push(badId);
    const badIndex = valid();
    badIndex.pages[0].index = 1;
    invalid.push(badIndex);
    const oversizedMarkdown = valid();
    oversizedMarkdown.pages[0].markdown.content = 'x'.repeat(2 * 1024 * 1024 + 1);
    invalid.push(oversizedMarkdown);
    const excessiveImages = valid();
    excessiveImages.pages[0].markdown.images = Array.from(
      { length: 2_049 },
      (_, index) => ({ id: `image-${index}` }),
    );
    invalid.push(excessiveImages);
    const reversedPixelBounds = valid();
    reversedPixelBounds.pages[0].markdown.images[0].bounding_box.bottom_right_x = 0;
    invalid.push(reversedPixelBounds);
    const invalidNormalizedBounds = valid();
    invalidNormalizedBounds.pages[0].markdown.images[0]
      .bounding_box_normalized.bottom_right_y = 1.1;
    invalid.push(invalidNormalizedBounds);
    const badBilling = valid();
    badBilling.meta.billed_units.pages = 2;
    invalid.push(badBilling);
    const malformedMeta = valid();
    malformedMeta.meta = 'not-an-object';
    invalid.push(malformedMeta);

    for (const [index, body] of invalid.entries()) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })));
      await expect(gateway.parseAiImage({
        runId: `browser-parse-invalid-${index}`,
        attachmentId: jpeg.id,
      })).rejects.toThrow(/invalid Parse response/i);
    }

    let chunks = 0;
    const megabyte = new Uint8Array(1024 * 1024).fill(0x20);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        if (chunks >= 17) {
          controller.close();
          return;
        }
        chunks += 1;
        controller.enqueue(megabyte);
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(gateway.parseAiImage({
      runId: 'browser-parse-oversized-body',
      attachmentId: jpeg.id,
    })).rejects.toThrow(/exceeded the allowed size/i);
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
