/**
 * src/views/rail/DesignStrip.tsx — one axis, shown small.
 *
 * The shape the reader asked for: a handful of real previews inline, and a way
 * through to the rest. Eight tiles and a "more…" cell make a tidy three-across
 * block, which is as many as fit in a 376px sheet while still being big enough
 * to tell a gothic arcade from a pigeonhole grid.
 *
 * The eight are the head of the vocabulary — the lists are already ordered
 * plain → ornate, which is the order somebody shops in — except that the
 * CURRENT choice is always among them. Without that the strip would show no
 * pressed tile the moment you picked something from the long sheet, and the
 * row would read as though your choice had been forgotten.
 */
import { Index, Show, type JSX } from 'solid-js';
import type { FlatScheme } from '../../art/flat';
import { DesignCanvas } from './designArt';
import type { PickerOption } from './DesignPicker';

export interface DesignStripProps {
  /** Accessible name for the group — "Bookcase build", "Wallpaper". */
  label: string;
  options: readonly PickerOption[];
  activeId: string;
  scheme: FlatScheme;
  onPick(id: string): void;
  /**
   * Opens the long sheet. Omit for a SHORT vocabulary that fits whole — the
   * five wallpaper scales, the four reliefs — where a "more…" cell leading to
   * the same five options would be a lie about how much there is.
   */
  onMore?(): void;
  tileW?: number;
  tileH?: number;
  columns?: number;
  /** How many previews before the "more…" cell. Default 8 (a 3x3 block). */
  limit?: number;
  /** Caption each tile. On for short rows, off when the tiles are the point. */
  showNames?: boolean;
}

export default function DesignStrip(props: DesignStripProps): JSX.Element {
  const limit = (): number => props.limit ?? 8;
  const columns = (): number => props.columns ?? 3;

  const shown = (): readonly PickerOption[] => {
    const all = props.options;
    if (props.onMore === undefined) return all;
    const head = all.slice(0, limit());
    if (head.some((o) => o.id === props.activeId)) return head;
    const active = all.find((o) => o.id === props.activeId);
    // Swap the current choice into the LAST slot rather than the first: the
    // head is ordered, and pushing the whole run along to make room at the
    // front would move every tile under the reader's cursor.
    return active === undefined ? head : [...head.slice(0, limit() - 1), active];
  };

  return (
    <div
      class="nb-strip"
      role="group"
      aria-label={props.label}
      style={{ '--nb-strip-cols': String(columns()) }}
    >
      {/* Index, not For — see DesignPicker: a pick rebuilds the option list,
          and reference keying would re-create every tile under the cursor. */}
      <Index each={shown()}>
        {(option) => (
          <button
            type="button"
            class="nb-strip-tile"
            classList={{ 'is-active': option().id === props.activeId }}
            aria-pressed={option().id === props.activeId}
            aria-label={`${option().name} — ${option().blurb}`}
            title={`${option().name} — ${option().blurb}`}
            onClick={() => props.onPick(option().id)}
          >
            <DesignCanvas
              class="nb-strip-art"
              key={option().artKey}
              w={props.tileW ?? 104}
              h={props.tileH ?? 72}
              scheme={props.scheme}
              draw={(ctx, w, h) => option().draw(ctx, w, h)}
            />
            <Show when={props.showNames === true}>
              <span class="nb-strip-name">{option().name}</span>
            </Show>
          </button>
        )}
      </Index>
      <Show when={props.onMore !== undefined}>
        <button
          type="button"
          class="nb-strip-tile nb-strip-more"
          onClick={() => props.onMore?.()}
          aria-label={`${props.label}: browse all ${props.options.length}`}
        >
          <span class="nb-strip-more-count">{props.options.length}</span>
          <span class="nb-strip-more-word">more…</span>
        </button>
      </Show>
    </div>
  );
}
