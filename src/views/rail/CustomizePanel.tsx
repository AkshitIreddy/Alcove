/**
 * src/views/rail/CustomizePanel.tsx — the Book Studio (library-themes.md §4).
 *
 * Two tabs behind the rail's Customize brush:
 *  1. **this book** — the full spine + cover vocabulary with a live preview
 *     that flips between the two faces (BookStudio.tsx).
 *  2. **this library** — the room: theme, wall finish, wallpaper pattern x
 *     colourway, flora density, lamp warmth (LibraryStudio.tsx).
 *  3. **your own** — work the reader brought in themselves: papers, cases,
 *     stickers and sounds, each with instructions and a generated AI prompt
 *     (features/packs/PacksPanel.tsx).
 * Page defaults (line spacing / page style / ink) stay on the book tab, since
 * they are also "about this book".
 *
 * The third tab is a LIBRARY, not the only way in. A reader's papers also
 * stand in the wallpaper row of tab 2, where papers are actually chosen — a
 * vocabulary reachable from one panel nobody opens is the shape of failure
 * this repo already has a test for (tests/roll-gates.test.ts).
 *
 * Persistence:
 *  - library choices go through `features/bookshelf/libraryPrefs` (the Pixi
 *    world subscribes to it, so the shelf redresses itself instantly);
 *  - book style and its cover-facing compatibility projection commit through
 *    one ordered appearance lane when `bookId` is supplied, while the same
 *    projection goes out through `onOverridesChange` so the open book, the
 *    pull-out ghost and the shelf spine all agree.
 */
import { For, Show, createEffect, createSignal, on, type JSX } from 'solid-js';
import type { BookStyleOverrides } from '../../art/bookStyle';
import { normalizeBookStyleOverrides } from '../../art/bookStyle';
import type { BookPresetId } from '../../art/bookDesign';
import type { CoverOverrides } from '../../art/covers';
import type { BookStyle } from '../../art/bookStyle';
import {
  normalizeBookSurpriseLocks,
  type BookSurpriseLockSet,
} from '../../art/bookSurprise';
import type { BookPageDefaults } from '../../data/books';
import { getBook } from '../../data/books';
import {
  bookStyleOverridesFor,
  createBookAppearanceHydrationGuard,
  createOrderedBookAppearanceWriter,
  persistBookStyle,
} from '../../features/bookshelf/bookIdentity';
import { saveBookBinding } from '../../data/designPrefs';
import {
  bookSurpriseLocksFor,
  saveBookSurpriseLocks,
} from '../../features/bookshelf/bookStudioPrefs';
import {
  RULING_ORDER,
  RULING_SHORTLIST,
  type RulingRow,
} from '../../editor/rulings';
import {
  DEFAULT_LINE_HEIGHT_PX,
  LINE_HEIGHT_MAX_PX,
  LINE_HEIGHT_MIN_PX,
} from '../../editor/document';
import BookStudio, { coverOverridesFromStyle } from './BookStudio';
import LibraryStudio from './LibraryStudio';
import PacksPanel from '../../features/packs/PacksPanel';

const INKS = [
  { value: 'sepia', label: 'sepia' },
  { value: 'graphite', label: 'graphite' },
  { value: 'ink-blue', label: 'ink blue' },
] as const;

/*
 * The slider's bounds and its resting value are the editor's, not this
 * panel's: the rail's page-style panel offers the same control over the same
 * document attribute, and both had their own copies of all three numbers.
 * Kept exported under the old names, which were this module's surface before
 * they were single-sourced.
 */
export const LINE_SPACING_MIN = LINE_HEIGHT_MIN_PX;
export const LINE_SPACING_MAX = LINE_HEIGHT_MAX_PX;

type StudioTab = 'book' | 'library' | 'own';

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
  /** Compatibility-aware style from a host that already loaded the Book row. */
  initialBookStyle?: Record<string, unknown> | null;
  /** Surprise locks from the same already-loaded Book row. */
  initialSurpriseLocks?: BookSurpriseLockSet;
  /** Page count, for the default spine thickness. */
  pageCount?: number;
  /**
   * Which tab opens first. The rail (inside a book) starts on the book;
   * the shelf's own studio button starts on the room.
   */
  initialTab?: StudioTab;
  /** Whether the owning rail panel is visibly open (its children stay mounted after close). */
  open?: boolean;
  /** Positions the Book Studio's companion preview beside the correct panel chrome. */
  host?: 'book' | 'shelf';
}

