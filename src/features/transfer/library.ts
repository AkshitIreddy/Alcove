/**
 * src/features/transfer/library.ts — the only file in this feature that talks
 * to the database.
 *
 * Reading:  `loadLibrarySnapshot()` mirrors books + pages + assets + theme
 *           into the plain `LibrarySnapshot` the pure modules consume.
 * Writing:  `applyImportPlan()` executes a plan additively and returns the
 *           restore point it recorded first; `revertRestorePoint()` undoes an
 *           import and records its own restore point so the revert is
 *           undoable in turn.
 *
 * Nothing here overwrites a user row on import: books are created (never
 * replaced) and pages are appended. The only path that ever writes over an
 * existing row is `revertRestorePoint`, and it writes a verbatim snapshot
 * back.
 */

import { nanoid } from 'nanoid';
import { getDb } from '../../data/db';
import {
  createBook,
  listBooksByFloorRange,
  nextFreeSlot,
  updateBookPageCount,
} from '../../data/books';
import { createPage, listPages } from '../../data/pages';
import { settings } from '../../data/settings';
import type { PageDoc } from '../../data/types';
import { docToScript } from '../../editor/script/fromTiptap';
import type { BundleManifest, ManifestBook } from './format';
import type { ImportPlan, PlannedBook } from './conflicts';
import type {
  AssetSnapshot,
  BookSnapshot,
  LibrarySnapshot,
  PageSnapshot,
} from './scope';
import {
  planRevert,
  type BookRowSnapshot,
  type CreatedPageRef,
  type LibraryRowIds,
  type PageRowSnapshot,
  type RestorePoint,
  type RevertPlan,
} from './restore';
import { addRestorePoint, getRestorePoint, patchRestorePoint } from './store';

// ---------------------------------------------------------------------------
// Pure doc helpers
// ---------------------------------------------------------------------------

interface DocNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function nodeText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const record = node as DocNode;
  if (typeof record.text === 'string') return record.text;
  if (!Array.isArray(record.content)) return '';
  return record.content.map(nodeText).join('');
}

/** First heading's text, else the first paragraph's, else "page N". */
export function pageTitleFromDoc(doc: PageDoc, index: number): string {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    if ((block as DocNode).type !== 'heading') continue;
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 80);
  }
  for (const block of blocks) {
    const text = nodeText(block).trim();
    if (text !== '') return text.slice(0, 60);
  }
  return `page ${index + 1}`;
}

/** Plain-text length of a document — the "how full" hint in the tree. */
export function docCharCount(doc: PageDoc): number {
  return nodeText({ content: doc.content ?? [] }).length;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

interface AssetRowLite {
  id: string;
  rel_path: string;
  kind: string;
  meta: string | null;
}

async function loadAssets(): Promise<AssetSnapshot[]> {
  try {
    const db = await getDb();
    const rows = await db.select<AssetRowLite[]>('SELECT * FROM assets');
    return rows.map((row) => {
      let meta: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = row.meta === null ? null : JSON.parse(row.meta);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = null;
      }
      const size = meta?.bytes;
      return {
        id: row.id,
        relPath: row.rel_path,
        kind: row.kind,
        meta,
        // Unknown sizes estimate at 120 KB so the preview is not wildly low.
        bytes: typeof size === 'number' && Number.isFinite(size) ? size : 120_000,
      };
    });
  } catch {
    return [];
  }
}

/** The library-wide look, shipped when "include the library theme" is on. */
export function themeSnapshot(): Record<string, unknown> {
  return {
    theme: settings.theme,
    pageStyleDefault: settings.pageStyleDefault,
    inkColor: settings.inkColor,
    handwritingFont: settings.handwritingFont,
  };
}

/** Read every shelved book (trash floor excluded) with its pages. */
export async function loadLibrarySnapshot(): Promise<LibrarySnapshot> {
  const books = await listBooksByFloorRange(0, 9999);
  const out: BookSnapshot[] = [];
  for (const book of books) {
    const pages = await listPages(book.id);
    const snapshots: PageSnapshot[] = pages.map((page, index) => ({
      id: page.id,
      bookId: book.id,
      ord: page.ord,
      title: pageTitleFromDoc(page.doc, index),
      script:
        page.scriptSource !== null && !page.sourceDirty
          ? page.scriptSource
          : docToScript(page.doc),
      docJson: JSON.stringify(page.doc),
      chars: docCharCount(page.doc),
    }));
    out.push({
      id: book.id,
      title: book.title,
      floor: book.floor,
      slot: book.slot,
      spineSeed: book.spineSeed,
      coverMeta: book.coverMeta,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      pages: snapshots,
    });
  }
  return { books: out, assets: await loadAssets(), theme: themeSnapshot() };
}

