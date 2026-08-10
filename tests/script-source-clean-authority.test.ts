import { describe, expect, it, vi } from 'vitest';

const databaseGate = vi.hoisted(() => {
  type BlockedWrite = {
    kind: 'save' | 'script';
    started(): void;
    readonly released: Promise<void>;
  };

  let blocked: BlockedWrite | null = null;

  return {
    blockNext(kind: BlockedWrite['kind']): {
      readonly started: Promise<void>;
      release(): void;
    } {
      let markStarted!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      blocked = { kind, started: markStarted, released };
      return { started, release };
    },

    async beforeExecute(query: string): Promise<void> {
      const kind = query.startsWith(
        'UPDATE pages SET doc_json = $1, source_dirty = $2',
      )
        ? 'save'
        : query.startsWith(
              'UPDATE pages SET doc_json = $1, script_source = $2',
            )
          ? 'script'
          : null;
      if (blocked === null || blocked.kind !== kind) return;
      const gate = blocked;
      blocked = null;
      gate.started();
      await gate.released;
    },
  };
});

vi.mock('../src/data/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/db')>();
  const memory = new actual.MemoryDb();
  return {
    ...actual,
    getDb: async (): Promise<import('../src/data/db').Db> => ({
      select: <T>(query: string, bindValues?: unknown[]) =>
        memory.select<T>(query, bindValues),
      execute: async (query: string, bindValues?: unknown[]) => {
        await databaseGate.beforeExecute(query);
        return memory.execute(query, bindValues);
      },
    }),
  };
});

import {
  createPage,
  getPage,
  savePageDoc,
  setPageScript,
} from '../src/data/pages';
import type { PageDoc } from '../src/data/types';
import { loadIndex } from '../src/data/search';

function paragraph(text: string): PageDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

describe('Notebook Script clean-source authority', () => {
  it('keeps the exact inserted source clean when the live editor debounce saves the same document later', async () => {
    const page = await createPage({
      bookId: 'script-race-live',
      doc: paragraph('before'),
    });
    const insertedDoc = paragraph('before plus the AI insertion');
    const source = 'before plus the AI insertion';

    await setPageScript(page.id, source, insertedDoc);

    const inserted = await getPage(page.id);
    expect(inserted).toMatchObject({
      doc: insertedDoc,
      scriptSource: source,
      sourceDirty: false,
    });

    // PageEditor already queued this exact snapshot while insertContent ran.
    await savePageDoc(page.id, structuredClone(insertedDoc));

    expect(await getPage(page.id)).toMatchObject({
      doc: insertedDoc,
      scriptSource: source,
      sourceDirty: false,
    });
  });

  it('atomically appends the offline fallback document and records its exact source as clean', async () => {
    const page = await createPage({
      bookId: 'script-race-offline',
      doc: paragraph('already here'),
    });
    const appendedDoc: PageDoc = {
      type: 'doc',
      content: [
        ...(page.doc.content ?? []),
        ...(paragraph('inserted while the editor is absent').content ?? []),
      ],
    };
    const source = 'inserted while the editor is absent';

    await setPageScript(page.id, source, appendedDoc);

    expect(await getPage(page.id)).toMatchObject({
      doc: appendedDoc,
      scriptSource: source,
      sourceDirty: false,
    });
  });

  it('never launders an already-dirty source through a no-op document save', async () => {
    const original = paragraph('from the script');
    const page = await createPage({
      bookId: 'script-race-already-dirty',
      doc: original,
      scriptSource: 'from the script',
    });
    const edited = paragraph('edited by the reader');

    await savePageDoc(page.id, edited);
    expect((await getPage(page.id))?.sourceDirty).toBe(true);

    await savePageDoc(page.id, structuredClone(edited));
    expect((await getPage(page.id))?.sourceDirty).toBe(true);
  });

  it('marks the stored source dirty on the first real edit after insertion', async () => {
    const insertedDoc = paragraph('inserted from the AI');
    const page = await createPage({ bookId: 'script-race-real-edit' });

    await setPageScript(page.id, 'inserted from the AI', insertedDoc);
    await savePageDoc(page.id, paragraph('reader changed it'));

    expect(await getPage(page.id)).toMatchObject({
      doc: paragraph('reader changed it'),
      scriptSource: 'inserted from the AI',
      sourceDirty: true,
    });
  });

  it('queues a script import behind an older in-flight autosave and lets the import win cleanly', async () => {
    const original = paragraph('old script document');
    const page = await createPage({
      bookId: 'script-race-old-save-first',
      doc: original,
      scriptSource: 'old script document',
    });
    const preImportEdit = paragraph('snapshot queued before import');
    const importedDoc = paragraph('replacement imported from the AI');
    const gate = databaseGate.blockNext('save');

    const oldSave = savePageDoc(page.id, preImportEdit);
    await gate.started;
    const imported = setPageScript(
      page.id,
      'replacement imported from the AI',
      importedDoc,
    );
    let importSettled = false;
    void imported.then(() => {
      importSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(importSettled).toBe(false);

    gate.release();
    await Promise.all([oldSave, imported]);

    expect(await getPage(page.id)).toMatchObject({
      doc: importedDoc,
      scriptSource: 'replacement imported from the AI',
      sourceDirty: false,
    });
    expect((await loadIndex()).find((row) => row.pageId === page.id)?.text).toBe(
      'replacement imported from the AI',
    );
  });

  it('queues a real edit behind an in-flight import and lets the later edit win dirty', async () => {
    const page = await createPage({
      bookId: 'script-race-import-first',
      doc: paragraph('before import'),
    });
    const importedDoc = paragraph('imported from the AI');
    const editedDoc = paragraph('reader edit after import');
    const gate = databaseGate.blockNext('script');

    const imported = setPageScript(page.id, 'imported from the AI', importedDoc);
    await gate.started;
    const edited = savePageDoc(page.id, editedDoc);
    let editSettled = false;
    void edited.then(() => {
      editSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(editSettled).toBe(false);

    gate.release();
    await Promise.all([imported, edited]);

    expect(await getPage(page.id)).toMatchObject({
      doc: editedDoc,
      scriptSource: 'imported from the AI',
      sourceDirty: true,
    });
    expect((await loadIndex()).find((row) => row.pageId === page.id)?.text).toBe(
      'reader edit after import',
    );
  });
});
