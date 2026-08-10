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
 *   ORDERING RULE, and the reason merely reading a book used to duplicate it:
 *   the removal is published to the store (`publish`) BEFORE `onOverflow`
 *   hands the blocks up, never a microtask after it. The host reads the target
 *   page out of that store synchronously, so a document that is one drain out
 *   of date is a document it will happily put the drained blocks back into.
 *   The long note at the foot of `extractOverflow` is the one to read.
 *
 * Props are read once at mount (an editor instance is not hot-swappable);
 * remount with a keyed <Show>/<For> when the page changes.
 */
import type { Editor, JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@tiptap/pm/view';
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
  DEFAULT_RULE_GAP_PX,
  clampRuleGapPx,
  isPageStyle,
  normalizePageDoc,
} from './document';
import { createDragHandleWiring } from './dragHandle';
import { createEditorExtensions } from './extensions';
import { recordSnapshot } from './history/pageHistory';
import { registerPageEditor, unregisterPageEditor } from './instances';
import { setActiveEditor } from './insert/activeEditor';
import { handleEditorContextMenu } from './menu/contextMenuController';
import {
  createMediaPastePlugin,
  insertMediaFiles,
  mediaFilesFrom,
} from './media';
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
import { burstConfetti, taskCompletionCue } from './effects/confetti';
import { mountMarginDoodles } from './effects/doodles';
import { notify } from './script/exporters/toast';
import '../styles/effects.css';

/**
 * Soft pencil-tick when a todo checkbox is checked without a celebration
 * (delegated per page root), plus a deliberately silent confetti burst when
 * the reader opted in.
 *
 * Pointer activation remembers coordinates from the event, so the common path
 * starts without a forced layout read or an extra staging frame. Keyboard and
 * assistive activation keep a next-frame measured fallback.
 */
const taskPointerOrigins = new WeakMap<
  HTMLInputElement,
  { readonly x: number; readonly y: number; readonly at: number }
>();

function onTaskPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) ||
    !event.isPrimary ||
    event.button !== 0 ||
    target.type !== 'checkbox' ||
    target.closest('li[data-checked]') === null
  ) {
    return;
  }
  // Pointer coordinates are already present on the event, so remembering
  // them costs no layout. Only cache the unchecked -> checked direction.
  if (!target.checked) {
    taskPointerOrigins.set(target, {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
    });
  } else {
    taskPointerOrigins.delete(target);
  }
}

function onTaskToggle(event: Event): void {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) ||
    target.type !== 'checkbox' ||
    target.closest('li[data-checked]') === null
  ) {
    return;
  }
  const cachedPointerOrigin = taskPointerOrigins.get(target);
  taskPointerOrigins.delete(target);
  if (!target.checked) return;
  const pointerOrigin =
    cachedPointerOrigin !== undefined &&
    event.timeStamp - cachedPointerOrigin.at >= 0 &&
    event.timeStamp - cachedPointerOrigin.at <= 1_000
      ? cachedPointerOrigin
      : undefined;
  const celebrates =
    settings.confettiOnComplete &&
    !settings.minimalistMode &&
    !isMotionOff();
  // The visual burst is deliberately silent. When it is disabled, keep the
  // ordinary completion cue; when it is enabled, do not substitute another
  // object or leave a quieter sound underneath it.
  const completionCue = taskCompletionCue(celebrates);
  if (completionCue !== null) void play(completionCue);
  if (!celebrates) return;
  if (pointerOrigin !== undefined) {
    burstConfetti(pointerOrigin);
    return;
  }
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    const rect = target.getBoundingClientRect();
    burstConfetti({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  });
}

gsap.registerPlugin(Flip);

