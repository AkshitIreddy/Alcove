/**
 * QuickSwitcher — the Ctrl+K hand-drawn command bar (roadmap items 20–21).
 *
 * Two modes behind one bar:
 * - "go to" (default): fuzzy palette over book titles + page headings,
 *   recent-weighted (src/search/recents). Enter opens the book through the
 *   existing appState open flow; heading rows jump straight to the page.
 * - "search text" (a `>` prefix, the tab, or Tab key): full-text search over
 *   the search index (src/data/search) with match snippets; activating a row
 *   opens the book, flips to the page and pulse-highlights the match
 *   (src/search/jump).
 *
 * Mount-anywhere: the component registers a module-level primary instance so
 * mounting it in several hosts (ShelfView + BookView today, App.tsx once the
 * orchestrator wires it) renders exactly one overlay + one hotkey listener.
 */

import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { openBookAnywhere } from '../bookshelf/openAnywhere';
import { listBooksByFloorRange } from '../../data/books';
import {
  ensureIndexFresh,
  searchContent,
  loadIndex,
  type ContentHit,
  type IndexedPage,
} from '../../data/search';
import { settings } from '../../data/settings';
import { matchesBinding, registerCommands } from '../../data/keybindings';
import type { Book } from '../../data/types';
import { fuzzyMatch } from '../../search/fuzzy';
import { tokenize } from '../../search/rank';
import {
  recentBookIds,
  recencyBoost,
  recordBookOpened,
} from '../../search/recents';
import { requestSearchJump } from '../../search/jump';
import { play } from '../../sound/engine';
import '../../styles/search.css';

// ---------------------------------------------------------------------------
// Single-instance registry (see module docblock)
// ---------------------------------------------------------------------------

const [primaryToken, setPrimaryToken] = createSignal<object | null>(null);

// Hotkey: "mod+k" from settings.keybindings['command-palette']. The matcher
// itself lives in data/keybindings.ts — every shortcut in the app shares it.

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

interface BookRowItem {
  kind: 'book';
  book: Book;
  score: number;
}

interface HeadingRowItem {
  kind: 'heading';
  page: IndexedPage;
  headingText: string;
  bookTitle: string;
  score: number;
}

interface ContentRowItem {
  kind: 'content';
  hit: ContentHit;
}

type Row = BookRowItem | HeadingRowItem | ContentRowItem;

const NAV_LIMIT = 12;

