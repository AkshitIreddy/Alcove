/**
 * A book opened flat is two boards hinged at the centre, not one closed-cover
 * illustration stretched to landscape.
 *
 * The ordinary cover renderer correctly places a closed book's spine on its
 * left edge. BookView used that same image as the whole open-book backing, so
 * its illustrated spine/ornament axis landed at roughly 13%/56.5% while the
 * real paper hinge is exactly 50%. Compose two real covers instead: mirror the
 * left board, keep the right board upright, and join their spine edges at the
 * mathematical centre. Shelf and pulled-out covers continue using the normal
 * one-board renderer unchanged.
 */

import {
  coverCacheKey,
  renderCover,
  type CoverParams,
} from './covers';

const openCoverCache = new Map<string, string>();
const OPEN_COVER_CACHE_CAPACITY = 24;

/** Exact CSS/background axis shared by both boards and the page gutter. */
export function openCoverHingeFraction(): number {
  return 0.5;
}

export function openCoverDataUrl(
  width: number,
  height: number,
  params: CoverParams,
): string {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const leftWidth = Math.floor(w * openCoverHingeFraction());
  const rightWidth = w - leftWidth;
  const key = [
    'open-v1',
    coverCacheKey(leftWidth, h, params, '', { plate: false }),
    coverCacheKey(rightWidth, h, params, '', { plate: false }),
  ].join('|');
  const cached = openCoverCache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (context === null) return canvas.toDataURL('image/png');

  const leftBoard = renderCover(leftWidth, h, params, '', { plate: false });
  const rightBoard = renderCover(rightWidth, h, params, '', { plate: false });

  // A normal cover's spine is on its left. Mirror the left board so both
  // spine faces meet at one centre hinge and both page blocks face outward.
  context.save();
  context.translate(leftWidth, 0);
  context.scale(-1, 1);
  context.drawImage(leftBoard, 0, 0, leftWidth, h);
  context.restore();
  context.drawImage(rightBoard, leftWidth, 0, rightWidth, h);

  const url = canvas.toDataURL('image/png');
  if (openCoverCache.size >= OPEN_COVER_CACHE_CAPACITY) {
    const oldest = openCoverCache.keys().next().value;
    if (oldest !== undefined) openCoverCache.delete(oldest);
  }
  openCoverCache.set(key, url);
  return url;
}

