/**
 * src/data/search.ts — the full-text search index.
 *
 * A plain `search_index` table (one row per page: plain text + headings JSON)
 * maintained from JS through the existing sql plugin — savePageDoc calls
 * `indexPage` on every save, and `ensureIndexFresh()` sweeps books/pages to
 * (re)index anything created or edited outside that hook (seeded pages,
 * script inserts, imported books) and to drop orphans. The table is created
 * lazily with `CREATE TABLE IF NOT EXISTS` because this wave cannot register
 * Rust-side migrations. Ranking runs in JS over the in-memory index
 * (src/search/rank.ts) — fine for a personal library (hundreds of pages).
 *
 * FTS5 upgrade path (documented for a later wave):
 * 1. Register a migration in src-tauri/src/lib.rs:
 *      CREATE VIRTUAL TABLE search_fts USING fts5(
 *        plain_text, headings, content='search_index', content_rowid='rowid');
 *    plus AFTER INSERT/UPDATE/DELETE triggers on search_index keeping the
 *    shadow table in sync (the classic external-content pattern).
 * 2. Swap `searchContent` to
 *      SELECT ..., snippet(search_fts, 0, '', '', '…', 12)
 *      FROM search_fts JOIN search_index ... WHERE search_fts MATCH $1
 *      ORDER BY bm25(search_fts)
 *    and keep the JS path as the browser-dev fallback.
 * Nothing else changes: indexPage/ensureIndexFresh already write the content
 * table the FTS shadow would hang off.
 *
 * Browser-dev note: the MemoryDb stub has no DDL and defaults primary keys
 * to `id`, so the row id column is literally `id` (= page id) and updates are
 * DELETE + INSERT rather than INSERT OR REPLACE.
 */

import { getDb } from './db';
import { extractPageText, type PageHeading } from '../search/extract';
import {
  buildSnippet,
  scoreContent,
  tokenize,
  type Snippet,
} from '../search/rank';
import type { PageDoc } from './types';

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const DDL =
  'CREATE TABLE IF NOT EXISTS search_index (' +
  'id TEXT PRIMARY KEY, ' + // page id
  'book_id TEXT NOT NULL, ' +
  'ord INTEGER NOT NULL, ' +
  'plain_text TEXT NOT NULL, ' +
  'headings TEXT NOT NULL, ' +
  'updated_at TEXT NOT NULL)';

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  tableReady ??= (async () => {
    const db = await getDb();
    await db.execute(DDL);
  })();
  return tableReady;
}

interface SearchIndexRow {
  id: string;
  book_id: string;
  ord: number;
  plain_text: string;
  headings: string;
  updated_at: string;
}

/** One indexed page, headings parsed — what the quick switcher consumes. */
export interface IndexedPage {
  pageId: string;
  bookId: string;
  ord: number;
  text: string;
  headings: PageHeading[];
  updatedAt: string;
}

function parseHeadings(raw: string): PageHeading[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (h): h is PageHeading =>
          h !== null &&
          typeof h === 'object' &&
          typeof (h as PageHeading).text === 'string' &&
          typeof (h as PageHeading).level === 'number',
      );
    }
  } catch {
    // Corrupt headings JSON only degrades the switcher — ignore.
  }
  return [];
}

function rowToIndexed(row: SearchIndexRow): IndexedPage {
  return {
    pageId: row.id,
    bookId: row.book_id,
    ord: row.ord,
    text: row.plain_text,
    headings: parseHeadings(row.headings),
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Index maintenance
// ---------------------------------------------------------------------------

/**
 * (Re)index one page. Never throws — indexing is best-effort and must not
 * break the save path it hooks into (src/data/pages.ts savePageDoc).
 */
export async function indexPage(
  pageId: string,
  bookId: string,
  ord: number,
  doc: PageDoc,
  updatedAt?: string,
): Promise<void> {
  try {
    await ensureTable();
    const db = await getDb();
    const { text, headings } = extractPageText(doc);
    await db.execute('DELETE FROM search_index WHERE id = $1', [pageId]);
    await db.execute(
      'INSERT INTO search_index (id, book_id, ord, plain_text, headings, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        pageId,
        bookId,
        ord,
        text,
        JSON.stringify(headings),
        updatedAt ?? new Date().toISOString(),
      ],
    );
  } catch {
    // Best-effort: a failed index write must never surface to the editor.
  }
}

/** Drop one page's index row (page deleted). Best-effort. */
export async function removePageIndex(pageId: string): Promise<void> {
  try {
    await ensureTable();
    const db = await getDb();
    await db.execute('DELETE FROM search_index WHERE id = $1', [pageId]);
  } catch {
    // ignore
  }
}

/** Every indexed page (unranked). */
export async function loadIndex(): Promise<IndexedPage[]> {
  await ensureTable();
  const db = await getDb();
  const rows = await db.select<SearchIndexRow[]>('SELECT * FROM search_index');
  return rows.map(rowToIndexed);
}

// ---------------------------------------------------------------------------
// Freshness sweep
// ---------------------------------------------------------------------------

interface PageRowLite {
  id: string;
  book_id: string;
  ord: number;
  doc_json: string;
  updated_at: string;
}

function parseDoc(raw: string): PageDoc | null {
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
    // fallthrough
  }
  return null;
}

