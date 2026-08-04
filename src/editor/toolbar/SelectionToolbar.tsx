/**
 * The selection toolbar's card — presentation only. Positioning, visibility
 * and every transaction live in the plugin view (extension.ts); this file is
 * handed a flat props bag and draws it.
 *
 * House style: the same aged-paper card the slash and context menus use, one
 * ink outline, wobbly corners, a rotated cream chip per glyph. The two icons
 * that are not letters are drawn rather than typed — a chain glyph and a
 * marker glyph are both font-coverage lotteries on Windows, and a missing
 * glyph box in the middle of a row of six is worse than either.
 */
import { For, Show, createMemo, onMount, type JSX } from 'solid-js';
import {
  HIGHLIGHT_STYLES,
  HIGHLIGHT_STYLE_LABELS,
  HIGHLIGHT_WASHES,
  SELECTION_ACTIONS,
  type HighlightStyle,
  type HighlightWash,
  type SelectionAction,
  type SelectionActionId,
  type SelectionActiveMap,
  type SelectionTray,
} from './actions';
import {
  faceFloorPx,
  faceGroups,
  faceShortlist,
  faceStack,
  type FaceGroup,
} from '../marks/face';
import type { HandSpec } from '../../features/settings/appearance';

// The tray's row names come from the same table the right-click menu reads
// (`editor/highlightStyles.ts`); a second copy here is how one surface ended
// up able to rename a style without the other noticing.

/** A tilted chisel marker over its own swipe. */
function HighlightIcon(): JSX.Element {
  return (
    <svg class="nb-seltool-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.6 3.6 C 16.3 4.5 17.7 6 18.7 7.7 L 10.6 15.8 L 6.4 11.6 Z"
        fill="var(--wash-lemon)"
        stroke="var(--ink-sepia)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M6.4 11.6 L 10.6 15.8 L 8.3 18.3 L 4.1 14.1 Z"
        fill="var(--paper-cream)"
        stroke="var(--ink-sepia)"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
      <path
        d="M3.4 20.8 C 8.2 19.9 14.4 19.9 19.6 20.7"
        fill="none"
        stroke="var(--wash-amber-deep)"
        stroke-width="2.4"
        stroke-linecap="round"
      />
    </svg>
  );
}

/** Two bowed links of a chain. */
function LinkIcon(): JSX.Element {
  return (
    <svg class="nb-seltool-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.3 13.9 C 8.6 12.2 8.7 9.7 10.4 8.1 L 12.9 5.7 C 14.7 4 17.3 4.1 18.9 5.8 C 20.4 7.4 20.3 9.9 18.6 11.5 L 17.1 13"
        fill="none"
        stroke="var(--ink-sepia)"
        stroke-width="1.9"
        stroke-linecap="round"
      />
      <path
        d="M13.8 10.2 C 15.5 11.9 15.4 14.4 13.7 16 L 11.2 18.4 C 9.4 20.1 6.8 20 5.2 18.3 C 3.7 16.7 3.8 14.2 5.5 12.6 L 7 11.1"
        fill="none"
        stroke="var(--ink-sepia)"
        stroke-width="1.9"
        stroke-linecap="round"
      />
    </svg>
  );
}

/**
 * One face, drawn in itself.
 *
 * The label is set in the face it names — a chip that says "quick note" in
 * Nunito Sans is a menu of identical rectangles, and choosing a hand you cannot
 * see is choosing by trusting the adjective. `faceFloorPx` is what keeps that
 * honest without breaking the house rule: a 13px chip drawn in Caveat is
 * illegible, so Caveat's chip is 20px and the row grows to fit it.
 */
function FaceChip(props: {
  readonly spec: HandSpec;
  readonly on: boolean;
  onPick(id: string): void;
}): JSX.Element {
  return (
    <button
      type="button"
      class="nb-seltool-face"
      classList={{ 'is-on': props.on }}
      style={{
        'font-family': props.spec.stack,
        'font-size': `${faceFloorPx(props.spec.id)}px`,
      }}
      aria-label={`${props.spec.label} — ${props.spec.id}`}
      aria-pressed={props.on}
      data-hand={props.spec.id}
      data-tooltip={`${props.spec.id} — ${props.spec.blurb}`}
      data-tooltip-side="top"
      onMouseDown={(event) => {
        event.preventDefault();
        props.onPick(props.spec.id);
      }}
    >
      {props.spec.label}
    </button>
  );
}

