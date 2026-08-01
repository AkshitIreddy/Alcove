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
 * Five vocabularies have landed on top of art that was once keyed on the
 * colour scheme alone: the build, the timber pattern, the room, the paper, and
 * the paper's tone and nib. Each arrival left behind a hand-spelled copy of
 * "what makes this art different" somewhere downstream, and every one of those
 * copies has since fallen behind the spec it was copied from. These tests pin
 * the keys, and pin the copies to the shared function rather than to a list.
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
  WALLPAPER_EDGES,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  WALLPAPER_PRESETS,
  WALLPAPER_TONES,
  wallpaperAxisKey,
  wallpaperSpec,
  wallpaperTileKey,
  DEFAULT_WALLPAPER_ID,
} from '../src/art/wallpaperDesign';
import { wallpaperOptions } from '../src/views/rail/designOptions';
import { bookDesignTag, BOOK_PRESETS, resolveBookDesign } from '../src/art/bookDesign';
import { CLOTHS } from '../src/art/flat';

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

describe('the wallpaper tile key carries every axis', () => {
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

  it('changes with the element TONE', () => {
    const keys = new Set(WALLPAPER_TONES.map((tone) => keyFor({ ...base, tone })));
    expect(keys.size).toBe(WALLPAPER_TONES.length);
  });

  it('changes with the EDGE sharpness', () => {
    const keys = new Set(WALLPAPER_EDGES.map((edge) => keyFor({ ...base, edge })));
    expect(keys.size).toBe(WALLPAPER_EDGES.length);
  });

  it('changes with the drawn size', () => {
    expect(wallpaperTileKey(base, 256, 1)).not.toBe(wallpaperTileKey(base, 384, 1));
  });
});

describe('the applied-room key carries every wallpaper axis too', () => {
  /**
   * `world.ts` keys the room it has already painted on `wallpaperAxisKey`, and
   * skips the repaint when that string has not moved. It used to spell its own
   * four-axis copy, which fell two axes behind when `tone` and `edge` landed:
   * changing only the sharpness left the old wall on screen — the disk cache
   * was correct and never consulted. Pinning the shared function here is what
   * stops the copy growing back.
   */
  const base = wallpaperSpec(DEFAULT_WALLPAPER_ID);

  it('separates every value of every axis', () => {
    const axes = [
      WALLPAPER_PATTERNS.map((pattern) => ({ ...base, pattern })),
      WALLPAPER_SCALES.map((scale) => ({ ...base, scale })),
      WALLPAPER_DEPTHS.map((depth) => ({ ...base, depth })),
      WALLPAPER_INKS.map((ink) => ({ ...base, ink })),
      WALLPAPER_TONES.map((tone) => ({ ...base, tone })),
      WALLPAPER_EDGES.map((edge) => ({ ...base, edge })),
    ];
    for (const specs of axes) {
      expect(new Set(specs.map(wallpaperAxisKey)).size).toBe(specs.length);
    }
  });

  it('treats an unnamed optional axis as its default, not as a third state', () => {
    // Otherwise the same paper read off disk (no `tone`) and picked in the
    // studio (`tone: 'auto'`) would be two rooms, and switching between them
    // would rebake a byte-identical wall.
    expect(wallpaperAxisKey({ ...base, tone: undefined, edge: undefined })).toBe(
      wallpaperAxisKey({ ...base, tone: 'auto', edge: 'crisp' }),
    );
  });
});

describe("the picker's card keys carry every axis too", () => {
  /**
   * `DesignCanvas` caches a drawn tile on `artKey`, so two cards that agree on
   * it show one picture. This was the fourth place in the app to spell the
   * wallpaper's axes out by hand, and the fourth to have fallen behind the
   * spec — a paper differing only in tone or nib previewed as its neighbour,
   * which is a picker lying about what it is offering.
   */
  it('gives every named paper its own card', () => {
    const opts = wallpaperOptions();
    expect(new Set(opts.map((o) => o.artKey)).size).toBe(opts.length);
  });

  it('derives the card key from the spec rather than re-spelling it', () => {
    for (const preset of WALLPAPER_PRESETS) {
      const opt = wallpaperOptions().find((o) => o.id === preset.id);
      expect(opt?.artKey).toContain(wallpaperAxisKey(preset.spec));
    }
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

  /**
   * Multi-digit indices must not run together.
   *
   * The tag concatenated its numeric fields bare, which was unambiguous only
   * while every one of them was a single digit. Cloths went to 50 and it broke
   * silently: cloth 1 + accent 23 and cloth 12 + accent 3 both spelled "123",
   * so two different books shared a cache key and one was served the other's
   * spine. Nothing fails when that happens — the cache validates nothing about
   * a hit — which is exactly why it needs a test rather than a comment.
   */
  it('never lets two different bindings collide on one tag', () => {
    const a = resolveBookDesign({ seed: 1, cloth: 1, accent: 23, preset: BOOK_PRESETS[0]!.id });
    const b = resolveBookDesign({ seed: 1, cloth: 12, accent: 3, preset: BOOK_PRESETS[0]!.id });
    expect(a.cloth).not.toBe(b.cloth);
    expect(bookDesignTag(a)).not.toBe(bookDesignTag(b));
  });

  /*
   * Swept across all 50 x 50, keyed on the RESOLVED pair rather than the
   * requested one: asking for accent === cloth bumps the accent to cloth + 1
   * (a half-binding in a single colour is just a full binding), so 50 of the
   * 2500 requests legitimately land on a pair another request already made.
   * Counting requests would fail on correct behaviour.
   */
  it('gives every distinct cloth x accent pair its own tag', () => {
    const byPair = new Map<string, string>();
    for (let cloth = 0; cloth < CLOTHS.length; cloth += 1) {
      for (let accent = 0; accent < CLOTHS.length; accent += 1) {
        const d = resolveBookDesign({ seed: 3, cloth, accent, preset: BOOK_PRESETS[0]!.id });
        byPair.set(`${d.cloth}.${d.accent}`, bookDesignTag(d));
      }
    }
    expect(new Set(byPair.values()).size).toBe(byPair.size);
    expect(byPair.size).toBeGreaterThan(CLOTHS.length * (CLOTHS.length - 1) - 1);
  });
});
