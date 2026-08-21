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
  untrack,
  type JSX,
} from 'solid-js';
import type { Editor, JSONContent } from '@tiptap/core';
import { undo, undoDepth } from '@tiptap/pm/history';
import { appState } from '../state/app';
import { editorState } from '../editor/state';
import {
  bookcaseOf,
  getBook,
  listBooksByFloorRange,
  readPageDefaults,
  readShelfMeta,
  savePageDefaults,
  type BookPageDefaults,
} from '../data/books';
import {
  createPage,
  deletePage,
  getPage,
  insertPageAfter,
  insertPageBefore,
  isPageFlowStart,
  listPages,
  persistPageDocIdentity,
  restorePageSnapshot,
  restoreOrCreatePageSnapshot,
  savePageDoc,
  setPageFlowStart,
  setPageScript,
} from '../data/pages';
import {
  beginAiPatchUndo,
  claimAiPatchApplication,
  completeAiPatchApplication,
  completeAiPatchUndo,
  forgetAiPatchApplication,
  latestAppliedAiPatch,
  readAiPatchApplication,
  recoverIncompleteAiPatchApplications,
  releaseAiPatchApplication,
  type AiPatchBookSnapshot,
} from '../data/aiAgentApply';
import { countAiAgentAttachmentReferences } from '../data/aiAgent';
import { seedIfEmpty } from '../data/seed';
import { loadDesignPrefs } from '../data/designPrefs';
import {
  save as saveSettings,
  settings,
  subscribe as subscribeSettings,
} from '../data/settings';
import { registerCommands, runCommand } from '../data/keybindings';
import type { Book, Page, PageDoc, PageStyle } from '../data/types';
import {
  coverDataUrl,
  deriveCoverParams,
  type CoverOverrides,
} from '../art/covers';
import { openCoverDataUrl } from '../art/openCover';
import { getTheme } from '../art/themes';
import PageEditor, {
  type PageEditorProps,
  type PaginationUndoOrigin,
} from '../editor/PageEditor';
import {
  pageDocForRendering,
  preparePageRenderDocs,
} from '../editor/blockIdentity';
import InsertScriptDialog from '../editor/insert/InsertScriptDialog';
import { activeEditor } from '../editor/insert/activeEditor';
import {
  recordSnapshotDurably,
  type PageSnapshot,
} from '../editor/history/pageHistory';
import {
  recordBookCheckpoint,
  restoreBookCheckpoint,
  type BookRecoverySnapshot,
} from '../editor/history/bookHistory';
import { getPageEditor } from '../editor/instances';
import {
  reversePaginationLegs,
  type PaginationUndoLeg,
} from '../editor/paginationUndo';
import {
  topLevelBlockAt,
  topLevelBlocksInRange,
} from '../editor/menu/blockOps';
import { clearJournalJump, pendingJournalJump } from '../editor/journal';
import { preparePageAssetsForDisplay } from '../editor/media/portableAssets';
import { notifySaved } from '../editor/saveIndicator';
import { docToScript } from '../editor/script/fromTiptap';
import { parseNotebookScriptPages } from '../editor/script/pageBoundaries';
import { scriptDocToTiptap } from '../editor/script/toTiptap';
import { exportActivePagePng } from '../editor/script/exporters/exportPage';
import { downloadNotebookScriptSpec } from '../editor/script/exporters/saveFile';
import { openExportPdfDialog } from '../features/templates/ExportPdfDialog';
import { openTemplatesGallery } from '../features/templates/TemplatesGallery';
import { countBook, countDoc } from '../editor/wordcount';
import FlipSurface, { type FlipSurfaceApi } from '../flip/FlipSurface';
import type { LeafSide } from '../flip/PageFlipController';
import type { FlipDirection } from '../flip/math';
import { planAheadSettlement } from '../flip/settleAhead';
import { play } from '../sound/engine';
import { LINGER_MS } from '../styles/motion';
import { useSearchJump } from '../search/jump';
import QuickSwitcher from '../features/quickswitch/QuickSwitcher';
import {
  bookStyleOverridesFor,
  resolveBookAppearance,
} from '../features/bookshelf/bookIdentity';
import {
  bookSurpriseHistoryFor,
  bookSurpriseLocksFor,
} from '../features/bookshelf/bookStudioPrefs';
import { prefsForBookcase } from '../features/bookshelf/libraryPrefs';
import { prefersReducedMotion } from '../features/bookshelf/env';
import {
  pulledBookCenterLayout,
  type PulledBookCenterLayout,
} from '../features/bookshelf/pulledBookGeometry';
import { paintPulledBookStatusMark } from '../features/bookshelf/pulledBookStatus';
import BookRail, { type RailPanelId } from './rail/BookRail';
import RailPanel from './rail/RailPanel';
import CustomizePanel from './rail/CustomizePanel';
import HistoryPanel from './rail/HistoryPanel';
import PageStylePanel from './rail/PageStylePanel';
import CataloguePanel from './rail/CataloguePanel';
import AiAgentPanel, {
  type AiAgentAttachmentView,
  type AiAgentConnectionView,
  type AiAgentContextView,
  type AiAgentController as AiAgentPanelController,
  type AiAgentKeySubmission,
  type AiAgentThreadView,
} from './rail/AiAgentPanel';
import {
  createAiAgentPanelController,
  type AiAgentPlacementOption,
} from './rail/aiAgentControllerAdapter';
import {
  agentSourceAttachmentMediaType,
  agentSourceMediaType,
} from '../features/aiAgent/attachmentIntake';
import SharePanel from './rail/SharePanel';
import TocPanel from './rail/TocPanel';
import FocusRail from './rail/FocusRail';
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
import { panelEdge } from './rail/panelPush';
import {
  DESK_ZOOM_REST,
  SPREAD_FIT_REST,
  retainInitialPageCapacity,
  appendBlocksToDoc,
  canFlipSpread,
  docHasContent,
  fitSpreadToRoom,
  leftSlot,
  mergePageOrderPreservingLiveDocs,
  newPageDoc,
  pagesToCreateOnFlip,
  prependBlocksToDoc,
  spreadOfSlot,
  spreadPageIds,
  stepDeskZoom,
  type SpreadFit,
  type SpreadIds,
} from './spread';
import '../styles/editor.css';
import '../styles/insert.css';
import '../styles/spread.css';
import '../styles/rail.css';
import '../styles/ai-agent.css';
import {
  TOUR_LAYER_SELECTOR,
  TOUR_STEP_ATTR,
  stepWatchVerdict,
} from '../features/tutorial';
import type {
  AgentContextPolicy,
  AiAgentController as CoreAiAgentController,
  NotebookInsertionTarget,
  NotebookPatchProposal,
  SourceAttachmentRef,
} from '../features/aiAgent';
import {
  AgentRuntime,
  CohereTauriAgentProvider,
  createAiAgentController,
  installAiAgentController,
  prepareBoundedProviderImage,
  randomAgentIds,
  systemAgentClock,
  webCryptoAgentHash,
} from '../features/aiAgent';
import {
  computeNotebookRevision,
  createProductionNotebookReadAdapter,
  notebookPageOrderExtendsSnapshot,
} from '../features/aiAgent/productionNotebook';
import { computeNotebookSelectionDigest } from '../features/aiAgent/selectionDigest';
import { createProductionSourceAdapters } from '../features/aiAgent/productionSources';
import { createProductionDraftSandbox } from '../features/aiAgent/draftSandbox';
import {
  prepareAiProposalApplication,
  jsonStorageCanonicalPageDoc,
  rollbackPreparedAiProposalAssets,
  verifyPreparedAiProposalDocuments,
  verifyPreparedAiProposalPlacement,
  type PreparedAiProposalApplication,
  type PreparedAiProposalPage,
  type ReviewedPagePlacement,
} from '../features/aiAgent/prepareProposal';
import {
  pendingManagedAiAttachmentsInState,
  SqliteAgentPersistence,
  type AgentTaskSummary,
} from '../data/aiAgentPersistence';
import {
  aiCredentialErrorMessage,
  aiCredentialStatus,
  saveAiCredential,
  testAiCredential,
} from '../data/aiCredentials';
import {
  deleteAiAttachment,
  readAiAttachment,
  saveAiAttachment,
  type AiAttachmentMetadata,
} from '../data/aiGateway';
import { OPEN_AI_AGENT_PANEL_EVENT } from '../editor/toolbar/aiRewrite';
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
};
const PaginatedPageEditor = PageEditor as (
  props: PaginatedPageEditorProps,
) => JSX.Element;

