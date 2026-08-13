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
  setPageSnapshotProtected,
  type PageSnapshot,
} from '../../editor/history/pageHistory';
import {
  listBookCheckpoints,
  setBookCheckpointProtected,
  type BookRecoverySnapshot,
} from '../../editor/history/bookHistory';
import { countDoc, docPlainText } from '../../editor/wordcount';

export interface HistoryPanelProps {
  pageId: string;
  bookId: string;
  /** Bumped by BookView whenever the panel opens so the list refreshes. */
  refreshKey: number;
  onRestore(snapshot: PageSnapshot): void;
  onRestoreBook(snapshot: BookRecoverySnapshot): void;
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
  const [scope, setScope] = createSignal<'page' | 'book'>('page');
  const [snapshots, { refetch: refetchPages }] = createResource(
    () => ({ pageId: props.pageId, refresh: props.refreshKey }),
    (source) => listSnapshots(source.pageId),
  );
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const [bookSnapshots, { refetch: refetchBook }] = createResource(
    () => ({ bookId: props.bookId, refresh: props.refreshKey }),
    (source) => listBookCheckpoints(source.bookId),
  );

  return (
    <div class="nb-history" data-testid="history-panel">
      <div class="nb-history-scope" role="tablist" aria-label="History scope">
        <button type="button" role="tab" aria-selected={scope() === 'page'} onClick={() => setScope('page')}>this page</button>
        <button type="button" role="tab" aria-selected={scope() === 'book'} onClick={() => setScope('book')}>whole book</button>
      </div>
      <Show when={scope() === 'page'}>
        <p class="nb-panel-footnote nb-history-hint">
          dense recent autosaves plus protected older recovery points
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
              <button
                type="button"
                class="nb-chip nb-chip-ghost nb-history-protect"
                aria-pressed={snapshot.protected === true}
                onClick={() => void setPageSnapshotProtected(
                  props.pageId,
                  snapshot.at,
                  snapshot.protected !== true,
                ).then(() => refetchPages())}
              >
                {snapshot.protected === true ? 'protected' : 'protect this'}
              </button>
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
      </Show>
      <Show when={scope() === 'book'}>
        <p class="nb-panel-footnote nb-history-hint">
          full notebook checkpoints preserve page order, deletions and content
        </p>
        <Show when={(bookSnapshots() ?? []).length > 0} fallback={<p class="nb-panel-footnote">the first protected checkpoint appears as you write</p>}>
          <For each={bookSnapshots()}>
            {(snapshot) => (
              <div class="nb-history-row">
                <div class="nb-history-meta">
                  <span class="nb-history-when font-accent">{snapshotLabel(snapshot.at)}</span>
                  <span class="nb-history-words font-label">{snapshot.pages.length} {snapshot.pages.length === 1 ? 'page' : 'pages'}</span>
                </div>
                <p class="nb-history-preview">whole-book recovery point</p>
                <button
                  type="button"
                  class="nb-chip nb-chip-ghost nb-history-protect"
                  aria-pressed={snapshot.protected === true}
                  onClick={() => void setBookCheckpointProtected(
                    props.bookId,
                    snapshot.at,
                    snapshot.protected !== true,
                  ).then(() => refetchBook())}
                >
                  {snapshot.protected === true ? 'protected' : 'protect this'}
                </button>
                <Show when={confirming() === `book:${snapshot.at}`} fallback={
                  <button type="button" class="nb-chip nb-history-restore" onClick={() => setConfirming(`book:${snapshot.at}`)}>restore book…</button>
                }>
                  <div class="nb-history-confirm">
                    <button type="button" class="nb-chip nb-history-restore-yes" onClick={() => { setConfirming(null); props.onRestoreBook(snapshot); }}>yes, restore all pages</button>
                    <button type="button" class="nb-chip nb-chip-ghost" onClick={() => setConfirming(null)}>keep current</button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
