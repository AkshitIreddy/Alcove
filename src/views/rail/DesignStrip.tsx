/**
 * src/views/rail/DesignStrip.tsx — one axis, shown small, and the shape every
 * long list in the app now borrows.
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
 *
 * That rule turned out not to be about strips at all, so the bottom half of
 * this file is now the general form of it — `cappedTo`, `MoreControl`,
 * `Capped` — and the strip is its first customer. Anything in the app with
 * more rows than a reader wants at once should reach for those three rather
 * than write a fourth copy: the catalogue's shelves and the picker sheet both
 * do, and the count on the control is the REMAINING count, never the total.
 * "60 more…" over a row that already shows eight of the sixty is a lie the
 * reader can check.
 */
import { Index, Show, createEffect, createSignal, type JSX } from 'solid-js';
import type { FlatScheme } from '../../art/flat';
import { DesignCanvas } from './designArt';
import type { PickerOption } from './DesignPicker';

/* ========================================================================== *
 *                     the shared shape: a head, and the rest                 *
 * ========================================================================== */

/**
 * How many rows a panel shows before it offers the rest.
 *
 * One number, because the reader asked for one behaviour ("after like 20")
 * across the whole app, and because a per-panel constant is a per-panel thing
 * to forget. Strips override it downward — a tile is 104px wide and eight is
 * all that fits — and the picker sheet overrides it upward, since its cards
 * are what the reader came for.
 */
export const CAP = 20;

/**
 * The head of a list, with the reader's current choice guaranteed to be in it.
 *
 * The guarantee is the whole point. Cap a list at twenty, let somebody pick the
 * fortieth from the expanded view, collapse it again, and every tile comes back
 * unpressed — which reads as "it forgot", not as "it is further down". So the
 * active row is swapped into the LAST slot of the head rather than the first:
 * the head is ordered, and pushing the whole run along to make room at the
 * front would move every tile out from under the reader's cursor.
 *
 * Pass no `isActive` when the list is a SEARCH RESULT. Pinning a row the query
 * did not match into a list of hits is a different lie: the reader typed a
 * word and got back something that does not contain it.
 */
export function cappedTo<T>(
  all: readonly T[],
  limit: number,
  isActive?: (item: T) => boolean,
): readonly T[] {
  if (limit < 1 || all.length <= limit) return all;
  const head = all.slice(0, limit);
  if (isActive === undefined || head.some(isActive)) return head;
  const active = all.find(isActive);
  return active === undefined ? head : [...head.slice(0, limit - 1), active];
}

export interface MoreControlProps {
  /** How many rows are NOT on screen. Never the total. */
  hidden: number;
  open: boolean;
  /** What is being revealed, for the screen reader: "tape", "wallpapers". */
  label: string;
  onToggle(): void;
  /** Extra class, so each host can dress the control as one of its own cells. */
  class?: string;
}

/** "37 more" / "show fewer" — the one control for "there is more behind this". */
export function MoreControl(props: MoreControlProps): JSX.Element {
  return (
    <button
      type="button"
      class={props.class === undefined ? 'nb-more' : `nb-more ${props.class}`}
      aria-expanded={props.open}
      aria-label={
        props.open ? `${props.label}: show fewer` : `${props.label}: show ${props.hidden} more`
      }
      onClick={() => props.onToggle()}
    >
      <Show
        when={!props.open}
        fallback={<span class="nb-more-word">show fewer</span>}
      >
        <span class="nb-more-count">{props.hidden}</span>
        <span class="nb-more-word">more</span>
      </Show>
    </button>
  );
}

export interface CappedProps<T> {
  each: readonly T[];
  /** Rows before the control. Defaults to `CAP`. */
  limit?: number;
  /** The reader's current choice, which is always shown. See `cappedTo`. */
  isActive?: (item: T) => boolean;
  /** What the control is revealing, for the screen reader. */
  label: string;
  /** Extra class on the control. */
  moreClass?: string;
  /**
   * Collapse again whenever this value changes — a new search, a new shelf.
   * Read reactively, so pass the value itself, not an accessor.
   */
  resetKey?: unknown;
  children: (item: () => T) => JSX.Element;
}

/**
 * A flat list, capped, with its own reveal control. Returns a FRAGMENT, so the
 * host's grid keeps owning the layout and the control lands in it as one more
 * cell.
 *
 * `Index`, not `For`. The rows these lists carry are rebuilt whenever anything
 * upstream changes — a pick, a keystroke in the search box — and a reference-
 * keyed `For` would throw away and re-create every button, taking the reader's
 * focus and their scroll position with it. That lesson was learned in
 * DesignPicker and it applies to every one of these.
 */
export function Capped<T>(props: CappedProps<T>): JSX.Element {
  const [open, setOpen] = createSignal(false);

  createEffect(() => {
    // Read, do not use: the read is the subscription.
    void props.resetKey;
    setOpen(false);
  });

  const shown = (): readonly T[] =>
    open() ? props.each : cappedTo(props.each, props.limit ?? CAP, props.isActive);
  const hidden = (): number => props.each.length - shown().length;

  return (
    <>
      <Index each={shown()}>{(item) => props.children(item)}</Index>
      <Show when={open() || hidden() > 0}>
        <MoreControl
          class={props.moreClass}
          hidden={hidden()}
          open={open()}
          label={props.label}
          onToggle={() => setOpen(!open())}
        />
      </Show>
    </>
  );
}

/* ========================================================================== *
 *                                  the strip                                 *
 * ========================================================================== */

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

  const shown = (): readonly PickerOption[] =>
    props.onMore === undefined
      ? props.options
      : cappedTo(props.options, limit(), (o) => o.id === props.activeId);

  /** What the "more…" cell is actually offering. Never the total — see above. */
  const hidden = (): number => props.options.length - shown().length;

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
            data-tooltip={`${option().name} — ${option().blurb}`}
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
      <Show when={props.onMore !== undefined && hidden() > 0}>
        <button
          type="button"
          class="nb-strip-tile nb-strip-more"
          onClick={() => props.onMore?.()}
          aria-label={`${props.label}: browse all ${props.options.length}`}
        >
          <span class="nb-strip-more-count">{hidden()}</span>
          <span class="nb-strip-more-word">more…</span>
        </button>
      </Show>
    </div>
  );
}
