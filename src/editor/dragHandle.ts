/**
 * The block drag handle — its element, where its layer lives, and the drag
 * lifecycle around @tiptap/extension-drag-handle.
 *
 * WHY THIS FILE EXISTS: the extension renders one handle per editor, wraps it
 * in a positioning div and parents that div to `view.dom.parentElement` — i.e.
 * INSIDE the page. That placement was the flicker. FlipSurface watches each
 * leaf with a MutationObserver ({ subtree, attributes }) to know when a page
 * needs re-rasterizing, and the handle rewrites its own inline left/top/
 * visibility on every hover. So hovering a paragraph read as "this page was
 * edited" → an html-to-image snapshot ~300 ms later → flip.css's
 * `.snapshotting .nb-drag-handle { display: none }` → the handle vanished from
 * under the pointer → the next mousemove re-anchored it → another mutation,
 * for as long as the pointer stayed on the page. Measured before the fix:
 * 21 full page rasterizations during 2.5 s of holding the pointer still over
 * one paragraph, with the handle display:none for 6 of every 30 sampled frames.
 *
 * The fix is placement, not damping. `hoistHandleLayer` moves the wrapper to
 * <body>: its style writes are then invisible to the leaf observer, the
 * snapshot-hiding rule can no longer match it, and it is not in the captured
 * subtree at all. floating-ui keeps computing `absolute` coordinates against
 * that wrapper, so pinning the wrapper to the viewport origin as a 0×0 fixed
 * box leaves every number it writes unchanged.
 *
 * IF DRAGGING IS REPORTED DEAD, READ THIS BEFORE CHANGING ANYTHING HERE.
 * Nothing in this file was the cause last time, and two speculative fixes were
 * made and reverted before that was established. The whole gesture rides on
 * NATIVE HTML5 drag events — the extension listens for dragstart/dragover/drop,
 * and `pastePlugin.handleDrop` takes the same road for image files. Anything
 * that stops the document receiving `dragover`/`drop` leaves this code looking
 * perfect: the handle still appears, still highlights, `dragstart` still fires,
 * and the block simply never moves.
 *
 * On Windows that is exactly what Tauri does by default. `dragDropEnabled`
 * defaults to true, and wry then revokes WebView2's own OLE drop target on
 * every child HWND and installs one that ignores everything but a file list.
 * `src-tauri/tauri.conf.json` therefore sets `"dragDropEnabled": false`, and
 * `tests/packaging.test.ts` pins it — no browser probe can see this, because a
 * browser has no wry in it. `scripts/probe-drag-matrix.mjs` reproduces the
 * symptom by swallowing those three events.
 *
 * The second half of the file is the drag itself. The extension caches the
 * hovered node and only re-anchors when the node CHANGES, and it never clears
 * that cache when a drag is abandoned — so after a failed move the handle kept
 * a stale anchor and re-hovering the same block was a no-op. `endDrag` clears
 * it (the plugin's own `hideDragHandle` meta is the documented reset) and drops
 * the NodeRangeSelection the drag left behind, which would otherwise be dragged
 * INSTEAD of the block under the handle on the next attempt.
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

/** Marks the whole document while a block is in flight (CSS hook, no layout). */
const DRAGGING_ATTR = 'data-nb-block-drag';

/** How close to a scroller's edge the pointer must get before it creeps. */
const AUTOSCROLL_EDGE_PX = 88;
/** Scroll speed at the very edge, px per frame. Ramps in quadratically. */
const AUTOSCROLL_MAX_PX = 18;

/**
 * Hand-drawn grip: six slightly-scattered graphite dots. Starts hidden — the
 * extension positions it on first block hover, and without this it would sit
 * unpositioned in the page corner until then.
 */
