export const IMAGE_ANNOTATION_TOOLS = [
  'pencil',
  'pen',
  'brush',
  'highlighter',
  'eraser',
] as const;
export type ImageAnnotationTool = (typeof IMAGE_ANNOTATION_TOOLS)[number];

export const IMAGE_ANNOTATION_COLOURS = [
  { id: 'graphite', label: 'Graphite', value: '#302d2a' },
  { id: 'sepia', label: 'Sepia', value: '#5c4334' },
  { id: 'terracotta', label: 'Terracotta', value: '#a4513f' },
  { id: 'amber', label: 'Amber', value: '#c28a27' },
  { id: 'moss', label: 'Moss', value: '#547044' },
  { id: 'sky', label: 'Ink blue', value: '#426c83' },
  { id: 'violet', label: 'Violet', value: '#6b537d' },
  { id: 'paper', label: 'Paper white', value: '#fffaf0' },
] as const;
export type ImageAnnotationColour =
  (typeof IMAGE_ANNOTATION_COLOURS)[number]['id'];

export const IMAGE_ANNOTATION_SIZES = [2, 4, 7, 12, 20] as const;

export interface ImageAnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageAnnotationStroke {
  readonly id: string;
  readonly tool: Exclude<ImageAnnotationTool, 'eraser'>;
  readonly colour: ImageAnnotationColour;
  readonly size: number;
  readonly points: readonly ImageAnnotationPoint[];
}

const annotationColourIds = new Set<string>(
  IMAGE_ANNOTATION_COLOURS.map((colour) => colour.id),
);
const annotationTools = new Set<string>(
  IMAGE_ANNOTATION_TOOLS.filter((tool) => tool !== 'eraser'),
);

/** Total parser: malformed or retired annotation data simply paints nothing. */
export function parseImageAnnotations(raw: unknown): ImageAnnotationStroke[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const source =
      parsed !== null && typeof parsed === 'object' && 'strokes' in parsed
        ? (parsed as { strokes?: unknown }).strokes
        : null;
    if (!Array.isArray(source)) return [];
    return source.flatMap((candidate, index) => {
      if (candidate === null || typeof candidate !== 'object') return [];
      const stroke = candidate as Record<string, unknown>;
      if (
        typeof stroke.tool !== 'string' ||
        !annotationTools.has(stroke.tool) ||
        typeof stroke.colour !== 'string' ||
        !annotationColourIds.has(stroke.colour) ||
        typeof stroke.size !== 'number' ||
        !Number.isFinite(stroke.size) ||
        !Array.isArray(stroke.points)
      ) {
        return [];
      }
      const points = stroke.points.flatMap((point) => {
        if (point === null || typeof point !== 'object') return [];
        const { x, y } = point as { x?: unknown; y?: unknown };
        return typeof x === 'number' &&
          Number.isFinite(x) &&
          typeof y === 'number' &&
          Number.isFinite(y)
          ? [{ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }]
          : [];
      });
      if (points.length === 0) return [];
      return [
        {
          id:
            typeof stroke.id === 'string' && stroke.id.trim() !== ''
              ? stroke.id
              : `restored-${index}`,
          tool: stroke.tool as ImageAnnotationStroke['tool'],
          colour: stroke.colour as ImageAnnotationColour,
          size: Math.max(1, Math.min(40, stroke.size)),
          points,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function serializeImageAnnotations(
  strokes: readonly ImageAnnotationStroke[],
): string | null {
  if (strokes.length === 0) return null;
  return JSON.stringify({ version: 1, strokes });
}
