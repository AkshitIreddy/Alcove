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
import { Show, createEffect, createSignal, on, type JSX } from 'solid-js';
import { normalizeCoverOverrides, type CoverOverrides } from '../../art/covers';
import {
  getBook,
  readCoverOverrides,
  readPageDefaults,
  savePageDefaults,
  type BookPageDefaults,
} from '../../data/books';
import type { Book } from '../../data/types';
import CustomizePanel from './CustomizePanel';
import LibraryStudio from './LibraryStudio';
import RailPanel from './RailPanel';
import PacksPanel from '../../features/packs/PacksPanel';

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

  createEffect(
    on(
      () => props.bookId,
      (id) => {
        if (id === null) {
          setBook(null);
          setOverrides(null);
          setPageDefaults(null);
          return;
        }
        let stale = false;
        void getBook(id).then((loaded) => {
          if (stale) return;
          setBook(loaded);
          setOverrides(normalizeCoverOverrides(readCoverOverrides(loaded)));
          setPageDefaults(readPageDefaults(loaded));
        });
        return () => {
          stale = true;
        };
      },
    ),
  );

  /**
   * Preview state only — `CustomizePanel` is given a `bookId`, so it already
   * persists BOTH `cover_meta.style` and its cover projection through
   * `persistBookStyle`. Writing the cover section a second time from here
   * would race that read-merge-write and could drop the style blob.
   */
  const changeOverrides = (next: CoverOverrides | null): void => {
    setOverrides(next);
  };

  const changeDefaults = (next: BookPageDefaults | null): void => {
    setPageDefaults(next);
    const id = props.bookId;
    if (id === null) return;
    void savePageDefaults(id, next);
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
            bookId={loaded().id}
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
