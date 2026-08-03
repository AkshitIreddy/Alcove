/**
 * src/views/rail/BookRail.tsx — the slim vertical icon rail on the book
 * view's left edge. Replaces the old top script toolbar entirely: every
 * book-level tool lives here as a hand-drawn icon button labelled by the
 * app's own tooltip (views/Tooltip.tsx — `data-tooltip`, never the browser's
 * `title=`). The back-to-shelf arrow stays above the rail (rendered by
 * BookView).
 *
 * Wave 2 additions: TOC + page-history panels, focus-mode / thumbnails
 * toggles, "bookmark this page" ribbon, and a footer with the quiet word
 * count (roadmap #11) and the autosave pencil that scribbles whenever a
 * save flushes (roadmap #17, driven by src/editor/saveIndicator).
 *
 * The ribbon drawer (bottom of this file) is the one panel the rail owns
 * outright rather than asking `BookView` to open: it needs no book prop, since
 * `views/bookmarks.ts` already knows which book is on screen, and everything
 * it edits is that module's vocabulary.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  Show,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { lastSavedAt } from '../../editor/saveIndicator';
import { LINGER_MS } from '../../styles/motion';
import Tooltips from '../Tooltip';
import {
  currentRibbon,
  ribbonFromPreset,
  ribbonPresetsOf,
  ribbonSvg,
  RIBBON_CHARMS,
  RIBBON_CLOTHS,
  RIBBON_FAMILIES,
  RIBBON_MATERIALS,
  RIBBON_TAILS,
  RIBBON_WEIGHTS,
  saveRibbonDesign,
  type RibbonCharmTone,
  type RibbonDesign,
  type RibbonFamily,
} from '../bookmarks';
import { Capped } from './DesignStrip';
import RailPanel from './RailPanel';
import {
  AddPageIcon,
  AiSpecIcon,
  BrushIcon,
  ExportScriptIcon,
  FilmstripIcon,
  FocusIcon,
  HistoryIcon,
  InsertScriptIcon,
  PageStyleIcon,
  PencilIcon,
  RibbonIcon,
  StickerIcon,
  TocIcon,
} from './icons';

export type RailPanelId =
  | 'customize'
  | 'page-style'
  | 'catalogue'
  | 'toc'
  | 'history';

export interface BookRailProps {
  activePanel: RailPanelId | null;
  onTogglePanel(panel: RailPanelId): void;
  onInsertScript(): void;
  onExportScript(): void;
  onCopySpec(): void;
  onAddPage(): void;
  /** Focus mode (roadmap #12) — rail icon mirror of F9. */
  focusMode: boolean;
  onToggleFocus(): void;
  /** Whether the active page is ribbon-bookmarked (roadmap #19). */
  bookmarked: boolean;
  onToggleBookmark(): void;
  /** Thumbnails strip visibility (roadmap #10, settings.thumbnailsStrip). */
  thumbnails: boolean;
  onToggleThumbnails(): void;
  /** Quiet word count for the footer (page + whole-book totals). */
  counts: {
    pageWords: number;
    pageChars: number;
    bookWords: number;
    bookChars: number;
  };
}

/** 1234 → "1.2k" — the rail is narrow, digits must stay tiny. */
const compact = (n: number): string =>
  n >= 10_000
    ? `${Math.round(n / 1000)}k`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);

/**
 * Ribbon-and-charm — the ribbon DRAWER, next to the ribbon TOGGLE.
 *
 * Local to this file rather than added to `icons.tsx`, which is another
 * group's territory this week. Same construction as everything in there: a
 * 24×24 frame, `currentColor`, slightly drunken curves, pre-wobbled.
 */
