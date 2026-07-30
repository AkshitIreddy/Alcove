/**
 * BookView — the opened book: one page rendered as a paper sheet with the
 * block editor inside. Page-flip navigation arrives with the flip feature;
 * for now the first page of the book is shown.
 */
import { Show, createResource, type JSX } from 'solid-js';
import { appState } from '../state/app';
import { editorState } from '../editor/state';
import { getBook, listBooksByFloorRange } from '../data/books';
import { createPage, listPages } from '../data/pages';
import { seedIfEmpty } from '../data/seed';
import type { Book, Page } from '../data/types';
import PageEditor from '../editor/PageEditor';
import '../styles/editor.css';

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
          </div>
        )}
      </Show>
    </main>
  );
}
