import { nanoid } from 'nanoid';
import { getDb, type Db } from './db';
import { indexPage, removePageIndex } from './search';
import type { CreatePageInput, Page, PageDoc, PageRow } from './types';

/**
 * Every read-modify-write for one page must observe the write invoked before
 * it. SQLite makes each UPDATE atomic, but `savePageDoc` also has to read the
 * current source provenance before it can decide whether the new document is
 * an edit. Without this lane, an already-running autosave can finish after a
 * script import and overwrite the imported document with its older snapshot.
 *
 * The stored tails never reject, so one failed write cannot poison later
 * writes. Public calls still receive their own rejection. `getPage` itself is
 * deliberately not queued: mutations call it from inside the lane and making
 * reads re-enter the same lane would deadlock.
 */
const pageMutationTails = new Map<string, Promise<void>>();

function inPageMutationLane<T>(
  id: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const previous = pageMutationTails.get(id) ?? Promise.resolve();
  const result = previous.then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  pageMutationTails.set(id, tail);
  void tail.then(() => {
    if (pageMutationTails.get(id) === tail) pageMutationTails.delete(id);
  });
  return result;
}

/** A fresh, empty TipTap document — the starter content for new pages. */
export function emptyPageDoc(): PageDoc {
  return { type: 'doc', content: [] };
}

function parseDoc(raw: string): PageDoc {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'doc'
    ) {
      return parsed as PageDoc;
    }
  } catch {
    // Unreadable doc_json — surface an empty page instead of crashing.
  }
  return emptyPageDoc();
}

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    bookId: row.book_id,
    ord: row.ord,
    doc: parseDoc(row.doc_json),
    scriptSource: row.script_source,
    sourceDirty: row.source_dirty === 1,
    updatedAt: row.updated_at,
  };
}

const PAGE_FLOW_START_PREFIX = 'page_flow_start:';

function pageFlowStartKey(id: string): string {
  return `${PAGE_FLOW_START_PREFIX}${id}`;
}

/** Keep an AI-authored page boundary outside TipTap's formatting envelope. */
export async function setPageFlowStart(
  id: string,
  protectedStart: boolean,
): Promise<void> {
  const db = await getDb();
  if (protectedStart) {
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [pageFlowStartKey(id), 'true'],
    );
  } else {
    await db.execute('DELETE FROM settings WHERE key = $1', [
      pageFlowStartKey(id),
    ]);
  }
}

export async function isPageFlowStart(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [pageFlowStartKey(id)],
  );
  return rows[0]?.value === 'true';
}

/**
 * v0.6.1 briefly stored this pagination bit in `doc.attrs`. Strip that legacy
 * field on read and preserve it as page metadata instead. This keeps old AI
 * imports anchored without letting a pagination concern alter page styling.
 */
async function migrateLegacyFlowStart(db: Db, page: Page): Promise<Page> {
  if (page.doc.attrs?.flowStart !== true) return page;
  const attrs = { ...page.doc.attrs };
  delete attrs.flowStart;
  const doc: PageDoc = {
    type: 'doc',
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(page.doc.content === undefined ? {} : { content: page.doc.content }),
  };
  await Promise.all([
    db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [pageFlowStartKey(page.id), 'true'],
    ),
    db.execute('UPDATE pages SET doc_json = $1 WHERE id = $2', [
      JSON.stringify(doc),
      page.id,
    ]),
  ]);
  return { ...page, doc };
}

/** All pages of a book, ordered by `ord` ascending. */
export async function listPages(bookId: string): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    'SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC',
    [bookId],
  );
  return Promise.all(rows.map((row) => migrateLegacyFlowStart(db, rowToPage(row))));
}

export async function getPage(id: string): Promise<Page | null> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    'SELECT * FROM pages WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows.length > 0
    ? migrateLegacyFlowStart(db, rowToPage(rows[0]))
    : null;
}

async function nextOrd(bookId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<Array<{ ord: number }>>(
    'SELECT ord FROM pages WHERE book_id = $1 ORDER BY ord DESC LIMIT 1',
    [bookId],
  );
  return rows.length > 0 ? rows[0].ord + 1 : 0;
}