function RibbonStyleIcon(): JSX.Element {
  const s = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  } as const;
  return (
    <svg viewBox="0 0 24 24" class="nb-rail-icon" aria-hidden="true">
      <path
        d="M 6.4 3.6 C 8.6 3.3 10.8 3.3 13 3.7 C 13.3 8 13.3 12.4 12.9 16.8 C 11.8 15.7 10.7 14.7 9.7 13.7 C 8.7 14.7 7.6 15.7 6.5 16.8 C 6.1 12.4 6.1 8 6.4 3.6 Z"
        {...s}
      />
      <path d="M 8.2 6.7 C 9.2 6.6 10.2 6.6 11.2 6.7" {...s} stroke-width="1.3" opacity="0.6" />
      <path
        d="M 17.6 12.4 C 18.9 12.7 19.6 13.5 19.8 14.8 C 19.5 16 18.8 16.7 17.6 17 C 16.4 16.7 15.7 16 15.4 14.8 C 15.7 13.5 16.4 12.7 17.6 12.4 Z"
        {...s}
        stroke-width="1.5"
      />
      <path d="M 17.6 17.1 C 17.4 18.6 17.4 20 17.7 21.3" {...s} stroke-width="1.3" />
    </svg>
  );
}

interface RailTool {
  readonly id: string;
  readonly label: string;
  readonly icon: () => JSX.Element;
  readonly panel?: RailPanelId;
  /**
   * A sheet this file opens itself. `panel` asks BookView to open one of its
   * five; this one is the rail's own, and the difference matters only to the
   * click handler and the pressed state.
   */
  readonly ownPanel?: 'ribbons';
  readonly action?: (p: BookRailProps) => void;
  /** Non-panel buttons that still show a pressed state (toggles). */
  readonly pressed?: (p: BookRailProps) => boolean;
  /**
   * Shortcut, drawn on a key cap inside the tooltip rather than spelled out
   * in brackets at the end of the label — "Focus mode (F9)" was one string a
   * reader had to parse; this is a label and a key.
   */
  readonly key?: string;
}

const TOOLS: readonly RailTool[] = [
  { id: 'customize', label: 'Customize this book', icon: BrushIcon, panel: 'customize' },
  { id: 'page-style', label: 'Page style', icon: PageStyleIcon, panel: 'page-style' },
  {
    id: 'catalogue',
    // Named for what the panel HOLDS, not for two of its seven shelves. A
    // reader after a quote card or a flowchart had no reason to open
    // something called "stickers", and so never found either.
    label: 'Catalogue — everything you can add',
    icon: StickerIcon,
    panel: 'catalogue',
  },
  { id: 'toc', label: 'Table of contents', icon: TocIcon, panel: 'toc' },
  { id: 'history', label: 'Page history', icon: HistoryIcon, panel: 'history' },
  {
    id: 'bookmark',
    label: 'Bookmark this page',
    icon: RibbonIcon,
    action: (p) => p.onToggleBookmark(),
    pressed: (p) => p.bookmarked,
  },
  {
    id: 'ribbon-style',
    label: 'Ribbons — choose how yours are cut',
    icon: RibbonStyleIcon,
    ownPanel: 'ribbons',
  },
  {
    id: 'focus',
    label: 'Focus mode',
    key: 'F9',
    icon: FocusIcon,
    action: (p) => p.onToggleFocus(),
    pressed: (p) => p.focusMode,
  },
  {
    id: 'thumbs',
    label: 'Thumbnails strip',
    icon: FilmstripIcon,
    action: (p) => p.onToggleThumbnails(),
    pressed: (p) => p.thumbnails,
  },
  { id: 'insert', label: 'Insert script', icon: InsertScriptIcon, action: (p) => p.onInsertScript() },
  { id: 'export', label: 'Export script', icon: ExportScriptIcon, action: (p) => p.onExportScript() },
  { id: 'spec', label: 'Copy AI spec', icon: AiSpecIcon, action: (p) => p.onCopySpec() },
  { id: 'add-page', label: 'Add a page', icon: AddPageIcon, action: (p) => p.onAddPage() },
];

/**
 * Index before which the panel/action divider renders — DERIVED.
 *
 * It was the literal 8, which was the index of `insert` on the day it was
 * written. Adding one tool above that line silently moved the divider up a
 * button, which is the whole "a constant restating another table's shape"
 * mistake in miniature. The divider separates the tools that open something
 * from the tools that do something; `insert` is the first of the second kind.
 */
const DIVIDER_AT = TOOLS.findIndex((tool) => tool.id === 'insert');

