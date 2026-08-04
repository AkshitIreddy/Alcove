/**
 * features/bookshelf/BookshelfWorld.tsx — Solid wrapper for the shelf world.
 *
 * Mounts the Pixi canvas into a host div, renders the offscreen accessibility
 * mirror (one focusable row per visible book) and the pulled-book DOM overlay.
 * All heavy lifting lives in world.ts; this component only owns reactive
 * state and DOM structure.
 *
 * It also owns the shelf's *chrome*, which is DOM on purpose — crisp text,
 * real focus rings, no re-bake when it moves:
 *  - the **ghost slot**: a dashed pencil outline of a book standing in the
 *    first free stretch of plank, following the camera (world.AddSpot);
 *  - the **shelf dock**: the left rail — "new book", the studio, "add a
 *    floor" and the trash, so none of them is ever more than one click away;
 *  - the **inline title tag**, standing beside a brand-new book (and never
 *    over it — see namePlate.ts);
 *  - the **first-run invitation** when the case is completely bare.
 *
 * Everything above rides inside `.shelf-stage`, which is the half of this
 * tree a side panel PUSHES aside (styles/rail.css reads the offset that
 * views/rail/panelPush.ts publishes). The panels themselves — the studio
 * sheet and the trash card — are deliberately OUTSIDE it: they must keep the
 * viewport as their containing block, and a panel cannot push itself.
 *
 * Everything inside the stage is positioned in CANVAS-LOCAL coordinates
 * (world.ts publishes `clientX - canvasRect.left`; see input.ts), which is
 * exactly what the stage's own transform undoes — so the menus, the plaque
 * editor and the ghost slot all keep landing under the pointer while the
 * room is stepped aside.
 */

import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { appState } from '../../state/app';
import {
  duplicateBook,
  readShelfMeta,
  renameBook,
  setBookPinned,
  touchBookOpened,
  trashBook,
  updateBookPageCount,
} from '../../data/books';
import type { Book } from '../../data/types';
import { bindingFor, formatBinding, registerCommands } from '../../data/keybindings';
import { settings } from '../../data/settings';
// Imported from the module that DEFINES the gallery rather than from
// `features/templates/groupD`: that barrel hydrates the custom-sticker
// registry on import, and the shelf has no business paying for the editor's
// asset table before a book has been opened.
import { openTemplatesGallery } from '../templates/TemplatesGallery';
import { play } from '../../sound/engine';
import Tooltips from '../../views/Tooltip';
import ShelfStudio from '../../views/rail/ShelfStudio';
import { floorNameSync, saveFloorName } from './floorNames';
import { namePlateBox, type NamePlateBox } from './namePlate';
import PulledBookOverlay from './PulledBookOverlay';
import ShelfMenu, {
  ShelfSpotMenu,
  type ShelfMenuAction,
  type ShelfSpotAction,
} from './ShelfMenu';
import TrashPanel from './TrashPanel';
import {
  NEW_BOOK_TITLE,
  ShelfWorld,
  type AddSpot,
  type RectLike,
  type VisibleBook,
} from './world';

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

interface SpotMenuState {
  floor: number;
  x: number;
  y: number;
}

interface PlateEditState {
  floor: number;
  rect: RectLike;
}

/** A book that just landed and is waiting for its title. */
interface NamingState {
  book: Book;
  rect: RectLike;
}

/** The two panels the dock rail opens. Only one may be up at a time. */
type DockPanel = 'studio' | 'trash';

/** Smallest the ghost slot may shrink to on screen (a clickable target). */
const GHOST_MIN_W = 30;
const GHOST_MIN_H = 104;

/* --------------------------- dock / case geometry -------------------------- */
/*
 * The dock is DOM floating over a full-bleed canvas, so "don't cover the
 * bookcase" is a geometry problem, not a z-index one. The case is 1200 world
 * px wide and the camera CENTRES it whenever the visible world is wider than
 * SHELF_WIDTH + 2 * X_SLACK (camera.xBounds collapses to a single point
 * there), so the free wall on each side is knowable from the zoom alone —
 * no extra plumbing through world.ts.
 *
 * Above that zoom the case runs off both edges and there is no wall left to
 * stand on; the dock shrinks to its icon-only form and hugs the window edge,
 * where it sits over the case's outer stile rather than over any book.
 */

