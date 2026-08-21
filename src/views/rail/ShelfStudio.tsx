/**
 * src/views/rail/ShelfStudio.tsx — the studio, reachable from the SHELF.
 *
 * Until now the theme picker and the Book Studio only existed behind the
 * rail brush *inside* an open book, which meant a library you had not opened
 * yet could not be redressed at all. This is the same sheet, opened from the
 * shelf chrome:
 *
 *  - with no book chosen it is the Library studio alone (rooms, wall,
 *    wallpaper x colourway, flora, lamp warmth);
 *  - right-click a spine → "Dress this book…" and it becomes the full
 *    two-tab studio for that book, still opening on the room.
 *
 * Everything persists through the existing stores: `libraryPrefs` for the
 * room (the Pixi world subscribes, so the shelf re-bakes and crossfades the
 * moment a card is picked) and `cover_meta` for the book.
 *
 * The room-only branch carries its own two tabs, and that is not decoration.
 * It does NOT go through `CustomizePanel` — it mounts `LibraryStudio` straight
 * — so when the reader's own packs gained a home on that panel's third tab,
 * the whole hub was unreachable from the shelf, which is where somebody
 * standing in a library they have not opened would look for it. The strips
 * inside LibraryStudio could reach the popup; nothing could reach the list of
 * what had already been brought in.
 */
import { Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { normalizeCoverOverrides, type CoverOverrides } from '../../art/covers';
import {
  getBook,
  readCoverOverrides,
  readPageDefaults,
  savePageDefaults,
  type BookPageDefaults,
} from '../../data/books';
import type { Book } from '../../data/types';
import { bookStyleOverridesFor } from '../../features/bookshelf/bookIdentity';
import {
  bookSurpriseHistoryFor,
  bookSurpriseLocksFor,
} from '../../features/bookshelf/bookStudioPrefs';
import CustomizePanel from './CustomizePanel';
import LibraryStudio from './LibraryStudio';
import RailPanel from './RailPanel';
import PacksPanel from '../../features/packs/PacksPanel';
import { createShelfStudioHydration } from './latestBookHydration';

export interface ShelfStudioProps {
  open: boolean;
  /** The book being dressed, or null for the room-only studio. */
  bookId: string | null;
  onClose(): void;
}

export default function ShelfStudio(props: ShelfStudioProps): JSX.Element {
  const [book, setBook] = createSignal<Book | null>(null);
  const [overrides, setOverrides] = createSignal<CoverOverrides | null>(null);
  const [pageDefaults, setPageDefaults] = createSignal<BookPageDefaults | null>(null);
  const [roomTab, setRoomTab] = createSignal<'library' | 'own'>('library');

  const clearBook = (): void => {
    setBook(null);
    setOverrides(null);
    setPageDefaults(null);
  };

  const hydration = createShelfStudioHydration(
    getBook,
    clearBook,
    (id, loaded) => {
      // The ticket is authoritative; the prop checks document the mutation
      // boundary too, and protect this callback if the helper is ever reused.
      if (!props.open || props.bookId !== id) return;
      setBook(loaded);
      setOverrides(normalizeCoverOverrides(readCoverOverrides(loaded)));
      setPageDefaults(readPageDefaults(loaded));
    },
  );

  createEffect(
    on(
      () => [props.open, props.bookId] as const,
      ([open, id]) => {
        // A rising `open` edge is significant even when the shelf retained the
        // same id: another host may have edited that book while this rail was
        // closed. The controller also clears A before loading B, so every
        // child handler below is either bound to the hydrated book or absent.
        hydration.update(open, id);
      },
    ),
  );

  onCleanup(() => hydration.cancel());

  /**
   * Preview state only — `CustomizePanel` is given a `bookId`, so it already
   * persists BOTH `cover_meta.style` and its cover projection through
   * `persistBookStyle`. Writing the cover section a second time from here
   * would race that read-merge-write and could drop the style blob.
   */
  const changeOverrides = (next: CoverOverrides | null): void => {
    // A queued child event from the old panel must not repopulate preview
    // state after selection invalidated that panel. Keep the loaded row mounted
    // during the close tween, but revoke its authority as soon as `open` falls.
    if (!props.open || book() === null) return;
    setOverrides(next);
  };

  const changeDefaults = (next: BookPageDefaults | null): void => {
    if (!props.open) return;
    const loaded = book();
    if (loaded === null) return;
    setPageDefaults(next);
    void savePageDefaults(loaded.id, next);
  };

  const title = (): string => {
    const loaded = book();
    return loaded === null ? 'Library studio' : `Studio — ${loaded.title}`;
  };

  return (
    <RailPanel
      open={props.open}
      title={title()}
      panelClass="is-shelf"
      onClose={() => props.onClose()}
    >
      <Show
        when={book()}
        fallback={
          <div class="nb-customize nb-studio">
            <div class="nb-studio-tabs" role="tablist" aria-label="Studio">
              <button
                type="button"
                class="nb-studio-tab"
                role="tab"
                aria-selected={roomTab() === 'library'}
                classList={{ 'is-active': roomTab() === 'library' }}
                data-studio-tab="library"
                onClick={() => setRoomTab('library')}
              >
                this library
              </button>
              <button
                type="button"
                class="nb-studio-tab"
                role="tab"
                aria-selected={roomTab() === 'own'}
                classList={{ 'is-active': roomTab() === 'own' }}
                data-studio-tab="own"
                onClick={() => setRoomTab('own')}
              >
                your own
              </button>
            </div>
            <Show when={roomTab() === 'library'}>
              <div class="nb-studio-pane" role="tabpanel" aria-label="This library">
                <LibraryStudio />
                <p class="nb-panel-footnote nb-studio-hint">
                  want to dress one book instead? right-click its spine on the
                  shelf and pick “dress this book”.
                </p>
              </div>
            </Show>
            <Show when={roomTab() === 'own'}>
              <div class="nb-studio-pane" role="tabpanel" aria-label="Your own">
                <PacksPanel />
              </div>
            </Show>
          </div>
        }
      >
        {(loaded) => (
          <CustomizePanel
            /* A book was named, so open on the BOOK. This branch only renders
               once a spine's "dress this book…" has loaded one; the room-only
               studio is the fallback above and never reaches CustomizePanel.
               Starting on "this library" here meant the one menu item that
               asks for a book's wardrobe opened the room instead. */
            initialTab="book"
            open={props.open}
            host="shelf"
            bookId={loaded().id}
            initialBookStyle={bookStyleOverridesFor(loaded())}
            initialSurpriseLocks={bookSurpriseLocksFor(loaded())}
            initialSurpriseHistory={bookSurpriseHistoryFor(loaded())}
            spineSeed={loaded().spineSeed}
            title={loaded().title}
            overrides={overrides()}
            onOverridesChange={changeOverrides}
            pageDefaults={pageDefaults()}
            onPageDefaultsChange={changeDefaults}
          />
        )}
      </Show>
    </RailPanel>
  );
}
