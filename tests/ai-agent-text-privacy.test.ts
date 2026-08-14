import { describe, expect, it } from 'vitest';
import type { ReviewedDraftReceiptStore } from '../src/data/aiAgentReviewedDraft';
import { prepareAiProposalApplication } from '../src/features/aiAgent/prepareProposal';
import { createReviewedDraftReceipt } from '../src/features/aiAgent/reviewedReceipt';
import type {
  AgentAdapters,
  AgentJsonValue,
  AgentProvider,
  AgentProviderCapabilities,
  AgentProviderStreamEvent,
  AgentProviderTurnRequest,
  AgentState,
  DraftPreviewGeneration,
  SourceManifest,
} from '../src/features/aiAgent';
import {
  AgentEventBus,
  AgentPrivateTextStreamRestorer,
  AgentRuntime,
  AgentToolCatalog,
  InMemoryAgentPersistence,
  assertAgentTextPrivacyReceipt,
  createAgentTextPrivacyReceipt,
  buildImagePromptHandoff,
  createInitialAgentState,
  createSourceCoverageLedger,
  createVisualReviewLedger,
  isAgentTextPrivacyReceipt,
  obfuscatePrivateJson,
  obfuscatePrivateText,
  obfuscateProviderRequest,
  recordVisualImageExposures,
  recordVisualInspection,
  restorePrivateJson,
  restorePrivateText,
} from '../src/features/aiAgent';

const NOW = '2026-08-12T08:00:00.000Z';

