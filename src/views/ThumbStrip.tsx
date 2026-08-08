/**
 * src/views/ThumbStrip.tsx — the toggleable bottom filmstrip of mini page
 * renders (roadmap #10). Every page gets a lightweight miniature drawn from
 * its stored heading and block shapes, so all 48 pages remain recognisable
 * without coupling the strip to the flip engine's six-entry raster LRU. Click
 * a thumb to jump to its spread.
 *
 * This preview is deliberately stable. The flip cache fills and evicts pages
 * out-of-band; borrowing its bitmaps made several stationary thumbnails swap
 * from preview to raster together after a turn. A navigation aid must not
 * repaint itself after the navigation has already landed.
 */
import { createEffect, For, type JSX } from 'solid-js';
import type { Page } from '../data/types';
import { extractHeadings } from './toc';
import { thumbnailPairNeedsRecentre } from './thumbScroll';

export interface ThumbStripProps {
  pages: readonly Page[];
  currentSpread: number;
  onJump(slot: number): void;
}

type PreviewNode = {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
};

function nodeText(value: unknown): string {
  if (value === null || typeof value !== 'object') return '';
  const node = value as PreviewNode;
  if (typeof node.text === 'string') return node.text;
  return Array.isArray(node.content) ? node.content.map(nodeText).join(' ') : '';
}

function topBlocks(page: Page): PreviewNode[] {
  return Array.isArray(page.doc.content)
    ? page.doc.content.filter(
        (value): value is PreviewNode => value !== null && typeof value === 'object',
      )
    : [];
}

