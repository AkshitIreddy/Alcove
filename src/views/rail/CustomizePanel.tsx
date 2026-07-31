/**
 * src/views/rail/CustomizePanel.tsx — the Book Studio (library-themes.md §4).
 *
 * Two tabs behind the rail's Customize brush:
 *  1. **this book** — the full spine + cover vocabulary with a live preview
 *     that flips between the two faces (BookStudio.tsx).
 *  2. **this library** — the room: theme, wall finish, wallpaper pattern x
 *     colourway, flora density, lamp warmth (LibraryStudio.tsx).
 * Page defaults (line spacing / page style / ink) stay on the book tab, since
 * they are also "about this book".
 *
 * Persistence:
 *  - library choices go through `features/bookshelf/libraryPrefs` (the Pixi
 *    world subscribes to it, so the shelf redresses itself instantly);
 *  - book style goes to `cover_meta.style` via `saveBookStyleOverrides` when
 *    `bookId` is supplied, AND its cover-facing projection goes out through
 *    the existing `onOverridesChange` prop so the open book's cover, the
 *    pull-out ghost and the shelf spine all agree.
 */
import { For, Show, createEffect, createSignal, on, type JSX } from 'solid-js';
import type { BookStyleOverrides } from '../../art/bookStyle';
import { normalizeBookStyleOverrides } from '../../art/bookStyle';
import type { CoverOverrides } from '../../art/covers';
import type { BookStyle } from '../../art/bookStyle';
import { readBookStyleOverrides } from '../../data/books';
import type { BookPageDefaults } from '../../data/books';
import { getBook } from '../../data/books';
import { persistBookStyle } from '../../features/bookshelf/bookIdentity';
import type { PageStyle } from '../../data/types';
import BookStudio, { coverOverridesFromStyle } from './BookStudio';
import LibraryStudio from './LibraryStudio';

const PAGE_STYLES: readonly PageStyle[] = ['ruled', 'grid', 'blank', 'dotted'];
const INKS = [
  { value: 'sepia', label: 'sepia' },
  { value: 'graphite', label: 'graphite' },
  { value: 'ink-blue', label: 'ink blue' },
] as const;

export const LINE_SPACING_MIN = 26;
export const LINE_SPACING_MAX = 40;
const DEFAULT_LINE_SPACING = 32;

type StudioTab = 'book' | 'library';

export interface CustomizePanelProps {
  spineSeed: number;
  title: string;
  overrides: CoverOverrides | null;
  onOverridesChange(next: CoverOverrides | null): void;
  pageDefaults: BookPageDefaults | null;
  onPageDefaultsChange(next: BookPageDefaults | null): void;
  /**
   * The book being edited. Supply it and the studio persists the merged
   * style to `cover_meta.style` itself; omit it and the panel still works,
   * holding the style for the session only.
   */
  bookId?: string;
  /** Page count, for the default spine thickness. */
  pageCount?: number;
  /**
   * Which tab opens first. The rail (inside a book) starts on the book;
   * the shelf's own studio button starts on the room.
   */
  initialTab?: StudioTab;
}

