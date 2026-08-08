/**
 * src/flip/scene.ts — the complete snapshot scene a GPU page turn owns.
 *
 * A turn is not three anonymous page textures. From its first frame until the
 * atomic return to live DOM it owns a complete two-sheet scene:
 *
 *   live stationary sheet + revealed texture + moving front/back + binding.
 *
 * The stationary leaf deliberately stays live DOM under the transparent half
 * of the canvas; reconstructing a page that never moves made its text react to
 * a turn on the other side. Keeping the rest of the contract explicit prevents
 * the recurring landing-only fixes:
 * the gutter, paper backing, edge stack or destination furniture cannot be
 * invented after p=1 if the renderer needed them at p=0. Page pixels include
 * editor content, media, node views, free marks and backlinks; the chrome is
 * read from the settled spread once at turn start and drawn in the same GL
 * frame as the sheets.
 */

import type { FlipDirection, SpreadNeighbourIds } from './math';
import { paperCreamRgb } from './paperTone';

/** The four complete page snapshots required by one turn. */
export interface FlipSnapshotSceneIds {
  /** The current page opposite the moving leaf. It remains flat underneath. */
  stationary: string | null;
  /** The moving sheet's face visible at p=0. */
  front: string | null;
  /** The moving sheet's reverse, which becomes the destination's inner leaf. */
  back: string | null;
  /** The destination's outer leaf, uncovered below the moving sheet. */
  revealed: string | null;
}

/**
 * Resolve the whole scene, not merely the curling sheet.
 *
 * next: current-left stays underneath; current-right turns; next-left is its
 * back; next-right is revealed. prev is the exact mirror.
 */
export function flipSnapshotSceneIds(
  dir: FlipDirection,
  ids: SpreadNeighbourIds,
): FlipSnapshotSceneIds {
  return dir === 'next'
    ? {
        stationary: ids.left,
        front: ids.right,
        back: ids.nextLeft ?? null,
        revealed: ids.nextRight ?? null,
      }
    : {
        stationary: ids.right,
        front: ids.left,
        back: ids.prevRight ?? null,
        revealed: ids.prevLeft ?? null,
      };
}

export interface FlipSnapshotSceneBitmaps {
  stationary: ImageBitmap | null;
  front: ImageBitmap | null;
  back: ImageBitmap | null;
  revealed: ImageBitmap | null;
}

export type SceneRgba = readonly [r: number, g: number, b: number, a: number];

/** Flat binding paint sampled from the real settled spread at turn start. */
export interface FlipSnapshotSceneStyle {
  gutterWidth: number;
  gutter: SceneRgba;
  threadWidth: number;
  thread: SceneRgba;
  paper: SceneRgba;
  edgeRadius: number;
  leftEdges: readonly FlipSceneEdgeLayer[];
  rightEdges: readonly FlipSceneEdgeLayer[];
  cornerSize: number;
  cornerRadius: number;
  cornerPaper: SceneRgba;
  showCorner: boolean;
}

export interface FlipSceneEdgeLayer {
  x: number;
  y: number;
  color: SceneRgba;
}

/** Space required around the spread for its farthest 8px page edge. */
export const FLIP_SCENE_OVERSCAN_PX = 10;

const FALLBACK_GUTTER: SceneRgba = [93 / 255, 58 / 255, 38 / 255, 0.22];
const FALLBACK_THREAD: SceneRgba = [93 / 255, 58 / 255, 38 / 255, 0.36];
const FALLBACK_DEEP: SceneRgba = [229 / 255, 216 / 255, 187 / 255, 1];
const FALLBACK_EDGE: SceneRgba = [205 / 255, 185 / 255, 145 / 255, 1];

function fallbackEdges(sign: -1 | 1, paper: SceneRgba): FlipSceneEdgeLayer[] {
  return [
    { x: sign * 2, y: 1, color: FALLBACK_DEEP },
    { x: sign * 3.5, y: 2, color: paper },
    { x: sign * 5, y: 3, color: FALLBACK_DEEP },
    { x: sign * 6.5, y: 4, color: paper },
    { x: sign * 8, y: 5, color: FALLBACK_EDGE },
  ];
}

function channel(raw: string): number {
  const value = raw.trim();
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.endsWith('%') ? Math.max(0, Math.min(1, parsed / 100)) : Math.max(0, Math.min(1, parsed / 255));
}

/** Parse the rgb()/rgba() form Chromium exposes for computed colours. */
export function computedRgba(raw: string, fallback: SceneRgba): SceneRgba {
  const match = raw.trim().match(/^rgba?\((.*)\)$/i);
  if (match === null) return fallback;
  const parts = match[1]!
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return fallback;
  const rgb: [number, number, number] = [channel(parts[0]!), channel(parts[1]!), channel(parts[2]!)];
  const alphaRaw = parts[3];
  const alpha =
    alphaRaw === undefined
      ? 1
      : alphaRaw.endsWith('%')
        ? Math.max(0, Math.min(1, Number.parseFloat(alphaRaw) / 100))
        : Math.max(0, Math.min(1, Number.parseFloat(alphaRaw)));
  if (!Number.isFinite(alpha) || rgb.some((value) => !Number.isFinite(value))) return fallback;
  return [rgb[0], rgb[1], rgb[2], alpha];
}

