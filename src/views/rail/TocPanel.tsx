/**
 * src/views/rail/TocPanel.tsx — the book's table of contents (roadmap #9):
 * every heading of every page as an indented hand-drawn tree; clicking an
 * entry jumps the spread to that page. Pages without headings appear as
 * plain "page N" rows so nothing in the book is unreachable.
 */
import { createMemo, For, type JSX } from 'solid-js';
import type { Page } from '../../data/types';
import { buildBookToc, type TocEntry } from '../toc';

export interface TocPanelProps {
  pages: readonly Page[];
  currentSpread: number;
  onJump(slot: number): void;
}

interface TocRow {
  readonly slot: number;
  readonly level: number;
  readonly text: string;
  readonly isPageRow: boolean;
}

export default function TocPanel(props: TocPanelProps): JSX.Element {
  const rows = createMemo((): TocRow[] => {
    const entries = buildBookToc(props.pages as Page[]);
    const bySlot = new Map<number, TocEntry[]>();
    for (const entry of entries) {
      const list = bySlot.get(entry.slot) ?? [];
      list.push(entry);
      bySlot.set(entry.slot, list);
    }
    const out: TocRow[] = [];
    props.pages.forEach((_page, slot) => {
      const headings = bySlot.get(slot);
      if (!headings || headings.length === 0) {
        out.push({ slot, level: 0, text: `page ${slot + 1}`, isPageRow: true });
        return;
      }
      for (const heading of headings) {
        out.push({
          slot,
          level: heading.level,
          text: heading.text,
          isPageRow: false,
        });
      }
    });
    return out;
  });

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
