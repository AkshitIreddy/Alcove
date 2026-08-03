/**
 * Callout block — a watercolor-washed aside with a sticker icon.
 *
 * Attrs: `{ id (UniqueID), icon: StickerId, tint: CalloutTint, tintHex }`.
 * The wash background is pure CSS (layered gradients in editor.css) — no
 * runtime SVG filters. Clicking the icon cycles stickers; the dot in the
 * corner opens the pigment picker.
 *
 * ## Where the colours come from now
 *
 * This node used to carry its own six tints. `editor.css` had grown to eleven
 * `[data-tint=…]` rules by the time anybody noticed, so five of the app's own
 * pigments were sitting in the stylesheet, rendering correctly, and reachable
 * from nowhere at all. The vocabulary is now `art/customColour.ts` — the same
 * twenty-four the rest of the app draws from — and the node paints from it
 * DIRECTLY, by writing `--co-light` / `--co-base` / `--co-deep` onto the
 * element, rather than by hoping a matching selector exists in a stylesheet.
 *
 * That is what makes both halves of this change work at once: a twenty-fifth
 * pigment needs no CSS, and a colour the reader typed in themselves — which
 * could never have a selector — is painted by exactly the same path as amber.
 * The `[data-tint=…]` rules in `editor.css` are now a fallback for documents
 * rendered outside the editor, and `data-tint` is still written so they hit.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  CUSTOM_WASH_ID,
  DEFAULT_WASH_ID,
  PALETTE_PAGE,
  PALETTE_REST,
  WASH_SWATCHES,
  WASH_SWATCH_IDS,
  customColours,
  normaliseHex,
  rememberCustomColour,
  resolveWash,
  subscribeCustomColours,
  type ResolvedWash,
} from '../../art/customColour';
import {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { STICKER_IDS, isStickerId, stickerSvg, type StickerId } from './stickers';

/**
 * Every tint a callout can wear, in picker order.
 *
 * Derived, never restated: the length of this array IS the size of the pigment
 * shelf, so a colour added there reaches the callout with no edit here. (A
 * constant repeating another table's size is how this codebase previously
 * ended up drawing eight of something it had fifty of.)
 */
export const CALLOUT_TINTS: readonly string[] = WASH_SWATCH_IDS;

/**
 * A tint id.
 *
 * Deliberately `string` and not a closed union. The attribute legitimately
 * holds three kinds of value — one of `CALLOUT_TINTS`, the literal `custom`
 * alongside a `tintHex`, or a stale id from a document written before a
 * recolour — and a union that claimed otherwise would only be lying at the
 * type level while `resolveWash` did the real work at runtime.
 */
export type CalloutTint = string;

function isCalloutTint(value: unknown): value is CalloutTint {
  return typeof value === 'string' && CALLOUT_TINTS.includes(value);
}

export interface CalloutAttributes {
  icon: StickerId;
  tint: CalloutTint;
  /** The reader's own colour, canonical `#rrggbb`, when `tint` is `custom`. */
  tintHex: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a callout. */
      setCallout: (attrs?: Partial<CalloutAttributes>) => ReturnType;
      /** Wrap in / lift out of a callout. */
      toggleCallout: (attrs?: Partial<CalloutAttributes>) => ReturnType;
    };
  }
}

function next<T>(list: readonly T[], current: T): T {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length];
}

/**
 * The three custom properties `editor.css` builds the whole wash out of.
 *
 * One string, used by both the node view and `renderHTML`, so a callout looks
 * the same whether the editor drew it or an exporter serialised it.
 */
function washStyle(wash: ResolvedWash): string {
  return `--co-light: ${wash.css.light}; --co-base: ${wash.css.base}; --co-deep: ${wash.css.deep}`;
}

/* ------------------------------ the picker -------------------------------- */

