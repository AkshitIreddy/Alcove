/**
 * features/bookshelf/BookshelfWorld.tsx — Solid wrapper for the shelf world.
 *
 * Mounts the Pixi canvas into a host div, renders the offscreen accessibility
 * mirror (one focusable row per visible book) and the pulled-book DOM overlay.
 * All heavy lifting lives in world.ts; this component only owns reactive
 * state and DOM structure.
 */

import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { appState } from '../../state/app';
import type { Book } from '../../data/types';
import PulledBookOverlay from './PulledBookOverlay';
import { ShelfWorld, type RectLike, type VisibleBook } from './world';

interface OverlayState {
  book: Book;
  rect: RectLike;
  mode: 'open' | 'close';
}

export default function BookshelfWorld(): JSX.Element {
  let host!: HTMLDivElement;
  const [visibleBooks, setVisibleBooks] = createSignal<VisibleBook[]>([]);
  const [overlay, setOverlay] = createSignal<OverlayState | null>(null);
  let world: ShelfWorld | null = null;
  let disposed = false;

  onMount(() => {
    void ShelfWorld.create(host, {
      onVisibleBooksChange: (books) => {
        if (!disposed) setVisibleBooks(books);
      },
      onGhostReady: (book, rect) => {
        if (!disposed) setOverlay({ book, rect, mode: 'open' });
      },
    }).then((w) => {
      if (disposed) {
        w.destroy();
        return;
      }
      world = w;
      // Returning from an open book: fly the cover back onto the shelf.
      void w.ready.then(() => {
        if (!disposed) beginReturnIfPending(w);
      });
    });
  });

  onCleanup(() => {
    disposed = true;
    world?.destroy();
    world = null;
  });

  function beginReturnIfPending(w: ShelfWorld): void {
    const bookId = appState.openBookId();
    if (bookId === null || appState.viewState() !== 'shelf') return;
    const prep = w.prepareReturn(bookId);
    if (prep === null) {
      appState.clearOpenBook();
      return;
    }
    setOverlay({ book: prep.book, rect: prep.rect, mode: 'close' });
  }

  function handleHandoff(state: OverlayState): void {
    if (world === null) return;
    if (state.mode === 'open') {
      world.fadeGhost();
    } else {
      world.pushInBook(state.book, () => appState.clearOpenBook());
    }
  }

  function handleDone(state: OverlayState): void {
    if (state.mode === 'open') {
      // Hand over to the book view; this unmounts the shelf (camera is
      // preserved in the module-level session snapshot).
      appState.openBook(state.book.id);
    } else {
      setOverlay(null);
    }
  }

  return (
    <div class="shelf-root" ref={host}>
      <Show when={overlay()}>
        {(state) => (
          <PulledBookOverlay
            book={state().book}
            spineRect={state().rect}
            mode={state().mode}
            onHandoff={() => handleHandoff(state())}
            onDone={() => handleDone(state())}
          />
        )}
      </Show>
      <nav class="shelf-a11y" aria-label="Bookshelf">
        <ul>
          <For each={visibleBooks()}>
            {(book) => (
              <li>
                <button
                  type="button"
                  aria-label={`Open ${book.title}, floor ${book.floor + 1}`}
                  onClick={() => world?.openFromList(book.id)}
                >
                  {book.title}
                </button>
              </li>
            )}
          </For>
        </ul>
      </nav>
    </div>
  );
}
