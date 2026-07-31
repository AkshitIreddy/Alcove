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
  COVER_FRAME_COUNT,
  COVER_MEDALLION_COUNT,
  COVER_PALETTE_COUNT,
  coverPaletteCss,
  deriveCoverParams,
  normalizeCoverOverrides,
} from '../src/art/covers';
import { clothForPalette, deriveSpineParams } from '../src/art/spines';
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
      expect([0, 1, 2]).toContain(p.titleFont);
      expect(typeof p.gilt).toBe('boolean');
    }
  });

  it('shares palette / texture / title face / ornament with the spine of the same seed', () => {
    for (const seed of [7, 42, 0xdead, 123456789]) {
      const cover = deriveCoverParams(seed);
      const spine = deriveSpineParams(seed);
      expect(cover.palette).toBe(spine.palette);
      expect(cover.texture).toBe(spine.texture);
      expect(cover.titleFont).toBe(spine.font);
      expect(cover.medallion).toBe(spine.ornament % COVER_MEDALLION_COUNT);
      // gilt may be promoted (extra cover roll) but never demoted.
      if (spine.gilt) expect(cover.gilt).toBe(true);
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
        palette: 99,
        texture: -1,
        frame: 2.5,
        medallion: '3',
        titleFont: 3,
        gilt: 'yes',
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
