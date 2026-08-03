/**
 * tests/room-presets.test.ts — the whole-room presets.
 *
 * A preset is a bundle of ids pointing into four other vocabularies, and every
 * one of those pointers fails SILENTLY. `getWallpaper` answers an unknown id
 * with the bare wall, `resolveShelfDesign` answers an unknown build with the
 * plank case, `getTheme` answers an unknown room with the default: a typo in
 * the table below does not throw, does not fail to render, and does not look
 * obviously wrong — it just quietly ships a card called "Gilt Salon" that is a
 * plain plank case on an empty wall.
 *
 * The coverage tests are the other half. The presets are the fast path — most
 * readers will only ever press these cards — so a table that stopped reaching
 * some of the carpentry would make part of the app unreachable in practice
 * while every count in every other file still said it was there. That is
 * exactly the failure `tests/catalogue-reach.test.ts` was written for, one
 * vocabulary along.
 */
import { describe, expect, it } from 'vitest';
import {
  ROOM_PRESETS,
  ROOM_PRESET_GROUPS,
  matchRoomPreset,
  roomPresetOptions,
} from '../src/views/rail/designOptions';
import {
  BUILD_IDS,
  DEFAULT_SHELF_DESIGN,
  PATTERN_IDS,
  isBuildId,
  isPatternId,
} from '../src/art/shelfDesign';
import { DEFAULT_THEME_ID, isThemeId } from '../src/art/themes';
import {
  DEFAULT_WALLPAPER_ID,
  WALLPAPER_PRESETS,
  wallpaperAxisKey,
  wallpaperSpec,
} from '../src/art/wallpaperDesign';