function positivePixels(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitCssLayers(raw: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      layers.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = raw.slice(start).trim();
  if (tail !== '') layers.push(tail);
  return layers;
}

/** Parse the flat, zero-blur box-shadow layers used by the page fore-edges. */
export function computedEdgeLayers(raw: string): FlipSceneEdgeLayer[] {
  const layers: FlipSceneEdgeLayer[] = [];
  for (const layer of splitCssLayers(raw)) {
    const colorMatch = layer.match(/rgba?\([^)]*\)/i);
    if (colorMatch === null) continue;
    const lengths = layer
      .replace(colorMatch[0], '')
      .match(/-?\d*\.?\d+px/g)
      ?.map((value) => Number.parseFloat(value));
    if (lengths === undefined || lengths.length < 2) continue;
    const color = computedRgba(colorMatch[0], FALLBACK_EDGE);
    layers.push({ x: lengths[0]!, y: lengths[1]!, color });
  }
  return layers;
}

function resolvedToken(root: HTMLElement, property: string, fallback: SceneRgba): SceneRgba {
  const probe = document.createElement('span');
  probe.style.cssText =
    `position:absolute;visibility:hidden;pointer-events:none;color:var(${property});`;
  root.append(probe);
  try {
    return computedRgba(getComputedStyle(probe).color, fallback);
  } finally {
    probe.remove();
  }
}

/**
 * Read the actual binding instead of keeping a second palette in the shader.
 * Computed pseudo-element paint is available in WebView2/Chromium and already
 * resolves theme tokens and colour-mix(), so ink/theme changes are present in
 * the scene from its first submitted frame.
 */
export function readFlipSnapshotSceneStyle(root: HTMLElement): FlipSnapshotSceneStyle {
  const spread = root.closest<HTMLElement>('.nb-spread');
  const gutter = spread?.querySelector<HTMLElement>('.nb-spread-gutter') ?? null;
  const leftLeaf = root.querySelector<HTMLElement>('.nb-leaf-paper[data-side="left"]');
  const rightLeaf = root.querySelector<HTMLElement>('.nb-leaf-paper[data-side="right"]');
  const corner = spread?.querySelector<HTMLElement>('.nb-page-curl') ?? null;
  const cream = paperCreamRgb();
  const paper: SceneRgba = [cream[0] / 255, cream[1] / 255, cream[2] / 255, 1];
  if (gutter === null || typeof getComputedStyle !== 'function') {
    return {
      gutterWidth: 26,
      gutter: FALLBACK_GUTTER,
      threadWidth: 2,
      thread: FALLBACK_THREAD,
      paper,
      edgeRadius: 4,
      leftEdges: fallbackEdges(-1, paper),
      rightEdges: fallbackEdges(1, paper),
      cornerSize: 34,
      cornerRadius: 4,
      cornerPaper: FALLBACK_DEEP,
      showCorner: corner !== null,
    };
  }
  try {
    const body = getComputedStyle(gutter);
    const thread = getComputedStyle(gutter, '::after');
    const left = leftLeaf === null ? null : getComputedStyle(leftLeaf);
    const right = rightLeaf === null ? null : getComputedStyle(rightLeaf);
    const cornerStyle = corner === null ? null : getComputedStyle(corner);
    const cornerPaper = resolvedToken(root, '--paper-deep', FALLBACK_DEEP);
    const cornerOpacity = Number.parseFloat(cornerStyle?.opacity ?? '');
    return {
      gutterWidth: positivePixels(body.width, 26),
      gutter: computedRgba(body.backgroundColor, FALLBACK_GUTTER),
      threadWidth: positivePixels(thread.width, 2),
      thread: computedRgba(thread.backgroundColor, FALLBACK_THREAD),
      paper,
      edgeRadius: positivePixels(right?.borderBottomRightRadius ?? '', 4),
      leftEdges:
        left === null || left.boxShadow === 'none'
          ? fallbackEdges(-1, paper)
          : computedEdgeLayers(left.boxShadow),
      rightEdges:
        right === null || right.boxShadow === 'none'
          ? fallbackEdges(1, paper)
          : computedEdgeLayers(right.boxShadow),
      // The turn scene paints the destination leaf's settled dog-ear, never
      // the outgoing page's hover/"ready to fold" transform. Sampling a CSS
      // transition here made the corner shrink or slide when DOM ownership
      // returned after landing.
      cornerSize: positivePixels(cornerStyle?.width ?? '', 34),
      cornerRadius: positivePixels(cornerStyle?.borderBottomRightRadius ?? '', 4),
      cornerPaper: [
        cornerPaper[0],
        cornerPaper[1],
        cornerPaper[2],
        cornerPaper[3] * (Number.isFinite(cornerOpacity) ? cornerOpacity : 0.75),
      ],
      showCorner: corner !== null && cornerStyle?.display !== 'none',
    };
  } catch {
    return {
      gutterWidth: 26,
      gutter: FALLBACK_GUTTER,
      threadWidth: 2,
      thread: FALLBACK_THREAD,
      paper,
      edgeRadius: 4,
      leftEdges: fallbackEdges(-1, paper),
      rightEdges: fallbackEdges(1, paper),
      cornerSize: 34,
      cornerRadius: 4,
      cornerPaper: FALLBACK_DEEP,
      showCorner: corner !== null,
    };
  }
}
