/**
 * One semantic bridge from authored binding glyphs to the shared emblem atlas.
 *
 * A named binding owns one focal tool.  Both faces must resolve that tool to
 * the same atlas index or the reader pulls a different-looking book from the
 * one they saw on the shelf.  Keep this tiny module free of renderer imports
 * so bookDesign, bookStyle and the canvas artwork can all consume it without
 * forming a runtime cycle.
 */
export const COVER_EMBLEM_FOR_AUTHORED_FOCAL: Readonly<
  Partial<Record<string, number>>
> = Object.freeze({
  crown: 20,
  sprig: 13,
  laurel: 1,
  palmette: 43,
  fleuron: 12,
  rosette: 23,
  'fleur-de-lis': 26,
  starflower: 2,
  acanthus: 12,
  sunrise: 5,
  'oak-spray': 13,
  thistle: 14,
  'ivy-knot': 1,
  'oak-volutes': 28,
  'wheat-saltire': 29,
  pomegranate: 30,
  tulip: 31,
  pinecone: 13,
  'fern-palmette': 56,
  ginkgo: 31,
  compass: 0,
  shield: 0,
});

/** Resolve the shared atlas tool used on both the spine and front board. */
export function bindingEmblemIndexForAuthoredFocal(
  glyph: string | null | undefined,
): number | undefined {
  return glyph == null ? undefined : COVER_EMBLEM_FOR_AUTHORED_FOCAL[glyph];
}