export default function CustomizePanel(props: CustomizePanelProps): JSX.Element {
  const [tab, setTab] = createSignal<StudioTab>(props.initialTab ?? 'book');
  const [style, setStyle] = createSignal<Record<string, unknown> | null>(null);

  // Hydrate the persisted style blob whenever the book changes.
  createEffect(
    on(
      () => props.bookId,
      (id) => {
        if (id === undefined) {
          setStyle(null);
          return;
        }
        let stale = false;
        void getBook(id).then((book) => {
          if (!stale) setStyle(readBookStyleOverrides(book));
        });
        return () => {
          stale = true;
        };
      },
    ),
  );

  const changeStyle = (next: BookStyleOverrides | null): void => {
    const blob = (next as Record<string, unknown> | null) ?? null;
    setStyle(blob);
    const normalized = normalizeBookStyleOverrides(blob);
    // The cover art reads cover_meta.cover — keep it in step so the open book
    // and the pull-out ghost show what the studio previewed.
    props.onOverridesChange(
      normalized === null
        ? null
        : coverOverridesFromStyle(normalized as Parameters<typeof coverOverridesFromStyle>[0]),
    );
    if (props.bookId !== undefined) {
      // Writes cover_meta.style AND its cover projection, so the shelf spine,
      // the pull-out ghost and the opened book all agree.
      void persistBookStyle(props.bookId, (normalized as BookStyle | null) ?? null);
    }
  };

  const patchDefaults = (partial: BookPageDefaults): void => {
    props.onPageDefaultsChange({ ...(props.pageDefaults ?? {}), ...partial });
  };

  const lineSpacing = (): number =>
    props.pageDefaults?.lineHeightPx ?? DEFAULT_LINE_SPACING;

  return (
    <div class="nb-customize nb-studio">
      <div class="nb-studio-tabs" role="tablist" aria-label="Studio">
        <button
          type="button"
          class="nb-studio-tab"
          role="tab"
          aria-selected={tab() === 'book'}
          classList={{ 'is-active': tab() === 'book' }}
          onClick={() => setTab('book')}
        >
          this book
        </button>
        <button
          type="button"
          class="nb-studio-tab"
          role="tab"
          aria-selected={tab() === 'library'}
          classList={{ 'is-active': tab() === 'library' }}
          onClick={() => setTab('library')}
        >
          this library
        </button>
      </div>

      <Show when={tab() === 'book'}>
        <div class="nb-studio-pane" role="tabpanel" aria-label="This book">
          <BookStudio
            spineSeed={props.spineSeed}
            title={props.title}
            style={style()}
            onStyleChange={changeStyle}
            pageCount={props.pageCount}
            // The binding is keyed by book id, and without this the studio
            // falls back to `seed:<spineSeed>` — stable, but a different key
            // from the one the shelf's spine factory reads, so a pinned
            // binding would show in the panel and nowhere else.
            bookId={props.bookId}
          />

          <section class="nb-panel-section nb-panel-section-divided">
            <h3 class="nb-panel-section-title">pages of this book</h3>
            <label class="nb-panel-row">
              <span class="nb-panel-row-label">
                line spacing <em class="nb-panel-row-hint">{lineSpacing()}px</em>
              </span>
              <input
                type="range"
                class="nb-panel-slider"
                min={LINE_SPACING_MIN}
                max={LINE_SPACING_MAX}
                step={1}
                value={lineSpacing()}
                aria-label="Line spacing"
                onInput={(e) =>
                  patchDefaults({ lineHeightPx: Number(e.currentTarget.value) })
                }
              />
            </label>
            <div class="nb-chip-row" role="group" aria-label="Default page style">
              <For each={PAGE_STYLES}>
                {(pageStyle) => (
                  <button
                    type="button"
                    class="nb-chip"
                    aria-pressed={props.pageDefaults?.pageStyle === pageStyle}
                    onClick={() => patchDefaults({ pageStyle })}
                  >
                    {pageStyle}
                  </button>
                )}
              </For>
            </div>
            <div class="nb-chip-row" role="group" aria-label="Ink color">
              <For each={INKS}>
                {(ink) => (
                  <button
                    type="button"
                    class="nb-chip"
                    aria-pressed={props.pageDefaults?.ink === ink.value}
                    onClick={() => patchDefaults({ ink: ink.value })}
                  >
                    {ink.label}
                  </button>
                )}
              </For>
            </div>
            <p class="nb-panel-footnote">
              applies to every page of this book, now and later
            </p>
          </section>
        </div>
      </Show>

      <Show when={tab() === 'library'}>
        <div class="nb-studio-pane" role="tabpanel" aria-label="This library">
          <LibraryStudio />
        </div>
      </Show>
    </div>
  );
}
