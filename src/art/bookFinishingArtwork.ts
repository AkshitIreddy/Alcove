import type { FlatCtx } from './flat';
import { FLAT } from './flat';
import { compileBookVector, paintBookVector } from './bookVector';
import art0 from '../../assets/book-art/finishing/woven-chevron.svg?raw';
import art1 from '../../assets/book-art/finishing/wrapped-cord.svg?raw';
import art2 from '../../assets/book-art/finishing/solid-silk-roll.svg?raw';
import art3 from '../../assets/book-art/finishing/plain.svg?raw';
import art4 from '../../assets/book-art/finishing/gilt.svg?raw';
import art5 from '../../assets/book-art/finishing/stained-red.svg?raw';
import art6 from '../../assets/book-art/finishing/sepia-edge.svg?raw';
import art7 from '../../assets/book-art/finishing/red-under-gold.svg?raw';
import art8 from '../../assets/book-art/finishing/deckle.svg?raw';
export const BOOK_FINISHING_ART = {
  'woven-chevron': compileBookVector(art0),
  'wrapped-cord': compileBookVector(art1),
  'solid-silk-roll': compileBookVector(art2),
  'plain': compileBookVector(art3),
  'gilt': compileBookVector(art4),
  'stained-red': compileBookVector(art5),
  'sepia-edge': compileBookVector(art6),
  'red-under-gold': compileBookVector(art7),
  'deckle': compileBookVector(art8),
} as const;
export function paintRemasteredEndband(
  ctx: FlatCtx, style: number, x: number, y: number, w: number, h: number,
  accent: string, tooling: string = FLAT.cream,
): void {
  const key = style === 2 ? 'wrapped-cord' : style === 3 ? 'solid-silk-roll' : 'woven-chevron';
  paintBookVector(ctx, BOOK_FINISHING_ART[key], x, y, w, h, {
    '#8d4d43': accent, '#c5a465': tooling, '#432934': FLAT.ink, '#f2e6ce': FLAT.cream,
  });
}
export function paintRemasteredPageEdge(
  ctx: FlatCtx, edge: string, x: number, y: number, w: number, h: number,
): void {
  const key = ['plain', 'gilt', 'stained-red', 'sepia-edge', 'red-under-gold', 'deckle'].includes(edge)
    ? edge as 'plain' | 'gilt' | 'stained-red' | 'sepia-edge' | 'red-under-gold' | 'deckle'
    : 'plain';
  paintBookVector(ctx, BOOK_FINISHING_ART[key], x, y, w, h, { '#432934': FLAT.ink });
}
