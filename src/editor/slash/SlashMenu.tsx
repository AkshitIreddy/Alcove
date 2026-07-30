/**
 * Slash-menu popover — an aged-paper card with Kalam labels, dashed hover
 * states, and sections. Pure presentation; the suggestion plugin in
 * extension.ts owns positioning, filtering, and keyboard state.
 */
import { For, Show, createEffect, type JSX } from 'solid-js';
import { stickerSvg } from '../nodes/stickers';
import {
  SLASH_SECTION_LABELS,
  type SlashCommand,
  type SlashIcon,
} from './registry';

export interface SlashMenuProps {
  readonly items: readonly SlashCommand[];
  readonly selectedIndex: number;
  onSelect(item: SlashCommand): void;
  onHover(index: number): void;
}

function Icon(props: { readonly icon: SlashIcon }): JSX.Element {
  return (
    <Show
      when={props.icon.kind === 'sticker' && props.icon}
      fallback={
        <span class="nb-slash-glyph" aria-hidden="true">
          {props.icon.kind === 'text' ? props.icon.text : ''}
        </span>
      }
    >
      {(icon) => {
        const resolved = icon();
        return (
          <span
            class="nb-slash-sticker"
            aria-hidden="true"
            innerHTML={
              resolved.kind === 'sticker' ? stickerSvg(resolved.stickerId) : ''
            }
          />
        );
      }}
    </Show>
  );
}

export default function SlashMenu(props: SlashMenuProps): JSX.Element {
  let listElement: HTMLDivElement | undefined;

  // Keep the keyboard-selected row in view.
  createEffect(() => {
    const index = props.selectedIndex;
    const row = listElement?.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    );
    row?.scrollIntoView({ block: 'nearest' });
  });

  const sectionOf = (index: number): string | null => {
    const current = props.items[index];
    if (!current) return null;
    const previous = props.items[index - 1];
    return previous?.section === current.section
      ? null
      : SLASH_SECTION_LABELS[current.section];
  };

  return (
    <div class="nb-slash-menu" role="listbox" aria-label="Insert block">
      <Show
        when={props.items.length > 0}
        fallback={
          <p class="nb-slash-empty font-accent">nothing matches — keep typing?</p>
        }
      >
        <div class="nb-slash-list" ref={listElement}>
          <For each={props.items}>
            {(item, index) => (
              <>
                <Show when={sectionOf(index())}>
                  {(label) => <div class="nb-slash-section">{label()}</div>}
                </Show>
                <button
                  type="button"
                  role="option"
                  class="nb-slash-item"
                  classList={{ 'is-selected': index() === props.selectedIndex }}
                  aria-selected={index() === props.selectedIndex}
                  data-index={index()}
                  // mousedown, not click: keep focus in the editor.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    props.onSelect(item);
                  }}
                  onMouseEnter={() => props.onHover(index())}
                >
                  <Icon icon={item.icon} />
                  <span class="nb-slash-text">
                    <span class="nb-slash-title">{item.title}</span>
                    <Show when={item.subtitle}>
                      <span class="nb-slash-subtitle font-ui">
                        {item.subtitle}
                      </span>
                    </Show>
                  </span>
                </button>
              </>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
