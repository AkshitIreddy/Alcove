/**
 * BookView — the opened book: one page rendered as a paper sheet with the
 * block editor inside. Page-flip navigation arrives with the flip feature;
 * for now the first page of the book is shown.
 *
 * The script toolbar (top-right) bridges pages and Notebook Script:
 * Insert script (paste dialog), Export script (clipboard), Copy AI spec.
 */
import { Show, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { appState } from '../state/app';
import { editorState } from '../editor/state';
import { getBook, listBooksByFloorRange } from '../data/books';
import { createPage, getPage, listPages } from '../data/pages';
import { seedIfEmpty } from '../data/seed';
import type { Book, Page, PageDoc } from '../data/types';
import PageEditor from '../editor/PageEditor';
import InsertScriptDialog from '../editor/insert/InsertScriptDialog';
import { activeEditor } from '../editor/insert/activeEditor';
import { docToScript } from '../editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../editor/script/spec';
import '../styles/editor.css';
import '../styles/insert.css';

interface BookSession {
  readonly book: Book;
  readonly page: Page;
}

async function loadSession(source: {
  readonly bookId: string | null;
}): Promise<BookSession | null> {
  let book: Book | null = source.bookId ? await getBook(source.bookId) : null;
  if (!book) {
    // WORKAROUND (see src/editor/state.ts): appState has no openBookId yet,
    // so a direct jump to the book view falls back to the first shelved book.
    let shelved = await listBooksByFloorRange(0, 999);
    if (shelved.length === 0) {
      await seedIfEmpty();
      shelved = await listBooksByFloorRange(0, 999);
    }
    book = shelved[0] ?? null;
  }
  if (!book) return null;

  const pages = await listPages(book.id);
  const page = pages[0] ?? (await createPage({ bookId: book.id }));
  return { book, page };
}

/** Hand-drawn back arrow (pre-wobbled static path — no runtime filters). */
function BackArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 34 20" class="nb-back-arrow" aria-hidden="true">
      <path
        d="M 31.5 10.4 C 24 9.6 14.5 10.5 6.2 10.1 M 12.8 3.4 C 10.4 5.8 7.6 8.2 4.1 10.2 C 7.4 12 10.2 14.4 12.4 16.9"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export default function BookView(): JSX.Element {
  // Source is an object so a null bookId still triggers the fetcher
  // (createResource skips falsy sources).
  const [session] = createResource(
    () => ({ bookId: editorState.openBookId() }),
    loadSession,
  );

  const [insertOpen, setInsertOpen] = createSignal(false);
  const [toast, setToast] = createSignal<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = (message: string): void => {
    setToast(message);
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 2600);
  };
  onCleanup(() => {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
  });

  const copyText = async (text: string, doneMessage: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      notify(doneMessage);
    } catch {
      notify('could not reach the clipboard');
    }
  };

  /**
   * Export Script (design doc §3): the stored verbatim source while the page
   * is unedited since insert, else the canonical printer over the live doc.
   */
  const exportScript = async (pageId: string): Promise<void> => {
    const page = await getPage(pageId);
    if (page !== null && page.scriptSource !== null && !page.sourceDirty) {
      await copyText(page.scriptSource, 'script copied (original paste)');
      return;
    }
    const editor = activeEditor();
    const doc = editor !== null ? (editor.getJSON() as PageDoc) : page?.doc;
    if (doc === undefined) {
      notify('nothing to export yet');
      return;
    }
    await copyText(docToScript(doc), 'script copied to clipboard');
  };

  return (
    <main class="nb-book-view">
      <button
        type="button"
        class="nb-back-button font-accent"
        onClick={() => appState.closeBook()}
      >
        <BackArrowIcon />
        <span>back to shelf</span>
      </button>

      <Show
        when={session()}
        fallback={
          <div class="nb-book-empty">
            <Show
              when={session.loading}
              fallback={
                <p class="font-label">
                  no books on the shelf yet — the bookshelf will grow soon
                </p>
              }
            >
              <p class="font-label">opening the book…</p>
            </Show>
          </div>
        }
        keyed
      >
        {(loaded) => (
          <div class="nb-sheet-stage">
            <div
              class="nb-script-toolbar font-ui"
              role="toolbar"
              aria-label="Script tools"
            >
              <button
                type="button"
                class="nb-script-tool"
                title="Paste Notebook Script into this page"
                onClick={() => setInsertOpen(true)}
              >
                Insert script
              </button>
              <button
                type="button"
                class="nb-script-tool"
                title="Copy this page as Notebook Script"
                onClick={() => void exportScript(loaded.page.id)}
              >
                Export script
              </button>
              <button
                type="button"
                class="nb-script-tool"
                title="Copy the Notebook Script spec for your AI assistant"
                onClick={() =>
                  void copyText(
                    NOTEBOOK_SCRIPT_SPEC,
                    'spec copied — paste it to your AI',
                  )
                }
              >
                Copy AI spec
              </button>
            </div>
            <article class="nb-sheet">
              <div class="nb-sheet-paper">
                <header class="nb-sheet-header">
                  <h1 class="nb-book-title">{loaded.book.title}</h1>
                </header>
                <PageEditor
                  pageId={loaded.page.id}
                  initialDoc={loaded.page.doc}
                />
              </div>
            </article>

            <Show when={insertOpen()}>
              <InsertScriptDialog
                pageId={loaded.page.id}
                onClose={() => setInsertOpen(false)}
                onNotify={notify}
              />
            </Show>
          </div>
        )}
      </Show>

      <Show when={toast()} keyed>
        {(message) => <div class="nb-script-toast">{message}</div>}
      </Show>
    </main>
  );
}
