/**
 * Sticker — one of the 50 procedural hand-drawn SVG stickers (see stickers.ts),
 * in either of two placements.
 *
 * Attrs: { stickerId, scale, rotate, placement, x, y }.
 *
 *  - `placement: 'inline'` (the default, and what every stored sticker already
 *    is) — an inline atom sitting between two words, exactly as before.
 *  - `placement: 'free'` — pinned to the LEAF at `x`/`y` percent of its box,
 *    drawn into that leaf's `.nb-free-layer` above the ruling and the text, and
 *    dragged with the pointer. The reader asked for this in as many words:
 *    *"click on it and put it anywhere on the page, not caring about where
 *    lines are"*.
 *
 * A free sticker is still the same node in the same document — it is simply
 * rendered somewhere else — so it saves, undoes, exports and copies with the
 * page like everything else, and `placement: 'inline'` takes it back into the
 * sentence with no conversion step. What it is NOT is a second storage model
 * beside the doc JSON, which `docs/design/block-editor.md` forbids.
 *
 * Its relationship with the pagination contract — where it is anchored in the
 * document and why the carry cannot take it — is written down once, in
 * `src/editor/effects/freePlacement.ts`. Read that before moving anything here.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import {
  clampPlacePct,
  isStickerPlacement,
  type StickerPlacement,
} from '../effects/freePlacement';
import { isStickerId, stickerSvg, type StickerId } from './stickers';

export interface StickerAttributes {
  stickerId: StickerId;
  /** Multiplier on the 28px base size, clamped 0.5..3. */
  scale: number;
  /** Rotation in degrees, small tilts read as hand-placed. */
  rotate: number;
  /** In the text flow, or pinned to the leaf. */
  placement: StickerPlacement;
  /** Free placement only: percent across the leaf. */
  x: number;
  /** Free placement only: percent down the leaf. */
  y: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sticker: {
      /** Insert a sticker at the current position. */
      insertSticker: (attrs: Partial<StickerAttributes> & { stickerId: StickerId }) => ReturnType;
    };
  }
}

const BASE_SIZE_PX = 28;

/** Free stickers start bigger — they are a stamp on the page, not punctuation. */
const FREE_BASE_SIZE_PX = 46;

/** Steps the puck's bigger/smaller pair walks, and the tilt it applies. */
const SCALE_STEP = 0.2;
const TILT_STEP = 7;

function clampScale(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(3, Math.max(0.5, Math.round(parsed * 100) / 100));
}

function clampRotate(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(180, Math.max(-180, Math.round(parsed)));
}

/* ========================================================================== *
 *                              the little puck                               *
 * ========================================================================== */

/**
 * The controls a free sticker offers once you have picked it up: two sizes,
 * two tilts, "back into the text", and away.
 *
 * Drawn here rather than borrowed from `rail/icons.tsx` because that file is
 * the RAIL's vocabulary at 24px and these are 14px marks on a 22px button —
 * same idiom (one ink, round caps, a slightly drunken line), own scale.
 */
const PUCK_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.9,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

function PuckGlyph(props: { d: string }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" class="nb-free-puck-glyph" aria-hidden="true">
      <path d={props.d} {...PUCK_STROKE} />
    </svg>
  );
}

const GLYPH_BIGGER = 'M 8.1 3.2 C 8 6.4 8 9.6 7.9 12.8 M 3.2 8 C 6.4 7.9 9.6 7.9 12.8 8';
const GLYPH_SMALLER = 'M 3.2 8.1 C 6.4 7.9 9.6 7.9 12.8 8';
const GLYPH_TILT_LEFT =
  'M 11.6 4.2 C 8.4 4 5.6 5.4 4.2 8.1 M 4.1 8.2 C 4.9 7.4 5.9 6.9 7 6.6 M 4.2 8.2 C 4.6 9.3 5 10.4 5.6 11.4';
