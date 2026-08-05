/**
 * PageEditor — one TipTap editor per page.
 *
 * - Debounced (400ms) savePageDoc on every update; flushed on unmount.
 * - Document carries pageStyle ('ruled'|'grid'|'blank'|'dotted') and
 *   lineHeightPx attrs; the page background CSS renders them (editor.css).
 *   The BookView rail changes them through the imperative surface in
 *   src/editor/insert/activeEditor.ts (getPageStyle/setPageStyle/
 *   getLineHeight/setLineHeight) — the old in-page floating switcher is gone.
 * - Line-level drag handles (src/editor/dragHandle.ts — the handle's layer
 *   lives on <body>, NOT in the page; read that file's header before moving
 *   it back) + GSAP Flip settle on drop.
 * - Click-below-to-type: clicking the empty ruled area below the last block
 *   drops the caret on a fresh line (or pulses the page-full hint when the
 *   page is paginated and cannot grow).
 * - Right-click opens the block context menu (src/editor/menu) and the
 *   native menu is suppressed inside the editor only.
 * - Pagination contract (see src/editor/pagination.ts): when `paginated`,
 *   overflowing trailing blocks leave the page after each transaction via
 *   `onOverflow(removedBlocksJson, cursorCarried)`. Two things the drain must
 *   handle itself, both of them found by driving the app rather than by
 *   reading it (tests/e2e/pagination-probe.mjs): a LONE block taller than the
 *   paper, which no amount of peeling can move and which therefore simply
 *   vanished under `overflow: hidden` — `splitOverflowingBlock` cuts it; and
 *   the empty line StarterKit's TrailingNode keeps below a code block or a
 *   table, which is put back the instant it is peeled — the drain reasons
 *   about the page without it.
 *
 * Props are read once at mount (an editor instance is not hot-swappable);
 * remount with a keyed <Show>/<For> when the page changes.
 */
import type { Editor, JSONContent } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { Slice } from '@tiptap/pm/model';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { savePageDoc } from '../data/pages';
import type { PageDoc, PageStyle } from '../data/types';
import { bumpLinkGraph } from '../search/backlinks';
import { LINGER_MS, isMotionOff, tween } from '../styles/motion';
import BacklinksTab from './backlinks/BacklinksTab';
import { createPageBacklinks } from './backlinks/usePageBacklinks';
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  isPageStyle,
  normalizePageDoc,
} from './document';
import { createDragHandleWiring } from './dragHandle';
import { createEditorExtensions } from './extensions';
import { recordSnapshot } from './history/pageHistory';
import { registerPageEditor, unregisterPageEditor } from './instances';
import { setActiveEditor } from './insert/activeEditor';
import { handleEditorContextMenu } from './menu/contextMenuController';
import { createMediaPastePlugin } from './media';
import {
  accumulateCarriedCaret,
  contentOverflows,
  pageIsFull,
  trailingOverflowCount,
} from './pagination';
// The spread's own answer to "how much is this being DRAWN at". Imported
// rather than restated: a second copy of that division is a second chance to
// get the direction of it wrong, and the two callers are measuring the same
// page from opposite ends (BookView the leaf, this file the blocks inside it).
import { visualScale } from '../views/spread';
import { notifySaved } from './saveIndicator';
import { createEditorTransaction, createTiptapEditor } from './solid';
import { play } from '../sound/engine';
import { settings } from '../data/settings';
import { burstConfetti } from './effects/confetti';
import { mountMarginDoodles } from './effects/doodles';
import '../styles/effects.css';

/**
 * Soft pencil-tick when a todo checkbox is checked (delegated per page root)
 * — plus a confetti burst from the checkbox when the user opted in.
 *
 * Everything decorative is pushed to the next frame on purpose: the tick has
 * to be the fastest thing on screen, and measuring the box (a forced layout)
 * inside the change handler puts a layout read between the click and the
 * checkbox actually looking checked.
 */
