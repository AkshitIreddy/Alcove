import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  AI_SPEC_STYLE_PRESETS,
  composeNotebookScriptSpec,
  createCustomAiSpecStyle,
  loadAiSpecStyleState,
  resolveAiSpecStyle,
  saveAiSpecStyleState,
  type AiSpecStylePreset,
} from '../../editor/script/aiStylePresets';

export interface AiSpecStylePickerProps {
  onCopy(spec: string): void;
  onDownload(spec: string): void;
  onNotify?(message: string): void;
}

export default function AiSpecStylePicker(props: AiSpecStylePickerProps): JSX.Element {
  const initial = loadAiSpecStyleState();
  const [selectedId, setSelectedId] = createSignal(initial.selectedId);
  const [customPresets, setCustomPresets] = createSignal<readonly AiSpecStylePreset[]>(
    initial.customPresets,
  );
  const [editing, setEditing] = createSignal(false);
  const [draftId, setDraftId] = createSignal<string | undefined>();
  const [draftName, setDraftName] = createSignal('');
  const [draftPrompt, setDraftPrompt] = createSignal('');
  const [draftBase, setDraftBase] = createSignal(AI_SPEC_STYLE_PRESETS[0].id);
  let nameInput: HTMLInputElement | undefined;
  let presetSelect: HTMLSelectElement | undefined;

  const selected = createMemo(() => resolveAiSpecStyle(selectedId(), customPresets()));
  const composedSpec = createMemo(() => composeNotebookScriptSpec(selected()));

  const persist = (nextSelected: string, nextCustoms = customPresets()): void => {
    setSelectedId(nextSelected);
    setCustomPresets(nextCustoms);
    saveAiSpecStyleState({ selectedId: nextSelected, customPresets: nextCustoms });
  };

  const beginCustom = (existing?: AiSpecStylePreset): void => {
    const base = existing?.basedOn ??
      (AI_SPEC_STYLE_PRESETS.some((preset) => preset.id === selected().id)
        ? selected().id
        : AI_SPEC_STYLE_PRESETS[0].id);
    const borrowed = resolveAiSpecStyle(base, []);
    setDraftId(existing?.id);
    setDraftName(existing?.name ?? 'My creative direction');
    setDraftBase(base);
    setDraftPrompt(existing?.prompt ?? borrowed.prompt);
    setEditing(true);
  };

  const closeEditor = (): void => {
    setEditing(false);
  };

  createEffect(() => {
    if (!editing()) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeEditor();
    };
    document.addEventListener('keydown', onKeyDown);
    queueMicrotask(() => nameInput?.focus());
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  // A newly saved custom option and its selected id enter the DOM in the same
  // Solid update. Native <select> applies `value` before the dynamic option is
  // mounted, so explicitly reconcile once the option list has settled.
  createEffect(() => {
    const id = selectedId();
    customPresets();
    queueMicrotask(() => {
      if (presetSelect !== undefined) presetSelect.value = id;
    });
  });

  const saveCustom = (): void => {
    const preset = createCustomAiSpecStyle({
      id: draftId(),
      name: draftName(),
      prompt: draftPrompt(),
      basedOn: draftBase(),
    });
    if (preset === null) {
      props.onNotify?.('give the direction a name and a little guidance');
      return;
    }
    const next = draftId() === undefined
      ? [...customPresets(), preset]
      : customPresets().map((item) => (item.id === preset.id ? preset : item));
    persist(preset.id, next);
    closeEditor();
    props.onNotify?.('creative direction saved');
  };

  const deleteCustom = (): void => {
    const id = draftId();
    if (id === undefined) return;
    const next = customPresets().filter((preset) => preset.id !== id);
    persist(AI_SPEC_STYLE_PRESETS[0].id, next);
    closeEditor();
    props.onNotify?.('custom direction removed');
  };

  return (
    <>
      <section class="nb-ai-style-picker" aria-label="AI guide creative direction">
        <div class="nb-ai-style-heading">
          <div class="nb-ai-style-title-lockup">
            <span class="nb-ai-style-spark" aria-hidden="true">
              <span class="nb-ai-style-spark-glyph">{'✨\uFE0E'}</span>
            </span>
            <div>
              <strong>Creative direction</strong>
              <span class="font-ui">a mood and quality brief, never a page recipe</span>
            </div>
          </div>
          <button
            type="button"
            class="nb-ai-style-edit font-ui"
            onClick={() => beginCustom(selected().custom ? selected() : undefined)}
          >
            {selected().custom ? 'Edit yours' : 'Create your own'}
          </button>
        </div>

        <div class="nb-ai-style-choice">
          <label class="nb-ai-style-select-label font-ui">
            <span>Direction</span>
            <select
              ref={presetSelect}
              aria-label="Creative direction preset"
              value={selectedId()}
              onChange={(event) => persist(event.currentTarget.value)}
            >
              <optgroup label="Alcove directions">
                <For each={AI_SPEC_STYLE_PRESETS}>
                  {(preset) => <option value={preset.id}>{preset.name}</option>}
                </For>
              </optgroup>
              <Show when={customPresets().length > 0}>
                <optgroup label="Your directions">
                  <For each={customPresets()}>
                    {(preset) => <option value={preset.id}>{preset.name}</option>}
                  </For>
                </optgroup>
              </Show>
            </select>
          </label>
          <p class="nb-ai-style-description font-ui">{selected().description}</p>
        </div>

        <p class="nb-ai-style-catalogue-note font-ui">
          The guide still gives the AI Alcove’s complete papers, cards, diagrams,
          lettering, stickers and trim catalogue. This only steers the feeling.
        </p>

        <div class="nb-ai-style-actions">
          <button type="button" class="font-ui" onClick={() => props.onDownload(composedSpec())}>
            <span aria-hidden="true">⇩</span> Download guide
          </button>
          <button type="button" class="is-primary font-ui" onClick={() => props.onCopy(composedSpec())}>
            <span aria-hidden="true">⧉</span> Copy guide
          </button>
        </div>
      </section>

      <Show when={editing()}>
        <Portal>
          <div
            class="nb-ai-style-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeEditor();
            }}
          >
            <section
              class="nb-ai-style-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="nb-ai-style-modal-title"
              aria-describedby="nb-ai-style-modal-intro"
            >
              <header class="nb-ai-style-modal-header">
                <div>
                  <span class="nb-ai-style-modal-kicker font-ui">your art director’s note</span>
                  <h2 id="nb-ai-style-modal-title">Create a direction</h2>
                  <p id="nb-ai-style-modal-intro" class="font-ui">
                    Describe the atmosphere, audience and quality you want. Alcove gives
                    the AI the complete visual catalogue separately, so your note can stay
                    about taste instead of micromanaging blocks.
                  </p>
                </div>
                <button
                  type="button"
                  class="nb-ai-style-modal-close"
                  aria-label="Close creative direction editor"
                  onClick={closeEditor}
                >
                  ×
                </button>
              </header>

              <div class="nb-ai-style-modal-body">
                <label class="nb-ai-style-field font-ui">
                  <span>Name</span>
                  <input
                    ref={nameInput}
                    aria-label="Custom direction name"
                    maxlength={60}
                    value={draftName()}
                    onInput={(event) => setDraftName(event.currentTarget.value)}
                  />
                </label>

                <label class="nb-ai-style-field font-ui">
                  <span>Borrow a starting mood from</span>
                  <select
                    aria-label="Base creative direction"
                    value={draftBase()}
                    onChange={(event) => {
                      const id = event.currentTarget.value;
                      setDraftBase(id);
                      setDraftPrompt(resolveAiSpecStyle(id, []).prompt);
                    }}
                  >
                    <For each={AI_SPEC_STYLE_PRESETS}>
                      {(preset) => <option value={preset.id}>{preset.name}</option>}
                    </For>
                  </select>
                  <small>Borrowing copies the mood into the writing desk below; edit it freely.</small>
                </label>

                <label class="nb-ai-style-field nb-ai-style-prompt-field font-ui">
                  <span>Your creative brief</span>
                  <textarea
                    aria-label="Custom creative direction"
                    maxlength={2400}
                    rows={11}
                    value={draftPrompt()}
                    onInput={(event) => setDraftPrompt(event.currentTarget.value)}
                  />
                  <div class="nb-ai-style-prompt-help">
                    <small>
                      Useful ingredients: intended feeling, audience, rhythm, clarity,
                      restraint, and what “high quality” means to you. Leave exact page
                      furniture to the AI unless it is essential.
                    </small>
                    <span>{draftPrompt().length}/2400</span>
                  </div>
                </label>
              </div>

              <footer class="nb-ai-style-modal-actions">
                <Show when={draftId() !== undefined}>
                  <button type="button" class="is-danger font-ui" onClick={deleteCustom}>
                    Delete direction
                  </button>
                </Show>
                <span class="nb-ai-style-modal-spacer" />
                <button type="button" class="font-ui" onClick={closeEditor}>Cancel</button>
                <button type="button" class="is-primary font-ui" onClick={saveCustom}>
                  Save direction
                </button>
              </footer>
            </section>
          </div>
        </Portal>
      </Show>
    </>
  );
}
