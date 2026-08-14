/**
 * A ruled-paper insertion caret with its own, page-safe geometry.
 *
 * Chromium sizes the native caret from the font's full line box. Patrick Hand
 * produces a 27px caret on Alcove's 32px writing pitch, and the bottom of that
 * box extends several pixels through the printed rule. CSS exposes the caret's
 * colour but not its height, so the reliable fix is a zero-layout overlay
 * beside ProseMirror at the collapsed text selection.
 *
 * The overlay never enters the document, never consumes horizontal space, and
 * is absent for ranges, node selections and gap cursors. IME composition gets
 * the native caret back temporarily; composition owns a live browser DOM range
 * and must not be made to negotiate with an overlay while it is assembling a
 * grapheme.
 */
import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export type WritingCaretAffinity = -1 | 1;

export interface WritingCaretPoint {
  readonly x: number;
  readonly y: number;
}

export interface WritingCaretRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface WritingCaretRuleGeometry {
  readonly top: number;
  readonly bottom: number;
  readonly ruleStart: number;
  readonly ruleEnd: number;
  readonly line: number;
}

interface WritingCaretPluginState {
  readonly affinity: WritingCaretAffinity;
}

interface WritingCaretMeta {
  readonly affinity: WritingCaretAffinity;
}

const writingCaretKey = new PluginKey<WritingCaretPluginState>('nbWritingCaret');

