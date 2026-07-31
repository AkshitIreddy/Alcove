/**
 * features/bookshelf/libraryKey.ts — the one place a room's identity string
 * is spelled. Pure (no Pixi, no DB), so both the texture cache and the prefs
 * store can agree on it and tests can check it in a node environment.
 *
 * The key used to be `theme|pattern|colourway|backdrop`, because three of those
 * four were separate pickers. It is now the room's id plus the scheme itself:
 * the id alone would let an edited hex serve stale case art out of the disk
 * cache, and every colour in the scheme is baked into that art.
 *
 * The id AND the scheme, not just the scheme, because a reader can now take
 * the shelf from one room and the books from another — so the drawn scheme is
 * no longer recoverable from the room's name, and two different mixes could
 * otherwise collide on a shared preset id.
 */

import { shelfDesignTag, type ShelfDesignInput } from '../../art/shelfDesign';
import type { ColourScheme, LibraryTheme, ThemeId } from '../../art/themes';

/** Same string ⇒ byte-identical case art, given the same carpentry. */
export function schemeKey(themeId: ThemeId, s: ColourScheme): string {
  return [themeId, s.timber, s.timberDark, s.recess, s.wall, ...s.cloths.flat()].join('|');
}

/**
 * A room to bake the case in: its colours, and its carpentry.
 *
 * It was one field for a while, when a room really was only a colour scheme.
 * `design` is the second axis and is NOT part of the scheme on purpose —
 * repainting a room must not straighten its arches, and rebuilding the case
 * must not repaint it.
 */
export interface ThemeRequest {
  themeId: ThemeId;
  /**
   * The colours to draw, which are NOT necessarily `getTheme(themeId).scheme`.
   * A reader can take the shelf from one room and the books from another, so
   * the composed scheme is passed in rather than looked up — looking it up
   * would silently ignore every part that was borrowed.
   */
  scheme: ColourScheme;
  /**
   * The build and timber pattern. Optional and total: a partial blob (or junk
   * out of SQLite) resolves to the house plank case rather than throwing
   * inside a bake.
   */
  design?: ShelfDesignInput;
}

/**
 * Identity of a baked room — same key ⇒ same case art.
 *
 * It lives here rather than next to the bakes in `textures.ts` for the reason
 * this module exists at all: that file imports Pixi, so a node test cannot
 * load it, and "does every axis reach the key" is precisely the property that
 * has to be tested rather than eyeballed. A missing axis is invisible — the
 * disk cache validates nothing about a hit, so it serves the wrong art
 * forever on any machine that has drawn it once.
 */
export function themeKeyOf(req: ThemeRequest): string {
  return `${schemeKey(req.themeId, req.scheme)}|${shelfDesignTag(req.design)}`;
}

/** A whole preset's own key — the scheme it ships with, unmixed. */
export function libraryKey(theme: LibraryTheme): string {
  return schemeKey(theme.id, theme.scheme);
}
