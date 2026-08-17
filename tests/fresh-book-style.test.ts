import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FRESH_BOOK_PROPORTION_RANGE,
  freshBookStyleOverrides,
  resolveBookStyle,
} from '../src/art/bookStyle';
import { MATERIALS, presetForSeed } from '../src/art/bookDesign';
import {
  COVER_TEXTURES,
  coverFrameSupportsHangingAccent,
} from '../src/art/covers';
import { formatForHeight, resolveSpineBinding } from '../src/art/spines';
import { createBook } from '../src/data/books';

afterEach(() => {
  vi.restoreAllMocks();
});

function sweptSeed(index: number): number {
  return Math.imul(index ^ 0x6d2b79f5, 0x9e3779b1) >>> 0;
}

describe('fresh ordinary-book recipes', () => {
  it('stay deterministic, proportionate and compositionally restrained across a broad seed sweep', () => {
    const failures: string[] = [];
    const formats = new Set<string>();
    const furniture = new Set<string>();
    const presets = new Set<string>();

    for (let index = 0; index < 8192; index += 1) {
      const seed = sweptSeed(index);
      const recipe = freshBookStyleOverrides(seed);
      const repeated = freshBookStyleOverrides(seed);
      const preset = presetForSeed(seed);
      const prefix = `seed ${seed} (${preset.id})`;

      if (JSON.stringify(recipe) !== JSON.stringify(repeated)) {
        failures.push(`${prefix}: recipe was not deterministic`);
      }
      for (const forbidden of [
        'material',
        'pigment',
        'hueJitter',
        'titleScale',
        'titleSpace',
      ] as const) {
        if (Object.prototype.hasOwnProperty.call(recipe, forbidden)) {
          failures.push(`${prefix}: fresh recipe pinned ${forbidden}`);
        }
      }

      const height = recipe.height;
      const thickness = recipe.thickness;
      if (typeof height !== 'number' || typeof thickness !== 'number') {
        failures.push(`${prefix}: missing coupled height/thickness`);
        continue;
      }
      const ratio = thickness / height;
      if (
        ratio < FRESH_BOOK_PROPORTION_RANGE.min ||
        ratio > FRESH_BOOK_PROPORTION_RANGE.max
      ) {
        failures.push(`${prefix}: non-book proportion ${thickness}/${height}`);
      }

      const bands = recipe.raisedBands ?? 0;
      const emblem = (recipe.ornament ?? -1) >= 0;
      const charm = recipe.charm !== undefined && recipe.charm !== 'none';
      const corners = recipe.cornerProtectors === true;
      const inset = recipe.insetPlate === true;
      const programmes = [
        bands > 0 ? 'bands' : '',
        emblem ? 'emblem' : '',
        charm ? 'charm' : '',
        corners ? 'corners' : '',
        inset ? 'inset' : '',
      ].filter(Boolean);
      if (programmes.length > 1) {
        failures.push(`${prefix}: stacked furniture ${programmes.join('+')}`);
      }
      if (bands > 2) failures.push(`${prefix}: ${bands} independently added cords`);
      if (preset.shape === 'ribbed' && bands > 0) {
        failures.push(`${prefix}: cords duplicated the ribbed silhouette`);
      }
      if (charm && !coverFrameSupportsHangingAccent(recipe.coverFrame ?? -1)) {
        failures.push(`${prefix}: charm paired with a busy cover frame`);
      }
      if ((recipe.coverMedallion ?? -1) !== (recipe.ornament ?? -1)) {
        failures.push(`${prefix}: spine/cover focal marks diverged`);
      }

      const authored = preset.decorations.filter(
        (decoration) => decoration !== 'plain' && decoration !== 'label-plate',
      );
      const material = MATERIALS[preset.material];
      const authoredBusy =
        authored.length > 0 ||
        (material.grain !== 'none' && material.grainCount > 3) ||
        preset.tier === 'niche';
      if (authoredBusy && programmes.length > 0) {
        failures.push(`${prefix}: added furniture over an authored/busy binding`);
      }

      formats.add(formatForHeight(height));
      furniture.add(programmes[0] ?? 'none');
      presets.add(preset.id);
    }

    expect(failures.slice(0, 25)).toEqual([]);
    expect(formats).toEqual(new Set(['folio', 'quarto', 'octavo', 'duodecimo', 'pocket']));
    // Loose charms and corner hardware were retired from fresh-book recipes:
    // a new binding may stay bare or add one restrained cord/emblem programme.
    expect(furniture).toEqual(new Set(['none', 'bands', 'emblem']));
    expect(presets.size).toBeGreaterThan(30);
  });

  it('leaves the exact named binding material authoritative on spine and cover', () => {
    const failures: string[] = [];

    for (let index = 0; index < 4096; index += 1) {
      const seed = sweptSeed(index);
      const preset = presetForSeed(seed);
      const resolved = resolveBookStyle(
        seed,
        { materials: ['paper'], pigments: [3], hueJitter: 12 },
        freshBookStyleOverrides(seed),
        { binding: null },
      );
      const binding = resolveSpineBinding({ ...resolved.spine, binding: null });
      const expectedCovering = COVER_TEXTURES.indexOf(preset.material);

      if (resolved.pinned.has('material')) {
        failures.push(`seed ${seed}: coarse material was pinned`);
      }
      if (binding.material !== preset.material) {
        failures.push(
          `seed ${seed}: spine ${binding.material} replaced named ${preset.material}`,
        );
      }
      if (resolved.cover.covering !== expectedCovering) {
        failures.push(
          `seed ${seed}: cover ${resolved.cover.covering} replaced named ${expectedCovering}`,
        );
      }
    }

    expect(failures.slice(0, 25)).toEqual([]);
  });
});

describe('new-book seed authority', () => {
  it('draws one random spine seed and uses that same seed for the fresh recipe', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.3125);
    const book = await createBook({
      id: 'fresh-book-one-seed-regression',
      bookcaseId: 'fresh-book-test-case',
      title: 'One Seed',
      floor: 0,
      slot: 0,
    });

    expect(random).toHaveBeenCalledTimes(1);
    expect(book.spineSeed).toBe(0x50000000);
    expect(book.coverMeta).toEqual({
      style: freshBookStyleOverrides(book.spineSeed),
    });
  });

  it('does not draw any random seed when the caller supplied the spine seed', async () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('unexpected second book-art seed');
    });
    const spineSeed = 0xdecafbad;
    const book = await createBook({
      id: 'fresh-book-explicit-seed-regression',
      bookcaseId: 'fresh-book-test-case',
      title: 'Known Seed',
      floor: 0,
      slot: 1,
      spineSeed,
    });

    expect(random).not.toHaveBeenCalled();
    expect(book.spineSeed).toBe(spineSeed);
    expect(book.coverMeta).toEqual({ style: freshBookStyleOverrides(spineSeed) });
  });
});
