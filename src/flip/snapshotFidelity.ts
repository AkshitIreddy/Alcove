/**
 * Pure geometry shared by offscreen page staging and its node-side regression
 * test. DOM ownership stays in offscreenPages.ts; this module only answers how
 * far a prose block is from the next rule.
 */
export function snapshotGridCorrections(
  blocks: readonly { readonly ordinary: boolean; readonly top: number }[],
  pitch: number,
): Array<{ readonly index: number; readonly pixels: number }> {
  if (!Number.isFinite(pitch) || pitch <= 0) return [];
  const corrections: Array<{ index: number; pixels: number }> = [];
  for (let index = 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (!block.ordinary || blocks[index - 1]!.ordinary) continue;
    const phase = ((block.top % pitch) + pitch) % pitch;
    const pixels =
      phase < 0.5 || pitch - phase < 0.5 ? 0 : pitch - phase;
    if (pixels > 0) corrections.push({ index, pixels });
  }
  return corrections;
}
