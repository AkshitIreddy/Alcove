/**
 * src/views/rail/PageStylePanel.tsx — the rulings + the line-height slider,
 * driving the focused page's document attributes through the live editor
 * (src/editor's active-editor registry). Replaces the old in-page style
 * switcher that used to overlap page content.
 *
 * This panel offered FOUR rulings for the whole of the app's life, which is
 * what the reader finally said out loud: "page style only shows four options…
 * at least 20 here". There are twenty-seven now, and the two things that
 * changed here are small because the work is elsewhere:
 *
 *  - the cards come from `editor/rulings.ts` in ITS derived order, not from a
 *    list this file keeps (it used to own the labels, which is how a picker and
 *    a validator drift), and
 *  - the grid is wrapped in `Capped`, so the six best land on the panel and the
 *    other twenty-one are one press away. Twenty-seven cards unwrapped would be
 *    twenty-seven tab stops in a rail panel 300px wide, and the reader's own
 *    rule for this app was "after like 20, put them behind a more".
 */
import { createEffect, createSignal, type JSX } from 'solid-js';
import { activeEditor } from '../../editor/insert/activeEditor';
import {
  DEFAULT_LINE_HEIGHT_PX,
  LINE_HEIGHT_MAX_PX,
  LINE_HEIGHT_MIN_PX,
  isPageStyle,
} from '../../editor/document';
import {
  RULING_FAMILY,
  RULING_ORDER,
  RULING_SHORTLIST,
} from '../../editor/rulings';
import type { PageStyle } from '../../data/types';
import { Capped, StarMark, createCuration, starWords } from './DesignStrip';
import '../../styles/rulings.css';

/**
 * One card. `group` is the family SPOKEN, because that is the only thing the
 * curation menu does with it ("first in the grids"); the machine word is what
 * `editor/rulings.ts` sorts on and it never has to leave that file.
 */
interface RulingCard {
  readonly id: PageStyle;
  readonly name: string;
  readonly blurb: string;
  readonly group: string;
}

const CARDS: readonly RulingCard[] = RULING_ORDER.map((row) => ({
  id: row.id,
  name: row.name,
  blurb: row.blurb,
  group: RULING_FAMILY[row.group],
}));

export interface PageStylePanelProps {
  open: boolean;
}

export default function PageStylePanel(props: PageStylePanelProps): JSX.Element {
  const [style, setStyle] = createSignal<PageStyle>('ruled');
  const [lineHeight, setLineHeight] = createSignal(DEFAULT_LINE_HEIGHT_PX);

  /*
   * The cards are drawn thumbnails and not chips or strip tiles, so this drives
   * the shared controller directly — the same way the studio's colour grids do.
   * `createCuration` is the one implementation; what varies between callers is
   * only the furniture the rows are drawn as.
   */
  const curation = createCuration<RulingCard>(() => ({
    axis: 'page-style',
    label: 'page styles',
    options: CARDS,
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
        <Capped
          each={curation.list()}
          limit={RULING_SHORTLIST}
          label="page styles"
          isActive={(row) => row.id === style()}
          moreClass="nb-pagestyle-more"
          /* A primitive, per Capped's contract — the curated list is rebuilt on
             every star and every removal, and an object here would slam the
             panel shut under the reader each time. */
          resetKey={props.open}
        >
          {(row) => (
            <button
              type="button"
              class="nb-pagestyle-card"
              aria-pressed={style() === row().id}
              aria-label={`${row().name} — ${row().blurb}${starWords(
                curation.starsFor(row().id),
              )}`}
              data-tooltip={row().blurb}
              classList={{ 'nb-cur-gone': curation.removed(row().id) }}
              onClick={() => applyStyle(row().id)}
              on:contextmenu={(event) => curation.onEntryContext(event, row().id)}
            >
              {/* The wrapper is the star's positioning context — see
                  curation.css. The thumb is the card's whole surface, and it is
                  painted by the SAME rule that paints the page (rulings.css),
                  so a thumbnail cannot show a ruling the paper will not. */}
              <span class="nb-mark-wrap">
                <span
                  class="nb-pagestyle-thumb"
                  data-style={row().id}
                  aria-hidden="true"
                />
                <StarMark stars={curation.starsFor(row().id)} />
              </span>
              <span class="nb-pagestyle-label">{row().name}</span>
            </button>
          )}
        </Capped>
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
