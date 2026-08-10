import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MATERIALS,
  bookDesignTag,
  bookPainterColours,
  bookPreset,
  type BookPresetId,
} from '../src/art/bookDesign';
import {
  resolveBookSurpriseColourProjection,
  surpriseBookRecipe,
  type BookSurpriseBodyColourSources,
  type BookSurpriseCurrent,
  type BookSurpriseLockId,
  type BookSurprisePalette,
} from '../src/art/bookSurprise';
import {
  resolveBookStyle,
  type BookStyleOverrides,
  type ResolvedBookStyle,
} from '../src/art/bookStyle';
import {
  coverCacheKey,
  coverPainterColours,
  coveringSpecFor,
} from '../src/art/covers';
import { FLAT } from '../src/art/flat';
import { resolveSpineBinding } from '../src/art/spines';

const ROOT = resolve(import.meta.dirname, '..');

type BodyLock = Extract<
  BookSurpriseLockId,
  | 'colour.spine-base'
  | 'colour.spine-accent'
  | 'colour.cover-base'
  | 'colour.cover-accent'
>;

type BodyField = keyof BookSurpriseBodyColourSources;

const BODY_CASES = [
  ['vellum', 'plain-vellum'],
  ['parchment', 'parchment-quarto'],
  ['deep buckram', 'buckram-library'],
  ['split binding', 'half-calf'],
  ['ordinary cloth', 'plain-cloth'],
] as const satisfies readonly (readonly [string, BookPresetId])[];

const BODY_LOCKS = [
  ['colour.spine-base', 'spineBaseHex'],
  ['colour.spine-accent', 'spineAccentHex'],
  ['colour.cover-base', 'coverBaseHex'],
  ['colour.cover-accent', 'coverAccentHex'],
] as const satisfies readonly (readonly [BodyLock, BodyField])[];

interface AppearanceSnapshot {
  resolved: ResolvedBookStyle;
  projection: {
    visible: BookSurprisePalette;
    sources: BookSurpriseBodyColourSources;
  };
}

function appearance(
  bookSeed: number,
  binding: BookPresetId,
  overrides?: BookStyleOverrides,
): AppearanceSnapshot {
  const resolved = resolveBookStyle(bookSeed, undefined, overrides, { binding });
  const spine = resolveSpineBinding({ ...resolved.spine, binding });
  return {
    resolved,
    projection: resolveBookSurpriseColourProjection(spine, resolved.cover, resolved.style),
  };
}

function asCurrent(
  binding: BookPresetId,
  snapshot: AppearanceSnapshot,
): BookSurpriseCurrent {
  return {
    binding,
    style: snapshot.resolved.style,
    pinned: snapshot.resolved.pinned,
    visibleColours: snapshot.projection.visible,
    colourSources: snapshot.projection.sources,
  };
}

function afterSurprise(
  bookSeed: number,
  binding: BookPresetId,
  snapshot: AppearanceSnapshot,
  lock: BodyLock,
  salt: number,
): { recipe: ReturnType<typeof surpriseBookRecipe>; after: AppearanceSnapshot } {
  const recipe = surpriseBookRecipe({
    direction: 'grand',
    seed: (0x71c0_1000 + salt) >>> 0,
    current: asCurrent(binding, snapshot),
    locks: [lock],
    avoidBinding: binding,
  });
  return {
    recipe,
    after: appearance(bookSeed, recipe.preset, recipe.style),
  };
}

