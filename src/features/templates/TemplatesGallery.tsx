/**
 * src/features/templates/TemplatesGallery.tsx — "+ from template" gallery
 * (roadmap item 26). Aged-paper overlay with one preview card per template
 * (live ScriptPreview of the parsed template, scaled down), each offering
 * "new book" (creates + opens a shelved book) and "add pages here" (appends
 * the template's pages to the open book).
 *
 * Standalone: `openTemplatesGallery()` self-mounts into document.body so the
 * rail wiring is a single onClick — no host state needed in BookView.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { render } from 'solid-js/web';
import { parse } from '../../script';
import ScriptPreview from '../../editor/insert/ScriptPreview';
import { appState } from '../../state/app';
import { usePanelKeys } from '../../state/panelKeys';
import { editorState } from '../../editor/state';
import { notify } from '../../editor/script/exporters/toast';
import { play } from '../../sound/engine';
import {
  appendScriptPagesToBook,
  createBookFromScript,
} from './createFromScript';
import { NOTEBOOK_TEMPLATES, type NotebookTemplate } from './templates';
import '../../styles/insert.css';
import '../../styles/templates.css';

/** Force BookView's session resource to reload the (possibly same) book. */
function reopenBook(bookId: string): void {
  editorState.setOpenBookId(null);
  queueMicrotask(() => {
    editorState.setOpenBookId(bookId);
    appState.openBook(bookId);
  });
}

interface TemplatesGalleryProps {
  onClose(): void;
}

function TemplateCard(props: {
  template: NotebookTemplate;
  busy: boolean;
  canInsertHere: boolean;
  onNewBook(template: NotebookTemplate): void;
  onInsertHere(template: NotebookTemplate): void;
}): JSX.Element {
  const parsed = createMemo(() => parse(props.template.script));
  return (
    <article class="nb-tpl-card" data-template={props.template.id}>
      <div class="nb-tpl-preview" aria-hidden="true">
        <div class="nb-tpl-preview-scale">
          <ScriptPreview doc={parsed()} />
        </div>
      </div>
      <h3 class="nb-tpl-name">{props.template.name}</h3>
      <p class="nb-tpl-blurb font-ui">{props.template.blurb}</p>
      <div class="nb-tpl-actions">
        <button
          type="button"
          class="nb-ins-button nb-ins-button-primary font-ui"
          disabled={props.busy}
          onClick={() => props.onNewBook(props.template)}
        >
          new book
        </button>
        <Show when={props.canInsertHere}>
          <button
            type="button"
            class="nb-ins-button font-ui"
            disabled={props.busy}
            onClick={() => props.onInsertHere(props.template)}
          >
            add pages here
          </button>
        </Show>
      </div>
    </article>
  );
}

export function TemplatesGallery(props: TemplatesGalleryProps): JSX.Element {
  const [busy, setBusy] = createSignal(false);

  const canInsertHere = (): boolean =>
    appState.viewState() === 'book' && editorState.openBookId() !== null;

  // The gallery opens from the shelf's dock, over a live bookcase whose arrows
  // and Enter are bound on `document`. Without this the card's own keyboard was
  // shared with the shelf underneath it — see state/panelKeys.ts.
  usePanelKeys();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  const newBook = async (template: NotebookTemplate): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const { book } = await createBookFromScript(
        template.script,
        template.name,
      );
      void play('pop-soft');
      notify(`“${book.title}” added to the shelf`);
      props.onClose();
      reopenBook(book.id);
    } catch {
      notify('could not create the book');
    } finally {
      setBusy(false);
    }
  };

  const insertHere = async (template: NotebookTemplate): Promise<void> => {
    const bookId = editorState.openBookId();
    if (busy() || bookId === null) return;
    setBusy(true);
    try {
      const pages = await appendScriptPagesToBook(bookId, template.script);
      void play('pop-soft');
      notify(
        `${pages.length} ${template.name} page${pages.length === 1 ? '' : 's'} added`,
      );
      props.onClose();
      reopenBook(bookId);
    } catch {
      notify('could not add the template');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      class="nb-ins-overlay nb-tpl-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="nb-ins-card nb-tpl-gallery"
        role="dialog"
        aria-modal="true"
        aria-label="Start from a template"
      >
        {/*
          Moved here from a "Close" at the bottom-right of the card. That put
          the only visible exit in the wrong corner AND under a grid that
          scrolls, so on a short window it was below the fold too.
        */}
        <button
          type="button"
          class="nb-ins-close"
          aria-label="Close templates"
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-ins-title">Start from a template</h2>
        <p class="nb-ins-hint font-ui">
          five hand-drawn starting points — each becomes real, editable pages
        </p>
        <div class="nb-tpl-grid">
          <For each={NOTEBOOK_TEMPLATES}>
            {(template) => (
              <TemplateCard
                template={template}
                busy={busy()}
                canInsertHere={canInsertHere()}
                onNewBook={(t) => void newBook(t)}
                onInsertHere={(t) => void insertHere(t)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

let openHost: HTMLElement | null = null;

/** Imperative opener for the rail button (and dev hooks). Idempotent. */
export function openTemplatesGallery(): void {
  if (openHost !== null) return;
  const host = document.createElement('div');
  host.className = 'nb-tpl-host';
  document.body.appendChild(host);
  openHost = host;
  const dispose = render(
    () => (
      <TemplatesGallery
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