/**
 * The two marks that say "a press here is not a press OUTSIDE the picker".
 *
 * This exists because the obvious version does not work, and did not work in a
 * way nothing reported: the panel called `event.stopPropagation()` on
 * mousedown and the close listener sat on `document`, so the reasoning was
 * "the listener only ever sees the somewhere-else case". Two things break it.
 * Solid DELEGATES mousedown to the document, so by the time the panel's
 * handler runs the native event is already at the document; and
 * `stopPropagation` does not stop other listeners on the same node anyway —
 * that is `stopImmediatePropagation`. The close therefore fired on every press
 * inside the panel. Chips survived by accident (their own click reapplied the
 * colour and closed it deliberately), and everything else did not: pressing
 * "4 more" shut the picker instead of expanding it, and the hex field could
 * not be focused at all. The whole custom-colour path was unreachable by
 * mouse, which is how a reader would actually reach it.
 *
 * Containment is checked with `closest`, which needs no refs, survives the
 * panel re-rendering, and reads the same for the trigger — a press on the
 * trigger must fall through so its own `onClick` can toggle the panel shut.
 */
const PANEL_CLASS = 'nb-callout-tint-panel';
const KEEP_OPEN_SELECTOR = `.${PANEL_CLASS}, .nb-callout-tint`;

const PANEL: JSX.CSSProperties = {
  position: 'absolute',
  top: '28px',
  right: '4px',
  'z-index': 'var(--z-menus)',
  width: '228px',
  padding: 'var(--space-8)',
  background: 'var(--paper-cream)',
  border: 'var(--stroke-ink)',
  'border-radius': 'var(--radius-wobble-md)',
  'box-shadow': 'var(--shadow-md)',
  display: 'flex',
  'flex-direction': 'column',
  gap: 'var(--space-8)',
};

const GRID: JSX.CSSProperties = {
  display: 'grid',
  'grid-template-columns': 'repeat(6, 1fr)',
  gap: '6px',
};

const CHIP: JSX.CSSProperties = {
  width: '100%',
  'aspect-ratio': '1',
  padding: '0',
  border: 'var(--stroke-ink-thin)',
  'border-radius': 'var(--radius-wobble-sm)',
  cursor: 'pointer',
};

const NOTE: JSX.CSSProperties = {
  font: '500 var(--text-ui)/1.3 var(--font-ui)',
  'letter-spacing': 'var(--tracking-ui)',
  color: 'var(--ink-sepia-soft)',
};

const LINK: JSX.CSSProperties = {
  ...NOTE,
  background: 'none',
  border: 'none',
  padding: '2px 0',
  'text-align': 'left',
  'text-decoration': 'underline',
  'text-underline-offset': '3px',
  cursor: 'pointer',
};

interface PickerProps {
  readonly current: ResolvedWash;
  readonly onPick: (tint: CalloutTint, hex: string | null) => void;
  readonly onClose: () => void;
}

/**
 * Twenty pigments, then the rest behind a count, then the reader's own.
 *
 * The fold at twenty is the reader's own instruction and it is a rendering
 * budget as much as a layout one — several pickers in this app draw their
 * swatch on a canvas, so "show everything" means "bake everything". These
 * particular chips are flat DOM with a background colour and nothing
 * rasterises on hover, but the fold is kept anyway so every picker in the app
 * behaves the same way.
 */
