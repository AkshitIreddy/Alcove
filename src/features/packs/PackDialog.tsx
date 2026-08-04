/**
 * src/features/packs/PackDialog.tsx — the popup the reader asked for, in the
 * three parts they asked for.
 *
 *   "when uploading for category it will open a popup with upload button
 *    information on how to do it along with a custom ai prompt they give to an
 *    ai that will tell it the specifications of how to build and package it
 *    for the user to upload it here"
 *
 *   1. an upload button          — top left of the card, first thing you meet
 *   2. information on how to do it — numbered, human, no model involved
 *   3. a custom AI prompt        — copyable, GENERATED from the schema
 *
 * Part 3 is the one with a trap in it, and `prompt.ts` is where the trap is
 * sprung: a hand-written prompt describing a format the importer does not
 * accept is worse than no prompt at all, because the reader does the work,
 * pastes the result and is told it is wrong by the app that told them what to
 * write. Everything here is derived.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS A PASTE BOX AS WELL AS A FILE BUTTON
 * ─────────────────────────────────────────────────────────────────────────
 * Because of where the file comes from. A reader who has just been handed
 * JSON in a chat window has it on the clipboard; telling them to save it as a
 * file first is asking them to open a file manager to move data six inches.
 * Both routes end in the same validator, so there is one thing to be right
 * about and two ways in.
 *
 * It is also the only route an automated check can drive: a native file
 * dialog cannot be answered by Playwright, and a feature whose entire entry
 * point is unreachable from a probe is a feature that gets verified by
 * looking at it and hoping.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REFUSAL IS A SCREEN, NOT A TOAST
 * ─────────────────────────────────────────────────────────────────────────
 * The brief: "Validate on import and say plainly what was wrong when
 * something fails." Problems come back with a place and a sentence, and they
 * are shown as a list in the card, where they can be read twice and compared
 * against the file — not as a toast that is gone in four seconds while the
 * reader is still looking for their text editor.
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
import { usePanelKeys } from '../../state/panelKeys';
import { PACK_CATEGORIES, UNSUPPORTED_CATEGORIES, packCategory } from './categories';
import { promptForCategory } from './prompt';
import type { PackCategory, PackCategoryId, PackProblem } from './schema';
import { fieldSummary } from './schema';
import { validatePackText } from './validate';
import { installPack, type InstallReport } from './store';
import {
  importSoundFolder,
  importStickerImages,
  looksLikeManifest,
  pickPackFile,
} from './intake';
import '../../styles/insert.css';
import '../../styles/packs.css';

/* -------------------------------------------------------------------------- */

type Outcome =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'refused'; problems: readonly PackProblem[]; fileName: string }
  | { kind: 'done'; lines: readonly string[]; notes: readonly string[] };

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** What an install turned into, in the reader's words rather than in counts. */
function describeInstall(category: PackCategory, report: InstallReport): string[] {
  const lines: string[] = [];
  if (report.pack !== null) {
    lines.push(
      report.installed === 1
        ? `“${report.pack.name}” is in — one ${category.noun}.`
        : `“${report.pack.name}” is in — ${report.installed} ${category.plural}.`,
    );
    switch (category.id) {
      case 'wallpaper':
        lines.push('They are under “yours” in the studio’s wallpaper row. Press one to hang it.');
        break;
      case 'carpentry':
        lines.push('They are under “yours” in the studio’s bookcase row.');
        break;
      case 'sticker':
        lines.push('They are in the catalogue under “your stickers”, and in script as {sticker=user:name}.');
        break;
      default:
        break;
    }
  }
  lines.push(...report.warnings);
  return lines;
}

export interface PackDialogProps {
  readonly initial: PackCategoryId;
  onClose(): void;
}