function axisDistance(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

/**
 * Choose which visual side of an ambiguous soft-wrap position was indicated.
 *
 * At a wrap boundary `coordsAtPos(pos, -1)` is the end of the previous line
 * and `coordsAtPos(pos, +1)` is the start of the next. ProseMirror's document
 * selection intentionally stores only `pos`; the pointer supplies the missing
 * visual-affinity bit. At ordinary positions both rectangles coincide, so the
 * downstream tie-break is immaterial.
 */
export function nearestWritingCaretAffinity(
  point: WritingCaretPoint,
  upstream: WritingCaretRect,
  downstream: WritingCaretRect,
): WritingCaretAffinity {
  const distance = (rect: WritingCaretRect): number => {
    const dx = axisDistance(point.x, rect.left, rect.right);
    const dy = axisDistance(point.y, rect.top, rect.bottom);
    return dx * dx + dy * dy;
  };
  return distance(upstream) < distance(downstream) ? -1 : 1;
}

/** Keyboard intent for the positions whose two visual affinities can differ. */
export function keyboardWritingCaretAffinity(
  key: string,
): WritingCaretAffinity | null {
  if (
    key === 'ArrowLeft' ||
    key === 'ArrowUp' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'Backspace'
  ) {
    return -1;
  }
  if (
    key === 'ArrowRight' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'PageDown' ||
    key === 'Enter' ||
    key === 'Delete'
  ) {
    return 1;
  }
  return null;
}

/**
 * Locate the baseline rule for a browser caret rectangle.
 *
 * `coordsAtPos().bottom` includes the font's descent, so it can sit several
 * pixels below the alphabetic baseline. That distance is still safely below
 * half of Alcove's writing pitch, including every supported text scale. The
 * nearest rule is therefore stable for body copy and all four heading sizes,
 * while using `top` would select the rule halfway through a two-line heading.
 *
 * Values returned here are viewport-space. The caller converts them back into
 * the page-editor host's layout coordinates before positioning the overlay.
 */
export function writingCaretRuleGeometry(
  caretBottom: number,
  pageTop: number,
  pitch: number,
  scaleY: number,
  height: number,
  clearance: number,
  ruleGap: number,
): WritingCaretRuleGeometry | null {
  if (
    !Number.isFinite(caretBottom) ||
    !Number.isFinite(pageTop) ||
    !Number.isFinite(pitch) ||
    !Number.isFinite(scaleY) ||
    !Number.isFinite(height) ||
    !Number.isFinite(clearance) ||
    !Number.isFinite(ruleGap) ||
    pitch <= 0 ||
    scaleY <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const viewportPitch = pitch * scaleY;
  const line = Math.max(
    1,
    Math.round((caretBottom - pageTop) / viewportPitch),
  );
  // A ruled tile paints its final layout pixel. Stay above its *start*, not
  // merely above the tile boundary, so the mark cannot cover that printed px.
  const ruleStart = pageTop + line * viewportPitch - scaleY;
  const ruleEnd = ruleStart + scaleY;
  const viewportHeight = height * scaleY;
  const viewportClearance = clearance * scaleY;
  const requestedBottom =
    ruleStart - (clearance + ruleGap) * scaleY;

  // A reader can move the handwriting twelve layout pixels either side of a
  // rule. At those extremes a correctly baseline-following mark would cross
  // this rule or its neighbour. Project the whole mark into whichever adjacent
  // clear band requires the smaller movement. This preserves the adjustment's
  // direction without ever drawing through a printed horizontal stroke.
  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.max(minimum, Math.min(maximum, value));
  const previousRuleEnd = ruleStart - viewportPitch + scaleY;
  const nextRuleStart = ruleStart + viewportPitch;
  const upperMinimum =
    previousRuleEnd + viewportClearance + viewportHeight;
  const upperMaximum = ruleStart - viewportClearance;
  const lowerMinimum = ruleEnd + viewportClearance + viewportHeight;
  const lowerMaximum = nextRuleStart - viewportClearance;
  const upperBottom = clamp(requestedBottom, upperMinimum, upperMaximum);
  const lowerBottom = clamp(requestedBottom, lowerMinimum, lowerMaximum);
  const bottom =
    Math.abs(requestedBottom - upperBottom) <=
    Math.abs(requestedBottom - lowerBottom)
      ? upperBottom
      : lowerBottom;
  return {
    line,
    ruleStart,
    ruleEnd,
    top: bottom - viewportHeight,
    bottom,
  };
}

function inputWritingCaretAffinity(
  inputType: string,
): WritingCaretAffinity | null {
  if (inputType.startsWith('deleteContentBackward')) return -1;
  if (
    inputType.startsWith('insert') ||
    inputType.startsWith('deleteContentForward')
  ) {
    return 1;
  }
  return null;
}

/** The document position that may show a writing caret, or null for a range. */
export function writingCaretPosition(state: EditorState): number | null {
  const { selection } = state;
  if (
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    !selection.$from.parent.inlineContent
  ) {
    return null;
  }
  return selection.head;
}

function writingCaretElement(): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = 'nb-writing-caret';
  element.contentEditable = 'false';
  element.draggable = false;
  element.setAttribute('aria-hidden', 'true');
  element.setAttribute('data-snapshot-hide', '');
  return element;
}

function styleElementAt(
  view: EditorView,
  position: number,
  affinity: WritingCaretAffinity,
): HTMLElement {
  const dom = view.domAtPos(position, affinity).node;
  return dom instanceof HTMLElement
    ? dom
    : dom.parentElement ?? view.dom;
}

export const WritingCaret = Extension.create({
  name: 'writingCaret',

  addProseMirrorPlugins() {
    return [
      new Plugin<WritingCaretPluginState>({
        key: writingCaretKey,
        state: {
          init: (): WritingCaretPluginState => ({
            affinity: 1,
          }),
          apply: (
            transaction,
            previous,
            _oldState,
            _nextState,
          ): WritingCaretPluginState => {
            const meta = transaction.getMeta(writingCaretKey) as
              | WritingCaretMeta
              | undefined;
            const affinity = meta?.affinity ?? previous.affinity;
            return affinity === previous.affinity ? previous : { affinity };
          },
        },
        view: (view) => {
          let settleFrame = 0;
          let positionFrame = 0;
          let pointerFrame = 0;
          let isComposing = false;
          let pendingPointer: WritingCaretPoint | null = null;
          const caret = writingCaretElement();
          const host = view.dom.parentElement;
          if (!(host instanceof HTMLElement)) {
            throw new Error('Writing caret requires the page-editor host.');
          }
          host.appendChild(caret);

          const hideCaret = (): void => {
            caret.classList.remove('is-visible');
          };

          const positionCaret = (restartBlink = false): void => {
            const position = writingCaretPosition(view.state);
            if (
              position === null ||
              !view.hasFocus() ||
              isComposing ||
              pendingPointer !== null
            ) {
              hideCaret();
              return;
            }
            const affinity =
              writingCaretKey.getState(view.state)?.affinity ?? 1;
            const coords = view.coordsAtPos(position, affinity);
            const hostRect = host.getBoundingClientRect();
            const scaleX = host.offsetWidth > 0
              ? hostRect.width / host.offsetWidth
              : 1;
            const scaleY = host.offsetHeight > 0
              ? hostRect.height / host.offsetHeight
              : scaleX;
            if (
              !Number.isFinite(scaleX) ||
              !Number.isFinite(scaleY) ||
              scaleX <= 0 ||
              scaleY <= 0
            ) {
              hideCaret();
              return;
            }
            const textElement = styleElementAt(view, position, affinity);
            const style = getComputedStyle(textElement);
            const fontSize = Number.parseFloat(style.fontSize);
            const proseStyle = getComputedStyle(view.dom);
            // `--page-line-height` can remain a serialized `calc(...)` custom
            // property in computed style. `lineHeight` is the browser-resolved
            // used value and therefore follows both the stored pitch and the
            // reader's text scale.
            const rootPitch = Number.parseFloat(proseStyle.lineHeight);
            const safeFontSize = Number.isFinite(fontSize) ? fontSize : 20;
            const proseFontSize = Number.parseFloat(proseStyle.fontSize);
            const safeProseFontSize = Number.isFinite(proseFontSize)
              ? proseFontSize
              : 20;
            const safePitch = Number.isFinite(rootPitch) ? rootPitch : 32;
            const height = Math.min(safeFontSize * 0.86, safePitch - 10);
            const page = host.closest('.nb-page');
            if (!(page instanceof HTMLElement)) {
              hideCaret();
              return;
            }
            const pageStyle = getComputedStyle(page);
            const ruleGapValue = Number.parseFloat(
              pageStyle.getPropertyValue('--page-rule-gap'),
            );
            const ruleGap = Number.isFinite(ruleGapValue) ? ruleGapValue : 0;
            const clearance = safeProseFontSize * 0.105;
            const ruleGeometry = writingCaretRuleGeometry(
              coords.bottom,
              page.getBoundingClientRect().top,
              safePitch,
              scaleY,
              height,
              clearance,
              ruleGap,
            );
            if (ruleGeometry === null) {
              hideCaret();
              return;
            }
            const bottom =
              (ruleGeometry.bottom - hostRect.top) / scaleY;
            caret.style.left = `${(coords.left - hostRect.left) / scaleX}px`;
            caret.style.top = `${bottom - height}px`;
            caret.style.height = `${height}px`;
            caret.classList.add('is-visible');
            if (restartBlink && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
              caret.style.animation = 'none';
              // Reset the blink after a real selection/input move, just as the
              // platform caret becomes solid again after every keystroke.
              void caret.offsetHeight;
              caret.style.animation = '';
            }
          };

          const schedulePosition = (): void => {
            if (positionFrame !== 0) cancelAnimationFrame(positionFrame);
            positionFrame = requestAnimationFrame(() => {
              positionFrame = 0;
              positionCaret();
            });
          };

          const setAffinity = (affinity: WritingCaretAffinity | null): void => {
            if (
              affinity === null ||
              writingCaretKey.getState(view.state)?.affinity === affinity
            ) {
              return;
            }
            view.dispatch(
              view.state.tr
                .setMeta(writingCaretKey, { affinity } satisfies WritingCaretMeta)
                .setMeta('addToHistory', false),
            );
          };
          const rememberPointer = (event: PointerEvent): void => {
            if (!event.isPrimary || event.button !== 0) return;
            pendingPointer = { x: event.clientX, y: event.clientY };
            hideCaret();
          };
          const settlePointer = (event: PointerEvent): void => {
            if (!event.isPrimary || pendingPointer === null) return;
            const point = pendingPointer;
            if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
            // Let the browser and ProseMirror publish the natural DOM
            // selection first. Dispatching an affinity-only transaction from
            // pointerdown can rebuild the selection DOM underneath Chromium's
            // hit test and sporadically move the click to a neighbouring line.
            const finishPointer = (remainingFrames: number): void => {
              pointerFrame = 0;
              const position = writingCaretPosition(view.state);
              const hit = view.posAtCoords({ left: point.x, top: point.y });
              if (
                remainingFrames > 0 &&
                hit !== null &&
                position !== hit.pos
              ) {
                pointerFrame = requestAnimationFrame(() => {
                  finishPointer(remainingFrames - 1);
                });
                return;
              }
              pendingPointer = null;
              if (position === null) {
                hideCaret();
                return;
              }
              const upstream = view.coordsAtPos(position, -1);
              const downstream = view.coordsAtPos(position, 1);
              setAffinity(
                nearestWritingCaretAffinity(point, upstream, downstream),
              );
              positionCaret(true);
            };
            pointerFrame = requestAnimationFrame(() => finishPointer(3));
          };
          const cancelPointer = (): void => {
            if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
            pointerFrame = 0;
            pendingPointer = null;
            schedulePosition();
          };
          const placeFromKeyboard = (event: KeyboardEvent): void => {
            if (event.altKey || event.metaKey) return;
            setAffinity(keyboardWritingCaretAffinity(event.key));
          };
          const placeFromInput = (event: InputEvent): void => {
            setAffinity(inputWritingCaretAffinity(event.inputType));
          };
          const composing = (): void => {
            if (settleFrame !== 0) cancelAnimationFrame(settleFrame);
            settleFrame = 0;
            isComposing = true;
            view.dom.classList.add('nb-is-composing');
            hideCaret();
          };
          const composed = (): void => {
            if (settleFrame !== 0) cancelAnimationFrame(settleFrame);
            // compositionend precedes the browser's final input transaction.
            // Keep the native caret for that hand-off frame, then let the
            // reconciled ProseMirror selection own the overlay again.
            settleFrame = requestAnimationFrame(() => {
              settleFrame = 0;
              isComposing = false;
              view.dom.classList.remove('nb-is-composing');
              positionCaret(true);
            });
          };
          // Pointerdown hides the old mark; pointerup restores it only after
          // Chromium has committed the new DOM selection. Keyboard/input intent
          // is safe to publish immediately because no browser hit test is live.
          view.dom.addEventListener('pointerdown', rememberPointer, true);
          window.addEventListener('pointerup', settlePointer, true);
          window.addEventListener('pointercancel', cancelPointer, true);
          view.dom.addEventListener('keydown', placeFromKeyboard, true);
          view.dom.addEventListener('beforeinput', placeFromInput, true);
          view.dom.addEventListener('compositionstart', composing);
          view.dom.addEventListener('compositionend', composed);
          view.dom.addEventListener('focus', schedulePosition, true);
          view.dom.addEventListener('blur', schedulePosition, true);
          window.addEventListener('resize', schedulePosition);
          const resizeObserver = new ResizeObserver(schedulePosition);
          resizeObserver.observe(view.dom);
          resizeObserver.observe(host);
          positionCaret();
          return {
            update: (updatedView, previousState) => {
              positionCaret(!updatedView.state.selection.eq(previousState.selection));
            },
            destroy: () => {
              if (settleFrame !== 0) cancelAnimationFrame(settleFrame);
              if (positionFrame !== 0) cancelAnimationFrame(positionFrame);
              if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
              view.dom.removeEventListener('pointerdown', rememberPointer, true);
              window.removeEventListener('pointerup', settlePointer, true);
              window.removeEventListener('pointercancel', cancelPointer, true);
              view.dom.removeEventListener('keydown', placeFromKeyboard, true);
              view.dom.removeEventListener('beforeinput', placeFromInput, true);
              view.dom.removeEventListener('compositionstart', composing);
              view.dom.removeEventListener('compositionend', composed);
              view.dom.removeEventListener('focus', schedulePosition, true);
              view.dom.removeEventListener('blur', schedulePosition, true);
              window.removeEventListener('resize', schedulePosition);
              resizeObserver.disconnect();
              view.dom.classList.remove('nb-is-composing');
              caret.remove();
            },
          };
        },
      }),
    ];
  },
});
