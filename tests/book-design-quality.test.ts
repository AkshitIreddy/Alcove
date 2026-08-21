import { describe, expect, it } from 'vitest';

import {
  BOOK_PRESET_IDS,
  BOOK_PRESETS,
  BOOK_SURPRISE_DIRECTIONS,
  DECORS,
  FORMAL_BOOK_PRESET_ID,
  MATERIALS,
  RETIRED_BOOK_PRESET_IDS,
  RETIRED_DECORATIONS,
  RETIRED_MATERIAL_LOOKS,
  RETIRED_SPINE_SHAPES,
  ROLLABLE_DECORATIONS,
  ROLLABLE_MATERIALS,
  ROLLABLE_PRESETS,
  ROLLABLE_SHAPES,
  SHAPES,
  bookBodyColours,
  bookDesignTag,
  bookPreset,
  normaliseBookPresetId,
  ownBindingId,
  parseOwnBinding,
  presetForSeed,
  resolveBookDesign,
  surpriseBookPreset,
} from '../src/art/bookDesign';
import {
  BOOK_SURPRISE_PALETTES,
  bookPresetAllowedByCuration,
  bookColourContrast,
  surpriseBookRecipe,
} from '../src/art/bookSurprise';
import {
  bindingOptions,
  ownAxisOptions,
  type BindingCardOptions,
} from '../src/views/rail/designOptions';
import {
  normalizeBookStyleOverrides,
  resolveBookStyle,
} from '../src/art/bookStyle';
import {
  coverBodyColours,
  coverCacheKey,
  coveringSpecFor,
  resolveCoverTitleColours,
} from '../src/art/covers';
import {
  TITLE_TEXT_MIN_CONTRAST,
  colourContrast,
} from '../src/art/titleContrast';
import {
  ORNAMENT_COUNT,
  ORNAMENT_LABELS,
  ORNAMENT_TAGS,
} from '../src/art/spines';