const GLYPH_TILT_RIGHT =
  'M 4.4 4.2 C 7.6 4 10.4 5.4 11.8 8.1 M 11.9 8.2 C 11.1 7.4 10.1 6.9 9 6.6 M 11.8 8.2 C 11.4 9.3 11 10.4 10.4 11.4';
const GLYPH_UNPIN =
  'M 3.1 12.9 C 5.3 10.7 7.4 8.5 9.6 6.4 M 7.2 3.4 C 9 3.1 10.8 3.1 12.6 3.4 C 12.9 5.2 12.9 7 12.6 8.8';
const GLYPH_AWAY = 'M 4.2 4.4 C 6.5 6.8 9.2 9.4 11.7 11.8 M 11.8 4.3 C 9.3 6.8 6.7 9.4 4.3 11.8';

interface PuckButton {
  readonly id: string;
  readonly label: string;
  readonly glyph: string;
}

const PUCK_BUTTONS: readonly PuckButton[] = [
  { id: 'smaller', label: 'Smaller', glyph: GLYPH_SMALLER },
  { id: 'bigger', label: 'Bigger', glyph: GLYPH_BIGGER },
  { id: 'tilt-left', label: 'Tilt it left', glyph: GLYPH_TILT_LEFT },
  { id: 'tilt-right', label: 'Tilt it right', glyph: GLYPH_TILT_RIGHT },
  { id: 'unpin', label: 'Put it back in the text', glyph: GLYPH_UNPIN },
  { id: 'remove', label: 'Take it off the page', glyph: GLYPH_AWAY },
];

/* ========================================================================== *
 *                                the node view                               *
 * ========================================================================== */

