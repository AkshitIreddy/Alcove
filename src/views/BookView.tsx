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
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from 'solid-js';
import { appState } from '../state/app';
import { editorState } from '../editor/state';
import {
  getBook,
  listBooksByFloorRange,
  readCoverOverrides,
  readPageDefaults,
  savePageDefaults,
  type BookPageDefaults,
} from '../data/books';
import { createPage, getPage, listPages, savePageDoc } from '../data/pages';
import { seedIfEmpty } from '../data/seed';
import { save as saveSettings, settings } from '../data/settings';
import { matchesBinding } from '../data/keybindings';
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
import {
  recordSnapshot,
  type PageSnapshot,
} from '../editor/history/pageHistory';
import { getPageEditor } from '../editor/instances';
import { clearJournalJump, pendingJournalJump } from '../editor/journal';
import { notifySaved } from '../editor/saveIndicator';
import { docToScript } from '../editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../editor/script/spec';
import { countBook, countDoc } from '../editor/wordcount';
import FlipSurface, { type FlipSurfaceApi } from '../flip/FlipSurface';
import type { LeafSide } from '../flip/PageFlipController';
import type { FlipDirection } from '../flip/math';
import { play } from '../sound/engine';
import { LINGER_MS } from '../styles/motion';
import { useSearchJump } from '../search/jump';
import QuickSwitcher from '../features/quickswitch/QuickSwitcher';
import BookRail, { type RailPanelId } from './rail/BookRail';
import RailPanel from './rail/RailPanel';
import CustomizePanel from './rail/CustomizePanel';
import HistoryPanel from './rail/HistoryPanel';
import PageStylePanel from './rail/PageStylePanel';
import CataloguePanel from './rail/CataloguePanel';
import TocPanel from './rail/TocPanel';
import CheatSheet from './CheatSheet';
import ThumbStrip from './ThumbStrip';
import {
  readBookmarks,
  saveBookmarks,
  toggleBookmark,
  type Bookmark,
} from './bookmarks';
import {
  arrowFlipAction,
  canFlipSpread,
  docHasContent,
  leftSlot,
  newPageDoc,
  pagesToCreateOnFlip,
  prependBlocksToDoc,
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
  onOverflow?(
    blocks: unknown[],
    cursorCarried: boolean,
    caretOffset?: number | null,
  ): void;
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

/** Hand-drawn cross for the focus-mode exit chip (static wobbled path). */
function CloseStrokeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 18 18" class="nb-focus-exit-glyph" aria-hidden="true">
      <path
        d="M 4.2 4.6 C 7.1 7.4 10.4 10.6 13.6 13.5 M 13.7 4.4 C 10.6 7.5 7.4 10.5 4.3 13.6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
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

  /**
   * Empty pages at the very end of the book. This is the allowance that lets
   * a reader deliberately skip a page (see MAX_TRAILING_BLANK_PAGES) while
   * still stopping a held key from appending without bound.
   */
  const trailingBlanks = (): number => {
    const all = pages();
    let n = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      if (docHasContent(all[i]?.doc)) break;
      n++;
    }
    return n;
  };

  const canFlip = (direction: FlipDirection): boolean =>
    canFlipSpread(
      pages().length,
      spreadIndex(),
      direction,
      rightHasContent(),
      trailingBlanks(),
    );

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
    const toCreate = pagesToCreateOnFlip(
      pages().length,
      spreadIndex(),
      direction,
      rightHasContent(),
      trailingBlanks(),
    );
    if (toCreate > 0) {
      // Fire-and-forget: the new spread shows cream blank faces for the few
      // ms until the rows land, then the keyed leaves mount their editors.
      // SEQUENCED, not Promise.all: createPage derives its ord from the store,
      // so two in flight at once would both claim the same slot.
      void (async () => {
        for (let i = 0; i < toCreate; i += 1) await appendPage();
      })();
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

  /**
   * Caret carry (roadmap first-duty fix): drop the caret inside the carried
   * content of the target page's editor. The leaf remounts (keyed on
   * id@version), so the instance may not exist for a frame or two — poll
   * across rAF until the registry hands back a live, connected editor.
   *
   * `offset` is the caret's PM token offset within the carried blocks;
   * since carries PREPEND to the target doc, the same offset addresses the
   * caret's spot in the new doc (clamped defensively).
   */
  const focusCarriedCaret = (pageId: string, offset: number | null): void => {
    const deadline = performance.now() + 6000;
    const attempt = (): void => {
      const instance = getPageEditor(pageId);
      if (instance && instance.view.dom.isConnected) {
        const size = instance.state.doc.content.size;
        const pos = Math.max(0, Math.min(offset ?? 0, size));
        instance.chain().focus(pos, { scrollIntoView: false }).run();
        return;
      }
      if (performance.now() < deadline) requestAnimationFrame(attempt);
    };
    attempt();
  };

  const carryOverflow = async (
    pageId: string,
    blocks: unknown[],
    cursorCarried: boolean,
    caretOffset: number | null,
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
    // When the carry target is on the NEXT spread it never remounts here,
    // so the mutation observer never fires — mark the flip snapshots stale
    // explicitly or the back/revealed faces show the pre-carry page.
    flipApi?.invalidateSnapshots();

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
      if (targetSpread !== spreadIndex()) {
        // Jump the spread SYNCHRONOUSLY instead of the animated flip: the
        // flip blurs the editor for ~450ms and every keystroke typed during
        // it would be silently lost (the original caret-carry bug). The new
        // leaves mount in this same task, so focus can chase immediately.
        setSpreadIndex(targetSpread);
        void play('page-flip');
      }
      focusCarriedCaret(next.id, caretOffset);
    }
  };

  const handleOverflow = (
    pageId: string,
    blocks: unknown[],
    cursorCarried: boolean,
    caretOffset: number | null,
  ): void => {
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    carryChain = carryChain.then(() =>
      carryOverflow(pageId, blocks, cursorCarried, caretOffset).catch(
        () => undefined,
      ),
    );
  };

  // -------------------------------------------------------------------------
  // Customization persistence + application
  // -------------------------------------------------------------------------
  const changeCoverOverrides = (next: CoverOverrides | null): void => {
    setCoverOverrides(next);
    // Persistence is owned by CustomizePanel's persistBookStyle (it writes
    // cover_meta.style AND this cover projection together). Saving here too
    // raced that writer with a stale projection — last finisher won.
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
  // Focus mode (roadmap #12) + keyboard cheat-sheet (roadmap #14)
  // -------------------------------------------------------------------------
  const [focusMode, setFocusMode] = createSignal(false);
  const [cheatOpen, setCheatOpen] = createSignal(false);
  const [activePanel, setActivePanel] = createSignal<RailPanelId | null>(null);

  /**
   * Entering focus mode CLOSES whatever the rail had open. A rail panel is a
   * sheet that also pushes the spread sideways to make room for itself, and
   * focus mode hides the rail — so entering with the Customize panel open
   * left a wall of controls floating beside a book shoved off the right edge,
   * with no rail icon left to close it with.
   */
  const setFocus = (on: boolean): void => {
    if (on) setActivePanel(null);
    setFocusMode(on);
  };
  const toggleFocus = (): void => setFocus(!focusMode());

  // -------------------------------------------------------------------------
  // Keyboard: ←/→ flip through the FlipSurface api unless the user is typing;
  // F9 toggles focus mode, '?' opens the cheat-sheet when not typing.
  // -------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent): void => {
    // Leaving focus mode is checked BEFORE the defaultPrevented guard: the
    // caret normally sits in a page while writing, and ProseMirror consumes
    // Escape there, which left the only keyboard exit dead unless the user
    // first clicked blank paper to blur the editor. Panels still own their
    // own Escape, so a panel closes first (RailPanel's listener).
    if (
      event.key === 'Escape' &&
      focusMode() &&
      !insertOpen() &&
      activePanel() === null
    ) {
      event.preventDefault();
      setFocus(false);
      return;
    }
    if (event.defaultPrevented || insertOpen()) return;

    if (event.key === 'F9') {
      event.preventDefault();
      toggleFocus();
      return;
    }

    // The script tools live in the rail; these are the combos the settings
    // sheet advertises for them, read from settings so the list stays true.
    const keys = settings.keybindings;
    if (matchesBinding(event, keys['insert-script'] ?? 'mod+alt+i')) {
      event.preventDefault();
      setInsertOpen(true);
      return;
    }
    if (matchesBinding(event, keys['export-script'] ?? 'mod+alt+e')) {
      event.preventDefault();
      const page = activePage();
      if (page) void exportScript(page.id);
      return;
    }
    if (cheatOpen() && (event.key === 'Escape' || event.key === '?')) {
      event.preventDefault();
      setCheatOpen(false);
      return;
    }
    if (event.key === '?' && !isTypingTarget(document.activeElement)) {
      event.preventDefault();
      setCheatOpen(true);
      return;
    }
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
  const [insertOpen, setInsertOpen] = createSignal(false);
  /** Toasts carry a tone so a failure never reads like a success. */
  const [toast, setToast] = createSignal<{
    message: string;
    tone: 'ok' | 'error';
  } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = (message: string, tone: 'ok' | 'error' = 'ok'): void => {
    setToast({ message, tone });
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(null), LINGER_MS.toast);
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
      notify('could not reach the clipboard', 'error');
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
      notify('nothing to export yet', 'error');
      return;
    }
    await copyText(docToScript(doc), 'script copied to clipboard');
  };

  // -------------------------------------------------------------------------
  // Word / character counts — quiet display in the rail footer (roadmap #11)
  // -------------------------------------------------------------------------
  const counts = createMemo(() => {
    const pageCounts = countDoc(activePage()?.doc ?? null);
    const bookCounts = countBook(pages().map((page) => page.doc));
    return {
      pageWords: pageCounts.words,
      pageChars: pageCounts.chars,
      bookWords: bookCounts.words,
      bookChars: bookCounts.chars,
    };
  });

  // -------------------------------------------------------------------------
  // Jump-to-slot — shared by TOC (roadmap #9), thumbnails (#10), ribbons (#19)
  // -------------------------------------------------------------------------
  const jumpToSlot = (slot: number): void => {
    const target = spreadOfSlot(slot);
    const current = spreadIndex();
    if (target === current) return;
    if (target === current + 1) {
      flipApi?.flipNext(); // adjacent — arrive with the flip animation
      return;
    }
    if (target === current - 1) {
      flipApi?.flipPrev();
      return;
    }
    setSpreadIndex(target);
    void play('page-flip');
  };

  // -------------------------------------------------------------------------
  // Page history restore — the time-turner panel hands a snapshot back
  // (roadmap #13). The current ink is snapshot first so a restore is always
  // reversible from the same panel.
  // -------------------------------------------------------------------------
  const [historyRefresh, setHistoryRefresh] = createSignal(0);

  const restoreSnapshot = async (
    pageId: string,
    snapshot: PageSnapshot,
  ): Promise<void> => {
    const page = pages().find((entry) => entry.id === pageId);
    if (!page) return;
    recordSnapshot(pageId, page.doc, { force: true });
    updatePageDoc(pageId, snapshot.doc);
    bumpDocVersion(pageId);
    await savePageDoc(pageId, snapshot.doc);
    notifySaved();
    setHistoryRefresh((n) => n + 1);
    notify('the page turned back in time');
    void play('pop-soft');
  };

  // -------------------------------------------------------------------------
  // Ribbon bookmarks (roadmap #19) — hydrated with the session, persisted in
  // cover_meta.bookmarks via src/views/bookmarks (defensive helpers).
  // -------------------------------------------------------------------------
  const [bookmarks, setBookmarks] = createSignal<Bookmark[]>([]);

  createEffect(
    on(session, (loaded) => {
      if (loaded) setBookmarks(readBookmarks(loaded.book));
    }),
  );

  const activeBookmarked = createMemo((): boolean => {
    const page = activePage();
    return page
      ? bookmarks().some((mark) => mark.pageId === page.id)
      : false;
  });

  const onToggleBookmark = (): void => {
    const loaded = session();
    const page = activePage();
    if (!loaded || !page) return;
    const next = toggleBookmark(bookmarks(), page.id);
    const added = next.length > bookmarks().length;
    setBookmarks(next);
    void saveBookmarks(loaded.book.id, next);
    void play('pop-soft');
    notify(added ? 'ribbon tucked into this page' : 'ribbon removed');
  };

  /** Bookmarks resolved to live slots (dropped pages disappear quietly). */
  const ribbons = createMemo(() =>
    bookmarks()
      .map((mark) => ({
        ...mark,
        slot: pages().findIndex((page) => page.id === mark.pageId),
      }))
      .filter((mark) => mark.slot >= 0),
  );

  // -------------------------------------------------------------------------
  // /today journal jump (roadmap #18): the slash command records a pending
  // page id + opens the Journal book; once this view's session shows that
  // book, flip to the dated page (refreshing the page list if the page was
  // created while the book was already open).
  // -------------------------------------------------------------------------
  let journalJumpBusy = false;
  createEffect(
    on([pendingJournalJump, session], ([pageId, loaded]) => {
      if (pageId === null || !loaded || journalJumpBusy) return;
      const slot = untrack(pages).findIndex((page) => page.id === pageId);
      if (slot >= 0) {
        setSpreadIndex(spreadOfSlot(slot));
        clearJournalJump();
        return;
      }
      journalJumpBusy = true;
      void listPages(loaded.book.id)
        .then((fresh) => {
          if (fresh.length > 0) setPages(fresh);
          const index = fresh.findIndex((page) => page.id === pageId);
          if (index >= 0) setSpreadIndex(spreadOfSlot(index));
        })
        .finally(() => {
          journalJumpBusy = false;
          clearJournalJump();
        });
    }),
  );

  // -------------------------------------------------------------------------
  // Leaves — the contract's per-side page JSX. The .nb-sheet-paper is stable
  // (getPageElement target + snapshot root); only the editor inside is keyed
  // by page id + external doc version, so edits never remount and spread
  // changes / overflow carries always do.
  // -------------------------------------------------------------------------
  const paperElements: Partial<Record<LeafSide, HTMLDivElement>> = {};

  // Search click-to-jump (group C): flip to the target page + pulse the match.
  useSearchJump({
    bookId: () => session()?.book.id ?? null,
    pages,
    setSpreadIndex,
    getPaper: (side) => paperElements[side] ?? null,
  });

  const leafKey = (page: Page | null): string | null =>
    page ? `${page.id}@${docVersions()[page.id] ?? 0}` : null;

  /**
   * Bring a blank leaf into existence so it can be written on.
   *
   * Turning past the end of a book lands on cream paper with no page behind it
   * — `pagesToCreateOnFlip` deliberately stops at the landing spread's LEFT
   * slot, because the right leaf of the last spread being bare is what the back
   * of a notebook looks like. The look was right and the behaviour was not:
   * clicking it did nothing, typing did nothing, and the only way out was to
   * turn back.
   *
   * So the paper stays bare until someone actually wants it, and then becomes a
   * page. Appends as many as the slot needs rather than one, because a blank
   * LEFT leaf sits two slots past the end and creating a single page would fill
   * the wrong one.
   */
  const writeOnBlankLeaf = async (side: LeafSide): Promise<void> => {
    const slot = spreadIndex() * 2 + (side === 'right' ? 1 : 0);
    for (let i = pages().length; i <= slot; i += 1) {
      if (!(await appendPage())) return;
    }
    void play('pop-soft');
    setFocusedSide(side);
    queueMicrotask(() => {
      paperElements[side]?.querySelector<HTMLElement>('.ProseMirror')?.focus();
    });
  };

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
      <Show
        when={leafKey(page())}
        keyed
        fallback={
          <button
            type="button"
            class="nb-leaf-blank"
            aria-label="Write on this page"
            onClick={() => void writeOnBlankLeaf(side)}
          >
            <span class="nb-leaf-blank-hint font-ui">start writing</span>
          </button>
        }
      >
        {(_key: string) => {
          const current = page();
          return current ? (
            <PaginatedPageEditor
              pageId={current.id}
              initialDoc={current.doc}
              onDocChange={(doc) => updatePageDoc(current.id, doc)}
              paginated
              pageCapacityPx={pageCapacity()}
              onOverflow={(blocks, cursorCarried, caretOffset) =>
                handleOverflow(
                  current.id,
                  blocks,
                  cursorCarried,
                  caretOffset ?? null,
                )
              }
            />
          ) : null;
        }}
      </Show>
    </div>
  );

  return (
    <main
      class="nb-book-view"
      classList={{ 'is-focus-mode': focusMode() }}
      data-focus-mode={focusMode() ? 'true' : 'false'}
      data-cursor={settings.cursorStyle}
    >
      {/* Ctrl+K quick switcher (single-instance; safe if also mounted in App). */}
      <QuickSwitcher />
      <button
        type="button"
        class="nb-back-button font-accent"
        onClick={() => appState.closeBook()}
      >
        <BackArrowIcon />
        <span>back to shelf</span>
      </button>

      {/* The one thing left on screen in focus mode, because focus mode
          hides the rail that toggles it: without this the only way out was
          to guess at F9 or blur the editor first and then press Escape. */}
      <button
        type="button"
        class="nb-focus-exit"
        aria-label="Leave focus mode (Escape)"
        tabindex={focusMode() ? 0 : -1}
        onClick={() => setFocus(false)}
      >
        <CloseStrokeIcon />
        <span class="nb-focus-exit-label font-ui">leave focus</span>
        <kbd class="nb-focus-exit-key font-ui">Esc</kbd>
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
        focusMode={focusMode()}
        onToggleFocus={toggleFocus}
        bookmarked={activeBookmarked()}
        onToggleBookmark={onToggleBookmark}
        thumbnails={settings.thumbnailsStrip}
        onToggleThumbnails={() =>
          void saveSettings({ thumbnailsStrip: !settings.thumbnailsStrip })
        }
        counts={counts()}
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
          // Built ONCE per book session: mounting a leaf mounts a TipTap
          // editor that registers itself (src/editor/instances), so these
          // must never be re-evaluated by a reactive prop read downstream.
          const leftLeaf = leafFace('left', leftPage);
          const rightLeaf = leafFace('right', rightPage);
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
                {/* Ribbon bookmarks peeking over the top edge (roadmap #19). */}
                <Show when={ribbons().length > 0}>
                  <div class="nb-ribbon-row" data-testid="ribbon-row">
                    <For each={ribbons()}>
                      {(mark) => (
                        <button
                          type="button"
                          class="nb-ribbon"
                          data-color={mark.color}
                          style={{
                            left: `${
                              8 +
                              ((mark.slot + 0.5) /
                                Math.max(pages().length, 1)) *
                                84
                            }%`,
                          }}
                          title={`ribbon — page ${mark.slot + 1}`}
                          aria-label={`Jump to bookmarked page ${mark.slot + 1}`}
                          onClick={() => jumpToSlot(mark.slot)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
                <div class="nb-spread">
                  <FlipSurface
                    ref={(api) => (flipApi = api)}
                    spreadIndex={spreadIndex()}
                    pageIds={ids()}
                    getPageElement={(side) => paperElements[side] ?? null}
                    loadPageDoc={async (pageId) => (await getPage(pageId))?.doc ?? null}
                    onNavigate={onNavigate}
                    canFlip={canFlip}
                    leftPage={leftLeaf}
                    rightPage={rightLeaf}
                  />
                  <div class="nb-spread-gutter" aria-hidden="true" />
                  <Show when={canFlip('next')}>
                    <div class="nb-page-curl" aria-hidden="true" />
                  </Show>
                </div>
              </div>

              {/* Bottom filmstrip of mini page renders (roadmap #10). */}
              <Show when={settings.thumbnailsStrip && !focusMode()}>
                <ThumbStrip
                  pages={pages()}
                  currentSpread={spreadIndex()}
                  getSnapshot={(pageId) => flipApi?.getSnapshot(pageId)}
                  onJump={jumpToSlot}
                />
              </Show>

              <RailPanel
                open={activePanel() === 'customize'}
                title="Customize this book"
                onClose={() => setActivePanel(null)}
              >
                <CustomizePanel
                  bookId={loaded.book.id}
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
                open={activePanel() === 'catalogue'}
                title="Catalogue"
                onClose={() => setActivePanel(null)}
              >
                <CataloguePanel />
              </RailPanel>

              <RailPanel
                open={activePanel() === 'toc'}
                title="Table of contents"
                onClose={() => setActivePanel(null)}
              >
                <TocPanel
                  pages={pages()}
                  currentSpread={spreadIndex()}
                  onJump={(slot) => {
                    jumpToSlot(slot);
                    setActivePanel(null);
                  }}
                />
              </RailPanel>

              <RailPanel
                open={activePanel() === 'history'}
                title="Turn back time"
                onClose={() => setActivePanel(null)}
              >
                <Show when={activePanel() === 'history' ? activePage()?.id : null} keyed>
                  {(pageId) => (
                    <HistoryPanel
                      pageId={pageId}
                      refreshKey={historyRefresh()}
                      onRestore={(snapshot) =>
                        void restoreSnapshot(pageId, snapshot)
                      }
                    />
                  )}
                </Show>
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

      {/* '?' keyboard cheat-sheet (roadmap #14). */}
      <Show when={cheatOpen()}>
        <CheatSheet onClose={() => setCheatOpen(false)} />
      </Show>

      <Show when={toast()} keyed>
        {(note) => (
          <div
            class="nb-script-toast"
            classList={{ 'is-error': note.tone === 'error' }}
            role="status"
            aria-live="polite"
          >
            {note.message}
          </div>
        )}
      </Show>
    </main>
  );
}
