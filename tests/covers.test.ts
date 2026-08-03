// @vitest-environment node
/**
 * tests/covers.test.ts — cover parameter derivation + override plumbing
 * (src/art/covers.ts) and the cover_meta helpers (src/data/books.ts).
 *
 * Plain Node: the canvas render path (renderCover/renderCoverInto) is proved
 * visually through the Playwright harness grid instead — here we pin down
 * everything deterministic and DOM-free.
 */

import { describe, expect, it } from 'vitest';

import {
  COVER_FONTS,
  COVER_FONT_COUNT,
  COVER_FONT_KIN,
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  COVER_PALETTE_COUNT,
  COVER_TEXTURES,
  COVER_TEXTURE_COUNT,
  COVER_TEXTURE_LABELS,
  coverCacheKey,
  coverPaletteCss,
  coveringSpecFor,
  deriveCoverParams,
  handForFace,
  normalizeCoverOverrides,
  type CoverParams,
} from '../src/art/covers';
import {
  MATERIALS,
  MATERIAL_LOOKS,
  bindingMaterialFor,
  materialLookFor,
  presetForSeed,
} from '../src/art/bookDesign';
import {
  ORNAMENT_COUNT,
  PIGMENT_COUNT,
  clothForPalette,
  deriveSpineParams,
} from '../src/art/spines';
import { mergeCoverMetaSection, readCoverOverrides, readPageDefaults } from '../src/data/books';

/* ─────────────────────────── deriveCoverParams ────────────────────────── */

describe('deriveCoverParams', () => {
  it('same seed ⇒ structurally identical params', () => {
    expect(deriveCoverParams(0xbeef)).toEqual(deriveCoverParams(0xbeef));
  });

  it('different seeds ⇒ different params', () => {
    const a = deriveCoverParams(101);
    const b = deriveCoverParams(102);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('respects the documented ranges over many seeds', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const p = deriveCoverParams(seed * 2654435761);
      expect(p.palette).toBeGreaterThanOrEqual(0);
      expect(p.palette).toBeLessThan(COVER_PALETTE_COUNT);
      expect([0, 1, 2]).toContain(p.texture);
      expect(p.frame).toBeGreaterThanOrEqual(0);
      expect(p.frame).toBeLessThan(COVER_FRAME_COUNT);
      expect(p.medallion).toBeGreaterThanOrEqual(0);
      expect(p.medallion).toBeLessThan(COVER_MEDALLION_COUNT);
      expect(p.titleFont).toBeGreaterThanOrEqual(0);
      expect(p.titleFont).toBeLessThan(COVER_FONT_COUNT);
      expect(p.covering).toBeGreaterThanOrEqual(0);
      expect(p.covering).toBeLessThan(COVER_TEXTURE_COUNT);
      expect(typeof p.gilt).toBe('boolean');
    }
  });

  it('shares palette / texture / ornament with the spine of the same seed', () => {
    for (const seed of [7, 42, 0xdead, 123456789]) {
      const cover = deriveCoverParams(seed);
      const spine = deriveSpineParams(seed);
      expect(cover.palette).toBe(spine.palette);
      expect(cover.texture).toBe(spine.texture);
      expect(cover.medallion).toBe(spine.ornament % COVER_MEDALLION_COUNT);
      // gilt may be promoted (extra cover roll) but never demoted.
      if (spine.gilt) expect(cover.gilt).toBe(true);
    }
  });

  /**
   * The board is lettered with the same TOOL as the spine.
   *
   * `titleFont` used to be `spine.font` outright, which is the same fact stated
   * the only way three faces allowed. There are fifty hands now, and they are
   * settings of those same three faces — so the promise survives as kinship
   * rather than equality, and this is where it is kept honest. A hand rolled
   * out of kin would put Kalam on a board whose spine is lettered in Caveat,
   * and the reader is looking at two books again.
   */
  it('letters the board in a hand of the spine face, over many seeds', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const s = seed * 2654435761;
      expect(COVER_FONT_KIN[deriveCoverParams(s).titleFont]).toBe(deriveSpineParams(s).font);
    }
  });

  it('applies overrides on top of the derived params, seed untouched', () => {
    const base = deriveCoverParams(0xf00d);
    const overridden = deriveCoverParams(0xf00d, {
      palette: (base.palette + 1) % COVER_PALETTE_COUNT,
      gilt: !base.gilt,
    });
    expect(overridden.palette).toBe((base.palette + 1) % COVER_PALETTE_COUNT);
    expect(overridden.gilt).toBe(!base.gilt);
    expect(overridden.seed).toBe(base.seed);
    expect(overridden.frame).toBe(base.frame); // untouched knobs survive
  });
});