const FRESH_TTL_MS = 15_000;
let lastSweep = 0;
let sweepInFlight: Promise<void> | null = null;

/**
 * Bring the index up to date with the `pages` table: (re)index pages whose
 * `updated_at` differs or that were never indexed (covers seeding, script
 * inserts and page creation, which bypass the savePageDoc hook), and drop
 * rows whose page vanished. Throttled to one sweep per 15s unless `force`.
 */
export async function ensureIndexFresh(force = false): Promise<void> {
  if (sweepInFlight) return sweepInFlight;
  if (!force && Date.now() - lastSweep < FRESH_TTL_MS) return;
  sweepInFlight = (async () => {
    try {
      await ensureTable();
      const db = await getDb();
      const [pages, indexed] = await Promise.all([
        db.select<PageRowLite[]>('SELECT * FROM pages'),
        db.select<SearchIndexRow[]>('SELECT * FROM search_index'),
      ]);
      const byId = new Map(indexed.map((row) => [row.id, row]));
      const live = new Set<string>();
      for (const page of pages) {
        live.add(page.id);
        const row = byId.get(page.id);
        if (row !== undefined && row.updated_at === page.updated_at) continue;
        const doc = parseDoc(page.doc_json);
        if (doc === null) continue;
        await indexPage(page.id, page.book_id, page.ord, doc, page.updated_at);
      }
      for (const row of indexed) {
        if (!live.has(row.id)) await removePageIndex(row.id);
      }
      lastSweep = Date.now();
    } catch {
      // Best-effort sweep; a failure just means slightly stale results.
    } finally {
      sweepInFlight = null;
    }
  })();
  return sweepInFlight;
}

// ---------------------------------------------------------------------------
// Content search (JS ranking — see FTS5 upgrade path above)
// ---------------------------------------------------------------------------

/** One ranked full-text hit with its display snippet. */
export interface ContentHit {
  pageId: string;
  bookId: string;
  bookTitle: string;
  /** Page ord within its book (0-based; display as ord + 1). */
  ord: number;
  score: number;
  snippet: Snippet;
}

/**
 * Rank every indexed page against `query` (call `ensureIndexFresh` first for
 * up-to-the-second results). Returns up to `limit` hits, best first.
 */
export async function searchContent(
  query: string,
  limit = 20,
): Promise<ContentHit[]> {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const phrase = query.trim().toLowerCase();

  const db = await getDb();
  const [pages, books] = await Promise.all([
    loadIndex(),
    db.select<Array<{ id: string; title: string }>>(
      'SELECT id, title FROM books',
    ),
  ]);
  const titles = new Map(books.map((book) => [book.id, book.title]));

  const hits: ContentHit[] = [];
  for (const page of pages) {
    const score = scoreContent(page, terms, phrase);
    if (score <= 0) continue;
    const snippet =
      buildSnippet(page.text, terms) ??
      // Terms matched only a heading: fall back to the heading line itself.
      buildSnippet(page.headings.map((h) => h.text).join(' · '), terms);
    if (snippet === null) continue;
    hits.push({
      pageId: page.pageId,
      bookId: page.bookId,
      bookTitle: titles.get(page.bookId) ?? 'Untitled book',
      ord: page.ord,
      score,
      snippet,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
