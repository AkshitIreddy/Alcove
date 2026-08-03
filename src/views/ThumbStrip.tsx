/**
 * src/views/ThumbStrip.tsx — the toggleable bottom filmstrip of mini page
 * renders (roadmap #10). Reuses the flip engine's snapshot cache through
 * FlipSurfaceApi.getSnapshot (LRU peek — never disturbs flip textures):
 * pages that have been on screen show their real rasterized ink; pages the
 * cache has not seen yet fall back to a hand-drawn paper chip with the page
 * number. Click a thumb to jump to its spread.
 *
 * Snapshots update out-of-band (idle-time captures), so a slow 1.5s pulse
 * re-blits any thumb whose cached version advanced — drawImage of a tiny
 * bitmap, no rasterization happens here.
 */
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  type JSX,
} from 'solid-js';
import type { Page } from '../data/types';
import type { RasterEntry } from '../flip/rasterCache';
import { extractHeadings } from './toc';

export interface ThumbStripProps {
  pages: readonly Page[];
  currentSpread: number;
  getSnapshot(pageId: string): RasterEntry | undefined;
  onJump(slot: number): void;
}

const REFRESH_MS = 1500;

export default function ThumbStrip(props: ThumbStripProps): JSX.Element {
  const canvases = new Map<string, HTMLCanvasElement>();
  const drawnVersions = new Map<string, number>();
  const [hasBitmap, setHasBitmap] = createSignal<Record<string, boolean>>({});

  const blit = (): void => {
    const seen: Record<string, boolean> = {};
    for (const page of props.pages) {
      const entry = props.getSnapshot(page.id);
      seen[page.id] = entry !== undefined;
      const canvas = canvases.get(page.id);
      if (!entry || !canvas) continue;
      if (drawnVersions.get(page.id) === entry.version) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(entry.bitmap, 0, 0, canvas.width, canvas.height);
      drawnVersions.set(page.id, entry.version);
    }
    setHasBitmap((prev) => {
      for (const key of Object.keys(seen)) {
        if (prev[key] !== seen[key]) return seen;
      }
      return prev;
    });
  };

  createEffect(() => {
    void props.pages.length;
    void props.currentSpread;
    queueMicrotask(blit);
  });
  const timer = setInterval(blit, REFRESH_MS);
  onCleanup(() => clearInterval(timer));

  const label = (page: Page, slot: number): string =>
    extractHeadings(page.doc)[0]?.text ?? `page ${slot + 1}`;

  return (
    <div class="nb-thumb-strip" data-testid="thumb-strip" aria-label="Page thumbnails">
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
              class="nb-thumb-paper"
              classList={{ 'has-snapshot': hasBitmap()[page.id] ?? false }}
            >
              <canvas
                width={104}
                height={132}
                ref={(el) => {
                  canvases.set(page.id, el);
                  drawnVersions.delete(page.id);
                  queueMicrotask(blit);
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
