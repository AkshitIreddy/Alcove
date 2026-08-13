import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return { ...actual, getDb: async () => memory };
});

import {
  beginAiPatchUndo,
  claimAiPatchApplication,
  completeAiPatchApplication,
  completeAiPatchUndo,
  forgetAiPatchApplication,
  latestAppliedAiPatch,
  readAiPatchApplication,
  recoverIncompleteAiPatchApplications,
  restoreAiPatchSnapshot,
  type AiPatchBookSnapshot,
} from '../src/data/aiAgentApply';
import {
  createPage,
  deletePage,
  insertPageAfter,
  isPageFlowStart,
  listPages,
  savePageDoc,
  setPageFlowStart,
} from '../src/data/pages';

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('AI Agent whole-book apply journal', () => {
  it('claims once and restores an interrupted multi-page mutation exactly', async () => {
    const bookId = 'ai-apply-recovery-book';
    const first = await createPage({ bookId, doc: doc('first') });
    const second = await createPage({ bookId, doc: doc('second') });
    await setPageFlowStart(second.id, true);
    const snapshot: AiPatchBookSnapshot = {
      bookId,
      pages: [
        { page: first, flowStart: false },
        { page: second, flowStart: true },
      ],
    };

    expect(await claimAiPatchApplication({
      idempotencyKey: 'apply-recover-once',
      patchId: 'patch-recover',
      bookId,
      before: snapshot,
    })).toBe(true);
    expect(await claimAiPatchApplication({
      idempotencyKey: 'apply-recover-once',
      patchId: 'patch-recover',
      bookId,
      before: snapshot,
    })).toBe(false);

    await savePageDoc(first.id, doc('partially changed'));
    await insertPageAfter(first.id, { doc: doc('partial extra page') });

    expect(await recoverIncompleteAiPatchApplications(bookId)).toBe(1);
    const restored = await listPages(bookId);
    expect(restored.map((page) => page.id)).toEqual([first.id, second.id]);
    expect(restored.map((page) => page.doc)).toEqual([doc('first'), doc('second')]);
    expect(await isPageFlowStart(second.id)).toBe(true);
    expect(await readAiPatchApplication('apply-recover-once')).toBeNull();
  });

  it('retains a completed receipt for durable Ctrl+Z until it is consumed', async () => {
    const bookId = 'ai-apply-complete-book';
    const first = await createPage({ bookId, doc: doc('before') });
    const snapshot: AiPatchBookSnapshot = {
      bookId,
      pages: [{ page: first, flowStart: false }],
    };
    expect(await claimAiPatchApplication({
      idempotencyKey: 'apply-complete-once',
      patchId: 'patch-complete',
      bookId,
      before: snapshot,
    })).toBe(true);
    await savePageDoc(first.id, doc('after'));
    await insertPageAfter(first.id, { doc: doc('new reviewed page') });
    await completeAiPatchApplication('apply-complete-once', 'revision-after');

    expect(await recoverIncompleteAiPatchApplications(bookId)).toBe(0);
    expect(await latestAppliedAiPatch(bookId)).toMatchObject({
      idempotencyKey: 'apply-complete-once',
      status: 'applied',
      resultRevision: 'revision-after',
    });

    expect(await beginAiPatchUndo('apply-complete-once')).toMatchObject({
      status: 'undoing',
    });
    await restoreAiPatchSnapshot(snapshot);
    await completeAiPatchUndo('apply-complete-once');
    expect((await listPages(bookId)).map((page) => page.doc)).toEqual([doc('before')]);
    expect(await latestAppliedAiPatch(bookId)).toBeNull();
  });

  it('recovers a crash after the first Ctrl+Z mutation and never drops undoing authority', async () => {
    const bookId = 'ai-undo-crash-recovery-book';
    const first = await createPage({ bookId, doc: doc('original first') });
    const second = await createPage({ bookId, doc: doc('original second') });
    await setPageFlowStart(second.id, true);
    const snapshot: AiPatchBookSnapshot = {
      bookId,
      pages: [
        { page: first, flowStart: false },
        { page: second, flowStart: true },
      ],
    };
    expect(await claimAiPatchApplication({
      idempotencyKey: 'undo-crash-after-first-mutation',
      patchId: 'patch-undo-crash',
      bookId,
      before: snapshot,
    })).toBe(true);
    await savePageDoc(first.id, doc('reviewed replacement'));
    const inserted = await insertPageAfter(first.id, { doc: doc('reviewed extra page') });
    await completeAiPatchApplication(
      'undo-crash-after-first-mutation',
      'post-apply-revision',
    );

    // Ctrl+Z write-ahead transition settles before deleting its first page.
    expect(await beginAiPatchUndo('undo-crash-after-first-mutation')).toMatchObject({
      status: 'undoing',
    });
    await deletePage(inserted.id);

    // Simulate a stale-revision cleanup racing the partially restored book.
    // It may discard an unused applied receipt, never recovery authority.
    await forgetAiPatchApplication('undo-crash-after-first-mutation');
    expect(await readAiPatchApplication('undo-crash-after-first-mutation')).toMatchObject({
      status: 'undoing',
    });

    // A fresh BookView calls this before publishing any page snapshot.
    expect(await recoverIncompleteAiPatchApplications(bookId)).toBe(1);
    const restored = await listPages(bookId);
    expect(restored.map((page) => page.id)).toEqual([first.id, second.id]);
    expect(restored.map((page) => page.doc)).toEqual([
      doc('original first'),
      doc('original second'),
    ]);
    expect(await isPageFlowStart(second.id)).toBe(true);
    expect(await readAiPatchApplication('undo-crash-after-first-mutation')).toBeNull();
  });
});