/* ────────────────────────── normalizeCoverOverrides ───────────────────── */

describe('normalizeCoverOverrides', () => {
  it('accepts a full valid override object', () => {
    expect(
      normalizeCoverOverrides({
        palette: 3,
        texture: 1,
        frame: 2,
        medallion: 7,
        titleFont: 0,
        gilt: true,
      }),
    ).toEqual({ palette: 3, texture: 1, frame: 2, medallion: 7, titleFont: 0, gilt: true });
  });

  it('drops invalid values instead of clamping them into meaning', () => {
    expect(
      normalizeCoverOverrides({
        palette: 999,
        texture: -1,
        frame: 2.5,
        medallion: '3',
        titleFont: COVER_FONT_COUNT,
        covering: COVER_TEXTURE_COUNT,
        gilt: 'yes',
      }),
    ).toBeNull();
  });

  /**
   * The bound is read off the table, not off a number somebody typed.
   *
   * When `titleFont` was three wide, `3` was the first invalid index; it is a
   * perfectly good hand now. A test that keeps its own copy of a count is the
   * same failure as a constant that does — it goes on passing while it stops
   * meaning anything.
   */
  it('accepts the last index of every table and rejects the one past it', () => {
    expect(
      normalizeCoverOverrides({
        palette: COVER_PALETTE_COUNT - 1,
        covering: COVER_TEXTURE_COUNT - 1,
        frame: COVER_FRAME_COUNT - 1,
        medallion: COVER_MEDALLION_COUNT - 1,
        titleFont: COVER_FONT_COUNT - 1,
      }),
    ).toEqual({
      palette: COVER_PALETTE_COUNT - 1,
      covering: COVER_TEXTURE_COUNT - 1,
      frame: COVER_FRAME_COUNT - 1,
      medallion: COVER_MEDALLION_COUNT - 1,
      titleFont: COVER_FONT_COUNT - 1,
    });
    expect(
      normalizeCoverOverrides({
        palette: COVER_PALETTE_COUNT,
        covering: COVER_TEXTURE_COUNT,
        frame: COVER_FRAME_COUNT,
        medallion: COVER_MEDALLION_COUNT,
        titleFont: COVER_FONT_COUNT,
      }),
    ).toBeNull();
  });

  it('keeps the valid subset of a partly-bad object', () => {
    expect(normalizeCoverOverrides({ palette: 2, frame: 100, gilt: false })).toEqual({
      palette: 2,
      gilt: false,
    });
  });

  it('rejects non-objects', () => {
    expect(normalizeCoverOverrides(null)).toBeNull();
    expect(normalizeCoverOverrides(undefined)).toBeNull();
    expect(normalizeCoverOverrides('gilt')).toBeNull();
    expect(normalizeCoverOverrides([1, 2])).toBeNull();
    expect(normalizeCoverOverrides(42)).toBeNull();
  });

  it('zero is a valid index everywhere (no falsy traps)', () => {
    expect(
      normalizeCoverOverrides({ palette: 0, texture: 0, frame: 0, medallion: 0, titleFont: 0 }),
    ).toEqual({ palette: 0, texture: 0, frame: 0, medallion: 0, titleFont: 0 });
  });
});

/* ─────────────────────────────── palette css ──────────────────────────── */

