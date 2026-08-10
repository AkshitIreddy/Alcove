/** A hand-drawn, focus-trapped update offer for one signed Tauri release. */
import { For, Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { load as loadSettings, save as saveSettings, settings } from '../../data/settings';
import { usePanelKeys } from '../../state/panelKeys';
import {
  parseUpdateNotes,
  type UpdateNoteBlock,
  type UpdateNoteInline,
} from './updateNotes';
import '../../styles/insert.css';
import '../../styles/updater.css';

type Phase =
  | { kind: 'offer' }
  | { kind: 'downloading'; done: number; total: number | null }
  | { kind: 'installing' }
  | { kind: 'restarting' }
  | { kind: 'error'; message: string };

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface UpdateDialogProps {
  readonly update: Update;
  onClose(): void;
}

function openReleaseLink(event: MouseEvent, href: string): void {
  event.preventDefault();
  void import('@tauri-apps/plugin-opener')
    .then(({ openUrl }) => openUrl(href))
    .catch(() => {
      window.open(href, '_blank', 'noopener,noreferrer');
    });
}

function NoteInline(props: { readonly parts: readonly UpdateNoteInline[] }): JSX.Element {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={part.text}>
          <Match when={part.kind === 'strong'}><strong>{part.text}</strong></Match>
          <Match when={part.kind === 'em'}><em>{part.text}</em></Match>
          <Match when={part.kind === 'code'}><code>{part.text}</code></Match>
          <Match when={part.kind === 'link'}>
            <a
              href={(part as Extract<UpdateNoteInline, { kind: 'link' }>).href}
              classList={{
                'is-strong':
                  (part as Extract<UpdateNoteInline, { kind: 'link' }>).strong === true,
              }}
              onClick={(event) =>
                openReleaseLink(
                  event,
                  (part as Extract<UpdateNoteInline, { kind: 'link' }>).href,
                )
              }
            >
              {part.text}
            </a>
          </Match>
        </Switch>
      )}
    </For>
  );
}

