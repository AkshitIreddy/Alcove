/**
 * src/views/rail/BookRail.tsx — the slim vertical icon rail on the book
 * view's left edge. Replaces the old top script toolbar entirely: every
 * book-level tool lives here as a hand-drawn icon button with a styled
 * tooltip (CSS, rail.css). The back-to-shelf arrow stays above the rail
 * (rendered by BookView).
 */
import { For, type JSX } from 'solid-js';
import {
  AddPageIcon,
  AiSpecIcon,
  BrushIcon,
  ExportScriptIcon,
  InsertScriptIcon,
  PageStyleIcon,
  StickerIcon,
} from './icons';

export type RailPanelId = 'customize' | 'page-style' | 'stickers';

export interface BookRailProps {
  activePanel: RailPanelId | null;
  onTogglePanel(panel: RailPanelId): void;
  onInsertScript(): void;
  onExportScript(): void;
  onCopySpec(): void;
  onAddPage(): void;
}

interface RailTool {
  readonly id: string;
  readonly label: string;
  readonly icon: () => JSX.Element;
  readonly panel?: RailPanelId;
  readonly action?: (p: BookRailProps) => void;
}

const TOOLS: readonly RailTool[] = [
  { id: 'customize', label: 'Customize this book', icon: BrushIcon, panel: 'customize' },
  { id: 'page-style', label: 'Page style', icon: PageStyleIcon, panel: 'page-style' },
  { id: 'stickers', label: 'Stickers & effects', icon: StickerIcon, panel: 'stickers' },
  { id: 'insert', label: 'Insert script', icon: InsertScriptIcon, action: (p) => p.onInsertScript() },
  { id: 'export', label: 'Export script', icon: ExportScriptIcon, action: (p) => p.onExportScript() },
  { id: 'spec', label: 'Copy AI spec', icon: AiSpecIcon, action: (p) => p.onCopySpec() },
  { id: 'add-page', label: 'Add a page', icon: AddPageIcon, action: (p) => p.onAddPage() },
];

export default function BookRail(props: BookRailProps): JSX.Element {
  return (
    <nav class="nb-rail" aria-label="Book tools">
      <For each={TOOLS}>
        {(tool, index) => (
          <>
            {/* Little divider between panel-tools and action-tools. */}
            {index() === 3 && <span class="nb-rail-divider" aria-hidden="true" />}
            <button
              type="button"
              class="nb-rail-button"
              classList={{
                'is-active': tool.panel !== undefined && props.activePanel === tool.panel,
              }}
              aria-label={tool.label}
              aria-pressed={
                tool.panel !== undefined ? props.activePanel === tool.panel : undefined
              }
              data-tip={tool.label}
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
    </nav>
  );
}
