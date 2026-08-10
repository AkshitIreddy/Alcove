/**
 * src/views/rail/HistoryPanel.tsx — the "time-turner" restore picker
 * (roadmap #13). Lists the page's autosave snapshots (in-memory ring of 20
 * merged with the persisted tail, newest first) with a one-line ink
 * preview; Restore hands the chosen doc back to BookView, which swaps the
 * page and persists.
 */
import { createResource, createSignal, For, Show, type JSX } from 'solid-js';
import {
  historyWordLabel,
  listSnapshots,
  type PageSnapshot,
} from '../../editor/history/pageHistory';
import { countDoc, docPlainText } from '../../editor/wordcount';

export interface HistoryPanelProps {
  pageId: string;
  /** Bumped by BookView whenever the panel opens so the list refreshes. */
  refreshKey: number;
  onRestore(snapshot: PageSnapshot): void;
}

/** "3:41 pm · Jul 30" — cozy, no ISO strings in the UI. */
function snapshotLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${time} · ${day}`;
}

function preview(snapshot: PageSnapshot): string {
  const text = docPlainText(snapshot.doc).replace(/\s+/g, ' ').trim();
  return text.length > 64 ? `${text.slice(0, 64)}…` : text || '(blank page)';
}

export default function HistoryPanel(props: HistoryPanelProps): JSX.Element {
  const [snapshots] = createResource(
    () => ({ pageId: props.pageId, refresh: props.refreshKey }),
    (source) => listSnapshots(source.pageId),
  );
  const [confirming, setConfirming] = createSignal<string | null>(null);

  return (
    <div class="nb-history" data-testid="history-panel">
      <p class="nb-panel-footnote nb-history-hint">
        the notebook remembers this page's last{' '}
        {Math.max(snapshots()?.length ?? 0, 1)} autosaves — turn back time
        below
      </p>
      <Show
        when={(snapshots() ?? []).length > 0}
        fallback={
          <p class="nb-panel-footnote">
            no snapshots yet — they appear as you write
          </p>
        }
      >
        <For each={snapshots()}>
          {(snapshot) => (
            <div class="nb-history-row">
              <div class="nb-history-meta">
                <span class="nb-history-when font-accent">
                  {snapshotLabel(snapshot.at)}
                </span>
                <span class="nb-history-words font-label">
                  {historyWordLabel(countDoc(snapshot.doc).words)}
                </span>
              </div>
              <p class="nb-history-preview">{preview(snapshot)}</p>
              <Show
                when={confirming() === snapshot.at}
                fallback={
                  <button
                    type="button"
                    class="nb-chip nb-history-restore"
                    onClick={() => setConfirming(snapshot.at)}
                  >
                    restore…
                  </button>
                }
              >
                <div class="nb-history-confirm">
                  <button
                    type="button"
                    class="nb-chip nb-history-restore-yes"
                    onClick={() => {
                      setConfirming(null);
                      props.onRestore(snapshot);
                    }}
                  >
                    yes, turn back
                  </button>
                  <button
                    type="button"
                    class="nb-chip nb-chip-ghost"
                    onClick={() => setConfirming(null)}
                  >
                    keep current
                  </button>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
