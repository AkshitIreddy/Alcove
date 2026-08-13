import { describe, expect, it } from 'vitest';
import {
  createAiAgentThread,
  countAiAgentAttachmentReferences,
  deleteAiAgentThread,
  getAiAgentThread,
  listAiAgentSourceChunks,
  listAiAgentSources,
  listAiAgentThreads,
  newAiAgentChunkId,
  replaceAiAgentSourceChunks,
  saveAiAgentSource,
  saveAiAgentThread,
} from '../src/data/aiAgent';

describe('AI Agent durable store', () => {
  it('round-trips graph state, source manifests, coverage chunks, and deletion', async () => {
    const created = await createAiAgentThread({
      bookId: 'book-agent-store',
      title: 'Explain the source',
      stateVersion: 1,
      state: { plan: ['read every page'], secret: undefined },
    });
    const working = await saveAiAgentThread({
      ...created,
      status: 'working',
      state: { plan: ['read every page', 'render the draft'] },
    });
    expect((await getAiAgentThread<typeof working.state>(created.id))?.state).toEqual(
      working.state,
    );
    expect((await listAiAgentThreads('book-agent-store'))[0]?.status).toBe(
      'working',
    );

    const sourceId = 'source-agent-store';
    await saveAiAgentSource({
      id: sourceId,
      threadId: created.id,
      kind: 'pdf',
      name: 'source.pdf',
      relPath: 'ai/sources/source-agent-store.pdf',
      digest: 'sha256:fixture',
      byteLength: 1024,
      unitCount: 2,
      meta: {
        pages: 2,
        managedAttachmentId: 'att-shared',
        pdf: {
          pages: [{
            visuals: [{ resourceId: 'att-derived-pdf-visual' }],
          }],
        },
      },
      createdAt: new Date().toISOString(),
    });
    await replaceAiAgentSourceChunks(sourceId, [
      {
        id: newAiAgentChunkId(),
        sourceId,
        ordinal: 0,
        locator: 'page 1',
        text: 'First page',
        digest: 'sha256:first',
        embedding: [0.1, 0.2],
      },
      {
        id: newAiAgentChunkId(),
        sourceId,
        ordinal: 1,
        locator: 'page 2',
        text: 'Second page',
        digest: 'sha256:second',
        embedding: null,
      },
    ]);

    expect(await listAiAgentSources(created.id)).toMatchObject([
      { id: sourceId, kind: 'pdf', unitCount: 2 },
    ]);
    expect(await listAiAgentSourceChunks(sourceId)).toMatchObject([
      { ordinal: 0, locator: 'page 1', embedding: [0.1, 0.2] },
      { ordinal: 1, locator: 'page 2', embedding: null },
    ]);
    expect(await countAiAgentAttachmentReferences('att-shared')).toBe(1);
    expect(await countAiAgentAttachmentReferences('att-derived-pdf-visual')).toBe(1);

    await deleteAiAgentThread(created.id);
    expect(await getAiAgentThread(created.id)).toBeNull();
    expect(await listAiAgentSources(created.id)).toEqual([]);
    expect(await listAiAgentSourceChunks(sourceId)).toEqual([]);
    expect(await countAiAgentAttachmentReferences('att-shared')).toBe(0);
    expect(await countAiAgentAttachmentReferences('att-derived-pdf-visual')).toBe(0);
  });
});
