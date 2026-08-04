/**
 * InsertScriptDialog — the paste target for Notebook Script.
 *
 * Aged-paper modal card: big monospace textarea, live parse (150ms debounce)
 * with friendly line-numbered warnings, a read-only preview of the parsed
 * doc, and Insert / Cancel. "Copy spec for your AI" puts the full spec
 * markdown on the clipboard.
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
import { parse, type Diag, type ScriptDoc } from '../../script';
import { getPage, savePageDoc, setPageScript } from '../../data/pages';
import { usePanelKeys } from '../../state/panelKeys';
import { scriptDocToTiptap } from '../script/toTiptap';
import { NOTEBOOK_SCRIPT_SPEC } from '../script/spec';
import { activeEditor } from './activeEditor';
import ScriptPreview from './ScriptPreview';

export interface InsertScriptDialogProps {
  readonly pageId: string;
  onClose(): void;
  /** Toast hook — called with a short human message after an action. */
  onNotify?(message: string): void;
}

const PARSE_DEBOUNCE_MS = 150;

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

  let textareaElement: HTMLTextAreaElement | undefined;
  let parseTimer: ReturnType<typeof setTimeout> | undefined;

  // Mounted only while it is up (BookView's <Show>). The shelf is not behind
  // this one, but the rule is the rule: every dialog says the keys are its own,
  // so nobody has to work out which scene a dialog can be reached from.
  usePanelKeys();

  const scheduleParse = (value: string): void => {
    if (parseTimer !== undefined) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      setParsed(value.trim() === '' ? null : parse(value));
    }, PARSE_DEBOUNCE_MS);
  };

  onCleanup(() => {
    if (parseTimer !== undefined) clearTimeout(parseTimer);
  });

  const handleInput = (value: string): void => {
    setSource(value);
    scheduleParse(value);
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

  // Escape closes the dialog.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') props.onClose();
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

  const insert = async (): Promise<void> => {
    const text = source();
    if (text.trim() === '' || inserting()) return;
    setInserting(true);
    try {
      const doc = parse(text);
      const editor = activeEditor();
      const json = scriptDocToTiptap(doc, {
        hasNode: (name) => editor?.schema.nodes[name] !== undefined,
      });
      const content = (json.content ?? []) as JSONContent[];
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
          // Inserts at the cursor, replacing the selection if there is one.
          editor.chain().focus().insertContent(content).run();
        }
      } else {
        // No live editor registered — append to the persisted document.
        const page = await getPage(props.pageId);
        if (page !== null) {
          await savePageDoc(props.pageId, {
            ...page.doc,
            content: [...(page.doc.content ?? []), ...content],
          });
        }
      }
      await setPageScript(props.pageId, text);
      props.onNotify?.('script inserted');
      props.onClose();
    } finally {
      setInserting(false);
    }
  };

  return (
    <div
      class="nb-ins-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        class="nb-ins-card"
        role="dialog"
        aria-modal="true"
        aria-label="Insert script"
      >
        {/* A way out you can see — top-left, like every exit in this app. */}
        <button
          type="button"
          class="nb-ins-close"
          aria-label="Close insert script"
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-ins-title">Insert script</h2>
        <p class="nb-ins-hint font-ui">
          paste Notebook Script — from your AI, or your own pen
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

        <div class="nb-ins-actions">
          <button
            type="button"
            class="nb-ins-button nb-ins-button-ghost font-ui"
            onClick={() => void copySpec()}
          >
            Copy spec for your AI
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
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
