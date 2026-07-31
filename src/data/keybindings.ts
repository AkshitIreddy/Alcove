/**
 * src/data/keybindings.ts — matching and labelling for `settings.keybindings`.
 *
 * The settings sheet renders that map as the app's shortcut list, so every
 * combo in it is a promise to the reader. This module is the only place that
 * decides whether a KeyboardEvent keeps that promise: handlers match against
 * `settings.keybindings[action]` rather than hard-coding a key, which is what
 * stops the list and the handlers from drifting. (They had already drifted:
 * `export-script` advertised mod+shift+e while App.tsx used that combo for the
 * library export.)
 *
 * Grammar: '+'-joined, modifiers in any order, key last. 'mod' is Ctrl on
 * Windows/Linux and Cmd on macOS.
 */

/** True when `event` is exactly the combo `binding` describes. */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  if (event.key.toLowerCase() !== key) return false;
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  // Exact match on every modifier: Ctrl+Shift+E must not fire on Ctrl+E.
  if (wantMod !== (event.ctrlKey || event.metaKey)) return false;
  if (wantShift !== event.shiftKey) return false;
  if (wantAlt !== event.altKey) return false;
  return true;
}

/**
 * A binding as the user's platform names it ("Ctrl+Shift+E"), for kbd chips
 * and `aria-keyshortcuts`. `aria-keyshortcuts` wants "Control", not "Ctrl",
 * so that spelling is a separate function rather than a find-and-replace at
 * the call site.
 */
export function formatBinding(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part === 'mod' ? modLabel() : capitalize(part)))
    .join('+');
}

/** The same combo in the spelling `aria-keyshortcuts` requires. */
export function ariaKeyshortcuts(binding: string): string {
  return binding
    .split('+')
    .map((part) => (part === 'mod' ? (isApple() ? 'Meta' : 'Control') : capitalize(part)))
    .join('+');
}

function capitalize(part: string): string {
  return part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1);
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.userAgent);
}

function modLabel(): string {
  return isApple() ? 'Cmd' : 'Ctrl';
}
