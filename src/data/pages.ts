import { nanoid } from 'nanoid';
import { getDb } from './db';
import type { CreatePageInput, Page, PageDoc, PageRow } from './types';

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

/** All pages of a book, ordered by `ord` ascending. */
export async function listPages(bookId: string): Promise<Page[]> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    'SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC',
    [bookId],
  );
  return rows.map(rowToPage);
}

export async function getPage(id: string): Promise<Page | null> {
  const db = await getDb();
  const rows = await db.select<PageRow[]>(
    'SELECT * FROM pages WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows.length > 0 ? rowToPage(rows[0]) : null;
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

/**
 * Persist the editor document (autosave path). Bumps `updated_at`; when the
 * page has a stored script source, the edit marks it dirty so "Export Script"
 * falls back to the canonical printer instead of the stale verbatim source.
 */
export async function savePageDoc(
  id: string,
  doc: PageDoc,
): Promise<Page | null> {
  const existing = await getPage(id);
  if (existing === null) return null;
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  const sourceDirty = existing.scriptSource !== null;
  await db.execute(
    'UPDATE pages SET doc_json = $1, source_dirty = $2, updated_at = $3 WHERE id = $4',
    [JSON.stringify(doc), sourceDirty ? 1 : 0, updatedAt, id],
  );
  return { ...existing, doc, sourceDirty, updatedAt };
}

/**
 * Store the verbatim Notebook Script source a page was inserted from (or
 * clear it with `null`). Resets `source_dirty` — the source is clean at the
 * moment of insertion.
 */
export async function setPageScript(
  id: string,
  source: string | null,
): Promise<Page | null> {
  const existing = await getPage(id);
  if (existing === null) return null;
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  await db.execute(
    'UPDATE pages SET script_source = $1, source_dirty = 0, updated_at = $2 WHERE id = $3',
    [source, updatedAt, id],
  );
  return { ...existing, scriptSource: source, sourceDirty: false, updatedAt };
}

/**
 * Rewrite `ord` for a book's pages to match `orderedIds` (index = new ord).
 * Ids not belonging to `bookId` are ignored by the WHERE guard.
 */
export async function reorderPages(
  bookId: string,
  orderedIds: readonly string[],
): Promise<void> {
  const db = await getDb();
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i += 1) {
    await db.execute(
      'UPDATE pages SET ord = $1, updated_at = $2 WHERE id = $3 AND book_id = $4',
      [i, updatedAt, orderedIds[i], bookId],
    );
  }
}
