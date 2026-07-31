// @vitest-environment node
/**
 * tests/art-themes.test.ts — the library theme system (src/art/themes.ts).
 *
 * The acceptance criteria in docs/design/library-themes.md §5 that can be
 * checked without pixels:
 *   - fourteen complete worlds, every one a full art package
 *   - no two rooms are the same bookcase recoloured (distinct carpentry
 *     vocabulary, not just distinct hexes)
 *   - eighteen wallpaper patterns; pattern and colourway fully independent
 *   - the wall treatment is orthogonal to both
 *
 * These are assertions about theme *data*, which outlived the renderers that
 * consumed it. The painting stack took the wallpaper renderers with it, so the
 * pattern catalogue is checked for its ids and labels only; the deferred
 * lighting pass took the per-theme light rigs, and the flora/prop/mote
 * dressing went with the art that drew it.
 */

import { describe, expect, it } from 'vitest';

import {
  BACKDROPS,
  BACKDROP_IDS,
  COLOURWAY_IDS,
  DEFAULT_THEME_ID,
  THEMES,
  THEME_IDS,
  THEME_RECIPE_VERSION,
  WALLPAPER_PATTERN_IDS,
  allBackdrops,
  allThemes,
  getTheme,
  isBackdropId,
  isColourwayId,
  isThemeId,
  isWallpaperPatternId,
  resolveBackdrop,
  resolveWallpaper,
  themeBackdrops,
  type LibraryTheme,
} from '../src/art/themes';
import { WALLPAPER_PATTERNS } from '../src/art/wallpaper';

const themes = allThemes();

/**
 * `#rgb` / `#rrggbb` → channels. Local because the shared implementation lived
 * in `art/wood.ts` and went with the painted case; the assertions below only
 * need it to read theme palette hexes.
 */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/* ================================ identity =============================== */

describe('theme registry', () => {
  it('ships the eight original worlds plus the six colourful ones', () => {
    expect(THEME_IDS).toHaveLength(14);
    expect([...THEME_IDS]).toEqual([
      // The colourful six lead the picker; Blossom Grove is the default room.
      'blossom',
      'robot',
      'dino',
      'candy',
      'reef',
      'voyager',
      'athenaeum',
      'conservatory',
      'observatory',
      'cottage',
      'scriptorium',
      'sakura',
      'attic',
      'apothecary',
    ]);
  });

  it('opens a brand-new library in Blossom Grove', () => {
    expect(DEFAULT_THEME_ID).toBe('blossom');
    expect(THEMES[DEFAULT_THEME_ID].name).toBe('Blossom Grove');
  });

  it('keys every theme by its own id and lists them in picker order', () => {
    for (const id of THEME_IDS) expect(THEMES[id].id).toBe(id);
    expect(themes.map((t) => t.id)).toEqual([...THEME_IDS]);
  });

  it('falls back to the refined default for junk ids', () => {
    expect(getTheme(null).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme(undefined).id).toBe(DEFAULT_THEME_ID);
    expect(getTheme('not-a-room').id).toBe(DEFAULT_THEME_ID);
    expect(getTheme('athenaeum').id).toBe('athenaeum');
  });

  it('narrows persisted values', () => {
    expect(isThemeId('sakura')).toBe(true);
    expect(isThemeId('SAKURA')).toBe(false);
    expect(isThemeId(7)).toBe(false);
    expect(isWallpaperPatternId('damask')).toBe(true);
    expect(isWallpaperPatternId('plaid')).toBe(false);
    expect(isColourwayId('tobacco')).toBe(true);
    expect(isColourwayId(null)).toBe(false);
    expect(isBackdropId('shoji')).toBe(true);
    expect(isBackdropId('wallpapered')).toBe(false);
  });

  it('has a recipe version so every raster can be invalidated at once', () => {
    expect(THEME_RECIPE_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(THEME_RECIPE_VERSION)).toBe(true);
  });
});

/* =========================== complete art package ======================== */