function onTaskToggle(event: Event): void {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) ||
    target.type !== 'checkbox' ||
    target.closest('li[data-checked]') === null ||
    !target.checked
  ) {
    return;
  }
  void play('check-done');
  if (!settings.confettiOnComplete || settings.minimalistMode) return;
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    const rect = target.getBoundingClientRect();
    burstConfetti({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    void play('confetti');
  });
}

gsap.registerPlugin(Flip);

export interface PageEditorProps {
  readonly pageId: string;
  readonly initialDoc: PageDoc;
  /**
   * Fires on every editor update with the fresh doc JSON (same payload the
   * debounced save persists). The spread host uses it to keep its in-memory
   * page list current so leaf remounts never resurrect a stale doc.
   */
  readonly onDocChange?: (doc: PageDoc) => void;
  /** Pagination contract: fixed-capacity page that hands overflow onward. */
  readonly paginated?: boolean;
  /** Content budget in px, compared against the prose root's scrollHeight. */
  readonly pageCapacityPx?: number;
  /**
   * Receives the trailing top-level blocks (doc JSON) removed on overflow,
   * whether the caret sat inside them, and — when it did — the caret's PM
   * token offset within the carried content (BookView advances the spread
   * and restores the caret at that offset inside the next page's editor).
   */
  readonly onOverflow?: (
    blocks: unknown[],
    cursorCarried: boolean,
    caretOffset?: number | null,
  ) => void;
}

const SAVE_DEBOUNCE_MS = 400;
/** Safety bound on the overflow loop (a transaction per iteration). */
const MAX_OVERFLOW_PASSES = 64;

/**
 * Cut the page's last block so the part of it that does not fit can be carried.
 *
 * `trailingOverflowCount` may never take the last block standing — a page with
 * nothing on it is not a page — so a single block taller than the paper had no
 * move at all. That is not a corner case: the prose root is `overflow: hidden`
 * (pages never scroll), so ONE long paragraph ran off the bottom of the page
 * and stayed there. Past about a hundred and ten words the reader was typing
 * text they could not see, with their own caret below the paper, no scrollbar
 * and nothing to say where it had gone. Proved by driving the app:
 * `tests/e2e/pagination-probe.mjs`, which found 2688px of prose inside a 721px
 * page and the following page still blank.
 *
 * So the block is split at the last SOFT-WRAP boundary above the fold, and the
 * ordinary block drain carries the tail away on its next pass. Cutting where
 * the line already broke is what keeps a word whole: a browser only wraps
 * between words, so the last position whose caret box sits above the fold sits
 * in the gap between two of them.
 *
 * `coordsAtPos` is monotonic in y inside one text block, so a binary search
 * lands on that position in a handful of probes instead of walking the text.
 *
 * A code block is cut at a NEWLINE instead, never at a wrap: a soft wrap
 * inside code is the browser's doing and promoting one to a real line break
 * would change what the code says. A single code line too tall for a page
 * keeps today's behaviour rather than being corrupted into fitting.
 *
 * @param limitY Client y of the fold — the prose root's top plus whatever
 *               capacity is left once its own padding-bottom is paid for.
 * @param realCount How many of the doc's children the drain counts as the
 *               page's own content: the TrailingNode phantom the caller
 *               ignores is NOT one, and cutting it (it is empty) instead of
 *               the block above it would do nothing forever.
 * @returns true when a split was dispatched, so the caller should measure
 *          again; false when there is nothing safe to cut.
 */
