/**
 * features/bookshelf/ShelfMenu.tsx — the app's right-click cards.
 *
 * Mirrors the editor context-menu aesthetic (aged-paper card, dashed hover
 * rows, glyph chips — see .nb-ctx-* in editor.css) with its own shelf-scoped
 * classes so the bookshelf feature owns its styling (shelf.css).
 *
 * ONE card, three customers, and that is the point. `MenuCard` owns the paper,
 * the viewport clamp, Escape and click-away; `MenuList` owns the rows and the
 * ArrowUp / ArrowDown / Enter ring. What each menu adds is only its own verbs
 * and its own extra modes (an inline rename, a hand-drawn confirm):
 *
 *  - `ShelfMenu`      right-click a SPINE — the book's own verbs.
 *  - `ShelfSpotMenu`  right-click BARE PLANK — put a book here, grow the case,
 *                     dress the room.
 *  - `BookcaseMenu`   right-click a CASE CARD in the studio's library tab. The
 *                     collection is a grid of real furniture and every verb in
 *                     it was a chip you had to find; this is the same card the
 *                     shelf already answers a right-click with.
 *
 * WHERE THE COORDINATES COME FROM, because the three do not agree and the
 * difference is load-bearing. The two shelf menus are handed CANVAS-LOCAL
 * coordinates (`input.ts` subtracts the canvas rect) and render inside
 * `.shelf-stage`, which carries the panel-push transform — and a
 * `position: fixed` box inside a transformed ancestor is laid out against that
 * ancestor. The two cancel out, so the card lands under the cursor whether the
 * room has been pushed aside or not. The bookcase menu has no such frame: it is
 * opened from a sheet GSAP slides on `xPercent`, so it takes real viewport
 * coordinates and PORTALS itself to `document.body`, where `fixed` means what
 * it says. Do not "tidy" one into the other.
 */

import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { Book } from '../../data/types';

const MENU_W = 216;

/* ========================================================================== *
 *                            the card, and its rows                          *
 * ========================================================================== */

/** One row of a right-click card. */
export interface MenuItemSpec<A extends string = string> {
  readonly action: A;
  readonly title: string;
  readonly glyph: string;
  /** Ends something. Painted in the palette's one warm red. */
  readonly danger?: boolean;
}

/**
 * The attribute a probe or an e2e spec clicks a row by.
 *
 * One per menu rather than one shared name: two of these cards can be mounted
 * at once (the studio sheet opens over the shelf), and `[data-shelf-action=
 * "delete"]` matching a row in a card the spec was not looking at is the kind
 * of failure that reads as flake.
 */
type MenuAttr = 'data-shelf-action' | 'data-shelf-spot' | 'data-case-action';

interface MenuCardProps {
  /** Anchor position, CSS px. Viewport coords when `portal`, else canvas-local. */
  x: number;
  y: number;
  /** Read out as the menu's name. */
  label: string;
  /** Extra modifier class on the card. */
  variant?: string;
  /**
   * The card's own width, for the RIGHT-edge clamp. Paired with the `width` a
   * variant sets in shelf.css — a card told it is narrower than it paints
   * hangs off the window by the difference. Defaults to the base `.shelf-menu`.
   */
  width?: number;
  /** How tall the card can get, for the bottom clamp. */
  reach?: number;
  /** Escape the nearest transformed ancestor — see the module docblock. */
  portal?: boolean;
  onClose(): void;
  children: JSX.Element;
}

/**
 * The aged-paper card: places itself, closes on Escape and on a press
 * anywhere outside. Both listeners are CAPTURE-phase on `document`, which is
 * what lets Escape close the card without also closing the sheet or the panel
 * underneath it (`stopPropagation` during capture means the bubble-phase
 * listeners on `window` never run).
 */
