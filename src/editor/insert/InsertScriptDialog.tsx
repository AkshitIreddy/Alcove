/**
 * InsertScriptDialog — the paste target for Notebook Script.
 *
 * Aged-paper modal card: big monospace textarea, live parse (150ms debounce)
 * with friendly line-numbered warnings, a read-only preview of the parsed
 * doc, and Insert / Cancel. The full format guide can be copied to the
 * clipboard or downloaded as Markdown for an assistant that accepts files.
 *
 * That button used to read "Copy spec for your AI" while the In-and-out sheet's
 * row for the SAME clipboard said "Copy the format for your AI" — two labels,
 * one action, and nothing on either surface to tell a reader they are the same
 * door. The sheet's wording won, on two grounds: "spec" is a word this app does
 * not use anywhere a reader can see it (the rails say *in and out*, *the parcel
 * desk*, *bring Markdown in*), and the README, the front page and the guided
 * tour had all already settled on "the format" — so the odd one out was the one
 * nobody else was quoting.
 *
 * On Insert the parsed ScriptDoc is mapped to editor JSON and inserted at the
 * cursor of the live editor (replacing any selection); the pasted source is
 * stored verbatim via setPageScript so "Export script" can return it
 * byte-identical while the page is unedited.
 */
import type { JSONContent } from '@tiptap/core';
import {
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { For } from 'solid-js';
import type { Diag, ScriptDoc } from '../../script';
import { getPage, setPageScript } from '../../data/pages';
import type { PageDoc } from '../../data/types';
import { usePanelKeys } from '../../state/panelKeys';
import { scriptDocToTiptap } from '../script/toTiptap';
import { parseNotebookScriptPages } from '../script/pageBoundaries';
import { resolveScriptFetches } from '../script/resolveFetches';
import {
  downloadNotebookScriptSpec,
  NOTEBOOK_SCRIPT_SPEC_PASTE_WARNING,
} from '../script/exporters/saveFile';
import { NOTEBOOK_SCRIPT_SPEC } from '../script/spec';
import { getPageEditor } from '../instances';
import ScriptPreview from './ScriptPreview';
import { waitForInsertionMaskPaint } from './insertionPaint';

export interface InsertScriptDialogProps {
  readonly pageId: string;
  onClose(): void;
  /** Toast hook — called with a short human message after an action. */
  onNotify?(message: string): void;
  /** Hold the reader on the spread where a multi-page import began. */
  onInsertionActivity?(active: boolean): void | Promise<void>;
  /** Arm one book-level Ctrl+Z after the import has fully settled. */
  onInsertComplete?(): void;
  onInsertFollowingPages?(
    afterPageId: string,
    pages: readonly {
      source: string;
      doc: PageDoc;
      protectedStart: true;
    }[],
  ): Promise<void>;
}

const PARSE_DEBOUNCE_MS = 150;

type InsertionPhase = 'preparing' | 'resolving' | 'laying-out' | 'checking';

const INSERTION_PHASE_COPY: Record<
  InsertionPhase,
  { readonly title: string; readonly detail: string }
> = {
  preparing: {
    title: 'Opening a place for your notes…',
    detail: 'Reading the script and remembering where this insertion began.',
  },
  resolving: {
    title: 'Gathering the pieces…',
    detail: 'Preparing blocks and any requested picture cards before the pages move.',
  },
  'laying-out': {
    title: 'Laying out the pages…',
    detail: 'Placing each block onto fixed paper. A long notebook can take a moment.',
  },
  checking: {
    title: 'Checking every page…',
    detail: 'Letting headings, cards and page breaks settle before showing the result.',
  },
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function InsertScriptDialog(
  props: InsertScriptDialogProps,
): JSX.Element {
  const [source, setSource] = createSignal('');
  const [parsed, setParsed] = createSignal<ScriptDoc | null>(null);
  const [inserting, setInserting] = createSignal(false);
  const [insertionPhase, setInsertionPhase] =
    createSignal<InsertionPhase>('preparing');

  let textareaElement: HTMLTextAreaElement | undefined;
  let fileElement: HTMLInputElement | undefined;
  let parseTimer: ReturnType<typeof setTimeout> | undefined;

  // Mounted only while it is up (BookView's <Show>). The shelf is not behind
  // this one, but the rule is the rule: every dialog says the keys are its own,
  // so nobody has to work out which scene a dialog can be reached from.
  usePanelKeys();

  const scheduleParse = (value: string): void => {
    if (parseTimer !== undefined) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      setParsed(
        value.trim() === '' ? null : parseNotebookScriptPages(value).preview,
      );
    }, PARSE_DEBOUNCE_MS);
  };

  onCleanup(() => {
    if (parseTimer !== undefined) clearTimeout(parseTimer);
  });

  const handleInput = (value: string): void => {
    setSource(value);
    scheduleParse(value);
  };

  const loadFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      handleInput(await file.text());
      props.onNotify?.(`${file.name} loaded`);
    } catch {
      props.onNotify?.('could not read that Markdown file');
    }
  };

  /**
   * Warnings, in source order, positioned by the PARSER rather than by a
   * re-scan here: `parse()` locates every diagnostic (script/diagnostics.ts
   * `locateDiags`), so line AND column are already exact, and a second scan
   * over the textarea could only disagree with it. `expected` is appended when
   * the parser knows what it wanted — that is the half that turns "unknown
   * value" into something a writer can act on.
   */
  const warnings = createMemo(
    (): Array<{ where: string; message: string }> =>
      (parsed()?.diagnostics ?? []).map((diag: Diag) => ({
        where: `line ${diag.line}:${diag.column}`,
        message:
          diag.expected === undefined
            ? diag.message
            : `${diag.message} — expected ${diag.expected}`,
      })),
  );
  const warningClipboardText = createMemo(() =>
    warnings()
      .map((warning) => `**${warning.where}** ${warning.message}`)
      .join('\n'),
  );

  // Escape closes the dialog.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !inserting()) props.onClose();
  };
  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    textareaElement?.focus();
  });
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));

  const copySpec = async (): Promise<void> => {
    const ok = await copyToClipboard(NOTEBOOK_SCRIPT_SPEC);
    props.onNotify?.(
      ok ? 'spec copied — paste it to your AI' : 'could not reach the clipboard',
    );
  };

  const downloadSpec = async (): Promise<void> => {
    const outcome = await downloadNotebookScriptSpec(NOTEBOOK_SCRIPT_SPEC);
    if (outcome === 'saved') {
      props.onNotify?.('format guide saved — attach it to your AI');
    } else if (outcome === 'failed') {
      props.onNotify?.('could not save the format guide');
    }
  };

  const copyWarnings = async (): Promise<void> => {
    const ok = await copyToClipboard(warningClipboardText());
    props.onNotify?.(
      ok ? 'script errors copied' : 'could not reach the clipboard',
    );
  };

  const insert = async (): Promise<void> => {
    const text = source();
    if (text.trim() === '' || inserting()) return;
    setInsertionPhase('preparing');
    setInserting(true);
    let viewLockReleased = false;
    try {
      // The editor insertion and pagination dispatch below are synchronous.
      // Commit an opaque, reassuring state first so WebView2 never has to
      // paint a half-remounted dialog or a transient blank book underneath.
      await waitForInsertionMaskPaint();
      await props.onInsertionActivity?.(true);
      const parsedPages = parseNotebookScriptPages(text);
      setInsertionPhase('resolving');
      // Image search is asynchronous and environment-owned. Resolve it once
      // before constructing any page JSON; in browser/offline development the
      // resolver deliberately returns clickable upload cards instead of
      // printing a literal `fetch:` request into the note.
      const resolvedDocs = await Promise.all(
        parsedPages.pages.map((page) => resolveScriptFetches(page.doc)),
      );
      const firstPage = parsedPages.pages[0];
      const firstSource = firstPage?.source ?? '';
      const doc = resolvedDocs[0] ?? parsedPages.preview;
      /*
       * The dialog belongs to one PAGE, not to whichever of the two mounted
       * editors happened to focus last.
       *
       * A spread mounts both PageEditors. Their construction effects used to
       * make the right editor the global `activeEditor` even after BookView
       * had correctly chosen the blank left leaf for this dialog. Importing a
       * script therefore wrote its visible document into the right page while
       * storing the source provenance against `props.pageId` on the left — two
       * different pages from one click. Address the editor through the same
       * page id the dialog and persistence path already use.
       */
      const schemaEditor = getPageEditor(props.pageId);
      const following = parsedPages.pages.slice(1).map((page, index) => {
        const pageDoc = scriptDocToTiptap(resolvedDocs[index + 1] ?? page.doc, {
          hasNode: (name) => schemaEditor?.schema.nodes[name] !== undefined,
        }) as PageDoc;
        return {
          source: page.source,
          doc: pageDoc,
          protectedStart: true as const,
        };
      });
      /*
       * Establish protected destinations BEFORE the first live-editor
       * dispatch. A large first section can synchronously request pagination;
       * if its following pages do not exist yet, that overflow is appended to
       * the tail and becomes the mysterious mostly-empty final page. BookView
       * also reuses the fresh book's blank leaves here.
       */
      setInsertionPhase('laying-out');
      await waitForInsertionMaskPaint();
      if (following.length > 0) {
        await props.onInsertFollowingPages?.(props.pageId, following);
      }
      // BookView may have refreshed the page list while creating/reusing those
      // destinations, so reacquire the page-owned editor after the await.
      const editor = getPageEditor(props.pageId);
      const json = scriptDocToTiptap(doc, {
        hasNode: (name) => editor?.schema.nodes[name] !== undefined,
      });
      const content = (json.content ?? []) as JSONContent[];
      let insertedDoc: PageDoc | undefined;
      if (editor !== null) {
        // Frontmatter paper style applies to the whole page.
        const pageStyle = (json.attrs as Record<string, unknown> | undefined)
          ?.pageStyle;
        if (typeof pageStyle === 'string') {
          editor.view.dispatch(
            editor.state.tr.setDocAttribute('pageStyle', pageStyle),
          );
        }
        if (content.length > 0) {
          /*
           * Keep the caret at the BEGINNING of the inserted notebook.
           *
           * TipTap's default `insertContent` moves the selection to the tail.
           * Pagination is synchronous, so a long import then sees that caret
           * inside the blocks it is peeling off the first leaf and quite
           * correctly follows it onto the next spread. The document landed in
           * the right place, but the reader appeared to be thrown to page 3.
           * One transaction with `updateSelection:false` makes the import an
           * atomic paste whose reading position stays where the paste began.
           */
          const insertionStart = editor.state.selection.from;
          editor
            .chain()
            .insertContent(content, { updateSelection: false })
            .setTextSelection(insertionStart)
            .run();
        }
        // TipTap dispatch is synchronous, including appended plugin
        // transactions. This is the final snapshot its PageEditor debounce
        // has just queued.
        insertedDoc = editor.getJSON() as PageDoc;
      } else {
        // No live editor registered — append to the persisted document.
        const page = await getPage(props.pageId);
        if (page !== null) {
          insertedDoc = {
            ...page.doc,
            content: [...(page.doc.content ?? []), ...content],
          };
        }
      }
      await setPageScript(props.pageId, firstSource, insertedDoc);
      setInsertionPhase('checking');
      await waitForInsertionMaskPaint();
      await props.onInsertionActivity?.(false);
      viewLockReleased = true;
      props.onNotify?.(
        following.length > 0
          ? `script inserted across ${following.length + 1} pages`
          : 'script inserted',
      );
      props.onInsertComplete?.();
      props.onClose();
    } finally {
      if (!viewLockReleased) await props.onInsertionActivity?.(false);
      setInserting(false);
    }
  };

  return (
    <div
      class="nb-ins-overlay"
      classList={{ 'is-inserting': inserting() }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !inserting()) props.onClose();
      }}
    >
      <div
        class="nb-ins-card"
        classList={{ 'is-inserting': inserting() }}
        role="dialog"
        aria-modal="true"
        aria-label="Insert script"
        aria-busy={inserting()}
      >
        <div class="nb-ins-content" inert={inserting()}>
          {/* A way out you can see — top-left, like every exit in this app. */}
          <button
            type="button"
            class="nb-ins-close"
            aria-label="Close insert script"
            disabled={inserting()}
            onClick={() => props.onClose()}
          >
            ×
          </button>
          <h2 class="nb-ins-title">Insert script</h2>
          <p class="nb-ins-hint font-ui">
            open the .md from your AI, or paste Notebook Script from your own pen
          </p>

          <input
            ref={fileElement}
            class="nb-ins-file-input"
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={(event) => {
              void loadFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />

          <p class="nb-ins-spec-note font-ui" role="note">
            {NOTEBOOK_SCRIPT_SPEC_PASTE_WARNING}
          </p>

          <div class="nb-ins-body">
          <div class="nb-ins-left">
            <textarea
              ref={textareaElement}
              class="nb-ins-textarea"
              spellcheck={false}
              placeholder={'# A heading\n\nSome **notes**…\n\n::: sticky-note\nhello!\n:::'}
              value={source()}
              onInput={(event) => handleInput(event.currentTarget.value)}
            />
            <Show when={warnings().length > 0}>
              <div class="nb-ins-warning-panel">
                <div class="nb-ins-warning-toolbar font-ui">
                  <span>{warnings().length} script {warnings().length === 1 ? 'warning' : 'warnings'}</span>
                  <button
                    type="button"
                    class="nb-ins-copy-warnings font-ui"
                    aria-label="Copy script errors"
                    title="Copy script errors"
                    onClick={() => void copyWarnings()}
                  >
                    <span aria-hidden="true">⧉</span>
                    Copy errors
                  </button>
                </div>
                <ul class="nb-ins-warnings font-ui" aria-label="Parse warnings">
                  <For each={warnings()}>
                    {(warning) => (
                      <li>
                        <span class="nb-ins-warn-line">{warning.where}</span>{' '}
                        {warning.message}
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          </div>

          <div class="nb-ins-preview" aria-label="Preview">
            <Show
              when={parsed()}
              fallback={
                <p class="nb-ins-preview-empty font-ui">
                  the preview appears here as you paste
                </p>
              }
              keyed
            >
              {(doc) => <ScriptPreview doc={doc} />}
            </Show>
          </div>
          </div>

          <div class="nb-ins-actions nb-ins-spec-actions">
          <button
            type="button"
            class="nb-ins-button nb-ins-button-primary font-ui"
            onClick={() => fileElement?.click()}
          >
            Open AI .md
          </button>
          <button
            type="button"
            class="nb-ins-button nb-ins-button-ghost font-ui"
            onClick={() => void downloadSpec()}
          >
            Download the format for your AI
          </button>
          <button
            type="button"
            class="nb-ins-button nb-ins-button-ghost font-ui"
            onClick={() => void copySpec()}
          >
            Copy the format for your AI
          </button>
          <span class="nb-ins-spacer" />
          <button
            type="button"
            class="nb-ins-button font-ui"
            onClick={() => props.onClose()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="nb-ins-button nb-ins-button-primary font-ui"
            disabled={source().trim() === '' || inserting()}
            onClick={() => void insert()}
          >
            {inserting() ? 'Laying out pages…' : 'Insert'}
          </button>
          </div>
        </div>

        <Show when={inserting()}>
          <section
            class="nb-ins-progress"
            data-phase={insertionPhase()}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div class="nb-ins-progress-book" aria-hidden="true">
              <span class="nb-ins-progress-cover" />
              <span class="nb-ins-progress-pages"><i /><i /><i /></span>
              <span class="nb-ins-progress-ribbon" />
            </div>
            <span class="nb-ins-progress-kicker font-ui">Notebook Script</span>
            <h3>{INSERTION_PHASE_COPY[insertionPhase()].title}</h3>
            <p class="font-ui">{INSERTION_PHASE_COPY[insertionPhase()].detail}</p>
            <ol class="nb-ins-progress-steps font-ui" aria-hidden="true">
              <li classList={{ 'is-current': insertionPhase() === 'preparing', 'is-done': insertionPhase() !== 'preparing' }}>Read</li>
              <li classList={{ 'is-current': insertionPhase() === 'resolving', 'is-done': insertionPhase() === 'laying-out' || insertionPhase() === 'checking' }}>Prepare</li>
              <li classList={{ 'is-current': insertionPhase() === 'laying-out', 'is-done': insertionPhase() === 'checking' }}>Place</li>
              <li classList={{ 'is-current': insertionPhase() === 'checking' }}>Check</li>
            </ol>
          </section>
        </Show>
      </div>
    </div>
  );
}
