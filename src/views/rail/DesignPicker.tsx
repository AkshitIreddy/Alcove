/**
 * src/views/rail/DesignPicker.tsx — the "more…" sheet.
 *
 * Three of the studio's vocabularies are far too long to sit inline: sixty
 * bookcases, fifty-five wallpapers, sixty-two bindings. A strip of eight plus
 * a way in is what the panel shows; this is the way in, and it takes over the
 * whole sheet rather than floating above it. One sheet at a time means no
 * second push claim, no stacking order to argue with, and Escape keeps meaning
 * the one thing it meant before.
 *
 * Every card is drawn by the real renderer for its vocabulary (see
 * designArt.tsx). Cards are ordinary buttons, so they are in the tab ring for
 * free and wear the app's focus ring; the arrow keys are added on top because
 * tabbing through sixty cards to reach the last one is not browsing.
 *
 * Two things it does NOT do any more.
 *
 * It does not paint the whole vocabulary the instant it opens. Every card is a
 * canvas bake, so the bindings sheet was 189 of them on one frame and the
 * papers 126 — measurably a second and a half of dead panel before anything was
 * legible. It shows `SHEET_CAP` and offers the rest, which is the same bargain
 * the strip that led here already struck.
 *
 * And its head does not scroll away. The back button is the only way out of a
 * sheet that has taken over the panel, and it used to be seven hundred pixels
 * above the reader by the time they had browsed a third of the cards.
 */
import {
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  type JSX,
} from 'solid-js';
import type { FlatScheme } from '../../art/flat';
import { DesignCanvas, type TileDraw } from './designArt';
import { MoreControl, cappedTo } from './DesignStrip';

export interface PickerOption {
  id: string;
  name: string;
  blurb: string;
  /**
   * Cache key for this card's art, carrying every axis the drawing varies on.
   * Not the id: two vocabularies can name the same preset, and a card drawn
   * against a book's own cloth varies on more than the preset.
   */
  artKey: string;
  draw: TileDraw;
  /** Section heading this option sits under. Omit for a flat list. */
  group?: string;
  /** Extra words the search should match — a build's name, a motif's name. */
  terms?: string;
}

export interface DesignPickerProps {
  title: string;
  /** One line under the title: what this axis actually changes. */
  hint?: string;
  options: readonly PickerOption[];
  activeId: string;
  /** The room the cards are painted in. */
  scheme: FlatScheme;
  onPick(id: string): void;
  onBack(): void;
  /** Card art size in CSS px. Bindings are tall; rooms are landscape. */
  cardW?: number;
  cardH?: number;
  /** Cards per row. Tall cards fit three, landscape ones two. */
  columns?: number;
  searchLabel?: string;
}

/** Fold to lowercase and drop punctuation, so "half-morocco" finds "Half Morocco". */
function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Cards before the "N more" control.
 *
 * Higher than the app-wide `CAP` of twenty on purpose: this sheet IS the long
 * list, the reader crossed a "more…" cell to get here, and a card is what they
 * came to look at. Twenty-four fills whole rows at two, three and four across,
 * so the control never lands alone at the end of a ragged rank.
 */
const SHEET_CAP = 24;