export function PackDialog(props: PackDialogProps): JSX.Element {
  const [categoryId, setCategoryId] = createSignal<PackCategoryId>(props.initial);
  const [outcome, setOutcome] = createSignal<Outcome>({ kind: 'idle' });
  const [pasted, setPasted] = createSignal('');
  const [showPrompt, setShowPrompt] = createSignal(true);
  const [copied, setCopied] = createSignal(false);

  const category = createMemo<PackCategory>(
    () => packCategory(categoryId()) ?? PACK_CATEGORIES[0]!,
  );
  const prompt = createMemo(() => promptForCategory(category()));
  const busy = (): boolean => outcome().kind === 'busy';

  // `openPackDialog` tears the host down on close, so being mounted IS being
  // open. The shelf is live behind this popup and binds arrows on `document`.
  usePanelKeys();

  /*
   * CAPTURE-phase on `document`, and it stops the event dead.
   *
   * `RailPanel` closes the whole studio sheet on Escape from a bubble-phase
   * listener on `window`, so a plain listener here closed BOTH: the popup and
   * the panel that opened it, leaving the reader back on the shelf wondering
   * where their wallpaper row went. `ShelfMenu.MenuCard` had already solved
   * this exactly once — stopping propagation during capture means the
   * bubble-phase listeners never run — and this is the same shape.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || busy()) return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onKeyDown, true));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown, true));

  const switchTo = (id: PackCategoryId): void => {
    if (busy() || id === categoryId()) return;
    setCategoryId(id);
    setOutcome({ kind: 'idle' });
    setPasted('');
    setCopied(false);
  };

  /* ----------------------------- importing ------------------------------ */

  const ingest = async (fileName: string, text: string): Promise<void> => {
    const current = category();
    const checked = validatePackText(text, current, packCategory);
    if (!checked.ok) {
      setOutcome({ kind: 'refused', problems: checked.problems, fileName });
      return;
    }
    const report = await installPack(checked.pack);
    if (report.refusal !== null) {
      setOutcome({
        kind: 'refused',
        problems: [{ where: 'the pack', message: report.refusal }],
        fileName,
      });
      return;
    }
    setOutcome({
      kind: 'done',
      lines: describeInstall(current, report),
      notes: checked.notes,
    });
    setPasted('');
  };

  const chooseFile = async (): Promise<void> => {
    if (busy()) return;
    setOutcome({ kind: 'busy' });
    try {
      const picked = await pickPackFile();
      if (picked === null) {
        setOutcome({ kind: 'idle' });
        return;
      }
      if (!looksLikeManifest(picked.fileName)) {
        setOutcome({
          kind: 'refused',
          fileName: picked.fileName,
          problems: [
            {
              where: 'the file',
              message: `a pack is a .json file, and this is “${picked.fileName}”. If you have drawings or recordings rather than a pack, use the other button.`,
            },
          ],
        });
        return;
      }
      await ingest(picked.fileName, picked.text);
    } catch {
      setOutcome({
        kind: 'refused',
        fileName: '',
        problems: [{ where: 'the file', message: 'it could not be read off your disk.' }],
      });
    }
  };

  const importPasted = async (): Promise<void> => {
    const text = pasted();
    if (busy() || text.trim() === '') return;
    setOutcome({ kind: 'busy' });
    await ingest('what you pasted', text);
  };

  /** Stickers: PNG/SVG straight in, no JSON anywhere near it. */
  const chooseImages = async (): Promise<void> => {
    if (busy()) return;
    setOutcome({ kind: 'busy' });
    const added = await importStickerImages();
    setOutcome(
      added.length === 0
        ? { kind: 'idle' }
        : {
            kind: 'done',
            notes: [],
            lines: [
              added.length === 1
                ? `“${added[0]!.name}” is in your catalogue.`
                : `${added.length} drawings are in your catalogue.`,
              'They are under “your stickers”, and in script as {sticker=user:name}.',
            ],
          },
    );
  };

  /** Sounds: a folder of cues into a set of the reader's own. */
  const chooseSounds = async (): Promise<void> => {
    if (busy()) return;
    setOutcome({ kind: 'busy' });
    const report = await importSoundFolder();
    if (report.set === null) {
      setOutcome({ kind: 'idle' });
      return;
    }
    const lines: string[] = [
      report.assigned.length === 0
        ? `“${report.set.name}” was made, and nothing matched a cue yet.`
        : `“${report.set.name}” is in — ${report.assigned.length} of ${category().maxItems} cues filled.`,
      'Everything you did not fill keeps playing the set you were already listening to. Settings → Sound has the per-cue buttons.',
    ];
    if (report.unmatched.length > 0) {
      lines.push(
        `Not matched to a cue, so not used: ${report.unmatched.join(', ')}. Rename them after a cue below, or place them one at a time in Settings → Sound.`,
      );
    }
    if (report.rejected.length > 0) {
      lines.push(`Refused (wrong kind of file, or too big): ${report.rejected.join(', ')}.`);
    }
    setOutcome({ kind: 'done', lines, notes: [] });
  };

  const copyPrompt = async (): Promise<void> => {
    const ok = await copyToClipboard(prompt());
    setCopied(ok);
    if (!ok) {
      setOutcome({
        kind: 'refused',
        fileName: '',
        problems: [
          {
            where: 'the clipboard',
            message: 'it could not be reached. The prompt is below — select it and copy it by hand.',
          },
        ],
      });
      return;
    }
    setTimeout(() => setCopied(false), 2400);
  };

  /* -------------------------------- view -------------------------------- */

  const uploadLabel = (): string =>
    category().intake === 'files' ? 'Choose files' : 'Choose a file';

  return (
    <div
      class="nb-ins-overlay nb-pack-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy()) props.onClose();
      }}
    >
      <div
        class="nb-ins-card nb-pack-card"
        role="dialog"
        aria-modal="true"
        aria-label="Add your own"
      >
        <button
          type="button"
          class="nb-ins-close"
          aria-label="Close add your own"
          disabled={busy()}
          onClick={() => props.onClose()}
        >
          ×
        </button>
        <h2 class="nb-ins-title">Add your own</h2>
        <p class="nb-ins-hint font-ui">
          bring work of your own into the app — or have an assistant make it for you
        </p>

        {/* Which category. A row rather than a dropdown: there are four, and a
            reader whose file was refused for being the wrong kind needs the
            other one to be one press away, not behind a menu. */}
        <div class="nb-pack-tabs" role="tablist" aria-label="What to add">
          <For each={PACK_CATEGORIES}>
            {(entry) => (
              <button
                type="button"
                class="nb-pack-tab"
                role="tab"
                aria-selected={entry.id === categoryId()}
                classList={{ 'is-active': entry.id === categoryId() }}
                data-pack-tab={entry.id}
                data-tooltip={entry.blurb}
                disabled={busy()}
                onClick={() => switchTo(entry.id)}
              >
                {entry.title}
              </button>
            )}
          </For>
        </div>

        <div class="nb-ins-body nb-pack-body">
          {/* ------------------------- left: do it ------------------------- */}
          <div class="nb-pack-left">
            <section class="nb-pack-step" aria-label="Bring in a file">
              <h3 class="nb-pack-step-title">
                <span class="nb-pack-step-number">1</span> bring it in
              </h3>

              <div class="nb-pack-buttons">
                <Show when={category().intake === 'manifest'}>
                  <button
                    type="button"
                    class="nb-ins-button nb-ins-button-primary font-ui"
                    data-pack-upload
                    disabled={busy()}
                    onClick={() => void chooseFile()}
                  >
                    {uploadLabel()}
                  </button>
                </Show>
                <Show when={category().id === 'sticker'}>
                  <button
                    type="button"
                    class="nb-ins-button font-ui"
                    data-pack-images
                    disabled={busy()}
                    onClick={() => void chooseImages()}
                  >
                    Choose images (png / svg)
                  </button>
                </Show>
                <Show when={category().intake === 'files'}>
                  <button
                    type="button"
                    class="nb-ins-button nb-ins-button-primary font-ui"
                    data-pack-upload
                    disabled={busy()}
                    onClick={() => void chooseSounds()}
                  >
                    {uploadLabel()}
                  </button>
                </Show>
              </div>

              <Show when={category().intake === 'manifest'}>
                <p class="nb-pack-or font-ui">or paste what your assistant gave you:</p>
                <textarea
                  class="nb-pack-paste"
                  spellcheck={false}
                  aria-label="Paste a pack"
                  data-pack-paste
                  placeholder={`{ "alcovePack": 1, "category": "${category().id}", … }`}
                  value={pasted()}
                  disabled={busy()}
                  onInput={(event) => setPasted(event.currentTarget.value)}
                />
                <button
                  type="button"
                  class="nb-ins-button font-ui nb-pack-paste-go"
                  data-pack-paste-go
                  disabled={busy() || pasted().trim() === ''}
                  onClick={() => void importPasted()}
                >
                  Import what I pasted
                </button>
              </Show>
            </section>

            {/* ------------------------ the outcome ------------------------ */}
            <Show when={outcome().kind === 'refused'}>
              {(() => {
                const state = outcome() as Extract<Outcome, { kind: 'refused' }>;
                return (
                  <section class="nb-pack-refusal" aria-label="Why it was refused" data-pack-refusal>
                    <h3 class="nb-pack-refusal-title">
                      nothing was imported
                      <Show when={state.fileName !== ''}>
                        <em class="nb-pack-refusal-file"> — {state.fileName}</em>
                      </Show>
                    </h3>
                    <p class="nb-pack-refusal-lead font-ui">
                      it is all or nothing on purpose: half a pack would leave you guessing
                      which half.
                    </p>
                    <ul class="nb-pack-problems font-ui">
                      <For each={state.problems.slice(0, 12)}>
                        {(problem) => (
                          <li>
                            <code class="nb-pack-where">{problem.where}</code>{' '}
                            {problem.message}
                          </li>
                        )}
                      </For>
                    </ul>
                    <Show when={state.problems.length > 12}>
                      <p class="nb-pack-more-problems font-ui">
                        …and {state.problems.length - 12} more. Fix these first — they are
                        usually the same mistake repeated.
                      </p>
                    </Show>
                  </section>
                );
              })()}
            </Show>

            <Show when={outcome().kind === 'done'}>
              {(() => {
                const state = outcome() as Extract<Outcome, { kind: 'done' }>;
                return (
                  <section class="nb-pack-done" aria-label="Imported" data-pack-done>
                    <h3 class="nb-pack-done-title">in it goes</h3>
                    <ul class="nb-pack-done-lines font-ui">
                      <For each={state.lines}>{(line) => <li>{line}</li>}</For>
                      <For each={state.notes}>
                        {(note) => <li class="nb-pack-note">{note}</li>}
                      </For>
                    </ul>
                  </section>
                );
              })()}
            </Show>

            {/* ---------------------- 2. how to do it ---------------------- */}
            <section class="nb-pack-step" aria-label="How to do it">
              <h3 class="nb-pack-step-title">
                <span class="nb-pack-step-number">2</span> how it works
              </h3>
              <ol class="nb-pack-howto font-ui">
                <For each={category().howTo}>{(line) => <li>{line}</li>}</For>
              </ol>

              <Show when={category().fields.length > 0}>
                <h4 class="nb-pack-sub">what one {category().noun} is made of</h4>
                <dl class="nb-pack-fields font-ui">
                  <For each={category().fields}>
                    {(field) => (
                      <>
                        <dt>
                          <code>{field.key}</code>
                          <Show when={!field.required}>
                            <span class="nb-pack-optional"> optional</span>
                          </Show>
                        </dt>
                        <dd>
                          {field.label} — {fieldSummary(field)}
                        </dd>
                      </>
                    )}
                  </For>
                </dl>
              </Show>

              <Show when={category().files !== undefined}>
                <h4 class="nb-pack-sub">name each file after the moment it plays</h4>
                <dl class="nb-pack-fields font-ui">
                  <For each={category().files?.naming ?? []}>
                    {(slot) => (
                      <>
                        <dt>
                          <code>{slot.name}</code>
                        </dt>
                        <dd>{slot.label}</dd>
                      </>
                    )}
                  </For>
                </dl>
              </Show>

              <p class="nb-pack-caveat font-ui">{category().caveat}</p>
            </section>
          </div>

          {/* --------------------- right: the AI prompt --------------------- */}
          <div class="nb-pack-right">
            <section class="nb-pack-step nb-pack-prompt-step" aria-label="The prompt for your assistant">
              <h3 class="nb-pack-step-title">
                <span class="nb-pack-step-number">3</span> the prompt for your assistant
              </h3>
              <p class="nb-pack-prompt-lead font-ui">
                this is written from the same description the importer checks against, so
                what it asks for is exactly what will be accepted. Paste it to any model,
                add a sentence about what you want, and bring back what it writes.
              </p>
              <div class="nb-pack-prompt-actions">
                <button
                  type="button"
                  class="nb-ins-button nb-ins-button-primary font-ui"
                  data-pack-copy-prompt
                  onClick={() => void copyPrompt()}
                >
                  {copied() ? 'copied ✓' : 'Copy the prompt'}
                </button>
                <button
                  type="button"
                  class="nb-ins-button nb-ins-button-ghost font-ui"
                  aria-expanded={showPrompt()}
                  onClick={() => setShowPrompt(!showPrompt())}
                >
                  {showPrompt() ? 'hide it' : 'read it'}
                </button>
              </div>
              <Show when={showPrompt()}>
                <pre class="nb-pack-prompt" data-pack-prompt tabindex="0">
                  {prompt()}
                </pre>
              </Show>
            </section>

            {/* The honest list. The brief: if a category cannot be supported
                honestly yet, SAY SO here rather than accepting an upload that
                will be dropped. */}
            <section class="nb-pack-step nb-pack-notyet" aria-label="What cannot be uploaded yet">
              <h3 class="nb-pack-step-title nb-pack-notyet-title">what you cannot bring in yet</h3>
              <dl class="nb-pack-fields font-ui">
                <For each={UNSUPPORTED_CATEGORIES}>
                  {(entry) => (
                    <>
                      <dt class="nb-pack-notyet-name">{entry.title}</dt>
                      <dd>
                        {entry.why}
                        <Show when={entry.instead !== undefined}>
                          <span class="nb-pack-instead"> Instead: {entry.instead}</span>
                        </Show>
                      </dd>
                    </>
                  )}
                </For>
              </dl>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Self-mounting, exactly like `openExportPdfDialog`, so every host in the rail
 * wires this with one onClick and no state of its own.
 */
export function openPackDialog(initial: PackCategoryId = 'wallpaper'): void {
  if (typeof document === 'undefined') return;
  document.querySelector('[data-nb-pack-dialog]')?.remove();
  const host = document.createElement('div');
  host.setAttribute('data-nb-pack-dialog', 'true');
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <PackDialog
        initial={initial}
        onClose={() => {
          dispose();
          host.remove();
        }}
      />
    ),
    host,
  );
}

export default PackDialog;
