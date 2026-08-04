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
import { registerCommands } from '../data/keybindings';
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
import { exportActivePagePng } from '../editor/script/exporters/exportPage';
import { NOTEBOOK_SCRIPT_SPEC } from '../editor/script/spec';
import { openExportPdfDialog } from '../features/templates/ExportPdfDialog';
import { openTemplatesGallery } from '../features/templates/TemplatesGallery';
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
import SharePanel from './rail/SharePanel';
import TocPanel from './rail/TocPanel';
import FocusDial from './rail/FocusDial';
import {
  ZOOM_REST,
  clampPan,
  clampZoom,
  stepFocusLevel,
  stepZoom,
  type FocusLevel,
} from './rail/focusLevels';
import {
  armedMark,
  armedMarkLabel,
  disarmMark,
  freeStickerNode,
  pageMarkNode,
  pointToPagePct,
  splitFreeMarks,
} from '../editor/effects/freePlacement';
import ThumbStrip from './ThumbStrip';
import {
  readBookmarks,
  saveBookmarks,
  toggleBookmark,
  type Bookmark,
  type RibbonColor,
} from './bookmarks';
import {
  MAX_TRAILING_BLANK_PAGES,
  SPREAD_FIT_REST,
  arrowFlipAction,
  canFlipSpread,
  docHasContent,
  fitSpreadToRoom,
  leftSlot,
  newPageDoc,
  pagesToCreateOnFlip,
  prependBlocksToDoc,
  spreadOfSlot,
  spreadPageIds,
  visualScale,
  type SpreadFit,
  type SpreadIds,
} from './spread';
import '../styles/editor.css';
import '../styles/insert.css';
import '../styles/spread.css';
import '../styles/rail.css';
// Last on purpose: the reader's own controls (the focus range, free-placed
// stickers, the merged ribbon plate) extend rules spread.css states first.
import '../styles/reader.css';

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

/* ---------------------------------------------------------------------------
 * The way back, and where every way back lives.
 *
 * CONVENTION (reader's words: *"when in focus mode the leave focus mode is in
 * top right, it should be top left instead, similar for all other types of
 * options, it should ALWAYS be on top left, maybe do a check"*):
 *
 *   Every control that LEAVES somewhere — back, close, exit, leave, cancel —
 *   is anchored to the TOP-LEFT of whatever it leaves: the window for a view,
 *   the sheet for a panel. Never the top-right, never the bottom.
 *
 * `tests/top-left-exits.test.ts` is the check: it fails any exit-ish selector
 * in src/styles that anchors itself with `right:`.
 *
 * The way back out of a book also has to stop being a permanent chrome bar
 * (*"placed in a way tasteful and goes away after it is used"*), so it fades
 * to a pencil mark once the reader has settled in, and comes back on intent:
 * the pointer entering the corner, Escape, or a Tab that lands on it.
 * ------------------------------------------------------------------------- */

/** The corner box that summons the way back, in px from the top-left. */
const BACK_ZONE_W = 280;
const BACK_ZONE_H = 160;

/** How long it stays out on arrival, and after a reveal. */
const BACK_LINGER_MS = 2800;

