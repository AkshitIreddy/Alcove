/**
 * src/features/templates/ExportPdfDialog.tsx — the "Export PDF" scope
 * chooser (roadmap item 23 asks for book *or* page). A small aged-paper
 * card with two hand-drawn choices; picking one runs the matching export
 * from src/editor/script/exporters/exportPage.ts.
 *
 * Standalone: `openExportPdfDialog()` self-mounts into document.body, so the
 * rail wiring stays a single onClick with no host state.
 */
import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import {
  exportActivePagePdf,
  exportOpenBookPdf,
} from '../../editor/script/exporters/exportPage';
import { usePanelKeys } from '../../state/panelKeys';
import '../../styles/insert.css';
import '../../styles/templates.css';

interface ExportPdfDialogProps {
  onClose(): void;
}

export function ExportPdfDialog(props: ExportPdfDialogProps): JSX.Element {
  const [busy, setBusy] = createSignal<'page' | 'book' | null>(null);

  // Mounted only while up (`openExportPdfDialog` disposes the host). Every
  // dialog claims the keyboard, so no reader of this file has to work out which
  // scene it can appear over — see state/panelKeys.ts.
  usePanelKeys();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && busy() === null) props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  const run = async (scope: 'page' | 'book'): Promise<void> => {
    if (busy() !== null) return;
    setBusy(scope);
    // Close first: the whole-book export rasterizes every page offscreen and
    // the overlay would only sit in the way (the toast reports the outcome).
    props.onClose();
    await (scope === 'page' ? exportActivePagePdf() : exportOpenBookPdf());
  };

  return (
    <div
      class="nb-ins-overlay nb-pdf-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && busy() === null) {
          props.onClose();
        }
      }}
    >
      <div
        class="nb-ins-card nb-pdf-card"
        role="dialog"
        aria-modal="true"
        aria-label="Export PDF"
      >
        {/*
          Disabled while a render is running, for the same reason the scrim
          above ignores clicks then: half an export is not a thing to leave
          behind. Not hidden — a control that vanishes reads as a bug, whereas
          a dimmed one reads as "not yet".
        */}
        <button
          type="button"
          class="nb-ins-close"
          aria-label="Close export"
          disabled={busy() !== null}
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-ins-title">Export PDF</h2>
        <p class="nb-ins-hint font-ui">
          print-quality pages, rendered at 2× — pick how much to take
        </p>
        <div class="nb-pdf-choices">
          <button
            type="button"
            class="nb-pdf-choice"
            data-scope="page"
            disabled={busy() !== null}
            onClick={() => void run('page')}
          >
            <svg viewBox="0 0 48 48" class="nb-pdf-choice-art" aria-hidden="true">
              <path
                d="M 12.4 7.6 C 20 6.9 27.6 6.9 35.4 7.7 C 36 18.6 36 29.4 35.5 40.3 C 27.8 41 20.1 41 12.5 40.2 C 11.8 29.4 11.8 18.4 12.4 7.6 Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linejoin="round"
              />
              <path
                d="M 17.6 15.4 C 22.7 14.9 27.8 15 30.6 15.3 M 17.4 21.6 C 22.9 21.1 28.4 21.2 30.8 21.5 M 17.5 27.8 C 21.6 27.4 25.7 27.4 27.4 27.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                opacity="0.7"
              />
            </svg>
            <span class="nb-pdf-choice-label font-ui">this page</span>
          </button>
          <button
            type="button"
            class="nb-pdf-choice"
            data-scope="book"
            disabled={busy() !== null}
            onClick={() => void run('book')}
          >
            <svg viewBox="0 0 48 48" class="nb-pdf-choice-art" aria-hidden="true">
              <path
                d="M 6.6 10.4 C 12.4 8.6 18.2 8.7 23.9 11.4 C 29.6 8.6 35.4 8.5 41.3 10.2 C 41.9 19.8 41.9 29.3 41.2 38.9 C 35.4 37.2 29.6 37.3 23.9 40 C 18.2 37.3 12.4 37.2 6.7 38.8 C 6 29.4 6 19.9 6.6 10.4 Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linejoin="round"
              />
              <path
                d="M 23.9 11.6 C 24 20.7 24 29.8 23.9 39.7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                opacity="0.6"
              />
              <path
                d="M 11.4 17.2 C 15 16.7 18.6 16.8 20.4 17.1 M 11.3 23.4 C 15.2 22.9 19.1 23 20.5 23.3 M 27.6 17.1 C 31.3 16.6 35 16.7 36.8 17 M 27.5 23.3 C 31.5 22.8 35.4 22.9 36.9 23.2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                opacity="0.6"
              />
            </svg>
            <span class="nb-pdf-choice-label font-ui">whole book</span>
          </button>
        </div>
        <Show when={busy() !== null}>
          <p class="nb-ins-hint font-ui">rendering…</p>
        </Show>
      </div>
    </div>
  );
}

let openHost: HTMLElement | null = null;

/** Imperative opener for the rail button (and dev hooks). Idempotent. */
export function openExportPdfDialog(): void {
  if (openHost !== null) return;
  const host = document.createElement('div');
  host.className = 'nb-pdf-host';
  document.body.appendChild(host);
  openHost = host;
  const dispose = render(
    () => (
      <ExportPdfDialog
        onClose={() => {
          dispose();
          host.remove();
          openHost = null;
        }}
      />
    ),
    host,
  );
}
