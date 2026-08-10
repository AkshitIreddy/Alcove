/**
 * Composition guards for the Book Studio's local dice and binding picker.
 *
 * Whole-book Surprise Me has its own art-directed search. These helpers cover
 * the two smaller paths that do not use that search: changing one named
 * binding and throwing the dice beside a single section. They deliberately
 * operate on style data only, so the UI, tests and renderer share one answer
 * to "is this still one coherent binding?".
 */
import {
  MAX_RAISED_BANDS,
  ORNAMENT_NONE,
  normalizeBookStyleOverrides,
  type BookStyle,
  type BookStyleOverrides,
} from '../../art/bookStyle';

/** Fields authored by a complete named/composed binding rather than its size or colour. */
const BINDING_OWNED_STYLE_KEYS = [
  'material',
  'raisedBands',
  'bandGilt',
  'headTail',
  'headTailStyle',
  'ornament',
  'gilt',
  'charm',
  'charmColor',
  'coverFrame',
  'coverMedallion',
  'cornerProtectors',
  'insetPlate',
] as const satisfies readonly (keyof BookStyleOverrides)[];

/**
 * Return the reader-owned style that may honestly survive a binding change.
 *
 * Dimensions, wear, edge treatment, role colours and FRONT-COVER title style
 * survive. Furniture and the coarse covering do not: the newly selected card
 * already authored those, and carrying the previous book's cords, charm and
 * fittings over is what made a clean option apply as a crowded sample sheet.
 */
export function styleAfterBindingChange(
  source: BookStyleOverrides | null | undefined,
): BookStyleOverrides | null {
  const out: BookStyleOverrides = { ...(source ?? {}) };
  for (const key of BINDING_OWNED_STYLE_KEYS) delete out[key];
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Reconcile a per-section dice result against the book already on the stand.
 *
 * The binding reset deliberately has no compatibility mode for applied
 * trinkets or independent cover hardware. Every local throw therefore goes
 * through the same active-value normalizer as persisted books, shares one
 * emblem between spine and cover, and clears the retired furniture even when
 * it arrived through an old theme or an already-open Studio session.
 */
export function reconcileBookStudioSectionRoll(
  current: BookStyle,
  rolled: Partial<BookStyle>,
  keys: readonly (keyof BookStyle)[],
): Partial<BookStyle> {
  const out: Partial<BookStyle> = {
    ...(normalizeBookStyleOverrides(rolled) ?? {}),
    charm: 'none',
    cornerProtectors: false,
    insetPlate: false,
  };
  delete out.charmColor;
  const group = new Set<keyof BookStyle>(keys);

  if (group.has('raisedBands')) {
    // Four cords remain available to a reader, but dice use at most two: a
    // random structural programme should never turn the spine into a ladder.
    const bands = Math.max(
      0,
      Math.min(Math.min(2, MAX_RAISED_BANDS), Math.round(out.raisedBands ?? current.raisedBands)),
    );
    out.raisedBands = bands;
    if (bands === 0) out.bandGilt = false;
  }

  if (group.has('material')) {
    const material = out.material ?? current.material;
    if (material === 'silk' || material === 'marbled') {
      out.ornament = ORNAMENT_NONE;
      out.coverMedallion = ORNAMENT_NONE;
    }
  }

  if (group.has('ornament') || group.has('coverMedallion')) {
    // `normalizeBookStyleOverrides` has already chosen and normalized one
    // emblem when either compatibility field was present. Restate the pair so
    // merging this partial patch cannot leave the old value on the other face.
    const emblem = out.ornament ?? out.coverMedallion ?? ORNAMENT_NONE;
    out.ornament = emblem;
    out.coverMedallion = emblem;
  }

  return out;
}
