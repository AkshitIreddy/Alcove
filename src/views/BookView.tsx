/**
 * BookView — the opened book as a true two-page spread on the desk: left and
 * right leaves side by side over a terracotta cover (edge peeking a few px
 * around the paper), spine gutter shadow down the middle, page flips driven
 * by the flip engine per the FlipSurface mount contract.
 *
 * Spread state: `spreadIndex` maps to page slots left = 2i, right = 2i + 1
 * (pure math in ./spread.ts). Flipping forward off the last spread while the
 * right leaf holds ink auto-creates the next page; "+ page" in the toolbar
 * appends one explicitly. New pages inherit settings.pageStyleDefault.
 *
 * The script toolbar (top-right) bridges pages and Notebook Script:
 * Insert script (paste dialog), Export script (clipboard), Copy AI spec.
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
import { getBook, listBooksByFloorRange } from '../data/books';
import { createPage, getPage, listPages } from '../data/pages';
import { seedIfEmpty } from '../data/seed';
import { settings } from '../data/settings';
import type { Book, Page, PageDoc } from '../data/types';
import PageEditor from '../editor/PageEditor';
import InsertScriptDialog from '../editor/insert/InsertScriptDialog';
import { activeEditor } from '../editor/insert/activeEditor';
import { docToScript } from '../editor/script/fromTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../editor/script/spec';
import FlipSurface, { type FlipSurfaceApi } from '../flip/FlipSurface';
import type { LeafSide } from '../flip/PageFlipController';
import type { FlipDirection } from '../flip/math';
import { play } from '../sound/engine';
import {
  arrowFlipAction,
  canFlipSpread,
  docHasContent,
  leftSlot,
  newPageDoc,
  shouldAutoCreatePage,
  spreadOfSlot,
  spreadPageIds,
  type SpreadIds,
} from './spread';
import '../styles/editor.css';
import '../styles/insert.css';
import '../styles/spread.css';

interface BookSession {
  readonly book: Book;
  readonly pages: Page[];
}

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

/** Hand-drawn plus for the "+ page" tool (static wobbled strokes). */
function AddPageIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" class="nb-add-page-icon" aria-hidden="true">
      <path
        d="M 8.2 2.6 C 7.9 6.2 8.1 9.7 7.9 13.4 M 2.6 8.2 C 6.2 7.8 9.8 8.1 13.4 7.9"
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

  createEffect(
    on(session, (loaded) => {
      if (loaded) {
        setPages(loaded.pages);
        setSpreadIndex(0);
      }
    }),
  );

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

  const rightHasContent = (): boolean => docHasContent(rightPage()?.doc);

  const canFlip = (direction: FlipDirection): boolean =>
    canFlipSpread(pages().length, spreadIndex(), direction, rightHasContent());

  // -------------------------------------------------------------------------
  // Page creation ("+ page" tool + auto-create on forward flip)
  // -------------------------------------------------------------------------
  const appendPage = async (): Promise<Page | null> => {
    const loaded = session();
    if (!loaded) return null;
    const created = await createPage({
      bookId: loaded.book.id,
      doc: newPageDoc(settings.pageStyleDefault),
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
  // Script toolbar plumbing (unchanged behavior, now spread-aware)
  // -------------------------------------------------------------------------
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
  // by page id, so edits never remount and spread changes always do.
  // -------------------------------------------------------------------------
  const paperElements: Partial<Record<LeafSide, HTMLDivElement>> = {};

  const leafFace = (side: LeafSide, page: () => Page | null): JSX.Element => (
    <div
      class="nb-sheet-paper nb-leaf-paper"
      data-side={side}
      ref={(el) => (paperElements[side] = el)}
      onFocusIn={() => setFocusedSide(side)}
    >
      <Show when={page()?.id} keyed>
        {(pageId) => (
          <PageEditor
            pageId={pageId}
            initialDoc={page()?.doc ?? { type: 'doc', content: [] }}
            onDocChange={(doc) => updatePageDoc(pageId, doc)}
          />
        )}
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
        {(loaded) => (
          <div class="nb-spread-stage" data-spread-index={spreadIndex()}>
            <div
              class="nb-script-toolbar font-ui"
              role="toolbar"
              aria-label="Script tools"
            >
              <button
                type="button"
                class="nb-script-tool nb-add-page"
                title="Add a page to this book"
                onClick={() => void addPage()}
              >
                <AddPageIcon />
                <span>page</span>
              </button>
              <button
                type="button"
                class="nb-script-tool"
                title="Paste Notebook Script into this page"
                onClick={() => setInsertOpen(true)}
              >
                Insert script
              </button>
              <button
                type="button"
                class="nb-script-tool"
                title="Copy this page as Notebook Script"
                onClick={() => {
                  const page = activePage();
                  if (page) void exportScript(page.id);
                }}
              >
                Export script
              </button>
              <button
                type="button"
                class="nb-script-tool"
                title="Copy the Notebook Script spec for your AI assistant"
                onClick={() =>
                  void copyText(
                    NOTEBOOK_SCRIPT_SPEC,
                    'spec copied — paste it to your AI',
                  )
                }
              >
                Copy AI spec
              </button>
            </div>

            <header class="nb-spread-header">
              <h1 class="nb-book-title">{loaded.book.title}</h1>
            </header>

            <div class="nb-book-cover">
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
              </div>
            </div>

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
        )}
      </Show>

      <Show when={toast()} keyed>
        {(message) => <div class="nb-script-toast">{message}</div>}
      </Show>
    </main>
  );
}