function StickerView(props: SolidNodeViewProps): JSX.Element {
  const stickerId = (): StickerId => {
    const value: unknown = props.node.attrs.stickerId;
    return isStickerId(value) ? value : 'star';
  };
  const placement = (): StickerPlacement => {
    const value: unknown = props.node.attrs.placement;
    return isStickerPlacement(value) ? value : 'inline';
  };
  const scale = (): number => clampScale(props.node.attrs.scale);
  const rotate = (): number => clampRotate(props.node.attrs.rotate);
  const attrX = (): number => clampPlacePct(props.node.attrs.x);
  const attrY = (): number => clampPlacePct(props.node.attrs.y);

  /* ------------------------------ the leaf ------------------------------- */

  /**
   * The layer this sticker paints into: `.nb-free-layer`, a child of the leaf
   * `BookView` renders. Resolved off the EDITOR's dom rather than our own,
   * because ProseMirror has not inserted this node's element yet at the moment
   * the view is built — and retried across a few frames, because on the very
   * first mount of a leaf the editor element itself is a frame behind.
   *
   * A null layer is not a failure: an editor mounted somewhere with no leaf
   * around it (a template preview) simply keeps the sticker inline, which is
   * a sticker in the wrong place rather than a sticker that vanished.
   */
  const [layer, setLayer] = createSignal<HTMLElement | null>(null);
  onMount(() => {
    let frame = 0;
    const look = (tries: number): void => {
      const dom: unknown = props.editor.view.dom;
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

  const free = (): boolean => placement() === 'free' && layer() !== null;

  /* ------------------------------ picking up ------------------------------ */

  /** Live position while the pointer has hold of it (attrs commit on release). */
  const [dragAt, setDragAt] = createSignal<{ x: number; y: number } | null>(null);
  /** Picked up: the puck is out and the sticker sits above its neighbours. */
  const [held, setHeld] = createSignal(false);

  const x = (): number => dragAt()?.x ?? attrX();
  const y = (): number => dragAt()?.y ?? attrY();

  let markEl: HTMLDivElement | undefined;

  /**
   * The box the mark's percentages resolve against: the LEAF's free layer.
   *
   * Explicitly, not `markEl.parentElement` — Solid's `<Portal>` wraps its
   * children in a plain `<div>` inside the mount, and that wrapper has no
   * in-flow content, so its rect is zero-height. Reading it here meant every
   * drag bailed on the `height === 0` guard and the puck never opened, which
   * looked exactly like the sticker ignoring the pointer.
   */
  const layerBox = (): DOMRect | null =>
    markEl?.closest('.nb-free-layer')?.getBoundingClientRect() ?? null;

  const beginDrag = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = layerBox();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    // The leaf is the editor's; a pointer press on a sticker must not put the
    // caret under it, or every pick-up would also scroll the page to a caret.
    event.preventDefault();
    event.stopPropagation();
    setHeld(true);

    const from = { px: event.clientX, py: event.clientY, x: x(), y: y() };
    let moved = false;

    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - from.px;
      const dy = move.clientY - from.py;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      setDragAt({
        x: clampPlacePct(from.x + (dx / rect.width) * 100),
        y: clampPlacePct(from.y + (dy / rect.height) * 100),
      });
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const landed = dragAt();
      setDragAt(null);
      if (landed && moved) props.updateAttributes({ x: landed.x, y: landed.y });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Is this press inside the mark's own box (the puck hangs outside it)? */
  const pointInMark = (event: PointerEvent): boolean => {
    const box = markEl?.getBoundingClientRect();
    if (!box) return false;
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    );
  };

  /**
   * One window-level press handler, in the CAPTURE phase, doing two jobs.
   *
   * 1. **Putting it down.** A press anywhere that is not this mark or its puck
   *    closes the puck.
   *
   * 2. **Taking back a press the block DRAG HANDLE swallowed.** This is not a
   *    tidy-up, it is the only way: the handle is hoisted onto `<body>` at
   *    `calc(var(--z-flip) + 5)` (editor.css explains why), while the whole
   *    book lives inside `.nb-book-cover`, which the panel-push transform
   *    makes its own stacking context — so NO z-index on a leaf's contents can
   *    put a sticker above that handle. Measured on the running app with a
   *    sticker near the gutter: handle box [577,349,24,28] over sticker box
   *    [548,347,46,46], `elementFromPoint` returning the handle, and both
   *    dragging and the puck dead as a result.
   *
   *    The handle is a hover affordance for the block UNDERNEATH, and a
   *    free-placed sticker is by definition on top of that block, so a press
   *    that lands on the handle while it is sitting over a sticker meant the
   *    sticker. Nothing else is claimed: if the topmost thing is a panel, a
   *    menu or a dialog, the press is theirs.
   */
  onMount(() => {
    const onDown = (event: PointerEvent): void => {
      const el = markEl;
      if (!el) return;
      const target = event.target;
      // Ours already — the mark's own handlers will deal with it.
      if (target instanceof globalThis.Node && el.contains(target)) return;

      if (event.button === 0 && pointInMark(event)) {
        const top = document.elementFromPoint(event.clientX, event.clientY);
        if (top !== null && top.closest('.nb-drag-handle') !== null) {
          beginDrag(event);
          return;
        }
      }
      if (held()) setHeld(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && held()) setHeld(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    });
  });

  const runPuck = (id: string): void => {
    switch (id) {
      case 'bigger':
        props.updateAttributes({ scale: clampScale(scale() + SCALE_STEP) });
        break;
      case 'smaller':
        props.updateAttributes({ scale: clampScale(scale() - SCALE_STEP) });
        break;
      case 'tilt-left':
        props.updateAttributes({ rotate: clampRotate(rotate() - TILT_STEP) });
        break;
      case 'tilt-right':
        props.updateAttributes({ rotate: clampRotate(rotate() + TILT_STEP) });
        break;
      case 'unpin':
        setHeld(false);
        props.updateAttributes({ placement: 'inline' });
        break;
      case 'remove':
        setHeld(false);
        props.deleteNode();
        break;
      default:
        break;
    }
  };

  /* ------------------------------- drawing -------------------------------- */

  const inlineSizePx = (): number => Math.round(BASE_SIZE_PX * scale());
  const freeSizePx = (): number => Math.round(FREE_BASE_SIZE_PX * scale());

  return (
    <NodeViewWrapper
      class="nb-sticker"
      classList={{
        'is-selected': props.selected,
        'is-free-anchor': free(),
      }}
      data-sticker={stickerId()}
      data-placement={placement()}
    >
      <Show
        when={free()}
        fallback={
          <span
            class="nb-sticker-box"
            style={{
              width: `${inlineSizePx()}px`,
              height: `${inlineSizePx()}px`,
              transform: `rotate(${rotate()}deg)`,
            }}
            // eslint-disable-next-line solid/no-innerhtml -- deterministic
            // markup from stickerSvg; no user text ever reaches it.
            innerHTML={stickerSvg(stickerId())}
          />
        }
      >
        <Portal mount={layer() ?? undefined}>
          <div
            class="nb-free-sticker"
            classList={{ 'is-held': held(), 'is-dragging': dragAt() !== null }}
            data-sticker={stickerId()}
            ref={(el) => (markEl = el)}
            style={{
              left: `${x()}%`,
              top: `${y()}%`,
              '--nb-free-size': `${freeSizePx()}px`,
              '--nb-free-tilt': `${rotate()}deg`,
            }}
            role="button"
            tabindex={0}
            aria-label={`${stickerId()} sticker, placed on the page — drag to move it`}
            data-tooltip={held() ? undefined : 'drag me anywhere on this page'}
            data-tooltip-side="top"
            onPointerDown={beginDrag}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setHeld(!held());
              }
            }}
          >
            <span
              class="nb-free-sticker-art"
              // eslint-disable-next-line solid/no-innerhtml -- see above
              innerHTML={stickerSvg(stickerId())}
            />
            <Show when={held()}>
              <div class="nb-free-puck" role="group" aria-label="Sticker controls">
                <For each={PUCK_BUTTONS}>
                  {(button) => (
                    <button
                      type="button"
                      class="nb-free-puck-button"
                      data-puck={button.id}
                      aria-label={button.label}
                      data-tooltip={button.label}
                      data-tooltip-side="top"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        runPuck(button.id);
                      }}
                    >
                      <PuckGlyph d={button.glyph} />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
    </NodeViewWrapper>
  );
}

