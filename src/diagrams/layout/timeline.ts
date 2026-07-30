/**
 * src/diagrams/layout/timeline.ts — vertical spine with alternating cards.
 *
 * Entries hang off a central hand-ruled spine, cards alternating left/right,
 * each connected to a dot on the spine. Pure + deterministic; heights come
 * from the injectable text measurer (canvas measureText in the app).
 *
 * Invariants (tested): dots descend strictly in entry order; sides alternate
 * starting left; cards never overlap vertically on the same side.
 */

import type { TimelineEntry } from '../../script/types';
import { wrapText, measureText, type TextMeasurer } from '../measure';
import type { LaidTimelineCard, TimelineLayout } from '../types';

export interface TimelineLayoutOptions {
  measure?: TextMeasurer;
  /** Card width (px). */
  cardWidth?: number;
  /** Horizontal gap between card and spine (px). */
  spineGap?: number;
  /** Minimum vertical gap between consecutive cards on the same side (px). */
  gapY?: number;
  margin?: number;
}

const BODY_FONT = '15px "Patrick Hand", cursive';
const LABEL_LINE_H = 22;
const BODY_LINE_H = 20;
const PAD = 12;

export function layoutTimeline(
  entries: TimelineEntry[],
  opts: TimelineLayoutOptions = {},
): TimelineLayout {
  const measure = opts.measure ?? measureText;
  const cardWidth = opts.cardWidth ?? 240;
  const spineGap = opts.spineGap ?? 34;
  const gapY = opts.gapY ?? 18;
  const margin = opts.margin ?? 16;
  const warnings: string[] = [];

  const spineX = margin + cardWidth + spineGap;
  const width = spineX + spineGap + cardWidth + margin;

  const cards: LaidTimelineCard[] = [];
  // Independent cursors per side so opposite cards may overlap vertically
  // (that is the classic staggered look) but same-side cards never do.
  const sideBottom: Record<'left' | 'right', number> = {
    left: margin,
    right: margin,
  };
  // Dots must strictly descend in entry order.
  let lastDotY = margin - 1;

  entries.forEach((entry, index) => {
    const side: 'left' | 'right' = index % 2 === 0 ? 'left' : 'right';
    const textLines =
      entry.text === ''
        ? []
        : wrapText(entry.text, cardWidth - PAD * 2, BODY_FONT, measure);
    const hasLabel = entry.label !== '';
    if (!hasLabel && textLines.length === 0) {
      warnings.push(`timeline entry ${index + 1} is empty — skipped`);
      return;
    }
    const height =
      PAD * 2 +
      (hasLabel ? LABEL_LINE_H : 0) +
      textLines.length * BODY_LINE_H;

    // Stagger: drop below the previous same-side card, and keep the dot
    // below the previous entry's dot.
    const minTopForDot = lastDotY + 14 - PAD - (hasLabel ? LABEL_LINE_H / 2 : 8);
    const y = Math.max(sideBottom[side] + (cards.length > 0 ? gapY : 0), minTopForDot, margin);
    const dotY = y + PAD + (hasLabel ? LABEL_LINE_H / 2 : Math.max(8, height / 2 - PAD));

    cards.push({
      index,
      side,
      label: entry.label,
      textLines,
      x: side === 'left' ? margin : spineX + spineGap,
      y,
      width: cardWidth,
      height,
      dotY,
      ...(entry.attrs !== undefined ? { attrs: entry.attrs } : {}),
    });
    sideBottom[side] = y + height;
    lastDotY = dotY;
  });

  const height =
    Math.max(sideBottom.left, sideBottom.right, margin) + margin;
  return { spineX, cards, width, height, warnings };
}
