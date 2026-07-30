/**
 * PageEditor — one TipTap editor per page.
 *
 * - Debounced (400ms) savePageDoc on every update; flushed on unmount.
 * - Document carries pageStyle ('ruled'|'grid'|'blank'|'dotted') and
 *   lineHeightPx attrs; the page background CSS renders them (editor.css).
 *   The BookView rail changes them through the imperative surface in
 *   src/editor/insert/activeEditor.ts (getPageStyle/setPageStyle/
 *   getLineHeight/setLineHeight) — the old in-page floating switcher is gone.
 * - Line-level drag handles (hand-drawn grip) + GSAP Flip settle on drop.
 * - Click-below-to-type: clicking the empty ruled area below the last block
 *   drops the caret on a fresh line (or pulses the page-full hint when the
 *   page is paginated and cannot grow).
 * - Right-click opens the block context menu (src/editor/menu) and the
 *   native menu is suppressed inside the editor only.
 * - Pagination contract (see src/editor/pagination.ts): when `paginated`,
 *   overflowing trailing blocks leave the page after each transaction via
 *   `onOverflow(removedBlocksJson, cursorCarried)`.
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
import {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_PAGE_STYLE,
  isPageStyle,
  normalizePageDoc,
} from './document';
import { createEditorExtensions } from './extensions';
import { recordSnapshot } from './history/pageHistory';
import { registerPageEditor, unregisterPageEditor } from './instances';
import { setActiveEditor } from './insert/activeEditor';
import { handleEditorContextMenu } from './menu/contextMenuController';
import { createMediaPastePlugin } from './media';
import {
  accumulateCarriedCaret,
  pageIsFull,
  trailingOverflowCount,
} from './pagination';
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
 */
function onTaskToggle(event: Event): void {
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    target.type === 'checkbox' &&
    target.closest('li[data-checked]') !== null &&
    target.checked
  ) {
    void play('check-done');
    if (settings.confettiOnComplete && !settings.minimalistMode) {
      const rect = target.getBoundingClientRect();
      burstConfetti({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
      void play('confetti');
    }
  }
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
const PAGE_FULL_HINT_MS = 1600;
/** Safety bound on the overflow loop (a transaction per iteration). */
const MAX_OVERFLOW_PASSES = 64;

/** Respect reduced-motion: tokens.css zeroes --motion-scale. */
function motionScale(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

/**
 * Hand-drawn grip: six slightly-scattered graphite dots. Starts hidden —
 * the DragHandle extension positions it on first block hover, and without
 * this it would sit unpositioned in the page corner until then.
 */
function buildDragHandleElement(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'nb-drag-handle';
  element.setAttribute('aria-hidden', 'true');
  element.style.visibility = 'hidden';
  element.innerHTML =
    '<svg viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg">' +
    '<g fill="var(--ink-graphite-soft)">' +
    '<circle cx="4.2" cy="4.4" r="1.7"/><circle cx="10" cy="3.8" r="1.6"/>' +
    '<circle cx="3.8" cy="11.2" r="1.6"/><circle cx="10.2" cy="10.8" r="1.7"/>' +
    '<circle cx="4.4" cy="17.8" r="1.7"/><circle cx="9.8" cy="18.2" r="1.6"/>' +
    '</g></svg>';
  return element;
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

  const flushSave = (): void => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (pendingDoc !== null) {
      const doc = pendingDoc;
      pendingDoc = null;
      void savePageDoc(pageId, doc).then(() => notifySaved());
      // Page history (roadmap #13): the flushed doc is snapshot-worthy —
      // the ring throttles internally so bursts collapse to one snapshot.
      recordSnapshot(pageId, doc);
    }
  };

  const scheduleSave = (doc: PageDoc): void => {
    pendingDoc = doc;
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
    const scale = motionScale();
    if (!moved || scale <= 0) return false;
    const state = Flip.getState(topLevelBlocks(view));
    // ProseMirror applies the drop synchronously in this task; the microtask
    // runs right after, with the DOM already reordered.
    queueMicrotask(() => {
      Flip.from(state, {
        targets: topLevelBlocks(view),
        duration: 0.4 * scale,
        ease: 'power3.out',
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
    hintTimer = setTimeout(() => setPageFullHint(false), PAGE_FULL_HINT_MS);
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
      while (view.state.doc.childCount > 1 && passes < MAX_OVERFLOW_PASSES) {
        passes += 1;
        const rootTop = root.getBoundingClientRect().top;
        const bottoms = Array.from(root.children).map(
          (child) => child.getBoundingClientRect().bottom - rootTop,
        );
        const padBottom =
          Number.parseFloat(getComputedStyle(root).paddingBottom) || 0;
        const doc = view.state.doc;
        const removeCount = Math.min(
          trailingOverflowCount(bottoms, capacity, padBottom),
          doc.childCount - 1,
        );
        if (removeCount <= 0) break;

        let from = doc.content.size;
        for (let i = 0; i < removeCount; i += 1) {
          const child = doc.child(doc.childCount - 1 - i);
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
          doc.content.size - from,
        );

        // One transaction for the removal; addToHistory false so undo does
        // not resurrect the overflow (and re-trigger the loop).
        const tr = view.state.tr.delete(from, doc.content.size);
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
      // extractOverflow for why scrollHeight is unusable here).
      const contentHeight =
        lastRect.bottom -
        root.getBoundingClientRect().top +
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
  const editor = createTiptapEditor(() => ({
    element: mountElement,
    extensions: createEditorExtensions({
      interactive: true,
      placeholder: 'Type / for commands…',
      dragHandle: { render: buildDragHandleElement },
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
      const doc = instance.getJSON() as PageDoc;
      scheduleSave(doc);
      props.onDocChange?.(doc);
      extractOverflow(instance);
    },
    // Two editors are mounted at once in the spread view; the focused one is
    // the "active" editor the script toolbar/dialog should target.
    onFocus: ({ editor: instance }) => setActiveEditor(instance),
  }));

  // Publish the live editor for the script toolbar/dialog + install the media
  // paste/drop plugin (once per instance).
  let mediaPluginInstalled: unknown = null;
  createEffect(() => {
    const instance = editor();
    setActiveEditor(instance ?? null);
    if (instance) registerPageEditor(pageId, instance);
    if (instance && mediaPluginInstalled !== instance) {
      instance.registerPlugin(createMediaPastePlugin());
      mediaPluginInstalled = instance;
    }
  });
  onCleanup(() => {
    setActiveEditor(null);
    const instance = editor();
    if (instance) unregisterPageEditor(pageId, instance);
  });

  // Initial-overflow pass: a freshly (re)mounted paginated page may already
  // exceed capacity (BookView prepends carried blocks). Measure after layout
  // and again once the handwriting fonts are in (metrics shift).
  createEffect(() => {
    const instance = editor();
    if (!instance || !isPaginated()) return;
    requestAnimationFrame(() => {
      if (!instance.isDestroyed) extractOverflow(instance);
    });
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

  return (
    <div
      class="nb-page"
      data-style={pageStyle()}
      data-paginated={isPaginated() ? 'true' : undefined}
      style={{ '--page-line-height': `${lineHeightPx()}px` }}
      ref={(el) => {
        pageRootElement = el;
        el.addEventListener('change', onTaskToggle);
      }}
    >
      <div class="nb-page-editor" ref={mountElement} />
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