/** Hand-drawn micro-icons (pre-wobbled static paths — no runtime filters). */
function BookIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 22 22" class="nb-qs-icon" aria-hidden="true">
      <path
        d="M 4.3 3.6 C 4.1 8.7 4.2 13.9 4.4 18.5 M 4.4 18.5 C 8.6 18.2 13.2 18.4 17.4 18.3 M 17.4 18.3 C 17.7 13.5 17.5 8.4 17.5 3.8 C 13.1 3.5 8.5 3.7 4.3 3.6 M 7.6 3.7 L 7.5 18.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function HeadingIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 22 22" class="nb-qs-icon" aria-hidden="true">
      <path
        d="M 5.2 4.4 C 5.1 9.1 5.3 13.8 5.2 17.8 M 16.6 4.2 C 16.8 8.9 16.6 13.6 16.8 17.9 M 5.3 10.9 C 9.1 11.2 12.9 10.8 16.7 11.1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function SnippetIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 22 22" class="nb-qs-icon" aria-hidden="true">
      <path
        d="M 13.9 13.7 C 15.8 12 16.4 9 14.9 6.9 C 13.4 4.7 10.2 4.1 8 5.5 C 5.7 6.9 5 10 6.4 12.2 C 7.9 14.5 11.2 15.1 13.4 13.9 M 14.2 13.9 L 18.3 17.8"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export default function QuickSwitcher(): JSX.Element {
  const token = {};

  // Claim / release the primary slot.
  onMount(() => {
    if (primaryToken() === null) setPrimaryToken(token);
  });
  createEffect(() => {
    if (primaryToken() === null) setPrimaryToken(token);
  });
  onCleanup(() => {
    if (primaryToken() === token) setPrimaryToken(null);
  });
  const isPrimary = (): boolean => primaryToken() === token;

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [open, setOpen] = createSignal(false);
  const [raw, setRaw] = createSignal('');
  const [sel, setSel] = createSignal(0);
  const [books, setBooks] = createSignal<Book[]>([]);
  const [index, setIndex] = createSignal<IndexedPage[]>([]);
  const [contentHits, setContentHits] = createSignal<ContentHit[]>([]);
  const [recents, setRecents] = createSignal<string[]>([]);
  let inputEl: HTMLInputElement | undefined;

  const mode = (): 'nav' | 'content' =>
    raw().startsWith('>') ? 'content' : 'nav';
  /** What the field SHOWS — the `>` mode prefix is never displayed. */
  const shown = (): string =>
    mode() === 'content' ? raw().slice(1) : raw();
  const query = (): string => shown().trim();

  const refreshData = async (): Promise<void> => {
    try {
      const shelved = await listBooksByFloorRange(0, 9999);
      setBooks(shelved);
      await ensureIndexFresh(true);
      setIndex(await loadIndex());
    } catch {
      // Search stays usable with whatever data already loaded.
    }
  };

  /**
   * `scope` is which of the bar's two modes it opens in. The `>` prefix IS the
   * mode (see `mode()`), so opening straight into full-text search is a matter
   * of seeding the field with it — no second piece of state that could
   * disagree with the tabs.
   */
  const openSwitcher = (scope: 'nav' | 'content' = 'nav'): void => {
    setRaw(scope === 'content' ? '>' : '');
    setSel(0);
    setRecents(recentBookIds());
    setOpen(true);
    void refreshData();
    void play('pop-soft');
    requestAnimationFrame(() => inputEl?.focus());
  };

  const close = (): void => {
    setOpen(false);
  };

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  const titleOf = (bookId: string): string =>
    books().find((book) => book.id === bookId)?.title ?? 'Untitled book';

  const navRows = createMemo((): Row[] => {
    const q = query();
    const recentList = recents();

    if (q === '') {
      // Empty query: recents first, then the rest, newest edits first.
      const byId = new Map(books().map((book) => [book.id, book]));
      const rows: Row[] = [];
      for (const id of recentList) {
        const book = byId.get(id);
        if (book !== undefined) {
          rows.push({ kind: 'book', book, score: 0 });
          byId.delete(id);
        }
      }
      const rest = [...byId.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      for (const book of rest) rows.push({ kind: 'book', book, score: 0 });
      return rows.slice(0, NAV_LIMIT);
    }

    const rows: Row[] = [];
    for (const book of books()) {
      const match = fuzzyMatch(q, book.title);
      if (match === null) continue;
      rows.push({
        kind: 'book',
        book,
        // +6 bias: a book beats an equally-matching heading.
        score: match.score + 6 + recencyBoost(book.id, recentList),
      });
    }
    for (const page of index()) {
      for (const heading of page.headings) {
        const match = fuzzyMatch(q, heading.text);
        if (match === null) continue;
        rows.push({
          kind: 'heading',
          page,
          headingText: heading.text,
          bookTitle: titleOf(page.bookId),
          score:
            match.score -
            heading.level +
            recencyBoost(page.bookId, recentList) * 0.5,
        });
      }
    }
    rows.sort((a, b) => {
      const sa = a.kind === 'content' ? 0 : a.score;
      const sb = b.kind === 'content' ? 0 : b.score;
      return sb - sa;
    });
    return rows.slice(0, NAV_LIMIT);
  });

  // Content mode: re-rank (in-memory index) whenever query or index changes.
  createEffect(() => {
    if (!open() || mode() !== 'content') return;
    const q = query();
    index(); // track: re-run once the freshness sweep lands
    if (q.length < 2) {
      setContentHits([]);
      return;
    }
    void searchContent(q).then((hits) => {
      // Stale-guard: only apply if the query still matches.
      if (open() && mode() === 'content' && query() === q) setContentHits(hits);
    });
  });

  const rows = createMemo((): Row[] =>
    mode() === 'content'
      ? contentHits().map((hit): Row => ({ kind: 'content', hit }))
      : navRows(),
  );

  createEffect(() => {
    const count = rows().length;
    if (sel() >= count) setSel(count > 0 ? count - 1 : 0);
  });

  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------
  const activate = (row: Row): void => {
    if (row.kind === 'book') {
      recordBookOpened(row.book.id);
      // The switcher lists the WHOLE library, so the pick may live in another
      // case — go and stand in it first, or shutting the book drops the reader
      // onto a shelf that does not contain it.
      void openBookAnywhere(row.book.id);
    } else if (row.kind === 'heading') {
      requestSearchJump(row.page.bookId, row.page.pageId, [
        row.headingText,
        ...tokenize(row.headingText),
      ]);
    } else {
      const q = query();
      requestSearchJump(row.hit.bookId, row.hit.pageId, [
        q.toLowerCase(),
        ...tokenize(q),
      ]);
    }
    void play('page-flip');
    close();
  };

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------
  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (!isPrimary()) return;
    const binding = settings.keybindings['command-palette'] ?? 'mod+k';
    if (matchesBinding(event, binding)) {
      event.preventDefault();
      event.stopPropagation();
      if (open()) close();
      else openSwitcher();
      return;
    }
    if (open() && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  onMount(() =>
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true }),
  );
  onCleanup(() =>
    window.removeEventListener('keydown', onGlobalKeyDown, { capture: true }),
  );

  /**
   * The bar's second door: straight into "search text".
   *
   * Through the command bus rather than a second `matchesBinding` branch in
   * the handler above, because that handler runs in the CAPTURE phase — which
   * is right for the palette (it must beat the editor's own Mod-k link tray)
   * and wrong for everything else, since a capture listener also beats a
   * settings row that is in the middle of recording a new combination.
   *
   * Only the primary instance claims it, for the same reason only the primary
   * instance draws the overlay — and it is an effect rather than an `onMount`
   * because the primary slot MOVES: shelf and book each mount a switcher, so
   * the instance that is primary on the shelf hands the slot over when that
   * view goes away, and the one that inherits it has long since mounted.
   */
  createEffect(() => {
    if (!isPrimary()) return;
    onCleanup(
      registerCommands({
        'search-text': () => {
          if (open() && mode() === 'content') close();
          else openSwitcher('content');
        },
      }),
    );
  });

  const toggleMode = (): void => {
    setRaw((value) => (value.startsWith('>') ? value.slice(1) : `>${value}`));
    setSel(0);
    inputEl?.focus();
  };

  const onInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = rows().length;
      if (count === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSel((current) => (current + delta + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = rows()[sel()];
      if (row !== undefined) activate(row);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      toggleMode();
    } else if (
      event.key === 'Backspace' &&
      mode() === 'content' &&
      shown() === ''
    ) {
      // The field is visually empty but `raw` still holds the hidden `>`, so
      // the browser fires no input event — backspace here drops the mode
      // instead of dead-ending the user in "search text".
      event.preventDefault();
      setRaw('');
      setSel(0);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const rowTitle = (row: Row): string => {
    if (row.kind === 'book') return row.book.title;
    if (row.kind === 'heading') return row.headingText;
    return row.hit.bookTitle;
  };

  const rowMeta = (row: Row): string => {
    if (row.kind === 'book') return 'book';
    if (row.kind === 'heading')
      return `${row.bookTitle} · p. ${row.page.ord + 1}`;
    return `p. ${row.hit.ord + 1}`;
  };

  return (
    <Show when={isPrimary() && open()}>
      <Portal>
        <div class="nb-qs-scrim" onClick={close}>
          <div
            class="nb-qs-bar"
            role="dialog"
            aria-modal="true"
            aria-label="Quick switcher"
            onClick={(event) => event.stopPropagation()}
          >
            {/*
              The close sits BESIDE the tablist, not inside it: a plain button
              among role="tab" children is announced as a tab it cannot be.
              First in the row, so the visible top-left corner and the tab
              order agree — same reasoning as `order: -1` elsewhere, except
              here the markup can simply say it.
            */}
            <div class="nb-qs-head">
              <button
                type="button"
                class="nb-qs-close"
                aria-label="Close search"
                onClick={close}
              >
                ×
              </button>
              <div class="nb-qs-tabs" role="tablist" aria-label="Search mode">
                <button
                  type="button"
                  role="tab"
                  class="nb-qs-tab font-label"
                  classList={{ 'is-active': mode() === 'nav' }}
                  aria-selected={mode() === 'nav'}
                  onClick={() => {
                    if (mode() === 'content') toggleMode();
                  }}
                >
                  go to
                </button>
                <button
                  type="button"
                  role="tab"
                  class="nb-qs-tab font-label"
                  classList={{ 'is-active': mode() === 'content' }}
                  aria-selected={mode() === 'content'}
                  onClick={() => {
                    if (mode() === 'nav') toggleMode();
                  }}
                >
                  search text
                </button>
              </div>
            </div>

            <input
              ref={inputEl}
              class="nb-qs-input"
              type="text"
              spellcheck={false}
              autocomplete="off"
              aria-label="Quick switcher query"
              placeholder={
                mode() === 'content'
                  ? 'search inside every page…'
                  : 'jump to a book or heading…  (> to search text)'
              }
              /* The `>` is a typing SHORTCUT into content mode, not a token
                 the user should have to see or delete: once the mode is lit
                 in the tabs, showing the prefix in the field is a second,
                 redundant representation of the same state. */
              value={shown()}
              onInput={(event) => {
                const next = event.currentTarget.value;
                setRaw(
                  mode() === 'content' && !next.startsWith('>')
                    ? `>${next}`
                    : next,
                );
                setSel(0);
              }}
              onKeyDown={onInputKeyDown}
            />

            <div class="nb-qs-results" role="listbox" aria-label="Results">
              <For each={rows()}>
                {(row, i) => (
                  <button
                    type="button"
                    role="option"
                    class="nb-qs-row"
                    classList={{ 'is-selected': i() === sel() }}
                    aria-selected={i() === sel()}
                    data-kind={row.kind}
                    onMouseEnter={() => setSel(i())}
                    onClick={() => activate(row)}
                  >
                    <span class="nb-qs-row-icon">
                      {row.kind === 'book' ? (
                        <BookIcon />
                      ) : row.kind === 'heading' ? (
                        <HeadingIcon />
                      ) : (
                        <SnippetIcon />
                      )}
                    </span>
                    <span class="nb-qs-row-body">
                      <span class="nb-qs-row-title">
                        {rowTitle(row)}
                        <span class="nb-qs-row-meta font-ui">{rowMeta(row)}</span>
                      </span>
                      <Show when={row.kind === 'content' ? row : null} keyed>
                        {(contentRow) => (
                          <span class="nb-qs-row-snippet">
                            <Show when={contentRow.hit.snippet.leading}>…</Show>
                            <For each={contentRow.hit.snippet.segments}>
                              {(segment) =>
                                segment.hit ? (
                                  <mark class="nb-qs-hit">{segment.text}</mark>
                                ) : (
                                  segment.text
                                )
                              }
                            </For>
                            <Show when={contentRow.hit.snippet.trailing}>…</Show>
                          </span>
                        )}
                      </Show>
                    </span>
                  </button>
                )}
              </For>
              <Show when={rows().length === 0}>
                <p class="nb-qs-empty font-accent">
                  {mode() === 'content' && query().length < 2
                    ? 'type a word to search inside pages'
                    : 'nothing here — fewer letters, maybe?'}
                </p>
              </Show>
            </div>

            <footer class="nb-qs-footer font-ui">
              <span>
                <kbd>↑↓</kbd> move
              </span>
              <span>
                <kbd>enter</kbd> open
              </span>
              <span>
                <kbd>tab</kbd> mode
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </footer>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