// ---------------------------------------------------------------------------
// Raw row access (revert needs verbatim rows, not model objects)
// ---------------------------------------------------------------------------

async function bookRows(ids: readonly string[]): Promise<BookRowSnapshot[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const out: BookRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<BookRowSnapshot[]>(
      'SELECT * FROM books WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) out.push(rows[0]);
  }
  return out;
}

async function pageRowsOfBooks(ids: readonly string[]): Promise<PageRowSnapshot[]> {
  const db = await getDb();
  const out: PageRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<PageRowSnapshot[]>(
      'SELECT * FROM pages WHERE book_id = $1 ORDER BY ord ASC',
      [id],
    );
    out.push(...rows);
  }
  return out;
}

async function pageRows(ids: readonly string[]): Promise<PageRowSnapshot[]> {
  const db = await getDb();
  const out: PageRowSnapshot[] = [];
  for (const id of ids) {
    const rows = await db.select<PageRowSnapshot[]>(
      'SELECT * FROM pages WHERE id = $1 LIMIT 1',
      [id],
    );
    if (rows.length > 0) out.push(rows[0]);
  }
  return out;
}

/** Ids currently in the library — the "as it stands now" side of a revert. */
export async function currentRowIds(): Promise<LibraryRowIds> {
  const db = await getDb();
  const books = await db.select<Array<{ id: string }>>('SELECT id FROM books');
  const pages = await db.select<Array<{ id: string }>>('SELECT id FROM pages');
  return {
    bookIds: new Set(books.map((row) => row.id)),
    pageIds: new Set(pages.map((row) => row.id)),
  };
}

// ---------------------------------------------------------------------------
// Bundle page bodies → editor documents
// ---------------------------------------------------------------------------

let toTiptapCache: ((script: string) => PageDoc) | null = null;

/**
 * Script → editor JSON, using the REAL storage schema so containers and
 * diagrams become their true nodes. Loaded lazily (TipTap is heavy and the
 * pure modules must stay importable in a bare node test runner).
 */
async function scriptToDoc(script: string): Promise<PageDoc> {
  if (toTiptapCache === null) {
    const [{ getSchema }, { parse }, { scriptDocToTiptap }, { createEditorExtensions }] =
      await Promise.all([
        import('@tiptap/core'),
        import('../../script'),
        import('../../editor/script/toTiptap'),
        import('../../editor/extensions'),
      ]);
    const schema = getSchema(createEditorExtensions());
    toTiptapCache = (source: string) =>
      scriptDocToTiptap(parse(source), {
        hasNode: (name: string) => schema.nodes[name] !== undefined,
      });
  }
  return toTiptapCache(script);
}

