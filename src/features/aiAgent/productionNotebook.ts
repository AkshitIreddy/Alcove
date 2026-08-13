/**
 * Production read-only notebook bridge for the in-book agent.
 *
 * It deliberately reads the mounted TipTap document when one exists so an
 * autosave still in flight cannot make the agent inspect yesterday's page.
 * There is no editor command or page mutation anywhere in this module.
 */
import type { Editor } from '@tiptap/core';
import { getBook } from '../../data/books';
import { getPage, listPages } from '../../data/pages';
import type { Page, PageDoc } from '../../data/types';
import { activeEditor } from '../../editor/insert/activeEditor';
import { getPageEditor, pageIdOfEditor } from '../../editor/instances';
import { docToScript } from '../../editor/script/fromTiptap';
import { pageTitleFromDoc } from '../../features/transfer/pagePortability';
import { extractPageText } from '../../search/extract';
import type {
  AgentHashAdapter,
  NotebookInspection,
  NotebookReadAdapter,
} from './adapters';
import { webCryptoAgentHash } from './adapters';
import type {
  NotebookPageInspection,
  NotebookSelectionInspection,
} from './types';
import { computeNotebookSelectionDigest } from './selectionDigest';

export interface NotebookRevisionPage {
  readonly id: string;
  readonly ord: number;
  readonly updatedAt: string;
  readonly doc: PageDoc;
}

export interface ProductionNotebookDependencies {
  readonly getBook: typeof getBook;
  readonly getPage: typeof getPage;
  readonly listPages: typeof listPages;
  readonly getPageEditor: (pageId: string) => Editor | null;
  readonly activeEditor: () => Editor | null;
  readonly pageIdOfEditor: (editor: Editor) => string | null;
  readonly hash: AgentHashAdapter;
  readonly now: () => string;
}

const DEFAULT_DEPENDENCIES: ProductionNotebookDependencies = {
  getBook,
  getPage,
  listPages,
  getPageEditor,
  activeEditor,
  pageIdOfEditor,
  hash: webCryptoAgentHash,
  now: () => new Date().toISOString(),
};

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The operation was aborted', 'AbortError');
}

function editorDoc(editor: Editor | null): PageDoc | null {
  if (editor === null || editor.isDestroyed) return null;
  return editor.getJSON() as PageDoc;
}

function liveDoc(page: Page, deps: ProductionNotebookDependencies): PageDoc {
  return editorDoc(deps.getPageEditor(page.id)) ?? page.doc;
}

/**
 * Revision used both by the read adapter and the proposal apply gate.
 *
 * Page order, identity and exact current JSON participate. `updatedAt` is
 * deliberately excluded: an autosave may persist the already-inspected live
 * JSON while the agent works, changing only the write clock. Treating that as
 * a conflict would reject an unchanged proposal. Callers may pass live editor
 * documents in place of stored documents.
 */
export function computeNotebookRevision(
  pages: readonly NotebookRevisionPage[],
  hash: AgentHashAdapter = webCryptoAgentHash,
): Promise<string> {
  return hash.digestJson(
    [...pages]
      .sort((left, right) => left.ord - right.ord || left.id.localeCompare(right.id))
      .map((page) => ({
        id: page.id,
        ord: page.ord,
        doc: page.doc,
      })),
  );
}

export function computeNotebookPageRevision(
  page: NotebookRevisionPage,
  hash: AgentHashAdapter = webCryptoAgentHash,
): Promise<string> {
  return hash.digestJson({
    id: page.id,
    ord: page.ord,
    doc: page.doc,
  });
}

async function inspectResolvedPage(
  page: Page,
  ordinal: number,
  deps: ProductionNotebookDependencies,
  signal: AbortSignal,
): Promise<NotebookPageInspection> {
  abortIfNeeded(signal);
  const doc = liveDoc(page, deps);
  const [revision, documentDigest] = await Promise.all([
    computeNotebookPageRevision({ ...page, doc }, deps.hash),
    deps.hash.digestJson(doc),
  ]);
  abortIfNeeded(signal);
  return {
    pageId: page.id,
    ordinal,
    revision,
    title: pageTitleFromDoc(doc, ordinal),
    plainText: extractPageText(doc).text,
    scriptSource: docToScript(doc),
    documentDigest,
    // This exact JSON never has to be reconstructed from Notebook Script. It
    // is consumed by the local draft sandbox for integrated caret/selection
    // previews and stripped from provider-facing inspect tool results.
    document: JSON.parse(JSON.stringify(doc)) as PageDoc,
  };
}

