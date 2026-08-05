/**
 * tests/design-cache-keys.test.ts — every axis that changes a pixel must
 * change the key that pixel is filed under.
 *
 * This is the one class of bug in the art pipeline that cannot be seen.
 * `art/bake.ts` validates nothing about a hit, so a key that misses an axis
 * serves the wrong art and never says so. A specimen board cannot catch it (it
 * draws fresh every time) and neither can a screenshot on a clean profile.
 *
 * **The blast radius is one session, not forever.** These tests used to say
 * "forever, on any machine that has ever drawn it once", which was true while
 * `bake.ts` wrote PNGs to `appCacheDir()`. That disk cache is gone — for flat
 * art the encode cost more than redrawing — so wrong art now survives until the
 * app is reloaded rather than until the cache directory is deleted. Still worth
 * a test: a session is as long as the reader leaves the window open, nothing
 * fails, nothing logs, and the picture is simply not the one they chose.
 *
 * Five vocabularies have landed on top of art that was once keyed on the
 * colour scheme alone: the build, the timber pattern, the room, the paper, and
 * the paper's tone and nib. Each arrival left behind a hand-spelled copy of
 * "what makes this art different" somewhere downstream, and every one of those
 * copies has since fallen behind the spec it was copied from. These tests pin
 * the keys, and pin the copies to the shared function rather than to a list.
 *
 * ## Pin the key the bake is FILED under, not a key beside it
 *
 * Two of the things checked below were once checked one step away from where it
 * mattered, and both were green while the app was wrong:
 *
 *  - `themeKeyOf` was proved injective while `textures.ts` hashed it to 32 bits
 *    before handing it to `bakeCached`. So the sweep now runs over
 *    `caseBakeKey`, which is the literal string in the cache.
 *  - `bookDesignTag` was swept as though it were the spine factory's key. No
 *    cache has ever read that function — the spine caches are invalidation-
 *    keyed (see its header) — so those tests have moved to what they really
 *    establish, and the binding axis that IS in a key (`ownBindingId`) is swept
 *    instead.
 */
import { describe, expect, it } from 'vitest';
// From `libraryKey`, not `textures`: the latter imports Pixi and cannot load
// in node. That is exactly why `themeKeyOf` and `caseBakeKey` live in the pure
// module.
import { caseBakeKey, schemeKey, themeKeyOf } from '../src/features/bookshelf/libraryKey';
import { getTheme, THEME_IDS, type ColourScheme } from '../src/art/themes';
import { caseFaces } from '../src/art/palette';
import { fnv1a } from '../src/art/noise';
import {
  BUILD_IDS,
  PATTERN_IDS,
  resolveShelfDesign,
  shelfDesignTag,
  DEFAULT_SHELF_DESIGN,
  FALLBACK_SHELF_DESIGN,
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
import {
  bookDesignTag,
  BOOK_PRESETS,
  DECORATIONS,
  MATERIAL_LOOKS,
  ownBindingId,
  parseOwnBinding,
  resolveBookDesign,
  SPINE_SHAPES,
} from '../src/art/bookDesign';
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

  it('treats an absent design as whatever it resolves to, not as its own axis', () => {
    // Otherwise a caller that omits `design` gets a THIRD key for art that is
    // byte-identical to something already baked, and bakes it twice.
    //
    // Stated against `resolveShelfDesign` rather than against a named constant:
    // the point is that the KEY and the DRAWING agree about what an absent
    // design means, and that stays true whichever constant the resolver
    // happens to fall back to. Naming one here made this test fail when the
    // fallback was split off from the opening default, for no reason a reader
    // would recognise as a bug.
    expect(themeKeyOf({ themeId: THEME_IDS[0], scheme })).toBe(
      themeKeyOf({ themeId: THEME_IDS[0], scheme, design: resolveShelfDesign(undefined) }),
    );
  });

  it('survives junk out of SQLite without throwing', () => {
    for (const junk of [null, undefined, {}, { build: 'nope' }, { pattern: 42 }]) {
      expect(() =>
        themeKeyOf({ themeId: THEME_IDS[0], scheme, design: junk as never }),
      ).not.toThrow();
    }
    // To the FALLBACK case, not the opening one. They were the same constant
    // until the opening carpentry became something worth looking at; keeping
    // them merged meant a corrupted row silently painted the handsome case, so
    // a reader could not tell a fallback from a choice they had made.
    expect(shelfDesignTag({ build: 'nope' } as never)).toBe(
      shelfDesignTag(FALLBACK_SHELF_DESIGN),
    );
    expect(resolveShelfDesign(null)).toEqual(FALLBACK_SHELF_DESIGN);
    expect(FALLBACK_SHELF_DESIGN).not.toEqual(DEFAULT_SHELF_DESIGN);
  });
});

