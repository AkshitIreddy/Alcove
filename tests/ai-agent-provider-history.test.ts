import { describe, expect, it } from 'vitest';
import {
  modelHistoryToProviderMessages,
  modelHistoryToProviderProjection,
} from '../src/features/aiAgent/provider';
import type {
  AgentImageRef,
  AgentJsonValue,
  AgentModelAssistantTurn,
  AgentModelToolCall,
  AgentModelToolTurn,
  AgentModelTurn,
  SourceManifest,
} from '../src/features/aiAgent/types';

const NOW = '2026-08-14T11:46:32.065Z';

function assistant(call: AgentModelToolCall, index: number): AgentModelAssistantTurn {
  return {
    id: `assistant-${index}`,
    role: 'assistant',
    content: index % 2 === 0 ? `Visible progress update ${index}.` : '',
    toolPlan: `Continue the safe notebook workflow ${index}.`,
    toolCalls: [call],
    createdAt: NOW,
  };
}

function tool(
  call: AgentModelToolCall,
  content: AgentJsonValue,
  index: number,
  imageRefs?: readonly AgentImageRef[],
): AgentModelToolTurn {
  return {
    id: `tool-${index}`,
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content,
    isError: false,
    ...(imageRefs === undefined
      ? {}
      : { imageRefs, imagePurpose: 'draft_visual_review' as const }),
    createdAt: NOW,
  };
}

function call(
  id: string,
  name: string,
  argumentsValue: AgentJsonValue,
): AgentModelToolCall {
  return { id, name, arguments: argumentsValue };
}

function callPairs(messages: ReturnType<typeof modelHistoryToProviderMessages>) {
  const calls = messages.flatMap((message) =>
    message.role === 'assistant'
      ? (message.toolCalls ?? []).map((item) => `${item.id}:${item.name}`)
      : [],
  );
  const results = messages.flatMap((message) =>
    message.role === 'tool'
      ? [`${message.toolCallId}:${message.toolName}`]
      : [],
  );
  return { calls, results };
}