describe('every theme is a complete art package', () => {
  it.each(themes.map((t) => [t.id, t] as const))('%s carries every field', (_id, theme) => {
    expect(theme.name.length).toBeGreaterThan(2);
    expect(theme.blurb.length).toBeGreaterThan(10);
    // wood
    expect(theme.wood.light).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.wood.dark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.wood.ringFreq).toBeGreaterThan(0);
    expect(theme.wood.sheen).toBeGreaterThanOrEqual(0);
    expect(theme.wood.sheen).toBeLessThanOrEqual(1);
    // carpentry
    expect(theme.joinery.size).toBeGreaterThan(0);
    expect(theme.crown.height).toBeGreaterThan(20);
    expect(theme.crown.overhang).toBeGreaterThanOrEqual(0);
    expect(theme.rail.width).toBeGreaterThan(10);
    // plate
    expect(theme.plate.w).toBeGreaterThan(40);
    expect(theme.plate.h).toBeGreaterThan(10);
    expect(theme.plate.burn).toBeGreaterThanOrEqual(0);
    expect(theme.plate.burn).toBeLessThanOrEqual(1);
    // wallpaper + wall
    expect(WALLPAPER_PATTERN_IDS).toContain(theme.wallpaper.pattern);
    expect(COLOURWAY_IDS).toContain(theme.wallpaper.colourway);
    expect(theme.wallpaper.tile).toBeGreaterThanOrEqual(128);
    // spine bias
    expect(theme.spineDefaults.pigments.length).toBeGreaterThanOrEqual(4);
    expect(theme.spineDefaults.materials.length).toBeGreaterThan(0);
  });

  it('never renders a handwriting face below the 13px floor', () => {
    for (const theme of themes) {
      expect(theme.plate.fontSize).toBeGreaterThanOrEqual(13);
      if (/Nunito/.test(theme.plate.font)) continue;
      expect(theme.plate.font).toMatch(/Caveat|Patrick Hand|Kalam|Architects Daughter/);
    }
  });

  it('wires the shelf furniture the doc calls for', () => {
    // "tiny drawers below each shelf" / "knitted bunting strung between floors"
    expect(THEMES.apothecary.shelfDetail).toBe('drawers');
    expect(THEMES.cottage.shelfDetail).toBe('bunting');
    // The scriptorium and the attic show the room's own wall through the case.
    expect(THEMES.scriptorium.backing).toBe('wallpaper');
    expect(THEMES.attic.backing).toBe('wallpaper');
    expect(THEMES.athenaeum.backing ?? 'wood').toBe('wood');
  });
});

/* ============================== distinctness ============================= */

