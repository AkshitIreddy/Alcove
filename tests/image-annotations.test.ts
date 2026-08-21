import { describe, expect, it } from 'vitest';
import {
  parseImageAnnotations,
  serializeImageAnnotations,
  type ImageAnnotationStroke,
} from '../src/editor/media/imageAnnotations';

const stroke: ImageAnnotationStroke = {
  id: 'mark-one',
  tool: 'highlighter',
  colour: 'amber',
  size: 12,
  points: [
    { x: 0.1, y: 0.2 },
    { x: 0.8, y: 0.72 },
  ],
};

describe('durable image annotations', () => {
  it('round-trips versioned vector strokes without losing their tool settings', () => {
    const saved = serializeImageAnnotations([stroke]);
    expect(saved).toContain('"version":1');
    expect(parseImageAnnotations(saved)).toEqual([stroke]);
  });

  it('is total over malformed persisted node attributes', () => {
    expect(parseImageAnnotations('{not json')).toEqual([]);
    expect(parseImageAnnotations(JSON.stringify({ version: 1, strokes: [{}] }))).toEqual([]);
    expect(parseImageAnnotations(null)).toEqual([]);
  });

  it('clamps imported points and brush sizes to the image vocabulary', () => {
    const restored = parseImageAnnotations(
      JSON.stringify({
        version: 1,
        strokes: [
          {
            ...stroke,
            size: 1000,
            points: [
              { x: -4, y: 9 },
              { x: Number.NaN, y: 0.2 },
            ],
          },
        ],
      }),
    );
    expect(restored).toEqual([
      {
        ...stroke,
        size: 40,
        points: [{ x: 0, y: 1 }],
      },
    ]);
  });

  it('uses null for an empty layer so untouched images stay compact', () => {
    expect(serializeImageAnnotations([])).toBeNull();
  });
});