function TintPicker(props: PickerProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [own, setOwn] = createSignal<readonly string[]>(customColours());

  createEffect(() => {
    const stop = subscribeCustomColours(() => setOwn([...customColours()]));
    onCleanup(stop);
  });

  createEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const shown = (): readonly (typeof WASH_SWATCHES)[number][] =>
    expanded() ? WASH_SWATCHES : WASH_SWATCHES.slice(0, PALETTE_PAGE);

  const commit = (value: string): void => {
    const hex = normaliseHex(value);
    // A hex we cannot read leaves the field exactly as the reader typed it.
    // Writing a default over somebody's half-typed colour is the one thing
    // this picker must never do.
    if (hex === null) return;
    rememberCustomColour(hex);
    props.onPick(CUSTOM_WASH_ID, hex);
    setDraft('');
  };

  return (
    <div
      contentEditable={false}
      role="group"
      aria-label="Callout wash colour"
      class={PANEL_CLASS}
      style={PANEL}
      // NOT what keeps the panel open — see PANEL_CLASS. This only stops the
      // editor underneath from treating a press on the panel as a click into
      // the prose. It must not preventDefault: the two inputs below need
      // mousedown's default behaviour to take focus at all.
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div style={GRID}>
        <For each={shown()}>
          {(swatch) => (
            <button
              type="button"
              data-tooltip={swatch.label}
              aria-label={swatch.label}
              aria-pressed={props.current.id === swatch.id}
              style={{
                ...CHIP,
                background: swatch.css.base,
                outline:
                  props.current.id === swatch.id ? '2px solid var(--accent-deep)' : 'none',
                'outline-offset': '2px',
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onPick(swatch.id, null)}
            />
          )}
        </For>
      </div>

      <Show when={PALETTE_REST > 0 && !expanded()}>
        <button type="button" style={LINK} onClick={() => setExpanded(true)}>
          {PALETTE_REST} more
        </button>
      </Show>

      <div style={{ ...NOTE, 'border-top': '1.5px dashed var(--paper-edge)', 'padding-top': 'var(--space-8)' }}>
        Your own colours
      </div>

      <Show when={own().length > 0}>
        <div style={GRID}>
          <For each={own()}>
            {(hex) => (
              <button
                type="button"
                data-tooltip={hex.toUpperCase()}
                aria-label={`Custom colour ${hex.toUpperCase()}`}
                aria-pressed={props.current.hex === hex}
                style={{
                  ...CHIP,
                  background: hex,
                  outline: props.current.hex === hex ? '2px solid var(--accent-deep)' : 'none',
                  'outline-offset': '2px',
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => props.onPick(CUSTOM_WASH_ID, hex)}
              />
            )}
          </For>
        </div>
      </Show>

      <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
        <input
          type="color"
          aria-label="Pick a colour"
          value={props.current.hex ?? props.current.paint.base}
          style={{
            width: '34px',
            height: '28px',
            padding: '0',
            border: 'var(--stroke-ink-thin)',
            'border-radius': 'var(--radius-sm)',
            background: 'none',
            cursor: 'pointer',
          }}
          onChange={(event) => commit(event.currentTarget.value)}
        />
        <input
          type="text"
          inputMode="text"
          spellcheck={false}
          placeholder="#7d915c"
          aria-label="Colour as a hex code"
          value={draft()}
          style={{
            flex: '1 1 auto',
            'min-width': '0',
            height: '28px',
            padding: '0 var(--space-8)',
            font: '500 var(--text-ui)/1 var(--font-ui)',
            color: 'var(--ink-sepia)',
            background: 'var(--paper-aged)',
            border:
              draft() !== '' && normaliseHex(draft()) === null
                ? '1.5px solid var(--accent-deep)'
                : 'var(--stroke-ink-thin)',
            'border-radius': 'var(--radius-sm)',
          }}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(draft());
            }
          }}
        />
        <button
          type="button"
          aria-label="Use this colour"
          disabled={normaliseHex(draft()) === null}
          style={{
            ...NOTE,
            height: '28px',
            padding: '0 var(--space-8)',
            color: 'var(--on-accent)',
            background: 'var(--accent-deep)',
            border: 'var(--stroke-ink-thin)',
            'border-radius': 'var(--radius-sm)',
            opacity: normaliseHex(draft()) === null ? '0.45' : '1',
            cursor: normaliseHex(draft()) === null ? 'default' : 'pointer',
          }}
          onClick={() => commit(draft())}
        >
          Use
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- node view -------------------------------- */

function CalloutView(props: SolidNodeViewProps): JSX.Element {
  const [open, setOpen] = createSignal(false);

  const icon = (): StickerId => {
    const value: unknown = props.node.attrs.icon;
    return isStickerId(value) ? value : 'leaf';
  };
  const wash = (): ResolvedWash =>
    resolveWash(props.node.attrs.tint, props.node.attrs.tintHex);

  // Pressing anywhere that is neither the panel nor the trigger closes the
  // picker. Containment rather than propagation — see KEEP_OPEN_SELECTOR for
  // why propagation cannot do this job. Registered ONLY while open, so a page
  // of a hundred callouts carries no listeners at rest.
  createEffect(() => {
    if (!open()) return;
    const close = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(KEEP_OPEN_SELECTOR) !== null) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    onCleanup(() => document.removeEventListener('mousedown', close));
  });

  return (
    // `data-tint-hex` is written onto the LIVE element as well as into
    // `renderHTML`, so the node view and the serialised form describe the same
    // colour. Anything that reads the rendered page rather than the document —
    // the page-flip's rasteriser, the HTML exporter's capture — then sees a
    // custom colour as a custom colour instead of as an unrecognised tint.
    <NodeViewWrapper
      class="nb-callout"
      data-tint={wash().id}
      data-tint-hex={wash().hex ?? undefined}
      style={washStyle(wash())}
    >
      <button
        type="button"
        class="nb-callout-icon"
        contentEditable={false}
        data-tooltip="Change icon"
        aria-label={`Callout icon: ${icon()} — click to change`}
        innerHTML={stickerSvg(icon())}
        onClick={() => props.updateAttributes({ icon: next(STICKER_IDS, icon()) })}
      />
      <button
        type="button"
        class="nb-callout-tint"
        contentEditable={false}
        data-tooltip="Change wash colour"
        aria-haspopup="true"
        aria-expanded={open()}
        aria-label={`Callout wash: ${wash().label} — click to change`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      />
      <Show when={open()}>
        <TintPicker
          current={wash()}
          onClose={() => setOpen(false)}
          onPick={(tint, hex) => {
            props.updateAttributes({ tint, tintHex: hex });
            setOpen(false);
          }}
        />
      </Show>
      <NodeViewContent class="nb-callout-body" />
    </NodeViewWrapper>
  );
}

export const Callout = Node.create({
  name: 'callout',

  group: 'block',

  content: 'paragraph+',

  defining: true,

  addAttributes() {
    return {
      icon: {
        default: 'leaf' satisfies StickerId,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-icon');
          return isStickerId(raw) ? raw : 'leaf';
        },
        renderHTML: (attributes) => ({ 'data-icon': String(attributes.icon) }),
      },
      tint: {
        default: DEFAULT_WASH_ID satisfies CalloutTint,
        // Total, and it does NOT reach for the default the moment it sees
        // something unfamiliar: `custom` is a legal value that is not in
        // CALLOUT_TINTS, and a bare hex in this slot is a document written by
        // a tolerant exporter. Both are kept; `resolveWash` sorts them out.
        parseHTML: (element) => {
          const raw = element.getAttribute('data-tint');
          if (isCalloutTint(raw)) return raw;
          if (raw === CUSTOM_WASH_ID || normaliseHex(raw) !== null) return raw;
          return DEFAULT_WASH_ID;
        },
        renderHTML: (attributes) => ({ 'data-tint': String(attributes.tint) }),
      },
      tintHex: {
        default: null as string | null,
        parseHTML: (element) =>
          normaliseHex(element.getAttribute('data-tint-hex')) ??
          normaliseHex(element.getAttribute('data-tint')),
        renderHTML: (attributes) => {
          const hex = normaliseHex(attributes.tintHex);
          return hex === null ? {} : { 'data-tint-hex': hex };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // The wash is written onto the element rather than left to a selector, so
    // an exported page carries all twenty-four pigments and every custom
    // colour without needing a stylesheet that knows their names.
    const wash = resolveWash(node.attrs.tint, node.attrs.tintHex);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        style: washStyle(wash),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(CalloutView);
  },
});
