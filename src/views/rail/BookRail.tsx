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
 *
 * ## One ribbon control, not two
 *
 * The rail used to carry a "bookmark this page" button AND a "ribbons" button,
 * and the reader found the seam:
 *
 *   "right now it just places a bokomark when i click on bookmark button […]
 *    oh wait never mind you just have it as options in sidebar called ribbon,
 *    maybe it might be worth merging those two instead having a seperate
 *    button"
 *
 * They are one control now. A press still marks the page in ONE press — that is
 * the thing worth protecting, and a chooser you have to walk through would have
 * made bookmarking slower to fix a naming problem. What the press also does is
 * open the ribbon plate beside the rail: the six ribbons of the book's own set,
 * so the reader can say which one marks this page, take it out again, or go on
 * into the full drawer and re-cut every ribbon in the book. A right-click opens
 * that plate without touching the bookmark, which is how you get at the ribbons
 * of a page you have already marked.
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
import { bindingFor, formatBinding } from '../../data/keybindings';
import { settings } from '../../data/settings';
import { lastSavedAt } from '../../editor/saveIndicator';
import { OutTrayIcon, TemplatesIcon } from '../../features/templates/icons';
import { LINGER_MS } from '../../styles/motion';
import Tooltips from '../Tooltip';
import {
  currentRibbon,
  ribbonFromPreset,
  ribbonPresetsOf,
  ribbonSvg,
  RIBBON_CHARMS,
  RIBBON_CLOTHS,
  RIBBON_COLORS,
  RIBBON_FAMILIES,
  RIBBON_MATERIALS,
  RIBBON_TAILS,
  RIBBON_WEIGHTS,
  saveRibbonDesign,
  type RibbonCharmTone,
  type RibbonColor,
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
  | 'history'
  /**
   * "Take it out" — every way a page or a book leaves this app, and the one
   * way loose files come in, on one sheet. The four flows on it (the PDF
   * chooser, the picture, the script, the Markdown import) were all finished,
   * all e2e-tested, and all reachable only through a dev global; see the
   * docblock on `features/templates/groupD.ts`.
   */
  | 'share';

export interface BookRailProps {
  activePanel: RailPanelId | null;
  onTogglePanel(panel: RailPanelId): void;
  onInsertScript(): void;
  onExportScript(): void;
  onCopySpec(): void;
  onAddPage(): void;
  /** The templates gallery — a new book, or this template's pages here. */
  onOpenTemplates(): void;
  /** Focus mode (roadmap #12) — rail icon mirror of F9. */
  focusMode: boolean;
  onToggleFocus(): void;
  /** Whether the active page is ribbon-bookmarked (roadmap #19). */
  bookmarked: boolean;
  onToggleBookmark(): void;
  /**
   * Which of the book's six ribbons marks the active page, or null when the
   * page is unmarked. The merged control (see the docblock) hands the reader
   * the set so the choice and the act are one button.
   */
  bookmarkSlot: RibbonColor | null;
  onPickBookmarkSlot(slot: RibbonColor): void;
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

interface RailTool {
  readonly id: string;
  readonly label: string;
  readonly icon: () => JSX.Element;
  readonly panel?: RailPanelId;
  readonly action?: (p: BookRailProps) => void;
  /** Non-panel buttons that still show a pressed state (toggles). */
  readonly pressed?: (p: BookRailProps) => boolean;
  /**
   * The ACTION ID whose combination is drawn on a key cap inside the tooltip,
   * rather than spelled out in brackets at the end of the label — "Focus mode
   * (F9)" was one string a reader had to parse; this is a label and a key.
   *
   * An id and not the combination itself, which is what it used to be: the
   * literal `'F9'` stayed 'F9' after a reader moved focus mode onto another
   * key, so the bubble on the button was quietly lying. `bindingFor` reads the
   * reader's own map, exactly as the dispatcher does.
   */
  readonly keyFor?: string;
}

const TOOLS: readonly RailTool[] = [
  {
    id: 'customize',
    label: 'Customize this book',
    icon: BrushIcon,
    panel: 'customize',
    keyFor: 'customize-book',
  },
  {
    id: 'page-style',
    label: 'Page style',
    icon: PageStyleIcon,
    panel: 'page-style',
    keyFor: 'page-style',
  },
  {
    id: 'catalogue',
    // Named for what the panel HOLDS, not for two of its seven shelves. A
    // reader after a quote card or a flowchart had no reason to open
    // something called "stickers", and so never found either.
    label: 'Catalogue — everything you can add',
    icon: StickerIcon,
    panel: 'catalogue',
    keyFor: 'catalogue',
  },
  {
    id: 'toc',
    label: 'Table of contents',
    icon: TocIcon,
    panel: 'toc',
    keyFor: 'table-of-contents',
  },
  { id: 'history', label: 'Page history', icon: HistoryIcon, panel: 'history' },
  {
    // The last panel in the group, because it is the one that ENDS a session:
    // everything above dresses the book, this is how a page leaves it.
    id: 'share',
    label: 'Take it out — PDF, picture, script, Markdown',
    icon: OutTrayIcon,
    panel: 'share',
    keyFor: 'export-pdf',
  },
  {
    // ONE control (see the docblock): the press marks the page, and the plate
    // it opens is where the ribbons live. `action` is not used — the click is
    // handled in place, because it has to open the plate as well as toggle.
    id: 'bookmark',
    label: 'Ribbon this page — and pick which ribbon',
    icon: RibbonIcon,
    keyFor: 'toggle-bookmark',
    pressed: (p) => p.bookmarked,
  },
  {
    id: 'focus',
    label: 'Focus mode',
    keyFor: 'toggle-focus',
    icon: FocusIcon,
    action: (p) => p.onToggleFocus(),
    pressed: (p) => p.focusMode,
  },
  {
    id: 'thumbs',
    label: 'Thumbnails strip',
    icon: FilmstripIcon,
    keyFor: 'thumbnails',
    action: (p) => p.onToggleThumbnails(),
    pressed: (p) => p.thumbnails,
  },
  {
    id: 'insert',
    label: 'Insert script',
    icon: InsertScriptIcon,
    keyFor: 'insert-script',
    action: (p) => p.onInsertScript(),
  },
  {
    id: 'export',
    label: 'Export script',
    icon: ExportScriptIcon,
    keyFor: 'export-script',
    action: (p) => p.onExportScript(),
  },
  { id: 'spec', label: 'Copy AI spec', icon: AiSpecIcon, action: (p) => p.onCopySpec() },
  {
    // Beside "add a page", because that is the pair: a blank one, or five
    // already written. The gallery's second verb — "add pages here" — only
    // exists while a book is open, which is why it has a rail button as well
    // as a dock button out on the shelf.
    id: 'templates',
    label: 'Start from a template',
    icon: TemplatesIcon,
    keyFor: 'templates',
    action: (p) => p.onOpenTemplates(),
  },
  {
    id: 'add-page',
    label: 'Add a page',
    icon: AddPageIcon,
    keyFor: 'new-page',
    action: (p) => p.onAddPage(),
  },
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

  /* ---------------------- the merged ribbon control ---------------------- */

  /**
   * The plate lives beside the rail button, so it needs that button's place on
   * screen. Measured at open time rather than anchored in CSS: `.nb-rail`
   * carries `translateY(-50%)`, which makes it the containing block for any
   * `position: fixed` child — the same trap the ribbon drawer's Portal exists
   * to dodge (see the Portal comment at the bottom of the nav).
   */
  const [plateAt, setPlateAt] = createSignal<{ top: number; left: number } | null>(
    null,
  );
  const plateOpen = (): boolean => plateAt() !== null;
  const closePlate = (): void => {
    setPlateAt(null);
  };

  const openPlateFrom = (button: HTMLElement): void => {
    const box = button.getBoundingClientRect();
    // Held to the window so a page near the top or bottom of the rail cannot
    // push the plate off screen. 232 is the plate's own width in rail.css.
    const top = Math.min(Math.max(12, box.top - 8), window.innerHeight - 300);
    setPlateAt({ top, left: box.right + 10 });
  };

  /**
   * The press. One press marks the page — that was the thing worth keeping —
   * and the plate follows so the choice of ribbon is one reach away rather
   * than one button away. Pressing again on a marked page takes the ribbon out
   * and puts the plate away with it.
   */
  const pressBookmark = (button: HTMLElement): void => {
    const wasMarked = props.bookmarked;
    props.onToggleBookmark();
    if (wasMarked) closePlate();
    else openPlateFrom(button);
  };

  createEffect(() => {
    // A panel sliding out from the rail would sit on top of the plate.
    if (props.activePanel !== null || ribbonsOpen()) closePlate();
  });

  createEffect(() => {
    if (!plateOpen()) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest('.nb-ribbon-plate') !== null ||
          target.closest('.nb-rail-button[data-tool="bookmark"]') !== null)
      ) {
        return;
      }
      closePlate();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePlate();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    });
  });

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

  /** The combination this tool is on right now, spelled for this platform. */
  const capFor = (tool: RailTool): string | undefined =>
    tool.keyFor === undefined
      ? undefined
      : formatBinding(bindingFor(tool.keyFor, settings.keybindings));

  /** The panel this icon opens is already up — see the tooltip note below. */
  const panelOpen = (tool: RailTool): boolean =>
    tool.id === 'bookmark'
      ? plateOpen()
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
                  tool.panel !== undefined
                    ? props.activePanel === tool.panel
                    : (tool.pressed?.(props) ?? false),
                // Not "pressed" — the plate being open is a second, quieter
                // state on the same button, and it must not read as "this page
                // is bookmarked" when it is only "the ribbons are showing".
                'is-open': tool.id === 'bookmark' && plateOpen(),
              }}
              // The shortcut rides the accessible name even though the visible
              // bubble draws it as a key cap: a screen reader gets one string.
              aria-label={
                capFor(tool) === undefined
                  ? tool.label
                  : `${tool.label} (${capFor(tool)})`
              }
              aria-pressed={
                tool.panel !== undefined
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
              data-tooltip-key={capFor(tool)}
              data-tool={tool.id}
              onContextMenu={(event) => {
                if (tool.id !== 'bookmark') return;
                // Reaching the ribbons of a page you already marked, without
                // un-marking it on the way in.
                event.preventDefault();
                if (plateOpen()) closePlate();
                else openPlateFrom(event.currentTarget);
              }}
              onClick={(event) => {
                if (tool.id === 'bookmark') pressBookmark(event.currentTarget);
                else if (tool.panel !== undefined) props.onTogglePanel(tool.panel);
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
        <Show when={plateAt()} keyed>
          {(at) => (
            <RibbonPlate
              top={at.top}
              left={at.left}
              marked={props.bookmarked}
              slot={props.bookmarkSlot}
              onPick={(slot) => props.onPickBookmarkSlot(slot)}
              onRemove={() => {
                props.onToggleBookmark();
                closePlate();
              }}
              onOpenDrawer={() => {
                closePlate();
                openRibbons();
              }}
            />
          )}
        </Show>
        <RibbonDrawer open={ribbonsOpen()} onClose={() => setRibbonsOpen(false)} />
      </Portal>
    </nav>
  );
}

/* ========================================================================== *
 *                              the ribbon plate                              *
 * ========================================================================== */

/**
 * The small plate the merged control opens: the book's six ribbons, the one
 * marking this page lit, and the two ways on — out of the page, or into the
 * drawer where every ribbon in the book is cut.
 *
 * It draws the CURRENT design in all six slots rather than six generic
 * colours, so what the reader picks from is what will actually be sticking out
 * of their book — same `ribbonSvg` the drawer previews with and the same
 * `ribbonCss` paints the cover with, so the three can never disagree.
 */
function RibbonPlate(props: {
  top: number;
  left: number;
  marked: boolean;
  slot: RibbonColor | null;
  onPick(slot: RibbonColor): void;
  onRemove(): void;
  onOpenDrawer(): void;
}): JSX.Element {
  const design = createMemo<RibbonDesign>(() => currentRibbon().design);
  return (
    <div
      class="nb-ribbon-plate"
      role="group"
      aria-label="Ribbon on this page"
      style={{ top: `${props.top}px`, left: `${props.left}px` }}
    >
      <p class="nb-ribbon-plate-title font-ui">
        {props.marked ? 'ribbon on this page' : 'no ribbon on this page'}
      </p>
      <div class="nb-ribbon-plate-row" role="group" aria-label="Which ribbon">
        <For each={RIBBON_COLORS}>
          {(slot) => (
            <button
              type="button"
              class="nb-ribbon-plate-slot"
              classList={{ 'is-active': props.slot === slot }}
              aria-pressed={props.slot === slot}
              aria-label={`Mark this page with the ${slot} ribbon`}
              data-slot={slot}
              data-tooltip={slot}
              data-tooltip-side="top"
              onClick={() => props.onPick(slot)}
            >
              <span
                class="nb-ribbon-plate-art"
                // eslint-disable-next-line solid/no-innerhtml -- ribbonSvg is
                // our own deterministic markup (views/bookmarks.ts).
                innerHTML={ribbonSvg(design(), { height: 52, slot, lip: true })}
              />
            </button>
          )}
        </For>
      </div>
      <div class="nb-ribbon-plate-actions">
        <Show when={props.marked}>
          <button
            type="button"
            class="nb-chip nb-chip-ghost"
            onClick={() => props.onRemove()}
          >
            take it out
          </button>
        </Show>
        <button type="button" class="nb-chip" onClick={() => props.onOpenDrawer()}>
          ribbons…
        </button>
      </div>
      <p class="nb-ribbon-plate-note font-ui">
        the ribbon button marks the page in one press — come back here to change
        which ribbon, or to cut a new set
      </p>
    </div>
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