export async function createPage(input: CreatePageInput): Promise<Page> {
  const db = await getDb();
  const page: Page = {
    id: nanoid(),
    bookId: input.bookId,
    ord: input.ord ?? (await nextOrd(input.bookId)),
    doc: input.doc ?? emptyPageDoc(),
    scriptSource: input.scriptSource ?? null,
    sourceDirty: false,
    updatedAt: new Date().toISOString(),
  };
  await db.execute(
    'INSERT INTO pages (id, book_id, ord, doc_json, script_source, source_dirty, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      page.id,
      page.bookId,
      page.ord,
      JSON.stringify(page.doc),
      page.scriptSource,
      0,
      page.updatedAt,
    ],
  );
  return page;
}

/** Open one ordinal in a book, then create the new page in that exact gap. */
async function insertPageAt(
  bookId: string,
  ord: number,
  input: Omit<CreatePageInput, 'bookId' | 'ord'>,
): Promise<Page> {
  const db = await getDb();
  const following = (await listPages(bookId))
    .filter((page) => page.ord >= ord)
    .sort((a, b) => b.ord - a.ord);
  for (const page of following) {
    await db.execute('UPDATE pages SET ord = $1 WHERE id = $2', [
      page.ord + 1,
      page.id,
    ]);
    await indexPage(
      page.id,
      page.bookId,
      page.ord + 1,
      page.doc,
      page.updatedAt,
    );
  }
  return createPage({ ...input, bookId, ord });
}

/** Insert a page directly after an existing page, preserving book order. */
export async function insertPageAfter(
  anchorId: string,
  input: Omit<CreatePageInput, 'bookId' | 'ord'>,
): Promise<Page | null> {
  const anchor = await getPage(anchorId);
  return anchor === null
    ? null
    : insertPageAt(anchor.bookId, anchor.ord + 1, input);
}

/** Insert a page directly before an existing page, preserving book order. */
export async function insertPageBefore(
  anchorId: string,
  input: Omit<CreatePageInput, 'bookId' | 'ord'>,
): Promise<Page | null> {
  const anchor = await getPage(anchorId);
  return anchor === null
    ? null
    : insertPageAt(anchor.bookId, anchor.ord, input);
}

/**
 * Persist the editor document (autosave path). Bumps `updated_at`; when the
 * page has a stored script source, the edit marks it dirty so "Export Script"
 * falls back to the canonical printer instead of the stale verbatim source.
 */
export function savePageDoc(
  id: string,
  doc: PageDoc,
): Promise<Page | null> {
  return inPageMutationLane(id, async () => {
    const existing = await getPage(id);
    if (existing === null) return null;
    const db = await getDb();
    const updatedAt = new Date().toISOString();
    const docJson = JSON.stringify(doc);
    const documentChanged = docJson !== JSON.stringify(existing.doc);
    const sourceDirty =
      existing.scriptSource !== null &&
      (existing.sourceDirty || documentChanged);
    const write = await db.execute(
      'UPDATE pages SET doc_json = $1, source_dirty = $2, updated_at = $3 WHERE id = $4',
      [docJson, sourceDirty ? 1 : 0, updatedAt, id],
    );
    // A deletion outside this module may win while the mutation is in flight.
    // Do not recreate its page in the search index or return a phantom save.
    if (write.rowsAffected === 0) return null;
    await indexPage(id, existing.bookId, existing.ord, doc, updatedAt);
    return { ...existing, doc, sourceDirty, updatedAt };
  });
}

/**
 * Persist deterministic block ids without pretending the reader edited text.
 *
 * Page render preparation is a storage normalization: ids affect node
 * identity and seeded decoration, but not the note's authored content. Keep
 * `source_dirty` and `updated_at` untouched so merely opening an older book
 * neither invalidates its verbatim Notebook Script nor changes its recency.
 */
export function persistPageDocIdentity(
  id: string,
  doc: PageDoc,
): Promise<void> {
  return inPageMutationLane(id, async () => {
    const db = await getDb();
    await db.execute('UPDATE pages SET doc_json = $1 WHERE id = $2', [
      JSON.stringify(doc),
      id,
    ]);
  });
}

