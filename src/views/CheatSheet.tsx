/**
 * src/views/CheatSheet.tsx — the `?` keyboard cheat-sheet (roadmap #14):
 * a hand-drawn two-column paper card listing every shortcut, opened by
 * pressing `?` anywhere outside a text field (BookView owns the key
 * handling). Click anywhere, Escape or `?` again closes it.
 */
import { For, type JSX } from 'solid-js';

interface ShortcutRow {
  readonly keys: string;
  readonly what: string;
}

interface ShortcutColumn {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

const COLUMNS: readonly ShortcutColumn[] = [
  {
    title: 'Around the book',
    rows: [
      { keys: '← →', what: 'turn the page' },
      { keys: 'F9', what: 'focus mode on/off' },
      { keys: 'Esc', what: 'close panels & overlays' },
      { keys: '?', what: 'this cheat-sheet' },
      { keys: 'drag page edge', what: 'curl a page by hand' },
      { keys: 'click corner curl', what: 'flip forward' },
    ],
  },
  {
    title: 'While writing',
    rows: [
      { keys: '/', what: 'block & sticker menu' },
      { keys: '/today', what: "today's journal page" },
      { keys: 'Ctrl B / I', what: 'bold / italic ink' },
      { keys: 'right-click', what: 'block menu (turn into, washes…)' },
      { keys: 'drag the dots', what: 'reorder lines' },
      { keys: 'click below ink', what: 'start a fresh line' },
    ],
  },
];

export interface CheatSheetProps {
  onClose(): void;
}

export default function CheatSheet(props: CheatSheetProps): JSX.Element {
  return (
    <div
      class="nb-cheat-veil"
      data-testid="cheat-sheet"
      onClick={() => props.onClose()}
    >
      <div
        class="nb-cheat-card"
        role="dialog"
        aria-label="Keyboard shortcuts"
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
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-cheat-title">keyboard spells</h2>
        <div class="nb-cheat-columns">
          <For each={COLUMNS}>
            {(column) => (
              <div class="nb-cheat-column">
                <h3 class="nb-cheat-heading font-accent">{column.title}</h3>
                <For each={column.rows}>
                  {(row) => (
                    <div class="nb-cheat-row">
                      <kbd class="nb-cheat-keys">{row.keys}</kbd>
                      <span class="nb-cheat-what">{row.what}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <p class="nb-cheat-footnote font-label">press ? or Esc to close</p>
      </div>
    </div>
  );
}
