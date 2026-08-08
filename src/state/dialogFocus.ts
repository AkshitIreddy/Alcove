/**
 * Focus ownership for a dialog-like surface.
 *
 * Modal cards use all three parts: focus enters on open, Tab wraps inside the
 * card, and the control that opened it gets focus back. The tutorial is the
 * deliberate exception: its highlighted page/shelf controls stay live, so it
 * asks for initial focus and restoration but opts out of the Tab trap.
 *
 * Escape is intentionally absent. Whether Escape closes, cancels an in-flight
 * operation, clears a search, or does nothing belongs to the surface itself.
 */
import { createEffect, onCleanup, onMount } from 'solid-js';

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type RestoreFocus = 'always' | 'if-contained';

export interface DialogFocusOptions {
  /** The element whose descendants make up the dialog's focus order. */
  container(): HTMLElement | undefined;
  /** The preferred first stop. Falls back to the first tabbable control. */
  initialFocus?(): HTMLElement | undefined;
  /** For latched surfaces; omitted means open for the component's lifetime. */
  open?: () => boolean;
  /** Modal by default. Non-modal teaching cards opt out. */
  trap?: boolean;
  /** Non-modal cards restore only if focus was still in the card on close. */
  restore?: RestoreFocus;
}

/**
 * The only cases where native Tab needs help: wrapping at an edge, or
 * recovering focus that somehow landed outside a modal.
 */
export function tabBoundaryTarget<T>(
  items: readonly T[],
  active: T | null,
  inside: boolean,
  backwards: boolean,
): T | null {
  if (items.length === 0) return null;
  const first = items[0] as T;
  const last = items[items.length - 1] as T;
  if (backwards) return !inside || active === first ? last : null;
  return !inside || active === last ? first : null;
}

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.getClientRects().length > 0 &&
      element.closest('[hidden], [inert], [aria-hidden="true"]') === null,
  );
}

function focusWithoutScroll(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch {
    // Older embedded webviews accept focus(), but not the options object.
    element.focus();
  }
}

function restorableActiveElement(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active === document.body || active === document.documentElement) return null;
  return active;
}

/** Give a dialog focus for exactly as long as it owns the screen. */
export function useDialogFocus(options: DialogFocusOptions): void {
  const isOpen = options.open ?? (() => true);
  const trapsTab = options.trap ?? true;
  const restoreMode = options.restore ?? 'always';
  let active = false;
  let opener: HTMLElement | null = null;
  let focusWasContained = false;
  let focusToken = 0;

  const activate = (): void => {
    if (active) return;
    active = true;
    opener = restorableActiveElement();
    focusWasContained = false;
    const token = (focusToken += 1);

    const focusInitial = (framesLeft: number): void => {
      if (!active || token !== focusToken) return;
      const container = options.container();
      if (container === undefined || !container.isConnected) {
        // A conditional <Portal> (the tutorial) can settle after the effect
        // that observed `open`. Chase that ref for a few paints, not forever.
        if (framesLeft > 0) requestAnimationFrame(() => focusInitial(framesLeft - 1));
        return;
      }
      const current = restorableActiveElement();
      if (
        current !== null &&
        current !== opener &&
        !container.contains(current)
      ) {
        // A fast pointer user already chose somewhere else before the Portal
        // settled. Their click is a stronger instruction than initial focus.
        return;
      }
      const wanted = options.initialFocus?.();
      const target =
        wanted !== undefined && wanted.isConnected
          ? wanted
          : (focusables(container)[0] ?? container);
      focusWithoutScroll(target);
      if (document.activeElement !== target && framesLeft > 0) {
        // Entrance choreography can hold a connected card at
        // `visibility:hidden` for its first beat. Browsers refuse that focus;
        // verify the result and try again once the card can actually receive it.
        requestAnimationFrame(() => focusInitial(framesLeft - 1));
      }
    };

    // Direct cards have refs by the microtask. The frame retry above exists
    // only for conditionally mounted Portals and does not delay the common case.
    queueMicrotask(() => focusInitial(4));
  };

  const deactivate = (): void => {
    if (!active) return;
    const container = options.container();
    const current = document.activeElement;
    const containedNow = current instanceof Node && container?.contains(current) === true;
    const shouldRestore =
      restoreMode === 'always' || focusWasContained || containedNow;
    const target = opener;
    active = false;
    focusToken += 1;
    opener = null;
    focusWasContained = false;
    if (shouldRestore && target?.isConnected) focusWithoutScroll(target);
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (!active) return;
    const target = event.target;
    focusWasContained =
      target instanceof Node && options.container()?.contains(target) === true;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!active || !trapsTab || event.key !== 'Tab') return;
    const container = options.container();
    if (container === undefined) return;
    const items = focusables(container);
    if (items.length === 0) {
      event.preventDefault();
      focusWithoutScroll(container);
      return;
    }
    const current = document.activeElement;
    const inside = current instanceof Node && container.contains(current);
    const target = tabBoundaryTarget(
      items,
      current instanceof HTMLElement ? current : null,
      inside,
      event.shiftKey,
    );
    if (target === null) return;
    event.preventDefault();
    focusWithoutScroll(target);
  };

  createEffect<boolean | undefined>((wasOpen) => {
    const open = isOpen();
    if (open && wasOpen !== true) activate();
    else if (!open && wasOpen === true) deactivate();
    return open;
  }, undefined);

  onMount(() => {
    window.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('keydown', onKeyDown, true);
  });

  onCleanup(() => {
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('keydown', onKeyDown, true);
    deactivate();
  });
}
