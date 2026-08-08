/**
 * src/sound/uiClicks.ts — quiet chrome plus a reliable book-rail click.
 *
 * The left book rail is the app's tactile tool surface, so its buttons click.
 * Other chrome stays quiet unless it opts in with `data-nb-sound-click`.
 * Important actions still call `play()` with their own semantic role.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY `click` AND NOT `pointerdown`
 * ─────────────────────────────────────────────────────────────────────────
 * Press-time is the better feel — 60-100 ms earlier and tied to the finger
 * rather than the release. But a lot of controls already voice themselves, and
 * a delegated handler has no way to know that ahead of time. On `click` in the
 * bubble phase the element's own handler has already run, so `msSinceVoicedPlay`
 * answers "did this control just make a sound?" and the click steps aside when
 * it did. Correct silence beats 80 ms of anticipation.
 *
 * `click` also covers keyboard activation for free: Enter and Space on a
 * <button> both fire it, with `detail === 0`.
 */

import {
  msSinceClickPlay,
  msSinceVoicedPlay,
  play,
  prepareInteractionAudio,
  recordInteractionGesture,
} from './engine';

/**
 * What counts as a button. Deliberately not `a[href]` — links inside a page's
 * prose are text, not chrome, and they already have their own affordance.
 */
const BUTTON_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
].join(',');

/** Explicit opt-in for otherwise quiet UI controls. */
export const CLICK_ATTR = 'data-nb-sound-click';
export const SOUNDED_BUTTON_SELECTOR = [
  `:is(${BUTTON_SELECTOR})[${CLICK_ATTR}]`,
  `.nb-rail :is(${BUTTON_SELECTOR})`,
].join(',');

/** Opt-out hook: put this on a control (or any ancestor) to keep it silent. */
export const SILENT_ATTR = 'data-nb-silent';

/**
 * A control that voiced itself within this window keeps the floor. 180 ms is
 * long enough to cover an async `play()` that had to finish decoding first, and
 * short enough that the previous interaction's sound has stopped counting.
 */
const VOICED_WINDOW_MS = 180;

/**
 * Two clicks closer together than this are one interaction as far as the ear
 * is concerned (double-click, or a control that re-dispatches).
 */
const MIN_INTERVAL_MS = 45;

let lastClickMs = Number.NEGATIVE_INFINITY;
let installed: (() => void) | undefined;

/**
 * Whether `target` is a button we should voice.
 *
 * Duck-typed rather than `instanceof Element`: the check has to hold for a
 * node from another realm (an iframe, or the unit suite's node environment,
 * where `Element` does not exist at all), and "has closest()" is the only
 * property this actually needs.
 */
export function isSoundedButton(target: EventTarget | null): boolean {
  const node = target as Element | null;
  if (!node || typeof node.closest !== 'function') return false;
  // `:is()` is load-bearing. Appending `[attr]` to the comma-joined selector
  // directly qualifies only its final arm (`[role="option"]`) and silently
  // turns every preceding arm — including plain `button` — back into blanket
  // playback.
  const button = node.closest(SOUNDED_BUTTON_SELECTOR);
  if (!button) return false;
  if (button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  return button.closest(`[${SILENT_ATTR}]`) === null;
}

/**
 * Pure decision half of the handler, so the rules are testable without a DOM
 * event loop: `nowMs` is the click's timestamp, `sinceVoiced` how long ago
 * another sound started, `lastClickAtMs` when this module last voiced one.
 */
export function shouldClick(
  nowMs: number,
  sinceVoiced: number,
  lastClickAtMs: number,
  sinceAnyClick: number = Number.POSITIVE_INFINITY,
): boolean {
  if (sinceVoiced < VOICED_WINDOW_MS) return false;
  /*
   * A click voiced by SOMEBODY ELSE counts too.
   *
   * `lastClickAtMs` is this module's own last click, and `sinceVoiced`
   * deliberately ignores the click role — so a click played by anything other
   * than this handler was invisible to it and got a second one stacked
   * underneath. Measured on the onboarding sound-set picker: seven same-family
   * pairs within 20ms across 38 plays, one per chip press, because
   * `previewSoundSet()` opens with a click and this handler could not tell.
   *
   * Defaulted rather than required so the existing three-argument calls in the
   * tests keep meaning what they meant.
   */
  if (sinceAnyClick < MIN_INTERVAL_MS) return false;
  return nowMs - lastClickAtMs >= MIN_INTERVAL_MS;
}

/**
 * Install the delegated listener. Idempotent; returns the uninstaller (Solid
 * `onCleanup` in dev, where the module can be hot-replaced).
 *
 * Mute, reduced-sound and the character preset are all the engine's business —
 * this only decides *whether this DOM event is a button press*.
 */
export function installUiClickSounds(root: Document = document): () => void {
  if (installed) return installed;

  // Installed synchronously before any app interaction. It also repairs
  // WebView focus state before mute gating runs.
  const onTrustedGesture = (): void => recordInteractionGesture();
  root.addEventListener('pointerdown', onTrustedGesture, true);
  root.addEventListener('keydown', onTrustedGesture, true);

  // Create Pixi Sound's shared context before the first gesture, arm direct
  // gesture resume, and decode the page/book/rail cues in the background.
  void prepareInteractionAudio().catch(() => undefined);

  // App start is the only moment the app reliably passes through on its way
  // to making a sound, and this is the one sound module App.tsx already calls.
  // The import is dynamic so the static graph of this module stays DOM-free
  // (the unit suite loads it in a node environment) and so the settings read
  // costs nothing until after first paint.
  void import('./soundSetPrefs').then((prefs) => prefs.loadSoundSet()).catch(() => undefined);

  const onClick = (event: Event): void => {
    if (!isSoundedButton(event.target)) return;
    const now = Date.now();
    if (!shouldClick(now, msSinceVoicedPlay(now), lastClickMs, msSinceClickPlay(now))) return;
    lastClickMs = now;
    void play('click-soft');
  };

  root.addEventListener('click', onClick, { passive: true });
  installed = () => {
    root.removeEventListener('pointerdown', onTrustedGesture, true);
    root.removeEventListener('keydown', onTrustedGesture, true);
    root.removeEventListener('click', onClick);
    installed = undefined;
  };
  return installed;
}
