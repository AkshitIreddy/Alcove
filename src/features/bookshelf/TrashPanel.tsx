/**
 * features/bookshelf/TrashPanel.tsx — what is in the trash.
 *
 * Opens from the trash button on the shelf's left rail. (It used to be a
 * drawer front drawn under the last floor, inside the case — a piece of
 * furniture you had to scroll to the bottom of the library to reach, and the
 * only chrome that was not on a rail. The panel kept the name for a while
 * after the drawer went.) Hand-drawn aged-paper card listing crumpled books
 * with per-book restore, and an "empty" action guarded by a two-step confirm
 * (permanent delete).
 *
 * ## ONE DRAWER FOR THE WHOLE LIBRARY, and it now says so
 *
 * A library is a collection of bookcases, so "what is in the trash" had two
 * possible answers — this case's, or every case's — and the panel used to
 * answer the second one silently. `listTrashedBooks()` is library-wide;
 * `listTrashedBooksIn()` sits right beside it in data/books.ts; the panel
 * passed the parameterless one straight to `createResource` and never
 * mentioned which it had picked.
 *
 * Library-wide is the right default and it stays. A reader opens the trash
 * because something they wrote is gone, and the one thing they reliably do NOT
 * remember is which bookcase it was standing in — a per-case drawer answers
 * "it is not here" for a book that is two clicks away, which is the worst
 * answer a search can give. But silence about it was the actual bug, because
 * three things downstream are per-case and surprising if you assumed otherwise:
 *
 *  - **Restore returns a book to the case it came from** (`restoreBook` reads
 *    the book's own `bookcase_id`), so restoring from here can put a book on a
 *    shelf you are not looking at. Every row is labelled with its case, and a
 *    restore that lands somewhere else says where and offers to take you.
 *  - **Empty is library-wide too.** A confirm that says "really?" while the
 *    reader believes they are clearing one room is a confirm that lied, so it
 *    now counts what it is about to shred and names the scope.
 *  - **The shelf behind the card only shows one case**, so a row can name a
 *    book that is nowhere on screen. The case chip is what closes that gap.
 *
 * And since a reader who DOES remember the room deserves the narrower list,
 * there is a scope toggle — but only when there is more than one bookcase, and
 * everything that follows it (the count, the empty button, the dust) follows
 * the scope. The narrowing is done here on the library-wide rows rather than by
 * a second query, so the filter and the chips can never disagree about which
 * case a book belongs to (`bookcaseOf` folds a case-less row into the default
 * case; SQL `bookcase_id = $1` would not).
 *
 * The tooltip layer it leans on is mounted by BookshelfWorld, which is the
 * only thing that opens this card.
 */

import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import {
  bookcaseOf,
  deleteBook,
  emptyTrash,
  listTrashedBooks,
  readShelfMeta,
  restoreBook,
} from '../../data/books';
import {
  bookcases,
  loadBookcases,
  switchBookcase,
} from '../../data/bookcases';
import type { Book } from '../../data/types';
import { play } from '../../sound/engine';

/** Which drawer the card is showing. Only ever `case` in a multi-case library. */
type Scope = 'library' | 'case';

export interface TrashPanelProps {
  onClose(): void;
  /** Called after any restore/empty so the shelf world reloads floors. */
  onChanged(): void;
}

function deletedLabel(iso: string | undefined): string {
  if (iso === undefined) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}

/** "1 book" / "7 books" — the count the confirm has to be honest about. */
function bookCount(n: number): string {
  return `${n} ${n === 1 ? 'book' : 'books'}`;
}