export default function BookRail(props: BookRailProps): JSX.Element {
  // The rail's own sheet. Kept here rather than in BookView's `activePanel`
  // because nothing outside this file needs to know it exists — but the two
  // still close each other, since two sheets both claiming the panel push
  // would stack one on top of the other.
  const [ribbonsOpen, setRibbonsOpen] = createSignal(false);
  createEffect(() => {
    if (props.activePanel !== null) setRibbonsOpen(false);
  });
  const openRibbons = (): void => {
    if (props.activePanel !== null) props.onTogglePanel(props.activePanel);
    setRibbonsOpen(true);
  };

  // Autosave pencil: scribble for a beat on every save pulse.
  const [scribbling, setScribbling] = createSignal(false);
  let scribbleTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      lastSavedAt,
      (at) => {
        if (at === 0) return;
        setScribbling(true);
        if (scribbleTimer !== undefined) clearTimeout(scribbleTimer);
        scribbleTimer = setTimeout(() => setScribbling(false), LINGER_MS.pulse);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    if (scribbleTimer !== undefined) clearTimeout(scribbleTimer);
  });

  /** The panel this icon opens is already up — see the tooltip note below. */
  const panelOpen = (tool: RailTool): boolean =>
    tool.ownPanel !== undefined
      ? ribbonsOpen()
      : tool.panel !== undefined && props.activePanel === tool.panel;

  return (
    <nav class="nb-rail" aria-label="Book tools">
      <Tooltips />
      <For each={TOOLS}>
        {(tool, index) => (
          <>
            {/* Little divider between panel-tools and action-tools. */}
            {index() === DIVIDER_AT && (
              <span class="nb-rail-divider" aria-hidden="true" />
            )}
            <button
              type="button"
              class="nb-rail-button"
              classList={{
                'is-active':
                  tool.ownPanel !== undefined
                    ? ribbonsOpen()
                    : tool.panel !== undefined
                      ? props.activePanel === tool.panel
                      : (tool.pressed?.(props) ?? false),
              }}
              // The shortcut rides the accessible name even though the visible
              // bubble draws it as a key cap: a screen reader gets one string.
              aria-label={
                tool.key === undefined ? tool.label : `${tool.label} (${tool.key})`
              }
              aria-pressed={
                tool.ownPanel !== undefined
                  ? ribbonsOpen()
                  : tool.panel !== undefined
                    ? props.activePanel === tool.panel
                    : tool.pressed
                      ? tool.pressed(props)
                      : undefined
              }
              // The bubble lands exactly where an open sheet starts, and the
              // rail paints above the sheet — so a pressed icon would label
              // the panel it just opened, over that panel's own title. An
              // absent `data-tooltip` is how a call site says "not now".
              data-tooltip={panelOpen(tool) ? undefined : tool.label}
              data-tooltip-side="right"
              data-tooltip-key={tool.key}
              data-tool={tool.id}
              onClick={() => {
                if (tool.ownPanel !== undefined) {
                  if (ribbonsOpen()) setRibbonsOpen(false);
                  else openRibbons();
                } else if (tool.panel !== undefined) props.onTogglePanel(tool.panel);
                else tool.action?.(props);
              }}
            >
              {tool.icon()}
            </button>
          </>
        )}
      </For>

      {/* Footer — quiet word count + the autosave pencil (roadmap #11/#17). */}
      <div class="nb-rail-footer">
        <span
          class="nb-rail-pencil"
          classList={{ 'is-scribbling': scribbling() }}
          data-scribbling={scribbling() ? 'true' : 'false'}
          data-tooltip="autosaved"
          data-tooltip-side="right"
          aria-hidden="true"
        >
          <PencilIcon />
        </span>
        <span
          class="nb-rail-counts"
          data-testid="word-counts"
          // Two lines. The bubble honours the newline (`white-space: pre-line`)
          // so this stays one attribute rather than a markup fragment.
          data-tooltip={
            `this page: ${props.counts.pageWords} words · ` +
            `${props.counts.pageChars} characters\n` +
            `whole book: ${props.counts.bookWords} words · ` +
            `${props.counts.bookChars} characters`
          }
          data-tooltip-side="right"
        >
          <span class="nb-rail-counts-page">{compact(props.counts.pageWords)}w</span>
          <span class="nb-rail-counts-book">{compact(props.counts.bookWords)}w</span>
        </span>
      </div>

      {/*
        Portal, and it is not optional: `.nb-rail` carries
        `transform: translateY(-50%)`, and a transformed ancestor becomes the
        containing block for `position: fixed` descendants — so a sheet
        rendered inside the nav would hang off the RAIL rather than the window,
        at half a viewport's offset.
      */}
      <Portal>
        <RibbonDrawer open={ribbonsOpen()} onClose={() => setRibbonsOpen(false)} />
      </Portal>
    </nav>
  );
}

