import { describe, expect, it } from 'vitest';

import type { AgentAdapters } from '../src/features/aiAgent/adapters';
import {
  notebookCraftDiagnostics,
  notebookCraftPreference,
  notebookCraftProfile,
  normalizeNotebookScriptSubmission,
  withNotebookCraftValidation,
} from '../src/features/aiAgent/draftCraft';
import { AgentEventBus } from '../src/features/aiAgent/events';
import { InMemoryAgentPersistence } from '../src/features/aiAgent/persistence';
import { buildAgentSystemPrompt } from '../src/features/aiAgent/prompts';
import { AgentToolCatalog } from '../src/features/aiAgent/tools';
import {
  createInitialAgentState,
  type AgentState,
  type NotebookScriptValidation,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-14T09:09:55.537Z';

const KIRBY_BULLETS = [
  '# Kirby',
  '',
  '- **Origin:** Dream Land',
  '- **Abilities:** inhales enemies and copies powers',
  '- **Personality:** cheerful and determined',
  '',
  '::page',
  '',
  '# The Powerpuff Girls',
  '',
  '- **Origin:** Townsville',
  '- **Abilities:** fly and use innate superpowers',
  '- **Personality:** a team with distinct strengths',
  '',
  '::page',
  '',
  '# Key differences',
  '',
  '- Kirby adapts by copying powers',
  '- The Powerpuff Girls coordinate as a team',
].join('\n');

const KIRBY_COMPOSED = [
  '# Kirby vs. the Powerpuff Girls',
  '',
  '::: callout {variant=info}',
  '**Big idea:** Kirby adapts; the girls coordinate.',
  ':::',
  '',
  '::page',
  '',
  '# Side by side',
  '',
  '::: columns',
  '::: col',
  '## Kirby',
  'Copies powers from opponents.',
  ':::',
  '::: col',
  '## Powerpuff Girls',
  'Combine three innate power sets.',
  ':::',
  ':::',
  '',
  '::page',
  '',
  '# Key differences',
  '',
  '| Lens | Kirby | Powerpuff Girls |',
  '| --- | --- | --- |',
  '| Power source | Copied | Innate |',
  '| Team shape | Usually solo | Trio |',
].join('\n');

function state(goal = 'Add the Kirby comparison to my book'): AgentState {
  return createInitialAgentState({
    identity: {
      threadId: 'thread-craft',
      taskId: 'task-craft',
      runId: 'run-craft',
      bookId: 'book-craft',
    },
    goal,
    now: NOW,
    userMessageId: 'reader-craft',
  });
}

function validation(draftHash = 'draft-craft'): NotebookScriptValidation {
  return {
    draftHash,
    parserDiagnostics: [],
    staticDiagnostics: [],
    imageDiagnostics: [],
    pageLedgerDiagnostics: [],
    valid: true,
    checkedAt: NOW,
  };
}

function unreachable(): never {
  throw new Error('not used by this craft test');
}

function adapters(): AgentAdapters {
  return {
    clock: { now: () => NOW },
    ids: { create: (prefix) => `${prefix}-craft` },
    hash: {
      digestText: async (text) => `hash:${text}`,
      digestJson: async (value) => `hash:${JSON.stringify(value)}`,
    },
    notebook: {
      inspectNotebook: async () => unreachable(),
      inspectPage: async () => unreachable(),
      inspectPageRange: async () => unreachable(),
      inspectSelection: async () => unreachable(),
    },
    ingestion: { ingest: async () => unreachable() },
    sources: {
      getManifest: async () => unreachable(),
      getSource: async () => unreachable(),
      readUnitRange: async () => unreachable(),
      readFullSource: async () => unreachable(),
    },
    retrieval: {
      ensureIndexed: async () => unreachable(),
      search: async () => unreachable(),
      rerank: async () => unreachable(),
    },
    sandbox: {
      validate: async (draft) => validation(draft.draftHash),
      render: async () => unreachable(),
      getGeneration: async () => unreachable(),
      dispose: async () => undefined,
    },
  };
}

describe('AI notebook semantic craft gate', () => {
  it('tells the provider about the semantic floor, plain-mode escape hatch and raw-script envelope', () => {
    const prompt = buildAgentSystemPrompt(state());
    expect(prompt).toContain('deterministic craft check enforces a small semantic floor');
    expect(prompt).toContain('at least two distinct editorial roles');
    expect(prompt).toContain('Explicit requests for plain, minimal, bullets-only, as-is or verbatim pages bypass');
    expect(prompt).toContain('never permit wrapping the complete Notebook Script in an outer code fence');
    expect(prompt).toContain('image slots remain explicit-request-only');
  });

  it('rejects the exact three-page heading-and-bullet template with actionable repair facts', () => {
    const current = state();
    const profile = notebookCraftProfile(KIRBY_BULLETS);
    expect(profile).toMatchObject({
      pageCount: 3,
      features: [],
      roles: [],
      featuredPageNumbers: [],
    });

    const checked = withNotebookCraftValidation(
      validation(),
      KIRBY_BULLETS,
      current,
    );
    expect(checked.valid).toBe(false);
    expect(checked.staticDiagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'craft.semantic-variety-required',
        message: expect.stringMatching(/3-page draft uses 0.*at least 2 structures.*2 different roles.*across 2 pages/isu),
      }),
    ]);
    expect(checked.staticDiagnostics[0]?.message).toMatch(/compact table or parallel columns/iu);
    expect(checked.staticDiagnostics[0]?.message).toMatch(/image placeholders.*must stay absent/iu);
  });

  it('passes a composed comparison whose native structures serve distinct meanings', () => {
    const profile = notebookCraftProfile(KIRBY_COMPOSED);
    expect(profile).toMatchObject({
      pageCount: 3,
      roles: ['comparison', 'focus', 'parallel'],
      featuredPageNumbers: [1, 2, 3],
    });
    expect(profile.features.map((feature) => feature.kind)).toEqual([
      'container:callout',
      'container:columns',
      'table',
    ]);
    expect(notebookCraftDiagnostics(KIRBY_COMPOSED, state())).toEqual([]);
  });

  it('honours explicit plain, bullets-only and verbatim requests without weakening ordinary source preservation', () => {
    for (const request of [
      'Make these pages minimal and plain.',
      'Keep it minimal.',
      'Use only bullets.',
      'Insert this verbatim, word-for-word.',
    ]) {
      const current = state(request);
      expect(notebookCraftPreference(current)).toBe('plain');
      expect(notebookCraftDiagnostics(KIRBY_BULLETS, current)).toEqual([]);
    }

    const preserveFacts = state('Preserve every fact and detail, then add these notes to my book.');
    expect(notebookCraftPreference(preserveFacts)).toBe('composed');
    expect(notebookCraftDiagnostics(KIRBY_BULLETS, preserveFacts)).toHaveLength(1);
  });

  it('does not mistake a negated plain style for permission to emit boring pages', () => {
    for (const request of [
      "Don't leave it plain—make it visual and engaging.",
      'Make it not minimal; use diagrams.',
      'Do not use plain text, use a diagram.',
      'Anything but plain pages, please.',
    ]) {
      const current = state(request);
      expect(notebookCraftPreference(current), request).toBe('composed');
      expect(notebookCraftDiagnostics(KIRBY_BULLETS, current), request).toHaveLength(1);
    }
    for (const request of [
      'Do not use fancy cards; keep it plain.',
      'Do not redesign—keep it as plain text.',
    ]) {
      expect(notebookCraftPreference(state(request)), request).toBe('plain');
    }
  });

  it('treats plain text as an input type when the reader asks for composed pages', () => {
    for (const request of [
      'Turn this plain text into engaging notebook pages.',
      'I attached a plain text file; make polished notes.',
      'Format the plain text using cards and tables.',
    ]) {
      expect(notebookCraftPreference(state(request)), request).toBe('composed');
      expect(notebookCraftDiagnostics(KIRBY_BULLETS, state(request)), request).toHaveLength(1);
    }
    for (const request of [
      'Use only plain text.',
      'Keep the pages plain and minimal.',
      'Plain text only.',
      'Bullets only.',
      'Paragraphs only.',
      'Minimalist, please.',
      'Basic bullet points are fine.',
      'This plain text file includes a table. Keep the pages plain.',
      'The attached plain text file has cards listed; format it as plain text.',
      'This plain text document says engaging and playful. Keep it verbatim.',
    ]) {
      expect(notebookCraftPreference(state(request)), request).toBe('plain');
    }
  });

  it('does not confuse restrained source editing or plain language with plain layout', () => {
    for (const request of [
      'Keep content changes minimal, but make polished pages with callouts.',
      'Make minimal edits to the wording and use a visual table.',
      'Keep additions minimal; design the notes with cards.',
      'Use plain language and an engaging layout.',
    ]) {
      expect(notebookCraftPreference(state(request)), request).toBe('composed');
      expect(notebookCraftDiagnostics(KIRBY_BULLETS, state(request)), request).toHaveLength(1);
    }
  });

  it('lets the newest explicit style direction win in a conversational follow-up', () => {
    const initial = state('Make polished, engaging pages from this comparison.');
    const plain = {
      ...initial,
      conversation: [...initial.conversation, {
        id: 'reader-plain-follow-up',
        role: 'user' as const,
        text: 'Actually keep the page layout plain and minimal.',
        createdAt: NOW,
      }],
    };
    expect(notebookCraftPreference(plain)).toBe('plain');
    const composed = {
      ...plain,
      conversation: [...plain.conversation, {
        id: 'reader-composed-follow-up',
        role: 'user' as const,
        text: 'Now make it engaging with tables and callouts.',
        createdAt: NOW,
      }],
    };
    expect(notebookCraftPreference(composed)).toBe('composed');
  });

  it('does not count an empty portable image slot as semantic craft', () => {
    const script = KIRBY_BULLETS.replace(
      '- **Origin:** Dream Land',
      '![Kirby portrait](){placeholder="generate a Kirby portrait"}\n\n- **Origin:** Dream Land',
    );
    expect(notebookCraftProfile(script).features).toEqual([]);
    expect(notebookCraftDiagnostics(script, state())).toHaveLength(1);
  });

  it('detects a whole-note Markdown fence if a caller bypasses submit normalization', () => {
    const wrapped = `\`\`\`markdown\n${KIRBY_BULLETS}\n\`\`\``;
    const diagnostics = notebookCraftDiagnostics(wrapped, state('Insert this verbatim.'));
    expect(diagnostics).toEqual([expect.objectContaining({
      severity: 'error',
      code: 'craft.whole-script-code-fence',
      message: expect.stringMatching(/headings, emphasis, lists.*literal source text.*remove only the outer/iu),
    })]);
  });

  it('safely unwraps one explicit document fence while preserving every inner fence', () => {
    const raw = [
      '# Tiny graph',
      '',
      '- A relationship worth seeing',
      '',
      '```graph',
      'Kirby -> Copy ability',
      '```',
    ].join('\n');
    const wrapped = `\`\`\`\`markdown\n${raw}\n\`\`\`\``;
    expect(normalizeNotebookScriptSubmission(wrapped)).toEqual({
      script: raw,
      outerDocumentFenceRemoved: true,
    });
    expect(normalizeNotebookScriptSubmission(`\`\`\`\n${raw}\n\`\`\``)).toEqual({
      script: `\`\`\`\n${raw}\n\`\`\``,
      outerDocumentFenceRemoved: false,
    });
    for (const [wrappedDocument, body] of [
      ['```markdown\nOsmosis moves water across a membrane.\n```', 'Osmosis moves water across a membrane.'],
      ['```markdown\n# Osmosis\n\nWater crosses a membrane.\n```', '# Osmosis\n\nWater crosses a membrane.'],
      ['```notebook\n- Water moves from dilute to concentrated regions.\n```', '- Water moves from dilute to concentrated regions.'],
      ['~~~markdown\nOsmosis moves water.\n~~~', 'Osmosis moves water.'],
    ] as const) {
      expect(normalizeNotebookScriptSubmission(wrappedDocument)).toEqual({
        script: body,
        outerDocumentFenceRemoved: true,
      });
    }
  });

  it('keeps an intentional programming fence valid when it is actual page content', () => {
    const codePage = '# Python example\n\n```python\nprint("hello")\n```';
    expect(notebookCraftDiagnostics(codePage, state())).toEqual([]);
  });

  it('wires the craft failure into validate_notebook_script before a render can be advertised', async () => {
    const initial = state();
    const draftHash = 'draft-craft-hash';
    const ready = {
      ...initial,
      lifecycle: 'running' as const,
      notebookSnapshot: {
        bookId: initial.identity.bookId,
        bookRevision: 'book-revision-craft',
        pageIds: ['page-existing'],
        pageRevisions: { 'page-existing': 'page-revision-existing' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' as const },
      draft: {
        runId: initial.identity.runId,
        version: 1,
        script: KIRBY_BULLETS,
        draftHash,
        createdAt: NOW,
      },
    };
    const catalog = new AgentToolCatalog(
      adapters(),
      new AgentEventBus(initial.identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const result = await catalog.execute(ready, {
      id: 'validate-craft',
      name: 'validate_notebook_script',
      arguments: {},
    }, new AbortController().signal);

    expect(result.result).toMatchObject({ valid: false });
    expect(result.state.validation).toMatchObject({
      valid: false,
      staticDiagnostics: [expect.objectContaining({
        code: 'craft.semantic-variety-required',
      })],
    });
  });

  it('catches a one-section bullets draft when native pagination spills it to three real pages', async () => {
    const initial = state();
    const script = KIRBY_BULLETS.replace(/\n::page\n/gu, '\n\n');
    const draftHash = 'draft-native-spill';
    expect(notebookCraftProfile(script).pageCount).toBe(1);
    const ready = {
      ...initial,
      lifecycle: 'running' as const,
      notebookSnapshot: {
        bookId: initial.identity.bookId,
        bookRevision: 'book-revision-spill',
        pageIds: ['page-existing'],
        pageRevisions: { 'page-existing': 'page-revision-existing' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' as const },
      draft: {
        runId: initial.identity.runId,
        version: 1,
        script,
        draftHash,
        createdAt: NOW,
      },
      validation: validation(draftHash),
    };
    const base = adapters();
    const generation = {
      generationId: 'generation-native-spill',
      draftHash,
      layoutHash: 'layout-native-spill',
      rendererVersion: 'test',
      bookSnapshotRevision: ready.notebookSnapshot.bookRevision,
      createdAt: NOW,
      parserValid: true,
      layoutValid: true,
      stale: false,
      pageCount: 3,
      pages: [1, 2, 3].map((pageNumber) => ({
        pageId: `generation-native-spill:page:${pageNumber}`,
        pageNumber,
        width: 600,
        height: 800,
        image: {
          resourceId: `image-native-spill-${pageNumber}`,
          mimeType: 'image/png' as const,
          digest: `image-digest-${pageNumber}`,
          width: 600,
          height: 800,
        },
        textDigest: `text-digest-${pageNumber}`,
        layoutDigest: `layout-digest-${pageNumber}`,
        paginationSpill: pageNumber > 1,
        residualOverflow: false,
      })),
      diagnostics: [],
    };
    const catalog = new AgentToolCatalog(
      {
        ...base,
        sandbox: {
          ...base.sandbox,
          render: async () => generation,
        },
      },
      new AgentEventBus(initial.identity, new InMemoryAgentPersistence(), () => NOW),
    );

    const rendered = await catalog.execute(ready, {
      id: 'render-native-spill',
      name: 'render_draft_preview',
      arguments: {},
    }, new AbortController().signal);
    expect(rendered.result).toMatchObject({
      pageCount: 3,
      diagnostics: [expect.objectContaining({
        code: 'craft.semantic-variety-required',
      })],
    });
    expect(rendered.state.previewGeneration?.pageCount).toBe(3);
    expect(rendered.state.visualReview).toBeUndefined();
    expect(rendered.state.validation).toMatchObject({
      valid: false,
      staticDiagnostics: [expect.objectContaining({
        code: 'craft.semantic-variety-required',
        message: expect.stringMatching(/expanded.*to 3 real pages.*at least 2 structures.*2 different roles/isu),
      })],
    });

    // Re-running validation cannot forget the observed native page count and
    // reopen the same render loop; only a changed draft can clear it.
    const rechecked = await catalog.execute(rendered.state, {
      id: 'revalidate-native-spill',
      name: 'validate_notebook_script',
      arguments: {},
    }, new AbortController().signal);
    expect(rechecked.state.validation?.valid).toBe(false);
  });

  it('normalizes an exact outer document fence at the submit boundary without a repair turn', async () => {
    const initial = state();
    const catalog = new AgentToolCatalog(
      adapters(),
      new AgentEventBus(initial.identity, new InMemoryAgentPersistence(), () => NOW),
    );
    const wrapped = `\`\`\`markdown\n${KIRBY_COMPOSED}\n\`\`\``;
    const result = await catalog.execute(initial, {
      id: 'submit-wrapped-craft',
      name: 'submit_notebook_script',
      arguments: {
        script: wrapped,
        reason: 'initial',
        citedUnitIds: [],
      },
    }, new AbortController().signal);

    expect(result.result).toMatchObject({
      outerDocumentFenceRemoved: true,
      mutationPerformed: false,
    });
    expect(result.state.draft?.script).toBe(KIRBY_COMPOSED);
    expect(result.state.usage.repairPasses).toBe(0);
  });
});
