import { describe, expect, it } from 'vitest';

import { buildAgentSystemPrompt } from '../src/features/aiAgent/prompts';
import { createInitialAgentState, type AgentState } from '../src/features/aiAgent/types';

const NOW = '2026-08-13T09:00:00.000Z';

function state(goal: string): AgentState {
  return createInitialAgentState({
    identity: {
      threadId: 'thread-format-source',
      taskId: 'task-format-source',
      runId: 'run-format-source',
      bookId: 'book-format-source',
    },
    goal,
    now: NOW,
    userMessageId: 'message-format-source',
  });
}

describe('supplied-material notebook intent', () => {
  it('treats conversational pasted/doc formatting as notebook authorship without a magic phrase', () => {
    const prompt = buildAgentSystemPrompt(state(
      'Here is the text another AI wrote. Please organise it and make it look good.',
    ));

    expect(prompt).toContain('first-class notebook-authoring request');
    expect(prompt).toContain('do not need a magic phrase');
    expect(prompt).toContain('produce reviewed pages');
    expect(prompt).toContain('Merely attaching a source with no usable request remains ambiguous');
  });

  it('pins faithful source claims, bounded proactive enrichment, and semantic catalogue use', () => {
    const prompt = buildAgentSystemPrompt(state(
      'Format the attached document into polished study pages.',
    ));

    expect(prompt).toContain('preserve its intent, facts, qualifications and important examples');
    expect(prompt).toContain('Never invent a specific date, number, quotation, result, citation or claim');
    expect(prompt).toContain('proactively add concise general-knowledge explanations');
    expect(prompt).toContain('distinguish those additions when provenance could be confused');
    expect(prompt).toContain('Prefer fewer well-filled pages over padded fragments');
    expect(prompt).toContain('native catalogue as an editorial vocabulary, not a quota');
    expect(prompt).toContain('only where each one clarifies structure');
  });

  it('requires faithful natural pagination before one gap-specific enrichment and full rereview', () => {
    const prompt = buildAgentSystemPrompt(state('Make these pasted notes engaging.'));

    expect(prompt).toContain('Pass 1 faithfully structures the source and lets it paginate naturally');
    expect(prompt).toContain('Render and inspect those native pages');
    expect(prompt).toContain('never damage a meaningful section boundary');
    expect(prompt).toContain('at most one compact, relevant enrichment');
    expect(prompt).toContain('Intentional whitespace is valid');
    expect(prompt).toContain('Never force fullness, repeat material, add generic filler');
    expect(prompt).toContain('revalidate, rerender and visually review every new page');
  });

  it('uses an attached managed image directly without enabling external slots', () => {
    const initial = state('Format these notes and include the image I attached.');
    const prompt = buildAgentSystemPrompt(initial);

    expect(prompt).toContain('exact `portableAssetPath`');
    expect(prompt).toContain('Never invent, shorten or rewrite that asset path');
    expect(prompt).toContain('preserve the image’s intrinsic aspect ratio and complete uncropped content');
    expect(prompt).toContain('immutable rendered preview that will be applied');
    expect(prompt).toContain('has not explicitly requested external images');
    expect(prompt).toContain('Asking to use an already attached image does not grant this permission');
  });
});
