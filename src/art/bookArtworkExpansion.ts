/** Authored mood assignments for the append-only book artwork collection.
 * IDs are saved identities, never a proxy for ornament density. */
import type { BookSurpriseDirectionId } from './bookDesign';
import type { TitlePlateStyle } from './spines';

export const EXPANDED_BOOK_TITLES: Readonly<Record<BookSurpriseDirectionId, readonly TitlePlateStyle[]>> = {
  formal: ['navigator-compass-label', 'archivist-index-tab', 'cameo-wreath-label'],
  grand: ['gothic-pointed-panel', 'fanfare-pediment', 'crown-quatrefoil', 'imperial-fan-panel'],
  antique: ['navigator-compass-label', 'archivist-index-tab', 'gothic-pointed-panel', 'cameo-wreath-label'],
  storybook: ['storybook-scallop-cartouche', 'ribbon-tail-cartouche', 'celestial-orbit-roundel'],
  botanical: ['herbarium-caption', 'foliate-shoulder-field', 'cameo-wreath-label'],
  cosy: ['sewn-linen-label', 'field-note-corner-ticket', 'storybook-scallop-cartouche'],
  rustic: ['artisan-notched-label', 'field-note-corner-ticket', 'sewn-linen-label'],
  quiet: ['whisper-rules', 'field-note-corner-ticket', 'herbarium-caption'],
};

export const EXPANDED_BOOK_EMBLEMS: Readonly<Record<BookSurpriseDirectionId, readonly number[]>> = {
  formal: [86, 87, 88, 89], grand: [90, 91, 92, 93],
  antique: [94, 95, 96, 97], storybook: [98, 99, 100, 101],
  botanical: [102, 103, 104, 105], cosy: [106, 107, 108, 109],
  rustic: [110, 111, 112, 113], quiet: [114, 115, 116, 117],
};

export const EXPANDED_BOOK_FRAMES: Readonly<Record<BookSurpriseDirectionId, readonly number[]>> = {
  formal: [56, 57, 58], grand: [59, 60, 61],
  antique: [62, 63, 64], storybook: [65, 66, 67],
  botanical: [68, 69, 70], cosy: [71, 72, 73],
  rustic: [74, 75, 76], quiet: [77, 78, 79],
};

/** Small open rules support a title or emblem; all other additions lead. */
export const EXPANDED_SUPPORTING_FRAMES: readonly number[] = [56, 58, 62, 65, 68, 71, 74, 77, 78, 79];

export function expandedFrameStatement(index: number): number | undefined {
  if (index < 56 || index > 79) return undefined;
  if (EXPANDED_SUPPORTING_FRAMES.includes(index)) return .30;
  if (EXPANDED_BOOK_FRAMES.grand.includes(index)) return 1.55;
  if (EXPANDED_BOOK_FRAMES.antique.includes(index)) return 1.15;
  return .85;
}
