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

import type { ColourScheme, LibraryTheme, ThemeId } from '../../art/themes';

/** Same string ⇒ byte-identical case art. */
export function schemeKey(themeId: ThemeId, s: ColourScheme): string {
  return [themeId, s.timber, s.timberDark, s.recess, s.wall, ...s.cloths.flat()].join('|');
}

/** A whole preset's own key — the scheme it ships with, unmixed. */
export function libraryKey(theme: LibraryTheme): string {
  return schemeKey(theme.id, theme.scheme);
}
