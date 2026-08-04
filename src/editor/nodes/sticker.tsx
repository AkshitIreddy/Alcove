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
 *
 * A sticker is no longer the only thing in the free layer: `./pageMark.tsx` put
 * tape, washi, frames, paper and doodles there too. What the two share — finding
 * the layer, the drag maths, the puck's glyphs — lives in `./freeMark.tsx`.
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
import {
  GLYPH_AWAY,
  GLYPH_BIGGER,
  GLYPH_SMALLER,
  GLYPH_TILT_LEFT,
  GLYPH_TILT_RIGHT,
  GLYPH_UNPIN,
  PuckGlyph,
  useFreeLayer,
  useMarkDrag,
  type PuckButton,
} from './freeMark';
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

/** Two sizes, two tilts, "back into the text", and away. */
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

  const layer = useFreeLayer(props);

  const free = (): boolean => placement() === 'free' && layer() !== null;

  /* ------------------------------ picking up ------------------------------ */

  /** Picked up: the puck is out and the sticker sits above its neighbours. */
  const [held, setHeld] = createSignal(false);

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

  const drag = useMarkDrag({
    box: layerBox,
    from: () => ({ x: x(), y: y() }),
    clamp: clampPlacePct,
    onHold: () => setHeld(true),
    commit: (at) => props.updateAttributes({ x: at.x, y: at.y }),
  });
  const beginDrag = drag.begin;

  const x = (): number => drag.at()?.x ?? attrX();
  const y = (): number => drag.at()?.y ?? attrY();

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
            classList={{ 'is-held': held(), 'is-dragging': drag.at() !== null }}
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