/** How long it stays once the pointer has left the corner again. */
const BACK_LEAVE_MS = 650;

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

  /**
   * KEEP TWO REAL PAGES STANDING READY AT THE END OF THE BOOK.
   *
   * The reader: *"always auto-create the next 2 pages when the user is on the
   * last page, so the user never sees a blank page."*
   *
   * They are describing the seam in `onNavigate` below, whose own comment
   * admits it: pages were created DURING the flip, fire-and-forget, so "the new
   * spread shows cream blank faces for the few ms until the rows land". Turning
   * onto a page that does not exist yet means turning onto cream paper and
   * waiting for an editor to appear underneath you. Creating it a beat EARLIER
   * costs the same page and removes the seam entirely.
   *
   * Bounded by the trailing blanks rather than by position, which is what stops
   * a runaway: once two empty pages trail the book nothing more is made, and
   * writing on one is what earns the next. `MAX_TRAILING_BLANK_PAGES` is four,
   * so two ahead sits inside the allowance a reader already has for
   * deliberately skipping a page — this cannot make `canFlipSpread` refuse a
   * turn it would otherwise have allowed.
   *
   * Only near the end, or a book with two hundred written pages would grow two
   * more the moment it opened.
   */
  const PAGES_AHEAD = 2;
  let stocking = false;
  createEffect(() => {
    const count = pages().length;
    const here = spreadIndex();
    // Track both, so writing on the last page re-arms this.
    const blanks = trailingBlanks();
    if (!session()) return;
    // Within one spread of the end — anywhere else there is nothing to stock.
    if (spreadOfSlot(Math.max(0, count - 1)) > here + 1) return;
    if (stocking) return;

    /*
     * Two blanks is not the whole answer, and the difference is visible.
     *
     * A spread is TWO slots, so an odd page count leaves the last spread with a
     * real page on the left and nothing at all on the right — measured as
     * ["empty-editor", "no-editor"], which on screen is a page you can write on
     * beside a leaf of bare cream that does nothing when clicked. That bare
     * leaf IS the blank page being complained about; stocking two more pages
     * without evening the count just moves it along.
     *
     * So the target is the smallest page count that both leaves two blanks
     * ahead AND completes the spread. In practice that is two or three pages,
     * once, and then nothing until the reader writes on one.
     */
    let wanted = Math.max(0, PAGES_AHEAD - blanks);
    if ((count + wanted) % 2 !== 0) wanted += 1;
    if (wanted === 0) return;

    /*
     * AND NEVER PAST THE ALLOWANCE, or this defeats the runaway guard.
     *
     * `canFlipSpread` lets a reader turn onto a blank spread while fewer than
     * MAX_TRAILING_BLANK_PAGES empty pages trail the book — the stop that keeps
     * a held arrow key from appending without bound. Topping the blanks back up
     * to two after every turn keeps that count permanently under the limit, so
     * the guard never fires and the book grows forever. Measured: three turns
     * past the end each produced another full spread.
     *
     * The count of trailing blanks stopped being a measure of the READER'S
     * intent the moment this effect started creating them, so the bound is
     * taken from the last page they actually wrote on instead. Four blanks past
     * that is the same allowance as before, arrived at honestly.
     */
    const all = pages();
    let lastInked = -1;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (docHasContent(all[i]?.doc)) {
        lastInked = i;
        break;
      }
    }
    const ceiling = lastInked + 1 + MAX_TRAILING_BLANK_PAGES;
    wanted = Math.min(wanted, Math.max(0, ceiling - count));
    if (wanted === 0) return;

    stocking = true;
    void (async () => {
      try {
        // Sequenced, not Promise.all: createPage derives its ord from the
        // store, so two in flight would both claim the same slot.
        for (let i = 0; i < wanted; i += 1) await appendPage();
      } finally {
        stocking = false;
      }
    })();
  });

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

  /**
   * How long after the last change of scale to re-measure.
   *
   * Longer than a frame so a tween costs one measurement rather than thirty,
   * and short enough that a reader who opens a panel and immediately types is
   * measured before they reach the foot of the page. The panel tween itself is
   * ~280 ms, so this lands just after it.
   */
  const SETTLE_MS = 90;

  /**
   * The capacity is in DRAWN pixels, because the thing it is compared against
   * is.
   *
   * PageEditor measures block bottoms with `getBoundingClientRect()`, which
   * reports what is on the glass; the leaf's own height comes from
   * `clientHeight`, which reports what was laid out. Those were the same number
   * until the spread started carrying a scale — the focus dial's zoom, and now
   * the panel fit — and after that a page at 78% measured its blocks 22% short
   * against an unshrunk capacity and quietly held a quarter more text than it
   * has room to show. A ResizeObserver never notices, either: a transform does
   * not resize anything.
   *
   * So multiply the laid-out capacity by however much the leaf is being drawn
   * at. `visualScale` is 1 whenever nothing is scaling, which is most of the
   * time, and the whole thing collapses to what it was.
   */
  const measureCapacity = (paper: HTMLElement): void => {
    const styles = getComputedStyle(paper);
    const laidOut =
      paper.clientHeight -
      (Number.parseFloat(styles.paddingTop) || 0) -
      (Number.parseFloat(styles.paddingBottom) || 0);
    const capacity =
      laidOut *
      visualScale(paper.getBoundingClientRect().height, paper.clientHeight);
    if (capacity > 120) setPageCapacity(Math.floor(capacity));
  };

  /** Both leaves, re-measured — for when the SCALE moved rather than the box. */
  const remeasureCapacity = (): void => {
    for (const side of ['left', 'right'] as const) {
      const paper = paperElements[side];
      if (paper?.isConnected === true) measureCapacity(paper);
    }
  };

  /**
   * The same, but ONCE the scale stops moving.
   *
   * `measureCapacity` forces three synchronous layouts per leaf — a
   * `getComputedStyle`, a `clientHeight` and a `getBoundingClientRect` — and it
   * was being asked for on every frame of the panel tween, which runs for about
   * a third of a second. Profiling a rail panel opening put `measureCapacity`
   * at 118 ms of self time on its own, the largest cost in the whole window and
   * the reason EVERY panel stalled by roughly the same amount whether it drew
   * anything expensive or not.
   *
   * Nothing needs the number while the sheet is still sliding. It is compared
   * against block bottoms when the reader types, and a reader is not typing
   * mid-tween — so the measurement is coalesced to the last frame of the move.
   * The timer is reset by each change, so a tween of any length costs exactly
   * one measurement, and an interrupted one (a second panel opened over the
   * first) costs one for both rather than one each.
   */
  let capacitySettle: ReturnType<typeof setTimeout> | undefined;
  const remeasureCapacityWhenSettled = (): void => {
    if (capacitySettle !== undefined) clearTimeout(capacitySettle);
    capacitySettle = setTimeout(() => {
      capacitySettle = undefined;
      remeasureCapacity();
    }, SETTLE_MS);
  };
  onCleanup(() => {
    if (capacitySettle !== undefined) clearTimeout(capacitySettle);
  });

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

  // -------------------------------------------------------------------------
  // Fitting the spread beside an open rail panel
  // =========================================================================
  // A sheet claims its width through views/rail/panelPush.ts, which tweens
  // `--nb-panel-edge` on <html> frame by frame. The shelf answers that by
  // sliding its whole world right; the book cannot, because it is a finite
  // object that already fills the view — pushed by the sheet's width its right
  // leaf ended up 271px past a 1440px window, taking the end of every line and
  // the page-curl corner with it.
  //
  // The arithmetic is `fitSpreadToRoom` (views/spread.ts, DOM-free and walked
  // at real window sizes in tests/spread.test.ts); this half is the two reads
  // it needs and the three things that can change them.
  //
  // WHY A MUTATION OBSERVER and not a signal off `activePanel()`: the edge is
  // tweened, so the book has to keep step with it for the length of the slide
  // or it jumps into place after the sheet has arrived — and BookView is not
  // the only thing that opens a sheet (BookRail's own ribbon plate claims the
  // same push without ever touching `activePanel`). Watching what panelPush
  // actually published answers both, and costs a handful of reads per toggle.
  // The observer is NOT `subtree`, and the fit is published on this view's own
  // element rather than back onto <html>, so writing it cannot re-trigger it.
  // -------------------------------------------------------------------------
  const [spreadFit, setSpreadFit] = createSignal<SpreadFit>(SPREAD_FIT_REST);
  let viewElement: HTMLElement | undefined;
  let stageElement: HTMLElement | undefined;
  /**
   * A plain mirror of the signal, and not a convenience.
   *
   * `fitSpread` runs from a ref callback, which Solid invokes inside the render
   * effect that is building the spread. Reading the signal there would
   * subscribe THAT effect to the fit, and every frame of the slide would then
   * re-run the render — remounting the leaves, and with them a TipTap instance
   * per page. Compare against the mirror; the signal is write-only from here.
   */
  let lastFit: SpreadFit = SPREAD_FIT_REST;
  /** Watches the two boxes the fit is read off; see `attachStage` below. */
  const roomObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          invalidateRoom();
          fitSpread();
        })
      : null;
  onCleanup(() => roomObserver?.disconnect());

  /**
   * The parts of the fit that a SLIDING SHEET cannot change, cached per slide.
   *
   * `fitSpread` runs on every frame of the panel tween, and four of the five
   * numbers it reads — the view's padding, its box, the stage's laid-out width
   * and the gutter token — are layout reads. Reading layout inside an animation
   * frame forces a synchronous style-and-layout pass, so the tween paid for
   * about thirty of them per open. Only `--nb-panel-edge` actually moves while
   * a sheet slides: the window is not resizing and the stage is not relaying
   * out, which is precisely why the push was built as a transform in the first
   * place (see `panelPush.ts`).
   *
   * So they are read once at the start of a slide and reused until something
   * that really can change them says so. That is exactly ONE place — the
   * ResizeObserver already watching both the view and the stage — and it is
   * enough because every way these numbers can move is a resize of one of those
   * two boxes: the window changing, the stage remounting with a book, and the
   * focus rung, which alters the stage's laid-out width and therefore fires the
   * observer on it (`attachStage` puts it under the same observer for this
   * reason). Getting the invalidation wrong would leave the book fitted to a
   * window it no longer has, so it is wired to the observer that already
   * existed rather than to a list of things I think can move.
   */
  let roomCache: { room: { left: number; right: number }; width: number; gap: number } | null =
    null;
  const invalidateRoom = (): void => {
    roomCache = null;
  };

  const fitSpread = (): void => {
    const view = viewElement;
    const stage = stageElement;
    if (!view || !stage || !view.isConnected || !stage.isConnected) return;

    if (roomCache === null) {
      const styles = getComputedStyle(view);
      const box = view.getBoundingClientRect();
      // The view is never itself transformed (the fit lives on its children),
      // so its own rect is honest. The stage IS inside the focus zoom, so take
      // its width from `offsetWidth` — a laid-out number — and its position
      // from the room, which is where flex centring puts it.
      roomCache = {
        room: {
          left: box.left + (Number.parseFloat(styles.paddingLeft) || 0),
          right: box.right - (Number.parseFloat(styles.paddingRight) || 0),
        },
        width: stage.offsetWidth,
        // One source for the gutter between sheet and book: the same token the
        // back arrow and the settings seal clear the sheet by.
        gap: Number.parseFloat(styles.getPropertyValue('--space-16')) || 16,
      };
    }
    const { room, width } = roomCache;
    const centre = (room.left + room.right) / 2;
    const edge =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          '--nb-panel-edge',
        ),
      ) || 0;
    const gap = roomCache.gap;

    const next = fitSpreadToRoom(
      { left: centre - width / 2, right: centre + width / 2 },
      room,
      edge,
      gap,
    );
    if (next.shift === lastFit.shift && next.scale === lastFit.scale) return;
    lastFit = next;
    setSpreadFit(next);
    // The leaf is now drawn at a different size, and the page capacity is
    // quoted in drawn pixels — see measureCapacity. Once the move SETTLES,
    // not on every frame of it: this runs for the whole tween.
    remeasureCapacityWhenSettled();
  };

  /** The view frame: fixed to the window, so this one is only the resize. */
  const attachView = (el: HTMLElement): void => {
    viewElement = el;
    roomObserver?.observe(el);
    queueMicrotask(fitSpread);
  };

  /**
   * The stage mounts and unmounts with the book session, and its width follows
   * both the window and the focus rung — so it is watched from its own ref
   * rather than from a signal that would have to guess when it exists.
   *
   * Deferred a microtask, like the view's: a ref fires before the element is in
   * the document, so measuring here reads zeros.
   */
  const attachStage = (el: HTMLElement | undefined): void => {
    if (stageElement && stageElement !== el) {
      roomObserver?.unobserve(stageElement);
    }
    stageElement = el;
    if (el) roomObserver?.observe(el);
    queueMicrotask(fitSpread);
  };

  onMount(() => {
    if (typeof MutationObserver === 'undefined') return;
    // panelPush writes the tweened edge onto <html>'s inline style; every
    // frame of every slide arrives here.
    const pushWatcher = new MutationObserver(() => fitSpread());
    pushWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    onCleanup(() => pushWatcher.disconnect());
    fitSpread();
  });

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
   * Put the caret inside a page's editor as soon as that editor exists.
   *
   * Two callers, and both hand the reader a page whose leaf is mounting in
   * the same breath: the overflow carry (the caret has to chase its own text
   * onto the next leaf) and `writeOnBlankLeaf` (bare paper becoming the page
   * the reader just asked to write on). Leaves are keyed on id@version, so
   * the instance may not exist for a frame or two — poll across rAF until the
   * registry hands back a live, connected editor.
   *
   * A plain `.ProseMirror.focus()` on the next microtask is NOT the same
   * thing and was the bug on the blank leaf: the element is not in the DOM
   * yet that soon, the call quietly hit nothing, and everything the reader
   * then typed went to <body>. Ask the registry, and keep asking.
   *
   * `offset` is a PM token offset — `'end'` for a page with nothing in it
   * yet. Since carries PREPEND to the target doc, the caret's offset within
   * the carried blocks addresses the same spot in the new doc (clamped
   * defensively).
   */
  /**
   * Run something against a page's editor as soon as that editor exists.
   *
   * The rAF chaser described above, on its own, so the caret carry and the
   * sticker placement below share one answer to "the leaf is keyed on
   * id@version and may not have mounted yet".
   */
  const withPageEditor = (
    pageId: string,
    run: (editor: NonNullable<ReturnType<typeof getPageEditor>>) => void,
  ): void => {
    const deadline = performance.now() + 6000;
    const attempt = (): void => {
      const instance = getPageEditor(pageId);
      if (instance && instance.view.dom.isConnected) {
        run(instance);
        return;
      }
      if (performance.now() < deadline) requestAnimationFrame(attempt);
    };
    attempt();
  };

  const focusPageCaret = (
    pageId: string,
    offset: number | 'end' | null,
  ): void => {
    withPageEditor(pageId, (instance) => {
      const size = instance.state.doc.content.size;
      const pos =
        offset === 'end' ? 'end' : Math.max(0, Math.min(offset ?? 0, size));
      instance.chain().focus(pos, { scrollIntoView: false }).run();
    });
  };

  // -------------------------------------------------------------------------
  // Free-placed marks — stickers, and the trim the reader put on the page
  // itself (see src/editor/effects/freePlacement.ts for the contract this
  // upholds — in one line: a free mark belongs to the PAGE, and the pagination
  // carry may never take it anywhere).
  // -------------------------------------------------------------------------

  /**
   * Where a free mark is anchored: just inside the page's first block.
   *
   * That is the one position on a page the overflow drain provably cannot
   * reach — `trailingOverflowCount` removes trailing blocks and always leaves
   * at least one. Returns null on a page with no textblock at all, which is
   * the caller's cue to do nothing rather than to invent a paragraph.
   */
  const freeAnchorPos = (doc: {
    forEach(fn: (node: { isTextblock: boolean }, offset: number) => void): void;
  }): number | null => {
    let at: number | null = null;
    doc.forEach((node, offset) => {
      if (at === null && node.isTextblock) at = offset + 1;
    });
    return at;
  };

  /**
   * Put free-placed marks back on the page they were placed on.
   *
   * Called on every carry with whatever `splitFreeMarks` found in the blocks on
   * their way out. Dispatched with `addToHistory: false` for the same reason
   * the drain itself is: a page break is not an edit the reader made, and one
   * Ctrl+Z should never half-undo one.
   */
  const anchorFreeMarks = (
    pageId: string,
    nodes: readonly Record<string, unknown>[],
  ): void => {
    if (nodes.length === 0) return;
    withPageEditor(pageId, (editor) => {
      const at = freeAnchorPos(editor.state.doc);
      if (at === null) return;
      const tr = editor.state.tr;
      let inserted = false;
      for (const json of nodes) {
        try {
          tr.insert(at, editor.schema.nodeFromJSON(json));
          inserted = true;
        } catch {
          // A sticker id or a trim value the schema no longer knows: dropping
          // it quietly is better than throwing inside a page break.
        }
      }
      if (inserted) editor.view.dispatch(tr.setMeta('addToHistory', false));
    });
  };

  const carryOverflow = async (
    pageId: string,
    blocks: unknown[],
    cursorCarried: boolean,
    caretOffset: number | null,
  ): Promise<void> => {
    const slot = pages().findIndex((page) => page.id === pageId);
    if (slot < 0) return;

    // A free-placed mark belongs to the PAGE, not to the paragraph it was
    // anchored in — so the blocks travel and the marks stay. This is the
    // second half of the contract in effects/freePlacement.ts (the first is
    // the anchor position, which the drain provably cannot reach; this catches
    // the case where an earlier carry PREPENDED enough to push that anchor
    // into the tail).
    const { kept, freed } = splitFreeMarks(blocks);
    anchorFreeMarks(pageId, freed);

    let next: Page | null = pages()[slot + 1] ?? null;
    if (!next) {
      next = await appendPage();
      if (!next) return;
    }

    const fallbackAttrs: Record<string, unknown> = { pageStyle: bookPageStyle() };
    const line = bookLineHeight();
    if (line !== undefined) fallbackAttrs.lineHeightPx = line;

    const merged = prependBlocksToDoc(next.doc, kept, fallbackAttrs);
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
      focusPageCaret(next.id, caretOffset);
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
  // Focus mode (roadmap #12) — a RANGE, not a switch (see rail/focusLevels.ts)
  // + keyboard cheat-sheet (roadmap #14)
  //
  // The reader: *"focus mode should allow user to basically zoom in and also
  // even just get into full page mode where the book isnt even visible and it
  // just page and even go as far just making one page visible, so basically it
  // should be controllable by user"*.
  //
  // So: four rungs (off → spread → page → leaf), a zoom the reader sets, and a
  // pan for when the zoom has made the leaf bigger than the window. `focusMode`
  // survives as a derived boolean because the class it drives — `is-focus-mode`
  // — is what the e2e suite and the tour both find the mode by.
  // -------------------------------------------------------------------------
  const [focusLevel, setFocusLevel] = createSignal<FocusLevel>('off');
  const [focusZoom, setFocusZoom] = createSignal(ZOOM_REST);
  const [focusPan, setFocusPan] = createSignal({ x: 0, y: 0 });
  /** Which leaf survives at the `leaf` rung. */
  const [soloLeaf, setSoloLeaf] = createSignal<LeafSide>('left');
  const [activePanel, setActivePanel] = createSignal<RailPanelId | null>(null);

  const focusMode = (): boolean => focusLevel() !== 'off';
  /** The two rungs where the book itself is out of the way. */
  const boardsOff = (): boolean =>
    focusLevel() === 'page' || focusLevel() === 'leaf';

  /** The window box the pan is clamped against (the stage fills it). */
  const viewportBox = (): { width: number; height: number } => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
  });

  const recentre = (): void => {
    setFocusZoom(ZOOM_REST);
    setFocusPan({ x: 0, y: 0 });
  };

  const changeZoom = (direction: 1 | -1): void => {
    const next = stepZoom(focusZoom(), direction);
    setFocusZoom(next);
    // Zooming back out has to bring the book back with it, or the reader ends
    // up at 100% with the spread parked off the left edge and no way to tell
    // that the pan — not the zoom — is what is wrong.
    setFocusPan((pan) => clampPan(pan, next, viewportBox()));
  };

  /**
   * Entering focus mode CLOSES whatever the rail had open. A rail panel is a
   * sheet that also pushes the spread sideways to make room for itself, and
   * focus mode hides the rail — so entering with the Customize panel open
   * left a wall of controls floating beside a book shoved off the right edge,
   * with no rail icon left to close it with.
   *
   * Leaving also puts the zoom and the pan back: the rungs are a way of
   * READING, and coming back to the desk at 220% and off-centre would look
   * like the app had broken rather than like a setting the reader left on.
   */
  const goToFocus = (level: FocusLevel): void => {
    if (level !== 'off') {
      setActivePanel(null);
      // The solo leaf adopts whichever page the reader was last in, so
      // stepping to "one page" never hides the page they were writing on.
      if (level === 'leaf' && focusLevel() !== 'leaf') setSoloLeaf(focusedSide());
    } else {
      recentre();
    }
    setFocusLevel(level);
  };

  const setFocus = (on: boolean): void => goToFocus(on ? 'spread' : 'off');
  const toggleFocus = (): void => setFocus(!focusMode());
  const stepFocus = (direction: 1 | -1): void =>
    goToFocus(stepFocusLevel(focusLevel(), direction));

  /**
   * At the `leaf` rung an arrow key means ONE page, not one spread.
   *
   * Reading a single leaf and having the arrow skip the page next to it is the
   * kind of thing that loses a reader their place. The side flips first and the
   * spread follows only when the side runs out, which is what turning a page in
   * a real book does.
   */
  const stepLeaf = (direction: 1 | -1): void => {
    if (direction > 0) {
      if (soloLeaf() === 'left') setSoloLeaf('right');
      else {
        setSoloLeaf('left');
        flipApi?.flipNext();
      }
    } else if (soloLeaf() === 'right') setSoloLeaf('left');
    else {
      setSoloLeaf('right');
      flipApi?.flipPrev();
    }
  };

  // -------------------------------------------------------------------------
  // The way back (see the convention docblock at the top of this file)
  // -------------------------------------------------------------------------
  const [backShown, setBackShown] = createSignal(true);
  let backTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pointer is inside the summoning corner. Plain flag: read on every move. */
  let backNear = false;

  const clearBackTimer = (): void => {
    if (backTimer !== undefined) {
      clearTimeout(backTimer);
      backTimer = undefined;
    }
  };

  /** Out, and staying out (the pointer is in the corner, or it has focus). */
  const holdBack = (): void => {
    clearBackTimer();
    setBackShown(true);
  };

  /** Out, then receding again after `ms`. */
  const showBack = (ms: number): void => {
    clearBackTimer();
    setBackShown(true);
    backTimer = setTimeout(() => {
      backTimer = undefined;
      setBackShown(false);
    }, ms);
  };

  /**
   * Only crossings of the corner boundary touch state — a pointer moving
   * across the page does one boolean compare per event and writes nothing.
   * (The page-flip rasterizes pages; nothing here may add work to a move.)
   */
  const onPointerMove = (event: PointerEvent): void => {
    const near = event.clientX <= BACK_ZONE_W && event.clientY <= BACK_ZONE_H;
    if (near === backNear) return;
    backNear = near;
    if (near) holdBack();
    else showBack(BACK_LEAVE_MS);
  };

  onMount(() => {
    // It is out when the reader arrives — that is the moment they most need to
    // know the door is there — and then it gets out of the way.
    showBack(BACK_LINGER_MS);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
  });
  onCleanup(() => {
    clearBackTimer();
    window.removeEventListener('pointermove', onPointerMove);
  });

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
    // Escape is also how you SUMMON the way back without reaching for the
    // corner — it is the key every other "get me out of here" in the app
    // answers to, and here it only lights the door rather than opening it.
    // Deliberately before the defaultPrevented guard: ProseMirror eats Escape
    // while the caret is in a page, which is exactly when you want the door.
    if (event.key === 'Escape' && !focusMode()) showBack(BACK_LINGER_MS);
    // Escape also disarms a mark waiting for somewhere to land — before the
    // defaultPrevented guard for the same reason as everything else here: the
    // caret is usually in a page, and ProseMirror eats its own Escape.
    if (event.key === 'Escape' && armedMark() !== null) {
      event.preventDefault();
      disarmMark();
      return;
    }
    if (event.defaultPrevented || insertOpen()) return;

    // F9 used to be spelled out right here, which is why it never appeared in
    // the shortcut list and could not be moved. It is `toggle-focus` in the
    // registry now and arrives through the dispatcher, like everything else
    // this view answers to — see the registration block below.

    // The focus range, on the keyboard. `[` and `]` walk the rungs and the
    // usual zoom combo works the zoom — a dial you have to reach for is one
    // more thing in front of the page focus mode exists to clear.
    if (focusMode() && !isTypingTarget(document.activeElement)) {
      if (event.key === '[' || event.key === ']') {
        event.preventDefault();
        stepFocus(event.key === ']' ? 1 : -1);
        return;
      }
    }
    if (focusMode() && (event.ctrlKey || event.metaKey)) {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        changeZoom(1);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        changeZoom(-1);
        return;
      }
      if (event.key === '0') {
        event.preventDefault();
        recentre();
        return;
      }
    }

    // The script tools, the rail's panels, the ribbon and the rest of what
    // this view can be told to do are COMMANDS now (see the block under this
    // handler) — matched once by the app's dispatcher instead of by a ladder
    // of `matchesBinding` calls here, which is what let F9 and '?' fire for a
    // year without ever appearing in the settings sheet. The cheat-sheet moved
    // out too: it lives at the root so it answers on the shelf as well.
    const action = arrowFlipAction(
      event.key,
      isTypingTarget(document.activeElement),
    );
    if (action === null) return;
    event.preventDefault();
    if (focusLevel() === 'leaf') {
      stepLeaf(action === 'next' ? 1 : -1);
      return;
    }
    if (action === 'next') flipApi?.flipNext();
    else flipApi?.flipPrev();
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  /**
   * Everything this view can be told to do from the keyboard.
   *
   * One entry per rail button that a reader presses more than once a session,
   * pointed at the SAME closure the button calls — the icon and the key can
   * therefore never drift, which is the whole reason this list is here rather
   * than a second set of handlers. Registered on mount and released on
   * cleanup, so none of them fires while the shelf is on screen: a key with no
   * live command is left completely alone by the dispatcher.
   *
   * The panel four are toggles because the rail icons are: pressing the key
   * again is how you put the sheet away, and a reader who has just opened the
   * catalogue with Ctrl+Alt+A should not have to find the mouse to close it.
   */
  onMount(() => {
    const togglePanel = (panel: RailPanelId) => (): void => {
      setActivePanel((current) => (current === panel ? null : panel));
    };
    onCleanup(
      registerCommands({
        'toggle-focus': toggleFocus,
        'new-page': () => void addPage(),
        'toggle-bookmark': onToggleBookmark,
        'table-of-contents': togglePanel('toc'),
        catalogue: togglePanel('catalogue'),
        'page-style': togglePanel('page-style'),
        'customize-book': togglePanel('customize'),
        thumbnails: () =>
          void saveSettings({ thumbnailsStrip: !settings.thumbnailsStrip }),
        'insert-script': () => setInsertOpen(true),
        'export-script': () => {
          const page = activePage();
          if (page) void exportScript(page.id);
        },
        /*
         * The four flows that had no key and no button (see
         * `views/rail/SharePanel.tsx`). Pointed at the same module-level
         * openers the sheet's rows call, for the same reason every other id
         * here is: the icon and the key must be one implementation.
         *
         * `templates` is registered by the SHELF as well — the gallery makes a
         * book from out there and adds its pages to this one from in here, and
         * a reader should not have to know which room they are in.
         *
         * `import-markdown` is deliberately NOT here: it belongs to the shell
         * (App.tsx), because importing files makes BOOKS and a reader on the
         * shelf wants it at least as much as a reader inside one. Registering
         * it in both would be worse than registering it in neither — this
         * view's cleanup would not restore the shell's entry, so the key would
         * work until the first time a book was closed.
         */
        templates: () => openTemplates(),
        'export-pdf': () => {
          setActivePanel(null);
          openExportPdfDialog();
        },
        'export-png': () => void exportActivePagePng(),
      }),
    );
  });

  /**
   * The gallery, from Ctrl+Alt+G.
   *
   * The rail icon that used to call this is gone — the gallery is a row on the
   * "In and out" sheet now, and that row calls `openTemplatesGallery` itself
   * (SharePanel closes the sheet before running a row that opens an overlay,
   * which is the only other thing this wrapper does). The key still comes
   * through here, because a shortcut pressed with a sheet open has the same
   * problem the row does.
   */
  const openTemplates = (): void => {
    // The sheet would sit under the overlay, and its Escape would close first.
    setActivePanel(null);
    void play('pop-soft');
    openTemplatesGallery();
  };

  // -------------------------------------------------------------------------
  // Zoom by wheel, and pan by drag — the two gestures the reader already knows
  // from the shelf (CLAUDE.md: plain wheel zooms out there). In here plain
  // wheel belongs to the page, so the zoom takes the modifier and nothing else
  // changes for someone who never enters focus mode.
  // -------------------------------------------------------------------------
  const onWheel = (event: WheelEvent): void => {
    if (!focusMode()) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 1 : -1);
      return;
    }
    // Once the book is bigger than the window the wheel walks it around.
    // Free to claim: pages never scroll, so a plain wheel over a leaf has
    // never meant anything until now.
    if (focusZoom() <= ZOOM_REST) return;
    event.preventDefault();
    const step = event.shiftKey
      ? { x: -event.deltaY, y: 0 }
      : { x: -event.deltaX, y: -event.deltaY };
    setFocusPan((pan) =>
      clampPan(
        { x: pan.x + step.x, y: pan.y + step.y },
        focusZoom(),
        viewportBox(),
      ),
    );
  };
  onMount(() =>
    window.addEventListener('wheel', onWheel, { passive: false }),
  );
  onCleanup(() => window.removeEventListener('wheel', onWheel));

  /**
   * Drag the zoomed book around.
   *
   * Only past 100% — at rest the book already fits, and a pan there would only
   * ever be a way to push it off screen. Only off the paper, too: a drag that
   * starts inside the prose is the browser's own sweep-to-select and the page
   * turn's own grab, and stealing either would be worse than not panning.
   */
  const onPanDown = (event: PointerEvent): void => {
    if (!focusMode() || focusZoom() <= ZOOM_REST || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof Element &&
      (isTypingTarget(target) ||
        target.closest('button, a, input, .nb-free-sticker, .nb-flip-hotspot') !==
          null)
    ) {
      return;
    }
    event.preventDefault();
    const from = { px: event.clientX, py: event.clientY, ...focusPan() };
    const onMove = (move: PointerEvent): void => {
      setFocusPan(
        clampPan(
          {
            x: from.x + (move.clientX - from.px),
            y: from.y + (move.clientY - from.py),
          },
          focusZoom(),
          viewportBox(),
        ),
      );
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

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

  const activeMark = createMemo((): Bookmark | null => {
    const page = activePage();
    if (!page) return null;
    return bookmarks().find((mark) => mark.pageId === page.id) ?? null;
  });

  const activeBookmarked = createMemo((): boolean => activeMark() !== null);

  const commitBookmarks = (next: Bookmark[]): void => {
    const loaded = session();
    if (!loaded) return;
    setBookmarks(next);
    void saveBookmarks(loaded.book.id, next);
  };

  const onToggleBookmark = (): void => {
    const loaded = session();
    const page = activePage();
    if (!loaded || !page) return;
    const next = toggleBookmark(bookmarks(), page.id);
    const added = next.length > bookmarks().length;
    commitBookmarks(next);
    void play('pop-soft');
    notify(added ? 'ribbon tucked into this page' : 'ribbon removed');
  };

  /**
   * Which of the six ribbons marks this page.
   *
   * The merged rail control (see `rail/BookRail.tsx`) offers the set; this
   * applies the pick, and marks the page first if it was not marked at all —
   * so choosing a ribbon on an unmarked page IS bookmarking it, and nobody has
   * to press twice to get the ribbon they wanted.
   *
   * Done here rather than in `views/bookmarks.ts` because that module's
   * `toggleBookmark` is a pure list operation shared with its own tests, and
   * "which slot" is a decision the view is making.
   */
  const onPickBookmarkSlot = (slot: RibbonColor): void => {
    const loaded = session();
    const page = activePage();
    if (!loaded || !page) return;
    const base =
      activeMark() === null ? toggleBookmark(bookmarks(), page.id) : bookmarks();
    commitBookmarks(
      base.map((mark) =>
        mark.pageId === page.id ? { ...mark, color: slot } : mark,
      ),
    );
    void play('pop-soft');
    notify(`the ${slot} ribbon marks this page`);
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
   * the wrong one — and BOTH leaves come through here, so the right leaf of a
   * past-the-end spread answers a click exactly as the left one does.
   *
   * The row is only half of it: a page nobody can type on is still "clicking
   * it does nothing" from where the reader sits. The caret goes in through the
   * SAME rAF chaser the overflow carry uses (`focusPageCaret`) rather than a
   * DOM `.focus()` a microtask later, because the leaf that is about to hold
   * the editor has not mounted one yet at that point.
   *
   * Re-entrant on purpose: a double-click finds the slot already filled, skips
   * straight to the caret, and never appends a second sheet.
   */
  const writeOnBlankLeaf = async (side: LeafSide): Promise<void> => {
    const slot = leftSlot(spreadIndex()) + (side === 'right' ? 1 : 0);
    while (pages().length <= slot) {
      if (!(await appendPage())) return;
    }
    const target = pageAt(slot);
    if (!target) return;
    void play('pop-soft');
    setFocusedSide(side);
    focusPageCaret(target.id, 'end');
  };

  /**
   * Drop the armed mark where the reader clicked.
   *
   * The catalogue arms one (`effects/freePlacement.ts`); this is the other
   * half — *"click on it and put it anywhere on the page, not caring about
   * where lines are"*. The x/y are a percentage of the LEAF's own box, so the
   * mark keeps its place when the window resizes or the reader zooms; a trim
   * mark's w/h are percentages for the same reason.
   *
   * One function for both kinds because both answer the same click and both
   * land in the same place in the document — the only thing that differs is
   * which node JSON gets built.
   *
   * Bare paper answers too, by becoming a page first: a leaf you can stick a
   * sticker on but not write on would be a strange thing to hand anyone.
   */
  const placeArmedMark = async (
    side: LeafSide,
    at: { x: number; y: number },
  ): Promise<void> => {
    const mark = armedMark();
    if (mark === null) return;
    disarmMark();
    const slot = leftSlot(spreadIndex()) + (side === 'right' ? 1 : 0);
    while (pages().length <= slot) {
      if (!(await appendPage())) return;
    }
    const target = pageAt(slot);
    if (!target) return;
    const json =
      mark.kind === 'sticker'
        ? freeStickerNode({ stickerId: mark.stickerId, x: at.x, y: at.y })
        : pageMarkNode({ fx: mark.fx, value: mark.value, x: at.x, y: at.y });
    withPageEditor(target.id, (editor) => {
      const pos = freeAnchorPos(editor.state.doc);
      if (pos === null) return;
      editor.view.dispatch(
        editor.state.tr.insert(pos, editor.schema.nodeFromJSON(json)),
      );
    });
    void play('pop-soft');
    notify(`${armedMarkLabel(mark)} stuck to this page — drag it wherever you like`);
  };

  /**
   * The armed mark's click is taken in the CAPTURE phase on the leaf.
   *
   * A bubble-phase handler would fire after ProseMirror had already moved the
   * caret to wherever the reader pressed, which is exactly the "where the
   * lines are" the whole feature exists to stop mattering.
   */
  const armLeafCapture = (el: HTMLElement, side: LeafSide): void => {
    const onDown = (event: PointerEvent): void => {
      if (armedMark() === null) return;
      event.preventDefault();
      event.stopPropagation();
      // Measured off the LAYER, not off the paper: that is the box the mark's
      // own `left`/`top` percentages resolve against and the box its drag math
      // reads, so the mark lands exactly under the pointer even if the two
      // boxes ever stop coinciding.
      const layer = el.querySelector('.nb-free-layer') ?? el;
      void placeArmedMark(
        side,
        pointToPagePct(layer.getBoundingClientRect(), event.clientX, event.clientY),
      );
    };
    el.addEventListener('pointerdown', onDown, true);
    onCleanup(() => el.removeEventListener('pointerdown', onDown, true));
  };

  const leafFace = (side: LeafSide, page: () => Page | null): JSX.Element => (
    <div
      class="nb-sheet-paper nb-leaf-paper"
      data-side={side}
      ref={(el) => {
        paperElements[side] = el;
        capacityObserver?.observe(el);
        armLeafCapture(el, side);
        queueMicrotask(() => measureCapacity(el));
      }}
      onFocusIn={() => setFocusedSide(side)}
    >
      {/*
        The layer free-placed marks paint into — a child of the leaf, so it
        travels with the page into the flip snapshots and clips at the paper's
        own edge. Two node views portal into it, the sticker
        (editor/nodes/sticker.tsx) and the trim mark (editor/nodes/pageMark.tsx);
        nothing else may render here.
      */}
      <div
        class="nb-free-layer"
        role="group"
        aria-label="Stickers and trim placed on this page"
      />
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
      ref={attachView}
      classList={{
        'is-focus-mode': focusMode(),
        'is-zoomed': focusMode() && focusZoom() !== ZOOM_REST,
        'is-placing': armedMark() !== null,
      }}
      data-focus-mode={focusMode() ? 'true' : 'false'}
      /* The rung, for CSS and for anything measuring the mode from outside.
         `is-focus-mode` stays exactly what it was — the e2e suite and the tour
         both find focus mode by that class. */
      data-focus-level={focusLevel()}
      data-solo-leaf={focusLevel() === 'leaf' ? soloLeaf() : undefined}
      data-cursor={settings.cursorStyle}
      style={{
        '--nb-focus-zoom': String(clampZoom(focusZoom())),
        '--nb-focus-pan-x': `${focusPan().x}px`,
        '--nb-focus-pan-y': `${focusPan().y}px`,
        /* Where the book sits, and how big, in the room an open rail sheet
           leaves it (rail.css `.nb-book-view .nb-book-cover`). Published here
           rather than on <html> so the fit cannot re-trigger the observer that
           computes it — and so it dies with the view. */
        '--nb-spread-shift': `${spreadFit().shift}px`,
        '--nb-spread-fit': String(spreadFit().scale),
      }}
      onPointerDown={onPanDown}
    >
      {/* Ctrl+K quick switcher (single-instance; safe if also mounted in App). */}
      <QuickSwitcher />
      {/* The only way out of a book, top-left, and quiet about it. It is not
          removed when it recedes — a control you cannot Tab to is not a way
          out — it just stops being ink you have to look past.

          The label keeps "back to shelf" as its leading words: that is the
          accessible name the e2e suite and the tour both find it by. */}
      <button
        type="button"
        class="nb-back-button font-accent"
        classList={{ 'is-away': !backShown() }}
        aria-label="back to shelf (Escape shows this)"
        tabindex={focusMode() ? -1 : 0}
        onFocus={() => holdBack()}
        onBlur={() => showBack(BACK_LEAVE_MS)}
        onClick={() => appState.closeBook()}
      >
        <BackArrowIcon />
        <span class="nb-back-label">back to shelf</span>
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

      {/* The reader's hand on the mode: which rung, how big, which leaf. Under
          the exit chip, in the same corner, because that is where this app
          keeps everything you reach for without looking. */}
      <Show when={focusMode()}>
        <FocusDial
          level={focusLevel()}
          onPickLevel={goToFocus}
          zoom={focusZoom()}
          onZoom={changeZoom}
          onZoomRest={recentre}
          leaf={soloLeaf()}
          onPickLeaf={setSoloLeaf}
          panned={focusPan().x !== 0 || focusPan().y !== 0}
          onRecentre={recentre}
        />
      </Show>

      <BookRail
        activePanel={activePanel()}
        onTogglePanel={(panel) =>
          setActivePanel((current) => (current === panel ? null : panel))
        }
        onAddPage={() => void addPage()}
        focusMode={focusMode()}
        onToggleFocus={toggleFocus}
        bookmarked={activeBookmarked()}
        onToggleBookmark={onToggleBookmark}
        bookmarkSlot={activeMark()?.color ?? null}
        onPickBookmarkSlot={onPickBookmarkSlot}
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
              ref={attachStage}
              data-spread-index={spreadIndex()}
              data-book-ink={pageDefaults()?.ink ?? 'inherit'}
            >
              <header class="nb-spread-header">
                <h1 class="nb-book-title-plate">{loaded.book.title}</h1>
              </header>

              <div
                class="nb-book-cover"
                style={{
                  // At the "pages" and "one page" rungs the boards come off,
                  // and the cover art has to go with them — an inline
                  // background-image outranks any stylesheet, so the rung is
                  // decided here rather than fought with `!important`.
                  'background-image': boardsOff()
                    ? undefined
                    : `url("${backdropUrl()}")`,
                }}
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
                          data-tooltip={`ribbon — page ${mark.slot + 1}`}
                          data-tooltip-side="left"
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
                open={activePanel() === 'share'}
                title="In and out"
                onClose={() => setActivePanel(null)}
              >
                {/* The three that cannot resolve their own context: the paste
                    box is mounted against the focused leaf, and both copies
                    need this view's page and its toast. Everything else on the
                    sheet calls its own module-level opener. */}
                <SharePanel
                  onInsertScript={() => setInsertOpen(true)}
                  onCopyScript={() => {
                    const page = activePage();
                    if (page) void exportScript(page.id);
                  }}
                  onCopySpec={() =>
                    void copyText(
                      NOTEBOOK_SCRIPT_SPEC,
                      'spec copied — paste it to your AI',
                    )
                  }
                  onClose={() => setActivePanel(null)}
                />
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

      {/* The keyboard cheat-sheet (roadmap #14) used to hang here, which made
          '?' a book-only key. It is mounted at the app root now (App.tsx →
          CheatSheetHost) so the shelf can answer it too. */}

      {/* A sticker or a piece of trim is waiting for somewhere to land. It says
          so, and it says how to change its mind — an armed cursor with no way
          out is a trap. */}
      <Show when={armedMark()} keyed>
        {(mark) => (
          <div class="nb-place-hint" role="status" aria-live="polite">
            <span class="nb-place-hint-text font-ui">
              click anywhere on a page to stick the {armedMarkLabel(mark)} there
            </span>
            <button
              type="button"
              class="nb-place-hint-stop font-ui"
              onClick={() => disarmMark()}
            >
              never mind <kbd>Esc</kbd>
            </button>
          </div>
        )}
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
