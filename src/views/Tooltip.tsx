/**
 * src/views/Tooltip.tsx — the app's own tooltip.
 *
 * Everything with a `title=""` was borrowing the operating system's grey
 * bubble: another app's typeface, another app's corner, another app's timing,
 * dropped on top of a flat, hand-drawn library. This is the replacement, and
 * it is ONE of them for the whole app — a single layer parked on <body>,
 * driven by delegated listeners, so adding a tooltip anywhere is adding an
 * attribute:
 *
 *   <button aria-label="Zoom out" data-tooltip="Zoom out"
 *           data-tooltip-side="top" data-tooltip-key="-">
 *
 * Three attributes, all optional past the first:
 *   data-tooltip       the words. EMPTY OR ABSENT MEANS NO TOOLTIP, which is
 *                      how a call site suppresses one conditionally (a rail
 *                      icon whose panel is already open labels nothing).
 *   data-tooltip-side  'right' (default) | 'left' | 'top' | 'bottom'. A hint,
 *                      not a promise: a side that would run off the window
 *                      flips to its opposite and then to the cross axis.
 *   data-tooltip-key   a shortcut, drawn on a little gilt key cap.
 *   data-tooltip-clipped
 *                      present = only speak up when the label is actually
 *                      cut off. Truncated names (a book in the trash, a menu
 *                      heading) want the full text back ONLY when the reader
 *                      cannot already see it; a bubble that repeats a line
 *                      sitting in full underneath it is noise. Measured at
 *                      show time, so it follows a resize for free.
 *
 * The things that are easy to get wrong, and what is done about each:
 *
 *   LAYOUT. The bubble is `position: fixed` inside a zero-size host appended
 *   to <body>, and it is placed with `translate3d`. It is not a child of the
 *   control it labels, so it cannot change that control's box, and nothing it
 *   does can reflow the page it floats over.
 *
 *   THE HOVER LOOP. A tooltip that measures on every pointer move is a
 *   rasterization engine. This measures exactly ONCE per appearance — one
 *   getBoundingClientRect pair, after the pointer has already been still for
 *   the delay — and everything after that is transform + opacity. `pointerover`
 *   bubbles, so there is one listener for the whole document rather than two
 *   per control, and a move WITHIN a control does no work at all.
 *
 *   THE KEYBOARD. Hover-only tooltips do not exist for anyone who tabs. This
 *   shows on `focusin` too, but only when the control matches `:focus-visible`
 *   — a mouse click already told you what you pressed, and a bubble popping up
 *   under your own cursor after every click is noise.
 *
 *   SCREEN READERS. The bubble is `aria-hidden`, and it never touches the
 *   control's own attributes. The accessible name stays where it belongs, on
 *   the control (`aria-label`), and is announced once rather than twice.
 *
 *   THE FLICKER. Showing costs a delay; hiding costs nothing. Sweeping a rail
 *   with the pointer therefore does not fire a bubble per icon. Once one IS
 *   up, a short warm window lets the next one follow almost immediately, so
 *   reading a rail icon by icon does not mean waiting out the full delay four
 *   times.
 */

import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import '../styles/tooltip.css';

export type TipSide = 'top' | 'right' | 'bottom' | 'left';

/** The attribute a control opts in with. Exported so tests can assert on it. */
export const TIP_ATTR = 'data-tooltip';
export const TIP_SIDE_ATTR = 'data-tooltip-side';
export const TIP_KEY_ATTR = 'data-tooltip-key';
export const TIP_CLIPPED_ATTR = 'data-tooltip-clipped';

const TRIGGER_SELECTOR = `[${TIP_ATTR}]`;

/* --------------------------------- timings -------------------------------- */

/** Pointer must rest this long before a bubble appears. */
const HOVER_DELAY_MS = 380;
/** Keyboard focus is deliberate, so it waits far less — just enough that
 *  tabbing straight through a rail does not strobe. */
const FOCUS_DELAY_MS = 110;
/** After one closes, the next opens on this much shorter delay. */
const WARM_DELAY_MS = 60;
/** How long "warm" lasts once a bubble goes away. */
const WARM_WINDOW_MS = 520;

/* -------------------------------- geometry -------------------------------- */

/**
 * Gap between the control and the bubble's edge. The nub lives in it and is
 * very slightly longer, so the tail's point just touches the control — which
 * is what makes the bubble read as coming OUT of the thing it labels rather
 * than floating beside it. Change it with the nub size in tooltip.css.
 */
const GAP = 11;
/** The bubble never comes closer than this to a window edge. */
const EDGE = 8;
/** How far from a corner the nub may sit, so it never rides a round. */
const NUB_INSET = 14;

const SIDES: readonly string[] = ['top', 'right', 'bottom', 'left'];

/** Fallback order: what was asked for, its opposite, then the cross axis. */
const FALLBACKS: Record<TipSide, readonly TipSide[]> = {
  right: ['right', 'left', 'bottom', 'top'],
  left: ['left', 'right', 'bottom', 'top'],
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left'],
};