export interface SelectionToolbarProps {
  readonly active: SelectionActiveMap;
  readonly tray: SelectionTray | null;
  /** Wash + hand style the open tray should show as chosen. */
  readonly wash: HighlightWash;
  readonly hlStyle: HighlightStyle;
  /** The hand under the selection, or null for the page's own. */
  readonly face: string | null;
  /** True once the reader has asked for every face rather than the shortlist. */
  readonly facesAll: boolean;
  /** Current value of the link field (the plugin owns the string). */
  readonly href: string;
  /** True when the selection already carries a link (offers "remove"). */
  readonly hasLink: boolean;
  /** Set while the typed link cannot be turned into an href. */
  readonly linkError: boolean;
  onPress(action: SelectionAction): void;
  onFace(hand: string): void;
  onClearFace(): void;
  onShowAllFaces(): void;
  onWash(wash: HighlightWash): void;
  onHighlightStyle(style: HighlightStyle): void;
  onClearHighlight(): void;
  onHrefInput(value: string): void;
  onApplyLink(): void;
  onRemoveLink(): void;
  /** Escape out of a tray (back to the row), or off the toolbar entirely. */
  onDismiss(): void;
}

/**
 * The link field, in its own component so it can own an `onMount`.
 *
 * WHY NOT FOCUS IT FROM THE `ref`. A Solid ref fires while the element is still
 * DETACHED — it is called as the node is created, before the fragment is
 * inserted. `HTMLElement.focus()` on a detached node is not a no-op: the focus
 * algorithm finds nothing focusable and resets the document's focus to `<body>`
 * — so the editor lost its selection, ProseMirror dispatched a blur
 * transaction, the toolbar's own visibility rule saw focus outside itself, and
 * the tray was torn down in the same tick it was built. The card flickered and
 * the reader never got a caret.
 *
 * `onMount` runs after insertion, which is the whole difference.
 */
function LinkField(props: {
  readonly href: string;
  readonly invalid: boolean;
  onInput(value: string): void;
  onApply(): void;
  onDismiss(): void;
}): JSX.Element {
  let field: HTMLInputElement | undefined;
  onMount(() => field?.focus());
  return (
    <input
      class="nb-seltool-field font-ui"
      type="text"
      spellcheck={false}
      autocomplete="off"
      placeholder="paste a link, or type a site…"
      aria-label="Link address"
      aria-invalid={props.invalid}
      classList={{ 'is-bad': props.invalid }}
      value={props.href}
      ref={field}
      onInput={(event) => props.onInput(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          props.onApply();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          props.onDismiss();
        }
      }}
    />
  );
}