describe('coverPaletteCss', () => {
  it('returns hsl() strings for every palette, wrapping out-of-range', () => {
    for (let i = 0; i < COVER_PALETTE_COUNT; i += 1) {
      const duo = coverPaletteCss(i);
      expect(duo.top).toMatch(/^hsl\(/);
      expect(duo.bottom).toMatch(/^hsl\(/);
    }
    expect(coverPaletteCss(COVER_PALETTE_COUNT)).toEqual(coverPaletteCss(0));
    expect(coverPaletteCss(-1)).toEqual(coverPaletteCss(COVER_PALETTE_COUNT - 1));
  });

  /**
   * The shelf and the pull-out must agree about a book's colour.
   *
   * Both fold the same twenty-slot `palette` onto the flat vocabulary's six
   * cloths, and for a while they folded it *differently* — the spine used the
   * pigment table, the cover used `palette % 6` — so a book was one colour on
   * the shelf and another in your hand. This pins the two together without
   * reaching into either module's private colour tables: whenever the spine
   * puts two palettes on the same cloth the cover must too, and vice versa.
   */
  it('agrees with the spine renderer about which palette is which cloth', () => {
    for (let a = 0; a < COVER_PALETTE_COUNT; a += 1) {
      for (let b = 0; b < COVER_PALETTE_COUNT; b += 1) {
        const sameOnSpine = clothForPalette(a) === clothForPalette(b);
        const sameOnCover = coverPaletteCss(a).top === coverPaletteCss(b).top;
        expect(sameOnCover).toBe(sameOnSpine);
      }
    }
  });
});

/* ──────────────────────── the five vocabularies ───────────────────────── */

/**
 * Every count is DERIVED from the table it counts.
 *
 * The note on `COVER_PALETTE_COUNT` explains why this suite exists: that
 * constant was written `20`, the pigment table grew to 50, and covers spent
 * however long arriving with a palette outside their own declared bound — with
 * nothing failing anywhere, because a restated literal is a lie no type can
 * catch. Two more constants (`COVER_MEDALLION_COUNT`, and then the two below)
 * were caught making the same mistake afterwards. So the derivations are
 * gated, not trusted.
 */
describe('the cover vocabularies are derived, never restated', () => {
  it('counts fifty of each, and each count matches its own table', () => {
    expect(COVER_PALETTE_COUNT).toBe(PIGMENT_COUNT);
    expect(COVER_MEDALLION_COUNT).toBe(ORNAMENT_COUNT);
    expect(COVER_TEXTURE_COUNT).toBe(COVER_TEXTURES.length);
    expect(COVER_FONT_COUNT).toBe(COVER_FONTS.length);
    // The board's coverings ARE the spine's, and not a copy of them.
    expect(COVER_TEXTURES).toBe(MATERIAL_LOOKS);
    for (const count of [
      COVER_PALETTE_COUNT,
      COVER_MEDALLION_COUNT,
      COVER_TEXTURE_COUNT,
      COVER_FRAME_COUNT,
      COVER_FONT_COUNT,
    ]) {
      expect(count).toBeGreaterThanOrEqual(50);
    }
  });

  it('labels every covering and every hand, with no two alike', () => {
    expect(COVER_TEXTURE_LABELS).toHaveLength(COVER_TEXTURE_COUNT);
    expect(new Set(COVER_TEXTURE_LABELS).size).toBe(COVER_TEXTURE_COUNT);
    expect(COVER_FONTS).toHaveLength(COVER_FONT_COUNT);
    expect(new Set(COVER_FONTS).size).toBe(COVER_FONT_COUNT);
    expect(COVER_FONT_KIN).toHaveLength(COVER_FONT_COUNT);
  });
});

describe('the fifty hands', () => {
  /**
   * `titleFont` is index-addressed by every `cover_meta` blob ever written and
   * by `bookStyle.TITLE_FONTS`, so the head of the table is load-bearing:
   * reorder it and every book anybody has customised is re-lettered.
   */
  it('keeps Caveat / Kalam / Patrick Hand at 0, 1, 2', () => {
    expect(COVER_FONTS.slice(0, 3)).toEqual(['Caveat', 'Kalam', 'Patrick Hand']);
    expect(COVER_FONT_KIN.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('gives every hand a kin among the spine faces, or none at all', () => {
    for (const kin of COVER_FONT_KIN) expect([-1, 0, 1, 2]).toContain(kin);
    // Each of the three has enough settings to be worth rolling. One hand per
    // face would make `handForFace` a rename of the old `titleFont: spine.font`.
    for (const face of [0, 1, 2]) {
      expect(COVER_FONT_KIN.filter((k) => k === face).length).toBeGreaterThanOrEqual(7);
    }
    // …and the faces the spine cannot letter in are offered, never rolled.
    expect(COVER_FONT_KIN.filter((k) => k === -1).length).toBeGreaterThan(0);
  });

  it('handForFace is deterministic, in kin, and total', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = seed * 2654435761;
      for (const face of [0, 1, 2]) {
        const hand = handForFace(face, s);
        expect(handForFace(face, s)).toBe(hand);
        expect(COVER_FONT_KIN[hand]).toBe(face);
      }
    }
    // Junk in never throws and never lands outside the table.
    for (const face of [-1, 3, 99, 1.7, Number.NaN]) {
      const hand = handForFace(face, 12345);
      expect(hand).toBeGreaterThanOrEqual(0);
      expect(hand).toBeLessThan(COVER_FONT_COUNT);
    }
  });

  it('spreads books across the hands rather than favouring one', () => {
    const used = new Set<number>();
    for (let seed = 1; seed <= 3000; seed += 1) used.add(deriveCoverParams(seed * 7919).titleFont);
    // Every rollable hand should turn up in three thousand books.
    expect(used.size).toBe(COVER_FONT_KIN.filter((k) => k >= 0).length);
  });
});

describe('the fifty coverings', () => {
  it('resolves an index, a material, or nothing at all', () => {
    const base: CoverParams = {
      seed: 1,
      palette: 3,
      texture: 0,
      frame: 0,
      medallion: 0,
      titleFont: 0,
      gilt: false,
    };
    // The index wins where there is one…
    for (let i = 0; i < COVER_TEXTURE_COUNT; i += 1) {
      expect(coveringSpecFor({ ...base, covering: i }).id).toBe(COVER_TEXTURES[i]);
    }
    // …the studio's chip answers when there is not…
    expect(coveringSpecFor({ ...base, material: 'vellum' }).id).toBe('vellum');
    // …and a bare pre-covering blob still resolves to something drawable.
    expect(MATERIALS[coveringSpecFor(base).id]).toBeDefined();
    // Junk indexes fall through to the material rather than throwing.
    for (const junk of [-1, COVER_TEXTURE_COUNT, 2.5, Number.NaN]) {
      expect(MATERIALS[coveringSpecFor({ ...base, covering: junk }).id]).toBeDefined();
    }
  });

  it('binds an untouched book in the covering its own spine wears', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = seed * 2654435761;
      const cover = deriveCoverParams(s);
      // `presetForSeed` is what `renderSpine` reads when nothing is pinned;
      // the board has to arrive at the same one or the two faces of the book
      // are grained differently.
      const bound = presetForSeed(s >>> 0).material;
      expect(coveringSpecFor(cover).id).toBe(bound);
    }
  });

  /**
   * The studio hands `material` down on EVERY save, pinned or not, so dragging
   * the covering along with it unconditionally would collapse all fifty onto
   * the seven chips the moment anybody opened the panel — while the spine kept
   * its fifty.
   */
  it('keeps the binding when the chip still agrees with it', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const s = seed * 2654435761;
      const derived = deriveCoverParams(s);
      const reported = bindingMaterialFor(coveringSpecFor(derived).id);
      expect(deriveCoverParams(s, { material: reported }).covering).toBe(derived.covering);
    }
  });

  it('moves the covering when the reader moves the chip', () => {
    const s = 0xc0ffee;
    const derived = deriveCoverParams(s);
    const chip = bindingMaterialFor(coveringSpecFor(derived).id) === 'vellum' ? 'leather' : 'vellum';
    expect(coveringSpecFor(deriveCoverParams(s, { material: chip })).id).toBe(
      materialLookFor(chip),
    );
  });
});