function parseDocJson(text: string): PageDoc | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as { type?: unknown }).type === 'doc'
    ) {
      return parsed as PageDoc;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface BundleContents {
  manifest: BundleManifest;
  /** Archive path → decoded text (page bodies, docs, theme). */
  texts: ReadonlyMap<string, string>;
  /** Archive path → raw bytes (assets). */
  binaries?: ReadonlyMap<string, Uint8Array>;
}

export interface ImportOutcome {
  restorePoint: RestorePoint;
  createdBookIds: string[];
  createdPageCount: number;
  /** Book id to open once the panel closes, when there is an obvious one. */
  focusBookId: string | null;
  warnings: string[];
}

function manifestBookById(manifest: BundleManifest): Map<string, ManifestBook> {
  return new Map(manifest.books.map((book) => [book.id, book]));
}

/**
 * Execute an import plan additively.
 *
 * Order matters: every row the operation will touch is snapshotted and the
 * restore point is written BEFORE the first mutation, so a crash mid-import
 * still leaves a usable undo entry.
 */
export async function applyImportPlan(
  contents: BundleContents,
  plan: ImportPlan,
  sourceName: string,
  now: Date = new Date(),
): Promise<ImportOutcome> {
  const warnings: string[] = [];
  const bookLookup = manifestBookById(contents.manifest);

  // --- snapshot the rows we are about to modify (append targets) ----------
  const appendTargets = plan.books
    .filter((book) => book.action === 'append' && book.targetBookId !== null)
    .map((book) => book.targetBookId as string);
  const priorBooks = await bookRows(appendTargets);

  const point: RestorePoint = {
    id: nanoid(),
    label: `Imported ${sourceName}`,
    createdAt: now.toISOString(),
    kind: 'import',
    source: sourceName,
    counts: {
      books: plan.counts.newBooks + plan.counts.appendedBooks,
      pages: plan.counts.pages,
    },
    createdBooks: [],
    createdPages: [],
    priorBooks,
    priorPages: [],
    revertOf: null,
    revertedAt: null,
    revertedBy: null,
  };
  await addRestorePoint(point, now);

  // --- execute ------------------------------------------------------------
  const createdBooks: string[] = [];
  const createdPages: CreatedPageRef[] = [];
  let focusBookId: string | null = null;

  const shelved = await listBooksByFloorRange(0, 9999);
  let cursorFloor = shelved.reduce((max, book) => Math.max(max, book.floor), 0);

  for (const planned of plan.books) {
    if (planned.action === 'skip') continue;
    const source = bookLookup.get(planned.sourceId);
    if (source === undefined) continue;

    let targetId = planned.targetBookId;
    if (planned.action === 'create') {
      const floor = Math.max(0, Math.min(source.floor, cursorFloor + 1));
      const slot = await nextFreeSlot(floor, source.slot);
      const created = await createBook({
        title: planned.title,
        floor,
        slot,
        spineSeed: source.spineSeed > 0 ? source.spineSeed : undefined,
        coverMeta: source.coverMeta,
      });
      cursorFloor = Math.max(cursorFloor, floor);
      targetId = created.id;
      createdBooks.push(created.id);
    }
    if (targetId === null) continue;
    focusBookId ??= targetId;

    for (const plannedPage of planned.pages) {
      const manifestPage = source.pages.find((page) => page.id === plannedPage.sourceId);
      if (manifestPage === undefined) continue;
      const body = contents.texts.get(manifestPage.file);
      const docText =
        manifestPage.docFile === null ? undefined : contents.texts.get(manifestPage.docFile);

      let doc: PageDoc | null = docText === undefined ? null : parseDocJson(docText);
      if (doc === null) {
        if (body === undefined) {
          warnings.push(`“${manifestPage.title}” had no body in the bundle — skipped`);
          continue;
        }
        try {
          doc = await scriptToDoc(body);
        } catch {
          warnings.push(`“${manifestPage.title}” could not be parsed — skipped`);
          continue;
        }
      }
      const page = await createPage({
        bookId: targetId,
        doc,
        scriptSource: body ?? null,
      });
      createdPages.push({ id: page.id, bookId: targetId });
    }
    await updateBookPageCount(targetId);
  }

  await importAssets(contents, warnings);

  const finalPoint: RestorePoint = {
    ...point,
    createdBooks,
    createdPages,
    counts: { books: createdBooks.length + appendTargets.length, pages: createdPages.length },
  };
  await patchRestorePoint(point.id, finalPoint, now);

  return {
    restorePoint: finalPoint,
    createdBookIds: createdBooks,
    createdPageCount: createdPages.length,
    focusBookId,
    warnings,
  };
}

/**
 * Additive asset import: only relPaths the library does not already know are
 * inserted, and bytes are written through the `bundle_write_asset` Rust
 * command when running in Tauri. Failures warn; they never abort an import.
 */
async function importAssets(
  contents: BundleContents,
  warnings: string[],
): Promise<void> {
  const assets = contents.manifest.assets;
  if (assets.length === 0) return;
  const db = await getDb();
  const existing = new Set(
    (
      await db.select<Array<{ rel_path: string }>>('SELECT rel_path FROM assets')
    ).map((row) => row.rel_path),
  );
  type Invoker = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
  let invoke: Invoker | null = null;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      invoke = (await import('@tauri-apps/api/core')).invoke as unknown as Invoker;
    } catch {
      invoke = null;
    }
  }
  for (const asset of assets) {
    if (existing.has(asset.relPath)) continue;
    const bytes = contents.binaries?.get(asset.file);
    if (bytes !== undefined && invoke !== null) {
      try {
        await invoke('bundle_write_asset', {
          relPath: asset.relPath,
          bytes: Array.from(bytes),
        });
      } catch {
        warnings.push(`could not save the asset “${asset.relPath}”`);
        continue;
      }
    } else if (bytes === undefined) {
      // Manifest-only asset (bundle exported without files): keep the row so
      // the reference resolves if the file shows up later.
      warnings.push(`“${asset.relPath}” was referenced but not included`);
    }
    await db.execute(
      'INSERT OR REPLACE INTO assets (id, rel_path, kind, meta, created_at) VALUES ($1, $2, $3, $4, $5)',
      [
        nanoid(),
        asset.relPath,
        asset.kind,
        asset.meta === null ? null : JSON.stringify(asset.meta),
        new Date().toISOString(),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Revert
// ---------------------------------------------------------------------------

export interface RevertOutcome {
  plan: RevertPlan;
  /** The restore point created by this revert — undo the undo. */
  restorePoint: RestorePoint | null;
  removedBooks: number;
  removedPages: number;
  restoredRows: number;
}

/** Preview a revert without touching anything (drives the confirm copy). */
export async function previewRevert(pointId: string): Promise<RevertPlan | null> {
  const point = await getRestorePoint(pointId);
  if (point === null) return null;
  return planRevert(point, await currentRowIds());
}

/**
 * Undo an import. Snapshots every row it is about to remove or overwrite into
 * a fresh `kind: 'revert'` restore point first, so reverting is undoable.
 */
export async function revertRestorePoint(
  pointId: string,
  now: Date = new Date(),
): Promise<RevertOutcome | null> {
  const point = await getRestorePoint(pointId);
  if (point === null) return null;
  const plan = planRevert(point, await currentRowIds());
  if (plan.empty) {
    return { plan, restorePoint: null, removedBooks: 0, removedPages: 0, restoredRows: 0 };
  }

  // Snapshot everything this revert touches, *before* touching it.
  const doomedBooks = await bookRows(plan.deleteBookIds);
  const cascadedPages = await pageRowsOfBooks(plan.deleteBookIds);
  const doomedPages = await pageRows(plan.deletePageIds);
  const overwrittenBooks = await bookRows(plan.restoreBooks.map((row) => row.id));
  const overwrittenPages = await pageRows(plan.restorePages.map((row) => row.id));

  const undoPoint: RestorePoint = {
    id: nanoid(),
    label: `Reverted ${point.source === '' ? point.label : point.source}`,
    createdAt: now.toISOString(),
    kind: 'revert',
    source: point.source,
    counts: {
      books: doomedBooks.length + overwrittenBooks.length,
      pages: cascadedPages.length + doomedPages.length + overwrittenPages.length,
    },
    createdBooks: [],
    createdPages: [],
    priorBooks: dedupeById([...doomedBooks, ...overwrittenBooks]),
    priorPages: dedupeById([...cascadedPages, ...doomedPages, ...overwrittenPages]),
    revertOf: point.id,
    revertedAt: null,
    revertedBy: null,
  };
  await addRestorePoint(undoPoint, now);

  const db = await getDb();
  for (const id of plan.deletePageIds) {
    await db.execute('DELETE FROM pages WHERE id = $1', [id]);
  }
  for (const id of plan.deleteBookIds) {
    await db.execute('DELETE FROM pages WHERE book_id = $1', [id]);
    await db.execute('DELETE FROM books WHERE id = $1', [id]);
  }
  for (const row of plan.restoreBooks) await upsertBookRow(row);
  for (const row of plan.restorePages) await upsertPageRow(row);

  await patchRestorePoint(
    point.id,
    { revertedAt: now.toISOString(), revertedBy: undoPoint.id },
    now,
  );
  // Undoing a revert puts the import back in force, so the import stops
  // counting as reverted and becomes revertable again.
  if (point.kind === 'revert' && point.revertOf !== null) {
    await patchRestorePoint(point.revertOf, { revertedAt: null, revertedBy: null }, now);
  }

  return {
    plan,
    restorePoint: undoPoint,
    removedBooks: plan.deleteBookIds.length,
    removedPages: plan.deletePageIds.length + cascadedPages.length,
    restoredRows: plan.restoreBooks.length + plan.restorePages.length,
  };
}

function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

async function upsertBookRow(row: BookRowSnapshot): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO books (id, title, floor, slot, spine_seed, cover_meta, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      row.id,
      row.title,
      row.floor,
      row.slot,
      row.spine_seed,
      row.cover_meta,
      row.created_at,
      row.updated_at,
    ],
  );
}

async function upsertPageRow(row: PageRowSnapshot): Promise<void> {
  const db = await getDb();
  await db.execute(
    'INSERT OR REPLACE INTO pages (id, book_id, ord, doc_json, script_source, source_dirty, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [
      row.id,
      row.book_id,
      row.ord,
      row.doc_json,
      row.script_source,
      row.source_dirty,
      row.updated_at,
    ],
  );
}

/** Convenience for the panel: what a planned book will do, in words. */
export function describePlannedBook(book: PlannedBook): string {
  return book.summary;
}