/* ========================================================================== *
 *                             the ribbon drawer                              *
 * ========================================================================== */

/**
 * One axis row: a label and a strip of previews, capped so a long vocabulary
 * does not unroll the whole sheet.
 *
 * The reader's rule, in their words: *"after like 20, just have an option that
 * says some number more which if clicked shows all of them, similar for
 * options in the whole app, dont show all at once, since it may slow down the
 * app."* Eight here rather than twenty — each tile is a drawn ribbon and the
 * sheet is 340px wide — and `Capped` is the app's one implementation of it, so
 * the count on the control is the REMAINING count everywhere.
 */
function AxisRow<T extends { id: string; name: string }>(props: {
  label: string;
  options: readonly T[];
  activeId: string;
  columns: number;
  limit?: number;
  onPick(id: string): void;
  art(option: T): string;
  hint?(option: T): string;
}): JSX.Element {
  return (
    <>
      <p class="nb-panel-row-label nb-strip-label font-ui">{props.label}</p>
      <div
        class="nb-strip"
        role="group"
        aria-label={props.label}
        style={{ '--nb-strip-cols': String(props.columns) }}
      >
        <Capped
          each={props.options}
          limit={props.limit ?? 8}
          label={props.label}
          isActive={(option) => option.id === props.activeId}
        >
          {(option) => (
            <button
              type="button"
              class="nb-strip-tile"
              classList={{ 'is-active': option().id === props.activeId }}
              aria-pressed={option().id === props.activeId}
              aria-label={
                props.hint === undefined
                  ? option().name
                  : `${option().name} — ${props.hint(option())}`
              }
              data-tooltip={option().name}
              data-tooltip-side="top"
              onClick={() => props.onPick(option().id)}
            >
              <span
                class="nb-strip-art"
                style={{
                  display: 'flex',
                  'align-items': 'flex-start',
                  'justify-content': 'center',
                  padding: '4px 0 2px',
                  background: 'var(--paper-cream)',
                }}
                // eslint-disable-next-line solid/no-innerhtml
                innerHTML={props.art(option())}
              />
              <span class="nb-strip-name">{option().name}</span>
            </button>
          )}
        </Capped>
      </div>
    </>
  );
}

const CHARM_TONE_LABELS: ReadonlyArray<{ id: RibbonCharmTone; name: string }> = [
  { id: 'ink', name: 'Ink' },
  { id: 'gilt', name: 'Gilt' },
  { id: 'cream', name: 'Cream' },
];

/**
 * Every axis of a ribbon, in one sheet.
 *
 * Presets first and axes under them, in that order on purpose: the reader
 * asked for *"well thought out presets with proper classifications"* before
 * they asked for knobs, and somebody who wants a ribbon and not a hobby should
 * be able to stop after the first two rows.
 */