async function loadSession(source: {
  readonly bookId: string | null;
}): Promise<BookSession | null> {
  // A binding is stored outside the Book row. Resolve that small settings
  // book before publishing the reader session, otherwise an unusually fast
  // first open can paint the seed binding once and never revisit it after the
  // async design store finishes hydrating.
  await loadDesignPrefs();
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

  // An approved AI patch is a whole-book operation. If the app was stopped
  // between its durable claim and completion, restore the exact pre-apply
  // snapshot before a single affected page is mounted or indexed.
  await recoverIncompleteAiPatchApplications(book.id);
  const storedPages = await listPages(book.id);
  if (storedPages.length === 0) {
    storedPages.push(await createPage({ bookId: book.id }));
  }
  // Resolve the identity migration before the resource publishes this
  // session. Both PageEditor and the offscreen flip capture therefore receive
  // the same ids on their very first construction, rather than independently
  // minting ids one frame apart at the raster-to-DOM handoff.
  const identified = await preparePageRenderDocs(
    storedPages,
    persistPageDocIdentity,
  );
  const pages = await preparePageAssetsForDisplay(
    identified,
    persistPageDocIdentity,
  );
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
/** Safety net if an animation event is lost during a route or window change. */
const BOOK_CLOSE_FALLBACK_MS = 520;

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
  /**
   * Visual-QA ruler: render each authored page exactly as stored, without the
   * pagination drain moving its trailing blocks onward. This is dev-only and
   * opt-in (`?qa=no-pagination`); production books always paginate.
   *
   * The normal walk proves the final book is stable. This view answers the
   * diagnostic question the normal walk cannot once a cascade has begun:
   * which authored leaf was actually too tall before anything moved?
   */
  const qaNoPagination =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('qa') === 'no-pagination';

  /* Device-pixel density is presentation state, never document geometry.
   * Re-bake the fixed open-cover board when a window crosses monitors while
   * leaving the canonical 1334×920 layout untouched. */
  const dprBucket = (): number =>
    typeof window === 'undefined'
      ? 1
      : Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * 2) / 2));
  const [displayDpr, setDisplayDpr] = createSignal(dprBucket());
  onMount(() => {
    let query: MediaQueryList | null = null;
    const refresh = (): void => {
      setDisplayDpr(dprBucket());
      query?.removeEventListener('change', refresh);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      query.addEventListener('change', refresh);
    };
    refresh();
    window.addEventListener('resize', refresh);
    onCleanup(() => {
      window.removeEventListener('resize', refresh);
      query?.removeEventListener('change', refresh);
    });
  });

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
  const [scriptInsertionSettling, setScriptInsertionSettling] = createSignal(false);
  let scriptInsertionViewLock:
    | { readonly spread: number; readonly side: LeafSide }
    | null = null;
  interface ScriptInsertionUndoPage {
    readonly page: Page;
    readonly flowStart: boolean;
  }
  interface ScriptInsertionUndoCheckpoint {
    readonly bookId: string;
    readonly pages: readonly ScriptInsertionUndoPage[];
    readonly spread: number;
    readonly side: LeafSide;
  }
  let scriptInsertionBefore: ScriptInsertionUndoCheckpoint | null = null;
  let scriptInsertionUndo: ScriptInsertionUndoCheckpoint | null = null;
  let scriptInsertionUndoKey: string | null = null;
  let restoringScriptInsertion = false;
  // The browser-only documentation film edits one inserted paragraph before
  // restoring its exact checkpoint. Keep that deliberate edit from consuming
  // the same one-shot Undo receipt the fixture needs for cleanup.
  let aiDemoInsertionActive = false;
  const [aiPatchApplying, setAiPatchApplying] = createSignal(false);

  const clonePage = (page: Page): Page =>
    JSON.parse(JSON.stringify(page)) as Page;

  const captureScriptInsertionCheckpoint = async (
    bookId: string,
  ): Promise<ScriptInsertionUndoCheckpoint> => {
    const snapshot = pages().map((page) => {
      const live = getPageEditor(page.id);
      return clonePage({
        ...page,
        doc: live === null ? page.doc : (live.getJSON() as PageDoc),
      });
    });
    const flowStarts = await Promise.all(
      snapshot.map((page) => isPageFlowStart(page.id)),
    );
    return {
      bookId,
      pages: snapshot.map((page, index) => ({
        page,
        flowStart: flowStarts[index] ?? false,
      })),
      spread: spreadIndex(),
      side: focusedSide(),
    };
  };

  const setScriptInsertionActivity = async (
    active: boolean,
    /**
     * `undefined` preserves the manual Insert Script contract: settle every
     * populated spread. The AI path supplies the immutable reviewed page ids,
     * because its sandbox already paginated every final leaf and applying one
     * reviewed page must not remount an unrelated 48-page notebook.
     */
    settlePageIds?: readonly string[],
  ): Promise<void> => {
    if (active) {
      setScriptInsertionSettling(false);
      scriptInsertionViewLock ??= {
        spread: spreadIndex(),
        side: focusedSide(),
      };
      const bookId = session()?.book.id;
      if (bookId !== undefined && scriptInsertionBefore === null) {
        scriptInsertionBefore = await captureScriptInsertionCheckpoint(bookId);
      }
      return;
    }
    const home = scriptInsertionViewLock;
    if (home === null) return;
    /*
     * Import creates protected destinations, and most of them are offscreen.
     * Waiting only for the opening spread's carry chain is not sufficient: an
     * offscreen read-only reconstruction is close enough for a flip picture,
     * but custom node views, editable code and display maths do not always
     * occupy exactly the same height as the real PageEditor. Opening such a
     * page later can split it, insert a spill before the next protected section
     * and shift every later ordinal. The reader then sees a complete section
     * on the staged page and the same section again after it moves forward.
     *
     * While the insertion overlay still owns navigation, silently mount the
     * affected spreads through the REAL editor and let their transactions,
     * ResizeObservers and overflow callbacks settle. Manual Script insertion
     * still requests the whole populated book because an imported section may
     * repaginate existing pages; an AI receipt already contains final native
     * leaves, so it names only the reviewed destinations. Repeat until a
     * complete scoped sweep leaves those documents unchanged.
     */
    const scopedPageIds = settlePageIds === undefined
      ? null
      : new Set(settlePageIds);
    const pagesInScope = (): readonly Page[] =>
      pages().filter((page) =>
        docHasContent(page.doc) &&
        (scopedPageIds === null || scopedPageIds.has(page.id)),
      );
    const pageSignature = (): string =>
      pagesInScope()
        .map(
          (page) =>
            `${page.id}:${JSON.stringify(page.doc, (key, value) =>
              key === 'id' || key === 'blockId' ? undefined : value,
            )}`,
        )
        .join('|');
    flipApi?.suspendSnapshots();
    setScriptInsertionSettling(true);
    try {
      // Give Solid one committed paint before visiting offscreen spreads. The
      // verification sweep is deliberately real, but its temporary navigation
      // belongs to the insertion transaction—not to the reader.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      for (let sweep = 0; sweep < 4; sweep += 1) {
        await carryChain;
        const before = pageSignature();
        const targetSpreads = scopedPageIds === null
          ? (() => {
              const lastContentSlot = pages().reduce(
                (last, page, slot) => (docHasContent(page.doc) ? slot : last),
                0,
              );
              return Array.from(
                { length: spreadOfSlot(lastContentSlot) + 1 },
                (_, index) => index,
              );
            })()
          : [...new Set(
              pages()
                .map((page, slot) =>
                  scopedPageIds.has(page.id) ? spreadOfSlot(slot) : -1,
                )
                .filter((spread) => spread >= 0),
            )].sort((left, right) => left - right);
        for (const target of targetSpreads) {
          setSpreadIndex(target);
          // Solid mounts the leaves on the first frame; custom node views and
          // their observers settle over the following frames.
          for (let frame = 0; frame < 2; frame += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            await carryChain;
          }
        }
        await carryChain;
        if (carryPending === 0 && pageSignature() === before) break;
      }
    } finally {
      // Requests made while visiting temporary spreads are useless once the
      // view returns home. The home-spread effect immediately warms its real
      // neighbours after the index is restored below.
      flipApi?.resumeSnapshots(true);
      scriptInsertionViewLock = null;
      setSpreadIndex(home.spread);
      setFocusedSide(home.side);
      // Let the restored live leaves commit before uncovering them. Without
      // this paint boundary the reader can glimpse the final internal
      // verification spread even though navigation never belonged to them.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setScriptInsertionSettling(false);
    }
  };

  const armScriptInsertionUndo = (): void => {
    scriptInsertionUndo = scriptInsertionBefore;
    scriptInsertionBefore = null;
  };

  /** A later authored/structural edit makes the one-shot AI rollback stale. */
  const clearScriptInsertionUndo = (): void => {
    scriptInsertionUndo = null;
    const key = scriptInsertionUndoKey;
    scriptInsertionUndoKey = null;
    if (key !== null) void forgetAiPatchApplication(key);
  };

  const restoreScriptInsertion = async (silent = false): Promise<boolean> => {
    const checkpoint = scriptInsertionUndo;
    if (checkpoint === null || restoringScriptInsertion) return false;
    if (session()?.book.id !== checkpoint.bookId) {
      clearScriptInsertionUndo();
      return false;
    }
    scriptInsertionUndo = null;
    restoringScriptInsertion = true;
    // Freeze live editors and structural commands synchronously. Otherwise a
    // user edit could invalidate the applied receipt in the await before its
    // durable `undoing` transition.
    setAiPatchApplying(true);
    const journalKey = scriptInsertionUndoKey;
    let journalMode: 'none' | 'apply_rollback' | 'undo' = 'none';
    try {
      await appendLane;
      await carryChain;
      if (journalKey !== null) {
        const durable = await readAiPatchApplication(journalKey);
        if (durable?.status === 'applying') {
          // A failed proposal apply already wrote its rollback authority before
          // mutating. Restore it without pretending this is a reader Undo.
          journalMode = 'apply_rollback';
        } else {
          // Ctrl+Z becomes durable before its very first page mutation. A stop
          // anywhere below leaves an `undoing` row that startup replays.
          const undo = await beginAiPatchUndo(journalKey);
          if (undo.bookId !== checkpoint.bookId) {
            throw new Error('The AI Undo receipt belongs to another notebook');
          }
          journalMode = 'undo';
        }
      }
      const keep = new Set(checkpoint.pages.map(({ page }) => page.id));
      const current = await listPages(checkpoint.bookId);
      for (const page of current) {
        if (!keep.has(page.id)) await deletePage(page.id);
      }
      for (const saved of checkpoint.pages) {
        await restorePageSnapshot(saved.page);
        await setPageFlowStart(saved.page.id, saved.flowStart);
      }
      const restored = await listPages(checkpoint.bookId);
      setPages(restored);
      for (const page of restored) {
        getPageEditor(page.id)?.commands.setContent(
          page.doc as unknown as JSONContent,
          { emitUpdate: false },
        );
      }
      setSpreadIndex(
        Math.min(checkpoint.spread, Math.max(0, spreadOfSlot(restored.length - 1))),
      );
      setFocusedSide(checkpoint.side);
      flipApi?.invalidateSnapshots();
      if (journalKey !== null) {
        if (journalMode === 'apply_rollback') {
          await releaseAiPatchApplication(journalKey);
        } else if (journalMode === 'undo') {
          await completeAiPatchUndo(journalKey);
        }
      }
      scriptInsertionUndoKey = null;
      if (!silent) notify('script insertion undone');
      return true;
    } catch (error) {
      // Keep the exact checkpoint and durable receipt available for another
      // Ctrl+Z or restart rather than turning a recoverable storage failure
      // into a lost Undo action.
      scriptInsertionUndo = checkpoint;
      notify(
        error instanceof Error ? error.message : 'Could not restore the notebook yet',
        'error',
      );
      return false;
    } finally {
      restoringScriptInsertion = false;
      setAiPatchApplying(false);
    }
  };

  onMount(() => {
    const onBookUndo = (event: KeyboardEvent): void => {
      const ordinaryPaginatedUndo =
        event.key.toLowerCase() === 'z' &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        canUndoPaginatedEdit();
      if (ordinaryPaginatedUndo) {
        void undoPaginatedEdit(event);
        return;
      }
      if (
        scriptInsertionUndo === null ||
        event.key.toLowerCase() !== 'z' ||
        (!event.ctrlKey && !event.metaKey) ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void restoreScriptInsertion();
    };
    document.addEventListener('keydown', onBookUndo, true);
    onCleanup(() => document.removeEventListener('keydown', onBookUndo, true));
  });

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
        // Hydrate from the same resolved appearance the shelf and pull-out use.
        // A Welcome-style `cover_meta.style` without a duplicated `cover`
        // section used to fall through to a fresh random board here.
        const appearance = resolveBookAppearance(
          loaded.book,
          getTheme(prefsForBookcase(bookcaseOf(loaded.book)).theme),
          { pageCount: readShelfMeta(loaded.book)?.pageCount },
        );
        const canonicalCover: CoverOverrides & { seed?: number } = {
          ...appearance.cover,
        };
        delete canonicalCover.seed;
        setCoverOverrides(canonicalCover);
        setPageDefaults(readPageDefaults(loaded.book));

        // A completed AI insertion keeps one durable whole-book Ctrl+Z
        // receipt. Rehydrate it only while the notebook still exactly equals
        // the recorded post-apply revision; any later edit invalidates it.
        void (async () => {
          const applied = await latestAppliedAiPatch(loaded.book.id);
          if (applied === null || session()?.book.id !== loaded.book.id) return;
          const revision = await computeNotebookRevision(loaded.pages);
          if (
            applied.resultRevision === null ||
            applied.resultRevision !== revision
          ) {
            await forgetAiPatchApplication(applied.idempotencyKey);
            return;
          }
          scriptInsertionUndo = {
            bookId: applied.before.bookId,
            pages: applied.before.pages,
            spread: 0,
            side: 'left',
          };
          scriptInsertionUndoKey = applied.idempotencyKey;
        })();
      }
    }),
  );

  // Whole-book history is deliberately independent of page autosaves. The
  // recorder deep-copies immediately, deduplicates, throttles and serializes
  // its durable writes; this reactive seam therefore also catches structural
  // page insert/delete/reorder changes, not only prose transactions.
  createEffect(() => {
    const loaded = session();
    const current = pages();
    if (loaded != null && current.length > 0) {
      void recordBookCheckpoint(loaded.book.id, current, {
        enabled: settings.protectedHistoryEnabled,
      }).catch(() => undefined);
    }
  });

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

  /** A later authored edit supersedes the one-shot whole-import checkpoint. */
  const handlePageDocChange = (pageId: string, doc: PageDoc): void => {
    if (
      !aiPatchApplying() &&
      !restoringScriptInsertion &&
      !aiDemoInsertionActive &&
      scriptInsertionViewLock === null
    ) {
      clearScriptInsertionUndo();
    }
    updatePageDoc(pageId, doc);
  };

  /**
   * Refresh durable ordinals without resurrecting an editor's older document.
   *
   * A live overflow drain publishes its trimmed source to `pages()`
   * synchronously, then saves SQLite on the editor debounce. If that overflow
   * meets a protected boundary, inserting the spill shifts ordinals and needs
   * a fresh ordered row list immediately. Replacing `pages()` wholesale with
   * that list used to bring the pre-drain SQLite document back during the
   * debounce window. The remounted source then emitted the same tail again,
   * duplicating an entire section under a second page id.
   *
   * Storage owns row order and metadata; the in-memory editor mirror owns the
   * newest document for every row already present.
   */
  const refreshPageOrderPreservingLiveDocs = async (
    bookId: string,
  ): Promise<void> => {
    const ordered = await listPages(bookId);
    setPages((current) => mergePageOrderPreservingLiveDocs(ordered, current));
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
   * Empty pages at the very end of the book. Kept for the pure spread helpers
   * and imported-book repair path; navigation readiness itself is based on the
   * concrete styled destination slots below, never on how many blanks exist.
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

  const canFlip = (direction: FlipDirection): boolean => {
    if (aiPatchApplying()) return false;
    if (
      !canFlipSpread(
        pages().length,
        spreadIndex(),
        direction,
        rightHasContent(),
        trailingBlanks(),
      )
    ) {
      return false;
    }
    if (direction === 'prev') return true;

    /*
     * A forward turn is armed only after BOTH destination leaves exist with
     * their inherited page docs. Previously `canFlipSpread` allowed the turn
     * first and `onNavigate` inserted those rows afterwards, so the curl had
     * no styled snapshots and the landed spread was cream-white until SQLite
     * and PageEditor caught up. The reserve below normally keeps this true;
     * the guard closes the tiny race when a reader turns unusually quickly.
     */
    const destinationLeft = leftSlot(spreadIndex() + 1);
    return pages().length >= destinationLeft + 2;
  };

  // -------------------------------------------------------------------------
  // Page creation ("+ page" rail tool + auto-create on forward flip)
  // -------------------------------------------------------------------------
  /*
   * One append lane for every producer in this view: end-of-book turns, the
   * rail button, blank-leaf clicks and pagination overflow. `createPage`
   * derives ord from SQLite, so two independent awaits can otherwise read the
   * same last ord before either INSERT lands. Chaining here keeps arbitrary
   * blank-page growth safe without making each caller know about the others.
   * A rejection is swallowed only by the lane tail, not by the caller, so the
   * current action still receives its real error and later appends may proceed.
   */
  let appendLane: Promise<void> = Promise.resolve();
  const appendPage = (): Promise<Page | null> => {
    const bookId = session()?.book.id;
    if (!bookId) return Promise.resolve(null);
    const pending = appendLane.then(async (): Promise<Page | null> => {
      if (session()?.book.id !== bookId) return null;
      const created = await createPage({
        bookId,
        doc: newPageDoc(bookPageStyle(), bookLineHeight()),
      });
      // A route change may finish while SQLite is inserting into the old book.
      // Keep that valid row there, but never publish it into another session.
      if (session()?.book.id === bookId) {
        setPages((prev) => [...prev, created]);
      }
      return created;
    });
    appendLane = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  const insertPagesAfter = (
    anchorId: string,
    additions: readonly {
      source: string;
      doc: PageDoc;
      protectedStart: boolean;
    }[],
  ): Promise<readonly string[]> => {
    const pending = appendLane.then(async () => {
      let after = anchorId;
      const insertedIds: string[] = [];
      const reusedMountedPages: { id: string; doc: PageDoc }[] = [];
      for (const addition of additions) {
        const bookId = session()?.book.id;
        const ordered = bookId ? await listPages(bookId) : [];
        const anchorIndex = ordered.findIndex((page) => page.id === after);
        const reusable = anchorIndex >= 0 ? ordered[anchorIndex + 1] : undefined;
        let destination: Page | null = null;
        if (
          reusable !== undefined &&
          !docHasContent(reusable.doc) &&
          reusable.scriptSource === null
        ) {
          // A fresh book already has blank leaves. Reusing them avoids moving
          // those empty starter pages to the tail of a multi-page import.
          destination = await setPageScript(
            reusable.id,
            addition.source,
            addition.doc,
          );
          reusedMountedPages.push({ id: reusable.id, doc: addition.doc });
        } else {
          destination = await insertPageAfter(after, {
            doc: addition.doc,
            scriptSource: addition.source,
          });
        }
        if (destination === null) break;
        await setPageFlowStart(destination.id, addition.protectedStart);
        after = destination.id;
        insertedIds.push(destination.id);
      }
      const bookId = session()?.book.id;
      if (bookId) setPages(await listPages(bookId));
      /*
       * Reusing a blank starter leaf updates SQLite and the reactive page
       * row, but the already-mounted TipTap instance owns its own document.
       * Without this explicit handoff the stored right page contains the
       * section while the open book continues to show bare paper until that
       * leaf is unmounted and revisited. Hydrate only after every protected
       * destination exists, so a large reused section cannot overflow before
       * the following anchors have been installed.
       */
      for (const reused of reusedMountedPages) {
        getPageEditor(reused.id)?.commands.setContent(
          reused.doc as unknown as JSONContent,
          {
            emitUpdate: false,
          },
        );
      }
      return insertedIds;
    });
    appendLane = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  /**
   * Insert an authored run directly before one page while preserving its
   * order. Each INSERT lands immediately before the same anchor, so walking
   * forward yields A, B, C, anchor.
   */
  const insertPagesBefore = (
    anchorId: string,
    additions: readonly PreparedAiProposalPage[],
  ): Promise<readonly string[]> => {
    const pending = appendLane.then(async () => {
      const insertedIds: string[] = [];
      for (const addition of additions) {
        const destination = await insertPageBefore(anchorId, {
          doc: addition.doc,
          scriptSource: addition.source,
        });
        if (destination === null) {
          throw new Error('The insertion page no longer exists');
        }
        await setPageFlowStart(destination.id, addition.protectedStart);
        insertedIds.push(destination.id);
      }
      const bookId = session()?.book.id;
      if (bookId !== undefined) setPages(await listPages(bookId));
      return insertedIds;
    });
    appendLane = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };

  let flipApi: FlipSurfaceApi | undefined;

  const addPage = async (): Promise<void> => {
    if (aiPatchApplying()) return;
    clearScriptInsertionUndo();
    const slotOfNew = pages().length;
    const created = await appendPage();
    if (!created) return;
    // A paper ribbon is visually self-confirming. It deliberately makes no
    // sound: the old pitched pop/tong was more intrusive than useful.
    const target = spreadOfSlot(slotOfNew);
    if (target === spreadIndex() + 1) {
      flipApi?.flipNext(); // one spread ahead — arrive with the flip animation
    } else if (target !== spreadIndex()) {
      setSpreadIndex(target);
    }
    // target === current spread: the new page simply appears on the right leaf.
  };

  /**
   * Create a styled blank leaf beside an existing page and land on it.
   *
   * This shares `appendLane` with overflow, script boundaries, forward-turn
   * reserves and the rail's append action. Without that one lane, a right-click
   * insertion racing pagination can shift the same ordinals twice and leave
   * two pages claiming one position.
   */
  const insertBlankPageBeside = async (
    anchorId: string,
    side: 'before' | 'after',
  ): Promise<void> => {
    if (aiPatchApplying()) return;
    clearScriptInsertionUndo();
    const bookId = session()?.book.id;
    if (!bookId) return;
    const doc = newPageDoc(bookPageStyle(), bookLineHeight());
    const pending = appendLane.then(async (): Promise<Page | null> => {
      if (session()?.book.id !== bookId) return null;
      const created =
        side === 'before'
          ? await insertPageBefore(anchorId, { doc })
          : await insertPageAfter(anchorId, { doc });
      if (created !== null && session()?.book.id === bookId) {
        await refreshPageOrderPreservingLiveDocs(bookId);
      }
      return created;
    });
    appendLane = pending.then(
      () => undefined,
      () => undefined,
    );

    const created = await pending.catch(() => null);
    if (created === null) {
      notify('could not add that page', 'error');
      return;
    }
    setSpreadIndex(spreadOfSlot(created.ord));
    setFocusedSide(created.ord % 2 === 0 ? 'left' : 'right');
    flipApi?.invalidateSnapshots();
    notify(side === 'before' ? 'page added before' : 'page added after');
  };

  let backwardMoveOverflowTarget:
    | { readonly pageId: string; overflowed: boolean }
    | null = null;

  /**
   * Pull one block, or every complete block touched by a retained selection,
   * into the previous leaf in one all-or-nothing page transaction.
   */
  const moveBlockToPreviousPage = (
    pageId: string,
    editor: Editor,
    pos: number,
    selectionRange?: { readonly from: number; readonly to: number },
  ): void => {
    if (aiPatchApplying()) return;
    clearScriptInsertionUndo();
    const slot = pages().findIndex((page) => page.id === pageId);
    if (slot <= 0) return;
    const selected =
      selectionRange === undefined
        ? (() => {
            const block = topLevelBlockAt(editor, pos);
            return block === null
              ? []
              : [
                  ...topLevelBlocksInRange(editor, {
                    from: block.pos,
                    to: block.pos + block.node.nodeSize,
                  }),
                ];
          })()
        : [...topLevelBlocksInRange(editor, selectionRange)];
    if (selected.length === 0) return;
    const previous = pages()[slot - 1];
    if (previous === undefined) return;
    const first = selected[0]!;
    const last = selected[selected.length - 1]!;
    const deleteFrom = first.pos;
    const deleteTo = last.pos + last.node.nodeSize;
    const sourceBefore = editor.getJSON() as PageDoc;
    const sourceBeforeKey = JSON.stringify(sourceBefore);
    const sourceAfter = editor.state.tr.delete(deleteFrom, deleteTo).doc.toJSON() as PageDoc;
    const moved = selected.map((block) => block.node.toJSON());
    const sourceSpread = spreadOfSlot(slot);
    const targetSpread = spreadOfSlot(slot - 1);
    const relativeSelection =
      selectionRange === undefined
        ? null
        : {
            from: selectionRange.from - deleteFrom,
            to: selectionRange.to - deleteFrom,
          };

    if (targetSpread !== spreadIndex()) setSpreadIndex(targetSpread);
    setFocusedSide((slot - 1) % 2 === 0 ? 'left' : 'right');

    withPageEditor(previous.id, (destination) => {
      // The mounted editor is the newest source of truth. TipTap may normalize
      // its initial document (for example by materializing a trailing writing
      // paragraph) before that harmless change reaches the page mirror. Using
      // only `pages()` here made an untouched non-first block look stale and
      // rejected every backward move. If the source leaf unmounted while we
      // chased the destination, fall back to the synchronous page mirror.
      const mountedSource = getPageEditor(pageId);
      const currentSource = mountedSource?.view.dom.isConnected
        ? mountedSource.getJSON() as PageDoc
        : pages().find((page) => page.id === pageId)?.doc;
      if (
        currentSource === undefined ||
        JSON.stringify(currentSource) !== sourceBeforeKey
      ) {
        notify('that selection changed before it could move', 'error');
        return;
      }
      // Do not reject from a cloned DOM measurement. Custom node views such
      // as cards can carry wrapper geometry that changes when reparented, so
      // the clone can claim a half-empty previous page is full. The real
      // provisional transaction below runs PageEditor's synchronous overflow
      // drain and rolls both complete documents back before paint if anything
      // actually spills; that is the authoritative, atomic fit decision.

      const fallbackAttrs: Record<string, unknown> = {
        pageStyle: bookPageStyle(),
      };
      const line = bookLineHeight();
      if (line !== undefined) fallbackAttrs.lineHeightPx = line;
      const destinationBefore = destination.getJSON() as PageDoc;
      const merged = appendBlocksToDoc(destinationBefore, moved, fallbackAttrs);
      let insertedAt = 0;
      try {
        const mergedNode = destination.schema.nodeFromJSON(merged);
        insertedAt = mergedNode.content.size;
        for (const json of moved) {
          insertedAt -= destination.schema.nodeFromJSON(json).nodeSize;
        }
      } catch {
        insertedAt = destination.state.doc.content.size;
      }

      /*
       * Let the real destination editor make the final capacity decision in
       * this same JavaScript task. Node views can finish intrinsic sizing only
       * in their real destination, so suppress that one overflow carry while
       * the transaction is provisional: if PageEditor peels anything, restore
       * both complete pre-move documents before paint. This is the
       * authoritative all-or-nothing guard; without it a late image/math size
       * could put two selected blocks back while leaving the first one moved.
       */
      const liveSource = getPageEditor(pageId);
      if (liveSource?.view.dom.isConnected) {
        liveSource.view.dispatch(
          liveSource.state.tr
            .delete(deleteFrom, deleteTo)
            .setMeta('addToHistory', false),
        );
      }
      backwardMoveOverflowTarget = {
        pageId: previous.id,
        overflowed: false,
      };
      try {
        const mergedNode = destination.schema.nodeFromJSON(merged);
        destination.view.dispatch(
          destination.state.tr
            .replaceWith(
              0,
              destination.state.doc.content.size,
              mergedNode.content,
            )
            .setMeta('addToHistory', false),
        );
      } catch {
        backwardMoveOverflowTarget.overflowed = true;
      }
      const overflowed = backwardMoveOverflowTarget.overflowed;
      backwardMoveOverflowTarget = null;
      if (overflowed) {
        const destinationNode = destination.schema.nodeFromJSON(destinationBefore);
        destination.view.dispatch(
          destination.state.tr
            .replaceWith(
              0,
              destination.state.doc.content.size,
              destinationNode.content,
            )
            .setMeta('addToHistory', false),
        );
        if (liveSource?.view.dom.isConnected) {
          const sourceNode = liveSource.schema.nodeFromJSON(sourceBefore);
          liveSource.view.dispatch(
            liveSource.state.tr
              .replaceWith(
                0,
                liveSource.state.doc.content.size,
                sourceNode.content,
              )
              .setMeta('addToHistory', false),
          );
        }
        updatePageDoc(pageId, sourceBefore);
        updatePageDoc(previous.id, destinationBefore);
        notify(
          selected.length === 1
            ? 'that block does not fit on the previous page'
            : 'that selection does not fit on the previous page',
          'error',
        );
        if (sourceSpread !== spreadIndex()) setSpreadIndex(sourceSpread);
        setFocusedSide(slot % 2 === 0 ? 'left' : 'right');
        if (selectionRange !== undefined) {
          withPageEditor(pageId, (source) => {
            source
              .chain()
              .focus()
              .setTextSelection(selectionRange)
              .run();
          });
        }
        return;
      }

      // Publish both halves in one task. The source may have unmounted while
      // the destination was being mounted; the mirror still receives its
      // prepared deletion before either save is allowed onto appendLane.
      updatePageDoc(pageId, sourceAfter);
      updatePageDoc(previous.id, merged);
      // The destination is live by construction and already owns `merged`.
      // A source on the adjacent spread may have unmounted while we chased the
      // destination; remount only that absent leaf from its updated mirror.
      if (!liveSource?.view.dom.isConnected) bumpDocVersion(pageId);
      flipApi?.invalidateSnapshots();

      const pending = appendLane.then(async () => {
        await savePageDoc(pageId, sourceAfter);
        await savePageDoc(previous.id, merged);
      });
      appendLane = pending.then(
        () => undefined,
        () => undefined,
      );

      withPageEditor(previous.id, (instance) => {
        if (relativeSelection === null) {
          instance.commands.focus('end');
          return;
        }
        const size = instance.state.doc.content.size;
        const from = Math.max(0, Math.min(insertedAt + relativeSelection.from, size));
        const to = Math.max(from, Math.min(insertedAt + relativeSelection.to, size));
        instance.chain().focus().setTextSelection({ from, to }).run();
      });
      notify(
        selected.length === 1
          ? 'block moved to the previous page'
          : `${selected.length} blocks moved to the previous page`,
      );
    });
  };

  /**
   * KEEP TWO COMPLETE, ALREADY-STYLED SPREADS STANDING AHEAD OF THE READER.
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
   * Finite by construction: the target is based on the current spread, not on
   * the total number of trailing blank documents. Counting trailing blanks was
   * the subtle bug here: once a book had four empty pages it looked "stocked"
   * forever, even after the reader had walked onto the last pair. Advancing one
   * spread moves this fixed window and creates only the next pair.
   *
   * Two spreads rather than one give the offscreen raster cache time to capture
   * the selected ruling before even a fast second turn. `appendPage` stamps the
   * book's current page style and line height into every reserved document.
   */
  const READY_SPREADS_AHEAD = 2;
  let stocking = false;
  createEffect(() => {
    const count = pages().length;
    const here = spreadIndex();
    if (!session()) return;
    // The AI apply temporarily visits its reviewed destination spreads while
    // holding the book mutation lock. Those visits are verification, not
    // reader navigation: stocking from them both bloats the transaction and
    // changes the very page order being proved. The effect reruns when the
    // lock drops and fills the real reader position normally.
    if (aiPatchApplying()) return;
    if (stocking) return;

    const readyThrough = here + READY_SPREADS_AHEAD;
    const targetCount = leftSlot(readyThrough) + 2;
    const wanted = Math.max(0, targetCount - count);
    if (wanted === 0) return;

    stocking = true;
    void (async () => {
      try {
        // Await each request so this reserve grows deterministically. The
        // shared append lane also serializes it against every other producer.
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
      // Defensive repair for an imported/corrupt sparse book. Normal pointer
      // navigation cannot enter this branch because `canFlip` waits for the
      // styled destination reserve above.
      void (async () => {
        for (let i = 0; i < toCreate; i += 1) await appendPage();
      })();
    }
    setSpreadIndex((index) =>
      Math.max(0, index + (direction === 'next' ? 1 : -1)),
    );
    void play('page-flip');
  };

  // -------------------------------------------------------------------------
  // Pagination — capacity measurement + overflow carry (see module docblock)
  // -------------------------------------------------------------------------
  const [pageCapacity, setPageCapacity] = createSignal(0);

  /**
   * The capacity is in LAID-OUT pixels, and nothing about a scale may enter it.
   *
   * The two numbers the drain compares have to be in the same units, and there
   * were two ways to arrange that. This used to convert the CAPACITY into drawn
   * px — multiply the laid-out height by `visualScale` — because PageEditor
   * measures block bottoms with `getBoundingClientRect()`, which reports the
   * glass. It fixed the unit mismatch and introduced a worse one, because
   * neither `clientHeight` nor `Math.floor` survives being multiplied by a
   * scale:
   *
   *     capacity = floor(laidOut × s)
   *
   * is not proportional to `s`. At s = 1 a 761px leaf floors to 760; at
   * s = 0.7913 it floors to 602, which is 760.8 laid-out px. So opening a rail
   * sheet changed what fits on the page by half a pixel — measured, on every
   * spread of the Welcome book (`scripts/probe-panel-repaginate.mjs`), and by
   * up to ~3px at `MIN_SPREAD_SCALE`. Half a pixel is nothing until a page has
   * been drained to its boundary, which is exactly what the drain leaves
   * behind: on the demo recording the card "What a card is for" sat with its
   * foot ON the padding line and vanished six frames after the "Customize this
   * book" sheet slid in, evicted to the next page, permanently — the contract
   * peels forward and never pulls back.
   *
   * `styles/spread.css`, `styles/rail.css` and `views/spread.ts` all promise in
   * as many words that a sheet answers the room it takes with a TRANSFORM so
   * that "the leaf's layout box — and therefore where every word sits and how
   * many fit — is untouched". A capacity built out of a scale cannot keep that
   * promise however carefully it is rounded.
   *
   * So the conversion goes the other way now: this stays a pure layout number
   * and `PageEditor.extractOverflow` divides its rect distances by the leaf's
   * scale before comparing. The residual error there (a `clientHeight` rounded
   * to a whole pixel) is a CONSTANT — it does not depend on `s` — so the
   * drain's verdict is identical at every scale, which is the property that
   * actually matters. `probe-panel-repaginate.mjs` gates it at 0.00px.
   */
  const measureCapacity = (paper: HTMLElement): void => {
    const styles = getComputedStyle(paper);
    const laidOut =
      paper.clientHeight -
      (Number.parseFloat(styles.paddingTop) || 0) -
      (Number.parseFloat(styles.paddingBottom) || 0);
    // The first settled paper box owns pagination for this open session.
    // Resizing the window changes the responsive leaf box, but that is a
    // camera/layout concern, not an edit. Updating this signal on every
    // ResizeObserver delivery used to invoke PageEditor's forward-only drain
    // and permanently push blocks onto later pages; enlarging the window had
    // no inverse operation with which to repair them.
    setPageCapacity((current) => retainInitialPageCapacity(current, laidOut));
  };

  /*
   * THERE IS NO "re-measure once the scale settles" ANY MORE, and its absence
   * is the point.
   *
   * A scale-settle re-measure used to hang off `fitSpread`, because the
   * capacity was quoted in drawn px and a sliding sheet therefore moved it.
   * With the capacity back in laid-out px there is nothing for a transform to
   * move: `clientHeight` and a computed padding are what they were before the
   * sheet opened. Every way the number CAN change is a change to the paper's
   * own layout box, and `capacityObserver` below is already watching exactly
   * that — a window resize, the stage remounting with a book, a focus rung
   * altering the stage's laid-out width.
   *
   * Keeping the call "just in case" would have kept a panel wired to the
   * reader's pagination for no reason, and that wire is the defect: it also
   * cost a forced layout per leaf per slide (118 ms of self time, profiled,
   * the largest single cost in a panel open).
   */
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
  let roomCache: {
    room: { left: number; right: number };
    width: number;
    height: number;
    availableHeight: number;
    gap: number;
  } | null = null;
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
        height: stage.offsetHeight,
        availableHeight:
          box.height -
          (Number.parseFloat(styles.paddingTop) || 0) -
          (Number.parseFloat(styles.paddingBottom) || 0),
        // One source for the gutter between sheet and book: the same token the
        // back arrow and the settings seal clear the sheet by.
        gap: Number.parseFloat(styles.getPropertyValue('--space-16')) || 16,
      };
    }
    const { room, width, height, availableHeight } = roomCache;
    const centre = (room.left + room.right) / 2;
    // panelPush's own reader: the INLINE property, not a cascade resolution.
    // This line runs on every frame of the panel tween, and asking
    // `getComputedStyle(document.documentElement)` for one custom property
    // recomputes every property on <html> first — 227ms per panel open,
    // measured, which is the frame-rate drop that was reported.
    const edge = panelEdge();
    const gap = roomCache.gap;

    const next = fitSpreadToRoom(
      { left: centre - width / 2, right: centre + width / 2 },
      room,
      edge,
      gap,
      height > 0 ? availableHeight / height : 1,
    );
    if (next.shift === lastFit.shift && next.scale === lastFit.scale) return;
    lastFit = next;
    setSpreadFit(next);
    // …and NOTHING about the pagination is touched from here. The leaf is drawn
    // at a different size; its layout box, and therefore what fits on it, is
    // the same box it was. See measureCapacity, and the note above
    // `capacityObserver` for what used to be on this line.
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

  /*
   * OPENING IS A TWO-OWNER TRANSACTION.
   *
   * The shelf's focused cover is already a complete, painted frame. Keep it
   * on the glass while this view does its expensive first TipTap mounts. Once
   * the expected live editors exist, wait for bundled fonts and two animation
   * frames: the first gives Chromium a real paint opportunity for the spread
   * under the cover, the second atomically hands visual ownership to it via
   * appState.readerReady. No arbitrary delay and no empty ruled placeholder.
   */
  let readerReadyFrame = 0;
  let readerReadyGeneration = 0;
  createEffect(
    on(session, (loaded) => {
      const generation = ++readerReadyGeneration;
      if (!loaded) return;
      const publish = (): void => {
        if (generation !== readerReadyGeneration) return;
        const stage = stageElement;
        const expectedEditors = Number(leftPage() !== null) + Number(rightPage() !== null);
        const mountedEditors = stage?.querySelectorAll('.nb-page-editor .ProseMirror').length ?? 0;
        if (stage === undefined || mountedEditors < expectedEditors) {
          readerReadyFrame = requestAnimationFrame(publish);
          return;
        }
        void document.fonts.ready.then(() => {
          if (generation !== readerReadyGeneration) return;
          readerReadyFrame = requestAnimationFrame(() => {
            if (generation !== readerReadyGeneration) return;
            readerReadyFrame = requestAnimationFrame(() => {
              if (generation !== readerReadyGeneration) return;
              appState.markReaderReady(loaded.book.id);
            });
          });
        });
      };
      queueMicrotask(publish);
      onCleanup(() => {
        readerReadyGeneration += 1;
        if (readerReadyFrame !== 0) cancelAnimationFrame(readerReadyFrame);
        readerReadyFrame = 0;
      });
    }),
  );

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
  let carryPending = 0;
  let carryRevision = 0;
  interface PaginationUndoReceipt {
    readonly token: string;
    readonly sourcePageId: string;
    readonly historyDepth: number;
    readonly beforeDoc: PageDoc;
    readonly afterAuthoredDoc: PageDoc;
    readonly bookBefore: readonly Page[];
    readonly legs: PaginationUndoLeg[];
  }
  const paginationUndoReceipts: PaginationUndoReceipt[] = [];
  const latestPaginationUndoReceipt = (): PaginationUndoReceipt | null =>
    paginationUndoReceipts.length === 0
      ? null
      : paginationUndoReceipts[paginationUndoReceipts.length - 1]!;
  const pendingPaginationOrigins = new Map<string, PaginationUndoOrigin>();
  const [reversingPagination, setReversingPagination] = createSignal(false);

  const noteAuthoredEdit = (
    pageId: string,
    origin: PaginationUndoOrigin,
  ): void => {
    const current = latestPaginationUndoReceipt();
    if (current !== null && current.token === origin.token) {
      paginationUndoReceipts[paginationUndoReceipts.length - 1] = {
        ...current,
        historyDepth: origin.historyDepth,
        beforeDoc: origin.beforeDoc,
        afterAuthoredDoc: origin.afterAuthoredDoc,
      };
      return;
    }
    paginationUndoReceipts.push({
      token: origin.token,
      sourcePageId: pageId,
      historyDepth: origin.historyDepth,
      beforeDoc: origin.beforeDoc,
      afterAuthoredDoc: origin.afterAuthoredDoc,
      bookBefore: pages().map((page) => clonePage({
        ...page,
        doc: page.id === pageId ? origin.beforeDoc : page.doc,
      })),
      legs: [],
    });
    // This stack shadows the editor's in-memory history only. Bound it well
    // above ordinary editing needs so a long session cannot retain whole-book
    // snapshots forever.
    if (paginationUndoReceipts.length > 256) paginationUndoReceipts.shift();
  };

  /**
   * Put one carry on the serialized chain and make its lifetime observable by
   * the flip QA bridge. A raster can exist while this work is still saving the
   * source and invalidating the target, so cache presence alone cannot prove a
   * face is ready to photograph.
   */
  const enqueueCarry = (work: () => Promise<void>): void => {
    carryPending += 1;
    carryRevision += 1;
    carryChain = carryChain
      .then(work)
      .catch(() => undefined)
      .finally(() => {
        carryPending -= 1;
        carryRevision += 1;
      });
  };

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
    origin: PaginationUndoOrigin | null,
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
    let createdTarget = false;
    if (next && (await isPageFlowStart(next.id))) {
      const spill = await insertPageAfter(pageId, {
        doc: newPageDoc(bookPageStyle(), bookLineHeight()),
      });
      if (spill === null) return;
      await refreshPageOrderPreservingLiveDocs(spill.bookId);
      next = spill;
      createdTarget = true;
    }
    if (!next) {
      next = await appendPage();
      if (!next) return;
      createdTarget = true;
    }

    const fallbackAttrs: Record<string, unknown> = { pageStyle: bookPageStyle() };
    const line = bookLineHeight();
    if (line !== undefined) fallbackAttrs.lineHeightPx = line;

    const targetBefore = next.doc;
    const merged = prependBlocksToDoc(targetBefore, kept, fallbackAttrs);
    if (origin !== null && !reversingPagination()) {
      const receipt = paginationUndoReceipts.find(
        (candidate) => candidate.token === origin.token,
      ) ?? null;
      if (receipt !== null) {
        receipt.legs.push({
          sourcePageId: pageId,
          targetPageId: next.id,
          moved: kept as Record<string, unknown>[],
          targetBefore,
          targetAfter: merged,
          createdTarget,
        });
        pendingPaginationOrigins.set(next.id, origin);
      }
    }
    updatePageDoc(next.id, merged);
    bumpDocVersion(next.id); // remounts the leaf when it is on this spread
    await savePageDoc(next.id, merged);
    // When the carry target is on the NEXT spread it never remounts here,
    // so the mutation observer never fires — mark the flip snapshots stale
    // explicitly or the back/revealed faces show the pre-carry page.
    flipApi?.invalidateSnapshots();
    // …and the target BY NAME, because it can be past the six pages that
    // covers. Re-staging it drains it in turn, so one carry off a page the
    // reader has not reached runs the whole reflow forward on its own instead
    // of one spread per turn (settleAhead; probe-turn-face.mjs measured the
    // reader outrunning it twice in six turns without this).
    flipApi?.settlePage(next.id);

    // Clear any stale mid-drain scroll on both leaves (before + after the
    // browser settles layout — rAF covers late scrollIntoView calls).
    resetLeafScroll('left');
    resetLeafScroll('right');
    requestAnimationFrame(() => {
      resetLeafScroll('left');
      resetLeafScroll('right');
    });

    if (cursorCarried && scriptInsertionViewLock === null) {
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
    origin: PaginationUndoOrigin | null = null,
  ): void => {
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    if (reversingPagination()) return;
    if (backwardMoveOverflowTarget?.pageId === pageId) {
      backwardMoveOverflowTarget.overflowed = true;
      return;
    }
    const inherited = origin ?? pendingPaginationOrigins.get(pageId) ?? null;
    pendingPaginationOrigins.delete(pageId);
    enqueueCarry(() =>
      carryOverflow(pageId, blocks, cursorCarried, caretOffset, inherited),
    );
  };

  /** Undo one authored edit and every layout-only page carry it caused. */
  const canUndoPaginatedEdit = (): boolean => {
    while (latestPaginationUndoReceipt()?.legs.length === 0) {
      paginationUndoReceipts.pop();
    }
    const receipt = latestPaginationUndoReceipt();
    const source = receipt === null ? null : getPageEditor(receipt.sourcePageId);
    return (
      receipt !== null &&
      receipt.legs.length > 0 &&
      (source === null ||
        Number(undoDepth(source.state)) === receipt.historyDepth) &&
      !reversingPagination()
    );
  };

  const undoPaginatedEdit = async (
    event: KeyboardEvent,
  ): Promise<boolean> => {
    const receipt = latestPaginationUndoReceipt();
    if (receipt === null || !canUndoPaginatedEdit()) return false;
    const pageId = receipt.sourcePageId;
    event.preventDefault();
    event.stopImmediatePropagation();
    setReversingPagination(true);
    try {
      await carryChain;
      const current = new Map(pages().map((page) => [page.id, page.doc]));
      const fallbackAttrs: Record<string, unknown> = {
        pageStyle: bookPageStyle(),
      };
      const line = bookLineHeight();
      if (line !== undefined) fallbackAttrs.lineHeightPx = line;
      const reversed = reversePaginationLegs(
        current,
        receipt.legs,
        fallbackAttrs,
      );
      if (reversed === null) {
        notify('The pages changed after that edit, so it was not safe to undo', 'error');
        return true;
      }
      const createdTargets = new Set(
        receipt.legs.filter((leg) => leg.createdTarget).map((leg) => leg.targetPageId),
      );

      const sourceEditor = getPageEditor(pageId);
      const originalEditorStillMounted =
        sourceEditor !== null &&
        Number(undoDepth(sourceEditor.state)) === receipt.historyDepth;
      if (originalEditorStillMounted && sourceEditor !== null && !undo(sourceEditor.state)) {
        notify('Could not undo that edit', 'error');
        return true;
      }

      // Reinstall every displaced block before asking ProseMirror to reverse
      // the authored edit. The history plugin maps its inverse through these
      // addToHistory:false replacements, so Ctrl+Shift+Z remains native.
      for (const [affectedId, doc] of reversed) {
        const before = current.get(affectedId);
        if (before === undefined || JSON.stringify(before) === JSON.stringify(doc)) continue;
        const live = getPageEditor(affectedId);
        if (live?.view.dom.isConnected) {
          const node = live.schema.nodeFromJSON(doc);
          live.view.dispatch(
            live.state.tr
              .replaceWith(0, live.state.doc.content.size, node.content)
              .setMeta('addToHistory', false),
          );
        } else {
          bumpDocVersion(affectedId);
        }
        updatePageDoc(affectedId, doc);
      }
      let sourceAfterUndo: PageDoc;
      if (originalEditorStillMounted && sourceEditor !== null) {
        if (!undo(sourceEditor.state, sourceEditor.view.dispatch, sourceEditor.view)) {
          notify('Could not undo that edit', 'error');
          return true;
        }
        sourceAfterUndo = sourceEditor.getJSON() as PageDoc;
      } else {
        // A caret carry can move to another spread and destroy the source
        // editor—and its in-memory PM history. The receipt therefore keeps an
        // exact pre-edit book snapshot rather than pretending history survived.
        sourceAfterUndo = receipt.beforeDoc;
        const beforeIds = new Set(receipt.bookBefore.map((page) => page.id));
        for (const page of await listPages(receipt.bookBefore[0]?.bookId ?? '')) {
          if (!beforeIds.has(page.id)) await deletePage(page.id);
        }
        for (const beforePage of receipt.bookBefore) {
          await restoreOrCreatePageSnapshot(beforePage);
        }
        const restored = receipt.bookBefore.map(clonePage);
        setPages(restored);
        for (const beforePage of restored) bumpDocVersion(beforePage.id);
      }
      updatePageDoc(pageId, sourceAfterUndo);
      for (const createdId of createdTargets) {
        const doc = reversed.get(createdId);
        if (doc === undefined || docHasContent(doc)) continue;
        await deletePage(createdId);
        reversed.delete(createdId);
        setPages((currentPages) => currentPages.filter((page) => page.id !== createdId));
      }
      if (createdTargets.size > 0 && receipt.bookBefore[0]?.bookId) {
        await refreshPageOrderPreservingLiveDocs(receipt.bookBefore[0].bookId);
      }
      paginationUndoReceipts.pop();
      pendingPaginationOrigins.clear();
      const writes = [...reversed.entries()].map(([affectedId, doc]) => [
        affectedId,
        affectedId === pageId ? sourceAfterUndo : doc,
      ] as const);
      const pending = appendLane.then(async () => {
        await Promise.all(
          writes.map(([affectedId, doc]) => savePageDoc(affectedId, doc)),
        );
      });
      appendLane = pending.then(() => undefined, () => undefined);
      flipApi?.invalidateSnapshots();
      return true;
    } finally {
      setReversingPagination(false);
    }
  };

  /**
   * THE SAME CARRY, ONE TURN EARLY — for a page nobody has looked at yet.
   *
   * A page is drained when it MOUNTS, and until then its stored document is
   * whatever it was before the reader's window decided what fits. That is
   * invisible while it stays a document, and it stops being invisible the
   * moment the flip photographs it: the faces of a curl are the adjacent
   * spread, which is never mounted, so the reader spends the whole gesture and
   * the landing frames looking at the page as it was BEFORE the reflow — and
   * because a drain pushes its tail onto the next page and that page's tail
   * onto the one after, "before the reflow" is a page from further along the
   * book. The temporal review of the demo caught exactly that five times
   * (frames 579, 695, 926, 1043, 1089: the curl finishes, the right leaf shows
   * a spread from elsewhere for two or three frames, then snaps), and
   * `scripts/probe-turn-face.mjs` reproduces it on every turn of the Welcome
   * book at 1180×720.
   *
   * `flip/offscreenPages` now drains the sheet it stages before it photographs
   * it, and tells us how much came off. The picture is therefore right on its
   * own; this puts the reader's DOCUMENT in the same state, so what they turn
   * onto is what they were shown. It is the identical carry `handleOverflow`
   * runs — trim the source, hand the blocks to the next page — with no caret to
   * chase, because nobody is typing on a page they have not reached.
   *
   * TWO GUARDS, both of which have to be here rather than in the flip:
   *
   *  - A MOUNTED PAGE IS NOT OURS. The staging path runs for the current
   *    leaves too (rasterCache prefers it even for a page in the DOM, so a
   *    capture never writes to the page the reader is looking at). Its live
   *    PageEditor owns that document and is draining it against the same
   *    capacity; a second writer would race it and could duplicate a block.
   *  - THE DOCUMENT MAY HAVE MOVED. The measurement happened inside an async
   *    staging; if the page has been written to since, a count is not a safe
   *    compare-and-swap (an equal-length edit would pass). `source` is the
   *    exact PageDoc that was staged, and any mismatch simply stands down —
   *    the next capture measures again.
   *
   * A persisted final TrailingNode paragraph is not one of the moved blocks.
   * It stays at the source page's tail, exactly as the live PageEditor drain
   * keeps it; otherwise it becomes a visible placeholder at the head of the
   * next page and shifts the entire landing down one ruled line.
   */
  const settleAhead = (
    pageId: string,
    remove: number,
    source: PageDoc,
    trailingPhantom: 0 | 1,
  ): void => {
    if (remove < 1) return;
    if (pageId === leftPage()?.id || pageId === rightPage()?.id) return;
    const page = pages().find((p) => p.id === pageId);
    const plan = planAheadSettlement(page?.doc, source, remove, trailingPhantom);
    if (plan === null) return;
    const { trimmed, moved } = plan;
    // Source first, target second — the ordering rule the drain's own long
    // note is about: a carry that reads the store between the two puts the
    // blocks back into a document that still has them.
    updatePageDoc(pageId, trimmed);
    bumpDocVersion(pageId);
    enqueueCarry(async () => {
      await savePageDoc(pageId, trimmed);
      await carryOverflow(pageId, moved, false, null, null);
    });
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
    if (aiPatchApplying()) return;
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
    if (aiPatchApplying()) return;
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
  const [deskZoom, setDeskZoom] = createSignal(DESK_ZOOM_REST);
  const [deskWheelArmed, setDeskWheelArmed] = createSignal(false);
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

  /*
   * The `leaf` rung used to have a keyboard step of its own — one page rather
   * than one spread — reached by the arrow keys, and it went with them. What is
   * left is the FocusRail's `left`/`right` buttons (onPickLeaf below): real
   * buttons, Tab-reachable, and they pick a side WITHIN the spread. Stated
   * plainly rather than papered over: choosing a side survives, stepping past
   * the right leaf into the next spread does not. The corner curl still turns
   * the spread at this rung, and inventing a new chord for the rest is the
   * owner's call, not this file's.
   */

  // -------------------------------------------------------------------------
  // The way back (see the convention docblock at the top of this file)
  // -------------------------------------------------------------------------
  const [backShown, setBackShown] = createSignal(true);
  let backTimer: ReturnType<typeof setTimeout> | undefined;
  /** Pointer is inside the summoning corner. Plain flag: read on every move. */
  let backNear = false;

  // The spread and the shelf are always-mounted siblings with different
  // owners. Closing gets one short local bridge before changing that owner,
  // otherwise the spread unmounts into a full-size cover in a single frame.
  const initialCloseLayout = (): PulledBookCenterLayout =>
    pulledBookCenterLayout(
      typeof window === 'undefined' ? 1280 : window.innerWidth,
      typeof window === 'undefined' ? 800 : window.innerHeight,
    );
  const [closing, setClosing] = createSignal(false);
  const [closeLayout, setCloseLayout] =
    createSignal<PulledBookCenterLayout>(initialCloseLayout());
  const [preparedCloseFace, setPreparedCloseFace] = createSignal<{
    url: string;
    image: HTMLImageElement;
  } | null>(null);
  let closeRequested = false;
  let closeFallback: ReturnType<typeof setTimeout> | undefined;

  // Rendering a full-resolution procedural cover is real work. Do it while
  // the reader is idle, not inside the click that is supposed to start the
  // closing gesture; the same URL is then reused by the shelf overlay.
  createEffect(() => {
    const loaded = session();
    const overrides = coverOverrides();
    const layout = closeLayout();
    setPreparedCloseFace(null);
    if (loaded == null || typeof window === 'undefined') return;

    let cancelled = false;
    const bake = (): void => {
      if (cancelled) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const url = coverDataUrl(
        Math.round(layout.width * dpr),
        Math.round(layout.height * dpr),
        deriveCoverParams(loaded.book.spineSeed, overrides),
        loaded.book.title,
      );
      // Baking gives us PNG bytes; decoding them for the first CSS paint is a
      // separate cost. Retain the decoded image for the life of the view so
      // inserting the bridge does not turn that decode into another click
      // pause.
      const image = new Image();
      image.src = url;
      const publish = (): void => {
        if (!cancelled) setPreparedCloseFace({ url, image });
      };
      if (typeof image.decode === 'function') {
        void image
          .decode()
          .catch(() => undefined)
          .then(publish);
      } else if (image.complete) {
        publish();
      } else {
        image.addEventListener('load', publish, { once: true });
        image.addEventListener('error', publish, { once: true });
      }
    };

    let cancel: () => void;
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(bake, { timeout: 1200 });
      cancel = () => window.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(bake, 350);
      cancel = () => window.clearTimeout(id);
    }
    onCleanup(() => {
      cancelled = true;
      cancel();
    });
  });

  const commitClose = (): void => {
    if (closeFallback !== undefined) {
      clearTimeout(closeFallback);
      closeFallback = undefined;
    }
    appState.closeBook();
  };

  /** One entry point, so a double click can never launch two return flights. */
  const requestClose = (): void => {
    if (closeRequested) return;
    closeRequested = true;
    setActivePanel(null);
    setInsertOpen(false);
    if (prefersReducedMotion() || session() == null) {
      commitClose();
      return;
    }
    setClosing(true);
    closeFallback = setTimeout(commitClose, BOOK_CLOSE_FALLBACK_MS);
  };

  const finishCloseBridge: JSX.EventHandler<HTMLDivElement, AnimationEvent> = (
    event,
  ) => {
    if (
      event.currentTarget === event.target &&
      event.animationName === 'nb-book-close-face'
    ) {
      commitClose();
    }
  };

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
    const syncCloseLayout = (): void => {
      setCloseLayout(initialCloseLayout());
    };
    window.addEventListener('resize', syncCloseLayout, { passive: true });
    onCleanup(() => window.removeEventListener('resize', syncCloseLayout));
  });
  onCleanup(() => {
    clearBackTimer();
    if (closeFallback !== undefined) clearTimeout(closeFallback);
    window.removeEventListener('pointermove', onPointerMove);
  });

  // -------------------------------------------------------------------------
  // Keyboard: Escape leaves focus mode, `[` and `]` walk the focus rungs, and
  // Ctrl +/-/0 works its zoom. Nothing here turns a page — turning is the
  // corner curl and the outer edge (FlipSurface), which answer in every focus
  // state. The arrows were removed because they only ever turned a page while
  // the caret was outside the paper.
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
    openTemplatesGallery();
  };

  // -------------------------------------------------------------------------
  // Wheel on PAPER belongs to writing and is left alone. Wheel on the flat
  // field around the book changes only the camera scale: the canonical
  // 1334×869 layout box and pagination capacity never move.
  // -------------------------------------------------------------------------
  const DESK_WHEEL_BLOCKED_SELECTOR =
    '.nb-spread-fit-frame, .nb-book-cover, .nb-rail, .nb-rail-panel, .nb-ai-agent, .nb-back-button, .nbs-layer, dialog, [role="dialog"], button, input, textarea, select, [contenteditable="true"]';
  const isEmptyDeskTarget = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    target.closest('.nb-book-view') !== null &&
    target.closest(DESK_WHEEL_BLOCKED_SELECTOR) === null;
  const DESK_WHEEL_CLICK_WINDOW_MS = 900;
  const DESK_WHEEL_GESTURE_WINDOW_MS = 650;
  const DESK_WHEEL_POINTER_SLOP_PX = 8;
  let deskWheelExpiresAt = 0;
  let deskWheelExpiryTimer: number | undefined;
  let deskWheelGeneration = 0;
  let deskWheelOrigin: { x: number; y: number } | undefined;

  const disarmDeskWheel = (): void => {
    deskWheelGeneration += 1;
    deskWheelExpiresAt = 0;
    deskWheelOrigin = undefined;
    if (deskWheelExpiryTimer !== undefined) {
      window.clearTimeout(deskWheelExpiryTimer);
      deskWheelExpiryTimer = undefined;
    }
    setDeskWheelArmed(false);
  };

  const armDeskWheelUntil = (
    duration: number,
    origin = deskWheelOrigin,
  ): void => {
    deskWheelGeneration += 1;
    const generation = deskWheelGeneration;
    deskWheelExpiresAt = performance.now() + duration;
    deskWheelOrigin = origin;
    setDeskWheelArmed(true);
    if (deskWheelExpiryTimer !== undefined) window.clearTimeout(deskWheelExpiryTimer);
    deskWheelExpiryTimer = window.setTimeout(() => {
      if (generation !== deskWheelGeneration) return;
      disarmDeskWheel();
    }, duration + 16);
  };

  const deskWheelTokenIsCurrent = (): boolean => {
    if (!deskWheelArmed()) return false;
    if (performance.now() <= deskWheelExpiresAt) return true;
    disarmDeskWheel();
    return false;
  };

  const onWheel = (event: WheelEvent): void => {
    if (!focusMode()) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        disarmDeskWheel();
        return;
      }
      if (!deskWheelTokenIsCurrent()) return;
      if (!isEmptyDeskTarget(event.target)) {
        disarmDeskWheel();
        return;
      }
      event.preventDefault();
      setDeskZoom((current) =>
        stepDeskZoom(current, event.deltaY, settings.zoomSensitivity),
      );
      armDeskWheelUntil(DESK_WHEEL_GESTURE_WINDOW_MS);
      return;
    }
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
  const onDeskPointerMove = (event: PointerEvent): void => {
    if (!deskWheelArmed()) return;
    const movedAway = deskWheelOrigin !== undefined &&
      Math.hypot(
        event.clientX - deskWheelOrigin.x,
        event.clientY - deskWheelOrigin.y,
      ) > DESK_WHEEL_POINTER_SLOP_PX;
    if (movedAway || !isEmptyDeskTarget(event.target)) disarmDeskWheel();
  };
  const onDeskPointerDownCapture = (event: PointerEvent): void => {
    if (deskWheelArmed() && (event.button !== 0 || !isEmptyDeskTarget(event.target))) {
      disarmDeskWheel();
    }
  };
  const onDeskFocusIn = (event: FocusEvent): void => {
    if (deskWheelArmed() && !isEmptyDeskTarget(event.target)) disarmDeskWheel();
  };

  onMount(() => {
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('pointermove', onDeskPointerMove, true);
    window.addEventListener('pointerdown', onDeskPointerDownCapture, true);
    window.addEventListener('focusin', onDeskFocusIn, true);
    window.addEventListener('keydown', disarmDeskWheel, true);
    window.addEventListener('blur', disarmDeskWheel);
    document.addEventListener('visibilitychange', disarmDeskWheel);
  });
  onCleanup(() => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointermove', onDeskPointerMove, true);
    window.removeEventListener('pointerdown', onDeskPointerDownCapture, true);
    window.removeEventListener('focusin', onDeskFocusIn, true);
    window.removeEventListener('keydown', disarmDeskWheel, true);
    window.removeEventListener('blur', disarmDeskWheel);
    document.removeEventListener('visibilitychange', disarmDeskWheel);
    disarmDeskWheel();
  });

  const onViewPointerDown = (event: PointerEvent): void => {
    if (!focusMode()) {
      // The token is granted by the completed click below, after the browser's
      // focus transition. Granting it on pointerdown lets that same click's
      // focusin immediately revoke it when focus falls back to <body>.
      if (deskWheelArmed()) disarmDeskWheel();
      return;
    }
    disarmDeskWheel();
    onPanDown(event);
  };

  const onViewClick = (event: MouseEvent): void => {
    if (
      !focusMode() && event.button === 0 && activePanel() === null &&
      isEmptyDeskTarget(event.target)
    ) {
      armDeskWheelUntil(DESK_WHEEL_CLICK_WINDOW_MS, {
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }
    disarmDeskWheel();
  };

  createEffect(() => {
    if (activePanel() !== null || focusMode()) disarmDeskWheel();
  });

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

  const [aiPanelController, setAiPanelController] =
    createSignal<AiAgentPanelController | undefined>();
  const [aiDemoPanelController, setAiDemoPanelController] =
    createSignal<AiAgentPanelController | undefined>();
  const [aiApplyQaPanelController, setAiApplyQaPanelController] =
    createSignal<AiAgentPanelController | undefined>();
  const [aiLoopQaPanelController, setAiLoopQaPanelController] =
    createSignal<AiAgentPanelController | undefined>();
  const [aiTutorialPreview, setAiTutorialPreview] = createSignal(false);
  const notebookForAiApply = createProductionNotebookReadAdapter();
  let aiCoreController: CoreAiAgentController | null = null;
  const [aiConnection, setAiConnection] = createSignal<AiAgentConnectionView>({
    status: 'unconfigured',
    provider: 'Cohere',
    firstUse: !settings.aiAgentSetupSeen,
    keyKind: settings.aiAgentKeyKind,
  });
  const [aiAttachments, setAiAttachments] =
    createSignal<readonly AiAgentAttachmentView[]>([]);
  const [aiSourceAttachments, setAiSourceAttachments] =
    createSignal<readonly SourceAttachmentRef[]>([]);
  const [aiThreads, setAiThreads] = createSignal<readonly AiAgentThreadView[]>([]);
  let aiAttachmentUploadEpoch = 0;
  let aiAttachmentUploadsSettled: Promise<void> = Promise.resolve();
  const [aiContextPolicy, setAiContextPolicy] = createSignal<AgentContextPolicy>(
    settings.aiAgentDefaultContext === 'whole-book'
      ? 'whole_book'
      : settings.aiAgentDefaultContext === 'nearby-pages'
        ? 'nearby_pages'
        : 'current_page',
  );

  // Let the guided tour show the real Agent panel without consuming or
  // triggering first-use key setup. The tour owns this one opening in both
  // directions; a panel the reader opened themselves remains theirs.
  onMount(() => {
    const stepId = 'meet-the-agent';
    let openedByTour = false;
    let openedForStep = false;
    const timer = window.setInterval(() => {
      const layer = document.querySelector(TOUR_LAYER_SELECTOR);
      const here = layer?.getAttribute(TOUR_STEP_ATTR) ?? '';
      const open = untrack(activePanel) === 'ai-agent';
      const verdict = stepWatchVerdict({
        here,
        stepId,
        open,
        mine: openedByTour,
        settled: false,
        openedForStep,
      });
      // Preview mode belongs only to the tour-owned opening. If the reader
      // closes it themselves, or the tour leaves this step after it was
      // already closed, do not suppress first-use setup on their next real
      // Agent visit. Compute the verdict first so a still-open tour-owned
      // panel retains its `mine` authority long enough to close cleanly.
      if (here !== stepId) {
        openedForStep = false;
        setAiTutorialPreview(false);
      } else if (openedByTour && !open) {
        openedByTour = false;
        setAiTutorialPreview(false);
      }
      if (verdict === 'open') {
        openedForStep = true;
        openedByTour = true;
        setAiTutorialPreview(true);
        setActivePanel('ai-agent');
      } else if (verdict === 'close') {
        openedByTour = false;
        setAiTutorialPreview(false);
        setActivePanel(null);
      } else if (here !== stepId && !open) {
        openedByTour = false;
      }
    }, 300);
    onCleanup(() => window.clearInterval(timer));
  });

  const aiContextViews = (): readonly AiAgentContextView[] => [
    {
      id: 'current-page',
      label: 'Current page',
      detail: 'Read the page you are working on.',
      selected: aiContextPolicy() === 'current_page',
    },
    {
      id: 'nearby-pages',
      label: 'Nearby pages',
      detail: 'Read this page and its neighbours for continuity.',
      selected: aiContextPolicy() === 'nearby_pages',
    },
    {
      id: 'whole-book',
      label: 'Whole book',
      detail: 'Let the agent inspect every page when the task needs it.',
      selected: aiContextPolicy() === 'whole_book',
    },
  ];

  const configureAiKey = async (input: AiAgentKeySubmission): Promise<void> => {
    if (input.kind === 'trial' && !input.trialPrivacyAcknowledged) {
      throw new Error('Acknowledge the trial-key privacy notice before connecting');
    }
    setAiConnection((current) => ({ ...current, status: 'testing', message: undefined }));
    try {
      const tested = await testAiCredential(input.key);
      if (!tested.valid) throw new Error('Cohere did not accept that API key');
      const status = await saveAiCredential(
        input.key,
        input.persistence === 'secure-vault' ? 'secure' : 'session',
      );
      await saveSettings({
        aiAgentSetupSeen: true,
        aiAgentKeyKind: input.kind,
        aiAgentTrialPrivacyAcknowledged:
          input.kind === 'trial' ? input.trialPrivacyAcknowledged : false,
      });
      setAiConnection({
        status: 'connected',
        provider: 'Cohere',
        firstUse: false,
        keyKind: input.kind,
        label: status.persistent ? 'saved in the system vault' : 'kept for this session',
      });
    } catch (error) {
      setAiConnection({
        status: 'error',
        provider: 'Cohere',
        firstUse: !settings.aiAgentSetupSeen,
        keyKind: input.kind,
        message: aiCredentialErrorMessage(error, 'Could not connect to Cohere'),
      });
      throw error;
    }
  };

  const skipAiSetup = async (): Promise<void> => {
    await saveSettings({ aiAgentSetupSeen: true });
    setAiConnection((current) => ({ ...current, firstUse: false }));
  };

  const humanFileSize = (bytes: number): string =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const aiTaskTimeLabel = (iso: string): string => {
    const value = new Date(iso);
    if (!Number.isFinite(value.getTime())) return '';
    const today = new Date();
    return value.toDateString() === today.toDateString()
      ? value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : value.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const aiThreadView = (task: AgentTaskSummary): AiAgentThreadView => ({
    id: task.id,
    title: task.title,
    updatedLabel: aiTaskTimeLabel(task.updatedAt),
    status: task.status,
  });

  const clearAiAttachmentViews = (): void => {
    for (const attachment of aiAttachments()) {
      if (attachment.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    }
    setAiAttachments([]);
    setAiSourceAttachments([]);
  };

  /**
   * Drop composer-only uploads which never entered a durable task manifest.
   * Registered sources retain a reference row and are intentionally kept for
   * task history; a file queued during an in-flight turn has no such owner and
   * must not become a private orphan when the composer is cleared or closed.
   */
  const clearAiAttachmentViewsAndOrphans = async (): Promise<void> => {
    aiAttachmentUploadEpoch += 1;
    await aiAttachmentUploadsSettled.catch(() => undefined);
    // Also cancel an upload that started while this async cleanup was waiting.
    aiAttachmentUploadEpoch += 1;
    const managedIds = aiSourceAttachments().flatMap((attachment) =>
      attachment.kind === 'managed_asset' ? [attachment.assetId] : [],
    );
    clearAiAttachmentViews();
    await Promise.all(managedIds.map(async (attachmentId) => {
      if (await countAiAgentAttachmentReferences(attachmentId) > 0) return;
      await deleteAiAttachment(attachmentId).catch(() => false);
    }));
  };

  const addAiFiles = async (files: readonly File[]): Promise<void> => {
    const uploadEpoch = aiAttachmentUploadEpoch;
    if (aiCoreController?.getSnapshot().interrupt !== null) {
      notify('answer or revise the current agent decision before adding sources', 'error');
      return;
    }
    const accepted = files.filter((file) => agentSourceMediaType(file) !== null);
    if (accepted.length !== files.length) {
      notify('That source type is not supported yet', 'error');
    }
    const upload = (async (): Promise<void> => {
      const saved: Array<{
        metadata: AiAttachmentMetadata;
        view: AiAgentAttachmentView;
        ref: SourceAttachmentRef;
      }> = [];
      const deleteUnregisteredSaved = async (): Promise<void> => {
        await Promise.all(saved.map(async ({ metadata, view }) => {
          if (view.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(view.previewUrl);
          if (await countAiAgentAttachmentReferences(metadata.id) === 0) {
            await deleteAiAttachment(metadata.id).catch(() => false);
          }
        }));
      };
      for (const file of accepted) {
        const sourceMediaType = agentSourceMediaType(file);
        if (sourceMediaType === null) continue;
        const temporaryId = `reading:${file.name}:${file.lastModified}`;
        const previewUrl = sourceMediaType.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;
        setAiAttachments((current) => [
          ...current,
          {
            id: temporaryId,
            name: file.name,
            kind: sourceMediaType === 'application/pdf'
              ? 'pdf'
              : sourceMediaType.startsWith('image/')
                ? 'image'
                : 'document',
            sizeLabel: humanFileSize(file.size),
            previewUrl,
            status: 'reading',
          },
        ]);
        try {
          const metadata = await saveAiAttachment(new Uint8Array(await file.arrayBuffer()));
          if (uploadEpoch !== aiAttachmentUploadEpoch) {
            if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
            if (await countAiAgentAttachmentReferences(metadata.id) === 0) {
              await deleteAiAttachment(metadata.id).catch(() => false);
            }
            await deleteUnregisteredSaved();
            return;
          }
          const view: AiAgentAttachmentView = {
            id: metadata.id,
            name: file.name,
            kind: metadata.kind === 'pdf'
              ? 'pdf'
              : metadata.mimeType.startsWith('image/')
                ? 'image'
                : 'document',
            sizeLabel: humanFileSize(metadata.sizeBytes),
            previewUrl,
            status: 'ready',
          };
          const semanticMediaType = agentSourceAttachmentMediaType(file, metadata);
          saved.push({
            metadata,
            view,
            ref: {
              kind: 'managed_asset',
              assetId: metadata.id,
              title: file.name,
              mediaType: semanticMediaType,
              digest: metadata.sha256,
            },
          });
          setAiAttachments((current) => [
            ...current.filter((item) => item.id !== temporaryId && item.id !== view.id),
            view,
          ]);
        } catch (error) {
          if (uploadEpoch !== aiAttachmentUploadEpoch) {
            if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
            await deleteUnregisteredSaved();
            return;
          }
          setAiAttachments((current) => current.map((item) =>
            item.id === temporaryId
              ? {
                  ...item,
                  status: 'error',
                  detail: error instanceof Error ? error.message : 'Could not attach this file',
                }
              : item,
          ));
        }
      }
      if (uploadEpoch !== aiAttachmentUploadEpoch) {
        await deleteUnregisteredSaved();
        return;
      }
      if (saved.length === 0) return;
      const refs = [...aiSourceAttachments(), ...saved.map((item) => item.ref)];
      const uniqueRefs = new Map<string, SourceAttachmentRef>();
      for (const ref of refs) {
        const key = ref.kind === 'managed_asset'
          ? `${ref.assetId}\u0000${ref.mediaType}`
          : JSON.stringify(ref);
        uniqueRefs.set(key, ref);
      }
      setAiSourceAttachments([...uniqueRefs.values()]);
      // The panel adapter registers the complete queued set immediately before
      // the next provider turn. This gives files added during a busy run one
      // deterministic owner and keeps the chip removable until registration.
    })();
    aiAttachmentUploadsSettled = Promise.allSettled([
      aiAttachmentUploadsSettled,
      upload,
    ]).then(() => undefined);
    await upload;
  };

  const removeAiAttachment = async (attachmentId: string): Promise<void> => {
    const references = attachmentId.startsWith('reading:')
      ? 0
      : await countAiAgentAttachmentReferences(attachmentId);
    if (aiCoreController?.getSnapshot().state !== null && references > 0) {
      notify('start a new AI task before removing a source already in its ledger', 'error');
      return;
    }
    const existing = aiAttachments().find((item) => item.id === attachmentId);
    if (existing?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(existing.previewUrl);
    setAiAttachments((current) => current.filter((item) => item.id !== attachmentId));
    setAiSourceAttachments((current) => current.filter(
      (item) => item.kind !== 'managed_asset' || item.assetId !== attachmentId,
    ));
    if (
      !attachmentId.startsWith('reading:') &&
      references === 0
    ) {
      try {
        await deleteAiAttachment(attachmentId);
      } catch {
        notify('the source was removed here, but its cached file could not be cleared', 'error');
      }
    }
  };

  /** Full structure is the durable Ctrl+Z authority; unlike Agent freshness,
   * later blank-page actions must invalidate a whole-book restore receipt. */
  const currentFullBookRevision = async (bookId: string): Promise<string> => {
    const ordered = (await listPages(bookId)).map((page) => {
      const live = getPageEditor(page.id);
      return {
        ...page,
        doc: live === null ? page.doc : (live.getJSON() as PageDoc),
      };
    });
    return computeNotebookRevision(ordered);
  };

  const appendPreparedAfter = (
    anchorId: string,
    additions: readonly PreparedAiProposalPage[],
  ): Promise<readonly string[]> => insertPagesAfter(anchorId, additions);

  /**
   * The only production mutation seam the AI agent is allowed to reach.
   *
   * The provider and LangGraph runtime can inspect, draft, render and review,
   * but they cannot import a page mutation adapter.  The reader's explicit
   * approval supplies an immutable proposal here; this function rechecks the
   * exact live notebook revision, claims the idempotency key, applies within
   * the existing whole-book import checkpoint, and rolls the entire operation
   * back on any failure.
   */
  const applyApprovedAiProposal = async (
    proposal: NotebookPatchProposal,
  ): Promise<void> => {
    const loaded = session();
    if (loaded == null || proposal.preview.bookId !== loaded.book.id) {
      throw new Error('This preview belongs to a different notebook');
    }
    const bookId = loaded.book.id;
    if (
      proposal.status !== 'approved_pending_apply' &&
      proposal.status !== 'apply_failed' &&
      proposal.status !== 'approved'
    ) {
      throw new Error('The AI draft still needs your approval');
    }
    if (aiPatchApplying()) {
      throw new Error('Another reviewed draft is already being inserted');
    }
    const durableApply = await readAiPatchApplication(proposal.idempotencyKey);
    if (
      durableApply?.status === 'applied' &&
      durableApply.patchId === proposal.patchId &&
      durableApply.bookId === bookId
    ) {
      notify('that reviewed draft was already inserted');
      return;
    }
    // Acquire the mutation lane synchronously. The two live page editors
    // become read-only and structural page actions also consult this signal,
    // so the revision proof below cannot race a reader edit.
    setAiPatchApplying(true);

    const assertFresh = async (): Promise<void> => {
      const snapshot = (
        await notebookForAiApply.inspectNotebook(
          bookId,
          new AbortController().signal,
        )
      ).snapshot;
      if (snapshot.bookRevision !== proposal.expectedBookRevision) {
        throw new Error(
          'The notebook changed after this preview was reviewed. Ask the agent to refresh it before inserting.',
        );
      }
      const expectedPageIds = proposal.expectedPageIds ?? proposal.preview.expectedPageIds;
      if (
        expectedPageIds !== undefined &&
        !notebookPageOrderExtendsSnapshot(expectedPageIds, snapshot.pageIds)
      ) {
        throw new Error(
          'The notebook page order changed after this preview was reviewed. Ask the agent to refresh it before inserting.',
        );
      }
    };

    const assertTargetBelongsToBook = async (): Promise<void> => {
      const target = proposal.insertionTarget;
      const pageId = target.kind === 'caret' ||
        target.kind === 'replace_selection' ||
        target.kind === 'before_page' ||
        target.kind === 'after_page'
        ? target.pageId
        : target.kind === 'new_pages'
          ? target.afterPageId
          : undefined;
      if (pageId === undefined) return;
      const currentIds = new Set((await listPages(bookId)).map((page) => page.id));
      if (!currentIds.has(pageId)) {
        throw new Error('The reviewed placement does not belong to this notebook');
      }
    };

    const previousUndo = scriptInsertionUndo;
    const previousUndoKey = scriptInsertionUndoKey;
    let claimed = false;
    let checkpointOpen = false;
    let preparedApplication: PreparedAiProposalApplication | null = null;
    let reviewedPageIds: readonly string[] = [];
    let reviewedPlacement: ReviewedPagePlacement | null = null;
    try {
      // Drain all earlier page producers before proving freshness. From this
      // point until finally, no reader-authored mutation can enter the view.
      await appendLane;
      await carryChain;
      await assertFresh();
      await assertTargetBelongsToBook();
      const application = await prepareAiProposalApplication(proposal);
      preparedApplication = application;
      const prepared = application.pages;
      if (
        (await webCryptoAgentHash.digestJson(application.plan.insertionTarget)) !==
          (await webCryptoAgentHash.digestJson(proposal.insertionTarget))
      ) {
        throw new Error('The reviewed application plan no longer matches this placement');
      }
      // Receipt verification and exact-asset promotion can await native I/O.
      // Recheck immediately before the durable rollback snapshot and claim.
      await assertFresh();
      await assertTargetBelongsToBook();
      const before = await captureScriptInsertionCheckpoint(bookId);
      const durableBefore: AiPatchBookSnapshot = {
        bookId,
        pages: before.pages,
      };
      claimed = await claimAiPatchApplication({
        idempotencyKey: proposal.idempotencyKey,
        patchId: proposal.patchId,
        bookId,
        before: durableBefore,
      });
      if (!claimed) {
        await rollbackPreparedAiProposalAssets(application);
        preparedApplication = null;
        const existing = await readAiPatchApplication(proposal.idempotencyKey);
        if (
          existing?.status === 'applied' &&
          existing.patchId === proposal.patchId &&
          existing.bookId === bookId
        ) {
          notify('that reviewed draft was already inserted');
          return;
        }
        throw new Error(
          'This reviewed draft has another unfinished apply. Reopen the notebook so Alcove can recover it before retrying.',
        );
      }

      // Keep the previous durable Ctrl+Z receipt until this proposal is fully
      // committed. A duplicate or failed apply must not consume valid Undo.
      scriptInsertionUndo = null;
      scriptInsertionUndoKey = proposal.idempotencyKey;
      // Reuse the exact durable authority captured before the claim rather
      // than taking a second, potentially different live-editor snapshot.
      scriptInsertionBefore = before;
      await setScriptInsertionActivity(true);
      checkpointOpen = true;
      const target = proposal.insertionTarget;
      if (target.kind === 'caret' || target.kind === 'replace_selection') {
        if (
          application.plan.kind !== 'integrated_target' ||
          application.plan.targetPageId !== target.pageId
        ) {
          throw new Error('The reviewed preview does not contain this target page');
        }
        const belongs = pages().some((page) => page.id === target.pageId);
        if (!belongs) throw new Error('The target page no longer exists');
        const page = await notebookForAiApply.inspectPage(
          target.pageId,
          new AbortController().signal,
        );
        if (
          page.revision !== application.plan.expectedTargetRevision ||
          page.documentDigest !== application.plan.expectedTargetDocumentDigest
        ) {
          throw new Error(
            'The target page changed after its integrated preview was reviewed.',
          );
        }
        if (target.kind === 'replace_selection') {
          const anchorDigest = await computeNotebookSelectionDigest({
            pageId: target.pageId,
            from: target.from,
            to: target.to,
            documentDigest: page.documentDigest,
          }, webCryptoAgentHash);
          if (anchorDigest !== target.selectionDigest) {
            throw new Error('The selected text changed after the AI task began');
          }
        }
        const first = prepared[0]!;
        const following = prepared.slice(1);
        if (
          first.protectedStart ||
          (await webCryptoAgentHash.digestJson(
            jsonStorageCanonicalPageDoc(first.doc),
          )) !==
            application.plan.reviewedTargetDocumentDigest
        ) {
          throw new Error('The reviewed target-page document failed its receipt check');
        }
        // Install every explicit page boundary before the live editor emits
        // an overflow. Otherwise a tall first fragment can create anonymous
        // spill pages ahead of the reviewed continuation and disturb the
        // agent's inspected order.
        const continuationIds = following.length > 0
          ? await appendPreparedAfter(target.pageId, following)
          : [];
        // Install the exact target document whose pixels were approved. There
        // is no second caret/selection merge here: doing that after approval
        // could repaginate differently and create unreviewed pages.
        if ((await savePageDoc(target.pageId, first.doc)) === null) {
          throw new Error('The target page disappeared while applying the reviewed draft');
        }
        getPageEditor(target.pageId)?.commands.setContent(
          first.doc as unknown as JSONContent,
          { emitUpdate: false },
        );
        reviewedPageIds = [target.pageId, ...continuationIds];
        reviewedPlacement = {
          kind: 'integrated',
          targetPageId: target.pageId,
        };
      } else if (target.kind === 'before_page') {
        if (application.plan.kind !== 'structural_pages') {
          throw new Error('The reviewed application plan is not a structural insertion');
        }
        reviewedPageIds = await insertPagesBefore(target.pageId, prepared);
        reviewedPlacement = {
          kind: 'before',
          anchorPageId: target.pageId,
        };
      } else if (target.kind === 'after_page') {
        if (application.plan.kind !== 'structural_pages') {
          throw new Error('The reviewed application plan is not a structural insertion');
        }
        reviewedPageIds = await appendPreparedAfter(target.pageId, prepared);
        reviewedPlacement = {
          kind: 'after',
          anchorPageId: target.pageId,
        };
      } else if (target.kind === 'book_start') {
        if (application.plan.kind !== 'structural_pages') {
          throw new Error('The reviewed application plan is not a structural insertion');
        }
        const ordered = await listPages(bookId);
        const first = ordered[0];
        if (first === undefined) {
          throw new Error('The notebook has no page to anchor the insertion');
        }
        if (!docHasContent(first.doc) && first.scriptSource === null) {
          await setPageScript(first.id, prepared[0]!.source, prepared[0]!.doc);
          await setPageFlowStart(first.id, true);
          reviewedPageIds = [first.id];
          if (prepared.length > 1) {
            reviewedPageIds = [
              first.id,
              ...await appendPreparedAfter(first.id, prepared.slice(1)),
            ];
          }
          getPageEditor(first.id)?.commands.setContent(
            prepared[0]!.doc as unknown as JSONContent,
            { emitUpdate: false },
          );
        } else {
          reviewedPageIds = await insertPagesBefore(first.id, prepared);
        }
        reviewedPlacement = { kind: 'at_start' };
      } else {
        if (application.plan.kind !== 'structural_pages') {
          throw new Error('The reviewed application plan is not a structural insertion');
        }
        const ordered = await listPages(bookId);
        const explicitAnchor =
          target.kind === 'new_pages' ? target.afterPageId : undefined;
        const anchor = explicitAnchor === undefined
          ? ([...ordered].reverse().find((page) => docHasContent(page.doc)) ?? ordered[0])
          : ordered.find((page) => page.id === explicitAnchor);
        if (anchor === undefined) {
          throw new Error('The notebook has no page to anchor the insertion');
        }
        if (
          !docHasContent(anchor.doc) &&
          anchor.scriptSource === null &&
          ordered.every((page) => !docHasContent(page.doc))
        ) {
          await setPageScript(anchor.id, prepared[0]!.source, prepared[0]!.doc);
          await setPageFlowStart(anchor.id, true);
          reviewedPageIds = [anchor.id];
          if (prepared.length > 1) {
            reviewedPageIds = [
              anchor.id,
              ...await appendPreparedAfter(anchor.id, prepared.slice(1)),
            ];
          }
          getPageEditor(anchor.id)?.commands.setContent(
            prepared[0]!.doc as unknown as JSONContent,
            { emitUpdate: false },
          );
          reviewedPlacement = { kind: 'at_start' };
        } else {
          reviewedPageIds = await appendPreparedAfter(anchor.id, prepared);
          reviewedPlacement = {
            kind: 'after',
            anchorPageId: anchor.id,
          };
        }
      }

      setPages(await listPages(bookId));
      await setScriptInsertionActivity(false, reviewedPageIds);
      checkpointOpen = false;
      // Let every queued editor/pagination producer settle after snapshots
      // resume, then compare all structural and integrated destinations to the
      // exact receipt. Only these reviewed bytes may become the committed book.
      await appendLane;
      await carryChain;
      const settled = await listPages(bookId);
      const settledById = new Map(settled.map((page) => [page.id, page]));
      await verifyPreparedAiProposalDocuments({
        pageIds: reviewedPageIds,
        pages: prepared,
        hash: webCryptoAgentHash,
        readPageDoc: (pageId) => {
          const stored = settledById.get(pageId);
          if (stored === undefined) return null;
          const live = getPageEditor(pageId);
          return live === null ? stored.doc : (live.getJSON() as PageDoc);
        },
      });
      if (reviewedPlacement === null) {
        throw new Error('The reviewed insertion did not produce a placement receipt');
      }
      verifyPreparedAiProposalPlacement({
        orderedPageIds: settled.map((page) => page.id),
        reviewedPageIds,
        placement: reviewedPlacement,
      });
      const resulting = settled;
      if (
        resulting.length === 0 ||
        resulting.some((page, index) => page.ord !== index) ||
        new Set(resulting.map((page) => page.id)).size !== resulting.length
      ) {
        throw new Error('The reviewed draft did not settle into a valid page order');
      }
      const resultRevision = await currentFullBookRevision(bookId);
      await completeAiPatchApplication(
        proposal.idempotencyKey,
        resultRevision,
      );
      if (
        previousUndoKey !== null &&
        previousUndoKey !== proposal.idempotencyKey
      ) {
        await forgetAiPatchApplication(previousUndoKey);
      }
      scriptInsertionUndoKey = proposal.idempotencyKey;
      armScriptInsertionUndo();
      flipApi?.invalidateSnapshots();
      notify(
        prepared.length === 1
          ? 'reviewed AI draft inserted — Ctrl+Z undoes it'
          : `reviewed AI draft inserted across ${prepared.length} pages — Ctrl+Z undoes it`,
      );
    } catch (error) {
      if (checkpointOpen) {
        try {
          await setScriptInsertionActivity(false, reviewedPageIds);
        } catch {
          // The exact pre-apply checkpoint below is still the authority.
        }
      }
      if (claimed) {
        // Roll back through the newly claimed journal. If that succeeds, put
        // the older one-shot Undo back exactly as it was. If it fails, retain
        // this new checkpoint/key for Ctrl+Z or startup recovery.
        scriptInsertionUndoKey = proposal.idempotencyKey;
        armScriptInsertionUndo();
        const restored = await restoreScriptInsertion();
        if (restored) {
          scriptInsertionUndo = previousUndo;
          scriptInsertionUndoKey = previousUndoKey;
        }
      }
      if (preparedApplication !== null) {
        await rollbackPreparedAiProposalAssets(preparedApplication).catch(() => undefined);
      }
      throw error;
    } finally {
      setAiPatchApplying(false);
    }
  };

  const aiDefaultInsertionTarget = (): NotebookInsertionTarget => {
    const page = activePage();
    return page === null ? { kind: 'book_end' } : { kind: 'after_page', pageId: page.id };
  };

  const aiPlacementOptions = (): readonly AiAgentPlacementOption[] => {
    const lockedTarget = aiCoreController?.getSnapshot().state?.insertionTarget;
    if (lockedTarget?.kind === 'replace_selection') {
      return [{
        id: 'replace-selection',
        label: 'Replace selected text',
        detail: 'Keep this reviewed rewrite anchored to the original selection.',
        target: lockedTarget,
      }];
    }
    const page = activePage();
    const pageNumber = page === null
      ? undefined
      : pages().findIndex((candidate) => candidate.id === page.id) + 1;
    const local: AiAgentPlacementOption[] = page === null
      ? []
      : [
          {
            id: 'after-current-page',
            label: `After page ${pageNumber}`,
            detail: 'Start on fresh pages immediately after the page you are reading.',
            target: { kind: 'after_page', pageId: page.id },
          },
          {
            id: 'before-current-page',
            label: `Before page ${pageNumber}`,
            detail: 'Place the reviewed pages immediately before this page.',
            target: { kind: 'before_page', pageId: page.id },
          },
        ];
    return [
      ...local,
      {
        id: 'book-start',
        label: 'At the beginning',
        detail: 'Make the reviewed draft the opening pages of this notebook.',
        target: { kind: 'book_start' },
      },
      {
        id: 'book-end',
        label: 'At the end',
        detail: 'Append the reviewed draft after the notebook’s last written page.',
        target: { kind: 'book_end' },
      },
    ];
  };

  /*
   * Provider-free browser regression for the REAL approved-proposal closure.
   * The ordinary demo has its own reversible insertion seam, so it cannot
   * prove BookView's receipt verification and apply journal. Keep this bridge
   * behind a second exact QA opt-in and absent from every Tauri build path.
   */
  onMount(() => {
    const query = new URLSearchParams(window.location.search);
    if (
      '__TAURI_INTERNALS__' in window ||
      query.get('fx') !== 'force' ||
      query.get('qa') !== 'agent-apply'
    ) return;
    let cancelled = false;
    let bridge: import('./rail/aiAgentApplyQaBridge').AiAgentApplyQaBridgeHandle | undefined;
    void import('./rail/aiAgentApplyQaBridge').then(({ createAiAgentApplyQaBridge }) => {
      const created = createAiAgentApplyQaBridge({
        bookId: () => session()?.book.id,
        bookTitle: () => session()?.book.title,
        insertionTarget: aiDefaultInsertionTarget,
        applyApprovedProposal: applyApprovedAiProposal,
        restoreAppliedProposal: () => restoreScriptInsertion(true),
        openPanel: () => setActivePanel('ai-agent'),
      });
      if (cancelled) {
        void created.dispose();
        return;
      }
      bridge = created;
      window.__aiAgentApplyQa = created;
      setAiApplyQaPanelController(created.controller);
    }).catch((error) => {
      if (!cancelled) console.error('[ai-agent-apply-qa] bridge unavailable', error);
    });
    onCleanup(() => {
      cancelled = true;
      if (window.__aiAgentApplyQa === bridge) delete window.__aiAgentApplyQa;
      setAiApplyQaPanelController(undefined);
      if (bridge !== undefined) void bridge.dispose();
    });
  });

  /*
   * Provider-free browser regression for the REAL AgentRuntime/graph/panel
   * orchestration. It is a separate exact QA route from the apply transaction
   * probe and is never constructed in Tauri.
   */
  onMount(() => {
    const query = new URLSearchParams(window.location.search);
    if (
      !import.meta.env.DEV ||
      '__TAURI_INTERNALS__' in window ||
      query.get('fx') !== 'force' ||
      query.get('qa') !== 'agent-loop'
    ) return;
    let cancelled = false;
    let bridge: import('./rail/aiAgentLoopQaBridge').AiAgentLoopQaBridgeHandle | undefined;
    void import('./rail/aiAgentLoopQaBridge').then(({ createAiAgentLoopQaBridge }) => {
      const bookId = session()?.book.id;
      if (bookId === undefined) throw new Error('Open a notebook before running Agent loop QA.');
      const created = createAiAgentLoopQaBridge({
        bookId,
        bookTitle: session()?.book.title ?? 'QA notebook',
        defaultInsertionTarget: aiDefaultInsertionTarget,
        openPanel: () => setActivePanel('ai-agent'),
      });
      if (cancelled) {
        void created.dispose();
        return;
      }
      bridge = created;
      window.__aiAgentLoopQa = created;
      setAiLoopQaPanelController(created.controller);
    }).catch((error) => {
      if (!cancelled) console.error('[ai-agent-loop-qa] bridge unavailable', error);
    });
    onCleanup(() => {
      cancelled = true;
      if (window.__aiAgentLoopQa === bridge) delete window.__aiAgentLoopQa;
      setAiLoopQaPanelController(undefined);
      if (bridge !== undefined) void bridge.dispose();
    });
  });

  onMount(() => {
    const query = new URLSearchParams(window.location.search);
    if (
      import.meta.env.DEV &&
      query.get('fx') === 'force' &&
      query.get('qa') === 'agent-loop'
    ) return;
    let disposed = false;
    const mountedBookId = session()?.book.id ?? editorState.openBookId() ?? '';
    const notebook = createProductionNotebookReadAdapter();
    const providerPrivacyReady = (): boolean =>
      settings.aiAgentKeyKind === 'production' ||
      settings.aiAgentTrialPrivacyAcknowledged;
    const sourceAdapters = createProductionSourceAdapters({
      notebook,
      providerPrivacyReady,
    });
    let qaNativeRenderFailureRemaining =
      import.meta.env.DEV &&
      !('__TAURI_INTERNALS__' in window) &&
      query.get('fx') === 'force' &&
      query.get('qa-render-failure') === 'once';
    const previewSandbox = createProductionDraftSandbox(
      qaNativeRenderFailureRemaining
        ? {
            renderPages: async (request) => {
              if (qaNativeRenderFailureRemaining) {
                qaNativeRenderFailureRemaining = false;
                // Deliberately a cross-boundary-shaped object rather than an
                // Error instance: the production bug collapsed this exact
                // class of renderer rejection to the useless “tool failed”.
                throw {
                  message:
                    'QA native renderer rejected the first draft; revise the script and render again.',
                };
              }
              const { renderDraftPagesInSandbox } = await import(
                '../features/aiAgent/draftSandboxMount'
              );
              return renderDraftPagesInSandbox(request);
            },
          }
        : {},
    );
    const persistence = new SqliteAgentPersistence();
    const runtime = new AgentRuntime(
      new CohereTauriAgentProvider(providerPrivacyReady, {
        prepareImage: (part, signal) => prepareBoundedProviderImage(
          part,
          signal,
          (resourceId) => previewSandbox.readAsset(resourceId).catch(
            () => readAiAttachment(resourceId),
          ),
        ),
      }),
      {
        notebook,
        ...sourceAdapters,
        sandbox: previewSandbox.adapter,
        clock: systemAgentClock,
        ids: randomAgentIds,
        hash: webCryptoAgentHash,
      },
      persistence,
    );
    const core = createAiAgentController(runtime);
    aiCoreController = core;
    const uninstall = installAiAgentController(core);

    const refreshAiThreads = async (): Promise<void> => {
      const tasks = await persistence.listTasksForBook(mountedBookId);
      if (!disposed) setAiThreads(tasks.map(aiThreadView));
    };
    const restoreTaskAttachments = async (taskId: string): Promise<void> => {
      const [resources, persisted] = await Promise.all([
        sourceAdapters.listManagedResources(
          taskId,
          new AbortController().signal,
        ),
        persistence.loadTask(taskId),
      ]);
      // A failed/cancelled first ingestion has no source rows yet. Its queued
      // managed refs are nevertheless durable product state and must return as
      // visible chips after restart so Retry and Delete act on the same bytes.
      const ownedResources = new Map<string, {
        readonly attachmentId: string;
        readonly title: string;
        readonly mediaType: string;
        readonly digest: string;
      }>();
      for (const attachment of pendingManagedAiAttachmentsInState(persisted?.state)) {
        ownedResources.set(attachment.assetId, {
          attachmentId: attachment.assetId,
          title: attachment.title,
          mediaType: attachment.mediaType,
          digest: attachment.digest,
        });
      }
      // A committed source ledger is the richer/newer description when an id
      // appears in both ledgers during the hand-off at the end of ingestion.
      for (const resource of resources) ownedResources.set(resource.attachmentId, resource);
      const views: AiAgentAttachmentView[] = [];
      const refs: SourceAttachmentRef[] = [];
      for (const resource of ownedResources.values()) {
        refs.push({
          kind: 'managed_asset',
          assetId: resource.attachmentId,
          title: resource.title,
          mediaType: resource.mediaType,
          digest: resource.digest,
        });
        let previewUrl: string | undefined;
        let sizeLabel = resource.mediaType === 'application/pdf'
          ? 'PDF'
          : resource.mediaType.startsWith('image/')
            ? 'image'
            : resource.mediaType;
        let status: AiAgentAttachmentView['status'] = 'ready';
        let detail: string | undefined;
        if (resource.mediaType.startsWith('image/')) {
          try {
            const stored = await readAiAttachment(resource.attachmentId);
            previewUrl = URL.createObjectURL(new Blob(
              [new Uint8Array(stored.bytes)],
              { type: stored.metadata.mimeType },
            ));
            sizeLabel = humanFileSize(stored.metadata.sizeBytes);
          } catch {
            status = 'error';
            detail = 'This task still references the image, but its cached bytes are unavailable.';
          }
        }
        views.push({
          id: resource.attachmentId,
          name: resource.title,
          kind: resource.mediaType === 'application/pdf'
            ? 'pdf'
            : resource.mediaType.startsWith('image/')
              ? 'image'
              : 'document',
          sizeLabel,
          previewUrl,
          status,
          detail,
        });
      }
      if (disposed) {
        for (const view of views) {
          if (view.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(view.previewUrl);
        }
        return;
      }
      await clearAiAttachmentViewsAndOrphans();
      setAiAttachments(views);
      setAiSourceAttachments(refs);
    };

    const panel = createAiAgentPanelController(core, {
      bookId: mountedBookId,
      bookTitle: session()?.book.title,
      connection: aiConnection,
      attachments: aiAttachments,
      sourceAttachments: aiSourceAttachments,
      context: aiContextViews,
      threads: aiThreads,
      activeThreadTitle: () => {
        const activeTaskId = core.getSnapshot().state?.identity.taskId;
        return aiThreads().find((thread) => thread.id === activeTaskId)?.title;
      },
      placements: aiPlacementOptions,
      defaultContextPolicy: aiContextPolicy,
      // The model may escalate this to a complete sweep after reading the
      // manifest; policy also treats retrievalPlan.requiresCompleteCoverage
      // as binding. Explicit “keep every fact” wording is recognized here so
      // the guarantee is present before the first provider turn too.
      preserveAllSourceInformation: () => false,
      obfuscatePrivateText: () => settings.aiAgentObfuscatePrivateText,
      insertionTarget: aiDefaultInsertionTarget,
      renderUrlFor: previewSandbox.renderUrlFor,
      configureKey: configureAiKey,
      skipKeySetup: skipAiSetup,
      openIntegrationSettings: () => {
        window.dispatchEvent(new CustomEvent('alcove:open-settings'));
      },
      attachFiles: addAiFiles,
      removeAttachment: (id) => void removeAiAttachment(id),
      toggleContext: (contextId, selected) => {
        if (!selected) return;
        const next: AgentContextPolicy = contextId === 'whole-book'
          ? 'whole_book'
          : contextId === 'nearby-pages'
            ? 'nearby_pages'
            : 'current_page';
        setAiContextPolicy(next);
        void saveSettings({
          aiAgentDefaultContext: next === 'whole_book'
            ? 'whole-book'
            : next === 'nearby_pages'
              ? 'nearby-pages'
              : 'current-page',
        });
      },
      onApprovedProposal: applyApprovedAiProposal,
      onStartNewTask: clearAiAttachmentViewsAndOrphans,
      onSelectThread: async (taskId) => {
        const restored = await core.restore(taskId);
        const generationId = restored.state?.patchProposal?.preview.generationId;
        if (generationId !== undefined) {
          const hydrated = await previewSandbox.adapter.getGeneration(
            generationId,
            new AbortController().signal,
          );
          if (hydrated === null) {
            notify(
              'that task’s exact preview has expired — ask the agent to render it again',
              'error',
            );
          } else {
            // getGeneration hydrates process-local image URLs. Republish the
            // same durable state so Solid resolves those URLs immediately.
            await core.restore(taskId);
          }
        }
        await restoreTaskAttachments(taskId);
        await refreshAiThreads();
      },
      onRenameThread: async (taskId, title) => {
        await persistence.renameTask(taskId, title);
        await refreshAiThreads();
      },
      onDeleteThread: async (taskId) => {
        const wasActive = core.getSnapshot().state?.identity.taskId === taskId;
        const persisted = await persistence.loadTask(taskId);
        const resources = await sourceAdapters.listManagedResources(
          taskId,
          new AbortController().signal,
        );
        const pendingAttachmentIds = pendingManagedAiAttachmentsInState(
          persisted?.state,
        ).map((attachment) => attachment.assetId);
        const ownedAttachmentIds = [...new Set([
          ...resources.map((resource) => resource.attachmentId),
          ...pendingAttachmentIds,
        ])];
        // Core owns and disposes every masked/final generation in the task;
        // keeping a second one-id cleanup here leaked the sibling generation.
        await core.deleteTask(taskId);
        await Promise.all(ownedAttachmentIds.map(async (attachmentId) => {
          if (await countAiAgentAttachmentReferences(attachmentId) > 0) return;
          await deleteAiAttachment(attachmentId).catch(() => false);
        }));
        if (wasActive) await clearAiAttachmentViewsAndOrphans();
        await refreshAiThreads();
      },
      onError: (error) => notify(
        error instanceof Error ? error.message : 'The AI agent could not finish that action',
        'error',
      ),
    });
    setAiPanelController(panel);

    const unsubscribeTaskHistory = core.subscribe(() => {
      void refreshAiThreads();
    });
    void refreshAiThreads();

    let privacyWasReady = providerPrivacyReady();
    const refreshAiConnection = (): void => {
      const privacyNowReady = providerPrivacyReady();
      if (privacyWasReady && !privacyNowReady && core.getSnapshot().busy) {
        void core.stop('AI privacy permission or credential was withdrawn');
      }
      privacyWasReady = privacyNowReady;
      void aiCredentialStatus().then((status) => {
        if (disposed) return;
        const privacyReady = settings.aiAgentKeyKind === 'production' ||
          settings.aiAgentTrialPrivacyAcknowledged;
        setAiConnection({
          status: status.configured && privacyReady ? 'connected' : 'unconfigured',
          provider: 'Cohere',
          firstUse: !settings.aiAgentSetupSeen,
          keyKind: settings.aiAgentKeyKind,
          message: status.configured && !privacyReady
            ? 'Acknowledge the trial privacy notice in Settings before the agent can send anything.'
            : undefined,
          label: status.configured && privacyReady
            ? status.persistent
              ? 'saved in the system vault'
              : 'available for this session'
            : undefined,
        });
      }).catch((error) => {
        if (disposed) return;
        setAiConnection({
          status: 'error',
          provider: 'Cohere',
          firstUse: !settings.aiAgentSetupSeen,
          keyKind: settings.aiAgentKeyKind,
          message: aiCredentialErrorMessage(error, 'Could not read the AI connection'),
        });
      });
    };
    // Settings can connect, replace or revoke a key while this notebook stays
    // mounted. Keep the rail's gate synchronized instead of requiring reopen.
    const unsubscribeAiSettings = subscribeSettings(refreshAiConnection);

    const openFromSelection = (): void => {
      setActivePanel('ai-agent');
    };
    window.addEventListener(OPEN_AI_AGENT_PANEL_EVENT, openFromSelection);
    onCleanup(() => {
      disposed = true;
      window.removeEventListener(OPEN_AI_AGENT_PANEL_EVENT, openFromSelection);
      setAiPanelController(undefined);
      aiCoreController = null;
      panel.dispose();
      unsubscribeTaskHistory();
      unsubscribeAiSettings();
      uninstall();
      // Abort provider/source work synchronously before disposing its native
      // render resources. A closed notebook must never leave an invisible
      // task writing checkpoints or recreating preview assets behind it.
      // Orphan cleanup must run after Stop's durable persistence barrier. In
      // particular, a close during first ingestion cannot observe zero source
      // rows and delete an upload before pendingSourceAttachments is counted.
      void (async () => {
        if (core.getSnapshot().busy) {
          await core.stop('Notebook closed').catch(() => undefined);
        }
        previewSandbox.releaseUrls();
        await clearAiAttachmentViewsAndOrphans();
      })();
    });
  });

  /*
   * README/demo automation gets the real Agent panel and native page renderer,
   * but never a provider, credential or persisted Agent task. In browser-only
   * `?fx=force` playback its Insert button intentionally sends the frozen,
   * reviewed Script through this view's real parser/page insertion seam. Reset
   * restores the exact pre-demo checkpoint before the film continues. The
   * Tauri guard prevents that reversible documentation fixture from ever
   * touching a reader's desktop library.
   */
  onMount(() => {
    const query = new URLSearchParams(window.location.search);
    const qaRoute = query.get('qa');
    if (
      query.get('fx') !== 'force' ||
      qaRoute === 'agent-loop' ||
      qaRoute === 'agent-production'
    ) return;
    let cancelled = false;
    let publicBridge: Window['__aiAgentDemo'];
    let disposeBridge: (() => Promise<void>) | undefined;

    void import('./rail/aiAgentDemoBridge').then(async ({ createAiAgentDemoBridge }) => {
      if (cancelled) return;
      const bridge = createAiAgentDemoBridge({
        bookTitle: session()?.book.title ?? 'this notebook',
        openPanel: () => setActivePanel('ai-agent'),
        closePanel: () => {
          if (untrack(activePanel) === 'ai-agent') setActivePanel(null);
        },
        insertReviewedPages: async (source) => {
          if ('__TAURI_INTERNALS__' in window) {
            throw new Error('The reversible documentation insertion is browser-only.');
          }
          const anchor = activePage();
          if (anchor === null) throw new Error('The demo needs an open page to insert after.');
          const beforePages = pages();
          const anchorIndex = beforePages.findIndex((page) => page.id === anchor.id);
          const originalSuccessorId = beforePages[anchorIndex + 1]?.id;
          const parsed = parseNotebookScriptPages(source);
          if (parsed.pages.length !== 3) {
            throw new Error(`The frozen fixture contains ${parsed.pages.length} pages, expected 3.`);
          }
          const schemaEditor = getPageEditor(anchor.id);
          const additions = parsed.pages.map((page) => ({
            source: page.source,
            doc: scriptDocToTiptap(page.doc, {
              hasNode: (name) => schemaEditor?.schema.nodes[name] !== undefined,
            }) as PageDoc,
            protectedStart: true as const,
          }));
          await setScriptInsertionActivity(true);
          try {
            const inserted = await insertPagesAfter(anchor.id, additions);
            if (inserted.length !== additions.length) {
              throw new Error(`Only ${inserted.length} of ${additions.length} demo pages were inserted.`);
            }
            const settledIds = pages().map((page) => page.id);
            const settledAnchor = settledIds.indexOf(anchor.id);
            const expectedRun = [anchor.id, ...inserted, ...(originalSuccessorId === undefined ? [] : [originalSuccessorId])];
            const actualRun = settledIds.slice(settledAnchor, settledAnchor + expectedRun.length);
            if (settledAnchor < 0 || actualRun.join('\u0000') !== expectedRun.join('\u0000')) {
              throw new Error('The live demo pagination did not settle to the exact three reviewed pages.');
            }
            armScriptInsertionUndo();
            aiDemoInsertionActive = true;
            // Keep the opaque settling card over the live spread until the
            // final page order *and* destination spread have painted.  Taking
            // it down immediately after the DB inserts exposed Solid's three
            // intermediate page-list updates as a burst of apparent page
            // turns beside the Agent panel.
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
            await setScriptInsertionActivity(false);
            // The settling sweep deliberately restores the reader's original
            // spread before it uncovers the book. Land on the first reviewed
            // page only after that cleanup, then wait for its live editors to
            // paint before the Agent reports that insertion has completed.
            const firstSlot = pages().findIndex((page) => page.id === inserted[0]);
            if (firstSlot < 0) {
              throw new Error('The first reviewed demo page disappeared while insertion settled.');
            }
            setSpreadIndex(spreadOfSlot(firstSlot));
            setFocusedSide(firstSlot % 2 === 0 ? 'left' : 'right');
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
            return inserted;
          } catch (error) {
            aiDemoInsertionActive = false;
            await setScriptInsertionActivity(false);
            armScriptInsertionUndo();
            await restoreScriptInsertion(true);
            throw error;
          }
        },
        restoreInsertedPages: async () => {
          const restored = await restoreScriptInsertion(true);
          aiDemoInsertionActive = false;
          return restored;
        },
      });
      disposeBridge = () => bridge.dispose();
      if (cancelled) {
        await bridge.dispose();
        return;
      }
      setAiDemoPanelController(bridge.controller);
      publicBridge = Object.freeze({
        state: bridge.state,
        open: bridge.open,
        advance: bridge.advance,
        reset: bridge.reset,
      });
      window.__aiAgentDemo = publicBridge;
    }).catch((error) => {
      if (!cancelled) console.error('[ai-agent-demo] bridge unavailable', error);
    });

    onCleanup(() => {
      cancelled = true;
      if (window.__aiAgentDemo === publicBridge) delete window.__aiAgentDemo;
      setAiDemoPanelController(undefined);
      if (disposeBridge !== undefined) void disposeBridge();
    });
  });

  const copyText = async (text: string, doneMessage: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      notify(doneMessage);
    } catch {
      notify('could not reach the clipboard', 'error');
    }
  };

  const downloadSpec = async (spec: string): Promise<void> => {
    const outcome = await downloadNotebookScriptSpec(spec);
    if (outcome === 'saved') {
      notify('format guide saved — attach it to your AI');
    } else if (outcome === 'failed') {
      notify('could not save the format guide', 'error');
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
    // TOC rows, thumbnails and ribbons name a destination. Even when that
    // destination happens to be adjacent, routing it through the page-edge
    // curl makes a direct-navigation control wait on snapshot warmth and can
    // expose a stale pre-insertion face. Reserve the physical curl for the
    // physical page edge; named navigation lands directly and predictably.
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
    // A restore is destructive even when automatic history is disabled.
    // Protect the state being left and await its durable write before the page
    // changes, so an app stop cannot strand the reader between both versions.
    await recordSnapshotDurably(pageId, page.doc);
    updatePageDoc(pageId, snapshot.doc);
    bumpDocVersion(pageId);
    await savePageDoc(pageId, snapshot.doc);
    notifySaved();
    setHistoryRefresh((n) => n + 1);
    notify('the page turned back in time');
  };

  const restoreWholeBookSnapshot = async (
    snapshot: BookRecoverySnapshot,
  ): Promise<void> => {
    const loaded = session();
    if (loaded == null || aiPatchApplying()) return;
    setAiPatchApplying(true);
    try {
      await recordBookCheckpoint(loaded.book.id, pages(), {
        force: true,
        enabled: true,
      });
      const restored = await restoreBookCheckpoint(loaded.book.id, snapshot);
      setPages(restored);
      for (const page of restored) bumpDocVersion(page.id);
      setSpreadIndex(0);
      setFocusedSide('left');
      flipApi?.invalidateSnapshots();
      setHistoryRefresh((n) => n + 1);
      notify('the whole book returned to that checkpoint');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'could not restore the book yet', 'error');
    } finally {
      setAiPatchApplying(false);
    }
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

  /**
   * The cloth that physically peeks out of each visible leaf.
   *
   * This is deliberately separate from `activeMark`, which follows keyboard
   * focus for the rail control.  Using that focus value to paint the cover made
   * one ribbon appear to follow the reader from page to page until focus moved.
   */
  const leftVisibleMark = createMemo((): Bookmark | null => {
    const page = leftPage();
    return page
      ? (bookmarks().find((mark) => mark.pageId === page.id) ?? null)
      : null;
  });
  const rightVisibleMark = createMemo((): Bookmark | null => {
    const page = rightPage();
    return page
      ? (bookmarks().find((mark) => mark.pageId === page.id) ?? null)
      : null;
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
    commitBookmarks(next);
    // The ribbon is its own visible confirmation.  The former pitched pop was
    // perceived as a metallic "tong", and a toast merely repeated the same
    // thing the reader can already see on the page.
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
  };

  /** Delete the right-clicked leaf, then land on its nearest survivor. */
  const deletePageAt = async (pageId: string): Promise<void> => {
    if (aiPatchApplying()) return;
    clearScriptInsertionUndo();
    const before = pages();
    if (before.length <= 1) {
      notify('a book keeps at least one page', 'error');
      return;
    }
    const removedSlot = before.findIndex((entry) => entry.id === pageId);
    if (removedSlot < 0 || (await deletePage(pageId)) === null) {
      notify('could not delete that page', 'error');
      return;
    }

    const remaining = before
      .filter((entry) => entry.id !== pageId)
      .map((entry, ord) => ({ ...entry, ord }));
    setPages(remaining);
    const landing = Math.min(removedSlot, remaining.length - 1);
    setSpreadIndex(spreadOfSlot(landing));
    setFocusedSide(landing % 2 === 0 ? 'left' : 'right');
    setDocVersions((versions) => {
      const next = { ...versions };
      delete next[pageId];
      return next;
    });
    const keptBookmarks = bookmarks().filter((mark) => mark.pageId !== pageId);
    if (keptBookmarks.length !== bookmarks().length) {
      commitBookmarks(keptBookmarks);
    }
    flipApi?.invalidateSnapshots();
    notify('page deleted');
  };

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
        .then((fresh) =>
          preparePageRenderDocs(fresh, persistPageDocIdentity),
        )
        .then((fresh) =>
          preparePageAssetsForDisplay(fresh, persistPageDocIdentity),
        )
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

  /**
   * Every route into a spread inherits the no-scroll page contract.
   *
   * Overflow already resets the mounted leaf, but TOC/thumbnails/ribbon jumps
   * replace both leaves without running that path. A late ProseMirror
   * scrollIntoView during their mount could therefore leave the destination
   * internally scrolled with its heading above the paper. Reset after the DOM
   * swap and across two paint boundaries so both the first mount and a late
   * editor focus are pinned back to the top.
   */
  createEffect(
    on(spreadIndex, () => {
      queueMicrotask(() => {
        resetLeafScroll('left');
        resetLeafScroll('right');
        requestAnimationFrame(() => {
          resetLeafScroll('left');
          resetLeafScroll('right');
          requestAnimationFrame(() => {
            resetLeafScroll('left');
            resetLeafScroll('right');
          });
        });
      });
    }),
  );

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
    if (aiPatchApplying()) return;
    const slot = leftSlot(spreadIndex()) + (side === 'right' ? 1 : 0);
    while (pages().length <= slot) {
      if (!(await appendPage())) return;
    }
    const target = pageAt(slot);
    if (!target) return;
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
    if (aiPatchApplying()) return;
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
      data-page-id={page()?.id}
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
          <div
            class="nb-page nb-blank-page-preview"
            data-style={bookPageStyle()}
            style={{
              '--page-line-height': `${bookLineHeight() ?? 32}px`,
            }}
          >
            {/* Use the real ruling cascade while a bare leaf is becoming a
                stored page. This placeholder has the same page/editor/prose
                structure as PageEditor, so all twenty-seven page modes paint
                correctly without maintaining a second set of gradients. */}
            <div class="nb-page-editor" aria-hidden="true">
              <div class="ProseMirror" />
            </div>
            <button
              type="button"
              class="nb-leaf-blank"
              aria-label="Write on this page"
              onClick={() => void writeOnBlankLeaf(side)}
            >
              <span class="nb-leaf-blank-hint font-ui">start writing</span>
            </button>
          </div>
        }
      >
        {(_key: string) => {
          const current = page();
          return current ? (
            <PaginatedPageEditor
              pageId={current.id}
              initialDoc={current.doc}
              readOnly={aiPatchApplying()}
              suppressPagination={reversingPagination()}
              onInsertPageBefore={() =>
                void insertBlankPageBeside(current.id, 'before')
              }
              onInsertPageAfter={() =>
                void insertBlankPageBeside(current.id, 'after')
              }
              onMoveBlockToPrevious={
                pages().findIndex((candidate) => candidate.id === current.id) > 0
                  ? (editor, pos, selectionRange) =>
                      moveBlockToPreviousPage(
                        current.id,
                        editor,
                        pos,
                        selectionRange,
                      )
                  : undefined
              }
              onDeletePage={
                pages().length > 1
                  ? () => void deletePageAt(current.id)
                  : undefined
              }
              onDocChange={(doc) => handlePageDocChange(current.id, doc)}
              onAuthoredEdit={(origin) => noteAuthoredEdit(current.id, origin)}
              paginated={!qaNoPagination}
              pageCapacityPx={qaNoPagination ? undefined : pageCapacity()}
              onOverflow={
                qaNoPagination
                  ? undefined
                  : (blocks, cursorCarried, caretOffset, origin) =>
                      handleOverflow(
                        current.id,
                        blocks,
                        cursorCarried,
                        caretOffset ?? null,
                        origin ?? null,
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
      aria-busy={closing() ? 'true' : undefined}
      data-focus-mode={focusMode() ? 'true' : 'false'}
      /* The rung, for CSS and for anything measuring the mode from outside.
         `is-focus-mode` stays exactly what it was — the e2e suite and the tour
         both find focus mode by that class. */
      data-focus-level={focusLevel()}
      data-solo-leaf={focusLevel() === 'leaf' ? soloLeaf() : undefined}
      data-cursor={settings.cursorStyle}
      data-desk-zoom={deskZoom()}
      data-desk-wheel-armed={deskWheelArmed() ? 'true' : 'false'}
      style={{
        '--nb-focus-zoom': String(clampZoom(focusZoom())),
        '--nb-focus-pan-x': `${focusPan().x}px`,
        '--nb-focus-pan-y': `${focusPan().y}px`,
        /* Where the book sits, and how big, in the room an open rail sheet
           leaves it (rail.css `.nb-book-view .nb-book-cover`). Published here
           rather than on <html> so the fit cannot re-trigger the observer that
           computes it — and so it dies with the view. */
        '--nb-spread-shift': `${spreadFit().shift}px`,
        '--nb-spread-fit': String(spreadFit().scale * deskZoom()),
      }}
      onPointerDown={onViewPointerDown}
      onClick={onViewClick}
    >
      {/* Ctrl+K quick switcher (single-instance; safe if also mounted in App). */}
      <QuickSwitcher />
      {/* The only way out of a book, top-left, and quiet about it. It is not
          removed when it recedes — a control you cannot Tab to is not a way
          out — it just stops being ink you have to look past.

          Its `aria-label` keeps the name available without growing visible
          copy beside the universally familiar arrow. */}
      <button
        type="button"
        class="nb-back-button font-accent"
        classList={{ 'is-away': !backShown() }}
        aria-label="back to shelf (Escape shows this)"
        tabindex={focusMode() ? -1 : 0}
        onFocus={() => holdBack()}
        onBlur={() => showBack(BACK_LEAVE_MS)}
        disabled={closing()}
        onClick={requestClose}
      >
        <BackArrowIcon />
      </button>

      {/* One focus-only rail owns every control the mode leaves on screen:
          depth, zoom, leaf, recenter, Settings, and the way out. It replaces
          the old exit chip + wide dial pair, which covered the page in the
          very mode meant to clear it. */}
      <Show when={focusMode()}>
        <FocusRail
          level={focusLevel()}
          onPickLevel={goToFocus}
          zoom={focusZoom()}
          onZoom={changeZoom}
          onZoomRest={recentre}
          leaf={soloLeaf()}
          onPickLeaf={setSoloLeaf}
          panned={focusPan().x !== 0 || focusPan().y !== 0}
          onRecentre={recentre}
          onOpenSettings={() => {
            runCommand('open-settings');
          }}
          onLeave={() => setFocus(false)}
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
            openCoverDataUrl(
              Math.round(1334 * displayDpr()),
              Math.round(872 * displayDpr()),
              deriveCoverParams(loaded.book.spineSeed, coverOverrides()),
            ),
          );
          // Built ONCE per book session: mounting a leaf mounts a TipTap
          // editor that registers itself (src/editor/instances), so these
          // must never be re-evaluated by a reactive prop read downstream.
          const leftLeaf = leafFace('left', leftPage);
          const rightLeaf = leafFace('right', rightPage);
          const closeFaceUrl = (): string => {
            const prepared = preparedCloseFace();
            if (prepared !== null) return prepared.url;
            const layout = closeLayout();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            return coverDataUrl(
              Math.round(layout.width * dpr),
              Math.round(layout.height * dpr),
              deriveCoverParams(loaded.book.spineSeed, coverOverrides()),
              loaded.book.title,
            );
          };
          const pinned = readShelfMeta(loaded.book)?.pinned === true;
          return (
            <>
              <div
                class="nb-spread-stage"
                classList={{
                  'is-book-closing': closing(),
                  'is-insertion-settling': scriptInsertionSettling(),
                }}
                data-spread-index={spreadIndex()}
                data-book-ink={pageDefaults()?.ink ?? 'inherit'}
              >
              <div class="nb-spread-fit-frame" ref={attachStage}>
                {/* Keep the book name in the document outline without spending
                    a visible band above the pages. The shelf and book menus
                    already provide the reader-facing title. */}
                <h1 class="nb-book-title-accessible">{loaded.book.title}</h1>

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
                <Show when={scriptInsertionSettling()}>
                  <div class="nb-insertion-settling" role="status" aria-live="polite">
                    <span class="nb-insertion-settling-dots" aria-hidden="true"><i /><i /><i /></span>
                    <strong>Letting the pages settle…</strong>
                    <span class="font-ui">Checking every fixed page before the book turns to the result.</span>
                  </div>
                </Show>
                {/* Ribbon bookmarks peeking over the top edge (roadmap #19). */}
                {/* A ribbon belongs to the page it marks. Rendering the whole
                    book's set on every spread made a page-local bookmark look
                    like it followed the reader after a turn (and made the
                    outside of a book accumulate duplicate-looking tabs). */}
                <Show
                  when={leftVisibleMark() !== null || rightVisibleMark() !== null}
                >
                  <div class="nb-ribbon-row" data-testid="ribbon-row">
                    <Show when={leftVisibleMark()} keyed>
                      {(mark) => (
                        <span
                          class="nb-ribbon"
                          data-color={mark.color}
                          style={{ left: '43%' }}
                          aria-label="The left page is bookmarked"
                        />
                      )}
                    </Show>
                    <Show when={rightVisibleMark()} keyed>
                      {(mark) => (
                        <span
                          class="nb-ribbon"
                          data-color={mark.color}
                          style={{ left: '88%' }}
                          aria-label="The right page is bookmarked"
                        />
                      )}
                    </Show>
                  </div>
                </Show>
                <div class="nb-spread">
                  <FlipSurface
                    ref={(api) => (flipApi = api)}
                    spreadIndex={spreadIndex()}
                    pageIds={ids()}
                    getPageElement={(side) => paperElements[side] ?? null}
                    // The adjacent-page snapshot reads the exact in-memory doc
                    // handed to PageEditor. Reloading SQLite here could race an
                    // edit or the identity normalization above and recreate a
                    // one-frame difference at the raster-to-DOM handoff.
                    loadPageDoc={async (pageId) =>
                      pageDocForRendering(pages(), pageId)
                    }
                    // A page staged for its snapshot is drained first, against
                    // the same budget the mounted leaves use, and hands the
                    // tail back here — so a reader turns onto the page they
                    // were shown (settleAhead).
                    pageCapacityPx={qaNoPagination ? undefined : pageCapacity()}
                    onAheadOverflow={qaNoPagination ? undefined : settleAhead}
                    aheadWorkState={() => ({
                      pending: carryPending,
                      revision: carryRevision,
                    })}
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
                  onJump={jumpToSlot}
                />
              </Show>
              </div>

              <RailPanel
                open={activePanel() === 'customize'}
                title="Customize this book"
                onClose={() => setActivePanel(null)}
              >
                <CustomizePanel
                  open={activePanel() === 'customize'}
                  host="book"
                  bookId={loaded.book.id}
                  initialBookStyle={bookStyleOverridesFor(loaded.book)}
                  initialSurpriseLocks={bookSurpriseLocksFor(loaded.book)}
                  initialSurpriseHistory={bookSurpriseHistoryFor(loaded.book)}
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
                open={activePanel() === 'ai-agent'}
                title="AI agent"
                panelClass="is-ai-agent"
                onClose={() => setActivePanel(null)}
              >
                <AiAgentPanel
                  bookTitle={loaded.book.title}
                  controller={aiApplyQaPanelController() ?? aiLoopQaPanelController() ?? aiDemoPanelController() ?? aiPanelController()}
                  onNotify={notify}
                  tourPreview={aiTutorialPreview()}
                  panelOpen={activePanel() === 'ai-agent'}
                />
              </RailPanel>

              <RailPanel
                open={activePanel() === 'share'}
                title="In and out"
                onClose={() => setActivePanel(null)}
              >
                {/* The four that cannot resolve their own context: the paste
                    box is mounted against the focused leaf; page copy needs
                    that leaf; spec copy/download use this view's toast. */}
                <SharePanel
                  onInsertScript={() => setInsertOpen(true)}
                  onCopyScript={() => {
                    const page = activePage();
                    if (page) void exportScript(page.id);
                  }}
                  onCopySpec={(spec) =>
                    void copyText(
                      spec,
                      'spec copied — paste it to your AI',
                    )
                  }
                  onDownloadSpec={(spec) => void downloadSpec(spec)}
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
                  activeSlot={spreadIndex() * 2 + (focusedSide() === 'right' ? 1 : 0)}
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
                      bookId={session()!.book.id}
                      refreshKey={historyRefresh()}
                      onRestore={(snapshot) =>
                        void restoreSnapshot(pageId, snapshot)
                      }
                      onRestoreBook={(snapshot) => void restoreWholeBookSnapshot(snapshot)}
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
                      onInsertionActivity={setScriptInsertionActivity}
                      onInsertComplete={armScriptInsertionUndo}
                      onInsertFollowingPages={async (afterPageId, additions) => {
                        await insertPagesAfter(afterPageId, additions);
                      }}
                    />
                  )}
                </Show>
              </div>

              {/*
                A real shared-object bridge: it ends at the exact centred box
                PulledBookOverlay begins from after the route changes. The
                paper wash owns the background across that route boundary;
                the cover itself never becomes translucent once visible.
              */}
              <Show when={preparedCloseFace() !== null || closing()}>
                <div
                  class="nb-book-close-bridge"
                  classList={{ 'is-active': closing() }}
                  data-testid="book-close-bridge"
                  aria-hidden="true"
                >
                  <div class="nb-book-close-wash" />
                  <div
                    class="nb-book-close-face"
                    onAnimationEnd={finishCloseBridge}
                    style={{
                      left: `${closeLayout().x}px`,
                      top: `${closeLayout().y}px`,
                      width: `${closeLayout().width}px`,
                      height: `${closeLayout().height}px`,
                      'background-image': `url("${closeFaceUrl()}")`,
                    }}
                  >
                    <Show when={pinned}>
                      <canvas
                        class="nb-book-close-star"
                        ref={(node) =>
                          paintPulledBookStatusMark(node, 'star')
                        }
                      />
                    </Show>
                  </div>
                </div>
              </Show>
            </>
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
