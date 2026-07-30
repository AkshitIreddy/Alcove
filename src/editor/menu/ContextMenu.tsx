/**
 * Right-click block context menu — Solid component rendered into a body
 * portal by contextMenu.ts. Aged-paper card styling (editor.css .nb-ctx-*)
 * matching the slash menu; submenus open on hover/ArrowRight; fully
 * keyboard navigable (the controller owns the document-level key handling
 * and drives selection through props).
 */
import { For, Show, createEffect, type JSX } from 'solid-js';
import type {
  ContextMenuEntry,
  ContextMenuItem,
  ContextMenuSubmenu,
} from './registry';

export interface ContextMenuSelection {
  /** Index into the entries array (items + submenus; dividers skipped). */
  readonly index: number;
  /** Open submenu id, or null when the root level has focus. */
  readonly openSubmenu: string | null;
  /** Selected row inside the open submenu. */
  readonly subIndex: number;
}

export interface ContextMenuProps {
  readonly entries: readonly ContextMenuEntry[];
  readonly selection: ContextMenuSelection;
  onHoverEntry(index: number): void;
  onHoverSubItem(index: number): void;
  onOpenSubmenu(id: string | null): void;
  onRunItem(item: ContextMenuItem): void;
}

function Glyph(props: {
  readonly glyph?: string;
  readonly swatch?: string;
}): JSX.Element {
  return (
    <Show
      when={props.swatch}
      fallback={
        <span class="nb-ctx-glyph" aria-hidden="true">
          {props.glyph ?? ''}
        </span>
      }
    >
      {(swatch) => (
        <span
          class="nb-ctx-swatch"
          style={{ background: swatch() }}
          aria-hidden="true"
        />
      )}
    </Show>
  );
}

function Row(props: {
  readonly item: ContextMenuItem;
  readonly selected: boolean;
  readonly inSubmenu: boolean;
  onHover(): void;
  onRun(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      class="nb-ctx-item"
      classList={{
        'is-selected': props.selected,
        'is-danger': props.item.danger === true,
      }}
      data-ctx-id={props.item.id}
      // mousedown, not click: keep focus in the editor (slash-menu pattern).
      onMouseDown={(event) => {
        event.preventDefault();
        props.onRun();
      }}
      onMouseEnter={() => props.onHover()}
    >
      <Glyph glyph={props.item.glyph} swatch={props.item.swatch} />
      <span class="nb-ctx-title">{props.item.title}</span>
    </button>
  );
}

export default function ContextMenu(props: ContextMenuProps): JSX.Element {
  let rootElement: HTMLDivElement | undefined;

  // Keep the keyboard-selected row scrolled into view (long submenus).
  createEffect(() => {
    void props.selection.index;
    void props.selection.subIndex;
    void props.selection.openSubmenu;
    const row = rootElement?.querySelector<HTMLElement>(
      '.nb-ctx-item.is-selected, .nb-ctx-parent.is-selected',
    );
    row?.scrollIntoView({ block: 'nearest' });
  });

  const submenuOpen = (entry: ContextMenuSubmenu): boolean =>
    props.selection.openSubmenu === entry.id;

  return (
    <div
      class="nb-ctx-menu"
      role="menu"
      aria-label="Block actions"
      ref={rootElement}
    >
      <div class="nb-ctx-list">
        <For each={props.entries}>
          {(entry, index) => {
            if (entry.kind === 'divider') {
              return <div class="nb-ctx-divider" role="separator" />;
            }
            if (entry.kind === 'submenu') {
              return (
                <div
                  class="nb-ctx-parent-wrap"
                  onMouseLeave={() => {
                    if (submenuOpen(entry)) props.onOpenSubmenu(null);
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={submenuOpen(entry)}
                    class="nb-ctx-item nb-ctx-parent"
                    classList={{
                      'is-selected':
                        index() === props.selection.index &&
                        props.selection.openSubmenu === null,
                      'is-open': submenuOpen(entry),
                    }}
                    data-ctx-id={entry.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      props.onHoverEntry(index());
                      props.onOpenSubmenu(entry.id);
                    }}
                  >
                    <Glyph glyph={entry.glyph} />
                    <span class="nb-ctx-title">{entry.title}</span>
                    <span class="nb-ctx-caret" aria-hidden="true">
                      ▸
                    </span>
                  </button>
                  <Show when={submenuOpen(entry)}>
                    <div class="nb-ctx-sub" role="menu" aria-label={entry.title}>
                      <For each={entry.items}>
                        {(item, subIndex) => (
                          <Row
                            item={item}
                            inSubmenu
                            selected={subIndex() === props.selection.subIndex}
                            onHover={() => props.onHoverSubItem(subIndex())}
                            onRun={() => props.onRunItem(item)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              );
            }
            return (
              <Row
                item={entry}
                inSubmenu={false}
                selected={
                  index() === props.selection.index &&
                  props.selection.openSubmenu === null
                }
                onHover={() => {
                  props.onHoverEntry(index());
                  props.onOpenSubmenu(null);
                }}
                onRun={() => props.onRunItem(entry)}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