interface TipState {
  text: string;
  key: string | null;
  side: TipSide;
  /** Viewport px, already clamped. */
  x: number;
  y: number;
  /** Offset of the nub along the card's own edge, in px from its top/left. */
  nub: number;
  /** False for the measuring pass, true once placed. */
  up: boolean;
}

interface Placement {
  side: TipSide;
  x: number;
  y: number;
  nub: number;
}

const clamp = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;

function readSide(el: Element): TipSide {
  const raw = el.getAttribute(TIP_SIDE_ATTR) ?? '';
  return SIDES.includes(raw) ? (raw as TipSide) : 'right';
}

/**
 * Where the bubble goes, given the control's box and the bubble's own size.
 *
 * Pure and exported so a node test can pin the flip and the clamp without a
 * browser: the failure this guards against is a bubble that is placed by
 * arithmetic which happens to work at the one window size it was built at.
 */
export function placeTip(
  anchor: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  want: TipSide,
  viewport: { width: number; height: number },
): Placement {
  const { width: w, height: h } = size;
  const aw = anchor.right - anchor.left;
  const ah = anchor.bottom - anchor.top;

  const fits = (side: TipSide): boolean => {
    if (side === 'right') return anchor.right + GAP + w <= viewport.width - EDGE;
    if (side === 'left') return anchor.left - GAP - w >= EDGE;
    if (side === 'top') return anchor.top - GAP - h >= EDGE;
    return anchor.bottom + GAP + h <= viewport.height - EDGE;
  };

  const side = FALLBACKS[want].find(fits) ?? want;

  let x: number;
  let y: number;
  if (side === 'right') {
    x = anchor.right + GAP;
    y = anchor.top + ah / 2 - h / 2;
  } else if (side === 'left') {
    x = anchor.left - GAP - w;
    y = anchor.top + ah / 2 - h / 2;
  } else if (side === 'top') {
    x = anchor.left + aw / 2 - w / 2;
    y = anchor.top - GAP - h;
  } else {
    x = anchor.left + aw / 2 - w / 2;
    y = anchor.bottom + GAP;
  }

  // Clamp into the window. Math.max guards the degenerate case where the
  // bubble is wider than the window itself — lo must never exceed hi.
  const cx = Math.round(clamp(x, EDGE, Math.max(EDGE, viewport.width - EDGE - w)));
  const cy = Math.round(clamp(y, EDGE, Math.max(EDGE, viewport.height - EDGE - h)));

  // The nub keeps pointing at the control's centre even after that clamp,
  // which is the whole reason it is computed rather than pinned to 50%.
  const vertical = side === 'left' || side === 'right';
  const centre = vertical ? anchor.top + ah / 2 - cy : anchor.left + aw / 2 - cx;
  const span = vertical ? h : w;
  const nub = Math.round(
    clamp(centre, NUB_INSET, Math.max(NUB_INSET, span - NUB_INSET)),
  );

  return { side, x: cx, y: cy, nub };
}

/* ------------------------------- the layer -------------------------------- */

