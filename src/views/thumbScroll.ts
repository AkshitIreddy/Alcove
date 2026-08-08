/**
 * Decide whether the selected thumbnail pair has left the visible filmstrip.
 * Kept outside the Solid component so the navigation seam has a browser-free
 * regression test.
 */
export function thumbnailPairNeedsRecentre(
  stripLeft: number,
  stripRight: number,
  firstLeft: number,
  secondRight: number,
  inset = 8,
): boolean {
  return firstLeft < stripLeft + inset || secondRight > stripRight - inset;
}