export const Sticker = Node.create({
  name: 'sticker',

  inline: true,

  group: 'inline',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      stickerId: {
        default: 'star' satisfies StickerId,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-sticker-id');
          return isStickerId(raw) ? raw : 'star';
        },
        renderHTML: (attributes) => ({
          'data-sticker-id': String(attributes.stickerId),
        }),
      },
      scale: {
        default: 1,
        parseHTML: (element) => clampScale(element.getAttribute('data-scale')),
        renderHTML: (attributes) => ({ 'data-scale': String(attributes.scale) }),
      },
      rotate: {
        default: 0,
        parseHTML: (element) => clampRotate(element.getAttribute('data-rotate')),
        renderHTML: (attributes) => ({ 'data-rotate': String(attributes.rotate) }),
      },
      /* --- free placement (see effects/freePlacement.ts) ------------------ */
      placement: {
        default: 'inline' satisfies StickerPlacement,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-placement');
          return isStickerPlacement(raw) ? raw : 'inline';
        },
        renderHTML: (attributes) => ({
          'data-placement': String(attributes.placement ?? 'inline'),
        }),
      },
      x: {
        default: 50,
        parseHTML: (element) => clampPlacePct(element.getAttribute('data-x')),
        renderHTML: (attributes) => ({ 'data-x': String(attributes.x) }),
      },
      y: {
        default: 50,
        parseHTML: (element) => clampPlacePct(element.getAttribute('data-y')),
        renderHTML: (attributes) => ({ 'data-y': String(attributes.y) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="sticker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'sticker' })];
  },

  addCommands() {
    return {
      insertSticker:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(StickerView);
  },
});
