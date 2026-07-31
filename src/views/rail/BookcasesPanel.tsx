/**
 * src/views/rail/BookcasesPanel.tsx — the reader's collection of bookcases.
 *
 * A library is now several cases, each with its own room, its own carpentry
 * and its own books, so there has to be somewhere to see them side by side.
 * That is this: one card per case, painted from that case's OWN colours and
 * OWN build (not the open one's), so the collection reads as a row of real
 * furniture rather than a list of names.
 *
 * Deleting is the only destructive thing in the panel and it asks twice on
 * purpose. `deleteBookcase` refuses a case that still holds books and reports
 * how many, which is exactly the number the second question needs — so the
 * reader is never told "are you sure?" without being told what is at stake.
 * The last case is never deletable; a library has to have somewhere to put
 * the next book.
 */
import { For, Show, createResource, createSignal, onMount, type JSX } from 'solid-js';
import { fnv1a } from '../../art/noise';
import { drawCaseCard } from '../../art/flatShelf';
import {
  MAX_FLOOR_COUNT,
  addBookcaseFloor,
  bookcases,
  createBookcase,
  deleteBookcase,
  loadBookcases,
  renameBookcase,
  switchBookcase,
  type Bookcase,
} from '../../data/bookcases';
import { countBooksInBookcase } from '../../data/books';
import { prefsForBookcase, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import { DesignCanvas } from './designArt';
import { loadDesignPrefs, roomDesign, shelfDesignOf } from '../../data/designPrefs';

const CARD_W = 152;
const CARD_H = 104;

export interface BookcasesPanelProps {
  /** Fired after a switch, so the host can close itself or cue a sound. */
  onSwitched?(id: string): void;
}

export default function BookcasesPanel(props: BookcasesPanelProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [confirming, setConfirming] = createSignal<string | null>(null);
  /** A case that refused to go because it still holds books, and how many. */
  const [withBooks, setWithBooks] = createSignal<{ id: string; count: number } | null>(null);
  const [note, setNote] = createSignal<string | null>(null);

  onMount(() => {
    void loadBookcases();
    void loadDesignPrefs();
  });

  /**
   * Book counts, re-fetched whenever the list changes. One small query per
   * case: cheap next to the case art, and a card that says "empty" is what
   * makes the delete button safe to press without thinking.
   */
  const [counts] = createResource(
    () => bookcases.list.map((c) => c.id).join(','),
    async (ids: string): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const id of ids.split(',').filter((s) => s.length > 0)) {
        try {
          out[id] = await countBooksInBookcase(id);
        } catch {
          // A count that will not load is not worth failing the panel over.
        }
      }
      return out;
    },
  );

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const open = (id: string): void => {
    if (id === bookcases.activeId) return;
    void run(async () => {
      await switchBookcase(id);
      props.onSwitched?.(id);
    });
  };

  const addCase = (): void => {
    setNote(null);
    void run(async () => {
      const made = await createBookcase({});
      // Created AND opened: the reader pressed "a new bookcase" to go and
      // stand in one, not to add a row to a list they then have to click.
      await switchBookcase(made.id);
      props.onSwitched?.(made.id);
    });
  };

  const commitRename = (id: string, value: string): void => {
    setRenaming(null);
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    void run(() => renameBookcase(id, trimmed));
  };

  const remove = (id: string, alsoBooks: boolean): void => {
    setNote(null);
    void run(async () => {
      const outcome = await deleteBookcase(id, { withBooks: alsoBooks });
      if (outcome.ok) {
        setConfirming(null);
        setWithBooks(null);
        return;
      }
      if (outcome.reason === 'not-empty') {
        setConfirming(null);
        setWithBooks({ id, count: outcome.bookCount });
        return;
      }
      setConfirming(null);
      setWithBooks(null);
      setNote(
        outcome.reason === 'last-bookcase'
          ? 'a library keeps at least one bookcase.'
          : 'that bookcase is already gone.',
      );
    });
  };

  const floors = (): number => bookcases.list.find((c) => c.id === bookcases.activeId)?.floors ?? 0;

  return (
    <div class="nb-cases" data-busy={busy() ? 'true' : 'false'}>
      <div class="nb-case-grid">
        <For each={bookcases.list}>
          {(bookcase: Bookcase) => {
            const scheme = (): ReturnType<typeof resolveLibrary>['scheme'] =>
              resolveLibrary(prefsForBookcase(bookcase.id)).scheme;
            const design = (): ReturnType<typeof shelfDesignOf> =>
              shelfDesignOf(roomDesign(bookcase.id));
            const isOpen = (): boolean => bookcase.id === bookcases.activeId;
            const count = (): number | undefined => counts()?.[bookcase.id];
            /** The blur that follows Enter or Escape has already been handled. */
            let cancelled = false;
            return (
              <div class="nb-case" classList={{ 'is-open': isOpen() }}>
                <button
                  type="button"
                  class="nb-case-open"
                  aria-pressed={isOpen()}
                  aria-label={`${isOpen() ? 'Open bookcase' : 'Switch to'} ${bookcase.name}`}
                  onClick={() => open(bookcase.id)}
                >
                  <DesignCanvas
                    class="nb-case-art"
                    key={`case|${design().build}|${design().pattern}`}
                    w={CARD_W}
                    h={CARD_H}
                    scheme={scheme()}
                    draw={(ctx, w, h) =>
                      drawCaseCard(ctx, w, h, fnv1a(`${bookcase.id}|card`), design())
                    }
                  />
                </button>

                <Show
                  when={renaming() === bookcase.id}
                  fallback={
                    <span class="nb-case-name" title={bookcase.name}>
                      {bookcase.name}
                    </span>
                  }
                >
                  <input
                    class="nb-case-rename"
                    type="text"
                    value={bookcase.name}
                    maxLength={60}
                    aria-label={`Rename ${bookcase.name}`}
                    ref={(el) => queueMicrotask(() => el.select())}
                    /* Cancelling removes the input, which fires blur — and a
                       naive blur handler then commits the very text Escape was
                       pressed to throw away. Observed: Escape renamed the case
                       to the abandoned draft. */
                    onBlur={(e) => {
                      if (cancelled) {
                        cancelled = false;
                        return;
                      }
                      commitRename(bookcase.id, e.currentTarget.value);
                    }}
                    /* `on:keydown`, not `onKeyDown`: the studio root stops
                       keydown natively before it can reach the document, and
                       Solid delegates `onKeyDown` TO the document — so the
                       delegated form never ran and Enter did nothing at all.
                       See shelfKeys.ts. */
                    on:keydown={(e: KeyboardEvent) => {
                      const input = e.currentTarget as HTMLInputElement;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        cancelled = true; // the blur that follows is ours
                        commitRename(bookcase.id, input.value);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        // Escape here cancels the RENAME. Without stopping it
                        // the sheet's own window listener also sees it and
                        // shuts the whole studio, which is not what "never
                        // mind, it was called that already" should do.
                        e.stopPropagation();
                        cancelled = true;
                        setRenaming(null);
                      }
                    }}
                  />
                </Show>

                <span class="nb-case-meta">
                  {count() === undefined
                    ? `${bookcase.floors} floors`
                    : `${count()} ${count() === 1 ? 'book' : 'books'} · ${bookcase.floors} floors`}
                </span>

                <div class="nb-case-tools">
                  <button
                    type="button"
                    class="nb-chip nb-chip-ghost"
                    onClick={() => setRenaming(bookcase.id)}
                  >
                    rename
                  </button>
                  <Show
                    when={confirming() === bookcase.id || withBooks()?.id === bookcase.id}
                    fallback={
                      <button
                        type="button"
                        class="nb-chip nb-chip-ghost"
                        onClick={() => {
                          setNote(null);
                          setWithBooks(null);
                          setConfirming(bookcase.id);
                        }}
                      >
                        delete
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="nb-chip nb-chip-danger"
                      onClick={() => remove(bookcase.id, withBooks()?.id === bookcase.id)}
                    >
                      {withBooks()?.id === bookcase.id
                        ? `delete ${withBooks()?.count} too`
                        : 'really?'}
                    </button>
                    <button
                      type="button"
                      class="nb-chip nb-chip-ghost"
                      onClick={() => {
                        setConfirming(null);
                        setWithBooks(null);
                      }}
                    >
                      keep
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={note() !== null}>
        <p class="nb-panel-footnote nb-case-note" role="status">
          {note()}
        </p>
      </Show>

      <div class="nb-chip-row nb-case-actions">
        <button type="button" class="nb-chip nb-chip-gilt" onClick={addCase}>
          a new bookcase
        </button>
        <button
          type="button"
          class="nb-chip"
          disabled={floors() >= MAX_FLOOR_COUNT}
          onClick={() => void run(() => addBookcaseFloor())}
        >
          add a floor
        </button>
      </div>
      <p class="nb-panel-footnote">
        {floors() >= MAX_FLOOR_COUNT
          ? `this bookcase is as tall as they go (${MAX_FLOOR_COUNT} floors).`
          : `this bookcase has ${floors()} floors. everything below is dressed here.`}
      </p>
    </div>
  );
}