/** Case width in world px — camera.ts SHELF_WIDTH. */
const CASE_W = 1200;
/** Horizontal slack the camera keeps beside the case — camera.ts X_SLACK. */
const CASE_SLACK = 60;
/**
 * Widths of the two dock forms, border included, measured in the browser and
 * rounded up: 104 and 61. The slack means a font that renders a hair wider
 * still lands on wall rather than on the case.
 */
const DOCK_FULL_W = 112;
const DOCK_MINI_W = 68;
/** Breathing room between the dock and the case's outer edge. */
const DOCK_GAP = 20;
/** Never let the dock touch the window edge. */
const DOCK_EDGE = 10;
/**
 * Below this the labelled rail starts to crowd the window, so it goes narrow
 * for headroom rather than for horizontal room. It was 620 while the brand
 * plate stood on top of the four buttons; the rail is ~300px tall without it,
 * so the labels now survive a much shorter window.
 */
const DOCK_SHORT_H = 520;

/* ------------------------------- chrome art ------------------------------- */
/*
 * Pre-wobbled inline SVG — the same trick the settings gear uses. Strokes
 * only (`fill:none` on every path), so a missing stylesheet can never turn
 * these into black boxes.
 */

function NewBookIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" class="shelf-dock__icon" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5.4 4.6 L12.2 4.2 L12.6 21.8 L5.8 22.2 Z" />
        <path d="M7.2 8.1 L10.6 7.9 M7.3 11.4 L10.7 11.2" />
        <path d="M20.6 12.2 L20.6 22.0 M15.7 17.1 L25.5 17.1" stroke-dasharray="0 0" />
        <path d="M15.6 8.6 L18.4 8.5" opacity="0.6" />
      </g>
    </svg>
  );
}

function PaletteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" class="shelf-dock__icon" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.2 3.6 C7.4 3.4 3.2 8.4 3.6 14.2 C4.0 20.1 9.1 24.6 14.6 24.2 C17.2 24.0 17.6 22.1 16.6 20.7 C15.6 19.3 16.4 17.6 18.3 17.6 L21.2 17.6 C23.4 17.6 24.6 16.0 24.5 13.6 C24.2 8.0 20.4 3.8 14.2 3.6 Z" />
        <path d="M8.6 12.1 A0.9 0.9 0 1 1 8.5 12.0 M12.6 8.3 A0.9 0.9 0 1 1 12.5 8.2 M17.6 9.0 A0.9 0.9 0 1 1 17.5 8.9 M8.2 17.4 A0.9 0.9 0 1 1 8.1 17.3" />
      </g>
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" class="shelf-dock__icon" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5.4 8.2 C11.2 7.6, 17.0 7.6, 22.8 8.1" />
        <path d="M11.0 8.0 C11.1 6.2, 11.6 5.2, 14.0 5.1 C16.4 5.0, 17.0 6.0, 17.1 7.9" />
        <path d="M7.4 9.6 C7.8 16.4, 8.2 20.6, 8.6 22.6 C8.8 23.7, 9.6 24.2, 11.0 24.3 C13.0 24.5, 15.2 24.5, 17.2 24.3 C18.6 24.2, 19.3 23.7, 19.5 22.6 C19.9 20.5, 20.4 16.3, 20.8 9.5" />
        <path d="M11.7 12.6 L12.1 20.9 M16.4 12.5 L16.0 20.8" opacity="0.6" />
      </g>
    </svg>
  );
}

/**
 * A stack of ready-written cards with a spark over the corner — "start from a
 * template".
 *
 * Drawn here rather than borrowed from `features/templates/icons.tsx`, whose
 * icons carry `.nb-rail-icon` and a 24 viewBox: that class lives in rail.css,
 * which the shelf does not load, so the borrowed glyph would size itself off
 * whatever the SVG default happens to be. Same drawing, this rail's frame —
 * and the same reason for the spark being OUTSIDE the card (see that file).
 */
function TemplateIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" class="shelf-dock__icon" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9.8 6.3 C12.9 6 16 6 19.1 6.3 M8.1 9.7 C11.9 9.3 15.6 9.3 19.4 9.6" opacity="0.55" stroke-width="1.5" />
        <path d="M5.4 12.6 C11.2 12.1 17 12.1 22.8 12.6 C23.2 16.6 23.2 20.4 22.7 23.8 C17 24.4 11.2 24.4 5.7 23.7 C5.1 20.2 5 16.4 5.4 12.6 Z" />
        <path d="M8.9 16.6 C12.3 16.3 15.7 16.3 19.2 16.6 M9 20.2 C11.8 19.9 14.6 19.9 16.7 20.1" stroke-width="1.5" opacity="0.6" />
        <path d="M23.4 2.6 C23.9 4.4 24.7 5.2 26.5 5.7 C24.7 6.2 23.9 7 23.4 8.8 C22.9 7 22.1 6.2 20.3 5.7 C22.1 5.2 22.9 4.4 23.4 2.6 Z" stroke-width="1.5" />
      </g>
    </svg>
  );
}

/*
 * The app's mark used to cap this rail, redrawn at 52px with a "Notebook"
 * wordmark under it. It was the one thing on the rail that did nothing when
 * pressed — a logo in a single-window desktop app has nowhere to go — so it
 * was a permanent 82px of dead target above four live ones. Removed; the
 * mark lives on in `assets/brand/icon.svg` and on the window itself.
 */
function AddFloorIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 28 28" class="shelf-dock__icon" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3.6 6.4 L24.3 5.9 M3.8 12.6 L24.5 12.1" />
        <path d="M6.2 6.2 L6.4 12.5 M13.0 6.0 L13.2 12.3 M20.0 6.0 L20.2 12.2" opacity="0.55" />
        <path d="M4.0 19.6 L24.4 19.1" stroke-dasharray="4 3.4" />
        <path d="M14.2 22.0 L14.2 25.6 M12.4 23.8 L16.0 23.8" />
      </g>
    </svg>
  );
}

