/**
 * src/views/rail/TocPanel.tsx — the book's table of contents (roadmap #9):
 * every heading of every page as an indented hand-drawn tree; clicking an
 * entry jumps the spread to that page. Heading-less continuation pages name
 * the section they continue; stocked trailing blank leaves stay out of sight.
 */
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Show,
  type JSX,
} from 'solid-js';
import type { Page } from '../../data/types';
import { buildTocRows, filterTocRows, normalizeTocSearch } from '../toc';

export interface TocPanelProps {
  pages: readonly Page[];
  currentSpread: number;
  onJump(slot: number): void;
}

export default function TocPanel(props: TocPanelProps): JSX.Element {
  let searchInput: HTMLInputElement | undefined;
  let results: HTMLDivElement | undefined;
  const resultsId = createUniqueId();
  const statusId = createUniqueId();
  const [query, setQuery] = createSignal('');
  const rows = createMemo(() => buildTocRows(props.pages));
  const searching = createMemo(() => normalizeTocSearch(query()).length > 0);
  const matches = createMemo(() => filterTocRows(rows(), query()));

  const clearSearch = (): void => {
    setQuery('');
    searchInput?.focus({ preventScroll: true });
  };

  const focusResult = (at: number): void => {
    const buttons = results?.querySelectorAll<HTMLButtonElement>('.nb-toc-row');
    if (!buttons || buttons.length === 0) return;
    // Native focus scrolling is useful here: a reader walking a long TOC with
    // arrow keys must see the row they just reached beneath the pinned search.
    buttons[Math.min(buttons.length - 1, Math.max(0, at))]?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && searching()) {
      // RailPanel owns an unhandled Escape and closes the whole sheet. The
      // first Escape here has the smaller, expected job: clear this search.
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResult(0);
      return;
    }
    if (event.key === 'Enter' && matches().length > 0) {
      event.preventDefault();
      props.onJump(matches()[0]!.slot);
    }
  };

  const onResultsKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.matches('.nb-toc-row')) return;

    const buttons = [...(results?.querySelectorAll<HTMLButtonElement>('.nb-toc-row') ?? [])];
    const current = buttons.indexOf(target);
    if (current < 0) return;

    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current + 1;
    if (event.key === 'ArrowUp' && current === 0) {
      event.preventDefault();
      searchInput?.focus({ preventScroll: true });
      return;
    }
    if (event.key === 'ArrowUp') next = current - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      searchInput?.focus({ preventScroll: true });
      return;
    }
    if (next === null) return;
    event.preventDefault();
    focusResult(next);
  };

  return (
    <div class="nb-toc" data-testid="toc-panel">
      <Show
        when={rows().length > 0}
        fallback={
          <p class="nb-panel-footnote">
            no headings yet — write an H1 and it will appear here
          </p>
        }
      >
        <div class="nb-toc-search-head nb-sheet-head">
          <div class="nb-toc-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M 10.4 4.8 C 14.1 4.5 17.2 7.2 17.4 10.8 C 17.6 14.3 15 17.2 11.5 17.5 C 8 17.8 5.1 15.2 4.8 11.7 C 4.5 8.2 7 5.2 10.4 4.8 Z" />
              <path d="M 16 16.1 C 17.6 17.6 19.1 19 20.2 20.2" />
            </svg>
            <input
              ref={(element) => (searchInput = element)}
              type="search"
              value={query()}
              placeholder="find a section or page…"
              aria-label="Search this table of contents"
              aria-controls={resultsId}
              aria-describedby={statusId}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
            />
            <Show when={searching()}>
              <button
                type="button"
                class="nb-toc-search-clear"
                aria-label="Clear table of contents search"
                title="clear search"
                onClick={clearSearch}
              >
                <svg viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M 4.2 4.5 C 7.1 7.3 10.2 10.4 13.8 13.6 M 13.7 4.3 C 10.7 7.3 7.4 10.6 4.2 13.8" />
                </svg>
              </button>
            </Show>
          </div>
          <div class="nb-toc-search-meta" id={statusId} role="status" aria-live="polite">
            <span>
              {searching()
                ? `${matches().length} ${matches().length === 1 ? 'match' : 'matches'} in ${rows().length}`
                : `${rows().length} ${rows().length === 1 ? 'entry' : 'entries'} in this book`}
            </span>
            <Show when={searching() && matches().length > 0}>
              <span aria-hidden="true">↓ browse · enter open</span>
            </Show>
          </div>
        </div>

        <div
          ref={(element) => (results = element)}
          id={resultsId}
          class="nb-toc-results"
          onKeyDown={onResultsKeyDown}
        >
          <For
            each={matches()}
            fallback={
              <div class="nb-toc-empty" role="note">
                <svg viewBox="0 0 32 32" aria-hidden="true">
                  <path d="M 8.2 8.4 C 12.8 7.7 17.5 7.8 22.6 8.6 L 22.1 23.7 C 17.3 23 12.6 22.9 8.7 23.6 Z" />
                  <path d="M 11.7 12.3 C 14.3 12 16.9 12.1 19.5 12.5 M 11.5 16.1 C 13.4 15.9 15.4 16 17.3 16.3" />
                </svg>
                <strong>nothing under that wording</strong>
                <span>try a shorter title or a page number</span>
              </div>
            }
          >
            {(row) => (
              <button
                type="button"
                class="nb-toc-row"
                classList={{
                  'is-page-row': row.isPageRow,
                  'is-current': Math.floor(row.slot / 2) === props.currentSpread,
                }}
                data-level={row.level}
                onClick={() => props.onJump(row.slot)}
              >
                <span class="nb-toc-text">{row.text}</span>
                <span class="nb-toc-page font-label">p.{row.slot + 1}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