function splitOverflowingBlock(
  view: EditorView,
  limitY: number,
  realCount: number,
): boolean {
  const state = view.state;
  const doc = state.doc;
  if (realCount < 1 || realCount > doc.childCount) return false;
  const block = doc.child(realCount - 1);
  // Two tokens is the least that can become two non-empty halves.
  if (!block.isTextblock || block.content.size < 2) return false;
  // Where that block ends: everything before it, plus the block itself.
  let end = 0;
  for (let i = 0; i < realCount; i += 1) end += doc.child(i).nodeSize;
  end -= 1; // just inside its closing token
  const start = end - block.content.size;

  let lo = start + 1;
  let hi = end - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let bottom: number;
    try {
      bottom = view.coordsAtPos(mid).bottom;
    } catch {
      // A position the view cannot place (a node view mid-teardown). Leaving
      // the block whole is the safe answer; the next transaction tries again.
      return false;
    }
    if (bottom <= limitY) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (at < 0) return false;

  if (block.type.spec.code === true) {
    // One token per character inside a code block, so a document position maps
    // straight onto an offset in its text.
    const newline = block.textContent.lastIndexOf('\n', at - start - 1);
    if (newline < 0) return false; // one line, longer than a page: leave it
    at = start + newline + 1;
  } else {
    // Do not open the carried block with the space the wrap swallowed.
    while (at < end && doc.textBetween(at, at + 1) === ' ') at += 1;
  }
  if (at <= start || at >= end) return false;

  // Deliberately NOT gated on `canSplit`. That helper refuses an ISOLATING
  // parent by rule, and a code block is isolating so that Enter inside it
  // types a newline rather than ending the block — a rule about editing
  // commands crossing the boundary, which a page break is not. Gating on it
  // made this whole branch unreachable for exactly the blocks that most need
  // it (checked: `canSplit` false, the step itself fine, two valid code blocks
  // out). What has to hold is that the STEP can make a legal document, and
  // ProseMirror answers that by refusing to apply — so ask it, and treat the
  // refusal as "leave the block whole".
  //
  // addToHistory false for the same reason the removal below is: a page break
  // is not an edit the reader made, and one Ctrl+Z must not half-undo one.
  try {
    view.dispatch(state.tr.split(at).setMeta('addToHistory', false));
  } catch {
    return false;
  }
  return true;
}

function topLevelBlocks(view: EditorView): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const child of Array.from(view.dom.children)) {
    if (child instanceof HTMLElement && child.hasAttribute('data-id')) {
      // Flip matches old/new elements by data-flip-id.
      child.setAttribute('data-flip-id', child.getAttribute('data-id') ?? '');
      blocks.push(child);
    }
  }
  return blocks;
}

