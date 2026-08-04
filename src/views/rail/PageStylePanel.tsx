/**
 * src/views/rail/PageStylePanel.tsx — the four page styles + line-height
 * slider, driving the focused page's document attributes through the live
 * editor (src/editor's active-editor registry). Replaces the old in-page
 * style switcher that used to overlap page content.
 */
import { For, createEffect, createSignal, type JSX } from 'solid-js';
import { activeEditor } from '../../editor/insert/activeEditor';
import {
  DEFAULT_LINE_HEIGHT_PX,
  LINE_HEIGHT_MAX_PX,
  LINE_HEIGHT_MIN_PX,
  isPageStyle,
} from '../../editor/document';
import { PAGE_STYLES } from '../../data/types';
import type { PageStyle } from '../../data/types';
import { StarMark, createCuration, starWords } from './DesignStrip';

/**
 * What each ruling is CALLED on a card. The rulings themselves — and the order
 * they are offered in — come from `data/types.ts`; this panel used to carry
 * its own copy of the four ids alongside their labels, which is a list that
 * can lose a ruling the settings validator still accepts. `Record<PageStyle,
 * …>` makes a new ruling a compile error here until it has a name.
 */
const PAGE_STYLE_LABELS: Readonly<Record<PageStyle, string>> = {
  ruled: 'Ruled lines',
  grid: 'Grid squares',
  blank: 'Blank paper',
  dotted: 'Dot grid',
};

export interface PageStylePanelProps {
  open: boolean;
}

/**
 * The four rulings as the reader's curation keys them.
 *
 * A four-entry list is still a list. The report's rule was "this notation for
 * pretty much anything", and a writer who never once wants grid paper has as
 * much reason to take it off this panel as they have to take a gothic arcade
 * off the carpentry — the shorter list is the whole benefit.
 */
const PAGE_STYLE_ROWS: readonly { id: PageStyle; name: string }[] = PAGE_STYLES.map((id) => ({
  id,
  name: PAGE_STYLE_LABELS[id],
}));

export default function PageStylePanel(props: PageStylePanelProps): JSX.Element {
  const [style, setStyle] = createSignal<PageStyle>('ruled');
  const [lineHeight, setLineHeight] = createSignal(DEFAULT_LINE_HEIGHT_PX);

  /*
   * The cards are drawn thumbnails and not chips or strip tiles, so this drives
   * the shared controller directly — the same way the studio's colour grids do.
   * `createCuration` is the one implementation; what varies between callers is
   * only the furniture the rows are drawn as.
   */
  const curation = createCuration<{ id: PageStyle; name: string }>(() => ({
    axis: 'page-style',
    label: 'page styles',
    options: PAGE_STYLE_ROWS,
    activeId: style(),
  }));

  // Sync from the focused editor whenever the panel opens or focus moves.
  createEffect(() => {
    if (!props.open) return;
    const editor = activeEditor();
    if (!editor) return;
    const attrs = editor.state.doc.attrs as Record<string, unknown>;
    const docStyle = attrs.pageStyle;
    if (isPageStyle(docStyle)) setStyle(docStyle);
    const docLine = attrs.lineHeightPx;
    if (typeof docLine === 'number' && Number.isFinite(docLine)) {
      // Pulled into the slider's range: a document may legitimately be ruled
      // outside it (see clampLineHeight), and the thumb has to sit somewhere.
      setLineHeight(
        Math.min(
          LINE_HEIGHT_MAX_PX,
          Math.max(LINE_HEIGHT_MIN_PX, Math.round(docLine)),
        ),
      );
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
      <div
        class="nb-pagestyle-grid"
        role="group"
        aria-label="Page style"
        on:contextmenu={(event) => curation.onListContext(event)}
      >
        <For each={curation.list()}>
          {(row) => (
            <button
              type="button"
              class="nb-pagestyle-card"
              aria-pressed={style() === row.id}
              aria-label={`${row.name}${starWords(curation.starsFor(row.id))}`}
              classList={{ 'nb-cur-gone': curation.removed(row.id) }}
              onClick={() => applyStyle(row.id)}
              on:contextmenu={(event) => curation.onEntryContext(event, row.id)}
            >
              {/* The wrapper is the star's positioning context — see
                  curation.css. The thumb is the card's whole surface. */}
              <span class="nb-mark-wrap">
                <span
                  class="nb-pagestyle-thumb"
                  data-style={row.id}
                  aria-hidden="true"
                />
                <StarMark stars={curation.starsFor(row.id)} />
              </span>
              <span class="nb-pagestyle-label">{row.name}</span>
            </button>
          )}
        </For>
      </div>
      <curation.Overlay />

      <label class="nb-panel-row">
        <span class="nb-panel-row-label">
          line height <em class="nb-panel-row-hint">{lineHeight()}px</em>
        </span>
        <input
          type="range"
          class="nb-panel-slider"
          min={LINE_HEIGHT_MIN_PX}
          max={LINE_HEIGHT_MAX_PX}
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