function cssColour(canvas: HTMLCanvasElement, name: string, fallback: string): string {
  try {
    return getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Draw a cheap but content-bearing preview directly from the stored document.
 * This is deliberately not another page renderer: one title plus the stored
 * block silhouettes makes distant targets distinct at filmstrip scale.
 */
function drawDocumentPreview(
  canvas: HTMLCanvasElement,
  page: Page,
  title: string,
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const paper = cssColour(canvas, '--paper-cream', '#f8f0dc');
  const rule = cssColour(canvas, '--paper-edge', '#d7bd8b');
  const ink = cssColour(canvas, '--ink-sepia', '#513426');
  const wash = cssColour(canvas, '--wash-amber-light', '#efd9a6');
  const sky = cssColour(canvas, '--wash-sky-light', '#cddfe0');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  for (let y = 31; y < canvas.height; y += 16) {
    ctx.beginPath();
    ctx.moveTo(9, y + 0.5);
    ctx.lineTo(95, y + 0.5);
    ctx.stroke();
  }

  // Tiny text is UI micro-copy, so it uses Nunito rather than shrinking a
  // handwriting face below the app's 13px readability floor.
  ctx.fillStyle = wash;
  ctx.fillRect(7, 7, 90, 24);
  ctx.fillStyle = ink;
  ctx.font = '700 13px "Nunito Sans", "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line === '' ? word : `${line} ${word}`;
    if (line !== '' && ctx.measureText(next).width > 84) {
      lines.push(line);
      line = word;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (lines.length < 2 && line !== '') lines.push(line);
  lines.slice(0, 2).forEach((text, index) => ctx.fillText(text, 11, 9 + index * 12));

  const blocks = topBlocks(page).slice(0, 6);
  blocks.forEach((block, index) => {
    const type = typeof block.type === 'string' ? block.type : '';
    const text = nodeText(block).trim();
    const width = Math.max(22, Math.min(80, 24 + ((text.length * 7 + index * 11) % 58)));
    const y = 39 + index * 13;
    if (/image|diagram|tree|graph|timeline|code/i.test(type)) {
      ctx.fillStyle = index % 2 === 0 ? sky : wash;
      ctx.fillRect(11, y, Math.min(width, 76), 9);
      ctx.strokeStyle = ink;
      ctx.strokeRect(11.5, y + 0.5, Math.min(width, 76) - 1, 8);
      return;
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = type === 'heading' ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(type === 'heading' ? 12 : 15, y + 4.5);
    ctx.lineTo(Math.min(94, 12 + width), y + 4.5);
    ctx.stroke();
  });
}

export default function ThumbStrip(props: ThumbStripProps): JSX.Element {
  let stripEl: HTMLDivElement | undefined;
  const canvases = new Map<string, HTMLCanvasElement>();
  const previewSignatures = new Map<string, string>();

  const previewSignature = (page: Page, slot: number): string =>
    JSON.stringify([
      label(page, slot),
      ...topBlocks(page)
        .slice(0, 6)
        .map((block) => [block.type, nodeText(block)]),
    ]);

  const blit = (): void => {
    const live = new Set(props.pages.map((page) => page.id));
    for (const id of previewSignatures.keys()) {
      if (!live.has(id)) previewSignatures.delete(id);
    }
    props.pages.forEach((page, slot) => {
      const canvas = canvases.get(page.id);
      if (canvas === undefined) return;
      const signature = previewSignature(page, slot);
      if (previewSignatures.get(page.id) === signature) return;
      drawDocumentPreview(canvas, page, label(page, slot));
      previewSignatures.set(page.id, signature);
    });
  };

  createEffect(() => {
    // Redraw only when the stored page collection changes. Spread navigation
    // changes selection/scroll position but never the thumbnail's pixels. Do
    // the content-bearing paint in this effect rather than a queued microtask:
    // the latter was observable one recorder frame after the new spread had
    // already landed. The signature keeps ID-only editor normalisation and an
    // unrelated page change from repainting all 48 canvases.
    void props.pages;
    blit();
  });

  /*
   * A TOC/ribbon jump can cross twenty spreads at once. A horizontal scroller
   * keeps its old scrollLeft, which used to leave the strip showing page 1
   * while the current pages sat two thousand pixels off-screen beside page 41.
   *
   * Follow navigation only when the selected pair has actually left the
   * viewport. Recentring every adjacent turn made the whole filmstrip jump at
   * the exact raster-to-DOM handoff even though the next two thumbnails were
   * already in view. A normal page turn should move only the selection ring;
   * a distant TOC/ribbon jump still recentres the otherwise hidden target.
   *
   * Do not put this in `blit()` or document edits would fight a reader who is
   * browsing the strip by hand. Rects are translated back into scroll
   * coordinates rather than using `scrollIntoView`, which can also move the
   * book or the window.
   */
  createEffect(() => {
    const spread = props.currentSpread;
    void props.pages.length;
    queueMicrotask(() => {
      const strip = stripEl;
      if (!strip || spread !== props.currentSpread) return;
      const thumbs = strip.querySelectorAll<HTMLElement>('.nb-thumb');
      const first = thumbs[spread * 2];
      const second = thumbs[spread * 2 + 1] ?? first;
      if (!first || !second) return;

      const stripRect = strip.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      if (
        !thumbnailPairNeedsRecentre(
          stripRect.left,
          stripRect.right,
          firstRect.left,
          secondRect.right,
        )
      ) {
        return;
      }

      const pairCenterInContent =
        strip.scrollLeft + (firstRect.left + secondRect.right) / 2 - stripRect.left;
      strip.scrollLeft = pairCenterInContent - strip.clientWidth / 2;
    });
  });

  const label = (page: Page, slot: number): string =>
    extractHeadings(page.doc)[0]?.text ?? `page ${slot + 1}`;

  return (
    <div
      class="nb-thumb-strip"
      data-testid="thumb-strip"
      aria-label="Page thumbnails"
      ref={stripEl}
    >
      <For each={props.pages}>
        {(page, slot) => (
          <button
            type="button"
            class="nb-thumb"
            classList={{
              'is-current': Math.floor(slot() / 2) === props.currentSpread,
            }}
            data-tooltip={label(page, slot())}
            data-tooltip-side="top"
            aria-label={`Jump to ${label(page, slot())}`}
            onClick={() => props.onJump(slot())}
          >
            <span
              class="nb-thumb-paper has-preview"
              data-thumbnail-source="document"
            >
              <canvas
                width={104}
                height={132}
                ref={(el) => {
                  canvases.set(page.id, el);
                  drawDocumentPreview(el, page, label(page, slot()));
                  previewSignatures.set(
                    page.id,
                    previewSignature(page, slot()),
                  );
                }}
              />
              <span class="nb-thumb-number font-label">{slot() + 1}</span>
            </span>
          </button>
        )}
      </For>
    </div>
  );
}
