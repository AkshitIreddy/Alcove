/**
 * BookView — the opened book as a true two-page spread on the desk.
 *
 * Restructured layout (user QA wave):
 * - The old top toolbar is GONE. A slim left icon rail (BookRail) carries
 *   every book tool; panels (customize / page style / stickers & effects)
 *   slide out from the rail with the settings sheet's GSAP pattern.
 * - The spread fills ~92% of the viewport height and all width freed by the
 *   rail; the title shrinks into a small Caveat plate above the book.
 * - The cover behind the pages is real procedural cover art (art/covers),
 *   seeded from spine_seed and overridable via cover_meta.
 * - Pagination (contract with src/editor/PageEditor): leaves never scroll.
 *   PageEditor measures itself against `pageCapacityPx` and hands overflow
 *   blocks up through `onOverflow`; BookView prepends them to the next page
 *   (creating it if needed), remounts that leaf, and flips forward when the
 *   cursor was carried.
 *
 * Spread state: `spreadIndex` maps to page slots left = 2i, right = 2i + 1
 * (pure math in ./spread.ts). New pages inherit the book's page defaults
 * (cover_meta.pageDefaults) and fall back to settings.pageStyleDefault.
 */
import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { appState } from '../state/app';
import { editorState } from '../editor/state';
import {
  getBook,
  listBooksByFloorRange,
  readCoverOverrides,
  readPageDefaults,
  saveCoverOverrides,
  savePageDefaults,
  type BookPageDefaults,
} from '../data/books';
import { createPage, getPage, listPages, savePageDoc } from '../data/pages';
import { seedIfEmpty } from '../data/seed';
import { settings } from '../data/settings';
import type { Book, Page, PageDoc, PageStyle } from '../data/types';
import {
  coverDataUrl,
  deriveCoverParams,
  normalizeCoverOverrides,
  type CoverOverrides,
} from '../art/covers';
import PageEditor, { type PageEditorProps } from '../editor/PageEditor';
import InsertScriptDialog from '../editor/insert/InsertScriptDialog';
import { activeEditor } from '../editor/insert/activeEditor';
import { docToScript } from '../editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../editor/script/spec';
import FlipSurface, { type FlipSurfaceApi } from '../flip/FlipSurface';
import type { LeafSide } from '../flip/PageFlipController';
import type { FlipDirection } from '../flip/math';
import { play } from '../sound/engine';
import BookRail, { type RailPanelId } from './rail/BookRail';
import RailPanel from './rail/RailPanel';
import CustomizePanel from './rail/CustomizePanel';
import PageStylePanel from './rail/PageStylePanel';
import StickersPanel from './rail/StickersPanel';
import {
  arrowFlipAction,
  canFlipSpread,
  docHasContent,
  leftSlot,
  newPageDoc,
  prependBlocksToDoc,
  shouldAutoCreatePage,
  spreadOfSlot,
  spreadPageIds,
  type SpreadIds,
} from './spread';
import '../styles/editor.css';
import '../styles/insert.css';
import '../styles/spread.css';
import '../styles/rail.css';

interface BookSession {
  readonly book: Book;
  readonly pages: Page[];
}

/**
 * Pagination contract props (docs in the wave brief; PageEditor's side is
 * built by the editor agent). Typed structurally here so BookView compiles
 * and wires the flow even while the editor half lands in parallel — extra
 * props are ignored by Solid components until PageEditor consumes them.
 */
type PaginatedPageEditorProps = PageEditorProps & {
  paginated?: boolean;
  pageCapacityPx?: number;
  onOverflow?(blocks: unknown[], cursorCarried: boolean): void;
};
const PaginatedPageEditor = PageEditor as (
  props: PaginatedPageEditorProps,
) => JSX.Element;

async function loadSession(source: {
  readonly bookId: string | null;
}): Promise<BookSession | null> {
  let book: Book | null = source.bookId ? await getBook(source.bookId) : null;
  if (!book) {
    // WORKAROUND (see src/editor/state.ts): appState has no openBookId yet,
    // so a direct jump to the book view falls back to the first shelved book.
    let shelved = await listBooksByFloorRange(0, 999);
    if (shelved.length === 0) {
      await seedIfEmpty();
      shelved = await listBooksByFloorRange(0, 999);
    }
    book = shelved[0] ?? null;
  }
  if (!book) return null;

  const pages = await listPages(book.id);
  if (pages.length === 0) pages.push(await createPage({ bookId: book.id }));
  return { book, pages };
}