export interface PageEditorProps {
  readonly pageId: string;
  readonly initialDoc: PageDoc;
  /** Page-level action surfaced at the bottom of the right-click menu. */
  readonly onDeletePage?: () => void;
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

interface GridSnapDecoration {
  from: number;
  to: number;
  pixels: number;
}

function gridSnapCorrection(laidOutTop: number, pitch: number): number {
  if (!Number.isFinite(laidOutTop) || !Number.isFinite(pitch) || pitch <= 0) {
    return 0;
  }
  const phase = ((laidOutTop % pitch) + pitch) % pitch;
  return phase < 0.5 || pitch - phase < 0.5 ? 0 : pitch - phase;
}

/**
 * ProseMirror owns every direct child of `.nb-prose`.
 *
 * Writing an inline style onto one of those elements looks right for one DOM
 * turn, then ProseMirror's observer restores the DOM described by its state and
 * the style disappears. A node decoration is the sanctioned way to put a
 * measured presentation attribute on an editor node: it survives redraws,
 * maps through document transactions, and is removed by the same owner that
 * applied it.
 */
function createGridSnapPlugin(
  key: PluginKey<DecorationSet>,
): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, decorations) => {
        const measured = transaction.getMeta(key) as
          | readonly GridSnapDecoration[]
          | undefined;
        if (measured !== undefined) {
          return DecorationSet.create(
            transaction.doc,
            measured.map(({ from, to, pixels }) =>
              Decoration.node(from, to, {
                'data-nb-grid-snap': pixels.toFixed(2),
                style: `--nb-grid-snap: ${pixels.toFixed(2)}px;`,
              }),
            ),
          );
        }
        return decorations.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations: (state) => key.getState(state) ?? null,
    },
  });
}

/**
 * Put ordinary prose back on the paper grid after an irregular-height block.
 *
 * Cards, media, diagrams and other special node views are allowed to size
 * themselves to their content. Their height is rarely an exact multiple of
 * the page pitch, though, so the next plain paragraph used to inherit that
 * remainder and float between the printed lines. Only the first ordinary text
 * block after a special block needs a spacer; once it is snapped, every later
 * line follows from the prose line-height again.
 *
 * The correction is added INSIDE the target's top padding (editor.css), not as
 * a margin and not as a page/ruling offset. Its border-box top therefore does
 * not move when the correction is applied. Re-measuring the same layout yields
 * the same number instead of alternately adding and removing a pitch: this is
 * the idempotence the ResizeObserver path depends on.
 */