function TooltipRoot(): JSX.Element {
  const [state, setState] = createSignal<TipState | null>(null);
  let card: HTMLDivElement | undefined;

  /** The control the bubble belongs to right now (or is about to). */
  let anchor: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** A bubble was actually painted (not merely scheduled). */
  let shown = false;
  let warmUntil = 0;

  const cancel = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const close = (): void => {
    cancel();
    if (shown) warmUntil = Date.now() + WARM_WINDOW_MS;
    shown = false;
    anchor = null;
    setState(null);
  };

  /**
   * Measure and place. This is the ONLY place that touches layout, and it runs
   * once per appearance — never on pointer movement.
   */
  const paint = (el: HTMLElement): void => {
    if (!el.isConnected) {
      close();
      return;
    }
    const text = (el.getAttribute(TIP_ATTR) ?? '').trim();
    if (text === '') {
      close();
      return;
    }
    // "Only if it is cut off." One layout read, and only after the delay has
    // already elapsed — never on the pointer-move that started this.
    if (
      el.hasAttribute(TIP_CLIPPED_ATTR) &&
      el.scrollWidth <= el.clientWidth + 1
    ) {
      close();
      return;
    }
    const side = readSide(el);
    const key = el.getAttribute(TIP_KEY_ATTR);

    // Pass 1 — put the words in the DOM so the card can size itself. It is
    // hidden (`visibility`) rather than merely transparent, so a frame that
    // slipped between the two passes could not flash it in the corner.
    setState({ text, key, side, x: 0, y: 0, nub: 0, up: false });
    const node = card;
    if (node === undefined) return;

    const box = el.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    const placed = placeTip(
      { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
      { width: size.width, height: size.height },
      side,
      { width: window.innerWidth, height: window.innerHeight },
    );

    // Pass 2 — move it and let it in. The read above flushed style, so the
    // hidden state is the transition's genuine start and the fade plays.
    setState({ text, key, ...placed, up: true });
    shown = true;
  };

  const open = (el: HTMLElement, delay: number): void => {
    if (anchor === el) return;
    const text = (el.getAttribute(TIP_ATTR) ?? '').trim();
    if (text === '') {
      close();
      return;
    }
    cancel();
    anchor = el;
    const wait = Date.now() < warmUntil ? WARM_DELAY_MS : delay;
    timer = setTimeout(() => {
      timer = undefined;
      if (anchor === el) paint(el);
    }, wait);
  };

  const triggerOf = (target: EventTarget | null): HTMLElement | null => {
    if (target === null || !(target instanceof Element)) return null;
    const found = target.closest(TRIGGER_SELECTOR);
    return found instanceof HTMLElement ? found : null;
  };

  onMount(() => {
    /*
     * `pointerover` rather than per-element `mouseenter`: it bubbles, so one
     * listener covers the whole app, including chrome that has not been
     * written yet. Moving inside the same control re-resolves to the same
     * element and `open` returns without doing any work.
     */
    const onPointerOver = (e: PointerEvent): void => {
      // Touch fires this on tap; a bubble that needs a hover has nothing to
      // say on a touch screen, and it would cover what was just tapped.
      if (e.pointerType === 'touch') return;
      const el = triggerOf(e.target);
      if (el === null) {
        if (anchor !== null) close();
        return;
      }
      open(el, HOVER_DELAY_MS);
    };

    // relatedTarget === null means the pointer left the window entirely.
    const onPointerOut = (e: PointerEvent): void => {
      if (e.relatedTarget === null && anchor !== null) close();
    };

    const onFocusIn = (e: FocusEvent): void => {
      const el = triggerOf(e.target);
      if (el === null) {
        if (anchor !== null) close();
        return;
      }
      // Keyboard focus only. Clicking a button already answered the question
      // the tooltip exists to answer.
      if (!el.matches(':focus-visible')) {
        if (anchor !== null && anchor !== el) close();
        return;
      }
      open(el, FOCUS_DELAY_MS);
    };

    const onFocusOut = (e: FocusEvent): void => {
      const el = triggerOf(e.target);
      if (el === null || el !== anchor) return;
      // Focus can leave a control the pointer is still resting on; that is a
      // hover tooltip now, and it stays.
      if (el.matches(':hover')) return;
      close();
    };

    // A press has answered the question. So has Escape, and so has anything
    // that moved the world out from under the bubble.
    const onPointerDown = (): void => {
      if (anchor !== null) close();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (anchor !== null && e.key === 'Escape') close();
    };
    const onScrollOrResize = (): void => {
      if (anchor !== null) close();
    };

    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // Capture, so a scroll inside a panel closes it too — a bubble pinned to
    // viewport coordinates goes stale the moment its control moves.
    window.addEventListener('scroll', onScrollOrResize, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    window.addEventListener('blur', onScrollOrResize);

    onCleanup(() => {
      cancel();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('blur', onScrollOrResize);
    });
  });

  return (
    <Show when={state()}>
      {(tip) => (
        <div
          class="nb-tip"
          classList={{ 'is-up': tip().up }}
          data-side={tip().side}
          data-testid="nb-tooltip"
          // The control keeps the accessible name; this is decoration, and
          // announcing it would read the same words twice.
          aria-hidden="true"
          style={{
            transform: `translate3d(${tip().x}px, ${tip().y}px, 0)`,
            '--nb-tip-nub': `${tip().nub}px`,
          }}
        >
          <div class="nb-tip__card" ref={card}>
            <span class="nb-tip__label">{tip().text}</span>
            <Show when={tip().key}>
              {(key) => <span class="nb-tip__key">{key()}</span>}
            </Show>
            <span class="nb-tip__nub" />
          </div>
        </div>
      )}
    </Show>
  );
}

/* ------------------------------ installation ------------------------------ */

let host: HTMLDivElement | null = null;

/**
 * Put the one tooltip layer on the page. Idempotent, and deliberately never
 * torn down: it is a few hundred bytes of DOM, and a layer that came and went
 * with whichever view happened to mount it would leave the app tooltip-less
 * for exactly as long as a view transition takes.
 */
export function ensureTooltips(): void {
  if (host !== null || typeof document === 'undefined' || document.body === null) {
    return;
  }
  host = document.createElement('div');
  host.className = 'nb-tip-host';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  render(() => <TooltipRoot />, host);
}

/**
 * Declarative form, for views that would rather say it in JSX than trust an
 * import for its side effect. Renders nothing itself — the layer lives on
 * <body> — and `ensureTooltips` has almost always already run by here.
 */
export default function Tooltips(): JSX.Element {
  ensureTooltips();
  return null;
}

/*
 * Installed on import, OUTSIDE any component. `render()` creates a root, and a
 * root created while a component is rendering is owned by that component — the
 * layer would then be torn down with whichever view happened to import it
 * first. At module scope there is no owner, so the layer belongs to the app.
 */
if (typeof document !== 'undefined') {
  if (document.body !== null) ensureTooltips();
  else document.addEventListener('DOMContentLoaded', ensureTooltips, { once: true });
}