/**
 * Store the verbatim Notebook Script source a page was inserted from (or
 * clear it with `null`). Resets `source_dirty` — the source is clean at the
 * moment of insertion.
 *
 * Supplying `doc` stores the source and the exact document it produced in one
 * UPDATE. The live editor has already queued its ordinary debounced save when
 * the insert dialog reaches this call. If only the source were written here,
 * that delayed snapshot would differ from the old persisted document and look
 * like a reader edit. With both halves committed together, the later identical
 * save is a provenance no-op while a genuinely different document is dirty.
 */
export function setPageScript(
  id: string,
  source: string | null,
  doc?: PageDoc,
): Promise<Page | null> {
  return inPageMutationLane(id, async () => {
    const existing = await getPage(id);
    if (existing === null) return null;
    const db = await getDb();
    const updatedAt = new Date().toISOString();
    const write = doc === undefined
      ? await db.execute(
          'UPDATE pages SET script_source = $1, source_dirty = 0, updated_at = $2 WHERE id = $3',
          [source, updatedAt, id],
        )
      : await db.execute(
          'UPDATE pages SET doc_json = $1, script_source = $2, source_dirty = 0, updated_at = $3 WHERE id = $4',
          [JSON.stringify(doc), source, updatedAt, id],
        );
    if (write.rowsAffected === 0) return null;
    if (doc !== undefined) {
      await indexPage(id, existing.bookId, existing.ord, doc, updatedAt);
    }
    return {
      ...existing,
      doc: doc ?? existing.doc,
      scriptSource: source,
      sourceDirty: false,
      updatedAt,
    };
  });
}

/**
 * Restore one exact page row captured before a book-level operation.
 *
 * Unlike `savePageDoc`, this is not a new reader edit: provenance, dirty state
 * and timestamp all return to their captured values. BookView uses it for the
 * single atomic undo checkpoint around a multi-page Notebook Script import.
 */
export function restorePageSnapshot(page: Page): Promise<Page | null> {
  return inPageMutationLane(page.id, async () => {
    const existing = await getPage(page.id);
    if (existing === null || existing.bookId !== page.bookId) return null;
    const db = await getDb();
    const write = await db.execute(
      'UPDATE pages SET ord = $1, doc_json = $2, script_source = $3, source_dirty = $4, updated_at = $5 WHERE id = $6',
      [
        page.ord,
        JSON.stringify(page.doc),
        page.scriptSource,
        page.sourceDirty ? 1 : 0,
        page.updatedAt,
        page.id,
      ],
    );
    if (write.rowsAffected === 0) return null;
    await indexPage(page.id, page.bookId, page.ord, page.doc, page.updatedAt);
    return page;
  });
}

/**
 * Delete one page and close its ordinal gap.
 *
 * The caller keeps the book-level invariant that at least one page remains.
 * This layer owns the durable cleanup: the page row, its search entry and its
 * private autosave-history blob all disappear together, and shifted pages are
 * re-indexed with their new displayed page numbers.
 */
export function deletePage(id: string): Promise<Page | null> {
  return inPageMutationLane(id, async () => {
    const existing = await getPage(id);
    if (existing === null) return null;
    const db = await getDb();
    const removed = await db.execute('DELETE FROM pages WHERE id = $1', [id]);
    if (removed.rowsAffected === 0) return null;

    await Promise.all([
      removePageIndex(id),
      db.execute('DELETE FROM settings WHERE key = $1', [`page_history:${id}`]),
      db.execute('DELETE FROM settings WHERE key = $1', [pageFlowStartKey(id)]),
    ]);

    const remaining = await listPages(existing.bookId);
    for (let ord = 0; ord < remaining.length; ord += 1) {
      const page = remaining[ord]!;
      if (page.ord === ord) continue;
      await db.execute('UPDATE pages SET ord = $1 WHERE id = $2', [ord, page.id]);
      await indexPage(page.id, page.bookId, ord, page.doc, page.updatedAt);
    }
    return existing;
  });
}
