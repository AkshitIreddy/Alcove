/**
 * src/editor/nodes/freeMark.tsx — the two things every mark in the free layer
 * needs, written once.
 *
 * A free sticker (`./sticker.tsx`) and a free trim mark (`./pageMark.tsx`) are
 * different nodes drawing different art, but they are the same OBJECT as far as
 * the page is concerned: something portalled into the leaf's `.nb-free-layer`,
 * picked up with the pointer, and given a little row of controls while it is
 * held. Both halves below were written for the sticker first; the second
 * customer is why they are here rather than there.
 *
 * `useFreeLayer` in particular is not obvious and was got wrong once (see the
 * retry comment) — two copies of it would be two chances to get it wrong again.
 */
import { createSignal, onCleanup, onMount, type Accessor, type JSX } from 'solid-js';
import type { SolidNodeViewProps } from '../solid';

/* ========================================================================== *
 *                                 the layer                                  *
 * ========================================================================== */

/**
 * The layer this mark paints into: `.nb-free-layer`, a child of the leaf
 * `BookView` renders.
 *
 * Resolved off the EDITOR's dom rather than off the node's own element, because
 * ProseMirror has not inserted that element yet at the moment the view is built
 * — and retried across a few frames, because on the very first mount of a leaf
 * the editor element itself is a frame behind.
 *
 * A null layer is not a failure: an editor mounted somewhere with no leaf around
 * it (a template preview) simply keeps the mark inline, which is a mark in the
 * wrong place rather than a mark that vanished.
 */
