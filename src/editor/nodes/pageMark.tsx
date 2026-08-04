/**
 * Page mark — a strip of tape, a washi print, a frame, a scrap of paper or a
 * pencil doodle, put wherever the reader pointed.
 *
 * The reader asked for this in as many words: *"give user the option to drag
 * and place stickers or any effects, like i mean click on it and put it
 * anywhere on the page, not caring about where lines are"*. Stickers answered
 * it; effects did not. Every one of the 472 values in `effects/vocabulary.ts`
 * was a block ATTRIBUTE — `data-tape` on whichever top-level block the caret
 * happened to be in — so a strip of tape could only ever lie across a
 * paragraph, never across a page.
 *
 * WHICH effects became marks and which stayed block properties is decided in
 * `effects/placeableEffects.ts`, on one question: does the thing have an extent
 * of its own on bare paper? Tape, washi, frames, paper and doodles do. Lifts,
 * underlines, tilts, lettering and tints do not — read that file before adding
 * an axis here.
 *
 * Attrs: { fx, value, x, y, w, h, rotate, seed }.
 *
 *   fx/value   which axis and which of its values — rendered as the axis's own
 *              `data-<key>` attribute, so the mark is painted by exactly the
 *              declarations in effects.css that paint a block. There is no
 *              second, free-placement copy of any of the 205 values, and there
 *              must never be one.
 *   x/y        percent across and down the LEAF (not the block, not pixels).
 *   w/h        percent of the leaf as well, so a window resize, a reflow and
 *              the focus-mode zoom all leave the mark exactly as big as it was
 *              put. See the pagination contract in effects/freePlacement.ts.
 *   rotate     the reader's own tilt, off the puck.
 *   seed       fixed at placement: the doodle's hand-drawn wobble must not
 *              re-roll every time the mark is dragged a pixel.
 *
 * The node is an INLINE ATOM that renders nothing where it sits and portals its
 * art into the leaf's `.nb-free-layer`. That is not a style choice: a
 * block-level mark would be measured by `trailingOverflowCount`, and a page
 * with a lot of tape on it would start pushing its own words onto the next
 * leaf.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { clampPlacePct } from '../effects/freePlacement';
import {
  DOODLE_KEY,
  MARK_MIN_PCT,
  PLACEABLE_AXES,
  clampMarkSize,
  placeableAxis,
  resolveMark,
  type PlaceableKey,
} from '../effects/placeableEffects';
import { doodleSvg, type DoodleKind } from '../effects/doodles';
import {
  GLYPH_AWAY,
  GLYPH_BIGGER,
  GLYPH_SMALLER,
  GLYPH_STRETCH,
  GLYPH_TILT_LEFT,
  GLYPH_TILT_RIGHT,
  PuckGlyph,
  useFreeLayer,
  useMarkDrag,
  type PuckButton,
} from './freeMark';

/** One press of the puck's bigger/smaller pair, and of its tilt pair. */
const SIZE_STEP = 1.18;
const TILT_STEP = 5;

function clampTilt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(180, Math.max(-180, Math.round(parsed)));
}

function clampSeed(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.abs(Math.trunc(parsed)) >>> 0 : 0;
}

const PUCK_BUTTONS: readonly PuckButton[] = [
  { id: 'smaller', label: 'Smaller', glyph: GLYPH_SMALLER },
  { id: 'bigger', label: 'Bigger', glyph: GLYPH_BIGGER },
  { id: 'tilt-left', label: 'Tilt it left', glyph: GLYPH_TILT_LEFT },
  { id: 'tilt-right', label: 'Tilt it right', glyph: GLYPH_TILT_RIGHT },
  { id: 'remove', label: 'Take it off the page', glyph: GLYPH_AWAY },
];

/* ========================================================================== *
 *                                the node view                               *
 * ========================================================================== */

