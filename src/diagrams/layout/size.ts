/**
 * src/diagrams/layout/size.ts — node box sizing shared by tree/graph layouts.
 *
 * Pure: sizes come from an injectable TextMeasurer (canvas measureText in the
 * app, deterministic heuristic in tests). Shape padding is baked into the
 * box so layouts never care which shape renders inside.
 */

import type { Attrs } from '../../script/types';
import { measureText, type TextMeasurer } from '../measure';
import { isDiagramShape, type DiagramShape } from '../types';

/** Label font — Architects Daughter (never below the 13px handwriting floor). */
export const LABEL_FONT = '14px "Architects Daughter", cursive';
export const NOTE_FONT = '13px "Architects Daughter", cursive';

export const LABEL_LINE_H = 20;
export const NOTE_LINE_H = 16;

export interface NodeBoxOptions {
  measure?: TextMeasurer;
  minWidth?: number;
  maxWidth?: number;
}

export interface NodeBox {
  width: number;
  height: number;
  shape: DiagramShape;
}

export function shapeOf(attrs: Attrs | undefined): DiagramShape {
  const raw = attrs?.shape;
  return isDiagramShape(raw) ? raw : 'rect';
}

/**
 * Size one node box for a label (+ optional note line). Cloud and circle
 * shapes get extra padding so the drawn outline clears the text.
 */
export function nodeBox(
  label: string,
  note: string | undefined,
  attrs: Attrs | undefined,
  opts: NodeBoxOptions = {},
): NodeBox {
  const measure = opts.measure ?? measureText;
  const minWidth = opts.minWidth ?? 56;
  const maxWidth = opts.maxWidth ?? 280;
  const shape = shapeOf(attrs);

  const labelW = measure(label === '' ? ' ' : label, LABEL_FONT);
  const noteW = note !== undefined ? measure(note, NOTE_FONT) : 0;
  const textW = Math.max(labelW, noteW);

  let padX = 16;
  let padY = 8;
  if (shape === 'cloud') {
    padX = 26;
    padY = 16;
  } else if (shape === 'circle') {
    padX = 22;
    padY = 14;
  }

  const width = Math.min(maxWidth, Math.max(minWidth, textW + padX * 2));
  const height =
    LABEL_LINE_H + (note !== undefined ? NOTE_LINE_H : 0) + padY * 2;
  return { width, height, shape };
}
