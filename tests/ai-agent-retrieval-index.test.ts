import { describe, expect, it } from 'vitest';
import {
  AI_AGENT_EMBEDDING_DIMENSIONS,
  aiAgentFtsQuery,
  isValidAiAgentEmbedding,
  reconcileRevisionedSnapshot,
  reciprocalRankFuse,
  resetAiAgentRetrievalIndexForTests,
  searchAiAgentRetrievalIndex,
} from '../src/data/aiAgentRetrievalIndex';

describe('AI agent derived retrieval index', () => {
  it('accepts only finite 512-float embeddings at the vec0 boundary', () => {
    const valid = Array<number>(AI_AGENT_EMBEDDING_DIMENSIONS).fill(0.25);
    expect(isValidAiAgentEmbedding(valid)).toBe(true);
    expect(isValidAiAgentEmbedding(valid.slice(1))).toBe(false);
    expect(isValidAiAgentEmbedding([...valid.slice(0, -1), Number.NaN])).toBe(false);
    expect(isValidAiAgentEmbedding([...valid.slice(0, -1), Number.POSITIVE_INFINITY])).toBe(false);
    expect(isValidAiAgentEmbedding('[0.25]')).toBe(false);
  });

  it('turns pasted/user text into quoted FTS terms rather than FTS syntax', () => {
    expect(aiAgentFtsQuery('Kittens AND "Huffman" prefix-code')).toBe(
      '"kittens" OR "and" OR "huffman" OR "prefix" OR "code"',
    );
    expect(aiAgentFtsQuery('***')).toBeNull();
  });

  it('fuses lexical and vector ranks deterministically without duplicate authority', () => {
    const alpha = { text: 'alpha' };
    const beta = { text: 'beta' };
    const fused = reciprocalRankFuse([
      [
        { key: 'alpha', value: alpha },
        { key: 'alpha', value: alpha },
        { key: 'beta', value: beta },
      ],
      [
        { key: 'beta', value: beta },
        { key: 'alpha', value: alpha },
      ],
    ]);
    expect(fused.map((item) => item.key)).toEqual(['alpha', 'beta']);
    expect(fused[0]?.ranks).toEqual([1, 2]);
    expect(fused[1]?.ranks).toEqual([3, 1]);
    expect(reciprocalRankFuse([], 60)).toEqual([]);
  });

  it('reports an unavailable extension as null so callers retain TS search', async () => {
    resetAiAgentRetrievalIndexForTests();
    await expect(searchAiAgentRetrievalIndex({
      threadId: 'task-a',
      sourceIds: ['source-a'],
      query: 'kitten',
      queryEmbedding: null,
      limit: 4,
    })).resolves.toBeNull();
  });

  it('invalidates before rebuilding and retries a cross-connection revision race', async () => {
    let revision = 7;
    let snapshot = 'old';
    let firstRebuild = true;
    const events: string[] = [];
    let published: number | null = 7;
    await reconcileRevisionedSnapshot({
      readRevision: async () => revision,
      readSnapshot: async () => snapshot,
      invalidate: async () => {
        events.push('invalidate');
        published = null;
      },
      rebuild: async (value) => {
        expect(published).toBeNull();
        events.push(`rebuild:${value}`);
        if (firstRebuild) {
          firstRebuild = false;
          snapshot = 'new';
          revision = 8;
        }
      },
      publish: async (stableRevision) => {
        events.push(`publish:${stableRevision}`);
        published = stableRevision;
      },
    });
    expect(events).toEqual([
      'invalidate',
      'rebuild:old',
      'invalidate',
      'rebuild:new',
      'publish:8',
    ]);
    expect(published).toBe(8);
  });

  it('leaves state invalidated when rebuilding fails or never stabilizes', async () => {
    let published: number | null = 3;
    await expect(reconcileRevisionedSnapshot({
      readRevision: async () => 3,
      readSnapshot: async () => 'snapshot',
      invalidate: async () => { published = null; },
      rebuild: async () => { throw new Error('simulated partial insert'); },
      publish: async (revision) => { published = revision; },
    })).rejects.toThrow('simulated partial insert');
    expect(published).toBeNull();

    let revision = 10;
    await expect(reconcileRevisionedSnapshot({
      readRevision: async () => revision,
      readSnapshot: async () => 'moving',
      invalidate: async () => { published = null; },
      rebuild: async () => { revision += 1; },
      publish: async (stableRevision) => { published = stableRevision; },
      maxAttempts: 2,
    })).rejects.toThrow('changed repeatedly');
    expect(published).toBeNull();
  });
});
