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

export interface ShelfStudioProps {
  open: boolean;
  /** The book being dressed, or null for the room-only studio. */
  bookId: string | null;
  onClose(): void;
  /** Fired after a change that the shelf must re-read from the DB. */
  onBookChanged?(): void;
}

export default function ShelfStudio(props: ShelfStudioProps): JSX.Element {
  const [book, setBook] = createSignal<Book | null>(null);
  const [overrides, setOverrides] = createSignal<CoverOverrides | null>(null);
  const [pageDefaults, setPageDefaults] = createSignal<BookPageDefaults | null>(null);

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
    if (props.bookId !== null) props.onBookChanged?.();
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
            <div class="nb-studio-pane">
              <LibraryStudio />
              <p class="nb-panel-footnote nb-studio-hint">
                want to dress one book instead? right-click its spine on the
                shelf and pick “dress this book”.
              </p>
            </div>
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
