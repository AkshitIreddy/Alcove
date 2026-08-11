/**
 * src/views/rail/TocPanel.tsx — the book's table of contents (roadmap #9):
 * every heading of every page as an indented hand-drawn tree; clicking an
 * entry jumps the spread to that page. Heading-less continuation pages name
 * the section they continue; stocked trailing blank leaves stay out of sight.
 */
import { createMemo, For, type JSX } from 'solid-js';
import type { Page } from '../../data/types';
import { buildTocRows } from '../toc';

export interface TocPanelProps {
  pages: readonly Page[];
  currentSpread: number;
  onJump(slot: number): void;
}

export default function TocPanel(props: TocPanelProps): JSX.Element {
  const rows = createMemo(() => buildTocRows(props.pages));

  return (
    <div class="nb-toc" data-testid="toc-panel">
      <For
        each={rows()}
        fallback={
          <p class="nb-panel-footnote">
            no headings yet — write an H1 and it will appear here
          </p>
        }
      >
        {(row) => (
          <button
            type="button"
            class="nb-toc-row"
            classList={{
              'is-page-row': row.isPageRow,
              'is-current': Math.floor(row.slot / 2) === props.currentSpread,
            }}
            data-level={row.level}
            onClick={() => props.onJump(row.slot)}
          >
            <span class="nb-toc-text">{row.text}</span>
            <span class="nb-toc-page font-label">p.{row.slot + 1}</span>
          </button>
        )}
      </For>
    </div>
  );
}
