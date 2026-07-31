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
 */

import {
  For,
  Show,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import {
  emptyTrash,
  listTrashedBooks,
  readShelfMeta,
  restoreBook,
} from '../../data/books';
import { play } from '../../sound/engine';

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

export default function TrashPanel(props: TrashPanelProps): JSX.Element {
  const [books, { refetch }] = createResource(listTrashedBooks);
  const [confirmingEmpty, setConfirmingEmpty] = createSignal(false);
  let rootElement: HTMLDivElement | undefined;

  onMount(() => {
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

  async function handleRestore(id: string): Promise<void> {
    void play('book-return');
    await restoreBook(id);
    await refetch();
    props.onChanged();
  }

  async function handleEmpty(): Promise<void> {
    if (!confirmingEmpty()) {
      setConfirmingEmpty(true);
      return;
    }
    void play('crumple-delete');
    await emptyTrash();
    setConfirmingEmpty(false);
    await refetch();
    props.onChanged();
  }

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

      <Show
        when={(books() ?? []).length > 0}
        fallback={<p class="shelf-trash__empty">~ nothing but dust in here ~</p>}
      >
        <ul class="shelf-trash__list">
          <For each={books() ?? []}>
            {(book) => (
              <li class="shelf-trash__row">
                <span class="shelf-trash__name" title={book.title}>
                  {book.title}
                </span>
                <span class="shelf-trash__when">
                  {deletedLabel(readShelfMeta(book)?.deletedAt)}
                </span>
                <button
                  type="button"
                  class="shelf-menu__btn is-primary"
                  onClick={() => void handleRestore(book.id)}
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
            {confirmingEmpty() ? 'Really shred everything?' : 'Empty the trash…'}
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
    </div>
  );
}
