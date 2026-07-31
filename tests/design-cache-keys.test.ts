/**
 * tests/design-cache-keys.test.ts — every axis that changes a pixel must
 * change the key that pixel is filed under.
 *
 * This is the one class of bug in the art pipeline that cannot be seen: the
 * disk cache (`art/bake.ts`) validates nothing about a hit, so a key that
 * misses an axis serves the wrong art forever, on any machine that has ever
 * drawn it once — and it survives a reinstall of the app but not of the
 * cache directory. A specimen board cannot catch it (it draws fresh every
 * time) and neither can a screenshot on a clean profile.
 *
 * Three vocabularies landed at once, each adding an axis to art that was
 * previously keyed on the colour scheme alone. These tests pin the keys.
 */
import { describe, expect, it } from 'vitest';
// From `libraryKey`, not `textures`: the latter imports Pixi and cannot load
// in node. That is exactly why `themeKeyOf` lives in the pure module.
import { themeKeyOf } from '../src/features/bookshelf/libraryKey';
import { getTheme, THEME_IDS } from '../src/art/themes';
import {
  BUILD_IDS,
  PATTERN_IDS,
  resolveShelfDesign,
  shelfDesignTag,
  DEFAULT_SHELF_DESIGN,
} from '../src/art/shelfDesign';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  wallpaperSpec,
  wallpaperTileKey,
  DEFAULT_WALLPAPER_ID,
} from '../src/art/wallpaperDesign';
import { bookDesignTag, BOOK_PRESETS, resolveBookDesign } from '../src/art/bookDesign';

const scheme = getTheme(THEME_IDS[0]).scheme;

describe('the case bake key carries the carpentry', () => {
  it('changes when the BUILD changes, colours held still', () => {
    const keys = new Set(
      BUILD_IDS.map((build) =>
        themeKeyOf({ themeId: THEME_IDS[0], scheme, design: { build, pattern: 'none' } }),
      ),
    );
    expect(keys.size).toBe(BUILD_IDS.length);
  });

  it('changes when the TIMBER PATTERN changes, colours held still', () => {
    const keys = new Set(
      PATTERN_IDS.map((pattern) =>
        themeKeyOf({ themeId: THEME_IDS[0], scheme, design: { build: 'plank', pattern } }),
      ),
    );
    expect(keys.size).toBe(PATTERN_IDS.length);
  });

  it('still changes when only the COLOURS change, carpentry held still', () => {
    const keys = new Set(
      THEME_IDS.map((id) =>
        themeKeyOf({ themeId: id, scheme: getTheme(id).scheme, design: DEFAULT_SHELF_DESIGN }),
      ),
    );
    expect(keys.size).toBe(THEME_IDS.length);
  });

  it('is stable for the same room asked for twice', () => {
    const req = { themeId: THEME_IDS[0], scheme, design: { build: 'arch', pattern: 'rope' } } as const;
    expect(themeKeyOf(req)).toBe(themeKeyOf(req));
  });

  it('treats an absent design as the house case rather than as its own axis', () => {
    // Otherwise a caller that omits `design` gets a THIRD key for art that is
    // byte-identical to the default's, and bakes it twice.
    expect(themeKeyOf({ themeId: THEME_IDS[0], scheme })).toBe(
      themeKeyOf({ themeId: THEME_IDS[0], scheme, design: DEFAULT_SHELF_DESIGN }),
    );
  });

  it('survives junk out of SQLite without throwing', () => {
    for (const junk of [null, undefined, {}, { build: 'nope' }, { pattern: 42 }]) {
      expect(() =>
        themeKeyOf({ themeId: THEME_IDS[0], scheme, design: junk as never }),
      ).not.toThrow();
    }
    expect(shelfDesignTag({ build: 'nope' } as never)).toBe(
      shelfDesignTag(DEFAULT_SHELF_DESIGN),
    );
    expect(resolveShelfDesign(null)).toEqual(DEFAULT_SHELF_DESIGN);
  });
});

describe('the wallpaper tile key carries all four axes', () => {
  const base = wallpaperSpec(DEFAULT_WALLPAPER_ID);
  const keyFor = (spec: Parameters<typeof wallpaperTileKey>[0]): string =>
    wallpaperTileKey(spec, 256, 1);

  it('changes with the pattern', () => {
    const keys = new Set(WALLPAPER_PATTERNS.map((pattern) => keyFor({ ...base, pattern })));
    expect(keys.size).toBe(WALLPAPER_PATTERNS.length);
  });

  it('changes with the scale', () => {
    const keys = new Set(WALLPAPER_SCALES.map((scale) => keyFor({ ...base, scale })));
    expect(keys.size).toBe(WALLPAPER_SCALES.length);
  });

  it('changes with the depth', () => {
    const keys = new Set(WALLPAPER_DEPTHS.map((depth) => keyFor({ ...base, depth })));
    expect(keys.size).toBe(WALLPAPER_DEPTHS.length);
  });

  it('changes with the ink slot', () => {
    const keys = new Set(WALLPAPER_INKS.map((ink) => keyFor({ ...base, ink })));
    expect(keys.size).toBe(WALLPAPER_INKS.length);
  });

  it('changes with the drawn size', () => {
    expect(wallpaperTileKey(base, 256, 1)).not.toBe(wallpaperTileKey(base, 384, 1));
  });
});

describe('the book design tag distinguishes bindings', () => {
  it('gives every preset its own tag at a fixed cloth', () => {
    const tags = new Set(
      BOOK_PRESETS.map((p) =>
        bookDesignTag(resolveBookDesign({ seed: 1, cloth: 0, accent: 3, preset: p.id })),
      ),
    );
    expect(tags.size).toBe(BOOK_PRESETS.length);
  });

  it('is deterministic — a book keeps its binding across sessions', () => {
    const once = resolveBookDesign({ seed: 0xbeef, cloth: 2 });
    const twice = resolveBookDesign({ seed: 0xbeef, cloth: 2 });
    expect(bookDesignTag(once)).toBe(bookDesignTag(twice));
  });

  it('a pinned preset overrides the one the seed would have picked', () => {
    // The studio's whole job. If these ever collide, picking a binding in the
    // panel would leave the shelf serving the seed's choice off the atlas.
    const seeded = resolveBookDesign({ seed: 7, cloth: 1 });
    const other = BOOK_PRESETS.find((p) => p.id !== seeded.preset);
    expect(other).toBeDefined();
    const pinned = resolveBookDesign({ seed: 7, cloth: 1, preset: other!.id });
    expect(pinned.preset).toBe(other!.id);
    expect(bookDesignTag(pinned)).not.toBe(bookDesignTag(seeded));
  });
});