export function useFreeLayer(
  props: SolidNodeViewProps,
): Accessor<HTMLElement | null> {
  const [layer, setLayer] = createSignal<HTMLElement | null>(null);
  onMount(() => {
    let frame = 0;
    /*
     * `editor.view` may not exist yet, and reading it THROWS rather than
     * returning undefined — TipTap guards the property and raises "The editor
     * view is not available. Cannot access view['dom']".
     *
     * That is not a hypothetical. Node views are constructed DURING the
     * EditorView constructor, so `editor.view` is not assigned at the moment
     * this runs; on a live leaf Solid's onMount happens late enough that it has
     * been, and on an OFFSCREEN staged editor it has not. The throw escaped
     * this effect, took down `withOffscreenPage`, and was swallowed whole by a
     * bare `catch { return null }` in offscreenPages.ts.
     *
     * The cost was the reader's blank page. Every offscreen capture failed, so
     * the back of every turning sheet and every page revealed under a curl had
     * no texture and drew as bare cream — measured through the `__flipCache`
     * bridge as `hasBack: false, hasRevealed: false` on every single turn.
     *
     * The retry loop below was already the right shape for "not ready yet"; it
     * simply never got the chance to run. Catching here hands a missing view
     * back as null, which is a retry, and after 24 frames a genuinely
     * leafless editor (a template preview) keeps its mark inline exactly as
     * this function's docblock promises.
     */
    const look = (tries: number): void => {
      let dom: unknown = null;
      try {
        dom = props.editor.view.dom;
      } catch {
        dom = null;
      }
      const leaf =
        dom instanceof HTMLElement ? dom.closest('.nb-sheet-paper') : null;
      const found = leaf?.querySelector<HTMLElement>(':scope > .nb-free-layer');
      if (found) {
        setLayer(found);
        return;
      }
      if (tries > 0) frame = requestAnimationFrame(() => look(tries - 1));
    };
    look(24);
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return layer;
}

/* ========================================================================== *
 *                              the little puck                               *
 * ========================================================================== */

/**
 * The controls a free mark offers once you have picked it up.
 *
 * Drawn here rather than borrowed from `rail/icons.tsx` because that file is
 * the RAIL's vocabulary at 24px and these are 14px marks on a 22px button —
 * same idiom (one ink, round caps, a slightly drunken line), own scale.
 */
export const PUCK_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.9,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

export function PuckGlyph(props: { d: string }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" class="nb-free-puck-glyph" aria-hidden="true">
      <path d={props.d} {...PUCK_STROKE} />
    </svg>
  );
}

export const GLYPH_BIGGER =
  'M 8.1 3.2 C 8 6.4 8 9.6 7.9 12.8 M 3.2 8 C 6.4 7.9 9.6 7.9 12.8 8';
export const GLYPH_SMALLER = 'M 3.2 8.1 C 6.4 7.9 9.6 7.9 12.8 8';
export const GLYPH_TILT_LEFT =
  'M 11.6 4.2 C 8.4 4 5.6 5.4 4.2 8.1 M 4.1 8.2 C 4.9 7.4 5.9 6.9 7 6.6 M 4.2 8.2 C 4.6 9.3 5 10.4 5.6 11.4';
export const GLYPH_TILT_RIGHT =
  'M 4.4 4.2 C 7.6 4 10.4 5.4 11.8 8.1 M 11.9 8.2 C 11.1 7.4 10.1 6.9 9 6.6 M 11.8 8.2 C 11.4 9.3 11 10.4 10.4 11.4';
export const GLYPH_UNPIN =
  'M 3.1 12.9 C 5.3 10.7 7.4 8.5 9.6 6.4 M 7.2 3.4 C 9 3.1 10.8 3.1 12.6 3.4 C 12.9 5.2 12.9 7 12.6 8.8';
export const GLYPH_AWAY =
  'M 4.2 4.4 C 6.5 6.8 9.2 9.4 11.7 11.8 M 11.8 4.3 C 9.3 6.8 6.7 9.4 4.3 11.8';
/** Two arrows away from a corner — "drag this to set the box yourself". */
export const GLYPH_STRETCH =
  'M 3.4 12.7 C 6.2 9.9 9.4 6.7 12.6 3.4 M 3.3 8.6 C 3.3 10 3.3 11.4 3.4 12.8 C 4.8 12.8 6.2 12.8 7.6 12.8 M 12.7 7.4 C 12.7 6 12.7 4.7 12.6 3.3 C 11.2 3.3 9.8 3.3 8.4 3.3';

export interface PuckButton {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
}

/**
 * Pick a mark up and put it down again with the pointer.
 *
 * The mark owns its position as an x/y percentage of the LAYER, so the drag
 * maths is the same for every kind of mark and lives here. `commit` is called
 * once, on release, and only if the pointer actually travelled — a press that
 * did not move is the reader opening the puck, not nudging the mark by a pixel
 * and writing a history entry for it.
 */
export interface DragHandles {
  /** Live position while the pointer has hold of it, or null. */
  readonly at: Accessor<{ x: number; y: number } | null>;
  readonly begin: (event: PointerEvent) => void;
}

export function useMarkDrag(options: {
  /** The box the percentages resolve against — the leaf's free layer. */
  box: () => DOMRect | null;
  from: () => { x: number; y: number };
  clamp: (value: number) => number;
  /**
   * How much of the pointer's travel each number takes. 1 for a POSITION.
   *
   * 2 for a SIZE, and this is not a fudge factor: a mark is centred on its x/y
   * (`translate(-50%, -50%)`), so widening it by one percent moves each edge by
   * half a percent. A corner grip dragged at gain 1 falls behind the pointer at
   * exactly half speed, which reads as the app not keeping up.
   */
  gain?: number;
  onHold: () => void;
  commit: (at: { x: number; y: number }) => void;
}): DragHandles {
  const [at, setAt] = createSignal<{ x: number; y: number } | null>(null);

  const begin = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = options.box();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    // The leaf is the editor's; a pointer press on a mark must not put the
    // caret under it, or every pick-up would also scroll the page to a caret.
    event.preventDefault();
    event.stopPropagation();
    options.onHold();

    const start = options.from();
    const origin = { px: event.clientX, py: event.clientY, x: start.x, y: start.y };
    let moved = false;

    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - origin.px;
      const dy = move.clientY - origin.py;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const gain = options.gain ?? 1;
      setAt({
        x: options.clamp(origin.x + (dx / rect.width) * 100 * gain),
        y: options.clamp(origin.y + (dy / rect.height) * 100 * gain),
      });
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const landed = at();
      setAt(null);
      if (landed && moved) options.commit(landed);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return { at, begin };
}
