import { describe, expect, it, vi } from 'vitest';

import { resolveBookStyle } from '../src/art/bookStyle';
import {
  BOOK_PRESET_IDS,
  SPINE_TEXT_FURNITURE_IDS,
  bindingMaterialFor,
  bookPreset,
  bookPresetAuthoredFocalGlyph,
  normaliseBookPresetId,
} from '../src/art/bookDesign';
import { getTheme } from '../src/art/themes';
import {
  COVER_TEXTURES,
  coverPainterColours,
  coveringSpecFor,
  deriveCoverParams,
  normalizeCoverOverrides,
  resolveCoverTitleColours,
} from '../src/art/covers';
import {
  bookStyleOverridesFor,
  coverOverridesFromStyle,
  createBookAppearanceHydrationGuard,
  createOrderedBookAppearanceWriter,
  persistBookStyle,
  resolveBookAppearance,
  type OrderedBookAppearanceWrite,
} from '../src/features/bookshelf/bookIdentity';
import {
  createBookCoverMetaMutationLane,
  mergeCoverMetaSections,
} from '../src/data/books';
import {
  WELCOME_BINDING,
  WELCOME_BOOK_PRESET,
  WELCOME_SPINE_SEED,
} from '../src/data/seed';
import type { Book } from '../src/data/types';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function turn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeBook(coverMeta: Record<string, unknown> | null): Book {
  return {
    id: 'book',
    bookcaseId: 'case-default',
    title: 'The book',
    floor: 0,
    slot: 0,
    spineSeed: 913,
    coverMeta,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('book appearance integration contract', () => {
  it('authors the Welcome book as a grand blue Gilt Quarto', () => {
    const resolved = resolveBookStyle(
      WELCOME_SPINE_SEED,
      undefined,
      WELCOME_BINDING as Parameters<typeof resolveBookStyle>[2],
      { binding: WELCOME_BOOK_PRESET },
    );

    expect(WELCOME_BINDING).toMatchObject({
      pigment: 29,
      spineBaseHex: '#394c70',
      coverBaseHex: '#475d82',
      toolingHex: '#f1d16f',
      emblemHex: '#f7e09a',
      gilt: true,
      ornament: 0,
      titlePlate: 'gilt-direct',
      titleFont: 44,
      coverFrame: 48,
      coverMedallion: 0,
      cornerProtectors: false,
      insetPlate: false,
      charm: 'none',
    });
    expect(WELCOME_BINDING).not.toHaveProperty('material');
    expect(bookPreset(WELCOME_BOOK_PRESET)).toMatchObject({
      shape: 'square',
      material: 'smooth-cloth',
    });
    // Gilt Quarto supplies the panel; the one optional foliate lozenge remains
    // the shared focal on spine and cover.
    expect(resolved.spine.ornamentOn).toBe(true);
    expect(resolved.cover).toMatchObject({
      frame: 48,
      medallion: 0,
      titlePlate: 'gilt-direct',
      titleFont: 44,
      cornerProtectors: false,
      insetPlate: false,
      charm: 'none',
    });
    expect(resolveCoverTitleColours(resolved.cover).ground).toBe(
      coverPainterColours(resolved.cover).visible.base,
    );
  });

  it('projects every binding-authored focal semantically onto the cover only', () => {
    const expected = {
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
    } as const;
    const seen = new Set<string>();

    for (const binding of BOOK_PRESET_IDS) {
      const glyph = bookPresetAuthoredFocalGlyph(binding);
      if (glyph === null) continue;
      expect(glyph in expected, `${binding}:${glyph}:semantic counterpart`).toBe(true);
      const resolved = resolveBookStyle(913, undefined, undefined, { binding });
      expect(resolved.spine.ornamentOn, `${binding}:${glyph}:duplicate spine tool`).toBe(false);
      expect(resolved.cover.medallion, `${binding}:${glyph}:cover counterpart`).toBe(
        expected[glyph as keyof typeof expected],
      );
      seen.add(glyph);
    }

    expect([...seen].sort()).toEqual(
      [...new Set(BOOK_PRESET_IDS
        .map(bookPresetAuthoredFocalGlyph)
        .filter((glyph): glyph is keyof typeof expected => glyph !== null))].sort(),
    );
  });

  it('preserves active colour roles while historical brocade ids hard-normalize to formal cloth', () => {
    const seed = 913;
    for (const binding of ['brocade-anthology', 'lattice-cabinet']) {
      const resolved = resolveBookStyle(seed, undefined, {
        coverBaseHex: '#345678',
        coverAccentHex: '#876543',
        toolingHex: '#ead081',
        emblemHex: '#f0dda0',
        hardwareHex: '#b38242',
      }, { binding });

      const projection = coverOverridesFromStyle(resolved.style, {
        binding,
        materialPinned: false,
      });
      expect(projection).toMatchObject({
        coverBaseHex: '#345678',
        coverAccentHex: '#876543',
        toolingHex: '#ead081',
        emblemHex: '#f0dda0',
        hardwareHex: null,
      });
      expect(
        coveringSpecFor(deriveCoverParams(seed, projection)).id,
        binding,
      ).toBe('smooth-cloth');
      expect(normaliseBookPresetId(binding)).toBe('gilt-quarto');
    }
  });

  it('force-normalizes historical special cases instead of restoring retired furniture', () => {
    for (const id of ['brocade-anthology', 'lattice-cabinet', 'parchment-cartulary']) {
      const preset = bookPreset(id);
      expect(BOOK_PRESET_IDS, `${id} remains absent from the picker`).not.toContain(id);
      expect(normaliseBookPresetId(id), `${id} is pulled into the reset`).toBe('gilt-quarto');
      expect(preset, `${id} resolves to the formal recovery`).toMatchObject({
        id: 'gilt-quarto',
        shape: 'square',
        material: 'smooth-cloth',
      });
      expect(
        preset.decorations.some((decoration) =>
          SPINE_TEXT_FURNITURE_IDS.includes(decoration),
        ),
        `${id} stays titleless on the spine`,
      ).toBe(false);
    }
  });

  it('lets an explicitly pinned coarse material outrank the named binding', () => {
    const seed = 914;
    const resolved = resolveBookStyle(seed, undefined, { material: 'paper' }, {
      binding: 'brocade-anthology',
    });
    const projection = coverOverridesFromStyle(resolved.style, {
      binding: 'brocade-anthology',
      materialPinned: true,
    });

    expect(projection.material).toBe('paper');
    expect(projection.covering).toBeUndefined();
  });

  it('projects the effective title treatment onto the front cover only', () => {
    const binding = 'library-buckram';
    let latent: ReturnType<typeof resolveBookStyle> | undefined;
    for (let seed = 0; seed < 4_096 && latent === undefined; seed += 1) {
      const candidate = resolveBookStyle(seed, undefined, undefined, { binding });
      if (candidate.style.titlePlate === 'none') latent = candidate;
    }
    expect(latent).toBeDefined();
    expect(latent!.cover.titlePlate).toBe('label');
    expect(coverOverridesFromStyle(latent!.style, {
      binding,
      seed: latent!.seed,
      titlePlatePinned: false,
    }).titlePlate).toBe('label');

    const explicitNone = resolveBookStyle(
      latent!.seed,
      undefined,
      { titlePlate: 'none' },
      { binding },
    );
    expect(explicitNone.cover.titlePlate).toBe('none');
    expect(coverOverridesFromStyle(explicitNone.style, {
      binding,
      seed: explicitNone.seed,
      titlePlatePinned: true,
    }).titlePlate).toBe('none');
  });

  it('persists the formal reset cover for a retired binding-only book', async () => {
    const save = vi.fn().mockResolvedValue(null);

    await persistBookStyle(
      'book',
      null,
      {
        binding: 'brocade-anthology',
        bindingPinned: true,
        materialPinned: false,
      },
      save,
    );

    expect(save).toHaveBeenCalledOnce();
    const [, savedStyle, savedCover] = save.mock.calls[0] as [
      string,
      Record<string, unknown> | null,
      Record<string, unknown> | null,
    ];
    expect(savedStyle).toBeNull();
    expect(savedCover).toMatchObject({
      covering: COVER_TEXTURES.indexOf('smooth-cloth'),
      material: bindingMaterialFor('smooth-cloth'),
    });
  });

  it('keeps a binding-only title plate inherited across reopen and binding changes', async () => {
    let latent: ReturnType<typeof resolveBookStyle> | undefined;
    for (let seed = 0; seed < 4_096 && latent === undefined; seed += 1) {
      const candidate = resolveBookStyle(seed, undefined, undefined, {
        binding: 'library-buckram',
      });
      if (candidate.style.titlePlate === 'none') latent = candidate;
    }
    expect(latent).toBeDefined();

    const save = vi.fn().mockResolvedValue(null);
    await persistBookStyle(
      'book',
      null,
      {
        binding: 'library-buckram',
        bindingPinned: true,
        materialPinned: false,
        seed: latent!.seed,
        titlePlatePinned: false,
      },
      save,
    );

    const [, savedStyle, savedCover] = save.mock.calls[0] as [
      string,
      Record<string, unknown> | null,
      Record<string, unknown> | null,
    ];
    expect(savedStyle).toBeNull();
    expect(savedCover).toMatchObject({
      titlePlate: 'label',
      titlePlateSource: 'inherited',
    });
    expect(normalizeCoverOverrides(savedCover)).not.toHaveProperty('titlePlate');

    const reopened = bookStyleOverridesFor({ coverMeta: { cover: savedCover } });
    expect(reopened?.['titlePlate']).toBeUndefined();

    // The stale compatibility cover can still be present during the ordered
    // binding write. It must not pin Library Buckram's label onto a plain
    // binding while the new compatibility projection catches up.
    const reopenedBook = {
      ...fakeBook({ cover: savedCover }),
      spineSeed: latent!.seed,
    };
    const rebound = resolveBookAppearance(reopenedBook, getTheme('walnut'), {
      binding: 'plain-cloth',
    });
    expect(rebound.pinned.has('titlePlate')).toBe(false);
    expect(rebound.spine.titlePlate).toBe('none');
    expect(rebound.cover.titlePlate).toBe('none');

    // Conversely, a real legacy/user title choice has no inherited marker and
    // therefore remains a pin. Explicit None suppresses the Buckram label on
    // both faces after a reopen.
    const explicit = bookStyleOverridesFor({
      coverMeta: { cover: { titlePlate: 'none' } },
    });
    expect(explicit).toMatchObject({ titlePlate: 'none' });
    const explicitNone = resolveBookAppearance(
      {
        ...fakeBook({ cover: { titlePlate: 'none' } }),
        spineSeed: latent!.seed,
      },
      getTheme('walnut'),
      { binding: 'library-buckram' },
    );
    expect(explicitNone.pinned.has('titlePlate')).toBe(true);
    expect(explicitNone.spine.titlePlate).toBe('none');
    expect(explicitNone.cover.titlePlate).toBe('none');
  });

  it('does not freeze a seed-derived binding when the final style override is cleared', async () => {
    const save = vi.fn().mockResolvedValue(null);

    await persistBookStyle(
      'book',
      null,
      {
        binding: 'brocade-anthology',
        bindingPinned: false,
        materialPinned: false,
      },
      save,
    );

    expect(save).toHaveBeenCalledWith('book', null, null);
  });

  it('normalizes a retired exact covering and frame without inventing a coarse material pin', () => {
    const floor = bookStyleOverridesFor({
      coverMeta: {
        cover: {
          covering: COVER_TEXTURES.indexOf('brocade'),
          texture: 0,
          frame: 7,
          clothHex: '#345678',
        },
      },
    });

    expect(floor).toMatchObject({ clothHex: '#345678', coverFrame: 26 });
    expect(floor).not.toHaveProperty('material');
  });

  it('rejects hydration that finishes after an edit or after a book switch', () => {
    const hydration = createBookAppearanceHydrationGuard();
    const beforeEdit = hydration.begin('book-a');
    hydration.invalidate();
    expect(hydration.accepts(beforeEdit)).toBe(false);

    const oldBook = hydration.begin('book-a');
    const currentBook = hydration.begin('book-b');
    expect(hydration.accepts(oldBook)).toBe(false);
    expect(hydration.accepts(currentBook)).toBe(true);
  });

  it('serializes appearance and page-default merges against one fresh cover_meta row', async () => {
    const firstWrite = deferred();
    let reads = 0;
    let writes = 0;
    let stored: Record<string, unknown> | null = {
      bookmarks: [{ pageId: 'page-1' }],
    };
    const lane = createBookCoverMetaMutationLane({
      read: async () => {
        reads += 1;
        return fakeBook(structuredClone(stored));
      },
      write: async (_bookId, coverMeta) => {
        writes += 1;
        if (writes === 1) await firstWrite.promise;
        stored = structuredClone(coverMeta);
        return fakeBook(stored);
      },
    });

    const appearance = lane('book', (meta) =>
      mergeCoverMetaSections(meta, {
        style: { thickness: 44 },
        cover: { covering: 12 },
      }),
    );
    const pageDefaults = lane('book', (meta) =>
      mergeCoverMetaSections(meta, {
        pageDefaults: { pageStyle: 'grid' },
      }),
    );

    await turn();
    expect(reads).toBe(1);
    expect(writes).toBe(1);
    firstWrite.resolve();
    await Promise.all([appearance, pageDefaults]);

    expect(reads).toBe(2);
    expect(stored).toEqual({
      bookmarks: [{ pageId: 'page-1' }],
      style: { thickness: 44 },
      cover: { covering: 12 },
      pageDefaults: { pageStyle: 'grid' },
    });
  });

  it('finishes rapid binding and style decisions strictly in click order', async () => {
    const firstBinding = deferred();
    const firstStyle = deferred();
    const events: string[] = [];

    const writer = createOrderedBookAppearanceWriter({
      saveBinding: async (_bookId, binding) => {
        events.push(`binding:${binding}:start`);
        if (binding === 'first') await firstBinding.promise;
        events.push(`binding:${binding}:end`);
      },
      saveStyle: async (write: OrderedBookAppearanceWrite) => {
        const marker = write.projectionBinding ?? 'none';
        events.push(`style:${marker}:start`);
        if (marker === 'first') await firstStyle.promise;
        events.push(`style:${marker}:end`);
      },
    });

    const first = writer({
      bookId: 'book',
      style: null,
      binding: 'first',
      projectionBinding: 'first',
    });
    const second = writer({
      bookId: 'book',
      style: null,
      binding: 'second',
      projectionBinding: 'second',
    });

    await turn();
    expect(events).toEqual(['binding:first:start']);

    firstBinding.resolve();
    await turn();
    expect(events).toEqual([
      'binding:first:start',
      'binding:first:end',
      'style:first:start',
    ]);

    firstStyle.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'binding:first:start',
      'binding:first:end',
      'style:first:start',
      'style:first:end',
      'binding:second:start',
      'binding:second:end',
      'style:second:start',
      'style:second:end',
    ]);
  });

  it('continues the lane after a failed appearance write', async () => {
    const saved: string[] = [];
    const writer = createOrderedBookAppearanceWriter({
      saveBinding: async (_bookId, binding) => {
        if (binding === 'broken') throw new Error('synthetic failure');
        saved.push(`binding:${binding}`);
      },
      saveStyle: async (write) => {
        saved.push(`style:${write.projectionBinding ?? 'none'}`);
      },
    });

    await expect(writer({
      bookId: 'book',
      style: null,
      binding: 'broken',
      projectionBinding: 'broken',
    })).rejects.toThrow('synthetic failure');
    await writer({
      bookId: 'book',
      style: null,
      binding: 'recovery',
      projectionBinding: 'recovery',
    });

    expect(saved).toEqual(['binding:recovery', 'style:recovery']);
  });
});