export function buildDragHandleElement(): HTMLElement {
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

/**
 * Move the extension's positioning wrapper out of the page and onto <body>.
 * Idempotent, and a no-op until the extension has parented the wrapper (the
 * plugin does that when the EditorView is constructed, one task after
 * `render()` returns the element).
 */
function hoistHandleLayer(element: HTMLElement, pageId: string): boolean {
  const wrapper = element.parentElement;
  if (wrapper === null) return false;
  if (wrapper.parentElement === document.body) return true;

  wrapper.classList.add('nb-drag-handle-layer');
  // Both mounted leaves put a layer on <body>; this is the only thing left
  // saying which page a given handle belongs to.
  wrapper.dataset.page = pageId;
  // A 0×0 box pinned to the viewport origin. The handle inside it is
  // positioned `absolute` by floating-ui against THIS element, so keeping it
  // at (0,0) with no size means the coordinates floating-ui computes are the
  // viewport coordinates it measured — nothing to re-derive. `fixed` (not
  // `absolute`) so a scrolled document cannot shear it, and the geometry is
  // written inline because the extension writes its own inline geometry first.
  wrapper.style.position = 'fixed';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '0';
  wrapper.style.height = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = ''; // the class owns it, in tokens
  document.body.appendChild(wrapper);
  return true;
}

interface DragSession {
  /** Doc identity at grab time — unchanged at dragend means nothing moved. */
  readonly docAtStart: ProseMirrorNode;
  readonly scroller: HTMLElement | null;
  pointerY: number;
  frame: number | undefined;
}

export interface DragHandleWiring {
  /** Element factory for `DragHandle.configure({ render })`. */
  render: () => HTMLElement;
  onElementDragStart: (event: DragEvent) => void;
  onElementDragEnd: (event: DragEvent) => void;
  /** Bind to the live editor once it exists; returns a disposer. */
  attach: (editor: Editor) => () => void;
}

/**
 * One wiring per editor instance. Created before the editor (the extension
 * calls `render()` while the editor is still being constructed), then bound
 * to it with `attach`.
 */
export function createDragHandleWiring(pageId: string): DragHandleWiring {
  let editorRef: Editor | null = null;
  let session: DragSession | null = null;
  let hoistFrame: number | undefined;

  /**
   * The nearest ancestor that can actually scroll, resolved ONCE per drag —
   * it costs a getComputedStyle per level, which has no business on a
   * per-frame path.
   *
   * `hidden` counts. Pages are fixed-height and never show a scrollbar (a
   * product rule), but a leaf whose content momentarily exceeds it still has
   * a settable scrollTop — that transient is exactly what BookView's
   * resetLeafScroll exists to clean up, and it is the only state in this app
   * where dragging a block towards the edge has anywhere to go. The
   * scrollHeight test is what keeps this from engaging the rest of the time.
   */
  const nearestScroller = (from: HTMLElement | null): HTMLElement | null => {
    let node = from;
    while (node !== null && node !== document.body) {
      const overflowY = getComputedStyle(node).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') &&
        node.scrollHeight - node.clientHeight > 1
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const onDragOver = (event: DragEvent): void => {
    if (session !== null) session.pointerY = event.clientY;
  };

  /**
   * Edge auto-scroll. One rAF loop for the whole drag, one rect read per
   * frame, quadratic ramp so the page creeps when you approach the edge and
   * only runs when you commit to it.
   */
  const autoScrollStep = (): void => {
    const current = session;
    if (current === null) return;
    const scroller = current.scroller;
    if (scroller !== null) {
      const rect = scroller.getBoundingClientRect();
      const fromTop = current.pointerY - rect.top;
      const fromBottom = rect.bottom - current.pointerY;
      let delta = 0;
      if (fromTop < AUTOSCROLL_EDGE_PX) {
        delta = -ramp(AUTOSCROLL_EDGE_PX - fromTop);
      } else if (fromBottom < AUTOSCROLL_EDGE_PX) {
        delta = ramp(AUTOSCROLL_EDGE_PX - fromBottom);
      }
      if (delta !== 0) scroller.scrollTop += delta;
    }
    current.frame = requestAnimationFrame(autoScrollStep);
  };

  const startDrag = (): void => {
    const editor = editorRef;
    if (editor === null || editor.isDestroyed) return;
    endDrag(); // a dragstart with a session live means the last one leaked
    const scroller = nearestScroller(editor.view.dom.parentElement);
    session = {
      docAtStart: editor.state.doc,
      scroller,
      pointerY: 0,
      frame: undefined,
    };
    // On <html>, never on the leaf: an attribute written inside the page is
    // an "edit" as far as the flip observer is concerned (see the header).
    document.documentElement.setAttribute(DRAGGING_ATTR, 'true');
    document.addEventListener('dragover', onDragOver, { passive: true });
    if (scroller !== null) session.frame = requestAnimationFrame(autoScrollStep);
  };

  const endDrag = (): void => {
    const current = session;
    if (current === null) return;
    session = null;
    if (current.frame !== undefined) cancelAnimationFrame(current.frame);
    document.removeEventListener('dragover', onDragOver);
    document.documentElement.removeAttribute(DRAGGING_ATTR);

    // Deferred one task: the library's own dragend bookkeeping and the drop
    // transaction both have to land first, or the reset races them.
    window.setTimeout(() => resetAfterDrag(current.docAtStart), 0);
  };

  /**
   * Clear everything a drag leaves behind. Both halves matter:
   *
   * - `hideDragHandle` is the plugin's documented reset; without it the cached
   *   node/pos survive, and because the plugin only re-anchors when the hovered
   *   node CHANGES, re-hovering the block you just failed to move does nothing
   *   at all and the handle stays wherever the abandoned drag left it.
   * - a cancelled drag leaves the NodeRangeSelection that `dragHandler` set.
   *   The next grab sees the handle's block inside that selection and drags
   *   the OLD range instead of the block under the pointer.
   */
  const resetAfterDrag = (docAtStart: ProseMirrorNode): void => {
    const editor = editorRef;
    if (editor === null || editor.isDestroyed) return;
    const state = editor.state;
    const cancelled = state.doc === docAtStart;
    const tr = state.tr;
    tr.setMeta('hideDragHandle', true);
    tr.setMeta('addToHistory', false);
    if (cancelled && !state.selection.empty) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.from)));
    }
    editor.view.dispatch(tr);
  };

  return {
    render: () => {
      const handle = buildDragHandleElement();
      // The wrapper does not exist yet — the plugin creates and parents it
      // while the EditorView is built, in this same task. A microtask lands
      // right after that; the rAF is the belt-and-braces retry.
      queueMicrotask(() => {
        if (!hoistHandleLayer(handle, pageId) && hoistFrame === undefined) {
          hoistFrame = requestAnimationFrame(() => {
            hoistFrame = undefined;
            hoistHandleLayer(handle, pageId);
          });
        }
      });
      return handle;
    },

    onElementDragStart: () => startDrag(),
    onElementDragEnd: () => endDrag(),

    attach: (editor: Editor) => {
      editorRef = editor;
      return () => {
        endDrag();
        if (hoistFrame !== undefined) {
          cancelAnimationFrame(hoistFrame);
          hoistFrame = undefined;
        }
        editorRef = null;
      };
    },
  };
}

/** Quadratic ramp: barely moves at the edge of the hot zone, commits at the rim. */
function ramp(depth: number): number {
  const t = Math.min(1, Math.max(0, depth / AUTOSCROLL_EDGE_PX));
  return t * t * AUTOSCROLL_MAX_PX;
}