export default function DesignPicker(props: DesignPickerProps): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);
  let grid: HTMLDivElement | undefined;
  let root: HTMLDivElement | undefined;

  /**
   * The sheet replaces the studio inside the SAME scroller, so it inherits
   * however far down the reader had scrolled to reach the "more…" cell — and
   * lands them halfway through a list whose title and search box are off
   * screen above. Start at the top instead.
   */
  onMount(() => {
    const scroller = root?.closest('.nb-rail-panel-body');
    if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
  });

  const cardW = (): number => props.cardW ?? 148;
  const cardH = (): number => props.cardH ?? 102;
  const columns = (): number => props.columns ?? 2;

  const matches = createMemo<readonly PickerOption[]>(() => {
    const q = fold(query());
    if (q.length === 0) return props.options;
    const words = q.split(' ');
    return props.options.filter((option) => {
      const hay = fold(
        `${option.name} ${option.blurb} ${option.group ?? ''} ${option.terms ?? ''}`,
      );
      return words.every((word) => hay.includes(word));
    });
  });

  /**
   * Collapse again on a new search or a new axis — but NOT on a pick.
   *
   * `props.options` is rebuilt every time a card is chosen (each card is drawn
   * against the axis being edited), so keying the reset on the option list
   * would snap a reader who had expanded all 189 bindings back to 24 the moment
   * they tried one. The title is what actually names the axis, and it is stable
   * across picks.
   */
  createEffect(() => {
    // Read, do not use: the reads are the subscription.
    void props.title;
    void query();
    setShowAll(false);
  });

  /**
   * What is actually mounted: the head of the hits, plus the current choice.
   *
   * The cap spans the whole sheet rather than each group, so the sections come
   * out in the vocabulary's own order and the tail of the list is simply not
   * built yet — twenty-four cards over three groups, not twenty-four per group.
   * No pinning while a query is live: a hit list is answering the reader's
   * word, and the active card is only in it if it matched.
   */
  const capped = createMemo<readonly PickerOption[]>(() => {
    const hits = matches();
    if (showAll()) return hits;
    const activeId = props.activeId;
    return cappedTo(
      hits,
      SHEET_CAP,
      query().length > 0 ? undefined : (option) => option.id === activeId,
    );
  });

  const hiddenCount = (): number => matches().length - capped().length;

  /**
   * Grouped when the vocabulary has groups AND nobody is searching. A search
   * result split into eleven one-card sections is harder to scan than a plain
   * run of hits, which is the whole reason someone typed.
   *
   * Gathered by NAME, not by consecutive run. The binding list is ordered by
   * family but not strictly — a patterned-paper wrapper sits between two plain
   * ones — and a run-based grouping printed "Paper wrapper" twice with four
   * cards between them, which reads as a bug rather than as an ordering.
   */
  const groups = createMemo<readonly { name: string; items: readonly PickerOption[] }[]>(() => {
    const list = capped();
    if (query().length > 0 || !list.some((o) => o.group !== undefined)) {
      return [{ name: '', items: list }];
    }
    const byName = new Map<string, PickerOption[]>();
    for (const option of list) {
      const name = option.group ?? '';
      const bucket = byName.get(name);
      if (bucket === undefined) byName.set(name, [option]);
      else bucket.push(option);
    }
    // Map iteration is insertion order, so the sections come out in the order
    // the vocabulary introduces them — its own curation, kept.
    return [...byName].map(([name, items]) => ({ name, items }));
  });

  /**
   * Arrow keys walk the whole sheet, not one section: the grid is one visual
   * run of cards and the group headings are labels on it, so stopping at a
   * heading would feel like a wall that is not drawn.
   */
  const onGridKeyDown = (event: KeyboardEvent): void => {
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? columns()
            : event.key === 'ArrowUp'
              ? -columns()
              : 0;
    const home = event.key === 'Home';
    const end = event.key === 'End';
    if (step === 0 && !home && !end) return;
    const host = grid;
    if (!host) return;
    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>('.nb-pick-card'));
    if (cards.length === 0) return;
    const here = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (here < 0 && !home && !end) return;
    const next = home ? 0 : end ? cards.length - 1 : Math.min(cards.length - 1, Math.max(0, here + step));
    event.preventDefault();
    cards[next]?.focus();
  };

  return (
    <div class="nb-pick" ref={(el) => (root = el)}>
      {/* nb-sheet-head (rail.css) is the shared "stays put while the body
          scrolls" utility. The way OUT of a sheet cannot be the one control
          that needs a scroll to the top to reach. */}
      <div class="nb-pick-head nb-sheet-head">
        <button type="button" class="nb-pick-back" onClick={() => props.onBack()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15.4 4.6 L7.2 11.6 C6.9 11.9 6.9 12.2 7.2 12.5 L15.2 19.4" />
            </g>
          </svg>
          back
        </button>
        <h3 class="nb-pick-title">{props.title}</h3>
      </div>

      <Show when={props.hint !== undefined}>
        <p class="nb-pick-hint">{props.hint}</p>
      </Show>

      <label class="nb-pick-search">
        <span class="nb-sr-only">{props.searchLabel ?? `Search ${props.title}`}</span>
        <input
          type="search"
          value={query()}
          placeholder="search…"
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </label>

      {/* Says what is ON SCREEN as well as what exists, because those are two
          different numbers now and the reader can count the first one. */}
      <p class="nb-pick-count" aria-live="polite">
        {matches().length === props.options.length
          ? hiddenCount() > 0
            ? `showing ${capped().length} of ${props.options.length}`
            : `${props.options.length} to choose from`
          : `${matches().length} of ${props.options.length}`}
      </p>

      {/*
        `Index`, not `For`. Picking a card rebuilds the whole option list —
        every card's art depends on the axis being edited — and a reference-
        keyed `For` therefore throws away and re-creates every button, taking
        the reader's focus to the body with it. `Index` keys by position, so
        the buttons survive and only their contents update; keyboard browsing
        stays where it was, which is measurable and was not true before.
      */}
      <div ref={(el) => (grid = el)} on:keydown={onGridKeyDown}>
        <Index each={groups()}>
          {(group) => (
            <>
              <Show when={group().name.length > 0}>
                <h4 class="nb-pick-group">{group().name}</h4>
              </Show>
              <div
                class="nb-pick-grid"
                role="group"
                aria-label={group().name.length > 0 ? group().name : props.title}
                style={{ '--nb-pick-cols': String(columns()) }}
              >
                <Index each={group().items}>
                  {(option) => (
                    <button
                      type="button"
                      class="nb-pick-card"
                      classList={{ 'is-active': option().id === props.activeId }}
                      aria-pressed={option().id === props.activeId}
                      data-tooltip={option().blurb}
                      onClick={() => props.onPick(option().id)}
                    >
                      <DesignCanvas
                        class="nb-pick-art"
                        key={option().artKey}
                        w={cardW()}
                        h={cardH()}
                        scheme={props.scheme}
                        draw={(ctx, w, h) => option().draw(ctx, w, h)}
                      />
                      <span class="nb-pick-name">{option().name}</span>
                      <span class="nb-pick-blurb">{option().blurb}</span>
                    </button>
                  )}
                </Index>
              </div>
            </>
          )}
        </Index>
        <Show when={showAll() || hiddenCount() > 0}>
          <MoreControl
            class="nb-more-row"
            hidden={hiddenCount()}
            open={showAll()}
            label={props.title}
            onToggle={() => setShowAll(!showAll())}
          />
        </Show>
        <Show when={matches().length === 0}>
          <p class="nb-panel-footnote">nothing by that name. try a shorter word.</p>
        </Show>
      </div>
    </div>
  );
}
