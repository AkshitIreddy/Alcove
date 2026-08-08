/**
 * src/views/CheatSheet.tsx — the keyboard cheat-sheet (roadmap #14): a
 * hand-drawn paper card listing every key the app answers to, opened with
 * Ctrl+/ or `?` from anywhere outside a text field. Click the veil, Escape,
 * or `?` again closes it.
 *
 * IT IS GENERATED, not typed out. The card reads `SHORTCUT_ACTIONS` from
 * data/keybindings and the reader's own `settings.keybindings` on top of it,
 * so a shortcut that exists appears here, a shortcut that has been rebound
 * shows the key the reader gave it, and neither can be forgotten. The hand
 * list this replaced had twelve rows on the day the app had eight shortcuts,
 * two of which were wrong.
 *
 * The card is a module-level surface (`toggleCheatSheet`, `CheatSheetHost`)
 * rather than a component someone has to hold open. It used to belong to
 * BookView, which meant the one screen where a reader is most likely to want
 * "what are the keys?" — the shelf they have just opened the app onto — was
 * the one screen that had no way to ask.
 */
import { For, Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { settings } from '../data/settings';
import { useDialogFocus } from '../state/dialogFocus';
import { usePanelKeys } from '../state/panelKeys';
import {
  SHORTCUT_GROUPS,
  actionsInGroup,
  bindingFor,
  formatBinding,
  registerCommands,
  type ShortcutAction,
} from '../data/keybindings';

/* ----------------------------- the open state ------------------------------ */

const [open, setOpen] = createSignal(false);

export function toggleCheatSheet(): void {
  setOpen((up) => !up);
}

/* -------------------------------- the rows -------------------------------- */

/**
 * What to draw on the key cap for one action.
 *
 * A 'house' row carries its own phrase (they are not combinations — "drag a
 * page edge" cannot be spelled in the storage grammar). Everything else is
 * the reader's own binding, spelled for their platform, plus the extra key
 * the same command also answers to where there is one.
 */
function capFor(action: ShortcutAction, stored: Readonly<Record<string, string>>): string {
  if (action.kind === 'house') return action.keys;
  const combo = formatBinding(bindingFor(action.id, stored));
  if (action.kind === 'binding' && action.also !== undefined && action.also.length > 0) {
    return `${combo}  ·  ${action.also.join(' ')}`;
  }
  return combo;
}

/** Rows for one group — the unhandled ids never reach the paper. */
function rowsFor(
  group: (typeof SHORTCUT_GROUPS)[number]['id'],
  stored: Readonly<Record<string, string>>,
): Array<{ id: string; keys: string; what: string }> {
  return actionsInGroup(group)
    .filter((action) => !(action.kind === 'binding' && action.handled === false))
    .map((action) => ({
      id: action.id,
      keys: capFor(action, stored),
      what: action.label,
    }));
}

export interface CheatSheetProps {
  onClose(): void;
}

export default function CheatSheet(props: CheatSheetProps): JSX.Element {
  let cardRef: HTMLDivElement | undefined;
  let closeRef: HTMLButtonElement | undefined;

  // Mounted only while the card is up (CheatSheetHost's <Show>), so the claim
  // needs no `open` accessor. Without it the shelf answered arrows through the
  // veil — the card that lists the keys was itself losing them.
  usePanelKeys();
  useDialogFocus({
    container: () => cardRef,
    initialFocus: () => closeRef,
  });

  // Read the live map: a reader who moved "the catalogue" onto another key
  // must be shown the key they chose, not the one the app shipped.
  const stored = (): Readonly<Record<string, string>> => settings.keybindings;

  return (
    <div
      class="nb-cheat-veil"
      data-testid="cheat-sheet"
      onClick={() => props.onClose()}
    >
      <div
        class="nb-cheat-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabindex="-1"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          A way out you can SEE.
          The card was dismissed by clicking the veil or pressing Escape, with a
          footnote saying so — which works and is invisible to anyone who did not
          read the footnote. Top-left, like every other exit in the app (see the
          note on .nb-rail-panel-header in rail.css; tests/top-left-exits.test.ts
          is the gate).
          The card also stops its own clicks now: it sat inside the veil's
          onClick, so clicking a shortcut row to read it closed the sheet.
        */}
        <button
          type="button"
          class="nb-cheat-close"
          aria-label="Close keyboard shortcuts"
          ref={closeRef}
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-cheat-title">keyboard spells</h2>
        {/* The columns are the registry's own groups, laid out by the grid
            rather than split by hand into two lists: adding a shortcut must
            never mean re-balancing this card. */}
        <div class="nb-cheat-columns">
          <For each={SHORTCUT_GROUPS}>
            {(group) => (
              <Show when={rowsFor(group.id, stored()).length > 0}>
                <div class="nb-cheat-column">
                  <h3 class="nb-cheat-heading font-accent">{group.title}</h3>
                  <p class="nb-cheat-where font-ui">{group.blurb}</p>
                  <For each={rowsFor(group.id, stored())}>
                    {(row) => (
                      <div class="nb-cheat-row">
                        <kbd class="nb-cheat-keys">{row.keys}</kbd>
                        <span class="nb-cheat-what">{row.what}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </For>
        </div>
        <p class="nb-cheat-footnote font-label">
          press ? or Esc to close · every key here can be changed in Settings
        </p>
      </div>
    </div>
  );
}

/**
 * Mount ONCE, near the root: owns the shortcut that opens the card and the
 * Escape/`?` that shuts it again.
 *
 * `keyboard-help` is registered here rather than in whichever view happens to
 * be on screen, which is what makes it work on the shelf as well as inside a
 * book. The close key is a plain listener rather than a second command: the
 * card is a dialog, and every dialog in this app closes on its own Escape.
 */
export function CheatSheetHost(): JSX.Element {
  onMount(() => {
    onCleanup(registerCommands({ 'keyboard-help': toggleCheatSheet }));

    // Capture, so ProseMirror cannot eat the Escape while the caret is still
    // in a page behind the veil — the same reasoning as BookView's own
    // pre-guard Escape. Only while the card is actually up.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!open()) return;
      if (event.key === 'Escape' || event.key === '?') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));
  });

  return (
    <Show when={open()}>
      <Portal>
        <CheatSheet onClose={() => setOpen(false)} />
      </Portal>
    </Show>
  );
}