describe('provider-only agent history compaction', () => {
  it('retains one exact current script and cuts repeated repair transport dramatically', () => {
    const sourceFact = `Grounded source fact: cats use their whiskers as tactile sensors.\n${'source-evidence '.repeat(700)}`;
    const history: AgentModelTurn[] = [
      {
        id: 'reader-original',
        role: 'user',
        content: 'Turn the cat explanation into polished notebook pages.',
        createdAt: NOW,
      },
      {
        id: 'reader-follow-up',
        role: 'user',
        content: 'Keep the science accurate and the explanation friendly.',
        createdAt: NOW,
      },
    ];

    const sourceCall = call('source-read', 'read_full_source', { sourceId: 'cats-source' });
    history.push(
      assistant(sourceCall, history.length),
      tool(sourceCall, {
        sourceId: 'cats-source',
        sourceDigest: 'source-digest',
        units: [{
          unitId: 'cats-unit-1',
          text: sourceFact,
          digest: 'cats-unit-1-digest',
          anchor: { sourceId: 'cats-source', unitId: 'cats-unit-1' },
        }],
        truncated: false,
      }, history.length),
    );

    let currentScript = '';
    let currentHash = '';
    for (let index = 0; index < 7; index += 1) {
      // The last two calls deliberately submit the same current draft, which
      // reproduces the unchanged-submit loop from the reader's diagnostic.
      const draftNumber = Math.min(index, 5);
      const script =
        `# Cat draft ${draftNumber}\n` +
        `unique-draft-${draftNumber}\n` +
        `${`Detailed cat note ${draftNumber}. `.repeat(750)}`;
      const draftHash = `draft-hash-${draftNumber}`;
      currentScript = script;
      currentHash = draftHash;
      const submit = call(`submit-${index}`, 'submit_notebook_script', {
        script,
        citedUnitIds: ['cats-unit-1'],
        reason: index === 0 ? 'initial' : 'repair',
      });
      history.push(
        assistant(submit, history.length),
        tool(submit, {
          draftVersion: draftNumber + 1,
          draftHash,
          mutationPerformed: index < 6,
          unchanged: index === 6,
        }, history.length),
      );
      const validate = call(`validate-${index}`, 'validate_notebook_script', {});
      history.push(
        assistant(validate, history.length),
        tool(validate, {
          draftHash,
          valid: true,
          diagnostics: Array.from({ length: 80 }, (_, diagnostic) => ({
            code: `historical-${index}-${diagnostic}`,
            message: `Verbose historical diagnostic ${'detail '.repeat(20)}`,
          })),
        }, history.length),
      );
    }

    const currentPreview = call(
      'current-preview-images',
      'read_draft_preview_pages',
      { pageNumbers: [1] },
    );
    const currentImage: AgentImageRef = {
      resourceId: 'current-page-render',
      mimeType: 'image/png',
      digest: 'current-page-render-digest',
      width: 900,
      height: 1200,
    };
    history.push(
      assistant(currentPreview, history.length),
      tool(currentPreview, {
        generationId: 'current-generation',
        draftHash: currentHash,
        pages: [{ pageNumber: 1, layoutDigest: 'current-layout' }],
      }, history.length, [currentImage]),
    );

    const original = modelHistoryToProviderMessages(history);
    const projection = modelHistoryToProviderProjection(history, {
      script: currentScript,
      draftHash: currentHash,
      version: 6,
    });

    expect(projection.compactedSubmitCalls).toBe(6);
    expect(projection.compactedToolResults).toBeGreaterThanOrEqual(12);
    expect(projection.projectedCharacters).toBeLessThan(
      projection.originalCharacters * 0.28,
    );
    expect(callPairs(projection.messages as typeof original)).toEqual(callPairs(original));

    const submitScripts = projection.messages.flatMap((message) =>
      message.role === 'assistant'
        ? (message.toolCalls ?? [])
            .filter((item) => item.name === 'submit_notebook_script')
            .map((item) => {
              const args = item.arguments as Readonly<Record<string, AgentJsonValue>>;
              return args.script;
            })
        : [],
    );
    expect(submitScripts.filter((script) => script === currentScript)).toHaveLength(1);
    expect(JSON.stringify(projection.messages)).not.toContain('unique-draft-0');
    const groundedSourceResult = projection.messages.find((message) =>
      message.role === 'tool' && message.toolCallId === 'source-read'
    );
    const groundedSourceText = groundedSourceResult?.content.find(
      (part) => part.type === 'text',
    );
    expect(groundedSourceText?.type === 'text'
      ? (JSON.parse(groundedSourceText.text) as {
          units: Array<{ text: string }>;
        }).units[0]?.text
      : undefined).toBe(sourceFact);
    expect(JSON.stringify(projection.messages)).toContain(
      'Keep the science accurate and the explanation friendly.',
    );

    const trailing = projection.messages.at(-1);
    expect(trailing).toMatchObject({
      role: 'tool',
      toolCallId: 'current-preview-images',
    });
    expect(trailing?.content).toContainEqual({
      type: 'image_ref',
      image: currentImage,
      purpose: 'draft_visual_review',
    });

    // Compaction is a transport projection only. The durable history used to
    // create it remains a full forensic transcript.
    expect(JSON.stringify(history)).toContain('unique-draft-0');
    expect(history.some((turn) =>
      turn.role === 'assistant' && turn.toolCalls.some((item) => {
        if (item.name !== 'submit_notebook_script') return false;
        const args = item.arguments as Readonly<Record<string, AgentJsonValue>>;
        return args.script === currentScript;
      })
    )).toBe(true);
  });

  it('fails open to complete history when no successful current-draft receipt exists', () => {
    const oldScript = `# Older draft\n${'full historical payload '.repeat(200)}`;
    const submit = call('only-submit', 'submit_notebook_script', {
      script: oldScript,
      citedUnitIds: [],
      reason: 'initial',
    });
    const history: AgentModelTurn[] = [
      assistant(submit, 0),
      tool(submit, { draftHash: 'old-draft-hash', draftVersion: 1 }, 1),
    ];
    const original = modelHistoryToProviderMessages(history);
    const projection = modelHistoryToProviderProjection(history, {
      script: '# Missing current draft',
      draftHash: 'missing-current-hash',
      version: 2,
    });
    expect(projection.messages).toEqual(original);
    expect(projection.compactedSubmitCalls).toBe(0);
    expect(projection.compactedToolResults).toBe(0);
    expect(projection.projectedCharacters).toBe(projection.originalCharacters);
  });

  it('redacts legacy canonical manifest and full-read results after the current manifest is clean', () => {
    const legacyManifest: SourceManifest = {
      version: 2,
      createdAt: NOW,
      digest: 'legacy-manifest',
      totalEstimatedTokens: 2,
      sources: [{
        id: 'canonical-spec',
        title: 'Notebook Script specification',
        kind: 'notebook_script_spec',
        digest: 'canonical-digest',
        mediaType: 'text/markdown',
        estimatedTokens: 1,
        quarantined: false,
        promptInjectionWarnings: [],
        units: [{
          id: 'canonical-unit',
          label: 'syntax',
          ordinal: 0,
          digest: 'canonical-unit-digest',
          estimatedTokens: 1,
          characters: 12,
          hasText: true,
          hasVisual: false,
          anchor: { sourceId: 'canonical-spec', unitId: 'canonical-unit' },
        }],
      }],
    };
    const manifestCall = call('legacy-manifest-call', 'list_source_manifest', {});
    const readCall = call('legacy-spec-read', 'read_full_source', {
      sourceId: 'canonical-spec',
    });
    const history: AgentModelTurn[] = [
      assistant(manifestCall, 0),
      tool(manifestCall, legacyManifest as unknown as AgentJsonValue, 1),
      assistant(readCall, 2),
      tool(readCall, {
        sourceId: 'canonical-spec',
        sourceDigest: 'canonical-digest',
        units: [{
          unitId: 'canonical-unit',
          text: 'SECRET LEGACY EXTERNAL AUTHORING INSTRUCTIONS',
          digest: 'canonical-unit-digest',
          anchor: { sourceId: 'canonical-spec', unitId: 'canonical-unit' },
        }],
        truncated: false,
      }, 3),
    ];
    const currentManifest: SourceManifest = {
      version: 2,
      createdAt: NOW,
      digest: 'current-spec-free-manifest',
      totalEstimatedTokens: 0,
      sources: [],
    };

    const projection = modelHistoryToProviderProjection(
      history,
      undefined,
      currentManifest,
    );
    const serialized = JSON.stringify(projection.messages);
    expect(projection.redactedCanonicalSourceResults).toBe(2);
    expect(serialized).not.toContain('Notebook Script specification');
    expect(serialized).not.toContain('SECRET LEGACY EXTERNAL AUTHORING INSTRUCTIONS');
    expect(serialized).toContain('localAuthoringAuthorityOmitted');
    expect(callPairs(projection.messages)).toEqual(
      callPairs(modelHistoryToProviderMessages(history)),
    );
  });
});