function measureProseGridSnaps(
  view: EditorView,
  pitch: number,
): GridSnapDecoration[] {
  if (!Number.isFinite(pitch) || pitch <= 0) return [];
  const root = view.dom;
  const children = Array.from(root.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  const ranges: Array<{ from: number; to: number }> = [];
  view.state.doc.forEach((node, from) => {
    ranges.push({ from, to: from + node.nodeSize });
  });
  // A node view may be between construction and attachment for one frame. Do
  // not risk decorating the wrong document node; the MutationObserver below
  // queues the complete shape as soon as it lands.
  if (children.length !== ranges.length) return [];

  /*
   * "Ordinary" means writing whose first line belongs on the paper's rule,
   * not merely a naked paragraph. Lists and blockquotes are top-level
   * ProseMirror nodes too; their actual words live in descendant paragraphs,
   * which inherit the decoration's --nb-grid-snap value. Leaving those roots
   * out is exactly how the ledger specimen failed: ledger -> blockquote meant
   * the quoted prose kept the ledger's fractional phase and floated above the
   * printed lines even though paragraph -> ledger -> paragraph looked right.
   */
  const ordinary = (node: Element): boolean =>
    node.matches('p, h1, h2, h3, h4, ul, ol, blockquote');
  const rootRect = root.getBoundingClientRect();
  const scale = visualScale(rootRect.height, root.clientHeight);
  const measured: GridSnapDecoration[] = [];

  for (let index = 1; index < children.length; index += 1) {
    const child = children[index] as HTMLElement;
    const previous = children[index - 1] as HTMLElement;
    if (!ordinary(child) || ordinary(previous)) continue;
    const laidOutTop =
      (child.getBoundingClientRect().top - rootRect.top) / scale;
    const pixels = gridSnapCorrection(laidOutTop, pitch);
    if (pixels <= 0) continue;
    measured.push({ ...ranges[index]!, pixels });
  }
  return measured;
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
   * Serialize the document NOW and feed both consumers from it.
   *
   * Split out of `mirror` so the overflow drain can publish its own removal on
   * the spot — see the long note at the foot of `extractOverflow`, which is the
   * whole reason this is callable rather than only queueable. Everything it
   * does is idempotent: clearing `dirtyEditor` is what makes the queued
   * microtask a no-op once the work it was queued for has already been done.
   */
  const publish = (instance: Editor): void => {
    dirtyEditor = null;
    if (instance.isDestroyed) return;
    const doc = instance.getJSON() as PageDoc;
    pendingDoc = doc;
    props.onDocChange?.(doc);
  };

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
    if (instance === null) return;
    publish(instance);
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
        /*
         * BOTH SIDES OF THE COMPARISON IN LAID-OUT PIXELS, AND THE CONVERSION
         * ON THIS SIDE OF IT.
         *
         * Block bottoms come off `getBoundingClientRect()` — DRAWN px, which a
         * scaled spread (the focus dial's zoom, the fit beside an open rail
         * sheet) scales. The capacity and this padding are laid-out numbers a
         * transform cannot touch. Something has to convert, and which side
         * converts is not a matter of taste:
         *
         *   - scaling the CAPACITY up to drawn px is what this used to do, via
         *     `floor(laidOut × s)` in BookView. `floor` is not proportional to
         *     `s`, so what fits on the page moved by half a pixel when a sheet
         *     opened and by up to ~3px at the smallest fit — and a page the
         *     drain had already packed to its boundary lost its last block to a
         *     colour picker, permanently, because the contract peels forward
         *     and never pulls back (demo frames 862/863; measured on every
         *     spread by scripts/probe-panel-repaginate.mjs).
         *   - dividing the RECT distances down to laid-out px, as here, leaves
         *     one residual: `clientHeight` is rounded to a whole pixel, so
         *     `scale` is out by a factor of about H_true/round(H_true). That
         *     error is CONSTANT in `s` — it cancels between two scales — so the
         *     drain's verdict is identical whether the sheet is open or shut,
         *     which is the property `styles/spread.css` promises the reader.
         */
        const scale = visualScale(rootRect.height, root.clientHeight);
        const bottoms = Array.from(root.children).map(
          (child) => (child.getBoundingClientRect().bottom - rootTop) / scale,
        );
        const padBottom =
          Number.parseFloat(getComputedStyle(root).paddingBottom) || 0;
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
              // Back into DRAWN px on the way out: this one is a client y for
              // `coordsAtPos` to be compared against, not a page measurement.
              rootTop + (capacity - padBottom) * scale,
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
        /*
         * THE REMOVAL REACHES THE STORE BEFORE THE BLOCKS REACH THE HOST, AND
         * THAT ORDERING IS THE WHOLE FIX FOR READING A BOOK DUPLICATING IT.
         *
         * Nothing had to be typed. Opening the Welcome book and turning through
         * it took a clean 32 pages to a block on two pages and eight blocks
         * twice on one (`scripts/probe-page-duplication.mjs`), and the reader
         * saw it as a green callout printed twice — *"it shows the same section
         * copied on the next page as well"*.
         *
         * Both leaves of a spread mount inside ONE synchronous Solid effects
         * flush, and each runs the initial drain above inside it. So by the end
         * of that single task the RIGHT leaf has already peeled its own tail B1
         * off itself. But a drain's removal only reached the store through
         * `queueMicrotask(mirror)`, while `onOverflow` fires SYNCHRONOUSLY on
         * the line below and BookView commits the carry to its chain the
         * instant it arrives — which parked the host's read of the target page
         * squarely BETWEEN the two:
         *
         *     MT-1  mirror(page 0)   the left leaf's removal lands. Fine.
         *     MT-2  carry(page 0)    reads page 1 from the store — PRE-DRAIN.
         *     MT-3  mirror(page 1)   too late: B1 has already been put back.
         *
         * At MT-2 the carry therefore prepended its blocks to a page-1 document
         * that still held B1, wrote that back to the store and to the row, and
         * bumped the version — which remounts the leaf. The fresh editor was
         * handed the resurrected B1 as its initial doc, drained it a SECOND
         * time, and the page after it received the same block twice at adjacent
         * indices. (The remount also destroyed the first editor before MT-3
         * ever ran, so `mirror` and `flushSave` both bailed on `isDestroyed`
         * and its removal reached neither the store nor the database.) The very
         * first duplicate needed ZERO page turns, because this was never a page
         * turn: it was the two leaves of the opening spread.
         *
         * Publishing here closes it at the SOURCE instead of at the reader. The
         * store cannot hold a pre-drain document past the drain that made it
         * stale, so nothing downstream — the carry, a leaf remount, a flip
         * snapshot — can pick one up, and none of them has to know how far
         * behind the store might be. It also materializes `pendingDoc` on the
         * spot, which is what lets `onCleanup(flushSave)` still write the row
         * when a remount destroys this editor before its 400ms elapses.
         *
         * The other cut was to fix the READER — hand the blocks to the target's
         * live editor as a transaction rather than rewriting its stored doc
         * (kept at `qa/wip/BookView.duplication-fix-v1.tsx`). It also took the
         * probe to zero, and it moved the target's SELECTION; the drain reads
         * the selection to decide the caret travelled with the text, so reading
         * a book threw the reader nineteen spreads forward, stole focus into a
         * ProseMirror and killed the arrow keys. Fixing the writer moves
         * neither the caret nor the spread, and this is the only line of it.
         */
        publish(instance);
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
      // Content height = last block bottom + surviving padding, in LAID-OUT px
      // (see extractOverflow for why scrollHeight is unusable here, and why the
      // rect distance is the side that converts). The line height this is about
      // to be compared against is a laid-out number too — it comes off the
      // doc's own attrs — so a drawn-px content height silently charged a
      // scaled book for a line 27% taller than the one it was about to add.
      const rootRect = root.getBoundingClientRect();
      const contentHeight =
        (lastRect.bottom - rootRect.top) /
          visualScale(rootRect.height, root.clientHeight) +
        (Number.parseFloat(getComputedStyle(root).paddingBottom) || 0);
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
  const gridSnapKey = new PluginKey<DecorationSet>(
    `nb-grid-snap-${pageId}`,
  );
  const gridSnapPlugin = createGridSnapPlugin(gridSnapKey);
  let gridSnapSignature = '[]';

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
          return handleEditorContextMenu(
            instance,
            event,
            notify,
            props.onDeletePage === undefined
              ? undefined
              : { onDeletePage: props.onDeletePage },
          );
        },
      },
    },
    onUpdate: ({ editor: instance }) => {
      // Overflow stays synchronous: the no-scrollbars contract has to hold on
      // the frame the text was typed, not one frame later.
      extractOverflow(instance);
      scheduleSave(instance);
      queueGridSnap();
    },
    // Two editors are mounted at once in the spread view; the focused one is
    // the "active" editor the script toolbar/dialog should target.
    onFocus: ({ editor: instance }) => setActiveEditor(instance),
  }));

  let gridSnapFrame = 0;
  const applyGridSnap = (): void => {
    const instance = editor();
    if (
      !instance ||
      instance.isDestroyed ||
      gridSnapKey.getState(instance.state) === undefined
    ) {
      return;
    }
    const storedPitch: unknown = instance.state.doc.attrs.lineHeightPx;
    const pitch =
      typeof storedPitch === 'number' && Number.isFinite(storedPitch)
        ? storedPitch
        : DEFAULT_LINE_HEIGHT_PX;
    const measured = measureProseGridSnaps(
      instance.view,
      pitch,
    ).map((snap) => ({
      ...snap,
      pixels: Number(snap.pixels.toFixed(2)),
    }));
    const signature = JSON.stringify(measured);
    if (signature === gridSnapSignature) return;
    gridSnapSignature = signature;
    instance.view.dispatch(
      instance.state.tr.setMeta(gridSnapKey, measured),
    );
  };
  const queueGridSnap = (): void => {
    if (gridSnapFrame !== 0) return;
    gridSnapFrame = requestAnimationFrame(() => {
      gridSnapFrame = 0;
      applyGridSnap();
    });
  };

  createEffect(() => {
    const instance = editor();
    if (!instance || instance.isDestroyed) return;
    const root = instance.view.dom;
    const resize = new ResizeObserver(queueGridSnap);
    const observeCurrentBlocks = (): void => {
      resize.disconnect();
      resize.observe(root, { box: 'border-box' });
      for (const child of Array.from(root.children)) {
        // Special blocks can grow because their border or padding changes
        // while their content box stays identical (a late card treatment is
        // one real example). The default content-box observation misses that
        // movement even though it shifts every following baseline.
        if (child instanceof HTMLElement) {
          resize.observe(child, { box: 'border-box' });
        }
      }
    };
    const mutations = new MutationObserver(() => {
      observeCurrentBlocks();
      queueGridSnap();
    });
    observeCurrentBlocks();
    mutations.observe(root, { childList: true, subtree: true });
    queueGridSnap();
    void document.fonts?.ready.then(() => {
      if (!instance.isDestroyed) queueGridSnap();
    });
    onCleanup(() => {
      mutations.disconnect();
      resize.disconnect();
    });
  });
  onCleanup(() => {
    if (gridSnapFrame !== 0) cancelAnimationFrame(gridSnapFrame);
  });

  // Publish the live editor for the script toolbar/dialog + install the media
  // paste/drop plugin and the drag-handle wiring (once per instance).
  let mediaPluginInstalled: unknown = null;
  let gridSnapPluginInstalled: unknown = null;
  let detachDragWiring: (() => void) | undefined;
  createEffect(() => {
    const instance = editor();
    setActiveEditor(instance ?? null);
    if (instance) registerPageEditor(pageId, instance);
    if (instance && gridSnapPluginInstalled !== instance) {
      instance.registerPlugin(gridSnapPlugin);
      gridSnapPluginInstalled = instance;
      gridSnapSignature = '[]';
      // The first measurement is synchronous, like initial overflow above.
      // Deferring it to rAF paints one frame with text after a card/ledger
      // floating between rules, then visibly pushes that text onto the grid.
      // getBoundingClientRect() performs the needed layout immediately; later
      // media/font/resize changes still use the coalesced observer path.
      applyGridSnap();
      // Some custom node views finish attaching after registerPlugin returns.
      // In that narrow construction window measureProseGridSnaps deliberately
      // returns [] rather than decorating the wrong document node. Re-measure
      // in a microtask as well: node-view construction has finished, but the
      // browser has not painted yet. The old rAF-only retry was the visible
      // one-pixel drop after a turned page containing cards or image captions.
      queueMicrotask(() => {
        if (!instance.isDestroyed) applyGridSnap();
      });
    }
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
    /*
     * THE READING TYPE IS A PAGE METRIC, and this line is what says so.
     *
     * Settings' "body size" moves the type on the page (and the rule pitch with
     * it), so what fits on a leaf changes — but the LEAF'S BOX does not, and the
     * box is what capacity is measured from. `remeasureCapacityWhenSettled()`
     * would hand `setPageCapacity` the identical number, and a signal set to
     * what it already holds notifies nobody.
     *
     * The drain does re-run today, and that is the problem: it re-runs by
     * ACCIDENT. `--text-body` still sizes the chrome the spread is laid out
     * beside, so the leaf measures 638px at slider 15 and 635px at 21 — three
     * pixels of unrelated shell moving the capacity by enough to notify. It
     * works, and it would stop working SILENTLY, as text clipped under
     * `overflow: hidden`, the day the shell stops reading that variable.
     *
     * So the dependency is declared rather than inherited.
     */
    void settings.bodyFontSize;
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

  const ruleGapPx = createEditorTransaction(editor, (instance): number => {
    const value: unknown = instance?.state.doc.attrs.ruleGapPx;
    return value === undefined ? DEFAULT_RULE_GAP_PX : clampRuleGapPx(value);
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

  /** Catch OS media drops on the paper margin as well as the prose root. */
  const onPageDragOver = (event: DragEvent): void => {
    if (mediaFilesFrom(event.dataTransfer).length > 0) event.preventDefault();
  };

  const onPageDrop = (event: DragEvent): void => {
    // The ProseMirror media plugin already handled a drop inside `.nb-prose`.
    if (event.defaultPrevented) return;
    const instance = editor();
    if (instance === undefined || instance.isDestroyed) return;
    const files = mediaFilesFrom(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    const at = instance.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos ?? instance.state.doc.content.size;
    void insertMediaFiles(instance.view, files, at).then((count) => {
      if (count > 0) notify(count === 1 ? 'media added' : `${count} media blocks added`);
    });
  };

  return (
    <div
      class="nb-page"
      data-style={pageStyle()}
      data-paginated={isPaginated() ? 'true' : undefined}
      style={{
        '--page-line-height': `${lineHeightPx()}px`,
        '--page-rule-gap': `${ruleGapPx()}px`,
        '--nb-backlink-rail': backlinkRailPx(),
      }}
      onDragOver={onPageDragOver}
      onDrop={onPageDrop}
      ref={(el) => {
        pageRootElement = el;
        el.addEventListener('pointerdown', onTaskPointerDown);
        el.addEventListener('change', onTaskToggle);
        onCleanup(() => {
          el.removeEventListener('pointerdown', onTaskPointerDown);
          el.removeEventListener('change', onTaskToggle);
        });
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