function selectedBlockIds(editor: Editor, from: number, to: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    const id: unknown = node.attrs?.id;
    if (typeof id === 'string' && id !== '' && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  });
  return ids;
}

export function createProductionNotebookReadAdapter(
  overrides: Partial<ProductionNotebookDependencies> = {},
): NotebookReadAdapter {
  const deps: ProductionNotebookDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };

  return {
    async inspectNotebook(bookId, signal): Promise<NotebookInspection> {
      abortIfNeeded(signal);
      const [book, storedPages] = await Promise.all([
        deps.getBook(bookId),
        deps.listPages(bookId),
      ]);
      abortIfNeeded(signal);
      if (book === null) throw new Error('The requested notebook no longer exists');

      const pages = [...storedPages].sort(
        (left, right) => left.ord - right.ord || left.id.localeCompare(right.id),
      );
      const livePages = pages.map((page) => ({ ...page, doc: liveDoc(page, deps) }));
      const revisions = await Promise.all(
        livePages.map((page) => computeNotebookPageRevision(page, deps.hash)),
      );
      const bookRevision = await computeNotebookRevision(livePages, deps.hash);
      abortIfNeeded(signal);

      return {
        title: book.title,
        snapshot: {
          bookId,
          bookRevision,
          pageIds: livePages.map((page) => page.id),
          pageRevisions: Object.fromEntries(
            livePages.map((page, index) => [page.id, revisions[index]!]),
          ),
          capturedAt: deps.now(),
        },
        pages: livePages.map((page, index) => {
          const extracted = extractPageText(page.doc);
          return {
            pageId: page.id,
            ordinal: index,
            revision: revisions[index]!,
            title: pageTitleFromDoc(page.doc, index),
            estimatedTokens: Math.max(1, Math.ceil(extracted.text.length / 4)),
          };
        }),
      };
    },

    async inspectPage(pageId, signal): Promise<NotebookPageInspection> {
      abortIfNeeded(signal);
      const page = await deps.getPage(pageId);
      abortIfNeeded(signal);
      if (page === null) throw new Error('The requested page no longer exists');
      const pages = await deps.listPages(page.bookId);
      const ordinal = [...pages]
        .sort((left, right) => left.ord - right.ord || left.id.localeCompare(right.id))
        .findIndex((candidate) => candidate.id === page.id);
      return inspectResolvedPage(page, Math.max(0, ordinal), deps, signal);
    },

    async inspectPageRange(
      bookId,
      startOrdinal,
      endOrdinal,
      signal,
    ): Promise<readonly NotebookPageInspection[]> {
      abortIfNeeded(signal);
      if (endOrdinal < startOrdinal) return [];
      const pages = (await deps.listPages(bookId)).sort(
        (left, right) => left.ord - right.ord || left.id.localeCompare(right.id),
      );
      abortIfNeeded(signal);
      const start = Math.max(0, Math.floor(startOrdinal));
      const end = Math.min(pages.length - 1, Math.floor(endOrdinal));
      if (end < start) return [];
      return Promise.all(
        pages
          .slice(start, end + 1)
          .map((page, offset) => inspectResolvedPage(page, start + offset, deps, signal)),
      );
    },

    async inspectSelection(
      bookId,
      signal,
    ): Promise<NotebookSelectionInspection | null> {
      abortIfNeeded(signal);
      const editor = deps.activeEditor();
      if (editor === null || editor.isDestroyed || editor.state.selection.empty) return null;
      const pageId = deps.pageIdOfEditor(editor);
      if (pageId === null) return null;
      const page = await deps.getPage(pageId);
      abortIfNeeded(signal);
      if (page === null || page.bookId !== bookId) return null;

      const { from, to } = editor.state.selection;
      const doc = editor.getJSON() as PageDoc;
      const pageRevision = await computeNotebookPageRevision({ ...page, doc }, deps.hash);
      const documentDigest = await deps.hash.digestJson(doc);
      const text = editor.state.doc.textBetween(from, to, '\n', '\n');
      const blockIds = selectedBlockIds(editor, from, to);
      const selectionDigest = await computeNotebookSelectionDigest({
        pageId,
        from,
        to,
        documentDigest,
      }, deps.hash);
      abortIfNeeded(signal);
      return {
        pageId,
        blockIds,
        from,
        to,
        text,
        selectionDigest,
        pageRevision,
      };
    },
  };
}
