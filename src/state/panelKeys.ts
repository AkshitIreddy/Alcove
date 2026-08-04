/**
 * src/state/panelKeys.ts — while a panel is out, the keyboard belongs to it.
 *
 * `ShelfWorld` binds arrows / Home / Enter on `document` (world.ts, "Keyboard
 * shelf nav"): arrows drag a selection halo between books, Home throws the
 * camera to the first floor, Enter pulls the selected book out and opens it.
 * A document listener cannot tell that a sheet is up, so unless something says
 * so, every panel in the app has its keys eaten from underneath it — arrowing
 * a picker moved the halo around behind the sheet, and Enter on a card picked
 * the design and then opened a book on top of the panel.
 *
 * ## Why this is its own store rather than a line in panelPush.ts
 *
 * The flag used to be written as a side effect of `claimPanelPush` — the call
 * that reserves LAYOUT room. So it was set by exactly the panels that displace
 * the world, which is exactly the ones that are `RailPanel`s, and the guard
 * was inert for everything else: the trash drawer, the templates gallery, the
 * settings sheet and the cheat sheet are all mounted outside the pushed stage,
 * claimed no push, and drove the shelf while the guard's own comment claimed
 * to cover them. Measured rather than argued — `scripts/probe-panel-keys.mjs`
 * opened seven surfaces, pressed ArrowDown at each and read the shelf's
 * selection back off the live world: four of the seven moved it.
 *
 * Owning the keyboard and displacing the world are two different questions. A
 * modal that covers the whole window pushes nothing and owns everything; the
 * shelf's studio pushes 380px and owns everything; the tour's card is pinned
 * over live UI and deliberately owns neither. `panelPush` now claims through
 * here instead of writing the attribute itself, so a panel that has no reason
 * to move anything can still say the keys are its own.
 *
 * ## A set of keys, not a boolean
 *
 * Sheets overlap. Swapping one panel for another claims the incoming one
 * before the outgoing one lets go, and a boolean would go false on that
 * release and hand the shelf a frame of arrows that were never its own.
 *
 * ## Why it is mirrored onto <html>
 *
 * The reader of this is a Pixi world, not a component: a `document` keydown
 * listener cannot subscribe to a Solid signal. The attribute is also the only
 * form of it a headless probe can see from outside the module graph, which
 * matters here more than usual — a probe's own `import()` of this file can
 * resolve to a second copy of the module on a dev server that has served HMR
 * updates, and that copy's set is empty no matter what the app has claimed.
 * `panelOwnsKeyboard()` therefore reads the DOM, never the set.
 */
import { createEffect, onCleanup } from 'solid-js';

/** Live claims, keyed by panel instance. */
const owners = new Set<string>();

/** Instance counter for `usePanelKeys` — a panel never picks its own key. */
let seq = 0;

function publish(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (owners.size > 0) root.dataset['nbPanel'] = 'open';
  else delete root.dataset['nbPanel'];
}

/** This panel is on screen: the shelf's navigation keys are not the shelf's. */
export function claimPanelKeys(key: string): void {
  owners.add(key);
  publish();
}

/** This panel is closing or unmounting — give the keyboard back. */
export function releasePanelKeys(key: string): void {
  if (!owners.delete(key)) return;
  publish();
}

/**
 * True while any panel is out.
 *
 * Reads the attribute rather than `owners` on purpose — see the docblock: the
 * DOM is the copy every module and every probe agrees on.
 */
export function panelOwnsKeyboard(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset['nbPanel'] === 'open';
}

/**
 * Solid side: this panel owns the keyboard for as long as it is on screen.
 *
 * Call it once in the component that renders the dialog root. Pass `open` only
 * if the panel STAYS MOUNTED while closed — `RailPanel` and the settings sheet
 * both latch, so that a half-typed rebinding survives a close; a panel that is
 * `<Show>`n in and out, or rendered into a host that is torn down, can omit it.
 *
 * The release is on cleanup as well as on `open` going false, because leaving
 * a scene unmounts a panel without ever closing it: the trash drawer goes with
 * the shelf the moment a book is opened.
 */
export function usePanelKeys(open?: () => boolean): void {
  const key = `panel-keys-${(seq += 1)}`;
  createEffect(() => {
    if (open === undefined || open()) claimPanelKeys(key);
    else releasePanelKeys(key);
  });
  onCleanup(() => releasePanelKeys(key));
}

/** Test seam: forget every claim. Never call this from the app. */
export function __resetPanelKeys(): void {
  owners.clear();
  publish();
}
