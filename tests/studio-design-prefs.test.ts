/**
 * tests/studio-design-prefs.test.ts — the studio's design store is TOTAL.
 *
 * Everything in `data/designPrefs.ts` is read back out of SQLite without
 * a schema, so the validators are the only thing between a corrupt row and an
 * exception inside a bake. These lock down the contract the drawing code
 * relies on: a resolved design always has a real build, a real pattern and all
 * four wallpaper axes, whatever was stored.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_DESIGN,
  mergeRoomDesign,
  mergeWallpaperSpec,
  shelfDesignOf,
} from '../src/data/designPrefs';
import { BUILD_IDS, PATTERN_IDS } from '../src/art/shelfDesign';
import {
  WALLPAPER_DEPTHS,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
} from '../src/art/wallpaperDesign';

const JUNK: readonly unknown[] = [
  null,
  undefined,
  0,
  -1,
  NaN,
  '',
  'plank',
  [],
  [1, 2, 3],
  {},
  { build: 42 },
  { build: 'gothic', pattern: 'no-such-pattern' },
  { wallpaper: 7 },
  { wallpaper: { pattern: 'nope', scale: 'huge', depth: null, ink: [] } },
  { build: null, pattern: undefined, wallpaper: null },
];

describe('mergeRoomDesign', () => {
  it('is total: every junk value gives a drawable design', () => {
    for (const raw of JUNK) {
      const design = mergeRoomDesign(raw);
      expect(BUILD_IDS).toContain(design.build);
      expect(PATTERN_IDS).toContain(design.pattern);
      expect(WALLPAPER_PATTERNS).toContain(design.wallpaper.pattern);
      expect(WALLPAPER_SCALES).toContain(design.wallpaper.scale);
      expect(WALLPAPER_DEPTHS).toContain(design.wallpaper.depth);
      expect(WALLPAPER_INKS).toContain(design.wallpaper.ink);
    }
  });

  it('keeps the fields it recognises and defaults the rest', () => {
    const design = mergeRoomDesign({ build: 'gothic', pattern: 'bogus' });
    expect(design.build).toBe('gothic');
    expect(design.pattern).toBe(DEFAULT_ROOM_DESIGN.pattern);
  });

  it('never hands back a shared wallpaper object', () => {
    // Two rooms merged from the same junk must not alias one spec, or editing
    // one bookcase's scale would silently move another's.
    const a = mergeRoomDesign(null);
    const b = mergeRoomDesign(null);
    a.wallpaper.scale = 'grand';
    expect(b.wallpaper.scale).toBe(DEFAULT_ROOM_DESIGN.wallpaper.scale);
    expect(DEFAULT_ROOM_DESIGN.wallpaper.scale).not.toBe('grand');
  });

  it('projects to the ShelfDesign the part drawers take', () => {
    const design = mergeRoomDesign({ build: 'barrister', pattern: 'rope' });
    expect(shelfDesignOf(design)).toEqual({ build: 'barrister', pattern: 'rope' });
  });
});

describe('mergeWallpaperSpec', () => {
  it('accepts a bare preset id, because an older blob is one', () => {
    // `wallpaperSpec` aliases the four retired names, so an upgrading reader
    // lands on a real paper rather than on a bare wall.
    expect(mergeWallpaperSpec('damask').pattern).toBe('damask');
    expect(mergeWallpaperSpec('star-night').pattern).toBe('star');
  });

  it('falls back per axis, not all-or-nothing', () => {
    const spec = mergeWallpaperSpec({ pattern: 'trellis', scale: 'enormous', ink: 'gilt' });
    expect(spec.pattern).toBe('trellis');
    expect(spec.ink).toBe('gilt');
    expect(spec.scale).toBe(DEFAULT_ROOM_DESIGN.wallpaper.scale);
  });
});