function MenuCard(props: MenuCardProps): JSX.Element {
  let rootElement: HTMLDivElement | undefined;

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
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
  const pos = (): { left: string; top: string } => ({
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - (props.width ?? MENU_W) - 12))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - (props.reach ?? 300)))}px`,
  });

  const card = (
    <div
      class="shelf-menu"
      classList={{ [props.variant ?? '']: props.variant !== undefined }}
      role="menu"
      aria-label={props.label}
      ref={rootElement}
      style={pos()}
    >
      {props.children}
    </div>
  );

  // Read once, not through a <Show>: where the card is mounted is a structural
  // fact about its opener, and a card that re-parented itself mid-life would
  // throw away the mode it is in.
  return props.portal === true ? <Portal>{card}</Portal> : card;
}

/**
 * The rows, plus the keyboard ring that walks them.
 *
 * Mounted only while a card is showing its LIST — the rename and confirm modes
 * replace it, and Solid's unmount takes the listener with it, so Enter in a
 * rename field can never activate a menu row that is no longer on screen.
 *
 * `stopPropagation` as well as `preventDefault`: `ShelfWorld` binds arrows and
 * Enter on `document` in the bubble phase (world.ts, "Keyboard shelf nav"), so
 * without it Enter here activated the row AND pulled the selected book off the
 * shelf behind the card.
 */
function MenuList<A extends string>(props: {
  items: readonly MenuItemSpec<A>[];
  attr: MenuAttr;
  onRun(action: A): void;
}): JSX.Element {
  const [selected, setSelected] = createSignal(0);

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      const n = props.items.length;
      if (n === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = props.items[selected()];
        if (item !== undefined) props.onRun(item.action);
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  return (
    <For each={props.items}>
      {(item, index) => (
        <button
          type="button"
          role="menuitem"
          class="shelf-menu__item"
          classList={{
            'is-selected': index() === selected(),
            'is-danger': item.danger === true,
          }}
          /* Set imperatively because the attribute's NAME varies per menu, and
             a JSX spread of `Record<string, string>` is not assignable to the
             button's props. One assignment, on a node that never changes row. */
          ref={(node) => node.setAttribute(props.attr, item.action)}
          onMouseEnter={() => setSelected(index())}
          onMouseDown={(e) => {
            e.preventDefault();
            props.onRun(item.action);
          }}
        >
          <span class="shelf-menu__glyph" aria-hidden="true">
            {item.glyph}
          </span>
          <span class="shelf-menu__label">{item.title}</span>
        </button>
      )}
    </For>
  );
}

/**
 * The card's heading: a name that clips, so it gets the app's own tooltip
 * (views/Tooltip.tsx) rather than the browser's grey one, and `-clipped` so a
 * short name is not read back to you over itself. Above the card, because the
 * card already owns everything to its right.
 */
function MenuTitle(props: { name: string }): JSX.Element {
  return (
    <div
      class="shelf-menu__title"
      data-tooltip={props.name}
      data-tooltip-side="top"
      data-tooltip-clipped=""
    >
      {props.name}
    </div>
  );
}

/* ========================================================================== *
 *                        1. right-click on a SPINE                           *
 * ========================================================================== */

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
  /** Anchor position, CSS px (canvas-local — see the module docblock). */
  x: number;
  y: number;
  pinned: boolean;
  onAction(action: ShelfMenuAction): void;
  /** Commit a rename (trimmed, non-empty). */
  onRename(title: string): void;
  onClose(): void;
}

export default function ShelfMenu(props: ShelfMenuProps): JSX.Element {
  const [mode, setMode] = createSignal<'menu' | 'rename' | 'confirm'>('menu');
  let renameInput: HTMLInputElement | undefined;

  const items = (): MenuItemSpec<ShelfMenuAction>[] => [
    // Not "Open": it takes the book off the shelf and hands it to you, and
    // the held card is where reading it is decided.
    { action: 'open', title: 'Take it out', glyph: '📖' },
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

  return (
    <MenuCard
      x={props.x}
      y={props.y}
      label={`Book actions for ${props.book.title}`}
      onClose={() => props.onClose()}
    >
      <Show when={mode() === 'menu'}>
        <MenuTitle name={props.book.title} />
        <MenuList items={items()} attr="data-shelf-action" onRun={run} />
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
    </MenuCard>
  );
}

/* ========================================================================== *
 *                     2. right-click on BARE PLANK                           *
 * ========================================================================== */

export type ShelfSpotAction = 'new-book' | 'add-floor' | 'studio';

export interface ShelfSpotMenuProps {
  /** Floor the right-click landed on (1-based in the label). */
  floor: number;
  x: number;
  y: number;
  onAction(action: ShelfSpotAction): void;
  onClose(): void;
}

const SPOT_ITEMS: readonly MenuItemSpec<ShelfSpotAction>[] = [
  { action: 'new-book', title: 'New book here', glyph: '✚' },
  { action: 'add-floor', title: 'Add a floor below', glyph: '▤' },
  { action: 'studio', title: 'Library studio…', glyph: '🎨' },
];

export function ShelfSpotMenu(props: ShelfSpotMenuProps): JSX.Element {
  return (
    <MenuCard
      x={props.x}
      y={props.y}
      label="Shelf actions"
      variant="shelf-menu--spot"
      reach={180}
      onClose={() => props.onClose()}
    >
      <div class="shelf-menu__title">floor {props.floor + 1}</div>
      <MenuList
        items={SPOT_ITEMS}
        attr="data-shelf-spot"
        onRun={(action) => {
          props.onAction(action);
          props.onClose();
        }}
      />
    </MenuCard>
  );
}

/* ========================================================================== *
 *              3. right-click a CASE CARD in the library tab                  *
 * ========================================================================== */

export type BookcaseMenuAction = 'open' | 'rename' | 'clone' | 'add-floor' | 'delete';

export interface BookcaseMenuProps {
  name: string;
  /** Anchor position, CSS px (viewport — this card portals out to <body>). */
  x: number;
  y: number;
  /** The case the reader is standing in: it has nothing to switch to. */
  isOpen: boolean;
  /** Books it holds, or undefined while the count is still being asked for. */
  bookCount?: number;
  /** False once the case is as tall as they go. */
  canAddFloor: boolean;
  /** False for the last bookcase — a library keeps at least one. */
  canDelete: boolean;
  onAction(action: BookcaseMenuAction): void;
  /** Commit a rename (trimmed, non-empty). */
  onRename(name: string): void;
  onClose(): void;
}

export function BookcaseMenu(props: BookcaseMenuProps): JSX.Element {
  const [mode, setMode] = createSignal<'menu' | 'rename' | 'confirm'>('menu');
  let renameInput: HTMLInputElement | undefined;

  const books = (): number => props.bookCount ?? 0;

  /**
   * What the card is standing on, in one line: how many books, and whether
   * this is the case you are looking at. The verbs below read differently
   * depending on both, and the grid behind the card is small enough that the
   * reader can lose track of which one they aimed at.
   */
  const hint = (): string => {
    const count =
      props.bookCount === undefined
        ? 'counting its books…'
        : `${props.bookCount} ${props.bookCount === 1 ? 'book' : 'books'}`;
    return props.isOpen ? `${count} · you are standing here` : count;
  };

  const items = (): MenuItemSpec<BookcaseMenuAction>[] => {
    const out: MenuItemSpec<BookcaseMenuAction>[] = [];
    // First, because it is the one verb that leads to the BOOKS: everything
    // else here dresses or renames the furniture.
    if (!props.isOpen) {
      out.push({ action: 'open', title: 'Stand in this one', glyph: '📚' });
    }
    out.push({ action: 'rename', title: 'Rename…', glyph: '✎' });
    out.push({ action: 'clone', title: 'Clone the shelf, no books', glyph: '⧉' });
    if (props.canAddFloor) {
      out.push({ action: 'add-floor', title: 'Add a floor to it', glyph: '▤' });
    }
    if (props.canDelete) {
      out.push({ action: 'delete', title: 'Delete this bookcase', glyph: '🗑', danger: true });
    }
    return out;
  };

  function run(action: BookcaseMenuAction): void {
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
    if (value.length > 0 && value !== props.name) props.onRename(value);
    props.onClose();
  }

  return (
    <MenuCard
      x={props.x}
      y={props.y}
      label={`Bookcase actions for ${props.name}`}
      variant="shelf-menu--case"
      /* Paired with `.shelf-menu--case { width }` in shelf.css. */
      width={244}
      reach={330}
      portal
      onClose={() => props.onClose()}
    >
      <Show when={mode() === 'menu'}>
        <MenuTitle name={props.name} />
        <p class="shelf-menu__hint shelf-menu__hint-tight">{hint()}</p>
        <MenuList items={items()} attr="data-case-action" onRun={run} />
      </Show>

      <Show when={mode() === 'rename'}>
        <div class="shelf-menu__title">Rename bookcase</div>
        <input
          class="shelf-menu__input"
          type="text"
          maxLength={60}
          value={props.name}
          ref={(node) => (renameInput = node)}
          aria-label="New bookcase name"
          /* `on:keydown`, not `onKeyDown`: the studio root stops keydown
             natively before it can reach the document, and Solid delegates
             `onKeyDown` TO the document — so the delegated form would never
             run and Enter would do nothing at all. See rail/shelfKeys.ts. */
          on:keydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            }
            e.stopPropagation();
          }}
        />
        <div class="shelf-menu__row">
          <button type="button" class="shelf-menu__btn is-primary" onClick={commitRename}>
            Rename
          </button>
          <button type="button" class="shelf-menu__btn" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </Show>

      <Show when={mode() === 'confirm'}>
        <div class="shelf-menu__title">Delete this bookcase?</div>
        {/* Says what is at stake before it asks, exactly as the card's own
            delete chip does — the difference between an empty case and one
            holding forty books is the whole question. */}
        <p class="shelf-menu__hint">
          {books() > 0
            ? `“${props.name}” and the ${books()} ${books() === 1 ? 'book' : 'books'} standing in it go for good. This one cannot be undone.`
            : `“${props.name}” is empty. The bookcase goes; nothing else does.`}
        </p>
        <div class="shelf-menu__row">
          <button
            type="button"
            class="shelf-menu__btn is-danger"
            data-case-action="confirm-delete"
            onClick={() => {
              props.onAction('delete');
              props.onClose();
            }}
          >
            {/* Short enough to stay on ONE line at 244px. The count belongs in
                the sentence above; "Delete it and its books" wrapped, and a
                destructive button that reflows reads as a mistake. */}
            {books() > 0 ? 'Delete it all' : 'Delete it'}
          </button>
          <button type="button" class="shelf-menu__btn" onClick={props.onClose}>
            Keep
          </button>
        </div>
      </Show>
    </MenuCard>
  );
}