export default function PageEditor(props: PageEditorProps): JSX.Element {
  let mountElement!: HTMLDivElement;
  let pageRootElement!: HTMLDivElement;

  // -------------------------------------------------------------------------
  // Debounced persistence
  // -------------------------------------------------------------------------
  const pageId = props.pageId;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingDoc: PageDoc | null = null;
  /** Set on every update, cleared by `mirror()`. Non-null means "unserialized". */
  let dirtyEditor: Editor | null = null;
  let mirrorQueued = false;

  /**
   * Serialize the document ONCE and feed both consumers from it.
   *
   * getJSON() walks the whole doc, and a single user action routinely lands
   * several transactions (the edit, UniqueID's appended one, a node view's
   * own). Serializing per transaction meant paying for the whole page each
   * time; a microtask collapses the burst into one pass without deferring
   * anything past the current task, so unmount still flushes the latest doc.
   */
  const mirror = (): void => {
    mirrorQueued = false;
    const instance = dirtyEditor;
    dirtyEditor = null;
    if (instance === null || instance.isDestroyed) return;
    const doc = instance.getJSON() as PageDoc;
    pendingDoc = doc;
    props.onDocChange?.(doc);
  };

  const flushSave = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    mirror(); // materialize anything the microtask has not picked up yet
    if (pendingDoc !== null) {
      const doc = pendingDoc;
      pendingDoc = null;
      void savePageDoc(pageId, doc).then(() => {
        notifySaved();
        // The save rewrote this page's row in the search index, and the link
        // graph is built from those rows — so any page this one now points at
        // (or has stopped pointing at) has a stale backlinks tab until this.
        bumpLinkGraph();
      });
      // Page history (roadmap #13): the flushed doc is snapshot-worthy —
      // the ring throttles internally so bursts collapse to one snapshot.
      recordSnapshot(pageId, doc);
    }
  };

  const scheduleSave = (instance: Editor): void => {
    dirtyEditor = instance;
    if (!mirrorQueued) {
      mirrorQueued = true;
      queueMicrotask(mirror);
    }
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  onCleanup(flushSave);

  // -------------------------------------------------------------------------
  // GSAP Flip reorder settle (doc §7): capture block positions before the
  // drop transaction mutates the DOM, animate transforms after.
  // -------------------------------------------------------------------------
  const handleDrop = (
    view: EditorView,
    _event: DragEvent,
    _slice: Slice,
    moved: boolean,
  ): boolean => {
    // Flip animates transforms only, but it still measures — skip the whole
    // capture when motion is off rather than tweening to a zero duration.
    if (!moved || isMotionOff()) return false;
    const state = Flip.getState(topLevelBlocks(view));
    // ProseMirror applies the drop synchronously in this task; the microtask
    // runs right after, with the DOM already reordered.
    queueMicrotask(() => {
      Flip.from(state, {
        targets: topLevelBlocks(view),
        // `enter`, not `spring`: these blocks are text, and an overshoot on
        // a paragraph reads as the page wobbling rather than as weight.
        ...tween('normal', 'enter'),
      });
    });
    return false; // let ProseMirror handle the actual drop
  };

  // -------------------------------------------------------------------------
  // Page-full hint ("page is full — flip onward"), auto-clearing pulse.
  // -------------------------------------------------------------------------
  const [pageFullHint, setPageFullHint] = createSignal(false);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const pulsePageFullHint = (): void => {
    setPageFullHint(true);
    if (hintTimer !== undefined) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setPageFullHint(false), LINGER_MS.hint);
  };
  onCleanup(() => {
    if (hintTimer !== undefined) clearTimeout(hintTimer);
  });

  // -------------------------------------------------------------------------
  // Pagination — measure after each transaction; peel trailing blocks while
  // the content overflows the capacity (contract in src/editor/pagination.ts)
  // -------------------------------------------------------------------------
  const capacityPx = (): number | undefined => {
    const value = props.pageCapacityPx;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  };
  const isPaginated = (): boolean => props.paginated === true;

  let extracting = false;

  const extractOverflow = (instance: Editor): void => {
    const capacity = capacityPx();
    if (!isPaginated() || capacity === undefined) return;
    if (extracting || instance.isDestroyed) return;
    extracting = true;
    try {
      const view = instance.view;
      const root = view.dom;
      const removed: unknown[] = [];
      let caretOffset: number | null = null;
      let passes = 0;

      // Content-based measurement (block bottoms + surviving padding): the
      // spread stretches the prose root to fill the leaf, so its scrollHeight
      // equals the page height even when half empty and cannot be trusted.
      //
      // The loop no longer gates on `childCount > 1`: a lone block that will
      // not fit is exactly the case `splitOverflowingBlock` exists for, and
      // gating it out is what made that block invisible instead.
      while (passes < MAX_OVERFLOW_PASSES) {
        passes += 1;
        const rootRect = root.getBoundingClientRect();
        const rootTop = rootRect.top;
        const bottoms = Array.from(root.children).map(
          (child) => child.getBoundingClientRect().bottom - rootTop,
        );
        // Both sides of the comparison have to be in the SAME pixels. Block
        // bottoms come off getBoundingClientRect — DRAWN px, so a scaled
        // spread scales them — and the capacity is quoted in drawn px for that
        // reason (BookView's measureCapacity says why). A computed padding is
        // a LAYOUT number and a transform does not touch it, so it has to be
        // scaled to join them. Left unscaled, a book drawn at 62% beside an
        // open rail sheet charged itself a 32px foot it was only paying 20px
        // for and peeled a line the page still had room for — and nothing
        // pulls a carried block BACK, so closing the sheet did not undo it.
        const padBottom =
          (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0) *
          visualScale(rootRect.height, root.clientHeight);
        const doc = view.state.doc;

        // The empty line StarterKit's TrailingNode keeps at the foot of any
        // page that ends in something other than a paragraph — so a reader can
        // always type past a code block, a table or an image. It is
        // bookkeeping, not ink, and it is PUT BACK the instant it is taken.
        // Peeling it therefore never made progress: the drain spent all
        // sixty-four of its passes shuttling the same empty line off the page
        // and handed BookView sixty-four empty paragraphs to prepend to the
        // next one (which then peeled forty-three of them onto the one after
        // that), while the block that was actually hanging off the paper never
        // moved at all. Measured on a 70-line code block: `remove 1, kids 2`,
        // identical, sixty-four times.
        //
        // So the drain reasons about the page WITHOUT it — unless the caret is
        // standing in it, which is the reader pressing Enter at the foot of a
        // full page and expecting to arrive on the next one.
        const tail = doc.lastChild;
        const phantom =
          doc.childCount > 1 &&
          tail !== null &&
          tail.type.name === 'paragraph' &&
          tail.content.size === 0 &&
          view.state.selection.head <= doc.content.size - tail.nodeSize;
        // Where the page's real content ends, and how many blocks it is.
        const cut = doc.content.size - (phantom ? (tail?.nodeSize ?? 0) : 0);
        const realBottoms = phantom ? bottoms.slice(0, -1) : bottoms;
        const realCount = doc.childCount - (phantom ? 1 : 0);

        const removeCount = Math.min(
          trailingOverflowCount(realBottoms, capacity, padBottom),
          realCount - 1,
        );
        if (removeCount <= 0) {
          // Nothing left that may be peeled. If the page still overflows, the
          // block standing on it is taller than the paper — cut it and let the
          // next pass carry the tail (see splitOverflowingBlock).
          if (!contentOverflows(realBottoms, capacity, padBottom)) break;
          if (
            !splitOverflowingBlock(
              view,
              rootTop + capacity - padBottom,
              realCount,
            )
          ) {
            break;
          }
          continue;
        }

        let from = cut;
        for (let i = 0; i < removeCount; i += 1) {
          const child = doc.child(realCount - 1 - i);
          from -= child.nodeSize;
          removed.unshift(child.toJSON());
        }
        // Caret carry (roadmap first-duty fix): track where the caret sits
        // inside the carried content so BookView can restore it on the next
        // page. Later passes prepend earlier blocks, shifting the offset.
        caretOffset = accumulateCarriedCaret(
          caretOffset,
          view.state.selection.head,
          from,
          cut - from,
        );

        // One transaction for the removal; addToHistory false so undo does
        // not resurrect the overflow (and re-trigger the loop).
        const tr = view.state.tr.delete(from, cut);
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
      }

      if (removed.length > 0) {
        props.onOverflow?.(removed, caretOffset !== null, caretOffset);
      }
    } finally {
      extracting = false;
    }
  };

  // -------------------------------------------------------------------------
  // Click-below-to-type — clicking the empty ruled area below the last block
  // places the caret on a fresh line (contract: append an empty paragraph or
  // reuse a trailing empty one; pulse the hint instead when at capacity).
  // -------------------------------------------------------------------------
  const handleClick = (
    view: EditorView,
    _pos: number,
    event: MouseEvent,
  ): boolean => {
    const instance = editor();
    if (!instance) return false;
    const root = view.dom;
    const last = root.lastElementChild;
    if (!(last instanceof HTMLElement)) return false;
    const lastRect = last.getBoundingClientRect();
    if (event.clientY <= lastRect.bottom) return false;

    const doc = view.state.doc;
    const lastNode = doc.lastChild;
    const trailingEmptyParagraph =
      lastNode !== null &&
      lastNode.type.name === 'paragraph' &&
      lastNode.content.size === 0;

    if (trailingEmptyParagraph) {
      // Reuse the empty line that is already waiting there.
      instance
        .chain()
        .setTextSelection(doc.content.size - 1)
        .focus()
        .run();
      return true;
    }

    if (isPaginated()) {
      // Content height = last block bottom + surviving padding (see
      // extractOverflow for why scrollHeight is unusable here — and for why
      // the padding is scaled into drawn px before it joins a rect distance).
      const rootRect = root.getBoundingClientRect();
      const contentHeight =
        lastRect.bottom -
        rootRect.top +
        (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0) *
          visualScale(rootRect.height, root.clientHeight);
      if (pageIsFull(contentHeight, lineHeightPx(), capacityPx())) {
        pulsePageFullHint();
        return true;
      }
    }

    instance
      .chain()
      .insertContentAt(doc.content.size, { type: 'paragraph' })
      .focus('end')
      .run();
    return true;
  };

  // -------------------------------------------------------------------------
  // Editor
  // -------------------------------------------------------------------------
  // Built before the editor: the extension calls render() while the editor is
  // still under construction, so the wiring has to exist first and is bound
  // to the instance afterwards.
  const dragWiring = createDragHandleWiring(pageId);

  const editor = createTiptapEditor(() => ({
    element: mountElement,
    extensions: createEditorExtensions({
      interactive: true,
      placeholder: 'Type / for commands…',
      dragHandle: {
        render: dragWiring.render,
        onElementDragStart: dragWiring.onElementDragStart,
        onElementDragEnd: dragWiring.onElementDragEnd,
      },
    }),
    // PageDoc's content is unknown[] on purpose (the data layer only owns the
    // envelope); the schema validates the deep shape when the editor parses it.
    content: normalizePageDoc(props.initialDoc) as JSONContent,
    editorProps: {
      attributes: { class: 'nb-prose', spellcheck: 'true' },
      handleDrop,
      handleClick,
      handleDOMEvents: {
        // Right-click block menu; the native menu is suppressed only here.
        contextmenu: (_view, event: Event): boolean => {
          const instance = editor();
          if (!instance || !(event instanceof MouseEvent)) return false;
          return handleEditorContextMenu(instance, event);
        },
      },
    },
    onUpdate: ({ editor: instance }) => {
      // Overflow stays synchronous: the no-scrollbars contract has to hold on
      // the frame the text was typed, not one frame later.
      extractOverflow(instance);
      scheduleSave(instance);
    },
    // Two editors are mounted at once in the spread view; the focused one is
    // the "active" editor the script toolbar/dialog should target.
    onFocus: ({ editor: instance }) => setActiveEditor(instance),
  }));

  // Publish the live editor for the script toolbar/dialog + install the media
  // paste/drop plugin and the drag-handle wiring (once per instance).
  let mediaPluginInstalled: unknown = null;
  let detachDragWiring: (() => void) | undefined;
  createEffect(() => {
    const instance = editor();
    setActiveEditor(instance ?? null);
    if (instance) registerPageEditor(pageId, instance);
    if (instance && mediaPluginInstalled !== instance) {
      instance.registerPlugin(createMediaPastePlugin());
      detachDragWiring?.();
      detachDragWiring = dragWiring.attach(instance);
      mediaPluginInstalled = instance;
    }
  });
  onCleanup(() => {
    detachDragWiring?.();
    detachDragWiring = undefined;
  });
  onCleanup(() => {
    setActiveEditor(null);
    const instance = editor();
    if (instance) unregisterPageEditor(pageId, instance);
  });

  /*
   * Initial-overflow pass: a freshly (re)mounted paginated page may already
   * exceed capacity (BookView prepends carried blocks).
   *
   * SYNCHRONOUS, BEFORE THE FRAME IS PAINTED. This used to wait for a
   * `requestAnimationFrame`, and rAF fires *after* the browser has painted —
   * so the reader saw one painted frame of the un-drained page and then watched
   * a block leave it. Reported from the demo: *"weird bug when turning pages,
   * basically items at bottom of left page after page turn go to the right in a
   * second"*, and it is a real edit rather than a wobble — the drain REMOVES
   * trailing blocks from one page's document and hands them to the next, and
   * nothing pulls them back.
   *
   * Measured with `probe-turn-reflow.mjs`: 2 of 6 turns moved a block after
   * landing, and BOTH were turns that took the rigid fold. That is the whole
   * asymmetry — on a curl the leaves mount `visibility: hidden` behind the
   * canvas and drain out of sight, so the same reflow was always happening and
   * only the fold ever showed it.
   *
   * `extractOverflow` reads `getBoundingClientRect()`, which forces layout
   * itself, so there is nothing to wait for: the rAF was buying a paint, not a
   * measurement. The fonts pass stays — handwriting metrics land later and
   * genuinely change what fits.
   */
  createEffect(() => {
    const instance = editor();
    if (!instance || !isPaginated()) return;
    if (!instance.isDestroyed) extractOverflow(instance);
    void document.fonts?.ready.then(() => {
      if (!instance.isDestroyed) extractOverflow(instance);
    });
  });

  // -------------------------------------------------------------------------
  // Page style (doc attrs → background CSS)
  // -------------------------------------------------------------------------
  const pageStyle = createEditorTransaction(editor, (instance): PageStyle => {
    const value: unknown = instance?.state.doc.attrs.pageStyle;
    return isPageStyle(value) ? value : DEFAULT_PAGE_STYLE;
  });

  const lineHeightPx = createEditorTransaction(editor, (instance): number => {
    const value: unknown = instance?.state.doc.attrs.lineHeightPx;
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : DEFAULT_LINE_HEIGHT_PX;
  });

  // -------------------------------------------------------------------------
  // Margin doodles — deterministic pencil sketches, seeded by pageId.
  // Mounted only when the user wants them (settings are reactive; the
  // nb-minimalist/nb-no-doodles root classes hide them as a CSS backstop).
  // -------------------------------------------------------------------------
  let doodleCleanup: (() => void) | undefined;
  createEffect(() => {
    const show = settings.showMarginDoodles && !settings.minimalistMode;
    doodleCleanup?.();
    doodleCleanup = undefined;
    if (show) doodleCleanup = mountMarginDoodles(pageRootElement, pageId);
  });
  onCleanup(() => {
    doodleCleanup?.();
    doodleCleanup = undefined;
  });

  // -------------------------------------------------------------------------
  // Backlinks — the pages that point at this one, listed at the foot of the
  // page. The strip is reserved through a custom property rather than
  // measured, because the overflow drain above re-reads the prose's
  // padding-bottom on every pass and a measured height would be a second
  // answer to the same question (src/editor/backlinks/BacklinksTab.tsx).
  // -------------------------------------------------------------------------
  const backlinks = createPageBacklinks(() => pageId);
  const backlinkRailPx = (): string =>
    backlinks().length > 0 ? 'var(--nb-backlink-tab-h)' : '0px';

  return (
    <div
      class="nb-page"
      data-style={pageStyle()}
      data-paginated={isPaginated() ? 'true' : undefined}
      style={{
        '--page-line-height': `${lineHeightPx()}px`,
        '--nb-backlink-rail': backlinkRailPx(),
      }}
      ref={(el) => {
        pageRootElement = el;
        el.addEventListener('change', onTaskToggle);
        onCleanup(() => el.removeEventListener('change', onTaskToggle));
      }}
    >
      <div class="nb-page-editor" ref={mountElement} />
      <BacklinksTab cards={backlinks()} />
      <div
        class="nb-page-full-hint font-accent"
        classList={{ 'is-active': pageFullHint() }}
        role="status"
        aria-hidden={!pageFullHint()}
      >
        page is full — flip onward
      </div>
    </div>
  );
}