describe('book binding quality vocabulary', () => {
  it('offers a compact book-like silhouette domain while retaining legacy diagnostics', () => {
    expect(ROLLABLE_SHAPES).toEqual([
      'square',
      'tight-back',
      'double-hinge',
    ]);
    expect(new Set(ROLLABLE_SHAPES).size).toBe(ROLLABLE_SHAPES.length);
    expect(RETIRED_SPINE_SHAPES.length).toBeGreaterThan(20);

    for (const id of ROLLABLE_SHAPES) {
      expect(SHAPES[id]).toBeDefined();
      expect(RETIRED_SPINE_SHAPES).not.toContain(id);
    }
    expect(ROLLABLE_SHAPES).not.toContain('spiral-wire');
    expect(ROLLABLE_SHAPES).not.toContain('ring-binder');
    expect(ROLLABLE_SHAPES).not.toContain('rolled');
    expect(ROLLABLE_SHAPES).not.toContain('wave-head');
    expect(ROLLABLE_SHAPES).not.toContain('slipcased');
    expect(ROLLABLE_SHAPES).not.toContain('clamshell');
    expect(ROLLABLE_SHAPES).not.toContain('japanese-stab');
    expect(ROLLABLE_SHAPES).not.toContain('pamphlet-thin');
    expect(ROLLABLE_SHAPES).not.toContain('saddle-stapled');
    expect(ROLLABLE_SHAPES).not.toContain('yapp');
  });

  it('keeps every offered preset inside the active shape, material and tooling domains', () => {
    const shapes = new Set(ROLLABLE_SHAPES);
    const materials = new Set(ROLLABLE_MATERIALS);
    const decorations = new Set(ROLLABLE_DECORATIONS);

    expect(BOOK_PRESETS.length).toBeGreaterThan(50);
    expect(RETIRED_BOOK_PRESET_IDS.length).toBeGreaterThan(20);
    for (const preset of BOOK_PRESETS) {
      expect(shapes.has(preset.shape)).toBe(true);
      expect(materials.has(preset.material)).toBe(true);
      expect(preset.decorations.every((id) => decorations.has(id))).toBe(true);
      expect(RETIRED_BOOK_PRESET_IDS).not.toContain(preset.id);
    }

    for (const id of ROLLABLE_MATERIALS) expect(MATERIALS[id]).toBeDefined();
    for (const id of ROLLABLE_DECORATIONS) expect(DECORS[id]).toBeDefined();
    expect(RETIRED_MATERIAL_LOOKS).toContain('snakeskin');
    expect(RETIRED_DECORATIONS).toContain('bee-diaper');
  });

  it('uses explicit coherent pools for every Surprise direction', () => {
    const active = new Set(BOOK_PRESET_IDS);
    expect(BOOK_SURPRISE_DIRECTIONS.map((direction) => direction.id)).toEqual([
      'formal',
      'grand',
      'antique',
      'storybook',
      'botanical',
      'cosy',
      'rustic',
      'quiet',
    ]);

    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      expect(direction.presetIds.length).toBeGreaterThanOrEqual(10);
      expect(new Set(direction.presetIds).size).toBe(direction.presetIds.length);
      for (const id of direction.presetIds) {
        expect(active.has(id), `${direction.id}:${id} must remain an active preset`).toBe(true);
      }

      const pool = new Set(direction.presetIds);
      for (let seed = 0; seed < 256; seed += 1) {
        expect(pool.has(surpriseBookPreset(direction.id, seed).id)).toBe(true);
      }
    }
  });

  it('never lets the ordinary seed path escape the vetted Surprise union', () => {
    const pool = new Set(ROLLABLE_PRESETS.map((preset) => preset.id));
    expect(pool.size).toBeGreaterThan(30);
    for (let seed = 0; seed < 4096; seed += 1) {
      const preset = presetForSeed(seed);
      expect(pool.has(preset.id)).toBe(true);
      expect(RETIRED_BOOK_PRESET_IDS).not.toContain(preset.id);
    }
  });

  it('keeps every granular spine role in binding and component-card cache keys', () => {
    const base: BindingCardOptions = {
      seed: 0x51a1,
      cloth: '#425c72',
      accent: '#8b4c52',
      tooling: '#edcf74',
      emblem: '#f4dda0',
      hardware: '#b98642',
      gilt: true,
      focusAt: 0.28,
    };
    const bindingKey = bindingOptions(base)[0]?.artKey;
    expect(bindingKey).toBeDefined();

    const changed: readonly Partial<BindingCardOptions>[] = [
      { cloth: '#315b50' },
      { accent: '#714552' },
      { tooling: '#432934' },
      { emblem: '#ead081' },
      { hardware: '#8f6637' },
    ];
    for (const role of changed) {
      expect(bindingOptions({ ...base, ...role })[0]?.artKey).not.toBe(bindingKey);
    }

    const current = {
      shape: ROLLABLE_SHAPES[0]!,
      material: ROLLABLE_MATERIALS[0]!,
      decoration: ROLLABLE_DECORATIONS[0]!,
      gilt: true,
    };
    const axisKey = ownAxisOptions(base, current, 'shape')[0]?.artKey;
    expect(axisKey).toBeDefined();
    for (const role of changed) {
      expect(
        ownAxisOptions({ ...base, ...role }, current, 'shape')[0]?.artKey,
      ).not.toBe(axisKey);
    }
  });

  it('keeps removed bindings and binding components out of whole-book Surprise', () => {
    const target = BOOK_PRESETS.find(
      (preset) => preset.decorations.length > 0,
    );
    expect(target).toBeDefined();
    if (target === undefined) return;

    const mark = target.decorations[0]!;
    const legacyOwnId = ownBindingId({
      shape: target.shape,
      material: target.material,
      decoration: mark,
      gilt: target.gilt,
    });
    expect(
      bookPresetAllowedByCuration(target, { bindings: [target.id] }),
    ).toBe(false);
    expect(
      bookPresetAllowedByCuration(target, { shapes: [target.shape] }),
    ).toBe(false);
    expect(
      bookPresetAllowedByCuration(target, { materials: [target.material] }),
    ).toBe(false);
    expect(
      bookPresetAllowedByCuration(target, { decorations: [mark] }),
    ).toBe(false);
    // Compatibility with curation rows written before component ids were
    // stored directly: the complete own-binding id still hides each part.
    expect(
      bookPresetAllowedByCuration(target, { shapes: [legacyOwnId] }),
    ).toBe(false);
    expect(
      bookPresetAllowedByCuration(target, { materials: [legacyOwnId] }),
    ).toBe(false);
    expect(
      bookPresetAllowedByCuration(target, { decorations: [legacyOwnId] }),
    ).toBe(false);

    const direction = BOOK_SURPRISE_DIRECTIONS[0]!;
    const directionIds = new Set(direction.presetIds);
    const soleAllowed = ROLLABLE_PRESETS.find(
      (preset) => !directionIds.has(preset.id),
    );
    expect(soleAllowed).toBeDefined();
    if (soleAllowed === undefined) return;
    const guard = (preset: (typeof ROLLABLE_PRESETS)[number]) =>
      preset.id === soleAllowed.id;
    const first = surpriseBookRecipe(direction.id, 0xabc123, guard);
    const second = surpriseBookRecipe(direction.id, 0xabc123, guard);
    expect(first).toEqual(second);
    expect(first.preset).toBe(soleAllowed.id);
  });

  it('recovers invalid and retired saved bindings to one formal book', () => {
    expect(BOOK_PRESET_IDS).toContain(FORMAL_BOOK_PRESET_ID);
    expect(bookPreset(FORMAL_BOOK_PRESET_ID).shape).toBe('square');

    for (const stale of [
      'scroll-case',
      'wire-notebook',
      'future-experimental-binding',
      'own:spiral-wire/smooth-cloth/plain/blind',
      'own:square/snakeskin/plain/blind',
      'own:square/smooth-cloth/bee-diaper/gilt',
    ]) {
      expect(parseOwnBinding(stale)).toBeNull();
      expect(normaliseBookPresetId(stale)).toBe(FORMAL_BOOK_PRESET_ID);
      expect(bookPreset(stale).id).toBe(FORMAL_BOOK_PRESET_ID);
    }

    const validOwn = 'own:tight-back/polished-calf/quarto-grand-fillet/gilt';
    expect(parseOwnBinding(validOwn)).not.toBeNull();
    expect(normaliseBookPresetId(validOwn)).toBe(validOwn);
    expect(normaliseBookPresetId(null)).toBeNull();
    expect(normaliseBookPresetId({ id: 'gilt-quarto' })).toBeNull();
  });

  it('keeps stable ornament indices while giving active slots honest binder-tool labels', () => {
    expect(ORNAMENT_COUNT).toBe(86);
    expect(ORNAMENT_LABELS).toHaveLength(ORNAMENT_COUNT);
    expect(ORNAMENT_TAGS).toHaveLength(ORNAMENT_COUNT);
    expect(ORNAMENT_LABELS.slice(0, 4)).toEqual([
      'Diamond', 'Broad laurel branch', 'Foliate starflower', 'Acanthus arabesque',
    ]);
    expect(ORNAMENT_LABELS[49]).toBe('Heart');
    expect(ORNAMENT_LABELS.slice(50)).toEqual([
      'Owl',
      'Stag',
      'Fox',
      'Cat',
      'Hare',
      'Moth',
      'Split fern palmette',
      'Paired ginkgo fans',
      'Mushroom',
      'Telescope',
      'Globe',
      'Classical column',
      'Torch',
      'Balance scales',
      'Castle',
      'Lamp of learning',
      'Acanthus spear',
      'Carnation bloom',
      'Iris fan',
      'Artichoke finial',
      'Poppy seedhead',
      'Olive spray',
      'Strawberry sprig',
      'Vine cluster',
      'Honeysuckle scroll',
      'Lotus palmette',
      'Maple samara spray',
      'Willow catkin',
      'Rowan spray',
      'Columbine bell',
      'Primrose stem',
      'Dog-rose branch',
      'Cedar cone spray',
      'Reed bundle',
      'Moresque knot',
      'Tudor rose standard',
    ]);
  });

  // Register one exhaustive test per authored direction. This still exercises
  // all 4,096 seeds twice, but no single Vitest case owns eight independent
  // sweeps and brushes the global ten-second timeout on a busy machine.
  for (const direction of BOOK_SURPRISE_DIRECTIONS) {
    it(`builds deterministic coherent ${direction.id} whole-book recipes`, () => {
      let failureCount = 0;
      const failureSamples: string[] = [];
      const check = (condition: boolean, detail: string): void => {
        if (condition) return;
        failureCount += 1;
        // Keep a broken sweep readable. Every seed is still evaluated; only
        // the error payload is capped so one systemic defect does not allocate
        // thousands of matcher objects before reporting useful examples.
        if (failureSamples.length < 40) failureSamples.push(detail);
      };

      const presetPool = new Set(direction.presetIds);
      for (let seed = 0; seed < 512; seed += 1) {
        const first = surpriseBookRecipe(direction.id, seed);
        const second = surpriseBookRecipe(direction.id, seed);
        const at = `${direction.id}:${seed}`;
        check(JSON.stringify(second) === JSON.stringify(first), `${at} is not deterministic`);
        check(presetPool.has(first.preset), `${at} escaped its direction pool with ${first.preset}`);
        check(
          !Object.prototype.hasOwnProperty.call(first.style, 'material'),
          `${at} unexpectedly pinned the coarse cover material`,
        );

        const style = first.style;
        const preset = bookPreset(first.preset);
        const [spineFace] = bookBodyColours(resolveBookDesign({
          seed,
          preset: first.preset,
          cloth: style.spineBaseHex as string,
          baseColourPinned: true,
          accent: style.spineAccentHex as string,
        }));
        const [coverFace] = coverBodyColours(
          preset.material,
          style.coverBaseHex as string,
          true,
        );
        check(
          bookColourContrast(style.toolingHex as string, spineFace) >= 2.35,
          `${at} tooling fails spine contrast`,
        );
        check(
          bookColourContrast(style.toolingHex as string, coverFace) >= 2.35,
          `${at} tooling fails cover contrast`,
        );
        check(
          bookColourContrast(style.emblemHex as string, spineFace) >= 2.35,
          `${at} emblem fails spine contrast`,
        );
        if (direction.id === 'rustic') {
          check(style.titlePlate !== 'none', `${at} gave a rustic book no title plate`);
        }
      }

      expect({ failureCount, failureSamples }).toEqual({ failureCount: 0, failureSamples: [] });
    });
  }

  it('keeps every Surprise direction backed by several authored palettes', () => {
    for (const palettes of Object.values(BOOK_SURPRISE_PALETTES)) {
      expect(palettes.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('normalizes and projects independent colour roles without cross-surface coupling', () => {
    const normalized = normalizeBookStyleOverrides({
      spineBaseHex: '#123456',
      spineAccentHex: '#654321',
      coverBaseHex: '#345678',
      coverAccentHex: '#876543',
      toolingHex: '#ead081',
      emblemHex: '#f0dda0',
      hardwareHex: '#b38242',
      titleScale: 99,
      titleSpace: -1,
    });
    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('titleScale');
    expect(normalized).not.toHaveProperty('titleSpace');
    expect(normalized).not.toHaveProperty('hardwareHex');

    const resolved = resolveBookStyle(123, undefined, normalized);
    expect(resolved.spine.spineBaseHex).toBe('#123456');
    expect(resolved.spine.spineAccentHex).toBe('#654321');
    expect('coverBaseHex' in resolved.spine).toBe(false);
    expect(resolved.cover.coverBaseHex).toBe('#345678');
    expect(resolved.cover.coverAccentHex).toBe('#876543');
    expect(resolved.cover.toolingHex).toBe('#ead081');
    expect(resolved.cover.emblemHex).toBe('#f0dda0');
    expect(resolved.cover.hardwareHex).toBeNull();

    const changed = { ...resolved.cover, coverBaseHex: '#704050' };
    expect(coverCacheKey(300, 420, changed, 'A')).not.toBe(
      coverCacheKey(300, 420, resolved.cover, 'A'),
    );

    const design = resolveBookDesign({ seed: 123, preset: 'gilt-quarto' });
    expect(bookDesignTag({ ...design, seed: design.seed + 1 })).not.toBe(bookDesignTag(design));
    expect(bookDesignTag({ ...design, focusAt: design.focusAt + 0.01 })).not.toBe(
      bookDesignTag(design),
    );
    expect(bookDesignTag({ ...design, wear: design.wear + 0.001 })).not.toBe(
      bookDesignTag(design),
    );
    expect(bookDesignTag({ ...design, decorations: [...design.decorations, 'plain'] })).not.toBe(
      bookDesignTag(design),
    );
    expect(bookDesignTag({ ...design, tooling: '#ead081' })).not.toBe(bookDesignTag(design));
    expect(bookDesignTag({ ...design, emblem: '#f0dda0' })).not.toBe(bookDesignTag(design));
    expect(bookDesignTag({ ...design, hardware: '#b38242' })).not.toBe(bookDesignTag(design));
  });

  it('projects the exact binding material onto the cover unless material was explicitly pinned', () => {
    for (const direction of BOOK_SURPRISE_DIRECTIONS) {
      for (let seed = 0; seed < 256; seed += 1) {
        const recipe = surpriseBookRecipe(direction.id, seed);
        const preset = bookPreset(recipe.preset);
        const resolved = resolveBookStyle(seed, undefined, recipe.style, {
          binding: recipe.preset,
        });
        expect(coveringSpecFor(resolved.cover).id).toBe(preset.material);

        const coverTitle = resolveCoverTitleColours(resolved.cover, 'Winter Herbarium');
        const directTitle = [
          'none', 'direct-blind-title', 'direct-gilt-title', 'direct-ink-title',
          'press-small-caps', 'printer-floret-imprint',
          'oxford-blind-compartment', 'cambridge-calf-compartment',
          'french-triple-fillet', 'ledger-open-field',
          'inscription-shoulders', 'renaissance-title-window',
        ].includes(resolved.cover.titlePlate ?? '');
        const titleContrastFloor = directTitle
          // Direct tooling is intentionally the board's own field. Forcing
          // the physical-label floor used to fabricate a filled UI card
          // behind mid-tone calf/cloth. The visually inspected direct anchors
          // remain clear at 3.0 because they are large identity lettering,
          // while physical labels retain the stricter universal floor.
          ? 3
          : TITLE_TEXT_MIN_CONTRAST;
        expect(
          colourContrast(coverTitle.ink, coverTitle.ground),
          `${direction.id}:${seed}:${recipe.preset}:${recipe.style.titlePlate}:${resolved.cover.titlePlate}:${JSON.stringify(coverTitle)}`,
        ).toBeGreaterThanOrEqual(titleContrastFloor);
      }
    }

    const explicit = resolveBookStyle(8, undefined, { material: 'paper' }, {
      binding: 'brocade-anthology',
    });
    expect(coveringSpecFor(explicit.cover).id).toBe('paper-wrapper');
  });
});