function NoteBlock(props: { readonly block: UpdateNoteBlock }): JSX.Element {
  const block = props.block;
  if (block.kind === 'heading') {
    return block.level === 2
      ? <h3><NoteInline parts={block.content} /></h3>
      : <h4><NoteInline parts={block.content} /></h4>;
  }
  if (block.kind === 'list') {
    const items = <For each={block.items}>{(item) => <li><NoteInline parts={item} /></li>}</For>;
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  return <p><NoteInline parts={block.content} /></p>;
}

function releaseDate(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function UpdateDialog(props: UpdateDialogProps): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>({ kind: 'offer' });
  let cardRef: HTMLDivElement | undefined;
  let closeRef: HTMLButtonElement | undefined;

  usePanelKeys();

  const busy = (): boolean => {
    const kind = phase().kind;
    return kind === 'downloading' || kind === 'installing' || kind === 'restarting';
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !busy()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      props.onClose();
      return;
    }
    if (event.key !== 'Tab' || cardRef === undefined) return;
    const focusable = Array.from(cardRef.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      cardRef.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  onMount(() => {
    // The updater can appear before App's ordinary settings hydration finishes.
    // Load the persisted choice before presenting this destructive option.
    void loadSettings();
    closeRef?.focus();
    window.addEventListener('keydown', onKeyDown, true);
  });
  onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));

  const notes = parseUpdateNotes(props.update.body);

  const progressPct = (): number | null => {
    const current = phase();
    if (current.kind !== 'downloading' || current.total === null || current.total <= 0) {
      return null;
    }
    return Math.min(100, Math.round((current.done / current.total) * 100));
  };

  const install = async (): Promise<void> => {
    if (busy()) return;
    setPhase({ kind: 'downloading', done: 0, total: null });
    try {
      await props.update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setPhase({
            kind: 'downloading',
            done: 0,
            total: event.data.contentLength ?? null,
          });
        } else if (event.event === 'Progress') {
          setPhase((current) =>
            current.kind === 'downloading'
              ? {
                  ...current,
                  done: current.done + event.data.chunkLength,
                }
              : current,
          );
        } else if (event.event === 'Finished') {
          setPhase({ kind: 'installing' });
        }
      });
      setPhase({ kind: 'restarting' });
      await relaunch();
    } catch (error) {
      setPhase({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The update could not finish. Your current Alcove is unchanged.',
      });
    }
  };

  const date = () => releaseDate(props.update.date);

  return (
    <div
      class="nb-ins-overlay nb-update-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy()) props.onClose();
      }}
    >
      <div
        ref={cardRef}
        class="nb-ins-card nb-update-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-update-title"
        aria-describedby="nb-update-notes"
        aria-busy={busy()}
        tabindex="-1"
      >
        <button
          ref={closeRef}
          type="button"
          class="nb-ins-close"
          aria-label="Close update"
          disabled={busy()}
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 id="nb-update-title" class="nb-ins-title">A new Alcove is ready</h2>
        <p class="nb-ins-hint font-ui">
          version {props.update.version}
          <Show when={date()}>{(shown) => <> · {shown()}</>}</Show>
        </p>

        <div class="nb-ins-body nb-update-body">
          <div id="nb-update-notes" class="nb-update-notes">
            <For each={notes}>{(block) => <NoteBlock block={block} />}</For>
          </div>

          <Show when={!busy()}>
            <label class="nb-update-welcome font-ui">
              <input
                type="checkbox"
                checked={settings.refreshWelcomeBookOnUpdate}
                onChange={(event) => void saveSettings({
                  refreshWelcomeBookOnUpdate: event.currentTarget.checked,
                })}
              />
              <span>
                <strong>Keep the Welcome book current</strong>
                <small>
                  Replace its pages and binding with the newest guide, even if you edited them.
                </small>
              </span>
            </label>
          </Show>

          <Show when={busy()}>
            <div
              class="nb-update-progress"
              role="progressbar"
              aria-label="Update progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={progressPct() ?? undefined}
            >
              <div
                class="nb-update-progress-fill"
                classList={{ 'is-indeterminate': progressPct() === null }}
                style={{ width: `${progressPct() ?? 18}%` }}
              />
            </div>
            <p class="nb-update-progress-label font-ui" aria-live="polite">
              {phase().kind === 'downloading'
                ? 'Bringing the new edition down…'
                : phase().kind === 'installing'
                  ? 'Putting it on the shelf…'
                  : 'Opening the new edition…'}
            </p>
          </Show>

          <Show when={phase().kind === 'error'}>
            <p class="nb-update-error font-ui" role="alert">
              {(phase() as Extract<Phase, { kind: 'error' }>).message}
            </p>
          </Show>
        </div>

        <Show when={!busy()}>
          <div class="nb-ins-actions nb-update-actions">
            <span class="nb-ins-spacer" />
            <button type="button" class="nb-ins-button font-ui" onClick={props.onClose}>
              Not now
            </button>
            <button
              type="button"
              class="nb-ins-button nb-ins-button-primary font-ui"
              onClick={() => void install()}
            >
              {phase().kind === 'error' ? 'Try again' : 'Update now'}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

let openHost: HTMLElement | null = null;

/** Imperative singleton opener used by the background checker. */
export function openUpdateDialog(update: Update): void {
  if (openHost !== null) {
    void update.close().catch(() => {});
    return;
  }
  const opener = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const host = document.createElement('div');
  host.className = 'nb-update-host';
  document.body.appendChild(host);
  openHost = host;
  let closing = false;
  let dispose: () => void = () => {};
  const close = (): void => {
    if (closing) return;
    closing = true;
    dispose();
    host.remove();
    openHost = null;
    void update.close().catch(() => {});
    opener?.focus();
  };
  dispose = render(() => <UpdateDialog update={update} onClose={close} />, host);
}