describe('every preset points at something real', () => {
  it('names a room, a build, a pattern and a paper that all exist', () => {
    const broken: string[] = [];
    for (const p of ROOM_PRESETS) {
      if (!isThemeId(p.theme)) broken.push(`${p.id}: room ${p.theme}`);
      if (!isBuildId(p.build)) broken.push(`${p.id}: build ${p.build}`);
      if (!isPatternId(p.pattern)) broken.push(`${p.id}: pattern ${p.pattern}`);
      // Through the LIST, not through `getWallpaper` — that is total and hands
      // back the bare wall for a name nobody has, which is the silent failure.
      if (!WALLPAPER_PRESETS.some((w) => w.id === p.paper)) {
        broken.push(`${p.id}: paper ${p.paper}`);
      }
    }
    expect(broken, `unresolvable preset fields: ${broken.join(', ')}`).toEqual([]);
  });

  it('carries the paper it names, tone and nib included', () => {
    for (const p of ROOM_PRESETS) {
      const named = WALLPAPER_PRESETS.find((w) => w.id === p.paper);
      expect(wallpaperAxisKey(p.wallpaper)).toBe(wallpaperAxisKey(named!.spec));
    }
  });

  it('gives every preset a group the picker knows how to shelve', () => {
    for (const p of ROOM_PRESETS) {
      expect(ROOM_PRESET_GROUPS, `${p.id} is in group ${p.group}`).toContain(p.group);
    }
  });

  it('fills every group — an empty classification is a heading with nothing under it', () => {
    for (const group of ROOM_PRESET_GROUPS) {
      const n = ROOM_PRESETS.filter((p) => p.group === group).length;
      expect(n, `group ${group} has ${n} presets`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('the presets are worth browsing', () => {
  it('offers enough of them to be a browse rather than a radio button', () => {
    expect(ROOM_PRESETS.length).toBeGreaterThanOrEqual(40);
  });

  it('has no two presets that are the same room', () => {
    const seen = new Map<string, string>();
    for (const p of ROOM_PRESETS) {
      const key = `${p.theme}|${p.build}|${p.pattern}|${wallpaperAxisKey(p.wallpaper)}`;
      expect(seen.get(key), `${p.id} is the same room as ${seen.get(key) ?? ''}`).toBeUndefined();
      seen.set(key, p.id);
    }
  });

  /**
   * The house room is exempt, and only the house room: its paper is
   * `DEFAULT_WALLPAPER_ID`, which belongs to `art/wallpaperDesign` rather than
   * to this table. If that default is ever repointed at a paper a preset
   * already hangs, the two cards will look alike — mildly untidy, and not a
   * reason to fail a build in a file that did not choose it.
   */
  it('hangs a different paper in each — no two rooms share a wall', () => {
    const chosen = ROOM_PRESETS.filter((p) => p.id !== 'quiet.house');
    const papers = new Set(chosen.map((p) => p.paper));
    expect(papers.size).toBe(chosen.length);
  });

  it('has unique ids', () => {
    expect(new Set(ROOM_PRESETS.map((p) => p.id)).size).toBe(ROOM_PRESETS.length);
  });
});

describe('the presets reach the whole carpentry vocabulary', () => {
  /**
   * Not a count — a count would be a second place to update. The claim is that
   * a reader who only ever presses preset cards still meets every build and
   * every treatment the app can draw.
   */
  it('uses every build at least once', () => {
    const used = new Set(ROOM_PRESETS.map((p) => p.build));
    const missing = BUILD_IDS.filter((id) => !used.has(id));
    expect(missing, `builds no preset reaches: ${missing.join(', ')}`).toEqual([]);
  });

  it('uses every timber pattern at least once', () => {
    const used = new Set(ROOM_PRESETS.map((p) => p.pattern));
    const missing = PATTERN_IDS.filter((id) => !used.has(id));
    expect(missing, `patterns no preset reaches: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('a preset card is filed under everything it draws', () => {
  /**
   * `DesignCanvas` caches the drawn tile on `artKey`, and a room card varies on
   * FOUR things — the colours, the build, the treatment and the paper. The
   * colours are the dangerous one: the card paints itself in a scheme the tile
   * store knows nothing about (`drawInScheme`), so without the room id in the
   * key the first preset drawn would be served to every preset after it.
   */
  it('gives every preset its own card key', () => {
    const opts = roomPresetOptions();
    expect(new Set(opts.map((o) => o.artKey)).size).toBe(opts.length);
  });

  it('derives the paper half of the key rather than re-spelling it', () => {
    for (const p of ROOM_PRESETS) {
      const opt = roomPresetOptions().find((o) => o.id === p.id);
      expect(opt?.artKey).toContain(wallpaperAxisKey(p.wallpaper));
      expect(opt?.artKey).toContain(p.theme);
      expect(opt?.artKey).toContain(`${p.build}.${p.pattern}`);
    }
  });
});

describe('the studio can tell which preset a room is wearing', () => {
  it('recognises every preset from its own values', () => {
    for (const p of ROOM_PRESETS) {
      expect(matchRoomPreset(p), `${p.id} did not match itself`).toBe(p.id);
    }
  });

  it("answers '' for a room nobody named", () => {
    const odd = {
      theme: ROOM_PRESETS[0]!.theme,
      build: ROOM_PRESETS[0]!.build,
      pattern: ROOM_PRESETS[0]!.pattern,
      // A paper the first preset does not hang. Any mismatch is enough.
      wallpaper: wallpaperSpec(
        WALLPAPER_PRESETS.find((w) => w.id !== ROOM_PRESETS[0]!.paper)!.id,
      ),
    };
    expect(matchRoomPreset(odd)).toBe('');
  });

  /**
   * The room a new library opens in has to be a card the strip can show as
   * pressed, or a fresh reader is told they are in "a room of your own" before
   * they have chosen anything. Derived from the three defaults rather than
   * spelled out, so it follows them if they move.
   */
  it('has a card for the room a fresh library opens in', () => {
    const id = matchRoomPreset({
      theme: DEFAULT_THEME_ID,
      build: DEFAULT_SHELF_DESIGN.build,
      pattern: DEFAULT_SHELF_DESIGN.pattern,
      wallpaper: wallpaperSpec(DEFAULT_WALLPAPER_ID),
    });
    expect(id, 'no preset matches the default room').not.toBe('');
  });
});