function RibbonDrawer(props: { open: boolean; onClose(): void }): JSX.Element {
  const [family, setFamily] = createSignal<RibbonFamily>('library');
  const design = createMemo<RibbonDesign>(() => currentRibbon().design);
  const set = (patch: Partial<RibbonDesign>): void => {
    void saveRibbonDesign({ ...design(), ...patch });
  };
  /** A preview of the current ribbon with one axis swapped for the tile's. */
  const swatch = (patch: Partial<RibbonDesign>, height = 54): string =>
    ribbonSvg({ ...design(), ...patch }, { height, lip: true });

  return (
    <RailPanel open={props.open} title="Ribbons" onClose={() => props.onClose()}>
      <div class="nb-ribbon-drawer">
        <div
          style={{
            display: 'flex',
            'align-items': 'flex-start',
            'justify-content': 'center',
            gap: 'var(--space-8)',
            padding: 'var(--space-8) 0 var(--space-4)',
          }}
        >
          {/* The book's own ribbons, in the six slots a cover actually uses —
              so the sheet shows the SET, not one ribbon in isolation. */}
          <Index each={['terracotta', 'moss', 'sky', 'plum', 'amber', 'blush'] as const}>
            {(slot) => (
              <span
                // eslint-disable-next-line solid/no-innerhtml
                innerHTML={ribbonSvg(design(), { height: 76, slot: slot(), lip: true })}
              />
            )}
          </Index>
        </div>

        <p class="nb-panel-row-label nb-strip-label font-ui">Ready-made</p>
        <div class="nb-chip-row" role="group" aria-label="Ribbon families">
          <For each={RIBBON_FAMILIES}>
            {(id) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={family() === id}
                onClick={() => setFamily(id)}
              >
                {id}
              </button>
            )}
          </For>
        </div>
        <div class="nb-strip" style={{ '--nb-strip-cols': '2' }}>
          <Index each={ribbonPresetsOf(family())}>
            {(preset) => (
              <button
                type="button"
                class="nb-strip-tile"
                classList={{ 'is-active': design().preset === preset().id }}
                aria-pressed={design().preset === preset().id}
                aria-label={`${preset().name} — ${preset().blurb}`}
                data-tooltip={preset().blurb}
                data-tooltip-side="top"
                onClick={() => void saveRibbonDesign(ribbonFromPreset(preset().id))}
              >
                <span
                  class="nb-strip-art"
                  style={{
                    display: 'flex',
                    'justify-content': 'center',
                    padding: '4px 0 2px',
                    background: 'var(--paper-cream)',
                  }}
                  // eslint-disable-next-line solid/no-innerhtml
                  innerHTML={ribbonSvg(
                    { ...preset().design, preset: preset().id },
                    { height: 62, lip: true },
                  )}
                />
                <span class="nb-strip-name">{preset().name}</span>
              </button>
            )}
          </Index>
        </div>

        <p class="nb-panel-row-label nb-strip-label font-ui">Cloth</p>
        <div class="nb-swatch-grid" role="group" aria-label="Ribbon cloth">
          <Capped
            each={RIBBON_CLOTHS}
            limit={12}
            label="cloths"
            moreClass="nb-more-row"
            isActive={(c) => c.id === design().cloth}
          >
            {(c) => (
              <button
                type="button"
                class="nb-swatch nb-swatch-colourway"
                classList={{ 'is-active': c().id === design().cloth }}
                aria-pressed={c().id === design().cloth}
                aria-label={c().name}
                data-tooltip={c().name}
                data-tooltip-side="top"
                style={{ background: c().face }}
                onClick={() => set({ cloth: c().id })}
              />
            )}
          </Capped>
        </div>

        <AxisRow
          label="Width"
          options={RIBBON_WEIGHTS}
          activeId={design().weight}
          columns={5}
          onPick={(id) => set({ weight: id })}
          art={(w) => swatch({ weight: w.id }, 46)}
        />
        <AxisRow
          label="Tail"
          options={RIBBON_TAILS}
          activeId={design().tail}
          columns={4}
          onPick={(id) => set({ tail: id })}
          art={(t) => swatch({ tail: t.id }, 48)}
        />
        <AxisRow
          label="Material"
          options={RIBBON_MATERIALS}
          activeId={design().material}
          columns={4}
          onPick={(id) => set({ material: id })}
          art={(m) => swatch({ material: m.id }, 48)}
        />
        <AxisRow
          label="Charm"
          options={RIBBON_CHARMS}
          activeId={design().charm}
          columns={4}
          onPick={(id) => set({ charm: id })}
          art={(c) => swatch({ charm: c.id }, 48)}
        />

        <p class="nb-panel-row-label nb-strip-label font-ui">Charm struck in</p>
        <div class="nb-chip-row" role="group" aria-label="Charm tone">
          <For each={CHARM_TONE_LABELS}>
            {(tone) => (
              <button
                type="button"
                class="nb-chip"
                aria-pressed={design().charmTone === tone.id}
                onClick={() => set({ charmTone: tone.id })}
              >
                {tone.name}
              </button>
            )}
          </For>
        </div>

        <Show when={currentRibbon().id === null}>
          <p class="nb-panel-footnote font-ui">
            open a book to keep a ribbon with it
          </p>
        </Show>
      </div>
    </RailPanel>
  );
}
