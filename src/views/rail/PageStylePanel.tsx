/**
 * src/views/rail/PageStylePanel.tsx — the four page styles + line-height
 * slider, driving the focused page's document attributes through the live
 * editor (src/editor's active-editor registry). Replaces the old in-page
 * style switcher that used to overlap page content.
 */
import { For, createEffect, createSignal, type JSX } from 'solid-js';
import { activeEditor } from '../../editor/insert/activeEditor';
import type { PageStyle } from '../../data/types';

const PAGE_STYLES: readonly { value: PageStyle; label: string }[] = [
  { value: 'ruled', label: 'Ruled lines' },
  { value: 'grid', label: 'Grid squares' },
  { value: 'blank', label: 'Blank paper' },
  { value: 'dotted', label: 'Dot grid' },
];

const LINE_MIN = 26;
const LINE_MAX = 40;

export interface PageStylePanelProps {
  open: boolean;
}

export default function PageStylePanel(props: PageStylePanelProps): JSX.Element {
  const [style, setStyle] = createSignal<PageStyle>('ruled');
  const [lineHeight, setLineHeight] = createSignal(32);

  // Sync from the focused editor whenever the panel opens or focus moves.
  createEffect(() => {
    if (!props.open) return;
    const editor = activeEditor();
    if (!editor) return;
    const attrs = editor.state.doc.attrs as Record<string, unknown>;
    const docStyle = attrs.pageStyle;
    if (
      typeof docStyle === 'string' &&
      PAGE_STYLES.some((s) => s.value === docStyle)
    ) {
      setStyle(docStyle as PageStyle);
    }
    const docLine = attrs.lineHeightPx;
    if (typeof docLine === 'number' && Number.isFinite(docLine)) {
      setLineHeight(Math.min(LINE_MAX, Math.max(LINE_MIN, Math.round(docLine))));
    }
  });

  const applyStyle = (value: PageStyle): void => {
    setStyle(value);
    const editor = activeEditor();
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setDocAttribute('pageStyle', value));
  };

  const applyLineHeight = (value: number): void => {
    setLineHeight(value);
    const editor = activeEditor();
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setDocAttribute('lineHeightPx', value));
  };

  return (
    <div class="nb-pagestyle">
      <div class="nb-pagestyle-grid" role="group" aria-label="Page style">
        <For each={PAGE_STYLES}>
          {(entry) => (
            <button
              type="button"
              class="nb-pagestyle-card"
              aria-pressed={style() === entry.value}
              onClick={() => applyStyle(entry.value)}
            >
              <span
                class="nb-pagestyle-thumb"
                data-style={entry.value}
                aria-hidden="true"
              />
              <span class="nb-pagestyle-label">{entry.label}</span>
            </button>
          )}
        </For>
      </div>

      <label class="nb-panel-row">
        <span class="nb-panel-row-label">
          line height <em class="nb-panel-row-hint">{lineHeight()}px</em>
        </span>
        <input
          type="range"
          class="nb-panel-slider"
          min={LINE_MIN}
          max={LINE_MAX}
          step={1}
          value={lineHeight()}
          aria-label="Line height"
          onInput={(e) => applyLineHeight(Number(e.currentTarget.value))}
        />
      </label>

      <p class="nb-panel-footnote">changes the page you last touched</p>
    </div>
  );
}
