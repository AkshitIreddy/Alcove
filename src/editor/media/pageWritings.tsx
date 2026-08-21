/**
 * Durable freehand writing painted over a whole notebook page.
 *
 * The stroke vocabulary is intentionally shared with image annotations. A
 * reader should not have to learn two different pencils merely because one is
 * used over a photograph and the other over paper. Coordinates are normalized
 * to the page, so marks survive window resizing, focus zoom and export sizes.
 */
import { For, type JSX } from 'solid-js';
import {
  IMAGE_ANNOTATION_COLOURS,
  parseImageAnnotations,
  serializeImageAnnotations,
  type ImageAnnotationPoint,
  type ImageAnnotationStroke,
} from './imageAnnotations';

export const PAGE_WRITINGS_ATTR = 'mouseWritings';

export type PageWritingPoint = ImageAnnotationPoint;
export type PageWritingStroke = ImageAnnotationStroke;

export const parsePageWritings = parseImageAnnotations;
export const serializePageWritings = serializeImageAnnotations;

export function pageWritingColour(stroke: PageWritingStroke): string {
  return (
    IMAGE_ANNOTATION_COLOURS.find((colour) => colour.id === stroke.colour)
      ?.value ?? IMAGE_ANNOTATION_COLOURS[0].value
  );
}

export function pageWritingAppearance(stroke: PageWritingStroke): {
  readonly width: number;
  readonly opacity: number;
  readonly linecap: 'round' | 'square';
} {
  switch (stroke.tool) {
    case 'pencil':
      return {
        width: Math.max(1, stroke.size * 0.62),
        opacity: 0.72,
        linecap: 'round',
      };
    case 'brush':
      return { width: stroke.size * 1.75, opacity: 0.9, linecap: 'round' };
    case 'highlighter':
      return { width: stroke.size * 3.2, opacity: 0.3, linecap: 'square' };
    default:
      return { width: stroke.size, opacity: 0.96, linecap: 'round' };
  }
}

export function pageWritingPath(
  stroke: PageWritingStroke,
  viewHeight: number,
): string {
  return stroke.points
    .map((point, index) => {
      const x = Math.round(point.x * 10000) / 10;
      const y = Math.round(point.y * viewHeight * 10) / 10;
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

export function erasePageWritingsAt(
  strokes: readonly PageWritingStroke[],
  point: PageWritingPoint,
  aspect: number,
  size: number,
): PageWritingStroke[] {
  const radius = Math.max(0.009, size / 500);
  return strokes.filter((stroke) =>
    !stroke.points.some((candidate) => {
      const dx = candidate.x - point.x;
      const dy = (candidate.y - point.y) * Math.max(0.1, aspect);
      return Math.hypot(dx, dy) <= radius;
    }),
  );
}

export function PageWritingLayer(props: {
  readonly strokes: readonly PageWritingStroke[];
  readonly aspect: number;
  readonly class?: string;
}): JSX.Element {
  const viewHeight = (): number => Math.max(1, props.aspect * 1000);
  return (
    <svg
      class={props.class ?? 'nb-page-writing'}
      viewBox={`0 0 1000 ${viewHeight()}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <For each={props.strokes}>
        {(stroke) => {
          const appearance = pageWritingAppearance(stroke);
          return (
            <path
              d={pageWritingPath(stroke, viewHeight())}
              fill="none"
              stroke={pageWritingColour(stroke)}
              stroke-width={appearance.width}
              stroke-opacity={appearance.opacity}
              stroke-linecap={appearance.linecap}
              stroke-linejoin="round"
            />
          );
        }}
      </For>
    </svg>
  );
}

/** Vanilla-DOM twin for the offscreen page renderer and export snapshots. */
export function mountStoredPageWritings(
  page: HTMLElement,
  raw: unknown,
): SVGSVGElement | null {
  const strokes = parsePageWritings(raw);
  if (strokes.length === 0) return null;
  const box = page.getBoundingClientRect();
  const aspect = box.width > 0 ? box.height / box.width : 1.414;
  const viewHeight = Math.max(1, aspect * 1000);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'nb-page-writing');
  svg.setAttribute('viewBox', `0 0 1000 ${viewHeight}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  for (const stroke of strokes) {
    const appearance = pageWritingAppearance(stroke);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pageWritingPath(stroke, viewHeight));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', pageWritingColour(stroke));
    path.setAttribute('stroke-width', String(appearance.width));
    path.setAttribute('stroke-opacity', String(appearance.opacity));
    path.setAttribute('stroke-linecap', appearance.linecap);
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  page.appendChild(svg);
  return svg;
}