export default function SelectionToolbar(props: SelectionToolbarProps): JSX.Element {
  const glyphFor = (id: SelectionActionId): JSX.Element => {
    if (id === 'highlight') return <HighlightIcon />;
    if (id === 'link') return <LinkIcon />;
    const action = SELECTION_ACTIONS.find((entry) => entry.id === id);
    // The face chip is the one glyph that is not a fixed letterform: it draws
    // "Aa" in whatever the selection is already wearing, so the button says
    // what the words look like as well as what pressing it is for.
    const style =
      id === 'face' && props.face !== null
        ? { 'font-family': faceStack(props.face) ?? '', 'font-size': '13px' }
        : undefined;
    return (
      <span
        class="nb-seltool-letter"
        data-mark={id}
        style={style}
        aria-hidden="true"
      >
        {action?.glyph ?? ''}
      </span>
    );
  };

  /*
   * The shortlist is recomputed from the selection's own face, so a reader who
   * set a run in a niche hand finds that hand in the first row when they come
   * back to it (the settings sheet's `withCurrent`, same argument).
   */
  const shortlist = createMemo<readonly HandSpec[]>(() => faceShortlist(props.face));
  const groups = createMemo<readonly FaceGroup[]>(() =>
    props.facesAll ? faceGroups() : [],
  );
  const moreCount = createMemo(() => {
    const shown = shortlist().length;
    const all = faceGroups().reduce((n, group) => n + group.faces.length, 0);
    return Math.max(0, all - shown);
  });

  return (
    <div class="nb-seltool" role="toolbar" aria-label="Text formatting">
      <div class="nb-seltool-row">
        <For each={SELECTION_ACTIONS}>
          {(action, index) => (
            <>
              {/* The two tray buttons are a different kind of press; a ruled
                  gap says so without a label. */}
              <Show when={action.tray !== null && index() > 0 && SELECTION_ACTIONS[index() - 1]?.tray === null}>
                <span class="nb-seltool-gap" aria-hidden="true" />
              </Show>
              <button
                type="button"
                class="nb-seltool-btn"
                classList={{
                  'is-on': props.active[action.id],
                  'is-open': props.tray !== null && props.tray === action.tray,
                }}
                style={{ '--nb-seltool-tilt': `${(index() % 3) - 1}deg` }}
                aria-label={action.title}
                aria-pressed={props.active[action.id]}
                data-action={action.id}
                data-tooltip={action.title}
                data-tooltip-side="top"
                data-tooltip-key={action.shortcut ?? undefined}
                // mousedown, not click: the editor keeps its selection.
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onPress(action);
                }}
              >
                {glyphFor(action.id)}
              </button>
            </>
          )}
        </For>
      </div>

      <Show when={props.tray === 'faces'}>
        <div class="nb-seltool-tray">
          <div class="nb-seltool-faces" role="group" aria-label="Handwriting">
            {/* The way back always comes first: a reader who has just tried
                three hands wants "leave it alone" without hunting. */}
            <button
              type="button"
              class="nb-seltool-face is-clear"
              classList={{ 'is-on': props.face === null }}
              aria-label="The page's own hand"
              aria-pressed={props.face === null}
              data-hand="none"
              data-tooltip="The page’s own hand"
              data-tooltip-side="top"
              onMouseDown={(event) => {
                event.preventDefault();
                props.onClearFace();
              }}
            >
              the page’s hand
            </button>
            <For each={shortlist()}>
              {(spec) => (
                <FaceChip
                  spec={spec}
                  on={props.face === spec.id}
                  onPick={props.onFace}
                />
              )}
            </For>
          </div>

          <Show when={props.facesAll}>
            <div class="nb-seltool-faceall">
              <For each={groups()}>
                {(group) => (
                  <>
                    <p class="nb-seltool-faceshelf font-ui">{group.title}</p>
                    <div
                      class="nb-seltool-faces"
                      role="group"
                      aria-label={group.title}
                    >
                      <For each={group.faces}>
                        {(spec) => (
                          <FaceChip
                            spec={spec}
                            on={props.face === spec.id}
                            onPick={props.onFace}
                          />
                        )}
                      </For>
                    </div>
                  </>
                )}
              </For>
            </div>
          </Show>

          <Show when={!props.facesAll && moreCount() > 0}>
            <button
              type="button"
              class="nb-seltool-more font-ui"
              aria-label={`Show all ${moreCount() + shortlist().length} hands`}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onShowAllFaces();
              }}
            >
              {moreCount()} more…
            </button>
          </Show>
        </div>
      </Show>

      <Show when={props.tray === 'washes'}>
        <div class="nb-seltool-tray">
          <div class="nb-seltool-washes" role="group" aria-label="Highlight wash">
            <For each={HIGHLIGHT_WASHES}>
              {(wash) => (
                <button
                  type="button"
                  class="nb-seltool-wash"
                  classList={{ 'is-on': props.active.highlight && props.wash === wash }}
                  style={{ '--nb-wash': `var(--wash-${wash})` }}
                  aria-label={`${wash} wash`}
                  data-wash={wash}
                  data-tooltip={`${wash.charAt(0).toUpperCase()}${wash.slice(1)} wash`}
                  data-tooltip-side="top"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    props.onWash(wash);
                  }}
                />
              )}
            </For>
            <button
              type="button"
              class="nb-seltool-wash is-clear"
              aria-label="No highlight"
              data-wash="none"
              data-tooltip="No highlight"
              data-tooltip-side="top"
              onMouseDown={(event) => {
                event.preventDefault();
                props.onClearHighlight();
              }}
            >
              ↺
            </button>
          </div>
          <div class="nb-seltool-styles" role="group" aria-label="Highlighter style">
            <For each={HIGHLIGHT_STYLES}>
              {(style) => (
                <button
                  type="button"
                  class="nb-seltool-style"
                  classList={{ 'is-on': props.hlStyle === style }}
                  aria-label={HIGHLIGHT_STYLE_LABELS[style].title}
                  data-style={style}
                  data-tooltip={HIGHLIGHT_STYLE_LABELS[style].title}
                  data-tooltip-side="top"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    props.onHighlightStyle(style);
                  }}
                >
                  {HIGHLIGHT_STYLE_LABELS[style].glyph}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.tray === 'link'}>
        <div class="nb-seltool-tray">
          <div class="nb-seltool-linkrow">
            {/* The tray exists to be typed in — open it and the caret is
                already there. */}
            <LinkField
              href={props.href}
              invalid={props.linkError}
              onInput={props.onHrefInput}
              onApply={props.onApplyLink}
              onDismiss={props.onDismiss}
            />
            <button
              type="button"
              class="nb-seltool-apply"
              aria-label="Apply link"
              data-tooltip="Apply link"
              data-tooltip-side="top"
              data-tooltip-key="↵"
              onMouseDown={(event) => {
                event.preventDefault();
                props.onApplyLink();
              }}
            >
              ✓
            </button>
            <Show when={props.hasLink}>
              <button
                type="button"
                class="nb-seltool-apply is-remove"
                aria-label="Remove link"
                data-tooltip="Remove link"
                data-tooltip-side="top"
                onMouseDown={(event) => {
                  event.preventDefault();
                  props.onRemoveLink();
                }}
              >
                ↺
              </button>
            </Show>
          </div>
          <Show when={props.linkError}>
            <p class="nb-seltool-note font-ui">
              that is not a web address — try alcove.app, or a full https:// link
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