describe('Book Studio painter-visible colour locks', () => {
  it('projects wells through vellum, parchment, deep, split and ordinary painters', () => {
    const explicit: BookStyleOverrides = {
      spineBaseHex: '#355f77',
      spineAccentHex: '#a15d4e',
      coverBaseHex: '#426b82',
      coverAccentHex: '#c09348',
      wear: 0,
    };

    for (const [name, binding] of BODY_CASES) {
      const snapshot = appearance(0x4a11_2200, binding, explicit);
      const spine = resolveSpineBinding({ ...snapshot.resolved.spine, binding });
      const spinePaint = bookPainterColours(spine);
      const coverPaint = coverPainterColours(snapshot.resolved.cover);

      expect(snapshot.projection.visible, `${name} spine wells`).toMatchObject({
        spineBaseHex: spinePaint.base,
        spineAccentHex: spinePaint.accent,
      });
      expect(snapshot.projection.visible, `${name} cover wells`).toMatchObject({
        coverBaseHex: coverPaint.visible.base,
        coverAccentHex: coverPaint.visible.accent,
      });
      expect(snapshot.projection.sources, `${name} persists sources`).toEqual({
        spineBaseHex: explicit.spineBaseHex,
        spineAccentHex: explicit.spineAccentHex,
        coverBaseHex: explicit.coverBaseHex,
        coverAccentHex: explicit.coverAccentHex,
      });
    }

    const vellum = appearance(0x4a11_2200, 'plain-vellum', explicit);
    const parchment = appearance(0x4a11_2200, 'parchment-quarto', explicit);
    // Dedicated face colours now tint pale skins instead of disappearing.
    expect(vellum.projection.visible.spineBaseHex).not.toBe(FLAT.cream);
    expect(vellum.projection.visible.coverBaseHex).not.toBe(FLAT.cream);
    expect(parchment.projection.visible.spineBaseHex).not.toBe(FLAT.creamDeep);
    expect(parchment.projection.visible.coverBaseHex).not.toBe(FLAT.cream);
    expect(vellum.projection.visible.spineBaseHex).not.toBe(
      vellum.projection.sources.spineBaseHex,
    );
  });

  it('keeps inherited pale skins natural, honours explicit roles, and resets to inheritance', () => {
    const seed = 0x4a11_2299;
    const shared = '#355f77';

    for (const [binding, naturalSpine] of [
      ['plain-vellum', FLAT.cream],
      ['parchment-quarto', FLAT.creamDeep],
    ] as const satisfies readonly (readonly [BookPresetId, string])[]) {
      const inherited = appearance(seed, binding, { clothHex: shared });
      const explicit = appearance(seed, binding, {
        clothHex: shared,
        spineBaseHex: shared,
        coverBaseHex: shared,
      });
      const reset = appearance(seed, binding, {
        clothHex: shared,
        spineBaseHex: null,
        coverBaseHex: null,
      });

      expect(inherited.projection.visible.spineBaseHex, `${binding} inherited spine`).toBe(
        naturalSpine,
      );
      expect(inherited.projection.visible.coverBaseHex, `${binding} inherited cover`).toBe(
        FLAT.cream,
      );
      expect(explicit.projection.visible.spineBaseHex, `${binding} explicit spine`).not.toBe(
        naturalSpine,
      );
      expect(explicit.projection.visible.coverBaseHex, `${binding} explicit cover`).not.toBe(
        FLAT.cream,
      );
      expect(reset.projection.visible, `${binding} reset pixels`).toMatchObject({
        spineBaseHex: inherited.projection.visible.spineBaseHex,
        coverBaseHex: inherited.projection.visible.coverBaseHex,
      });

      const inheritedDesign = resolveSpineBinding({
        ...inherited.resolved.spine,
        binding,
      });
      const explicitDesign = resolveSpineBinding({
        ...explicit.resolved.spine,
        binding,
      });
      expect(inheritedDesign.cloth).toBe(explicitDesign.cloth);
      expect(inheritedDesign.baseColourPinned).toBe(false);
      expect(explicitDesign.baseColourPinned).toBe(true);
      expect(bookDesignTag(explicitDesign)).not.toBe(bookDesignTag(inheritedDesign));
      expect(coverCacheKey(214, 292, explicit.resolved.cover, 'Colour')).not.toBe(
        coverCacheKey(214, 292, inherited.resolved.cover, 'Colour'),
      );
    }
  });

  it('keeps every inherited body/accent well invariant across Surprise', () => {
    let serial = 0;
    for (const [name, binding] of BODY_CASES) {
      const before = appearance(0x5eed_3100 + serial, binding);
      expect(before.resolved.pinned.has('material'), `${name} material provenance`).toBe(false);

      for (const [lock, field] of BODY_LOCKS) {
        const { recipe, after } = afterSurprise(
          before.resolved.seed,
          binding,
          before,
          lock,
          serial++,
        );
        const body = MATERIALS[bookPreset(binding).material].body;
        const naturalPaleBase =
          (field === 'spineBaseHex' || field === 'coverBaseHex')
          && (body === 'cream' || body === 'parchment');
        expect(recipe.style[field], `${name} ${lock} source`).toBe(
          naturalPaleBase
            ? before.projection.visible[field]
            : before.projection.sources[field],
        );
        expect(after.projection.visible[field], `${name} ${lock} pixels`).toBe(
          before.projection.visible[field],
        );
        expect(recipe.components.material, `${name} ${lock} material transform`).toBe(
          bookPreset(binding).material,
        );
        if (lock === 'colour.spine-base' || lock === 'colour.spine-accent') {
          expect(recipe.style.wear, `${name} ${lock} wear transform`).toBe(
            before.resolved.style.wear,
          );
        }
      }
    }
  });

  it('keeps explicit sources invariant without applying deep/wear folds twice', () => {
    const explicit: BookStyleOverrides = {
      spineBaseHex: '#31566f',
      spineAccentHex: '#a34f4a',
      coverBaseHex: '#40657b',
      coverAccentHex: '#bc8245',
      wear: 0.67,
    };
    let serial = 100;

    for (const [name, binding] of BODY_CASES) {
      const before = appearance(0x6eed_4100 + serial, binding, explicit);
      for (const [lock, field] of BODY_LOCKS) {
        const { recipe, after } = afterSurprise(
          before.resolved.seed,
          binding,
          before,
          lock,
          serial++,
        );
        expect(recipe.style[field], `${name} ${lock} raw source`).toBe(explicit[field]);
        expect(after.projection.visible[field], `${name} ${lock} visible result`).toBe(
          before.projection.visible[field],
        );
      }
    }
  });

  it('couples a pinned material override while a body colour is held', () => {
    const binding = 'half-calf';
    const before = appearance(0x7712_4410, binding, {
      material: 'vellum',
      coverBaseHex: '#31566f',
      wear: 0.61,
    });
    expect(before.resolved.pinned.has('material')).toBe(true);
    expect(coveringSpecFor(before.resolved.cover).id).toBe('vellum');

    const { recipe, after } = afterSurprise(
      before.resolved.seed,
      binding,
      before,
      'colour.cover-base',
      999,
    );
    expect(recipe.style.material).toBe('vellum');
    expect(coveringSpecFor(after.resolved.cover).id).toBe('vellum');
    expect(after.projection.visible.coverBaseHex).toBe(
      before.projection.visible.coverBaseHex,
    );
  });

  it('cancels a queued picker-return target before resolving a newer preview click', () => {
    const source = readFileSync(resolve(ROOT, 'src/views/rail/BookStudio.tsx'), 'utf8');
    const start = source.indexOf('const revealControl = (target: BookStudioControlTarget)');
    const end = source.indexOf('\n  onCleanup(() => {', start);
    const body = source.slice(start, end);
    const cancellation = body.indexOf('cancelPendingControlReveal();');
    const lookup = body.indexOf('const control = studioRoot?.querySelector');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(cancellation).toBeGreaterThanOrEqual(0);
    expect(cancellation).toBeLessThan(lookup);
    expect(body).toContain('revealControl(target);');
  });
});
