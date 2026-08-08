/**
 * Context-menu controller — opens the Solid ContextMenu in a body portal at
 * the pointer, owns keyboard navigation + dismissal, and suppresses the
 * native menu inside the editor only (PageEditor wires handleDOMEvents).
 *
 * Right-click behavior (Notion-grade): the block under the cursor is
 * NodeSelected first, then the menu opens. Escape closes (submenu first),
 * arrows navigate, ArrowRight/Enter dives into submenus, ArrowLeft backs out.
 */
import type { Editor } from '@tiptap/core';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import ContextMenu from './ContextMenu';
import {
  buildBlockContextMenu,
  type ContextMenuContext,
  type ContextMenuEntry,
  type ContextMenuItem,
  type ContextMenuSubmenu,
} from './registry';
import { selectBlock, topLevelBlockAt } from './blockOps';

interface OpenMenu {
  close(): void;
}

let openMenu: OpenMenu | null = null;

/** Close whatever block context menu is open (idempotent). */
export function closeBlockContextMenu(): void {
  openMenu?.close();
}

function selectableIndexes(entries: readonly ContextMenuEntry[]): number[] {
  const out: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind !== 'divider') out.push(index);
  });
  return out;
}

function stepThrough(
  candidates: readonly number[],
  current: number,
  delta: number,
): number {
  if (candidates.length === 0) return current;
  const at = candidates.indexOf(current);
  if (at === -1) return candidates[0];
  const next =
    (at + delta + candidates.length) % candidates.length;
  return candidates[next];
}

export interface OpenContextMenuOptions {
  readonly editor: Editor;
  readonly clientX: number;
  readonly clientY: number;
  /** Position immediately before the top-level block to act on. */
  readonly pos: number;
  readonly notify?: (message: string) => void;
}

export function openBlockContextMenu(options: OpenContextMenuOptions): void {
  closeBlockContextMenu();

  const { editor, pos } = options;
  if (editor.isDestroyed) return;

  // Select the block under the cursor first.
  selectBlock(editor, pos);

  const entries = buildBlockContextMenu();
  const candidates = selectableIndexes(entries);
  const context: ContextMenuContext = {
    editor,
    pos,
    notify: options.notify,
  };

  interface SelectionState {
    index: number;
    openSubmenu: string | null;
    subIndex: number;
  }
  const [selection, setSelection] = createStore<SelectionState>({
    index: candidates[0] ?? 0,
    openSubmenu: null,
    subIndex: 0,
  });

  const host = document.createElement('div');
  host.className = 'nb-ctx-portal';
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.zIndex = 'var(--z-menus)';
  document.body.appendChild(host);

  let disposed = false;
  const close = (): void => {
    if (disposed) return;
    disposed = true;
    openMenu = null;
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', close);
    editor.off('destroy', close);
    dispose();
    host.remove();
  };

  const runItem = (item: ContextMenuItem): void => {
    close();
    item.run(context);
  };

  const currentSubmenu = (): ContextMenuSubmenu | null => {
    if (selection.openSubmenu === null) return null;
    const entry = entries[selection.index];
    return entry !== undefined &&
      entry.kind === 'submenu' &&
      entry.id === selection.openSubmenu
      ? entry
      : null;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const submenu = currentSubmenu();
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (submenu) setSelection({ openSubmenu: null, subIndex: 0 });
        else {
          close();
          editor.view.focus();
        }
        return;
      case 'ArrowDown':
        event.preventDefault();
        if (submenu) {
          setSelection('subIndex', (i) => (i + 1) % submenu.items.length);
        } else {
          setSelection('index', (i) => stepThrough(candidates, i, 1));
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (submenu) {
          setSelection(
            'subIndex',
            (i) => (i - 1 + submenu.items.length) % submenu.items.length,
          );
        } else {
          setSelection('index', (i) => stepThrough(candidates, i, -1));
        }
        return;
      case 'ArrowRight': {
        const entry = entries[selection.index];
        if (!submenu && entry !== undefined && entry.kind === 'submenu') {
          event.preventDefault();
          setSelection({ openSubmenu: entry.id, subIndex: 0 });
        }
        return;
      }
      case 'ArrowLeft':
        if (submenu) {
          event.preventDefault();
          setSelection({ openSubmenu: null, subIndex: 0 });
        }
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (submenu) {
          const item = submenu.items[selection.subIndex];
          if (item) runItem(item);
          return;
        }
        const entry = entries[selection.index];
        if (entry === undefined) return;
        if (entry.kind === 'submenu') {
          setSelection({ openSubmenu: entry.id, subIndex: 0 });
        } else if (entry.kind === 'item') {
          runItem(entry);
        }
        return;
      }
      default:
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && host.contains(event.target)) return;
    close();
  };

  const dispose = render(
    () =>
      createComponent(ContextMenu, {
        entries,
        get selection() {
          return selection;
        },
        onHoverEntry: (index: number) => setSelection('index', index),
        onHoverSubItem: (index: number) => setSelection('subIndex', index),
        onOpenSubmenu: (id: string | null) =>
          setSelection({ openSubmenu: id, subIndex: 0 }),
        onRunItem: runItem,
      }),
    host,
  );

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('blur', close);
  editor.on('destroy', close);
  openMenu = { close };

  const reference = {
    getBoundingClientRect: (): DOMRect =>
      new DOMRect(options.clientX, options.clientY, 1, 1),
  };
  const card = host.firstElementChild;
  if (card instanceof HTMLElement) {
    void computePosition(reference, card, {
      placement: 'right-start',
      strategy: 'fixed',
      middleware: [offset(4), flip({ padding: 12 }), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      if (disposed) return;
      card.style.position = 'fixed';
      card.style.left = '0';
      card.style.top = '0';
      card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      // Near the right viewport edge, submenus fly out to the left instead.
      const width = card.getBoundingClientRect().width;
      if (x + width + 224 > window.innerWidth) {
        card.classList.add('is-left');
      }
    });
  }
}

/**
 * The contextmenu DOM handler PageEditor installs on the prose root:
 * resolves the clicked block, suppresses the native menu, opens ours.
 * Returns true when handled.
 */
export function handleEditorContextMenu(
  editor: Editor,
  event: MouseEvent,
  notify?: (message: string) => void,
): boolean {
  const view = editor.view;
  const found = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  const probe = found ? found.pos : view.state.selection.head;
  const block = topLevelBlockAt(editor, probe);
  if (!block) return false;
  event.preventDefault();
  openBlockContextMenu({
    editor,
    clientX: event.clientX,
    clientY: event.clientY,
    pos: block.pos,
    notify,
  });
  return true;
}