/* ─────────────────────────────── cache key ────────────────────────────── */

/**
 * Every axis that varies a baked pixel has to reach the key.
 *
 * CLAUDE.md states this rule for the shelf, the wall and the spine, and the
 * reason it keeps being stated is that breaking it is invisible: the cache
 * validates nothing about a hit, so a key missing an axis serves the wrong
 * board to every reader who already has the right one under that key, and goes
 * on doing it until the app is reloaded. A new vocabulary is exactly when it
 * gets forgotten, so the test turns each knob rather than reading the key.
 */
describe('coverCacheKey carries every axis', () => {
  const base: CoverParams = {
    seed: 0xbead,
    palette: 4,
    clothHex: null,
    texture: 0,
    covering: 3,
    frame: 7,
    medallion: 9,
    titleFont: 2,
    gilt: false,
    material: 'cloth',
    titlePlate: 'label',
    cornerProtectors: false,
    insetPlate: false,
    edge: 'plain',
    wear: 0.1,
    charm: 'none',
    charmColor: 0,
  };
  const key = (p: Partial<CoverParams>): string => coverCacheKey(300, 416, { ...base, ...p }, 'Alcove');

  it('is stable for identical params', () => {
    expect(key({})).toBe(key({}));
  });

  it('changes when any knob does', () => {
    const turns: Array<[string, Partial<CoverParams>]> = [
      ['seed', { seed: base.seed + 1 }],
      ['palette', { palette: 5 }],
      ['clothHex', { clothHex: '#31708e' }],
      ['texture', { texture: 2 }],
      ['covering', { covering: 4 }],
      ['frame', { frame: 8 }],
      ['medallion', { medallion: 10 }],
      ['titleFont', { titleFont: 3 }],
      ['gilt', { gilt: true }],
      ['titlePlate', { titlePlate: 'gilt' }],
      ['cornerProtectors', { cornerProtectors: true }],
      ['insetPlate', { insetPlate: true }],
      ['edge', { edge: 'gilt' }],
      ['wear', { wear: 0.9 }],
      ['charm', { charm: 'ribbon' }],
      ['charmColor', { charmColor: 3 }],
    ];
    const same = turns.filter(([, patch]) => key(patch) === key({})).map(([name]) => name);
    expect(same).toEqual([]);
  });

  it('separates sizes, titles and the plate-less backdrop', () => {
    const p = { ...base };
    expect(coverCacheKey(300, 416, p, 'A')).not.toBe(coverCacheKey(300, 416, p, 'B'));
    expect(coverCacheKey(300, 416, p, 'A')).not.toBe(coverCacheKey(301, 416, p, 'A'));
    expect(coverCacheKey(300, 416, p, 'A')).not.toBe(
      coverCacheKey(300, 416, p, 'A', { plate: false }),
    );
  });

  /**
   * Two ways of saying the same board are one PNG.
   *
   * `covering` is folded through `coveringSpecFor` rather than written raw, so
   * a book that names its covering by index and a book that leaves the index
   * absent and lets its material resolve to the same one are the same picture —
   * and paying to bake it twice would be the cache failing in the harmless
   * direction, which is still the cache failing.
   */
  it('folds an absent covering onto the one its material resolves to', () => {
    const i = COVER_TEXTURES.indexOf(materialLookFor('vellum'));
    expect(key({ material: 'vellum', covering: undefined })).toBe(
      key({ material: 'vellum', covering: i }),
    );
  });
});

