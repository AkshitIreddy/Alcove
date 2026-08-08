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

/*
 * Card interior geometry. Exported because `render/TimelineDiagram.tsx` places
 * the label and every body line INSIDE the height computed below, and it had
 * its own copy of these three numbers: the measurer decided a card was
 * `PAD * 2 + LABEL_LINE_H + lines * BODY_LINE_H` tall while the painter
 * independently decided where line `i` sits. Two numbers, one box — change
 * either side alone and the text walks out through the bottom of a card that
 * is still the old size. Same shape as `layout/size.ts`, which already
 * publishes `LABEL_LINE_H` for the tree/graph node boxes.
 */

/** Height of a card's label row (px). */
export const LABEL_LINE_H = 22;
/** Height of one wrapped body line (px). */
export const BODY_LINE_H = 20;
/** Inner padding on every side of a card (px). */
export const PAD = 12;

export function layoutTimeline(
  entries: TimelineEntry[],
  opts: TimelineLayoutOptions = {},
): TimelineLayout {
  const measure = opts.measure ?? measureText;
  /* The editor's default 1280px spread leaves about 387px for one page's
     prose. The old 580px timeline was therefore scaled to two thirds size by
     the SVG viewBox, quietly turning its nominal 15px handwriting into ~10px.
     Keep the primitive inside the real page measure; wrapping makes cards
     taller, and a fixed-height page can paginate that honestly. */
  const cardWidth = opts.cardWidth ?? 160;
  const spineGap = opts.spineGap ?? 16;
  const gapY = opts.gapY ?? 18;
  const margin = opts.margin ?? 12;
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
