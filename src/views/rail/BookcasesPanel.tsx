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
 *
 * Cloning copies the FURNITURE and nothing else: the room's colours, the
 * carpentry, the paper, the floor count — never the books. "I want another one
 * of these to sort into" is the whole reason anyone asks for a second bookcase
 * that looks like the first, and a copy that arrived pre-filled with duplicates
 * of every book would be the opposite of that.
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
  setBookcaseRoom,
  switchBookcase,
  type Bookcase,
} from '../../data/bookcases';
import { countBooksInBookcase } from '../../data/books';
import { prefsForBookcase, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import { DesignCanvas } from './designArt';
import {
  loadDesignPrefs,
  roomDesign,
  saveRoomDesign,
  shelfDesignOf,
  snapshotRoomDesign,
} from '../../data/designPrefs';

const CARD_W = 152;
const CARD_H = 104;

/**
 * "My Library copy", then "… copy 2". Numbered from the second copy rather
 * than the first, because "copy 1" reads as though there is a copy 0.
 */
export function copyName(source: string, taken: readonly string[]): string {
  const used = new Set(taken);
  const base = `${source} copy`.slice(0, 60);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const numbered = `${source} copy ${n}`.slice(0, 60);
    if (!used.has(numbered)) return numbered;
  }
}

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
  /** Bumped to re-ask the database how many books each case holds. */
  const [stamp, setStamp] = createSignal(0);
  let rootEl: HTMLDivElement | undefined;

  const recount = (): void => {
    setStamp((n) => n + 1);
  };

  onMount(() => {
    void loadBookcases();
    void loadDesignPrefs();

    /*
     * `RailPanel` mounts its children at app start and only slides them into
     * view later, so the first count below runs before the seed has shelved a
     * single book — and the list of ids it keys on does not change when that
     * book arrives, so it never asked again. Observed, not theorised: the card
     * for a case holding the welcome book read "0 books" while
     * `countBooksInBookcase` answered 1 for the same id from the console.
     *
     * Re-ask whenever the collection is actually on screen. Geometry, not a
     * prop: the sheet parks itself off the left edge, so "did this come into
     * view" is a question the platform can already answer, and it stays true
     * for the copy of this panel that lives behind the book studio's tab.
     */
    const host = rootEl;
    if (host === undefined || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) recount();
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  /**
   * Book counts, re-fetched whenever the list changes, whenever the panel is
   * shown, and after every mutation. One small query per case: cheap next to
   * the case art, and a card that says "empty" is what makes the delete button
   * safe to press without thinking.
   */
  const [counts] = createResource(
    () => ({ stamp: stamp(), ids: bookcases.list.map((c) => c.id) }),
    async (key: { ids: readonly string[] }): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const id of key.ids) {
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
      // Everything this panel does can change a count — a delete takes books
      // with it, a switch does not but costs one cheap query to prove it.
      recount();
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
      // Created AND opened: the reader pressed "add bookcase" to go and stand
      // in one, not to add a row to a list they then have to click.
      await switchBookcase(made.id);
      props.onSwitched?.(made.id);
    });
  };

  /**
   * A second bookcase built exactly like this one, with nothing on it.
   *
   * Three stores hold "what this case looks like" and all three have to come
   * across or the copy is not one: the validated room blob (its colours, which
   * may borrow timber from one room and the wall from another — so the whole
   * blob goes, not just `theme`), the carpentry and paper in `designPrefs`,
   * and the floor count on the row itself.
   *
   * It does NOT switch. The copy is empty by design, and teleporting the
   * reader into a case that looks identical to the one they were standing in
   * but has lost every book reads as a catastrophe rather than as a copy. The
   * card appears in the grid, one click away, and the note says what happened.
   */
  const cloneCase = (source: Bookcase): void => {
    setNote(null);
    setConfirming(null);
    setWithBooks(null);
    void run(async () => {
      const room = prefsForBookcase(source.id);
      const design = snapshotRoomDesign(source.id);
      const made = await createBookcase({
        name: copyName(source.name, bookcases.list.map((c) => c.name)),
        theme: room.theme,
        floors: source.floors,
      });
      await setBookcaseRoom(made.id, JSON.stringify(room));
      await saveRoomDesign(design, made.id);
      setNote(`“${made.name}” is the same bookcase, with nothing on it yet.`);
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
    <div
      class="nb-cases"
      ref={(el) => (rootEl = el)}
      data-busy={busy() ? 'true' : 'false'}
    >
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

                {/* The name's tooltip is `-clipped`: the text is right there,
                    so it only speaks up when it is actually cut off. */}
                <Show
                  when={renaming() === bookcase.id}
                  fallback={
                    <span
                      class="nb-case-name"
                      data-tooltip={bookcase.name}
                      data-tooltip-clipped
                    >
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
                  <button
                    type="button"
                    class="nb-chip nb-chip-ghost"
                    aria-label={`Clone ${bookcase.name} without its books`}
                    data-tooltip="a second bookcase built the same way — the shelf only, no books"
                    onClick={() => cloneCase(bookcase)}
                  >
                    clone
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
          add bookcase
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