export default function BookshelfWorld(): JSX.Element {
  let host!: HTMLDivElement;
  const [visibleBooks, setVisibleBooks] = createSignal<VisibleBook[]>([]);
  const [overlay, setOverlay] = createSignal<OverlayState | null>(null);
  const [zoomPct, setZoomPct] = createSignal(100);
  const [viewportW, setViewportW] = createSignal(
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  const [viewportH, setViewportH] = createSignal(
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [spotMenu, setSpotMenu] = createSignal<SpotMenuState | null>(null);
  const [plateEdit, setPlateEdit] = createSignal<PlateEditState | null>(null);
  const [addSpot, setAddSpot] = createSignal<AddSpot | null>(null);
  const [naming, setNaming] = createSignal<NamingState | null>(null);
  /**
   * At most one dock panel is up at a time — the studio sheet and the trash
   * card both claim the left of the window, and each rail icon toggles its
   * own. The book id is kept when the studio closes so the sheet does not
   * blank out halfway through sliding away.
   */
  const [dockPanel, setDockPanel] = createSignal<DockPanel | null>(null);
  const [studioBookId, setStudioBookId] = createSignal<string | null>(null);
  let world: ShelfWorld | null = null;
  let disposed = false;
  let creating = false;

  /**
   * Which panel was up at the moment the press STARTED.
   *
   * TrashPanel closes itself on any pointerdown outside its card — in the
   * capture phase, so it has already run by the time the dock button's click
   * fires and a naive toggle would read "closed" and re-open it on the spot.
   * This listener is registered before any panel exists, so it always sees the
   * state the user was actually looking at when they pressed. Keydown is
   * covered too, or a keyboard toggle would act on a stale pointer snapshot.
   */
  let panelAtPress: DockPanel | null = null;

  onMount(() => {
    const snapshot = (): void => {
      panelAtPress = dockPanel();
    };
    document.addEventListener('pointerdown', snapshot, true);
    document.addEventListener('keydown', snapshot, true);
    onCleanup(() => {
      document.removeEventListener('pointerdown', snapshot, true);
      document.removeEventListener('keydown', snapshot, true);
    });
  });

  onMount(() => {
    // The dock's placement is derived from the window width, so it has to
    // re-derive when the window changes — the camera does not always publish
    // a zoom change on resize.
    const onResize = (): void => {
      setViewportW(window.innerWidth);
      setViewportH(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    void ShelfWorld.create(host, {
      onVisibleBooksChange: (books) => {
        if (!disposed) setVisibleBooks(books);
      },
      onGhostReady: (book, rect) => {
        if (disposed) return;
        // The pulled cover flies from a canvas-local spine rect to the CENTRE
        // of the window, so it must not still be inside a stage that a panel
        // has stepped aside. A book leaving the shelf ends the panel too.
        setDockPanel(null);
        setOverlay({ book, rect, mode: 'open' });
      },
      onZoomChange: (percent) => {
        if (!disposed) setZoomPct(percent);
      },
      onBookMenu: (book, screen) => {
        if (!disposed) {
          setSpotMenu(null);
          setMenu({ book, x: screen.x, y: screen.y });
        }
      },
      onShelfMenu: (floor, screen) => {
        if (!disposed) {
          setMenu(null);
          setSpotMenu({ floor, x: screen.x, y: screen.y });
        }
      },
      onEditFloorPlate: (floor, rect) => {
        if (!disposed) setPlateEdit({ floor, rect });
      },
      onAddSpotChange: (spot) => {
        if (!disposed) setAddSpot(spot);
      },
    }).then((w) => {
      if (disposed) {
        w.destroy();
        return;
      }
      world = w;
      // Seed the readout from the restored camera: onZoomChange only fires on
      // a *change*, so without this the dock would lay itself out against a
      // zoom of 100% until the first pan.
      setZoomPct(w.zoomPercent);
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

  /* --------------------------- adding a book ---------------------------- */

  /**
   * Create a book and hand it straight to the title editor. Guarded because
   * the ghost slot, the dock and the shelf menu all lead here and a double
   * click must not put two books on the plank.
   */
  function addBook(floor?: number): void {
    const w = world;
    if (w === null || creating) return;
    creating = true;
    setNaming(null);
    void w
      .addBook(floor)
      .then((created) => {
        if (disposed || created === null) return;
        setNaming({ book: created.book, rect: created.rect });
      })
      .finally(() => {
        creating = false;
      });
  }

  /** Commit (or discard) the inline spine title. */
  function commitName(state: NamingState, raw: string): void {
    setNaming(null);
    const w = world;
    const title = raw.trim();
    if (w === null || title.length === 0 || title === state.book.title) return;
    void (async () => {
      await renameBook(state.book.id, title);
      w.invalidateSpine(state.book.id);
      if (!disposed) await w.refreshData();
    })();
  }

  /** Open the studio sheet, on the room (null) or on one book's wardrobe. */
  function openStudio(bookId: string | null): void {
    void play('pop-soft');
    setStudioBookId(bookId);
    setDockPanel('studio');
  }

  /**
   * A dock icon presses its OWN panel shut again. `panelAtPress` rather than
   * `dockPanel()` because the trash card may already have closed itself under
   * this very press — see the field's docblock.
   */
  function toggleDockPanel(panel: DockPanel, button: HTMLElement): void {
    // A canvas gesture can swallow the focus a click would normally hand to a
    // button; without this the sheet has no opener to give focus back to.
    button.focus();
    if (panelAtPress === panel) {
      setDockPanel(null);
      return;
    }
    if (panel === 'studio') openStudio(null);
    else {
      void play('pop-soft');
      setDockPanel('trash');
    }
  }

  /**
   * The shelf's four keyboard commands.
   *
   * Registered from the view rather than from world.ts, because these are what
   * the DOCK buttons do — the dock owns the panels and the "which floor is the
   * ghost slot on" answer, and a key that did something subtly different from
   * the button beside it would be a second implementation to keep in step.
   * Registered on mount and dropped on cleanup, so none of them fires while a
   * book is open and the case is not on screen.
   */
  onMount(() => {
    onCleanup(
      registerCommands({
        'new-book': () => addBook(addSpot()?.floor),
        'library-studio': () => toggleDock('studio'),
        'open-trash': () => toggleDock('trash'),
        'add-floor': () => world?.addFloor(),
        // The gallery is a book with a head start, so it belongs beside "new
        // book" on both the rail and the keyboard. BookView registers the same
        // id, which is what makes Ctrl+Alt+G work in either room — the gallery
        // offers "add pages here" only when a book is actually open.
        templates: () => openTemplates(),
      }),
    );
  });

  /**
   * The key cap in the dock's tooltip — the READER's binding, not the shipped
   * one. Spelled from the same table the dispatcher matches on, so moving the
   * shortcut in Settings re-labels the button rather than leaving it lying.
   */
  const templatesKey = (): string =>
    formatBinding(bindingFor('templates', settings.keybindings));

  /** The gallery, from the dock, the right-click card or the keyboard. */
  function openTemplates(): void {
    void play('pop-soft');
    // A sheet claiming the left of the window would sit under the overlay.
    setDockPanel(null);
    openTemplatesGallery();
  }

  /**
   * The keyboard's version of pressing a dock icon.
   *
   * `dockPanel()` and not `panelAtPress`: that snapshot exists because a
   * pointerdown closes the trash card before the button's click lands, and a
   * command has no such race — it runs once, after the panel state has
   * settled. Reading the snapshot here would toggle against a value taken by
   * whatever the reader last clicked, which may have been minutes ago.
   */
  function toggleDock(panel: DockPanel): void {
    if (dockPanel() === panel) {
      setDockPanel(null);
      return;
    }
    if (panel === 'studio') openStudio(null);
    else {
      void play('pop-soft');
      setDockPanel('trash');
    }
  }

  function handleSpotAction(state: SpotMenuState, action: ShelfSpotAction): void {
    if (action === 'new-book') addBook(state.floor);
    else if (action === 'from-template') openTemplates();
    else if (action === 'add-floor') world?.addFloor();
    else openStudio(null);
  }

  /* --------------------------- book menu actions ------------------------- */

  /** Run a shelf-menu action against the data layer, then re-sync the world. */
  function handleMenuAction(book: Book, action: ShelfMenuAction): void {
    const w = world;
    if (w === null) return;
    if (action === 'open') {
      w.pullOut(book.id);
      return;
    }
    if (action === 'move') {
      w.beginMove(book.id);
      return;
    }
    if (action === 'customize') {
      openStudio(book.id);
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

  /**
   * Send a book to another bookcase. The world owns the whole verb — pinning
   * the face the book wears in THIS room, clamping the landing floor into a
   * shorter case, and re-syncing the shelf it just left — because all three
   * need things this component does not have (see `world.moveBookToCase`).
   */
  function handleMoveToCase(book: Book, bookcaseId: string): void {
    void world?.moveBookToCase(book.id, bookcaseId);
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

  /**
   * The canvas and the DOM swap the book between them. 'out': the DOM cover
   * has taken over, so the canvas ghost fades. 'in': the cover is back on the
   * spine, so the canvas pushes the book into the row — the same second half
   * whether the reader put it back by hand or the book view just closed.
   */
  function handleHandoff(state: OverlayState, phase: 'out' | 'in'): void {
    const w = world;
    if (w === null) return;
    if (phase === 'out') {
      w.fadeGhost();
      return;
    }
    w.pushInBook(state.book, () => {
      // Only a book that was actually OPEN has an id to clear; a book put
      // back from the hand never reached the book view.
      if (state.mode === 'close') appState.clearOpenBook();
    });
  }

  /**
   * The reader chose to read the book they are holding. This is the only path
   * that counts as opening it — pulling a spine out no longer does, so the
   * continue-reading ribbon is moved here rather than in the world.
   */
  function handleOpen(state: OverlayState): void {
    void touchBookOpened(state.book.id);
    // Hand over to the book view; this unmounts the shelf (camera is
    // preserved in the module-level session snapshot).
    appState.openBook(state.book.id);
  }

  function handleDone(): void {
    setOverlay(null);
  }

  /* ------------------------------ chrome geometry ------------------------ */

  /** The ghost slot, floored to a target you can actually hit. */
  const ghostBox = (): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null => {
    const spot = addSpot();
    if (spot === null) return null;
    const width = Math.max(GHOST_MIN_W, spot.width);
    const height = Math.max(GHOST_MIN_H, spot.height);
    return {
      left: spot.x - (width - spot.width) / 2,
      // Grow upward from the plank so the outline keeps standing on it.
      top: spot.y - (height - spot.height),
      width,
      height,
    };
  };

  /**
   * Free wall to the LEFT of the bookcase, in screen px.
   *
   * Zero once the case is wider than the window can centre — at that point
   * the camera is free to pan and the case's left edge is anywhere in
   * [0, X_SLACK * zoom], so there is nothing safe to claim.
   */
  const leftWall = (): number => {
    const zoom = zoomPct() / 100;
    const vw = viewportW();
    if (zoom <= 0 || vw / zoom < CASE_W + CASE_SLACK * 2) return 0;
    return Math.max(0, (vw - CASE_W * zoom) / 2);
  };

  /**
   * Where the dock stands, and in which form.
   *
   * Full while the wall can hold the labelled rail; icon-only when it can
   * only hold that; and when the case has swallowed the window the mini rail
   * hugs the edge, over the case's outer stile rather than over its books.
   */
  const dockPlace = (): { left: number; mini: boolean } => {
    const wall = leftWall();
    const roomy = viewportH() >= DOCK_SHORT_H;
    if (roomy && wall >= DOCK_FULL_W + DOCK_GAP + DOCK_EDGE) {
      return { left: Math.round((wall - DOCK_FULL_W) / 2), mini: false };
    }
    if (wall >= DOCK_MINI_W + DOCK_GAP + DOCK_EDGE) {
      return { left: Math.round((wall - DOCK_MINI_W) / 2), mini: true };
    }
    return { left: DOCK_EDGE, mini: true };
  };

  /** The first-run card, parked beside the ghost and kept on screen. */
  const inviteBox = (): { left: number; top: number } | null => {
    const box = ghostBox();
    if (box === null) return null;
    const width = 268;
    const left = Math.min(
      Math.max(12, box.left + box.width + 26),
      Math.max(12, window.innerWidth - width - 16),
    );
    return { left, top: Math.max(12, box.top + box.height / 2 - 78) };
  };

  return (
    <div class="shelf-root">
      {/* The app's own tooltip layer (views/Tooltip.tsx). It parks itself on
          <body>, so it is safe to ask for from more than one view — and the
          shelf is the first view a reader ever sees. */}
      <Tooltips />
      {/* ==== the room itself — the half a side panel pushes aside ======== */}
      <div class="shelf-stage" ref={host}>
        {/* ---- the dashed "put a book here" outline, standing on the plank --
             Stood down while a new book is being named: the ghost is the same
             cream, the same dashed ink and roughly the same size as the book
             beside it, and the two together are what a reader reads as one
             blank slab. It comes straight back when the name is committed. */}
        <Show when={naming() === null && ghostBox()}>
          {(box) => (
            <button
              type="button"
              class="shelf-addslot"
              classList={{ 'is-firstrun': addSpot()?.firstRun === true }}
              data-testid="shelf-addslot"
              style={{
                left: `${box().left}px`,
                top: `${box().top}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
              aria-label={`Add a book to floor ${(addSpot()?.floor ?? 0) + 1}`}
              // The slot stands mid-case, so the bubble goes ABOVE it rather
              // than beside it, where it would cover the next book along.
              data-tooltip="Put a new book here"
              data-tooltip-side="top"
              onClick={() => addBook(addSpot()?.floor)}
            >
              <span class="shelf-addslot__band" aria-hidden="true" />
              <span class="shelf-addslot__plus" aria-hidden="true">
                +
              </span>
              <span class="shelf-addslot__tip" aria-hidden="true">
                new book
              </span>
            </button>
          )}
        </Show>

        {/* ---- first run: a bare case should ask for its first book -------- */}
        <Show when={addSpot()?.firstRun === true && naming() === null && inviteBox()}>
          {(box) => (
            <div
              class="shelf-firstrun"
              data-testid="shelf-firstrun"
              style={{ left: `${box().left}px`, top: `${box().top}px` }}
            >
              <p class="shelf-firstrun__eyebrow">an empty case</p>
              <p class="shelf-firstrun__line">
                every library starts with one book.
              </p>
              <button
                type="button"
                class="shelf-firstrun__btn"
                onClick={() => addBook(addSpot()?.floor)}
              >
                write my first one
              </button>
              <span class="shelf-firstrun__arrow" aria-hidden="true">
                <svg viewBox="0 0 60 34">
                  <path
                    d="M56 17.5 C44 9 30 7.5 8 15.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                  />
                  <path
                    d="M8 15.5 L18 11.6 M8 15.5 L16.4 22"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
            </div>
          )}
        </Show>

        {/* ---- name the new book, from a tag tied to its spine ------------- */}
        <Show when={naming()}>
          {(state) => {
            /*
             * NOTHING is drawn over the new book. The geometry, and the long
             * story of why the editor stands beside the spine instead of on
             * it, live in `namePlate.ts` — so a node test can hold it to that
             * invariant without a browser. All this layer does is spend the
             * answer.
             */
            const box = (): NamePlateBox =>
              namePlateBox(state().rect, { width: viewportW(), height: viewportH() });
            return (
              <>
                {/* The leader that ties the tag back to the book it names. */}
                <span
                  class="shelf-spine-name__tie"
                  aria-hidden="true"
                  style={{
                    left: `${box().tie.left}px`,
                    top: `${box().tie.top}px`,
                    width: `${box().tie.width}px`,
                  }}
                />
                <input
                  class="shelf-spine-name"
                  data-testid="shelf-spine-name"
                  data-side={box().side}
                  type="text"
                  maxLength={80}
                  aria-label="Name this book"
                  placeholder="name it…"
                  value={state().book.title === NEW_BOOK_TITLE ? '' : state().book.title}
                  style={{
                    left: `${box().left}px`,
                    top: `${box().top}px`,
                    width: `${box().width}px`,
                    height: `${box().height}px`,
                    'font-size': `${box().fontSize}px`,
                  }}
                  ref={(node) =>
                    queueMicrotask(() => {
                      node.focus();
                      node.select();
                    })
                  }
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitName(state(), e.currentTarget.value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setNaming(null);
                    }
                  }}
                  onBlur={(e) => {
                    const current = naming();
                    if (current !== null) commitName(current, e.currentTarget.value);
                  }}
                />
              </>
            );
          }}
        </Show>

        {/* `keyed`, so the callback gets the VALUE and not an accessor: the
            overlay calls back during its own teardown (to drop the slot
            outline it asked the world for), and reading a <Show> accessor
            there is reading a state that has already gone. Every overlay is a
            freshly built object anyway, so keying on identity remounts in
            exactly the cases the accessor form did. */}
        <Show when={overlay()} keyed>
          {(state) => (
            <PulledBookOverlay
              book={state.book}
              spineRect={state.rect}
              mode={state.mode}
              // Read at the moment the book is sent back rather than captured
              // at the pull: the row can have re-laid out under it (a rename,
              // a sibling arriving) while the reader was deciding.
              homeRect={() => world?.spineRectOf(state.book.id) ?? state.rect}
              caseRect={() => world?.caseScreenRect() ?? null}
              onOverCase={(over) => world?.showSlotHint(state.book.id, over)}
              onHandoff={(phase) => handleHandoff(state, phase)}
              onOpen={() => handleOpen(state)}
              onDone={() => handleDone()}
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
              onMoveTo={(caseId) => handleMoveToCase(state().book, caseId)}
              onClose={() => setMenu(null)}
            />
          )}
        </Show>
        <Show when={spotMenu()}>
          {(state) => (
            <ShelfSpotMenu
              floor={state().floor}
              x={state().x}
              y={state().y}
              onAction={(action) => handleSpotAction(state(), action)}
              onClose={() => setSpotMenu(null)}
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
        <nav class="shelf-a11y" aria-label="Bookshelf">
          <ul>
            <For each={visibleBooks()}>
              {(book) => (
                <li>
                  {/* "Take out", not "Open": this pulls the book off the
                      shelf and hands it over; the held card's own "read it"
                      button is what opens it, and it takes focus. */}
                  <button
                    type="button"
                    aria-label={`Take ${book.title} off the shelf, floor ${book.floor + 1}`}
                    onClick={() => world?.pullOut(book.id)}
                  >
                    {book.title}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </nav>

        {/* ---- the left rail: everything you can do to the LIBRARY (rather
                than to a book). Its `left` is derived from the zoom so it
                stands on bare wall instead of on the case. The two buttons
                that open a panel TOGGLE it, and say so with aria-pressed. --- */}
        <div
          class="shelf-dock"
          classList={{ 'is-mini': dockPlace().mini }}
          data-testid="shelf-dock"
          style={{ left: `${dockPlace().left}px` }}
        >
          <div
            class="shelf-dock__tools"
            role="toolbar"
            aria-label="Shelf tools"
            aria-orientation="vertical"
          >
            <button
              type="button"
              class="shelf-dock__btn is-primary"
              data-shelf-dock="new-book"
              aria-label="New book"
              data-tooltip="Put a new book on this floor"
              data-tooltip-side="right"
              onClick={() => addBook(addSpot()?.floor)}
            >
              <NewBookIcon />
              <span class="shelf-dock__label">new book</span>
            </button>
            {/* Directly under "new book", because it is the same verb with a
                head start — a reader who wants a Cornell page or a weekly
                planner is standing exactly where a reader who wants a blank
                book is standing, and until now the gallery was reachable only
                by typing a global into a console. */}
            <button
              type="button"
              class="shelf-dock__btn"
              data-shelf-dock="templates"
              aria-label="Start from a template"
              data-tooltip="Five hand-drawn starting points"
              data-tooltip-side="right"
              data-tooltip-key={templatesKey()}
              onClick={() => openTemplates()}
            >
              <TemplateIcon />
              <span class="shelf-dock__label">template</span>
            </button>
            <span class="shelf-dock__rule" aria-hidden="true" />
            <button
              type="button"
              class="shelf-dock__btn"
              classList={{ 'is-active': dockPanel() === 'studio' }}
              data-shelf-dock="studio"
              aria-label="Library studio"
              aria-pressed={dockPanel() === 'studio'}
              // Suppressed while the sheet is open: the sheet lands where the
              // bubble would, and it carries its own title.
              data-tooltip={
                dockPanel() === 'studio'
                  ? undefined
                  : 'Pick the room, the wall, the growing things'
              }
              data-tooltip-side="right"
              onClick={(e) => toggleDockPanel('studio', e.currentTarget)}
            >
              <PaletteIcon />
              <span class="shelf-dock__label">studio</span>
            </button>
            <button
              type="button"
              class="shelf-dock__btn"
              data-shelf-dock="add-floor"
              aria-label="Add a floor"
              data-tooltip="Grow the case downward"
              data-tooltip-side="right"
              onClick={() => world?.addFloor()}
            >
              <AddFloorIcon />
              <span class="shelf-dock__label">add floor</span>
            </button>
            {/* Crumpled books used to live in a drawer drawn INSIDE the case,
                which put a piece of filing furniture in the middle of the
                artwork. It is a library action, so it belongs on the rail. */}
            <button
              type="button"
              class="shelf-dock__btn"
              classList={{ 'is-active': dockPanel() === 'trash' }}
              data-shelf-dock="trash"
              aria-label="Trash"
              aria-pressed={dockPanel() === 'trash'}
              data-tooltip={
                dockPanel() === 'trash'
                  ? undefined
                  : 'Books you crumpled — restore or empty'
              }
              data-tooltip-side="right"
              onClick={(e) => toggleDockPanel('trash', e.currentTarget)}
            >
              <TrashIcon />
              <span class="shelf-dock__label">trash</span>
            </button>
          </div>
        </div>

        {/* The pill sits on the bottom edge, so every bubble here opens
            UPWARD, and each shortcut rides a key cap instead of a bracket. */}
        <div class="shelf-zoom-pill" role="toolbar" aria-label="Zoom controls">
          <button
            type="button"
            class="shelf-zoom-pill__btn"
            aria-label="Zoom out"
            data-tooltip="Zoom out"
            data-tooltip-side="top"
            data-tooltip-key="−"
            onClick={() => world?.zoomOut()}
          >
            −
          </button>
          <button
            type="button"
            class="shelf-zoom-pill__pct"
            aria-label="Reset zoom to 100%"
            data-tooltip="Back to 100%"
            data-tooltip-side="top"
            data-tooltip-key="0"
            onClick={() => world?.zoomReset()}
          >
            {zoomPct()}%
          </button>
          <button
            type="button"
            class="shelf-zoom-pill__btn"
            aria-label="Zoom in"
            data-tooltip="Zoom in"
            data-tooltip-side="top"
            data-tooltip-key="+"
            onClick={() => world?.zoomIn()}
          >
            +
          </button>
          <span class="shelf-zoom-pill__rule" aria-hidden="true" />
          <button
            type="button"
            class="shelf-zoom-pill__fit"
            aria-label="Fit bookcase to window"
            data-tooltip="Fit the whole case in the window"
            data-tooltip-side="top"
            onClick={() => world?.zoomFit()}
          >
            fit
          </button>
        </div>
      </div>
      {/* ==== end of the pushed stage ===================================== */}

      {/* The two dock panels live OUTSIDE the stage: they are what does the
          pushing, and a fixed sheet inside a transformed box would be laid
          out against that box instead of against the window. */}
      <Show when={dockPanel() === 'trash'}>
        <TrashPanel
          onClose={() => setDockPanel(null)}
          onChanged={() => void world?.refreshData()}
        />
      </Show>

      <ShelfStudio
        open={dockPanel() === 'studio'}
        bookId={studioBookId()}
        onClose={() => setDockPanel(null)}
        onBookChanged={() => {
          const w = world;
          const id = studioBookId();
          if (w === null || id === null) return;
          w.invalidateSpine(id);
          void w.refreshData();
        }}
      />
    </div>
  );
}
