/**
 * The `[[` picker's card — presentation only. The suggestion plugin
 * (./extension.ts) owns positioning, the query, the async load and every
 * transaction; this file is handed a list and draws it.
 *
 * Two lines per row, and both of them earn their place: the page's derived
 * name (src/search/pageCards.ts) is what the reader is looking for, and the
 * book + page number underneath is what tells two pages with the same heading
 * apart — which, in a notebook full of "Monday", is most of them.
 */
import { For, Show, createEffect, type JSX } from 'solid-js';
import type { PageCard } from '../../search/backlinks';
import { createHoverIntent } from '../menu/hoverIntent';

export interface PageLinkMenuProps {
  readonly items: readonly PageCard[];
  readonly selectedIndex: number;
  /** True while the first load for this query is still out. */
  readonly loading: boolean;
  onSelect(item: PageCard): void;
  onHover(index: number): void;
}

export default function PageLinkMenu(props: PageLinkMenuProps): JSX.Element {
  let listElement: HTMLDivElement | undefined;

  // The card opens at the caret, which is very often under a resting mouse —
  // and an element appearing beneath a stationary pointer still fires
  // mouseenter. Without this the highlight jumps to whatever row landed under
  // the cursor and Enter inserts that page instead of the one being read.
  const pointerMoved = createHoverIntent();

  createEffect(() => {
    const index = props.selectedIndex;
    listElement
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  return (
    <div class="nb-pagepick" role="listbox" aria-label="Link to a page">
      <div class="nb-pagepick-head font-ui">link to a page</div>
      <Show
        when={props.items.length > 0}
        fallback={
          <p class="nb-pagepick-empty font-accent">
            {props.loading ? 'looking through the shelves…' : 'no page by that name'}
          </p>
        }
      >
        <div class="nb-pagepick-list" ref={listElement}>
          <For each={props.items}>
            {(item, index) => (
              <button
                type="button"
                role="option"
                class="nb-pagepick-item"
                classList={{ 'is-selected': index() === props.selectedIndex }}
                aria-selected={index() === props.selectedIndex}
                data-index={index()}
                data-page={item.pageId}
                // mousedown, not click: keep focus (and the caret) in the page.
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onSelect(item);
                }}
                onMouseEnter={() => {
                  if (pointerMoved()) props.onHover(index());
                }}
              >
                <span class="nb-pagepick-text">
                  <span
                    class="nb-pagepick-title"
                    classList={{ 'is-untitled': item.untitled }}
                  >
                    {item.title}
                  </span>
                  <span class="nb-pagepick-where font-ui">
                    {item.bookTitle} · page {item.ord + 1}
                  </span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