/* ───────────────────────── cover_meta helpers (books) ─────────────────── */

describe('cover_meta helpers', () => {
  it('readCoverOverrides pulls the cover section, null-safe', () => {
    expect(readCoverOverrides(null)).toBeNull();
    expect(readCoverOverrides({ coverMeta: null })).toBeNull();
    expect(readCoverOverrides({ coverMeta: { cover: 'nope' } })).toBeNull();
    expect(readCoverOverrides({ coverMeta: { cover: [1] } })).toBeNull();
    expect(readCoverOverrides({ coverMeta: { cover: { palette: 4 } } })).toEqual({
      palette: 4,
    });
  });

  it('readPageDefaults validates and clamps the pageDefaults section', () => {
    expect(readPageDefaults(null)).toBeNull();
    expect(readPageDefaults({ coverMeta: {} })).toBeNull();
    expect(
      readPageDefaults({ coverMeta: { pageDefaults: { lineHeightPx: 30, pageStyle: 'grid', ink: 'graphite' } } }),
    ).toEqual({ lineHeightPx: 30, pageStyle: 'grid', ink: 'graphite' });
    // clamped into the editor's legal band, junk dropped
    expect(
      readPageDefaults({ coverMeta: { pageDefaults: { lineHeightPx: 999, pageStyle: 'plaid', ink: 'crimson' } } }),
    ).toEqual({ lineHeightPx: 64 });
    expect(readPageDefaults({ coverMeta: { pageDefaults: { ink: 7 } } })).toBeNull();
  });

  it('mergeCoverMetaSection merges without clobbering sibling sections', () => {
    const meta = { cover: { palette: 1 }, pageDefaults: { ink: 'sepia' } };
    expect(mergeCoverMetaSection(meta, 'cover', { palette: 5 })).toEqual({
      cover: { palette: 5 },
      pageDefaults: { ink: 'sepia' },
    });
    expect(mergeCoverMetaSection(meta, 'cover', null)).toEqual({
      pageDefaults: { ink: 'sepia' },
    });
    expect(mergeCoverMetaSection(null, 'pageDefaults', { ink: 'ink-blue' })).toEqual({
      pageDefaults: { ink: 'ink-blue' },
    });
    // removing the last section collapses the blob to null (column cleared)
    expect(mergeCoverMetaSection({ cover: { palette: 1 } }, 'cover', null)).toBeNull();
    expect(mergeCoverMetaSection(null, 'cover', {})).toBeNull();
  });
});
