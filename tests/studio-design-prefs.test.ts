/**
 * tests/studio-design-prefs.test.ts — the studio's design store is TOTAL.
 *
 * Everything in `data/designPrefs.ts` is read back out of SQLite without
 * a schema, so the validators are the only thing between a corrupt row and an
 * exception inside a bake. These lock down the contract the drawing code
 * relies on: a resolved design always has a real build, a real pattern and a
 * real value on every wallpaper axis it names, whatever was stored.
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
  WALLPAPER_EDGES,
  WALLPAPER_INKS,
  WALLPAPER_PATTERNS,
  WALLPAPER_SCALES,
  WALLPAPER_TONES,
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

  it('carries the optional axes back off disk', () => {
    // The spec is rebuilt field by field, so an axis this validator does not
    // name is dropped on the next read: the reader's choice would hold for the
    // session and be gone tomorrow. `tone` and `edge` arrived after the first
    // four and were exactly that bug.
    for (const tone of WALLPAPER_TONES) {
      expect(mergeWallpaperSpec({ tone }).tone).toBe(tone);
    }
    for (const edge of WALLPAPER_EDGES) {
      expect(mergeWallpaperSpec({ edge }).edge).toBe(edge);
    }
  });

  it('leaves an unnamed optional axis unnamed rather than writing its default', () => {
    // Absent means auto/crisp, which is the same picture — but materialising it
    // would rewrite every stored blob and make "back to auto" unreachable once
    // the picker offers it.
    //
    // This held for a while by accident: the merge fell back to the DEFAULT
    // PAPER's tone, and the default paper named none. Changing the opening wall
    // to one that does made it start writing 'gilt' into specs nobody had given
    // a tone. The fallback is `undefined` now, on purpose — tone and edge are
    // properties of a particular paper, not house defaults.
    const spec = mergeWallpaperSpec({ pattern: 'trellis' });
    expect(spec.tone).toBeUndefined();
    expect(spec.edge).toBeUndefined();
  });

  it('drops junk in an optional axis instead of storing it', () => {
    const spec = mergeWallpaperSpec({ tone: 'chartreuse', edge: 42 });
    expect(spec.tone).toBeUndefined();
    expect(spec.edge).toBeUndefined();
  });

  /**
   * The other half: a NAMED axis still has to survive, or a reader's chosen
   * tone holds for the session and is gone tomorrow. Loosening the fallback to
   * `undefined` is only safe while this holds.
   */
  it('keeps an optional axis that WAS named', () => {
    const spec = mergeWallpaperSpec({ pattern: 'trellis', tone: 'gilt', edge: 'etched' });
    expect(spec.tone).toBe('gilt');
    expect(spec.edge).toBe('etched');
  });
});