describe('the string the case bake is actually FILED under', () => {
  /**
   * `themeKeyOf` being injective says nothing about what reaches `bakeCached`.
   * It didn't, for a while: `textures.roomTag` was
   * `fnv1a(schemeKey(…)).toString(36)`, so a hundred and twenty characters of
   * colour arrived at the cache as six. `art/bake.ts`'s own header argues
   * against exactly that ("a (small) correctness risk in a 32-bit collision
   * serving one room's plank to another") and its caller did it anyway.
   *
   * So these sweep `caseBakeKey`, which is the literal string in the map.
   */
  // The four parts' real design sizes (`features/bookshelf/constants.ts`),
  // spelled here rather than imported because that module pulls in the store.
  const PLANK = [1200, 40] as const;

  it('gives every room in the whole vocabulary its own key', () => {
    // 60 schemes x 52 builds x 50 patterns. Enumerable, so enumerated: a
    // birthday-bound argument is what a hashed key had going for it, and it
    // was wrong.
    const keys = new Set<string>();
    let rooms = 0;
    for (const themeId of THEME_IDS) {
      const s = getTheme(themeId).scheme;
      for (const build of BUILD_IDS) {
        for (const pattern of PATTERN_IDS) {
          keys.add(
            caseBakeKey('plank', PLANK[0], PLANK[1], themeKeyOf({ themeId, scheme: s, design: { build, pattern } })),
          );
          rooms += 1;
        }
      }
    }
    expect(rooms).toBe(THEME_IDS.length * BUILD_IDS.length * PATTERN_IDS.length);
    expect(keys.size).toBe(rooms);
  });

  it('separates the four parts of one room, and the sizes of one part', () => {
    const room = themeKeyOf({ themeId: THEME_IDS[0], scheme, design: DEFAULT_SHELF_DESIGN });
    const parts = (['plank', 'recess', 'post', 'crown'] as const).map((p) =>
      caseBakeKey(p, PLANK[0], PLANK[1], room),
    );
    expect(new Set(parts).size).toBe(4);
    expect(caseBakeKey('plank', 1200, 40, room)).not.toBe(caseBakeKey('plank', 1200, 41, room));
    expect(caseBakeKey('plank', 1200, 40, room)).not.toBe(caseBakeKey('plank', 1228, 40, room));
  });

  it('leads with the part and the size, so a bake PROFILE sample stays legible', () => {
    // `bake.ts` records `params.slice(0, 96)` in its ring buffer for the perf
    // HUD. With the room's hexes in front, every sample truncates to colour and
    // no two parts can be told apart in the log.
    const room = themeKeyOf({ themeId: THEME_IDS[0], scheme, design: DEFAULT_SHELF_DESIGN });
    const sample = caseBakeKey('recess', 1200, 280, room).slice(0, 96);
    expect(sample).toContain('recess');
    expect(sample).toContain('1200x280');
  });

  /**
   * The defect that took the hash out, kept as a regression.
   *
   * A reader can type their own timber hex — `libraryPrefs.composeScheme` folds
   * it through `palette.caseFaces` — so the input space is millions of schemes
   * wide, not the sixty authored rooms. A sweep of 400k hexes through the old
   * `fnv1a(...).toString(36)` turned up collisions immediately; this is the
   * first pair it found. Both still hash to `9sjds2`, and both must still get
   * their own bake key.
   */
  it('separates two timber colours the old 32-bit tag could not', () => {
    const roomFor = (hex: string): ColourScheme => {
      const board = caseFaces(hex);
      return {
        timber: board.timber,
        timberDark: board.timberDark,
        recess: board.recess,
        wall: scheme.wall,
        cloths: scheme.cloths,
      };
    };
    const navy = roomFor('#0043a9');
    const teal = roomFor('#006b82');
    expect(navy.timber).not.toBe(teal.timber);

    // The bug, still reproducible: six base-36 characters cannot tell a navy
    // bookcase from a teal one.
    const oldTag = (s: ColourScheme): string =>
      fnv1a(schemeKey(THEME_IDS[0], s)).toString(36);
    expect(oldTag(navy)).toBe(oldTag(teal));

    // The fix.
    const keyFor = (s: ColourScheme): string =>
      caseBakeKey('plank', PLANK[0], PLANK[1], themeKeyOf({
        themeId: THEME_IDS[0],
        scheme: s,
        design: DEFAULT_SHELF_DESIGN,
      }));
    expect(keyFor(navy)).not.toBe(keyFor(teal));
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
   * changing only the sharpness left the old wall on screen — the bake key was
   * correct and never got as far as being consulted. Pinning the shared
   * function here is what stops the copy growing back.
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

describe("a composed binding's id — the one binding axis that IS in a key", () => {
  /**
   * `SpineFactory.paramsCache` is keyed `${styleEpoch}|${bookId}|${pinned}`,
   * and `pinned` is the stored id verbatim. For the 189 named presets that is
   * safe by construction — they come out of a table. For a binding the reader
   * composed in the studio it is not: `own:shape/material/decoration/gilt` has
   * to spell all four axes, because the cache cannot see past the string. Two
   * composed bindings that agreed on an id would share one cached
   * `ResolvedBookStyle`, and one book would be served the other's spine.
   *
   * Nothing tested this. It is the only binding property a key depends on.
   */
  it('round-trips every axis', () => {
    for (const shape of SPINE_SHAPES) {
      const parts = {
        shape,
        material: MATERIAL_LOOKS[3]!,
        decoration: DECORATIONS[5]!,
        gilt: true,
      } as const;
      expect(parseOwnBinding(ownBindingId(parts))).toEqual(parts);
    }
    const bare = {
      shape: SPINE_SHAPES[0]!,
      material: MATERIAL_LOOKS[0]!,
      decoration: 'none',
      gilt: false,
    } as const;
    expect(parseOwnBinding(ownBindingId(bare))).toEqual(bare);
  });

  it('gives every combination in the vocabulary its own id', () => {
    const ids = new Set<string>();
    let n = 0;
    const decorations = [...DECORATIONS, 'none'] as const;
    for (const shape of SPINE_SHAPES) {
      for (const material of MATERIAL_LOOKS) {
        for (const decoration of decorations) {
          for (const gilt of [false, true]) {
            ids.add(ownBindingId({ shape, material, decoration, gilt }));
            n += 1;
          }
        }
      }
    }
    expect(n).toBe(SPINE_SHAPES.length * MATERIAL_LOOKS.length * decorations.length * 2);
    expect(ids.size).toBe(n);
  });

  it('is not confusable with a named preset', () => {
    // Both live in the same field. A composed id that collided with a preset
    // id would resolve to the preset and quietly discard three of the reader's
    // four choices.
    const presetIds = new Set(BOOK_PRESETS.map((p) => p.id));
    for (const shape of SPINE_SHAPES) {
      const id = ownBindingId({
        shape,
        material: MATERIAL_LOOKS[0]!,
        decoration: 'none',
        gilt: false,
      });
      expect(presetIds.has(id)).toBe(false);
    }
  });
});

/**
 * `bookDesignTag` is NOT a cache key and these are not cache-key tests.
 *
 * They were written as though it were the spine factory's params key; it is
 * not, and no cache in the app has ever called this function. Driving the
 * running shelf settles it: with `styleEpoch` held and the pin held at
 * `plain-cloth`, a Book Studio edit still repainted 14.7% of the spine's crop,
 * and unpinning restored the seeded binding byte-for-byte — the spine caches
 * drop their entries (`SpineFactory.invalidate` / `invalidateAll`) rather than
 * key around a binding.
 *
 * What the tag is, and what these therefore prove, is that the vocabularies
 * really are distinct: that fifty cloths are fifty bindings and 189 presets are
 * 189 bindings, rather than a table with duplicates in it. A specimen board
 * shows what one binding looks like and can never show that two of them differ.
 * They stay here, next to the keys, because the tag is also what a content-
 * keyed spine cache would have to carry if one is ever built.
 */
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
   * so the tag called two different bindings the same binding — and the sweep
   * below, which exists to prove fifty cloths are fifty bindings, passed
   * anyway. A distinctness test built on a lossy string proves nothing.
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
