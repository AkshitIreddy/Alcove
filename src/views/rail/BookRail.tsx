/**
 * src/views/rail/BookRail.tsx — the slim vertical icon rail on the book
 * view's left edge. Replaces the old top script toolbar entirely: every
 * book-level tool lives here as a hand-drawn icon button with a styled
 * tooltip (CSS, rail.css). The back-to-shelf arrow stays above the rail
 * (rendered by BookView).
 *
 * Wave 2 additions: TOC + page-history panels, focus-mode / thumbnails
 * toggles, "bookmark this page" ribbon, and a footer with the quiet word
 * count (roadmap #11) and the autosave pencil that scribbles whenever a
 * save flushes (roadmap #17, driven by src/editor/saveIndicator).
 */
import { createEffect, createSignal, For, on, onCleanup, type JSX } from 'solid-js';
import { lastSavedAt } from '../../editor/saveIndicator';
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
  | 'stickers'
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

interface RailTool {
  readonly id: string;
  readonly label: string;
  readonly icon: () => JSX.Element;
  readonly panel?: RailPanelId;
  readonly action?: (p: BookRailProps) => void;
  /** Non-panel buttons that still show a pressed state (toggles). */
  readonly pressed?: (p: BookRailProps) => boolean;
}

const TOOLS: readonly RailTool[] = [
  { id: 'customize', label: 'Customize this book', icon: BrushIcon, panel: 'customize' },
  { id: 'page-style', label: 'Page style', icon: PageStyleIcon, panel: 'page-style' },
  { id: 'stickers', label: 'Stickers & effects', icon: StickerIcon, panel: 'stickers' },
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
    id: 'focus',
    label: 'Focus mode (F9)',
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

/** Index before which the panel/action divider renders. */
const DIVIDER_AT = 8;

export default function BookRail(props: BookRailProps): JSX.Element {
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
        scribbleTimer = setTimeout(() => setScribbling(false), 1400);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    if (scribbleTimer !== undefined) clearTimeout(scribbleTimer);
  });

  return (
    <nav class="nb-rail" aria-label="Book tools">
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
              }}
              aria-label={tool.label}
              aria-pressed={
                tool.panel !== undefined
                  ? props.activePanel === tool.panel
                  : tool.pressed
                    ? tool.pressed(props)
                    : undefined
              }
              data-tip={tool.label}
              data-tool={tool.id}
              onClick={() => {
                if (tool.panel !== undefined) props.onTogglePanel(tool.panel);
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
          title="autosaved"
          aria-hidden="true"
        >
          <PencilIcon />
        </span>
        <span
          class="nb-rail-counts"
          data-testid="word-counts"
          title={
            `this page: ${props.counts.pageWords} words · ` +
            `${props.counts.pageChars} characters\n` +
            `whole book: ${props.counts.bookWords} words · ` +
            `${props.counts.bookChars} characters`
          }
        >
          <span class="nb-rail-counts-page">{compact(props.counts.pageWords)}w</span>
          <span class="nb-rail-counts-book">{compact(props.counts.bookWords)}w</span>
        </span>
      </div>
    </nav>
  );
}