export default function TrashPanel(props: TrashPanelProps): JSX.Element {
  /*
   * Always the whole library. The scope toggle narrows this list rather than
   * re-querying, so "3 elsewhere" is free and the case chips and the filter
   * are reading the same field — see the docblock.
   */
  const [all, { refetch }] = createResource(listTrashedBooks);
  const [scope, setScope] = createSignal<Scope>('library');
  const [confirmingEmpty, setConfirmingEmpty] = createSignal(false);
  /** Where the last restore actually landed, when it was not the open case. */
  const [landed, setLanded] = createSignal<{ title: string; caseId: string } | null>(
    null,
  );
  let rootElement: HTMLDivElement | undefined;

  onMount(() => {
    // The names on the chips come from here. The shelf has almost always
    // loaded the collection already; this is idempotent and covers the case
    // where the panel is the first thing to ask.
    void loadBookcases();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
      }
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (rootElement !== undefined && !rootElement.contains(e.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    });
  });

  /** More than one bookcase — the only situation any of this matters in. */
  const manyCases = (): boolean => bookcases.list.length > 1;

  /**
   * A case's name. A book whose case has since been deleted cannot really
   * happen (deleting a case takes its trash with it — `listBooksInBookcase`
   * includes floor -1), but a row with no label at all would be worse than one
   * that admits it does not know.
   */
  const caseName = (id: string): string =>
    bookcases.list.find((c) => c.id === id)?.name ?? 'a bookcase since removed';

  const rows = createMemo<Book[]>(() => {
    const list = all() ?? [];
    if (scope() === 'library' || !manyCases()) return list;
    const here = bookcases.activeId;
    return list.filter((book) => bookcaseOf(book) === here);
  });

  /** In the library-wide list but not in the open case. */
  const elsewhere = createMemo<number>(
    () =>
      (all() ?? []).filter((book) => bookcaseOf(book) !== bookcases.activeId).length,
  );

  /** Show the case chip only when it can tell the reader something. */
  const showCases = (): boolean => manyCases() && scope() === 'library';

  const setScopeTo = (next: Scope): void => {
    // A confirm is about a specific pile of books. Changing which pile is
    // showing must take the armed confirm with it, or the second press shreds
    // a set the reader never agreed to.
    setConfirmingEmpty(false);
    setLanded(null);
    setScope(next);
  };

  async function handleRestore(book: Book): Promise<void> {
    void play('book-return');
    const home = bookcaseOf(book);
    await restoreBook(book.id);
    // Only worth saying when the book went back somewhere the reader is not
    // looking; otherwise it is already visibly back on the shelf behind.
    setLanded(
      home === bookcases.activeId ? null : { title: book.title, caseId: home },
    );
    await refetch();
    props.onChanged();
  }

  /** Take the reader to the case a restored book actually landed in. */
  async function handleGoThere(caseId: string): Promise<void> {
    setLanded(null);
    await switchBookcase(caseId);
    props.onChanged();
    props.onClose();
  }

  async function handleEmpty(): Promise<void> {
    if (!confirmingEmpty()) {
      setConfirmingEmpty(true);
      return;
    }
    void play('crumple-delete');
    setLanded(null);
    if (scope() === 'case' && manyCases()) {
      /*
       * Exactly the rows the confirm just counted, by id.
       *
       * NOT `emptyTrash(activeId)`: that scopes in SQL on `bookcase_id`, while
       * the list above scopes with `bookcaseOf`, which folds a row whose case
       * was never written into the default case. The two agree on every row
       * the orphan sweep in `ensureBookcases()` has seen — but an import
       * revert re-inserts historical rows verbatim mid-session, and one of
       * those in the drawer would be LISTED here and then survive its own
       * "empty", which reads as a button that does not work.
       */
      for (const book of rows()) await deleteBook(book.id);
    } else {
      // The whole drawer, including anything that arrived while the card was
      // open — which is what "empty the trash" says.
      await emptyTrash();
    }
    setConfirmingEmpty(false);
    await refetch();
    props.onChanged();
  }

  /** What the resting empty button promises to do. */
  const emptyLabel = (): string => {
    if (scope() === 'case' && manyCases()) return 'Empty this bookcase’s trash…';
    return manyCases() ? 'Empty every bookcase’s trash…' : 'Empty the trash…';
  };

  /** …and what the armed one admits it is about to shred. */
  const confirmLabel = (): string =>
    scope() === 'case' && manyCases()
      ? `Really shred ${bookCount(rows().length)} from ${caseName(bookcases.activeId)}?`
      : `Really shred ${bookCount(rows().length)}?`;

  return (
    <div
      class="shelf-trash"
      role="dialog"
      aria-label="Trash"
      ref={rootElement}
    >
      <div class="shelf-trash__head">
        <span class="shelf-trash__title">Trash</span>
        <button
          type="button"
          class="shelf-trash__close"
          aria-label="Close trash"
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      {/* The sentence the panel used not to say. One bookcase and there is
          nothing to disclose, so it is not said. */}
      <Show when={manyCases()}>
        <div class="shelf-trash__scope">
          <p class="shelf-trash__said">
            {scope() === 'library'
              ? `one drawer for all ${bookcases.list.length} bookcases — each book goes back to its own.`
              : `only what you deleted from ${caseName(bookcases.activeId)}.`}
          </p>
          <div class="shelf-trash__tabs" role="group" aria-label="Trash scope">
            <button
              type="button"
              class="shelf-trash__tab"
              classList={{ 'is-on': scope() === 'library' }}
              aria-pressed={scope() === 'library'}
              data-shelf-scope="library"
              onClick={() => setScopeTo('library')}
            >
              every bookcase
            </button>
            <button
              type="button"
              class="shelf-trash__tab"
              classList={{ 'is-on': scope() === 'case' }}
              aria-pressed={scope() === 'case'}
              data-shelf-scope="case"
              onClick={() => setScopeTo('case')}
            >
              this one
            </button>
          </div>
        </div>
      </Show>

      <Show
        when={rows().length > 0}
        fallback={
          <>
            <p class="shelf-trash__empty">
              {scope() === 'case' && manyCases()
                ? '~ nothing but dust in this bookcase ~'
                : '~ nothing but dust in here ~'}
            </p>
            {/* "It is not here" is only a true answer if it also says where
                else to look. */}
            <Show when={scope() === 'case' && elsewhere() > 0}>
              <p class="shelf-trash__said">
                {bookCount(elsewhere())} in other bookcases.{' '}
                <button
                  type="button"
                  class="shelf-trash__link"
                  onClick={() => setScopeTo('library')}
                >
                  show them
                </button>
              </p>
            </Show>
          </>
        }
      >
        <ul class="shelf-trash__list">
          <For each={rows()}>
            {(book) => (
              <li class="shelf-trash__row">
                <span class="shelf-trash__what">
                  {/* Long names clip in this column; the app's own tooltip
                      (views/Tooltip.tsx) gives the whole one back — and only
                      then, which is what `-clipped` means. The card hugs the
                      left edge, so it opens to the right. */}
                  <span
                    class="shelf-trash__name"
                    data-tooltip={book.title}
                    data-tooltip-side="right"
                    data-tooltip-clipped=""
                  >
                    {book.title}
                  </span>
                  <span class="shelf-trash__meta">
                    <Show when={showCases()}>
                      {/* The label AND the promise: this is where Restore will
                          put it back, which is the whole reason the chip is
                          here rather than a bare case name. */}
                      <span
                        class="shelf-trash__case"
                        data-tooltip={`goes back to ${caseName(bookcaseOf(book))}`}
                        data-tooltip-side="right"
                      >
                        {caseName(bookcaseOf(book))}
                      </span>
                    </Show>
                    <span class="shelf-trash__when">
                      {deletedLabel(readShelfMeta(book)?.deletedAt)}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  class="shelf-menu__btn is-primary"
                  aria-label={`Restore ${book.title}`}
                  onClick={() => void handleRestore(book)}
                >
                  Restore
                </button>
              </li>
            )}
          </For>
        </ul>

        <div class="shelf-trash__foot">
          <button
            type="button"
            class="shelf-menu__btn is-danger"
            data-shelf-action="empty-trash"
            onClick={() => void handleEmpty()}
          >
            {confirmingEmpty() ? confirmLabel() : emptyLabel()}
          </button>
          <Show when={confirmingEmpty()}>
            <button
              type="button"
              class="shelf-menu__btn"
              onClick={() => setConfirmingEmpty(false)}
            >
              Keep
            </button>
          </Show>
        </div>
      </Show>

      {/*
        Where the last restore actually landed, when that was not here.

        OUTSIDE the list/empty branch on purpose: restoring the only book in
        the drawer flips this card to "nothing but dust", and that is precisely
        the moment a reader most needs to be told the book is not lost, it is
        in the other room.
      */}
      <Show when={landed()}>
        {(note) => (
          <p class="shelf-trash__said shelf-trash__said--landed" role="status">
            “{note().title}” went back to {caseName(note().caseId)}.{' '}
            <button
              type="button"
              class="shelf-trash__link"
              data-shelf-action="goto-case"
              onClick={() => void handleGoThere(note().caseId)}
            >
              go there
            </button>
          </p>
        )}
      </Show>
    </div>
  );
}