function PageMarkView(props: SolidNodeViewProps): JSX.Element {
  const spec = (): { fx: PlaceableKey; value: string } =>
    resolveMark(props.node.attrs.fx, props.node.attrs.value);
  const axis = () => placeableAxis(spec().fx) ?? PLACEABLE_AXES[0];

  const attrX = (): number => clampPlacePct(props.node.attrs.x);
  const attrY = (): number => clampPlacePct(props.node.attrs.y);
  const attrW = (): number => clampMarkSize(props.node.attrs.w, axis().w);
  const attrH = (): number => clampMarkSize(props.node.attrs.h, axis().h);
  const tilt = (): number => clampTilt(props.node.attrs.rotate);

  const layer = useFreeLayer(props);

  /** Picked up: the puck is out and the mark sits above its neighbours. */
  const [held, setHeld] = createSignal(false);

  let markEl: HTMLDivElement | undefined;

  /**
   * The box the mark's percentages resolve against: the LEAF's free layer.
   *
   * Explicitly, not `markEl.parentElement` — Solid's `<Portal>` wraps its
   * children in a plain `<div>` inside the mount, and that wrapper has no
   * in-flow content, so its rect is zero-height. Reading it here meant every
   * drag bailed on the `height === 0` guard and the puck never opened, which
   * looked exactly like the mark ignoring the pointer.
   */
  const layerBox = (): DOMRect | null =>
    markEl?.closest('.nb-free-layer')?.getBoundingClientRect() ?? null;

  const move = useMarkDrag({
    box: layerBox,
    from: () => ({ x: x(), y: y() }),
    clamp: clampPlacePct,
    onHold: () => setHeld(true),
    commit: (at) => props.updateAttributes({ x: at.x, y: at.y }),
  });

  /**
   * The corner grip. Same drag maths, different pair of numbers — a mark has a
   * SIZE and a sticker does not, which is the one place the two kinds of free
   * mark genuinely differ. Without it the only sizes on offer would be the
   * puck's uniform steps, and a strip of tape is a shape you want to stretch,
   * not to scale.
   */
  const size = useMarkDrag({
    box: layerBox,
    from: () => ({ x: attrW(), y: attrH() }),
    clamp: (value) => clampMarkSize(value, MARK_MIN_PCT),
    gain: 2,
    onHold: () => setHeld(true),
    commit: (at) => props.updateAttributes({ w: at.x, h: at.y }),
  });

  const x = (): number => move.at()?.x ?? attrX();
  const y = (): number => move.at()?.y ?? attrY();
  const w = (): number => size.at()?.x ?? attrW();
  const h = (): number => size.at()?.y ?? attrH();

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
   * 2. **Taking back a press the block DRAG HANDLE swallowed.** The handle is
   *    hoisted onto `<body>` at `calc(var(--z-flip) + 5)` (editor.css explains
   *    why) while the whole book lives inside `.nb-book-cover`, which the
   *    panel-push transform makes its own stacking context — so no z-index on
   *    a leaf's contents can put a mark above that handle. It is a hover
   *    affordance for the block UNDERNEATH, and a free-placed mark is by
   *    definition on top of that block, so a press that lands on the handle
   *    while it is sitting over a mark meant the mark. Nothing else is claimed:
   *    if the topmost thing is a panel, a menu or a dialog, the press is theirs.
   *    (Measured on the running app with a sticker near the gutter — see
   *    nodes/sticker.tsx, which hit it first.)
   */
  onMount(() => {
    const onDown = (event: PointerEvent): void => {
      const el = markEl;
      if (!el) return;
      const target = event.target;
      if (target instanceof globalThis.Node && el.contains(target)) return;

      if (event.button === 0 && pointInMark(event)) {
        const top = document.elementFromPoint(event.clientX, event.clientY);
        if (top !== null && top.closest('.nb-drag-handle') !== null) {
          move.begin(event);
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
        props.updateAttributes({
          w: clampMarkSize(attrW() * SIZE_STEP, attrW()),
          h: clampMarkSize(attrH() * SIZE_STEP, attrH()),
        });
        break;
      case 'smaller':
        props.updateAttributes({
          w: clampMarkSize(attrW() / SIZE_STEP, attrW()),
          h: clampMarkSize(attrH() / SIZE_STEP, attrH()),
        });
        break;
      case 'tilt-left':
        props.updateAttributes({ rotate: clampTilt(tilt() - TILT_STEP) });
        break;
      case 'tilt-right':
        props.updateAttributes({ rotate: clampTilt(tilt() + TILT_STEP) });
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

  /**
   * The ink, in the axis's own idiom.
   *
   * A trim value is an empty box carrying `data-<key>`, painted by
   * `src/styles/effects.css` under the `.nb-fx-specimen` scope — the second
   * scope that file answers to, and exactly what it exists for: "a page-shaped
   * fragment somewhere else in the app that wants an effect painted exactly as
   * the page paints it". Not `.nb-prose`: the tutorial spotlight and the e2e
   * helpers resolve that one document-wide, and a second one inside a leaf
   * would capture them.
   *
   * A doodle is not an attribute at all — it is pencil linework out of
   * `effects/doodles.ts`, wobbled once per seed and cached there.
   */
  const inkAttrs = (): Record<string, string> => {
    const current = spec();
    return current.fx === DOODLE_KEY ? {} : { [`data-${current.fx}`]: current.value };
  };

  return (
    <NodeViewWrapper
      class="nb-page-mark"
      classList={{ 'is-free-anchor': layer() !== null }}
      data-fx={spec().fx}
      data-fx-value={spec().value}
    >
      <Show when={layer()}>
        <Portal mount={layer() ?? undefined}>
          <div
            class="nb-free-mark"
            classList={{
              'is-held': held(),
              'is-dragging': move.at() !== null || size.at() !== null,
            }}
            data-fx={spec().fx}
            data-fx-value={spec().value}
            data-fit={axis().fit}
            ref={(el) => (markEl = el)}
            style={{
              left: `${x()}%`,
              top: `${y()}%`,
              width: `${w()}%`,
              height: `${h()}%`,
              /* A stamp's ink is drawn at its own natural pixel size, so the
                 only way the grip can reach it is a scale — and the scale is
                 how far the reader has stretched the mark from the axis's own
                 default box. No DOM measurement: both numbers are attributes.
                 A `box` axis ignores these; see MarkFit. */
              '--nb-mark-sx': String(w() / axis().w),
              '--nb-mark-sy': String(h() / axis().h),
              '--nb-free-tilt': `${tilt()}deg`,
            }}
            role="button"
            tabindex={0}
            aria-label={`${spec().fx} ${spec().value}, placed on the page — drag to move it`}
            data-tooltip={held() ? undefined : 'drag me anywhere on this page'}
            data-tooltip-side="top"
            onPointerDown={move.begin}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setHeld(!held());
              }
            }}
          >
            <span class="nb-free-mark-skin nb-fx-specimen">
              <Show
                when={spec().fx === DOODLE_KEY}
                fallback={<span class="nb-free-mark-ink" {...inkAttrs()} />}
              >
                <span
                  class="nb-free-mark-ink nb-free-mark-doodle"
                  // eslint-disable-next-line solid/no-innerhtml -- deterministic
                  // markup from doodleSvg; no user text ever reaches it.
                  innerHTML={doodleSvg(
                    spec().value as DoodleKind,
                    clampSeed(props.node.attrs.seed),
                  )}
                />
              </Show>
            </span>

            <Show when={held()}>
              {/* Set the box yourself. A button rather than a bare div so it is
                  reachable by keyboard for the same reason the mark is. */}
              <button
                type="button"
                class="nb-free-mark-grip"
                aria-label="Drag to resize"
                data-tooltip="drag to set the size"
                data-tooltip-side="top"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  size.begin(event);
                }}
              >
                <PuckGlyph d={GLYPH_STRETCH} />
              </button>
              <div class="nb-free-puck" role="group" aria-label="Mark controls">
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

export const PageMark = Node.create({
  name: 'page-mark',

  inline: true,

  group: 'inline',

  atom: true,

  /**
   * NOT `draggable`.
   *
   * ProseMirror's own node dragging moves the node inside the DOCUMENT, and a
   * page mark's position has nothing to do with where in the document it sits —
   * it is anchored at the head of the page's first block on purpose, because
   * that is the one spot the overflow carry cannot reach. Dragging is the
   * pointer handler above, which writes x/y instead.
   */
  draggable: false,

  addAttributes() {
    return {
      fx: {
        default: 'tape' satisfies PlaceableKey,
        parseHTML: (element) =>
          resolveMark(element.getAttribute('data-fx'), element.getAttribute('data-fx-value'))
            .fx,
        renderHTML: (attributes) => ({ 'data-fx': String(attributes.fx) }),
      },
      value: {
        default: 'top',
        parseHTML: (element) =>
          resolveMark(element.getAttribute('data-fx'), element.getAttribute('data-fx-value'))
            .value,
        renderHTML: (attributes) => ({ 'data-fx-value': String(attributes.value) }),
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
      w: {
        default: 34,
        parseHTML: (element) => clampMarkSize(element.getAttribute('data-w'), 34),
        renderHTML: (attributes) => ({ 'data-w': String(attributes.w) }),
      },
      h: {
        default: 8,
        parseHTML: (element) => clampMarkSize(element.getAttribute('data-h'), 8),
        renderHTML: (attributes) => ({ 'data-h': String(attributes.h) }),
      },
      rotate: {
        default: 0,
        parseHTML: (element) => clampTilt(element.getAttribute('data-rotate')),
        renderHTML: (attributes) => ({ 'data-rotate': String(attributes.rotate) }),
      },
      seed: {
        default: 0,
        parseHTML: (element) => clampSeed(element.getAttribute('data-seed')),
        renderHTML: (attributes) => ({ 'data-seed': String(attributes.seed) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="page-mark"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'page-mark' })];
  },

  addNodeView() {
    return SolidNodeViewRenderer(PageMarkView);
  },
});
