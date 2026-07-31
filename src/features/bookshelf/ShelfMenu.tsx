/**
 * features/bookshelf/ShelfMenu.tsx — right-click menu for a shelf book.
 *
 * Mirrors the editor context-menu aesthetic (aged-paper card, dashed hover
 * rows, glyph chips — see .nb-ctx-* in editor.css) with its own shelf-scoped
 * classes so the bookshelf feature owns its styling (shelf.css). Three modes:
 * the action menu, an inline rename card, and the hand-drawn crumple-confirm
 * card for delete. Keyboard: ArrowUp/Down + Enter navigate, Escape closes.
 */

import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import type { Book } from '../../data/types';

export type ShelfMenuAction =
  | 'open'
  | 'rename'
  | 'customize'
  | 'pin'
  | 'duplicate'
  | 'move'
  | 'delete';

export interface ShelfMenuProps {
  book: Book;
  /** Anchor position, CSS px (viewport coords). */
  x: number;
  y: number;
  pinned: boolean;
  onAction(action: ShelfMenuAction): void;
  /** Commit a rename (trimmed, non-empty). */
  onRename(title: string): void;
  onClose(): void;
}

interface MenuItem {
  action: ShelfMenuAction;
  title: string;
  glyph: string;
  danger?: boolean;
}

const MENU_W = 216;

export default function ShelfMenu(props: ShelfMenuProps): JSX.Element {
  const [mode, setMode] = createSignal<'menu' | 'rename' | 'confirm'>('menu');
  const [selected, setSelected] = createSignal(0);
  let rootElement: HTMLDivElement | undefined;
  let renameInput: HTMLInputElement | undefined;

  const items = (): MenuItem[] => [
    { action: 'open', title: 'Open', glyph: '📖' },
    { action: 'rename', title: 'Rename…', glyph: '✎' },
    { action: 'customize', title: 'Dress this book…', glyph: '🎨' },
    {
      action: 'pin',
      title: props.pinned ? 'Unpin favorite' : 'Pin as favorite',
      glyph: props.pinned ? '☆' : '⭐',
    },
    { action: 'duplicate', title: 'Duplicate', glyph: '⧉' },
    { action: 'move', title: 'Move…', glyph: '⇄' },
    { action: 'delete', title: 'Crumple (to trash)', glyph: '🗑', danger: true },
  ];

  function run(action: ShelfMenuAction): void {
    if (action === 'rename') {
      setMode('rename');
      queueMicrotask(() => {
        renameInput?.focus();
        renameInput?.select();
      });
      return;
    }
    if (action === 'delete') {
      setMode('confirm');
      return;
    }
    props.onAction(action);
    props.onClose();
  }

  function commitRename(): void {
    const value = renameInput?.value.trim() ?? '';
    if (value.length > 0 && value !== props.book.title) props.onRename(value);
    props.onClose();
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }
      if (mode() !== 'menu') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items().length;
        setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items()[selected()];
        if (item !== undefined) run(item.action);
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

  // Clamp the card into the viewport.
  const pos = (): { left: string; top: string } => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      left: `${Math.max(8, Math.min(props.x, vw - MENU_W - 12))}px`,
      top: `${Math.max(8, Math.min(props.y, vh - 300))}px`,
    };
  };

  createEffect(() => {
    void mode();
    void props.book.id;
  });

  return (
    <div
      class="shelf-menu"
      role="menu"
      aria-label={`Book actions for ${props.book.title}`}
      ref={rootElement}
      style={pos()}
    >
      <Show when={mode() === 'menu'}>
        <div class="shelf-menu__title" title={props.book.title}>
          {props.book.title}
        </div>
        <For each={items()}>
          {(item, index) => (
            <button
              type="button"
              role="menuitem"
              class="shelf-menu__item"
              classList={{
                'is-selected': index() === selected(),
                'is-danger': item.danger === true,
              }}
              data-shelf-action={item.action}
              onMouseEnter={() => setSelected(index())}
              onMouseDown={(e) => {
                e.preventDefault();
                run(item.action);
              }}
            >
              <span class="shelf-menu__glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span class="shelf-menu__label">{item.title}</span>
            </button>
          )}
        </For>
      </Show>

      <Show when={mode() === 'rename'}>
        <div class="shelf-menu__title">Rename book</div>
        <input
          class="shelf-menu__input"
          type="text"
          maxLength={80}
          value={props.book.title}
          ref={(node) => (renameInput = node)}
          aria-label="New book title"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            }
            e.stopPropagation();
          }}
        />
        <div class="shelf-menu__row">
          <button
            type="button"
            class="shelf-menu__btn is-primary"
            onClick={commitRename}
          >
            Rename
          </button>
          <button type="button" class="shelf-menu__btn" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </Show>

      <Show when={mode() === 'confirm'}>
        <div class="shelf-menu__title">Crumple this book?</div>
        <p class="shelf-menu__hint">
          “{props.book.title}” goes into the trash on the left rail. You can
          restore it from there.
        </p>
        <div class="shelf-menu__row">
          <button
            type="button"
            class="shelf-menu__btn is-danger"
            data-shelf-action="confirm-delete"
            onClick={() => {
              props.onAction('delete');
              props.onClose();
            }}
          >
            Crumple it
          </button>
          <button type="button" class="shelf-menu__btn" onClick={props.onClose}>
            Keep
          </button>
        </div>
      </Show>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The shelf's OWN menu — right-click on bare plank rather than on a spine.
   Same aged-paper card, three verbs: put a book here, grow the case, dress
   the room.
   ------------------------------------------------------------------------ */

export type ShelfSpotAction = 'new-book' | 'add-floor' | 'studio';

export interface ShelfSpotMenuProps {
  /** Floor the right-click landed on (1-based in the label). */
  floor: number;
  x: number;
  y: number;
  onAction(action: ShelfSpotAction): void;
  onClose(): void;
}

const SPOT_ITEMS: ReadonlyArray<{
  action: ShelfSpotAction;
  title: string;
  glyph: string;
}> = [
  { action: 'new-book', title: 'New book here', glyph: '✚' },
  { action: 'add-floor', title: 'Add a floor below', glyph: '▤' },
  { action: 'studio', title: 'Library studio…', glyph: '🎨' },
];

export function ShelfSpotMenu(props: ShelfSpotMenuProps): JSX.Element {
  const [selected, setSelected] = createSignal(0);
  let rootElement: HTMLDivElement | undefined;

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = SPOT_ITEMS.length;
        setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = SPOT_ITEMS[selected()];
        if (item !== undefined) {
          props.onAction(item.action);
          props.onClose();
        }
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

  const pos = (): { left: string; top: string } => ({
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - MENU_W - 12))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - 180))}px`,
  });

  return (
    <div
      class="shelf-menu shelf-menu--spot"
      role="menu"
      aria-label="Shelf actions"
      ref={rootElement}
      style={pos()}
    >
      <div class="shelf-menu__title">floor {props.floor + 1}</div>
      <For each={SPOT_ITEMS}>
        {(item, index) => (
          <button
            type="button"
            role="menuitem"
            class="shelf-menu__item"
            classList={{ 'is-selected': index() === selected() }}
            data-shelf-spot={item.action}
            onMouseEnter={() => setSelected(index())}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onAction(item.action);
              props.onClose();
            }}
          >
            <span class="shelf-menu__glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <span class="shelf-menu__label">{item.title}</span>
          </button>
        )}
      </For>
    </div>
  );
}