export default function CustomizePanel(props: CustomizePanelProps): JSX.Element {
  const [tab, setTab] = createSignal<StudioTab>(props.initialTab ?? 'book');
  const [style, setStyle] = createSignal<Record<string, unknown> | null>(
    props.initialBookStyle ?? null,
  );
  const [surpriseLocks, setSurpriseLocks] = createSignal<BookSurpriseLockSet>(
    normalizeBookSurpriseLocks(props.initialSurpriseLocks),
  );
  const hydration = createBookAppearanceHydrationGuard();
  /*
   * One lane for BOTH halves of a book appearance. A Surprise press changes
   * designPrefs (the binding) and cover_meta (the style); serialising only the
   * latter still allows two rapid presses to persist a binding from one beside
   * the colours and proportions from the other.
   */
  const writeAppearance = createOrderedBookAppearanceWriter({
    saveBinding: (bookId, binding) => saveBookBinding(bookId, binding),
    saveStyle: (write) =>
      persistBookStyle(write.bookId, write.style, {
        binding: write.projectionBinding,
        bindingPinned: write.bindingPinned,
        materialPinned: write.materialPinned,
        seed: props.spineSeed,
        titlePlatePinned: write.titlePlatePinned,
      }),
  });

  // Hydrate whenever the book changes. Both app hosts already own the loaded
  // Book row and supply its compatibility-aware floor, avoiding a second read
  // entirely. The fallback remains for isolated/specimen callers; its ticket
  // cannot overwrite a local edit or a later book.
  createEffect(
    on(
      () => props.bookId,
      (id) => {
        const ticket = hydration.begin(id);
        if (id === undefined) {
          setStyle(null);
          setSurpriseLocks(normalizeBookSurpriseLocks(props.initialSurpriseLocks));
          return;
        }
        if (props.initialBookStyle !== undefined) {
          if (hydration.accepts(ticket)) {
            setStyle(props.initialBookStyle);
            setSurpriseLocks(normalizeBookSurpriseLocks(props.initialSurpriseLocks));
          }
          return;
        }
        void getBook(id)
          .then((book) => {
            if (hydration.accepts(ticket)) {
              setStyle(book === null ? null : bookStyleOverridesFor(book));
              setSurpriseLocks(bookSurpriseLocksFor(book));
            }
          })
          .catch(() => undefined);
      },
    ),
  );

  const reflectStyle = (
    next: BookStyleOverrides | null,
    projectionBinding?: BookPresetId | null,
  ): BookStyle | null => {
    const blob = (next as Record<string, unknown> | null) ?? null;
    hydration.invalidate();
    setStyle(blob);
    const normalized = normalizeBookStyleOverrides(blob);
    // The cover art reads cover_meta.cover — keep it in step so the open book
    // and the pull-out ghost show what the studio previewed.
    // A binding-only choice can legitimately leave the style blob empty. It
    // still has an exact covering that the already-open book must show now;
    // passing null here would redraw the seed's cover until the next reopen.
    props.onOverridesChange(
      normalized === null
        ? projectionBinding === undefined || projectionBinding === null
          ? null
          : coverOverridesFromStyle({}, projectionBinding, props.spineSeed)
        : coverOverridesFromStyle(
            normalized as Parameters<typeof coverOverridesFromStyle>[0],
            projectionBinding,
            props.spineSeed,
          ),
    );
    return (normalized as BookStyle | null) ?? null;
  };

  const changeStyle = (
    next: BookStyleOverrides | null,
    projectionBinding?: BookPresetId | null,
    bindingPinned?: boolean,
  ): void => {
    const persisted = reflectStyle(next, projectionBinding);
    if (props.bookId !== undefined) {
      void writeAppearance({
        bookId: props.bookId,
        style: persisted,
        projectionBinding,
        bindingPinned,
        materialPinned:
          persisted !== null && Object.prototype.hasOwnProperty.call(persisted, 'material'),
        titlePlatePinned:
          persisted !== null && Object.prototype.hasOwnProperty.call(persisted, 'titlePlate'),
      }).catch(() => undefined);
    }
  };

  const changeAppearance = (
    next: BookStyleOverrides | null,
    binding: BookPresetId | null,
    projectionBinding: BookPresetId,
  ): void => {
    const persisted = reflectStyle(next, projectionBinding);
    if (props.bookId === undefined) return;
    void writeAppearance({
      bookId: props.bookId,
      style: persisted,
      binding,
      projectionBinding,
      bindingPinned: binding !== null,
      materialPinned:
        persisted !== null && Object.prototype.hasOwnProperty.call(persisted, 'material'),
      titlePlatePinned:
        persisted !== null && Object.prototype.hasOwnProperty.call(persisted, 'titlePlate'),
    }).catch(() => undefined);
  };

  const changeSurpriseLocks = (next: BookSurpriseLockSet): void => {
    const normalized = normalizeBookSurpriseLocks(next);
    setSurpriseLocks(normalized);
    if (props.bookId !== undefined) {
      void saveBookSurpriseLocks(props.bookId, normalized).catch(() => undefined);
    }
  };

  const patchDefaults = (partial: BookPageDefaults): void => {
    props.onPageDefaultsChange({ ...(props.pageDefaults ?? {}), ...partial });
  };

  /**
   * The rulings this row offers: the signature tier, plus whatever the reader
   * has actually chosen if it is not one of them.
   *
   * Without the second half, a reader who picks `isometric` in the page-style
   * panel comes back here to a row with nothing pressed, which reads as the
   * panel having forgotten.
   */
  const defaultStyleChoices = (): readonly RulingRow[] => {
    const short = RULING_ORDER.slice(0, RULING_SHORTLIST);
    const chosen = props.pageDefaults?.pageStyle;
    if (chosen === undefined || short.some((r) => r.id === chosen)) return short;
    const extra = RULING_ORDER.find((r) => r.id === chosen);
    return extra === undefined ? short : [...short, extra];
  };

  const lineSpacing = (): number =>
    props.pageDefaults?.lineHeightPx ?? DEFAULT_LINE_HEIGHT_PX;

  return (
    <div class="nb-customize nb-studio">
      <div class="nb-studio-tabs" role="tablist" aria-label="Studio">
        <button
          type="button"
          class="nb-studio-tab"
          role="tab"
          aria-selected={tab() === 'book'}
          classList={{ 'is-active': tab() === 'book' }}
          data-studio-tab="book"
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
          data-studio-tab="library"
          onClick={() => setTab('library')}
        >
          this library
        </button>
        <button
          type="button"
          class="nb-studio-tab"
          role="tab"
          aria-selected={tab() === 'own'}
          classList={{ 'is-active': tab() === 'own' }}
          data-studio-tab="own"
          onClick={() => setTab('own')}
        >
          your own
        </button>
      </div>

      <Show when={tab() === 'book'}>
        <div class="nb-studio-pane" role="tabpanel" aria-label="This book">
          <BookStudio
            spineSeed={props.spineSeed}
            title={props.title}
            style={style()}
            onStyleChange={changeStyle}
            onAppearanceChange={changeAppearance}
            surpriseLocks={surpriseLocks()}
            onSurpriseLocksChange={changeSurpriseLocks}
            pageCount={props.pageCount}
            // The binding is keyed by book id, and without this the studio
            // falls back to `seed:<spineSeed>` — stable, but a different key
            // from the one the shelf's spine factory reads, so a pinned
            // binding would show in the panel and nowhere else.
            bookId={props.bookId}
            open={props.open}
            host={props.host}
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
            {/*
              The ruling vocabulary went from 4 ids to 27, and this row printed
              the RAW ID of every one of them — so "fine-quadrille" and
              "manuscript-guide" appeared as chips, twenty-seven across, in a
              panel that has room for six. The ids were readable enough as words
              while there were four of them and stopped being the moment there
              were not.

              `RULING_ORDER` carries the drawn name and the tier, so this shows
              the signature tier by name and the reader's own choice if it is
              not among them — the same shortlist-plus-current pattern the
              settings pickers use. The full set lives in the page-style panel,
              which is the picker built for it; this row only sets the DEFAULT
              for new pages and does not need to be a second copy of it.
            */}
            <div class="nb-chip-row" role="group" aria-label="Default page style">
              <For each={defaultStyleChoices()}>
                {(ruling) => (
                  <button
                    type="button"
                    class="nb-chip"
                    aria-pressed={props.pageDefaults?.pageStyle === ruling.id}
                    onClick={() => patchDefaults({ pageStyle: ruling.id })}
                  >
                    {ruling.name}
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

      <Show when={tab() === 'own'}>
        <div class="nb-studio-pane" role="tabpanel" aria-label="Your own">
          <PacksPanel />
        </div>
      </Show>
    </div>
  );
}