const hash = {
  async digestText(text: string): Promise<string> {
    let value = 2166136261;
    for (const character of text) {
      value ^= character.codePointAt(0) ?? 0;
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(16).padStart(64, '0');
  },
  async digestJson(value: unknown): Promise<string> {
    return this.digestText(JSON.stringify(value));
  },
};

function emptyManifest(): SourceManifest {
  return {
    version: 1,
    createdAt: NOW,
    sources: [],
    totalEstimatedTokens: 0,
    digest: 'empty-manifest',
  };
}

function generation(input: {
  draftHash: string;
  generationId: string;
  resourceId: string;
}): DraftPreviewGeneration {
  return {
    generationId: input.generationId,
    draftHash: input.draftHash,
    layoutHash: `layout:${input.draftHash}`,
    rendererVersion: 'privacy-test-renderer',
    bookSnapshotRevision: 'book-revision',
    createdAt: NOW,
    parserValid: true,
    layoutValid: true,
    stale: false,
    pageCount: 1,
    pages: [{
      pageId: `${input.generationId}:page:1`,
      pageNumber: 1,
      width: 620,
      height: 720,
      image: {
        resourceId: input.resourceId,
        mimeType: 'image/png',
        digest: `digest:${input.resourceId}`,
        width: 620,
        height: 720,
      },
      textDigest: `text:${input.draftHash}`,
      layoutDigest: `page-layout:${input.draftHash}`,
      paginationSpill: false,
      residualOverflow: false,
    }],
    diagnostics: [],
  };
}

describe('AI Agent local text veil', () => {
  it('layers checksum, context and structured-field recognizers without masking ordinary numbers', () => {
    const raw = [
      'Card: 4111 1111 1111 1111',
      'IBAN: GB82 WEST 1234 5698 7654 32',
      'SSN: 123-45-6789',
      'Passport number: P12345678',
      'API key: sk_live_EXAMPLE_123456789',
      'https://example.test/report?access_token=private-token-123&view=summary',
      'Username: @alice_notes',
      'Postal code: SW1A 1AA',
      'GPS: 51.501364, -0.141890',
      'Device: 00:1A:2B:3C:4D:5E',
      'Authorization: Bearer secret-bearer-token-987',
      'Passphrase: correct horse battery staple',
      'Local file C:\\Users\\alice\\Documents\\notes.txt',
      'Invoice total 4111.11 and experiment count 12345678901 stay readable.',
    ].join('\n');
    const transformed = obfuscatePrivateText(
      raw,
      createAgentTextPrivacyReceipt({ namespace: 'layered-recognizers', now: NOW }),
      NOW,
    );
    for (const privateFragment of [
      '4111 1111 1111 1111',
      'GB82 WEST 1234 5698 7654 32',
      '123-45-6789',
      'P12345678',
      'sk_live_EXAMPLE_123456789',
      'private-token-123',
      '@alice_notes',
      'SW1A 1AA',
      '51.501364, -0.141890',
      '00:1A:2B:3C:4D:5E',
      'secret-bearer-token-987',
      'correct horse battery staple',
      'alice',
    ]) expect(transformed.value).not.toContain(privateFragment);
    expect(transformed.value).toContain('Invoice total 4111.11');
    expect(transformed.value).toContain('experiment count 12345678901');
    expect(restorePrivateText(transformed.value, transformed.receipt)).toBe(raw);
    const kinds = new Set(transformed.receipt.entries.map((entry) => entry.kind));
    for (const kind of [
      'payment_card',
      'financial_account',
      'government_id',
      'credential_secret',
      'username',
      'postal_code',
      'precise_location',
      'network_address',
      'user_path',
    ] as const) expect(kinds.has(kind)).toBe(true);
  });

  it('rejects corrupted persisted receipts instead of restoring ambiguous tokens', () => {
    const transformed = obfuscatePrivateText(
      'Email alice@example.org.',
      createAgentTextPrivacyReceipt({ namespace: 'receipt-shape', now: NOW }),
      NOW,
    );
    expect(isAgentTextPrivacyReceipt(transformed.receipt)).toBe(true);
    const entry = transformed.receipt.entries[0]!;
    for (const placeholder of [
      entry.placeholder.replace('EMAIL', 'PHONE'),
      entry.placeholder.replace(/0001/u, '0002'),
      entry.placeholder.replace(transformed.receipt.namespace, 'OTHERXXXXX'),
    ]) {
      expect(isAgentTextPrivacyReceipt({
        ...transformed.receipt,
        entries: [{ ...entry, placeholder }],
      })).toBe(false);
      expect(() => assertAgentTextPrivacyReceipt({
        ...transformed.receipt,
        entries: [{ ...entry, placeholder }],
      })).toThrow(/blocked restoration and provider transport/i);
    }
  });

  it('masks privacy-labelled JSON scalars even when their shape is otherwise ambiguous', () => {
    const receipt = createAgentTextPrivacyReceipt({ namespace: 'structured-fields', now: NOW });
    const source: AgentJsonValue = {
      pageId: 'page-capability-id',
      firstName: 'Alice',
      lastName: 'Example',
      city: 'Tiny Town',
      accessToken: 'short-but-private',
      href: 'https://example.test/path?api_key=query-secret-789&mode=read',
      publicUrl: 'https://example.test/public',
    };
    const transformed = obfuscatePrivateJson(source, receipt, NOW);
    const serialized = JSON.stringify(transformed.value);
    expect(serialized).not.toContain('Alice');
    expect(serialized).not.toContain('Example');
    expect(serialized).not.toContain('Tiny Town');
    expect(serialized).not.toContain('short-but-private');
    expect(serialized).not.toContain('query-secret-789');
    expect(transformed.value).toMatchObject({
      pageId: 'page-capability-id',
      publicUrl: 'https://example.test/public',
    });
    expect(restorePrivateJson(transformed.value, transformed.receipt)).toEqual(source);
  });

  it('round-trips recognized private text with stable typed opaque placeholders', () => {
    const raw = [
      'Student: Alice Example',
      'alice@example.org',
      '+1 (415) 555-0198',
      '42 Paper Street, Apt 7B',
      '192.168.10.24',
      '2001:db8::1',
      '::1',
      '550e8400-e29b-41d4-a716-446655440000',
      '2026-08-12',
      'client_20260812_ABCDEF98',
    ].join('\n');
    const first = obfuscatePrivateText(
      raw,
      createAgentTextPrivacyReceipt({ namespace: 'task-restart-1', now: NOW }),
      NOW,
    );

    expect(first.value).not.toContain('Alice Example');
    expect(first.value).not.toContain('alice@example.org');
    expect(first.value).not.toContain('415');
    expect(first.value).not.toContain('Paper Street');
    expect(first.value).not.toContain('192.168.10.24');
    expect(first.value).not.toContain('2001:db8::1');
    expect(first.value).not.toContain('::1');
    expect(first.value).not.toContain('550e8400');
    expect(first.value).not.toContain('2026-08-12');
    expect(first.value).toContain('ALCOVE_PRIVATE_EMAIL_');
    expect(first.value).toContain('ALCOVE_PRIVATE_LABELLED_NAME_');
    expect(restorePrivateText(first.value, first.receipt)).toBe(raw);

    // A JSON restart preserves the receipt and therefore the exact same token.
    const restarted = JSON.parse(JSON.stringify(first.receipt));
    const repeated = obfuscatePrivateText(
      `Please email alice@example.org again.`,
      restarted,
      '2026-08-12T08:05:00.000Z',
    );
    const emailToken = first.receipt.entries.find((entry) => entry.kind === 'email')!
      .placeholder;
    expect(repeated.value).toContain(emailToken);
    expect(repeated.receipt.entries.filter((entry) => entry.kind === 'email')).toHaveLength(1);
    const notebookSyntax = '::page\n::let name = "Ada"\n::: card\n:::';
    expect(obfuscatePrivateText(notebookSyntax, first.receipt, NOW).value)
      .toBe(notebookSyntax);
  });

  it('does not touch identifiers, anchors or schemas while masking structured prose', () => {
    const receipt = createAgentTextPrivacyReceipt({ namespace: 'tool-json', now: NOW });
    const structured: AgentJsonValue = {
      pageId: 'page-550e8400-e29b-41d4-a716-446655440000',
      documentDigest: '550e8400-e29b-41d4-a716-446655440000',
      anchor: {
        sourceId: 'source-1',
        unitId: 'unit-1',
        pageNumber: 4,
      },
      clientName: 'Alice Example',
      body: 'Email alice@example.org on 2026-08-12.',
      accessToken: 'provider-secret-token-123',
      billing: 'Card: 4111 1111 1111 1111',
      avoid: 'Do not show alice@example.org in a cluttered grid.',
      grid: 'alice@example.org',
      valid: 'alice@example.org',
      sourceIds: ['source-1'],
    };
    const transformed = obfuscatePrivateJson(structured, receipt, NOW);
    expect(transformed.value).toMatchObject({
      pageId: 'page-550e8400-e29b-41d4-a716-446655440000',
      documentDigest: '550e8400-e29b-41d4-a716-446655440000',
      anchor: { sourceId: 'source-1', unitId: 'unit-1', pageNumber: 4 },
      sourceIds: ['source-1'],
    });
    expect(JSON.stringify(transformed.value)).not.toContain('Alice Example');
    expect(JSON.stringify(transformed.value)).not.toContain('alice@example.org');
    expect(JSON.stringify(transformed.value)).not.toContain('provider-secret-token-123');
    expect(JSON.stringify(transformed.value)).not.toContain('4111 1111 1111 1111');
    expect((transformed.value as Record<string, AgentJsonValue>).avoid)
      .toContain('ALCOVE_PRIVATE_EMAIL_');
    expect((transformed.value as Record<string, AgentJsonValue>).grid)
      .toContain('ALCOVE_PRIVATE_EMAIL_');
    expect((transformed.value as Record<string, AgentJsonValue>).valid)
      .toContain('ALCOVE_PRIVATE_EMAIL_');

    const request: AgentProviderTurnRequest = {
      requestId: 'provider-request-1',
      runId: 'run-1',
      threadId: 'thread-1',
      systemPrompt: 'System anchor page-550e8400-e29b-41d4-a716-446655440000',
      messages: [{
        role: 'tool',
        toolCallId: 'call-1',
        toolName: 'inspect_page',
        content: [{ type: 'text', text: JSON.stringify(structured) }],
      }],
      tools: [{
        name: 'inspect_page',
        description: 'Inspect one page',
        effect: 'read',
        inputSchema: {
          type: 'object',
          properties: { pageId: { type: 'string' } },
          required: ['pageId'],
        },
      }],
      toolChoice: 'required',
    };
    const provider = obfuscateProviderRequest(request, receipt, NOW).value;
    expect(provider.requestId).toBe(request.requestId);
    expect(provider.systemPrompt).toBe(request.systemPrompt);
    expect(provider.messages[0]?.toolCallId).toBe('call-1');
    expect(provider.messages[0]?.toolName).toBe('inspect_page');
    expect(provider.tools).toEqual(request.tools);
    expect(JSON.stringify(provider.messages)).not.toContain('Alice Example');
    expect(JSON.stringify(provider.messages)).not.toContain('alice@example.org');
    expect(JSON.stringify(provider.messages)).not.toContain('provider-secret-token-123');
    expect(JSON.stringify(provider.messages)).not.toContain('4111 1111 1111 1111');
  });

  it('restores placeholders split across streamed chunks and leaves unknown tokens alone', () => {
    const transformed = obfuscatePrivateText(
      'Email alice@example.org for details.',
      createAgentTextPrivacyReceipt({ namespace: 'streaming', now: NOW }),
      NOW,
    );
    const token = transformed.receipt.entries[0]!.placeholder;
    const stream = new AgentPrivateTextStreamRestorer(transformed.receipt);
    const split = Math.floor(token.length / 2);
    const output = [
      stream.push(`Answer: ${token.slice(0, split)}`),
      stream.push(`${token.slice(split)} now.`),
      stream.flush(),
    ].join('');
    expect(output).toBe('Answer: alice@example.org now.');
    expect(restorePrivateText('⟦ALCOVE_PRIVATE_EMAIL_UNKNOWN_0001⟧', transformed.receipt))
      .toBe('⟦ALCOVE_PRIVATE_EMAIL_UNKNOWN_0001⟧');
    expect(restorePrivateText('alice@example.org', undefined)).toBe('alice@example.org');
  });

  it('restores reader-visible plan and question fields while keeping model history masked', async () => {
    const transformed = obfuscatePrivateText(
      'Email alice@example.org for details.',
      createAgentTextPrivacyReceipt({ namespace: 'presentation', now: NOW }),
      NOW,
    );
    const token = transformed.receipt.entries[0]!.placeholder;
    const identity = {
      taskId: 'presentation-task',
      threadId: 'presentation-thread',
      runId: 'presentation-run',
      bookId: 'book-1',
    };
    const initial = createInitialAgentState({
      identity,
      goal: transformed.value,
      now: NOW,
      userMessageId: 'presentation-user',
    });
    const state: AgentState = {
      ...initial,
      lifecycle: 'running',
      textPrivacy: transformed.receipt,
      modelHistory: [{
        id: 'masked-user-turn',
        role: 'user',
        content: transformed.value,
        createdAt: NOW,
      }],
    };
    let nextId = 0;
    const tools = new AgentToolCatalog(
      {
        clock: { now: () => NOW },
        ids: { create: (prefix) => `${prefix}-${++nextId}` },
      } as AgentAdapters,
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const planned = await tools.execute(state, {
      id: 'plan-private',
      name: 'set_plan',
      arguments: {
        summary: `Help ${token}`,
        steps: [{
          id: 'step-private',
          title: `Contact ${token}`,
          description: `Use ${token} only in the local display`,
        }],
      },
    }, new AbortController().signal);
    expect(planned.state.plan).toMatchObject({
      summary: 'Help alice@example.org',
      steps: [{
        id: 'step-private',
        title: 'Contact alice@example.org',
        description: 'Use alice@example.org only in the local display',
      }],
    });
    expect(JSON.stringify(planned.state.modelHistory)).toContain(token);
    expect(JSON.stringify(planned.state.modelHistory)).not.toContain('alice@example.org');

    const asked = await tools.execute(planned.state, {
      id: 'ask-private',
      name: 'ask_user',
      arguments: {
        kind: 'requirements',
        question: `May I mention ${token}?`,
        context: `This changes how ${token} appears.`,
      },
    }, new AbortController().signal);
    expect(asked.interrupt).toMatchObject({
      kind: 'requirements',
      title: 'A quick question',
      questions: [{
        id: 'ask-private',
        prompt: 'This changes how alice@example.org appears.\n\nMay I mention alice@example.org?',
      }],
    });
    expect(JSON.stringify(asked.interrupt)).not.toContain(token);
    expect(asked.state.conversation.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'This changes how alice@example.org appears.\n\nMay I mention alice@example.org?',
    });

    const mutated = token.replace(/0001(?=⟧$)/u, '0002');
    const rejected = await tools.execute(state, {
      id: 'plan-mutated-private',
      name: 'set_plan',
      arguments: {
        summary: `Help ${mutated}`,
        steps: [{ id: 'step-mutated', title: 'Try again' }],
      },
    }, new AbortController().signal);
    expect(rejected.result).toMatchObject({
      error: expect.stringMatching(/placeholder was changed.*verbatim/i),
    });
    const malformed = token.replace(/0001⟧$/u, 'XXXX');
    const malformedResult = await tools.execute(state, {
      id: 'plan-malformed-private',
      name: 'set_plan',
      arguments: {
        summary: `Help ${malformed}`,
        steps: [{ id: 'step-malformed', title: 'Try again' }],
      },
    }, new AbortController().signal);
    expect(malformedResult.result).toMatchObject({
      error: expect.stringMatching(/placeholder was changed.*verbatim/i),
    });
    // A lookalike from another task namespace is ordinary literal prose and
    // must not be treated as this task's private mapping.
    const foreign = await tools.execute(state, {
      id: 'plan-foreign-private',
      name: 'set_plan',
      arguments: {
        summary: 'Explain ⟦ALCOVE_PRIVATE_EMAIL_OTHERSPACE_0001⟧ literally',
        steps: [{ id: 'step-foreign', title: 'Explain literal token' }],
      },
    }, new AbortController().signal);
    expect(foreign.result).not.toHaveProperty('error');
  });

  it('is absent by default, survives task restart, and never sends raw text when enabled', async () => {
    class CapturingProvider implements AgentProvider {
      readonly id = 'capture';
      readonly requests: AgentProviderTurnRequest[] = [];

      capabilities(): Promise<AgentProviderCapabilities> {
        return Promise.resolve({
          providerId: 'capture',
          modelId: 'capture',
          toolUse: true,
          streaming: true,
          imageInput: true,
          maxInputTokens: 32_000,
          maxOutputTokens: 4_000,
          supportsParallelToolCalls: false,
        });
      }

      async *streamTurn(request: AgentProviderTurnRequest): AsyncIterable<AgentProviderStreamEvent> {
        this.requests.push(request);
        yield {
          type: 'tool_call',
          id: `call-${this.requests.length}`,
          name: 'ask_user',
          arguments: {
            kind: 'requirements',
            question: 'What should I do next?',
            context: null,
          },
        };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    }

    const manifest = emptyManifest();
    const adapters: AgentAdapters = {
      clock: { now: () => NOW },
      ids: { create: (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}` },
      hash,
      notebook: {
        inspectNotebook: async (bookId) => ({
          title: 'Book',
          snapshot: {
            bookId,
            bookRevision: 'book-revision',
            pageIds: [],
            pageRevisions: {},
            capturedAt: NOW,
          },
          pages: [],
        }),
        inspectPage: async () => { throw new Error('unused'); },
        inspectPageRange: async () => [],
        inspectSelection: async () => null,
      },
      ingestion: { ingest: async () => manifest },
      sources: {
        getManifest: async () => manifest,
        getSource: async () => null,
        readUnitRange: async () => { throw new Error('unused'); },
        readFullSource: async () => { throw new Error('unused'); },
      },
      retrieval: {
        ensureIndexed: async () => [],
        search: async () => [],
        rerank: async (_query, candidates) => candidates,
      },
      sandbox: {
        validate: async () => { throw new Error('unused'); },
        render: async () => { throw new Error('unused'); },
        getGeneration: async () => null,
        dispose: async () => undefined,
      },
    };

    const rawProvider = new CapturingProvider();
    await new AgentRuntime(rawProvider, adapters, new InMemoryAgentPersistence()).start({
      bookId: 'book-1',
      goal: 'Email alice@example.org about this.',
    });
    expect(JSON.stringify(rawProvider.requests[0])).toContain('alice@example.org');

    const maskedProvider = new CapturingProvider();
    const persistence = new InMemoryAgentPersistence();
    const runtime = new AgentRuntime(maskedProvider, adapters, persistence);
    const result = await runtime.start({
      taskId: 'privacy-task',
      threadId: 'privacy-thread',
      runId: 'privacy-run',
      bookId: 'book-1',
      goal: 'Email alice@example.org about this.',
      obfuscatePrivateText: true,
    });
    expect(JSON.stringify(maskedProvider.requests[0])).not.toContain('alice@example.org');
    expect(JSON.stringify(maskedProvider.requests[0])).toContain('ALCOVE_PRIVATE_EMAIL_');
    expect(maskedProvider.requests[0]?.systemPrompt).toContain('PRIVACY PLACEHOLDERS');
    expect(result.state.conversation[0]?.text).toContain('alice@example.org');

    const restarted = new AgentRuntime(maskedProvider, adapters, persistence);
    const restored = await restarted.restore('privacy-task');
    expect(restored.state?.textPrivacy).toEqual(result.state.textPrivacy);
  });

  it('masks exact surrounding-page text before the disposable model-review render', async () => {
    const rawDocument = {
      type: 'doc' as const,
      content: [{
        type: 'paragraph',
        attrs: { blockId: 'stable-block-id' },
        content: [{ type: 'text', text: 'Client: Alice Example · alice@example.org' }],
      }],
    };
    const documentDigest = await hash.digestJson(rawDocument);
    const transformed = obfuscatePrivateText(
      '# Added note\n\nEmail alice@example.org.',
      createAgentTextPrivacyReceipt({ namespace: 'target-page', now: NOW }),
      NOW,
    );
    const draftHash = await hash.digestText(transformed.value);
    const seenTargets: unknown[] = [];
    const manifest = emptyManifest();
    const adapters: AgentAdapters = {
      clock: { now: () => NOW },
      ids: { create: (prefix) => `${prefix}-1` },
      hash,
      notebook: {
        inspectNotebook: async () => { throw new Error('unused'); },
        inspectPage: async () => ({
          pageId: 'page-private',
          ordinal: 0,
          revision: 'page-private-revision',
          plainText: 'Client: Alice Example · alice@example.org',
          scriptSource: 'Client: Alice Example · alice@example.org',
          documentDigest,
          document: rawDocument,
        }),
        inspectPageRange: async () => [],
        inspectSelection: async () => null,
      },
      ingestion: { ingest: async () => manifest },
      sources: {
        getManifest: async () => manifest,
        getSource: async () => null,
        readUnitRange: async () => { throw new Error('unused'); },
        readFullSource: async () => { throw new Error('unused'); },
      },
      retrieval: {
        ensureIndexed: async () => [],
        search: async () => [],
        rerank: async (_query, candidates) => candidates,
      },
      sandbox: {
        validate: async (draft, context) => {
          seenTargets.push(context.targetPage);
          return {
            draftHash: draft.draftHash,
            parserDiagnostics: [], staticDiagnostics: [], imageDiagnostics: [],
            pageLedgerDiagnostics: [], valid: true, checkedAt: NOW,
          };
        },
        render: async (draft, context) => {
          seenTargets.push(context.targetPage);
          return generation({
            draftHash: draft.draftHash,
            generationId: 'masked-target-generation',
            resourceId: 'masked-target-pixels',
          });
        },
        getGeneration: async () => null,
        dispose: async () => undefined,
      },
    };
    const identity = {
      taskId: 'masked-target-task', threadId: 'masked-target-thread',
      runId: 'masked-target-run', bookId: 'book-1',
    };
    const initial = createInitialAgentState({
      identity, goal: 'Insert notes for Alice Example', now: NOW,
      userMessageId: 'masked-target-message',
    });
    const state: AgentState = {
      ...initial,
      lifecycle: 'running',
      textPrivacy: transformed.receipt,
      sourceManifest: manifest,
      sourceCoverage: createSourceCoverageLedger(manifest, 'relevant', NOW),
      notebookSnapshot: {
        bookId: 'book-1', bookRevision: 'book-revision',
        pageIds: ['page-private'],
        pageRevisions: { 'page-private': 'page-private-revision' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'caret', pageId: 'page-private', position: 1 },
      draft: {
        runId: identity.runId, version: 1, script: transformed.value, draftHash,
        sourceManifestDigest: manifest.digest, createdAt: NOW,
      },
    };
    const tools = new AgentToolCatalog(
      adapters,
      new AgentEventBus(identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const validated = await tools.execute(state, {
      id: 'validate-masked-target', name: 'validate_notebook_script', arguments: {},
    }, new AbortController().signal);
    const rendered = await tools.execute(validated.state, {
      id: 'render-masked-target', name: 'render_draft_preview', arguments: {},
    }, new AbortController().signal);
    expect(rendered.result).not.toHaveProperty('error');
    expect(seenTargets).toHaveLength(2);
    for (const target of seenTargets) {
      const serialized = JSON.stringify(target);
      expect(serialized).not.toContain('Alice Example');
      expect(serialized).not.toContain('alice@example.org');
      expect(serialized).toContain('ALCOVE_PRIVATE_');
      expect(serialized).toContain('stable-block-id');
    }
  });

  it('keeps model-review renders masked, then locally restores, revalidates, previews and applies exact text', async () => {
    const rawScript = [
      '# Client',
      '',
      'Name: Alice Example',
      '',
      'Email alice@example.org.',
      '',
      '![Friendly study portrait](){placeholder="upload the finished study portrait", width=48}',
    ].join('\n');
    const transformed = obfuscatePrivateText(
      rawScript,
      createAgentTextPrivacyReceipt({ namespace: 'end-to-end', now: NOW }),
      NOW,
    );
    const maskedHash = await hash.digestText(transformed.value);
    const maskedPrompt = obfuscatePrivateText(
      'Create a warm study portrait. Client: Alice Example. No lettering or watermarks.',
      transformed.receipt,
      NOW,
    );
    const maskedGeneration = generation({
      draftHash: maskedHash,
      generationId: 'masked-generation',
      resourceId: 'masked-review-pixels',
    });
    const finalRenders: string[] = [];
    const disposedGenerations: string[] = [];
    let rejectRestoredLayout = true;
    const receipts = new Map<string, Awaited<ReturnType<typeof createReviewedDraftReceipt>>>();
    const receiptStore: ReviewedDraftReceiptStore = {
      get: async (id) => receipts.get(id) ?? null,
      put: async (receipt) => { receipts.set(receipt.generationId, receipt); },
      delete: async (id) => { receipts.delete(id); },
    };
    const manifest = emptyManifest();
    const adapters: AgentAdapters = {
      clock: { now: () => NOW },
      ids: { create: (prefix) => `${prefix}-${Math.random().toString(36).slice(2)}` },
      hash,
      notebook: {
        inspectNotebook: async (bookId) => ({
          title: 'Book',
          snapshot: {
            bookId,
            bookRevision: 'book-revision',
            pageIds: [],
            pageRevisions: {},
            capturedAt: NOW,
          },
          pages: [],
        }),
        inspectPage: async () => { throw new Error('unused'); },
        inspectPageRange: async () => [],
        inspectSelection: async () => null,
      },
      ingestion: { ingest: async () => manifest },
      sources: {
        getManifest: async () => manifest,
        getSource: async () => null,
        readUnitRange: async () => { throw new Error('unused'); },
        readFullSource: async () => { throw new Error('unused'); },
      },
      retrieval: {
        ensureIndexed: async () => [],
        search: async () => [],
        rerank: async (_query, candidates) => candidates,
      },
      sandbox: {
        validate: async (draft) => ({
          draftHash: draft.draftHash,
          parserDiagnostics: [],
          staticDiagnostics: [],
          imageDiagnostics: [],
          pageLedgerDiagnostics: [],
          valid: true,
          checkedAt: NOW,
        }),
        render: async (draft) => {
          finalRenders.push(draft.script);
          const next = generation({
            draftHash: draft.draftHash,
            generationId: 'restored-generation',
            resourceId: 'restored-final-pixels',
          });
          const rendered = rejectRestoredLayout
            ? { ...next, layoutValid: false }
            : next;
          const receipt = await createReviewedDraftReceipt({
            version: 2,
            generationId: next.generationId,
            draftHash: next.draftHash,
            layoutHash: next.layoutHash,
            bookSnapshotRevision: next.bookSnapshotRevision,
            rendererVersion: next.rendererVersion,
            applicationPlan: {
              kind: 'structural_pages',
              insertionTarget: { kind: 'book_end' },
            },
            pages: [{
              source: draft.script,
              protectedStart: true,
              doc: {
                type: 'doc',
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: draft.script }],
                }],
              },
            }],
            fetchedAssets: [],
          }, hash);
          await receiptStore.put(receipt);
          return rendered;
        },
        getGeneration: async () => null,
        dispose: async (generationId) => { disposedGenerations.push(generationId); },
      },
    };
    const identity = {
      taskId: 'privacy-proposal-task',
      threadId: 'privacy-proposal-thread',
      runId: 'privacy-proposal-run',
      bookId: 'book-1',
    };
    const initial = createInitialAgentState({
      identity,
      goal: 'Make notes with an illustration for Alice Example',
      now: NOW,
      userMessageId: 'user-1',
    });
    const exposed = recordVisualImageExposures(
      createVisualReviewLedger(maskedGeneration, NOW),
      maskedGeneration,
      maskedGeneration.pages,
      { now: NOW, providerCallCount: 1 },
    );
    const reviewed = recordVisualInspection(exposed, maskedGeneration, {
      pageIds: maskedGeneration.pages.map((page) => page.pageId),
      findings: [],
      providerCallCount: 2,
      now: NOW,
    });
    const state: AgentState = {
      ...initial,
      lifecycle: 'running',
      textPrivacy: maskedPrompt.receipt,
      notebookSnapshot: {
        bookId: 'book-1',
        bookRevision: 'book-revision',
        pageIds: [],
        pageRevisions: {},
        capturedAt: NOW,
      },
      sourceManifest: manifest,
      sourceCoverage: createSourceCoverageLedger(manifest, 'relevant', NOW),
      insertionTarget: { kind: 'book_end' },
      draft: {
        runId: identity.runId,
        version: 1,
        script: transformed.value,
        draftHash: maskedHash,
        sourceManifestDigest: manifest.digest,
        createdAt: NOW,
      },
      imagePromptHandoff: buildImagePromptHandoff({
        draftHash: maskedHash,
        script: transformed.value,
        prompts: [{
          slotId: 'page-1-image-1',
          role: 'concept_illustration',
          aspect: 'portrait_4_5',
          prompt: maskedPrompt.value,
          avoid: 'tiny lettering',
        }],
        now: NOW,
      }),
      validation: {
        draftHash: maskedHash,
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
      previewGeneration: maskedGeneration,
      visualReview: reviewed,
      usage: { ...initial.usage, providerCalls: 3 },
    };
    // These are the immutable pixels that crossed to model review: their
    // originating draft contains no restored private value.
    expect(state.draft?.script).not.toContain('Alice Example');
    expect(state.draft?.script).not.toContain('alice@example.org');
    expect(state.visualReview?.imageExposures[0]?.imageResourceId)
      .toBe('masked-review-pixels');

    const persistence = new InMemoryAgentPersistence();
    const tools = new AgentToolCatalog(
      adapters,
      new AgentEventBus(identity, persistence, () => NOW),
    );
    const rejected = await tools.execute(state, {
      id: 'rejected-proposal-call',
      name: 'propose_notebook_patch',
      arguments: { request: 'current' },
    }, new AbortController().signal);
    expect(rejected.state.patchProposal).toBeUndefined();
    expect(disposedGenerations).toEqual(['restored-generation']);
    // A rejected exact-text render is destroyed before any state checkpoint
    // can own it. Retry from the still-valid masked review with a good layout.
    rejectRestoredLayout = false;
    finalRenders.length = 0;
    disposedGenerations.length = 0;
    const proposed = await tools.execute(state, {
      id: 'proposal-call',
      name: 'propose_notebook_patch',
      arguments: { request: 'current' },
    }, new AbortController().signal);
    expect(
      proposed.state.patchProposal,
      JSON.stringify(proposed.result),
    ).toBeDefined();
    const proposal = proposed.state.patchProposal!;

    expect(finalRenders).toEqual([rawScript]);
    expect(proposal.script).toBe(rawScript);
    expect(proposal.preview.generationId).toBe('restored-generation');
    expect(proposal.preview.validation.valid).toBe(true);
    expect(proposal.preview.pages[0]?.image.resourceId).toBe('restored-final-pixels');
    expect(proposal.preview.imageGenerationPrompts[0]?.prompt).toContain('Alice Example');
    expect(proposal.preview.imageGenerationPrompts[0]?.prompt).not.toContain('ALCOVE_PRIVATE_');

    const application = await prepareAiProposalApplication(proposal, {
      receiptStore,
      hash,
      promoteAssets: async () => undefined,
    });
    expect(application.pages[0]?.source).toBe(rawScript);
    expect(JSON.stringify(application.pages[0]?.doc)).toContain('Alice Example');
    expect(JSON.stringify(application.pages[0]?.doc)).toContain('alice@example.org');
    expect(JSON.stringify(application.pages[0]?.doc)).not.toContain('ALCOVE_PRIVATE_');

    // Ownership is dropped only after exact-text pixels are gone. If the
    // following checkpoint save crashes, restart still has the old durable
    // reference and can safely retry cleanup instead of leaking an orphan.
    const crashBacking = new InMemoryAgentPersistence();
    await crashBacking.saveTask(proposed.state);
    const crashOrder: string[] = [];
    const crashPersistence = {
      checkpointer: crashBacking.checkpointer,
      loadTask: (taskId: string) => crashBacking.loadTask(taskId),
      saveTask: async (next: AgentState) => {
        if (next.localRestoredFinal === undefined) {
          crashOrder.push('save-cleared-state');
          throw new Error('simulated checkpoint crash');
        }
        await crashBacking.saveTask(next);
      },
      deleteTask: (taskId: string) => crashBacking.deleteTask(taskId),
      tombstoneTask: (taskId: string, threadId: string) =>
        crashBacking.tombstoneTask!(taskId, threadId),
      appendEvent: (event: Parameters<typeof crashBacking.appendEvent>[0]) =>
        crashBacking.appendEvent(event),
      listEvents: (taskId: string, afterSequence?: number) =>
        crashBacking.listEvents(taskId, afterSequence),
    };
    const crashRuntime = new AgentRuntime(
      {
        id: 'unused-crash-provider',
        capabilities: async () => ({
          providerId: 'unused', modelId: 'unused', toolUse: true, streaming: true,
          imageInput: false, maxInputTokens: 1, maxOutputTokens: 1,
          supportsParallelToolCalls: false,
        }),
        async *streamTurn(): AsyncIterable<AgentProviderStreamEvent> {
          throw new Error('unused');
        },
      },
      {
        ...adapters,
        sandbox: {
          ...adapters.sandbox,
          dispose: async (generationId) => {
            crashOrder.push(`dispose:${generationId}`);
          },
        },
      },
      crashPersistence,
    );
    await crashRuntime.restore('privacy-proposal-task');
    await expect(crashRuntime.sendUserMessage('Revise it'))
      .rejects.toThrow('simulated checkpoint crash');
    expect(crashOrder).toEqual([
      'dispose:restored-generation',
      'save-cleared-state',
    ]);
    expect((await crashBacking.loadTask('privacy-proposal-task'))?.state.localRestoredFinal)
      .toBeDefined();

    // Even an identical script is stale when attached evidence changes. It
    // must drop the old proposal, exact final and citation intent.
    const changedManifest = { ...manifest, digest: 'changed-manifest' };
    disposedGenerations.length = 0;
    const resubmitted = await tools.execute({
      ...proposed.state,
      lifecycle: 'running',
      sourceManifest: changedManifest,
      sourceCoverage: createSourceCoverageLedger(changedManifest, 'relevant', NOW),
    }, {
      id: 'same-script-new-source-call',
      name: 'submit_notebook_script',
      arguments: {
        script: transformed.value,
        citedUnitIds: [],
        reason: 'repair',
      },
    }, new AbortController().signal);
    expect(resubmitted.result).not.toHaveProperty('error');
    expect(resubmitted.state.patchProposal).toBeUndefined();
    expect(resubmitted.state.localRestoredFinal).toBeUndefined();
    expect(resubmitted.state.sourceCoverage?.citedUnitIds).toEqual([]);
    expect(disposedGenerations).toEqual(['restored-generation']);
    disposedGenerations.length = 0;

    // Delete owns both the model-reviewed masked generation and the distinct
    // restored approval generation. The patch preview aliases the latter and
    // must not cause a duplicate disposal.
    await persistence.saveTask(proposed.state);
    const unusedProvider: AgentProvider = {
      id: 'unused',
      capabilities: async () => ({
        providerId: 'unused',
        modelId: 'unused',
        toolUse: true,
        streaming: true,
        imageInput: false,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        supportsParallelToolCalls: false,
      }),
      async *streamTurn(): AsyncIterable<AgentProviderStreamEvent> {
        throw new Error('unused');
      },
    };
    await new AgentRuntime(unusedProvider, adapters, persistence)
      .deleteTask('privacy-proposal-task');
    expect(disposedGenerations.sort()).toEqual([
      'masked-generation',
      'restored-generation',
    ]);
  });
});