/** Hand-drawn back arrow (pre-wobbled static path — no runtime filters). */
function BackArrowIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 34 20" class="nb-back-arrow" aria-hidden="true">
      <path
        d="M 31.5 10.4 C 24 9.6 14.5 10.5 6.2 10.1 M 12.8 3.4 C 10.4 5.8 7.6 8.2 4.1 10.2 C 7.4 12 10.2 14.4 12.4 16.9"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** True when arrow keys should keep moving the caret, not the page. */
function isTypingTarget(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.closest('.nb-prose') !== null ||
    element.isContentEditable ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  );
}

const sameSpreadIds = (a: SpreadIds, b: SpreadIds): boolean =>
  a.left === b.left &&
  a.right === b.right &&
  a.nextLeft === b.nextLeft &&
  a.nextRight === b.nextRight &&
  a.prevLeft === b.prevLeft &&
  a.prevRight === b.prevRight;

export default function BookView(): JSX.Element {
  // Source is an object so a null bookId still triggers the fetcher
  // (createResource skips falsy sources).
  const [session] = createResource(
    () => ({ bookId: editorState.openBookId() }),
    loadSession,
  );

  // -------------------------------------------------------------------------
  // Spread state
  // -------------------------------------------------------------------------
  const [pages, setPages] = createSignal<Page[]>([]);
  const [spreadIndex, setSpreadIndex] = createSignal(0);
  const [focusedSide, setFocusedSide] = createSignal<LeafSide>('left');

  // ---------------------------------------------------------------------------
  // Per-book customization state (cover_meta), hydrated with the session.
  // ---------------------------------------------------------------------------
  const [coverOverrides, setCoverOverrides] = createSignal<CoverOverrides | null>(
    null,
  );
  const [pageDefaults, setPageDefaults] = createSignal<BookPageDefaults | null>(
    null,
  );

  createEffect(
    on(session, (loaded) => {
      if (loaded) {
        setPages(loaded.pages);
        setSpreadIndex(0);
        setCoverOverrides(normalizeCoverOverrides(readCoverOverrides(loaded.book)));
        setPageDefaults(readPageDefaults(loaded.book));
      }
    }),
  );

  const bookPageStyle = (): PageStyle =>
    pageDefaults()?.pageStyle ?? settings.pageStyleDefault;
  const bookLineHeight = (): number | undefined => pageDefaults()?.lineHeightPx;

  const pageAt = (slot: number): Page | null => pages()[slot] ?? null;
  const leftPage = createMemo(() => pageAt(leftSlot(spreadIndex())));
  const rightPage = createMemo(() => pageAt(leftSlot(spreadIndex()) + 1));

  const ids = createMemo(
    () =>
      spreadPageIds(
        pages().map((page) => page.id),
        spreadIndex(),
      ),
    undefined,
    { equals: sameSpreadIds },
  );

  /** Keep the in-memory doc current so leaf remounts never load stale JSON. */
  const updatePageDoc = (pageId: string, doc: PageDoc): void => {
    setPages((prev) =>
      prev.map((page) => (page.id === pageId ? { ...page, doc } : page)),
    );
  };

  // External doc rewrites (overflow carries, page-default sweeps) bump a
  // per-page version; leaves key on id@version so the mounted editor remounts
  // with the fresh doc (PageEditor reads props once at mount).
  const [docVersions, setDocVersions] = createSignal<Record<string, number>>({});
  const bumpDocVersion = (pageId: string): void => {
    setDocVersions((prev) => ({ ...prev, [pageId]: (prev[pageId] ?? 0) + 1 }));
  };

  const rightHasContent = (): boolean => docHasContent(rightPage()?.doc);

  const canFlip = (direction: FlipDirection): boolean =>
    canFlipSpread(pages().length, spreadIndex(), direction, rightHasContent());

  // -------------------------------------------------------------------------
  // Page creation ("+ page" rail tool + auto-create on forward flip)
  // -------------------------------------------------------------------------
  const appendPage = async (): Promise<Page | null> => {
    const loaded = session();
    if (!loaded) return null;
    const created = await createPage({
      bookId: loaded.book.id,
      doc: newPageDoc(bookPageStyle(), bookLineHeight()),
    });
    setPages((prev) => [...prev, created]);
    return created;
  };

  let flipApi: FlipSurfaceApi | undefined;

  const addPage = async (): Promise<void> => {
    const slotOfNew = pages().length;
    const created = await appendPage();
    if (!created) return;
    void play('pop-soft');
    const target = spreadOfSlot(slotOfNew);
    if (target === spreadIndex() + 1) {
      flipApi?.flipNext(); // one spread ahead — arrive with the flip animation
    } else if (target !== spreadIndex()) {
      setSpreadIndex(target);
    }
    // target === current spread: the new page simply appears on the right leaf.
  };

  /** Contract rule 3: synchronous store work only — no awaits in here. */
  const onNavigate = (direction: FlipDirection): void => {
    if (
      shouldAutoCreatePage(
        pages().length,
        spreadIndex(),
        direction,
        rightHasContent(),
      )
    ) {
      // Fire-and-forget: the new spread shows cream blank faces for the few
      // ms until the row lands, then the keyed leaf mounts the editor.
      void appendPage();
    }
    setSpreadIndex((index) =>
      Math.max(0, index + (direction === 'next' ? 1 : -1)),
    );
  };

  // -------------------------------------------------------------------------
  // Pagination — capacity measurement + overflow carry (see module docblock)
  // -------------------------------------------------------------------------
  const [pageCapacity, setPageCapacity] = createSignal(0);

  const measureCapacity = (paper: HTMLElement): void => {
    const styles = getComputedStyle(paper);
    const capacity =
      paper.clientHeight -
      (Number.parseFloat(styles.paddingTop) || 0) -
      (Number.parseFloat(styles.paddingBottom) || 0);
    if (capacity > 120) setPageCapacity(Math.floor(capacity));
  };

  const capacityObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target instanceof HTMLElement) {
              measureCapacity(entry.target);
            }
          }
        })
      : null;
  onCleanup(() => capacityObserver?.disconnect());

  /** Serialize carries: bursts of overflow land one at a time, in order. */
  let carryChain: Promise<void> = Promise.resolve();

  /**
   * ProseMirror's scrollIntoView scrolls the prose root mid-drain (while the
   * pasted/typed content still overflows); once the trailing blocks have been
   * carried off, that stale scrollTop leaves the page visually cropped even
   * though the content now fits. Leaves never scroll — pin everything to 0.
   */
  const resetLeafScroll = (side: LeafSide): void => {
    const paper = paperElements[side];
    if (!paper) return;
    const targets: HTMLElement[] = [
      paper,
      ...Array.from(
        paper.querySelectorAll<HTMLElement>('.nb-page, .nb-page-editor, .nb-prose'),
      ),
    ];
    for (const el of targets) {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    }
  };

  const focusLeafStart = (side: LeafSide): void => {
    // Double rAF: wait out the keyed remount + first paint, then drop the
    // caret at the start of the carried content.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const prose =
          paperElements[side]?.querySelector<HTMLElement>('.nb-prose');
        if (!prose) return;
        prose.focus();
        const editor = activeEditor();
        editor?.commands.focus('start');
      });
    });
  };

  const carryOverflow = async (
    pageId: string,
    blocks: unknown[],
    cursorCarried: boolean,
  ): Promise<void> => {
    const slot = pages().findIndex((page) => page.id === pageId);
    if (slot < 0) return;

    let next: Page | null = pages()[slot + 1] ?? null;
    if (!next) {
      next = await appendPage();
      if (!next) return;
    }

    const fallbackAttrs: Record<string, unknown> = { pageStyle: bookPageStyle() };
    const line = bookLineHeight();
    if (line !== undefined) fallbackAttrs.lineHeightPx = line;

    const merged = prependBlocksToDoc(next.doc, blocks, fallbackAttrs);
    updatePageDoc(next.id, merged);
    bumpDocVersion(next.id); // remounts the leaf when it is on this spread
    await savePageDoc(next.id, merged);

    // Clear any stale mid-drain scroll on both leaves (before + after the
    // browser settles layout — rAF covers late scrollIntoView calls).
    resetLeafScroll('left');
    resetLeafScroll('right');
    requestAnimationFrame(() => {
      resetLeafScroll('left');
      resetLeafScroll('right');
    });

    if (cursorCarried) {
      const targetSpread = spreadOfSlot(slot + 1);
      if (targetSpread === spreadIndex()) {
        // Left leaf spilled into the right leaf of the same spread.
        focusLeafStart('right');
      } else {
        flipApi?.flipNext();
        focusLeafStart('left');
      }
    }
  };

  const handleOverflow = (
    pageId: string,
    blocks: unknown[],
    cursorCarried: boolean,
  ): void => {
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    carryChain = carryChain.then(() =>
      carryOverflow(pageId, blocks, cursorCarried).catch(() => undefined),
    );
  };

  // -------------------------------------------------------------------------
  // Customization persistence + application
  // -------------------------------------------------------------------------
  const changeCoverOverrides = (next: CoverOverrides | null): void => {
    setCoverOverrides(next);
    const loaded = session();
    if (loaded) {
      void saveCoverOverrides(
        loaded.book.id,
        next as Record<string, unknown> | null,
      );
    }
  };

  /** Debounced sweep: stamp the book's page defaults into every page doc. */
  let defaultsTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (defaultsTimer !== undefined) clearTimeout(defaultsTimer);
  });

  const applyDefaultsToPages = (defaults: BookPageDefaults): void => {
    const style = defaults.pageStyle;
    const line = defaults.lineHeightPx;
    if (style === undefined && line === undefined) return;
    setPages((prev) =>
      prev.map((page) => {
        const attrs: Record<string, unknown> = { ...(page.doc.attrs ?? {}) };
        if (style !== undefined) attrs.pageStyle = style;
        if (line !== undefined) attrs.lineHeightPx = line;
        return { ...page, doc: { ...page.doc, attrs } };
      }),
    );
    for (const page of pages()) {
      void savePageDoc(page.id, page.doc);
      bumpDocVersion(page.id);
    }
  };

  const changePageDefaults = (next: BookPageDefaults | null): void => {
    setPageDefaults(next);
    const loaded = session();
    if (loaded) void savePageDefaults(loaded.book.id, next);
    if (defaultsTimer !== undefined) clearTimeout(defaultsTimer);
    if (next) {
      defaultsTimer = setTimeout(() => applyDefaultsToPages(next), 350);
    }
  };

  // -------------------------------------------------------------------------
  // Keyboard: ←/→ flip through the FlipSurface api unless the user is typing.
  // -------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || insertOpen()) return;
    const action = arrowFlipAction(
      event.key,
      isTypingTarget(document.activeElement),
    );
    if (action === null) return;
    event.preventDefault();
    if (action === 'next') flipApi?.flipNext();
    else flipApi?.flipPrev();
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  // -------------------------------------------------------------------------
  // Rail actions (script tools moved off the old top toolbar)
  // -------------------------------------------------------------------------
  const [activePanel, setActivePanel] = createSignal<RailPanelId | null>(null);
  const [insertOpen, setInsertOpen] = createSignal(false);
  const [toast, setToast] = createSignal<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = (message: string): void => {
    setToast(message);
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), 2600);
  };
  onCleanup(() => {
    if (toastTimer !== undefined) clearTimeout(toastTimer);
  });

  /** The page script actions target: the focused leaf, else whichever exists. */
  const activePage = createMemo((): Page | null =>
    focusedSide() === 'right'
      ? (rightPage() ?? leftPage())
      : (leftPage() ?? rightPage()),
  );

  const copyText = async (text: string, doneMessage: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      notify(doneMessage);
    } catch {
      notify('could not reach the clipboard');
    }
  };

  /**
   * Export Script (design doc §3): the stored verbatim source while the page
   * is unedited since insert, else the canonical printer over the live doc.
   */
  const exportScript = async (pageId: string): Promise<void> => {
    const page = await getPage(pageId);
    if (page !== null && page.scriptSource !== null && !page.sourceDirty) {
      await copyText(page.scriptSource, 'script copied (original paste)');
      return;
    }
    const editor = activeEditor();
    const doc = editor !== null ? (editor.getJSON() as PageDoc) : page?.doc;
    if (doc === undefined) {
      notify('nothing to export yet');
      return;
    }
    await copyText(docToScript(doc), 'script copied to clipboard');
  };

  // -------------------------------------------------------------------------
  // Leaves — the contract's per-side page JSX. The .nb-sheet-paper is stable
  // (getPageElement target + snapshot root); only the editor inside is keyed
  // by page id + external doc version, so edits never remount and spread
  // changes / overflow carries always do.
  // -------------------------------------------------------------------------
  const paperElements: Partial<Record<LeafSide, HTMLDivElement>> = {};

  const leafKey = (page: Page | null): string | null =>
    page ? `${page.id}@${docVersions()[page.id] ?? 0}` : null;

  const leafFace = (side: LeafSide, page: () => Page | null): JSX.Element => (
    <div
      class="nb-sheet-paper nb-leaf-paper"
      data-side={side}
      ref={(el) => {
        paperElements[side] = el;
        capacityObserver?.observe(el);
        queueMicrotask(() => measureCapacity(el));
      }}
      onFocusIn={() => setFocusedSide(side)}
    >
      <Show when={leafKey(page())} keyed>
        {(_key: string) => {
          const current = page();
          return current ? (
            <PaginatedPageEditor
              pageId={current.id}
              initialDoc={current.doc}
              onDocChange={(doc) => updatePageDoc(current.id, doc)}
              paginated
              pageCapacityPx={pageCapacity()}
              onOverflow={(blocks, cursorCarried) =>
                handleOverflow(current.id, blocks, cursorCarried)
              }
            />
          ) : null;
        }}
      </Show>
    </div>
  );

  return (
    <main class="nb-book-view">
      <button
        type="button"
        class="nb-back-button font-accent"
        onClick={() => appState.closeBook()}
      >
        <BackArrowIcon />
        <span>back to shelf</span>
      </button>

      <BookRail
        activePanel={activePanel()}
        onTogglePanel={(panel) =>
          setActivePanel((current) => (current === panel ? null : panel))
        }
        onInsertScript={() => setInsertOpen(true)}
        onExportScript={() => {
          const page = activePage();
          if (page) void exportScript(page.id);
        }}
        onCopySpec={() =>
          void copyText(
            NOTEBOOK_SCRIPT_SPEC,
            'spec copied — paste it to your AI',
          )
        }
        onAddPage={() => void addPage()}
      />

      <Show
        when={session()}
        fallback={
          <div class="nb-book-empty">
            <Show
              when={session.loading}
              fallback={
                <p class="font-label">
                  no books on the shelf yet — the bookshelf will grow soon
                </p>
              }
            >
              <p class="font-label">opening the book…</p>
            </Show>
          </div>
        }
        keyed
      >
        {(loaded) => {
          const backdropUrl = createMemo(() =>
            coverDataUrl(
              720,
              500,
              deriveCoverParams(loaded.book.spineSeed, coverOverrides()),
              '',
              { plate: false },
            ),
          );
          return (
            <div
              class="nb-spread-stage"
              data-spread-index={spreadIndex()}
              data-book-ink={pageDefaults()?.ink ?? 'inherit'}
            >
              <header class="nb-spread-header">
                <h1 class="nb-book-title-plate">{loaded.book.title}</h1>
              </header>

              <div
                class="nb-book-cover"
                style={{ 'background-image': `url("${backdropUrl()}")` }}
              >
                <div class="nb-spread">
                  <FlipSurface
                    ref={(api) => (flipApi = api)}
                    spreadIndex={spreadIndex()}
                    pageIds={ids()}
                    getPageElement={(side) => paperElements[side] ?? null}
                    onNavigate={onNavigate}
                    canFlip={canFlip}
                    leftPage={leafFace('left', leftPage)}
                    rightPage={leafFace('right', rightPage)}
                  />
                  <div class="nb-spread-gutter" aria-hidden="true" />
                  <Show when={canFlip('next')}>
                    <div class="nb-page-curl" aria-hidden="true" />
                  </Show>
                </div>
              </div>

              <RailPanel
                open={activePanel() === 'customize'}
                title="Customize this book"
                onClose={() => setActivePanel(null)}
              >
                <CustomizePanel
                  spineSeed={loaded.book.spineSeed}
                  title={loaded.book.title}
                  overrides={coverOverrides()}
                  onOverridesChange={changeCoverOverrides}
                  pageDefaults={pageDefaults()}
                  onPageDefaultsChange={changePageDefaults}
                />
              </RailPanel>

              <RailPanel
                open={activePanel() === 'page-style'}
                title="Page style"
                onClose={() => setActivePanel(null)}
              >
                <PageStylePanel open={activePanel() === 'page-style'} />
              </RailPanel>

              <RailPanel
                open={activePanel() === 'stickers'}
                title="Stickers & effects"
                onClose={() => setActivePanel(null)}
              >
                <StickersPanel />
              </RailPanel>

              <Show when={insertOpen() ? activePage()?.id : null} keyed>
                {(pageId) => (
                  <InsertScriptDialog
                    pageId={pageId}
                    onClose={() => setInsertOpen(false)}
                    onNotify={notify}
                  />
                )}
              </Show>
            </div>
          );
        }}
      </Show>

      <Show when={toast()} keyed>
        {(message) => <div class="nb-script-toast">{message}</div>}
      </Show>
    </main>
  );
}
