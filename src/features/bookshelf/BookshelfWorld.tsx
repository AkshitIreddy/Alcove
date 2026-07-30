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
import {
  duplicateBook,
  readShelfMeta,
  renameBook,
  setBookPinned,
  trashBook,
  updateBookPageCount,
} from '../../data/books';
import type { Book } from '../../data/types';
import { play } from '../../sound/engine';
import { floorNameSync, saveFloorName } from './floorNames';
import PulledBookOverlay from './PulledBookOverlay';
import ShelfMenu, { type ShelfMenuAction } from './ShelfMenu';
import TrashPanel from './TrashPanel';
import { ShelfWorld, type RectLike, type VisibleBook } from './world';

interface OverlayState {
  book: Book;
  rect: RectLike;
  mode: 'open' | 'close';
}

interface MenuState {
  book: Book;
  x: number;
  y: number;
}

interface PlateEditState {
  floor: number;
  rect: RectLike;
}

export default function BookshelfWorld(): JSX.Element {
  let host!: HTMLDivElement;
  const [visibleBooks, setVisibleBooks] = createSignal<VisibleBook[]>([]);
  const [overlay, setOverlay] = createSignal<OverlayState | null>(null);
  const [zoomPct, setZoomPct] = createSignal(100);
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [plateEdit, setPlateEdit] = createSignal<PlateEditState | null>(null);
  const [trashOpen, setTrashOpen] = createSignal(false);
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
      onZoomChange: (percent) => {
        if (!disposed) setZoomPct(percent);
      },
      onBookMenu: (book, screen) => {
        if (!disposed) setMenu({ book, x: screen.x, y: screen.y });
      },
      onEditFloorPlate: (floor, rect) => {
        if (!disposed) setPlateEdit({ floor, rect });
      },
      onOpenTrash: () => {
        if (!disposed) setTrashOpen(true);
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
    // Auto book thickness: re-count pages after a writing session so the
    // spine width reflects the book's real girth on this remount.
    void updateBookPageCount(bookId).then(() => {
      if (!disposed) void w.refreshData();
    });
    const prep = w.prepareReturn(bookId);
    if (prep === null) {
      appState.clearOpenBook();
      return;
    }
    setOverlay({ book: prep.book, rect: prep.rect, mode: 'close' });
  }

  /** Run a shelf-menu action against the data layer, then re-sync the world. */
  function handleMenuAction(book: Book, action: ShelfMenuAction): void {
    const w = world;
    if (w === null) return;
    if (action === 'open') {
      w.openFromList(book.id);
      return;
    }
    if (action === 'move') {
      w.beginMove(book.id);
      return;
    }
    void (async () => {
      if (action === 'pin') {
        void play('pop-soft');
        await setBookPinned(book.id, readShelfMeta(book)?.pinned !== true);
      } else if (action === 'duplicate') {
        void play('pop-soft');
        await duplicateBook(book.id);
      } else if (action === 'delete') {
        void play('crumple-delete');
        await trashBook(book.id);
      }
      if (!disposed) await w.refreshData();
    })();
  }

  function handleRename(book: Book, title: string): void {
    const w = world;
    if (w === null) return;
    void (async () => {
      await renameBook(book.id, title);
      w.invalidateSpine(book.id);
      if (!disposed) await w.refreshData();
    })();
  }

  function commitPlate(state: PlateEditState, value: string): void {
    setPlateEdit(null);
    void saveFloorName(state.floor, value);
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
      <Show when={menu()}>
        {(state) => (
          <ShelfMenu
            book={state().book}
            x={state().x}
            y={state().y}
            pinned={readShelfMeta(state().book)?.pinned === true}
            onAction={(action) => handleMenuAction(state().book, action)}
            onRename={(title) => handleRename(state().book, title)}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>
      <Show when={plateEdit()}>
        {(state) => (
          <input
            class="shelf-plate-edit"
            type="text"
            maxLength={40}
            aria-label={`Name for floor ${state().floor + 1}`}
            value={floorNameSync(state().floor) ?? ''}
            placeholder={`Floor ${state().floor + 1}`}
            style={{
              left: `${state().rect.x - 30}px`,
              top: `${state().rect.y - 6}px`,
              width: `${Math.max(state().rect.width + 60, 170)}px`,
              height: `${Math.max(state().rect.height + 12, 30)}px`,
            }}
            ref={(node) => queueMicrotask(() => {
              node.focus();
              node.select();
            })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitPlate(state(), e.currentTarget.value);
              else if (e.key === 'Escape') setPlateEdit(null);
            }}
            onBlur={(e) => {
              const current = plateEdit();
              if (current !== null) commitPlate(current, e.currentTarget.value);
            }}
          />
        )}
      </Show>
      <Show when={trashOpen()}>
        <TrashPanel
          onClose={() => setTrashOpen(false)}
          onChanged={() => void world?.refreshData()}
        />
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
      <div class="shelf-zoom-pill" role="toolbar" aria-label="Zoom controls">
        <button
          type="button"
          class="shelf-zoom-pill__btn"
          aria-label="Zoom out"
          title="Zoom out (-)"
          onClick={() => world?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          class="shelf-zoom-pill__pct"
          aria-label="Reset zoom to 100%"
          title="Reset zoom (0)"
          onClick={() => world?.zoomReset()}
        >
          {zoomPct()}%
        </button>
        <button
          type="button"
          class="shelf-zoom-pill__btn"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => world?.zoomIn()}
        >
          +
        </button>
        <span class="shelf-zoom-pill__rule" aria-hidden="true" />
        <button
          type="button"
          class="shelf-zoom-pill__fit"
          aria-label="Fit bookcase to window"
          title="Fit the whole case"
          onClick={() => world?.zoomFit()}
        >
          fit
        </button>
      </div>
    </div>
  );
}
