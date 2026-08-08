/**
 * The backlinks tab — "3 pages link here", at the foot of the page.
 *
 * WHY IT IS ON THE PAGE AND NOT IN THE RAIL. A backlink is a fact ABOUT THIS
 * PAGE, and the reader has to be able to find it without knowing it exists. A
 * rail panel is a place you go when you already suspect the answer is there; a
 * line at the foot of the page is a thing you notice. It is also where the
 * same fact has always lived on paper — the foot of the page is where a book
 * puts its cross-references.
 *
 * IT COSTS THE PAGE ITS OWN ROOM, HONESTLY. The tab is drawn in the page's
 * bottom margin and the prose reserves that strip through
 * `--nb-backlink-rail` (PageEditor sets it, editor.css adds it to the prose's
 * padding-bottom next to the footnote rail's). That single quantity is the one
 * the overflow drain re-reads on every pass, so a page that gains a backlink
 * pushes its last line onward instead of printing underneath the tab. Anything
 * cleverer — measuring the tab, floating it over the text — would be a second
 * source of truth about how tall the page is, and the drain would not see it.
 *
 * NOTHING IS DRAWN WHEN NOTHING LINKS HERE. Most pages in most notebooks are
 * linked from nowhere, and a permanent "0 pages link here" would be a line of
 * furniture on every page of the book.
 */
import { For, Show, createSignal, type JSX } from 'solid-js';
import { requestSearchJump } from '../../search/jump';
import type { PageCard } from '../../search/backlinks';
import { play } from '../../sound/engine';

/** Rows the open card shows before it starts counting the rest. */
const MAX_ROWS = 5;

export interface BacklinksTabProps {
  readonly cards: readonly PageCard[];
}

/** A bowed return arrow — the mark for "and back this way". */
function ReturnMark(): JSX.Element {
  return (
    <svg class="nb-backlink-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 5.4 C 20.6 9.2 19.4 12.6 16.4 14.4 C 13.2 16.3 9.4 16.8 5.2 16.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
      />
      <path
        d="M9.6 11.6 C 7.9 13.2 6.4 14.8 5.2 16.4 C 6.6 17.9 8.2 19.3 10 20.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export default function BacklinksTab(props: BacklinksTabProps): JSX.Element {
  const [open, setOpen] = createSignal(false);

  const count = (): number => props.cards.length;
  const shown = (): readonly PageCard[] => props.cards.slice(0, MAX_ROWS);
  const hidden = (): number => Math.max(0, count() - MAX_ROWS);

  const words = (): string =>
    count() === 1 ? '1 page links here' : `${count()} pages link here`;

  const toggle = (): void => {
    setOpen((was) => !was);
  };

  const follow = (card: PageCard): void => {
    setOpen(false);
    void play('page-flip');
    requestSearchJump(card.bookId, card.pageId, []);
  };

  return (
    <Show when={count() > 0}>
      <div
        class="nb-backlinks"
        classList={{ 'is-open': open() }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open()) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <Show when={open()}>
          <div class="nb-backlink-card" role="group" aria-label="Pages that link here">
            <div class="nb-backlink-head font-ui">linked from</div>
            <For each={shown()}>
              {(card) => (
                <button
                  type="button"
                  class="nb-backlink-row"
                  data-page={card.pageId}
                  onClick={() => follow(card)}
                >
                  <span class="nb-backlink-row-text">
                    <span
                      class="nb-backlink-title"
                      classList={{ 'is-untitled': card.untitled }}
                    >
                      {card.title}
                    </span>
                    <span class="nb-backlink-where font-ui">
                      {card.bookTitle} · page {card.ord + 1}
                    </span>
                  </span>
                </button>
              )}
            </For>
            <Show when={hidden() > 0}>
              <p class="nb-backlink-more font-ui">
                and {hidden()} more {hidden() === 1 ? 'page' : 'pages'}
              </p>
            </Show>
          </div>
        </Show>

        <button
          type="button"
          class="nb-backlink-tab"
          aria-expanded={open()}
          aria-label={words()}
          data-tooltip={open() ? 'Hide the pages that link here' : 'Show the pages that link here'}
          data-tooltip-side="top"
          onClick={toggle}
        >
          <ReturnMark />
          <span class="nb-backlink-count font-ui">{words()}</span>
        </button>
      </div>
    </Show>
  );
}