describe('no two rooms are the same bookcase recoloured', () => {
  const key = (t: LibraryTheme): string =>
    [
      t.wood.grain,
      t.wood.finish,
      t.joinery.kind,
      t.crown.profile,
      t.crown.carving,
      t.rail.inlay,
      t.plate.kind,
      t.wallpaper.pattern,
    ].join('|');

  it('gives every room a unique carpentry signature', () => {
    const keys = themes.map(key);
    expect(new Set(keys).size).toBe(themes.length);
  });

  it('differs from every other room in at least three of those axes', () => {
    for (let i = 0; i < themes.length; i++) {
      for (let j = i + 1; j < themes.length; j++) {
        const a = key(themes[i]!).split('|');
        const b = key(themes[j]!).split('|');
        const diffs = a.filter((v, k) => v !== b[k]).length;
        expect(
          diffs,
          `${themes[i]!.id} vs ${themes[j]!.id} differ in only ${diffs} axes`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('uses a distinct plate material and wallpaper per room', () => {
    expect(new Set(themes.map((t) => t.plate.kind)).size).toBeGreaterThanOrEqual(12);
    expect(new Set(themes.map((t) => t.wallpaper.pattern)).size).toBe(themes.length);
  });

  it('spreads the wood palettes apart in luminance, not just hue', () => {
    const lum = (hex: string): number => {
      const { r, g, b } = parseHex(hex);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const mids = themes.map((t) => (lum(t.wood.light) + lum(t.wood.dark)) / 2).sort((a, b) => a - b);
    expect(mids[mids.length - 1]! - mids[0]!).toBeGreaterThan(90);
  });
});

/* ============================ colour actually sings ====================== */

describe('every room is genuinely colourful', () => {
  /** Chroma proxy: how far apart the RGB channels are, 0 = grey. */
  const chroma = (hex: string): number => {
    const { r, g, b } = parseHex(hex);
    return Math.max(r, g, b) - Math.min(r, g, b);
  };

  it('never ships a drab spine ramp', () => {
    for (const theme of themes) {
      const pigments = theme.spineDefaults.pigments;
      const mean = pigments.reduce((sum, p) => sum + chroma(p), 0) / pigments.length;
      expect(mean, `${theme.id} spine pigments are washed out`).toBeGreaterThan(70);
      // And at least one pigment that really sings.
      expect(Math.max(...pigments.map(chroma)), `${theme.id} has no hero colour`).toBeGreaterThan(110);
    }
  });

  it('keeps the colourful six visually apart from the heritage eight', () => {
    const colourful = ['blossom', 'robot', 'dino', 'candy', 'reef', 'voyager'] as const;
    for (const id of colourful) {
      const t = THEMES[id];
      expect(t.name.length).toBeGreaterThan(3);
      // Each brings its own new carving + plate + wallpaper vocabulary.
      expect(
        ['blossom', 'circuit', 'fossil', 'candy-stripe', 'coral', 'starfield'],
      ).toContain(t.crown.carving);
      expect(
        ['painted-sign', 'led-panel', 'amber-stone', 'candy-wrapper', 'shell', 'neon'],
      ).toContain(t.plate.kind);
    }
    // No two of them share a carving, a plate or a wallpaper.
    for (const axis of ['carving', 'plate', 'wallpaper'] as const) {
      const values = colourful.map((id) =>
        axis === 'carving'
          ? THEMES[id].crown.carving
          : axis === 'plate'
            ? THEMES[id].plate.kind
            : THEMES[id].wallpaper.pattern,
      );
      expect(new Set(values).size, `${axis} repeats across the colourful six`).toBe(6);
    }
  });
});

/* =============================== wallpaper =============================== */

describe('wallpaper library', () => {
  it('ships the twelve original patterns plus the colourful six', () => {
    expect(WALLPAPER_PATTERN_IDS).toHaveLength(18);
    // The renderers are gone; the catalogue survives so the studio picker can
    // still label the preference it persists.
    for (const id of WALLPAPER_PATTERN_IDS) {
      const p = WALLPAPER_PATTERNS[id];
      expect(p.id).toBe(id);
      expect(p.name.length).toBeGreaterThan(2);
    }
  });

  it('ships eighteen colourways for a theme to name', () => {
    expect(COLOURWAY_IDS).toHaveLength(18);
    for (const id of COLOURWAY_IDS) expect(isColourwayId(id)).toBe(true);
  });

  it('keeps pattern and colourway independent (144 walls)', () => {
    const combos = new Set<string>();
    for (const p of WALLPAPER_PATTERN_IDS) {
      for (const c of COLOURWAY_IDS) {
        combos.add(`${p}|${resolveWallpaper(THEMES.athenaeum, { pattern: p, colourway: c }).colourway}`);
      }
    }
    expect(combos.size).toBe(18 * 18);
  });

  it('applies studio overrides one axis at a time', () => {
    const t = THEMES.cottage;
    expect(resolveWallpaper(t, null)).toEqual(t.wallpaper);
    expect(resolveWallpaper(t, { pattern: 'damask' })).toEqual({
      pattern: 'damask',
      colourway: t.wallpaper.colourway,
      tile: t.wallpaper.tile,
    });
    expect(resolveWallpaper(t, { colourway: 'moss' }).pattern).toBe(t.wallpaper.pattern);
    // Junk on either axis falls back to the room's own choice.
    expect(resolveWallpaper(t, { pattern: 'plaid', colourway: 'chartreuse' })).toEqual(t.wallpaper);
  });
});

/* =============================== backdrops =============================== */

describe('wall treatments are orthogonal to the room', () => {
  it('ships six treatments, each with picker copy', () => {
    expect(BACKDROP_IDS).toHaveLength(6);
    expect(allBackdrops()).toHaveLength(6);
    for (const id of BACKDROP_IDS) {
      expect(BACKDROPS[id].id).toBe(id);
      expect(BACKDROPS[id].name.length).toBeGreaterThan(2);
      expect(BACKDROPS[id].blurb.length).toBeGreaterThan(10);
      expect(typeof BACKDROPS[id].usesPattern).toBe('boolean');
    }
    // Only the papered and panelled walls can show the wallpaper pattern.
    expect(BACKDROP_IDS.filter((id) => BACKDROPS[id].usesPattern).sort()).toEqual([
      'panelled',
      'papered',
    ]);
  });

  it('gives every room two or three curated walls, all valid and distinct', () => {
    for (const theme of themes) {
      expect(theme.backdrops.length).toBeGreaterThanOrEqual(2);
      expect(theme.backdrops.length).toBeLessThanOrEqual(3);
      expect(new Set(theme.backdrops).size).toBe(theme.backdrops.length);
      for (const id of theme.backdrops) expect(BACKDROP_IDS).toContain(id);
      expect(themeBackdrops(theme).map((b) => b.id)).toEqual([...theme.backdrops]);
    }
  });

  it('does not give every room the same shortlist', () => {
    expect(new Set(themes.map((t) => t.backdrops.join('|'))).size).toBeGreaterThanOrEqual(6);
    // The rooms whose identity IS their wall lead with it.
    expect(THEMES.scriptorium.backdrops[0]).toBe('plastered');
    expect(THEMES.sakura.backdrops[0]).toBe('shoji');
    expect(THEMES.conservatory.backdrops[0]).toBe('glazed');
  });

  it('lets the studio pick any wall for any room, and ignores junk', () => {
    for (const theme of themes) {
      expect(resolveBackdrop(theme, null)).toBe(theme.backdrops[0]);
      expect(resolveBackdrop(theme, 'not-a-wall')).toBe(theme.backdrops[0]);
      for (const id of BACKDROP_IDS) expect(resolveBackdrop(theme, id)).toBe(id);
    }
  });
});

/*
 * `scaleFloraDensity` had a suite here, guarding the acceptance criterion that
 * a zero slider reached a genuinely clean shelf. Every shelf is clean now:
 * flora, shelf props and the dust motes went with the painting stack, and the
 * `light` / `flora` / `props` / `motes` packages came off `LibraryTheme` with
 * them rather than sit in the data reading like a promise.
 */

/*
 * `parseHex`/`mixHex` had a suite here — a mixed colour silently degrading to
 * grey was invisible in a diff and catastrophic on screen. Both lived in
 * `art/wood.ts` to tint the painted case, and went with it. `art/charms.ts`
 * still has its own `mixHex`, covered by tests/art-bookstyle.test.ts.
 */
