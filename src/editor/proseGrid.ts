/**
 * One ruling-alignment rule for live writing and offscreen page faces.
 * Compact headings and transparent columns participate just like prose;
 * skipping an ordinary-to-ordinary transition makes ink jump at flip landing.
 */
export const PROSE_GRID_SELECTOR =
  'p, h1, h2, h3, h4, ul, ol, blockquote, [data-type="columns"]';

export function proseGridCorrections(
  blocks: readonly {
    readonly ordinary: boolean;
    readonly top: number;
    /** Padding already present in measured live geometry; staged faces start at zero. */
    readonly appliedCorrection?: number;
  }[],
  pitch: number,
): Array<{ readonly index: number; readonly pixels: number }> {
  if (!Number.isFinite(pitch) || pitch <= 0) return [];
  const corrections: Array<{ index: number; pixels: number }> = [];
  let upstreamChange = -(blocks[0]?.appliedCorrection ?? 0);
  for (let index = 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    let pixels = 0;
    if (block.ordinary && Number.isFinite(block.top)) {
      const top = block.top + upstreamChange;
      const phase = ((top % pitch) + pitch) % pitch;
      pixels = phase < 0.5 || pitch - phase < 0.5 ? 0 : pitch - phase;
    }
    if (pixels > 0) corrections.push({ index, pixels });
    // Padding moves every later block. Replace the old contribution rather
    // than accumulating it again when ResizeObserver measures the live page.
    upstreamChange += pixels - (block.appliedCorrection ?? 0);
  }
  return corrections;
}
